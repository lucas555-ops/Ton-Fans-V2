// assets/js/ui.js (v19) — TON Fans UI (pro-level UX)
// - Shows Remaining + Minted counters (3 per wallet)
// - Toast popups (English)
// - Keeps Mint enabled at Remaining=0, but click only shows toast + "no transaction sent"
// - Resets qty to 1 after successful mint
(() => {
  console.log("[TONFANS] ui.js v19 loaded");

  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const MAX_QTY = 3;

  const TIER_LABELS = {
    "littlegen": "LittleGEN",
    "biggen": "BigGEN",
    "littlegen_diamond": "LittleGEN Diamond",
    "biggen_diamond": "BigGEN Diamond",
    "littlegen-diamond": "LittleGEN Diamond",
    "biggen-diamond": "BigGEN Diamond",
  };

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

    qtyMinus: $("qtyMinus"),
    qty: $("qty"),
    qtyPlus: $("qtyPlus"),

    price: $("price"),
    total: $("total"),

    mintBtn: $("mintBtn"),
    mintHelp: $("mintHelp"),
    mintHint: $("mintHint"),

    stickyMintBar: $("stickyMintBar"),
    stickySelected: $("stickySelected"),
    stickyActionBtn: $("stickyActionBtn"),
    stickyChangeBtn: $("stickyChangeBtn"),
  };

  function tierCards(){
    return $$(".tier-card[data-tier]");
  }

  function mintApi(){
    return window.__TONFANS_MINT__;
  }

  function setText(el, txt){
    if (!el) return;
    el.textContent = (txt == null ? "" : String(txt));
  }

  function setHidden(el, hidden){
    if (!el) return;
    el.style.display = hidden ? "none" : "";
  }

  function clamp(n, a, b){
    n = Number(n);
    if (!Number.isFinite(n)) n = a;
    return Math.max(a, Math.min(b, n));
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
    v = clamp(v, 1, MAX_QTY);
    if (!els.qty) return;
    if ("value" in els.qty) els.qty.value = String(v);
    else els.qty.textContent = String(v);
    syncTotals();
    // clamp +/- button states
    if (els.qtyMinus) {
      const dis = v <= 1;
      els.qtyMinus.disabled = dis;
      els.qtyMinus.style.opacity = dis ? ".55" : "1";
      els.qtyMinus.style.cursor = dis ? "not-allowed" : "pointer";
    }
    if (els.qtyPlus) {
      const dis = v >= MAX_QTY;
      els.qtyPlus.disabled = dis;
      els.qtyPlus.style.opacity = dis ? ".55" : "1";
      els.qtyPlus.style.cursor = dis ? "not-allowed" : "pointer";
    }
  }

  function fmtSol(v){
    if (v == null || v === "" || Number.isNaN(Number(v))) return "—";
    const n = Number(v);
    // show 3 decimals only when needed (e.g. 0.125 / 0.375)
    const s3 = n.toFixed(3);
    if (s3.endsWith("000")) return n.toFixed(2);
    if (s3.endsWith("0")) return n.toFixed(2);
    return s3;
  }

  function syncTotals(){
    const s = window.__TONFANS_STATE__ || {};
    if (els.price) setText(els.price, fmtSol(s.priceSol));
    if (els.total) {
      const qty = getQty();
      const total = (s.priceSol == null) ? null : (Number(s.priceSol) * qty);
      setText(els.total, fmtSol(total));
    }
  }

  function shortPk(pk){
    const s = String(pk || "");
    if (!s) return "";
    return `${s.slice(0,4)}…${s.slice(-4)}`;
  }

  function highlightTier(tierRaw){
    for (const c of tierCards()){
      const on = (c.getAttribute("data-tier") === tierRaw);
      c.style.outline = on ? "2px solid rgba(255,255,255,.65)" : "";
      c.style.outlineOffset = on ? "2px" : "";
      c.style.borderColor = on ? "rgba(255,255,255,.55)" : "";
    }
  }

  function canMint(s){
    return !!(s.walletConnected && s.ready && !s.busy);
  }

  // -------- Toast (popup)
  const toastWrap = document.createElement("div");
  toastWrap.style.position = "fixed";
  toastWrap.style.top = "16px";
  toastWrap.style.right = "16px";
  toastWrap.style.zIndex = "99999";
  toastWrap.style.display = "flex";
  toastWrap.style.flexDirection = "column";
  toastWrap.style.gap = "8px";
  document.body.appendChild(toastWrap);

  function showToast(message, kind="info"){
    const t = document.createElement("div");
    t.textContent = String(message || "");
    t.style.maxWidth = "360px";
    t.style.padding = "10px 12px";
    t.style.borderRadius = "12px";
    t.style.border = "1px solid rgba(255,255,255,.12)";
    t.style.background = "rgba(0,0,0,.72)";
    t.style.backdropFilter = "blur(10px)";
    t.style.color = "rgba(255,255,255,.92)";
    t.style.fontSize = "13px";
    t.style.boxShadow = "0 10px 30px rgba(0,0,0,.35)";
    if (kind === "error") t.style.borderColor = "rgba(255,80,80,.35)";
    if (kind === "warn") t.style.borderColor = "rgba(255,180,80,.35)";
    if (kind === "ok") t.style.borderColor = "rgba(120,255,180,.28)";
    toastWrap.appendChild(t);
    setTimeout(() => {
      t.style.opacity = "0";
      t.style.transform = "translateY(-6px)";
      t.style.transition = "all .2s ease";
      setTimeout(() => t.remove(), 220);
    }, 2600);
  }

  window.addEventListener("tonfans:toast", (e) => {
    const d = e.detail || {};
    showToast(d.message || "", d.kind || "info");
  });

  // -------- Extra UI: Remaining + Minted + Limit note
  const qtyRemainingEl = document.createElement("span");
  qtyRemainingEl.className = "text-xs muted2 ml-2";
  qtyRemainingEl.style.whiteSpace = "nowrap";
  if (els.qty && els.qty.parentElement) els.qty.parentElement.appendChild(qtyRemainingEl);

  const mintedLineEl = document.createElement("div");
  mintedLineEl.className = "mt-2 text-xs muted2";
  mintedLineEl.style.whiteSpace = "nowrap";

  const limitNoteEl = document.createElement("div");
  limitNoteEl.className = "mt-1 text-[11px] muted2";
  limitNoteEl.style.opacity = ".85";
  limitNoteEl.style.whiteSpace = "nowrap";
  limitNoteEl.textContent = "Limit reached — no transaction sent (no bot tax)";

  if (els.mintBtn && els.mintBtn.parentElement) {
    els.mintBtn.parentElement.appendChild(mintedLineEl);
    els.mintBtn.parentElement.appendChild(limitNoteEl);
  }

  // -------- Render
  function render(s){
    window.__TONFANS_STATE__ = s || {};

    // pills
    if (els.netPill) setText(els.netPill, s.cluster === "devnet" ? "Devnet" : (s.cluster || "—"));
    if (els.walletPill) setText(els.walletPill, s.walletConnected ? (s.walletShort || "Connected") : "Not connected");
    if (els.readyPill) setText(els.readyPill, s.ready ? "Yes" : "No");

    // wallet card
    setText(els.walletStatus, s.walletConnected ? "Connected" : "Not connected");
    setText(els.walletAddr, s.walletConnected ? (s.walletShort || "") : "—");
    setHidden(els.connectBtn, !!s.walletConnected);
    setHidden(els.disconnectBtn, !s.walletConnected);

    // tier
    const label = s.tierLabel || TIER_LABELS[s.tierRaw] || "—";
    setText(els.selectedTierName, label);
    setText(
      els.selectedTierMeta,
      s.guardPk ? `guard: ${shortPk(s.guardPk)}${s.guardGroup ? ` (${s.guardGroup})` : ""}` : "guard: —"
    );
    setHidden(els.tierReady, !s.ready);
    highlightTier(s.tierRaw);

    // sticky
    if (els.stickyMintBar) {
      const show = !!s.tierRaw;
      setHidden(els.stickyMintBar, !show);
      if (show && els.stickySelected) setText(els.stickySelected, label);
    }

    // qty clamp
    setQty(getQty());

    // price/total
    syncTotals();

    // remaining + minted info
    if (s.mintedRemaining == null) {
      qtyRemainingEl.style.display = "none";
      mintedLineEl.style.display = "none";
      limitNoteEl.style.display = "none";
    } else {
      qtyRemainingEl.style.display = "";
      mintedLineEl.style.display = "";
      const minted = Number(s.mintedCount || 0);
      const rem = Math.max(0, Number(s.mintedRemaining || 0));
      qtyRemainingEl.textContent = `Remaining: ${rem}/${MAX_QTY}`;
      mintedLineEl.textContent = `Minted: ${minted}/${MAX_QTY}`;

      // Show pro note when remaining=0 (button still active)
      limitNoteEl.style.display = (rem === 0) ? "" : "none";
    }

    // mint btn state (keep active even if Remaining=0)
    if (els.mintBtn) {
      const ok = canMint(s);
      els.mintBtn.disabled = !ok;
      els.mintBtn.style.cursor = ok ? "pointer" : "not-allowed";
      els.mintBtn.style.opacity = ok ? "1" : ".65";
    }

    // sticky action
    if (els.stickyActionBtn) {
      if (!s.walletConnected) {
        els.stickyActionBtn.textContent = "Connect";
        els.stickyActionBtn.disabled = false;
        els.stickyActionBtn.style.cursor = "pointer";
      } else {
        els.stickyActionBtn.textContent = "Mint";
        const ok2 = canMint(s);
        els.stickyActionBtn.disabled = !ok2;
        els.stickyActionBtn.style.cursor = ok2 ? "pointer" : "not-allowed";
        els.stickyActionBtn.style.opacity = ok2 ? "1" : ".65";
      }
    }

    // hint line
    if (els.mintHint) {
      const prefix = s.hintKind === "error" ? "Error: " : "";
      setText(els.mintHint, `${prefix}${s.hint || ""}`.trim());
    }
  }

  // -------- Bind
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
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        onTier(c).catch((err) => showToast(err?.message || String(err), "error"));
      }, { capture: true });
    }

    // qty buttons
    if (els.qtyMinus) els.qtyMinus.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      setQty(getQty() - 1);
    }, { capture: true });

    if (els.qtyPlus) els.qtyPlus.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      setQty(getQty() + 1);
    }, { capture: true });

    // connect/disconnect
    if (els.connectBtn) els.connectBtn.addEventListener("click", (e) => {
      e.preventDefault();
      mintApi()?.toggleConnect?.().catch((err) => showToast(err?.message || String(err), "error"));
    });
    if (els.disconnectBtn) els.disconnectBtn.addEventListener("click", (e) => {
      e.preventDefault();
      mintApi()?.toggleConnect?.().catch((err) => showToast(err?.message || String(err), "error"));
    });

    // mint main (async)
    if (els.mintBtn) els.mintBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();

      const s = window.__TONFANS_STATE__ || {};
      const api = mintApi();
      if (!api) return;

      try {
        if (!s.walletConnected) {
          await api.toggleConnect?.();
          return;
        }
        await api.mintNow?.(getQty());
        // Success (or client-side prevented mint) -> reset qty to 1 for "top mint page" UX
        setQty(1);
      } catch (err) {
        showToast(err?.message || String(err), "error");
      }
    }, { capture: true });

    // sticky action (async)
    if (els.stickyActionBtn) els.stickyActionBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();

      const s = window.__TONFANS_STATE__ || {};
      const api = mintApi();
      if (!api) return;

      try {
        if (!s.walletConnected) await api.toggleConnect?.();
        else {
          await api.mintNow?.(getQty());
          setQty(1);
        }
      } catch (err) {
        showToast(err?.message || String(err), "error");
      }
    }, { capture: true });

    // sticky change tier
    if (els.stickyChangeBtn) els.stickyChangeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      location.hash = "#tiers";
      try { document.getElementById("tiers")?.scrollIntoView({ behavior: "smooth" }); } catch {}
    });

    // external quantity updates (from mint.js)
    window.addEventListener("tonfans:qty", (e) => {
      const q = Number(e.detail?.qty);
      if (!Number.isFinite(q)) return;
      setQty(q);
    });

    window.addEventListener("tonfans:state", (e) => render(e.detail));
  }

  // init
  function init(){
    bind();
    const s0 = {
      cluster: "devnet",
      walletConnected: false,
      walletShort: null,
      tierRaw: null,
      tierLabel: "—",
      guardPk: null,
      guardGroup: null,
      ready: false,
      priceSol: null,
      mintedCount: null,
      mintedRemaining: null,
      busy: false,
      hint: "",
      hintKind: "info",
    };
    window.__TONFANS_STATE__ = s0;
    render(s0);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
