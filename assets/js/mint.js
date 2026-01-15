// assets/js/mint.js
// TON FANS — Candy Machine v3 (Sugar) mint module (browser-ready, no build step).
// Fixes UI + mint flow for multi-tier mints.
//
// ✅ Selected tier (state + events)
// ✅ Ready Yes/No (wrapped + supply)
// ✅ Price / Estimated total (best-effort from solPayment guard)
// ✅ Mint now реально запускает mintV2
//
// Load order (IMPORTANT):
// 1) any legacy inline scripts (if you still keep them)
// 2) <script type="module" src="assets/js/mint.js?v=5"></script>
// 3) <script src="assets/js/ui.js?v=5"></script>
//
// Candy Machine JS SDK uses Umi + mpl-candy-machine. Docs:
// - createUmi + mplCandyMachine plugin + fetchCandyMachine/fetchCandyGuard 
// - mintV2 + setComputeUnitLimit 

import { createUmi } from "https://esm.sh/@metaplex-foundation/umi-bundle-defaults@1.4.1?bundle";
import { publicKey, generateSigner, transactionBuilder } from "https://esm.sh/@metaplex-foundation/umi@1.3.0?bundle";
import { mplCandyMachine, fetchCandyMachine, fetchCandyGuard, mintV2 } from "https://esm.sh/@metaplex-foundation/mpl-candy-machine@6.1.0?bundle";
import { mplTokenMetadata } from "https://esm.sh/@metaplex-foundation/mpl-token-metadata@3.4.0?bundle";
import { walletAdapterIdentity } from "https://esm.sh/@metaplex-foundation/umi-signer-wallet-adapters@1.4.1?bundle";
import { setComputeUnitLimit } from "https://esm.sh/@metaplex-foundation/mpl-toolbox@0.10.0?bundle";

// -------------------------
// helpers
// -------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function safeString(x) {
 try { return String(x); } catch { return ""; }
}

function shortPk(pk, n = 4) {
 const s = safeString(pk);
 if (s.length <= (n * 2 + 3)) return s;
 return `${s.slice(0, n)}…${s.slice(-n)}`;
}

function firstEl(selectors) {
 for (const s of selectors) {
 const el = document.querySelector(s);
 if (el) return el;
 }
 return null;
}

function getAllTierButtons() {
 return Array.from(document.querySelectorAll("[data-tier]"));
}

function parsePkMaybe(v) {
 if (!v) return null;
 const s = String(v).trim();
 if (s.length < 32) return null;
 try { return publicKey(s); } catch { return null; }
}

// -------------------------
// Config discovery (flexible)
// -------------------------
function readConfigFromDOM() {
 const tierBtns = getAllTierButtons();
 const tiers = {};

 for (const btn of tierBtns) {
 const tier = btn.getAttribute("data-tier");
 if (!tier) continue;

 const cm =
 btn.getAttribute("data-cm") ||
 btn.getAttribute("data-cmid") ||
 btn.getAttribute("data-candy-machine") ||
 btn.getAttribute("data-candy-machine-id") ||
 btn.dataset?.cm ||
 btn.dataset?.cmid ||
 btn.dataset?.candyMachine ||
 btn.dataset?.candyMachineId;

 const group =
 btn.getAttribute("data-group") ||
 btn.dataset?.group ||
 null;

 if (cm) {
 tiers[tier] = {
 candyMachineId: cm.trim(),
 group: group ? String(group).trim() : null,
 };
 }
 }

 const metaMap = {
 littlegen: "cm-littlegen",
 biggen: "cm-biggen",
 "littlegen-diamond": "cm-littlegen-diamond",
 "biggen-diamond": "cm-biggen-diamond",
 };
 for (const [tier, metaName] of Object.entries(metaMap)) {
 if (tiers[tier]?.candyMachineId) continue;
 const meta = document.querySelector(`meta[name="${metaName}"]`);
 if (meta?.getAttribute("content")) {
 tiers[tier] = { candyMachineId: meta.getAttribute("content").trim(), group: null };
 }
 }

 const root = document.documentElement;
 const body = document.body;

 const rpc =
 body?.getAttribute("data-rpc") ||
 root?.getAttribute("data-rpc") ||
 body?.dataset?.rpc ||
 root?.dataset?.rpc ||
 null;

 const defaultTier =
 body?.getAttribute("data-default-tier") ||
 root?.getAttribute("data-default-tier") ||
 body?.dataset?.defaultTier ||
 root?.dataset?.defaultTier ||
 null;

 return { rpc, defaultTier, tiers };
}

