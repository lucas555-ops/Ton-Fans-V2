// assets/js/ui.js (v18) — TON Fans UI for your index.html
// Adds "Minted: X/3" + "Remaining: Y/3", toast popup, qty reset after success,
// and dynamic qty max based on remaining (prevents user from selecting > remaining).
(() => {
  console.log("[TONFANS] ui.js v18 loaded");

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

  const MAX_QTY = 3;
  let currentMaxQty = MAX_QTY;

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

  // --- Toast (popup) ---
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

    const max = Number.isFinite(Number(currentMaxQty)) ? Number(currentMaxQty) : MAX_QTY;
    if (q > max) q = max;

    if ("value" in els.qty) {
      els.qty.value = String(q);
      els.qty.setAttribute("min","1");
      els.qty.setAttribute("max", String(max));
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

  function canMint(s){
    return !!s.walletConnected && !!s.ready && !s.busy;
  }

  // extra UI lines
  let qtyRemainingEl = null;
  let mintedLineEl = null;

  function ensureExtraEls(){
    if (!qtyRemainingEl && els.qty && els.qty.parentElement) {
      qtyRemainingEl = document.getElementById("qtyRemaining");
      if (!qtyRemainingEl) {
        qtyRemainingEl = document.createElement("div");
        qtyRemainingEl.id = "qtyRemaining";
        qtyRemainingEl.className = "text-xs muted2 ml-2";
        qtyRemainingEl.style.whiteSpace = "nowrap";
        els.qty.parentElement.appendChild(qtyRemainingEl);
      }
    }

    if (!mintedLineEl && els.mintBtn) {
      mintedLineEl = document.getElementById("mintedLine");
      if (!mintedLineEl) {
        mintedLineEl = document.createElement("div");
        mintedLineEl.id = "mintedLine";
        mintedLineEl.className = "mt-2 text-xs muted2";
        mintedLineEl.textContent = "Minted: —/3";
        els.mintBtn.insertAdjacentElement("afterend", mintedLineEl);
      }
    }
  }

  function render(s){
    window.__TONFANS_STATE__ = s;

    ensureExtraEls();

    // minted / remaining from mint.js
    const minted = Number.isFinite(Number(s.mintedCount)) ? Number(s.mintedCount) : null;
    const remaining = Number.isFinite(Number(s.mintedRemaining)) ? Number(s.mintedRemaining)
      : (minted == null ? null : Math.max(0, MAX_QTY - minted));

    // dynamic max qty based on remaining (but always allow showing at least 1)
    if (remaining == null) currentMaxQty = MAX_QTY;
    else currentMaxQty = Math.max(1, Math.min(MAX_QTY, remaining));

    if (mintedLineEl) mintedLineEl.textContent = `Minted: ${(minted == null ? "—" : minted)}/3`;
    if (qtyRemainingEl) qtyRemainingEl.textContent = `Remaining: ${(remaining == null ? "—" : remaining)}/3`;

    // Top pills
    if (els.netPill) setText(els.netPill, s.cluster === "devnet" ? "Devnet" : (s.cluster || "—"));
    if (els.walletPill) setText(els.walletPill, s.walletConnected ? (s.walletShort || "Connected") : "Not connected");
    if (els.readyPill) setText(els.readyPill, s.ready ? "Yes" : "No");

    // Wallet card
    setText(els.walletStatus, s.walletConnected ? "Connected" : "Not connected");
    setText(els.walletAddr, s.walletConnected ? (s.walletShort || "") : "—");
    setHidden(els.connectBtn, !!s.walletConnected);
    setHidden(els.disconnectBtn, !s.walletConnected);

    // Selected tier
    setText(els.selectedTierName, s.tierLabel || "—");
    setText(
      els.selectedTierMeta,
      s.guardPk
        ? `guard: ${String(s.guardPk).slice(0,4)}…${String(s.guardPk).slice(-4)}${s.guardGroup ? ` (${s.guardGroup})` : ""}`
        : "guard: —"
    );
    setHidden(els.tierReady, !s.ready);
    highlightTier(s.tierRaw);

    // Sticky bar
    if (els.stickyMintBar) {
      const show = !!s.tierRaw;
      setHidden(els.stickyMintBar, !show);
      if (show) setText(els.stickySelected, s.tierLabel || "—");
    }

    // Quantity clamp + disable buttons
    setQty(getQty());
    if (els.qtyMinus) {
      const dis = getQty() <= 1;
      els.qtyMinus.disabled = dis;
      els.qtyMinus.style.opacity = dis ? ".55" : "1";
      els.qtyMinus.style.cursor = dis ? "not-allowed" : "pointer";
    }
    if (els.qtyPlus) {
      const dis = getQty() >= currentMaxQty;
      els.qtyPlus.disabled = dis;
      els.qtyPlus.style.opacity = dis ? ".55" : "1";
      els.qtyPlus.style.cursor = dis ? "not-allowed" : "pointer";
    }

    // Price + total
    setText(els.price, fmtSol(s.priceSol));
    const total = (s.priceSol == null) ? null : (Number(s.priceSol) * getQty());
    setText(els.total, fmtSol(total));

    // Mint button
    if (els.mintBtn){
      const ok = canMint(s);
      els.mintBtn.disabled = !ok;
      els.mintBtn.style.opacity = ok ? "1" : ".55";
      els.mintBtn.textContent = s.busy ? (s.busyLabel || "Working…") : "Mint now";
      els.mintBtn.style.cursor = ok ? "pointer" : "not-allowed";
    }

    // Sticky action
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
      const prefix = s.hintKind === "error" ? "Error: " : "";
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
      if (els.qtyPlus.disabled) {
        const s = window.__TONFANS_STATE__ || {};
        const rem = Number.isFinite(Number(s.mintedRemaining)) ? Number(s.mintedRemaining) : null;
        if (rem === 0) toast("Mint limit reached (3 per wallet)", "error");
        else if (rem != null) toast(`Only ${rem}/3 remaining.`, "info");
        return;
      }
      setQty(getQty() + 1);
      render(window.__TONFANS_STATE__ || {});
    }, { capture: true });

    // input support
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
    if (els.mintBtn) els.mintBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      try {
        await mintApi()?.mintNow?.(getQty());
      } catch (err) {
        // Error handled by mint.js toast
      }
    }, { capture: true });

    // sticky action
    if (els.stickyActionBtn) els.stickyActionBtn.addEventListener("click", async (e) => {
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
      } catch (err) {
        // Error handled by mint.js toast
      }
    }, { capture: true });

    // sticky change tier
    if (els.stickyChangeBtn) els.stickyChangeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      location.hash = "#tiers";
      try { document.getElementById("tiers")?.scrollIntoView({ behavior: "smooth" }); } catch {}
    });

    // toast / qty events from mint.js
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

    window.addEventListener("tonfans:state", (e) => render(e.detail));
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
      hint: "",
      hintKind: "info",
      mintedCount: null,
      mintedRemaining: null,
    };
    window.__TONFANS_STATE__ = init;
    render(init);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
