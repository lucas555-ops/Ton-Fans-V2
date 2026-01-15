// assets/js/mint.js (v22) — TON Fans (DEVNET)
// Fixes:
// - Supply всегда обновляется (даже при mintedRemaining = null)
// - Безопасный запуск при первом заходе
// - Улучшенное кэширование tier
// - Массив последних транзакций (топовая фича)

const DEVNET_RPCS = [
  "https://api.devnet.solana.com",
  "https://rpc.ankr.com/solana_devnet",
];

const CLUSTER = "devnet";
const MINT_LIMIT_ID = 1;
const MAX_QTY = 3;
const CU_LIMIT = 800_000;

console.log("[TONFANS] mint.js v22 loaded");

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
    
    if (typeof cg.safeFetchMintCounterFromSeeds === "function"){
      try {
        counter = await cg.safeFetchMintCounterFromSeeds(umi, { id, user, candyGuard });
      } catch {}
    }

    if (!counter && typeof cg.findMintCounterPda === "function" && typeof cg.fetchMintCounter === "function"){
      try {
        const pda = cg.findMintCounterPda(umi, { id, user, candyGuard });
        counter = await cg.fetchMintCounter(umi, pda);
      } catch {}
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
  
  const capped = Math.min(MAX_QTY, cnt);
  state.mintedCount = capped;
  state.mintedRemaining = Math.max(0, MAX_QTY - capped);
  
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

function currentRpc(){ return DEVNET_RPCS[rpcIdx] || DEVNET_RPCS[0]; }

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
  rpcIdx = (rpcIdx + 1) % DEVNET_RPCS.length;
  return rebuildUmi();
}

function isForbidden(err){
  const m = String(err?.message || err || "").toLowerCase();
  return m.includes("access forbidden") || m.includes("forbidden") || m.includes("403");
}

async function withFailover(fn){
  let last = null;
  for (let attempt = 0; attempt < DEVNET_RPCS.length; attempt++){
    try {
      if (!umi) await rebuildUmi();
      return await fn();
    } catch(e){
      last = e;
      if (isForbidden(e) || (e?.name === "TypeError" && String(e?.message||"").includes("fetch"))) {
        if (rpcIdx < DEVNET_RPCS.length - 1) {
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
  
  const explorerUrl = `https://solscan.io/tx/${signature}?cluster=devnet`;
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

  // PRO-LEVEL UX: кнопка активна, но при remaining=0 только toast, без транзы
  if (state.mintedRemaining !== null && state.mintedRemaining <= 0) {
    const msg = "Mint limit reached (3 per wallet)";
    setHint(msg, "error");
    emitToast(msg, "info"); // info, а не error, чтобы не пугать
    emitQty(1);
    emit();
    return; // НИКАКОЙ транзакции, НИКАКОГО botTax
  }

  // Check if we need to adjust quantity
  if (state.mintedRemaining !== null) {
    const remaining = Number(state.mintedRemaining);

    if (q > remaining) {
      const msg = `Only ${remaining}/3 remaining — adjusting quantity to ${remaining}.`;
      setHint(msg, "info");
      emitToast(msg, "info");
      
      try {
        await _executeMint(remaining);
      } catch (err) {
        // Error handled in _executeMint
      }
      return;
    }
  }

  await _executeMint(q);
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

    // After successful mint
    emitQty(1);
    setHint("Mint complete.", "ok");
    
    if (signatures.length === 1) {
      emitToast(`Mint successful! Tx: ${signatures[0].slice(0, 8)}…`, "ok");
    } else {
      emitToast(`Minted ${signatures.length} NFTs successfully!`, "ok");
    }
    
    await refresh();
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
  if (saved) setTier(saved).catch(()=>{});
  else emit();
})();