function readConfigFromWindow() {
 const candidates = [
 "TONFANS_CONFIG",
 "TON_FANS_CONFIG",
 "CANDY_MACHINE_CONFIG",
 "CM_CONFIG",
 "__CM_CONFIG__",
 "__TONFANS_CONFIG__",
 ];

 for (const key of candidates) {
 const v = window[key];
 if (v && typeof v === "object") {
 const rpc = v.rpc || v.RPC || v.rpcEndpoint || v.endpoint || null;
 const defaultTier = v.defaultTier || v.default || null;
 const tiers = v.tiers || v.TIERS || null;
 if (tiers && typeof tiers === "object") return { rpc, defaultTier, tiers };
 }
 }
 return null;
}

function mergeTierConfig(domCfg, winCfg) {
 const out = {
 rpc: (winCfg?.rpc || domCfg?.rpc || "https://api.mainnet-beta.solana.com").trim(),
 defaultTier: (winCfg?.defaultTier || domCfg?.defaultTier || null),
 tiers: {},
 };

 const allTiers = new Set([
 ...Object.keys(domCfg?.tiers || {}),
 ...Object.keys(winCfg?.tiers || {}),
 "littlegen",
 "biggen",
 "littlegen-diamond",
 "biggen-diamond",
 ]);

 for (const t of allTiers) {
 const a = winCfg?.tiers?.[t] || null;
 const b = domCfg?.tiers?.[t] || null;
 const candyMachineId = (a?.candyMachineId || a?.cm || a?.id || b?.candyMachineId || b?.cm || b?.id || "").trim();
 const group = (a?.group || b?.group || null);
 if (candyMachineId) out.tiers[t] = { candyMachineId, group: group ? String(group) : null };
 }

 if (!out.defaultTier) out.defaultTier = Object.keys(out.tiers)[0] || "littlegen";
 return out;
}

// -------------------------
// Eventing
// -------------------------
function createEmitter() {
 const subs = new Set();
 return {
 on(fn) { subs.add(fn); return () => subs.delete(fn); },
 emit(data) {
 for (const fn of subs) {
 try { fn(data); } catch {}
 }
 try { window.dispatchEvent(new CustomEvent("tonfans:state", { detail: data })); } catch {}
 }
 };
}
const emitter = createEmitter();

// -------------------------
// State
// -------------------------
const state = {
 rpc: "https://api.mainnet-beta.solana.com",
 wallet: { connected: false, address: null, short: null },
 tiers: {}, // {tier:{candyMachineId, group?}}
 selectedTier: null,
 candyMachine: null, // fetched CM
 candyGuard: null, // fetched guard (if wrapped)
 supply: { available: null, redeemed: null, remaining: null },
 pricing: { priceSol: null, estimatedTotalSol: null },
 readiness: { ready: false, reason: "init" },
 ui: { status: "idle", message: "" },
};

function getPublicState() {
 return JSON.parse(JSON.stringify(state));
}

function setStatus(status, message = "") {
 state.ui.status = status;
 state.ui.message = message;
 emitter.emit(getPublicState());
}

// -------------------------
// Wallet
// -------------------------
function getProvider() {
 return window.solana || null;
}

