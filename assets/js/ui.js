/* TONFANS UI (v6) — sticky bar + tier selection + pills
   Works with index.html that uses:
   data-tier="littlegen|biggen|littlegen_diamond|biggen_diamond"
*/
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const IDS = {
    netPill: "netPill",
    walletPill: "walletPill",
    readyPill: "readyPill",
    walletStatus: "walletStatus",
    walletAddr: "walletAddr",
    connectBtn: "connectBtn",
    disconnectBtn: "disconnectBtn",
    price: "price",
    total: "total",
    mintBtn: "mintBtn",
    mintHint: "mintHint",
    qty: "qty",
    // Selected tier panel
    selectedTierName: "selectedTierName",
    selectedTierMeta: "selectedTierMeta", // (in HTML)
    selectedTierThumb: "selectedTierThumb",
    tierReady: "tierReady",
    // Sticky bar
    stickyMintBar: "stickyMintBar",
    stickySelected: "stickySelected",
    stickyActionBtn: "stickyActionBtn",
    stickyChangeBtn: "stickyChangeBtn",
  };

  const TIER_LABEL = {
    littlegen: "LittlGEN",
    biggen: "BigGEN",
    littlegen_diamond: "LittlGEN Diamond",
    biggen_diamond: "BigGEN Diamond",
    // tolerate hyphen variants (old)
    "littlegen-diamond": "LittlGEN Diamond",
    "biggen-diamond": "BigGEN Diamond",
  };

  const TIER_PRICE = {
    littlegen: "0.10",
    biggen: "0.125",
    littlegen_diamond: "0.15",
    biggen_diamond: "0.20",
    "littlegen-diamond": "0.15",
    "biggen-diamond": "0.20",
  };

  const TIER_THUMB = {
    littlegen: "static/sample3.png",
    biggen: "static/sample1.png",
    littlegen_diamond: "static/sample4.png",
    biggen_diamond: "static/sample2.png",
    "littlegen-diamond": "static/sample4.png",
    "biggen-diamond": "static/sample2.png",
  };

  const state = {
    networkLabel: null,
    walletConnected: false,
    walletLabel: "",
    ready: false,
    tier: null,
    tierLabel: "—",
    guardLabel: "—",
    qty: 1,
    priceLabel: null, // null means: don't override DOM yet
    totalLabel: null,
    hint: "",
    busy: false,
  };

  function shortAddr(addr) {
    if (!addr || addr.length < 8) return addr || "";
    return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
  }

  function readInitialDom() {
    const p = $(`#${IDS.price}`)?.textContent?.trim();
    const t = $(`#${IDS.total}`)?.textContent?.trim();
    const q = parseInt($(`#${IDS.qty}`)?.textContent?.trim() || "1", 10);
    if (p && p !== "—") state.priceLabel = p;
    if (t && t !== "—") state.totalLabel = t;
    if (!Number.isNaN(q) && q > 0) state.qty = q;
  }

  function calcTotal(priceStr, qty) {
    const p = Number(priceStr);
    if (!Number.isFinite(p)) return null;
    const total = p * qty;
    // Keep up to 3 decimals, trim trailing zeros
    const fixed = total.toFixed(3).replace(/\.?0+$/, "");
    return fixed;
  }

  function setTier(rawTier, { emit = true } = {}) {
    if (!rawTier) return;

    const tier = String(rawTier).trim().toLowerCase();
    const label = TIER_LABEL[tier] || tier;
    const price = TIER_PRICE[tier] || null;

    state.tier = tier;
    state.tierLabel = label;
    state.guardLabel = tier; // by project convention guard label == tier
    if (price) {
      state.priceLabel = price;
      state.totalLabel = calcTotal(price, state.qty);
    }

    // Persist
    try { localStorage.setItem("tonfans:tier", tier); } catch (_) {}

    // Card highlight
    const cards = $$(".tier-card");
    cards.forEach((c) => {
      const cTier = String(c.getAttribute("data-tier") || "").toLowerCase();
      const on = cTier === tier;
      c.classList.toggle("tier-selected", on);
      c.setAttribute("aria-pressed", on ? "true" : "false");
      // also outline ring for safety even if CSS differs
      c.style.outline = on ? "2px solid rgba(255,255,255,.35)" : "";
      c.style.outlineOffset = on ? "2px" : "";
    });

    // Selected tier thumb/name/meta
    const nameEl = $(`#${IDS.selectedTierName}`);
    if (nameEl) nameEl.textContent = label;

    const metaEl = $(`#${IDS.selectedTierMeta}`);
    if (metaEl) metaEl.textContent = `guard: ${state.guardLabel}`;

    const thumbEl = $(`#${IDS.selectedTierThumb}`);
    if (thumbEl) thumbEl.src = TIER_THUMB[tier] || thumbEl.src;

    render();

    if (emit) {
      window.dispatchEvent(
        new CustomEvent("tonfans:tier", { detail: { tier } })
      );
    }
  }

  function render() {
    // Pills
    const net = $(`#${IDS.netPill}`);
    if (net && state.networkLabel) net.textContent = state.networkLabel;

    const wp = $(`#${IDS.walletPill}`);
    if (wp) wp.textContent = state.walletConnected ? `Wallet: ${shortAddr(state.walletLabel)}` : "Wallet: Not connected";

    const rp = $(`#${IDS.readyPill}`);
    if (rp) {
      rp.textContent = state.ready ? "Ready: Yes" : "Ready: No";
      rp.classList.toggle("ok", !!state.ready);
      rp.classList.toggle("bad", !state.ready);
    }

    // Wallet block
    const ws = $(`#${IDS.walletStatus}`);
    if (ws) ws.textContent = state.walletConnected ? "Connected" : "Not connected";

    const wa = $(`#${IDS.walletAddr}`);
    if (wa) wa.textContent = state.walletConnected ? state.walletLabel : "—";

    const connectBtn = $(`#${IDS.connectBtn}`);
    const disconnectBtn = $(`#${IDS.disconnectBtn}`);
    if (connectBtn) connectBtn.style.display = state.walletConnected ? "none" : "";
    if (disconnectBtn) disconnectBtn.style.display = state.walletConnected ? "" : "none";

    // Price / Total — update only if we have values
    const priceEl = $(`#${IDS.price}`);
    if (priceEl && state.priceLabel != null) priceEl.textContent = state.priceLabel;

    const totalEl = $(`#${IDS.total}`);
    if (totalEl && state.totalLabel != null) totalEl.textContent = state.totalLabel;

    // Selected tier block
    const nameEl = $(`#${IDS.selectedTierName}`);
    if (nameEl) nameEl.textContent = state.tier ? state.tierLabel : "—";

    const metaEl = $(`#${IDS.selectedTierMeta}`);
    if (metaEl) metaEl.textContent = `guard: ${state.tier ? state.guardLabel : "—"}`;

    // Mint button
    const mintBtn = $(`#${IDS.mintBtn}`);
    if (mintBtn) {
      mintBtn.disabled = !state.ready || state.busy || !state.tier;
      mintBtn.textContent = state.busy ? "Minting…" : "Mint now";
    }

    // Hint
    const hintEl = $(`#${IDS.mintHint}`);
    if (hintEl) hintEl.textContent = state.hint || "";

    // Small ready micro
    const tr = $(`#${IDS.tierReady}`);
    if (tr) {
      tr.classList.toggle("ready-hide", !state.ready);
    }

    // Sticky bar
    const sticky = $(`#${IDS.stickyMintBar}`);
    if (sticky) {
      const show = state.tier && window.scrollY > 400;
      sticky.classList.toggle("hidden", !show);

      const stickySel = $(`#${IDS.stickySelected}`);
      if (stickySel) stickySel.textContent = state.tier ? state.tierLabel : "—";

      const stickyAction = $(`#${IDS.stickyActionBtn}`);
      if (stickyAction) {
        if (!state.walletConnected) stickyAction.textContent = "Connect wallet";
        else if (!state.tier) stickyAction.textContent = "Select tier";
        else if (state.busy) stickyAction.textContent = "Minting…";
        else stickyAction.textContent = "Mint now";
        stickyAction.disabled = state.busy || (!!state.walletConnected && !state.tier);
      }
    }
  }

  function scrollToTiers() {
    const el = $("#tiers");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function wireButtons() {
    const connectBtn = $(`#${IDS.connectBtn}`);
    if (connectBtn) {
      connectBtn.onclick = (e) => {
        e.preventDefault();
        window.TONFANS?.mint?.toggleConnect?.();
      };
    }

    const disconnectBtn = $(`#${IDS.disconnectBtn}`);
    if (disconnectBtn) {
      disconnectBtn.onclick = (e) => {
        e.preventDefault();
        window.TONFANS?.mint?.disconnect?.();
      };
    }

    const mintBtn = $(`#${IDS.mintBtn}`);
    if (mintBtn) {
      mintBtn.onclick = (e) => {
        e.preventDefault();
        if (!state.tier) return scrollToTiers();
        window.TONFANS?.mint?.mintNow?.();
      };
    }

    const stickyChange = $(`#${IDS.stickyChangeBtn}`);
    if (stickyChange) stickyChange.onclick = (e) => { e.preventDefault(); scrollToTiers(); };

    const stickyAction = $(`#${IDS.stickyActionBtn}`);
    if (stickyAction) {
      stickyAction.onclick = (e) => {
        e.preventDefault();
        if (!state.walletConnected) return window.TONFANS?.mint?.toggleConnect?.();
        if (!state.tier) return scrollToTiers();
        window.TONFANS?.mint?.mintNow?.();
      };
    }

    // Anchor shortcuts
    $$(".change-tier-btn, a[href='#tiers']").forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault();
        scrollToTiers();
      };
    });
  }

  function wireTierCards() {
    const cards = $$(".tier-card");
    cards.forEach((card) => {
      card.style.cursor = "pointer";
      card.addEventListener("click", () => {
        const tier = String(card.getAttribute("data-tier") || "").toLowerCase();
        if (!tier) return;
        setTier(tier);
      });
    });
  }

  function wireQtyWatcher() {
    // mint.js will update #qty — here we just watch for changes and recompute total.
    const qtyEl = $(`#${IDS.qty}`);
    if (!qtyEl) return;
    const observer = new MutationObserver(() => {
      const q = parseInt(qtyEl.textContent || "1", 10);
      if (!Number.isNaN(q) && q > 0) {
        state.qty = q;
        if (state.priceLabel) state.totalLabel = calcTotal(state.priceLabel, state.qty);
        render();
        // tell mint module too
        window.dispatchEvent(new CustomEvent("tonfans:qty", { detail: { qty: state.qty } }));
      }
    });
    observer.observe(qtyEl, { childList: true, characterData: true, subtree: true });
  }

  function wireStateEvents() {
    window.addEventListener("tonfans:state", (e) => {
      const d = e.detail || {};
      if (typeof d.networkLabel === "string") state.networkLabel = d.networkLabel;
      if (typeof d.walletConnected === "boolean") state.walletConnected = d.walletConnected;
      if (typeof d.walletLabel === "string") state.walletLabel = d.walletLabel;
      if (typeof d.ready === "boolean") state.ready = d.ready;
      if (typeof d.busy === "boolean") state.busy = d.busy;

      // Only update price/total if the module has a real value (avoid overwriting with "—")
      if (typeof d.priceLabel === "string" && d.priceLabel !== "—") {
        state.priceLabel = d.priceLabel;
        state.totalLabel = calcTotal(state.priceLabel, state.qty);
      }
      if (typeof d.totalLabel === "string" && d.totalLabel !== "—") state.totalLabel = d.totalLabel;

      if (typeof d.hint === "string") state.hint = d.hint;

      if (typeof d.tier === "string") {
        state.tier = d.tier;
        state.tierLabel = TIER_LABEL[d.tier] || d.tier;
        state.guardLabel = d.guardLabel || d.tier;
      }

      render();
    });
  }

  function init() {
    readInitialDom();
    wireButtons();
    wireTierCards();
    wireQtyWatcher();
    wireStateEvents();

    // Restore tier if present
    try {
      const saved = localStorage.getItem("tonfans:tier");
      if (saved) setTier(saved, { emit: true });
    } catch (_) {}

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
