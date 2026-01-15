// assets/js/mint.js (v17) — TON Fans (DEVNET)
// Fixes:
// - RPC 403/CORS: hard devnet RPC list + failover
// - More robust supply parsing (avoid false "Sold out" due to NaN/0 parsing)
// - Group/guard resolution + price
// - Exposes window.TONFANS.mint API for ui.js

const DEVNET_RPCS = [
  "https://api.devnet.solana.com",
  // Fallback (some providers can rate-limit / return non-standard payloads)
  "https://rpc.ankr.com/solana_devnet",
];

const CLUSTER = "devnet";
const MINT_LIMIT_ID = 1;          // must match your Candy Guard mintLimit.id
const MAX_QTY = 3;                // project rule: max 3 per wallet
const CU_LIMIT = 800_000;

console.log("[TONFANS] mint.js v19 loaded");

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
}// ---- UI helper events (ui.js listens)
function emitToast(message, kind="info"){
  try { window.dispatchEvent(new CustomEvent("tonfans:toast", { detail: { message: String(message||""), kind } })); } catch {}
}
function emitQty(qty){
  try { window.dispatchEvent(new CustomEvent("tonfans:qty", { detail: { qty: Number(qty||1) } })); } catch {}
}

// ---- MintLimit counter (Candy Guard mintLimit)
let CGSDK = null;
async function loadCandyGuardSdk(){
  if (CGSDK) return CGSDK;
  // version chosen to match Candy Machine v6 + Umi v1
  CGSDK = await import("https://esm.sh/@metaplex-foundation/mpl-candy-guard@0.7.0?bundle");
  return CGSDK;
}

function extractMintCounterCount(counter){
  if (!counter) return 0;
  const c = counter.count ?? counter.mintCount ?? counter.minted ?? counter.value ?? 0;
  try {
    if (typeof c === "bigint") return Number(c);
    if (typeof c === "number") return c;
    if (typeof c === "string") return Number(c);
    return Number(c?.toString?.() ?? 0);
  } catch { return 0; }
}

async function fetchWalletMintedCount(){
  if (!state.walletConnected || !state.wallet || !state.guardPk) return null;
  try {
    await loadSdk();
    if (!umi) await rebuildUmi();
    attachWalletIdentity();
    const sdk = SDK;
    const cg = await loadCandyGuardSdk();

    const userPk = sdk.publicKey(String(state.wallet));
    const guardPk = sdk.publicKey(String(state.guardPk));
    const id = MINT_LIMIT_ID;

    // Find PDA (prefer helper if present)
    let pda = null;
    if (typeof cg.findMintCounterPda === "function"){
      pda = cg.findMintCounterPda(umi, { id, user: userPk, candyGuard: guardPk });
    } else if (typeof cg.findMintCounterPdaFromSeeds === "function"){
      pda = cg.findMintCounterPdaFromSeeds(umi, { id, user: userPk, candyGuard: guardPk });
    }

    // Safe fetch (prefer safeFetch if present)
    let counter = null;
    if (typeof cg.safeFetchMintCounter === "function" && pda){
      counter = await withFailover(() => cg.safeFetchMintCounter(umi, pda));
    } else if (typeof cg.safeFetchMintCounterFromSeeds === "function"){
      counter = await withFailover(() => cg.safeFetchMintCounterFromSeeds(umi, { id, user: userPk, candyGuard: guardPk }));
    } else if (typeof cg.fetchMintCounter === "function"){
      if (!pda) throw new Error("MintCounter PDA helper missing");
      counter = await withFailover(() => cg.fetchMintCounter(umi, pda));
    } else if (typeof cg.fetchMintCounterFromSeeds === "function"){
      counter = await withFailover(() => cg.fetchMintCounterFromSeeds(umi, { id, user: userPk, candyGuard: guardPk }));
    }

    if (!counter) return 0; // not initialized yet => 0 minted
    return extractMintCounterCount(counter);
  } catch (e){
    // can't read counter -> let on-chain guard enforce, but we won't block mint client-side
    return null;
  }
}

async function updateWalletMintCounter(){
  const minted = await fetchWalletMintedCount();
  state.mintedCount = minted;
  state.mintedRemaining = (minted == null) ? null : Math.max(0, MAX_QTY - Number(minted||0));
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

  // Handle Option-like wrappers used by some Umi builds
  const kind = sp.__kind ?? sp.__option ?? null;
  if (kind && String(kind).toLowerCase().includes("none")) return null;

  const inner = sp.value ?? (Array.isArray(sp.fields) ? sp.fields[0] : null) ?? sp;

  // Common shapes:
  // - { amount: SolAmount } where SolAmount has basisPoints (lamports)
  // - { lamports: bigint }
  // - SolAmount itself
  const candidate = inner?.amount ?? inner?.lamports ?? inner?.basisPoints ?? inner;
  const bi = toBigIntMaybe(candidate);

  // If we couldn't parse a number, treat as missing guard
  if (bi == null) return null;

  return bi;
}