async function connectWallet() {
 const provider = getProvider();
 if (!provider) throw new Error("No Solana wallet found. Install Phantom (or compatible) and refresh.");

 if (!provider.publicKey) await provider.connect();

 const address = provider.publicKey?.toString?.() || null;
 state.wallet.connected = !!address;
 state.wallet.address = address;
 state.wallet.short = address ? shortPk(address) : null;
 emitter.emit(getPublicState());
 return address;
}

async function disconnectWallet() {
 const provider = getProvider();
 if (provider?.disconnect) {
 try { await provider.disconnect(); } catch {}
 }
 state.wallet.connected = false;
 state.wallet.address = null;
 state.wallet.short = null;
 emitter.emit(getPublicState());
}

// -------------------------
// Umi (lazy)
// -------------------------
let umi = null;

function getUmi() {
 if (umi) return umi;
 umi = createUmi(state.rpc).use(mplCandyMachine()).use(mplTokenMetadata());
 return umi;
}

function attachWalletToUmi() {
 const provider = getProvider();
 if (!provider) return;

 const walletAdapter = {
 publicKey: provider.publicKey,
 connected: !!provider.publicKey,
 connecting: false,
 disconnecting: false,
 connect: async () => { await provider.connect(); walletAdapter.publicKey = provider.publicKey; walletAdapter.connected = true; },
 disconnect: async () => { if (provider.disconnect) await provider.disconnect(); walletAdapter.publicKey = null; walletAdapter.connected = false; },
 signTransaction: async (tx) => {
 if (!provider.signTransaction) throw new Error("Wallet does not support signTransaction");
 return await provider.signTransaction(tx);
 },
 signAllTransactions: async (txs) => {
 if (provider.signAllTransactions) return await provider.signAllTransactions(txs);
 const out = [];
 for (const tx of txs) out.push(await walletAdapter.signTransaction(tx));
 return out;
 },
 };

 getUmi().use(walletAdapterIdentity(walletAdapter));
}

// -------------------------
// Candy Guard parsing (price best-effort)
// -------------------------
function resolveGuards(guard, groupLabel) {
 if (!guard) return null;
 if (!groupLabel) return guard.guards || null;

 const groups = guard.groups || [];
 const found = groups.find((g) => g.label === groupLabel);
 if (!found) return guard.guards || null;

 const base = guard.guards || {};
 const grp = found.guards || {};
 return { ...base, ...grp };
}

function solAmountToNumber(v) {
 if (v == null) return null;

 // object forms (SolAmount)
 if (typeof v === "object") {
 const inner = v.basisPoints ?? v.lamports ?? v.amount ?? null;
 if (inner != null) v = inner;
 }

 try {
 const lamports = typeof v === "bigint" ? v : BigInt(String(v));
 const sol = Number(lamports) / 1_000_000_000;
 return Number.isFinite(sol) ? sol : null;
 } catch {
 return null;
 }
}

