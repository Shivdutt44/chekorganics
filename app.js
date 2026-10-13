/* ==========================================================================
   CHEKORGANICS — app shell
   Live catalog (products.json) · cart · rails · React-like page transitions
   ========================================================================== */
(function () {
  "use strict";

  // Preserve explicit .html filenames so all static file servers and GitHub Pages
  // reliably resolve routes on refresh and navigation.

  /* ------------------------------------------------------------ catalog */
  const LOCAL = window.STORE || { products: [], collections: [] };

  /* ------------------------------------------- admin product edits (Firestore) */
  // admin.html saves Shopify-style product edits to the Firestore `products` collection,
  // keyed by handle. They are layered over whichever catalog is showing (bundled data.js
  // or the live Shopify feed). A cached copy applies instantly; loadProductOverrides()
  // refreshes it. Edits are applied to the product objects in place, so the snapshots
  // ux.js / wishlist.js / quickbuy.js / shoppable.js took of data.js see them too.
  const OVERRIDES_KEY = "chek_product_overrides_v1";
  let OVERRIDES = (() => { try { return JSON.parse(localStorage.getItem(OVERRIDES_KEY)) || {}; } catch (e) { return {}; } })();
  const isHidden = h => { const o = OVERRIDES[h]; return !!o && (o.deleted || o.status === "draft" || o.status === "archived"); };

  function overlayProduct(p, o) {
    if (typeof o.title === "string" && o.title.trim()) p.title = o.title.trim();
    if (Number(o.price) >= 0 && o.price !== "" && o.price != null) p.price = Number(o.price);
    if ("compareAt" in o) p.compareAt = Number(o.compareAt) > p.price ? Number(o.compareAt) : null;
    if (Array.isArray(o.images) && o.images.length) p.images = o.images.slice();
    if (typeof o.description === "string") p.excerpt = o.description;
    if (typeof o.type === "string") p.type = o.type;
    if (Array.isArray(o.tags)) p.tags = o.tags.slice();
    if (Array.isArray(o.collections) && o.collections.length) {
      p.collections = o.collections.includes("All Products") ? o.collections.slice() : ["All Products"].concat(o.collections);
      p.primaryCollection = p.collections.find(c => c !== "All Products") || "All Products";
    }
    if ("badge" in o) p.badge = o.badge || null;
    if (o.trackInventory) p.available = Number(o.inventory) > 0;
    else if ("available" in o) p.available = o.available !== false;
    return p;
  }

  function withOverrides(list) {
    const have = new Set(list.map(p => p.handle));
    const out = list.filter(p => !isHidden(p.handle)).map(p => (OVERRIDES[p.handle] ? overlayProduct(p, OVERRIDES[p.handle]) : p));
    // products added in the admin portal (not in the store catalog)
    Object.keys(OVERRIDES).forEach(h => {
      const o = OVERRIDES[h];
      if (have.has(h) || isHidden(h) || !o.title || !Array.isArray(o.images) || !o.images.length) return;
      out.push(overlayProduct({
        id: h, handle: h, title: o.title, price: 0, compareAt: null, images: [], type: "", tags: [],
        collections: ["All Products"], primaryCollection: "All Products", excerpt: "",
        rating: 0, reviews: 0, available: true, badge: null, featured: -1
      }, o));
    });
    return out;
  }

  let BASE = LOCAL.products;         // catalog before admin edits (bundled, then live feed)
  let STORE = { products: withOverrides(BASE), collections: LOCAL.collections }; // working catalog
  let SOURCE = "local";              // local | live | cached
  let SYNCED_AT = null;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const LIVE = "https://www.chekorganics.com";
  const FREE_SHIP = 3000;
  const money = n => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  const byHandle = h => STORE.products.find(p => p.handle === h);
  // drafts / archived / deleted products stay out of carts and direct links too
  const localByHandle = h => (isHidden(h) ? undefined : LOCAL.products.find(p => p.handle === h));

  function splitTitle(raw) {
    const t = String(raw).replace(/\s+/g, " ").trim();
    const m = t.match(/^(.{3,62}?)\s+[-–—]\s+(.+)$/);
    let benefit = "", name = t;
    if (m) { benefit = m[1].trim(); name = m[2].trim(); }
    if (name.includes("|")) {
      const head = name.split("|")[0].trim();
      if (head.length > 12) name = head;
    }
    return { benefit, name: name || t };
  }

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ------------------------------------------------- reviews & ratings engine */
  const REVIEWS_STORAGE_KEY = "chek_reviews_store_v2";

  // Real aggregate ratings from the store's review widgets (data.js), captured before the
  // boot code below writes computed values back onto the products. Nothing here is invented:
  // a product with no real rating and no customer review shows "No reviews yet".
  const REAL_RATINGS = Object.fromEntries((LOCAL.products || [])
    .filter(p => Number(p.rating) > 0 && Number(p.reviews) > 0)
    .map(p => [p.handle, { rating: Number(p.rating), count: Number(p.reviews) }]));

  // handle -> reviews other shoppers submitted (Firestore), filled by loadRemoteReviews()
  let REMOTE_REVIEWS = {};

  function readStoredReviews() {
    try { return JSON.parse(localStorage.getItem(REVIEWS_STORAGE_KEY)) || {}; } catch (e) { return {}; }
  }

  function writeStoredReviews(data) {
    try { localStorage.setItem(REVIEWS_STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
  }

  const Ratings = {
    get(p) {
      const handle = typeof p === "string" ? p : p && p.handle;
      const real = REAL_RATINGS[handle];

      // this browser's reviews + everyone's reviews from Firestore; the shopper's own review
      // is in both, so de-duplicate on the id it was saved with
      const seen = new Set();
      const written = (readStoredReviews()[handle] || []).concat(REMOTE_REVIEWS[handle] || [])
        .filter(r => {
          const key = r.id || [r.author, r.title, r.body].join("|");
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

      const count = (real ? real.count : 0) + written.length;
      const points = (real ? real.rating * real.count : 0) + written.reduce((s, r) => s + (Number(r.rating) || 0), 0);

      // star-by-star split is only known for written reviews (the store widget gave averages)
      const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
      written.forEach(r => { const s = Math.round(Number(r.rating)); if (s in breakdown) breakdown[s]++; });
      if (written.length) Object.keys(breakdown).forEach(k => { breakdown[k] = Math.round(breakdown[k] * 100 / written.length); });

      return {
        rating: count ? Math.round((points / count) * 10) / 10 : 0,
        reviewsCount: count,
        reviews: written,
        breakdown,
        hasBreakdown: written.length > 0
      };
    },

    submit(handle, review) {
      if (!handle) return false;
      const all = readStoredReviews();
      const list = all[handle] || [];
      const clean = s => String(s || "").trim().slice(0, 1000);
      const newRev = {
        id: "rev_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
        author: clean(review.name).slice(0, 60) || "Customer",
        city: clean(review.city).slice(0, 60),
        rating: Math.min(5, Math.max(1, Math.round(Number(review.rating)) || 5)),
        title: clean(review.title).slice(0, 120),
        body: clean(review.body),
        createdAt: new Date().toISOString(),
        // not tied to an order, so never labelled as a verified purchase
        verified: false,
        helpful: 0
      };
      list.unshift(newRev);
      all[handle] = list;
      writeStoredReviews(all);

      // Cloud Firestore sync
      if (window.FirebaseDB && window.FirebaseDB.saveReview) {
        window.FirebaseDB.saveReview(handle, newRev);
      }

      const prod = byHandle(handle);
      if (prod) {
        const stats = Ratings.get(prod);
        prod.rating = stats.rating;
        prod.reviews = stats.reviewsCount;
      }

      window.dispatchEvent(new CustomEvent("chek:rating-updated", { detail: { handle, review: newRev } }));
      return newRev;
    }
  };

  function applyRatings(products) {
    (products || []).forEach(p => {
      const s = Ratings.get(p);
      p.rating = s.rating;
      p.reviews = s.reviewsCount;
    });
  }

  // Synchronize initial products with their real ratings
  if (LOCAL && Array.isArray(LOCAL.products)) applyRatings(LOCAL.products);
  applyRatings(STORE.products); // includes products added in the admin portal

  // Fetch the admin's product edits, cache them for the next page view, repaint if they changed
  async function loadProductOverrides() {
    if (!window.FirebaseDB || !window.FirebaseDB.getProductOverrides) return;
    const map = await window.FirebaseDB.getProductOverrides();
    if (!map) return; // offline / not configured: keep the cached edits
    const before = JSON.stringify(OVERRIDES);
    OVERRIDES = map;
    try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(map)); } catch (e) {}
    if (JSON.stringify(map) === before) return;
    // edits were applied in place; an edit that was removed needs a reload to restore store data
    STORE = { products: withOverrides(BASE), collections: STORE.collections };
    applyRatings(STORE.products);
    rerender();
  }

  // Pull every shopper's reviews from Firestore once per page, then repaint ratings
  async function loadRemoteReviews() {
    if (!window.FirebaseDB || !window.FirebaseDB.getAllReviews) return;
    const list = await window.FirebaseDB.getAllReviews();
    if (!list.length) return;
    const byProduct = {};
    list.forEach(r => { if (r && r.productHandle) (byProduct[r.productHandle] = byProduct[r.productHandle] || []).push(r); });
    REMOTE_REVIEWS = byProduct;
    applyRatings(LOCAL.products);
    applyRatings(STORE.products);
    rerender();
  }

  // "3 days ago"-style label from the saved timestamp (older saved reviews only have `date`)
  function reviewDate(r) {
    if (!r.createdAt) return r.date || "";
    const days = Math.floor((Date.now() - new Date(r.createdAt).getTime()) / 864e5);
    if (!(days >= 0)) return "";
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 30) return days + " days ago";
    return new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }

  function renderStars(rating) {
    const r = Math.min(5, Math.max(0, Number(rating) || 0));
    const full = Math.round(r);
    return "★".repeat(full) + "☆".repeat(Math.max(0, 5 - full));
  }

  // badge text for a Ratings.get() result; products nobody has rated say so instead of showing 0.0
  const ratingScore = r => (r.reviewsCount ? r.rating.toFixed(1) : "");
  const ratingCount = r => (r.reviewsCount ? "(" + r.reviewsCount + ")" : "No reviews yet");

  function ratingHtml(p) {
    const r = Ratings.get(p);
    const label = r.reviewsCount ? "Rated " + r.rating.toFixed(1) + "★ (" + r.reviewsCount + " reviews) · Click to rate!" : "No reviews yet · Be the first to rate";
    return (
      '<div class="card__rating">' +
        '<button class="rating-badge" type="button" data-rate-modal="' + esc(p.handle) + '" title="' + label + '">' +
          '<span class="stars__glyphs" aria-hidden="true">' + renderStars(r.rating) + '</span>' +
          '<span class="rating-badge__score">' + ratingScore(r) + '</span>' +
          '<span class="rating-badge__count">' + ratingCount(r) + '</span>' +
          '<span class="rating-badge__cta">Rate</span>' +
        '</button>' +
      '</div>'
    );
  }

  function cardHtml(p) {
    const t = splitTitle(p.title);
    const badge = p.compareAt
      ? '<span class="card__badge card__badge--sale">Save ' + money(p.compareAt - p.price) + "</span>"
      : p.badge ? '<span class="card__badge">' + esc(p.badge) + "</span>" : "";
    return (
      '<article class="card">' +
        '<a class="card__media" href="product.html?p=' + p.handle + '" aria-label="' + esc(t.name) + '">' +
          badge +
          '<img src="' + p.images[0] + '" alt="' + esc(t.name) + '" loading="lazy" decoding="async">' +
          '<div class="card__quick"><button class="btn btn--gold btn--sm btn--block" type="button" data-add="' + p.handle + '">Add to bag</button></div>' +
        "</a>" +
        '<div class="card__body">' +
          '<span class="card__eyebrow">' + esc(p.primaryCollection) + "</span>" +
          '<h3 class="card__title"><a href="product.html?p=' + p.handle + '">' + esc(t.name) + "</a></h3>" +
          ratingHtml(p) +
          '<div class="card__foot">' +
            '<span class="price">' + money(p.price) + (p.compareAt ? "<s>" + money(p.compareAt) + "</s>" : "") + "</span>" +
            '<button class="btn btn--primary btn--sm" type="button" data-add="' + p.handle + '">Add</button>' +
          "</div>" +
        "</div>" +
      "</article>"
    );
  }

  function skeletonCard() {
    return '<article class="card card--skeleton"><div class="sk sk--media"></div>' +
      '<div class="card__body"><div class="sk sk--line sk--w40"></div><div class="sk sk--line sk--w90"></div>' +
      '<div class="sk sk--line sk--w60"></div><div class="sk sk--line sk--w30"></div></div></article>';
  }

  function renderSkeletons(el, n) {
    if (el && !el.children.length) el.innerHTML = Array.from({ length: n }, skeletonCard).join("");
  }

  function renderInto(el, list) {
    if (!el) return;
    el.innerHTML = list.map(cardHtml).join("");
  }

  /* --------------------------------- live catalog sync (products.json) -- */
  function normalizeLive(raw) {
    if (!raw || !Array.isArray(raw.products)) return null;
    const colsOf = {};
    LOCAL.products.forEach(p => (colsOf[p.handle] = p.collections || []));
    const clean = s => String(s || "").replace(/\s+/g, " ").trim();

    const products = raw.products.map(p => {
      const v = (p.variants && p.variants[0]) || {};
      const price = parseFloat(v.price) || 0;
      const cmp = v.compare_at_price ? parseFloat(v.compare_at_price) : null;
      const remote = (p.images || []).map(i => (typeof i === "string" ? i : i.src)).filter(Boolean);
      const keep = localByHandle(p.handle);
      const images = keep && keep.images.length ? keep.images : remote.map(src => src + (src.includes("?") ? "&" : "?") + "width=900");
      // title must be declared before use: reading it first threw a ReferenceError, so every
      // live sync silently failed and the site stayed on the bundled catalog
      const title = clean(p.title);
      const stats = Ratings.get(p.handle);
      const cols = colsOf[p.handle] || ["All Products"];
      let badge = keep ? keep.badge : null;
      if (stats.reviewsCount >= 50) badge = "Bestseller";
      else if (!badge && /launch|spf|new/i.test(title)) badge = "New launch";
      return {
        id: p.id, title, handle: p.handle, price,
        compareAt: cmp && cmp > price ? cmp : null,
        images: images.length ? images : (keep ? keep.images : []),
        type: p.product_type || "", tags: p.tags || [],
        collections: cols,
        primaryCollection: cols.find(c => c !== "All Products") || "All Products",
        excerpt: keep ? keep.excerpt : "",
        rating: stats.rating, reviews: stats.reviewsCount,
        available: v.available !== false, badge,
        featured: keep ? keep.featured : -1
      };
    }).filter(p => p.images.length);

    if (!products.length) return null;
    products.sort((a, b) => (a.featured < 0 ? 99 : a.featured) - (b.featured < 0 ? 99 : b.featured));

    const counts = {};
    products.forEach(p => p.collections.forEach(c => (counts[c] = (counts[c] || 0) + 1)));
    const collections = (LOCAL.collections || []).map(c => ({
      title: c.title, handle: c.handle, image: c.image, blurb: c.blurb,
      count: counts[c.title] || c.count
    })).filter(c => c.count > 0);

    return { products, collections };
  }

  function paintSyncPill() {
    const pill = $("#sync-pill");
    if (!pill) return;
    pill.className = "sync-pill";
    if (SOURCE === "live") {
      pill.classList.add("is-live");
      pill.innerHTML = '<span class="dot"></span> Live catalog · ' + STORE.products.length + ' products · synced ' + (SYNCED_AT || "just now");
    } else if (SOURCE === "cached") {
      pill.classList.add("is-cached");
      pill.innerHTML = '<span class="dot"></span> Offline catalog · ' + STORE.products.length + " products";
    } else {
      pill.classList.add("is-cached");
      pill.innerHTML = '<span class="dot"></span> Loading live catalog…';
    }
  }

  async function fetchJson(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 6000);
    try {
      const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  async function refreshCatalog() {
    const tries = ["/api/products.json", LIVE + "/products.json?limit=250"];
    for (const url of tries) {
      try {
        const norm = normalizeLive(await fetchJson(url));
        if (norm) {
          BASE = norm.products;
          const products = withOverrides(BASE);
          applyRatings(products);
          const changed = products.length !== STORE.products.length ||
            products.some((p, i) => STORE.products[i] && STORE.products[i].price !== p.price);
          STORE = { products, collections: norm.collections.length ? norm.collections : LOCAL.collections };
          SOURCE = "live";
          SYNCED_AT = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
          window.CHEK_SYNC = { stage: 'live', url: url, products: norm.products.length };
          paintSyncPill();
          if (changed) rerender();
          return true;
        }
      } catch (e) { /* try next source */
        window.CHEK_SYNC = { stage: 'fetch-failed', url: url, error: String(e) };
      }
    }
    SOURCE = "cached";
    paintSyncPill();
    return false;
  }

  function rerender() {
    homePage(); shopPage(); productPage(); sync();
    // re-rendered sections (e.g. the home collections grid) bring fresh .reveal elements that
    // nothing observes yet; without this they stay at opacity 0 after reviews/admin edits load
    reveal();
  }

  /* --------------------------------------------------------------- cart */
  const KEY = "chek_cart_v1";
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const write = c => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {} };

  const Cart = {
    items() {
      const c = read();
      return Object.keys(c).map(h => ({ product: byHandle(h) || localByHandle(h), qty: c[h] })).filter(x => x.product && x.qty > 0);
    },
    count() { return this.items().reduce((n, x) => n + x.qty, 0); },
    total() { return this.items().reduce((n, x) => n + x.product.price * x.qty, 0); },
    add(handle, qty) {
      const p = byHandle(handle) || localByHandle(handle);
      if (!p) return;
      const c = read();
      c[handle] = Math.min(99, (c[handle] || 0) + (qty || 1));
      write(c); sync();
      toast("Added · " + splitTitle(p.title).name);
      openDrawer();
    },
    set(handle, qty) { const c = read(); if (qty <= 0) delete c[handle]; else c[handle] = Math.min(99, qty); write(c); sync(); },
    remove(handle) { this.set(handle, 0); },
    clear() { write({}); sync(); }
  };
  window.Cart = Cart;
  // read-only view of the working catalog for header.js search suggestions
  window.ChekCatalog = { products: () => STORE.products, collections: () => STORE.collections || [] };

  function buildDrawer() {
    const wrap = document.createElement("div");
    wrap.innerHTML =
      '<div class="overlay" data-close></div>' +
      '<aside class="drawer" aria-label="Shopping bag">' +
        '<div class="drawer__head"><h3>Your bag <span data-drawer-count style="font-size:.85rem;color:var(--muted)"></span></h3>' +
          '<button class="icon-btn" type="button" data-close aria-label="Close bag">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
          "</button></div>" +
        '<div class="drawer__body"></div>' +
        '<div class="drawer__foot">' +
          '<div class="ship-bar" data-ship><div class="ship-bar__fill"></div></div>' +
          '<p class="ship-bar__text" data-ship-text></p>' +
          '<div class="drawer__row"><span>Subtotal</span><b data-total>₹0</b></div>' +
          '<div class="drawer__row"><span>Shipping</span><span data-ship-cost>Calculated at checkout</span></div>' +
          '<p class="drawer__hint">100% Genuine Ayurvedic Formulations · Dispatched from our farm in Telangana.</p>' +
          '<a class="btn btn--primary btn--block" data-checkout href="checkout.html">Proceed to Checkout</a>' +
          '<div class="drawer__trust"><span>COD available</span><span>AYUSH certified</span><span>7-day returns</span></div>' +
        "</div>" +
      "</aside>";
    document.body.appendChild(wrap);
    wrap.addEventListener("click", e => {
      if (e.target.closest("[data-close]")) return closeDrawer();
      const add = e.target.closest("[data-plus]"), sub = e.target.closest("[data-minus]"), del = e.target.closest("[data-remove]");
      if (add) Cart.set(add.dataset.plus, +add.dataset.qty + 1);
      if (sub) Cart.set(sub.dataset.minus, +sub.dataset.qty - 1);
      if (del) Cart.remove(del.dataset.remove);
    });
  }

  function paintDrawer() {
    const body = $(".drawer__body");
    if (!body) return;
    const items = Cart.items();
    if (!items.length) {
      body.innerHTML = '<div class="drawer__empty"><p>Your bag is empty.</p><a class="btn btn--ghost btn--sm" href="shop.html">Explore the apothecary</a></div>';
    } else {
      body.innerHTML = items.map(({ product: p, qty }) =>
        '<div class="line-item">' +
          '<img src="' + p.images[0] + '" alt="">' +
          '<div><b>' + esc(splitTitle(p.title).name) + "</b>" +
            '<div class="qty qty--sm"><button type="button" data-minus="' + p.handle + '" data-qty="' + qty + '">−</button><span>' + qty + "</span>" +
            '<button type="button" data-plus="' + p.handle + '" data-qty="' + qty + '">+</button></div>' +
          "</div>" +
          '<div class="line-item__right"><span class="price">' + money(p.price * qty) + "</span>" +
            '<button class="remove" type="button" data-remove="' + p.handle + '">Remove</button></div>' +
        "</div>").join("");
    }

    const total = Cart.total();
    $("[data-total]").textContent = money(total);
    $("[data-drawer-count]").textContent = items.length ? "· " + Cart.count() + " item" + (Cart.count() > 1 ? "s" : "") : "";

    // free-shipping nudge (real ₹3,000 threshold)
    const bar = $("[data-ship]"), text = $("[data-ship-text]"), cost = $("[data-ship-cost]");
    const pct = Math.min(100, (total / FREE_SHIP) * 100);
    bar.style.display = items.length ? "block" : "none";
    $(".ship-bar__fill", bar).style.width = pct + "%";
    if (!items.length) text.textContent = "";
    else if (total >= FREE_SHIP) { text.innerHTML = '🎉 You\'ve unlocked <b>free shipping</b>'; bar.classList.add("is-done"); }
    else { text.innerHTML = 'Add <b>' + money(FREE_SHIP - total) + "</b> more for free shipping"; bar.classList.remove("is-done"); }
    cost.textContent = total >= FREE_SHIP ? "FREE" : "Calculated at checkout";

    const chkBtn = $("[data-checkout]");
    if (chkBtn) {
      chkBtn.href = items.length ? "checkout.html" : "shop.html";
      chkBtn.removeAttribute("target");
      chkBtn.removeAttribute("rel");
      chkBtn.textContent = items.length ? "Proceed to Checkout · " + money(total) : "Explore Products";
    }
  }

  const openDrawer = () => { $(".drawer").classList.add("is-open"); $(".overlay").classList.add("is-open"); paintDrawer(); document.body.style.overflow = "hidden"; };
  const closeDrawer = () => { $(".drawer").classList.remove("is-open"); $(".overlay").classList.remove("is-open"); document.body.style.overflow = ""; };

  function sync() {
    const n = Cart.count();
    $$("[data-cart-count]").forEach(el => {
      el.textContent = n;
      el.style.display = n ? "grid" : "none";
      if (n) { el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop"); }
    });
    paintDrawer();
  }

  /* --------------------------------------------------------------- toast */
  let toastEl, toastTimer;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; document.body.appendChild(toastEl); }
    toastEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12l4.5 4.5L19 7"/></svg>' + esc(msg);
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 2600);
  }

  /* ---------------------------------------------------------- delegation */
  document.addEventListener("click", e => {
    const cartBtn = e.target.closest("[data-open-cart]");
    if (cartBtn) {
      e.preventDefault();
      openDrawer();
      return;
    }
    const btn = e.target.closest("[data-add]");
    if (btn && btn.id !== "pdp-add" && !btn.hasAttribute("data-sticky-add")) { e.preventDefault(); Cart.add(btn.dataset.add, 1); }
  });

  /* -------------------------------------------------------------- header */
  function header() {
    const h = $(".header");
    if (h) {
      const onScroll = () => h.classList.toggle("is-stuck", window.scrollY > 12);
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
    }
    $$("[data-open-cart]").forEach(btn => {
      btn.addEventListener("click", e => { e.preventDefault(); openDrawer(); });
    });
    // several menu buttons can exist (header.js: ☰ on phones, "All" on desktop)
    const burgers = $$("[data-burger]"), mnav = $(".mobile-nav");
    if (burgers.length && mnav) {
      burgers.forEach(b => b.addEventListener("click", () => mnav.classList.add("is-open")));
      const close = $("[data-burger-close]");
      if (close) close.addEventListener("click", () => mnav.classList.remove("is-open"));
      mnav.addEventListener("click", e => { if (e.target.tagName === "A") mnav.classList.remove("is-open"); });
    }
    document.addEventListener("keydown", e => { if (e.key === "Escape") { closeDrawer(); if (mnav) mnav.classList.remove("is-open"); closeRateModal(); } });

    // prefetch internal pages on hover → navigation feels instant (React-like)
    const prefetched = new Set();
    document.addEventListener("pointerenter", e => {
      const a = e.target.closest && e.target.closest('a[href^="shop"], a[href^="product"], a[href^="./"]');
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href || prefetched.has(href)) return;
      prefetched.add(href);
      const l = document.createElement("link");
      l.rel = "prefetch"; l.as = "document"; l.href = href;
      document.head.appendChild(l);
    }, true);
  }

  /* -------------------------------------------------------------- reveal */
  function reveal() {
    const els = $$(".reveal:not(.is-in)");
    if (!("IntersectionObserver" in window)) { els.forEach(el => el.classList.add("is-in")); return; }
    const io = new IntersectionObserver(entries => {
      entries.forEach((en, i) => {
        if (en.isIntersecting) { setTimeout(() => en.target.classList.add("is-in"), (i % 6) * 60); io.unobserve(en.target); }
      });
    }, { threshold: 0.1, rootMargin: "0px 0px -30px" });
    els.forEach(el => io.observe(el));
  }

  /* ---------------------------------------------------------------- rail */
  function rails() {
    $$("[data-rail]").forEach(nav => {
      const rail = document.getElementById(nav.dataset.rail);
      if (!rail) return;
      nav.addEventListener("click", e => {
        const dir = e.target.closest("[data-next]") ? 1 : e.target.closest("[data-prev]") ? -1 : 0;
        if (dir) rail.scrollBy({ left: dir * (rail.clientWidth * 0.85), behavior: "smooth" });
      });
    });
  }

  /* ---------------------------------------------------------- newsletter */
  function newsletter() {
    const form = $("#newsletter");
    if (!form) return;
    form.addEventListener("submit", e => {
      e.preventDefault();
      const input = form.querySelector('input[type="email"]') || form.querySelector("input");
      const email = input ? input.value : "";
      if (window.FirebaseDB && window.FirebaseDB.saveNewsletter && email) {
        window.FirebaseDB.saveNewsletter(email);
      }
      const c = $("#coupon");
      if (c) c.classList.add("is-on");
      form.reset();
      toast("Welcome! Code WELCOME10 unlocked.");
    });
  }

  /* ----------------------------------------------------------- home page */
  function homePage() {
    const cats = $("#cat-grid");
    if (cats) {
      cats.innerHTML = STORE.collections.map(c =>
        '<a class="cat reveal" href="shop.html?c=' + encodeURIComponent(c.title) + '">' +
          '<div class="cat__media"><img src="' + c.image + '" alt="' + esc(c.title) + '" loading="lazy" decoding="async"></div>' +
          '<div class="cat__body"><div><span>' + c.count + (c.count === 1 ? " product" : " products") + "</span><h3>" + esc(c.title) + "</h3></div>" +
          '<span class="cat__arrow" aria-hidden="true">→</span></div>' +
        "</a>").join("");
    }
    const rail = $("#icon-rail");
    if (rail) renderInto(rail, STORE.products.slice(0, 20));
    const newest = $("#new-rail");
    if (newest) {
      const picks = STORE.products.filter(p => /sun|spf|kajal|body milk|amla|moringa/i.test(p.title)).slice(0, 8);
      renderInto(newest, picks.length >= 4 ? picks : STORE.products.slice(20, 28));
    }
    const reviews = $("#review-grid");
    if (reviews && !reviews.children.length) {
      const REVIEWS = [
        {
          q: "I finished my first order and had to place another immediately. As an interior designer my full day is spent in dust and site visits — I am simply in love with ChekOrganics body lotion and skincare.",
          n: "Vmsharitha Rao",
          role: "Interior Designer",
          loc: "Hyderabad",
          d: "25 May 2026",
          p: "Organic Noni Body Lotion",
          img: "assets/reviews/sharitha.webp"
        },
        {
          q: "Wonder oil. Has remarkable capabilities of pain relief and removal of dryness of scalp & skin. My whole family has switched to it and results are remarkable.",
          n: "Anupama Pandey",
          role: "Verified Buyer",
          loc: "Bengaluru",
          d: "15 Aug 2026",
          p: "Noni Herbal Hair Oil",
          img: "assets/reviews/anupama.webp"
        },
        {
          q: "It's a wonderful soap. Fresh peppermint smell — no need of any chemical deodorants after shower. A gentle natural exfoliator that keeps me fresh and energized through the day.",
          n: "Rajesh Kumar",
          role: "Fitness Enthusiast",
          loc: "Mumbai",
          d: "05 Jun 2026",
          p: "Noni Turmeric Soap",
          img: "assets/reviews/rajesh.webp"
        },
        {
          q: "A proud customer of this beauty gem since a year now! No parlour detanning services, no artificial chemical cleanups — this mask does the job all alone. Truly in love.",
          n: "Taara Sharma",
          role: "Verified Buyer",
          loc: "Delhi NCR",
          d: "02 Jun 2026",
          p: "Noni Mukha Lepam Mask",
          img: "assets/reviews/taara.webp"
        },
        {
          q: "Noni juice is an authentic Ayurvedic superfood. Consuming it regularly for a few months now and I feel energetic through the day. Strongly recommended to all age groups.",
          n: "Dr. John William",
          role: "Medical Practitioner",
          loc: "Chennai",
          d: "20 May 2026",
          p: "Noni Fruit Juice 500ml",
          img: "assets/reviews/dr-john.webp"
        },
        {
          q: "It's a very good lip balm, it keeps my lips deeply moisturised for hours and smells 100% natural. Pure Ayurvedic ingredients with zero petroleum jelly.",
          n: "Ittukala Jashmitha",
          role: "College Student",
          loc: "Warangal",
          d: "05 May 2026",
          p: "Passion Fruit Lip Balm",
          img: "assets/reviews/jashmitha.webp"
        }
        // only testimonials published on chekorganics.com belong here
      ];
      reviews.innerHTML = REVIEWS.map(r =>
        '<article class="review reveal">' +
          '<div class="review__customer">' +
            '<div class="review__avatar-wrap">' +
              '<img src="' + r.img + '" alt="' + esc(r.n) + '" class="review__avatar" width="54" height="54" loading="lazy">' +
              '<span class="review__verified-badge" title="Verified Customer">' +
                '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' +
              '</span>' +
            '</div>' +
            '<div class="review__author">' +
              '<b class="review__name">' + esc(r.n) + '</b>' +
              '<span class="review__meta">' + esc(r.role) + ' · ' + esc(r.loc) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="review__rating">' +
            '<span class="stars__glyphs">★★★★★</span>' +
            '<span class="review__date">' + r.d + '</span>' +
          '</div>' +
          '<p class="review__quote">“' + esc(r.q) + '”</p>' +
          '<div class="review__product">' +
            '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>' +
            '<span>Purchased: <b>' + esc(r.p) + '</b></span>' +
          '</div>' +
        '</article>').join("");
    }
  }

  /* ----------------------------------------------------------- shop page */
  function shopPage() {
    const grid = $("#shop-grid");
    if (!grid) return;
    const params = new URLSearchParams(location.search);
    // ?q= comes from the header search, ?deals=1 from "Today's Deals" (products with a compare-at price)
    window.__shopState = window.__shopState || { c: params.get("c") || "All Products", q: (params.get("q") || "").trim(), sort: "featured", deals: params.get("deals") === "1" };
    const state = window.__shopState;
    const chips = $("#chips");
    const countEl = $("#result-count"), search = $("#shop-search"), sort = $("#shop-sort");

    // chips always rebuilt so live counts stay accurate
    const all = [{ title: "All Products", count: STORE.products.length }].concat(STORE.collections);
    chips.innerHTML = all.map(c =>
      '<button class="chip' + (c.title === state.c ? " is-active" : "") + '" type="button" data-col="' + esc(c.title) + '">' +
      esc(c.title) + ' <span style="opacity:.55">(' + c.count + ")</span></button>").join("");

    function apply() {
      let list = STORE.products.slice();
      if (state.c && state.c !== "All Products") list = list.filter(p => p.collections.includes(state.c));
      if (state.deals) list = list.filter(p => p.compareAt && p.compareAt > p.price);
      if (state.q) {
        const q = state.q.toLowerCase();
        list = list.filter(p => (p.title + " " + p.type + " " + p.collections.join(" ") + " " + p.tags.join(" ")).toLowerCase().includes(q));
      }
      if (state.sort === "price-asc") list.sort((a, b) => a.price - b.price);
      if (state.sort === "price-desc") list.sort((a, b) => b.price - a.price);
      if (state.sort === "rating") list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      if (state.sort === "name") list.sort((a, b) => a.title.localeCompare(b.title));

      renderInto(grid, list);
      countEl.textContent = list.length + (list.length === 1 ? " product" : " products");
      const empty = $("#empty"); if (empty) empty.style.display = list.length ? "none" : "block";
      const heading = $("#active-col");
      if (heading) heading.textContent = state.deals ? "Today's Deals" : state.q ? "Results for “" + state.q + "”" : state.c;
    }

    if (!grid.dataset.bound) {
      grid.dataset.bound = "1";
      if (state.q) search.value = state.q;
      chips.addEventListener("click", e => {
        const b = e.target.closest("[data-col]");
        if (!b) return;
        state.c = b.dataset.col;
        const url = new URL(location.href);
        state.c === "All Products" ? url.searchParams.delete("c") : url.searchParams.set("c", state.c);
        history.replaceState({}, "", url);
        apply();
      });
      search.addEventListener("input", e => { state.q = e.target.value.trim(); apply(); });
      sort.addEventListener("change", e => { state.sort = e.target.value; apply(); });
    }
    apply();
  }

  /* ------------------------------------------------------- product page */
  const RECENT_KEY = "chek_recent_v1";
  function pushRecent(handle) {
    try {
      const list = JSON.parse(localStorage.getItem(RECENT_KEY)) || [];
      const next = [handle].concat(list.filter(h => h !== handle)).slice(0, 8);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch (e) {}
  }

  function productPage() {
    const root = $("#pdp");
    if (!root) return;
    const asked = new URLSearchParams(location.search).get("p");
    const handle = asked || (STORE.products[0] && STORE.products[0].handle);
    // an unknown or retired handle gets a "not found" notice rather than some other product
    const p = byHandle(handle) || localByHandle(handle) || (asked ? null : STORE.products[0]);
    let missing = $("#pdp-missing");
    if (!p) {
      root.hidden = true;
      $$("#reviews-section").forEach(s => (s.hidden = true));
      if (!missing) {
        missing = document.createElement("div");
        missing.id = "pdp-missing";
        missing.style.cssText = "text-align:center;padding:3rem 1rem";
        missing.innerHTML = "<h1>Product not found</h1><p style=\"color:var(--muted);margin:0.75rem 0 1.5rem\">This product may have been renamed or is no longer available.</p>" +
          '<a class="btn btn--primary" href="shop.html">Browse all products</a>';
        root.after(missing);
      }
      document.title = "Product not found — CHEKORGANICS";
      const crumb = $("#pdp-crumb");
      if (crumb) crumb.textContent = "Not found";
      return;
    }
    // the live catalog can arrive after a miss on the bundled one
    root.hidden = false;
    $$("#reviews-section").forEach(s => (s.hidden = false));
    if (missing) missing.remove();
    const t = splitTitle(p.title);
    pushRecent(p.handle);

    document.title = t.name + " — CHEKORGANICS";
    const meta = document.querySelector('meta[name="description"]');
    if (meta && p.excerpt) meta.setAttribute("content", p.excerpt);

    const main = $("#gallery-main"), thumbs = $("#gallery-thumbs");
    const prevBtn = $("#gallery-prev"), nextBtn = $("#gallery-next"), counter = $("#gallery-counter");
    const images = (p.images && p.images.length) ? p.images : ["assets/brand/logo.webp"];
    let currentIdx = 0;

    function showImage(idx, animate = true) {
      if (!images.length) return;
      currentIdx = (idx + images.length) % images.length;
      const targetSrc = images[currentIdx];

      if (animate && main) {
        main.classList.add("is-changing");
        setTimeout(() => {
          main.src = targetSrc;
          main.alt = t.name + " · View " + (currentIdx + 1);
          main.classList.remove("is-changing");
        }, 120);
      } else if (main) {
        main.src = targetSrc;
        main.alt = t.name + " · View " + (currentIdx + 1);
      }

      // Sync active state on thumbnails
      if (thumbs) {
        $$("button", thumbs).forEach((btn, i) => {
          const isActive = (i === currentIdx);
          btn.classList.toggle("is-active", isActive);
          btn.setAttribute("aria-selected", isActive ? "true" : "false");
          if (isActive) {
            btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
          }
        });
      }

      // Sync counter
      if (counter) {
        counter.textContent = (currentIdx + 1) + " / " + images.length;
        counter.style.display = images.length > 1 ? "block" : "none";
      }

      // Show/hide prev/next if only 1 image
      if (prevBtn) prevBtn.style.display = images.length > 1 ? "grid" : "none";
      if (nextBtn) nextBtn.style.display = images.length > 1 ? "grid" : "none";
    }

    if (thumbs) {
      thumbs.innerHTML = images.map((src, i) =>
        '<button type="button" class="' + (i === 0 ? "is-active" : "") + '" data-shot="' + i + '" aria-label="View image ' + (i + 1) + '" aria-selected="' + (i === 0 ? "true" : "false") + '">' +
        '<img src="' + src + '" alt="' + esc(t.name) + " view " + (i + 1) + '"></button>').join("");

      thumbs.onclick = (e) => {
        const btn = e.target.closest("[data-shot]");
        if (btn) {
          const shotIdx = parseInt(btn.dataset.shot, 10);
          showImage(shotIdx);
        }
      };
    }

    if (prevBtn) {
      prevBtn.onclick = (e) => {
        e.preventDefault();
        showImage(currentIdx - 1);
      };
    }

    if (nextBtn) {
      nextBtn.onclick = (e) => {
        e.preventDefault();
        showImage(currentIdx + 1);
      };
    }

    // Touch swipe support for gallery on mobile
    const galleryMain = $(".gallery__main");
    if (galleryMain) {
      let touchStartX = 0;
      let touchEndX = 0;
      galleryMain.addEventListener("touchstart", (e) => {
        touchStartX = e.changedTouches[0].screenX;
      }, { passive: true });
      galleryMain.addEventListener("touchend", (e) => {
        touchEndX = e.changedTouches[0].screenX;
        const diff = touchStartX - touchEndX;
        if (Math.abs(diff) > 45) {
          if (diff > 0) showImage(currentIdx + 1); // swipe left
          else showImage(currentIdx - 1); // swipe right
        }
      }, { passive: true });
    }

    // Keyboard navigation (Left / Right arrow keys)
    if (!window.__pdpGalleryKeyBound) {
      window.__pdpGalleryKeyBound = true;
      window.addEventListener("keydown", (e) => {
        if (!/\/product(\.html)?$/.test(location.pathname)) return;
        if (document.activeElement && (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA")) return;
        if (e.key === "ArrowLeft") {
          const pb = $("#gallery-prev");
          if (pb) pb.click();
        } else if (e.key === "ArrowRight") {
          const nb = $("#gallery-next");
          if (nb) nb.click();
        }
      });
    }

    showImage(0, false);

    $("#pdp-eyebrow").textContent = p.primaryCollection + (p.type ? " · " + p.type : "");
    $("#pdp-title").textContent = t.name;
    const rStats = Ratings.get(p);
    $("#pdp-rating").innerHTML =
      '<div class="pdp-rating-summary">' +
        '<button class="pdp-rating-badge" type="button" data-scroll-reviews aria-label="View ' + rStats.reviewsCount + ' reviews">' +
          '<span class="stars__glyphs stars__glyphs--lg" aria-hidden="true">' + renderStars(rStats.rating) + '</span>' +
          '<span class="pdp-rating-score">' + ratingScore(rStats) + '</span>' +
          '<span class="pdp-rating-count">' + (rStats.reviewsCount ? '(' + rStats.reviewsCount + ' customer review' + (rStats.reviewsCount === 1 ? '' : 's') + ')' : 'No reviews yet') + '</span>' +
        '</button>' +
        '<span class="pdp-rating-sep">·</span>' +
        '<button class="pdp-rate-btn" type="button" id="pdp-hero-rate-btn">✍️ Write a review</button>' +
      '</div>' +
      '<span class="stock ' + (p.available ? "in" : "out") + '">' + (p.available ? "● In stock · dispatched in 24 hrs" : "● Currently sold out") + "</span>";
    $("#pdp-price").innerHTML = money(p.price) + (p.compareAt ? "<s>" + money(p.compareAt) + "</s>" : "");
    const save = $("#pdp-save");
    if (p.compareAt) { save.style.display = "inline-block"; save.textContent = "Save " + money(p.compareAt - p.price); }
    $("#pdp-benefit").textContent = t.benefit || p.excerpt.slice(0, 90);
    $("#pdp-desc").textContent = p.excerpt || "Handcrafted in small batches on our own farm in Telangana, using Ayurvedic wisdom and Noni grown, certified and processed by CHEKORGANICS.";
    $("#pdp-tags").innerHTML = p.collections.map(c => '<span class="tag">' + esc(c) + "</span>").concat(p.tags.slice(0, 6).map(x => '<span class="tag">' + esc(x) + "</span>")).join("");

    const qty = $("#qty");
    $("#qty-minus").onclick = () => { qty.value = Math.max(1, (+qty.value || 1) - 1); syncSticky(); };
    $("#qty-plus").onclick = () => { qty.value = Math.min(99, (+qty.value || 1) + 1); syncSticky(); };
    qty.onchange = () => { qty.value = Math.min(99, Math.max(1, +qty.value || 1)); syncSticky(); };

    const addBtn = $("#pdp-add");
    addBtn.dataset.add = p.handle;
    addBtn.disabled = !p.available;
    addBtn.textContent = p.available ? "Add to bag" : "Sold out";
    addBtn.onclick = () => Cart.add(p.handle, Math.max(1, +qty.value || 1));

    const buyBtn = $("#pdp-buy");
    if (buyBtn) {
      buyBtn.textContent = p.available ? "Buy Now" : "Sold out";
      buyBtn.disabled = !p.available;
      buyBtn.onclick = (e) => {
        e.preventDefault();
        Cart.add(p.handle, Math.max(1, +qty.value || 1));
        window.location.href = "checkout.html";
      };
    }
    const crumb = $("#pdp-crumb"); if (crumb) crumb.textContent = t.name;

    // sticky add-to-bag bar (appears once the buy box scrolls away) — CRO
    let bar = $("#sticky-buy");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "sticky-buy"; bar.id = "sticky-buy";
      bar.innerHTML =
        '<div class="sticky-buy__inner">' +
          '<img alt="" data-sticky-img>' +
          '<div class="sticky-buy__text"><b data-sticky-title></b><span class="price" data-sticky-price></span></div>' +
          '<button class="btn btn--primary" type="button" data-sticky-add>Add to bag</button>' +
          '<button class="icon-btn" type="button" data-sticky-buy-now aria-label="Buy now · Checkout">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 7h12l1 13H5L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg></button>' +
        "</div>";
      document.body.appendChild(bar);
    }
    $("[data-sticky-img]").src = p.images[0];
    const stickyText = bar.querySelector(".sticky-buy__text");
    if (stickyText) {
      stickyText.innerHTML = '<b data-sticky-title>' + esc(t.name) + '</b>' +
        '<div style="display:flex;align-items:center;gap:0.6rem;margin-top:2px">' +
          '<span class="price" data-sticky-price>' + money(p.price) + '</span>' +
          (rStats.reviewsCount ? '<span class="stars stars--sm"><span class="stars__glyphs">' + renderStars(rStats.rating) + '</span> <b>' + rStats.rating.toFixed(1) + '</b></span>' : '') +
        '</div>';
    }
    const stickyBuyNow = $("[data-sticky-buy-now]");
    if (stickyBuyNow) {
      stickyBuyNow.onclick = (e) => {
        e.preventDefault();
        Cart.add(p.handle, Math.max(1, +qty.value || 1));
        window.location.href = "checkout.html";
      };
    }
    $("[data-sticky-add]").onclick = () => Cart.add(p.handle, Math.max(1, +qty.value || 1));
    bar.dataset.handle = p.handle;

    function syncSticky() {
      const pr = $(".pdp__price");
      const box = $(".pdp__buy");
      const show = (box.getBoundingClientRect().bottom < 0) || window.scrollY > 900;
      bar.classList.toggle("is-on", !!show && p.available);
    }
    if (window.__stickyFn) window.removeEventListener("scroll", window.__stickyFn);
    window.__stickyFn = syncSticky;
    window.addEventListener("scroll", syncSticky, { passive: true });
    syncSticky();

    renderPdpReviews(p);

    const related = $("#related-grid");
    if (related) {
      const rel = STORE.products.filter(x => x.handle !== p.handle && x.collections.some(c => p.collections.includes(c)));
      renderInto(related, (rel.length >= 4 ? rel : STORE.products.filter(x => x.handle !== p.handle)).slice(0, 4));
    }

    // recently viewed — CRO
    const wrap = $("#recent-wrap"), recGrid = $("#recent-grid");
    if (wrap && recGrid) {
      let recent = [];
      try { recent = (JSON.parse(localStorage.getItem(RECENT_KEY)) || []).map(byHandle).filter(Boolean); } catch (e) {}
      recent = recent.filter(x => x.handle !== p.handle).slice(0, 4);
      wrap.hidden = !recent.length;
      if (recent.length) renderInto(recGrid, recent);
    }
  }

  /* -------------------------------------------------------- hero slider */
  function heroSlider() {
    const root = $("#hero");
    if (!root) return;
    const slides = $$(".hero__slide", root);
    const panels = $$(".hero__panel", root);
    const dots = $$("[data-hero-dot]", root);
    if (slides.length < 2) return;

    let index = 0, timer = null, hovering = false, focused = false;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function go(n) {
      index = (n + slides.length) % slides.length;
      slides.forEach((s, k) => {
        s.classList.toggle("is-active", k === index);
        s.setAttribute("aria-hidden", k === index ? "false" : "true");
      });
      panels.forEach((p, k) => {
        p.classList.toggle("is-active", k === index);
        p.setAttribute("aria-hidden", k === index ? "false" : "true");
      });
      dots.forEach((d, k) => {
        d.classList.toggle("is-active", k === index);
        d.setAttribute("aria-current", k === index ? "true" : "false");
      });
    }

    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function play() {
      stop();
      if (reduce || document.hidden || hovering || focused) return;
      timer = setInterval(() => go(index + 1), 6500);
    }

    const next = $("[data-hero-next]", root), prev = $("[data-hero-prev]", root);
    if (next) next.addEventListener("click", () => { go(index + 1); play(); });
    if (prev) prev.addEventListener("click", () => { go(index - 1); play(); });
    dots.forEach((d, k) => d.addEventListener("click", () => { go(k); play(); }));

    root.addEventListener("pointerenter", () => { hovering = true; stop(); });
    root.addEventListener("pointerleave", () => { hovering = false; play(); });
    root.addEventListener("focusin", e => {
      // only keyboard focus pauses autoplay (mouse clicks keep it running)
      focused = !!(e.target && e.target.matches && e.target.matches(":focus-visible"));
      if (focused) stop(); else play();
    });
    root.addEventListener("focusout", () => { focused = false; setTimeout(play, 0); });
    document.addEventListener("visibilitychange", () => (document.hidden ? stop() : play()));

    // swipe on touch screens
    let x0 = null;
    root.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; stop(); }, { passive: true });
    root.addEventListener("touchend", e => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 48) go(index + (dx < 0 ? 1 : -1));
      x0 = null; play();
    });

    go(0);
    play();
  }

  /* ------------------------------------------------ rating modal & reviews UI */
  let activeModalHandle = null;

  function setupStarPicker(container, hiddenInput, labelEl) {
    if (!container) return;
    const labels = {
      1: "1★ Needs improvement",
      2: "2★ Fair ritual",
      3: "3★ Good product",
      4: "4★ Very good",
      5: "5★ Excellent!"
    };
    const buttons = Array.from(container.querySelectorAll("button"));
    let currentRating = Number(hiddenInput ? hiddenInput.value : 5) || 5;

    function render(rating, isHover) {
      buttons.forEach(btn => {
        const v = Number(btn.dataset.val);
        btn.classList.toggle("is-hovered", isHover && v <= rating);
        btn.classList.toggle("is-active", !isHover && v <= rating);
      });
      if (labelEl) labelEl.textContent = labels[rating] || (rating + "★");
    }

    buttons.forEach(btn => {
      const v = Number(btn.dataset.val);
      btn.addEventListener("mouseenter", () => render(v, true));
      btn.addEventListener("focus", () => render(v, true));
      btn.addEventListener("click", e => {
        e.preventDefault();
        currentRating = v;
        if (hiddenInput) hiddenInput.value = v;
        render(v, false);
      });
    });

    container.addEventListener("mouseleave", () => render(currentRating, false));
    render(currentRating, false);
  }

  function buildRateModal() {
    if ($("#rate-modal-overlay")) return;
    const overlay = document.createElement("div");
    overlay.className = "rate-modal-overlay";
    overlay.id = "rate-modal-overlay";
    overlay.innerHTML =
      '<div class="rate-modal" role="dialog" aria-modal="true" aria-labelledby="rate-modal-title">' +
        '<button class="icon-btn rate-modal__close" type="button" data-close-rate-modal aria-label="Close modal">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
        '</button>' +
        '<div class="rate-modal__product">' +
          '<img id="rate-modal-img" src="" alt="" width="60" height="60">' +
          '<div>' +
            '<span class="rate-modal__eyebrow">Rate this product</span>' +
            '<h4 id="rate-modal-title">Product Name</h4>' +
            '<div class="rate-modal__current" id="rate-modal-current" style="font-size:0.8rem;color:var(--muted)"></div>' +
          '</div>' +
        '</div>' +
        '<form id="quick-rate-form" class="rate-modal__form">' +
          '<div class="form-group">' +
            '<label class="form-label">Your Rating <span class="req">*</span></label>' +
            '<div class="star-rating-picker">' +
              '<div class="picker-stars" id="modal-picker-stars">' +
                '<button type="button" data-val="1">★</button>' +
                '<button type="button" data-val="2">★</button>' +
                '<button type="button" data-val="3">★</button>' +
                '<button type="button" data-val="4">★</button>' +
                '<button type="button" data-val="5">★</button>' +
              '</div>' +
              '<span class="picker-label" id="modal-picker-label">5★ Excellent!</span>' +
              '<input type="hidden" id="modal-rating-val" value="5" required>' +
            '</div>' +
          '</div>' +
          '<div class="form-row">' +
            '<div class="form-group">' +
              '<label class="form-label" for="modal-input-name">Your Name <span class="req">*</span></label>' +
              '<input class="form-input" id="modal-input-name" type="text" placeholder="e.g. Priya Sharma" required>' +
            '</div>' +
            '<div class="form-group">' +
              '<label class="form-label" for="modal-input-city">City (optional)</label>' +
              '<input class="form-input" id="modal-input-city" type="text" placeholder="e.g. Hyderabad">' +
            '</div>' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="modal-input-title">Review Title (optional)</label>' +
            '<input class="form-input" id="modal-input-title" type="text" placeholder="e.g. Amazing natural quality!">' +
          '</div>' +
          '<div class="form-group">' +
            '<label class="form-label" for="modal-input-body">Feedback / Review <span class="req">*</span></label>' +
            '<textarea class="form-textarea" id="modal-input-body" rows="3" placeholder="Share your experience about herbal texture, fragrance, results..." required></textarea>' +
          '</div>' +
          '<div class="rate-modal__actions">' +
            '<button class="btn btn--gold btn--block" type="submit">Submit Rating &amp; Review</button>' +
          '</div>' +
          '<p class="rate-modal__footer-note">🌿 Your review is shown publicly on this product</p>' +
        '</form>' +
      '</div>';
    document.body.appendChild(overlay);

    setupStarPicker($("#modal-picker-stars"), $("#modal-rating-val"), $("#modal-picker-label"));

    overlay.addEventListener("click", e => {
      if (e.target === overlay || e.target.closest("[data-close-rate-modal]")) closeRateModal();
    });

    const form = $("#quick-rate-form");
    if (form) {
      form.addEventListener("submit", e => {
        e.preventDefault();
        if (!activeModalHandle) return;
        const name = $("#modal-input-name").value;
        const city = $("#modal-input-city").value;
        const rating = Number($("#modal-rating-val").value) || 5;
        const title = $("#modal-input-title").value;
        const body = $("#modal-input-body").value;

        Ratings.submit(activeModalHandle, { name, city, rating, title, body });
        closeRateModal();
        toast("✨ Thank you! Your " + rating + "★ review has been recorded.");
      });
    }
  }

  function openQuickRateModal(handle) {
    buildRateModal();
    const p = byHandle(handle) || localByHandle(handle);
    if (!p) return;
    activeModalHandle = handle;
    const t = splitTitle(p.title);
    const stats = Ratings.get(p);

    const img = $("#rate-modal-img");
    if (img) { img.src = p.images[0]; img.alt = t.name; }
    const titleEl = $("#rate-modal-title");
    if (titleEl) titleEl.textContent = t.name;
    const curEl = $("#rate-modal-current");
    if (curEl) curEl.innerHTML = stats.reviewsCount
      ? renderStars(stats.rating) + ' <b>' + stats.rating.toFixed(1) + '</b> (' + stats.reviewsCount + ' review' + (stats.reviewsCount === 1 ? '' : 's') + ')'
      : 'No reviews yet — be the first';

    $("#modal-rating-val").value = "5";
    setupStarPicker($("#modal-picker-stars"), $("#modal-rating-val"), $("#modal-picker-label"));
    $("#modal-input-name").value = "";
    $("#modal-input-city").value = "";
    $("#modal-input-title").value = "";
    $("#modal-input-body").value = "";

    const overlay = $("#rate-modal-overlay");
    if (overlay) overlay.classList.add("is-open");
    document.body.style.overflow = "hidden";
  }

  function closeRateModal() {
    const overlay = $("#rate-modal-overlay");
    if (overlay) overlay.classList.remove("is-open");
    document.body.style.overflow = "";
    activeModalHandle = null;
  }

  function renderPdpReviews(p) {
    const sec = $("#reviews-section");
    if (!sec || !p) return;

    const stats = Ratings.get(p);

    const scoreEl = $("#summary-score");
    if (scoreEl) scoreEl.textContent = stats.reviewsCount ? stats.rating.toFixed(1) : "–";
    const starsEl = $("#summary-stars");
    if (starsEl) starsEl.innerHTML = renderStars(stats.rating);
    const countEl = $("#summary-count");
    if (countEl) countEl.textContent = stats.reviewsCount
      ? "Based on " + stats.reviewsCount + " customer rating" + (stats.reviewsCount === 1 ? "" : "s")
      : "No reviews yet — be the first to share yours";

    // share of written reviews rated 4★ or 5★ (hidden until someone has written one)
    const recEl = $("#summary-recommend");
    if (recEl) {
      recEl.style.display = stats.hasBreakdown ? "" : "none";
      recEl.textContent = stats.hasBreakdown ? "🌿 " + (stats.breakdown[5] + stats.breakdown[4]) + "% of written reviews are 4★ or 5★" : "";
    }

    const barsEl = $("#summary-bars");
    if (barsEl) barsEl.style.display = stats.hasBreakdown ? "" : "none";
    if (barsEl && stats.hasBreakdown) {
      barsEl.innerHTML = [5, 4, 3, 2, 1].map(star => {
        const pct = stats.breakdown[star] || 0;
        return '<div class="rating-bar-row">' +
          '<span>' + star + ' ★</span>' +
          '<div class="rating-bar__track"><div class="rating-bar__fill" style="width:' + pct + '%"></div></div>' +
          '<span>' + pct + '%</span>' +
        '</div>';
      }).join("");
    }

    const toggleBtn = $("#btn-toggle-review-form");
    const closeBtn = $("#btn-close-review-form");
    const cancelBtn = $("#btn-cancel-review");
    const form = $("#pdp-review-form");

    function openForm() {
      if (form) {
        form.style.display = "block";
        form.scrollIntoView({ behavior: "smooth", block: "center" });
        const nameInput = $("#pdp-rev-name");
        if (nameInput) setTimeout(() => nameInput.focus(), 300);
      }
    }
    function closeForm() {
      if (form) form.style.display = "none";
    }

    if (toggleBtn) toggleBtn.onclick = () => {
      const isHidden = form.style.display === "none" || !form.style.display;
      if (isHidden) openForm(); else closeForm();
    };
    if (closeBtn) closeBtn.onclick = closeForm;
    if (cancelBtn) cancelBtn.onclick = closeForm;

    setupStarPicker($("#pdp-star-picker"), $("#pdp-rating-input"), $("#pdp-picker-label"));

    const listEl = $("#pdp-reviews-list");
    if (listEl) {
      listEl.innerHTML = !stats.reviews.length
        ? '<p class="review-card__body" style="text-align:center;padding:1.5rem 0">' +
            (stats.reviewsCount ? "Ratings so far came without written comments." : "No reviews yet.") +
            " Bought this? Be the first to write one.</p>"
        : stats.reviews.map(r =>
        '<article class="review-card">' +
          '<div class="review-card__header">' +
            '<div class="review-card__user">' +
              '<div class="review-card__name">' +
                // no "Verified Buyer" tag: reviews aren't linked to orders, and older saved
                // reviews carry verified:true from a version that set it on every review
                esc(r.author) +
              '</div>' +
              (r.city ? '<span class="review-card__city">' + esc(r.city) + '</span>' : '') +
            '</div>' +
            '<span class="review-card__date">' + esc(reviewDate(r)) + '</span>' +
          '</div>' +
          '<div class="stars__glyphs" aria-label="' + (Number(r.rating) || 0) + ' stars">' + renderStars(r.rating) + '</div>' +
          (r.title ? '<h4 class="review-card__title">' + esc(r.title) + '</h4>' : '') +
          (r.body ? '<p class="review-card__body">' + esc(r.body) + '</p>' : '') +
          '<div class="review-card__footer">' +
            '<span></span>' +
            '<button class="helpful-btn" type="button" data-helpful="' + esc(r.id || 'r') + '">Helpful 👍 <span>' + (Number(r.helpful) || 0) + '</span></button>' +
          '</div>' +
        '</article>'
      ).join("");
    }

    if (form && !form.dataset.bound) {
      form.dataset.bound = "1";
      form.addEventListener("submit", e => {
        e.preventDefault();
        const name = $("#pdp-rev-name").value;
        const city = $("#pdp-rev-city").value;
        const rating = Number($("#pdp-rating-input").value) || 5;
        const title = $("#pdp-rev-title").value;
        const body = $("#pdp-rev-body").value;

        Ratings.submit(p.handle, { name, city, rating, title, body });
        form.reset();
        closeForm();
        renderPdpReviews(p);
        toast("✨ Thank you, " + (name || "valued customer") + "! Your review has been added.");
      });
    }
  }

  // Global rating click delegation
  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-rate-modal]");
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      const h = btn.dataset.rateModal;
      const isPdp = /\/product(\.html)?$/.test(location.pathname);
      const currentParam = new URLSearchParams(location.search).get("p");
      const currentHandle = currentParam || (STORE.products[0] && STORE.products[0].handle);
      if (isPdp && currentHandle === h && $("#reviews-section")) {
        const sec = $("#reviews-section");
        sec.scrollIntoView({ behavior: "smooth", block: "start" });
        const f = $("#pdp-review-form");
        if (f) {
          f.style.display = "block";
          const inp = $("#pdp-rev-name");
          if (inp) setTimeout(() => inp.focus(), 300);
        }
      } else {
        openQuickRateModal(h);
      }
    }
    if (e.target.closest("[data-scroll-reviews]")) {
      e.preventDefault();
      const sec = $("#reviews-section");
      if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (e.target.closest("#pdp-hero-rate-btn")) {
      e.preventDefault();
      const sec = $("#reviews-section");
      if (sec) {
        sec.scrollIntoView({ behavior: "smooth", block: "start" });
        const f = $("#pdp-review-form");
        if (f) {
          f.style.display = "block";
          const inp = $("#pdp-rev-name");
          if (inp) setTimeout(() => inp.focus(), 300);
        }
      }
    }
    const helpful = e.target.closest("[data-helpful]");
    if (helpful && !helpful.classList.contains("is-active")) {
      helpful.classList.add("is-active");
      const sp = helpful.querySelector("span");
      if (sp) sp.textContent = Number(sp.textContent || 0) + 1;
      toast("Thank you for your feedback!");
    }
  });

  window.addEventListener("chek:rating-updated", e => {
    const handle = e.detail.handle;
    $$('[data-rate-modal="' + handle + '"]').forEach(b => {
      const stats = Ratings.get(handle);
      const glyphs = b.querySelector(".stars__glyphs");
      if (glyphs) glyphs.innerHTML = renderStars(stats.rating);
      const sc = b.querySelector(".rating-badge__score");
      if (sc) sc.textContent = ratingScore(stats);
      const cnt = b.querySelector(".rating-badge__count");
      if (cnt) cnt.textContent = ratingCount(stats);
    });
    if (/\/product(\.html)?$/.test(location.pathname)) {
      const cur = new URLSearchParams(location.search).get("p") || (STORE.products[0] && STORE.products[0].handle);
      if (cur === handle) {
        const p = byHandle(handle) || STORE.products[0];
        if (p) renderPdpReviews(p);
      }
    }
  });

  /* ----------------------------------------------------------- checkout */
  function checkoutPage() {
    const form = $("#checkout-form");
    if (!form) return;

    // Support 1-click direct buy via query parameter ?buy=handle&qty=N
    const urlParams = new URLSearchParams(window.location.search);
    const buyHandle = urlParams.get("buy");
    const buyQty = Math.max(1, parseInt(urlParams.get("qty"), 10) || 1);
    if (buyHandle) {
      const p = byHandle(buyHandle) || localByHandle(buyHandle);
      if (p) {
        Cart.add(p.handle, buyQty);
      }
    }

    let couponDiscount = 0;
    let appliedCoupon = null;
    let selectedShipping = "standard"; // standard | express
    let selectedPayment = "upi"; // upi | cod | card | netbanking
    let selectedAddressType = "Home";

    const VALID_COUPONS = {
      "WELCOME10": { type: "percent", value: 10, label: "10% off (Welcome Offer)" },
      "CHEK100": { type: "flat", value: 100, label: "₹100 flat discount" },
      "AYURVEDA": { type: "percent", value: 15, label: "15% off Ayurvedic special" }
    };

    // Indian PIN codes dictionary for instant auto-detection
    const PIN_MAP = {
      "500": { city: "Hyderabad", state: "Telangana" },
      "501": { city: "Ranga Reddy", state: "Telangana" },
      "502": { city: "Medak", state: "Telangana" },
      "503": { city: "Nizamabad", state: "Telangana" },
      "504": { city: "Adilabad", state: "Telangana" },
      "505": { city: "Karimnagar", state: "Telangana" },
      "506": { city: "Warangal", state: "Telangana" },
      "507": { city: "Khammam", state: "Telangana" },
      "508": { city: "Nalgonda", state: "Telangana" },
      "509": { city: "Mahabubnagar", state: "Telangana" },
      "515": { city: "Anantapur", state: "Andhra Pradesh" },
      "516": { city: "Cuddapah", state: "Andhra Pradesh" },
      "517": { city: "Tirupati", state: "Andhra Pradesh" },
      "518": { city: "Kurnool", state: "Andhra Pradesh" },
      "520": { city: "Vijayawada", state: "Andhra Pradesh" },
      "521": { city: "Krishna", state: "Andhra Pradesh" },
      "522": { city: "Guntur", state: "Andhra Pradesh" },
      "530": { city: "Visakhapatnam", state: "Andhra Pradesh" },
      "110": { city: "New Delhi", state: "Delhi" },
      "121": { city: "Faridabad", state: "Haryana" },
      "122": { city: "Gurugram", state: "Haryana" },
      "201": { city: "Noida / Ghaziabad", state: "Uttar Pradesh" },
      "400": { city: "Mumbai", state: "Maharashtra" },
      "411": { city: "Pune", state: "Maharashtra" },
      "440": { city: "Nagpur", state: "Maharashtra" },
      "560": { city: "Bengaluru", state: "Karnataka" },
      "570": { city: "Mysuru", state: "Karnataka" },
      "600": { city: "Chennai", state: "Tamil Nadu" },
      "641": { city: "Coimbatore", state: "Tamil Nadu" },
      "682": { city: "Kochi", state: "Kerala" },
      "695": { city: "Thiruvananthapuram", state: "Kerala" },
      "700": { city: "Kolkata", state: "West Bengal" },
      "302": { city: "Jaipur", state: "Rajasthan" },
      "380": { city: "Ahmedabad", state: "Gujarat" },
      "395": { city: "Surat", state: "Gujarat" },
      "452": { city: "Indore", state: "Madhya Pradesh" },
      "462": { city: "Bhopal", state: "Madhya Pradesh" },
      "800": { city: "Patna", state: "Bihar" },
      "160": { city: "Chandigarh", state: "Punjab" },
      "141": { city: "Ludhiana", state: "Punjab" }
    };

    function renderSummary() {
      const items = Cart.items();
      const subtotal = Cart.total();
      const count = Cart.count();

      const emptyEl = $("#checkout-empty");
      const gridEl = $("#checkout-main-grid");
      if (!items.length) {
        if (emptyEl) emptyEl.style.display = "block";
        if (gridEl) gridEl.style.display = "none";
        return;
      } else {
        if (emptyEl) emptyEl.style.display = "none";
        if (gridEl) gridEl.style.display = "grid";
      }

      // Render summary items
      const listEl = $("#summary-items-list");
      if (listEl) {
        listEl.innerHTML = items.map(({ product: p, qty }) => {
          const t = splitTitle(p.title);
          return `
            <div class="summary-item">
              <div class="summary-item__img-wrap">
                <img src="${p.images[0]}" alt="${esc(t.name)}">
                <span class="summary-item__badge">${qty}</span>
              </div>
              <div class="summary-item__details">
                <p class="summary-item__title">${esc(t.name)}</p>
                <div class="summary-item__meta">${esc(t.benefit || p.collections[0] || "Handcrafted")}</div>
              </div>
              <div class="summary-item__price">${money(p.price * qty)}</div>
            </div>
          `;
        }).join("");
      }

      const countEl = $("#summary-items-count");
      if (countEl) countEl.textContent = count + " item" + (count > 1 ? "s" : "");

      // Shipping cost
      let shippingFee = 0;
      const stdPriceEl = $("#ship-standard-price");
      const stdDescEl = $("#ship-standard-desc");
      if (subtotal >= FREE_SHIP) {
        if (stdPriceEl) stdPriceEl.textContent = "FREE";
        if (stdDescEl) stdDescEl.textContent = "Delivered in 3–5 days · Free Shipping unlocked!";
      } else {
        if (stdPriceEl) stdPriceEl.textContent = "₹99";
        if (stdDescEl) stdDescEl.textContent = "Add " + money(FREE_SHIP - subtotal) + " more for FREE Shipping";
      }

      if (selectedShipping === "express") {
        shippingFee = 149;
      } else {
        shippingFee = subtotal >= FREE_SHIP ? 0 : 99;
      }

      // Coupon discount calculation
      let discountAmt = 0;
      if (appliedCoupon) {
        const cInfo = VALID_COUPONS[appliedCoupon];
        if (cInfo) {
          if (cInfo.type === "percent") {
            discountAmt = Math.round((subtotal * cInfo.value) / 100);
          } else {
            discountAmt = Math.min(subtotal, cInfo.value);
          }
        }
      }
      couponDiscount = discountAmt;

      const totalToPay = Math.max(0, subtotal - discountAmt + shippingFee);
      const estTax = Math.round(totalToPay * 0.18 / 1.18); // GST 18% embedded

      // Update breakdown UI
      const subtotalEl = $("#calc-subtotal"); if (subtotalEl) subtotalEl.textContent = money(subtotal);
      const shipEl = $("#calc-shipping"); if (shipEl) shipEl.textContent = shippingFee === 0 ? "FREE" : money(shippingFee);
      const taxEl = $("#calc-tax"); if (taxEl) taxEl.textContent = money(estTax) + " (included)";
      const totalEl = $("#calc-total"); if (totalEl) totalEl.textContent = money(totalToPay);
      const mobTotalEl = $("#mobile-summary-total"); if (mobTotalEl) mobTotalEl.textContent = money(totalToPay);

      // Discount row
      const discRow = $("#calc-row-discount");
      const discVal = $("#calc-discount-val");
      const discCode = $("#calc-discount-code");
      if (discRow && discVal && discCode) {
        if (discountAmt > 0) {
          discRow.style.display = "flex";
          discVal.textContent = "- " + money(discountAmt);
          discCode.textContent = appliedCoupon;
        } else {
          discRow.style.display = "none";
        }
      }

      // Savings banner
      const savBanner = $("#savings-banner");
      const savText = $("#savings-text");
      const totalSavings = discountAmt + (shippingFee === 0 && subtotal < FREE_SHIP ? 99 : (subtotal >= FREE_SHIP ? 99 : 0));
      if (savBanner && savText) {
        if (totalSavings > 0) {
          savBanner.style.display = "block";
          savText.textContent = "You are saving " + money(totalSavings) + " on this order!";
        } else {
          savBanner.style.display = "none";
        }
      }

      // Submit button text
      const placeBtnText = $("#btn-place-order-text");
      if (placeBtnText) {
        if (selectedPayment === "cod") {
          placeBtnText.textContent = "Place Order (COD) · " + money(totalToPay);
        } else {
          placeBtnText.textContent = "Pay Securely · " + money(totalToPay);
        }
      }

      // UPI QR and Amount
      const upiAmt = $("#upi-qr-amount");
      if (upiAmt) upiAmt.textContent = money(totalToPay);
      const codAmtVal = $(".cod-amount-val");
      if (codAmtVal) codAmtVal.textContent = totalToPay.toLocaleString("en-IN");
      generateDynamicUpiQr(totalToPay);
    }

    function generateDynamicUpiQr(amount) {
      const vpa = "Q20988719@ybl";
      const payee = "PhonePeMerchant";
      const amtStr = Number(amount || 0).toFixed(2);
      const upiUri = "upi://pay?pa=" + vpa + "&pn=" + encodeURIComponent(payee) + "&am=" + amtStr + "&cu=INR&tn=ChekOrganics%20Order";

      const intentLink = $("#upi-intent-link");
      if (intentLink) intentLink.href = upiUri;

      const qrTarget = $("#dynamic-qr-target");
      if (qrTarget) {
        qrTarget.innerHTML = "";
        try {
          if (typeof QRCode !== "undefined") {
            new QRCode(qrTarget, {
              text: upiUri,
              width: 140,
              height: 140,
              colorDark: "#0b2014",
              colorLight: "#ffffff",
              correctLevel: QRCode.CorrectLevel.M
            });
          }
        } catch (e) {}
      }
    }

    // Copy VPA button
    const copyVpaBtn = $("#btn-copy-vpa");
    if (copyVpaBtn) {
      copyVpaBtn.onclick = () => {
        if (navigator.clipboard) {
          navigator.clipboard.writeText("Q20988719@ybl").then(() => {
            copyVpaBtn.textContent = "Copied! ✓";
            toast("UPI ID copied: Q20988719@ybl");
            setTimeout(() => { copyVpaBtn.textContent = "Copy"; }, 2500);
          }).catch(() => {
            toast("UPI ID: Q20988719@ybl");
          });
        } else {
          toast("UPI ID: Q20988719@ybl");
        }
      };
    }

    // Dynamic 10-minute refresh timer
    let qrTimerSec = 600;
    const qrTimerEl = $("#upi-timer");
    if (qrTimerEl && !window.__upiQrTimerActive) {
      window.__upiQrTimerActive = true;
      setInterval(() => {
        if (qrTimerSec > 0) {
          qrTimerSec--;
          const m = String(Math.floor(qrTimerSec / 60)).padStart(2, "0");
          const s = String(qrTimerSec % 60).padStart(2, "0");
          qrTimerEl.textContent = m + ":" + s;
        } else {
          qrTimerSec = 600;
          renderSummary();
        }
      }, 1000);
    }

    // Toggle Mobile Order Summary
    const mobToggle = $("#mobile-summary-toggle");
    const sidebar = $("#checkout-sidebar");
    const mobToggleText = $("#mobile-toggle-text");
    if (mobToggle && sidebar) {
      mobToggle.onclick = () => {
        const isOpen = sidebar.classList.toggle("is-open");
        mobToggle.classList.toggle("is-open", isOpen);
        if (mobToggleText) mobToggleText.textContent = isOpen ? "Hide order summary" : "Show order summary";
      };
    }

    // PIN code auto lookup
    const pinInput = $("#addr-pincode");
    const cityInput = $("#addr-city");
    const stateSelect = $("#addr-state");
    const pinHint = $("#pin-hint");
    if (pinInput) {
      pinInput.oninput = () => {
        const val = pinInput.value.trim().replace(/\D/g, "");
        pinInput.value = val;
        if (val.length === 6) {
          const prefix3 = val.substring(0, 3);
          const match = PIN_MAP[prefix3];
          if (match) {
            if (cityInput && !cityInput.value) cityInput.value = match.city;
            if (stateSelect) stateSelect.value = match.state;
            if (pinHint) pinHint.textContent = `✓ ${match.city}, ${match.state}`;
          } else {
            if (pinHint) pinHint.textContent = "✓ PIN verified";
          }
        } else {
          if (pinHint) pinHint.textContent = "";
        }
      };
      // PIN chosen in the header's "Deliver to" (header.js)
      let savedPin = "";
      try { savedPin = localStorage.getItem("chek_delivery_pin") || ""; } catch (e) {}
      if (!pinInput.value && /^\d{6}$/.test(savedPin)) { pinInput.value = savedPin; pinInput.oninput(); }
    }

    // Address Type Chips
    $$("#addr-type-group .pill-btn").forEach(btn => {
      btn.onclick = () => {
        $$("#addr-type-group .pill-btn").forEach(b => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        selectedAddressType = btn.dataset.addrType;
      };
    });

    // Shipping selection
    $$("input[name='shipping_method']").forEach(radio => {
      radio.onchange = () => {
        selectedShipping = radio.value;
        $$(".shipping-option").forEach(card => card.classList.remove("is-selected"));
        radio.closest(".shipping-option").classList.add("is-selected");
        renderSummary();
      };
    });

    // Payment method accordion
    $$(".payment-method__head").forEach(head => {
      head.onclick = () => {
        const wrap = head.closest(".payment-method");
        const method = wrap.dataset.payMethod;
        selectedPayment = method;

        $$(".payment-method").forEach(m => {
          m.classList.remove("is-active");
          const b = m.querySelector(".payment-method__body");
          if (b) b.style.display = "none";
          const r = m.querySelector("input[name='payment_choice']");
          if (r) r.checked = false;
        });

        wrap.classList.add("is-active");
        const body = wrap.querySelector(".payment-method__body");
        if (body) body.style.display = "block";
        const radio = wrap.querySelector("input[name='payment_choice']");
        if (radio) radio.checked = true;

        renderSummary();
      };
    });

    // card / net banking need a payment gateway, which this static site does not have,
    // so checkout offers UPI (matched by UTR) and Cash on Delivery only

    // Coupon Apply & Chips
    function applyCoupon(code) {
      const clean = (code || "").trim().toUpperCase();
      if (!clean) return;
      if (VALID_COUPONS[clean]) {
        appliedCoupon = clean;
        const badge = $("#coupon-applied-badge");
        const badgeText = $("#coupon-applied-text");
        if (badge && badgeText) {
          badge.style.display = "flex";
          badgeText.innerHTML = `🎉 Coupon <b>${clean}</b> applied! (${VALID_COUPONS[clean].label})`;
        }
        toast("Coupon " + clean + " applied!");
        renderSummary();
      } else {
        toast("Invalid promo code. Try WELCOME10 or CHEK100");
      }
    }

    const applyCouponBtn = $("#btn-apply-coupon");
    const couponInput = $("#coupon-code-input");
    if (applyCouponBtn && couponInput) {
      applyCouponBtn.onclick = () => {
        applyCoupon(couponInput.value);
        couponInput.value = "";
      };
      couponInput.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          applyCoupon(couponInput.value);
          couponInput.value = "";
        }
      };
    }

    $$(".coupon-chip").forEach(chip => {
      chip.onclick = () => applyCoupon(chip.dataset.coupon);
    });

    const removeCouponBtn = $("#btn-remove-coupon");
    if (removeCouponBtn) {
      removeCouponBtn.onclick = () => {
        appliedCoupon = null;
        couponDiscount = 0;
        const badge = $("#coupon-applied-badge");
        if (badge) badge.style.display = "none";
        toast("Coupon removed");
        renderSummary();
      };
    }

    // Express checkout buttons
    $$("[data-express-pay]").forEach(btn => {
      btn.onclick = () => {
        const app = btn.dataset.expressPay;
        // set payment method to upi and scroll down to contact
        const upiHead = $("[data-pay-method='upi'] .payment-method__head");
        if (upiHead) upiHead.click();
        const mobInput = $("#cust-mobile");
        if (mobInput) {
          mobInput.focus();
          toast(`Selected ${app.toUpperCase()} · Please fill delivery details to complete order`);
        }
      };
    });

    // Handle Form Submit -> Realistic Gateway Flow
    form.onsubmit = (e) => {
      e.preventDefault();

      const items = Cart.items();
      if (!items.length) {
        toast("Your bag is empty");
        return;
      }

      const mobile = $("#cust-mobile")?.value.trim();
      const email = $("#cust-email")?.value.trim();
      const name = $("#cust-name")?.value.trim();
      const flat = $("#addr-flat")?.value.trim();
      const street = $("#addr-street")?.value.trim();
      const landmark = $("#addr-landmark")?.value.trim() || "";
      const pincode = $("#addr-pincode")?.value.trim();
      const city = $("#addr-city")?.value.trim();
      const state = $("#addr-state")?.value;
      const sendWhatsApp = $("#cust-whatsapp")?.checked;

      if (!mobile || mobile.length !== 10) {
        toast("Please enter a valid 10-digit mobile number");
        $("#cust-mobile")?.focus();
        return;
      }
      if (!pincode || pincode.length !== 6) {
        toast("Please enter a valid 6-digit PIN code");
        $("#addr-pincode")?.focus();
        return;
      }
      if (!name || !flat || !street || !city || !state) {
        toast("Please complete all required address fields");
        return;
      }
      // UPI payments are matched by hand against the bank statement using the 12-digit UTR
      const utr = ($("#upi-utr")?.value || "").replace(/\D/g, "");
      if (selectedPayment === "upi" && utr.length !== 12) {
        toast("Please pay via UPI and enter the 12-digit transaction ID (UTR)");
        $("#upi-utr")?.focus();
        return;
      }

      // Show authentic Payment Gateway Handshake Modal
      const overlay = $("#gateway-overlay");
      const titleEl = $("#gateway-status-title");
      const descEl = $("#gateway-status-desc");

      if (overlay) overlay.style.display = "grid";

      const subtotal = Cart.total();
      let shipFee = selectedShipping === "express" ? 149 : (subtotal >= FREE_SHIP ? 0 : 99);
      const totalAmount = Math.max(0, subtotal - couponDiscount + shipFee);

      // Time-based ID with a random suffix: a bare 5-digit number collides and is guessable,
      // and the tracker looks orders up by this ID
      const orderNum = "CHEK-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();

      // Estimated Delivery: 4 days from today
      const today = new Date();
      const deliveryDate = new Date(today);
      deliveryDate.setDate(today.getDate() + 4);
      const options = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
      const formattedEta = deliveryDate.toLocaleDateString("en-IN", options);

      setTimeout(() => {
        if (titleEl) titleEl.textContent = "Saving your order…";
        if (descEl) descEl.textContent = "Generating your order ID…";
      }, 700);

      setTimeout(() => {
        if (overlay) overlay.style.display = "none";

        // Save order to localStorage
        const orderData = {
          orderId: orderNum,
          date: new Date().toISOString(),
          customer: { name, mobile, email, sendWhatsApp },
          address: { flat, street, landmark, city, state, pincode, type: selectedAddressType },
          shipping: { method: selectedShipping, fee: shipFee, eta: formattedEta },
          // nothing on this page confirms a UPI/card transfer, so prepaid orders start unverified
          payment: Object.assign(
            { method: selectedPayment, total: totalAmount, status: selectedPayment === "cod" ? "cod" : "pending" },
            selectedPayment === "upi" ? { utr } : {}
          ),
          coupon: appliedCoupon,
          discount: couponDiscount,
          items: items.map(x => ({
            handle: x.product.handle,
            title: x.product.title,
            price: x.product.price,
            qty: x.qty,
            image: x.product.images[0]
          }))
        };

        // FirebaseDB.saveOrder keeps its own local backup, so only write here when it is absent
        if (window.FirebaseDB && window.FirebaseDB.saveOrder) {
          window.FirebaseDB.saveOrder(orderData);
        } else {
          try {
            const orders = JSON.parse(localStorage.getItem("chek_orders_v1")) || [];
            orders.unshift(orderData);
            localStorage.setItem("chek_orders_v1", JSON.stringify(orders));
          } catch (err) {}
        }

        // Clear user cart
        Cart.clear();

        // Render Order Confirmation
        renderConfirmation(orderData);

        // Smooth scroll to top
        window.scrollTo({ top: 0, behavior: "smooth" });
      }, 1500);
    };

    function renderConfirmation(order) {
      const formGrid = $("#checkout-main-grid");
      const confView = $("#order-confirmation");
      const stepsView = $(".checkout-steps");

      if (formGrid) formGrid.style.display = "none";
      if (confView) confView.style.display = "block";

      if (stepsView) {
        stepsView.innerHTML = `
          <span class="step step--done"><span class="step__num">✓</span> Bag</span>
          <span class="step__divider">›</span>
          <span class="step step--done"><span class="step__num">✓</span> Shipping</span>
          <span class="step__divider">›</span>
          <span class="step step--done"><span class="step__num">✓</span> Confirmed</span>
        `;
      }

      const confName = $("#conf-customer-name"); if (confName) confName.textContent = order.customer.name;
      const confId = $("#conf-order-id"); if (confId) confId.textContent = order.orderId;
      const confEta = $("#conf-delivery-date"); if (confEta) confEta.textContent = order.shipping.eta;

      const waNote = $("#conf-whatsapp-note");
      if (waNote) {
        waNote.innerHTML = `📦 Save your order ID <b>${esc(order.orderId)}</b> — track it any time from "Track Order" with this ID or <b>+91 ${esc(order.customer.mobile)}</b>.`;
      }

      // Address box
      const addrBox = $("#conf-address-box");
      if (addrBox) {
        addrBox.innerHTML = `
          <b>${esc(order.customer.name)} (${esc(order.address.type)})</b><br>
          ${esc(order.address.flat)}, ${esc(order.address.street)}<br>
          ${order.address.landmark ? esc(order.address.landmark) + "<br>" : ""}
          ${esc(order.address.city)}, ${esc(order.address.state)} — <b>${esc(order.address.pincode)}</b><br>
          📞 +91 ${esc(order.customer.mobile)}
        `;
      }

      // Payment box
      const payBox = $("#conf-payment-box");
      if (payBox) {
        let pLabel = "UPI" + (order.payment.utr ? " · UTR " + esc(order.payment.utr) : "");
        if (order.payment.method === "cod") pLabel = "Cash on Delivery (Pay upon delivery)";

        payBox.innerHTML = `
          <b>Payment Method:</b> ${pLabel}<br>
          <b>Status:</b> ${order.payment.method === "cod" ? "<span style='color:#c29a45'>Pending Doorstep Payment</span>" : "<span style='color:#c29a45'>Awaiting payment confirmation</span>"}<br>
          <b>Total Amount:</b> ${money(order.payment.total)}
        `;
      }

      // Ordered Items
      const itemsList = $("#conf-items-list");
      if (itemsList) {
        itemsList.innerHTML = order.items.map(it => {
          const t = splitTitle(it.title);
          return `
            <div class="receipt-item-row">
              <div style="display:flex;align-items:center;gap:0.7rem">
                <img src="${it.image}" alt="" style="width:38px;height:38px;border-radius:6px;object-fit:cover">
                <span><b>${esc(t.name)}</b> × ${it.qty}</span>
              </div>
              <b>${money(it.price * it.qty)}</b>
            </div>
          `;
        }).join("");
      }

      const confCount = $("#conf-items-count");
      if (confCount) confCount.textContent = order.items.reduce((s, x) => s + x.qty, 0);

      // Totals Box
      const totalsBox = $("#conf-totals-box");
      if (totalsBox) {
        const sub = order.items.reduce((s, x) => s + x.price * x.qty, 0);
        totalsBox.innerHTML = `
          <div style="display:flex;justify-content:space-between"><span>Subtotal:</span><span>${money(sub)}</span></div>
          ${order.discount ? `<div style="display:flex;justify-content:space-between;color:var(--leaf)"><span>Coupon Discount:</span><span>-${money(order.discount)}</span></div>` : ""}
          <div style="display:flex;justify-content:space-between"><span>Delivery:</span><span>${order.shipping.fee === 0 ? "FREE" : money(order.shipping.fee)}</span></div>
          <div style="display:flex;justify-content:space-between;font-weight:700;font-size:1.05rem;border-top:1px solid rgba(16,53,31,0.12);padding-top:0.4rem;margin-top:0.2rem">
            <span>Order Total:</span><span style="color:var(--forest)">${money(order.payment.total)}</span>
          </div>
        `;
      }
    }

    // Print Receipt button
    const printBtn = $("#btn-print-receipt");
    if (printBtn) {
      printBtn.onclick = () => window.print();
    }

    renderSummary();
  }

  /* ---------------------------------------------------------------- boot */
  renderSkeletons($("#icon-rail"), 8);
  renderSkeletons($("#shop-grid"), 8);

  document.addEventListener("DOMContentLoaded", () => {
    buildDrawer();
    buildRateModal();
    header();
    sync();
    rails();
    newsletter();
    heroSlider();
    homePage();
    shopPage();
    productPage();
    checkoutPage();
    paintSyncPill();
    reveal();
    document.body.classList.add("page-enter");

    const name = (location.pathname.split("/").pop() || "").replace(/\.html$/, "");
    const here = !name || name === "index" ? "./" : name;
    $$(".nav a, .mobile-nav a").forEach(a => { if (a.getAttribute("href") === here) a.setAttribute("aria-current", "page"); });

    // hydrate with the live products.json feed, then re-render
    refreshCatalog().then(() => { reveal(); });
    loadRemoteReviews().catch(() => {});
    loadProductOverrides().catch(() => {});
    setTimeout(refreshCatalog, 60000); // keep prices/stock fresh while the tab stays open
  });
})();
