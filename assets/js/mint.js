// assets/js/mint.js
// TON Fans — Guard-only mint (Phantom/Solflare via window.solana)
// Works with your current assets/js/ui.js via:
//  - listens: "tonfans:tier"
//  - emits:   "tonfans:state"
//  - exposes: window.TONFANS.mint.toggleConnect(), mintNow()

(() => {
  const TAG = "[TONFANS]";
  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);
  const err = (...a) => console.error(TAG, ...a);

  // ---------------------------
  // CONFIG (edit if needed)
  // ---------------------------

  // Your 4 Candy Machines (DEVNET right now, based on your sugar logs)
  const DEFAULT_CM_BY_TIER = {
    lgen: "Hr9YzscC71vdHifZR4jRvMd8JmmGxbJrS6j7QckEVqKy",
    bgen: "Ewhn2nJV6tbvq59GMahyWmS54jQWL4n3mrsoVM8n8GHH",
    ldia: "8L5MLvbvM9EsZ8nb1NAwqzEXuVsiq5x5fHGNKchz6UQR",
    bdia: "EyjoAcKwkfNo8NqCZczHHnNSi3ccYpnCetkBUwbqCien",
  };

  // Collection mint (same for all tiers)
  const DEFAULT_COLLECTION_MINT = "9Zz8cBzFny6ZSzETZZxUeo7Qdi4nRTedNQVVwGhQ9P5w";

  // If you want to override from index.html:
  // window.TONFANS_CONFIG = { cluster:"devnet", rpc:"...", CM_BY_TIER:{...}, COLLECTION_MINT:"..." }
  const CFG = (window.TONFANS_CONFIG ||= {});
  const CM_BY_TIER = CFG.CM_BY_TIER || DEFAULT_CM_BY_TIER;
  const COLLECTION_MINT = CFG.COLLECTION_MINT || DEFAULT_COLLECTION_MINT;

  // Cluster / RPC
  const qp = new URLSearchParams(location.search);
  const CLUSTER =
    (CFG.cluster || qp.get("cluster") || "devnet").toLowerCase(); // devnet | mainnet-beta
  const RPC =
    CFG.rpc ||
    qp.get("rpc") ||
    (CLUSTER === "mainnet" || CLUSTER === "mainnet-beta"
      ? "https://api.mainnet-beta.solana.com"
      : "https://api.devnet.solana.com");

  const NETWORK_LABEL =
    CLUSTER === "mainnet" || CLUSTER === "mainnet-beta" ? "Mainnet" : "Devnet";

  // ---------------------------
  // UI helpers (robust selectors)
  // ---------------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const shortPk = (s) =>
    typeof s === "string" && s.length > 8 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s;

  function findButtonsByText(re) {
    return $$("button,a").filter((el) => re.test((el.textContent || "").trim()));
  }

  function getQty() {
    // try common ids/classes
    const cands = [
      $("#mintQty"),
      $("#qtyValue"),
      $("#quantityValue"),
      $("[data-qty]"),
      $("input[name='qty']"),
      $("input#qty"),
      $("input#mintQtyInput"),
    ].filter(Boolean);

    for (const el of cands) {
      const v =
        el.tagName === "INPUT"
          ? parseInt(el.value || "1", 10)
          : parseInt((el.textContent || "1").trim(), 10);
      if (Number.isFinite(v) && v > 0) return Math.min(10, v);
    }
    return 1;
  }

  function setStatus(message, kind = "info") {
    // try common status nodes
    const nodes = [
      $("#mintStatus"),
      $("#mintMessage"),
      $("#mintError"),
      $("[data-mint-status]"),
    ].filter(Boolean);

    if (nodes.length) {
      nodes.forEach((n) => {
        n.textContent = message;
        n.style.opacity = "1";
      });
      return;
    }

    // fallback: create under the first "Mint now" button
    const mintBtn = findButtonsByText(/^mint now$/i)[0];
    if (!mintBtn) return;
    let box = $("#tonfans-mint-status-inline");
    if (!box) {
      box = document.createElement("div");
      box.id = "tonfans-mint-status-inline";
      box.style.marginTop = "10px";
      box.style.fontSize = "13px";
      box.style.opacity = "0.9";
      mintBtn.parentElement?.appendChild(box);
    }
    box.textContent = message;
  }

  function emitState(partial) {
    window.dispatchEvent(
      new CustomEvent("tonfans:state", {
        detail: {
          networkLabel: NETWORK_LABEL,
          ...partial,
        },
      })
    );
  }

  // ---------------------------
  // Internal state
  // ---------------------------
  const STATE = {
    tier: null,
    cmAddress: null,
    candyMachine: null,

    // Guard-only
    candyGuardAddress: null,
    candyGuard: null,
    mintLimitId: null, // number
    mintLimitMax: null, // number
    priceSol: null, // number (unit price)

    // Wallet
    walletConnected: false,
    walletPubkey: null,

    // SDK cache
    sdk: null,
    sdkLoading: null,

    // Prevent double mint
    minting: false,
  };

  // ---------------------------
  // Wallet connect/disconnect (Phantom/Solflare)
  // ---------------------------
  function getProvider() {
    const p = window.solana;
    if (!p) return null;
    return p;
  }

  async function connectWallet() {
    const provider = getProvider();
    if (!provider) {
      setStatus("No Solana wallet found. Install Phantom / Solflare.");
      throw new Error("No wallet provider (window.solana).");
    }
    const resp = await provider.connect();
    const pk = (resp?.publicKey || provider.publicKey)?.toString?.();
    if (!pk) throw new Error("Wallet connected but no publicKey.");
    STATE.walletConnected = true;
    STATE.walletPubkey = pk;
    emitState({
      walletConnected: true,
      walletLabel: shortPk(pk),
      tier: STATE.tier,
      priceLabel: STATE.priceSol != null ? String(STATE.priceSol) : "—",
    });
    setStatus("Wallet connected.");
    return pk;
  }

  async function disconnectWallet() {
    const provider = getProvider();
    if (!provider) return;

    // Phantom supports disconnect()
    try {
      await provider.disconnect();
    } catch (e) {
      // Some wallets don't allow programmatic disconnect — we'll still reset local state.
      warn("disconnect() failed (non-fatal):", e);
    }

    STATE.walletConnected = false;
    STATE.walletPubkey = null;
    emitState({
      walletConnected: false,
      walletLabel: "Not connected",
    });
    setStatus("Disconnected.");
  }

  async function toggleConnect() {
    if (STATE.walletConnected) return disconnectWallet();
    return connectWallet();
  }

  // ---------------------------
  // Load SDK lazily (so UI/Connect never breaks)
  // ---------------------------
  async function loadSdk() {
    if (STATE.sdk) return STATE.sdk;
    if (STATE.sdkLoading) return STATE.sdkLoading;

    STATE.sdkLoading = (async () => {
      // Use esm.sh bundles (stable in browsers)
      const [
        solanaWeb3,
        umiCore,
        umiBundle,
        signerAdapters,
        mplCandy,
        mplToolbox,
      ] = await Promise.all([
        import("https://esm.sh/@solana/web3.js@1.98.4"),
        import("https://esm.sh/@metaplex-foundation/umi@0.9.2"),
        import("https://esm.sh/@metaplex-foundation/umi-bundle-defaults@1.4.1"),
        import("https://esm.sh/@metaplex-foundation/umi-signer-wallet-adapters@1.4.1"),
        import("https://esm.sh/@metaplex-foundation/mpl-candy-machine@6.0.1"),
        import("https://esm.sh/@metaplex-foundation/mpl-toolbox@0.10.0"),
      ]);

      const sdk = {
        clusterApiUrl: solanaWeb3.clusterApiUrl,
        umi: umiCore,
        createUmi: umiBundle.createUmi,
        walletAdapterIdentity: signerAdapters.walletAdapterIdentity,
        mplCandyMachine: mplCandy.mplCandyMachine,
        fetchCandyMachine: mplCandy.fetchCandyMachine,
        safeFetchCandyGuard: mplCandy.safeFetchCandyGuard,
        mintV2: mplCandy.mintV2,
        setComputeUnitLimit: mplToolbox.setComputeUnitLimit,
      };

      STATE.sdk = sdk;
      log("SDK loaded.");
      return sdk;
    })();

    return STATE.sdkLoading;
  }

  function makeWalletAdapter(provider) {
    // Minimal wallet-adapter-like wrapper for umi-signer-wallet-adapters
    return {
      publicKey: provider.publicKey,
      connected: !!provider.publicKey,
      // umi uses signTransaction/signAllTransactions
      signTransaction: async (tx) => provider.signTransaction(tx),
      signAllTransactions: async (txs) => provider.signAllTransactions(txs),
      // optional
      signMessage: provider.signMessage
        ? async (msg) => provider.signMessage(msg)
        : undefined,
    };
  }

  function optionValue(opt) {
    // umi option shape: { __option: 'Some', value: ... } or { __option: 'None' }
    if (!opt) return null;
    if (opt.__option === "Some") return opt.value;
    return null;
  }

  function toSol(lamports) {
    const n = typeof lamports === "bigint" ? Number(lamports) : Number(lamports || 0);
    return n / 1_000_000_000;
  }

  // ---------------------------
  // Fetch CM + Guard on tier select
  // ---------------------------
  async function refreshTierOnChain() {
    if (!STATE.cmAddress) return;

    const sdk = await loadSdk();
    const { createUmi, mplCandyMachine, fetchCandyMachine, safeFetchCandyGuard } =
      sdk;
    const { publicKey } = sdk.umi;

    const umi = createUmi(RPC).use(mplCandyMachine());

    // Fetch candy machine
    const cmPk = publicKey(STATE.cmAddress);
    const cm = await fetchCandyMachine(umi, cmPk);

    STATE.candyMachine = cm;

    // Guard = mintAuthority (when guard is attached)
    const guardPk = cm.mintAuthority;
    let guard = null;
    try {
      guard = await safeFetchCandyGuard(umi, guardPk);
    } catch (e) {
      guard = null;
    }

    if (!guard) {
      STATE.candyGuardAddress = null;
      STATE.candyGuard = null;
      STATE.priceSol = null;
      STATE.mintLimitId = null;
      STATE.mintLimitMax = null;

      emitState({
        tier: STATE.tier,
        priceLabel: "—",
      });

      setStatus(
        "Guard not configured for this Candy Machine yet. Run sugar guard add for this tier."
      );
      return;
    }

    STATE.candyGuardAddress = guardPk.toString();
    STATE.candyGuard = guard;

    // Extract guards (default set)
    const guards = guard.guards || {};
    const solPay = optionValue(guards.solPayment);
    const mintLimit = optionValue(guards.mintLimit);

    if (solPay?.lamports != null) {
      STATE.priceSol = Number(toSol(solPay.lamports).toFixed(3));
    } else {
      STATE.priceSol = null;
    }

    if (mintLimit) {
      STATE.mintLimitId = Number(mintLimit.id);
      STATE.mintLimitMax = Number(mintLimit.limit);
    } else {
      STATE.mintLimitId = null;
      STATE.mintLimitMax = null;
    }

    emitState({
      tier: STATE.tier,
      priceLabel: STATE.priceSol != null ? String(STATE.priceSol) : "—",
    });

    const ml = STATE.mintLimitMax ? ` (limit ${STATE.mintLimitMax}/wallet)` : "";
    setStatus(
      `Tier ready on-chain. Guard OK${ml}.` +
        (STATE.priceSol != null ? ` Price: ${STATE.priceSol} SOL.` : "")
    );
  }

  function setTier(tier) {
    const t = String(tier || "").toLowerCase();
    if (!CM_BY_TIER[t]) {
      warn("Unknown tier:", tier);
      return;
    }
    STATE.tier = t;
    STATE.cmAddress = CM_BY_TIER[t];

    emitState({
      tier: STATE.tier,
      priceLabel: STATE.priceSol != null ? String(STATE.priceSol) : "—",
    });

    // refresh CM + Guard from chain
    refreshTierOnChain().catch((e) => {
      err("refreshTierOnChain failed:", e);
      setStatus(`Error loading Candy Machine/Guard: ${e?.message || e}`);
    });
  }

  // ---------------------------
  // Mint (Guard-only)
  // ---------------------------
  async function mintOnce(umi, sdk) {
    const { publicKey, generateSigner, some, transactionBuilder } = sdk.umi;
    const { mintV2, setComputeUnitLimit } = sdk;

    if (!STATE.candyMachine || !STATE.candyGuardAddress) {
      throw new Error("Guard not configured (no candyGuard).");
    }

    const cmPk = publicKey(STATE.cmAddress);
    const guardPk = publicKey(STATE.candyGuardAddress);

    const nftMint = generateSigner(umi);

    // Mint args: mintLimit requires mintArgs.mintLimit: some({ id })
    const mintArgs = {};
    if (STATE.mintLimitId != null) {
      mintArgs.mintLimit = some({ id: STATE.mintLimitId });
    }

    const builder = transactionBuilder()
      .add(setComputeUnitLimit(umi, { units: 800_000 }))
      .add(
        mintV2(umi, {
          candyMachine: cmPk,
          candyGuard: guardPk,
          nftMint,

          // collection mint is stored on the CM
          collectionMint: STATE.candyMachine.collectionMint,
          // in your case update authority is your deploy wallet (umi identity)
          collectionUpdateAuthority: umi.identity,
          mintArgs: Object.keys(mintArgs).length ? mintArgs : undefined,
        })
      );

    const res = await builder.sendAndConfirm(umi);
    return { signature: res.signature, mint: nftMint.publicKey.toString() };
  }

  async function mintNow() {
    if (STATE.minting) return;

    try {
      if (!STATE.tier) {
        setStatus("Select tier first.");
        return;
      }
      if (!STATE.walletConnected) {
        setStatus("Connect wallet first.");
        return;
      }
      if (!STATE.candyGuardAddress) {
        setStatus("Guard not configured for this tier yet. (Run sugar guard add)");
        return;
      }

      const qty = getQty();

      if (STATE.mintLimitMax && qty > STATE.mintLimitMax) {
        setStatus(`Qty too high. Max per wallet is ${STATE.mintLimitMax}.`);
        return;
      }

      const sdk = await loadSdk();
      const provider = getProvider();
      if (!provider?.publicKey) {
        setStatus("Wallet not available. Reconnect.");
        return;
      }

      const { createUmi, mplCandyMachine, walletAdapterIdentity } = sdk;

      const umi = createUmi(RPC)
        .use(mplCandyMachine())
        .use(walletAdapterIdentity(makeWalletAdapter(provider)));

      STATE.minting = true;

      // Ensure buttons really clickable (ui.js sometimes only removes class)
      findButtonsByText(/^mint now$/i).forEach((b) => {
        b.classList.remove("tonfans-disabled");
        b.removeAttribute("disabled");
      });

      setStatus(`Minting ${qty}…`);

      const results = [];
      for (let i = 0; i < qty; i++) {
        setStatus(`Minting ${i + 1}/${qty}…`);
        // eslint-disable-next-line no-await-in-loop
        const r = await mintOnce(umi, sdk);
        results.push(r);
      }

      const last = results[results.length - 1];
      setStatus(`✅ Mint success. Mint: ${last.mint}`);
      log("mint success:", results);
    } catch (e) {
      err("mint failed:", e);
      setStatus(`Mint failed: ${e?.message || e}`);
    } finally {
      STATE.minting = false;
    }
  }

  // ---------------------------
  // Wire page buttons (so click реально запускает mintNow)
  // ---------------------------
  function wireButtons() {
    // Connect buttons
    const connectBtns = findButtonsByText(/^connect$/i).concat(
      findButtonsByText(/^connected:/i),
      findButtonsByText(/^disconnect$/i)
    );

    connectBtns.forEach((btn) => {
      if (btn.dataset.tonfansWired) return;
      btn.dataset.tonfansWired = "1";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        toggleConnect().catch((e2) => setStatus(`Connect error: ${e2?.message || e2}`));
      });
    });

    // Mint buttons
    const mintBtns = findButtonsByText(/^mint now$/i);
    mintBtns.forEach((btn) => {
      if (btn.dataset.tonfansWired) return;
      btn.dataset.tonfansWired = "1";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        mintNow();
      });
    });
  }

  // ---------------------------
  // Public API for ui.js
  // ---------------------------
  function ensureGlobalApi() {
    window.TONFANS ||= {};
    window.TONFANS.mint ||= {};
    window.TONFANS.mint.toggleConnect = toggleConnect;
    window.TONFANS.mint.mintNow = mintNow;
    window.TONFANS.mint.setTier = setTier;
    window.TONFANS.mint.debug = () => ({ ...STATE });
  }

  // ---------------------------
  // Listen tier from ui.js
  // ---------------------------
  window.addEventListener("tonfans:tier", (e) => {
    const tier = e?.detail?.tier;
    setTier(tier);
  });

  // ---------------------------
  // Init
  // ---------------------------
  function init() {
    ensureGlobalApi();

    // publish initial state
    emitState({
      walletConnected: false,
      walletLabel: "Not connected",
      networkLabel: NETWORK_LABEL,
      priceLabel: "—",
    });

    // wire buttons now + later (in case DOM updates)
    wireButtons();
    const mo = new MutationObserver(() => wireButtons());
    mo.observe(document.documentElement, { subtree: true, childList: true });

    // Wallet events (phantom)
    const provider = getProvider();
    if (provider?.on) {
      provider.on("connect", () => {
        const pk = provider.publicKey?.toString?.();
        STATE.walletConnected = !!pk;
        STATE.walletPubkey = pk || null;
        emitState({
          walletConnected: STATE.walletConnected,
          walletLabel: pk ? shortPk(pk) : "Not connected",
        });
      });

      provider.on("disconnect", () => {
        STATE.walletConnected = false;
        STATE.walletPubkey = null;
        emitState({
          walletConnected: false,
          walletLabel: "Not connected",
        });
      });

      provider.on("accountChanged", (pk) => {
        const s = pk?.toString?.();
        STATE.walletConnected = !!s;
        STATE.walletPubkey = s || null;
        emitState({
          walletConnected: STATE.walletConnected,
          walletLabel: s ? shortPk(s) : "Not connected",
        });
      });
    }

    setStatus("Select tier → Connect → Mint (Guard-only).");
    log("mint.js init ok. RPC:", RPC, "cluster:", CLUSTER);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
