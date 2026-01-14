// TONFANS Mint (v6) — Umi + mpl-candy-machine (Candy Guard / Guard Groups)
// IMPORTANT: This file does NOT bind Connect/Mint buttons (ui.js does), to avoid double-click conflicts.
//
// References:
// - Guard groups + `group: some('label')`: Metaplex Candy Machine JS docs.
// - MintLimit mintArgs uses `some({ id })`: same docs.

import { createUmi } from "https://esm.sh/@metaplex-foundation/umi-bundle-defaults@1.4.1?bundle";
import { publicKey, transactionBuilder, generateSigner, some } from "https://esm.sh/@metaplex-foundation/umi@1.4.1?bundle";
import { createSignerFromWalletAdapter, walletAdapterIdentity } from "https://esm.sh/@metaplex-foundation/umi-signer-wallet-adapters@1.4.1?bundle";
import { mplTokenMetadata } from "https://esm.sh/@metaplex-foundation/mpl-token-metadata@3.4.0?bundle";
import { mplCandyMachine, fetchCandyMachine, safeFetchCandyGuard, fetchCandyGuard, mintV2 } from "https://esm.sh/@metaplex-foundation/mpl-candy-machine@6.1.0?bundle";
import { setComputeUnitLimit, setComputeUnitPrice } from "https://esm.sh/@metaplex-foundation/mpl-toolbox@0.10.0?bundle";

// -------------------- CONFIG (update if needed) --------------------
const CM_BY_TIER = {
  littlegen: "Hr9YzscC71vdHifZR4jRvMd8JmmGxbJrS6j7QckEVqKy",
  biggen: "Ewhn2nJV6tbvq59GMahyWmS54jQWL4n3mrsoVM8n8GHH",
  littlegen_diamond: "8L5MLvbvM9EsZ8nb1NAwqzEXuVsiq5x5fHGNKchz6UQR",
  biggen_diamond: "EyjoAcKwkfNo8NqCZczHHnNSi3ccYpnCetkBUwbqCien",
};

// Default RPC behaviour:
// - If URL has ?rpc=... we use it.
// - Else if URL has ?cluster=devnet|mainnet-beta we use that.
// - Else we try mainnet-beta first, then devnet (auto-fallback).
const RPC_BY_CLUSTER = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
};

const DEFAULT_MICRO_LAMPORTS = 1_000;
const DEFAULT_CU_LIMIT = 800_000;

// -------------------- INTERNAL STATE --------------------
const state = {
  tier: null,
  cmId: null,
  rpc: null,
  networkLabel: null,

  // wallet
  walletConnected: false,
  walletLabel: "",
  walletPk: null,

  // candy
  candyGuardPk: null,
  candyGuard: null,
  useGroup: false,
  groupLabel: null,
  mintLimitId: null,
  priceLamports: null,

  // ui-ish
  qty: 1,
  busy: false,
  hint: "",
};

let umi = null;
let provider = null;

// -------------------- HELPERS --------------------
const $ = (sel, root = document) => root.querySelector(sel);

function dispatch(extra = {}) {
  window.dispatchEvent(
    new CustomEvent("tonfans:state", {
      detail: {
        networkLabel: state.networkLabel,
        walletConnected: state.walletConnected,
        walletLabel: state.walletLabel,
        ready: computeReady(),
        busy: state.busy,
        tier: state.tier,
        guardLabel: state.groupLabel || state.tier || "—",
        hint: state.hint,
        ...extra,
      },
    })
  );
}

function setHint(msg) {
  state.hint = msg || "";
  dispatch();
}

function computeReady() {
  return !!(state.walletConnected && state.tier && state.cmId && umi && !state.busy);
}

function unwrapOption(opt) {
  if (!opt || typeof opt !== "object") return null;
  if ("__option" in opt) return opt.__option === "Some" ? opt.value : null;
  return opt; // already unwrapped
}

function toBigInt(v) {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(Math.trunc(v));
    if (typeof v === "string") return BigInt(v);
    if (v && typeof v === "object" && "basisPoints" in v) return BigInt(v.basisPoints);
  } catch (_) {}
  return null;
}

