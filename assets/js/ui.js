// assets/js/ui.js (v7)
// TON Fans — UI controller for your current index.html.
// - Fixes underscore tiers (littlegen_diamond / biggen_diamond)
// - Fixes connect/disconnect visibility (Tailwind 'hidden' class)
// - Fixes sticky bar (toggle hidden class)
// - Renders Ready / Price / Total from tonfans:state events
//
// Requires: mint.js exposing window.TONFANS.mint

(() => {
  const $ = (id) => document.getElementById(id);

  const els = {
    netPill: $("netPill"),
    walletPill: $("walletPill"),
    walletAddr: $("walletAddr"),
    walletStatus: $("walletStatus"),
    connectBtn: $("connectBtn"),
    disconnectBtn: $("disconnectBtn"),

    readyPill: $("readyPill"),
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

    stickyMintBar: $("stickyMintBar"),
    stickySelected: $("stickySelected"),
    stickyActionBtn: $("stickyActionBtn"),
    stickyChangeBtn: $("stickyChangeBtn"),

    mintHelp: $("mintHelp"),
  };

  const tierCards = () => Array.from(document.querySelectorAll(".tier-card[data-tier]"));

  const TIER_UI_LABEL = {
    littlegen: "LittlGEN",
    biggen: "BigGEN",
    littlegen_diamond: "LittlGEN Diamond",
    biggen_diamond: "BigGEN Diamond",
    "littlegen-diamond": "LittlGEN Diamond",
    "biggen-diamond": "BigGEN Diamond",
  };

  function setHidden(el, hidden) {
    if (!el) return;
    el.classList.toggle("hidden", !!hidden);
  }

  function setText(el, v) {
    if (!el) return;
    el.textContent = v == null ? "" : String(v);
  }

  function fmt(n) {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    const x = Number(n);
    if (x === 0) return "0";
    if (x < 1) return x.toFixed(2);
    return x.toFixed(2);
  }

  function getQty() {
    const v = Number(els.qty?.value || 1);
    if (!Number.isFinite(v) || v <= 0) return 1;
    return Math.floor(v);
  }

  function clampQty(max) {
    if (!els.qty) return;
    let q = getQty();
    if (max && q > max) q = max;
    if (q < 1) q = 1;
    els.qty.value = String(q);
  }

  function highlightTier(tierRaw) {
    for (const c of tierCards()) {
      const t = c.getAttribute("data-tier");
      const on = t === tierRaw;
      c.classList.toggle("tier-selected", on);
      c.setAttribute("aria-selected", on ? "true" : "false");
    }
  }

  function showSticky(show) {
    if (!els.stickyMintBar) return;
    setHidden(els.stickyMintBar, !show);
  }

  function updateActionButtons(s) {
    // main connect/disconnect buttons
    if (s.walletConnected) {
      setHidden(els.connectBtn, true);
      setHidden(els.disconnectBtn, false);
    } else {
      setHidden(els.connectBtn, false);
      setHidden(els.disconnectBtn, true);
    }

    // sticky action
    if (!els.stickyActionBtn) return;

    if (!s.walletConnected) {
      els.stickyActionBtn.textContent = "Connect";
    } else if (s.ready) {
      els.stickyActionBtn.textContent = "Mint";
    } else {
      els.stickyActionBtn.textContent = "Prepare";
    }
  }

  function renderState(s) {
    // Network pill
    setText(els.netPill, `Network ${s.cluster === "devnet" ? "Devnet" : s.cluster}`);

    // Wallet pill + wallet card
    if (s.walletConnected) {
      setText(els.walletPill, `Wallet: ${s.walletShort || "Connected"}`);
      setText(els.walletAddr, s.walletShort || "");
      setText(els.walletStatus, "Connected");
    } else {
      setText(els.walletPill, "Wallet");
      setText(els.walletAddr, "—");
      setText(els.walletStatus, "Not connected");
    }

    // Selected tier
    setText(els.selectedTierName, s.tierLabel || "—");

    const guardLine = s.guardPk ? `guard: ${String(s.guardPk).slice(0, 4)}…${String(s.guardPk).slice(-4)}${s.guardGroup ? ` (${s.guardGroup})` : ""}` : "guard: —";
    setText(els.selectedTierMeta, guardLine);
    setHidden(els.tierReady, !s.ready);
    highlightTier(s.tierRaw);

    // sticky
    if (s.tierRaw) {
      showSticky(true);
      setText(els.stickySelected, s.tierLabel || TIER_UI_LABEL[s.tierRaw] || "—");
    } else {
      showSticky(false);
    }

    // qty limits
    clampQty(s.mintLimit || 3);

    // price / total
    const q = getQty();
    setText(els.price, fmt(s.priceSol));
    const total = (s.priceSol == null) ? null : (Number(s.priceSol) * q);
    setText(els.total, fmt(total));

    // ready pill + mint button
    setText(els.readyPill, `Ready: ${s.ready ? "Yes" : "No"}`);

    const canMint = !!s.walletConnected && !!s.ready && !s.busy;
    if (els.mintBtn) {
      els.mintBtn.disabled = !canMint;
      els.mintBtn.style.opacity = canMint ? "1" : ".55";
      els.mintBtn.style.cursor = canMint ? "pointer" : "not-allowed";
      els.mintBtn.textContent = s.busy ? (s.busyLabel || "Working…") : "Mint now";
    }

    // hint
    if (els.mintHint) {
      const prefix = s.hintKind === "error" ? "Error: " : (s.hintKind === "ok" ? "" : "Status: ");
      setText(els.mintHint, `${prefix}${s.hint || ""}`.trim());
    }

    updateActionButtons(s);

    // If CM isn't set yet, keep "Set CM address" link as a guide
    if (els.mintHelp) {
      els.mintHelp.textContent = s.tierRaw ? "Change tier →" : "Set CM address →";
      els.mintHelp.href = s.tierRaw ? "#tiers" : "#transparency";
    }
  }

  function getMint() {
    return window.TONFANS?.mint || null;
  }

  async function onTierClick(card) {
    const tierRaw = card.getAttribute("data-tier");
    if (!tierRaw) return;

    highlightTier(tierRaw);
    setText(els.selectedTierName, TIER_UI_LABEL[tierRaw] || tierRaw);
    setText(els.selectedTierMeta, "guard: —");
    showSticky(true);
    setText(els.stickySelected, TIER_UI_LABEL[tierRaw] || tierRaw);

    const mint = getMint();
    if (mint?.setTier) await mint.setTier(tierRaw);
  }

  function bindTierCards() {
    for (const c of tierCards()) {
      c.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onTierClick(c).catch(() => {});
      }, { capture: true });
    }
  }

  function bindQty() {
    if (els.qtyMinus) els.qtyMinus.addEventListener("click", (e) => {
      e.preventDefault();
      const max = window.__TONFANS_STATE__?.mintLimit || 3;
      let q = getQty();
      q = Math.max(1, q - 1);
      els.qty.value = String(q);
      renderState(window.__TONFANS_STATE__ || {});
    });

    if (els.qtyPlus) els.qtyPlus.addEventListener("click", (e) => {
      e.preventDefault();
      const max = window.__TONFANS_STATE__?.mintLimit || 3;
      let q = getQty();
      q = Math.min(max, q + 1);
      els.qty.value = String(q);
      renderState(window.__TONFANS_STATE__ || {});
    });

    if (els.qty) els.qty.addEventListener("input", () => {
      renderState(window.__TONFANS_STATE__ || {});
    });
  }

  function bindConnect() {
    if (els.connectBtn) els.connectBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await getMint()?.toggleConnect?.();
      } catch (err) {
        console.error(err);
      }
    });

    if (els.disconnectBtn) els.disconnectBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await getMint()?.toggleConnect?.();
      } catch (err) {
        console.error(err);
      }
    });

    if (els.stickyActionBtn) els.stickyActionBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      const s = window.__TONFANS_STATE__ || {};
      const mint = getMint();
      if (!mint) return;

      try {
        if (!s.walletConnected) {
          await mint.toggleConnect();
        } else if (s.ready) {
          await mint.mintNow(getQty());
        } else {
          await mint.refresh();
        }
      } catch (err) {
        console.error(err);
      }
    });

    if (els.stickyChangeBtn) els.stickyChangeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      location.hash = "#tiers";
      try { document.getElementById("tiers")?.scrollIntoView({ behavior: "smooth" }); } catch {}
    });
  }

  function bindMint() {
    if (!els.mintBtn) return;
    els.mintBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await getMint()?.mintNow?.(getQty());
      } catch (err) {
        console.error(err);
      }
    });
  }

  function boot() {
    bindTierCards();
    bindQty();
    bindConnect();
    bindMint();

    // default UI state
    const initState = {
      cluster: "devnet",
      walletConnected: false,
      tierRaw: null,
      tierLabel: "—",
      ready: false,
      priceSol: null,
      mintLimit: 3,
      hint: "Select a tier.",
      hintKind: "info",
      busy: false,
      busyLabel: "",
    };
    window.__TONFANS_STATE__ = initState;
    renderState(initState);

    window.addEventListener("tonfans:state", (e) => {
      window.__TONFANS_STATE__ = e.detail;
      renderState(e.detail);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
