// assets/js/ui.js
(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const IDS = {
    netPill: "netPill",
    walletPill: "walletPill",
    readyPill: "readyPill",

    selectedTierName: "selectedTierName",
    selectedTierGuard: "selectedTierGuard",

    walletStatus: "walletStatus",
    walletAddr: "walletAddr",
    connectBtn: "connectBtn",
    disconnectBtn: "disconnectBtn",

    price: "price",
    total: "total",

    mintBtn: "mintBtn",
    mintHint: "mintHint",

    cmAddressInput: "cmAddressInput",
    setCmBtn: "setCmBtn",

    stickyMintBar: "stickyMintBar",
    stickyTierLabel: "stickyTierLabel",
    stickyActionBtn: "stickyActionBtn",
    stickyChangeBtn: "stickyChangeBtn",

    tiersSection: "tiers",
    mintSection: "mint",
  };

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
    priceLabel: "—",
    totalLabel: "—",
  };

  function shortAddr(addr) {
    if (!addr) return "—";
    const s = String(addr);
    if (s.length <= 10) return s;
    return `${s.slice(0, 4)}…${s.slice(-4)}`;
  }

  function scrollToTiers() {
    const sec = $("#" + IDS.tiersSection);
    if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => {
      sec?.classList?.add("tier-pulse");
      setTimeout(() => sec?.classList?.remove("tier-pulse"), 900);
    }, 350);
  }

  function setTier(tierKey) {
    state.tier = tierKey;
    state.tierLabel = tierKey ? (TIER_LABEL[tierKey] || tierKey) : null;

    $$(".tier-card[data-tier]").forEach((card) => {
      const raw = (card.getAttribute("data-tier") || "").toLowerCase();
      const k = TIER_MAP[raw];
      card.classList.toggle("tier-selected", k === tierKey);
    });

    window.dispatchEvent(new CustomEvent("tonfans:tier", { detail: { tier: tierKey } }));
  }

  function wireTierCards() {
    $$(".tier-card[data-tier]").forEach((card) => {
      card.style.cursor = "pointer";
      card.onclick = () => {
        const raw = (card.getAttribute("data-tier") || "").toLowerCase();
        const key = TIER_MAP[raw] || null;
        if (key) setTier(key);
      };
    });

    // Any "change tier" elements scroll to tiers
    $$(".change-tier-btn, a[href='#tiers']").forEach((el) => {
      el.onclick = (e) => {
        e.preventDefault();
        scrollToTiers();
      };
    });
  }

  function wireButtons() {
    const connectBtn = $("#" + IDS.connectBtn);
    const disconnectBtn = $("#" + IDS.disconnectBtn);
    const mintBtn = $("#" + IDS.mintBtn);
    const setCmBtn = $("#" + IDS.setCmBtn);

    if (connectBtn) connectBtn.onclick = (e) => { e.preventDefault(); window.TONFANS?.mint?.toggleConnect?.(); };
    if (disconnectBtn) disconnectBtn.onclick = (e) => { e.preventDefault(); window.TONFANS?.mint?.toggleConnect?.(); };
    if (mintBtn) mintBtn.onclick = (e) => { e.preventDefault(); window.TONFANS?.mint?.mintNow?.(); };

    if (setCmBtn) setCmBtn.onclick = (e) => {
      e.preventDefault();
      const v = ($("#" + IDS.cmAddressInput)?.value || "").trim();
      if (!v) return;
      window.TONFANS?.mint?.setCm?.(v);
    };

    // Sticky bar buttons
    const stickyAction = $("#" + IDS.stickyActionBtn);
    const stickyChange = $("#" + IDS.stickyChangeBtn);

    if (stickyChange) stickyChange.onclick = (e) => { e.preventDefault(); scrollToTiers(); };

    if (stickyAction) stickyAction.onclick = (e) => {
      e.preventDefault();
      if (!state.walletConnected) return window.TONFANS?.mint?.toggleConnect?.();
      if (!state.tier) return scrollToTiers();
      if (!state.ready) return window.TONFANS?.mint?.setTier?.(state.tier);
      return window.TONFANS?.mint?.mintNow?.();
    };
  }

  function stickyVisibility() {
    const sticky = $("#" + IDS.stickyMintBar);
    if (!sticky) return;

    const mint = $("#" + IDS.mintSection);
    let show = (window.scrollY || 0) > 600;

    if (mint && mint.getBoundingClientRect) {
      const r = mint.getBoundingClientRect();
      show = r.top < -120;
    }

    sticky.style.display = show ? "" : "none";
  }

  function render() {
    // pills
    const netPill = $("#" + IDS.netPill);
    const walletPill = $("#" + IDS.walletPill);
    const readyPill = $("#" + IDS.readyPill);

    if (netPill) netPill.textContent = state.networkLabel || "—";
    if (walletPill) walletPill.textContent = state.walletConnected ? shortAddr(state.walletLabel) : "Not connected";
    if (readyPill) readyPill.textContent = state.ready ? "Yes" : "No";

    // Selected tier box
    const nameEl = $("#" + IDS.selectedTierName);
    const guardEl = $("#" + IDS.selectedTierGuard);
    if (nameEl) nameEl.textContent = state.tierLabel || "—";
    if (guardEl) guardEl.textContent = `guard: ${state.guardLabel || "—"}`;

    // Wallet card
    const walletStatus = $("#" + IDS.walletStatus);
    const walletAddr = $("#" + IDS.walletAddr);
    if (walletStatus) walletStatus.textContent = state.walletConnected ? "Connected" : "Not connected";
    if (walletAddr) walletAddr.textContent = state.walletConnected ? `Connected: ${shortAddr(state.walletLabel)}` : "Connect wallet";

    // Connect/disconnect visibility
    const connectBtn = $("#" + IDS.connectBtn);
    const disconnectBtn = $("#" + IDS.disconnectBtn);
    if (connectBtn) connectBtn.style.display = state.walletConnected ? "none" : "";
    if (disconnectBtn) disconnectBtn.style.display = state.walletConnected ? "" : "none";

    // Price + total
    const priceEl = $("#" + IDS.price);
    const totalEl = $("#" + IDS.total);
    if (priceEl) priceEl.textContent = state.priceLabel || "—";
    if (totalEl) totalEl.textContent = state.totalLabel || "—";

    // Mint button
    const mintBtn = $("#" + IDS.mintBtn);
    if (mintBtn) {
      mintBtn.disabled = !state.ready;
      mintBtn.classList.toggle("opacity-60", !state.ready);
      mintBtn.classList.toggle("cursor-not-allowed", !state.ready);
    }

    // Hint
    const hint = $("#" + IDS.mintHint);
    if (hint) {
      if (!state.walletConnected) hint.textContent = "Disconnected.";
      else if (!state.tier) hint.textContent = "Select a tier.";
      else if (!state.ready) hint.textContent = "Setting Candy Guard…";
      else hint.textContent = "Ready. Click Mint now.";
    }

    // Sticky
    const stickyLabel = $("#" + IDS.stickyTierLabel);
    const stickyAction = $("#" + IDS.stickyActionBtn);
    if (stickyLabel) stickyLabel.textContent = state.tierLabel ? `Tier: ${state.tierLabel}` : "Tier: —";

    if (stickyAction) {
      if (!state.walletConnected) stickyAction.textContent = "Connect";
      else if (!state.tier) stickyAction.textContent = "Select tier";
      else if (!state.ready) stickyAction.textContent = "Preparing…";
      else stickyAction.textContent = "Mint now";
    }
  }

  window.addEventListener("tonfans:state", (e) => {
    const d = e.detail || {};
    if (typeof d.walletConnected === "boolean") state.walletConnected = d.walletConnected;
    if (typeof d.walletLabel === "string") state.walletLabel = d.walletLabel;
    if (typeof d.networkLabel === "string") state.networkLabel = d.networkLabel;

    if (typeof d.tier === "string" || d.tier === null) state.tier = d.tier;
    if (typeof d.tierLabel === "string" || d.tierLabel === null) state.tierLabel = d.tierLabel;

    if (typeof d.guardLabel === "string") state.guardLabel = d.guardLabel;

    if (typeof d.ready === "boolean") state.ready = d.ready;

    if (typeof d.priceLabel === "string") state.priceLabel = d.priceLabel;
    if (typeof d.totalLabel === "string") state.totalLabel = d.totalLabel;

    render();
  });

  function init() {
    wireTierCards();
    wireButtons();
    render();

    window.addEventListener("scroll", stickyVisibility, { passive: true });
    window.addEventListener("resize", stickyVisibility);
    stickyVisibility();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
