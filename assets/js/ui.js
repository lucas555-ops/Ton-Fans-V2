// assets/js/ui.js (v23) — TON Fans UI (paired with mint.js v23)
// Fixes:
// - Selected tier / Ready / Price always sync
// - Ready micro-copy uses ready-pop / ready-hide classes (components.css)
// - Sticky "Change tier" works
// - Auto-select saved tier (or first tier on first visit) with retry until mint API is ready
// - Toasts from mint.js

(() => {
  console.log("[TONFANS] ui.js v23 loaded");

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

    shareX: $("shareX"),
  };

  const MAX_QTY = 3;

  const tierCards = () => Array.from(document.querySelectorAll(".tier-card[data-tier]"));

  function setHidden(el, hidden){ if (el) el.classList.toggle("hidden", !!hidden); }
  function setText(el, v){ if (el) el.textContent = v == null ? "" : String(v); }

  function fmtSol(n){
    if (n == null || !Number.isFinite(Number(n))) return "—";
    const x = Number(n);
    const milli = Math.round(x * 1000);
    const rounded3 = milli / 1000;
    if (milli % 10 === 0) return rounded3.toFixed(2);
    return rounded3.toFixed(3);
  }

  // --- Toast (tiny, safe) ---
  let toastTimer = null;
  function ensureToastEl(){
    let el = document.getElementById("tonfansToast");
    if (el) return el;

    el = document.createElement("div");
    el.id = "tonfansToast";
    el.style.position = "fixed";
    el.style.left = "50%";
    el.style.bottom = "22px";
    el.style.transform = "translateX(-50%)";
    el.style.zIndex = "99999";
    el.style.maxWidth = "92vw";
    el.style.padding = "12px 14px";
    el.style.borderRadius = "14px";
    el.style.border = "1px solid rgba(255,255,255,0.12)";
    el.style.background = "rgba(10,10,10,0.86)";
    el.style.backdropFilter = "blur(10px)";
    el.style.color = "rgba(255,255,255,0.92)";
    el.style.fontSize = "13px";
    el.style.fontWeight = "600";
    el.style.boxShadow = "0 12px 40px rgba(0,0,0,0.45)";
    el.style.display = "none";
    el.style.pointerEvents = "none";
    document.body.appendChild(el);
    return el;
  }

  function toast(message, kind="info"){
    const el = ensureToastEl();
    el.textContent = String(message || "");
    el.style.display = "block";
    el.style.borderColor =
      (kind === "error") ? "rgba(255,120,120,0.35)" :
      (kind === "ok") ? "rgba(120,255,180,0.28)" :
      "rgba(255,255,255,0.12)";

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = "none"; }, 2600);
  }

  function readQtyRaw(){
    if (!els.qty) return "1";
    if ("value" in els.qty) return String(els.qty.value || "1");
    return String(els.qty.textContent || "1").trim();
  }

  function getQty(){
    const v = Number(readQtyRaw() || 1);
    if (!Number.isFinite(v) || v <= 0) return 1;
    return Math.floor(v);
  }

  function setQty(v){
    if (!els.qty) return;
    let q = Math.floor(Number(v || 1));
    if (!Number.isFinite(q) || q < 1) q = 1;
    if (q > MAX_QTY) q = MAX_QTY;

    if ("value" in els.qty) {
      els.qty.value = String(q);
      els.qty.setAttribute("min","1");
      els.qty.setAttribute("max", String(MAX_QTY));
    } else {
      els.qty.textContent = String(q);
    }
  }

  function highlightTier(tierRaw){
    for (const c of tierCards()){
      const t = c.getAttribute("data-tier");
      const on = t === tierRaw;
      c.classList.toggle("tier-selected", on);
      c.setAttribute("aria-selected", on ? "true" : "false");
    }
  }

  function setReadyMicro(on){
    if (!els.tierReady) return;
    els.tierReady.classList.toggle("ready-pop", !!on);
    els.tierReady.classList.toggle("ready-hide", !on);
  }

  function canMint(s){
    return !!s.walletConnected && !!s.ready && !s.busy;
  }

  function render(s){
    window.__TONFANS_STATE__ = s;

    // top pills
    if (els.netPill) setText(els.netPill, s.cluster === "devnet" ? "Devnet" : (s.cluster || "—"));
    if (els.walletPill) setText(els.walletPill, s.walletConnected ? (s.walletShort || "Connected") : "Not connected");
    if (els.readyPill) {
      setText(els.readyPill, s.ready ? "Yes" : "No");
      // quick color hint (works with Tailwind in HTML)
      els.readyPill.classList.toggle("text-yellow-400", !s.ready);
      els.readyPill.classList.toggle("text-emerald-300", !!s.ready);
    }

    // wallet card
    setText(els.walletStatus, s.walletConnected ? "Connected" : "Not connected");
    if (els.walletAddr) {
      setText(els.walletAddr, s.walletConnected ? (s.walletShort || "") : "");
      setHidden(els.walletAddr, !s.walletConnected);
    }
    setHidden(els.connectBtn, !!s.walletConnected);
    setHidden(els.disconnectBtn, !s.walletConnected);

    // selected tier
    setText(els.selectedTierName, s.tierLabel || "—");
    setText(
      els.selectedTierMeta,
      s.guardPk
        ? `guard: ${String(s.guardPk).slice(0,4)}…${String(s.guardPk).slice(-4)}${s.guardGroup ? ` (${s.guardGroup})` : ""}`
        : "guard: —"
    );
    setReadyMicro(!!s.ready);
    highlightTier(s.tierRaw);

    // sticky bar
    if (els.stickyMintBar) {
      const show = !!s.tierRaw;
      setHidden(els.stickyMintBar, !show);
      document.body.classList.toggle("has-sticky", show);
      if (show) setText(els.stickySelected, s.tierLabel || "—");
    }

    // quantity
    setQty(getQty());
    if (els.qtyMinus) {
      const dis = getQty() <= 1;
      els.qtyMinus.disabled = dis;
      els.qtyMinus.style.opacity = dis ? ".55" : "1";
      els.qtyMinus.style.cursor = dis ? "not-allowed" : "pointer";
    }
    if (els.qtyPlus) {
      const dis = getQty() >= MAX_QTY;
      els.qtyPlus.disabled = dis;
      els.qtyPlus.style.opacity = dis ? ".55" : "1";
      els.qtyPlus.style.cursor = dis ? "not-allowed" : "pointer";
    }

    // price + total
    setText(els.price, fmtSol(s.priceSol));
    const total = (s.priceSol == null) ? null : (Number(s.priceSol) * getQty());
    setText(els.total, fmtSol(total));

    // mint button
    if (els.mintBtn){
      const ok = canMint(s);
      els.mintBtn.disabled = !ok;
      els.mintBtn.style.opacity = ok ? "1" : ".55";
      els.mintBtn.textContent = s.busy ? (s.busyLabel || "Working…") : "Mint now";
      els.mintBtn.style.cursor = ok ? "pointer" : "not-allowed";
    }

    // sticky action
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

    // hint
    if (els.mintHint){
      const prefix = s.hintKind === "error" ? "Error: " : "";
      setText(els.mintHint, `${prefix}${s.hint || ""}`.trim());
    }

    // help link
    if (els.mintHelp){
      els.mintHelp.textContent = s.tierRaw ? "Change tier →" : "Set CM address →";
      els.mintHelp.href = s.tierRaw ? "#tiers" : "#transparency";
    }

    // After mint: Share on X
    if (els.shareX){
      const tx0 = Array.isArray(s.recentTxSignatures) && s.recentTxSignatures.length ? s.recentTxSignatures[0] : null;
      const sig = tx0?.signature || (typeof tx0 === "string" ? tx0 : null);
      if (sig) {
        const explorer = tx0?.explorerUrl || `https://solscan.io/tx/${sig}${(s.cluster === "devnet") ? "?cluster=devnet" : ""}`;
        const shareText = `Just minted TON Fans on Solana! ${explorer}`;
        els.shareX.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
        els.shareX.style.opacity = "1";
        els.shareX.style.pointerEvents = "auto";
      } else {
        els.shareX.href = "https://x.com/ton_fans";
        els.shareX.style.opacity = ".7";
      }
    }
  }

  function mintApi(){ return window.TONFANS?.mint; }

  function setTierWhenReady(tierRaw, tries = 0){
    const api = mintApi();
    if (api?.setTier) {
      api.setTier(tierRaw).catch(()=>{});
      return;
    }
    if (tries >= 60) return; // ~6s max
    setTimeout(() => setTierWhenReady(tierRaw, tries + 1), 100);
  }

  async function onTier(card){
    const tierRaw = card.getAttribute("data-tier");
    if (!tierRaw) return;

    highlightTier(tierRaw);
    try { localStorage.setItem("tonfans:tier", tierRaw); } catch {}

    if (els.stickyMintBar) setHidden(els.stickyMintBar, false);
    setTierWhenReady(tierRaw);
  }

  function bind(){
    // tier cards
    for (const c of tierCards()){
      c.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        onTier(c).catch(()=>{});
      }, { capture: true });
    }

    // qty buttons
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

    // input support (if you later switch qty element to input)
    if (els.qty && ("value" in els.qty)) els.qty.addEventListener("input", (e) => {
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

    // events
    window.addEventListener("tonfans:toast", (e) => {
      try { toast(e?.detail?.message, e?.detail?.kind || "info"); } catch {}
    });

    window.addEventListener("tonfans:qty", (e) => {
      try {
        const q = Number(e?.detail?.qty);
        if (Number.isFinite(q)) {
          setQty(q);
          render(window.__TONFANS_STATE__ || {});
        }
      } catch {}
    });

    window.addEventListener("tonfans:state", (e) => {
      try { render(e.detail); } catch (err) { console.error("[TONFANS] render error:", err); }
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
      busy: false,
      hint: "Select a tier.",
      hintKind: "info",
      recentTxSignatures: [],
    };

    window.__TONFANS_STATE__ = init;
    render(init);

    // Auto tier select (saved or first card) — robust retry until mint.js is ready
    let tier = null;
    try { tier = localStorage.getItem("tonfans:tier"); } catch {}
    if (!tier) {
      const first = tierCards()[0];
      tier = first?.getAttribute("data-tier") || null;
      if (tier) { try { localStorage.setItem("tonfans:tier", tier); } catch {} }
    }

    if (tier) {
      highlightTier(tier);
      if (els.stickyMintBar) setHidden(els.stickyMintBar, false);
      setTierWhenReady(tier);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
