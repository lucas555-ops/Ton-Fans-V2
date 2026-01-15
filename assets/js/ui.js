// assets/js/ui.js
// TON FANS — UI glue (no conflict, defensive, works with different HTML layouts).
// Requires mint.js (window.TonFansMint).
//
// Load order:
//   <script type="module" src="assets/js/mint.js?v=5"></script>
//   <script src="assets/js/ui.js?v=5"></script>

(function () {
  "use strict";

  // ---------- Helpers ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function firstEl(selectors) {
    for (const s of selectors) {
      const el = $(s);
      if (el) return el;
    }
    return null;
  }

  function setText(el, text) {
    if (!el) return;
    el.textContent = (text == null ? "" : String(text));
  }

  function setHtml(el, html) {
    if (!el) return;
    el.innerHTML = html;
  }

  function setDisabled(el, disabled) {
    if (!el) return;
    if ("disabled" in el) el.disabled = !!disabled;
    el.setAttribute("aria-disabled", disabled ? "true" : "false");
    el.classList.toggle("is-disabled", !!disabled);
  }

  function formatSol(v) {
    if (v == null || !Number.isFinite(Number(v))) return "—";
    // Show up to 3 decimals, but keep clean.
    const n = Number(v);
    if (n === 0) return "0";
    if (n < 0.001) return n.toFixed(6);
    if (n < 1) return n.toFixed(3);
    return n.toFixed(2);
  }

  function toast(msg, kind) {
    // Minimal safe toast. If your site already has a toast system, we won't fight it.
    try {
      const existing = $("#tonfans-toast");
      if (existing) existing.remove();

      const div = document.createElement("div");
      div.id = "tonfans-toast";
      div.textContent = String(msg || "");
      div.style.position = "fixed";
      div.style.left = "50%";
      div.style.bottom = "24px";
      div.style.transform = "translateX(-50%)";
      div.style.zIndex = "99999";
      div.style.padding = "10px 14px";
      div.style.borderRadius = "12px";
      div.style.maxWidth = "92vw";
      div.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      div.style.fontSize = "14px";
      div.style.lineHeight = "1.25";
      div.style.backdropFilter = "blur(10px)";
      div.style.background = kind === "error" ? "rgba(180, 40, 40, .88)" : "rgba(20, 20, 20, .88)";
      div.style.color = "white";
      div.style.boxShadow = "0 12px 40px rgba(0,0,0,.35)";
      document.body.appendChild(div);
      setTimeout(() => { try { div.remove(); } catch {} }, 2600);
    } catch {}
  }

  // ---------- Element bindings (multiple fallbacks) ----------
  const els = {
    selectedTier: firstEl(["#selectedTier", "[data-selected-tier]", ".selected-tier", "#tierSelectedText"]),
    ready: firstEl(["#readyText", "[data-ready]", ".ready-text", "#mintReady"]),
    price: firstEl(["#priceValue", "[data-price]", ".price-value", "#mintPrice"]),
    total: firstEl(["#totalValue", "[data-total]", ".total-value", "#mintTotal"]),
    supply: firstEl(["#supplyText", "[data-supply]", ".supply-text", "#mintSupply"]),
    status: firstEl(["#statusText", "[data-status]", ".status-text", "#mintStatus"]),
    walletLabel: firstEl(["#walletText", "[data-wallet]", ".wallet-text", "#walletLabel"]),
    connectBtn: firstEl(["#connectBtn", "#connectWallet", ".connect-wallet", "[data-action='connect']"]),
    mintBtn: firstEl(["#mintBtn", "#mintNow", ".mint-now", "[data-action='mint']", "[data-mint]"]),
    qty: firstEl(["#mintQty", "input[name='qty']", "[data-mint-qty]"]),
    stickyBar: firstEl(["#stickyBar", ".sticky-bar", "[data-sticky-bar]"]),
    stickyChangeTier: firstEl(["#changeTier", "#changeTierBtn", ".change-tier", "[data-action='change-tier']"]),
  };

  const tierButtons = () => $all("[data-tier]");
  const tierSection = () => firstEl(["#tiers", "#tier", "#tierSection", "[data-tiers]", ".tiers", ".tier-section"]) || document.body;

  function highlightTier(tier) {
    for (const b of tierButtons()) {
      const t = b.getAttribute("data-tier");
      const on = (t === tier);
      b.classList.toggle("active", on);
      b.classList.toggle("is-active", on);
      b.classList.toggle("selected", on);
      b.classList.toggle("is-selected", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
      if (on) b.setAttribute("data-selected", "true"); else b.removeAttribute("data-selected");
    }
  }

  function computeQty() {
    const v = els.qty ? Number(els.qty.value || 1) : 1;
    if (!Number.isFinite(v) || v <= 0) return 1;
    return Math.min(10, Math.floor(v));
  }

  function updateFromState(s) {
    if (!s) return;

    // Selected tier
    setText(els.selectedTier, s.selectedTier || "—");
    highlightTier(s.selectedTier);

    // Wallet label
    if (els.walletLabel) {
      setText(els.walletLabel, s.wallet?.connected ? s.wallet.short : "Not connected");
    }
    if (els.connectBtn) {
      els.connectBtn.textContent = s.wallet?.connected ? "Connected" : "Connect wallet";
      els.connectBtn.classList.toggle("is-connected", !!s.wallet?.connected);
    }

    // Ready
    const readyText = s.readiness?.ready ? "Ready Yes" : "Ready No";
    setText(els.ready, readyText);

    // Supply
    if (els.supply) {
      const rem = s.supply?.remaining;
      const av = s.supply?.available;
      const rd = s.supply?.redeemed;
      if (rem == null || av == null || rd == null) setText(els.supply, "");
      else setText(els.supply, `${rem} left • ${rd}/${av} minted`);
    }

    // Price + total
    const qty = computeQty();
    const priceSol = s.pricing?.priceSol;
    setText(els.price, `${formatSol(priceSol)} SOL`);
    if (els.total) {
      const total = (priceSol == null || !Number.isFinite(Number(priceSol))) ? null : (Number(priceSol) * qty);
      setText(els.total, `${formatSol(total)} SOL`);
    }

    // Status
    if (els.status) {
      const msg = s.ui?.message || "";
      setText(els.status, msg);
    }

    // Mint button enable/disable
    const canMint = !!s.wallet?.connected && !!s.readiness?.ready && s.ui?.status !== "minting";
    setDisabled(els.mintBtn, !canMint);

    if (els.mintBtn) {
      const base = els.mintBtn.getAttribute("data-base-text") || els.mintBtn.textContent || "Mint now";
      if (!els.mintBtn.getAttribute("data-base-text")) els.mintBtn.setAttribute("data-base-text", base);

      if (s.ui?.status === "minting") els.mintBtn.textContent = "Minting…";
      else els.mintBtn.textContent = base;
    }
  }

  // ---------- Bind interactions ----------
  function bindTierButtons() {
    for (const b of tierButtons()) {
      b.addEventListener("click", async (e) => {
        const tier = b.getAttribute("data-tier");
        if (!tier) return;
        e.preventDefault();
        e.stopImmediatePropagation?.();

        if (window.TonFansMint?.selectTier) {
          await window.TonFansMint.selectTier(tier);
        }
      }, { capture: true });
    }
  }

  function bindQty() {
    if (!els.qty) return;
    els.qty.addEventListener("input", () => {
      const s = window.TonFansMint?.getState?.();
      if (s) updateFromState(s);
    });
  }

  function bindConnect() {
    if (!els.connectBtn) return;
    els.connectBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopImmediatePropagation?.();
      try {
        await window.TonFansMint.connectWallet();
        await window.TonFansMint.refresh();
      } catch (err) {
        toast(err?.message || String(err), "error");
      }
    }, { capture: true });
  }

  function bindMint() {
    if (!els.mintBtn) return;
    els.mintBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopImmediatePropagation?.();
      try {
        const qty = computeQty();
        await window.TonFansMint.mint(qty);
      } catch (err) {
        toast(err?.message || String(err), "error");
      }
    }, { capture: true });
  }

  function bindStickyBar() {
    if (!els.stickyBar) return;

    // show/hide on scroll
    const threshold = 260;
    const update = () => {
      const on = window.scrollY > threshold;
      els.stickyBar.classList.toggle("is-visible", on);
      els.stickyBar.style.display = on ? "" : "none";
    };
    window.addEventListener("scroll", update, { passive: true });
    update();

    if (els.stickyChangeTier) {
      els.stickyChangeTier.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopImmediatePropagation?.();
        try {
          tierSection().scrollIntoView({ behavior: "smooth", block: "start" });
        } catch {
          window.scrollTo(0, 0);
        }
      }, { capture: true });
    }
  }

  // ---------- Boot ----------
  function boot() {
    // If mint.js didn't load yet, wait a bit.
    if (!window.TonFansMint) {
      setTimeout(boot, 120);
      return;
    }

    // Initial paint
    updateFromState(window.TonFansMint.getState());

    // Subscribe
    window.addEventListener("tonfans:state", (e) => {
      updateFromState(e.detail);
      // Toast on errors
      if (e.detail?.ui?.status === "error" && e.detail?.ui?.message) {
        toast(e.detail.ui.message, "error");
      }
    });

    // Bind UI
    bindTierButtons();
    bindQty();
    bindConnect();
    bindMint();
    bindStickyBar();

    // Re-bind if DOM changes (some templates rebuild pills)
    const mo = new MutationObserver(() => {
      bindTierButtons();
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
