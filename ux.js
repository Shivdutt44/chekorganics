/* ==========================================================================
   CHEKORGANICS — 4.0 mobile app shell & CRO layer
   Load order matters: data.js → ux.js → app.js
   (ux.js snapshots the store's real review data before app.js runs, and
   builds its UI first so app.js's cart sync also updates the new badges.)
   ========================================================================== */
(function () {
  "use strict";

  const LIVE = "https://www.chekorganics.com";
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const mqMobile = window.matchMedia("(max-width: 768px)");
  const mqFooter = window.matchMedia("(max-width: 640px)");
  const page = (location.pathname.split("/").pop() || "").toLowerCase().replace(/\.html$/, "") || "index";
  /* Real ratings collected from the store's review widgets (data.js), captured
     before anything else can modify window.STORE. Social proof only ever uses
     these numbers or a real orders feed — nothing is invented. */
  const REAL_RATED = ((window.STORE && window.STORE.products) || [])
    .filter(p => p && p.handle && Number(p.rating) > 0 && Number(p.reviews) > 0)
    .map(p => ({ handle: p.handle, title: p.title, rating: Number(p.rating), reviews: Number(p.reviews), image: (p.images || [])[0] || null }));
  const CATALOG = new Map(((window.STORE && window.STORE.products) || []).map(p => [p.handle, { title: p.title, image: (p.images || [])[0] || null }]));

  function shortName(raw) {
    const t = String(raw || "").replace(/\s+/g, " ").trim();
    const m = t.match(/^(.{3,62}?)\s+[-–—]\s+(.+)$/);
    let name = m ? m[2] : t;
    if (name.includes("|")) {
      const head = name.split("|")[0].trim();
      if (head.length > 12) name = head;
    }
    return name.replace(/^CHEKORGANICS?\s+(BODYHUES\s+)?[-–—]?\s*/i, "") || t;
  }

  const ICON = {
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 10.5 12 4l8.5 6.5"/><path d="M5.5 9v10.5h13V9"/><path d="M10 19.5v-5h4v5"/></svg>',
    shop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5c0 1.4 1.1 2.5 2.7 2.5s2.6-1.1 2.6-2.5c0 1.4 1.1 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1 2.5 2.6 2.5S20 10.9 20 9.5"/><path d="M5.5 12v8h13v-8"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="3.25"/></svg>',
    bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 7h12l1 13H5L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>',
    box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/></svg>',
    truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 6h11v10H3zM14 9.5h4l3 3.5V16h-7z"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.8"/><circle cx="12" cy="17.2" r="0.6" fill="currentColor"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    up: '<svg class="to-top__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  };

  /* ------------------------------------------------------------ layout sync
     Keeps floating UI (back-to-top, notifications, toast, sticky buy bar)
     stacked above the bottom navigation and the product page's buy bar. */
  function syncBottomUI() {
    const root = document.documentElement.style;
    const bnav = $(".bnav");
    const navVisible = !!bnav && mqMobile.matches && !document.body.classList.contains("bnav-hidden");
    const navH = navVisible ? bnav.getBoundingClientRect().height : 0;
    const buy = $(".sticky-buy.is-on");
    const buyH = buy ? buy.getBoundingClientRect().height : 0;
    root.setProperty("--bnav-offset", navH + "px");
    root.setProperty("--ui-bottom", navH + buyH + "px");
  }

  /* -------------------------------------------- 1. scroll progress + to top */
  function scrollUI() {
    const bar = document.createElement("div");
    bar.className = "scroll-progress";
    bar.setAttribute("aria-hidden", "true");
    document.body.appendChild(bar);

    const R = 23, C = 2 * Math.PI * R;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "to-top";
    btn.setAttribute("aria-label", "Back to top");
    btn.innerHTML =
      '<svg class="to-top__ring" viewBox="0 0 52 52" aria-hidden="true"><circle class="to-top__track" cx="26" cy="26" r="' + R + '"/>' +
      '<circle class="to-top__bar" cx="26" cy="26" r="' + R + '" stroke-dasharray="' + C.toFixed(2) + '" stroke-dashoffset="' + C.toFixed(2) + '"/></svg>' +
      ICON.up + '<span class="to-top__pct" aria-hidden="true">0%</span>';
    document.body.appendChild(btn);
    const ring = $(".to-top__bar", btn), pct = $(".to-top__pct", btn);

    btn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" });
      const brand = $(".header .brand");
      if (brand) brand.focus({ preventScroll: true });
    });

    let ticking = false, lastY = window.scrollY;
    function update() {
      ticking = false;
      const doc = document.documentElement;
      const max = Math.max(1, doc.scrollHeight - window.innerHeight);
      const y = window.scrollY;
      const p = Math.min(1, Math.max(0, y / max));
      bar.style.transform = "scaleX(" + p + ")";
      ring.style.strokeDashoffset = (C * (1 - p)).toFixed(2);
      pct.textContent = Math.round(p * 100) + "%";
      btn.classList.toggle("is-on", y > 600);

      // bottom nav: hide while scrolling down, reveal on scroll up / near the ends
      if (document.body.classList.contains("has-bnav")) {
        const dy = y - lastY;
        const nearEnd = y < 120 || y > max - 80;
        if (nearEnd || dy < -6) document.body.classList.remove("bnav-hidden");
        else if (dy > 8 && y > 240) document.body.classList.add("bnav-hidden");
      }
      lastY = y;
      syncBottomUI();
    }
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    // the product page's sticky buy bar appears/disappears on its own schedule
    new MutationObserver(onScroll).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
    update();
  }

  /* --------------------------------------------------- 2. account menu */
  let acctPop, acctScrim, acctTrigger = null;

  function buildAccount() {
    acctScrim = document.createElement("div");
    acctScrim.className = "acct-scrim";
    acctPop = document.createElement("div");
    acctPop.className = "acct-pop";
    acctPop.id = "account-menu";
    acctPop.setAttribute("role", "dialog");
    acctPop.setAttribute("aria-modal", "false");
    acctPop.setAttribute("aria-label", "Account");
    function renderAcctPop(user) {
      if (!acctPop) return;
      if (user) {
        const name = user.displayName || user.email.split("@")[0];
        const initial = name.charAt(0).toUpperCase();
        acctPop.innerHTML =
          '<div class="acct-pop__head"><span class="acct-pop__avatar" style="font-weight:700;font-size:1.1rem;background:var(--forest);color:#c29a45">' + esc(initial) + '</span>' +
          '<div><b>Namaste, ' + esc(name) + '!</b><span style="font-size:0.75rem;color:var(--muted)">' + esc(user.email) + '</span></div></div>' +
          '<div class="acct-pop__actions" style="grid-template-columns:1fr;margin-bottom:0.6rem">' +
          '<button type="button" class="btn btn--primary" data-auth-action="orders" style="justify-content:center;display:flex;align-items:center;gap:0.5rem">' + ICON.box + ' My Orders &amp; Profile</button></div>' +
          '<ul class="acct-pop__list">' +
          '<li><a href="#orders" data-auth-action="orders">' + ICON.box + "My orders</a></li>" +
          '<li><a href="#track" data-auth-action="track">' + ICON.truck + "Track an order</a></li>" +
          '<li><a href="contact.html">' + ICON.help + "Help &amp; support</a></li>" +
          '<li><button type=\"button\" data-auth-action=\"logout\" style=\"display:flex;align-items:center;gap:0.7rem;min-height:44px;width:100%;border:none;background:none;font-size:0.92rem;color:#b91c1c;cursor:pointer;padding:0 0.5rem;font-family:inherit;border-radius:12px\">' + ICON.lock + "Sign Out</button></li></ul>" +
          '<p class="acct-pop__note">' + ICON.lock + "Signed in with ChekOrganics Cloud Account.</p>";
      } else {
        acctPop.innerHTML =
          '<div class="acct-pop__head"><span class="acct-pop__avatar">' + ICON.user + '</span>' +
          '<div><b>Namaste!</b><span>Sign in to track orders &amp; reorder faster</span></div></div>' +
          '<div class="acct-pop__actions">' +
          '<button type="button" class="btn btn--primary" data-auth-action="login">Log in</button>' +
          '<button type="button" class="btn btn--ghost" data-auth-action="signup">Sign up</button></div>' +
          '<ul class="acct-pop__list">' +
          '<li><a href="#orders" data-auth-action="orders">' + ICON.box + "My orders</a></li>" +
          '<li><a href="#track" data-auth-action="track">' + ICON.truck + "Track an order</a></li>" +
          '<li><a href="contact.html">' + ICON.help + "Help &amp; support</a></li></ul>" +
          '<p class="acct-pop__note">' + ICON.lock + "Your account is secured by ChekOrganics. 100% private &amp; safe.</p>";
      }
    }

    renderAcctPop(null);
    document.body.append(acctScrim, acctPop);

    if (window.FirebaseDB && window.FirebaseDB.onAuthStateChanged) {
      window.FirebaseDB.onAuthStateChanged(user => {
        renderAcctPop(user);
      });
    }

    // header icon, placed before the bag
    const actions = $(".header__actions");
    const cart = actions && $("[data-open-cart]", actions);
    if (actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "icon-btn acct-btn";
      btn.setAttribute("aria-label", "Account: log in or sign up");
      btn.setAttribute("aria-haspopup", "dialog");
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-controls", "account-menu");
      btn.setAttribute("data-account", "");
      btn.innerHTML = ICON.user;
      actions.insertBefore(btn, cart || actions.firstChild);
    }

    document.addEventListener("click", e => {
      const trigger = e.target.closest("[data-account]");
      if (trigger) {
        e.preventDefault();
        acctPop.classList.contains("is-open") && acctTrigger === trigger ? closeAccount() : openAccount(trigger);
        return;
      }
      if (acctPop.classList.contains("is-open") && !acctPop.contains(e.target)) closeAccount(false);
    });
    acctScrim.addEventListener("click", () => closeAccount());
    acctPop.addEventListener("click", e => {
      const authBtn = e.target.closest("[data-auth-action]");
      if (authBtn) {
        e.preventDefault();
        const action = authBtn.dataset.authAction;
        closeAccount(false);
        if (action === "logout") {
          if (window.FirebaseDB && window.FirebaseDB.signOut) {
            window.FirebaseDB.signOut();
            window.toast && window.toast("Signed out successfully.");
          }
        } else if (window.openAuth) {
          window.openAuth(action === "orders" ? "profile" : action);
        }
        return;
      }
      if (e.target.closest("a")) closeAccount(false);
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && acctPop.classList.contains("is-open")) closeAccount();
    });
    window.addEventListener("resize", () => acctPop.classList.contains("is-open") && placeAccount());
  }

  function placeAccount() {
    if (mqMobile.matches || !acctTrigger) return;
    const r = acctTrigger.getBoundingClientRect();
    const header = document.querySelector(".amz-header") || document.querySelector("#site-header") || document.querySelector("header");
    const headerBottom = header ? header.getBoundingClientRect().bottom : r.bottom;
    acctPop.style.top = Math.round(headerBottom + 10) + "px";
    const triggerCenter = r.left + r.width / 2;
    // Align so the popup's top pointer arrow (around 70px from its right) aligns with triggerCenter
    const idealLeft = Math.round(triggerCenter - 225);
    const clampedLeft = Math.max(16, Math.min(window.innerWidth - 316, idealLeft));
    acctPop.style.left = clampedLeft + "px";
  }

  function openAccount(trigger) {
    acctTrigger = trigger;
    placeAccount();
    acctPop.classList.add("is-open");
    acctScrim.classList.add("is-open");
    $$("[data-account]").forEach(b => b.setAttribute("aria-expanded", String(b === trigger)));
    const first = $("a", acctPop);
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 60);
  }

  function closeAccount(restoreFocus = true) {
    acctPop.classList.remove("is-open");
    acctScrim.classList.remove("is-open");
    $$("[data-account]").forEach(b => b.setAttribute("aria-expanded", "false"));
    if (restoreFocus && acctTrigger) acctTrigger.focus({ preventScroll: true });
  }

  /* ------------------------------------------------ 3. mobile bottom nav */
  function bottomNav() {
    const nav = document.createElement("nav");
    nav.className = "bnav";
    nav.setAttribute("aria-label", "App navigation");
    const current = name => (name === page ? ' aria-current="page"' : "");
    nav.innerHTML =
      '<a class="bnav__item" href="./"' + current("index") + '><span class="bnav__icon">' + ICON.home + "</span>Home</a>" +
      '<a class="bnav__item" href="shop.html"' + (page === "shop" || page === "product" ? ' aria-current="page"' : "") + '><span class="bnav__icon">' + ICON.shop + "</span>Shop</a>" +
      '<button class="bnav__item" type="button" data-bnav-menu aria-label="Browse categories"><span class="bnav__icon">' + ICON.grid + "</span>Categories</button>" +
      '<button class="bnav__item" type="button" data-account aria-haspopup="dialog" aria-expanded="false" aria-controls="account-menu"><span class="bnav__icon">' + ICON.user + "</span>Account</button>" +
      '<button class="bnav__item" type="button" data-open-cart aria-label="Open shopping bag"><span class="bnav__icon">' + ICON.bag +
      '<span class="cart-count" data-cart-count style="display:none">0</span></span>Bag</button>';
    document.body.appendChild(nav);
    document.body.classList.add("has-bnav");

    // "Categories" reuses the existing full-screen menu
    $("[data-bnav-menu]", nav).addEventListener("click", () => {
      const burger = $("[data-burger]");
      if (burger) burger.click();
    });

    // hide while the on-screen keyboard is up
    document.addEventListener("focusin", e => {
      if (mqMobile.matches && e.target.matches("input:not([type=checkbox]):not([type=radio]), textarea, select")) document.body.classList.add("bnav-hidden");
    });
    document.addEventListener("focusout", () => document.body.classList.remove("bnav-hidden"));
    mqMobile.addEventListener("change", syncBottomUI);
  }

  /* ------------------------------------------------ 4. footer accordions */
  function footerAccordion() {
    const cols = $$(".footer__grid > div");
    cols.forEach((col, i) => {
      col.classList.add("footer__col");
      const h = $("h4", col), list = $("ul", col);
      if (!h || !list) return;
      const id = "footer-panel-" + i;
      list.id = id;
      list.classList.add("footer__panel");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "footer__toggle";
      btn.setAttribute("aria-controls", id);
      btn.innerHTML = "<span>" + esc(h.textContent.trim()) + "</span>" + ICON.chevron;
      h.textContent = "";
      h.appendChild(btn);
      btn.addEventListener("click", () => {
        if (!mqFooter.matches) return;
        const open = !col.classList.contains("is-open");
        col.classList.toggle("is-open", open);
        btn.setAttribute("aria-expanded", String(open));
      });
    });
    const apply = () => {
      $$(".footer__toggle").forEach(btn => {
        const col = btn.closest(".footer__col");
        if (mqFooter.matches) {
          btn.removeAttribute("tabindex");
          btn.removeAttribute("aria-disabled");
          btn.setAttribute("aria-expanded", String(col.classList.contains("is-open")));
        } else {
          // desktop: plain headings, lists always visible
          btn.setAttribute("tabindex", "-1");
          btn.setAttribute("aria-disabled", "true");
          btn.setAttribute("aria-expanded", "true");
        }
      });
    };
    apply();
    mqFooter.addEventListener("change", apply);
  }

  /* ---------------------------------------- 5. social-proof notifications
     Sources, in order of preference:
       a) a REAL recent-orders feed, if the store owner configures one:
          <meta name="chek:sales-feed" content="https://…/recent-sales.json">
          JSON: [{ "handle": "<product handle>", "city": "Pune", "at": "<ISO time>" }, …]
          (e.g. generated from Shopify orders by Shopify Flow or an app — the
          Admin API cannot be called from a public page without leaking its token)
       b) otherwise, real customer ratings from the store's review widgets.
     Never shows invented buyers, cities, times or counts. */
  const PROOF = { firstDelay: 9000, showMs: 6500, minGap: 22000, maxGap: 36000, maxPerPage: 5, offKey: "chek_proof_off" };

  function relTime(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 0) return null;
    if (mins < 2) return "just now";
    if (mins < 60) return mins + " min ago";
    const h = Math.round(mins / 60);
    if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
    const d = Math.round(h / 24);
    return d + (d === 1 ? " day ago" : " days ago");
  }

  async function loadSalesFeed() {
    const url = (document.querySelector('meta[name="chek:sales-feed"]') || {}).content || window.CHEK_SALES_FEED_URL;
    if (!url) return [];
    try {
      const r = await fetch(url, { cache: "no-store", credentials: "omit" });
      if (!r.ok) return [];
      const data = await r.json();
      const list = Array.isArray(data) ? data : Array.isArray(data.sales) ? data.sales : [];
      const cutoff = Date.now() - 72 * 3600 * 1000;
      return list
        .filter(s => s && CATALOG.has(s.handle) && Date.parse(s.at) > cutoff && Date.parse(s.at) <= Date.now() + 60000)
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .slice(0, 20)
        .map(s => ({
          kind: "sale",
          handle: s.handle,
          image: CATALOG.get(s.handle).image,
          kicker: s.city ? "Someone in " + String(s.city).slice(0, 40) + " ordered" : "New order",
          title: shortName(CATALOG.get(s.handle).title),
          at: s.at,
        }));
    } catch (e) {
      return [];
    }
  }

  function ratingItems() {
    return REAL_RATED.slice()
      .sort((a, b) => b.reviews - a.reviews || b.rating - a.rating)
      .map(p => ({
        kind: "rating",
        handle: p.handle,
        image: p.image,
        kicker: "Rated by customers",
        title: shortName(p.title),
        meta: '<span class="stars" aria-hidden="true">' + "★".repeat(Math.round(p.rating)) + "</span> " + (Number.isInteger(p.rating) ? p.rating.toFixed(1) : String(p.rating)) +
          "/5 · " + p.reviews + (p.reviews === 1 ? " review" : " reviews"),
        label: shortName(p.title) + ", rated " + p.rating + " out of 5 from " + p.reviews + (p.reviews === 1 ? " review" : " reviews") + " on chekorganics.com",
      }));
  }

  async function socialProof() {
    try {
      if (sessionStorage.getItem(PROOF.offKey) === "1") return;
    } catch (e) { /* storage blocked: still fine */ }

    const sales = await loadSalesFeed();
    const currentHandle = page === "product" ? new URLSearchParams(location.search).get("p") : null;
    let queue = (sales.length ? sales : ratingItems()).filter(i => i.handle !== currentHandle);
    if (!queue.length) return;
    if (!sales.length) queue = shuffle(queue);

    const el = document.createElement("aside");
    el.className = "proof";
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-label", "Shopper activity");
    el.style.setProperty("--proof-ms", PROOF.showMs + "ms");
    document.body.appendChild(el);

    let shown = 0, idx = 0, hideTimer = null, nextTimer = null, hovering = false;

    function blocked() {
      return document.hidden ||
        !!$(".drawer.is-open, .mobile-nav.is-open, .acct-pop.is-open, #rate-modal-overlay.is-open") ||
        (mqMobile.matches && document.activeElement && document.activeElement.matches("input, textarea, select"));
    }

    function render(item) {
      const href = "product.html?p=" + encodeURIComponent(item.handle);
      const meta = item.kind === "sale" ? esc(relTime(item.at) || "") + " · verified order" : item.meta;
      el.innerHTML =
        (item.image ? '<img class="proof__img" src="' + esc(item.image) + '" alt="" width="56" height="56" loading="lazy" decoding="async">' : "<span></span>") +
        '<a class="proof__body" href="' + esc(href) + '" aria-label="' + esc(item.label || item.kicker + ": " + item.title) + '">' +
        '<span class="proof__kicker">' + (item.kind === "sale" ? '<span class="live-dot" aria-hidden="true"></span>' : "") + esc(item.kicker) + "</span>" +
        '<span class="proof__title">' + esc(item.title) + "</span>" +
        '<span class="proof__meta">' + meta + "</span></a>" +
        '<button class="proof__close" type="button" aria-label="Hide these notifications">' + ICON.close + "</button>" +
        '<span class="proof__timer" aria-hidden="true"></span>';
      $(".proof__close", el).addEventListener("click", () => {
        hide();
        clearTimeout(nextTimer);
        try { sessionStorage.setItem(PROOF.offKey, "1"); } catch (e) { /* ignore */ }
      });
    }

    function show() {
      if (shown >= PROOF.maxPerPage) return;
      if (blocked()) {
        nextTimer = setTimeout(show, 5000);
        return;
      }
      render(queue[idx++ % queue.length]);
      syncBottomUI();
      el.classList.remove("is-on");
      void el.offsetWidth; // restart the timer bar animation
      el.classList.add("is-on");
      shown++;
      scheduleHide(PROOF.showMs);
    }

    function scheduleHide(ms) {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (hovering) return scheduleHide(1500);
        hide();
        if (shown < PROOF.maxPerPage) nextTimer = setTimeout(show, PROOF.minGap + Math.random() * (PROOF.maxGap - PROOF.minGap));
      }, ms);
    }

    function hide() {
      clearTimeout(hideTimer);
      el.classList.remove("is-on");
    }

    el.addEventListener("mouseenter", () => (hovering = true));
    el.addEventListener("mouseleave", () => (hovering = false));
    el.addEventListener("focusin", () => (hovering = true));
    el.addEventListener("focusout", () => (hovering = false));
    document.addEventListener("visibilitychange", () => document.hidden && hide());

    nextTimer = setTimeout(show, PROOF.firstDelay);
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ---------------------------------------------------------------- boot */
  document.addEventListener("DOMContentLoaded", () => {
    buildAccount();
    bottomNav();
    footerAccordion();
    scrollUI();
    socialProof();
  });
  window.addEventListener("load", syncBottomUI);
})();
