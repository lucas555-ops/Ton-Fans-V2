// assets/js/ui.js (v11) — TON Fans UI for your index.html
// Fixes:
// - Top pills: do NOT duplicate labels (Network/Wallet/Ready already present in HTML)
// - Quantity max 3 enforced (plus/minus + input)
// - Sticky bar action always says "Mint" (disabled when not ready)
// - Mint button enable/disable consistent with state.ready + sold out hints

(() => {
  const $ = (id) => document.getElementById(id);

  const els = {
    netPill: $("netPill"),
    walletPill: $("walletPill"),
    readyPill: $("readyPill"),

    walletStatus: $("walletStatus"),
    walletAddr: $("walletAddr"),
    connectBtn: $("connectBtn"),
    disconnectBtn: $("disconnectBtn"),

    selectedTierName: $("selectedTierName"),
    selectedTierMeta: $("selectedTierMeta"),
    tierReady: $("tierReady"),

    price: $("price"),
    total: $("total"),
    qty: $("qty"),
    qtyMinus: $("qtyMinus"),
    qtyPlus: $("qtyPlus"),

    mintBtn: $("mintBtn"),
    mintHint: $("mintHint"),
    mintHelp: $("mintHelp"),

    stickyMintBar: $("stickyMintBar"),
    stickySelected: $("stickySelected"),
    stickyActionBtn: $("stickyActionBtn"),
    stickyChangeBtn: $("stickyChangeBtn"),
  };

  const tierCards = () => Array.from(document.querySelectorAll(".tier-card[data-tier]"));

  const MAX_QTY = 3;

  function setHidden(el, hidden){ if (el) el.classList.toggle("hidden", !!hidden); }
  function setText(el, v){ if (el) el.textContent = v == null ? "" : String(v); }
  function fmt(n){
    if (n == null || !Number.isFinite(Number(n))) return "—";
    return Number(n).toFixed(2);
  }
  function getQty(){
    const v = Number(els.qty?.value || 1);
    if (!Number.isFinite(v) || v <= 0) return 1;
    return Math.floor(v);
  }
  function setQty(v){
    if (!els.qty) return;
    let q = Math.floor(Number(v||1));
    if (!Number.isFinite(q) || q < 1) q = 1;
    if (q > MAX_QTY) q = MAX_QTY;
    els.qty.value = String(q);
    // also enforce attributes
    els.qty.setAttribute("min","1");
    els.qty.setAttribute("max", String(MAX_QTY));
  }

  function highlightTier(tierRaw){
    for (const c of tierCards()){
      const t = c.getAttribute("data-tier");
      const on = t === tierRaw;
      c.classList.toggle("tier-selected", on);
      c.setAttribute("aria-selected", on ? "true" : "false");
    }
  }

  function canMint(s){
    return !!s.walletConnected && !!s.ready && !s.busy;
  }

  function render(s){
    // store state
    window.__TONFANS_STATE__ = s;

    // Top pills (labels are in HTML already)
    if (els.netPill) setText(els.netPill, s.cluster === "devnet" ? "Devnet" : (s.cluster || "—"));
    if (els.walletPill) setText(els.walletPill, s.walletConnected ? (s.walletShort || "Connected") : "Not connected");
    if (els.readyPill) setText(els.readyPill, s.ready ? "Yes" : "No");

    // Wallet card
    setText(els.walletStatus, s.walletConnected ? "Connected" : "Not connected");
    setText(els.walletAddr, s.walletConnected ? (s.walletShort || "") : "—");
    setHidden(els.connectBtn, !!s.walletConnected);
    setHidden(els.disconnectBtn, !s.walletConnected);

    // Selected tier card
    setText(els.selectedTierName, s.tierLabel || "—");
    setText(els.selectedTierMeta, s.guardPk ? `guard: ${String(s.guardPk).slice(0,4)}…${String(s.guardPk).slice(-4)}${s.guardGroup ? ` (${s.guardGroup})` : ""}` : "guard: —");
    setHidden(els.tierReady, !s.ready);
    highlightTier(s.tierRaw);

    // Sticky bar
    if (els.stickyMintBar) {
      const show = !!s.tierRaw;
      setHidden(els.stickyMintBar, !show);
      if (show) setText(els.stickySelected, s.tierLabel || "—");
    }

    // Quantity
    setQty(getQty());
    // Disable +/- at bounds
    if (els.qtyMinus) {
      els.qtyMinus.disabled = getQty() <= 1;
      els.qtyMinus.style.opacity = els.qtyMinus.disabled ? ".55" : "1";
      els.qtyMinus.style.cursor = els.qtyMinus.disabled ? "not-allowed" : "pointer";
    }
    if (els.qtyPlus) {
      els.qtyPlus.disabled = getQty() >= MAX_QTY;
      els.qtyPlus.style.opacity = els.qtyPlus.disabled ? ".55" : "1";
      els.qtyPlus.style.cursor = els.qtyPlus.disabled ? "not-allowed" : "pointer";
    }

    // Price + total
    setText(els.price, fmt(s.priceSol));
    const total = (s.priceSol == null) ? null : (Number(s.priceSol) * getQty());
    setText(els.total, fmt(total));

    // Mint button
    if (els.mintBtn){
      const ok = canMint(s);
      els.mintBtn.disabled = !ok;
      els.mintBtn.style.opacity = ok ? "1" : ".55";
      els.mintBtn.textContent = s.busy ? (s.busyLabel || "Working…") : "Mint now";
      els.mintBtn.style.cursor = ok ? "pointer" : "not-allowed";
    }

    // Sticky action — ALWAYS show "Mint" when wallet connected
    if (els.stickyActionBtn){
      if (!s.walletConnected) {
        els.stickyActionBtn.textContent = "Connect";
        els.stickyActionBtn.disabled = false;
        els.stickyActionBtn.style.cursor = "pointer";
      } else {
        els.stickyActionBtn.textContent = "Mint";
        const okSticky = canMint(s);
        els.stickyActionBtn.disabled = !okSticky;
        els.stickyActionBtn.style.cursor = okSticky ? "pointer" : "not-allowed";
      }
    }

    // Hint
    if (els.mintHint){
      const prefix = s.hintKind === "error" ? "Error: " : (s.hintKind === "ok" ? "" : "");
      setText(els.mintHint, `${prefix}${s.hint || ""}`.trim());
    }

    // Help link label
    if (els.mintHelp){
      els.mintHelp.textContent = s.tierRaw ? "Change tier →" : "Set CM address →";
      els.mintHelp.href = s.tierRaw ? "#tiers" : "#transparency";
    }
  }

  function mintApi(){ return window.TONFANS?.mint; }

  async function onTier(card){
    const tierRaw = card.getAttribute("data-tier");
    if (!tierRaw) return;
    highlightTier(tierRaw);
    if (els.stickyMintBar) setHidden(els.stickyMintBar, false);
    await mintApi()?.setTier?.(tierRaw);
  }

  function bind(){
    // tier cards
    for (const c of tierCards()){
      c.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onTier(c).catch(()=>{});
      }, { capture: true });
    }

    // qty
    if (els.qtyMinus) els.qtyMinus.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      if (els.qtyMinus.disabled) return;
      setQty(getQty() - 1);
      render(window.__TONFANS_STATE__ || {});
    }, { capture: true });
    if (els.qtyPlus) els.qtyPlus.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      if (els.qtyPlus.disabled) return;
      setQty(getQty() + 1);
      render(window.__TONFANS_STATE__ || {});
    }, { capture: true });
    if (els.qty) els.qty.addEventListener("click", (e) => {
      // no-op for div qty; kept for compatibility
      e.stopPropagation();
    }, { capture: true });

    if (els.qty && "addEventListener" in els.qty && "value" in els.qty) els.qty.addEventListener("input", (e) => {
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      setQty(getQty());
      render(window.__TONFANS_STATE__ || {});
    }, { capture: true });

    // connect/disconnect
    if (els.connectBtn) els.connectBtn.addEventListener("click", (e) => {
      e.preventDefault();
      mintApi()?.toggleConnect?.().catch(()=>{});
    });
    if (els.disconnectBtn) els.disconnectBtn.addEventListener("click", (e) => {
      e.preventDefault();
      mintApi()?.toggleConnect?.().catch(()=>{});
    });

    // mint main
    if (els.mintBtn) els.mintBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      mintApi()?.mintNow?.(getQty()).catch(()=>{});
    }, { capture: true });

    // sticky action
    if (els.stickyActionBtn) els.stickyActionBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      const s = window.__TONFANS_STATE__ || {};
      const api = mintApi();
      if (!api) return;
      if (!s.walletConnected) api.toggleConnect?.().catch(()=>{});
      else api.mintNow?.(getQty()).catch(()=>{});
    }, { capture: true });

    // sticky change tier
    if (els.stickyChangeBtn) els.stickyChangeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      location.hash = "#tiers";
      try { document.getElementById("tiers")?.scrollIntoView({ behavior: "smooth" }); } catch {}
    });
  }

  function boot(){
    bind();
    const init = {
      cluster: "devnet",
      walletConnected: false,
      walletShort: null,
      tierRaw: null,
      tierLabel: "—",
      ready: false,
      priceSol: null,
      mintLimit: MAX_QTY,
      busy: false,
      busyLabel: "",
      hint: "Select a tier.",
      hintKind: "info",
    };
    window.__TONFANS_STATE__ = init;
    render(init);

    window.addEventListener("tonfans:state", (e) => render(e.detail));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
