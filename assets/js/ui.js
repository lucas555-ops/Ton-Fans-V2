// assets/js/ui.js
(() => {
  const STATE = {
    tier: null,            // 'lgen' | 'bgen' | 'ldia' | 'bdia'
    walletConnected: false,
    walletLabel: "Not connected",
    networkLabel: "—",
    ready: false,
    priceLabel: "—",
  };

  // -------- helpers
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const safeText = (el, t) => { if (el) el.textContent = t; };
  const safeShow = (el, on) => { if (el) el.style.display = on ? "" : "none"; };

  function injectStyles() {
    if ($("#tonfans-ui-style")) return;
    const s = document.createElement("style");
    s.id = "tonfans-ui-style";
    s.textContent = `
      .tonfans-tier-selected{
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
      #tonfans-sticky{
        position: fixed;
        left: 16px;
        right: 16px;
        bottom: 14px;
        z-index: 9999;
        display: none;
      }
      #tonfans-sticky .tf-wrap{
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
      #tonfans-sticky .tf-left{
        flex: 1;
        display:flex;
        flex-direction:column;
        gap:4px;
        min-width: 0;
      }
      #tonfans-sticky .tf-title{
        font-size: 12px;
        opacity: .75;
      }
      #tonfans-sticky .tf-sub{
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #tonfans-sticky button{
        border-radius: 14px;
      }
    `;
    document.head.appendChild(s);
  }

  function ensureSticky() {
    if ($("#tonfans-sticky")) return;

    const wrap = document.createElement("div");
    wrap.id = "tonfans-sticky";
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

    $("#tfStickyConnect").addEventListener("click", () => {
      window.TONFANS?.mint?.toggleConnect?.();
    });
    $("#tfStickyMint").addEventListener("click", () => {
      window.TONFANS?.mint?.mintNow?.();
    });
  }

  // -------- element discovery (не завязано на твои конкретные id)
  function findTopChipValue(labelText) {
    // ищем "Wallet" / "Ready" / "Network" и берем соседний span/div
    const candidates = $$("body *")
      .filter(el => el && el.children && el.children.length >= 2)
      .slice(0, 8000);

    for (const el of candidates) {
      const a = el.children[0];
      const b = el.children[1];
      if (!a || !b) continue;
      const t = (a.textContent || "").trim().toLowerCase();
      if (t === labelText.toLowerCase()) return b;
    }
    return null;
  }

  function findMintButtons() {
    // кнопки "Mint now" на странице
    const btns = $$("button,a").filter(el => /mint now/i.test((el.textContent || "").trim()));
    return btns;
  }

  function findConnectButtons() {
    const btns = $$("button,a").filter(el => {
      const tx = (el.textContent || "").trim().toLowerCase();
      return tx === "connect" || tx.startsWith("connected:") || tx === "disconnect";
    });
    return btns;
  }

  function findTierCards() {
    // 1) если есть data-tier — супер
    let cards = $$("[data-tier]");
    if (cards.length) return cards;

    // 2) fallback: карточки где внутри текст LittlGEN/BigGEN
    const all = $$("div,section,article");
    cards = all.filter(el => {
      const t = (el.textContent || "");
      return /LittlGEN|BigGEN/i.test(t) && el.querySelector("button, a") == null;
    });
    // слишком много? режем
    return cards.slice(0, 12);
  }

  function tierKeyFromCard(el) {
    const dt = el.getAttribute("data-tier");
    if (dt) return dt;

    const t = (el.textContent || "").toLowerCase();
    const isLittle = t.includes("littlgen");
    const isBig = t.includes("biggen");
    const isDiamond = t.includes("diamond");

    if (isLittle && isDiamond) return "ldia";
    if (isBig && isDiamond) return "bdia";
    if (isLittle) return "lgen";
    if (isBig) return "bgen";
    return null;
  }

  // -------- render
  function recomputeReady() {
    STATE.ready = Boolean(STATE.walletConnected && STATE.tier);
  }

  function render() {
    recomputeReady();

    // верхние чипы
    const topWallet = findTopChipValue("Wallet");
    const topReady = findTopChipValue("Ready");
    const topNet = findTopChipValue("Network");

    safeText(topWallet, STATE.walletConnected ? STATE.walletLabel : "Not connected");
    safeText(topReady, STATE.ready ? "Yes" : "No");
    safeText(topNet, STATE.networkLabel || "—");

    // selected tier box (если есть)
    const selTierName = $("#selectedTierName") || $(".selected-tier-name");
    const selGuard = $("#selectedTierGuard") || $(".selected-tier-guard");
    if (selTierName) safeText(selTierName, STATE.tier ? STATE.tier.toUpperCase() : "—");
    if (selGuard) safeText(selGuard, STATE.tier ? "guard: default" : "guard: —");

    // price
    const priceEl = $("#mintPrice") || $("#priceValue") || $(".price-value");
    if (priceEl) safeText(priceEl, STATE.priceLabel || "—");

    // кнопки connect/disconnect
    const connectBtns = findConnectButtons();
    connectBtns.forEach(b => {
      if (!STATE.walletConnected) {
        b.textContent = "Connect";
        b.classList.remove("tonfans-disabled");
      } else {
        // делаем как у тебя было: Connected: ...
        b.textContent = `Connected: ${STATE.walletLabel}`;
        b.classList.remove("tonfans-disabled");
      }
    });

    // mint кнопки
    const mintBtns = findMintButtons();
    mintBtns.forEach(b => {
      if (STATE.ready) b.classList.remove("tonfans-disabled");
      else b.classList.add("tonfans-disabled");
    });

    // sticky line
    const stickyLine = $("#tfStickyLine");
    if (stickyLine) {
      stickyLine.textContent = STATE.walletConnected
        ? (STATE.tier ? `Tier: ${STATE.tier.toUpperCase()} • ${STATE.walletLabel}` : `Select tier • ${STATE.walletLabel}`)
        : "Select tier → Connect → Mint";
    }

    // sticky buttons state
    const stMint = $("#tfStickyMint");
    const stConn = $("#tfStickyConnect");
    if (stConn) stConn.textContent = STATE.walletConnected ? `Connected: ${STATE.walletLabel}` : "Connect";
    if (stMint) {
      if (STATE.ready) stMint.classList.remove("tonfans-disabled");
      else stMint.classList.add("tonfans-disabled");
    }
  }

  // -------- tier selection UI
  function setSelectedTier(tier) {
    STATE.tier = tier;

    const cards = findTierCards();
    cards.forEach(c => c.classList.remove("tonfans-tier-selected"));

    const selected = cards.find(c => tierKeyFromCard(c) === tier);
    if (selected) selected.classList.add("tonfans-tier-selected");

    // сообщаем mint-скрипту
    window.dispatchEvent(new CustomEvent("tonfans:tier", { detail: { tier } }));
    render();
  }

  function wireTierClicks() {
    const cards = findTierCards();
    cards.forEach(card => {
      card.style.cursor = "pointer";
      card.addEventListener("click", () => {
        const tier = tierKeyFromCard(card);
        if (tier) setSelectedTier(tier);
      });
    });
  }

  function wireConnectClicks() {
    // любая "Connect"/"Connected" кнопка будет toggle connect/disconnect
    findConnectButtons().forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        window.TONFANS?.mint?.toggleConnect?.();
      });
    });
  }

  function stickyVisibility() {
    const sticky = $("#tonfans-sticky");
    if (!sticky) return;

    // если есть секция mint — используем её как триггер
    const mintSection = $("#mint") || $("#section-mint") || document.querySelector("section");
    const y = window.scrollY || 0;

    let show = y > 420;
    if (mintSection && mintSection.getBoundingClientRect) {
      const r = mintSection.getBoundingClientRect();
      // когда mint ушёл вверх — показываем
      show = r.top < -80;
    }
    sticky.style.display = show ? "" : "none";
  }

  // -------- external state events from mint.js
  window.addEventListener("tonfans:state", (e) => {
    const d = e.detail || {};
    if (typeof d.walletConnected === "boolean") STATE.walletConnected = d.walletConnected;
    if (typeof d.walletLabel === "string") STATE.walletLabel = d.walletLabel;
    if (typeof d.networkLabel === "string") STATE.networkLabel = d.networkLabel;
    if (typeof d.priceLabel === "string") STATE.priceLabel = d.priceLabel;
    if (typeof d.tier === "string") STATE.tier = d.tier;
    render();
  });

  // -------- init
  function init() {
    injectStyles();
    ensureSticky();
    wireTierClicks();
    wireConnectClicks();
    render();

    window.addEventListener("scroll", stickyVisibility, { passive: true });
    window.addEventListener("resize", stickyVisibility);
    stickyVisibility();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
