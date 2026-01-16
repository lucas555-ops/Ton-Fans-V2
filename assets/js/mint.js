// assets/js/mint.js (v23) — TON Fans (AUTO devnet/mainnet)
// Fixes / features:
// - Auto cluster (window.TONFANS_CONFIG.cluster OR ?cluster=devnet/mainnet-beta OR localStorage)
// - RPC failover list per cluster
// - Candy Guard mintLimit counter (multi-CDN) + PRE-CHECK to avoid botTax on 3/3
// - Solscan links auto by cluster
// - Best-effort "truth check" after mint (metadata fetch)

/* global window, document, location */

const MINT_LIMIT_ID = 1;          // must match Candy Guard mintLimit.id
const MAX_QTY = 3;                // project rule: max 3 per wallet
const CU_LIMIT = 800_000;

const DEVNET_RPCS = [
  "https://api.devnet.solana.com",
  "https://rpc.ankr.com/solana_devnet",
];

const MAINNET_RPCS = [
  "https://api.mainnet-beta.solana.com",
  "https://rpc.ankr.com/solana",
];

const RPC_BY_CLUSTER = {
  devnet: DEVNET_RPCS,
  "mainnet-beta": MAINNET_RPCS,
  mainnet: MAINNET_RPCS,
};

function normalizeCluster(v){
  const s = String(v || "").trim();
  if (!s) return "devnet";
  if (s === "mainnet") return "mainnet-beta";
  if (s === "mainnetbeta") return "mainnet-beta";
  return s;
}

function detectCluster(){
  try {
    const qs = new URLSearchParams(location.search);
    const q = qs.get("cluster");
    if (q) return normalizeCluster(q);
  } catch {}

  try {
    const cfg = window.TONFANS_CONFIG?.cluster;
    if (cfg) return normalizeCluster(cfg);
  } catch {}

  try {
    const saved = localStorage.getItem("tonfans:cluster");
    if (saved) return normalizeCluster(saved);
  } catch {}

  return "devnet";
}

const CLUSTER = normalizeCluster(detectCluster());
try { localStorage.setItem("tonfans:cluster", CLUSTER); } catch {}

console.log("[TONFANS] mint.js v23 loaded, cluster:", CLUSTER);

// ---------- Candy Machine addresses (DEVNET in this repo) ----------
// If you switch to mainnet, put mainnet CM ids here (or pass devnet cluster).
const CM_BY_TIER_DEVNET = {
  lgen: "Hr9YzscC71vdHifZR4jRvMd8JmmGxbJrS6j7QckEVqKy",
  bgen: "Ewhn2nJV6tbvq59GMahyWmS54jQWL4n3mrsoVM8n8GHH",
  ldia: "8L5MLvbvM9EsZ8nb1NAwqzEXuVsiq5x5fHGNKchz6UQR",
  bdia: "EyjoAcKwkfNo8NqCZczHHnNSi3ccYpnCetkBUwbqCien",
};

const CM_BY_TIER_MAINNET = {
  lgen: null,
  bgen: null,
  ldia: null,
  bdia: null,
};

function getCmMap(cluster){
  const c = normalizeCluster(cluster);
  return c === "devnet" ? CM_BY_TIER_DEVNET : CM_BY_TIER_MAINNET;
}

const TIER_ALIASES = {
  littlegen: "lgen",
  biggen: "bgen",
  littlegen_diamond: "ldia",
  biggen_diamond: "bdia",
  "littlegen-diamond": "ldia",
  "biggen-diamond": "bdia",
  lgen: "lgen",
  bgen: "bgen",
  ldia: "ldia",
  bdia: "bdia",
};

const TIER_LABEL = {
  lgen: "LittlGEN",
  bgen: "BigGEN",
  ldia: "LittlGEN Diamond",
  bdia: "BigGEN Diamond",
};

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function shortPk(s){ return s ? String(s).slice(0,4) + "…" + String(s).slice(-4) : ""; }

