// assets/js/mint.js (TONFANS v6)
// Candy Machine v2 + Candy Guard (browser, no build).
// Emits `tonfans:state` for assets/js/ui.js.

(() => {
  const TAG = "[TONFANS]";
  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);
  const error = (...a) => console.error(TAG, ...a);

  window.TONFANS = window.TONFANS || {};
  window.TONFANS.mint = window.TONFANS.mint || {};

  // ---------- config
  const QS = new URLSearchParams(location.search);

  // Collection mint (sugar show)
  const COLLECTION_MINT = "9Zz8cBzFny6ZSzETZZxUeo7Qdi4nRTedNQVVwGhQ9P5w";
  // Collection update authority (deployer wallet)
  const COLLECTION_UPDATE_AUTHORITY = "9mG7vEEABrX5X4mg9WCAa17XpCxR28Ute2iEaDbHTJtD";

  // Candy Machines by tier
  const CM_BY_TIER = {
    lgen: "Hr9YzscC71vdHifZR4jRvMd8JmmGxbJrS6j7QckEVqKy",
    bgen: "Ewhn2nJV6tbvq59GMahyWmS54jQWL4n3mrsoVM8n8GHH",
    ldia: "8L5MLvbvM9EsZ8nb1NAwqzEXuVsiq5x5fHGNKchz6UQR",
    bdia: "EyjoAcKwkfNo8NqCZczHHnNSi3ccYpnCetkBUwbqCien",
  };

  const TIER_ALIASES = {
    lgen: "lgen",
    bgen: "bgen",
    ldia: "ldia",
    bdia: "bdia",
    littlegen: "lgen",
    biggen: "bgen",
    "littlegen-diamond": "ldia",
    "biggen-diamond": "bdia",
    "littlegen_diamond": "ldia",
    "biggen_diamond": "bdia",
  };

  const TIER_LABEL = {
    lgen: "LittlGEN",
    bgen: "BigGEN",
    ldia: "LittlGEN Diamond",
    bdia: "BigGEN Diamond",
  };

  // Candy Guard mintLimit.id (guards.default.mintLimit.id in your config.json)
  const MINT_LIMIT_ID = 1;

  // Cluster / RPC
  const CLUSTER = (QS.get("cluster") || "mainnet").toLowerCase();
  const RPC =
    QS.get("rpc") ||
    (CLUSTER === "mainnet" || CLUSTER === "mainnet-beta"
      ? "https://api.mainnet-beta.solana.com"
      : "https://api.devnet.solana.com");

  const CU_LIMIT = 800_000;

  // ---------- DOM helpers
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function shortPk(pk) {
    const s = String(pk || "");
    if (!s) return "—";
    if (s.length <= 10) return s;
    return `${s.slice(0, 4)}…${s.slice(-4)}`;
  }

  function setStatus(msg) {
    const el =
      $("#mintHint") ||
      $("#mintStatus") ||
      $("#mintMessage") ||
      $(".mint-hint") ||
      $(".mint-status") ||
      $(".mint-message") ||
      $("#statusLine");
    if (el) el.textContent = msg || "";
  }

  // ---------- state
  const state = {
    sdkReady: false,
    tier: null,
    cmId: null,
    guardId: null,
    walletConnected: false,
    walletPk: null,
    networkLabel: CLUSTER === "mainnet" || CLUSTER === "mainnet-beta" ? "Mainnet" : "Devnet",
    ready: false,
    busy: false,
    priceLamports: null,
    priceNumeric: null, // "0.10"
    qty: 1,
  };

  function computeTotalLabel() {
    if (!state.priceNumeric) return "—";
    const p = Number(state.priceNumeric);
    const q = Math.max(1, Number(state.qty || 1));
    if (!Number.isFinite(p) || !Number.isFinite(q)) return "—";
    return (p * q).toFixed(2);
  }

  function tierLabel(tier) {
    return tier ? (TIER_LABEL[tier] || tier) : null;
  }

  function guardLabel() {
    return state.guardId ? shortPk(String(state.guardId)) : "—";
  }

  function dispatchState(extra = {}) {
    Object.assign(state, extra);

    state.ready = Boolean(
      state.sdkReady &&
        state.walletConnected &&
        state.tier &&
        state.cmId &&
        state.guardId &&
        !state.busy
    );

    window.dispatchEvent(
      new CustomEvent("tonfans:state", {
        detail: {
          tier: state.tier,
          tierLabel: tierLabel(state.tier),
          guardLabel: guardLabel(),

          walletConnected: state.walletConnected,
          walletPk: state.walletPk || null,
          networkLabel: state.networkLabel,

          ready: state.ready,
          busy: state.busy,

          qty: Number(state.qty || 1),
          priceLabel: state.priceNumeric || "—",
          totalLabel: computeTotalLabel(),
        },
      })
    );

    updateLegacyUI();
  }

  // ---------- legacy template support (ids already exist in your index.html)
  function updateLegacyUI() {
    const qtyEl = $("#qty");
    if (qtyEl) qtyEl.textContent = String(state.qty);

    const priceEl = $("#price");
    const totalEl = $("#total");
    if (priceEl) priceEl.textContent = state.priceNumeric || (priceEl.textContent || "—");
    if (totalEl) totalEl.textContent = computeTotalLabel();

    const mintBtn = $("#mintBtn");
    if (mintBtn) {
      mintBtn.textContent = state.busy ? "Minting..." : "Mint now";
      if (state.ready) {
        mintBtn.removeAttribute("disabled");
        mintBtn.style.opacity = "";
        mintBtn.style.cursor = "pointer";
      } else {
        mintBtn.setAttribute("disabled", "true");
        mintBtn.style.opacity = ".55";
        mintBtn.style.cursor = "not-allowed";
      }
    }
  }

  // ---------- SDK loader (esm.sh)
  let SDK = null;
  async function loadSdkOnce() {
    if (SDK) return SDK;

    const UMI_DEFAULTS = "https://esm.sh/@metaplex-foundation/umi-bundle-defaults@latest?bundle&target=es2022";
    const UMI_CORE = "https://esm.sh/@metaplex-foundation/umi@latest?bundle&target=es2022";
    const UMI_WALLET = "https://esm.sh/@metaplex-foundation/umi-signer-wallet-adapters@latest?bundle&target=es2022";
    const MPL_CM = "https://esm.sh/@metaplex-foundation/mpl-candy-machine@latest?bundle&target=es2022";
    const MPL_TOOLBOX = "https://esm.sh/@metaplex-foundation/mpl-toolbox@latest?bundle&target=es2022";

    const [{ createUmi }, umiCore, walletAdapters, mplCm, toolbox] = await Promise.all([
      import(UMI_DEFAULTS),
      import(UMI_CORE),
      import(UMI_WALLET),
      import(MPL_CM),
      import(MPL_TOOLBOX),
    ]);

    SDK = {
      createUmi,
      publicKey: umiCore.publicKey,
      generateSigner: umiCore.generateSigner,
      some: umiCore.some,
      transactionBuilder: umiCore.transactionBuilder,
      walletAdapterIdentity: walletAdapters.walletAdapterIdentity,
      mplCandyMachine: mplCm.mplCandyMachine,
      fetchCandyMachine: mplCm.fetchCandyMachine,
      safeFetchCandyGuard: mplCm.safeFetchCandyGuard,
      mintV2: mplCm.mintV2,
      setComputeUnitLimit: toolbox.setComputeUnitLimit,
    };

    log("SDK loaded.");
    return SDK;
  }

  // ---------- Phantom provider + Umi instance
  let umi = null;

  function getProvider() {
    return window.solana || null;
  }

  function makeAdapterFromProvider(provider) {
    return {
      publicKey: provider.publicKey || null,
      connected: Boolean(provider.isConnected),
      connect: () => provider.connect(),
      disconnect: () => provider.disconnect(),
      signTransaction: provider.signTransaction?.bind(provider),
      signAllTransactions: provider.signAllTransactions?.bind(provider),
      signMessage: provider.signMessage?.bind(provider),
      on: provider.on?.bind(provider),
      off: provider.off?.bind(provider),
    };
  }

  async function ensureUmiWithIdentity() {
    const sdk = await loadSdkOnce();
    if (!umi) umi = sdk.createUmi(RPC).use(sdk.mplCandyMachine());

    const provider = getProvider();
    if (!provider) throw new Error("No Solana wallet found. Install Phantom.");

    const adapter = makeAdapterFromProvider(provider);
    umi.use(sdk.walletAdapterIdentity(adapter));

    return { sdk, umi, provider };
  }

  // ---------- lamports helpers
  function lamportsFromSolAmount(solAmount) {
    if (!solAmount) return null;
    if (typeof solAmount === "bigint") return solAmount;
    if (typeof solAmount === "number") return BigInt(Math.floor(solAmount));
    if (typeof solAmount === "string" && /^\d+$/.test(solAmount)) return BigInt(solAmount);
    if (typeof solAmount === "object") {
      if (solAmount.basisPoints != null) return BigInt(solAmount.basisPoints);
      if (solAmount.lamports != null) return BigInt(solAmount.lamports);
      if (solAmount.amount != null) return lamportsFromSolAmount(solAmount.amount);
    }
    return null;
  }

  function lamportsToNumeric(lamports) {
    if (lamports == null) return null;
    return (Number(lamports) / 1e9).toFixed(2);
  }

  // ---------- tier refresh (resolve guard + price)
  async function refreshForTier(tierKey) {
    const tier = TIER_ALIASES[String(tierKey || "").toLowerCase()] || null;
    const cmId = tier ? (CM_BY_TIER[tier] || null) : null;

    dispatchState({ tier, cmId, guardId: null, priceLamports: null, priceNumeric: null });

    if (!cmId) {
      setStatus("Select a tier.");
      return;
    }

    try {
      const { sdk, umi } = await ensureUmiWithIdentity();

      const cmPk = sdk.publicKey(cmId);
      const cm = await sdk.fetchCandyMachine(umi, cmPk);

      // CandyGuard is CM.mintAuthority AFTER `sugar guard add`
      let guardId = null;
      let priceLamports = null;

      try {
        const cgPk = cm.mintAuthority;
        const cg = await sdk.safeFetchCandyGuard(umi, cgPk);
        if (cg) {
          guardId = cgPk;

          const g =
            (cg.guards && cg.guards.default) ||
            (cg.groups && cg.groups.default && cg.groups.default.guards) ||
            cg.guards ||
            null;

          const solPay = g && g.solPayment && g.solPayment.value ? g.solPayment.value : null;
          if (solPay && solPay.amount) priceLamports = lamportsFromSolAmount(solPay.amount);
        }
      } catch (e) {
        warn("CandyGuard not resolved for this CM (likely not wrapped):", e);
      }

      const priceNumeric = priceLamports != null ? lamportsToNumeric(priceLamports) : null;

      dispatchState({ guardId, priceLamports, priceNumeric });

      if (!guardId) {
        setStatus("Candy Guard is NOT set for this tier. Run: cd cm-<tier> && sugar guard add");
      } else if (!state.walletConnected) {
        setStatus("Select tier → Connect wallet → Mint.");
      } else {
        setStatus("Ready. Click Mint now.");
      }
    } catch (e) {
      error("refresh tier failed:", e);
      setStatus(String(e?.message || e));
    }
  }

  // ---------- connect / disconnect
  async function connectWallet() {
    const provider = getProvider();
    if (!provider) throw new Error("No Solana wallet found. Install Phantom.");
    await provider.connect();

    const pk = provider.publicKey?.toBase58 ? provider.publicKey.toBase58() : String(provider.publicKey || "");
    dispatchState({
      walletConnected: true,
      walletPk: pk,
    });

    await ensureUmiWithIdentity();
    if (state.tier) await refreshForTier(state.tier);
  }

  async function disconnectWallet() {
    const provider = getProvider();
    if (provider?.disconnect) {
      try {
        await provider.disconnect();
      } catch (_) {}
    }
    dispatchState({ walletConnected: false, walletPk: null });
    setStatus("Disconnected.");
  }

  async function toggleConnect() {
    try {
      const provider = getProvider();
      if (!provider) throw new Error("No wallet found.");
      if (provider.isConnected) await disconnectWallet();
      else await connectWallet();
    } catch (e) {
      error("toggleConnect failed:", e);
      setStatus(String(e?.message || e));
    }
  }

  // ---------- mint
  async function mintOnce() {
    const { sdk, umi } = await ensureUmiWithIdentity();

    if (!state.cmId) throw new Error("Select a tier first.");
    if (!state.guardId) throw new Error("Candy Guard missing for this tier (wrap CM).");
    if (!state.walletConnected) throw new Error("Connect wallet first.");

    const cmPk = sdk.publicKey(state.cmId);
    const cm = await sdk.fetchCandyMachine(umi, cmPk);

    const nftMint = sdk.generateSigner(umi);

    const mintArgs = {
      mintLimit: sdk.some({ id: MINT_LIMIT_ID }),
    };

    const builder = sdk
      .transactionBuilder()
      .add(sdk.setComputeUnitLimit(umi, { units: CU_LIMIT }))
      .add(
        sdk.mintV2(umi, {
          candyMachine: cmPk,
          nftMint,
          collectionMint: sdk.publicKey(COLLECTION_MINT),
          collectionUpdateAuthority: sdk.publicKey(COLLECTION_UPDATE_AUTHORITY),
          tokenStandard: cm.tokenStandard,
          mintArgs,
        })
      );

    const res = await builder.sendAndConfirm(umi, { confirm: { commitment: "confirmed" } });
    const sig = (res && (res.signature || res)) || null;
    const sigStr = typeof sig === "string" ? sig : (sig?.toString?.() || "");
    return { signature: sigStr, mint: nftMint.publicKey?.toString?.() || String(nftMint.publicKey) };
  }

  async function mintNow() {
    if (state.busy) return;

    try {
      dispatchState({ busy: true });

      if (!state.tier) throw new Error("Select a tier first.");

      if (!state.walletConnected) {
        setStatus("Connecting wallet...");
        await connectWallet();
      }

      // ensure latest guard/price
      await refreshForTier(state.tier);

      if (!state.guardId) {
        throw new Error("Candy Guard is NOT set for this tier. Run: cd cm-<tier> && sugar guard add");
      }

      if (!state.ready) throw new Error("Not ready yet.");

      setStatus("Minting...");

      const n = Math.max(1, Math.min(10, Number(state.qty || 1)));
      const results = [];
      for (let i = 0; i < n; i++) {
        setStatus(`Minting ${i + 1}/${n}...`);
        results.push(await mintOnce());
      }

      const last = results[results.length - 1];
      setStatus(`Mint success (${n}). Tx: ${last.signature || "confirmed"}`);
      log("mint success:", results);
    } catch (e) {
      error("mint failed:", e);
      const msg = String(e?.message || e);

      if (msg.includes("UnexpectedAccountError") || msg.includes("CandyGuard")) {
        setStatus("Mint failed: this tier CM is not wrapped with Candy Guard. Run: cd cm-<tier> && sugar guard add");
      } else {
        setStatus(msg);
      }
    } finally {
      dispatchState({ busy: false });
    }
  }

  // ---------- wiring
  function bindClicks() {
    // Connect button (legacy)
    const connectBtn = $("#connectBtn") || $("#walletBtn") || $("#connectWalletBtn");
    if (connectBtn && !connectBtn.__tonfans_bound) {
      connectBtn.__tonfans_bound = true;
      connectBtn.addEventListener("click", (e) => {
        e.preventDefault();
        toggleConnect();
      });
    }

    // Mint button (legacy)
    const mintBtn = $("#mintBtn");
    if (mintBtn && !mintBtn.__tonfans_bound) {
      mintBtn.__tonfans_bound = true;
      mintBtn.addEventListener("click", (e) => {
        e.preventDefault();
        mintNow();
      });
    }

    // Qty controls
    const minus = $("#qtyMinus");
    const plus = $("#qtyPlus");

    if (minus && !minus.__tonfans_bound) {
      minus.__tonfans_bound = true;
      minus.addEventListener("click", (e) => {
        e.preventDefault();
        state.qty = Math.max(1, Number(state.qty || 1) - 1);
        dispatchState({ qty: state.qty });
      });
    }

    if (plus && !plus.__tonfans_bound) {
      plus.__tonfans_bound = true;
      plus.addEventListener("click", (e) => {
        e.preventDefault();
        state.qty = Math.min(10, Number(state.qty || 1) + 1);
        dispatchState({ qty: state.qty });
      });
    }
  }

  // Listen tier selection from ui.js
  window.addEventListener("tonfans:tier", (e) => {
    const tier = e?.detail?.tier;
    if (tier) refreshForTier(tier);
  });

  // Expose for ui.js
  window.TONFANS.mint.toggleConnect = toggleConnect;
  window.TONFANS.mint.mintNow = mintNow;
  window.TONFANS.mint.setTier = (tier) => refreshForTier(tier);

  // ---------- init
  async function init() {
    try {
      await loadSdkOnce();
      dispatchState({ sdkReady: true });
    } catch (e) {
      dispatchState({ sdkReady: false });
      setStatus(String(e?.message || e));
    }

    // wallet detection
    const provider = getProvider();
    if (provider?.isConnected && provider.publicKey) {
      const pk = provider.publicKey.toBase58 ? provider.publicKey.toBase58() : String(provider.publicKey);
      dispatchState({ walletConnected: true, walletPk: pk });
    } else {
      dispatchState({ walletConnected: false, walletPk: null });
    }

    // optional: preselect tier from URL (?tier=lgen|bgen|ldia|bdia or data-tier values)
    const tierParam = (QS.get("tier") || "").toLowerCase();
    const initialTier = TIER_ALIASES[tierParam] || null;
    if (initialTier) refreshForTier(initialTier);

    bindClicks();
    updateLegacyUI();

    // phantom events
    if (provider?.on) {
      try {
        provider.on("connect", () => {
          const pk = provider.publicKey?.toBase58?.() || String(provider.publicKey || "");
          dispatchState({ walletConnected: true, walletPk: pk });
        });
        provider.on("disconnect", () => {
          dispatchState({ walletConnected: false, walletPk: null });
        });
        provider.on("accountChanged", (pubkey) => {
          const pk = pubkey?.toBase58?.() || String(pubkey || "");
          if (!pk) dispatchState({ walletConnected: false, walletPk: null });
          else dispatchState({ walletConnected: true, walletPk: pk });
          if (state.tier) refreshForTier(state.tier);
        });
      } catch (_) {}
    }

    log("init done", { cluster: CLUSTER, rpc: RPC });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
