/* ==========================================================================
   CHEKORGANICS — first-order discount popup (welcome-popup.css)
   Same offer and behaviour as the chekorganics.com Shopify popup:
   • home: opens after 3 s; shop / product: after 8 s or half-way down the page
   • closed → stays away for 20 minutes; subscribed → never shown again
   • the email is saved to Firestore `subscribers` (FirebaseDB.saveNewsletter); the free
     Apps Script mailer (email/Code.gs) then emails the code automatically
   • the code is remembered and applied at checkout automatically (app.js)
   ========================================================================== */
(function () {
  "use strict";

  const CODE = "WELCOME10";
  // true once the Apps Script mailer (email/README.md) is set up; it emails the code to new
  // subscribers. While false, the popup doesn't promise an email.
  const EMAILS_ON = true;
  const KEYS = { subscribed: "chek_popup_subscribed", dismissed: "chek_popup_dismissed_at", code: "chek_welcome_code" };
  const RESHOW_MIN = 20;
  const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  const isHome = page === "" || page === "index.html";
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  const $ = (sel, root) => (root || document).querySelector(sel);

  function shouldShow() {
    if (store.get(KEYS.subscribed) === "true") return false;
    const at = Number(store.get(KEYS.dismissed) || 0);
    if (at && (Date.now() - at) / 60000 < RESHOW_MIN) return false;
    return true;
  }

  // never interrupt the shopper while another dialog / drawer is open
  const busy = () => !!document.querySelector(
    ".drawer.is-open, .auth-modal-backdrop.is-open, .mobile-nav.is-open, .acct-pop.is-open, #adv-search-modal.is-open, #rate-modal-overlay.is-open, .amz-loc-pop:not([hidden])"
  );

  let root, lastFocus;

  function build() {
    root = document.createElement("div");
    root.className = "wpop";
    root.hidden = true;
    root.innerHTML =
      '<div class="wpop__overlay" data-wpop-close></div>' +
      '<div class="wpop__box" role="dialog" aria-modal="true" aria-labelledby="wpop-title">' +
        '<button type="button" class="wpop__close" data-wpop-close aria-label="Close popup">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        "</button>" +
        '<div class="wpop__image"><img src="assets/brand/welcome-popup.webp" alt="" width="480" height="720"></div>' +
        '<div class="wpop__content">' +
          '<div class="wpop__step" data-wpop-step>' +
            '<h2 class="wpop__title" id="wpop-title">Enjoy an Exclusive 10% off on your First order</h2>' +
            '<p class="wpop__text">Join our community and discover the power of Ayurvedic wellness. Subscribe to receive your exclusive discount code.</p>' +
            '<form class="wpop__form" data-wpop-form novalidate>' +
              '<input class="wpop__input" type="email" name="email" placeholder="Enter your email" aria-label="Email address" autocomplete="email" required>' +
              '<p class="wpop__error" data-wpop-error role="alert"></p>' +
              '<button class="wpop__btn" type="submit">Claim My Discount</button>' +
            "</form>" +
          "</div>" +
          '<div class="wpop__success" data-wpop-success hidden>' +
            '<h2 class="wpop__title">You&#39;re in! 🌿</h2>' +
            '<p class="wpop__ok">Thank you for joining us! Here&#39;s your exclusive discount code:</p>' +
            '<div class="wpop__code">' +
              '<span class="wpop__code-label">Your discount code</span>' +
              '<span class="wpop__code-value">' + CODE + "</span>" +
              '<button type="button" class="wpop__copy" data-wpop-copy>Copy Code</button>' +
            "</div>" +
            '<p class="wpop__note">It&#39;s applied automatically at checkout.' + (EMAILS_ON ? ' We&#39;re also emailing it to <b data-wpop-email></b>.' : "") + "</p>" +
            '<a class="wpop__btn wpop__btn--link" href="shop.html">Start Shopping</a>' +
          "</div>" +
        "</div>" +
      "</div>";
    document.body.appendChild(root);

    root.addEventListener("click", e => {
      if (e.target.closest("[data-wpop-close]")) close(true);
      if (e.target.closest("[data-wpop-copy]")) copy(e.target.closest("[data-wpop-copy]"));
    });
    $("[data-wpop-form]", root).addEventListener("submit", submit);
    $(".wpop__input", root).addEventListener("input", () => { $("[data-wpop-error]", root).textContent = ""; });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && root && !root.hidden) close(true); });
  }

  function open() {
    if (!shouldShow()) return;
    if (busy()) { setTimeout(open, 4000); return; } // try again once the other dialog is closed
    if (!root) build();
    lastFocus = document.activeElement;
    root.hidden = false;
    requestAnimationFrame(() => root.classList.add("is-open"));
    document.documentElement.classList.add("wpop-lock");
    setTimeout(() => { const i = $(".wpop__input", root); if (i && window.innerWidth > 767) i.focus({ preventScroll: true }); }, 250);
  }

  function close(dismissed) {
    if (!root || root.hidden) return;
    if (dismissed && store.get(KEYS.subscribed) !== "true") store.set(KEYS.dismissed, String(Date.now()));
    root.classList.remove("is-open");
    document.documentElement.classList.remove("wpop-lock");
    setTimeout(() => { root.hidden = true; }, 250);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  async function submit(e) {
    e.preventDefault();
    const input = $(".wpop__input", root);
    const err = $("[data-wpop-error]", root);
    const btn = $(".wpop__btn", root);
    const email = input.value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.textContent = "Please enter a valid email address"; input.focus(); return; }

    btn.disabled = true;
    btn.textContent = "Claiming…";
    let result = { success: true };
    if (window.FirebaseDB && window.FirebaseDB.saveNewsletter) {
      result = await window.FirebaseDB.saveNewsletter(email, "popup").catch(() => ({ success: false }));
    }
    btn.disabled = false;
    btn.textContent = "Claim My Discount";
    if (!result || result.success === false) {
      err.textContent = "Couldn't save your email right now. Please check your connection and try again.";
      return;
    }

    store.set(KEYS.subscribed, "true");
    store.set(KEYS.code, CODE); // app.js applies it at checkout
    const shown = $("[data-wpop-email]", root);
    if (shown) shown.textContent = email;
    $("[data-wpop-step]", root).hidden = true;
    $("[data-wpop-success]", root).hidden = false;
    window.dispatchEvent(new CustomEvent("chek:welcome-code", { detail: { code: CODE } }));
  }

  function copy(btn) {
    const done = () => { btn.textContent = "Copied ✓"; setTimeout(() => { btn.textContent = "Copy Code"; }, 2200); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(CODE).then(done, done);
    else {
      const t = document.createElement("textarea");
      t.value = CODE; document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); } catch (x) {}
      t.remove(); done();
    }
  }

  function schedule() {
    if (!shouldShow()) return;
    if (isHome) { setTimeout(open, 3000); return; }
    // other pages: after 8 s, or once the shopper is half-way down the page
    let fired = false;
    const fire = () => { if (fired) return; fired = true; window.removeEventListener("scroll", onScroll); open(); };
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max > 0 && window.scrollY / max > 0.5) fire();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    setTimeout(fire, 8000);
  }

  window.ChekWelcomePopup = { open: () => { store.set(KEYS.dismissed, "0"); open(); } };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", schedule);
  else schedule();
})();
