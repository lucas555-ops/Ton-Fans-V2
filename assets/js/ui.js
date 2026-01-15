// assets/js/ui.js (v21) — TON Fans UI for your index.html
// Fixes:
// - Updated ID matching with HTML (shareX instead of shareOnX)
// - Removed conflicting after mint section logic (simplified)
// - Fixed supply container creation
(() => {
  console.log("[TONFANS] ui.js v21 loaded");

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
    
    // After mint elements (match HTML)
    shareX: $("shareX"),
    afterMintMessage: $("afterMintMessage"),
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

  function canMint(s){
    // Can mint if: wallet connected, ready, not busy, AND has remaining mints
    const hasRemaining = s.mintedRemaining === null || s.mintedRemaining > 0;
    return !!s.walletConnected && !!s.ready && !s.busy && hasRemaining;
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

  // Supply UI elements
  let supplyMintedPill = null;
  let supplyRemainPill = null;
  let supplyBarWrap = null;
  let supplyBarFill = null;
  let supplyBarText = null;

  function ensureSupplyWrap(){
    const container = document.querySelector(".supply-container");
    if (!container) return null;
    
    // Clear container first
    container.innerHTML = '';
    
    // Create supply pills
    supplyMintedPill = document.createElement("div");
    supplyMintedPill.id = "supplyMintedPill";
    supplyMintedPill.className = "text-xs muted2 mb-1";
    supplyMintedPill.textContent = "Supply: —/— minted";
    container.appendChild(supplyMintedPill);
    
    supplyRemainPill = document.createElement("div");
    supplyRemainPill.id = "supplyRemainPill";
    supplyRemainPill.className = "text-xs muted2 mb-2";
    supplyRemainPill.textContent = "Supply remaining: —";
    container.appendChild(supplyRemainPill);
    
    return container;
  }

  function ensureSupplyBar(){
    const wrap = ensureSupplyWrap();
    if (!wrap || supplyBarWrap) return;

    supplyBarWrap = document.createElement("div");
    supplyBarWrap.className = "w-full mt-1 mb-3";

    supplyBarText = document.createElement("div");
    supplyBarText.className = "text-xs muted2 mb-1 flex justify-between";
    
    const leftSpan = document.createElement("span");
    leftSpan.textContent = "Minted";
    
    const rightSpan = document.createElement("span");
    rightSpan.textContent = "— / —";
    rightSpan.id = "supplyBarNumbers";
    
    supplyBarText.appendChild(leftSpan);
    supplyBarText.appendChild(rightSpan);

    const outer = document.createElement("div");
    outer.style.height = "6px";
    outer.style.borderRadius = "999px";
    outer.style.background = "rgba(255,255,255,.10)";
    outer.style.overflow = "hidden";

    supplyBarFill = document.createElement("div");
    supplyBarFill.style.height = "100%";
    supplyBarFill.style.width = "0%";
    supplyBarFill.style.borderRadius = "999px";
    supplyBarFill.style.background = "linear-gradient(90deg, rgba(120,255,180,0.9) 0%, rgba(100,200,255,0.9) 100%)";
    supplyBarFill.style.transition = "width .35s ease";

    outer.appendChild(supplyBarFill);
    supplyBarWrap.appendChild(supplyBarText);
    supplyBarWrap.appendChild(outer);

    wrap.appendChild(supplyBarWrap);
  }

  function updateSupplyUI(s){
    ensureSupplyBar();
    
    // Always update supply pills, even when mintedRemaining = null
    if (supplyMintedPill && supplyRemainPill && 
        Number.isFinite(s.itemsRedeemed) && Number.isFinite(s.itemsAvailable)) {
      
      const total = s.itemsAvailable;
      const redeemed = s.itemsRedeemed;
      const remaining = Number.isFinite(s.itemsRemaining) ? s.itemsRemaining : Math.max(0, total - redeemed);
      
      supplyMintedPill.textContent = `Supply: ${redeemed}/${total} minted`;
      supplyRemainPill.textContent = `Supply remaining: ${remaining}`;
    }
    
    // Update progress bar
    if (supplyBarFill && supplyBarText && 
        Number.isFinite(s.itemsRedeemed) && Number.isFinite(s.itemsAvailable) && s.itemsAvailable > 0) {
      
      const total = s.itemsAvailable;
      const redeemed = s.itemsRedeemed;
      const pct = Math.max(0, Math.min(100, (redeemed / total) * 100));
      
      const numbersSpan = document.getElementById("supplyBarNumbers");
      if (numbersSpan) {
        numbersSpan.textContent = `${redeemed} / ${total}`;
      }
      
      supplyBarFill.style.width = `${pct}%`;
    }
  }

  function syncTotals(){
    const s = window.__TONFANS_STATE__ || {};
    const currentQty = getQty();
    
    // Price + total
    if (els.price) setText(els.price, fmtSol(s.priceSol));
    
    const total = (s.priceSol == null) ? null : (Number(s.priceSol) * currentQty);
    if (els.total) setText(els.total, fmtSol(total));
  }

  function updateAfterMintUI(s){
    if (!els.shareX || !els.afterMintMessage) return;
    
    const showAfterMint = !!s.lastTxSignature;
    
    if (showAfterMint && s.lastTxExplorerUrl) {
      // Update share on X link
      const tierName = s.tierLabel || "TON Fans NFT";
      const shareText = `Just minted ${tierName} on @ton_fans! ${s.lastTxExplorerUrl}`;
      els.shareX.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
      els.shareX.target = "_blank";
      
      // Update message
      els.afterMintMessage.textContent = `Mint successful! View transaction: ${s.lastTxSignature.slice(0,8)}...`;
      els.afterMintMessage.innerHTML = `Mint successful! <a href="${s.lastTxExplorerUrl}" target="_blank" class="text-blue-400 hover:text-blue-300">View on Solscan</a>`;
    } else {
      // Reset to default
      els.shareX.href = "#";
      els.afterMintMessage.textContent = "Celebration moment + explorer link will appear here after mint integration.";
    }
  }

  function render(s){
    window.__TONFANS_STATE__ = s;

    ensureExtraEls();
    ensureSupplyBar();

    // Update supply UI (ALWAYS, even when mintedRemaining = null)
    updateSupplyUI(s);

    // minted / remaining from mint.js
    const minted = s.mintedCount !== null ? Number(s.mintedCount) : null;
    const remaining = s.mintedRemaining !== null ? Number(s.mintedRemaining) : null;

    // Display personal mint counters
    if (mintedLineEl) mintedLineEl.textContent = `Minted: ${(minted == null ? "—" : minted)}/3`;
    if (qtyRemainingEl) qtyRemainingEl.textContent = `Remaining: ${(remaining == null ? "—" : remaining)}/3`;

    // Sync price totals
    syncTotals();

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

    // Quantity buttons - disable if no remaining mints OR if at min/max
    const currentQty = getQty();
    const hasRemaining = remaining === null || remaining > 0;
    
    if (els.qtyMinus) {
      const atMin = currentQty <= 1;
      const dis = atMin || !hasRemaining;
      els.qtyMinus.disabled = dis;
      els.qtyMinus.style.opacity = dis ? ".55" : "1";
      els.qtyMinus.style.cursor = dis ? "not-allowed" : "pointer";
    }
    
    if (els.qtyPlus) {
      const atMax = currentQty >= MAX_QTY;
      const dis = atMax || !hasRemaining;
      els.qtyPlus.disabled = dis;
      els.qtyPlus.style.opacity = dis ? ".55" : "1";
      els.qtyPlus.style.cursor = dis ? "not-allowed" : "pointer";
    }

    // Mint button - disable if no remaining mints
    if (els.mintBtn){
      const ok = canMint(s);
      els.mintBtn.disabled = !ok;
      els.mintBtn.style.opacity = ok ? "1" : ".55";
      els.mintBtn.textContent = s.busy ? (s.busyLabel || "Working…") : "Mint now";
      els.mintBtn.style.cursor = ok ? "pointer" : "not-allowed";
    }

    // Sticky action button
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

    // Update "After mint" section
    updateAfterMintUI(s);
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

    // qty minus button
    if (els.qtyMinus) els.qtyMinus.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      if (els.qtyMinus.disabled) return;
      setQty(getQty() - 1);
      render(window.__TONFANS_STATE__ || {});
    }, { capture: true });

    // qty plus button
    if (els.qtyPlus) els.qtyPlus.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      
      if (els.qtyPlus.disabled) {
        const s = window.__TONFANS_STATE__ || {};
        const rem = s.mintedRemaining;
        if (rem === 0) {
          toast("Mint limit reached (3 per wallet)", "error");
        } else if (rem != null && rem < MAX_QTY) {
          toast(`Only ${rem}/3 remaining.`, "info");
        }
        return;
      }
      
      setQty(getQty() + 1);
      render(window.__TONFANS_STATE__ || {});
    }, { capture: true });

    // qty input support
    if (els.qty && ("value" in els.qty)) els.qty.addEventListener("input", (e) => {
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      setQty(getQty());
      render(window.__TONFANS_STATE__ || {});
    }, { capture: true });

    // connect/disconnect buttons
    if (els.connectBtn) els.connectBtn.addEventListener("click", (e) => {
      e.preventDefault();
      mintApi()?.toggleConnect?.().catch(()=>{});
    });
    if (els.disconnectBtn) els.disconnectBtn.addEventListener("click", (e) => {
      e.preventDefault();
      mintApi()?.toggleConnect?.().catch(()=>{});
    });

    // mint main button
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

    // sticky action button
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

    // sticky change tier button
    if (els.stickyChangeBtn) els.stickyChangeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      location.hash = "#tiers";
      try { document.getElementById("tiers")?.scrollIntoView({ behavior: "smooth" }); } catch {}
    });

    // listen for toast events from mint.js
    window.addEventListener("tonfans:toast", (e) => {
      try { toast(e?.detail?.message, e?.detail?.kind || "info"); } catch {}
    });

    // listen for qty change events from mint.js
    window.addEventListener("tonfans:qty", (e) => {
      try {
        const q = Number(e?.detail?.qty);
        if (Number.isFinite(q)) {
          setQty(q);
          render(window.__TONFANS_STATE__ || {});
        }
      } catch {}
    });

    // listen for supply update events from mint.js
    window.addEventListener("tonfans:supply", (e) => {
      try {
        const s = window.__TONFANS_STATE__ || {};
        const supplyData = e.detail;
        
        // Update state with new supply data
        s.itemsAvailable = supplyData.itemsAvailable;
        s.itemsRedeemed = supplyData.itemsRedeemed;
        s.itemsRemaining = supplyData.itemsRemaining;
        
        // Update UI
        updateSupplyUI(s);
      } catch (err) {
        console.error("[TONFANS] Error updating supply:", err);
      }
    });

    // listen for state updates from mint.js
    window.addEventListener("tonfans:state", (e) => {
      try {
        render(e.detail);
      } catch (err) {
        console.error("[TONFANS] Error rendering state:", err);
      }
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
      hint: "",
      hintKind: "info",
      mintedCount: null,
      mintedRemaining: null,
      itemsAvailable: null,
      itemsRedeemed: null,
      itemsRemaining: null,
      lastTxSignature: null,
      lastTxExplorerUrl: null,
    };
    window.__TONFANS_STATE__ = init;
    render(init);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
