/* assets/js/mint.js
TON Fans — Mint + Wallet logic (Phantom + Metaplex Candy Machine)

✅ Tier -> Candy Machine mapping (4 CMs)
✅ Sticky-bar connect works on desktop + mobile (Phantom deep-link + autoconnect)
✅ Remembers selected tier across reload / Phantom deep-link
✅ Mints sequentially (safer on mobile), shows tx link
*/

const CM_CLUSTER = "devnet"; // change to "mainnet-beta" for production
const COLLECTION_MINT = "9Zz8cBzFny6ZSzETZZxUeo7Qdi4nRTedNQVVwGhQ9P5w";

// Deployed Candy Machines (devnet)
const CM_BY_TIER = {
  littlegen: "Hr9YzscC71vdHifZR4jRvMd8JmmGxbJrS6j7QckEVqKy",
  biggen: "Ewhn2nJV6tbvq59GMahyWmS54jQWL4n3mrsoVM8n8GHH",
  littlegen_diamond: "8L5MLvbvM9EsZ8nb1NAwqzEXuVsiq5x5fHGNKchz6UQR",
  biggen_diamond: "EyjoAcKwkfNo8NqCZczHHnNSi3ccYpnCetkBUwbqCien",
};

const tiers = {
  littlegen: { label: "LittlGEN", price: 0.10, supply: 500, cm: CM_BY_TIER.littlegen, desc: "Entry tier — the core GEN." },
  biggen: { label: "BigGEN", price: 0.125, supply: 500, cm: CM_BY_TIER.biggen, desc: "Upgraded GEN — bolder vibe." },
  littlegen_diamond: { label: "LittlGEN Diamond", price: 0.15, supply: 185, cm: CM_BY_TIER.littlegen_diamond, desc: "Diamond tier — rare crystal traits." },
  biggen_diamond: { label: "BigGEN Diamond", price: 0.20, supply: 185, cm: CM_BY_TIER.biggen_diamond, desc: "Top Diamond — max flex." },
};

function $(id) { return document.getElementById(id); }
function fmtSol(x) { return `${Number(x).toFixed(3)} SOL`; }
function shorten(pk) { return pk ? `${pk.slice(0,4)}…${pk.slice(-4)}` : ""; }

function toast(msg, type = "info") {
  const el = $("mintStatus");
  if (!el) return;
  el.textContent = msg;
  el.className = `mint-status ${type}`;
}

/* ---------------- Wallet (Phantom) ---------------- */

function getProvider() {
  // Desktop usually: window.solana. Mobile in-app often: window.phantom.solana
  const p =
    (window.solana && (window.solana.isPhantom || window.solana.isPhantomWallet)) ? window.solana :
    (window.phantom && window.phantom.solana) ? window.phantom.solana :
    window.solana || null;

  return p || null;
}

function providerExists() {
  return !!getProvider();
}

function setAutoconnectFlag() {
  try { localStorage.setItem("tonfans_autoconnect", "1"); } catch {}
}

function clearAutoconnectFlag() {
  try { localStorage.removeItem("tonfans_autoconnect"); } catch {}
}

function openPhantomLink() {
  setAutoconnectFlag();
  const url = new URL(window.location.href);
  url.searchParams.set("autoconnect", "1");

  // Preserve tier choice explicitly (safe even if localStorage blocked)
  try { url.searchParams.set("tier", selected); } catch {}

  window.location.href = `https://phantom.app/ul/browse/${encodeURIComponent(url.toString())}`;
}

async function connectWallet({ preferPrompt = false } = {}) {
  const provider = getProvider();
  if (!provider) {
    openPhantomLink();
    return null;
  }

  try {
    const resp = preferPrompt
      ? await provider.connect()
      : await provider.connect({ onlyIfTrusted: true }).catch(() => provider.connect());

    const pk = resp?.publicKey?.toString?.() || provider?.publicKey?.toString?.();
    if (pk) setWalletPubkey(pk);
    return pk || null;
  } catch (e) {
    console.error(e);
    toast("Wallet connect failed. Try again.", "error");
    throw e;
  }
}

async function disconnectWallet() {
  const provider = getProvider();
  try {
    if (provider?.disconnect) await provider.disconnect();
  } finally {
    setWalletPubkey("");
  }
}

/* ---------------- State / UI ---------------- */

let selected = "littlegen";
let userTierPicked = false;
let walletPubkey = "";