function formatSolFromLamports(lamports) {
  const L = toBigInt(lamports);
  if (L == null) return null;
  const denom = 1_000_000_000n;
  const whole = L / denom;
  const frac = L % denom;
  if (frac === 0n) return whole.toString();
  let fracStr = frac.toString().padStart(9, "0");
  fracStr = fracStr.replace(/0+$/, "");
  return `${whole.toString()}.${fracStr}`;
}

function resolveRpcCandidates() {
  const qs = new URLSearchParams(location.search);
  const rpc = qs.get("rpc");
  const cluster = qs.get("cluster");

  if (rpc) return [{ rpc, label: cluster || "custom" }];

  if (cluster && RPC_BY_CLUSTER[cluster]) return [{ rpc: RPC_BY_CLUSTER[cluster], label: cluster }];

  return [
    { rpc: RPC_BY_CLUSTER["mainnet-beta"], label: "mainnet-beta" },
    { rpc: RPC_BY_CLUSTER["devnet"], label: "devnet" },
  ];
}

function getProvider() {
  return window.solana || null;
}

function applyWalletIdentity() {
  if (!umi || !provider?.publicKey) return;
  try {
    const signer = createSignerFromWalletAdapter(provider);
    umi.use(walletAdapterIdentity(signer));
  } catch (_) {
    // wallet not initialized or incompatible
  }
}

async function ensureUmi(rpc) {
  if (umi && state.rpc === rpc) return umi;

  umi = createUmi(rpc);
  umi.use(mplTokenMetadata());
  umi.use(mplCandyMachine());

  state.rpc = rpc;

  // If wallet already connected, attach identity
  applyWalletIdentity();
  return umi;
}

async function ensureWalletConnected({ silent = false } = {}) {
  provider = getProvider();
  if (!provider) {
    setHint("Wallet not found. Install Phantom / Solflare.");
    return false;
  }

  try {
    if (!provider.publicKey) {
      await provider.connect(silent ? { onlyIfTrusted: true } : undefined);
    }
  } catch (e) {
    if (!silent) setHint("Wallet connection cancelled.");
    return false;
  }

  if (!provider.publicKey) return false;

  state.walletConnected = true;
  state.walletPk = provider.publicKey.toString();
  state.walletLabel = state.walletPk;

  applyWalletIdentity();
  dispatch();
  return true;
}

async function disconnectWallet() {
  provider = getProvider();
  try { await provider?.disconnect?.(); } catch (_) {}
  state.walletConnected = false;
  state.walletPk = null;
  state.walletLabel = "";
  dispatch();
}

// -------------------- CANDY / GUARD RESOLUTION --------------------
const TIER_GROUP_ALIASES = {
  littlegen: "lgen",
  biggen: "bgen",
  littlegen_diamond: "ldia",
  biggen_diamond: "bdia",
};

function normalizeTier(tier) {
  const t = String(tier || "").trim().toLowerCase();
  if (t === "littlegen-diamond") return "littlegen_diamond";
  if (t === "biggen-diamond") return "biggen_diamond";
  return t;
}

function pickGuardsFromCandyGuard(cg, groupLabel) {
  const base = (cg?.guards && (cg.guards.default || cg.guards)) || cg?.defaultGuards || {};
  const baseGuards = unwrapOption(base) || base;

  const groups = cg?.groups || cg?.data?.groups || null;

  let group = null;
  const wanted = String(groupLabel || "").toLowerCase();
  const alias = (TIER_GROUP_ALIASES[wanted] || "").toLowerCase();

  if (Array.isArray(groups)) {
    group = groups.find((g) => String(g?.label || "").toLowerCase() === wanted);
    if (!group && alias) {
      group = groups.find((g) => String(g?.label || "").toLowerCase() === alias);
    }
  } else if (groups && typeof groups === "object") {
    group = groups[groupLabel] || groups[wanted] || null;
    if (!group && alias) group = groups[alias] || null;
  }

  const groupGuards = group?.guards ? (unwrapOption(group.guards) || group.guards) : null;

  const resolved = { ...(baseGuards || {}) };
  if (groupGuards) {
    Object.assign(resolved, groupGuards);
    return { resolvedGuards: resolved, hasGroup: true, usedGroup: group?.label || groupLabel };
  }
  return { resolvedGuards: resolved, hasGroup: false, usedGroup: null };
}

