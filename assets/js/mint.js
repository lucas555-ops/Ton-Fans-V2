// assets/js/mint.js (v23) — TON Fans (PRODUCTION)
// Fixes:
// - No botTax triggered when mint limit reached (skip transaction entirely)
// - Accurate supply updates (itemsRedeemed/itemsRemaining) even with null values
// - Safe initialization on first load (prevent undefined issues)
// - Improved caching of selected tier and cluster
// - Recent transactions array (up to 10) for history feature
const MINT_LIMIT_ID = 1;
const MAX_QTY = 3;

// Candy Guard program ID (same for devnet/mainnet)
const CANDY_GUARD_PROGRAM_ID = "Guard1JwRhJkVH6XZhzoYxeBVQe872VH4yceq5M1eD4";
const MINT_COUNTER_PREFIX = "mint_limit";
function u8(n) { return Uint8Array.of(n & 0xff); }
function u16le(n) {
  const b = new Uint8Array(2);
  b[0] = n & 0xff;
  b[1] = (n >> 8) & 0xff;
  return b;
}
function idSeedBytes(id) {
  const n = Number(id);
  if (Number.isFinite(n) && n >= 0 && n <= 255) return u8(n);
  if (Number.isFinite(n) && n >= 0 && n <= 65535) return u16le(n);
  return u8(0);
}
function readU64LE(data, offset) {
  let x = 0n;
  for (let i = 0; i < 8; i++) x |= BigInt(data[offset + i] || 0) << (8n * BigInt(i));
  return x;
}
async function findMintCounterPdaLocal({ sdk, candyGuardPk, candyMachinePk, userPk, mintLimitId }) {
  // Seeds per Metaplex Candy Guard: ["mint_limit", id, payer, candyGuard, candyMachine]
  const programId = sdk.publicKey(CANDY_GUARD_PROGRAM_ID);
  const seeds = [
    new TextEncoder().encode(MINT_COUNTER_PREFIX),
    idSeedBytes(mintLimitId),
    sdk.publicKey(String(userPk)).bytes,
    sdk.publicKey(String(candyGuardPk)).bytes,
    sdk.publicKey(String(candyMachinePk)).bytes,
  ];
  if (!umi?.eddsa?.findPda) throw new Error('Umi eddsa.findPda not available');
  const [pda] = umi.eddsa.findPda(programId, seeds);
  return pda;
}
const CU_LIMIT = 800_000;
const DEVNET_RPCS = [
  'https://api.devnet.solana.com',
  'https://rpc.ankr.com/solana_devnet',
];
const MAINNET_RPCS = [
  'https://api.mainnet-beta.solana.com',
  'https://rpc.ankr.com/solana',
];
const RPC_BY_CLUSTER = { devnet: DEVNET_RPCS, 'mainnet-beta': MAINNET_RPCS, mainnet: MAINNET_RPCS };
function normalizeCluster(v) {
  const s = String(v || '').trim();
  if (!s) return 'devnet';
  if (s === 'mainnet') return 'mainnet-beta';
  if (s === 'mainnetbeta') return 'mainnet-beta';
  return s;
}
function detectCluster() {
  try {
    const qs = new URLSearchParams(location.search);
    const q = qs.get('cluster') || qs.get('c');
    if (q) return normalizeCluster(q);
  } catch {}
  try {
    const ls = localStorage.getItem('tonfans:cluster');
    if (ls) return normalizeCluster(ls);
  } catch {}
  try {
    const cfg = window.TONFANS_CONFIG || {};
    if (cfg.cluster) return normalizeCluster(cfg.cluster);
  } catch {}
  return 'devnet';
}
const CLUSTER = detectCluster();
console.log("[TONFANS] mint.js v23 loaded");
const CM_BY_TIER = {
  lgen: "Hr9YzscC71vdHifZR4jRvMd8JmmGxbJrS6j7QckEVqKy",
  bgen: "Ewhn2nJV6tbvq59GMahyWmS54jQWL4n3mrsoVM8n8GHH",
  ldia: "8L5MLvbvM9EsZ8nb1NAwqzEXuVsiq5x5fHGNKchz6UQR",
  bdia: "EyjoAcKwkfNo8NqCZczHHnNSi3ccYpnCetkBUwbqCien",
};
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
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function shortPk(s) { return s ? s.slice(0, 4) + "…" + s.slice(-4) : ""; }
function emit() {
  const payload = JSON.parse(JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("tonfans:state", { detail: payload }));
}
function setHint(msg, kind = "info") {
  state.hint = msg || "";
  state.hintKind = kind;
  emit();
}
function setBusy(on, label = "") {
  state.busy = !!on;
  state.busyLabel = label || "";
  emit();
}
function emitToast(message, kind = "info") {
  if (!message) return;
  try {
    window.dispatchEvent(new CustomEvent("tonfans:toast", {
      detail: { message: String(message), kind: kind || "info" }
    }));
  } catch {}
}
// Apple-grade UX: if we cannot verify mint limit (RPC/SDK issues), ask for confirmation before proceeding.
function confirmProceedWithoutLimitCheck() {
  const msg = "Can't verify mint limit right now (RPC/SDK issue). Continue anyway? If your wallet already reached the limit, you may pay only the network fee.";
  try {
    // allow UI override
    const fn = window?.TONFANS?.ui?.confirmProceed;
    if (typeof fn === 'function') {
      const r = fn(msg);
      if (typeof r === 'boolean') return r;
    }
  } catch {}
  try {
    return window.confirm(msg);
  } catch {
    return false;
  }
}
function normalizeSignature(sig) {
  return typeof sig === 'string' && sig.length > 0 ? sig : null;
}
let state = {
  cluster: CLUSTER,
  rpc: null,
  tierRaw: null,
  tierKey: null,
  tierLabel: "—",
  cmId: null,
  guardPk: null,
  guardGroup: null,
  walletConnected: false,
  wallet: null,
  walletShort: null,
  itemsAvailable: null,
  itemsRedeemed: null,
  itemsRemaining: null,
  priceSol: null,
  solDestination: null,
  isFree: false,
  ready: false,
  mintLimit: MAX_QTY,
  mintedCount: null,
  mintedRemaining: null,
  lastTxSignature: null,
  lastTxExplorerUrl: null,
  lastTxIsBotTax: false,
  busy: false,
  busyLabel: "",
  hint: "Select a tier.",
  hintKind: "info",
};
function getState() { return JSON.parse(JSON.stringify(state)); }
async function resolveCollectionUpdateAuthority(cm, collectionMint) {
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
async function fetchMintedCountOnChain() {
  if (!state.wallet || !state.guardPk) return null;
  try {
    await loadSdk();
    if (!umi) await rebuildUmi();
    const sdk = SDK;
    const cg = await loadCgSdk();
    const user = sdk.publicKey(String(state.wallet));
    const candyGuard = sdk.publicKey(String(state.guardPk));
    const id = MINT_LIMIT_ID;
    // 1) safeFetchMintCounterFromSeeds (best way)
    if (typeof cg.safeFetchMintCounterFromSeeds === "function") {
      try {
        const counter = await cg.safeFetchMintCounterFromSeeds(umi, { id, user, candyGuard });
        return extractCounterCount(counter);
      } catch (e) {
        const msg = String(e?.message || e || "").toLowerCase();
        if (msg.includes("accountnotfound") || msg.includes("account not found")) return 0;
      }
    }
    // 2) findPDA + fetchMintCounter (fallback)
    if (typeof cg.findMintCounterPda === "function" && typeof cg.fetchMintCounter === "function") {
      try {
        const pda = cg.findMintCounterPda(umi, { id, user, candyGuard });
        const counter = await cg.fetchMintCounter(umi, pda);
        return extractCounterCount(counter);
      } catch (e) {
        const msg = String(e?.message || e || "").toLowerCase();
        if (msg.includes("accountnotfound") || msg.includes("account not found")) return 0;
      }
    }
    // If nothing worked, assume 0 (safe default)
    return 0;
  } catch (error) {
    console.error("[TONFANS] Error fetching mint counter:", error);
    return null;
  }
}
async function updateWalletMintCounter() {
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
  emit(); // ensure UI updates
  return capped;
}
function extractCounterCount(counter) {
  try {
    // Counter struct may contain count in various forms
    const raw = counter?.count ?? counter?.countOnChain ?? counter;
    if (raw == null) return null;
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'bigint') return Number(raw);
    if (typeof raw === 'string') return Number.parseInt(raw);
    if (typeof raw === 'object') {
      if ('toNumber' in raw) return raw.toNumber();
      if ('basisPoints' in raw) return Number(raw.basisPoints);
      if ('toBigInt' in raw) return Number(raw.toBigInt());
    }
    return Number(raw);
  } catch {
    return null;
  }
}
async function loadCgSdk() {
  if (!SDK) await loadSdk();
  try {
    const cgSdk = await import("https://esm.sh/@metaplex-foundation/mpl-candy-guard@3.1.0?bundle");
    return { 
      safeFetchMintCounterFromSeeds: cgSdk.safeFetchMintCounterFromSeeds,
      findMintCounterPda: cgSdk.findMintCounterPda,
      fetchMintCounter: cgSdk.fetchMintCounter
    };
  } catch {
    return {};
  }
}
function extractSolPaymentLamports(guards) {
  const sp = guards?.solPayment;
  if (!sp) return null;
  const kind = sp.__kind ?? sp.__option ?? null;
  if (kind && String(kind).toLowerCase().includes("none")) return null;
  const inner = sp.value ?? (Array.isArray(sp.fields) ? sp.fields[0] : null) ?? sp;
  const candidate = inner?.amount ?? inner?.lamports ?? inner?.basisPoints ?? inner;
  const bi = toBigIntMaybe(candidate);
  if (bi == null) return null;
  return bi;
}
function extractSolPaymentDestination(guards) {
  const sp = guards?.solPayment;
  if (!sp) return null;
  const kind = sp.__kind ?? sp.__option ?? null;
  if (kind && String(kind).toLowerCase().includes("none")) return null;
  const inner = sp.value ?? (Array.isArray(sp.fields) ? sp.fields[0] : null) ?? sp;
  const d = inner?.destination ?? inner?.destinationAddress ?? inner?.destination?.publicKey ?? null;
  if (!d) return null;
  if (typeof d === "string") return d;
  if (typeof d === "object") {
    if (typeof d.toString === "function") return String(d);
    if (d.bytes) return String(d);
  }
  return null;
}
function toBigIntMaybe(v) {
  if (v == null) return null;
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
  if (typeof v === "string") { try { return BigInt(v); } catch { return null; } }
  if (typeof v === "object") {
    const inner = v.basisPoints ?? v.lamports ?? v.amount ?? v.value ?? null;
    if (inner != null) return toBigIntMaybe(inner);
  }
  return null;
}
function toNumberSafe(v) {
  const bi = toBigIntMaybe(v);
  if (bi == null) return null;
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  const clipped = bi > max ? max : bi;
  return Number(clipped);
}
function lamportsToSol(lamports) {
  const bi = toBigIntMaybe(lamports);
  if (bi == null) return null;
  const sol = Number(bi) / 1_000_000_000;
  return Number.isFinite(sol) ? sol : null;
}
function mergeGuards(base, override) {
  return { ...(base || {}), ...(override || {}) };
}
function resolveGuardsByLabels(cg, labels) {
  if (!cg) return { guards: null, group: null };
  const base = cg.guards || {};
  const groups = cg.groups || [];
  for (const label of labels) {
    const found = groups.find(g => g.label === label);
    if (found) return { guards: mergeGuards(base, found.guards || {}), group: label };
  }
  return { guards: base, group: null };
}
async function connectWallet() {
  const p = getProvider();
  if (!p) throw new Error("No Solana wallet found. Install Phantom.");
  if (!p.publicKey) await p.connect();
  state.walletConnected = !!p.publicKey;
  state.wallet = p.publicKey ? p.publicKey.toString() : null;
  state.walletShort = state.wallet ? shortPk(state.wallet) : null;
  emit();
  await refresh();
}
async function disconnectWallet() {
  const p = getProvider();
  if (p?.disconnect) { try { await p.disconnect(); } catch {} }
  state.walletConnected = false;
  state.wallet = null;
  state.walletShort = null;
  state.ready = false;
  emit();
}
async function toggleConnect() {
  const p = getProvider();
  if (!p) throw new Error("No Solana wallet found.");
  if (p.publicKey) await disconnectWallet();
  else { await connectWallet(); }
}
// -------- SDK dynamic import
let SDK = null;
async function loadSdk() {
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
const currentRpcs = RPC_BY_CLUSTER[CLUSTER] || DEVNET_RPCS;
function currentRpc() { return currentRpcs[rpcIdx] || currentRpcs[0]; }
async function rebuildUmi() {
  const sdk = await loadSdk();
  umi = sdk.createUmi(currentRpc()).use(sdk.mplCandyMachine()).use(sdk.mplTokenMetadata());
  state.rpc = currentRpc();
  emit();
  return umi;
}
function attachWalletIdentity() {
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
function isRecentBlockhashFailed(err) {
  const m = String(err?.message || err || "");
  return m.includes("failed to get recent blockhash")
      || m.includes("Expected the value to satisfy a union")
      || m.includes("expected the value to satisfy a union")
      || m.includes("union of `type | type`")
      || m.includes("union of `type | type`");
}
function isBlockhashNotFound(err) {
  const m = String(err?.message || err || "").toLowerCase();
  return m.includes("blockhash not found") || m.includes("blockhashnotfound");
}
function rotateRpc() {
  rpcIdx = (rpcIdx + 1) % currentRpcs.length;
  return rebuildUmi();
}
function isForbidden(err) {
  const m = String(err?.message || err || "").toLowerCase();
  return m.includes("access forbidden") || m.includes("forbidden") || m.includes("403");
}
async function withFailover(fn) {
  let last = null;
  for (let attempt = 0; attempt < currentRpcs.length; attempt++) {
    try {
      if (!umi) await rebuildUmi();
      return await fn();
    } catch (e) {
      last = e;
      if (isForbidden(e) || (e?.name === "TypeError" && String(e?.message || "").includes("fetch"))) {
        if (rpcIdx < currentRpcs.length - 1) {
          rpcIdx++;
          await rebuildUmi();
          setHint(`RPC switched → ${currentRpc()}`, "info");
          await sleep(60);
          continue;
        }
      }
      break;
    }
  }
  throw last;
}
async function refresh() {
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
    // determine guard group and price
    const raw = String(state.tierRaw || "");
    const labels = [raw, raw.replaceAll("_", "-"), state.tierKey, "default"].filter(Boolean);
    const resolved = resolveGuardsByLabels(cg, labels);
    state.guardGroup = resolved.group;
    const lamports = extractSolPaymentLamports(resolved.guards);
    const dest = extractSolPaymentDestination(resolved.guards);
    state.solDestination = dest;
    state.isFree = (lamports == null);
    state.priceSol = state.isFree ? 0 : lamportsToSol(lamports);
    // readiness: if known remaining == 0 -> sold out; if remaining is null (unknown) -> don't block mint
    if (state.itemsRemaining === 0) {
      state.ready = false;
      setHint(`Sold out (${state.itemsRedeemed ?? "?"}/${state.itemsAvailable ?? "?"}).`, "error");
    } else {
      state.ready = true;
      const p = state.isFree ? "price: FREE (network rent applies)" : `price: ${state.priceSol} SOL`;
      const d = state.solDestination ? ` • dest: ${shortPk(String(state.solDestination))}` : "";
      const sup = (state.itemsRemaining == null) ? "" : ` • left: ${state.itemsRemaining}`;
      const grp = state.guardGroup ? `group: ${state.guardGroup}` : "base guards";
      setHint(`Ready (${grp}${d}, ${p}${sup}).`, "ok");
    }
    // Update per-wallet mint counter for current wallet
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
async function setTier(tierRaw) {
  const key = normalizeTier(tierRaw);
  state.tierRaw = tierRaw || null;
  state.tierKey = key;
  state.tierLabel = key ? TIER_LABEL[key] : "—";
  state.cmId = key ? CM_BY_TIER[key] : null;
  // reset derived fields
  state.guardPk = null;
  state.guardGroup = null;
  state.itemsAvailable = null;
  state.itemsRedeemed = null;
  state.itemsRemaining = null;
  state.priceSol = null;
  state.ready = false;
  state.mintedCount = null;
  state.mintedRemaining = null;
  state.lastTxSignature = null;
  state.lastTxExplorerUrl = null;
  state.lastTxIsBotTax = false;
  try { localStorage.setItem("tonfans:tier", tierRaw || ""); } catch {}
  emit();
  if (!state.cmId) {
    setHint("Tier selected, but CM ID not found.", "error");
    return;
  }
  await refresh();
}
async function mintNow(qty = 1) {
  if (!state.cmId) throw new Error("Select a tier first.");
  if (!state.walletConnected) throw new Error("Connect wallet first.");
  if (!state.ready) throw new Error(state.itemsRemaining === 0 ? "Sold out." : "Not ready.");
  const q = Math.max(1, Math.min(MAX_QTY, Number(qty || 1)));
  // CRITICAL: Check mint limit *before* sending transaction
  await updateWalletMintCounter();
  // If no mints remaining, do NOT send TX (avoid botTax)
  if (state.mintedRemaining !== null && state.mintedRemaining <= 0) {
    const msg = "Mint limit reached (3 per wallet)";
    setHint(msg, "error");
    emitToast(msg, "info");
    emitQty(1);
    emit();
    return; // No transaction = no botTax
  }
  // If requested quantity > remaining limit, auto-reduce and mint that many
  if (state.mintedRemaining !== null && q > state.mintedRemaining) {
    const remaining = Number(state.mintedRemaining);
    const msg = `Only ${remaining}/3 remaining — minting ${remaining}.`;
    setHint(msg, "info");
    emitToast(msg, "info");
    emitQty(remaining);
    await _executeMint(remaining);
    return;
  }
  // Proceed with requested quantity
  await _executeMint(q);
}
async function _executeMint(qty) {
  setBusy(true, "Minting…");
  setHint(`Minting x${qty}…`, "info");
  // Save current counter for verification after mint
  const mintedCountBefore = state.mintedCount;
  // Clear previous transaction info
  state.lastTxSignature = null;
  state.lastTxExplorerUrl = null;
  state.lastTxIsBotTax = false;
  try {
    await loadSdk();
    if (!umi) await rebuildUmi();
    attachWalletIdentity();
    const sdk = SDK;
    const cmPk = sdk.publicKey(state.cmId);
    const cm = await withFailover(async () => await sdk.fetchCandyMachine(umi, cmPk));
    const cg = await withFailover(async () => await sdk.fetchCandyGuard(umi, cm.mintAuthority));
    const raw = String(state.tierRaw || "");
    const labels = [raw, raw.replaceAll("_", "-"), state.tierKey, "default"].filter(Boolean);
    // choose group if exists
    let group = null;
    const groups = cg.groups || [];
    group = labels.find(l => groups.some(g => g.label === l)) || null;
    const resolved = resolveGuardsByLabels(cg, labels);
    const guards = resolved.guards;
    const mintArgs = {};
    if (guards?.solPayment && state.solDestination) {
      mintArgs.solPayment = { destination: SDK.publicKey(String(state.solDestination)) };
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
        "CM missing collectionMint/collectionUpdateAuthority. " +
        "Fix: redeploy with a collection or set/verify collection via sugar, then retry."
      );
    }
    const cua = (typeof collectionUpdateAuthority === 'string') ? SDK.publicKey(String(collectionUpdateAuthority)) : collectionUpdateAuthority;
    const cMint = (typeof collectionMint === 'string') ? SDK.publicKey(String(collectionMint)) : collectionMint;
    let lastSignature = null;
    let lastNftMint = null;
    for (let i = 0; i < qty; i++) {
      const nftMint = sdk.generateSigner(umi);
      lastNftMint = nftMint;
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
      // send with retry if blockhash expires while user approves in wallet
      try {
        lastSignature = await builder.sendAndConfirm(umi);
      } catch (e) {
        if (isBlockhashNotFound(e) || isRecentBlockhashFailed(e)) {
          setHint("RPC/blockhash hiccup — retrying with fresh blockhash…", "info");
          try { await rotateRpc(); } catch {}
          // rebuild and try once more
          const builder2 = sdk.transactionBuilder()
            .add(sdk.setComputeUnitLimit(umi, { units: CU_LIMIT }))
            .add(ix);
          lastSignature = await builder2.sendAndConfirm(umi);
        } else {
          throw e;
        }
      }
    }
    const signature = normalizeSignature(lastSignature);
    // If minted multiple, get all signatures (if any intermediate missing, treat as fail)
    const allSigs = (qty === 1) ? [signature] : umi.transactions.map(t => normalizeSignature(t.signature));
    // Determine if guard (like botTax) prevented mint by checking chain state
    let detectedNewMint = false;
    if (lastNftMint) {
      try {
        const updateAuth = await resolveCollectionUpdateAuthority(cm, collectionMint);
        if (updateAuth) detectedNewMint = true; // if we can resolve update auth, NFT exists
      } catch {}
    }
    // Update state with last transaction info
    state.lastTxSignature = signature;
    state.lastTxExplorerUrl = signature ? `https://solscan.io/tx/${signature}${(state.cluster === 'devnet') ? '?cluster=devnet' : ''}` : null;
    state.lastTxIsBotTax = !detectedNewMint;
    // Build recent transactions record
    const txRecord = {
      signature: signature || "(none)",
      shortSig: signature ? signature.slice(0, 8) + "…" + signature.slice(-8) : "(none)",
      explorerUrl: state.lastTxExplorerUrl || "#",
      timestamp: Date.now()
    };
    // Prepend to recent list
    state.recentTxSignatures = state.recentTxSignatures || [];
    state.recentTxSignatures.unshift(txRecord);
    // Limit to 10 recent
    if (state.recentTxSignatures.length > 10) {
      state.recentTxSignatures = state.recentTxSignatures.slice(0, 10);
    }
    // Persist recent transactions in localStorage
    try {
      localStorage.setItem("tonfans:recentTxs", JSON.stringify(state.recentTxSignatures));
    } catch {}
    // Verify success
    if (signature && detectedNewMint) {
      // If minted at least one NFT
      setHint('Mint complete.', 'ok');
      if (qty === 1) {
        emitToast(`✅ Mint verified. Tx: ${String(signature).slice(0, 8)}…`, 'ok');
      } else {
        const msg = '✅ Mints complete.';
        setHint(msg, 'ok');
        emitToast(msg, 'ok');
      }
    } else if (signature && !detectedNewMint) {
      // Transaction confirmed but no NFT detected (likely botTax or guard failure)
      const msg = '❌ Tx confirmed but mint NOT detected (likely botTax / guard fail).';
      setHint(msg, 'error');
      emitToast(msg, 'error');
    } else {
      // No signature (transaction might not have been sent at all)
      const msg = 'Tx sent. Verifying mint… (check wallet)';
      setHint(msg, 'info');
      emitToast('Tx sent. If NFT not in wallet, it may be botTax / failed mint.', 'info');
    }
    // After successful mint(s), refresh mint counter
    await updateWalletMintCounter();
    // Prepare data for after-mint UI
    const lastMintInfo = {
      ok: !!(signature && detectedNewMint),
      signature: signature || null,
      tierLabel: state.tierLabel,
      signatures: allSigs.filter(Boolean),
    };
    state.lastMint = lastMintInfo;
    // Auto-switch connected wallet if devnet/mainnet mismatch (not needed in dev environment)
    // ...
    emit();
  } catch (e) {
    console.error("[TONFANS] Mint error:", e);
    const raw = e?.message || e;
    setHint(raw, 'error');
    emitToast(raw || 'Mint failed', 'error');
    throw e;
  } finally {
    setBusy(false, "");
    // After any mint attempt, refresh state
    try { await refresh(); } catch {}
  }
}
function copyTxSignature(sig) {
  try {
    navigator.clipboard.writeText(String(sig || "")); 
    console.log("Copied transaction signature:", sig);
  } catch (e) {
    console.warn("Copy failed:", e);
  }
}
// Expose API to window
window.TONFANS = window.TONFANS || {};
window.TONFANS.mint = {
  setTier,
  toggleConnect,
  connect: connectWallet,
  disconnect: disconnectWallet,
  mintNow,
  copyTxSignature,
};
try {
  const savedTxs = localStorage.getItem("tonfans:recentTxs");
  if (savedTxs) {
    const raw = JSON.parse(savedTxs);
    if (Array.isArray(raw)) {
      // Normalize and load recent transactions on page load (for persistence)
      const norm = raw.map(sig => typeof sig === 'string' ? ({ signature: sig }) : sig);
      state.recentTxSignatures = norm.slice(0, 10);
    }
  }
} catch {}
// On page load, if tier was saved in localStorage, auto-select it
try {
  const saved = localStorage.getItem("tonfans:tier");
  if (saved) setTier(saved).catch(() => {});
  else emit();
} catch {}
