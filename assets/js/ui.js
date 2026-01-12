/*
  TON Fans — subtle UI enhancements
  - Micro-effects on cards (border glow + glass sweep)
  - Reveal-on-scroll for sections
  - Copy buttons with toast feedback
*/

(() => {
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------- Toast ----------
  const ensureToast = () => {
    let el = document.getElementById('toast');
    if (el) return el;

    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.innerHTML = '<span class="toast-dot"></span><span id="toastText">Copied</span>';
    document.body.appendChild(el);
    return el;
  };

  let toastTimer = null;
  const showToast = (msg) => {
    const el = ensureToast();
    const txt = el.querySelector('#toastText');
    if (txt) txt.textContent = msg;

    el.classList.add('toast--show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('toast--show'), 1200);
  };

  // Clipboard helper with fallback
  const copyToClipboard = async (text) => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}

    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (_) {
      return false;
    }
  };

  // ---------- Card micro-effects ----------
  const enhanceCards = () => {
    // Add fx to div.card only (skip img.card etc.)
    qsa('div.card').forEach((el) => el.classList.add('fx-card'));
    // Buttons shouldn't sweep
    qsa('.btn-primary, .btn-ghost').forEach((el) => el.classList.add('fx-no-sweep'));
  };

  // ---------- Reveal on scroll ----------
  const setupReveal = () => {
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    // Reveal all anchors + explicitly marked sections
    const targets = new Set([
      ...qsa('section.anchor'),
      ...qsa('section[data-reveal]'),
    ]);

    // If a section has no .anchor but is clearly a content block, allow opt-in by data-reveal
    targets.forEach((el) => el.classList.add('reveal'));

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('reveal-in');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );

    targets.forEach((el) => {
      // If already in view on load, reveal immediately to avoid flicker
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.9) {
        el.classList.add('reveal-in');
      } else {
        io.observe(el);
      }
    });
  };

  // ---------- Copy buttons ----------
  const setupCopyButtons = () => {
    qsa('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-copy');
        const el = id ? document.getElementById(id) : null;
        const text = (el?.textContent || '').trim();

        if (!text || text === 'TBD') {
          showToast('Not set yet');
          return;
        }

        const ok = await copyToClipboard(text);
        if (ok) {
          const prev = btn.textContent;
          btn.textContent = 'Copied';
          showToast('Copied');
          setTimeout(() => (btn.textContent = prev), 900);
        } else {
          showToast('Copy failed');
        }
      });
    });
  };

  
  // ---------- Section focus pulse (Jobs-level) ----------
  const setupSectionFocus = () => {
    const flash = (id) => {
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      // restart animation cleanly
      el.classList.remove('section-flash');
      // eslint-disable-next-line no-unused-expressions
      void el.offsetWidth;
      el.classList.add('section-flash');
      window.setTimeout(() => el.classList.remove('section-flash'), 900);
    };

    // Anchors like <a href="#tiers">
    document.addEventListener('click', (e) => {
      const a = e.target?.closest?.('a[href^="#"]');
      if (!a) return;
      const href = a.getAttribute('href') || '';
      const id = href.slice(1);
      if (!id) return;
      // only for real sections, avoid noisy flashes on tiny jumps
      if (id === 'tiers' || id === 'mint') {
        window.setTimeout(() => flash(id), 420);
      }
    });

    // Buttons opting in via data-focus="tiers"
    document.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('[data-focus]');
      if (!btn) return;
      const id = btn.getAttribute('data-focus');
      if (!id) return;
      window.setTimeout(() => flash(id), 420);
    });

    // If user lands with hash
    window.addEventListener('hashchange', () => {
      const id = (window.location.hash || '').replace('#', '');
      if (id === 'tiers' || id === 'mint') {
        window.setTimeout(() => flash(id), 260);
      }
    });
  };



// ---------- Sticky Mint Bar auto-hide when Mint CTA is visible (Apple-clean) ----------
// Hide sticky quick-actions only when the primary Mint button is actually visible.
// This avoids duplicated CTAs and feels cleaner than section-based suppression.
const setupStickyAutoHide = () => {
  const sticky = document.getElementById('stickyMintBar');
  const mintBtn = document.getElementById('mintBtn');
  if (!sticky || !mintBtn) return;

  const apply = (hide) => {
    if (hide) {
      sticky.classList.add('sticky-suppressed');
      document.body.classList.remove('has-sticky');
    } else {
      sticky.classList.remove('sticky-suppressed');
      // Only add padding if sticky is actually shown
      if (!sticky.classList.contains('hidden')) {
        document.body.classList.add('has-sticky');
      }
    }
  };

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        // Hide when the actual Mint CTA is on screen.
        apply(entry.isIntersecting);
      });
    },
    {
      threshold: 0.12,
      // Slightly earlier suppression as the button approaches the viewport.
      rootMargin: '0px 0px -18% 0px',
    }
  );

  io.observe(mintBtn);
};
// ---------- Boot ----------
  document.addEventListener('DOMContentLoaded', () => {
    enhanceCards();
    setupReveal();
    setupCopyButtons();
    setupSectionFocus();
    setupStickyAutoHide();
  });
})();
 
