// assets/js/mint.js (v23) — TON Fans (DEVNET)
// Fixes:
// - Supply всегда обновляется (даже при mintedRemaining = null)
// - Безопасный запуск при первом заходе
// - Улучшенное кэширование tier
// - Массив последних транзакций (топовая фича)

const MINT_LIMIT_ID = 1;
const MAX_QTY = 3;
const CU_LIMIT = 800_000;

const DEVNET_RPCS = [
  'https://api.devnet.solana.com',
  'https://rpc.ankr.com/solana_devnet',
];

const MAINNET_RPCS = [
  'https://api.mainnet-beta.solana.com',
  'https://rpc.ankr.com/solana',
];

const RPC_BY_CLUSTER = {
  devnet: DEVNET_RPCS,
  'mainnet-beta': MAINNET_RPCS,
  mainnet: MAINNET_RPCS,
};

function normalizeCluster(v){
  const s = String(v || '').trim();
  if (!s) return 'devnet';
  if (s === 'mainnet') return 'mainnet-beta';
  if (s === 'mainnetbeta') return 'mainnet-beta';
  return s;
}

function detectCluster(){
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

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function shortPk(s){ return s ? s.slice(0,4)+"…"+s.slice(-4) : ""; }

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

// --- Обновлено: Candy Guard mint counter ---
let CGSDK = null;
async function loadCgSdk(){
  if (CGSDK) return CGSDK;

  const candidates = [
    "https://esm.sh/@metaplex-foundation/mpl-candy-guard@0.7.0?bundle",
    "https://esm.sh/@metaplex-foundation/mpl-candy-guard@0.6.0?bundle",
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
      return CGSDK;
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error("Failed to load Candy Guard SDK.");
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
  // Обрабатываем разные форматы ответов от Candy Guard SDK
  console.log('[TONFANS] 📊 Обработка счетчика:', counter);
  if (!counter) return 0;

  // Формат 1: Umi Option(Some)
  if (counter.__kind === 'Some' && counter.value) {
    const inner = counter.value;
    const raw = inner.count ?? inner.mintCount ?? 0;
    return Number(raw) || 0;
  }

  // Формат 2: прямой объект
  if (counter.count !== undefined) return Number(counter.count) || 0;

  // Формат 3: объект с data
  if (counter.data && counter.data.count !== undefined) return Number(counter.data.count) || 0;

  // Формат 4: число
  if (typeof counter === 'number') return counter;

  // Формат 5: BigInt
  if (typeof counter === 'bigint') return Number(counter);

  // fallback to unwrapOption if present
  try {
    const c = unwrapOption(counter);
    const raw = c?.count ?? c?.mintCount ?? c?.data?.count ?? 0;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  } catch {}

  console.warn('[TONFANS] ⚠️ Неизвестный формат счетчика:', counter);
  return 0;
}

async function fetchMintedCountOnChain(){
  if (!state.walletConnected || !state.wallet || !state.guardPk) return null;

  console.log('[TONFANS] 🔍 Запрашиваю счетчик минтов...', {
    wallet: state.walletShort,
    guard: state.guardPk ? shortPk(state.guardPk) : null,
    tier: state.tierKey
  });

  try {
    await loadSdk();
    if (!umi) await rebuildUmi();
    const sdk = SDK;
    const cg = await loadCgSdk();

    const user = sdk.publicKey(String(state.wallet));
    const candyGuard = sdk.publicKey(String(state.guardPk));
    const id = MINT_LIMIT_ID;

    let counter = null;
    let method = 'none';

    // 1) fetchMintCounter (preferred)
    if (typeof cg.fetchMintCounter === 'function' && typeof cg.findMintCounterPda === 'function') {
      try {
        const pda = cg.findMintCounterPda(umi, { id, user, candyGuard });
        console.log('[TONFANS] 📍 PDA счетчика:', pda.toString());
        counter = await cg.fetchMintCounter(umi, pda);
        method = 'fetchMintCounter';
        console.log('[TONFANS] ✅ Счетчик найден через fetchMintCounter:', counter);
      } catch (e) {
        const msg = String(e?.message || e || '');
        console.log('[TONFANS] ❌ fetchMintCounter error:', msg);
        if (msg.toLowerCase().includes('accountnotfound') || msg.toLowerCase().includes('account not found')) {
          console.log('[TONFANS] 📝 Счетчик не найден, считаем 0 минтов');
          return 0;
        }
      }
    }

    // 2) Fallback: safeFetchMintCounterFromSeeds
    if (!counter && typeof cg.safeFetchMintCounterFromSeeds === 'function') {
      try {
        counter = await cg.safeFetchMintCounterFromSeeds(umi, { id, user, candyGuard });
        method = 'safeFetchMintCounterFromSeeds';
        console.log('[TONFANS] ✅ Счетчик найден через safeFetchMintCounterFromSeeds:', counter);
      } catch (e) {
        console.log('[TONFANS] ❌ safeFetchMintCounterFromSeeds error:', String(e?.message || e || ''));
      }
    }

    // 3) RPC fallback: compute PDA via findMintCounterPda and check existence
    if (!counter && typeof cg.findMintCounterPda === 'function') {
      try {
        const pda = cg.findMintCounterPda(umi, { id, user, candyGuard });
        const acc = await umi.rpc.getAccount(pda);
        if (!acc.exists) {
          console.log('[TONFANS] 📝 Счетчик не найден (аккаунт не существует)');
          return 0;
        }
        // If exists but fetch failed earlier, treat as 0-safe
        console.log('[TONFANS] ✅ PDA существует, но fetch не дал объект — считаем 0');
        return 0;
      } catch (e) {
        console.log('[TONFANS] ❌ RPC fallback error:', String(e?.message || e || ''));
      }
    }

    if (!counter) {
      console.log('[TONFANS] 📝 Счетчик не найден, считаем 0 минтов');
      return 0;
    }

    const count = extractCounterCount(counter);
    console.log(`[TONFANS] ✅ Извлеченное значение: ${count} (метод: ${method})`);
    return count;
  } catch (error) {
    console.error('[TONFANS] ❌ Ошибка получения счетчика минтов:', error);
    return null;
  }
}

async function updateWalletMintCounter(){
  console.log('[TONFANS] 🔄 Обновляю счетчик минтов...');
  const cnt = await fetchMintedCountOnChain();

  if (cnt === null) {
    // Ошибка при получении
    state.mintedCount = null;
    state.mintedRemaining = null;
    console.log('[TONFANS] ❌ Не удалось получить счетчик');
    return null;
  }

  const capped = Math.min(MAX_QTY, cnt);
  state.mintedCount = capped;
  state.mintedRemaining = Math.max(0, MAX_QTY - capped);

  console.log('[TONFANS] 📊 Обновленные счетчики:', {
    minted: state.mintedCount,
    remaining: state.mintedRemaining
  });

  if (state.mintedRemaining === 0) {
    emitQty(1);
  }

  return capped;
}

function normalizeTier(t){
  const key = String(t||"").trim();
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
  else { await connectWallet(); }
}

// -------- SDK dynamic import
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

function rpcs(){ return RPC_BY_CLUSTER[CLUSTER] || DEVNET_RPCS; }
function currentRpc(){ const list = rpcs(); return list[rpcIdx] || list[0]; }

async function rebuildUmi(){
  const sdk = await loadSdk();
  umi = sdk.createUmi(currentRpc()).use(sdk.mplCandyMachine()).use(sdk.mplTokenMetadata());
  state.rpc = currentRpc();
  emit();
  return umi;
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

// -------- value helpers
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

function rotateRpc(){
  rpcIdx = (rpcIdx + 1) % rpcs().length;
  return rebuildUmi();
}

function isForbidden(err){
  const m = String(err?.message || err || "").toLowerCase();
  return m.includes("access forbidden") || m.includes("forbidden") || m.includes("403");
}

async function withFailover(fn){
  let last = null;
  for (let attempt = 0; attempt < rpcs().length; attempt++){
    try {
      if (!umi) await rebuildUmi();
      return await fn();
    } catch(e){
      last = e;
      if (isForbidden(e) || (e?.name === "TypeError" && String(e?.message||"").includes("fetch"))) {
        if (rpcIdx < rpcs().length - 1) {
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

function toBigIntMaybe(v){
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

function toNumberSafe(v){
  const bi = toBigIntMaybe(v);
  if (bi == null) return null;
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  const clipped = bi > max ? max : bi;
  return Number(clipped);
}

function lamportsToSol(lamports){
  const bi = toBigIntMaybe(lamports);
  if (bi == null) return null;
  const sol = Number(bi) / 1_000_000_000;
  return Number.isFinite(sol) ? sol : null;
}

function mergeGuards(base, override){
  return { ...(base||{}), ...(override||{}) };
}

function resolveGuardsByLabels(cg, labels){
  if (!cg) return { guards: null, group: null };
  const base = cg.guards || {};
  const groups = cg.groups || [];
  for (const label of labels){
    const found = groups.find(g => g.label === label);
    if (found) return { guards: mergeGuards(base, found.guards || {}), group: label };
  }
  return { guards: base, group: null };
}

function extractSolPaymentLamports(guards){
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

function extractSolPaymentDestination(guards){
  const sp = guards?.solPayment;
  if (!sp) return null;

  const kind = sp.__kind ?? sp.__option ?? null;
  if (kind && String(kind).toLowerCase().includes("none")) return null;

  const inner = sp.value ?? (Array.isArray(sp.fields) ? sp.fields[0] : null) ?? sp;

  const d = inner?.destination ?? inner?.destinationAddress ?? inner?.destination?.publicKey ?? null;

  if (!d) return null;
  if (typeof d === "string") return d;
  if (typeof d === "object"){
    if (typeof d.toString === "function") return String(d);
    if (d.bytes) return String(d);
  }
  return null;
}

// -------- state
const state = {
  cluster: CLUSTER,
  rpc: currentRpc(),
  tierRaw: null,
  tierKey: null,
  tierLabel: "—",
  cmId: null,

  guardPk: null,
  guardGroup: null,

  walletConnected: false,
  wallet: null,
  walletShort: null,

  // supply (ВСЕГДА обновляется)
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

  // ТОПОВАЯ ФИЧА: массив последних транзакций
  recentTxSignatures: [], // Массив объектов {signature, explorerUrl, timestamp}

  // ui
  busy: false,
  busyLabel: "",
  hint: "Select a tier.",
  hintKind: "info",
};

function getState(){ return JSON.parse(JSON.stringify(state)); }

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

// -------- core
async function setTier(tierRaw){
  const key = normalizeTier(tierRaw);
  state.tierRaw = tierRaw || null;
  state.tierKey = key;
  state.tierLabel = key ? TIER_LABEL[key] : "—";
  state.cmId = key ? CM_BY_TIER[key] : null;

  // reset derived
  state.guardPk = null;
  state.guardGroup = null;
  state.itemsAvailable = null;
  state.itemsRedeemed = null;
  state.itemsRemaining = null;
  state.priceSol = null;
  state.ready = false;
  state.mintedCount = null;
  state.mintedRemaining = null;
  // НЕ сбрасываем recentTxSignatures при смене тира

  // ВАЖНО: Сохраняем tier в localStorage ДАЖЕ при первом выборе
  try { 
    localStorage.setItem("tonfans:tier", tierRaw || ""); 
  } catch {}

  emit();

  if (!state.cmId) {
    setHint("Tier выбран, но CM ID не найден.", "error");
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

    // labels candidates
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

    // ВАЖНО: Всегда эмитим обновление supply (даже если mintedRemaining = null)
    emitSupplyUpdate({
      itemsAvailable: state.itemsAvailable,
      itemsRedeemed: state.itemsRedeemed,
      itemsRemaining: state.itemsRemaining
    });

    // Update mint counter
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

// ТОПОВАЯ ФИЧА: добавляем транзакцию в историю
function addRecentTransaction(signature){
  if (!signature) return;
  
  const explorerUrl = (state.cluster === 'devnet')
    ? `https://solscan.io/tx/${signature}?cluster=devnet`
    : `https://solscan.io/tx/${signature}`;
  const txRecord = {
    signature,
    explorerUrl,
    timestamp: Date.now(),
    shortSig: signature.slice(0, 8) + "…" + signature.slice(-8)
  };
  
  // Добавляем в начало массива (новые сверху)
  state.recentTxSignatures.unshift(txRecord);
  
  // Ограничиваем до 10 последних
  if (state.recentTxSignatures.length > 10) {
    state.recentTxSignatures = state.recentTxSignatures.slice(0, 10);
  }
  
  // Сохраняем в localStorage для persistence
  try {
    localStorage.setItem("tonfans:recentTxs", JSON.stringify(state.recentTxSignatures));
  } catch {}
  
  emit();
}

async function mintNow(qty=1){
  if (!state.cmId) throw new Error("Select a tier first.");
  if (!state.walletConnected) throw new Error("Connect wallet first.");
  if (!state.ready) throw new Error(state.itemsRemaining === 0 ? "Sold out." : "Not ready.");

  const q = Math.max(1, Math.min(MAX_QTY, Number(qty || 1)));

  // Pre-check mintLimit
  await updateWalletMintCounter();

  // КРИТИЧЕСКИ ВАЖНО: Если mintedRemaining <= 0, ВОЗВРАЩАЕМСЯ БЕЗ отправки транзакции
  console.log('[TONFANS] 🔍 Проверка лимита перед минтом:', {
    mintedCount: state.mintedCount,
    mintedRemaining: state.mintedRemaining,
    requestedQty: q
  });

  // Сценарий 1: Мы ЗНАЕМ, что осталось 0
  if (state.mintedRemaining !== null && state.mintedRemaining <= 0) {
    const msg = '❌ Mint limit reached (3 per wallet)';
    console.log('[TONFANS] ' + msg);
    setHint(msg, 'error');
    emitToast(msg, 'error');
    emitQty(1);
    emit();
    return; // НИКАКОЙ ТРАНЗАКЦИИ = НИКАКОЙ botTax
  }

  // Сценарий 2: мы не знаем (null) — q уже capped, просто продолжаем

  // Сценарий 3: Мы знаем количество, но запрашиваем больше, чем осталось
  if (state.mintedRemaining !== null && q > state.mintedRemaining) {
    const remaining = state.mintedRemaining;
    const msg = `Только ${remaining}/3 осталось — изменяю количество на ${remaining}.`;
    setHint(msg, 'info');
    emitToast(msg, 'info');
    await _executeMint(remaining);
    return;
  }

  console.log('[TONFANS] ✅ Лимит проверен, запускаю минт...');
  await _executeMint(q);
}

async function _executeMint(qty){
  // Truth verification: capture counter before mint
  const beforeCnt = await fetchMintedCountOnChain();

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
        "Fix: redeploy with a collection or set/verify collection via sugar."
      );
    }

    const cua = (typeof collectionUpdateAuthority === 'string') ? SDK.publicKey(String(collectionUpdateAuthority)) : collectionUpdateAuthority;
    const cMint = (typeof collectionMint === 'string') ? SDK.publicKey(String(collectionMint)) : collectionMint;

    const signatures = [];

    for (let i=0;i<qty;i++){
      const nftMint = sdk.generateSigner(umi);
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
        addRecentTransaction(signature); // ТОПОВАЯ ФИЧА: сохраняем каждую транзакцию
      }
      
      await sleep(150);
    }

    // After mint: refresh + truth verification (botTax ≠ success)
    emitQty(1);

    // Refresh state (supply / price / etc.)
    await refresh();

    // Update counter and verify real mint happened
    const afterCnt = await fetchMintedCountOnChain();
    const b = (typeof beforeCnt === 'number') ? beforeCnt : null;
    const a = (typeof afterCnt === 'number') ? afterCnt : null;
    const delta = (b != null && a != null) ? Math.max(0, a - b) : null;
    const attempted = signatures.length;

    if (delta != null) {
      if (delta >= attempted && attempted > 0) {
        setHint('Mint complete.', 'ok');
        if (attempted === 1) {
          emitToast(`✅ Mint verified. Tx: ${signatures[0].slice(0, 8)}…`, 'ok');
        } else {
          emitToast(`✅ Mint verified: ${attempted} NFTs`, 'ok');
        }
      } else if (delta > 0) {
        const msg = `⚠️ Partial mint: verified ${delta}/${attempted}. Check wallet & Solscan.`;
        setHint(msg, 'info');
        emitToast(msg, 'info');
      } else {
        const msg = '❌ Tx confirmed but mint NOT detected (likely botTax / guard fail).';
        setHint(msg, 'error');
        emitToast(msg, 'error');
      }
    } else {
      // If we couldn't read counter (RPC / SDK), don't lie — be neutral
      setHint('Tx sent. Verifying mint… (check wallet)', 'info');
      emitToast('Tx sent. If NFT not in wallet, it may be botTax / failed mint.', 'info');
    }
  } catch (e) {
    setHint(e?.message || String(e), "error");
    emitToast(e?.message || "Mint failed", "error");
    throw e;
  } finally {
    setBusy(false, "");
  }
}

// Copy transaction signature
function copyTxSignature(signature){
  if (!signature && state.recentTxSignatures.length > 0) {
    signature = state.recentTxSignatures[0].signature;
  }
  
  if (!signature) return;
  
  navigator.clipboard.writeText(signature)
    .then(() => {
      emitToast("Transaction signature copied!", "ok");
    })
    .catch(() => {
      const textArea = document.createElement('textarea');
      textArea.value = signature;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        emitToast("Transaction signature copied!", "ok");
      } catch (err) {
        emitToast("Failed to copy signature", "error");
      }
      document.body.removeChild(textArea);
    });
}

// init + expose
window.TONFANS = window.TONFANS || {};
window.TONFANS.mint = { 
  setTier, 
  toggleConnect, 
  refresh, 
  mintNow, 
  getState,
  copyTxSignature,
  addRecentTransaction
};

(function init(){
  // Загружаем историю транзакций из localStorage
  try {
    const savedTxs = localStorage.getItem("tonfans:recentTxs");
    if (savedTxs) {
      state.recentTxSignatures = JSON.parse(savedTxs);
    }
  } catch {}
  
  const p = getProvider();
  if (p?.on) {
    try {
      p.on("connect", () => { 
        state.walletConnected = !!p.publicKey; 
        state.wallet = p.publicKey?.toString?.()||null; 
        state.walletShort = state.wallet?shortPk(state.wallet):null; 
        emit(); 
        refresh().catch(()=>{}); 
      });
      p.on("disconnect", () => { 
        state.walletConnected = false; 
        state.wallet=null; 
        state.walletShort=null; 
        emit(); 
      });
      p.on("accountChanged", (pk) => { 
        state.walletConnected=!!pk; 
        state.wallet=pk?.toString?.()||null; 
        state.walletShort=state.wallet?shortPk(state.wallet):null; 
        emit(); 
        refresh().catch(()=>{}); 
      });
    } catch {}
  }

  // Check if wallet is already connected
  if (p?.publicKey) {
    state.walletConnected = true;
    state.wallet = p.publicKey.toString();
    state.walletShort = shortPk(state.wallet);
    emit();
  }

  let saved = null;
  try { saved = localStorage.getItem("tonfans:tier"); } catch {}
  if (saved) {
    setTier(saved).catch(()=>{});
  } else {
    // Default tier on first visit (keeps UI alive even if ui.js loads earlier)
    const defTier = (window.TONFANS_CONFIG && window.TONFANS_CONFIG.defaultTier) ? window.TONFANS_CONFIG.defaultTier : 'littlegen';
    try { localStorage.setItem("tonfans:tier", defTier); } catch {}
    setTier(defTier).catch(()=>{});
  }
})();