function rememberTier() {
  try {
    localStorage.setItem("tonfans_selected_tier", selected);
    localStorage.setItem("tonfans_user_tier_picked", userTierPicked ? "1" : "0");
  } catch {}
}

function restoreTier() {
  // Priority: URL param tier (for Phantom deep-link), then localStorage
  try {
    const urlTier = new URL(window.location.href).searchParams.get("tier");
    if (urlTier && tiers[urlTier]) selected = urlTier;
  } catch {}

  try {
    const t = localStorage.getItem("tonfans_selected_tier");
    const picked = localStorage.getItem("tonfans_user_tier_picked");
    if (t && tiers[t]) selected = t;
    userTierPicked = picked === "1";
  } catch {}
}

function setWalletPubkey(pk) {
  walletPubkey = pk || "";
  try {
    if (walletPubkey) localStorage.setItem("tonfans_wallet_pubkey", walletPubkey);
    else localStorage.removeItem("tonfans_wallet_pubkey");
  } catch {}
  syncConnectCTA();
  updateStickyBar();
}

function syncConnectCTA() {
  const connected = !!walletPubkey;
  const provider = getProvider();

  const connectBtn = $("connectBtn");
  const disconnectBtn = $("disconnectBtn");
  const walletPill = $("walletPill");
  const walletAddr = $("walletAddr");

  if (connectBtn) {
    connectBtn.hidden = connected;
    connectBtn.textContent = provider ? "Connect Wallet" : "Open in Phantom";
  }
  if (disconnectBtn) disconnectBtn.hidden = !connected;
  if (walletPill) walletPill.hidden = !connected;
  if (walletAddr) walletAddr.textContent = connected ? shorten(walletPubkey) : "";
}

function showStickyBar() {
  const sticky = $("stickyMintBar");
  if (!sticky) return;
  sticky.hidden = false;
  document.body.classList.add("sticky-mint-visible");
}

function hideStickyBar() {
  const sticky = $("stickyMintBar");
  if (!sticky) return;
  sticky.hidden = true;
  document.body.classList.remove("sticky-mint-visible");
}

function setTier(tierKey, { silent = false } = {}) {
  if (!tiers[tierKey]) return;
  selected = tierKey;

  if (!silent) {
    userTierPicked = true;
    rememberTier();
    showStickyBar();
  } else {
    rememberTier();
  }

  // Update selected card style
  document.querySelectorAll("[data-tier]").forEach((el) => {
    el.classList.toggle("selected", el.getAttribute("data-tier") === tierKey);
  });

  const t = tiers[tierKey];

  // Mint panel
  $("tierTitle") && ($("tierTitle").textContent = t.label);
  $("tierDesc") && ($("tierDesc").textContent = t.desc);
  $("priceLabel") && ($("priceLabel").textContent = fmtSol(t.price));
  $("supplyLeft") && ($("supplyLeft").textContent = `${t.supply}`);

  $("cmAddress") && ($("cmAddress").textContent = t.cm || "—");
  const explorer = $("cmExplorerLink");
  if (explorer) explorer.href = t.cm ? `https://explorer.solana.com/address/${t.cm}?cluster=${CM_CLUSTER}` : "#";

  const mintBtn = $("mintBtn");
  if (mintBtn) mintBtn.disabled = !t.cm;

  // Top pill
  $("tierPillLabel") && ($("tierPillLabel").textContent = t.label);
  $("tierPillPrice") && ($("tierPillPrice").textContent = fmtSol(t.price));

  // Sticky labels
  $("stickyTierLabel") && ($("stickyTierLabel").textContent = t.label);
  $("stickyPrice") && ($("stickyPrice").textContent = fmtSol(t.price));

  updateTotal();
  updateStickyBar();
}

function updateTotal() {
  const qtyEl = $("mintQty");
  const totalEl = $("totalPrice");
  const stickyTotal = $("stickyTotal");
  const qty = Math.max(1, Math.min(10, parseInt(qtyEl?.value || "1", 10) || 1));
  if (qtyEl && qtyEl.value !== String(qty)) qtyEl.value = String(qty);

  const total = tiers[selected].price * qty;
  if (totalEl) totalEl.textContent = fmtSol(total);
  if (stickyTotal) stickyTotal.textContent = fmtSol(total);
}

