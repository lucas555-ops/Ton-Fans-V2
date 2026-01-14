// assets/js/mint.js
// TON Fans — Candy Machine mint + wallet logic (no build, browser-only).
// Works with assets/js/ui.js (tier selection + sticky bar).
//
// Cluster: devnet (change RPC_URL if you migrate to mainnet).
(() => {
  const LOG_PREFIX = "[TONFANS]";
  const log = (...a) => console.log(LOG_PREFIX, ...a);
  const warn = (...a) => console.warn(LOG_PREFIX, ...a);
  const error = (...a) => console.error(LOG_PREFIX, ...a);

  // ---------------------------
  // CONFIG (your deployed IDs)
  // ---------------------------
  const RPC_URL = "https://api.devnet.solana.com";
  const NETWORK_LABEL = "Devnet";

  // Collection (created once in cm-lgen)
  const COLLECTION_MINT = "9Zz8cBzFny6ZSzETZZxUeo7Qdi4nRTedNQVVwGhQ9P5w";
  // Collection update authority (wallet that created the collection)
  const COLLECTION_UPDATE_AUTHORITY = "9mG7vEEABrX5X4mg9WCAa17XpCxR28Ute2iEaDbHTJtD";
  // Treasury / solPayment destination (from your configs)
  const TREASURY = "9mG7vEEABrX5X4mg9WCAa17XpCxR28Ute2iEaDbHTJtD";

  // Candy Machines (deployed)
  // IMPORTANT: tier keys match index.html data-tier values
  const CM_BY_TIER = Object.freeze({
    littlegen:          "Hr9YzscC71vdHifZR4jRvMd8JmmGxbJrS6j7QckEVqKy",
    biggen:            "Ewhn2nJV6tbvq59GMahyWmS54jQWL4n3mrsoVM8n8GHH",
    littlegen_diamond: "8L5MLvbvM9EsZ8nb1NAwqzEXuVsiq5x5fHGNKchz6UQR",
    biggen_diamond:    "EyjoAcKwkfNo8NqCZczHHnNSi3ccYpnCetkBUwbqCien",
  });

  // Prices shown in UI (display only; actual SOL payment is enforced on-chain by guards).
  const PRICE_SOL = Object.freeze({
    littlegen: "0.10",
    biggen: "0.125",
    littlegen_diamond: "0.15",
    biggen_diamond: "0.20",
  });

  // Accept short aliases too (if some other script uses them)
  const TIER_ALIASES = Object.freeze({
    lgen: "littlegen",
    bgen: "biggen",
    ldia: "littlegen_diamond",
    bdia: "biggen_diamond",
  });

  // ---------------------------
  // DOM helpers
  // ---------------------------
  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const byId = (id) => document.getElementById(id);

  const setText = (el, t) => { if (el) el.textContent = String(t ?? ""); };
  const show    = (el, on) => { if (el) el.classList.toggle("hidden", !on); };
  const setDisabled = (el, on) => { if (el) el.disabled = !!on; };

  const shortPk = (pk) => {
    const s = String(pk || "");
    if (!s) return "—";
    if (s.length <= 10) return s;
    return `${s.slice(0, 4)}…${s.slice(-4)}`;
  };

  function formatSol(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    return x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  }

  // ---------------------------
  // App State
  // ---------------------------
  const STATE = {
    tier: null,                 // normalized tier key
    qty: 1,

    provider: null,             // Phantom provider
    walletConnected: false,
    walletPk: null,

    // SDK (lazy-loaded)
    sdkLoaded: false,
    sdkLoading: false,
    sdk: null,
    umi: null,

    minting: false,
  };

  function computeReady() {
    return Boolean(STATE.walletConnected && STATE.walletPk && STATE.tier && !STATE.minting);
  }

  function emitState(extra = {}) {
    const priceLabel = STATE.tier ? `${PRICE_SOL[STATE.tier] ?? "—"} SOL` : "—";
    window.dispatchEvent(
      new CustomEvent("tonfans:state", {
        detail: {
          tier: STATE.tier || null,
          walletConnected: STATE.walletConnected,
          walletLabel: STATE.walletPk ? shortPk(STATE.walletPk) : "Not connected",
          networkLabel: NETWORK_LABEL,
          priceLabel,
          ...extra,
        },
      })
    );
  }

  // ---------------------------
  // UI syncing (index.html specific IDs)
  // ---------------------------
  function syncUI(hint = "") {
    // top pills
    setText(byId("netPill"), NETWORK_LABEL);
    setText(byId("walletPill"), STATE.walletConnected ? shortPk(STATE.walletPk) : "Not connected");
    setText(byId("readyPill"), computeReady() ? "Yes" : "No");

    // mint section status
    setText(byId("walletStatus"), STATE.walletConnected ? "Connected" : "Not connected");
    setText(byId("walletAddr"), STATE.walletConnected ? shortPk(STATE.walletPk) : "—");

    // connect/disconnect buttons (main block)
    show(byId("connectBtn"), !STATE.walletConnected);
    show(byId("disconnectBtn"), STATE.walletConnected);

    // selected tier meta
    const tierNameEl = byId("selectedTierName");
    const tierMetaEl = byId("selectedTierMeta");
    const tierReadyEl = byId("tierReady");

    if (STATE.tier) {
      const pretty =
        STATE.tier === "littlegen" ? "LittlGEN" :
        STATE.tier === "biggen" ? "BigGEN" :
        STATE.tier === "littlegen_diamond" ? "LittlGEN Diamond" :
        STATE.tier === "biggen_diamond" ? "BigGEN Diamond" :
        STATE.tier;

      setText(tierNameEl, pretty);
      const cm = CM_BY_TIER[STATE.tier];
      setText(tierMetaEl, cm ? `CM: ${shortPk(cm)} • ${PRICE_SOL[STATE.tier]} SOL` : "—");
      if (tierReadyEl) tierReadyEl.classList.remove("ready-hide");
    } else {
      setText(tierNameEl, "—");
      setText(tierMetaEl, "Select a tier to see details");
      if (tierReadyEl) tierReadyEl.classList.add("ready-hide");
    }

    // qty + totals
    const price = STATE.tier ? Number(PRICE_SOL[STATE.tier] || 0) : 0;
    const total = price * (STATE.qty || 1);
    setText(byId("qty"), String(STATE.qty));
    setText(byId("price"), STATE.tier ? `${PRICE_SOL[STATE.tier]} SOL` : "—");
    setText(byId("total"), STATE.tier ? `${formatSol(total)} SOL` : "—");

    // mint button state
    setDisabled(byId("mintBtn"), !computeReady());

    // hint
    const hintEl = byId("mintHint");
    if (hintEl) {
      if (STATE.minting) setText(hintEl, "Minting… approve in wallet.");
      else if (hint) setText(hintEl, hint);
      else setText(hintEl, computeReady() ? "Ready. Click Mint now." : "Select tier → Connect → Mint.");
    }

    emitState();
  }

  // ---------------------------
  // Tier selection
  // ---------------------------
  function normalizeTier(tier) {
    if (!tier) return null;
    const t = String(tier).trim().toLowerCase();
    if (CM_BY_TIER[t]) return t;
    if (TIER_ALIASES[t]) return TIER_ALIASES[t];

    // tolerate minor variants
    if (t.includes("littl") && t.includes("diamond")) return "littlegen_diamond";
    if (t.includes("big") && t.includes("diamond")) return "biggen_diamond";
    if (t.includes("littl")) return "littlegen";
    if (t.includes("big")) return "biggen";
    return null;
  }

  function setTier(tier) {
    const nt = normalizeTier(tier);
    if (!nt) return;
    STATE.tier = nt;
    syncUI();
  }

  // ---------------------------
  // Wallet (Phantom)
  // ---------------------------
  function getProvider() {
    const p = window.solana;
    if (p && p.isPhantom) return p;
    if (p && typeof p.connect === "function") return p; // fallback
    return null;
  }

  async function connectWallet() {
    const p = STATE.provider || getProvider();
    if (!p) return syncUI("Phantom wallet not found. Install Phantom and refresh.");

    STATE.provider = p;

    try {
      const resp = await p.connect({ onlyIfTrusted: false });
      const pk =
        resp?.publicKey?.toBase58?.() ||
        p.publicKey?.toBase58?.() ||
        (resp?.publicKey ? String(resp.publicKey) : "");

      STATE.walletConnected = true;
      STATE.walletPk = pk || null;
      syncUI("Wallet connected.");
    } catch (e) {
      warn("connect failed:", e);
      syncUI(`Connect failed: ${String(e?.message || e)}`);
    }
  }

  async function disconnectWallet() {
    const p = STATE.provider || getProvider();
    if (!p) return;

    try {
      if (typeof p.disconnect === "function") await p.disconnect();
    } catch (e) {
      warn("disconnect warning:", e);
    }

    STATE.walletConnected = false;
    STATE.walletPk = null;
    syncUI("Disconnected.");
  }

  async function toggleConnect() {
    if (STATE.walletConnected) return disconnectWallet();
    return connectWallet();
  }

  // ---------------------------
  // CDN module loader (robust)
  // ---------------------------
  const CDN = Object.freeze({
    jsdelivr: (pkg) => `https://cdn.jsdelivr.net/npm/${pkg}/+esm`,
    jsdelivrV: (pkg, v) => `https://cdn.jsdelivr.net/npm/${pkg}@${v}/+esm`,
    esm: (pkg) => `https://esm.sh/${pkg}?bundle&target=es2022`,
    esmV: (pkg, v) => `https://esm.sh/${pkg}@${v}?bundle&target=es2022`,
    unpkg: (pkg) => `https://unpkg.com/${pkg}?module`,
    unpkgV: (pkg, v) => `https://unpkg.com/${pkg}@${v}?module`,
  });

  const PKG_FALLBACK_VERSIONS = Object.freeze({
    "@metaplex-foundation/umi-bundle-defaults": "1.4.1",
    "@metaplex-foundation/umi": "1.4.1",
    "@metaplex-foundation/umi-signer-wallet-adapters": "1.4.1",
    "@metaplex-foundation/mpl-candy-machine": "6.1.0",
    "@metaplex-foundation/mpl-token-metadata": "3.2.1",
    "@metaplex-foundation/mpl-toolbox": "0.10.0",
    "bs58": "6.0.0",
  });

  async function importWithFallback(pkg) {
    const v = PKG_FALLBACK_VERSIONS[pkg];
    const candidates = [
      CDN.jsdelivr(pkg),
      v ? CDN.jsdelivrV(pkg, v) : null,
      CDN.esm(pkg),
      v ? CDN.esmV(pkg, v) : null,
      CDN.unpkg(pkg),
      v ? CDN.unpkgV(pkg, v) : null,
    ].filter(Boolean);

    let lastErr = null;
    for (const url of candidates) {
      try {
        return await import(url);
      } catch (e) {
        lastErr = e;
      }
    }

    throw new Error(
      `Failed to import ${pkg}. Tried:\n- ${candidates.join("\n- ")}\n\nLast error: ${String(lastErr?.message || lastErr)}`
    );
  }

  async function loadSdk() {
    if (STATE.sdkLoaded) return;
    if (STATE.sdkLoading) {
      while (STATE.sdkLoading) await new Promise((r) => setTimeout(r, 50));
      return;
    }

    STATE.sdkLoading = true;
    syncUI("Loading mint SDK…");

    try {
      const [
        umiBundle,
        umiCore,
        candy,
        tokenMeta,
        walletAdapters,
        toolbox,
        bs58mod,
      ] = await Promise.all([
        importWithFallback("@metaplex-foundation/umi-bundle-defaults"),
        importWithFallback("@metaplex-foundation/umi"),
        importWithFallback("@metaplex-foundation/mpl-candy-machine"),
        importWithFallback("@metaplex-foundation/mpl-token-metadata"),
        importWithFallback("@metaplex-foundation/umi-signer-wallet-adapters"),
        importWithFallback("@metaplex-foundation/mpl-toolbox"),
        importWithFallback("bs58"),
      ]);

      STATE.sdk = {
        createUmi: umiBundle.createUmi,

        generateSigner: umiCore.generateSigner,
        publicKey: umiCore.publicKey,
        some: umiCore.some,

        mplCandyMachine: candy.mplCandyMachine,
        fetchCandyMachine: candy.fetchCandyMachine,
        safeFetchCandyGuard: candy.safeFetchCandyGuard,
        mintV2: candy.mintV2,

        mplTokenMetadata: tokenMeta.mplTokenMetadata,
        walletAdapterIdentity: walletAdapters.walletAdapterIdentity,
        setComputeUnitLimit: toolbox.setComputeUnitLimit,

        bs58: bs58mod.default || bs58mod,
      };

      if (!STATE.sdk.createUmi || !STATE.sdk.mplCandyMachine || !STATE.sdk.mintV2) {
        throw new Error("SDK loaded but missing expected exports.");
      }

      STATE.sdkLoaded = true;
      log("SDK loaded.");
      syncUI();
    } catch (e) {
      error("import failed:", e);
      syncUI(`Error: ${String(e?.message || e)}`);
      throw e;
    } finally {
      STATE.sdkLoading = false;
    }
  }

  function ensureUmi() {
    if (!STATE.sdkLoaded || !STATE.sdk) throw new Error("SDK not loaded");

    if (!STATE.umi) {
      STATE.umi = STATE.sdk
        .createUmi(RPC_URL)
        .use(STATE.sdk.mplCandyMachine())
        .use(STATE.sdk.mplTokenMetadata());
    }

    if (STATE.walletConnected && STATE.provider) {
      STATE.umi.use(STATE.sdk.walletAdapterIdentity(STATE.provider));
    }

    return STATE.umi;
  }

  // ---------------------------
  // Minting
  // ---------------------------
  function currentCandyMachineId() {
    if (!STATE.tier) return null;
    return CM_BY_TIER[STATE.tier] || null;
  }

  function explorerTx(sig) {
    return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
  }

  function normalizeMintErr(e) {
    const msg = String(e?.message || e || "Unknown error");
    return msg.replaceAll("Error: ", "").slice(0, 420);
  }

  async function mintOnce({ group = null } = {}) {
    await loadSdk();
    const sdk = STATE.sdk;
    const umi = ensureUmi();

    const cmId = currentCandyMachineId();
    if (!cmId) throw new Error("Select a tier first.");

    const candyMachine = await sdk.fetchCandyMachine(umi, sdk.publicKey(cmId));
    const candyGuard = await sdk.safeFetchCandyGuard(umi, candyMachine.mintAuthority);

    const nftMint = sdk.generateSigner(umi);

    const builder = await sdk.mintV2(umi, {
      candyMachine: candyMachine.publicKey,
      candyGuard: candyGuard?.publicKey,
      nftMint,
      collectionMint: candyMachine.collectionMint ?? sdk.publicKey(COLLECTION_MINT),
      collectionUpdateAuthority: sdk.publicKey(COLLECTION_UPDATE_AUTHORITY),
      group: group || undefined,
      mintArgs: {
        // If solPayment guard is enabled, this satisfies it.
        solPayment: sdk.some({ destination: sdk.publicKey(TREASURY) }),
      },
    });

    // extra CU for heavy routes
    builder.prepend(sdk.setComputeUnitLimit(umi, { units: 800000 }));

    const res = await builder.sendAndConfirm(umi, { confirm: { commitment: "confirmed" } });
    return sdk.bs58.encode(res.signature);
  }

  async function mintNow() {
    if (!STATE.tier) return syncUI("Pick a tier first.");
    if (!STATE.walletConnected) return syncUI("Connect wallet first.");
    if (STATE.minting) return;

    STATE.minting = true;
    syncUI();

    try {
      const groupTry = [null, "default", "public", "main", "mint"];
      const qty = Math.max(1, Math.min(STATE.qty || 1, 5));

      let minted = 0;

      for (let i = 0; i < qty; i++) {
        let sig = null;
        let lastErr = null;

        for (const g of groupTry) {
          try {
            sig = await mintOnce({ group: g });
            break;
          } catch (e) {
            lastErr = e;
            const m = String(e?.message || e);
            const maybeGroup = /group/i.test(m) || /Selected Guard Group/i.test(m) || /Group not found/i.test(m);
            if (!maybeGroup) break;
          }
        }

        if (!sig) throw lastErr || new Error("Mint failed");

        minted += 1;
        syncUI(`Minted ${minted}/${qty}. Tx: ${sig}`);

        const shareX = byId("shareX");
        if (shareX) {
          shareX.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
            `Just minted a TON Fans NFT on Solana (devnet). Tx: ${sig}`
          )}`;
        }

        // little pause between mints
        if (i < qty - 1) await new Promise((r) => setTimeout(r, 500));
      }
    } catch (e) {
      error("mint failed:", e);
      syncUI(`Error: ${normalizeMintErr(e)}`);
    } finally {
      STATE.minting = false;
      syncUI();
    }
  }

  // ---------------------------
  // Bind UI actions
  // ---------------------------
  function bindButtons() {
    const connectBtn = byId("connectBtn");
    const disconnectBtn = byId("disconnectBtn");
    const mintBtn = byId("mintBtn");

    if (connectBtn) connectBtn.addEventListener("click", (e) => { e.preventDefault(); toggleConnect(); });
    if (disconnectBtn) disconnectBtn.addEventListener("click", (e) => { e.preventDefault(); disconnectWallet(); });
    if (mintBtn) mintBtn.addEventListener("click", (e) => { e.preventDefault(); mintNow(); });

    const minus = byId("qtyMinus");
    const plus  = byId("qtyPlus");
    if (minus) minus.addEventListener("click", () => { STATE.qty = Math.max(1, (STATE.qty || 1) - 1); syncUI(); });
    if (plus)  plus.addEventListener("click", () => { STATE.qty = Math.min(5, (STATE.qty || 1) + 1); syncUI(); });

    // Fallback: bind any button with text that includes "connect wallet" or "connect"
    $$("button,a").forEach((el) => {
      const t = (el.textContent || "").trim().toLowerCase();
      if (!t) return;
      if (el.dataset.tfBound) return;
      if (t.includes("connect")) {
        el.dataset.tfBound = "1";
        el.addEventListener("click", (e) => {
          // don't hijack navigation anchors
          if (el.tagName === "A") {
            const href = el.getAttribute("href") || "";
            if (href.startsWith("#")) return;
          }
          if (el === connectBtn || el === disconnectBtn) return;
          e.preventDefault();
          toggleConnect();
        });
      }
    });
  }

  // ---------------------------
  // Provider events (Phantom)
  // ---------------------------
  function bindProviderEvents() {
    const p = getProvider();
    if (!p) return;
    STATE.provider = p;

    try {
      if (typeof p.on === "function") {
        p.on("connect", () => {
          STATE.walletConnected = true;
          STATE.walletPk = p.publicKey?.toBase58?.() ?? null;
          syncUI("Wallet connected.");
        });
        p.on("disconnect", () => {
          STATE.walletConnected = false;
          STATE.walletPk = null;
          syncUI("Disconnected.");
        });
        p.on("accountChanged", (pk) => {
          if (!pk) {
            STATE.walletConnected = false;
            STATE.walletPk = null;
            syncUI("Wallet disconnected.");
          } else {
            STATE.walletConnected = true;
            STATE.walletPk = pk.toBase58 ? pk.toBase58() : String(pk);
            syncUI("Wallet changed.");
          }
        });
      }
    } catch (_) {}
  }

  // ---------------------------
  // Public API for ui.js sticky buttons
  // ---------------------------
  window.TONFANS = window.TONFANS || {};
  window.TONFANS.mint = {
    toggleConnect,
    mintNow,
    _state: STATE, // debug
  };

  // Tier event coming from ui.js
  window.addEventListener("tonfans:tier", (e) => {
    setTier(e?.detail?.tier);
  });

  // ---------------------------
  // Init
  // ---------------------------
  function init() {
    // Try to infer tier from markup
    const firstTier = document.querySelector("[data-tier]")?.getAttribute("data-tier");
    if (firstTier) setTier(firstTier);

    bindButtons();
    bindProviderEvents();

    // If wallet already connected (trusted), sync
    const p = getProvider();
    if (p?.publicKey) {
      STATE.provider = p;
      STATE.walletConnected = !!p.isConnected;
      STATE.walletPk = p.publicKey?.toBase58?.() ?? null;
    }

    syncUI();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
