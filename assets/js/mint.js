/* assets/js/mint.js
   TONFANS 4-CM Mint Controller (UI + Wallet + Mint)
   - Fixes: tier outline, top pills, stickybar, connect/disconnect, mint action
*/

(() => {
  "use strict";

  const LOG = "[TONFANS]";

  // -----------------------------
  // CONFIG (can be overridden via window.*)
  // -----------------------------
  const DEFAULT_CLUSTER = "devnet"; // "mainnet-beta"
  const DEFAULT_RPC =
    DEFAULT_CLUSTER === "devnet"
      ? "https://api.devnet.solana.com"
      : "https://api.mainnet-beta.solana.com";

  const CLUSTER = String(
    window.TONFANS_CLUSTER || window.CM_CLUSTER || DEFAULT_CLUSTER
  ).trim();

  const RPC_URL = String(window.TONFANS_RPC || window.CM_RPC || DEFAULT_RPC).trim();

  // Treasury = solPayment destination (your wallet)
  const TREASURY_DESTINATION = String(
    window.TONFANS_TREASURY || window.TREASURY_ADDRESS || "9mG7vEEABrX5X4mg9WCAa17XpCxR28Ute2iEaDbHTJtD"
  ).trim();

  // 4 Candy Machines by tier (DEVNET addresses from your deploy logs)
  const CM_BY_TIER = window.TONFANS_CM_BY_TIER || window.CM_BY_TIER || {
    littlegen: "Hr9YzscC71vdHifZR4jRvMd8JmmGxbJrS6j7QckEVqKy",
    biggen: "Ewhn2nJV6tbvq59GMahyWmS54jQWL4n3mrsoVM8n8GHH",
    littlgen_diamond: "8L5MLvbvM9EsZ8nb1NAwqzEXuVsiq5x5fHGNKchz6UQR",
    biggen_diamond: "EyjoAcKwkfNo8NqCZczHHnNSi3ccYpnCetkBUwbqCien",
  };

  // Tier metadata (only for UI)
  const TIERS = window.TONFANS_TIERS || {
    littlegen: { key: "littlegen", label: "LittlGEN", priceSol: 0.10, supply: 500, guardLabel: "Sol Payment" },
    biggen: { key: "biggen", label: "BigGEN", priceSol: 0.20, supply: 500, guardLabel: "Sol Payment" },
    littlgen_diamond: { key: "littlgen_diamond", label: "LittlGEN Diamond", priceSol: 0.30, supply: 185, guardLabel: "Sol Payment" },
    biggen_diamond: { key: "biggen_diamond", label: "BigGEN Diamond", priceSol: 0.40, supply: 185, guardLabel: "Sol Payment" },
  };

  // Back-compat globals for ui.js (IMPORTANT so ui.js doesn't disable Mint)
  window.CM_BY_TIER = CM_BY_TIER;
  window.TREASURY_ADDRESS = TREASURY_DESTINATION;
  window.CM_CLUSTER = CLUSTER;
  window.CM_RPC = RPC_URL;

  // -----------------------------
  // STATE
  // -----------------------------
  const state = {
    selectedTier: null,
    qty: 1,
    walletPubkey: null,
    walletConnected: false,
    isMinting: false,
    depsPromise: null,
  };

  // -----------------------------
  // DOM HELPERS
  // -----------------------------
  const $ = (id) => document.getElementById(id);

  const els = {
    // Tier cards
    tierCards: Array.from(document.querySelectorAll("[data-tier]")),

    // Selected tier box
    selectedTierName: $("selectedTierName") || $("selectedTierTitle") || $("selectedTier"),
    selectedTierGuard: $("selectedTierGuard") || $("selectedTierLabel") || $("selectedTierMeta"),

    // Price UI (optional)
    priceValue: $("priceValue") || $("price") || $("priceText"),
    totalValue: $("totalValue") || $("estimatedTotal") || $("total"),

    // Quantity UI
    qtyMinus: $("qtyMinus") || $("qtyDec"),
    qtyPlus: $("qtyPlus") || $("qtyInc"),
    qtyValue: $("qtyValue") || $("qty") || $("quantityValue"),

    // Wallet buttons (main)
    connectBtn: $("connectBtn") || $("walletConnectBtn"),
    disconnectBtn: $("disconnectBtn") || $("walletDisconnectBtn"),

    // Mint UI
    mintBtn: $("mintBtn") || $("mintNowBtn"),
    mintHint: $("mintHint") || $("mintStatus") || $("mintError"),

    // Top pills (value spans)
    networkPill: $("networkPill") || $("netPill") || $("networkValue"),
    walletPill: $("walletPill") || $("walletValue"),
    readyPill: $("readyPill") || $("readyValue"),

    // Sticky bar
    stickyBar: $("stickyMintBar") || $("stickyBar"),
    stickyActionBtn: $("stickyActionBtn") || $("stickyBtn") || $("stickyMintBtn"),
    stickyTier: $("stickyTier") || $("stickyTierName"),
  };

  function shortPk(pk) {
    if (!pk || typeof pk !== "string") return "—";
    if (pk.length <= 10) return pk;
    return pk.slice(0, 4) + "…" + pk.slice(-4);
  }

  function safeText(el, text) {
    if (!el) return;
    el.textContent = text;
  }

  function safeHTML(el, html) {
    if (!el) return;
    el.innerHTML = html;
  }

  function show(el) {
    if (!el) return;
    el.style.display = "";
  }

  function hide(el) {
    if (!el) return;
    el.style.display = "none";
  }

  function hasProvider() {
    return typeof window !== "undefined" && window.solana && typeof window.solana.connect === "function";
  }

  function getProvider() {
    return window.solana || null;
  }

  function clusterParam() {
    return CLUSTER === "devnet" ? "devnet" : "mainnet-beta";
  }

  function explorerTx(sig) {
    return `https://explorer.solana.com/tx/${sig}?cluster=${clusterParam()}`;
  }

  function currentCandyMachine() {
    if (!state.selectedTier) return "";
    return (CM_BY_TIER[state.selectedTier] || "").trim();
  }

  function isReady() {
    return !!state.walletConnected && !!state.walletPubkey && !!currentCandyMachine();
  }

  // -----------------------------
  // UI RENDER
  // -----------------------------
  function setSelectedTier(tierKey, { silent = false } = {}) {
    if (!tierKey || !TIERS[tierKey]) return;

    state.selectedTier = tierKey;
    localStorage.setItem("tonfans_selected_tier", tierKey);

    // Tier card outline (IMPORTANT)
    els.tierCards.forEach((card) => {
      const t = card.getAttribute("data-tier");
      card.classList.toggle("tier-selected", t === tierKey);
    });

    // Selected tier box
    safeText(els.selectedTierName, TIERS[tierKey].label || tierKey);
    safeText(els.selectedTierGuard, `guard: ${TIERS[tierKey].guardLabel || "—"}`);

    // Sticky tier name
    safeText(els.stickyTier, TIERS[tierKey].label || tierKey);

    // Price blocks
    const price = Number(TIERS[tierKey].priceSol || 0);
    if (els.priceValue) safeText(els.priceValue, `${price.toFixed(2)} SOL`);
    updateEstimatedTotal();

    // Back-compat for ui.js (so it doesn't disable Mint)
    window.CANDY_MACHINE_ADDRESS = currentCandyMachine();

    if (!silent) showStickyBar();
    renderHealth();
    renderActions();
  }

  function setQty(next) {
    const n = Math.max(1, Math.min(10, Number(next || 1)));
    state.qty = n;
    if (els.qtyValue) safeText(els.qtyValue, String(n));
    updateEstimatedTotal();
    renderActions();
  }

  function updateEstimatedTotal() {
    if (!state.selectedTier) return;
    const price = Number(TIERS[state.selectedTier]?.priceSol || 0);
    const total = price * (state.qty || 1);
    if (els.totalValue) safeText(els.totalValue, `${total.toFixed(2)} SOL`);
  }

  function showStickyBar() {
    if (!els.stickyBar) return;
    show(els.stickyBar);
    // if your CSS uses a class trigger, keep it too:
    els.stickyBar.classList.add("is-visible");
  }

  function renderHealth() {
    // network
    if (els.networkPill) safeText(els.networkPill, CLUSTER === "devnet" ? "Devnet" : "Mainnet");

    // wallet
    if (els.walletPill) safeText(els.walletPill, state.walletConnected ? "Connected" : "Not connected");

    // ready
    if (els.readyPill) safeText(els.readyPill, isReady() ? "Yes" : "No");
  }

  function renderActions() {
    // Connect/Disconnect buttons
    if (els.connectBtn && els.disconnectBtn) {
      if (state.walletConnected) {
        hide(els.connectBtn);
        show(els.disconnectBtn);
        els.disconnectBtn.disabled = false;
        safeText(els.disconnectBtn, `Disconnect (${shortPk(state.walletPubkey)})`);
      } else {
        show(els.connectBtn);
        hide(els.disconnectBtn);
        els.connectBtn.disabled = false;
      }
    } else if (els.connectBtn && !els.disconnectBtn) {
      // Single-button toggle mode
      els.connectBtn.disabled = false;
      safeText(
        els.connectBtn,
        state.walletConnected ? `Connected: ${shortPk(state.walletPubkey)} (click to disconnect)` : "Connect wallet"
      );
    }

    // Mint button
    if (els.mintBtn) {
      const ready = isReady();
      els.mintBtn.disabled = !ready || state.isMinting;
      els.mintBtn.classList.toggle("is-disabled", els.mintBtn.disabled);
    }

    // Sticky action button
    if (els.stickyActionBtn) {
      if (state.isMinting) {
        els.stickyActionBtn.disabled = true;
        safeText(els.stickyActionBtn, "Minting…");
      } else if (!hasProvider()) {
        els.stickyActionBtn.disabled = false;
        safeText(els.stickyActionBtn, "Get Phantom");
      } else if (!state.walletConnected) {
        els.stickyActionBtn.disabled = false;
        safeText(els.stickyActionBtn, "Connect");
      } else if (!currentCandyMachine()) {
        els.stickyActionBtn.disabled = true;
        safeText(els.stickyActionBtn, "Select tier");
      } else {
        els.stickyActionBtn.disabled = false;
        safeText(els.stickyActionBtn, "Mint now");
      }
    }

    // Hint line
    if (els.mintHint) {
      if (!state.selectedTier) {
        safeText(els.mintHint, "Select a tier to continue.");
      } else if (!currentCandyMachine()) {
        safeText(els.mintHint, "Candy Machine is not set for this tier.");
      } else if (!hasProvider()) {
        safeText(els.mintHint, "Install Phantom (recommended) or a wallet that exposes window.solana.");
      } else if (!state.walletConnected) {
        safeText(els.mintHint, "Connect wallet to mint.");
      } else if (state.isMinting) {
        safeText(els.mintHint, "Minting… please confirm in your wallet.");
      } else {
        safeText(els.mintHint, "Ready to mint.");
      }
    }

    renderHealth();
  }

  // -----------------------------
  // WALLET
  // -----------------------------
  async function connectWallet({ silent = false } = {}) {
    if (!hasProvider()) {
      // Deep-link to Phantom (mobile)
      const url = location.href;
      const deeplink = `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(
        location.host
      )}`;
      if (!silent) window.open(deeplink, "_blank");
      throw new Error("No wallet provider found (window.solana).");
    }

    const provider = getProvider();

    try {
      // silent connect
      const resp = silent
        ? await provider.connect({ onlyIfTrusted: true })
        : await provider.connect();

      const pk = resp?.publicKey?.toString?.() || provider.publicKey?.toString?.();
      if (!pk) throw new Error("Connected but no publicKey returned.");

      state.walletPubkey = pk;
      state.walletConnected = true;

      localStorage.setItem("tonfans_autoconnect", "1");
      localStorage.setItem("tonfans_last_pubkey", pk);

      renderActions();
      return pk;
    } catch (e) {
      if (!silent) console.error(LOG, "connect failed:", e);
      state.walletConnected = false;
      state.walletPubkey = null;
      renderActions();
      throw e;
    }
  }

  async function disconnectWallet() {
    const provider = getProvider();
    try {
      if (provider && typeof provider.disconnect === "function") {
        await provider.disconnect();
      }
    } catch (_) {
      // ignore
    }

    state.walletConnected = false;
    state.walletPubkey = null;

    localStorage.removeItem("tonfans_autoconnect");
    localStorage.removeItem("tonfans_last_pubkey");

    renderActions();
  }

  function bindWalletEvents() {
    const provider = getProvider();
    if (!provider || typeof provider.on !== "function") return;

    provider.on("connect", () => {
      const pk = provider.publicKey?.toString?.();
      if (pk) {
        state.walletConnected = true;
        state.walletPubkey = pk;
        localStorage.setItem("tonfans_last_pubkey", pk);
        renderActions();
      }
    });

    provider.on("disconnect", () => {
      state.walletConnected = false;
      state.walletPubkey = null;
      renderActions();
    });

    provider.on("accountChanged", (pubkey) => {
      const pk = pubkey?.toString?.() || provider.publicKey?.toString?.();
      if (!pk) {
        state.walletConnected = false;
        state.walletPubkey = null;
      } else {
        state.walletConnected = true;
        state.walletPubkey = pk;
        localStorage.setItem("tonfans_last_pubkey", pk);
      }
      renderActions();
    });
  }

  // -----------------------------
  // DEPS LOADER (NO umi-signer-wallet-adapters)
  // -----------------------------
  async function importFrom(urls) {
    let lastErr = null;
    for (const url of urls) {
      try {
        return await import(url);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Dynamic import failed");
  }

  async function dep(pkg, version) {
    const v = version ? `@${version}` : "";
    const urls = [
      `https://esm.sh/${pkg}${v}?bundle&target=es2020`,
      `https://esm.sh/${pkg}${v}?target=es2020`,
      `https://cdn.jsdelivr.net/npm/${pkg}${v}/+esm`,
    ];
    return importFrom(urls);
  }

  async function loadDeps() {
    if (state.depsPromise) return state.depsPromise;

    state.depsPromise = (async () => {
      try {
        const web3 = await dep("@solana/web3.js", "1.95.2");
        const umi = await dep("@metaplex-foundation/umi", "0.9.1");
        const bundle = await dep("@metaplex-foundation/umi-bundle-defaults", "0.9.1");
        const adapters = await dep("@metaplex-foundation/umi-web3js-adapters", "0.9.1");
        const candy = await dep("@metaplex-foundation/mpl-candy-machine", "6.0.1");

        return { web3, umi, bundle, adapters, candy };
      } catch (e) {
        console.error(LOG, "deps load failed:", e);
        throw new Error(`${LOG} Failed to load mint dependencies (UMI/MPL). Try hard refresh / disable cache.`);
      }
    })();

    return state.depsPromise;
  }

  // -----------------------------
  // MINT
  // -----------------------------
  async function mintOnce() {
    if (!state.selectedTier) throw new Error("Select tier first.");
    const cmId = currentCandyMachine();
    if (!cmId) throw new Error("Candy Machine is not set for this tier.");
    if (!state.walletConnected || !state.walletPubkey) throw new Error("Wallet not connected.");

    const { web3, umi, bundle, adapters, candy } = await loadDeps();

    const { Connection, Keypair, ComputeBudgetProgram, PublicKey } = web3;
    const connection = new Connection(RPC_URL, { commitment: "confirmed" });

    const {
      publicKey,
      createNoopSigner,
      signerIdentity,
      some,
      none,
    } = umi;

    const { createUmi } = bundle;

    const { fromWeb3JsKeypair, toWeb3JsLegacyTransaction } = adapters;

    const {
      mplCandyMachine,
      fetchCandyMachine,
      safeFetchCandyGuard,
      mintV2,
    } = candy;

    // UMI client
    const umiClient = createUmi(RPC_URL, { commitment: "confirmed" }).use(mplCandyMachine());

    // identity = wallet pubkey (no-op signer, wallet will sign in Phantom)
    const walletPkUmi = publicKey(state.walletPubkey);
    const noop = createNoopSigner(walletPkUmi);
    umiClient.use(signerIdentity(noop));

    // Fetch CM + Guard
    const cmPk = publicKey(cmId);
    const cm = await fetchCandyMachine(umiClient, cmPk);

    const guardPk = cm.mintAuthority;
    const guard = await safeFetchCandyGuard(umiClient, guardPk);

    // New mint signer (NFT mint)
    const nftMintKp = Keypair.generate();
    const nftMintSigner = fromWeb3JsKeypair(umiClient, nftMintKp);

    // Mint args for solPayment guard
    const mintArgs = {
      solPayment: some({ destination: publicKey(TREASURY_DESTINATION) }),
    };

    const builder = mintV2(umiClient, {
      candyMachine: cmPk,
      candyGuard: guard ? some(guardPk) : none(),
      nftMint: nftMintSigner,
      collectionMint: cm.collectionMint,
      collectionUpdateAuthority: cm.collectionUpdateAuthority,
      tokenStandard: cm.tokenStandard,
      mintArgs: guard ? some(mintArgs) : none(),
    });

    // Build UMI tx -> convert to web3 legacy tx
    const umiTx = builder.build(umiClient);
    const tx = toWeb3JsLegacyTransaction(umiTx);

    // Add compute budget (helps reliability)
    tx.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 600000 })
    );
    tx.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 })
    );

    // Populate blockhash + fee payer
    const latest = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = latest.blockhash;
    tx.feePayer = new PublicKey(state.walletPubkey);

    // Partial sign with mint keypair (required)
    tx.partialSign(nftMintKp);

    // Wallet sign + send
    const provider = getProvider();
    if (!provider) throw new Error("No wallet provider.");

    let sig;
    if (typeof provider.signAndSendTransaction === "function") {
      const res = await provider.signAndSendTransaction(tx, { preflightCommitment: "confirmed", maxRetries: 5 });
      sig = typeof res === "string" ? res : res?.signature;
    } else if (typeof provider.signTransaction === "function") {
      const signed = await provider.signTransaction(tx);
      sig = await connection.sendRawTransaction(signed.serialize(), { maxRetries: 5 });
    } else {
      throw new Error("Wallet does not support signAndSendTransaction/signTransaction.");
    }

    // Confirm
    await connection.confirmTransaction(
      { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      "confirmed"
    );

    return sig;
  }

  async function mintNow() {
    if (state.isMinting) return;

    state.isMinting = true;
    renderActions();

    try {
      const qty = Math.max(1, Number(state.qty || 1));
      let lastSig = null;

      for (let i = 1; i <= qty; i++) {
        safeText(els.mintHint, `Minting ${i}/${qty}… confirm in wallet.`);
        const sig = await mintOnce();
        lastSig = sig;
        safeHTML(
          els.mintHint,
          `✅ Minted ${i}/${qty}. Tx: <a href="${explorerTx(sig)}" target="_blank" rel="noreferrer">${shortPk(sig)}</a>`
        );
      }

      return lastSig;
    } catch (e) {
      console.error(LOG, "mint failed:", e);
      safeText(els.mintHint, `Error: ${e?.message || String(e)}`);
      throw e;
    } finally {
      state.isMinting = false;
      renderActions();
    }
  }

  // -----------------------------
  // BIND UI EVENTS
  // -----------------------------
  function bindUI() {
    // tier cards
    if (els.tierCards && els.tierCards.length) {
      els.tierCards.forEach((card) => {
        card.addEventListener("click", () => {
          const t = card.getAttribute("data-tier");
          setSelectedTier(t);
        });
      });
    }

    // qty buttons
    if (els.qtyMinus) els.qtyMinus.addEventListener("click", () => setQty((state.qty || 1) - 1));
    if (els.qtyPlus) els.qtyPlus.addEventListener("click", () => setQty((state.qty || 1) + 1));

    // connect / disconnect
    if (els.connectBtn && els.disconnectBtn) {
      els.connectBtn.addEventListener("click", () => connectWallet({ silent: false }).catch((e) => safeText(els.mintHint, `Error: ${e.message}`)));
      els.disconnectBtn.addEventListener("click", () => disconnectWallet());
    } else if (els.connectBtn && !els.disconnectBtn) {
      // toggle mode
      els.connectBtn.addEventListener("click", async () => {
        if (state.walletConnected) return disconnectWallet();
        return connectWallet({ silent: false }).catch((e) => safeText(els.mintHint, `Error: ${e.message}`));
      });
    }

    // mint
    if (els.mintBtn) {
      els.mintBtn.addEventListener("click", () => mintNow().catch(() => {}));
    }

    // sticky action
    if (els.stickyActionBtn) {
      els.stickyActionBtn.addEventListener("click", async () => {
        try {
          if (!hasProvider()) {
            const url = location.href;
            const deeplink = `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(location.host)}`;
            window.open(deeplink, "_blank");
            return;
          }
          if (!state.walletConnected) {
            await connectWallet({ silent: false });
            return;
          }
          if (!currentCandyMachine()) return;
          await mintNow();
        } catch (e) {
          safeText(els.mintHint, `Error: ${e?.message || String(e)}`);
        }
      });
    }
  }

  // -----------------------------
  // INIT
  // -----------------------------
  function initDefaultTier() {
    const saved = localStorage.getItem("tonfans_selected_tier");
    const first = saved && TIERS[saved] ? saved : Object.keys(TIERS)[0];
    if (first) setSelectedTier(first, { silent: true });
  }

  async function tryAutoConnect() {
    const should = localStorage.getItem("tonfans_autoconnect") === "1";
    if (!should) return;
    if (!hasProvider()) return;
    try {
      await connectWallet({ silent: true });
    } catch (_) {
      // silent
    }
  }

  function init() {
    // Ensure UI won't be blocked by ui.js old logic
    window.CANDY_MACHINE_ADDRESS = window.CANDY_MACHINE_ADDRESS || "";

    initDefaultTier();
    setQty(Number(els.qtyValue?.textContent || 1));

    bindUI();
    bindWalletEvents();

    renderHealth();
    renderActions();

    // sticky bar visible after tier selection; keep hidden initially if your layout expects it
    // showStickyBar(); // uncomment if you want it always visible

    tryAutoConnect().finally(() => renderActions());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
