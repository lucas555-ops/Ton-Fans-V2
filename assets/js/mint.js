// assets/js/mint.js (v7)
// TON Fans — Candy Machine (Sugar / CMv3) mint controller for your current index.html.
// Cluster: DEVNET (forced) + RPC failover to avoid 403 "Access forbidden" from bad/private RPCs.
//
// Exposes: window.TONFANS.mint = { setTier, toggleConnect, refresh, mintNow, getState }
//
// IMPORTANT:
// - index.html loads ui.js (defer) then mint.js (type="module").
// - This module dispatches CustomEvent("tonfans:state", {detail: state}) so UI can render.

const DEVNET_RPCS = [
  "https://api.devnet.solana.com",
  "https://rpc.ankr.com/solana_devnet",
];

const CLUSTER = "devnet";          // forced for now
const MINT_LIMIT_ID = 1;           // must match guard config mintLimit.id
const RECOMMENDED_MINT_LIMIT = 3;  // for UI + qty clamp
const CU_LIMIT = 800_000;

const CM_BY_TIER = {
  lgen: "Hr9YzscC71vdHifZR4jRvMd8JmmGxbJrS6j7QckEVqKy",
  bgen: "Ewhn2nJV6tbvq59GMahyWmS54jQWL4n3mrsoVM8n8GHH",
  ldia: "8L5MLvbvM9EsZ8nb1NAwqzEXuVsiq5x5fHGNKchz6UQR",
  bdia: "EyjoAcKwkfNo8NqCZczHHnNSi3ccYpnCetkBUwbqCien",
};

