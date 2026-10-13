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
        '<button type="button" data-loc-close aria-label="Close"><svg class="ico ico--xs" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>' +
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

  /* ------------------------------------------------------------- mega menu */
  const COLLECTIONS_DATA = [
    {
      name: "Superfoods",
      url: "shop.html?c=Superfoods",
      image: "assets/products/chekorganics-noni-fruit-juice-ayush-certified-ayurvedic-wellness-elixir-0.webp",
      count: "6 Remedies",
      badge: "AYUSH Certified",
      tagline: "Immunity & Detox",
      top: [
        { name: "Pure Noni Fruit Juice 800ml (AYUSH)", url: "product.html?p=chekorganics-noni-fruit-juice-ayush-certified-ayurvedic-wellness-elixir" },
        { name: "Organic Spirulina Powder (100g)", url: "shop.html?c=Superfoods" },
        { name: "Organic Moringa Powder (100g)", url: "shop.html?c=Superfoods" }
      ]
    },
    {
      name: "Haircare",
      url: "shop.html?c=Haircare",
      image: "assets/products/chekorganics-bodyhues-noni-herbal-hair-oil-200ml-0.webp",
      count: "9 Remedies",
      badge: "Bestseller",
      tagline: "Fall Control & Dandruff",
      top: [
        { name: "Noni Herbal Hair Oil 200ml", url: "product.html?p=chekorganics-bodyhues-noni-herbal-hair-oil-200ml" },
        { name: "Noni Herbal Shampoo 500ml", url: "product.html?p=noni-herbal-shampoo-500ml" },
        { name: "Noni Herbal Shampoo 200ml", url: "shop.html?c=Haircare" }
      ]
    },
    {
      name: "Skin Care",
      url: "shop.html?c=Skin%20Care",
      image: "assets/products/chekorganics-bodyhues-noni-herbal-bath-powder-250g-0.webp",
      count: "7 Remedies",
      badge: "100% Herbal",
      tagline: "Radiance & Glow",
      top: [
        { name: "Noni Herbal Bath Powder (Ubtan)", url: "product.html?p=chekorganics-bodyhues-noni-herbal-bath-powder-250g" },
        { name: "Organic Noni Body Butter 100g", url: "shop.html?c=Skin%20Care" },
        { name: "Taruna Gulab Body Milk 250g", url: "shop.html?c=Skin%20Care" }
      ]
    },
    {
      name: "Handmade Soaps",
      url: "shop.html?c=Handmade%20Soaps",
      image: "assets/products/chekorganics-bodyhues-noni-turmeric-soap-100gm-0.webp",
      count: "5 Remedies",
      badge: "Cold-Pressed",
      tagline: "Gentle Herbal Cleansing",
      top: [
        { name: "Noni Turmeric Soap (100g)", url: "shop.html?c=Handmade%20Soaps" },
        { name: "Pulpy Papaya De-Tan Bar", url: "shop.html?c=Handmade%20Soaps" },
        { name: "Pure Noni Fruit Bath Bar", url: "shop.html?c=Handmade%20Soaps" }
      ]
    },
    {
      name: "Moisturisers",
      url: "shop.html?c=Moisturisers",
      image: "assets/products/chekorganics-bodyhues-organic-noni-body-butter-50g-copy-0.webp",
      count: "5 Remedies",
      badge: "Deep Hydration",
      tagline: "Nourishing Body Butters",
      top: [
        { name: "Organic Noni Body Butter 100g", url: "shop.html?c=Moisturisers" },
        { name: "Organic Noni Body Butter 50g", url: "shop.html?c=Moisturisers" },
        { name: "Taruna Gulab Body Milk 250g", url: "shop.html?c=Moisturisers" }
      ]
    },
    {
      name: "Men's Grooming",
      url: "shop.html?c=Men%27s%20Grooming",
      image: "assets/products/chekorganics-bodyhues-instarang-noni-herbal-hair-color-0.webp",
      count: "5 Remedies",
      badge: "Active Care",
      tagline: "Beard & Hair Styling",
      top: [
        { name: "Men Hair & Beard Styling Cream", url: "shop.html?c=Men%27s%20Grooming" },
        { name: "Men DUDE Herbal Shampoo 100ml", url: "shop.html?c=Men%27s%20Grooming" },
        { name: "Instarang Natural Black Color", url: "shop.html?c=Men%27s%20Grooming" }
      ]
    },
    {
      name: "Herbal Hair Colours",
      url: "shop.html?c=Herbal%20Hair%20Colours",
      image: "assets/products/chekorganics-bodyhues-instarang-noni-herbal-hair-color-0.webp",
      count: "3 Remedies",
      badge: "Zero Chemical",
      tagline: "Natural Black & Henna",
      top: [
        { name: "INSTARANG Herbal Hair Color 100g", url: "shop.html?c=Herbal%20Hair%20Colours" },
        { name: "Noni Herbal Hair Pack 100g", url: "shop.html?c=Herbal%20Hair%20Colours" },
        { name: "Noni Herbal Hair Pack 250g", url: "shop.html?c=Herbal%20Hair%20Colours" }
      ]
    },
    {
      name: "Lip Care",
      url: "shop.html?c=Lip%20Care",
      image: "assets/products/chekorganics-bodyhues-passion-fruit-lip-balm-0.webp",
      count: "2 Remedies",
      badge: "Natural Gloss",
      tagline: "Chapped Lip Relief",
      top: [
        { name: "Passion Fruit Herbal Lip Balm", url: "shop.html?c=Lip%20Care" },
        { name: "Clear Noni Gloss Lip Balm", url: "shop.html?c=Lip%20Care" }
      ]
    },
    {
      name: "Oral Care",
      url: "shop.html?c=Oral%20Care",
      image: "assets/products/chekorganics-mulika-manjan-ayurvedic-herbal-tooth-paste-18-herbs-fluoride-free-0.webp",
      count: "1 Remedy",
      badge: "18+ Herbs",
      tagline: "Fluoride-Free Gum Care",
      top: [
        { name: "MULIKA MANJAN Toothpaste 50g", url: "shop.html?c=Oral%20Care" }
      ]
    },
    {
      name: "Eye Care",
      url: "shop.html?c=Eye%20Care",
      image: "assets/products/chekorganics-ashyukajal-noni-kajal-0.webp",
      count: "1 Remedy",
      badge: "32 Herbs",
      tagline: "Cooling Noni Kajal",
      top: [
        { name: "AshyuKajal Traditional Noni Kajal 2g", url: "shop.html?c=Eye%20Care" }
      ]
    }
  ];

  function setupMegaMenu() {
    const nav = $(".amz-nav");
    if (!nav) return;
    const navInner = $(".amz-nav__inner", nav);
    if (!navInner) return;

    // 1. Ensure trigger button in the sub-bar
    let trigger = $("#amz-mega-trigger");
    if (!trigger) {
      trigger = document.createElement("button");
      trigger.id = "amz-mega-trigger";
      trigger.className = "amz-cat-trigger amz-hit";
      trigger.type = "button";
      trigger.setAttribute("aria-expanded", "false");
      trigger.setAttribute("aria-haspopup", "true");
      trigger.innerHTML = '<span>Categories</span> <svg class="amz-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
      const allBtn = $(".amz-all", navInner);
      if (allBtn && allBtn.nextSibling) {
        navInner.insertBefore(trigger, allBtn.nextSibling);
      } else {
        navInner.prepend(trigger);
      }
    }

    // 2. Build Scrim & Mega Menu Container if not present
    let scrim = $("#amz-megamenu-scrim");
    if (!scrim) {
      scrim = document.createElement("div");
      scrim.id = "amz-megamenu-scrim";
      scrim.className = "amz-megamenu-scrim";
      document.body.appendChild(scrim);
    }

    let menu = $("#amz-megamenu");
    if (!menu) {
      menu = document.createElement("div");
      menu.id = "amz-megamenu";
      menu.className = "amz-megamenu";
      menu.setAttribute("role", "region");
      menu.setAttribute("aria-label", "Collections and Categories Mega Menu");

      const circlesHtml = COLLECTIONS_DATA.map(c => `
        <a href="${c.url}" class="amz-circle-card" title="Explore ${esc(c.name)} (${esc(c.count)})">
          <div class="amz-circle-card__img-wrap">
            <img src="${esc(c.image)}" alt="${esc(c.name)}" class="amz-circle-card__img" loading="lazy">
          </div>
          <span class="amz-circle-card__title">${esc(c.name)}</span>
          <span class="amz-circle-card__count">${esc(c.count)}</span>
        </a>
      `).join("");

      menu.innerHTML = `
        <div class="amz-megamenu__inner">
          <!-- 1. CIRCULAR COLLECTION IMAGES ROW (AMAZON STYLE) -->
          <div class="amz-megamenu__circles-head">
            <div class="amz-megamenu__circles-title">
              <svg class="ico ico--sm ico--gold" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              <span>Explore Ayurvedic Collections</span>
              <small>Click any circle to browse authentic remedies</small>
            </div>
            <a href="shop.html" class="amz-megamenu__all-link">Browse Full Catalog (38) →</a>
          </div>

          <div class="amz-megamenu__circles-row">
            ${circlesHtml}
          </div>

          <!-- 2. CATEGORIZED COLUMNS GRID -->
          <div class="amz-megamenu__cols">
            <!-- Column 1: Superfoods -->
            <div class="amz-mega-col">
              <h4 class="amz-mega-col__head">
                <svg class="ico ico--xs ico--leaf" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg> Superfoods &amp; Detox
              </h4>
              <ul class="amz-mega-col__list">
                <li><a href="product.html?p=chekorganics-noni-fruit-juice-ayush-certified-ayurvedic-wellness-elixir">Pure Noni Fruit Juice 800ml (AYUSH)</a></li>
                <li><a href="shop.html?c=Superfoods">Organic Spirulina Powder (100g)</a></li>
                <li><a href="shop.html?c=Superfoods">Organic Moringa Powder (100g)</a></li>
                <li><a href="shop.html?c=Superfoods">Noni Triphala Immunity Mix</a></li>
              </ul>
              <a href="shop.html?c=Superfoods" class="amz-mega-col__viewall">View all Superfoods (6) →</a>
            </div>

            <!-- Column 2: Haircare -->
            <div class="amz-mega-col">
              <h4 class="amz-mega-col__head">
                <svg class="ico ico--xs ico--leaf" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg> Haircare &amp; Scalp
              </h4>
              <ul class="amz-mega-col__list">
                <li><a href="product.html?p=chekorganics-bodyhues-noni-herbal-hair-oil-200ml">Noni Herbal Hair Oil (Fall Control)</a></li>
                <li><a href="product.html?p=noni-herbal-shampoo-500ml">Noni Herbal Shampoo 500ml</a></li>
                <li><a href="shop.html?c=Herbal%20Hair%20Colours">Instarang Noni Hair Color 100g</a></li>
                <li><a href="shop.html?c=Haircare">Noni Herbal Hair Pack (Anti-Dandruff)</a></li>
              </ul>
              <a href="shop.html?c=Haircare" class="amz-mega-col__viewall">View all Haircare (9) →</a>
            </div>

            <!-- Column 3: Skincare & Soaps -->
            <div class="amz-mega-col">
              <h4 class="amz-mega-col__head">
                <svg class="ico ico--xs ico--leaf" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg> Skincare &amp; Soaps
              </h4>
              <ul class="amz-mega-col__list">
                <li><a href="product.html?p=chekorganics-bodyhues-noni-herbal-bath-powder-250g">Noni Herbal Bath Powder (Ubtan)</a></li>
                <li><a href="shop.html?c=Moisturisers">Organic Noni Body Butter 100g</a></li>
                <li><a href="shop.html?c=Handmade%20Soaps">Noni Turmeric Bath Soap 100g</a></li>
                <li><a href="shop.html?c=Handmade%20Soaps">Pulpy Papaya De-Tan Bath Bar</a></li>
                <li><a href="shop.html?c=Moisturisers">Taruna Gulab Body Milk (250g)</a></li>
              </ul>
              <a href="shop.html?c=Skin%20Care" class="amz-mega-col__viewall">View all Skincare (12) →</a>
            </div>

            <!-- Column 4: Personal Rituals -->
            <div class="amz-mega-col">
              <h4 class="amz-mega-col__head">
                <svg class="ico ico--xs ico--leaf" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg> Speciality &amp; Men
              </h4>
              <ul class="amz-mega-col__list">
                <li><a href="shop.html?c=Eye%20Care">AshyuKajal Traditional Noni Kajal (32 Herbs)</a></li>
                <li><a href="shop.html?c=Oral%20Care">Mulika Manjan Herbal Toothpaste (18+ Herbs)</a></li>
                <li><a href="shop.html?c=Lip%20Care">Passion Fruit &amp; Noni Lip Balm</a></li>
                <li><a href="shop.html?c=Men%27s%20Grooming">Men DUDE Beard Styling Cream</a></li>
              </ul>
              <a href="shop.html?c=Men%27s%20Grooming" class="amz-mega-col__viewall">Explore Speciality Care →</a>
            </div>

            <!-- Column 5: Ayurvedic Spotlight Card -->
            <div class="amz-mega-spotlight">
              <div>
                <span class="amz-mega-spotlight__badge">AYUSH Certified Bestseller</span>
                <img src="assets/products/chekorganics-noni-fruit-juice-ayush-certified-ayurvedic-wellness-elixir-0.webp" alt="Chek Noni Juice" class="amz-mega-spotlight__img" loading="lazy">
                <h4 class="amz-mega-spotlight__title">Pure Noni Fruit Juice 800ml</h4>
                <p class="amz-mega-spotlight__desc">Traditional fermentation from our Telangana organic farm. Zero added sugar or chemicals.</p>
              </div>
              <a href="product.html?p=chekorganics-noni-fruit-juice-ayush-certified-ayurvedic-wellness-elixir" class="amz-mega-spotlight__btn">Shop Elixir (₹899) →</a>
            </div>
          </div>

          <!-- 3. TRUST & COMPANY FOOTER -->
          <div class="amz-megamenu__foot">
            <div class="amz-megamenu__trust-items">
              <span class="amz-megamenu__trust-item"><svg class="ico ico--xs ico--gold" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg> AYUSH Certified · Govt. of India</span>
              <span class="amz-megamenu__trust-item"><svg class="ico ico--xs ico--gold" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg> Free Shipping Above ₹3,000</span>
              <span class="amz-megamenu__trust-item"><svg class="ico ico--xs ico--gold" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Safe UPI &amp; Cash on Delivery</span>
              <span class="amz-megamenu__trust-item"><svg class="ico ico--xs ico--gold" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> Telangana Farm &amp; Secunderabad LLP</span>
            </div>
            <div class="amz-megamenu__foot-links">
              <a href="story.html">Our Story</a>
              <a href="about.html">About Us</a>
              <a href="contact.html">Contact Us</a>
              <a href="shipping-policy.html">Shipping Policy</a>
            </div>
          </div>
        </div>
      `;

      nav.appendChild(menu);
    }

    // 3. Inject circular bubbles into Mobile Drawer (.amz-drawer)
    const drawer = $(".mobile-nav.amz-drawer");
    if (drawer && !$(".amz-drawer__circles-sec", drawer)) {
      const head = $(".amz-drawer__head", drawer);
      if (head) {
        const sec = document.createElement("div");
        sec.className = "amz-drawer__circles-sec";
        sec.innerHTML = `
          <div class="amz-drawer__circles-title">
            <svg class="ico ico--xs ico--gold" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
            <span>Shop By Collection</span>
          </div>
          <div class="amz-drawer__circles-scroll">
            ${COLLECTIONS_DATA.map(c => `
              <a href="${c.url}" class="amz-drawer__circle-item">
                <img src="${esc(c.image)}" alt="${esc(c.name)}" class="amz-drawer__circle-img" loading="lazy">
                <span class="amz-drawer__circle-label">${esc(c.name)}</span>
              </a>
            `).join("")}
          </div>
        `;
        head.insertAdjacentElement("afterend", sec);
      }
    }

    // 4. Interactive Open / Close Logic with Hover & Click
    let closeTimer = null;

    function openMega() {
      if (closeTimer) clearTimeout(closeTimer);
      trigger.classList.add("is-active");
      trigger.setAttribute("aria-expanded", "true");
      menu.classList.add("is-open");
      menu.scrollTop = 0;
      scrim.classList.add("is-open");
    }

    function closeMega() {
      if (closeTimer) clearTimeout(closeTimer);
      trigger.classList.remove("is-active");
      trigger.setAttribute("aria-expanded", "false");
      menu.classList.remove("is-open");
      scrim.classList.remove("is-open");
    }

    function scheduleClose() {
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = setTimeout(closeMega, 240);
    }

    // Hover interactions (desktop)
    trigger.addEventListener("mouseenter", openMega);
    trigger.addEventListener("mouseleave", scheduleClose);
    menu.addEventListener("mouseenter", openMega);
    menu.addEventListener("mouseleave", scheduleClose);

    // Click interactions
    trigger.addEventListener("click", e => {
      e.preventDefault();
      if (menu.classList.contains("is-open")) {
        closeMega();
      } else {
        openMega();
      }
    });

    scrim.addEventListener("click", closeMega);

    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && menu.classList.contains("is-open")) closeMega();
    });

    menu.addEventListener("click", e => {
      if (e.target.closest("a")) closeMega();
    });
  }

  /* ------------------------------------------------------------------ boot */
  function init() {
    if (!$(".amz-header")) return;
    paintLocation();
    setupSearch();
    setupMegaMenu();

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
