// assets/js/ui.js (v23) — TON Fans UI for your index.html
// Fixes:
// - Progress bar всегда виден (даже без данных)
// - Supply pills всегда обновляются
// - Tier сохраняется в localStorage при первом выборе
// - PRO-LEVEL UX: кнопка Mint активна при remaining=0 (только toast)
// - Топовая фича: список последних транзакций
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
    
    // После минта
    afterMintSection: $("afterMintSection"),
    shareOnX: $("shareOnX"),
    recentTxsContainer: $("recentTxsContainer"),
    copyTxBtn: $("copyTxBtn"),
  };

  const tierCards = () => Array.from(document.querySelectorAll(".tier-card[data-tier]"));

  function setHidden(el, hidden){ 
    if (el) el.classList.toggle("hidden", !!hidden); 
  }
  
  function setText(el, v){ 
    if (el) el.textContent = v == null ? "" : String(v); 
  }

  function fmtSol(n){
    if (n == null || !Number.isFinite(Number(n))) return "—";
    const x = Number(n);

    const milli = Math.round(x * 1000);
    const rounded3 = milli / 1000;

    if (milli % 10 === 0) return rounded3.toFixed(2);
    return rounded3.toFixed(3);
  }

  function getMaxQty(s){
    const limRaw = (s && s.mintLimit != null) ? Number(s.mintLimit) : 3;
    const lim = (Number.isFinite(limRaw) && limRaw > 0) ? Math.floor(limRaw) : 3;
    return Math.max(1, lim);
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
    const maxQ = getMaxQty(window.__TONFANS_STATE__ || {});
    if (q > maxQ) q = maxQ;

    if ("value" in els.qty) {
      els.qty.value = String(q);
      els.qty.setAttribute("min","1");
      els.qty.setAttribute("max", String(maxQ));
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

  // PRO-LEVEL UX: проверяем только базовые условия
  function canMint(s){
    // ТОЛЬКО: подключен кошелёк, тир готов, не занят
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
        mintedLineEl.textContent = 'Minted: —/—';
        els.mintBtn.insertAdjacentElement("afterend", mintedLineEl);
      }
    }
  }

  // Supply UI elements
  let supplyMintedPill = null;
  let supplyRemainPill = null;
  let supplyProgressBar = null;

  function ensureSupplyElements(){
    // Создаём элементы если их нет
    if (!supplyMintedPill) {
      supplyMintedPill = document.getElementById("supplyMintedPill");
      if (!supplyMintedPill) {
        const container = document.querySelector('.supply-container') || document.querySelector('.text-xs.text-neutral-400.mt-4');
        if (container) {
          supplyMintedPill = document.createElement("div");
          supplyMintedPill.id = "supplyMintedPill";
          supplyMintedPill.className = "mb-1";
          supplyMintedPill.textContent = "Supply: —/— minted";
          container.appendChild(supplyMintedPill);
        }
      }
    }
    
    if (!supplyRemainPill) {
      supplyRemainPill = document.getElementById("supplyRemainPill");
      if (!supplyRemainPill && supplyMintedPill) {
        supplyRemainPill = document.createElement("div");
        supplyRemainPill.id = "supplyRemainPill";
        supplyRemainPill.className = "mb-2";
        supplyRemainPill.textContent = "Supply remaining: —";
        supplyMintedPill.parentNode.appendChild(supplyRemainPill);
      }
    }
    
    if (!supplyProgressBar) {
      supplyProgressBar = document.getElementById("supplyProgressBar");
      if (!supplyProgressBar && supplyRemainPill) {
        supplyProgressBar = document.createElement("div");
        supplyProgressBar.id = "supplyProgressBar";
        supplyProgressBar.className = "mt-2";
        supplyRemainPill.parentNode.appendChild(supplyProgressBar);
      }
    }
  }

  function updateSupplyUI(s){
    ensureSupplyElements();
    
    // ВАЖНО: Всегда обновляем, даже если данные null
    const total = s.itemsAvailable;
    const redeemed = s.itemsRedeemed;
    
    if (supplyMintedPill) {
      if (total != null && redeemed != null) {
        supplyMintedPill.textContent = `Supply: ${redeemed}/${total} minted`;
        supplyMintedPill.style.opacity = "1";
      } else {
        supplyMintedPill.textContent = `Supply: —/— minted`;
        supplyMintedPill.style.opacity = "0.7";
      }
    }
    
    if (supplyRemainPill) {
      if (total != null && redeemed != null) {
        const remaining = s.itemsRemaining != null ? s.itemsRemaining : Math.max(0, total - redeemed);
        supplyRemainPill.textContent = `Supply remaining: ${remaining}`;
        supplyRemainPill.style.opacity = "1";
      } else {
        supplyRemainPill.textContent = `Supply remaining: —`;
        supplyRemainPill.style.opacity = "0.7";
      }
    }
    
    if (supplyProgressBar) {
      if (total != null && redeemed != null && total > 0) {
        const pct = Math.max(0, Math.min(100, (redeemed / total) * 100));
        
        // Создаём прогресс-бар если его нет
        let barFill = supplyProgressBar.querySelector('.progress-bar-fill');
        let barText = supplyProgressBar.querySelector('.progress-bar-text');
        
        if (!barFill) {
          // Создаём текст
          barText = document.createElement("div");
          barText.className = "progress-bar-text text-xs text-neutral-500 mb-1 flex justify-between";
          barText.innerHTML = `<span>Progress</span><span>${redeemed} / ${total}</span>`;
          supplyProgressBar.appendChild(barText);
          
          // Создаём контейнер для полоски
          const barContainer = document.createElement("div");
          barContainer.style.height = "6px";
          barContainer.style.borderRadius = "999px";
          barContainer.style.background = "rgba(255,255,255,.10)";
          barContainer.style.overflow = "hidden";
          
          barFill = document.createElement("div");
          barFill.className = "progress-bar-fill";
          barFill.style.height = "100%";
          barFill.style.width = "0%";
          barFill.style.borderRadius = "999px";
          barFill.style.background = "linear-gradient(90deg, rgba(120,255,180,0.9) 0%, rgba(100,200,255,0.9) 100%)";
          barFill.style.transition = "width .35s ease";
          
          barContainer.appendChild(barFill);
          supplyProgressBar.appendChild(barContainer);
        }
        
        // Обновляем
        if (barFill) barFill.style.width = `${pct}%`;
        if (barText) barText.innerHTML = `<span>Progress</span><span>${redeemed} / ${total}</span>`;
        
        supplyProgressBar.style.display = "block";
      } else {
        // Показываем скелетон
        supplyProgressBar.innerHTML = `
          <div class="text-xs text-neutral-500 mb-1 flex justify-between">
            <span>Progress</span>
            <span>— / —</span>
          </div>
          <div style="height:6px; border-radius:999px; background:rgba(255,255,255,.05); overflow:hidden;">
            <div style="height:100%; width:0%; border-radius:999px; background:rgba(255,255,255,.1);"></div>
          </div>
        `;
        supplyProgressBar.style.display = "block";
      }
    }
  }

  function syncTotals(){
    const s = window.__TONFANS_STATE__ || {};
    const currentQty = getQty();
    
    if (els.price) setText(els.price, fmtSol(s.priceSol));
    
    const total = (s.priceSol == null) ? null : (Number(s.priceSol) * currentQty);
    if (els.total) setText(els.total, fmtSol(total));
  }

  // ТОПОВАЯ ФИЧА: отображаем последние транзакции
  function updateRecentTransactions(txs){
    if (!els.recentTxsContainer) return;
    
    if (!txs || txs.length === 0) {
      els.recentTxsContainer.innerHTML = `
        <div class="text-xs text-neutral-500 italic">
          No recent transactions
        </div>
      `;
      return;
    }
    
    let html = '<div class="space-y-2">';
    
    txs.forEach((tx, idx) => {
      html += `
        <div class="flex items-center justify-between text-xs">
          <div class="flex items-center gap-2">
            <span class="text-neutral-400">Tx ${idx + 1}</span>
            <span class="font-mono text-neutral-300">${tx.shortSig}</span>
          </div>
          <div class="flex gap-2">
            <a href="${tx.explorerUrl}" target="_blank" 
               class="px-2 py-1 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 rounded text-[10px] font-medium transition">
              View
            </a>
            <button onclick="window.TONFANS?.mint?.copyTxSignature('${tx.signature}')"
                    class="px-2 py-1 bg-white/10 hover:bg-white/20 border border-white/20 rounded text-[10px] font-medium transition">
              Copy
            </button>
          </div>
        </div>
      `;
    });
    
    html += '</div>';
    els.recentTxsContainer.innerHTML = html;
  }

  function normalizeTxs(raw){
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const x of raw){
      if (!x) continue;
      if (typeof x === "string") {
        const sig = x;
        if (sig.length < 12) continue;
        out.push({"signature":sig});
        continue;
      }
      if (typeof x === "object") {
        const sig = x.signature || x.sig || x.tx || null;
        if (typeof sig !== "string" || sig.length < 12) continue;
        const shortSig = x.shortSig || (sig.slice(0,8) + "…" + sig.slice(-8));
        const explorerUrl = x.explorerUrl || `https://solscan.io/tx/${sig}${(window.__TONFANS_STATE__?.cluster === 'devnet') ? '?cluster=devnet' : ''}`;
        out.push({
          signature: sig,
          shortSig,
          explorerUrl,
          timestamp: Number(x.timestamp)||null,
        });
      }
    }
    // limit
    return out.slice(0, 10);
  }

  function updateAfterMintUI(s){
    if (!els.afterMintSection) return;

    const last = s.lastMint || null;
    const ok = !!(last && last.ok && typeof last.signature === "string" && last.signature.length > 12);

    // Engineering elegance (Woz): allow dismissing the success panel without breaking verification.
    // Dismissal is session-only and is tied to the specific mint signature.
    const dismissKey = "tonfans:afterMintDismissed";
    const dismissedSig = (typeof sessionStorage !== "undefined") ? sessionStorage.getItem(dismissKey) : null;
    const isDismissed = ok && dismissedSig === last.signature;

    // Inject a small × button once (no HTML edits required)
    if (ok) {
      const header = els.afterMintSection.querySelector('.text-sm.font-medium');
      if (header && !header.querySelector('[data-action="dismiss-after-mint"]')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Dismiss');
        btn.setAttribute('title', 'Dismiss');
        btn.dataset.action = 'dismiss-after-mint';
        btn.textContent = '×';
        // minimal Jobs-like styling
        btn.style.marginLeft = 'auto';
        btn.style.width = '28px';
        btn.style.height = '28px';
        btn.style.borderRadius = '10px';
        btn.style.border = '1px solid rgba(255,255,255,0.14)';
        btn.style.background = 'rgba(0,0,0,0.35)';
        btn.style.color = 'rgba(255,255,255,0.8)';
        btn.style.fontSize = '18px';
        btn.style.lineHeight = '26px';
        btn.style.cursor = 'pointer';
        btn.style.flexShrink = '0';
        btn.addEventListener('click', () => {
          try { sessionStorage.setItem(dismissKey, String(last.signature)); } catch (_) {}
          setHidden(els.afterMintSection, true);
        });
        header.appendChild(btn);
      }
    }

    // показываем блок ТОЛЬКО после реального успешного минта в этой сессии
    setHidden(els.afterMintSection, !ok || isDismissed);

    if (!ok || isDismissed) return;

    // Share on X (only when ok)
    if (els.shareOnX){
      setHidden(els.shareOnX, false);
      const tierName = last.tierLabel || s.tierLabel || "TON Fans NFT";
      const txSig = last.signature;
      const clusterParam = (s.cluster === "devnet") ? "?cluster=devnet" : "";
      const shareText = `Just minted ${tierName} on @ton_fans! https://solscan.io/tx/${txSig}${clusterParam}`;
      els.shareOnX.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
      els.shareOnX.target = "_blank";
    }

    // Recent transactions: show last mint txs first
    const txs = Array.isArray(last.signatures) && last.signatures.length
      ? last.signatures.map((sig) => ({
          signature: sig,
          shortSig: sig.slice(0,8) + "…" + sig.slice(-8),
          explorerUrl: `https://solscan.io/tx/${sig}${(s.cluster === 'devnet') ? '?cluster=devnet' : ''}`
        }))
      : normalizeTxs(s.recentTxSignatures);

    updateRecentTransactions(txs);
  }

  function render(s){
    window.__TONFANS_STATE__ = s;

    ensureExtraEls();
    
    // ВСЕГДА обновляем supply UI
    updateSupplyUI(s);

    // minted / remaining
    const minted = s.mintedCount !== null ? Number(s.mintedCount) : null;
    const remaining = s.mintedRemaining !== null ? Number(s.mintedRemaining) : null;

    if (mintedLineEl) {const lim = (s && s.mintLimit != null) ? Number(s.mintLimit) : 3; mintedLineEl.textContent = `Minted: ${(minted == null ? '—' : minted)}/${lim}`;}
    if (qtyRemainingEl) {const lim = (s && s.mintLimit != null) ? Number(s.mintLimit) : 3; qtyRemainingEl.textContent = `Remaining: ${(remaining == null ? '—' : remaining)}/${lim}`;}

    syncTotals();

    // Top pills
    if (els.netPill) setText(els.netPill, s.cluster === "devnet" ? "Devnet" : (s.cluster || "—"));
    if (els.walletPill) setText(els.walletPill, s.walletConnected ? (s.walletShort || "Connected") : "Not connected");
    if (els.readyPill) setText(els.readyPill, (s.ready && s.walletConnected) ? "Yes" : "No");

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
    );    // Ready micro-copy (components.css): use ready-pop / ready-hide
    if (els.tierReady) {
      // ensure element participates in transitions
      els.tierReady.classList.remove('hidden');
      els.tierReady.classList.remove('ready-pop','ready-hide');
      if (s.ready && s.walletConnected) {
        els.tierReady.classList.add('ready-pop');
      } else {
        els.tierReady.classList.add('ready-hide');
      }
    }
    highlightTier(s.tierRaw);
    // Sticky bar (Apple-grade, animated via assets/css/components.css)
    if (els.stickyMintBar) {
      const show = !!s.tierRaw;
      document.body.classList.toggle('has-sticky', show);

      if (show) {
        els.stickyMintBar.classList.remove('sticky-suppressed');
        setHidden(els.stickyMintBar, false);
        setText(els.stickySelected, s.tierLabel || '—');
        // animate in
        requestAnimationFrame(() => {
          els.stickyMintBar.classList.add('sticky-in');
        });
      } else {
        els.stickyMintBar.classList.remove('sticky-in');
        els.stickyMintBar.classList.add('sticky-suppressed');
        // hide after transition so it doesn't steal clicks
        setTimeout(() => {
          setHidden(els.stickyMintBar, true);
        }, 240);
      }
    }

    // Quantity buttons - четкая логика блокировки
    const currentQty = getQty();

    // Определяем, есть ли вообще возможность минтить
    const canMintMore = remaining === null || remaining > 0;

    if (els.qtyMinus) {
      const atMin = currentQty <= 1;
      // Минус отключаем если: достигнут минимум ИЛИ нельзя минтить вообще
      const dis = atMin || !canMintMore;
      els.qtyMinus.disabled = dis;
      els.qtyMinus.style.opacity = dis ? '.55' : '1';
      els.qtyMinus.style.cursor = dis ? 'not-allowed' : 'pointer';
    }

    if (els.qtyPlus) {
      const maxQ = getMaxQty(s);
      const maxInc = (remaining == null) ? maxQ : Math.max(1, Math.min(maxQ, remaining));
      const atMax = currentQty >= maxInc;
      // Плюс отключаем если: достигнут максимум ИЛИ нельзя минтить вообще
      const dis = atMax || !canMintMore;
      els.qtyPlus.disabled = dis;
      els.qtyPlus.style.opacity = dis ? '.55' : '1';
      els.qtyPlus.style.cursor = dis ? 'not-allowed' : 'pointer';

      // Сохраняем данные для обработчика
      els.qtyPlus.dataset.canMintMore = String(canMintMore);
      els.qtyPlus.dataset.remaining = String(remaining);
    }

    // Apple-grade UX: when limit reached → button clearly says so (still clickable for info)
    if (els.mintBtn){
      const ok = canMint(s);
      const limitReached = remaining === 0;

      // Keep clickable so we can show a toast (disabled buttons don't fire click)
      els.mintBtn.disabled = !ok;
      els.mintBtn.setAttribute("aria-disabled", (!ok || limitReached) ? "true" : "false");
      els.mintBtn.dataset.mode = limitReached ? "limit" : "mint";

      if (limitReached) {
        // Looks disabled, behaves like an info button
        els.mintBtn.style.opacity = "0.62";
        els.mintBtn.style.cursor = ok ? "help" : "not-allowed";
        els.mintBtn.title = "Mint limit reached (click for info)";
      } else {
        els.mintBtn.style.opacity = ok ? "1" : ".55";
        els.mintBtn.style.cursor = ok ? "pointer" : "not-allowed";
        els.mintBtn.title = "";
      }

      const bypassArmed = !!(s.limitCheckBypassUntil && Date.now() < s.limitCheckBypassUntil);
      els.mintBtn.textContent = s.busy
        ? (s.busyLabel || "Working…")
        : (limitReached ? "Limit reached" : (bypassArmed ? "Mint anyway" : "Mint now"));
    }

    // Sticky action button (Apple-grade)
    if (els.stickyActionBtn){
      if (!s.walletConnected) {
        els.stickyActionBtn.textContent = "Connect";
        els.stickyActionBtn.disabled = false;
        els.stickyActionBtn.style.opacity = "1";
        els.stickyActionBtn.style.cursor = "pointer";
        els.stickyActionBtn.dataset.mode = "connect";
      } else {
        const okSticky = canMint(s);
        const limitReached = remaining === 0;

        // Keep clickable for toast when limit reached
        els.stickyActionBtn.disabled = !okSticky;
        els.stickyActionBtn.setAttribute("aria-disabled", (!okSticky || limitReached) ? "true" : "false");
        els.stickyActionBtn.dataset.mode = limitReached ? "limit" : "mint";

        const bypassArmed = !!(s.limitCheckBypassUntil && Date.now() < s.limitCheckBypassUntil);
        els.stickyActionBtn.textContent = limitReached ? "Limit" : (bypassArmed ? "Mint anyway" : "Mint");
        els.stickyActionBtn.style.opacity = limitReached ? "0.62" : (okSticky ? "1" : ".55");
        els.stickyActionBtn.style.cursor = okSticky ? (limitReached ? "help" : "pointer") : "not-allowed";
        els.stickyActionBtn.title = limitReached ? "Mint limit reached" : "";
      }
    }

    // Hint
    if (els.mintHint){
      const prefix = s.hintKind === "error" ? "Error: " : "";
      setText(els.mintHint, `${prefix}${s.hint || ""}`.trim());
    }

    // Help link
    if (els.mintHelp){
      els.mintHelp.textContent = s.tierRaw ? "Change tier →" : "Set CM address →";
      els.mintHelp.href = s.tierRaw ? "#tiers" : "#transparency";
    }

    // После минта
    updateAfterMintUI(s);
  }

  function mintApi(){ return window.TONFANS?.mint; }

  async function ensureConnected(api){
    const s0 = window.__TONFANS_STATE__ || {};
    if (s0.walletConnected) return true;
    try {
      await api?.toggleConnect?.();
    } catch (e) {
      toast(e?.message || "Wallet connect cancelled", "error");
      return false;
    }
    const t0 = Date.now();
    while (Date.now() - t0 < 12000){
      const s = window.__TONFANS_STATE__ || {};
      if (s.walletConnected) return true;
      await new Promise(r => setTimeout(r, 120));
    }
    toast("Wallet not connected. Open wallet and approve.", "error");
    return false;
  }

  async function onTier(card){
    const tierRaw = card.getAttribute("data-tier");
    if (!tierRaw) return;
    
    highlightTier(tierRaw);
    
    // ВАЖНО: Сохраняем tier ДАЖЕ при первом выборе
    try {
      localStorage.setItem("tonfans:tier", tierRaw);
    } catch {}
    
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
        const rem = s.mintedRemaining;
        if (rem === 0) {
          toast(`❌ Mint limit reached (${getMaxQty(window.__TONFANS_STATE__||{})} per wallet)`, 'error');
        } else if (rem != null && rem < getMaxQty(s)) {
          const lim = getMaxQty(s);
          toast(`📊 Only ${rem}/${lim} remaining.`, "info");
        } else if (!els.qtyPlus.dataset.canMintMore || els.qtyPlus.dataset.canMintMore === "false") {
          toast("⚠️ Cannot increase quantity", "error");
        }
        return;
      }

      setQty(getQty() + 1);
      render(window.__TONFANS_STATE__ || {});
    }, { capture: true });

    // qty input
    if (els.qty && ("value" in els.qty)) els.qty.addEventListener("input", (e) => {
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      setQty(getQty());
      render(window.__TONFANS_STATE__ || {});
    }, { capture: true });

    // connect/disconnect
    if (els.connectBtn) els.connectBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      const api = mintApi();
      if (!api) return;
      try {
        await api.toggleConnect?.();
      } catch (err) {
        toast(err?.message || "Wallet connect cancelled", "error");
      }
    });
    if (els.disconnectBtn) els.disconnectBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      const api = mintApi();
      if (!api) return;
      try {
        await api.toggleConnect?.();
      } catch (err) {
        toast(err?.message || "Wallet disconnect failed", "error");
      }
    });

    // PRO-LEVEL UX: обработка клика на Mint
    if (els.mintBtn) els.mintBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();

      const s = window.__TONFANS_STATE__ || {};
      const api = mintApi();
      if (!api) return;

      // If wallet not connected: connect + continue mint in one flow (mobile-friendly)
      if (!s.walletConnected) {
        const ok = await ensureConnected(api);
        if (!ok) return;
      }

      const ss = window.__TONFANS_STATE__ || {};
      const remaining = ss.mintedRemaining;
      if (remaining === 0) {
        const limRaw = (ss.mintLimit != null) ? Number(ss.mintLimit) : 3;
        const lim = Number.isFinite(limRaw) && limRaw > 0 ? Math.floor(limRaw) : 3;
        toast(`Mint limit reached (${lim} per wallet). No transaction will be sent.`, "info");
        return;
      }

      try {
        await api.mintNow?.(getQty());
      } catch (err) {
        // errors are surfaced via mint.js toast/hint
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
        // If wallet not connected: connect + continue mint in one flow (mobile-friendly)
        if (!s.walletConnected) {
          const ok = await ensureConnected(api);
          if (!ok) return;
        }

        const ss = window.__TONFANS_STATE__ || {};
        // PRO-LEVEL UX: проверка лимита для sticky кнопки
        const remaining = ss.mintedRemaining;
        if (remaining === 0) {
          const limRaw = (ss.mintLimit != null) ? Number(ss.mintLimit) : 3;
          const lim = Number.isFinite(limRaw) && limRaw > 0 ? Math.floor(limRaw) : 3;
          toast(`Mint limit reached (${lim} per wallet). No transaction will be sent.`, "info");
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

    // События
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

    window.addEventListener("tonfans:supply", (e) => {
      try {
        const s = window.__TONFANS_STATE__ || {};
        const supplyData = e.detail;
        
        s.itemsAvailable = supplyData.itemsAvailable;
        s.itemsRedeemed = supplyData.itemsRedeemed;
        s.itemsRemaining = supplyData.itemsRemaining;
        
        updateSupplyUI(s);
      } catch (err) {
        console.error("[TONFANS] Error updating supply:", err);
      }
    });

    window.addEventListener("tonfans:state", (e) => {
      try {
        render(e.detail);
      } catch (err) {
        console.error("[TONFANS] Error rendering state:", err);
      }
    });
  }

  // ВАЖНО: Безопасная инициализация с автоматическим выбором тира
  function safeInitial(){
    // 1) Determine tier (saved -> first card)
    let savedTier = null;
    try { savedTier = localStorage.getItem("tonfans:tier"); } catch {}

    let useTier = savedTier;
    const cards = tierCards();
    if (!useTier && cards.length > 0) {
      useTier = cards[0].getAttribute("data-tier");
      try { if (useTier) localStorage.setItem("tonfans:tier", useTier); } catch {}
    }

    if (useTier) {
      highlightTier(useTier);

      // 2) Call mint API when it becomes available (mint.js may load after ui.js)
      const start = Date.now();
      const tryBind = () => {
        const api = mintApi();
        if (api && typeof api.setTier === 'function') {
          api.setTier(useTier).catch(()=>{});
          return true;
        }
        // retry for up to ~5s
        if (Date.now() - start < 5000) {
          setTimeout(tryBind, 120);
        }
        return false;
      };
      setTimeout(tryBind, 0);
    }

    // default qty
    setQty(1);
  }

  function boot(){
    bind();
    safeInitial(); // ВАЖНО: вызываем ДО render
    
    const init = {
      cluster: (new URLSearchParams(location.search).get("cluster") || "devnet"),
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
      recentTxSignatures: [],
    };
    window.__TONFANS_STATE__ = init;
    render(init);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
