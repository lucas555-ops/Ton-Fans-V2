// assets/js/mint.js (v8) — TON Fans (DEVNET)
// Fixes:
// - RPC 403/CORS: hard devnet RPC list + failover
// - More robust supply parsing (avoid false "Sold out" due to NaN/0 parsing)
// - Group/guard resolution + price
// - Exposes window.TONFANS.mint API for ui.js

const DEVNET_RPCS = [
  "https://api.devnet.solana.com",
  "https://rpc.ankr.com/solana_devnet",
];

const CLUSTER = "devnet";
const MINT_LIMIT_ID = 1;          // must match your Candy Guard mintLimit.id
const MAX_QTY = 3;                // project rule: max 3 per wallet
const CU_LIMIT = 800_000;

// Devnet CM addresses (your approved list)
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
  else { await connectWallet(); await refresh(); }
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
  const sp = guards?.solPayment ?? null;
  const v = sp?.value ?? sp;
  const amt = v?.amount ?? v?.lamports ?? v;
  return toBigIntMaybe(amt);
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

  // supply
  itemsAvailable: null,
  itemsRedeemed: null,
  itemsRemaining: null,

  // pricing
  priceSol: null,

  // flags
  ready: false,
  mintLimit: MAX_QTY,

  // ui
  busy: false,
  busyLabel: "",
  hint: "Select a tier.",
  hintKind: "info",
};

function getState(){ return JSON.parse(JSON.stringify(state)); }

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

  try { localStorage.setItem("tonfans:tier", tierRaw || ""); } catch {}
  emit();

  if (!state.cmId) {
    setHint("Tier выбран, но CM ID не найден (проверь mapping).", "error");
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
      setHint("Candy Machine NOT wrapped by Candy Guard (run `sugar guard add` for this tier).", "error");
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
    state.priceSol = lamportsToSol(lamports);

    // readiness:
    // - If remaining is known and ==0 => sold out.
    // - If remaining unknown (null) => do NOT block (avoid false sold-out).
    if (state.itemsRemaining === 0) {
      state.ready = false;
      setHint(`Sold out (${state.itemsRedeemed ?? "?"}/${state.itemsAvailable ?? "?"}).`, "error");
    } else {
      state.ready = true;
      const p = state.priceSol == null ? "price: —" : `price: ${state.priceSol} SOL`;
      const sup = (state.itemsRemaining == null) ? "" : ` • left: ${state.itemsRemaining}`;
      const grp = state.guardGroup ? `group: ${state.guardGroup}` : "base guards";
      setHint(`Ready (${grp}, ${p}${sup}).`, "ok");
    }

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

async function mintNow(qty=1){
  if (!state.cmId) throw new Error("Select a tier first.");
  if (!state.walletConnected) throw new Error("Connect wallet first.");
  if (!state.ready) throw new Error(state.itemsRemaining === 0 ? "Sold out." : "Not ready.");

  const q = Math.max(1, Math.min(MAX_QTY, Number(qty || 1)));

  setBusy(true, "Minting…");
  setHint(`Minting x${q}…`, "info");

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

    // choose group if exists
    let group = null;
    const groups = cg.groups || [];
    group = labels.find(l => groups.some(g => g.label === l)) || null;

    const resolved = resolveGuardsByLabels(cg, labels);
    const guards = resolved.guards;

    const mintArgs = {};
    if (guards?.mintLimit) mintArgs.mintLimit = { id: MINT_LIMIT_ID };

    const collectionMint = cm.collectionMint || cm.collection?.mint;
    const collectionUpdateAuthority = cm.collectionUpdateAuthority || cm.collection?.updateAuthority;
    if (!collectionMint || !collectionUpdateAuthority) throw new Error("CM missing collectionMint/collectionUpdateAuthority.");

    for (let i=0;i<q;i++){
      const nftMint = sdk.generateSigner(umi);
      const ix = sdk.mintV2(umi, {
        candyMachine: cm.publicKey || cmPk,
        nftMint,
        collectionMint,
        collectionUpdateAuthority,
        ...(cm.tokenStandard ? { tokenStandard: cm.tokenStandard } : {}),
        ...(group ? { group } : {}),
        ...(Object.keys(mintArgs).length ? { mintArgs } : {}),
      });

      const builder = sdk.transactionBuilder()
        .add(sdk.setComputeUnitLimit(umi, { units: CU_LIMIT }))
        .add(ix);

      await builder.sendAndConfirm(umi);
      await sleep(150);
    }

    setHint("Mint complete.", "ok");
    await refresh();
  } catch (e) {
    setHint(e?.message || String(e), "error");
    throw e;
  } finally {
    setBusy(false, "");
  }
}

// init + expose
window.TONFANS = window.TONFANS || {};
window.TONFANS.mint = { setTier, toggleConnect, refresh, mintNow, getState };

(function init(){
  const p = getProvider();
  if (p?.on) {
    try {
      p.on("connect", () => { state.walletConnected = !!p.publicKey; state.wallet = p.publicKey?.toString?.()||null; state.walletShort = state.wallet?shortPk(state.wallet):null; emit(); refresh().catch(()=>{}); });
      p.on("disconnect", () => { state.walletConnected = false; state.wallet=null; state.walletShort=null; emit(); });
      p.on("accountChanged", (pk) => { state.walletConnected=!!pk; state.wallet=pk?.toString?.()||null; state.walletShort=state.wallet?shortPk(state.wallet):null; emit(); refresh().catch(()=>{}); });
    } catch {}
  }

  let saved = null;
  try { saved = localStorage.getItem("tonfans:tier"); } catch {}
  if (saved) setTier(saved).catch(()=>{});
  else emit();
})();