function updateStickyBar() {
  const sticky = $("stickyMintBar");
  if (!sticky) return;

  if (!userTierPicked) {
    hideStickyBar();
    return;
  }

  const connected = !!walletPubkey;
  const provider = getProvider();

  const stickyActionBtn = $("stickyActionBtn");
  const stickyChangeBtn = $("stickyChangeBtn");

  if (stickyChangeBtn) {
    stickyChangeBtn.onclick = () => {
      const el = document.querySelector("#tiers");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  }

  if (!stickyActionBtn) return;

  if (!connected) {
    stickyActionBtn.textContent = provider ? "Connect Wallet" : "Open in Phantom";
    stickyActionBtn.onclick = () => connectWallet({ preferPrompt: true });
    return;
  }

  if (!tiers[selected]?.cm) {
    stickyActionBtn.textContent = "Select Tier";
    stickyActionBtn.onclick = () => {
      const el = document.querySelector("#tiers");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    return;
  }

  stickyActionBtn.textContent = "Mint Now";
  stickyActionBtn.onclick = () => {
    const el = document.querySelector("#mint");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => $("mintBtn")?.focus?.(), 350);
  };
}

/* ---------------- Metaplex minting ---------------- */

const _deps = { loaded: false, v: null };

async function loadDeps() {
  if (_deps.loaded) return _deps.v;

  const [
    { createUmi },
    { walletAdapterIdentity },
    umiCore,
    candy,
    toolbox,
    { TokenStandard },
    bs58mod,
  ] = await Promise.all([
    import("https://esm.sh/@metaplex-foundation/umi-bundle-defaults@1.0.1"),
    import("https://esm.sh/@metaplex-foundation/umi-signer-wallet-adapters@1.0.1"),
    import("https://esm.sh/@metaplex-foundation/umi@1.0.1"),
    import("https://esm.sh/@metaplex-foundation/mpl-candy-machine@6.0.0"),
    import("https://esm.sh/@metaplex-foundation/mpl-toolbox@0.10.0"),
    import("https://esm.sh/@metaplex-foundation/mpl-token-metadata@3.2.0"),
    import("https://esm.sh/bs58@5.0.0"),
  ]);

  _deps.v = {
    createUmi,
    walletAdapterIdentity,
    publicKey: umiCore.publicKey,
    generateSigner: umiCore.generateSigner,
    transactionBuilder: umiCore.transactionBuilder,
    mplCandyMachine: candy.mplCandyMachine,
    fetchCandyMachine: candy.fetchCandyMachine,
    mintV2: candy.mintV2,
    setComputeUnitLimit: toolbox.setComputeUnitLimit,
    createMintWithAssociatedToken: toolbox.createMintWithAssociatedToken,
    findAssociatedTokenPda: toolbox.findAssociatedTokenPda,
    TokenStandard,
    bs58: bs58mod.default,
  };

  _deps.loaded = true;
  return _deps.v;
}

function endpointForCluster(cluster) {
  return cluster === "devnet"
    ? "https://api.devnet.solana.com"
    : "https://api.mainnet-beta.solana.com";
}

function phantomAdapter(provider) {
  return {
    publicKey: provider.publicKey,
    signTransaction: provider.signTransaction.bind(provider),
    signAllTransactions: provider.signAllTransactions?.bind(provider),
    signMessage: provider.signMessage?.bind(provider),
    connect: provider.connect.bind(provider),
    disconnect: provider.disconnect?.bind(provider),
  };
}

async function mintOnce({ cmAddress }) {
  const provider = getProvider();
  if (!provider) {
    openPhantomLink();
    throw new Error("NO_PROVIDER");
  }
  if (!walletPubkey) {
    await connectWallet({ preferPrompt: true });
    if (!walletPubkey) throw new Error("NO_WALLET");
  }

  const d = await loadDeps();

  const umi = d
    .createUmi(endpointForCluster(CM_CLUSTER))
    .use(d.walletAdapterIdentity(phantomAdapter(provider)))
    .use(d.mplCandyMachine());

  const cmPk = d.publicKey(cmAddress);
  const candyMachine = await d.fetchCandyMachine(umi, cmPk);

  const nftMint = d.generateSigner(umi);
  const owner = umi.identity.publicKey;

  // For standard NFTs token account isn't strictly required, but creating it makes the flow robust.
  const ata = d.findAssociatedTokenPda(umi, { mint: nftMint.publicKey, owner });

  const builder = d
    .transactionBuilder()
    .add(d.setComputeUnitLimit(umi, { units: 800_000 }))
    .add(d.createMintWithAssociatedToken(umi, { mint: nftMint, owner, decimals: 0 }))
    .add(
      d.mintV2(umi, {
        candyMachine: cmPk,
        nftMint,
        // optional but safe:
        token: ata,
        collectionMint: candyMachine.collectionMint,
        collectionUpdateAuthority: candyMachine.authority,
        tokenStandard: d.TokenStandard.NonFungible,
      })
    );

  const { signature } = await builder.sendAndConfirm(umi, { confirm: { commitment: "confirmed" } });
  return d.bs58.encode(signature);
}

async function doMint({ quantity }) {
  const tier = tiers[selected];
  if (!tier?.cm) {
    toast("Select a tier first.", "error");
    return;
  }

  const qty = Math.max(1, Math.min(10, Number(quantity) || 1));

  const mintBtn = $("mintBtn");
  const qtyEl = $("mintQty");
  if (mintBtn) mintBtn.disabled = true;
  if (qtyEl) qtyEl.disabled = true;

  try {
    toast(`Minting 1/${qty}…`, "info");
    for (let i = 0; i < qty; i++) {
      toast(`Minting ${i + 1}/${qty}…`, "info");
      const sig = await mintOnce({ cmAddress: tier.cm });
      const link = `https://explorer.solana.com/tx/${sig}?cluster=${CM_CLUSTER}`;
      // Show last tx link (helpful feedback)
      const out = $("mintStatus");
      if (out) out.innerHTML = `Minted ✅ (${i + 1}/${qty}) — <a href="${link}" target="_blank" rel="noopener">View TX</a>`;
    }
  } catch (e) {
    console.error(e);
    if (String(e?.message || "").includes("User rejected")) {
      toast("Transaction rejected in wallet.", "error");
    } else {
      toast("Mint failed. Try again (or mint 1 at a time).", "error");
    }
  } finally {
    if ($("mintBtn")) $("mintBtn").disabled = false;
    if ($("mintQty")) $("mintQty").disabled = false;
  }
}

/* ---------------- Boot ---------------- */

function initTierUI() {
  restoreTier();
  setTier(selected, { silent: true });
  if (userTierPicked) showStickyBar();

  document.querySelectorAll("[data-tier]").forEach((card) => {
    card.addEventListener("click", () => {
      const t = card.getAttribute("data-tier");
      if (t) setTier(t, { silent: false });
    });
  });

  $("mintQty")?.addEventListener("input", () => {
    updateTotal();
    updateStickyBar();
  });
}

function initWalletUI() {
  $("connectBtn")?.addEventListener("click", () => connectWallet({ preferPrompt: true }));
  $("disconnectBtn")?.addEventListener("click", () => disconnectWallet());

  const provider = getProvider();
  if (provider?.on) {
    provider.on("connect", () => {
      const pk = provider.publicKey?.toString?.();
      if (pk) setWalletPubkey(pk);
    });
    provider.on("disconnect", () => setWalletPubkey(""));
    provider.on("accountChanged", (pk) => setWalletPubkey(pk ? pk.toString() : ""));
  }

  // Auto connect (deep-link) or trusted connect
  const url = new URL(window.location.href);
  const wantsAuto = url.searchParams.get("autoconnect") === "1" || (localStorage.getItem("tonfans_autoconnect") === "1");

  if (wantsAuto) {
    clearAutoconnectFlag();
    url.searchParams.delete("autoconnect");
    // keep tier param (useful)
    window.history.replaceState({}, "", url.toString());
    connectWallet({ preferPrompt: true }).finally(syncConnectCTA);
    return;
  }

  const saved = localStorage.getItem("tonfans_wallet_pubkey");
  if (saved && provider?.connect) {
    provider.connect({ onlyIfTrusted: true })
      .then(() => {
        const pk = provider.publicKey?.toString?.();
        if (pk) setWalletPubkey(pk);
      })
      .catch(() => {});
  }

  syncConnectCTA();
}

function initMintButton() {
  $("mintBtn")?.addEventListener("click", async () => {
    const qty = Number($("mintQty")?.value || 1);
    await doMint({ quantity: qty });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initTierUI();
  initWalletUI();
  initMintButton();
  updateStickyBar();
});
