/* ==========================================================================
   CHEKORGANICS — Amazon-style header behaviour (header.css)
   Deliver-to PIN, search with category + live suggestions, account greeting,
   Returns & Orders, and the "All" side menu. Cart, account popover, wishlist
   and the menu open/close keep using the existing hooks (data-open-cart,
   data-account, data-wishlist-open, data-burger) handled by app.js / ux.js /
   wishlist.js. Load after app.js.
   ========================================================================== */
(function () {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = n => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  const PIN_KEY = "chek_delivery_pin"; // also read by checkout to prefill the PIN code

  // the storefront's working catalog (admin edits applied, hidden products removed)
  const products = () => (window.ChekCatalog && window.ChekCatalog.products()) || (window.STORE && window.STORE.products) || [];
  const collections = () => ((window.ChekCatalog && window.ChekCatalog.collections()) || (window.STORE && window.STORE.collections) || []).map(c => c.title);

  /* ------------------------------------------------------------ deliver to */
  const readPin = () => { try { return localStorage.getItem(PIN_KEY) || ""; } catch (e) { return ""; } };

  function paintLocation() {
    const pin = readPin();
    $$("[data-loc-line1]").forEach(el => (el.textContent = pin ? "Delivering to " + pin : "Delivering across India"));
    $$("[data-loc-line2]").forEach(el => (el.textContent = pin ? "Update location" : "Enter your PIN code"));
  }

  let locPop, locScrim, locTrigger;
  function buildLocationPopover() {
    locScrim = document.createElement("div");
    locScrim.className = "amz-loc-scrim";
    locScrim.hidden = true;
    locPop = document.createElement("div");
    locPop.className = "amz-loc-pop";
    locPop.hidden = true;
    locPop.setAttribute("role", "dialog");
    locPop.setAttribute("aria-modal", "true");
    locPop.setAttribute("aria-labelledby", "amz-loc-title");
    locPop.innerHTML =
      '<div class="amz-loc-pop__head"><span id="amz-loc-title">Choose your location</span>' +
        '<button type="button" data-loc-close aria-label="Close">✕</button></div>' +
      '<form class="amz-loc-pop__body" data-loc-form>' +
        "Delivery options and speeds vary by location. Enter the 6-digit PIN code you want your order delivered to." +
        '<div class="amz-loc-pop__row">' +
          '<input type="text" inputmode="numeric" maxlength="6" placeholder="e.g. 500001" aria-label="PIN code" data-loc-input>' +
          '<button type="submit">Apply</button>' +
        "</div>" +
        '<p class="amz-loc-pop__err" data-loc-err aria-live="polite"></p>' +
        '<p class="amz-loc-pop__note">Free shipping on orders above ₹3,000 · standard delivery in 3–5 business days.</p>' +
      "</form>";
    document.body.append(locScrim, locPop);

    locScrim.addEventListener("click", closeLocation);
    $("[data-loc-close]", locPop).addEventListener("click", closeLocation);
    $("[data-loc-input]", locPop).addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); });
    $("[data-loc-form]", locPop).addEventListener("submit", e => {
      e.preventDefault();
      const pin = $("[data-loc-input]", locPop).value;
      if (!/^[1-9]\d{5}$/.test(pin)) { $("[data-loc-err]", locPop).textContent = "Please enter a valid 6-digit PIN code."; return; }
      try { localStorage.setItem(PIN_KEY, pin); } catch (err) {}
      paintLocation();
      closeLocation();
      window.dispatchEvent(new CustomEvent("chek:pin-changed", { detail: { pin } })); // PDP delivery estimate
    });
  }

  function openLocation(trigger) {
    if (!locPop) buildLocationPopover();
    locTrigger = trigger;
    $("[data-loc-input]", locPop).value = readPin();
    $("[data-loc-err]", locPop).textContent = "";
    // under the button on desktop, centred on phones
    if (window.innerWidth >= 768 && trigger) {
      const r = trigger.getBoundingClientRect();
      locPop.style.top = Math.round(r.bottom + 8) + "px";
      locPop.style.left = Math.round(Math.max(16, Math.min(window.innerWidth - 376, r.left))) + "px";
      locPop.style.transform = "";
    } else {
      locPop.style.top = "50%";
      locPop.style.left = "50%";
      locPop.style.transform = "translate(-50%, -50%)";
    }
    locScrim.hidden = false;
    locPop.hidden = false;
    setTimeout(() => $("[data-loc-input]", locPop).focus(), 30);
  }

  function closeLocation() {
    if (!locPop || locPop.hidden) return;
    locPop.hidden = true;
    locScrim.hidden = true;
    if (locTrigger) locTrigger.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------------- search */
  function setupSearch() {
    const form = $("[data-amz-search]");
    if (!form) return;
    const input = $("[data-amz-q]", form);
    const select = $("[data-amz-cat]", form);
    const label = $("[data-amz-cat-label]", form);
    const box = $("[data-amz-suggest]", form);

    // categories + current filters from the URL (shop page)
    const params = new URLSearchParams(location.search);
    select.innerHTML = '<option value="">All</option>' + collections().map(c => '<option value="' + esc(c) + '">' + esc(c) + "</option>").join("");
    if (params.get("c") && collections().includes(params.get("c"))) select.value = params.get("c");
    if (params.get("q")) input.value = params.get("q");
    const paintLabel = () => { label.textContent = select.value || "All"; };
    paintLabel();
    select.addEventListener("change", () => { paintLabel(); input.focus(); suggest(); });

    let active = -1;
    function items() { return $$(".amz-suggest__item", box); }
    function close() { box.hidden = true; active = -1; input.setAttribute("aria-expanded", "false"); }

    function suggest() {
      const q = input.value.trim().toLowerCase();
      if (!q) { close(); return; }
      const cat = select.value;
      const words = q.split(/\s+/);
      const hits = products()
        .filter(p => !cat || (p.collections || []).includes(cat))
        .map(p => {
          const hay = (p.title + " " + (p.type || "") + " " + (p.tags || []).join(" ")).toLowerCase();
          if (!words.every(w => hay.includes(w))) return null;
          return { p, score: p.title.toLowerCase().indexOf(words[0]) };
        })
        .filter(Boolean)
        .sort((a, b) => (a.score < 0) - (b.score < 0) || a.score - b.score)
        .slice(0, 7);

      const mark = t => esc(t).replace(new RegExp("(" + words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "gi"), "<mark>$1</mark>");
      box.innerHTML = (hits.length
        ? hits.map(({ p }) =>
            '<a class="amz-suggest__item" role="option" href="product.html?p=' + encodeURIComponent(p.handle) + '">' +
              '<img src="' + esc((p.images || [])[0] || "assets/brand/logo.webp") + '" alt="" loading="lazy">' +
              "<span>" + mark(p.title) + "</span><small>" + money(p.price) + "</small></a>"
          ).join("")
        : '<div class="amz-suggest__empty">No products match “' + esc(input.value.trim()) + "”" + (cat ? " in " + esc(cat) : "") + "</div>") +
        '<a class="amz-suggest__item amz-suggest__all" role="option" href="' + resultsUrl() + '">See all results for “' + esc(input.value.trim()) + "”" + (cat ? " in " + esc(cat) : "") + "</a>";
      box.hidden = false;
      active = -1;
      input.setAttribute("aria-expanded", "true");
    }

    function resultsUrl() {
      const u = new URLSearchParams();
      if (input.value.trim()) u.set("q", input.value.trim());
      if (select.value) u.set("c", select.value);
      const qs = u.toString();
      return "shop.html" + (qs ? "?" + qs : "");
    }

    input.addEventListener("input", suggest);
    input.addEventListener("focus", () => { if (input.value.trim()) suggest(); });
    input.addEventListener("keydown", e => {
      const list = items();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (box.hidden || !list.length) return;
        e.preventDefault();
        active = (active + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
        list.forEach((el, i) => el.classList.toggle("is-active", i === active));
        list[active].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && active >= 0 && list[active]) {
        e.preventDefault();
        location.href = list[active].getAttribute("href");
      } else if (e.key === "Escape") {
        close();
      }
    });
    document.addEventListener("click", e => { if (!form.contains(e.target)) close(); });

    // search results are the shop page, filtered by ?q= and ?c=
    form.addEventListener("submit", e => {
      e.preventDefault();
      close();
      location.href = resultsUrl();
    });
  }

  /* --------------------------------------------------------------- account */
  function paintAccount(user) {
    const first = user ? String(user.displayName || (user.email || "").split("@")[0] || "there").split(" ")[0] : "";
    $$("[data-hello]").forEach(el => (el.textContent = user ? "Hello, " + first : "Hello, sign in"));
    $$("[data-acct-mobile]").forEach(el => (el.textContent = user ? first + " ›" : "Sign in ›"));
  }

  /* ------------------------------------------------------------------ boot */
  function init() {
    if (!$(".amz-header")) return;
    paintLocation();
    setupSearch();

    document.addEventListener("click", e => {
      const loc = e.target.closest("[data-loc-open]");
      if (loc) { e.preventDefault(); openLocation(loc); return; }

      // Returns & Orders: signed in → account with order history, otherwise order tracking
      const orders = e.target.closest("[data-amz-orders]");
      if (orders) {
        e.preventDefault();
        const signedIn = window.FirebaseDB && window.FirebaseDB.getCurrentUser && window.FirebaseDB.getCurrentUser();
        if (window.openAuth) window.openAuth(signedIn ? undefined : "track");
      }

      // the "All" drawer: close on the backdrop, and after any button inside it
      const drawer = $(".mobile-nav.amz-drawer.is-open");
      if (drawer && (e.target === drawer || (e.target.closest("button") && drawer.contains(e.target) && !e.target.closest("[data-burger-close]")))) {
        drawer.classList.remove("is-open");
      }
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeLocation(); });

    paintAccount(null);
    if (window.FirebaseDB && window.FirebaseDB.onAuthStateChanged) window.FirebaseDB.onAuthStateChanged(paintAccount);

    // "Today's Deals" only while some product has a compare-at price (set in the admin portal);
    // re-checked once the live catalog and admin edits have loaded
    const paintDeals = () => {
      const any = products().some(p => p.compareAt && p.compareAt > p.price);
      $$('a[href="shop.html?deals=1"]').forEach(a => { a.hidden = !any; });
    };
    paintDeals();
    setTimeout(paintDeals, 3000);

    // mark the current category in the bar
    const here = location.pathname.split("/").pop() + location.search;
    $$(".amz-nav__links a").forEach(a => { if (a.getAttribute("href") === here) a.setAttribute("aria-current", "page"); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