// Accept tier values from HTML + legacy aliases.
const TIER_ALIASES = {
  // html
  littlegen: "lgen",
  biggen: "bgen",
  littlegen_diamond: "ldia",
  biggen_diamond: "bdia",
  // dash variants
  "littlegen-diamond": "ldia",
  "biggen-diamond": "bdia",
  // already keys
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

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function shortPk(s) { if (!s) return ""; return s.slice(0,4)+"…"+s.slice(-4); }

function emit() {
  try {
    window.dispatchEvent(new CustomEvent("tonfans:state", { detail: structuredClone(state) }));
  } catch {
    window.dispatchEvent(new CustomEvent("tonfans:state", { detail: JSON.parse(JSON.stringify(state)) }));
  }
}

function setHint(msg, kind="info") {
  state.hint = msg || "";
  state.hintKind = kind;
  emit();
}

function setBusy(b, label) {
  state.busy = !!b;
  state.busyLabel = label || "";
  emit();
}

function normalizeTier(t) {
  const key = (t || "").toString().trim();
  return TIER_ALIASES[key] || null;
}

function getProvider() {
  return window.solana || null;
}

async function connect() {
  const p = getProvider();
  if (!p) throw new Error("No Solana wallet found. Install Phantom and refresh.");
  if (!p.publicKey) await p.connect();
  state.walletConnected = !!p.publicKey;
  state.wallet = p.publicKey ? p.publicKey.toString() : null;
  state.walletShort = state.wallet ? shortPk(state.wallet) : null;
  emit();
}

async function disconnect() {
  const p = getProvider();
  if (p?.disconnect) {
    try { await p.disconnect(); } catch {}
  }
  state.walletConnected = false;
  state.wallet = null;
  state.walletShort = null;
  emit();
}

async function toggleConnect() {
  const p = getProvider();
  if (!p) throw new Error("No Solana wallet found.");
  if (p.publicKey) {
    await disconnect();
  } else {
    await connect();
    await refresh(); // re-check readiness after connect
  }
}

// -------- SDK loading (Umi + mpl-candy-machine)
let SDK = null;
async function loadSdk() {
  if (SDK) return SDK;

  // Use pinned versions for stability.
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

function currentRpc() { return DEVNET_RPCS[rpcIdx] || DEVNET_RPCS[0]; }

async function makeUmi() {
  const sdk = await loadSdk();
  umi = sdk.createUmi(currentRpc())
    .use(sdk.mplCandyMachine())
    .use(sdk.mplTokenMetadata());
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

// -------- Guard helpers
function mergeGuards(base, override) {
  // shallow merge is enough for guard configs (override replaces base for each guard)
  return { ...(base || {}), ...(override || {}) };
}

function resolveGuardsByLabels(cg, labels) {
  if (!cg) return { guards: null, group: null };
  const base = cg.guards || {};
  const groups = cg.groups || [];
  for (const label of labels) {
    const g = groups.find((x) => x.label === label);
    if (g) return { guards: mergeGuards(base, g.guards || {}), group: label };
  }
  return { guards: base, group: null };
}

function toLamports(v) {
  if (v == null) return null;
  if (typeof v === "object") {
    const inner = v.basisPoints ?? v.lamports ?? v.amount ?? null;
    if (inner != null) v = inner;
  }
  try { return typeof v === "bigint" ? v : BigInt(String(v)); } catch { return null; }
}

function lamportsToSol(lamports) {
  const l = toLamports(lamports);
  if (l == null) return null;
  const sol = Number(l) / 1_000_000_000;
  return Number.isFinite(sol) ? sol : null;
}

function extractSolPaymentLamports(guards) {
  // Supports different shapes: guards.solPayment OR guards.solPayment.value
  const sp = guards?.solPayment ?? null;
  const v = sp?.value ?? sp;
  const amt = v?.amount ?? v?.lamports ?? v;
  return toLamports(amt);
}

function hasMintLimit(guards) {
  return !!guards?.mintLimit;
}

// -------- RPC failover wrapper
function isForbidden(err) {
  const msg = (err?.message || String(err || "")).toLowerCase();
  return msg.includes("access forbidden") || msg.includes("forbidden") || msg.includes("403");
}

async function withRpcFailover(fn, label) {
  const lastIdx = DEVNET_RPCS.length - 1;
  let lastErr = null;

  for (let attempt = 0; attempt < DEVNET_RPCS.length; attempt++) {
    try {
      if (!umi) await makeUmi();
      return await fn();
    } catch (e) {
      lastErr = e;
      // Failover on forbidden/CORS/network type issues.
      if (isForbidden(e) || (e?.name === "TypeError" && String(e?.message||"").includes("fetch"))) {
        if (rpcIdx < lastIdx) {
          rpcIdx++;
          await makeUmi();
          setHint(`RPC switched → ${currentRpc()}`, "info");
          await sleep(80);
          continue;
        }
      }
      break;
    }
  }
  throw lastErr;
}

// -------- state
const state = {
  cluster: CLUSTER,
  rpc: currentRpc(),
  tierKey: null,          // lgen|bgen|ldia|bdia
  tierRaw: null,          // original from UI
  tierLabel: "—",
  cmId: null,

  guardPk: null,
  guardGroup: null,

  walletConnected: false,
  wallet: null,
  walletShort: null,

  ready: false,
  priceSol: null,
  totalSol: null,
  mintLimit: RECOMMENDED_MINT_LIMIT,

  itemsAvailable: null,
  itemsRedeemed: null,
  itemsRemaining: null,

  busy: false,
  busyLabel: "",
  hint: "Select a tier.",
  hintKind: "info",
};

function computeTotal(qty) {
  const q = Math.max(1, Math.min(RECOMMENDED_MINT_LIMIT, Number(qty || 1)));
  if (state.priceSol == null) return null;
  const t = Number(state.priceSol) * q;
  return Number.isFinite(t) ? t : null;
}

async function setTier(tierRaw) {
  const key = normalizeTier(tierRaw);
  state.tierRaw = tierRaw || null;
  state.tierKey = key;
  state.tierLabel = key ? TIER_LABEL[key] : "—";
  state.cmId = key ? CM_BY_TIER[key] : null;
  state.guardPk = null;
  state.guardGroup = null;
  state.ready = false;
  state.priceSol = null;
  state.totalSol = null;

  try { localStorage.setItem("tonfans:tier", tierRaw || ""); } catch {}
  emit();

  if (!key || !state.cmId) {
    setHint("Tier выбран, но CM ID не найден (проверь mapping).", "error");
    return;
  }

  await refresh();
}

async function refresh() {
  if (!state.cmId) {
    state.ready = false;
    state.priceSol = null;
    setHint("Select a tier to load Candy Machine.", "info");
    emit();
    return;
  }

  setBusy(true, "Loading…");
  setHint("Loading Candy Machine…", "info");

  try {
    await loadSdk();
    if (!umi) await makeUmi();

    const sdk = SDK;
    const cmPk = sdk.publicKey(state.cmId);

    const cm = await withRpcFailover(
      async () => await sdk.fetchCandyMachine(umi, cmPk),
      "fetchCandyMachine"
    );

    const available = Number(cm.itemsAvailable ?? 0);
    const redeemed  = Number(cm.itemsRedeemed ?? 0);
    const remaining = Math.max(available - redeemed, 0);

    state.itemsAvailable = Number.isFinite(available) ? available : null;
    state.itemsRedeemed  = Number.isFinite(redeemed) ? redeemed : null;
    state.itemsRemaining = Number.isFinite(remaining) ? remaining : null;

    // Candy Guard is CM.mintAuthority AFTER `sugar guard add`
    state.guardPk = null;
    state.guardGroup = null;
    state.priceSol = null;

    let cg = null;
    try {
      cg = await withRpcFailover(async () => await sdk.fetchCandyGuard(umi, cm.mintAuthority), "fetchCandyGuard");
      state.guardPk = cm.mintAuthority?.toString?.() || null;
    } catch (e) {
      cg = null;
      state.guardPk = null;
    }

    if (!cg) {
      state.ready = false;
      setHint("Candy Machine NOT wrapped by Candy Guard (run `sugar guard add` in this CM folder).", "error");
      emit();
      return;
    }

    // Candidate labels order:
    // 1) exact HTML label (e.g. littlegen_diamond)
    // 2) dash version
    // 3) tierKey (ldia)
    // 4) "default"
    const raw = (state.tierRaw || "").toString();
    const candidates = [
      raw,
      raw.replaceAll("_", "-"),
      state.tierKey,
      "default",
    ].filter(Boolean);

    const resolved = resolveGuardsByLabels(cg, candidates);
    const guards = resolved.guards;
    state.guardGroup = resolved.group;

    // Price (solPayment)
    const lamports = extractSolPaymentLamports(guards);
    state.priceSol = lamportsToSol(lamports);

    // Readiness
    if (state.itemsRemaining === 0) {
      state.ready = false;
      setHint("Sold out.", "error");
    } else {
      state.ready = true;
      const gLabel = state.guardGroup ? `group: ${state.guardGroup}` : "base guards";
      const p = state.priceSol == null ? "price: —" : `price: ${state.priceSol} SOL`;
      setHint(`Ready (${gLabel}, ${p}).`, "ok");
    }

    emit();
  } catch (e) {
    state.ready = false;
    state.priceSol = null;
    setHint(`failed to get info about account ${state.cmId}: ${e?.message || String(e)}`, "error");
    emit();
  } finally {
    setBusy(false, "");
  }
}

async function mintNow(qty = 1) {
  if (!state.cmId) throw new Error("Select a tier first.");
  if (!state.walletConnected) throw new Error("Connect wallet first.");
  if (!state.ready) throw new Error("Not ready (check Candy Guard / RPC).");

  setBusy(true, "Minting…");
  setHint("Minting…", "info");

  try {
    await loadSdk();
    if (!umi) await makeUmi();
    attachWalletIdentity();

    const sdk = SDK;
    const cmPk = sdk.publicKey(state.cmId);

    // Re-fetch CM to ensure fresh state
    const cm = await withRpcFailover(async () => await sdk.fetchCandyMachine(umi, cmPk), "fetchCandyMachine");

    // Determine group label that exists (if any)
    let group = null;
    try {
      const cg = await withRpcFailover(async () => await sdk.fetchCandyGuard(umi, cm.mintAuthority), "fetchCandyGuard");
      const raw = (state.tierRaw || "").toString();
      const labels = [raw, raw.replaceAll("_","-"), state.tierKey, "default"].filter(Boolean);
      const groups = cg.groups || [];
      group = labels.find((l) => groups.some((g) => g.label === l)) || null;

      // If mintLimit guard is configured, provide mintArgs
      const resolved = resolveGuardsByLabels(cg, labels);
      const guards = resolved.guards;

      const mintArgs = {};
      if (hasMintLimit(guards)) mintArgs.mintLimit = { id: MINT_LIMIT_ID };

      // Mint quantity: do sequential mints (safe, wallet prompts per mint).
      const q = Math.max(1, Math.min(RECOMMENDED_MINT_LIMIT, Number(qty || 1)));

      const collectionMint = cm.collectionMint || cm.collection?.mint;
      const collectionUpdateAuthority = cm.collectionUpdateAuthority || cm.collection?.updateAuthority;
      if (!collectionMint || !collectionUpdateAuthority) {
        throw new Error("Candy Machine missing collectionMint / collectionUpdateAuthority.");
      }

      for (let i = 0; i < q; i++) {
        const nftMint = sdk.generateSigner(umi);

        const ix = sdk.mintV2(umi, {
          candyMachine: cm.publicKey || cm.address || cmPk,
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
        await sleep(200);
      }
    } catch (inner) {
      throw inner;
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

function getState() { return structuredClone(state); }

// -------- init
window.TONFANS = window.TONFANS || {};
window.TONFANS.mint = { setTier, toggleConnect, refresh, mintNow, getState };

(function init() {
  // Wallet event listeners
  const p = getProvider();
  if (p?.on) {
    try {
      p.on("connect", () => {
        state.walletConnected = !!p.publicKey;
        state.wallet = p.publicKey ? p.publicKey.toString() : null;
        state.walletShort = state.wallet ? shortPk(state.wallet) : null;
        emit();
        refresh().catch(() => {});
      });
      p.on("disconnect", () => {
        state.walletConnected = false;
        state.wallet = null;
        state.walletShort = null;
        emit();
      });
      p.on("accountChanged", (pk) => {
        state.walletConnected = !!pk;
        state.wallet = pk ? pk.toString() : null;
        state.walletShort = state.wallet ? shortPk(state.wallet) : null;
        emit();
        refresh().catch(() => {});
      });
    } catch {}
  }

  // Restore tier
  let saved = null;
  try { saved = localStorage.getItem("tonfans:tier"); } catch {}
  if (saved) setTier(saved).catch(() => {});
  else emit();

  // Force Devnet label always
  state.cluster = "devnet";
  emit();
})();