function extractSolPaymentLamports(resolvedGuards) {
  const sp = unwrapOption(resolvedGuards?.solPayment);
  if (!sp) return null;

  if ("lamports" in sp) return sp.lamports;

  if ("amount" in sp) {
    const a = sp.amount;
    if (a && typeof a === "object" && "basisPoints" in a) return a.basisPoints;
    return a;
  }

  if ("value" in sp && sp.value) {
    const v = sp.value;
    if ("lamports" in v) return v.lamports;
    if ("amount" in v) return v.amount;
  }

  return null;
}

function extractMintLimitId(resolvedGuards) {
  const ml = unwrapOption(resolvedGuards?.mintLimit);
  if (!ml) return null;
  if (typeof ml === "object") {
    if ("id" in ml) return ml.id;
    if ("identifier" in ml) return ml.identifier;
  }
  return null;
}

async function fetchCandyMachineWithFallback(cmId) {
  const candidates = resolveRpcCandidates();

  for (const c of candidates) {
    try {
      await ensureUmi(c.rpc);
      const cmPk = publicKey(cmId);
      const cm = await fetchCandyMachine(umi, cmPk);

      state.networkLabel = c.label;
      dispatch();
      return cm;
    } catch (_) {
      // try next rpc
    }
  }

  throw new Error("Candy Machine not found on mainnet/devnet with current CM id.");
}

async function resolveCandyGuard(cm) {
  const mintAuth = cm?.mintAuthority || cm?.data?.mintAuthority;
  if (!mintAuth) throw new Error("Candy Machine mintAuthority missing.");

  const cgPk = publicKey(mintAuth);
  state.candyGuardPk = cgPk;

  let cg = null;
  try { cg = await safeFetchCandyGuard(umi, cgPk); } catch (_) {}
  if (!cg) {
    try { cg = await fetchCandyGuard(umi, cgPk); } catch (_) {}
  }
  if (!cg) throw new Error("Candy Machine is not wrapped by Candy Guard (or guard not found).");

  state.candyGuard = cg;
  return cg;
}

async function refreshForTier(tier) {
  const t = normalizeTier(tier);
  state.tier = t;
  state.cmId = CM_BY_TIER[t] || null;

  if (!state.cmId) {
    setHint("Candy Machine ID for this tier is not set.");
    return;
  }

  setHint("Loading Candy Machine…");

  try {
    const cm = await fetchCandyMachineWithFallback(state.cmId);
    const cg = await resolveCandyGuard(cm);

    const { resolvedGuards, hasGroup, usedGroup } = pickGuardsFromCandyGuard(cg, state.tier);
    state.useGroup = hasGroup;
    state.groupLabel = hasGroup ? String(usedGroup || state.tier) : null;

    const lamports = extractSolPaymentLamports(resolvedGuards);
    state.priceLamports = lamports != null ? toBigInt(lamports) : null;

    const priceLabel = state.priceLamports != null ? formatSolFromLamports(state.priceLamports) : null;
    const totalLabel =
      state.priceLamports != null ? formatSolFromLamports(state.priceLamports * BigInt(Math.max(1, state.qty))) : null;

    const mintLimitId = extractMintLimitId(resolvedGuards);
    state.mintLimitId = mintLimitId != null ? Number(mintLimitId) : null;

    setHint(hasGroup ? `Guard group: ${state.groupLabel}` : "Guard: default");

    dispatch({
      // only send if we have a real value (ui.js will keep its own otherwise)
      ...(priceLabel ? { priceLabel } : {}),
      ...(totalLabel ? { totalLabel } : {}),
    });
  } catch (e) {
    console.error(e);
    setHint(e?.message || "Failed to load Candy Machine / Guard.");
  }
}

