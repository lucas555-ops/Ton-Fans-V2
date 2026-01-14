// assets/js/mint.js
// TON Fans — Frontend mint + wallet controller (no build step).
// Works with both:
// 1) original index.html (tier cards: .tier-card[data-tier], pills: #netPill/#walletPill/#readyPill, buttons: #connectBtn/#disconnectBtn/#mintNowBtn)
// 2) patched pages with sticky bar (#stickyMintBar) and/or ui.js.
//
// Fixes:
// - Tier select outline is back
// - Top pills Network/Wallet/Ready are ALWAYS synced
// - Connect button is a proper toggle (connect/disconnect)
// - Mint uses UMI + mpl-candy-machine loaded from CDN with fallback (esm.sh -> jsdelivr),
//   preventing "Failed to load umi-signer-wallet..." / dynamic import fetch errors.

(() => {
  "use strict";

  // ------------------------------
  // CONFIG
  // ------------------------------
  const LOG = (...a) => console.log("[TONFANS]", ...a);
  const WARN = (...a) => console.warn("[TONFANS]", ...a);
  const ERR = (...a) => console.error("[TONFANS]", ...a);

  // Default cluster. Override with:
  // - URL: ?cluster=devnet | ?cluster=mainnet
  // - localStorage: TONFANS_CLUSTER = "devnet" | "mainnet"
  const CLUSTER = (() => {
    try {
      const u = new URL(location.href);
      const qp = (u.searchParams.get("cluster") || "").toLowerCase();
      if (qp === "devnet" || qp === "mainnet") return qp;
      const ls = (localStorage.getItem("TONFANS_CLUSTER") || "").toLowerCase();
      if (ls === "devnet" || ls === "mainnet") return ls;
    } catch (_) {}
    return "devnet";
  })();

  const RPC_BY_CLUSTER = {
    devnet: "https://api.devnet.solana.com",
    mainnet: "https://api.mainnet-beta.solana.com",
  };

  // Candy Machines (from your Sugar deploy logs)
  // NOTE: replace if you redeploy.
  const CM_BY_TIER = {
    lgen: { cm: "Hr9YzscC71vdHifZR4jRvMd8JmmGxbJrS6j7QckEVqKy", label: "LittlGEN" },
    bgen: { cm: "Ewhn2nJV6tbvq59GMahyWmS54jQWL4n3mrsoVM8n8GHH", label: "BigGEN" },
    ldia: { cm: "8L5MLvbvM9EsZ8nb1NAwqzEXuVsiq5x5fHGNKchz6UQR", label: "LittlGEN Diamond" },
    bdia: { cm: "EyjoAcKwkfNo8NqCZczHHnNSi3ccYpnCetkBUwbqCien", label: "BigGEN Diamond" },
  };

  // Map from HTML data-tier to internal keys
  const TIER_ALIASES = {
    lgen: "lgen",
    bgen: "bgen",
    ldia: "ldia",
    bdia: "bdia",
    littlegen: "lgen",
    biggen: "bgen",
    littlegen_diamond: "ldia",
    biggen_diamond: "bdia",
  };

  // ------------------------------
  // STATE
  // ------------------------------
  const STATE = {
    cluster: CLUSTER,
    rpc: RPC_BY_CLUSTER[CLUSTER],
    tier: null,                 // internal: lgen|bgen|ldia|bdia
    tierRaw: null,              // raw data-tier from DOM
    cm: null,                   // candy machine address
    walletPubkey: null,         // base58
    walletShort: "Not connected",
    walletConnected: false,
    ready: false,
    busy: false,
    lastError: "",
    lastSig: "",
  };

  // ------------------------------
  // DOM HELPERS
  // ------------------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const setText = (el, t) => { if (el) el.textContent = String(t ?? ""); };
  const showInline = (el, on) => { if (el) el.style.display = on ? "" : "none"; };
  const setDisabled = (el, on) => {
    if (!el) return;
    if ("disabled" in el) el.disabled = !!on;
    el.classList.toggle("disabled", !!on);
    el.classList.toggle("tonfans-disabled", !!on);
  };

  function shortPubkey(pk) {
    if (!pk || typeof pk !== "string") return "Not connected";
    if (pk.length <= 10) return pk;
    return `${pk.slice(0, 4)}…${pk.slice(-4)}`;
  }

  function injectStylesOnce() {
    if ($("#tonfans-mint-style")) return;
    const s = document.createElement("style");
    s.id = "tonfans-mint-style";
    s.textContent = `
      /* Tier selection outline (works with both legacy + patched classnames) */
      .tier-card.tier-selected,
      .tier-card.tonfans-tier-selected{
        outline: 2px solid rgba(0, 255, 209, .9);
        outline-offset: 2px;
        box-shadow: 0 0 0 6px rgba(0, 255, 209, .12);
        border-radius: 18px;
      }
      .tonfans-disabled{
        opacity: .55 !important;
        pointer-events: none !important;
        filter: grayscale(.2);
      }
      /* Fallback sticky bar if page doesn't have one */
      #tonfans-sticky-fallback{
        position: fixed;
        left: 16px;
        right: 16px;
        bottom: 14px;
        z-index: 9999;
        display: none;
      }
      #tonfans-sticky-fallback .tf-wrap{
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        background: rgba(10,16,24,.82);
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 18px;
        padding: 12px 12px;
        display: flex;
        align-items: center;
        gap: 10px;
        box-shadow: 0 10px 30px rgba(0,0,0,.45);
      }
      #tonfans-sticky-fallback .tf-left{
        flex: 1;
        display:flex;
        flex-direction:column;
        gap:4px;
        min-width: 0;
      }
      #tonfans-sticky-fallback .tf-title{ font-size: 12px; opacity: .75; }
      #tonfans-sticky-fallback .tf-sub{
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #tonfans-sticky-fallback button{ border-radius: 14px; }
    `;
    document.head.appendChild(s);
  }

  // ------------------------------
  // UI SYNC
  // ------------------------------
  function dispatchState() {
    const detail = {
      tier: STATE.tier,
      walletConnected: STATE.walletConnected,
      walletLabel: STATE.walletShort,
      networkLabel: STATE.cluster === "mainnet" ? "Mainnet" : "Devnet",
      ready: STATE.ready,
      priceLabel: readTierPriceLabel(STATE.tier),
      cm: STATE.cm,
      busy: STATE.busy,
      lastError: STATE.lastError,
      lastSig: STATE.lastSig,
    };
    window.dispatchEvent(new CustomEvent("tonfans:state", { detail }));
  }

  function readTierPriceLabel() {
    // Try reading price from the selected tier card (e.g. "0.10 SOL")
    const rawKey = STATE.tierRaw;
    const card = rawKey ? document.querySelector(`.tier-card[data-tier="${rawKey}"]`) : null;
    const text = (card?.textContent || "").replace(/\s+/g, " ").trim();
    const m = text.match(/(\d+(\.\d+)?)\s*SOL/i);
    if (m) return `${m[1]} SOL`;

    // Fallback: existing UI price elements
    const priceEl = $("#priceValue") || $("#mintPrice") || $("#price");
    const t = (priceEl?.textContent || "").trim();
    if (t) return t;

    return "—";
  }

  function setError(msg) {
    STATE.lastError = msg ? String(msg) : "";
    const el = $("#mintError") || $("#mintErrorMsg") || $("#mint-error");
    if (el) {
      el.textContent = STATE.lastError;
      el.style.display = STATE.lastError ? "" : "none";
    }
    dispatchState();
  }

  function setSig(sig) {
    STATE.lastSig = sig ? String(sig) : "";
    dispatchState();
  }

  function recomputeReady() {
    STATE.ready = Boolean(STATE.walletConnected && STATE.walletPubkey && STATE.tier && STATE.cm && !STATE.busy);
  }

  function syncTopPills() {
    const net = $("#netPill");
    const wal = $("#walletPill");
    const ready = $("#readyPill");

    if (net) setText(net, STATE.cluster === "mainnet" ? "Mainnet" : "Devnet");
    if (wal) setText(wal, STATE.walletConnected ? STATE.walletShort : "Not connected");
    if (ready) setText(ready, STATE.ready ? "Yes" : "No");
  }

  function syncWalletUI() {
    const status = $("#walletStatus");
    const addr = $("#walletAddr");
    const connectBtn = $("#connectBtn");
    const disconnectBtn = $("#disconnectBtn");

    if (status) setText(status, STATE.walletConnected ? "Connected" : "Not connected");
    if (addr) setText(addr, STATE.walletConnected ? `${STATE.walletShort} (${STATE.cluster})` : `— (${STATE.cluster})`);

    // Make connectBtn a toggle
    if (connectBtn) {
      connectBtn.textContent = STATE.walletConnected ? `Connected: ${STATE.walletShort}` : "Connect Wallet";
      connectBtn.classList.toggle("connected", STATE.walletConnected);
      connectBtn.dataset.tfToggle = "1";
    }

    // Optional dedicated disconnect button (show/hide)
    if (disconnectBtn) {
      showInline(disconnectBtn, STATE.walletConnected);
      disconnectBtn.dataset.tfToggle = "1";
    }
  }

  function syncTierUI() {
    const tierName = $("#selectedTierName");
    const tierMeta = $("#selectedTierMeta");
    const tierReadyEl = $("#tierReady");

    const tierObj = STATE.tier ? CM_BY_TIER[STATE.tier] : null;

    if (tierName) setText(tierName, tierObj ? tierObj.label : "—");

    if (tierMeta) {
      const guard = "default";
      const price = readTierPriceLabel();
      setText(tierMeta, tierObj ? `guard: ${guard} • ${price}` : "guard: —");
    }

    // tierReady differs across pages:
    // - old: shows Yes/No text
    // - fixed: "Ready." badge with class ready-hide
    if (tierReadyEl) {
      if (tierReadyEl.classList.contains("ready-hide")) {
        tierReadyEl.classList.toggle("ready-hide", !STATE.cm);
      } else {
        setText(tierReadyEl, STATE.cm ? "Yes" : "No");
      }
    }

    // Price box ids differ
    const priceEl = $("#priceValue") || $("#mintPrice") || $("#price");
    if (priceEl) setText(priceEl, readTierPriceLabel());
  }

  function syncMintButtons() {
    recomputeReady();

    // Possible mint buttons by id
    setDisabled($("#mintNowBtn"), !STATE.ready);
    setDisabled($("#mintBtn"), !STATE.ready);

    // Any other visible "Mint now" CTA
    $$("button,a").forEach((el) => {
      const t = (el.textContent || "").trim();
      if (!/mint now/i.test(t)) return;
      el.classList.toggle("tonfans-disabled", !STATE.ready);
      if ("disabled" in el) el.disabled = !STATE.ready;
    });

    syncTopPills();
    syncWalletUI();
    syncTierUI();
    dispatchState();
  }

  // ------------------------------
  // STICKY BAR (supports 2 variants + fallback)
  // ------------------------------
  function ensureStickyFallback() {
    if ($("#stickyMintBar") || $("#tonfans-sticky") || $("#tonfans-sticky-fallback")) return;

    const wrap = document.createElement("div");
    wrap.id = "tonfans-sticky-fallback";
    wrap.innerHTML = `
      <div class="tf-wrap">
        <div class="tf-left">
          <div class="tf-title">TON Fans</div>
          <div class="tf-sub" id="tfStickyLine">Select tier → Connect → Mint</div>
        </div>
        <button id="tfStickyConnect" type="button">Connect</button>
        <button id="tfStickyMint" type="button">Mint now</button>
      </div>
    `;
    document.body.appendChild(wrap);

    $("#tfStickyConnect")?.addEventListener("click", () => toggleConnect());
    $("#tfStickyMint")?.addEventListener("click", () => mintNow());
  }

  function syncSticky() {
    const bar = $("#stickyMintBar");
    const action = $("#stickyActionBtn");
    const change = $("#stickyChangeBtn");
    const selected = $("#stickySelected");

    const fb = $("#tonfans-sticky-fallback");
    const fbLine = $("#tfStickyLine");
    const fbConn = $("#tfStickyConnect");
    const fbMint = $("#tfStickyMint");

    const lineText = STATE.walletConnected
      ? (STATE.tier ? `Tier: ${CM_BY_TIER[STATE.tier]?.label || STATE.tier.toUpperCase()} • ${STATE.walletShort}` : `Select tier • ${STATE.walletShort}`)
      : "Select tier → Connect → Mint";

    if (selected) setText(selected, STATE.tier ? (CM_BY_TIER[STATE.tier]?.label || STATE.tier.toUpperCase()) : "—");

    if (action) {
      if (!STATE.walletConnected) action.textContent = "Connect";
      else if (!STATE.tier) action.textContent = "Select tier";
      else action.textContent = "Mint now";
      action.classList.toggle("disabled", STATE.busy);
      action.classList.toggle("tonfans-disabled", STATE.busy);
      action.dataset.tfBound = action.dataset.tfBound || "0";
    }

    if (change) change.dataset.tfBound = change.dataset.tfBound || "0";

    if (fbLine) fbLine.textContent = lineText;
    if (fbConn) fbConn.textContent = STATE.walletConnected ? `Connected: ${STATE.walletShort}` : "Connect";
    if (fbMint) fbMint.classList.toggle("tonfans-disabled", !STATE.ready);

    // Visibility
    const showSticky = (() => {
      const y = window.scrollY || 0;
      if (bar) {
        const anchor = $("#mint") || $("#mintSection") || document.querySelector("main") || document.body;
        const r = anchor.getBoundingClientRect?.();
        if (r) return r.top < -120;
        return y > 420;
      }
      if (fb) return y > 420;
      return false;
    })();

    // Patched sticky uses class "hidden"
    if (bar) bar.classList.toggle("hidden", !showSticky);
    if (fb) showInline(fb, showSticky);

    if (bar && action && action.dataset.tfBound === "0") {
      action.dataset.tfBound = "1";
      action.addEventListener("click", (e) => {
        e.preventDefault();
        if (STATE.busy) return;
        if (!STATE.walletConnected) return toggleConnect();
        if (!STATE.tier) return scrollToTiers();
        return mintNow();
      });
    }

    if (bar && change && change.dataset.tfBound === "0") {
      change.dataset.tfBound = "1";
      change.addEventListener("click", (e) => {
        e.preventDefault();
        scrollToTiers();
      });
    }
  }

  function scrollToTiers() {
    const el = $("#tiers") || $("#tierCards") || $(".tier-grid") || document.querySelector(".tier-card");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.animate?.(
      [
        { boxShadow: "0 0 0 0 rgba(0,255,209,0)" },
        { boxShadow: "0 0 0 8px rgba(0,255,209,.15)" },
        { boxShadow: "0 0 0 0 rgba(0,255,209,0)" },
      ],
      { duration: 900 }
    );
  }

  // ------------------------------
  // TIER SELECTION
  // ------------------------------
  function normalizeTier(raw) {
    const key = (raw || "").toLowerCase().trim();
    return TIER_ALIASES[key] || null;
  }

  function markSelectedTierCard(rawTier) {
    const cards = $$(".tier-card[data-tier]");
    cards.forEach((c) => {
      c.classList.remove("tier-selected");
      c.classList.remove("tonfans-tier-selected");
    });

    const selected = cards.find(
      (c) => (c.getAttribute("data-tier") || "").toLowerCase() === (rawTier || "").toLowerCase()
    );
    if (selected) {
      selected.classList.add("tier-selected");
      selected.classList.add("tonfans-tier-selected");
    }
  }

  function setTier(rawTier) {
    const tier = normalizeTier(rawTier);
    if (!tier) {
      setError(`Unknown tier: ${rawTier}`);
      return;
    }

    STATE.tier = tier;
    STATE.tierRaw = rawTier;
    STATE.cm = CM_BY_TIER[tier]?.cm || null;

    try { localStorage.setItem("TONFANS_TIER", rawTier); } catch (_) {}

    markSelectedTierCard(rawTier);

    // Preload deps after user action (silent)
    preloadDeps();

    dispatchState();
    syncMintButtons();
    syncSticky();
  }

  function wireTierClicks() {
    const cards = $$(".tier-card[data-tier]");
    cards.forEach((card) => {
      if (card.dataset.tfTierBound === "1") return;
      card.dataset.tfTierBound = "1";
      card.style.cursor = "pointer";
      card.addEventListener("click", () => {
        const raw = card.getAttribute("data-tier");
        setTier(raw);
      });
    });
  }

  // Support ui.js event ("tonfans:tier") if present
  window.addEventListener("tonfans:tier", (e) => {
    const raw = e?.detail?.tier;
    if (raw && TIER_ALIASES[String(raw).toLowerCase()]) {
      const domCard =
        document.querySelector(`.tier-card[data-tier="${raw}"]`) ||
        (raw === "lgen" ? document.querySelector('.tier-card[data-tier="littlegen"]') : null) ||
        (raw === "bgen" ? document.querySelector('.tier-card[data-tier="biggen"]') : null) ||
        (raw === "ldia" ? document.querySelector('.tier-card[data-tier="littlegen_diamond"]') : null) ||
        (raw === "bdia" ? document.querySelector('.tier-card[data-tier="biggen_diamond"]') : null);
      const domRaw = domCard?.getAttribute("data-tier") || raw;
      setTier(domRaw);
    }
  });

  // ------------------------------
  // WALLET
  // ------------------------------
  function getProvider() {
    const p = window.solana || window.phantom?.solana;
    if (p && typeof p.connect === "function") return p;
    return null;
  }

  async function connectWallet({ onlyIfTrusted = false } = {}) {
    const provider = getProvider();
    if (!provider) throw new Error("No Solana wallet found (install Phantom or Solflare).");

    const res = await provider.connect(onlyIfTrusted ? { onlyIfTrusted: true } : {});
    const pk = (res?.publicKey || provider.publicKey)?.toString?.() || null;

    if (!pk) throw new Error("Wallet connection failed (no publicKey).");

    STATE.walletPubkey = pk;
    STATE.walletShort = shortPubkey(pk);
    STATE.walletConnected = true;
    setError("");

    try { localStorage.setItem("TONFANS_LAST_WALLET", pk); } catch (_) {}

    try {
      if (!provider.__tonfans_bound) {
        provider.__tonfans_bound = true;
        provider.on?.("disconnect", () => disconnectWallet(true));
        provider.on?.("accountChanged", (pubkey) => {
          const next = pubkey?.toString?.() || null;
          if (!next) return;
          STATE.walletPubkey = next;
          STATE.walletShort = shortPubkey(next);
          STATE.walletConnected = true;
          syncMintButtons();
          syncSticky();
        });
      }
    } catch (_) {}

    // preload deps after connect too
    preloadDeps();

    syncMintButtons();
    syncSticky();
    return pk;
  }

  function disconnectWallet(silent = false) {
    const provider = getProvider();
    try { provider?.disconnect?.(); } catch (_) {}

    STATE.walletPubkey = null;
    STATE.walletShort = "Not connected";
    STATE.walletConnected = false;

    if (!silent) setError("");
    syncMintButtons();
    syncSticky();
  }

  async function toggleConnect() {
    try {
      if (STATE.walletConnected && STATE.walletPubkey) disconnectWallet(false);
      else await connectWallet({ onlyIfTrusted: false });
    } catch (e) {
      setError(e?.message || String(e));
    }
  }

  function wireConnectButtons() {
    const connectBtn = $("#connectBtn");
    const disconnectBtn = $("#disconnectBtn");

    if (connectBtn && connectBtn.dataset.tfToggle !== "1") {
      connectBtn.dataset.tfToggle = "1";
      connectBtn.addEventListener("click", (e) => {
        e.preventDefault();
        toggleConnect();
      });
    }
    if (disconnectBtn && disconnectBtn.dataset.tfToggle !== "1") {
      disconnectBtn.dataset.tfToggle = "1";
      disconnectBtn.addEventListener("click", (e) => {
        e.preventDefault();
        disconnectWallet(false);
      });
    }

    // Bind any generic connect-looking buttons
    $$("button,a").forEach((el) => {
      const tx = (el.textContent || "").trim().toLowerCase();
      const isConnectish =
        tx === "connect" ||
        tx === "connect wallet" ||
        tx === "disconnect" ||
        tx.startsWith("connected:");
      if (!isConnectish) return;
      if (el.dataset.tfConnectBound === "1") return;
      el.dataset.tfConnectBound = "1";
      el.addEventListener("click", (e) => {
        e.preventDefault();
        if (tx === "disconnect") disconnectWallet(false);
        else toggleConnect();
      });
    });
  }

  // ------------------------------
  // MINT DEPS LOADER (UMI) + fallback
  // ------------------------------
  let DEPS = null;
  let DEPS_LOADING = null;

  async function importWithFallback(urls) {
    let lastErr = null;
    for (const u of urls) {
      try {
        return await import(/* @vite-ignore */ u);
      } catch (e) {
        lastErr = e;
        WARN("import failed:", u, e?.message || e);
      }
    }
    throw lastErr || new Error("Failed to import module.");
  }

  async function loadDeps() {
    if (DEPS) return DEPS;
    if (DEPS_LOADING) return DEPS_LOADING;

    const target = "es2022";
    const esm = (pkg) => `https://esm.sh/${pkg}?bundle&target=${target}`;
    const jsd = (pkg) => `https://cdn.jsdelivr.net/npm/${pkg}/+esm`;

    DEPS_LOADING = (async () => {
      const umiBundle = await importWithFallback([
        esm("@metaplex-foundation/umi-bundle-defaults@1.0.1"),
        jsd("@metaplex-foundation/umi-bundle-defaults@1.0.1"),
      ]);

      const umiCore = await importWithFallback([
        esm("@metaplex-foundation/umi@1.0.1"),
        jsd("@metaplex-foundation/umi@1.0.1"),
      ]);

      const walletAdapters = await importWithFallback([
        esm("@metaplex-foundation/umi-signer-wallet-adapters@1.0.1"),
        jsd("@metaplex-foundation/umi-signer-wallet-adapters@1.0.1"),
      ]);

      const candy = await importWithFallback([
        esm("@metaplex-foundation/mpl-candy-machine@6.0.0"),
        jsd("@metaplex-foundation/mpl-candy-machine@6.0.0"),
      ]);

      const tokenMeta = await importWithFallback([
        esm("@metaplex-foundation/mpl-token-metadata@3.2.0"),
        jsd("@metaplex-foundation/mpl-token-metadata@3.2.0"),
      ]);

      const bs58mod = await importWithFallback([
        esm("bs58@5.0.0"),
        jsd("bs58@5.0.0"),
      ]);

      const deps = {
        createUmi: umiBundle.createUmi,
        publicKey: umiCore.publicKey,
        generateSigner: umiCore.generateSigner,
        transactionBuilder: umiCore.transactionBuilder,
        setComputeUnitLimit: umiCore.setComputeUnitLimit,
        setComputeUnitPrice: umiCore.setComputeUnitPrice,

        walletAdapterIdentity: walletAdapters.walletAdapterIdentity,

        mplCandyMachine: candy.mplCandyMachine,
        fetchCandyMachine: candy.fetchCandyMachine,
        fetchCandyGuard: candy.fetchCandyGuard,
        mintV2: candy.mintV2,

        mplTokenMetadata: tokenMeta.mplTokenMetadata,
        TokenStandard: tokenMeta.TokenStandard,

        bs58: bs58mod.default || bs58mod,
      };

      if (!deps.createUmi || !deps.mintV2 || !deps.walletAdapterIdentity) {
        throw new Error("Mint deps loaded but missing required exports.");
      }

      DEPS = deps;
      return deps;
    })();

    return DEPS_LOADING;
  }

  function preloadDeps() {
    loadDeps().catch(() => {});
  }

  // ------------------------------
  // MINT
  // ------------------------------
  async function mintNow() {
    if (STATE.busy) return;
    setError("");
    setSig("");

    try {
      if (!STATE.tier || !STATE.cm) throw new Error("Select a tier first.");
      if (!STATE.walletConnected || !STATE.walletPubkey) throw new Error("Connect your wallet first.");

      STATE.busy = true;
      syncMintButtons();
      syncSticky();

      const {
        createUmi,
        publicKey,
        generateSigner,
        transactionBuilder,
        setComputeUnitLimit,
        setComputeUnitPrice,
        walletAdapterIdentity,
        mplCandyMachine,
        fetchCandyMachine,
        fetchCandyGuard,
        mintV2,
        mplTokenMetadata,
        TokenStandard,
        bs58,
      } = await loadDeps();

      const provider = getProvider();
      if (!provider) throw new Error("Wallet provider not found.");

      const umi = createUmi(STATE.rpc)
        .use(walletAdapterIdentity(provider))
        .use(mplCandyMachine())
        .use(mplTokenMetadata());

      const cmPk = publicKey(STATE.cm);

      const candyMachine = await fetchCandyMachine(umi, cmPk);

      // Candy Guard address is typically stored on candyMachine as mintAuthority (CMv3).
      let candyGuardPk = null;
      try {
        candyGuardPk = candyMachine?.mintAuthority || candyMachine?.candyGuard || null;
      } catch (_) {}

      if (candyGuardPk && typeof fetchCandyGuard === "function") {
        try { await fetchCandyGuard(umi, candyGuardPk); } catch (_) {}
      }

      const nftMint = generateSigner(umi);

      const mintArgs = {
        candyMachine: cmPk,
        nftMint,
        collectionMint: candyMachine.collectionMint,
        collectionUpdateAuthority: candyMachine.authority,
        tokenStandard: TokenStandard.NonFungible,
      };

      if (candyGuardPk) mintArgs.candyGuard = candyGuardPk;

      const builder = mintV2(umi, mintArgs);

      const txBuilder = transactionBuilder()
        .add(setComputeUnitLimit(umi, { units: 600_000 }))
        .add(setComputeUnitPrice(umi, { microLamports: 1_000 }))
        .add(builder);

      const tx = txBuilder.build(umi);

      // IMPORTANT: send via umi.rpc so ALL signers (wallet + nftMint) are included
      const sigAny = await umi.rpc.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
      const sig =
        typeof sigAny === "string"
          ? sigAny
          : (bs58?.encode ? bs58.encode(sigAny) : String(sigAny));

      await umi.rpc.confirmTransaction(sig, { commitment: "confirmed" });

      setSig(sig);
      setError("");

      const link =
        STATE.cluster === "mainnet"
          ? `https://solscan.io/tx/${sig}`
          : `https://solscan.io/tx/${sig}?cluster=devnet`;

      const out = $("#mintResult") || $("#mintResultMsg") || $("#mint-result");
      if (out) {
        out.innerHTML = `Mint sent ✅ <a href="${link}" target="_blank" rel="noreferrer">View on Solscan</a>`;
        out.style.display = "";
      } else {
        LOG("Mint sent:", sig);
      }
    } catch (e) {
      ERR(e);
      setError(e?.message || String(e));
    } finally {
      STATE.busy = false;
      syncMintButtons();
      syncSticky();
    }
  }

  function wireMintButtons() {
    const mintNowBtn = $("#mintNowBtn");
    if (mintNowBtn && mintNowBtn.dataset.tfMintBound !== "1") {
      mintNowBtn.dataset.tfMintBound = "1";
      mintNowBtn.addEventListener("click", (e) => {
        e.preventDefault();
        mintNow();
      });
    }

    const mintBtn = $("#mintBtn");
    if (mintBtn && mintBtn.dataset.tfMintBound !== "1") {
      mintBtn.dataset.tfMintBound = "1";
      mintBtn.addEventListener("click", (e) => {
        e.preventDefault();
        mintNow();
      });
    }

    // Bind any other "Mint now" CTA
    $$("button,a").forEach((el) => {
      const t = (el.textContent || "").trim();
      if (!/mint now/i.test(t)) return;
      if (el.dataset.tfMintBound === "1") return;
      el.dataset.tfMintBound = "1";
      el.addEventListener("click", (e) => {
        e.preventDefault();
        mintNow();
      });
    });
  }

  // ------------------------------
  // INIT
  // ------------------------------
  function restoreTierFromStorage() {
    try {
      const raw = localStorage.getItem("TONFANS_TIER");
      if (raw) {
        const card = document.querySelector(`.tier-card[data-tier="${raw}"]`);
        if (card) setTier(raw);
      }
    } catch (_) {}
  }

  async function tryAutoConnectTrusted() {
    try {
      const provider = getProvider();
      if (!provider) return;

      if (provider.isConnected && provider.publicKey) {
        const pk = provider.publicKey.toString();
        STATE.walletPubkey = pk;
        STATE.walletShort = shortPubkey(pk);
        STATE.walletConnected = true;
        syncMintButtons();
        syncSticky();
        return;
      }

      await connectWallet({ onlyIfTrusted: true });
    } catch (_) {}
  }

  function onTick() {
    syncSticky();
  }

  function init() {
    injectStylesOnce();

    // Expose API for ui.js sticky buttons
    window.TONFANS = window.TONFANS || {};
    window.TONFANS.mint = {
      toggleConnect,
      connect: () => connectWallet({ onlyIfTrusted: false }),
      disconnect: () => disconnectWallet(false),
      mintNow,
      setTier: (t) => setTier(t),
      getState: () => ({ ...STATE }),
    };

    wireTierClicks();
    wireConnectButtons();
    wireMintButtons();

    ensureStickyFallback();

    restoreTierFromStorage();
    tryAutoConnectTrusted();

    syncMintButtons();
    syncSticky();

    window.addEventListener("scroll", onTick, { passive: true });
    window.addEventListener("resize", onTick);
    setInterval(onTick, 800);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
