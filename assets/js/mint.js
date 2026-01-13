// Ton Fans — 4 Candy Machines Mint Flow   
// One Candy Machine per tier (cleanest production setup)



// ---- Lazy-load UMI + Candy Machine deps (keeps wallet connect + tier UI working even if CDNs are slow) ----
let __TONFANS_DEPS_PROMISE__ = null;
async function loadTonfansDeps() {
  if (__TONFANS_DEPS_PROMISE__) return __TONFANS_DEPS_PROMISE__;
  __TONFANS_DEPS_PROMISE__ = (async () => {
    const [umiDefaults, cm, tm, wa, toolbox, umiCore] = await Promise.all([
      import('https://esm.sh/@metaplex-foundation/umi-bundle-defaults@1.0.1'),
      import('https://esm.sh/@metaplex-foundation/mpl-candy-machine@6.0.0'),
      import('https://esm.sh/@metaplex-foundation/mpl-token-metadata@3.4.0'),
      import('https://esm.sh/@metaplex-foundation/umi-signer-wallet-adapters@0.9.1'),
      import('https://esm.sh/@metaplex-foundation/mpl-toolbox@0.9.1'),
      import('https://esm.sh/@metaplex-foundation/umi@1.0.1'),
    ]);

    return {
      // UMI
      createUmi: umiDefaults.createUmi,
      generateSigner: umiCore.generateSigner,
      publicKey: umiCore.publicKey,
      transactionBuilder: umiCore.transactionBuilder,

      // Candy Machine
      mplCandyMachine: cm.mplCandyMachine,
      fetchCandyMachine: cm.fetchCandyMachine,
      mintV2: cm.mintV2,

      // Token Metadata plugin (required by CM)
      mplTokenMetadata: tm.mplTokenMetadata,

      // Wallet identity + compute units
      walletAdapterIdentity: wa.walletAdapterIdentity,
      setComputeUnitLimit: toolbox.setComputeUnitLimit,
    };
  })();

  return __TONFANS_DEPS_PROMISE__;
}

// ---- 4 CANDY MACHINES CONFIG (EDIT THESE) ----
const CM_CLUSTER = "devnet"; // "devnet" | "mainnet-beta"
const CM_RPC =
  CM_CLUSTER === "devnet" ? "https://api.devnet.solana.com" : "https://api.mainnet-beta.solana.com";

// ✅ EACH TIER HAS ITS OWN CANDY MACHINE
const CM_BY_TIER = {
  littlegen: "Hr9YzscC71vdHifZR4jRvMd8JmmGxbJrS6j7QckEVqKy",         // LGEN (500) DEVNET
  biggen: "Ewhn2nJV6tbvq59GMahyWmS54jQWL4n3mrsoVM8n8GHH",            // BGEN (500) DEVNET
  littlegen_diamond: "8L5MLvbvM9EsZ8nb1NAwqzEXuVsiq5x5fHGNKchz6UQR", // LDIA (185) DEVNET
  biggen_diamond: "EyjoAcKwkfNo8NqCZczHHnNSi3ccYpnCetkBUwbqCien"     // BDIA (185) DEVNET
};