function emit(){
  const payload = JSON.parse(JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("tonfans:state", { detail: payload }));
}

function setHint(msg, kind="info"){
  state.hint = msg || "";
  state.hintKind = kind;
  emit();
}

function setBusy(on, label=""){
  state.busy = !!on;
  state.busyLabel = label || "";
  emit();
}

function emitToast(message, kind="info"){
  if (!message) return;
  try {
    window.dispatchEvent(new CustomEvent("tonfans:toast", {
      detail: { message: String(message), kind: kind || "info" }
    }));
  } catch {}
}

function emitQty(qty){
  try {
    const q = Number(qty);
    if (!Number.isFinite(q)) return;
    window.dispatchEvent(new CustomEvent("tonfans:qty", { detail: { qty: q } }));
  } catch {}
}

function emitSupplyUpdate(supplyData){
  try {
    window.dispatchEvent(new CustomEvent("tonfans:supply", { detail: supplyData }));
  } catch {}
}

// ---------- Candy Guard mint counter ----------
let CGSDK = null;
async function loadCgSdk(){
  if (CGSDK) return CGSDK;

  const candidates = [
    "https://esm.sh/@metaplex-foundation/mpl-candy-guard@0.7.0?bundle",
    "https://esm.sh/@metaplex-foundation/mpl-candy-guard@0.6.0?bundle",
    "https://esm.sh/@metaplex-foundation/mpl-candy-guard@0.5.1?bundle",
  ];

  let last = null;
  for (const url of candidates){
    try {
      const mod = await import(url);
      CGSDK = {
        safeFetchMintCounterFromSeeds: mod.safeFetchMintCounterFromSeeds,
        fetchMintCounter: mod.fetchMintCounter,
        findMintCounterPda: mod.findMintCounterPda,
      };
      console.log("[TONFANS] Candy Guard SDK loaded:", url);
      return CGSDK;
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error("Failed to load Candy Guard SDK");
}

function unwrapOption(v){
  if (!v) return null;
  const kind = v.__kind ?? v.__option ?? null;
  if (kind && String(kind).toLowerCase().includes("none")) return null;
  if (v.value != null) return v.value;
  if (Array.isArray(v.fields) && v.fields.length) return v.fields[0];
  return v;
}

function extractCounterCount(counter){
  const c = unwrapOption(counter);
  const raw = c?.count ?? c?.mintCount ?? c?.data?.count ?? 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

async function fetchMintedCountOnChain(){
  if (!state.walletConnected || !state.wallet || !state.guardPk) return null;

  try {
    await loadSdk();
    if (!umi) await rebuildUmi();
    const sdk = SDK;
    const cg = await loadCgSdk();

    const user = sdk.publicKey(String(state.wallet));
    const candyGuard = sdk.publicKey(String(state.guardPk));
    const id = MINT_LIMIT_ID;

    let counter = null;

    // Best way
    if (typeof cg.safeFetchMintCounterFromSeeds === "function"){
      try {
        counter = await cg.safeFetchMintCounterFromSeeds(umi, { id, user, candyGuard });
      } catch (e) {
        const msg = String(e?.message || e || "").toLowerCase();
        if (msg.includes("accountnotfound") || msg.includes("account not found")) return 0;
      }
    }

    // Fallback
    if (!counter && typeof cg.findMintCounterPda === "function" && typeof cg.fetchMintCounter === "function"){
      try {
        const pda = cg.findMintCounterPda(umi, { id, user, candyGuard });
        counter = await cg.fetchMintCounter(umi, pda);
      } catch (e) {
        const msg = String(e?.message || e || "").toLowerCase();
        if (msg.includes("accountnotfound") || msg.includes("account not found")) return 0;
      }
    }

    return counter ? extractCounterCount(counter) : 0;
  } catch (error) {
    console.error("[TONFANS] Error fetching mint counter:", error);
    return null;
  }
}

async function updateWalletMintCounter(){
  const cnt = await fetchMintedCountOnChain();

  if (cnt === null) {
    state.mintedCount = null;
    state.mintedRemaining = null;
    return null;
  }

  const capped = Math.min(MAX_QTY, Number(cnt || 0));
  state.mintedCount = capped;
  state.mintedRemaining = Math.max(0, MAX_QTY - capped);

  if (state.mintedRemaining === 0) emitQty(1);
  emit();
  return capped;
}

// ---------- wallet helpers ----------
function normalizeTier(t){
  const key = String(t || "").trim();
  return TIER_ALIASES[key] || null;
}

function getProvider(){ return window.solana || null; }

async function connectWallet(){
  const p = getProvider();
  if (!p) throw new Error("No Solana wallet found. Install Phantom.");
  if (!p.publicKey) await p.connect();
  state.walletConnected = !!p.publicKey;
  state.wallet = p.publicKey ? p.publicKey.toString() : null;
  state.walletShort = state.wallet ? shortPk(state.wallet) : null;
  emit();
  await refresh();
}

async function disconnectWallet(){
  const p = getProvider();
  if (p?.disconnect) { try { await p.disconnect(); } catch {} }
  state.walletConnected = false;
  state.wallet = null;
  state.walletShort = null;
  emit();
}

async function toggleConnect(){
  const p = getProvider();
  if (!p) throw new Error("No Solana wallet found.");
  if (p.publicKey) await disconnectWallet();
  else await connectWallet();
}

// ---------- SDK dynamic import ----------
let SDK = null;
async function loadSdk(){
  if (SDK) return SDK;
  const umiBundle = await import("https://esm.sh/@metaplex-foundation/umi-bundle-defaults@1.4.1?bundle");
  const umiCore   = await import("https://esm.sh/@metaplex-foundation/umi@1.3.0?bundle");
  const cmSdk     = await import("https://esm.sh/@metaplex-foundation/mpl-candy-machine@6.1.0?bundle");
  const tmSdk     = await import("https://esm.sh/@metaplex-foundation/mpl-token-metadata@3.4.0?bundle");
  const waSdk     = await import("https://esm.sh/@metaplex-foundation/umi-signer-wallet-adapters@1.4.1?bundle");
  const toolbox   = await import("https://esm.sh/@metaplex-foundation/mpl-toolbox@0.10.0?bundle");

  SDK = {
    createUmi: umiBundle.createUmi,
    publicKey: umiCore.publicKey,
    generateSigner: umiCore.generateSigner,
    transactionBuilder: umiCore.transactionBuilder,
    mplCandyMachine: cmSdk.mplCandyMachine,
    fetchCandyMachine: cmSdk.fetchCandyMachine,
    fetchCandyGuard: cmSdk.fetchCandyGuard,
    mintV2: cmSdk.mintV2,
    mplTokenMetadata: tmSdk.mplTokenMetadata,
    findMetadataPda: tmSdk.findMetadataPda,
    fetchMetadata: tmSdk.fetchMetadata,
    walletAdapterIdentity: waSdk.walletAdapterIdentity,
    setComputeUnitLimit: toolbox.setComputeUnitLimit,
  };
  return SDK;
}

let rpcIdx = 0;
let umi = null;

function rpcList(){
  return RPC_BY_CLUSTER[state.cluster] || RPC_BY_CLUSTER.devnet;
}

function currentRpc(){
  const list = rpcList();
  return list[rpcIdx] || list[0];
}

async function rebuildUmi(){
  const sdk = await loadSdk();
  umi = sdk.createUmi(currentRpc()).use(sdk.mplCandyMachine()).use(sdk.mplTokenMetadata());
  state.rpc = currentRpc();
  emit();
  return umi;
}

function rotateRpc(){
  const list = rpcList();
  rpcIdx = (rpcIdx + 1) % list.length;
  return rebuildUmi();
}

function attachWalletIdentity(){
  const p = getProvider();
  if (!p?.publicKey) throw new Error("Wallet not connected.");
  const sdk = SDK;

  const walletAdapter = {
    publicKey: p.publicKey,
    connected: true,
    connecting: false,
    disconnecting: false,
    connect: async () => { await p.connect(); },
    disconnect: async () => { if (p.disconnect) await p.disconnect(); },
    signTransaction: async (tx) => {
      if (!p.signTransaction) throw new Error("Wallet does not support signTransaction");
      return await p.signTransaction(tx);
    },
    signAllTransactions: async (txs) => {
      if (p.signAllTransactions) return await p.signAllTransactions(txs);
      const out = [];
      for (const tx of txs) out.push(await walletAdapter.signTransaction(tx));
      return out;
    }
  };

  umi.use(sdk.walletAdapterIdentity(walletAdapter));
}

function isRecentBlockhashFailed(err){
  const m = String(err?.message || err || "");
  return m.includes("failed to get recent blockhash")
      || m.includes("Expected the value to satisfy a union")
      || m.includes("expected the value to satisfy a union")
      || m.includes("union of `type | type`")
      || m.includes("union of `type | type`");
}

function isBlockhashNotFound(err){
  const m = String(err?.message || err || "").toLowerCase();
  return m.includes("blockhash not found") || m.includes("blockhashnotfound");
}

function isForbidden(err){
  const m = String(err?.message || err || "").toLowerCase();
  return m.includes("access forbidden") || m.includes("forbidden") || m.includes("403");
}

async function withFailover(fn){
  let last = null;
  const list = rpcList();
  for (let attempt = 0; attempt < list.length; attempt++){
    try {
      if (!umi) await rebuildUmi();
      return await fn();
    } catch (e) {
      last = e;
      if (isForbidden(e) || isBlockhashNotFound(e) || isRecentBlockhashFailed(e)) {
        try { await rotateRpc(); } catch {}
        continue;
      }
      throw e;
    }
  }
  throw last || new Error("RPC failover exhausted");
}

// ---------- CM / Guard parsing helpers ----------
function toNumberSafe(v){
  if (v == null) return null;
  try {
    if (typeof v === "bigint") return Number(v);
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string") {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    if (typeof v === "object") {
      const maybe = v.basisPoints ?? v.value ?? v.amount ?? v.number ?? null;
      if (maybe != null) return toNumberSafe(maybe);
    }
  } catch {}
  return null;
}

function resolveGuardsByLabels(candyGuard, labels){
  const groups = candyGuard?.groups || [];
  for (const label of labels){
    const g = groups.find(x => x?.label === label);
    if (g) return { group: label, guards: g.guards || null };
  }
  return { group: null, guards: candyGuard?.guards || null };
}

function extractSolPaymentLamports(guards){
  const gp = guards?.solPayment;
  if (!gp) return null;
  const raw = gp.lamports ?? gp.amount ?? gp.value ?? gp.basisPoints ?? null;
  const n = toNumberSafe(raw);
  return (n == null) ? null : n;
}

function extractSolPaymentDestination(guards){
  const gp = guards?.solPayment;
  if (!gp) return null;
  return gp.destination ?? gp.treasury ?? gp.receiver ?? null;
}

function lamportsToSol(l){
  const n = Number(l);
  if (!Number.isFinite(n)) return null;
  return n / 1_000_000_000;
}

async function resolveCollectionUpdateAuthority(cm, collectionMint){
  const direct = cm?.collectionUpdateAuthority
    ?? cm?.collection?.updateAuthority
    ?? cm?.collection?.updateAuthorityAddress
    ?? cm?.collectionUpdateAuthorityAddress
    ?? null;

  if (direct) return direct;

  try {
    await loadSdk();
    if (!umi) await rebuildUmi();
    const sdk = SDK;

    if (!sdk.findMetadataPda || !sdk.fetchMetadata) return null;

    const mintPk = (typeof collectionMint === "string") ? sdk.publicKey(collectionMint) : collectionMint;
    const mdPda = sdk.findMetadataPda(umi, { mint: mintPk });
    const md = await withFailover(async () => await sdk.fetchMetadata(umi, mdPda));
    return md?.updateAuthority ?? null;
  } catch {
    return null;
  }
}

// ---------- explorer links ----------
function solscanTxUrl(sig){
  if (!sig) return "";
  const c = normalizeCluster(state.cluster);
  if (c === "devnet") return `https://solscan.io/tx/${sig}?cluster=devnet`;
  return `https://solscan.io/tx/${sig}`;
}

// ---------- state ----------
const state = {
  cluster: CLUSTER,
  rpc: (RPC_BY_CLUSTER[CLUSTER] || DEVNET_RPCS)[0],

  tierRaw: null,
  tierKey: null,
  tierLabel: "—",
  cmId: null,

  guardPk: null,
  guardGroup: null,

  walletConnected: false,
  wallet: null,
  walletShort: null,

  // supply
  itemsAvailable: null,
  itemsRedeemed: null,
  itemsRemaining: null,

  // pricing
  priceSol: null,
  solDestination: null,
  isFree: false,

  // flags
  ready: false,
  mintLimit: MAX_QTY,

  // per-wallet mint counter
  mintedCount: null,
  mintedRemaining: null,

  // recent tx list
  recentTxSignatures: [], // [{signature, explorerUrl, timestamp, shortSig}]

  // ui
  busy: false,
  busyLabel: "",
  hint: "Select a tier.",
  hintKind: "info",
};

function getState(){ return JSON.parse(JSON.stringify(state)); }

// ---------- core ----------
async function setTier(tierRaw){
  const key = normalizeTier(tierRaw);

  state.tierRaw = tierRaw || null;
  state.tierKey = key;
  state.tierLabel = key ? TIER_LABEL[key] : "—";

  const cmMap = getCmMap(state.cluster);
  state.cmId = key ? (cmMap?.[key] || null) : null;

  // reset derived
  state.guardPk = null;
  state.guardGroup = null;
  state.itemsAvailable = null;
  state.itemsRedeemed = null;
  state.itemsRemaining = null;
  state.priceSol = null;
  state.solDestination = null;
  state.isFree = false;
  state.ready = false;
  state.mintedCount = null;
  state.mintedRemaining = null;

  try { localStorage.setItem("tonfans:tier", tierRaw || ""); } catch {}

  emit();

  if (!state.cmId) {
    setHint("Tier selected, but CM id is missing for this cluster.", "error");
    return;
  }

  await refresh();
}

async function refresh(){
  if (!state.cmId) {
    state.ready = false;
    setHint("Select a tier to load Candy Machine.", "info");
    emit();
    return;
  }

  setBusy(true, "Loading…");
  setHint("Loading Candy Machine…", "info");

  try {
    await loadSdk();
    if (!umi) await rebuildUmi();

    const sdk = SDK;
    const cmPk = sdk.publicKey(state.cmId);

    const cm = await withFailover(async () => await sdk.fetchCandyMachine(umi, cmPk));

    const available = toNumberSafe(cm.itemsAvailable);
    const redeemed  = toNumberSafe(cm.itemsRedeemed);

    let remaining = null;
    if (available != null && redeemed != null) remaining = Math.max(available - redeemed, 0);

    state.itemsAvailable = available;
    state.itemsRedeemed = redeemed;
    state.itemsRemaining = remaining;

    // fetch guard
    let cg = null;
    try {
      cg = await withFailover(async () => await sdk.fetchCandyGuard(umi, cm.mintAuthority));
      state.guardPk = cm.mintAuthority?.toString?.() || null;
    } catch {
      cg = null;
      state.guardPk = null;
    }

    if (!cg) {
      state.ready = false;
      setHint("Candy Machine NOT wrapped by Candy Guard.", "error");
      emit();
      return;
    }

    // label candidates (raw, dashed, tierKey, default)
    const raw = String(state.tierRaw || "");
    const labels = [raw, raw.replaceAll("_","-"), state.tierKey, "default"].filter(Boolean);
    const resolved = resolveGuardsByLabels(cg, labels);
    state.guardGroup = resolved.group;

    // price
    const lamports = extractSolPaymentLamports(resolved.guards);
    const dest = extractSolPaymentDestination(resolved.guards);
    state.solDestination = dest;
    state.isFree = (lamports == null);
    state.priceSol = state.isFree ? 0 : lamportsToSol(lamports);

    // readiness
    if (state.itemsRemaining === 0) {
      state.ready = false;
      setHint(`Sold out (${state.itemsRedeemed ?? "?"}/${state.itemsAvailable ?? "?"}).`, "error");
    } else {
      state.ready = true;
      const p = state.isFree ? "price: FREE" : `price: ${state.priceSol} SOL`;
      const d = state.solDestination ? ` • dest: ${shortPk(String(state.solDestination))}` : "";
      const sup = (state.itemsRemaining == null) ? "" : ` • left: ${state.itemsRemaining}`;
      const grp = state.guardGroup ? `group: ${state.guardGroup}` : "base guards";
      setHint(`Ready (${grp}${d}, ${p}${sup}).`, "ok");
    }

    emitSupplyUpdate({
      itemsAvailable: state.itemsAvailable,
      itemsRedeemed: state.itemsRedeemed,
      itemsRemaining: state.itemsRemaining,
    });

    // per-wallet mint counter
    await updateWalletMintCounter();
    emit();
  } catch (e) {
    state.ready = false;
    state.priceSol = null;
    setHint(`RPC error: ${e?.message || String(e)}`, "error");
    emit();
  } finally {
    setBusy(false, "");
  }
}

// --- recent tx list ---
function addRecentTransaction(signature, mintPkStr){
  if (!signature) return;

  const explorerUrl = solscanTxUrl(signature);
  const txRecord = {
    signature,
    explorerUrl,
    timestamp: Date.now(),
    shortSig: String(signature).slice(0, 8) + "…" + String(signature).slice(-8),
    mint: mintPkStr || null,
  };

  state.recentTxSignatures.unshift(txRecord);
  if (state.recentTxSignatures.length > 10) state.recentTxSignatures = state.recentTxSignatures.slice(0, 10);

  try { localStorage.setItem("tonfans:recentTxs", JSON.stringify(state.recentTxSignatures)); } catch {}
  emit();
}

function isMintLimitError(err){
  const m = String(err?.message || err || "").toLowerCase();
  return m.includes("mint limit") || m.includes("mintlimit") || m.includes("mintlimitreached") || m.includes("mint limit reached");
}

async function mintNow(qty = 1){
  if (!state.cmId) throw new Error("Select a tier first.");
  if (!state.walletConnected) throw new Error("Connect wallet first.");
  if (!state.ready) throw new Error(state.itemsRemaining === 0 ? "Sold out." : "Not ready.");

  const q = Math.max(1, Math.min(MAX_QTY, Number(qty || 1)));

  // Pre-check mintLimit (CRITICAL: avoid sending tx that will trigger botTax)
  await updateWalletMintCounter();

  if (state.mintedRemaining !== null && state.mintedRemaining <= 0) {
    const msg = "Mint limit reached (3 per wallet)";
    setHint(msg, "error");
    emitToast(msg, "info");
    emitQty(1);
    emit();
    return; // NO TX
  }

  // adjust quantity if needed
  if (state.mintedRemaining !== null) {
    const remaining = Number(state.mintedRemaining);
    if (q > remaining) {
      const msg = `Only ${remaining}/3 remaining — adjusting quantity to ${remaining}.`;
      setHint(msg, "info");
      emitToast(msg, "info");
      if (remaining <= 0) return;
      await _executeMint(remaining);
      return;
    }
  }

  await _executeMint(q);
}

async function verifyMintMetadataBestEffort(mintPk){
  try {
    if (!mintPk) return false;
    await loadSdk();
    if (!umi) await rebuildUmi();

    const sdk = SDK;
    if (!sdk.findMetadataPda || !sdk.fetchMetadata) return false;

    const mdPda = sdk.findMetadataPda(umi, { mint: mintPk });
    const md = await withFailover(async () => await sdk.fetchMetadata(umi, mdPda));
    return !!md;
  } catch {
    return false;
  }
}

async function _executeMint(qty){
  setBusy(true, "Minting…");
  setHint(`Minting x${qty}…`, "info");

  try {
    await loadSdk();
    if (!umi) await rebuildUmi();
    attachWalletIdentity();

    const sdk = SDK;
    const cmPk = sdk.publicKey(state.cmId);

    const cm = await withFailover(async () => await sdk.fetchCandyMachine(umi, cmPk));
    const cg = await withFailover(async () => await sdk.fetchCandyGuard(umi, cm.mintAuthority));

    const raw = String(state.tierRaw || "");
    const labels = [raw, raw.replaceAll("_","-"), state.tierKey, "default"].filter(Boolean);
    const groups = cg.groups || [];
    const group = labels.find(l => groups.some(g => g.label === l)) || null;

    const resolved = resolveGuardsByLabels(cg, labels);
    const guards = resolved.guards;

    const mintArgs = {};
    if (guards?.solPayment && state.solDestination) {
      mintArgs.solPayment = { destination: sdk.publicKey(String(state.solDestination)) };
    }
    if (guards?.mintLimit) mintArgs.mintLimit = { id: MINT_LIMIT_ID };

    function pick(obj, paths) {
      for (const p of paths) {
        let v = obj;
        for (const part of p.split(".")) v = v?.[part];
        if (v) return v;
      }
      return null;
    }

    const collectionMint = pick(cm, [
      "collectionMint",
      "collectionMintAddress",
      "collection.mint",
      "collection.mintAddress",
      "collectionMint.publicKey",
    ]);

    const collectionUpdateAuthority = await resolveCollectionUpdateAuthority(cm, collectionMint);

    if (!collectionMint || !collectionUpdateAuthority) {
      throw new Error(
        "CM missing collectionMint/collectionUpdateAuthority. Fix: redeploy with collection or set/verify collection via sugar."
      );
    }

    const cua = (typeof collectionUpdateAuthority === "string") ? sdk.publicKey(String(collectionUpdateAuthority)) : collectionUpdateAuthority;
    const cMint = (typeof collectionMint === "string") ? sdk.publicKey(String(collectionMint)) : collectionMint;

    const signatures = [];

    for (let i = 0; i < qty; i++){
      // Extra guard: pre-check before each mint (protect from race)
      await updateWalletMintCounter();
      if (state.mintedRemaining !== null && state.mintedRemaining <= 0) {
        const msg = "Mint limit reached (3 per wallet)";
        setHint(msg, "error");
        emitToast(msg, "info");
        emitQty(1);
        emit();
        break;
      }

      const nftMint = sdk.generateSigner(umi);
      const mintPk = nftMint.publicKey;

      const ix = sdk.mintV2(umi, {
        candyMachine: cm.publicKey || cmPk,
        candyGuard: cm.mintAuthority,
        nftMint,
        collectionMint: cMint,
        collectionUpdateAuthority: cua,
        ...(cm.tokenStandard ? { tokenStandard: cm.tokenStandard } : {}),
        ...(group ? { group } : {}),
        ...(Object.keys(mintArgs).length ? { mintArgs } : {}),
      });

      const builder = sdk.transactionBuilder()
        .add(sdk.setComputeUnitLimit(umi, { units: CU_LIMIT }))
        .add(ix);

      let signature = null;
      try {
        signature = await builder.sendAndConfirm(umi);
      } catch (e) {
        // If we hit mintLimit unexpectedly, DO NOT retry (avoids botTax loops)
        if (isMintLimitError(e)) {
          const msg = "Mint limit reached (3 per wallet)";
          setHint(msg, "error");
          emitToast(msg, "info");
          emitQty(1);
          emit();
          break;
        }

        if (isBlockhashNotFound(e) || isRecentBlockhashFailed(e)) {
          setHint("RPC/blockhash hiccup — retrying…", "info");
          try { await rotateRpc(); } catch {}
          const builder2 = sdk.transactionBuilder()
            .add(sdk.setComputeUnitLimit(umi, { units: CU_LIMIT }))
            .add(ix);
          signature = await builder2.sendAndConfirm(umi);
        } else {
          throw e;
        }
      }

      if (signature) {
        signatures.push(signature);
        addRecentTransaction(signature, mintPk?.toString?.() || null);

        // Truth check (best-effort): metadata exists
        try {
          await sleep(250);
          const ok = await verifyMintMetadataBestEffort(mintPk);
          if (!ok) console.warn("[TONFANS] metadata not found yet (ok, may be delayed)");
        } catch {}
      }

      await sleep(150);
    }

    emitQty(1);

    if (signatures.length === 0) {
      // could be stopped by mintLimit
      await refresh();
      return;
    }

    setHint("Mint complete.", "ok");
    if (signatures.length === 1) emitToast(`Mint successful! Tx: ${String(signatures[0]).slice(0, 8)}…`, "ok");
    else emitToast(`Minted ${signatures.length} NFTs successfully!`, "ok");

    await refresh();
  } catch (e) {
    setHint(e?.message || String(e), "error");
    emitToast(e?.message || "Mint failed", "error");
    throw e;
  } finally {
    setBusy(false, "");
  }
}

// Copy tx signature
function copyTxSignature(signature){
  if (!signature && state.recentTxSignatures.length > 0) signature = state.recentTxSignatures[0].signature;
  if (!signature) return;

  navigator.clipboard.writeText(signature)
    .then(() => { emitToast("Transaction signature copied!", "ok"); })
    .catch(() => {
      const textArea = document.createElement("textarea");
      textArea.value = signature;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand("copy");
        emitToast("Transaction signature copied!", "ok");
      } catch {
        emitToast("Failed to copy signature", "error");
      }
      document.body.removeChild(textArea);
    });
}

// ---------- expose API ----------
window.TONFANS = window.TONFANS || {};
window.TONFANS.mint = {
  setTier,
  toggleConnect,
  refresh,
  mintNow,
  getState,
  copyTxSignature,
  addRecentTransaction,
};

(function init(){
  // load recent txs
  try {
    const savedTxs = localStorage.getItem("tonfans:recentTxs");
    if (savedTxs) state.recentTxSignatures = JSON.parse(savedTxs);
  } catch {}

  const p = getProvider();
  if (p?.on) {
    try {
      p.on("connect", () => {
        state.walletConnected = !!p.publicKey;
        state.wallet = p.publicKey?.toString?.() || null;
        state.walletShort = state.wallet ? shortPk(state.wallet) : null;
        emit();
        refresh().catch(()=>{});
      });
      p.on("disconnect", () => {
        state.walletConnected = false;
        state.wallet = null;
        state.walletShort = null;
        emit();
      });
      p.on("accountChanged", (pk) => {
        state.walletConnected = !!pk;
        state.wallet = pk?.toString?.() || null;
        state.walletShort = state.wallet ? shortPk(state.wallet) : null;
        emit();
        refresh().catch(()=>{});
      });
    } catch {}
  }

  // already connected
  if (p?.publicKey) {
    state.walletConnected = true;
    state.wallet = p.publicKey.toString();
    state.walletShort = shortPk(state.wallet);
  }

  // saved tier
  let saved = null;
  try { saved = localStorage.getItem("tonfans:tier"); } catch {}
  if (saved) setTier(saved).catch(()=>{});
  else emit();
})();