// -------------------------
// Fetch + compute state
// -------------------------
async function refresh() {
 if (!state.selectedTier) return;

 const tierCfg = state.tiers[state.selectedTier];
 if (!tierCfg?.candyMachineId) {
 state.readiness.ready = false;
 state.readiness.reason = "missing_candy_machine_id";
 setStatus("error", `Missing Candy Machine ID for tier: ${state.selectedTier}`);
 return;
 }

 const cmPk = parsePkMaybe(tierCfg.candyMachineId);
 if (!cmPk) {
 state.readiness.ready = false;
 state.readiness.reason = "bad_candy_machine_id";
 setStatus("error", `Bad Candy Machine ID for tier: ${state.selectedTier}`);
 return;
 }

 setStatus("loading", "Fetching Candy Machine…");

 try {
 const cm = await fetchCandyMachine(getUmi(), cmPk);
 state.candyMachine = cm;

 // Supply
 const available = Number(cm.itemsAvailable ?? 0);
 const redeemed = Number(cm.itemsRedeemed ?? 0);
 const remaining = Math.max(available - redeemed, 0);

 state.supply.available = Number.isFinite(available) ? available : null;
 state.supply.redeemed = Number.isFinite(redeemed) ? redeemed : null;
 state.supply.remaining = Number.isFinite(remaining) ? remaining : null;

 // Guard (wrapped check): docs show mintAuthority points to Candy Guard when wrapped 
 let guard = null;
 try {
 guard = await fetchCandyGuard(getUmi(), cm.mintAuthority);
 state.candyGuard = guard;
 } catch {
 state.candyGuard = null;
 }

 // Price from solPayment
 const resolved = resolveGuards(state.candyGuard, tierCfg.group);
 const solPayment = resolved?.solPayment || null;
 const priceSol = solAmountToNumber(solPayment?.amount ?? solPayment);

 state.pricing.priceSol = priceSol;
 state.pricing.estimatedTotalSol = priceSol;

 // Readiness
 if (!state.candyGuard) {
 state.readiness.ready = false;
 state.readiness.reason = "not_wrapped";
 setStatus("idle", "Candy Machine is NOT wrapped by Candy Guard.");
 } else if (state.supply.remaining === 0) {
 state.readiness.ready = false;
 state.readiness.reason = "sold_out";
 setStatus("idle", "Sold out.");
 } else {
 state.readiness.ready = true;
 state.readiness.reason = "ok";
 setStatus("idle", "Ready.");
 }

 emitter.emit(getPublicState());
 } catch (e) {
 state.candyMachine = null;
 state.candyGuard = null;
 state.readiness.ready = false;
 state.readiness.reason = "fetch_failed";
 setStatus("error", e?.message ? `Fetch failed: ${e.message}` : `Fetch failed: ${safeString(e)}`);
 }
}

async function selectTier(tier) {
 if (!tier) return;
 if (!state.tiers[tier]) return;

 state.selectedTier = tier;
 try { localStorage.setItem("tonfans:selectedTier", tier); } catch {}
 emitter.emit(getPublicState());

 await refresh();
}

// -------------------------
// Mint
// -------------------------
async function sendBuilder(builder) {
 // SDKs provide sendAndConfirm(umi) as in docs 
 if (typeof builder.sendAndConfirm === "function") return await builder.sendAndConfirm(getUmi());
 if (typeof builder.send === "function") return await builder.send(getUmi());
 throw new Error("Transaction builder missing sendAndConfirm/send.");
}

async function mintOne() {
 if (!state.readiness.ready) throw new Error(`Not ready: ${state.readiness.reason}`);
 if (!state.wallet.connected) throw new Error("Wallet not connected.");
 if (!state.candyMachine) throw new Error("Candy Machine not loaded.");

 attachWalletToUmi();

 const cm = state.candyMachine;
 const tierCfg = state.tiers[state.selectedTier] || {};

 // Minting docs require collectionMint + collectionUpdateAuthority 
 const collectionMint = cm.collectionMint || cm.collection?.mint || null;
 const collectionUpdateAuthority = cm.collectionUpdateAuthority || cm.collection?.updateAuthority || null;

 if (!collectionMint || !collectionUpdateAuthority) {
 throw new Error("Candy Machine missing collectionMint / collectionUpdateAuthority.");
 }

 const nftMint = generateSigner(getUmi());

 const ix = mintV2(getUmi(), {
 candyMachine: cm.publicKey || cm.address || cm.id,
 nftMint,
 collectionMint,
 collectionUpdateAuthority,
 ...(cm.tokenStandard ? { tokenStandard: cm.tokenStandard } : {}),
 ...(tierCfg.group ? { group: tierCfg.group } : {}),
 });

 const builder = transactionBuilder()
 .add(setComputeUnitLimit(getUmi(), { units: 800_000 }))
 .add(ix);

 return await sendBuilder(builder);
}

