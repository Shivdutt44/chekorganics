/* ==========================================================================
   CHEKORGANICS — Wishlist
   Header heart (with count) → wishlist drawer · heart on every product card
   image · "Add to wishlist" on the product page.
   Saved in this browser (localStorage), synced across open tabs.
   Load after app.js (cards are rendered by app.js; "Add to bag" uses its
   [data-add] handler).
   ========================================================================== */
(function () {
  "use strict";

  const KEY = "chek_wishlist_v1";
  const LIVE = "https://www.chekorganics.com";
  const MAX = 100;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = n => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  const snapshot = new Map(((window.STORE && window.STORE.products) || []).map(p => [p.handle, p]));

  const HEART = '<svg class="wl-heart" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 20.3s-7.4-4.5-9.3-9.2C1.4 7.8 3.4 4.5 6.8 4.5c2.1 0 3.6 1.2 5.2 3.1 1.6-1.9 3.1-3.1 5.2-3.1 3.4 0 5.4 3.3 4.1 6.6-1.9 4.7-9.3 9.2-9.3 9.2z"/></svg>';
  const CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

  function shortName(raw) {
    const t = String(raw || "").replace(/\s+/g, " ").trim();
    const m = t.match(/^(.{3,62}?)\s+[-–—]\s+(.+)$/);
    let name = m ? m[2] : t;
    if (name.includes("|")) {
      const head = name.split("|")[0].trim();
      if (head.length > 12) name = head;
    }
    return name || t;
  }

  /* ------------------------------------------------------------ storage */
  function read() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(v) ? v.filter(x => x && typeof x.h === "string") : [];
    } catch (e) {
      return [];
    }
  }
  function write(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch (e) { /* storage full or blocked */ }
  }
  const has = h => read().some(x => x.h === h);
  function toggle(h) {
    const list = read();
    const i = list.findIndex(x => x.h === h);
    if (i >= 0) list.splice(i, 1);
    else list.unshift({ h, t: Date.now() });
    write(list);
    paint();
    return i < 0; // true = now saved
  }
  function remove(h) {
    write(read().filter(x => x.h !== h));
    paint();
  }

  const info = h => {
    const p = snapshot.get(h);
    return p
      ? { handle: h, title: shortName(p.title), image: (p.images || [])[0] || null, price: p.price, compareAt: p.compareAt, available: p.available !== false }
      : { handle: h, title: h.replace(/-/g, " "), image: null, price: null, compareAt: null, available: null };
  };
  const live = new Map();
  function liveInfo(h) {
    if (!live.has(h)) {
      live.set(h, fetch(LIVE + "/products/" + encodeURIComponent(h) + ".js", { credentials: "omit" })
        .then(r => (r.ok ? r.json() : r.status === 404 ? { gone: true } : null))
        .then(j => {
          if (!j) return null;
          if (j.gone) return { gone: true };
          return {
            title: shortName(j.title),
            image: j.featured_image ? (j.featured_image.startsWith("//") ? "https:" + j.featured_image : j.featured_image) : null,
            price: j.price / 100,
            compareAt: j.compare_at_price && j.compare_at_price > j.price ? j.compare_at_price / 100 : null,
            available: !!j.available,
          };
        })
        .catch(() => null));
    }
    return live.get(h);
  }

  /* --------------------------------------------------------------- toast */
  let toastEl, toastTimer;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "wl-toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.innerHTML = HEART + "<span>" + esc(msg) + "</span>";
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 2200);
  }

  /* ------------------------------------------------- hearts on product cards */
  function decorateCards(root) {
    $$(".card:not(.card--skeleton)", root).forEach(card => {
      if ($(".card__wish", card)) return;
      const link = $(".card__media", card);
      const m = link && /[?&]p=([^&#]+)/.exec(link.getAttribute("href") || "");
      if (!m) return;
      const h = decodeURIComponent(m[1]);
      const name = (link.getAttribute("aria-label") || info(h).title).trim();
      const b = document.createElement("button");
      b.type = "button";
      b.className = "card__wish";
      b.dataset.wish = h;
      b.dataset.name = name;
      b.innerHTML = HEART;
      link.insertAdjacentElement("afterend", b);
    });
    paint();
  }

  /* ------------------------------------------------------- header button */
  function headerButton() {
    const actions = $(".header__actions");
    if (!actions || $(".wl-btn", actions)) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "icon-btn wl-btn";
    b.setAttribute("data-wishlist-open", "");
    b.setAttribute("aria-haspopup", "dialog");
    b.innerHTML = HEART + '<span class="cart-count wl-count" data-wishlist-count style="display:none">0</span>';
    const before = $(".acct-btn", actions) || $("[data-open-cart]", actions);
    actions.insertBefore(b, before || null);
  }

  /* ------------------------------------------------------- product page */
  function productButton() {
    const buy = $(".pdp__buy");
    if (!buy || $(".pdp-wish", buy)) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn--ghost pdp-wish";
    b.innerHTML = HEART + '<span class="pdp-wish__label">Add to wishlist</span>';
    buy.appendChild(b);
    const handle = () => {
      const add = $("#pdp-add");
      return (add && add.dataset.add) || new URLSearchParams(location.search).get("p") || "";
    };
    b.dataset.wish = handle();
    // app.js fills #pdp-add after it renders the product (and again after the live catalog sync)
    const add = $("#pdp-add");
    if (add) new MutationObserver(() => {
      b.dataset.wish = handle();
      paint();
    }).observe(add, { attributes: true, attributeFilter: ["data-add"] });
  }

  /* ----------------------------------------------------------- the drawer */
  let drawer, scrim, returnFocus = null;
  function buildDrawer() {
    scrim = document.createElement("div");
    scrim.className = "wl-scrim";
    drawer = document.createElement("aside");
    drawer.className = "wl-drawer";
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-modal", "true");
    drawer.setAttribute("aria-labelledby", "wl-title");
    drawer.innerHTML =
      '<div class="wl-drawer__head"><h3 id="wl-title">' + HEART + 'Wishlist <span data-wl-n></span></h3>' +
      '<button class="icon-btn" type="button" data-wl-close aria-label="Close wishlist">' + CLOSE + "</button></div>" +
      '<div class="wl-drawer__body" data-wl-body></div>' +
      '<p class="wl-drawer__note">Saved on this device. Add items to your bag when you\'re ready.</p>';
    document.body.append(scrim, drawer);
    scrim.addEventListener("click", closeDrawer);
    $("[data-wl-close]", drawer).addEventListener("click", closeDrawer);
    drawer.addEventListener("click", e => {
      const rm = e.target.closest("[data-wl-remove]");
      if (rm) {
        const h = rm.dataset.wlRemove;
        remove(h);
        toast("Removed from wishlist");
        renderDrawer();
        const next = $("[data-wl-remove]", drawer) || $("[data-wl-close]", drawer);
        next.focus({ preventScroll: true });
        return;
      }
      if (e.target.closest("[data-add]")) setTimeout(() => closeDrawer(false), 0); // app.js adds it and opens the bag
      if (e.target.closest("a[href]")) closeDrawer(false);
    });
    drawer.addEventListener("keydown", e => {
      if (e.key === "Escape") closeDrawer();
      else if (e.key === "Tab") {
        const f = $$("button:not([disabled]), a[href]", drawer);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
  }

  function openDrawer(from) {
    if (!drawer) buildDrawer();
    returnFocus = from || document.activeElement;
    renderDrawer();
    drawer.classList.add("is-open");
    scrim.classList.add("is-open");
    document.documentElement.classList.add("wl-lock");
    $("[data-wl-close]", drawer).focus({ preventScroll: true });
  }
  function closeDrawer(restore = true) {
    if (!drawer || !drawer.classList.contains("is-open")) return;
    drawer.classList.remove("is-open");
    scrim.classList.remove("is-open");
    document.documentElement.classList.remove("wl-lock");
    if (restore && returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
  }

  function priceHtml(x) {
    return x.price == null ? "" : '<span class="price">' + money(x.price) + (x.compareAt ? "<s>" + money(x.compareAt) + "</s>" : "") + "</span>";
  }

  function renderDrawer() {
    const list = read();
    $("[data-wl-n]", drawer).textContent = list.length ? "· " + list.length : "";
    const body = $("[data-wl-body]", drawer);
    if (!list.length) {
      body.innerHTML =
        '<div class="wl-empty">' + HEART + "<p><b>Your wishlist is empty</b><br>Tap the heart on any product to save it for later.</p>" +
        '<a class="btn btn--primary btn--sm" href="shop.html">Explore products</a></div>';
      return;
    }
    body.innerHTML = list
      .map(({ h }) => {
        const x = info(h);
        return (
          '<div class="wl-item" data-wl-item="' + esc(h) + '">' +
          '<a class="wl-item__img" href="product.html?p=' + encodeURIComponent(h) + '">' + (x.image ? '<img src="' + esc(x.image) + '" alt="" loading="lazy">' : "") + "</a>" +
          '<div class="wl-item__body"><a class="wl-item__name" href="product.html?p=' + encodeURIComponent(h) + '">' + esc(x.title) + "</a>" +
          '<div class="wl-item__price">' + priceHtml(x) + "</div>" +
          '<div class="wl-item__actions"><button class="btn btn--primary btn--sm" type="button" data-add="' + esc(h) + '"' + (x.available === false ? " disabled" : "") + ">" + (x.available === false ? "Sold out" : "Add to bag") + "</button>" +
          '<button class="wl-item__remove" type="button" data-wl-remove="' + esc(h) + '" aria-label="Remove ' + esc(x.title) + ' from wishlist">Remove</button></div></div></div>'
        );
      })
      .join("");
    // live price & stock from the store
    list.forEach(({ h }) =>
      liveInfo(h).then(lx => {
        const row = drawer && drawer.querySelector('[data-wl-item="' + CSS.escape(h) + '"]');
        if (!lx || !row) return;
        const add = $("[data-add]", row);
        if (lx.gone) {
          $(".wl-item__price", row).innerHTML = '<span class="wl-item__gone">No longer available</span>';
          add.disabled = true;
          add.textContent = "Unavailable";
          return;
        }
        const x = { ...info(h), ...lx, image: info(h).image || lx.image, title: snapshot.has(h) ? info(h).title : lx.title };
        $(".wl-item__price", row).innerHTML = priceHtml(x);
        $(".wl-item__name", row).textContent = x.title;
        if (!$(".wl-item__img img", row) && x.image) $(".wl-item__img", row).innerHTML = '<img src="' + esc(x.image) + '" alt="" loading="lazy">';
        add.disabled = !x.available;
        add.textContent = x.available ? "Add to bag" : "Sold out";
      })
    );
  }

  /* ---------------------------------------------------------------- paint */
  function paint() {
    const list = read();
    const saved = new Set(list.map(x => x.h));
    $$("[data-wish]").forEach(b => {
      const on = saved.has(b.dataset.wish);
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", String(on));
      const name = b.dataset.name || info(b.dataset.wish).title;
      b.setAttribute("aria-label", (on ? "Remove " : "Save ") + name + (on ? " from wishlist" : " to wishlist"));
      const label = $(".pdp-wish__label", b);
      if (label) label.textContent = on ? "Saved to wishlist" : "Add to wishlist";
    });
    $$("[data-wishlist-count]").forEach(c => {
      c.textContent = list.length;
      c.style.display = list.length ? "grid" : "none";
    });
    $$("[data-wishlist-open]").forEach(b => b.setAttribute("aria-label", "Wishlist" + (list.length ? ", " + list.length + (list.length === 1 ? " item" : " items") : ", empty")));
  }

  /* ---------------------------------------------------------------- boot */
  document.addEventListener("click", e => {
    const w = e.target.closest("[data-wish]");
    if (w) {
      e.preventDefault();
      e.stopPropagation();
      if (!w.dataset.wish) return;
      const saved = toggle(w.dataset.wish);
      w.classList.remove("pop");
      void w.offsetWidth;
      if (saved) w.classList.add("pop");
      toast(saved ? "Saved to wishlist" : "Removed from wishlist");
      if (drawer && drawer.classList.contains("is-open")) renderDrawer();
      return;
    }
    const open = e.target.closest("[data-wishlist-open]");
    if (open) {
      e.preventDefault();
      openDrawer(open);
    }
  }, true);

  window.addEventListener("storage", e => {
    if (e.key !== KEY) return;
    paint();
    if (drawer && drawer.classList.contains("is-open")) renderDrawer();
  });

  document.addEventListener("DOMContentLoaded", () => {
    headerButton();
    productButton();
    decorateCards(document);
    // app.js renders and re-renders product cards (skeletons → snapshot → live catalog)
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        decorateCards(document);
      });
    }).observe(document.body, { childList: true, subtree: true });
  });
})();
