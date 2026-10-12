/* ==========================================================================
   CHEKORGANICS — app shell
   Live catalog (products.json) · cart · rails · React-like page transitions
   ========================================================================== */
(function () {
  "use strict";

  /* ------------------------------------------------------------ catalog */
  const LOCAL = window.STORE || { products: [], collections: [] };
  let STORE = LOCAL;                 // working catalog — local first for instant paint
  let SOURCE = "local";              // local | live | cached
  let SYNCED_AT = null;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const LIVE = "https://www.chekorganics.com";
  const FREE_SHIP = 3000;
  const money = n => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  const byHandle = h => STORE.products.find(p => p.handle === h);
  const localByHandle = h => LOCAL.products.find(p => p.handle === h);

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

  function stars(rating) {
    if (!rating) return "";
    const full = Math.round(rating);
    return '<span class="stars__glyphs" aria-hidden="true">' + "★".repeat(full) + "☆".repeat(5 - full) + "</span>";
  }

  function ratingHtml(p) {
    if (!p.rating) return '<span class="stars" style="opacity:.55">Loved by 10,000+ customers</span>';
    return '<span class="stars">' + stars(p.rating) +
      "<span>" + p.rating.toFixed(1) + " · " + p.reviews + (p.reviews === 1 ? " review" : " reviews") + "</span></span>";
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
    const ratings = Object.fromEntries(LOCAL.products.filter(p => p.rating).map(p => [p.handle, { rating: p.rating, reviews: p.reviews }]));
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
      const r = ratings[p.handle] || {};
      const cols = colsOf[p.handle] || ["All Products"];
      const title = clean(p.title);
      let badge = null;
      if (r.reviews >= 4) badge = "Bestseller";
      else if (/launch|spf|new/i.test(title)) badge = "New launch";
      return {
        id: p.id, title, handle: p.handle, price,
        compareAt: cmp && cmp > price ? cmp : null,
        images: images.length ? images : (keep ? keep.images : []),
        type: p.product_type || "", tags: p.tags || [],
        collections: cols,
        primaryCollection: cols.find(c => c !== "All Products") || "All Products",
        excerpt: keep ? keep.excerpt : "",
        rating: r.rating || null, reviews: r.reviews || 0,
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
          const changed = norm.products.length !== STORE.products.length ||
            norm.products.some((p, i) => STORE.products[i] && STORE.products[i].price !== p.price);
          STORE = { products: norm.products, collections: norm.collections.length ? norm.collections : LOCAL.collections };
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
    remove(handle) { this.set(handle, 0); }
  };
  window.Cart = Cart;

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
          '<p class="drawer__hint">Preview bag — secure checkout, COD and discounts run on the official CHEKORGANICS store.</p>' +
          '<a class="btn btn--primary btn--block" data-checkout href="' + LIVE + '/collections/all" target="_blank" rel="noopener">Checkout on chekorganics.com</a>' +
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

    const href = items.length
      ? LIVE + "/cart/" + items.map(({ product: p, qty }) => p.id + ":" + qty).join(",")
      : LIVE + "/collections/all";
    $("[data-checkout]").href = href;
    $("[data-checkout]").textContent = items.length ? "Checkout " + money(total) + " on chekorganics.com" : "Continue on chekorganics.com";
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
    const burger = $("[data-burger]"), mnav = $(".mobile-nav");
    if (burger && mnav) {
      burger.addEventListener("click", () => mnav.classList.add("is-open"));
      const close = $("[data-burger-close]");
      if (close) close.addEventListener("click", () => mnav.classList.remove("is-open"));
      mnav.addEventListener("click", e => { if (e.target.tagName === "A") mnav.classList.remove("is-open"); });
    }
    document.addEventListener("keydown", e => { if (e.key === "Escape") { closeDrawer(); if (mnav) mnav.classList.remove("is-open"); } });

    // prefetch internal pages on hover → navigation feels instant (React-like)
    const prefetched = new Set();
    document.addEventListener("pointerenter", e => {
      const a = e.target.closest && e.target.closest('a[href^="shop.html"], a[href^="product.html"], a[href^="index.html"]');
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
    const els = $$(".reveal");
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
          '<div class="cat__body"><div><span>' + c.count + " products</span><h3>" + esc(c.title) + "</h3></div>" +
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
        { q: "I am using this oil and my hair is long and thick. My hairfall completely stopped — all the products of Chek Organics are very nice.", n: "Anonymous", d: "21 Sep 2026" },
        { q: "Wonder oil. Has capabilities of pain relief and removal of dryness of skin.", n: "Anupama Pandey", d: "15 Aug 2026" },
        { q: "It's a wonderful soap. Fresh peppermint smell — no need of any deodorants after the shower. A good exfoliator that keeps me fresh through the day.", n: "Rajesh", d: "05 Jun 2026" },
        { q: "A proud customer of this beauty gem since a year now! No detanning services, no cleanup — this gem does the job all alone. Loved it.", n: "Taara", d: "02 Jun 2026" },
        { q: "What should I say about this miracle Manjan. My mom went through a dental surgery and this worked as a miracle — gums tightened, sensitivity down.", n: "Taara", d: "02 Jun 2026" },
        { q: "Noni juice is an amazing superfood. Consuming it for a few months and I feel energetic through the day. Strongly recommended to all age groups, especially 30+.", n: "Dr. John William", d: "20 May 2026" },
        { q: "It's a very good lip balm, it really helps my lips by keeping them moisturised and smells very great.", n: "Ittukala Jashmitha", d: "05 May 2026" },
        { q: "I've been a regular customer — skin care, hair care and noni juice. The quality has always stood out and the results feel genuine.", n: "Verified buyer", d: "22 May 2026" },
        { q: "I finished my first order and had to place another. As an interior designer my full day is spent in dust — I am simply in love with ChekOrganics.", n: "Vmsharitha", d: "25 May 2026" }
      ];
      reviews.innerHTML = REVIEWS.map(r =>
        '<article class="review reveal"><span class="stars__glyphs">★★★★★</span><p>“' + esc(r.q) + "”</p>" +
        "<footer><b>" + esc(r.n) + "</b><span>" + r.d + "</span></footer></article>").join("");
    }
  }

  /* ----------------------------------------------------------- shop page */
  function shopPage() {
    const grid = $("#shop-grid");
    if (!grid) return;
    const params = new URLSearchParams(location.search);
    window.__shopState = window.__shopState || { c: params.get("c") || "All Products", q: "", sort: "featured" };
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
      const heading = $("#active-col"); if (heading) heading.textContent = state.c;
    }

    if (!grid.dataset.bound) {
      grid.dataset.bound = "1";
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
    const handle = new URLSearchParams(location.search).get("p") || (STORE.products[0] && STORE.products[0].handle);
    const p = byHandle(handle) || STORE.products[0];
    if (!p) return;
    const t = splitTitle(p.title);
    pushRecent(p.handle);

    document.title = t.name + " — CHEKORGANICS";
    const meta = document.querySelector('meta[name="description"]');
    if (meta && p.excerpt) meta.setAttribute("content", p.excerpt);

    const main = $("#gallery-main"), thumbs = $("#gallery-thumbs");
    main.src = p.images[0]; main.alt = t.name;
    thumbs.innerHTML = p.images.map((src, i) =>
      '<button type="button" class="' + (i === 0 ? "is-active" : "") + '" data-shot="' + i + '" aria-label="View image ' + (i + 1) + '">' +
      '<img src="' + src + '" alt="' + esc(t.name) + " view " + (i + 1) + '"></button>').join("");

    $("#pdp-eyebrow").textContent = p.primaryCollection + (p.type ? " · " + p.type : "");
    $("#pdp-title").textContent = t.name;
    $("#pdp-rating").innerHTML = ratingHtml(p) +
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

    $("#pdp-buy").href = LIVE + "/products/" + p.handle;
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
          '<a class="icon-btn" data-sticky-buy-now target="_blank" rel="noopener" aria-label="Buy now on chekorganics.com">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 7h12l1 13H5L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg></a>' +
        "</div>";
      document.body.appendChild(bar);
    }
    $("[data-sticky-img]").src = p.images[0];
    $("[data-sticky-title]").textContent = t.name;
    $("[data-sticky-price]").textContent = money(p.price);
    $("[data-sticky-buy-now]").href = LIVE + "/products/" + p.handle;
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

  /* ---------------------------------------------------------------- boot */
  renderSkeletons($("#icon-rail"), 8);
  renderSkeletons($("#shop-grid"), 8);

  document.addEventListener("DOMContentLoaded", () => {
    buildDrawer();
    header();
    sync();
    rails();
    newsletter();
    heroSlider();
    homePage();
    shopPage();
    productPage();
    paintSyncPill();
    reveal();
    document.body.classList.add("page-enter");

    const here = location.pathname.split("/").pop() || "index.html";
    $$(".nav a, .mobile-nav a").forEach(a => { if (a.getAttribute("href") === here) a.setAttribute("aria-current", "page"); });

    // hydrate with the live products.json feed, then re-render
    refreshCatalog().then(() => { reveal(); });
    setTimeout(refreshCatalog, 60000); // keep prices/stock fresh while the tab stays open
  });
})();