function extractSolPaymentDestination(guards){
  const sp = guards?.solPayment;
  if (!sp) return null;

  const kind = sp.__kind ?? sp.__option ?? null;
  if (kind && String(kind).toLowerCase().includes("none")) return null;

  const inner = sp.value ?? (Array.isArray(sp.fields) ? sp.fields[0] : null) ?? sp;

  // Common shapes:
  // - { destination: PublicKey }
  // - { destinationAddress: PublicKey }
  // - { destination: { publicKey: ... } } (rare)
  const d = inner?.destination ?? inner?.destinationAddress ?? inner?.destination?.publicKey ?? null;

  // Normalize to base58 string if possible
  if (!d) return null;
  if (typeof d === "string") return d;
  if (typeof d === "object"){
    if (typeof d.toString === "function") return String(d);
    if (d.bytes) return String(d); // Umi PublicKey toString works
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
  mintedCount: null,          // number minted by this wallet (mintLimit id)
  mintedRemaining: null,      // remaining mints for this wallet (0..3)

  // ui
  busy: false,
  busyLabel: "",
  hint: "Select a tier.",
  hintKind: "info",
};

function getState(){ return JSON.parse(JSON.stringify(state)); }

// Resolve collection update authority safely (prevents CandyGuard PublicKeyMismatch)
async function resolveCollectionUpdateAuthority(cm, collectionMint){
  // Try direct fields first
  const direct = cm?.collectionUpdateAuthority
    ?? cm?.collection?.updateAuthority
    ?? cm?.collection?.updateAuthorityAddress
    ?? cm?.collectionUpdateAuthorityAddress
    ?? null;

  if (direct) return direct;

  // Fallback: read updateAuthority from collection metadata (Token Metadata)
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

  try { localStorage.setItem("tonfans:tier", tierRaw || ""); } catch {}
  emit();

  if (!state.cmId) {
    setHint("Tier выбран, но CM ID не найден (проверь mapping).", "error");
    return;
  }

  if (!state.isFree && !state.solDestination) {
    setHint('Missing solPayment destination from Candy Guard. Re-check guard config (solPayment destination) or use base guards.', 'error');
    emit();
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
    const dest = extractSolPaymentDestination(resolved.guards);
    state.solDestination = dest;
    state.isFree = (lamports == null);
    state.priceSol = state.isFree ? 0 : lamportsToSol(lamports);

    // readiness:
    // - If remaining is known and ==0 => sold out.
    // - If remaining unknown (null) => do NOT block (avoid false sold-out).
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
    try { if (state.walletConnected) await updateWalletMintCounter(); } catch {}

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

  let q = Math.max(1, Math.min(MAX_QTY, Number(qty || 1)));


// ---- Client-side mintLimit precheck (prevents botTax when already 3/3)
try {
  if (state.walletConnected && state.guardPk){
    const minted = await fetchWalletMintedCount();
    if (minted != null){
      state.mintedCount = minted;
      state.mintedRemaining = Math.max(0, MAX_QTY - Number(minted||0));
      emit();

      const remaining = state.mintedRemaining;
      if (remaining <= 0){
        setHint("Mint limit reached (3 per wallet).", "error");
        emitToast("Mint limit reached (3 per wallet)", "warn");
        // Do NOT send any transaction (no bot tax)
        return;
      }
      if (q > remaining){
        q = remaining;
        emitQty(q);
        emitToast(`Only ${remaining}/3 remaining for this wallet — minting ${q} now.`, "info");
        setHint(`Only ${remaining}/3 remaining — minting x${q}.`, "info");
      }
    }
  }
} catch {}

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
        "This Candy Machine was deployed without a collection (or older layout). " +
        "Fix: redeploy with a collection or set/verify collection via sugar, then retry."
      );
    }

    const cua = (typeof collectionUpdateAuthority === 'string') ? SDK.publicKey(String(collectionUpdateAuthority)) : collectionUpdateAuthority;
    const cMint = (typeof collectionMint === 'string') ? SDK.publicKey(String(collectionMint)) : collectionMint;

    for (let i=0;i<q;i++){
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

      // send with retry if blockhash expires while user approves in wallet
      try {
        await builder.sendAndConfirm(umi);
      } catch (e) {
        if (isBlockhashNotFound(e) || isRecentBlockhashFailed(e)) {
          setHint("RPC/blockhash hiccup — retrying with fresh blockhash…", "info");
          try { await rotateRpc(); } catch {}
          // rebuild and try once more
          const builder2 = sdk.transactionBuilder()
            .add(sdk.setComputeUnitLimit(umi, { units: CU_LIMIT }))
            .add(ix);
          await builder2.sendAndConfirm(umi);
        } else {
          throw e;
        }
      }
      await sleep(150);
    }

    setHint("Mint complete.", "ok");
    emitQty(1);
    try { if (state.walletConnected) await updateWalletMintCounter(); } catch {}
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