// -------------------- MINT --------------------
async function mintOne() {
  if (!state.tier || !state.cmId) throw new Error("Select a tier first.");

  const cm = await fetchCandyMachineWithFallback(state.cmId);
  await resolveCandyGuard(cm);

  const nftMint = generateSigner(umi);

  const collectionMint = cm?.collectionMint || cm?.data?.collectionMint;
  const collectionUpdateAuthority = cm?.collectionUpdateAuthority || cm?.data?.collectionUpdateAuthority;
  if (!collectionMint || !collectionUpdateAuthority) {
    throw new Error("Collection accounts are missing on Candy Machine.");
  }

  const mintArgs = {};
  if (state.mintLimitId != null) mintArgs.mintLimit = some({ id: Number(state.mintLimitId) });

  const group = state.useGroup && state.groupLabel ? some(String(state.groupLabel)) : undefined;

  const tx = transactionBuilder()
    .add(setComputeUnitLimit(umi, { units: DEFAULT_CU_LIMIT }))
    .add(setComputeUnitPrice(umi, { microLamports: DEFAULT_MICRO_LAMPORTS }))
    .add(
      mintV2(umi, {
        candyMachine: publicKey(state.cmId),
        candyGuard: state.candyGuardPk,
        nftMint,
        collectionMint: publicKey(collectionMint),
        collectionUpdateAuthority: publicKey(collectionUpdateAuthority),
        ...(group ? { group } : {}),
        ...(Object.keys(mintArgs).length ? { mintArgs } : {}),
      })
    );

  const result = await tx.sendAndConfirm(umi);
  return { signature: result.signature, mint: nftMint.publicKey };
}

async function mintNow() {
  if (state.busy) return;
  state.busy = true;
  dispatch();

  try {
    const ok = await ensureWalletConnected({ silent: false });
    if (!ok) throw new Error("Wallet not connected.");

    // Resolve tier at least once
    if (state.tier) await refreshForTier(state.tier);

    const qty = Math.max(1, Math.min(5, Number(state.qty || 1)));
    for (let i = 0; i < qty; i++) {
      setHint(`Minting ${i + 1}/${qty}…`);
      const { signature } = await mintOne();
      setHint(`Minted! Tx: ${signature}`);
    }
  } catch (e) {
    console.error(e);
    setHint(e?.message || "Mint failed.");
  } finally {
    state.busy = false;
    dispatch();
  }
}

// -------------------- QTY (owned by mint.js) --------------------
function clampQty(q) {
  const n = Number(q);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(5, Math.trunc(n)));
}

function setQty(q) {
  state.qty = clampQty(q);
  const el = $("#qty");
  if (el) el.textContent = String(state.qty);

  // update totals if we know price
  if (state.priceLamports != null) {
    const totalLabel = formatSolFromLamports(state.priceLamports * BigInt(state.qty));
    dispatch({ totalLabel });
  } else {
    dispatch();
  }
}

function bindQtyButtons() {
  const minus = $("#qtyMinus");
  const plus = $("#qtyPlus");
  if (minus) minus.addEventListener("click", () => setQty(state.qty - 1));
  if (plus) plus.addEventListener("click", () => setQty(state.qty + 1));
}

// -------------------- PUBLIC API (used by ui.js) --------------------
function toggleConnect() {
  if (state.walletConnected) return disconnectWallet();
  return ensureWalletConnected({ silent: false });
}

function setTier(tier) {
  return refreshForTier(tier);
}

function init() {
  provider = getProvider();

  // UI events
  window.addEventListener("tonfans:tier", (e) => refreshForTier(e?.detail?.tier));
  window.addEventListener("tonfans:qty", (e) => {
    if (e?.detail?.qty != null) state.qty = clampQty(e.detail.qty);
    dispatch();
  });

  // Wallet lifecycle
  if (provider?.on) {
    provider.on("connect", () => {
      state.walletConnected = !!provider.publicKey;
      state.walletLabel = provider.publicKey?.toString?.() || "";
      applyWalletIdentity();
      dispatch();
    });
    provider.on("disconnect", () => {
      state.walletConnected = false;
      state.walletLabel = "";
      dispatch();
    });
  }

  // Best-effort silent connect
  ensureWalletConnected({ silent: true });

  bindQtyButtons();
  dispatch();
}

window.TONFANS = window.TONFANS || {};
window.TONFANS.mint = { toggleConnect, disconnect: disconnectWallet, mintNow, setTier };

init();