async function mint(quantity = 1) {
 const q = Math.max(1, Math.min(10, Number(quantity || 1)));
 setStatus("minting", `Minting x${q}…`);

 const results = [];
 for (let i = 0; i < q; i++) {
 try {
 const r = await mintOne();
 results.push(r);
 await sleep(250);
 } catch (e) {
 setStatus("error", e?.message || safeString(e));
 throw e;
 }
 }

 setStatus("success", `Mint complete (${q}).`);
 await refresh();
 return results;
}

// -------------------------
// Init
// -------------------------
async function init() {
 const domCfg = readConfigFromDOM();
 const winCfg = readConfigFromWindow();
 const cfg = mergeTierConfig(domCfg, winCfg);

 state.rpc = cfg.rpc;
 state.tiers = cfg.tiers;

 // Selected tier
 let tier = null;
 try { tier = localStorage.getItem("tonfans:selectedTier"); } catch {}
 if (!tier || !state.tiers[tier]) tier = cfg.defaultTier || "littlegen";
 if (!state.tiers[tier]) tier = Object.keys(state.tiers)[0] || "littlegen";
 state.selectedTier = tier;

 // Wallet status (no popup)
 const provider = getProvider();
 if (provider?.publicKey) {
 state.wallet.connected = true;
 state.wallet.address = provider.publicKey.toString();
 state.wallet.short = shortPk(state.wallet.address);
 }

 emitter.emit(getPublicState());

 // Wallet events
 if (provider?.on) {
 try {
 provider.on("connect", () => {
 state.wallet.connected = !!provider.publicKey;
 state.wallet.address = provider.publicKey?.toString?.() || null;
 state.wallet.short = state.wallet.address ? shortPk(state.wallet.address) : null;
 emitter.emit(getPublicState());
 });
 provider.on("disconnect", () => {
 state.wallet.connected = false;
 state.wallet.address = null;
 state.wallet.short = null;
 emitter.emit(getPublicState());
 });
 provider.on("accountChanged", (pk) => {
 state.wallet.connected = !!pk;
 state.wallet.address = pk?.toString?.() || null;
 state.wallet.short = state.wallet.address ? shortPk(state.wallet.address) : null;
 emitter.emit(getPublicState());
 });
 } catch {}
 }

 // Expose API
 window.TonFansMint = {
 version: "tonfans-mint-v5",
 getState: () => getPublicState(),
 onState: (fn) => emitter.on(fn),
 connectWallet,
 disconnectWallet,
 selectTier,
 refresh,
 mint,
 };

 // Safe fallback bindings (in case ui.js isn't loaded)
 for (const btn of getAllTierButtons()) {
 btn.addEventListener("click", async (e) => {
 const t = btn.getAttribute("data-tier");
 if (!t) return;
 e.preventDefault();
 e.stopImmediatePropagation?.();
 await selectTier(t);
 }, { capture: true });
 }

 const mintBtn = firstEl(["#mintBtn", "#mintNow", ".mint-now", "[data-mint]", "[data-action='mint']"]);
 if (mintBtn) {
 mintBtn.addEventListener("click", async (e) => {
 e.preventDefault();
 e.stopImmediatePropagation?.();
 const qtyEl = firstEl(["#mintQty", "input[name='qty']", "[data-mint-qty]"]);
 const qty = qtyEl ? Number(qtyEl.value || 1) : 1;
 try { await mint(qty); } catch {}
 }, { capture: true });
 }

 const connectBtn = firstEl(["#connectBtn", "#connectWallet", ".connect-wallet", "[data-action='connect']"]);
 if (connectBtn) {
 connectBtn.addEventListener("click", async (e) => {
 e.preventDefault();
 e.stopImmediatePropagation?.();
 try {
 await connectWallet();
 await refresh();
 } catch (err) {
 setStatus("error", err?.message || safeString(err));
 }
 }, { capture: true });
 }

 // Initial fetch
 await refresh();

 return window.TonFansMint;
}

if (document.readyState === "loading") {
 document.addEventListener("DOMContentLoaded", () => init().catch(() => {}));
} else {
 init().catch(() => {});
}