// ---- Original inline script (wallet UX + tier selection + sticky bar etc.) ----
    // =========================
    // CONFIG — set these after deploy
    // =========================
    // Treasury wallet (same as in sugar configs):
    const TREASURY_ADDRESS = ""; // e.g. "DeF...456"
    // Optional: collection page / marketplace link
    const COLLECTION_LINK = ""; // e.g. "https://magiceden.us/marketplace/..."
    // =========================

    const tiers = {
      littlegen: { label: "LittlGEN", price: 0.10, supply: 500, cm: "littlegen" },
      biggen: { label: "BigGEN", price: 0.125, supply: 500, cm: "biggen" },
      littlegen_diamond: { label: "LittlGEN Diamond", price: 0.15, supply: 185, cm: "littlegen_diamond" },
      biggen_diamond: { label: "BigGEN Diamond", price: 0.20, supply: 185, cm: "biggen_diamond" },
    };

    // State
    let selected = "littlegen";
    let qty = 1;
    let readyTimer = null;

    // Elements
    const tierCards = document.querySelectorAll(".tier-card");
    const selectedTierLabel = document.getElementById("selectedTierLabel");
    const selectedTierThumb = document.getElementById("selectedTierThumb");
    const selectedTierName = document.getElementById("selectedTierName");
    const selectedTierMeta = document.getElementById("selectedTierMeta");
    const priceEl = document.getElementById("price");
    const totalEl = document.getElementById("total");
    const qtyEl = document.getElementById("qty");
    const mintBtn = document.getElementById("mintBtn");
    const mintHint = document.getElementById("mintHint");
    // Sticky mint bar
    const stickyBar = document.getElementById("stickyMintBar");
    const stickySelected = document.getElementById("stickySelected");
    const stickyActionBtn = document.getElementById("stickyActionBtn");
    const stickyChangeBtn = document.getElementById("stickyChangeBtn");
    let userTierPicked = false;

    const walletStatus = document.getElementById("walletStatus");
    const walletAddr = document.getElementById("walletAddr");
    const connectBtn = document.getElementById("connectBtn");
    const disconnectBtn = document.getElementById("disconnectBtn");

    const cmAddress = document.getElementById("cmAddress");
    const treasuryAddress = document.getElementById("treasuryAddress");
    const explorerLink = document.getElementById("explorerLink");
    const shareX = document.getElementById("shareX");
    const netPill = document.getElementById("netPill");
    const walletPill = document.getElementById("walletPill");
    const readyPill = document.getElementById("readyPill");

    // Helpers
    function fmt(n){ return (Math.round(n*1000)/1000).toFixed(n === 0.125 ? 3 : 2).replace(/\\.00$/, ".00"); }
    
    function setTier(key, opts = {}){
      selected = key;
      const t = tiers[selected];

      tierCards.forEach(c => c.classList.toggle("tier-selected", c.dataset.tier === selected));

      const silent = !!opts.silent;

      if(!silent){
        userTierPicked = true;
        const activeTier = Array.from(tierCards).find(c => c.dataset.tier === selected);
        if(activeTier){
          activeTier.classList.add("tier-pulse");
          setTimeout(() => activeTier.classList.remove("tier-pulse"), 520);
        }
        if(stickyBar && stickyBar.classList.contains("hidden")) showStickyBar();
      }

      selectedTierLabel.textContent = t.label;
      selectedTierName.textContent = t.label;
      selectedTierMeta.textContent = `supply: ${t.supply}`;
      priceEl.textContent = fmt(t.price);
      totalEl.textContent = fmt(t.price * qty);

      const tweet = encodeURIComponent(
        `the rays aren't random.\n\ninspired by π — infinite geometry.\n\nton aesthetics. Solana mint.\n\nTier: ${t.label} (${fmt(t.price)} SOL)`
      );
      shareX.href = "https://x.com/intent/tweet?text=" + tweet;

      updateStickyBar();
    }

    function setQty(newQty){
      const max = 3;
      if(newQty < 1) newQty = 1;
      if(newQty > max) newQty = max;
      qty = newQty;
      qtyEl.textContent = qty;
      const t = tiers[selected];
      totalEl.textContent = fmt(t.price * qty);
      updateStickyBar();
    }

    function updateStickyBar(){
      if(!stickyBar) return;
      const t = tiers[selected];
      if(stickySelected) stickySelected.textContent = `${t.label} × ${qty} = ${fmt(t.price * qty)} SOL`;
    }

    function showStickyBar(){
      if(!stickyBar) return;
      stickyBar.classList.remove("hidden");
      stickyBar.classList.add("sticky-in");
      document.body.classList.add("has-sticky");
    }

    // Wallet state management
    const WALLET_CACHE_KEY = "tonfans_wallet_pubkey";
    const walletState = { pubkey: "" };

    function normalizePubkey(pk) {
      if (!pk) return "";
      try {
        if (typeof pk === "object" && typeof pk.toString === "function") return pk.toString();
        if (typeof pk === "string") return pk;
      } catch {}
      return "";
    }

    function setWalletPubkey(pk) {
      const s = normalizePubkey(pk);
      walletState.pubkey = s;
      if (s) sessionStorage.setItem(WALLET_CACHE_KEY, s);
    }

    function clearWalletPubkey() {
      walletState.pubkey = "";
      sessionStorage.removeItem(WALLET_CACHE_KEY);
    }

    function isWalletConnected() {
      return !!walletState.pubkey;
    }

    async function bootstrapWalletState() {
      clearWalletPubkey();
      if (!hasProvider()) {
        syncConnectCTA();
        return;
      }
      const p = getProvider();
      try {
        const res = await p.connect({ onlyIfTrusted: true });
        setWalletPubkey(res?.publicKey || p.publicKey);
      } catch (_) {
        clearWalletPubkey();
      }
      syncConnectCTA();
    }

    function getProvider(){
      return window.solana || (window.phantom && window.phantom.solana) || null;
    }

    function hasProvider(){
      const p = getProvider();
      return !!(p && typeof p.connect === "function");
    }

    function syncConnectCTA(){
      const providerOk = hasProvider();
      const connected = isWalletConnected();

      if (!providerOk){
        connectBtn.textContent = "Open in Phantom";
        connectBtn.dataset.mode = "phantom";
        disconnectBtn.classList.add("hidden");
        connectBtn.classList.remove("hidden");
        walletStatus.textContent = "Phantom not found";
        walletStatus.style.color = "var(--warn)";
        walletAddr.classList.add("hidden");
        updateMintReady();
        updateStickyBar();
        updateHealth();
        return;
      }

      connectBtn.textContent = "Connect Wallet";
      connectBtn.dataset.mode = "connect";

      if (connected){
        const pk = walletState.pubkey || "";
        walletAddr.textContent = pk ? (pk.slice(0,4) + "…" + pk.slice(-4)) : "";
        walletAddr.classList.toggle("hidden", !pk);
        walletStatus.textContent = "Connected";
        walletStatus.style.color = "var(--good)";
        connectBtn.classList.add("hidden");
        disconnectBtn.classList.remove("hidden");
      }else{
        walletAddr.classList.add("hidden");
        walletStatus.textContent = "Not connected";
        walletStatus.style.color = "var(--warn)";
        connectBtn.classList.remove("hidden");
        disconnectBtn.classList.add("hidden");
      }

      updateMintReady();
      updateStickyBar();
      updateHealth();
    }

    async function connectWallet(){
      if (!hasProvider()){
        try{ localStorage.setItem("tonfans_autoconnect", "1"); }catch(_e){}
        window.location.href = phantomDeepLink();
        return;
      }

      const provider = getProvider();
      try{
        const res = await provider.connect();
        setWalletPubkey(res?.publicKey || provider.publicKey);
        updateMintReady();
        updateStickyBar();
      }catch(e){
        clearWalletPubkey();
        updateMintReady();
        updateStickyBar();
      }

      syncConnectCTA();
    }

    async function disconnectWallet(){
      try{
        await getProvider()?.disconnect?.();
      }catch(e){}
      clearWalletPubkey();
      syncConnectCTA();
    }

    function updateHealth(){
      const hasCM = Object.values(CM_BY_TIER).some(addr => addr && addr.length > 20);
      const providerOk = hasProvider();
      const hasWallet = isWalletConnected();
      const isReady = hasWallet;

      if (netPill) netPill.textContent = (CM_CLUSTER === "devnet" ? "Devnet" : "Mainnet");
      if (walletPill) {
        walletPill.textContent = hasWallet && walletState.pubkey ? (walletState.pubkey.slice(0,4) + "…" + walletState.pubkey.slice(-4)) : "Not connected";
      }
      if (readyPill) {
        readyPill.textContent = isReady ? "Yes" : "No";
        const wrap = readyPill.closest('.pill');
        if (wrap) wrap.classList.toggle('ready-yes', isReady);
      }
    }

    function updateMintReady(){
      const hasCM = Object.values(CM_BY_TIER).some(addr => addr && addr.length > 20);
      const providerOk = hasProvider();
      const hasWallet = isWalletConnected();

      if (hasCM && hasWallet){
        mintBtn.disabled = false;
        mintBtn.style.opacity = "1";
        mintBtn.style.cursor = "pointer";
        mintHint.textContent = "Status: ready to mint.";
      } else {
        mintBtn.disabled = true;
        mintBtn.style.opacity = ".55";
        mintBtn.style.cursor = "not-allowed";
        if (!hasCM) {
          mintHint.textContent = "Status: waiting for Candy Machine deployment.";
        } else {
          mintHint.textContent = "Status: connect wallet to mint.";
        }
      }

      updateHealth();
      updateStickyBar();
    }

    function initConfig(){
      // Show CM addresses status
      const hasCM = Object.values(CM_BY_TIER).some(addr => addr && addr.length > 20);
      cmAddress.textContent = hasCM ? "Deployed (4 CM)" : "TBD";
      treasuryAddress.textContent = TREASURY_ADDRESS ? TREASURY_ADDRESS : "TBD";

      if (COLLECTION_LINK){
        explorerLink.textContent = "Marketplace";
        explorerLink.href = COLLECTION_LINK;
      }

      updateMintReady();
      updateStickyBar();
    }

    // Wallet events
    try{
      const p = getProvider();
      if (p && typeof p.on === "function"){
        p.on("connect", syncConnectCTA);
        p.on("disconnect", () => {
          clearWalletPubkey();
          syncConnectCTA();
        });
        p.on("accountChanged", (pk) => {
          const s = normalizePubkey(pk);
          if (!s) clearWalletPubkey();
          else setWalletPubkey(pk);
          syncConnectCTA();
        });
      }
    }catch(_){}

    // Events
    tierCards.forEach((c) =>
      c.addEventListener("click", () =>
        setTier(c.dataset.tier, { thumbSrc: c.querySelector("img")?.getAttribute("src") || "" })
      )
    );
    document.getElementById("qtyMinus").addEventListener("click", () => setQty(qty - 1));
    document.getElementById("qtyPlus").addEventListener("click", () => setQty(qty + 1));
    connectBtn.addEventListener("click", connectWallet);
    disconnectBtn.addEventListener("click", disconnectWallet);

    if (stickyChangeBtn){
      stickyChangeBtn.addEventListener("click", () => {
        const el = document.getElementById("tiers");
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    mintBtn.addEventListener("click", mintFromSelectedTier);
    document.getElementById("year").textContent = new Date().getFullYear();

    // Bootstrap wallet state
    bootstrapWalletState().then(async () => {
      initConfig();
      await autoConnectIfRequested();
      setTier(selected, { silent: true });
      setQty(1);
    });

    async function autoConnectIfRequested(){
      if (!shouldAutoConnect()) return;
      clearAutoConnect();
      if (!hasProvider() || isWalletConnected()){
        syncConnectCTA();
        return;
      }
      try {
        const res = await getProvider().connect();
        setWalletPubkey(res?.publicKey || getProvider().publicKey);
      } catch (e) {
        // user may reject
      }
      syncConnectCTA();
    }

    function shouldAutoConnect(){
      try {
        return localStorage.getItem("tonfans_autoconnect") === "1";
      } catch {
        return false;
      }
    }

    function clearAutoConnect(){
      try {
        localStorage.removeItem("tonfans_autoconnect");
      } catch {}
    }

    function phantomDeepLink(){
      const url = typeof window !== "undefined" ? window.location.href : "";
      const params = new URLSearchParams({
        redirect: url,
        cluster: CM_CLUSTER === "devnet" ? "devnet" : "mainnet-beta",
        autoconnect: "1"
      });
      const enc = encodeURIComponent(url);
      return `https://phantom.app/ul/browse/${enc}?${params.toString()}`;
    }

// ---- Candy Machine mint integration (4 CM) ----

function phantomAdapter(provider) {
  // Minimal WalletAdapter wrapper for Phantom provider (UMI walletAdapterIdentity)
  const adapter = {
    name: "Phantom",
    url: "https://phantom.app",
    icon: "https://phantom.app/favicon.ico",
    readyState: "Installed",
    publicKey: provider.publicKey || null,
    connecting: false,
    connected: !!provider.publicKey,

    connect: async () => {
      const res = await provider.connect();
      adapter.publicKey = provider.publicKey || res?.publicKey || null;
      adapter.connected = !!adapter.publicKey;
      return res;
    },

    disconnect: async () => {
      await provider.disconnect();
      adapter.publicKey = null;
      adapter.connected = false;
    },

    signTransaction: async (tx) => provider.signTransaction(tx),
    signAllTransactions: async (txs) => provider.signAllTransactions(txs),
    signMessage: async (msg) => provider.signMessage(msg),
    on: (event, handler) => provider.on?.(event, handler),
  };

  return adapter;
}

async function mintFromSelectedTier() {
  const t = tiers[selected];
  
  // ✅ Get CM address for THIS tier
  const cmAddress = CM_BY_TIER[selected];
  if (!cmAddress) {
    alert("Candy Machine address is not set yet (" + selected + ")");
    return;
  }

  if (!walletState.pubkey) {
    alert("Please connect wallet first");
    return;
  }

  const prevHint = mintHint?.textContent || "Mint";
  if (mintHint) mintHint.textContent = "Minting...";
  mintBtn.disabled = true;
  mintBtn.classList.add("disabled");

  try {
        const { createUmi, mplCandyMachine, fetchCandyMachine, mintV2, mplTokenMetadata, walletAdapterIdentity, setComputeUnitLimit, generateSigner, publicKey, transactionBuilder } = await loadTonfansDeps();

    const umi = createUmi(CM_RPC);

    const provider = getProvider();
    if (!provider) throw new Error("Phantom provider not found");

    const adapter = phantomAdapter(provider);
    umi.use(walletAdapterIdentity(adapter));
    umi.use(mplCandyMachine());
    umi.use(mplTokenMetadata());

    // ✅ Fetch THIS CM (not a guard group)
    const candyMachine = await fetchCandyMachine(umi, publicKey(cmAddress));

    // Build transaction for qty mints
    let tb = transactionBuilder(umi).add(setComputeUnitLimit(umi, { units: 450000 }));

    for (let i = 0; i < qty; i++) {
      tb = tb.add(
        mintV2(umi, {
          candyMachine: candyMachine.publicKey,
          collectionMint: candyMachine.collectionMint,
          collectionUpdateAuthority: candyMachine.collectionUpdateAuthority,
          tokenStandard: candyMachine.tokenStandard,
          // ✅ No guard groups (4CM approach)
          // Just mint from this specific CM
        })
      );
    }

    await tb.sendAndConfirm(umi);

    if (mintHint) mintHint.textContent = "Mint submitted ✓";
    mintBtn.disabled = false;
    mintBtn.classList.remove("disabled");
    setTimeout(() => {
      if (mintHint) mintHint.textContent = prevHint;
    }, 2500);
  } catch (err) {
    console.error("Mint error:", err);
    if (mintHint) mintHint.textContent = `Error: ${err.message.slice(0, 40)}...`;
    mintBtn.disabled = false;
    mintBtn.classList.remove("disabled");
  }
}

// Expose for debugging
window.__TONFANS_4CM__ = {
  CM_CLUSTER,
  CM_RPC,
  CM_BY_TIER,
  tiers,
  mintFromSelectedTier,
};
