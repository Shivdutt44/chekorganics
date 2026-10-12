/* ==========================================================================
   CHEKORGANICS — shared behaviour (cart, cards, rails, page renderers)
   ========================================================================== */
(function () {
  "use strict";

  const STORE = window.STORE || { products: [], collections: [] };
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const LIVE = "https://www.chekorganics.com";
  const money = n => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  const byHandle = h => STORE.products.find(p => p.handle === h);

  /* ---------------------------------------------------------------- titles */
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

  function stars(rating) {
    if (!rating) return "";
    const full = Math.round(rating);
    return '<span class="stars__glyphs" aria-hidden="true">' +
      "★".repeat(full) + "☆".repeat(5 - full) + "</span>";
  }

  function ratingHtml(p) {
    if (!p.rating) return '<span class="stars" style="opacity:.55">New in store</span>';
    return '<span class="stars">' + stars(p.rating) +
      "<span>" + p.rating.toFixed(1) + " · " + p.reviews +
      (p.reviews === 1 ? " review" : " reviews") + "</span></span>";
  }

  function cardHtml(p) {
    const t = splitTitle(p.title);
    const badge = p.compareAt
      ? '<span class="card__badge card__badge--sale">Sale</span>'
      : p.badge ? '<span class="card__badge">' + p.badge + "</span>" : "";
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
            '<span class="price">' + money(p.price) +
              (p.compareAt ? "<s>" + money(p.compareAt) + "</s>" : "") +
            "</span>" +
            '<button class="btn btn--primary btn--sm" type="button" data-add="' + p.handle + '">Add</button>' +
          "</div>" +
        "</div>" +
      "</article>"
    );
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderInto(el, list) {
    if (!el) return;
    el.innerHTML = list.map(cardHtml).join("");
  }

  /* ------------------------------------------------------------------ cart */
  const KEY = "chek_cart_v1";
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const write = c => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {} };

  const Cart = {
    items() {
      const c = read();
      return Object.keys(c)
        .map(h => ({ product: byHandle(h), qty: c[h] }))
        .filter(x => x.product && x.qty > 0);
    },
    count() { return this.items().reduce((n, x) => n + x.qty, 0); },
    total() { return this.items().reduce((n, x) => n + x.product.price * x.qty, 0); },
    add(handle, qty) {
      const c = read();
      c[handle] = (c[handle] || 0) + (qty || 1);
      write(c);
      sync();
      toast("Added to your bag · " + splitTitle(byHandle(handle).title).name);
      openDrawer();
    },
    set(handle, qty) {
      const c = read();
      if (qty <= 0) delete c[handle]; else c[handle] = qty;
      write(c);
      sync();
    },
    remove(handle) { this.set(handle, 0); },
    clear() { write({}); sync(); }
  };
  window.Cart = Cart;

  /* ------------------------------------------------------------ drawer UI */
  function buildDrawer() {
    const wrap = document.createElement("div");
    wrap.innerHTML =
      '<div class="overlay" data-close></div>' +
      '<aside class="drawer" aria-label="Shopping bag">' +
        '<div class="drawer__head"><h3>Your bag</h3>' +
          '<button class="icon-btn" type="button" data-close aria-label="Close bag">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
          "</button></div>" +
        '<div class="drawer__body"></div>' +
        '<div class="drawer__foot">' +
          '<div class="drawer__row"><span>Subtotal</span><b data-total>₹0</b></div>' +
          '<div class="drawer__row"><span>Shipping</span><span>Free over ₹3,000</span></div>' +
          '<p class="drawer__hint">This is a preview store — secure checkout &amp; COD run on the official CHEKORGANICS store.</p>' +
          '<a class="btn btn--primary btn--block" data-checkout href="' + LIVE + '/cart" target="_blank" rel="noopener">Checkout on chekorganics.com</a>' +
        "</div>" +
      "</aside>";
    document.body.appendChild(wrap);
    wrap.addEventListener("click", e => {
      if (e.target.closest("[data-close]")) closeDrawer();
      const add = e.target.closest("[data-plus]");
      const sub = e.target.closest("[data-minus]");
      const del = e.target.closest("[data-remove]");
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
      body.innerHTML = '<div class="drawer__empty"><p>Your bag is empty.</p>' +
        '<a class="btn btn--ghost btn--sm" href="shop.html">Explore the apothecary</a></div>';
    } else {
      body.innerHTML = items.map(({ product: p, qty }) =>
        '<div class="line-item">' +
          '<img src="' + p.images[0] + '" alt="">' +
          "<div><b>" + esc(splitTitle(p.title).name) + "</b>" +
            '<div class="qty"><button type="button" data-minus="' + p.handle + '" data-qty="' + qty + '">−</button>' +
            "<span>" + qty + "</span>" +
            '<button type="button" data-plus="' + p.handle + '" data-qty="' + qty + '">+</button></div>' +
          "</div>" +
          '<div class="line-item__right"><span class="price">' + money(p.price * qty) + "</span>" +
            '<button class="remove" type="button" data-remove="' + p.handle + '">Remove</button></div>' +
        "</div>").join("");
    }
    $("[data-total]").textContent = money(Cart.total());
    const href = items.length
      ? LIVE + "/cart/" + items.map(({ product: p, qty }) => p.id + ":" + qty).join(",")
      : LIVE + "/collections/all";
    $("[data-checkout]").href = href;
  }

  const openDrawer = () => { $(".drawer").classList.add("is-open"); $(".overlay").classList.add("is-open"); paintDrawer(); };
  const closeDrawer = () => { $(".drawer").classList.remove("is-open"); $(".overlay").classList.remove("is-open"); };

  function sync() {
    const n = Cart.count();
    $$("[data-cart-count]").forEach(el => { el.textContent = n; el.style.display = n ? "grid" : "none"; });
    paintDrawer();
  }

  /* ----------------------------------------------------------------- toast */
  let toastEl, toastTimer;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 2600);
  }

  /* -------------------------------------------------------------- delegation */
  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-add]");
    if (btn && btn.id !== "pdp-add") {
      e.preventDefault();
      Cart.add(btn.dataset.add, 1);
    }
    const cartBtn = e.target.closest("[data-open-cart]");
    if (cartBtn) { e.preventDefault(); openDrawer(); }
  });

  /* ---------------------------------------------------------------- header */
  function header() {
    const h = $(".header");
    if (h) {
      const onScroll = () => h.classList.toggle("is-stuck", window.scrollY > 12);
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
    }
    const burger = $("[data-burger]");
    const mnav = $(".mobile-nav");
    if (burger && mnav) {
      burger.addEventListener("click", () => mnav.classList.add("is-open"));
      const close = $("[data-burger-close]");
      if (close) close.addEventListener("click", () => mnav.classList.remove("is-open"));
      mnav.addEventListener("click", e => { if (e.target.tagName === "A") mnav.classList.remove("is-open"); });
    }
    document.addEventListener("keydown", e => { if (e.key === "Escape") { closeDrawer(); if (mnav) mnav.classList.remove("is-open"); } });
  }

  /* ---------------------------------------------------------------- reveal */
  function reveal() {
    const els = $$(".reveal");
    if (!("IntersectionObserver" in window)) { els.forEach(el => el.classList.add("is-in")); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en, i) => {
        if (en.isIntersecting) {
          setTimeout(() => en.target.classList.add("is-in"), (i % 6) * 70);
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px" });
    els.forEach(el => io.observe(el));
  }

  /* ----------------------------------------------------------------- rails */
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

  /* -------------------------------------------------------------- newsletter */
  function newsletter() {
    const form = $("#newsletter");
    if (!form) return;
    form.addEventListener("submit", e => {
      e.preventDefault();
      const coupon = $("#coupon");
      if (coupon) coupon.classList.add("is-on");
      form.reset();
      toast("Welcome! Code WELCOME10 unlocked.");
    });
  }

  /* ------------------------------------------------------------- home page */
  function homePage() {
    const cats = $("#cat-grid");
    if (cats) {
      cats.innerHTML = STORE.collections.map(c =>
        '<a class="cat reveal" href="shop.html?c=' + encodeURIComponent(c.title) + '">' +
          '<div class="cat__media"><img src="' + c.image + '" alt="' + esc(c.title) + '" loading="lazy" decoding="async"></div>' +
          '<div class="cat__body"><div><span>' + c.count + " products</span>" +
            "<h3>" + esc(c.title) + "</h3></div>" +
            '<span class="cat__arrow" aria-hidden="true">→</span></div>' +
        "</a>").join("");
    }

    const rail = $("#icon-rail");
    if (rail) renderInto(rail, STORE.products.slice(0, 20));

    const newest = $("#new-rail");
    if (newest) {
      const picks = STORE.products
        .filter(p => /sun|spf|kajal|body milk|amla|moringa/i.test(p.title))
        .slice(0, 8);
      renderInto(newest, picks.length >= 4 ? picks : STORE.products.slice(20, 28));
    }

    const reviews = $("#review-grid");
    if (reviews) {
      const REVIEWS = [
        { q: "I am using this oil and my hair is long and thick. My hairfall completely stopped — all the products of Chek Organics are very nice.", n: "Anonymous", d: "21 Sep 2026", s: 5 },
        { q: "Wonder oil. Has capabilities of pain relief and removal of dryness of skin.", n: "Anupama Pandey", d: "15 Aug 2026", s: 5 },
        { q: "It's a wonderful soap. Fresh peppermint smell — no need of any deodorants after the shower. A good exfoliator that keeps me fresh through the day.", n: "Rajesh", d: "05 Jun 2026", s: 5 },
        { q: "A proud customer of this beauty gem since a year now! No detanning services, no cleanup — this gem does the job all alone. Loved it.", n: "Taara", d: "02 Jun 2026", s: 5 },
        { q: "What should I say about this miracle Manjan. My mom went through a dental surgery and this worked as a miracle — gums tightened, sensitivity down.", n: "Taara", d: "02 Jun 2026", s: 5 },
        { q: "Noni juice is an amazing superfood. Consuming it for a few months and I feel energetic through the day. Strongly recommended to all age groups, especially 30+.", n: "Dr. John William", d: "20 May 2026", s: 5 },
        { q: "It's a very good lip balm, it really helps my lips by keeping them moisturised and smells very great.", n: "Ittukala Jashmitha", d: "05 May 2026", s: 5 },
        { q: "I've been a regular customer — skin care, hair care and noni juice. The quality has always stood out and the results feel genuine.", n: "Verified buyer", d: "22 May 2026", s: 5 },
        { q: "I finished my first order and had to place another. As an interior designer my full day is spent in dust — I am simply in love with ChekOrganics.", n: "Vmsharitha", d: "25 May 2026", s: 5 }
      ];
      reviews.innerHTML = REVIEWS.map(r =>
        '<article class="review reveal"><span class="stars__glyphs">★★★★★</span>' +
        "<p>“" + esc(r.q) + "”</p>" +
        "<footer><b>" + esc(r.n) + "</b><span>" + r.d + "</span></footer></article>").join("");
    }
  }

  /* -------------------------------------------------------------- shop page */
  function shopPage() {
    const grid = $("#shop-grid");
    if (!grid) return;

    const params = new URLSearchParams(location.search);
    const state = { c: params.get("c") || "All Products", q: "", sort: "featured" };

    const chips = $("#chips");
    const all = [{ title: "All Products", count: STORE.products.length }].concat(STORE.collections);
    chips.innerHTML = all.map(c =>
      '<button class="chip' + (c.title === state.c ? " is-active" : "") + '" type="button" data-col="' + esc(c.title) + '">' +
      esc(c.title) + ' <span style="opacity:.55">(' + c.count + ")</span></button>").join("");

    const countEl = $("#result-count");
    const search = $("#shop-search");
    const sort = $("#shop-sort");

    function apply() {
      let list = STORE.products.slice();
      if (state.c && state.c !== "All Products") list = list.filter(p => p.collections.includes(state.c));
      if (state.q) {
        const q = state.q.toLowerCase();
        list = list.filter(p =>
          p.title.toLowerCase().includes(q) ||
          p.type.toLowerCase().includes(q) ||
          p.collections.join(" ").toLowerCase().includes(q) ||
          p.tags.join(" ").toLowerCase().includes(q));
      }
      if (state.sort === "price-asc") list.sort((a, b) => a.price - b.price);
      if (state.sort === "price-desc") list.sort((a, b) => b.price - a.price);
      if (state.sort === "rating") list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      if (state.sort === "name") list.sort((a, b) => a.title.localeCompare(b.title));

      renderInto(grid, list);
      countEl.textContent = list.length + (list.length === 1 ? " product" : " products");
      const empty = $("#empty");
      if (empty) empty.style.display = list.length ? "none" : "block";
      const heading = $("#active-col");
      if (heading) heading.textContent = state.c;
      $$(".chip", chips).forEach(ch => ch.classList.toggle("is-active", ch.dataset.col === state.c));
    }

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

    apply();
  }

  /* ---------------------------------------------------------- product page */
  function productPage() {
    const root = $("#pdp");
    if (!root) return;
    const handle = new URLSearchParams(location.search).get("p") || STORE.products[0].handle;
    const p = byHandle(handle) || STORE.products[0];
    const t = splitTitle(p.title);

    document.title = t.name + " — CHEKORGANICS";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", p.excerpt || document.title);

    const main = $("#gallery-main");
    const thumbs = $("#gallery-thumbs");
    main.src = p.images[0];
    main.alt = t.name;
    thumbs.innerHTML = p.images.map((src, i) =>
      '<button type="button" class="' + (i === 0 ? "is-active" : "") + '" data-shot="' + i + '">' +
      '<img src="' + src + '" alt="' + esc(t.name) + " view " + (i + 1) + '"></button>').join("");
    thumbs.addEventListener("click", e => {
      const b = e.target.closest("[data-shot]");
      if (!b) return;
      main.src = p.images[+b.dataset.shot];
      $$("button", thumbs).forEach(x => x.classList.toggle("is-active", x === b));
    });

    $("#pdp-eyebrow").textContent = p.primaryCollection + (p.type ? " · " + p.type : "");
    $("#pdp-title").textContent = t.name;
    $("#pdp-rating").innerHTML = ratingHtml(p);
    $("#pdp-price").innerHTML = money(p.price) + (p.compareAt ? "<s>" + money(p.compareAt) + "</s>" : "");
    const save = $("#pdp-save");
    if (p.compareAt) { save.style.display = "inline-block"; save.textContent = "Save " + money(p.compareAt - p.price); }
    $("#pdp-benefit").textContent = t.benefit || p.excerpt.slice(0, 90);
    $("#pdp-desc").textContent = p.excerpt || "Handcrafted in small batches on our own farm in Telangana, using Ayurvedic wisdom and Noni grown, certified and processed by CHEKORGANICS.";
    $("#pdp-tags").innerHTML = p.collections.map(c => '<span class="tag">' + esc(c) + "</span>").join("") +
      p.tags.slice(0, 6).map(x => '<span class="tag">' + esc(x) + "</span>").join("");

    const qty = $("#qty");
    $("#qty-minus").addEventListener("click", () => { qty.value = Math.max(1, (+qty.value || 1) - 1); });
    $("#qty-plus").addEventListener("click", () => { qty.value = Math.min(99, (+qty.value || 1) + 1); });

    const addBtn = $("#pdp-add");
    addBtn.dataset.add = p.handle;
    addBtn.addEventListener("click", () => Cart.add(p.handle, Math.max(1, +qty.value || 1)));

    const buy = $("#pdp-buy");
    buy.href = LIVE + "/products/" + p.handle;
    const crumb = $("#pdp-crumb");
    if (crumb) crumb.textContent = t.name;

    const related = $("#related-grid");
    if (related) {
      const rel = STORE.products.filter(x => x.handle !== p.handle && x.collections.some(c => p.collections.includes(c)));
      renderInto(related, (rel.length >= 4 ? rel : STORE.products.filter(x => x.handle !== p.handle)).slice(0, 4));
    }
  }

  /* ------------------------------------------------------------------ boot */
  document.addEventListener("DOMContentLoaded", () => {
    buildDrawer();
    header();
    sync();
    rails();
    newsletter();
    homePage();
    shopPage();
    productPage();
    reveal();
    // mark current nav link
    const here = location.pathname.split("/").pop() || "index.html";
    $$(".nav a, .mobile-nav a").forEach(a => {
      if (a.getAttribute("href") === here) a.setAttribute("aria-current", "page");
    });
  });
})();
