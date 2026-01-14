// assets/js/mint.js
// TON Fans — Candy Machine v2 + Candy Guard (browser, no build)
//
// index.html must include:
//   <script type="module" src="assets/js/mint.js"></script>
//   <script src="assets/js/ui.js"></script>
//
// Key idea:
// - UI (tier selection, sticky, chips) is handled by assets/js/ui.js
// - Mint logic is here (connect/disconnect + mint via Candy Guard)
//
// IMPORTANT (your current issue):
// If a tier's CM is NOT wrapped, mint will NOT work and you will see:
//   UnexpectedAccountError ... expected type [CandyGuard]
// Fix per tier:
//   cd cm-<tier> && sugar guard add
//
// This file:
// - Loads Metaplex Umi + mpl-candy-machine from esm.sh (no pinned versions to avoid CDN 404)
// - Resolves CandyGuard from CandyMachine.mintAuthority (after wrapping)
// - Enforces mintLimit mintArgs (id from your config.json)
// - Emits "tonfans:state" for ui.js (Wallet/Ready/Network/Price/Tier)
// - Supports older template IDs (connectBtn/mintBtn/price/total/stickyMintBar) if they exist.

(() => {
  const TAG = "[TONFANS]";
  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);
  const err = (...a) => console.error(TAG, ...a);

  window.TONFANS = window.TONFANS || {};
  window.TONFANS.mint = window.TONFANS.mint || {};

  // ---------- config (EDIT IF NEEDED)
  const QS = new URLSearchParams(location.search);

  // Collection mint (from sugar show output)
  const COLLECTION_MINT = "9Zz8cBzFny6ZSzETZZxUeo7Qdi4nRTedNQVVwGhQ9P5w";
  // Collection update authority (your deployer wallet public key)
  const COLLECTION_UPDATE_AUTHORITY = "9mG7vEEABrX5X4mg9WCAa17XpCxR28Ute2iEaDbHTJtD";

  // Candy Machines by tier (devnet right now)
  const CM_BY_TIER = {
    lgen: "Hr9YzscC71vdHifZR4jRvMd8JmmGxbJrS6j7QckEVqKy",
    bgen: "Ewhn2nJV6tbvq59GMahyWmS54jQWL4n3mrsoVM8n8GHH",
    ldia: "8L5MLvbvM9EsZ8nb1NAwqzEXuVsiq5x5fHGNKchz6UQR",
    bdia: "EyjoAcKwkfNo8NqCZczHHnNSi3ccYpnCetkBUwbqCien",
  };

  // Candy Guard mintLimit.id (from guards.default.mintLimit.id in your config.json)
  const MINT_LIMIT_ID = 1;

  // Cluster / RPC
  const CLUSTER = (QS.get("cluster") || "devnet").toLowerCase();
  const RPC =
    QS.get("rpc") ||
    (CLUSTER === "mainnet" || CLUSTER === "mainnet-beta"
      ? "https://api.mainnet-beta.solana.com"
      : "https://api.devnet.solana.com");

  // Compute budget (safe)
  const CU_LIMIT = 800_000;

  // ---------- state
  const state = {
    sdkReady: false,
    tier: null,
    cmId: null,
    guardId: null,
    walletConnected: false,
    walletPk: null,
    walletLabel: "Not connected",
    networkLabel: CLUSTER === "mainnet" || CLUSTER === "mainnet-beta" ? "Mainnet" : "Devnet",
    ready: false,
    busy: false,
    priceLamports: null,
    priceNumeric: null, // "0.15"
    qty: 1,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function shortPk(pk) {
    const s = String(pk || "");
    if (s.length <= 10) return s || "—";
    return `${s.slice(0, 4)}…${s.slice(-4)}`;
  }

  function setStatus(msg) {
    // Templates commonly use these:
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

  function dispatchState(extra = {}) {
    Object.assign(state, extra);

    // "ready" definition (guard required)
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
          walletConnected: state.walletConnected,
          walletLabel: state.walletLabel,
          networkLabel: state.networkLabel,
          ready: state.ready,
          // send numeric for ui.js (to avoid "SOL SOL" duplicates)
          priceLabel: state.priceNumeric || "—",
        },
      })
    );

    updateLegacyUI();
  }

  // ---------- legacy template support (optional)
  function updateLegacyUI() {
    // Connect label
    const connectBtn = $("#connectBtn") || $("#walletBtn") || $("#connectWalletBtn");
    if (connectBtn) {
      connectBtn.removeAttribute("disabled");
      connectBtn.textContent = state.walletConnected
        ? `Connected: ${shortPk(state.walletPk)}`
        : "Connect Wallet";
    }

    // Quantity
    const qtyEl = $("#qty");
    if (qtyEl) qtyEl.textContent = String(state.qty);

    // Price / Total (legacy template uses <span id="price">0.10</span> SOL)
    const priceEl = $("#price");
    const totalEl = $("#total");
    if (priceEl) priceEl.textContent = state.priceNumeric || "—";
    if (totalEl) {
      if (!state.priceNumeric) totalEl.textContent = "—";
      else {
        const p = Number(state.priceNumeric);
        const t = (p * Number(state.qty || 1)).toFixed(2);
        totalEl.textContent = t;
      }
    }

    // Mint button
    const mintBtn = $("#mintBtn");
    if (mintBtn) {
      mintBtn.textContent = state.busy ? "Minting..." : "Mint now";
      if (state.ready) {
        mintBtn.removeAttribute("disabled");
        mintBtn.style.opacity = "";
        mintBtn.style.cursor = "";
      } else {
        mintBtn.setAttribute("disabled", "true");
        mintBtn.style.opacity = ".55";
        mintBtn.style.cursor = "not-allowed";
      }
    }

    // Sticky bar (legacy template id="stickyMintBar")
    const sticky = $("#stickyMintBar");
    if (sticky) {
      const shouldShow = (window.scrollY || 0) > 520;
      sticky.classList.toggle("hidden", !shouldShow);

      const stickySelected = $("#stickySelected");
      if (stickySelected) stickySelected.textContent = state.tier ? state.tier.toUpperCase() : "—";

      const stickyActionBtn = $("#stickyActionBtn");
      if (stickyActionBtn) {
        stickyActionBtn.textContent = state.walletConnected
          ? (state.ready ? "Mint now" : "Set CM address →")
          : "Connect";
        if (state.ready) stickyActionBtn.removeAttribute("disabled");
        else stickyActionBtn.setAttribute("disabled", "true");
      }
    }

    // ui.js also manages buttons by class, but we additionally remove disabled attr on generic mint buttons when ready
    $$("button,a")
      .filter((el) => /mint now/i.test((el.textContent || "").trim()))
      .forEach((b) => {
        if (state.ready) b.removeAttribute("disabled");
      });
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

    try {
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
    } catch (e) {
      warn("SDK import failed:", e);
      throw new Error("Failed to load Metaplex SDK from esm.sh (check Network tab).");
    }
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

    // attach identity (works after connect AND if already connected)
    const adapter = makeAdapterFromProvider(provider);
    umi.use(sdk.walletAdapterIdentity(adapter));

    return { sdk, umi, provider };
  }

  // ---------- helpers
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
    const sol = Number(lamports) / 1e9;
    return sol.toFixed(2);
  }

  // ---------- tier refresh (resolve guard + price)
  async function refreshForTier(tier) {
    const cmId = CM_BY_TIER[tier] || null;
    dispatchState({ tier, cmId, guardId: null, priceLamports: null, priceNumeric: null });
    setStatus("");

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

          // Guards are stored per group. Most setups use "default".
          // The exact shape can vary by SDK bundling; try common access patterns:
          const g =
            (cg.guards && cg.guards.default) ||
            (cg.groups && cg.groups.default && cg.groups.default.guards) ||
            cg.guards ||
            null;

          const solPay = g && g.solPayment && g.solPayment.value ? g.solPayment.value : null;
          if (solPay && solPay.amount) priceLamports = lamportsFromSolAmount(solPay.amount);
        }
      } catch (e) {
        // not wrapped (mintAuthority is your wallet) -> this will fail to deserialize as CandyGuard
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
      err("refresh tier failed:", e);
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
      walletLabel: shortPk(pk),
    });

    await ensureUmiWithIdentity();
    if (state.tier) await refreshForTier(state.tier);
    else updateLegacyUI();
  }

  async function disconnectWallet() {
    const provider = getProvider();
    if (provider?.disconnect) {
      try {
        await provider.disconnect();
      } catch (_) {}
    }
    dispatchState({ walletConnected: false, walletPk: null, walletLabel: "Not connected" });
    setStatus("Disconnected.");
  }

  async function toggleConnect() {
    try {
      const provider = getProvider();
      if (!provider) throw new Error("No wallet found.");
      if (provider.isConnected) await disconnectWallet();
      else await connectWallet();
    } catch (e) {
      err("toggleConnect failed:", e);
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
      state.busy = true;
      dispatchState({ busy: true });

      if (!state.tier) throw new Error("Select a tier first.");

      if (!state.walletConnected) {
        setStatus("Connecting wallet...");
        await connectWallet();
      }

      await refreshForTier(state.tier);

      if (!state.guardId) {
        throw new Error("Candy Guard is NOT set for this tier. Run: cd cm-<tier> && sugar guard add");
      }

      if (!state.ready) throw new Error("Not ready yet.");

      setStatus("Minting...");
      updateLegacyUI();

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
      err("mint failed:", e);
      const msg = String(e?.message || e);

      // Most common hard fail you had:
      if (msg.includes("UnexpectedAccountError") || msg.includes("CandyGuard")) {
        setStatus("Mint failed: this tier CM is not wrapped with Candy Guard. Run: cd cm-<tier> && sugar guard add");
      } else {
        setStatus(msg);
      }
    } finally {
      state.busy = false;
      dispatchState({ busy: false });
      updateLegacyUI();
    }
  }

  // ---------- wiring
  function bindClicks() {
    // legacy connect btn
    const connectBtn = $("#connectBtn") || $("#walletBtn") || $("#connectWalletBtn");
    if (connectBtn && !connectBtn.__tonfans_bound) {
      connectBtn.__tonfans_bound = true;
      connectBtn.addEventListener("click", (e) => {
        e.preventDefault();
        toggleConnect();
      });
    }

    // legacy mint btn
    const mintBtn = $("#mintBtn");
    if (mintBtn && !mintBtn.__tonfans_bound) {
      mintBtn.__tonfans_bound = true;
      mintBtn.addEventListener("click", (e) => {
        e.preventDefault();
        mintNow();
      });
    }

    // legacy sticky action
    const stickyActionBtn = $("#stickyActionBtn");
    if (stickyActionBtn && !stickyActionBtn.__tonfans_bound) {
      stickyActionBtn.__tonfans_bound = true;
      stickyActionBtn.addEventListener("click", (e) => {
        e.preventDefault();
        if (!state.walletConnected) toggleConnect();
        else mintNow();
      });
    }

    // generic mint buttons
    $$("button,a")
      .filter((el) => /mint now/i.test((el.textContent || "").trim()))
      .forEach((b) => {
        if (b.__tonfans_bound) return;
        b.__tonfans_bound = true;
        b.addEventListener("click", (e) => {
          e.preventDefault();
          mintNow();
        });
      });

    // legacy qty controls (#qtyMinus/#qtyPlus)
    const minus = $("#qtyMinus");
    const plus = $("#qtyPlus");
    if (minus && !minus.__tonfans_bound) {
      minus.__tonfans_bound = true;
      minus.addEventListener("click", (e) => {
        e.preventDefault();
        state.qty = Math.max(1, Number(state.qty || 1) - 1);
        updateLegacyUI();
      });
    }
    if (plus && !plus.__tonfans_bound) {
      plus.__tonfans_bound = true;
      plus.addEventListener("click", (e) => {
        e.preventDefault();
        state.qty = Math.min(10, Number(state.qty || 1) + 1);
        updateLegacyUI();
      });
    }
  }

  // listen tier selection from ui.js
  window.addEventListener("tonfans:tier", (e) => {
    const tier = e?.detail?.tier;
    if (tier) refreshForTier(tier);
  });

  // expose for ui.js sticky
  window.TONFANS.mint.toggleConnect = toggleConnect;
  window.TONFANS.mint.mintNow = mintNow;
  window.TONFANS.mint.setTier = (tier) => refreshForTier(tier);

  // ---------- init
  async function init() {
    // pre-load SDK
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
      dispatchState({ walletConnected: true, walletPk: pk, walletLabel: shortPk(pk) });
    } else {
      dispatchState({ walletConnected: false, walletPk: null, walletLabel: "Not connected" });
    }

    bindClicks();
    updateLegacyUI();

    window.addEventListener("scroll", updateLegacyUI, { passive: true });
    window.addEventListener("resize", updateLegacyUI);

    // phantom events
    if (provider?.on) {
      try {
        provider.on("connect", () => {
          const pk = provider.publicKey?.toBase58?.() || String(provider.publicKey || "");
          dispatchState({ walletConnected: true, walletPk: pk, walletLabel: shortPk(pk) });
        });
        provider.on("disconnect", () => {
          dispatchState({ walletConnected: false, walletPk: null, walletLabel: "Not connected" });
        });
        provider.on("accountChanged", (pubkey) => {
          const pk = pubkey?.toBase58?.() || String(pubkey || "");
          if (!pk) dispatchState({ walletConnected: false, walletPk: null, walletLabel: "Not connected" });
          else dispatchState({ walletConnected: true, walletPk: pk, walletLabel: shortPk(pk) });
          if (state.tier) refreshForTier(state.tier);
        });
      } catch (_) {}
    }

    log("init done", { cluster: CLUSTER, rpc: RPC });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
