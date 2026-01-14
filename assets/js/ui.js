// assets/js/ui.js (TONFANS v6)
// UI-only layer: tier selection + sticky bar + pills.
// Mint logic lives in assets/js/mint.js and emits `tonfans:state`.

(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // IDs that exist in your current index.html
  const IDS = {
    netPill: "netPill",
    walletPill: "walletPill",
    readyPill: "readyPill",

    selectedTierName: "selectedTierName",
    selectedTierMeta: "selectedTierMeta", // contains "guard: —"

    walletStatus: "walletStatus",
    walletAddr: "walletAddr",
    connectBtn: "connectBtn",
    disconnectBtn: "disconnectBtn",

    price: "price",
    total: "total",
    mintBtn: "mintBtn",
    mintHint: "mintHint",

    stickyMintBar: "stickyMintBar",
    stickySelected: "stickySelected",
    stickyActionBtn: "stickyActionBtn",
    stickyChangeBtn: "stickyChangeBtn",

    tiersSection: "tiers",
  };

  // Normalize index.html data-tier values (supports "_" and "-")
  const normalizeTierAttr = (raw) =>
    String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");

  // data-tier -> internal tier key
  const TIER_MAP = {
    "littlegen": "lgen",
    "biggen": "bgen",
    "littlegen-diamond": "ldia",
    "biggen-diamond": "bdia",
  };

  const TIER_LABEL = {
    lgen: "LittlGEN",
    bgen: "BigGEN",
    ldia: "LittlGEN Diamond",
    bdia: "BigGEN Diamond",
  };

  const state = {
    tier: null,
    tierLabel: null,
    guardLabel: "—",

    walletConnected: false,
    walletLabel: "Not connected",
    networkLabel: "—",
    ready: false,

    priceLabel: null, // null -> don't overwrite DOM defaults on first render
    totalLabel: null,
    qty: null,

    busy: false,
  };

  function shortAddr(addr) {
    const s = String(addr || "");
    if (!s) return "—";
    if (s.length <= 10) return s;
    return `${s.slice(0, 4)}…${s.slice(-4)}`;
  }

  function readQtyFromDom() {
    const q = $("#qty");
    const n = q ? Number((q.textContent || "").trim()) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function computeTotal(priceLabel, qty) {
    const p = Number(priceLabel);
    if (!Number.isFinite(p)) return null;
    const q = Number(qty);
    const qq = Number.isFinite(q) && q > 0 ? q : 1;
    return (p * qq).toFixed(2);
  }

  function scrollToTiers() {
    const sec = $("#" + IDS.tiersSection);
    if (!sec) return;
    sec.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => {
      sec.classList.add("tier-pulse");
      setTimeout(() => sec.classList.remove("tier-pulse"), 900);
    }, 250);
  }

  function highlightTierCards(tierKey) {
    $$(".tier-card[data-tier]").forEach((card) => {
      const raw = normalizeTierAttr(card.getAttribute("data-tier"));
      const k = TIER_MAP[raw] || null;
      card.classList.toggle("tier-selected", Boolean(tierKey && k === tierKey));
    });
  }

  function setTier(tierKey, { emit = true } = {}) {
    state.tier = tierKey || null;
    state.tierLabel = state.tier ? (TIER_LABEL[state.tier] || state.tier) : null;

    highlightTierCards(state.tier);

    if (emit) {
      window.dispatchEvent(
        new CustomEvent("tonfans:tier", { detail: { tier: state.tier } })
      );
    }
  }

  function wireTierCards() {
    $$(".tier-card[data-tier]").forEach((card) => {
      card.style.cursor = "pointer";
      card.addEventListener("click", () => {
        const raw = normalizeTierAttr(card.getAttribute("data-tier"));
        const key = TIER_MAP[raw] || null;
        if (key) setTier(key, { emit: true });
      });
    });

    // Any "change tier" elements scroll to tiers
    $$(".change-tier-btn, a[href='#tiers']").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        scrollToTiers();
      });
    });
  }

  function wireButtons() {
    const connectBtn = $("#" + IDS.connectBtn);
    const disconnectBtn = $("#" + IDS.disconnectBtn);
    const mintBtn = $("#" + IDS.mintBtn);

    if (connectBtn) {
      connectBtn.addEventListener("click", (e) => {
        e.preventDefault();
        window.TONFANS?.mint?.toggleConnect?.();
      });
    }
    if (disconnectBtn) {
      disconnectBtn.addEventListener("click", (e) => {
        e.preventDefault();
        window.TONFANS?.mint?.toggleConnect?.();
      });
    }
    if (mintBtn) {
      mintBtn.addEventListener("click", (e) => {
        e.preventDefault();
        window.TONFANS?.mint?.mintNow?.();
      });
    }

    // Sticky bar buttons
    const stickyAction = $("#" + IDS.stickyActionBtn);
    const stickyChange = $("#" + IDS.stickyChangeBtn);

    if (stickyChange) {
      stickyChange.addEventListener("click", (e) => {
        e.preventDefault();
        scrollToTiers();
      });
    }

    if (stickyAction) {
      stickyAction.addEventListener("click", (e) => {
        e.preventDefault();
        if (!state.walletConnected) return window.TONFANS?.mint?.toggleConnect?.();
        if (!state.tier) return scrollToTiers();
        if (!state.ready) return window.TONFANS?.mint?.setTier?.(state.tier);
        return window.TONFANS?.mint?.mintNow?.();
      });
    }
  }

  function render() {
    // top pills
    const netPill = $("#" + IDS.netPill);
    const walletPill = $("#" + IDS.walletPill);
    const readyPill = $("#" + IDS.readyPill);

    if (netPill) netPill.textContent = state.networkLabel || "—";
    if (walletPill) walletPill.textContent = state.walletConnected ? `Wallet: ${shortAddr(state.walletLabel)}` : "Wallet";
    if (readyPill) readyPill.textContent = `Ready: ${state.ready ? "Yes" : "No"}`;

    // selected tier box
    const nameEl = $("#" + IDS.selectedTierName);
    const metaEl = $("#" + IDS.selectedTierMeta);
    if (nameEl) nameEl.textContent = state.tierLabel || "—";
    if (metaEl) metaEl.textContent = `guard: ${state.guardLabel || "—"}`;

    // wallet card
    const walletStatus = $("#" + IDS.walletStatus);
    const walletAddr = $("#" + IDS.walletAddr);
    if (walletStatus) walletStatus.textContent = state.walletConnected ? "Connected" : "Not connected";
    if (walletAddr) {
      walletAddr.textContent = state.walletConnected ? `Wallet: ${shortAddr(state.walletLabel)}` : "Connect wallet";
      walletAddr.classList.toggle("hidden", !state.walletConnected);
    }

    // connect/disconnect visibility (IMPORTANT: toggle Tailwind 'hidden' class)
    const connectBtn = $("#" + IDS.connectBtn);
    const disconnectBtn = $("#" + IDS.disconnectBtn);
    if (connectBtn) connectBtn.classList.toggle("hidden", state.walletConnected);
    if (disconnectBtn) disconnectBtn.classList.toggle("hidden", !state.walletConnected);

    // price + total (avoid nuking initial DOM defaults until we receive values)
    const priceEl = $("#" + IDS.price);
    const totalEl = $("#" + IDS.total);

    const qty = state.qty ?? readQtyFromDom();
    const priceLabel =
      state.priceLabel != null ? state.priceLabel : (priceEl ? (priceEl.textContent || "").trim() : "—");

    // If mint.js didn't send total, compute it
    const totalLabel =
      state.totalLabel != null
        ? state.totalLabel
        : computeTotal(priceLabel, qty) || (totalEl ? (totalEl.textContent || "").trim() : "—");

    if (priceEl && state.priceLabel != null) priceEl.textContent = state.priceLabel || "—";
    if (totalEl && (state.totalLabel != null || state.priceLabel != null)) totalEl.textContent = totalLabel || "—";

    // mint button: remove inline "disabled look" when ready
    const mintBtn = $("#" + IDS.mintBtn);
    if (mintBtn) {
      const disabled = !state.ready || state.busy;
      mintBtn.disabled = disabled;

      if (disabled) {
        mintBtn.style.opacity = ".55";
        mintBtn.style.cursor = "not-allowed";
      } else {
        mintBtn.style.opacity = "";
        mintBtn.style.cursor = "pointer";
      }
    }

    // hint
    const hint = $("#" + IDS.mintHint);
    if (hint) {
      if (state.busy) hint.textContent = "Working…";
      else if (!state.tier) hint.textContent = "Select a tier.";
      else if (!state.walletConnected) hint.textContent = "Select tier → Connect wallet → Mint.";
      else if (!state.ready) hint.textContent = "Preparing Candy Guard…";
      else hint.textContent = "Ready. Click Mint now.";
    }

    // sticky bar: show as soon as tier is selected (as your index.html comment says)
    const sticky = $("#" + IDS.stickyMintBar);
    if (sticky) sticky.classList.toggle("hidden", !state.tier);

    const stickySelected = $("#" + IDS.stickySelected);
    if (stickySelected) stickySelected.textContent = state.tierLabel || "—";

    const stickyAction = $("#" + IDS.stickyActionBtn);
    if (stickyAction) {
      if (!state.walletConnected) stickyAction.textContent = "Connect";
      else if (!state.tier) stickyAction.textContent = "Select tier";
      else if (!state.ready) stickyAction.textContent = "Prepare";
      else stickyAction.textContent = "Mint now";
    }
  }

  // receive state from mint.js
  window.addEventListener("tonfans:state", (e) => {
    const d = e.detail || {};

    if (typeof d.walletConnected === "boolean") state.walletConnected = d.walletConnected;

    // prefer full wallet address if provided
    if (typeof d.walletPk === "string") state.walletLabel = d.walletPk;
    else if (typeof d.walletLabel === "string") state.walletLabel = d.walletLabel;

    if (typeof d.networkLabel === "string") state.networkLabel = d.networkLabel;

    if (typeof d.tier === "string" || d.tier === null) {
      // if mint.js sets tier (via ?tier=...), sync highlight without re-emitting
      if (d.tier !== state.tier) setTier(d.tier, { emit: false });
      else state.tier = d.tier;
    }
    if (typeof d.tierLabel === "string" || d.tierLabel === null) state.tierLabel = d.tierLabel;

    if (typeof d.guardLabel === "string") state.guardLabel = d.guardLabel;

    if (typeof d.ready === "boolean") state.ready = d.ready;
    if (typeof d.busy === "boolean") state.busy = d.busy;

    if (typeof d.priceLabel === "string") state.priceLabel = d.priceLabel;
    if (typeof d.totalLabel === "string") state.totalLabel = d.totalLabel;
    if (typeof d.qty === "number") state.qty = d.qty;

    render();
  });

  function bootstrapFromDom() {
    // keep initial values from HTML (so we don't turn 0.10 into — on first paint)
    const priceEl = $("#" + IDS.price);
    const totalEl = $("#" + IDS.total);
    if (priceEl) state.priceLabel = (priceEl.textContent || "").trim();
    if (totalEl) state.totalLabel = (totalEl.textContent || "").trim();
    state.qty = readQtyFromDom();
  }

  function init() {
    bootstrapFromDom();
    wireTierCards();
    wireButtons();
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
