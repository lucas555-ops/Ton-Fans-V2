/* TONFANS Mint (static-site, no build) — Devnet
 * - Wallet: Phantom window.solana
 * - Mint: Metaplex Umi + mpl-candy-machine (loaded from CDN)
 * - NO wallet-adapter dependency (avoids umi-signer-wallet-adapters CDN issues)
 *
 * Expected HTML IDs/classes (from TONFANS index.html):
 * - Tier cards: button.tier-card[data-tier]
 * - Selected tier label: #selectedTier, #stickySelected
 * - Main buttons: #connectBtn, #mintBtn
 * - Sticky action button: #stickyActionBtn
 * - Status blocks: #walletStatus, #mintHint, #mintErr
 */

(() => {
  "use strict";

  // -----------------------------
  // CONFIG
  // -----------------------------
  const CLUSTER = "devnet";
  const DEFAULT_RPC = "https://api.devnet.solana.com";

  // If you want to override from HTML before this script loads:
  // <script>window.TONFANS_RPC="...";</script>
  const RPC = (typeof window !== "undefined" && window.TONFANS_RPC) ? window.TONFANS_RPC : DEFAULT_RPC;

  // Candy Machine IDs (devnet) — deployed in your logs
  const CM_BY_TIER = Object.freeze({
    // Genesis
    littlegen: "Hr9YzscC71vdHifZR4jRvMd8JmmGxbJrS6j7QckEVqKy",        // LittlGEN (501)
    biggen: "Ewhn2nJV6tbvq59GMahyWmS54jQWL4n3mrsoVM8n8GHH",          // BigGEN (500)
    // Diamond
    littlegen_diamond: "8L5MLvbvM9EsZ8nb1NAwqzEXuVsiq5x5fHGNKchz6UQR", // LittlGEN Diamond (185)
    biggen_diamond: "EyjoAcKwkfNo8NqCZczHHnNSi3ccYpnCetkBUwbqCien",    // BigGEN Diamond (185)
  });

  // The SOL treasury destination used by Sugar when you uploaded (Funding address)
  const TREASURY_DESTINATION = "9mG7vEEABrX5X4mg9WCAa17XpCxR28Ute2iEaDbHTJtD";

  // CDN import versions (pinning avoids surprises)
  // Sources (versions may change; pin what works for you)
  const UMI_VER = "1.4.1";
  const UMI_DEFAULTS_VER = "1.4.1";
  const UMI_WEB3JS_VER = "1.4.1";
  const CANDY_VER = "6.1.0";
  const WEB3_VER = "1.98.4";

  // -----------------------------
  // DOM helpers
  // -----------------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const shortPk = (s) => (typeof s === "string" && s.length > 8 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s);

  function setText(el, txt) {
    if (!el) return;
    el.textContent = txt;
  }
  function show(el) { if (el) el.classList.remove("hidden"); }
  function hide(el) { if (el) el.classList.add("hidden"); }

  function setWalletStatus(msg, kind = "info") {
    const el = $("#walletStatus");
    if (!el) return;
    el.classList.remove("status-ok", "status-warn", "status-err");
    if (kind === "ok") el.classList.add("status-ok");
    else if (kind === "warn") el.classList.add("status-warn");
    else if (kind === "err") el.classList.add("status-err");
    el.textContent = msg;
  }
  function setMintHint(msg) {
    const el = $("#mintHint");
    if (!el) return;
    el.textContent = msg || "";
  }
  function setMintError(err) {
    const el = $("#mintErr");
    if (!el) return;
    el.textContent = err ? String(err) : "";
  }

  // -----------------------------
  // State
  // -----------------------------
  const state = {
    selectedTier: "littlegen",
    wallet: null,            // Phantom provider
    walletPubkey: null,      // base58 string
    isMinting: false,
  };

  // -----------------------------
  // CDN dynamic import w/ fallbacks
  // -----------------------------
  const CDN_BUILDERS = [
    // esm.sh usually works well for Umi packages
    (pkg) => `https://esm.sh/${pkg}?bundle&target=es2020`,
    // jsdelivr +esm fallback
    (pkg) => `https://cdn.jsdelivr.net/npm/${pkg}/+esm`,
    // skypack fallback (may not work for all metaplex pkgs)
    (pkg) => `https://cdn.skypack.dev/${pkg}`,
  ];

  async function importWithFallback(pkg) {
    const errors = [];
    for (const build of CDN_BUILDERS) {
      const url = build(pkg);
      try {
        // eslint-disable-next-line no-new-func
        return await import(/* webpackIgnore: true */ url);
      } catch (e) {
        errors.push({ url, error: e });
      }
    }
    const msg =
      errors
        .map((x, i) => `#${i + 1} ${x.url}\n   ${String(x.error && (x.error.message || x.error))}`)
        .join("\n");
    throw new Error(`[TONFANS] Failed to load "${pkg}". Tried:\n${msg}`);
  }

  let _depsPromise = null;
  async function deps() {
    if (_depsPromise) return _depsPromise;
    _depsPromise = (async () => {
      const [umiDefaults, umiCore, umiWeb3Adapters, candy, web3] = await Promise.all([
        importWithFallback(`@metaplex-foundation/umi-bundle-defaults@${UMI_DEFAULTS_VER}`),
        importWithFallback(`@metaplex-foundation/umi@${UMI_VER}`),
        importWithFallback(`@metaplex-foundation/umi-web3js-adapters@${UMI_WEB3JS_VER}`),
        importWithFallback(`@metaplex-foundation/mpl-candy-machine@${CANDY_VER}`),
        importWithFallback(`@solana/web3.js@${WEB3_VER}`),
      ]);

      return {
        // Umi
        createUmi: umiDefaults.createUmi,
        publicKey: umiCore.publicKey,
        some: umiCore.some,
        transactionBuilder: umiCore.transactionBuilder,
        signerIdentity: umiCore.signerIdentity,
        createNoopSigner: umiCore.createNoopSigner,
        createSignerFromKeypair: umiCore.createSignerFromKeypair,
        // web3js ↔ umi helpers
        toWeb3JsLegacyTransaction: umiWeb3Adapters.toWeb3JsLegacyTransaction,
        fromWeb3JsKeypair: umiWeb3Adapters.fromWeb3JsKeypair,
        // Candy Machine
        mplCandyMachine: candy.mplCandyMachine,
        fetchCandyMachine: candy.fetchCandyMachine,
        safeFetchCandyGuard: candy.safeFetchCandyGuard,
        mintV2: candy.mintV2,
        // web3.js
        web3,
      };
    })();
    return _depsPromise;
  }

  // -----------------------------
  // Wallet (Phantom)
  // -----------------------------
  function getProvider() {
    const provider = window.solana;
    if (!provider || !provider.isPhantom) return null;
    return provider;
  }

  async function connectWallet() {
    setMintError("");
    const provider = getProvider();
    if (!provider) {
      setWalletStatus("Phantom wallet not found. Install Phantom to mint.", "err");
      throw new Error("Phantom wallet not found");
    }
    state.wallet = provider;

    // connect may prompt
    await provider.connect({ onlyIfTrusted: false });

    state.walletPubkey = provider.publicKey?.toString?.() || null;
    if (!state.walletPubkey) throw new Error("Wallet connected but publicKey missing");

    setWalletStatus(`Connected: ${shortPk(state.walletPubkey)} (${CLUSTER})`, "ok");
    renderWalletUI();
  }

  async function disconnectWallet() {
    setMintError("");
    const provider = state.wallet || getProvider();
    if (!provider) return;
    try { await provider.disconnect(); } catch (_) {}
    state.walletPubkey = null;
    setWalletStatus(`Not connected (${CLUSTER})`, "warn");
    renderWalletUI();
  }

  function bindWalletEvents() {
    const provider = getProvider();
    if (!provider || provider.__tonfansBound) return;
    provider.__tonfansBound = true;

    provider.on("connect", () => {
      state.walletPubkey = provider.publicKey?.toString?.() || null;
      renderWalletUI();
    });
    provider.on("disconnect", () => {
      state.walletPubkey = null;
      renderWalletUI();
    });
    provider.on("accountChanged", (pk) => {
      state.walletPubkey = pk ? pk.toString() : null;
      renderWalletUI();
    });
  }

  // -----------------------------
  // Tier selection
  // -----------------------------
  function normalizeTier(t) {
    if (!t) return null;
    // accept some legacy variants just in case
    const map = {
      "littlgen": "littlegen",
      "littlegen": "littlegen",
      "biggen": "biggen",
      "littlgen-diamond": "littlegen_diamond",
      "littlegen-diamond": "littlegen_diamond",
      "littlgen_diamond": "littlegen_diamond",
      "littlegen_diamond": "littlegen_diamond",
      "biggen-diamond": "biggen_diamond",
      "biggen_diamond": "biggen_diamond",
    };
    return map[t] || t;
  }

  function setSelectedTier(tierRaw) {
    const tier = normalizeTier(tierRaw);
    if (!tier || !CM_BY_TIER[tier]) return;

    state.selectedTier = tier;
    try { localStorage.setItem("tonfans_selected_tier", tier); } catch (_) {}

    // UI: tier-selected class on cards
    const cards = $$(".tier-card[data-tier]");
    for (const c of cards) {
      const cTier = normalizeTier(c.getAttribute("data-tier"));
      if (cTier === tier) c.classList.add("tier-selected");
      else c.classList.remove("tier-selected");
    }

    setText($("#selectedTier"), tierLabel(tier));
    setText($("#stickySelected"), tierLabel(tier));
    setMintHint(`Selected: ${tierLabel(tier)}`);
  }

  function tierLabel(tier) {
    switch (tier) {
      case "littlegen": return "LittlGEN";
      case "biggen": return "BigGEN";
      case "littlegen_diamond": return "LittlGEN Diamond";
      case "biggen_diamond": return "BigGEN Diamond";
      default: return tier;
    }
  }

  function initTierUI() {
    // Restore
    try {
      const saved = localStorage.getItem("tonfans_selected_tier");
      if (saved) state.selectedTier = normalizeTier(saved) || state.selectedTier;
    } catch (_) {}

    // Bind clicks
    $$(".tier-card[data-tier]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setSelectedTier(btn.getAttribute("data-tier"));
      });
    });

    // Initial paint
    setSelectedTier(state.selectedTier);
  }

  // -----------------------------
  // UI rendering
  // -----------------------------
  function renderWalletUI() {
    const connected = Boolean(state.walletPubkey);

    const connectBtn = $("#connectBtn");
    const mintBtn = $("#mintBtn");
    const stickyActionBtn = $("#stickyActionBtn");

    if (connectBtn) {
      connectBtn.textContent = connected ? `Connected: ${shortPk(state.walletPubkey)}` : "Connect Phantom";
      connectBtn.classList.toggle("btn-disabled", connected);
      connectBtn.disabled = connected;
    }

    if (mintBtn) {
      mintBtn.disabled = !connected || state.isMinting;
      mintBtn.classList.toggle("btn-disabled", !connected || state.isMinting);
    }

    if (stickyActionBtn) {
      stickyActionBtn.textContent = connected ? (state.isMinting ? "Minting…" : "Mint now") : "Connect";
      stickyActionBtn.disabled = state.isMinting;
      stickyActionBtn.classList.toggle("btn-disabled", state.isMinting);
    }

    // If not connected show a clear hint
    if (!connected) {
      setMintHint("Connect Phantom to mint. (Devnet — ensure you have DEVNET SOL)");
    } else {
      setMintHint(`Ready. Mint from: ${tierLabel(state.selectedTier)} (Devnet)`);
    }
  }

  // -----------------------------
  // Mint core
  // -----------------------------
  async function mintSelectedTier() {
    if (state.isMinting) return;
    setMintError("");

    const provider = state.wallet || getProvider();
    if (!provider || !provider.isPhantom) {
      setWalletStatus("Phantom wallet not found.", "err");
      throw new Error("Phantom wallet not found");
    }

    // Ensure connected
    if (!state.walletPubkey) {
      await connectWallet();
    }
    if (!state.walletPubkey) throw new Error("Wallet not connected");

    const tier = normalizeTier(state.selectedTier);
    const cmId = CM_BY_TIER[tier];
    if (!cmId) throw new Error(`Unknown tier "${tier}"`);

    state.isMinting = true;
    renderWalletUI();

    try {
      const d = await deps();
      const {
        createUmi,
        publicKey,
        some,
        transactionBuilder,
        signerIdentity,
        createNoopSigner,
        createSignerFromKeypair,
        toWeb3JsLegacyTransaction,
        fromWeb3JsKeypair,
        mplCandyMachine,
        fetchCandyMachine,
        safeFetchCandyGuard,
        mintV2,
        web3,
      } = d;

      const { Connection, Keypair, ComputeBudgetProgram } = web3;

      // web3 connection (send/confirm)
      const connection = new Connection(RPC, "confirmed");

      // Build Umi client (no wallet-adapter; identity is a NOOP signer with wallet pubkey)
      const umi = createUmi(RPC).use(mplCandyMachine());

      const walletPkUmi = publicKey(state.walletPubkey);
      umi.use(signerIdentity(createNoopSigner(walletPkUmi)));

      // Fetch CM & Guard
      setMintHint(`Loading Candy Machine (${tierLabel(tier)})…`);
      const candyMachinePk = publicKey(cmId);
      const candyMachine = await fetchCandyMachine(umi, candyMachinePk);
      const candyGuard = await safeFetchCandyGuard(umi, candyMachine.mintAuthority);

      // Mint signer (we keep the web3 keypair so we can partialSign after we add compute budget)
      const nftMintKp = Keypair.generate();
      const nftMintUmiKeypair = fromWeb3JsKeypair(nftMintKp);
      const nftMintSigner = createSignerFromKeypair(umi, nftMintUmiKeypair);

      // Mint args (solPayment destination must match guard config; in Sugar it's your funding address)
      const mintArgs = {};
      if (candyGuard) {
        mintArgs.solPayment = some({ destination: publicKey(TREASURY_DESTINATION) });
      }

      // Latest blockhash (web3js) — ensures tx is fresh
      const { blockhash } = await connection.getLatestBlockhash("confirmed");

      // Build tx via Umi (no signatures yet)
      setMintHint("Building mint transaction…");
      const builder = transactionBuilder().add(
        mintV2(umi, {
          candyMachine: candyMachine.publicKey,
          collectionMint: candyMachine.collectionMint,
          collectionUpdateAuthority: candyMachine.authority,
          nftMint: nftMintSigner,
          candyGuard: candyGuard ? candyGuard.publicKey : undefined,
          mintArgs: candyGuard ? mintArgs : undefined,
          tokenStandard: candyMachine.tokenStandard,
        })
      );

      // Build Umi tx and convert to legacy web3 tx
      const umiTx = builder.setBlockhash(blockhash).build(umi);
      let tx = toWeb3JsLegacyTransaction(umiTx);

      // Ensure payer & blockhash (belt-and-suspenders)
      tx.feePayer = provider.publicKey;
      tx.recentBlockhash = blockhash;

      // Add compute budget instruction FIRST (before signing)
      tx.instructions.unshift(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 })
      );

      // Sign with mint keypair (creates mint account)
      tx.partialSign(nftMintKp);

      // Wallet signs and sends (Phantom)
      setMintHint("Phantom: approve the mint transaction…");
      const signedTx = await provider.signTransaction(tx);

      setMintHint("Sending transaction…");
      const sig = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });

      setMintHint(`Confirming… ${sig.slice(0, 8)}…`);
      const conf = await connection.confirmTransaction(sig, "confirmed");
      if (conf?.value?.err) throw new Error(`Transaction failed: ${JSON.stringify(conf.value.err)}`);

      setMintHint(`✅ Mint successful: ${sig}`);
    } catch (e) {
      setMintError(e?.message || String(e));
      setMintHint("Mint failed.");
      console.error("[TONFANS] Mint error:", e);
      throw e;
    } finally {
      state.isMinting = false;
      renderWalletUI();
    }
  }

  // -----------------------------
  // Bind buttons
  // -----------------------------
  function initButtons() {
    const connectBtn = $("#connectBtn");
    const mintBtn = $("#mintBtn");
    const stickyActionBtn = $("#stickyActionBtn");

    if (connectBtn && !connectBtn.__tonfansBound) {
      connectBtn.__tonfansBound = true;
      connectBtn.addEventListener("click", async () => {
        try { await connectWallet(); } catch (e) { setMintError(e?.message || String(e)); }
      });
    }

    if (mintBtn && !mintBtn.__tonfansBound) {
      mintBtn.__tonfansBound = true;
      mintBtn.addEventListener("click", async () => {
        try { await mintSelectedTier(); } catch (_) {}
      });
    }

    if (stickyActionBtn && !stickyActionBtn.__tonfansBound) {
      stickyActionBtn.__tonfansBound = true;
      stickyActionBtn.addEventListener("click", async () => {
        try {
          if (!state.walletPubkey) await connectWallet();
          else await mintSelectedTier();
        } catch (e) {
          setMintError(e?.message || String(e));
        }
      });
    }

    // Optional: allow disconnect via clicking the wallet status while connected (handy for testing)
    const walletStatus = $("#walletStatus");
    if (walletStatus && !walletStatus.__tonfansBound) {
      walletStatus.__tonfansBound = true;
      walletStatus.addEventListener("dblclick", async () => {
        if (state.walletPubkey) await disconnectWallet();
      });
    }
  }

  // -----------------------------
  // Init
  // -----------------------------
  function init() {
    bindWalletEvents();
    initTierUI();
    initButtons();

    // Try silent connect (trusted)
    const provider = getProvider();
    if (provider?.isPhantom) {
      provider.connect({ onlyIfTrusted: true }).then(() => {
        state.wallet = provider;
        state.walletPubkey = provider.publicKey?.toString?.() || null;
        if (state.walletPubkey) setWalletStatus(`Connected: ${shortPk(state.walletPubkey)} (${CLUSTER})`, "ok");
        renderWalletUI();
      }).catch(() => {
        setWalletStatus(`Not connected (${CLUSTER})`, "warn");
        renderWalletUI();
      });
    } else {
      setWalletStatus("Not connected (Phantom not detected)", "warn");
      renderWalletUI();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // Expose small debug surface
  window.TONFANS = window.TONFANS || {};
  window.TONFANS.__state = state;
  window.TONFANS.__mint = mintSelectedTier;
  window.TONFANS.__setTier = setSelectedTier;
})();
