/* ==========================================================================
   CHEKORGANICS — Advanced Real-Time Live Search Engine
   Instant client-side indexing · Multi-category filters · Zero page refresh
   ========================================================================== */
(function () {
  "use strict";

  const RECENT_KEY = "chek_recent_searches_v1";
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const state = {
    query: "",
    category: "All",
    priceRange: "all",
    sortBy: "match",
    inStockOnly: false
  };

  const TRENDING_QUERIES = [
    "Noni Juice",
    "Herbal Hair Oil",
    "Mulika Manjan",
    "Instarang Hair Color",
    "Spirulina",
    "Turmeric Soap",
    "Taruna Gulab",
    "Hair Fall Control"
  ];

  const CONCERNS = [
    { label: "Hair Fall & Dandruff", term: "Hair Fall" },
    { label: "Natural Detox & Immunity", term: "Detox" },
    { label: "Skin Glow & Tan Removal", term: "Glow" },
    { label: "Dental & Oral Care", term: "Mulika Manjan" },
    { label: "Stress Relief & Vitality", term: "Ashwagandha" }
  ];

  /* Read recent searches from localStorage */
  function getRecentSearches() {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveRecentSearch(term) {
    if (!term || term.trim().length < 2) return;
    const clean = term.trim();
    let list = getRecentSearches().filter(x => x.toLowerCase() !== clean.toLowerCase());
    list.unshift(clean);
    list = list.slice(0, 6);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch (e) {}
  }

  function clearRecentSearches() {
    try {
      localStorage.removeItem(RECENT_KEY);
    } catch (e) {}
    renderContent();
  }

  /* Get product catalog from window.STORE */
  function getCatalog() {
    if (window.STORE && Array.isArray(window.STORE.products)) {
      return window.STORE.products;
    }
    return [];
  }

  function getCollections() {
    const list = ["All"];
    const prods = getCatalog();
    const seen = new Set();
    prods.forEach(p => {
      (p.collections || []).forEach(c => {
        if (c && c !== "All Products" && !seen.has(c)) {
          seen.add(c);
          list.push(c);
        }
      });
    });
    return list;
  }

  /* Highlight matching terms safely */
  function highlightText(text, query) {
    if (!query || !query.trim()) return escapeHtml(text);
    const words = query.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return escapeHtml(text);
    const regex = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    const escaped = escapeHtml(text);
    return escaped.replace(regex, "<mark>$1</mark>");
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c]));
  }

  /* Scoring & filtering products in real time */
  function searchProducts() {
    const prods = getCatalog();
    const q = state.query.toLowerCase().trim();
    const words = q.split(/\s+/).filter(Boolean);

    let filtered = prods.filter(p => {
      // Category filter
      if (state.category !== "All") {
        const inCol = (p.collections || []).includes(state.category) || p.primaryCollection === state.category;
        if (!inCol) return false;
      }

      // In stock filter
      if (state.inStockOnly && p.available === false) {
        return false;
      }

      // Price filter
      const price = Number(p.price) || 0;
      if (state.priceRange === "u250" && price >= 250) return false;
      if (state.priceRange === "250-500" && (price < 250 || price > 500)) return false;
      if (state.priceRange === "500p" && price <= 500) return false;

      // Query filter
      if (words.length > 0) {
        const title = (p.title || "").toLowerCase();
        const excerpt = (p.excerpt || "").toLowerCase();
        const type = (p.type || "").toLowerCase();
        const tags = (p.tags || []).join(" ").toLowerCase();
        const cols = (p.collections || []).join(" ").toLowerCase();
        const full = `${title} ${excerpt} ${type} ${tags} ${cols}`;

        const matchesAll = words.every(w => full.includes(w));
        if (!matchesAll) return false;
      }

      return true;
    });

    // Scoring if query exists
    if (words.length > 0) {
      filtered.forEach(p => {
        let score = 0;
        const title = (p.title || "").toLowerCase();
        const type = (p.type || "").toLowerCase();
        const tags = (p.tags || []).join(" ").toLowerCase();

        if (title.includes(q)) score += 50;
        words.forEach(w => {
          if (title.startsWith(w)) score += 20;
          if (title.includes(w)) score += 10;
          if (type.includes(w)) score += 6;
          if (tags.includes(w)) score += 4;
        });
        if (p.badge === "Bestseller") score += 5;
        p._searchScore = score;
      });
    }

    // Sorting
    filtered.sort((a, b) => {
      if (state.sortBy === "price-asc") return (a.price || 0) - (b.price || 0);
      if (state.sortBy === "price-desc") return (b.price || 0) - (a.price || 0);
      if (state.sortBy === "rating") return (b.rating || 0) - (a.rating || 0);
      if (state.sortBy === "bestseller") {
        const aBest = a.badge === "Bestseller" ? 1 : 0;
        const bBest = b.badge === "Bestseller" ? 1 : 0;
        return bBest - aBest;
      }
      // "match"
      if (words.length > 0) {
        return (b._searchScore || 0) - (a._searchScore || 0);
      }
      return 0;
    });

    return filtered;
  }

  /* Build and Inject Modal DOM */
  let modalEl, inputEl, bodyEl, catsRowEl, clearBtnEl, resultsCountEl;

  function ensureModal() {
    if ($("#adv-search-modal")) return;

    const modal = document.createElement("div");
    modal.id = "adv-search-modal";
    modal.className = "adv-search-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Search products and remedies");

    modal.innerHTML = `
      <div class="adv-search-card" role="document">
        <!-- Search Header -->
        <div class="adv-search-head">
          <svg class="adv-search-head__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>
          </svg>
          <input 
            type="search" 
            id="adv-search-input" 
            class="adv-search-input" 
            placeholder="Search Noni Juice, Hair Oils, Soaps, Superfoods…" 
            autocomplete="off" 
            spellcheck="false"
            aria-label="Search remedies and products"
          >
          <button type="button" id="adv-search-clear" class="adv-search-clear" aria-label="Clear search query" style="display:none;"><svg class="ico ico--xs" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          <button type="button" class="adv-search-close" id="adv-search-close" aria-label="Close search">
            Close <kbd>ESC</kbd>
          </button>
        </div>

        <!-- Filter Toolbar -->
        <div class="adv-search-filters">
          <div class="adv-search-cats-row" id="adv-search-cats"></div>
          
          <div class="adv-subfilters-row">
            <div class="adv-subfilters-left">
              <span style="font-size:0.75rem;font-weight:600;color:var(--forest,#10351f)">Price:</span>
              <button type="button" class="adv-price-btn is-active" data-price="all">All</button>
              <button type="button" class="adv-price-btn" data-price="u250">&lt; ₹250</button>
              <button type="button" class="adv-price-btn" data-price="250-500">₹250 - ₹500</button>
              <button type="button" class="adv-price-btn" data-price="500p">₹500+</button>
            </div>

            <div class="adv-subfilters-right">
              <label class="adv-toggle-label">
                <input type="checkbox" id="adv-instock-toggle">
                <span>In Stock Only</span>
              </label>

              <select class="adv-sort-select" id="adv-sort-select" aria-label="Sort search results">
                <option value="match">Best Match</option>
                <option value="bestseller">Bestsellers First</option>
                <option value="rating">Highest Rated</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Results / Idle Area -->
        <div class="adv-search-body" id="adv-search-body"></div>

        <!-- Foot -->
        <div class="adv-search-foot">
          <span style="display:inline-flex;align-items:center;gap:0.4rem"><svg class="ico ico--leaf" viewBox="0 0 24 24"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg> 100% Genuine Ayurvedic Formulations · Farm to Formula</span>
          <a href="shop.html" id="adv-view-all-link">Browse Full Shop Catalog (38 products) →</a>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modalEl = modal;
    inputEl = $("#adv-search-input", modal);
    bodyEl = $("#adv-search-body", modal);
    catsRowEl = $("#adv-search-cats", modal);
    clearBtnEl = $("#adv-search-clear", modal);

    // Event Listeners on Modal
    $("#adv-search-close", modal).addEventListener("click", closeModal);
    modal.addEventListener("click", e => {
      if (e.target === modal) closeModal();
    });

    clearBtnEl.addEventListener("click", () => {
      inputEl.value = "";
      state.query = "";
      clearBtnEl.style.display = "none";
      inputEl.focus();
      renderContent();
    });

    // Real-time input typing (Instant response)
    let typeTimer;
    inputEl.addEventListener("input", e => {
      clearTimeout(typeTimer);
      typeTimer = setTimeout(() => {
        state.query = e.target.value;
        clearBtnEl.style.display = state.query ? "grid" : "none";
        renderContent();
      }, 50);
    });

    // Price Filter Buttons
    $$(".adv-price-btn", modal).forEach(btn => {
      btn.addEventListener("click", () => {
        $$(".adv-price-btn", modal).forEach(b => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        state.priceRange = btn.dataset.price;
        renderContent();
      });
    });

    // In Stock Toggle
    $("#adv-instock-toggle", modal).addEventListener("change", e => {
      state.inStockOnly = e.target.checked;
      renderContent();
    });

    // Sort Select
    $("#adv-sort-select", modal).addEventListener("change", e => {
      state.sortBy = e.target.value;
      renderContent();
    });

    // Global Keydown (ESC to close)
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && modalEl && modalEl.classList.contains("is-open")) {
        closeModal();
      }
      // Hotkey Ctrl+K / Cmd+K or "/" to open
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openModal();
      }
    });

    renderCategories();
    renderContent();
  }

  /* Render Category Chips with counts */
  function renderCategories() {
    if (!catsRowEl) return;
    const cats = getCollections();
    const prods = getCatalog();

    catsRowEl.innerHTML = cats.map(c => {
      const count = c === "All" 
        ? prods.length 
        : prods.filter(p => (p.collections || []).includes(c) || p.primaryCollection === c).length;
      const active = state.category === c ? "is-active" : "";
      return `<button type="button" class="adv-cat-chip ${active}" data-cat="${escapeHtml(c)}">
        <span>${escapeHtml(c)}</span>
        <span class="adv-cat-chip__count">(${count})</span>
      </button>`;
    }).join("");

    $$(".adv-cat-chip", catsRowEl).forEach(btn => {
      btn.addEventListener("click", () => {
        state.category = btn.dataset.cat;
        $$(".adv-cat-chip", catsRowEl).forEach(b => b.classList.toggle("is-active", b.dataset.cat === state.category));
        renderContent();
      });
    });
  }

  /* Render Modal Content (Results vs Idle) */
  function renderContent() {
    if (!bodyEl) return;

    const hasActiveFilters = state.category !== "All" || state.priceRange !== "all" || state.inStockOnly || state.sortBy !== "match";
    const isTyping = state.query.trim().length > 0;

    // If completely idle with no query and no filters, show Trending & Recent
    if (!isTyping && !hasActiveFilters) {
      renderIdleState();
      return;
    }

    const results = searchProducts();

    // Results Header bar
    let html = `
      <div class="adv-results-summary">
        <span>Found <strong class="adv-results-count">${results.length}</strong> ${results.length === 1 ? 'product' : 'products'} ${state.category !== 'All' ? `in <em>${escapeHtml(state.category)}</em>` : ''}</span>
        ${hasActiveFilters || isTyping ? `<button type="button" class="adv-reset-filters-btn" id="adv-reset-all">Reset all filters</button>` : ''}
      </div>
    `;

    if (results.length === 0) {
      html += `
        <div class="adv-empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
            <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>
            <line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
          <h3>No Ayurvedic remedies matched your search</h3>
          <p>We couldn't find any products matching "<strong>${escapeHtml(state.query)}</strong>". Try adjusting your keyword or clearing active filters.</p>
          <div class="adv-pills-wrap" style="justify-content:center;">
            <button type="button" class="adv-quick-pill" data-fill="Noni Juice">Noni Juice</button>
            <button type="button" class="adv-quick-pill" data-fill="Hair Oil">Hair Oil</button>
            <button type="button" class="adv-quick-pill" data-fill="Soap">Handmade Soaps</button>
            <button type="button" class="adv-quick-pill" data-fill="Superfoods">Superfoods</button>
          </div>
        </div>
      `;
    } else {
      html += `<div class="adv-results-grid">`;
      results.forEach(p => {
        const img = (p.images && p.images[0]) || "assets/brand/logo.webp";
        const titleHtml = highlightText(p.title, state.query);
        const price = p.price != null ? `₹${p.price}` : "";
        const compare = p.compareAt ? `₹${p.compareAt}` : "";
        const badge = p.badge ? `<span class="adv-prod-badge">${escapeHtml(p.badge)}</span>` : "";
        const typeCol = escapeHtml([p.type, p.primaryCollection].filter(Boolean).join(" · ") || "Ayurvedic Formulation");
        const rating = p.rating ? `★ ${p.rating} (${p.reviews || 1})` : "★ 5.0 (Ayush)";
        const soldOut = p.available === false;

        html += `
          <div class="adv-prod-card" data-handle="${escapeHtml(p.handle)}">
            <img class="adv-prod-thumb" src="${escapeHtml(img)}" alt="${escapeHtml(p.title)}" loading="lazy">
            <div class="adv-prod-info">
              <div>
                ${badge}
                <a class="adv-prod-title" href="product.html?p=${encodeURIComponent(p.handle)}">${titleHtml}</a>
                <div class="adv-prod-meta">${typeCol} · <span style="color:#d97706">${rating}</span></div>
              </div>
              <div class="adv-prod-bottom">
                <div class="adv-prod-price">
                  ${price}
                  ${compare ? `<span class="adv-prod-compare">${compare}</span>` : ""}
                </div>
                <div class="adv-prod-actions">
                  <a class="adv-btn-view" href="product.html?p=${encodeURIComponent(p.handle)}">View</a>
                  <button type="button" class="adv-btn-add" data-add-handle="${escapeHtml(p.handle)}" ${soldOut ? "disabled" : ""}>
                    ${soldOut ? "Sold Out" : "+ Bag"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        `;
      });
      html += `</div>`;
    }

    bodyEl.innerHTML = html;

    // Attach Reset All handler
    const resetBtn = $("#adv-reset-all", bodyEl);
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        state.query = "";
        state.category = "All";
        state.priceRange = "all";
        state.sortBy = "match";
        state.inStockOnly = false;
        if (inputEl) inputEl.value = "";
        if (clearBtnEl) clearBtnEl.style.display = "none";
        $$(".adv-cat-chip", catsRowEl).forEach(b => b.classList.toggle("is-active", b.dataset.cat === "All"));
        $$(".adv-price-btn", modalEl).forEach(b => b.classList.toggle("is-active", b.dataset.price === "all"));
        $("#adv-instock-toggle", modalEl).checked = false;
        $("#adv-sort-select", modalEl).value = "match";
        renderContent();
      });
    }

    // Attach quick pill fills in empty state
    $$(".adv-quick-pill", bodyEl).forEach(btn => {
      btn.addEventListener("click", () => {
        const fill = btn.dataset.fill;
        if (inputEl) inputEl.value = fill;
        state.query = fill;
        if (clearBtnEl) clearBtnEl.style.display = "grid";
        renderContent();
      });
    });

    // Attach Add to Bag buttons
    $$("[data-add-handle]", bodyEl).forEach(btn => {
      btn.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        const handle = btn.dataset.addHandle;
        if (!handle || btn.disabled) return;

        if (window.Cart && typeof window.Cart.add === "function") {
          window.Cart.add(handle, 1);
        }

        btn.classList.add("is-added");
        const prevText = btn.innerHTML;
        btn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:0.3rem"><svg class="ico ico--sm" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Added</span>`;
        setTimeout(() => {
          btn.classList.remove("is-added");
          btn.innerHTML = prevText;
        }, 1800);
      });
    });

    // Save recent search if user typed at least 3 chars
    if (state.query.trim().length >= 3) {
      saveRecentSearch(state.query);
    }
  }

  /* Render Idle State (Trending + Health Concerns + Recent) */
  function renderIdleState() {
    const recent = getRecentSearches();

    let html = `<div class="adv-idle-container">`;

    // Trending Searches
    html += `
      <div class="adv-idle-section">
        <h4 style="display:flex;align-items:center;gap:0.4rem"><svg class="ico ico--gold" viewBox="0 0 24 24"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg> Trending Ayurvedic Searches</h4>
        <div class="adv-pills-wrap">
          ${TRENDING_QUERIES.map(q => `<button type="button" class="adv-quick-pill" data-search-term="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join("")}
        </div>
      </div>
    `;

    // Browse by Concern
    html += `
      <div class="adv-idle-section">
        <h4 style="display:flex;align-items:center;gap:0.4rem"><svg class="ico ico--leaf" viewBox="0 0 24 24"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg> Browse by Health &amp; Skin Concern</h4>
        <div class="adv-pills-wrap">
          ${CONCERNS.map(c => `<button type="button" class="adv-quick-pill" data-search-term="${escapeHtml(c.term)}">${escapeHtml(c.label)}</button>`).join("")}
        </div>
      </div>
    `;

    // Recent Searches
    if (recent.length > 0) {
      html += `
        <div class="adv-idle-section">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.65rem;">
            <h4 style="margin:0;display:flex;align-items:center;gap:0.4rem"><svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Recent Searches</h4>
            <button type="button" id="adv-clear-recent" style="font-size:0.74rem;background:none;border:none;color:#94a3b8;cursor:pointer;text-decoration:underline;">Clear</button>
          </div>
          <div class="adv-pills-wrap">
            ${recent.map(r => `<button type="button" class="adv-quick-pill" data-search-term="${escapeHtml(r)}">${escapeHtml(r)}</button>`).join("")}
          </div>
        </div>
      `;
    }

    html += `</div>`;
    bodyEl.innerHTML = html;

    // Attach clicks for quick pills
    $$("[data-search-term]", bodyEl).forEach(btn => {
      btn.addEventListener("click", () => {
        const term = btn.dataset.searchTerm;
        if (inputEl) inputEl.value = term;
        state.query = term;
        if (clearBtnEl) clearBtnEl.style.display = "grid";
        saveRecentSearch(term);
        renderContent();
      });
    });

    const clearRecentBtn = $("#adv-clear-recent", bodyEl);
    if (clearRecentBtn) {
      clearRecentBtn.addEventListener("click", clearRecentSearches);
    }
  }

  /* Open / Close Search Modal */
  function openModal(prefill) {
    ensureModal();
    if (!modalEl) return;

    if (typeof prefill === "string") {
      state.query = prefill;
      if (inputEl) inputEl.value = prefill;
      if (clearBtnEl) clearBtnEl.style.display = prefill ? "grid" : "none";
    }

    modalEl.classList.add("is-open");
    document.body.style.overflow = "hidden";
    renderCategories();
    renderContent();

    setTimeout(() => {
      if (inputEl) {
        inputEl.focus();
        inputEl.select();
      }
    }, 120);
  }

  function closeModal() {
    if (!modalEl) return;
    modalEl.classList.remove("is-open");
    document.body.style.overflow = "";
  }

  /* Automatically inject Header Search Trigger into header */
  function injectHeaderTrigger() {
    const headerInner = $(".header__inner");
    if (!headerInner) return;

    // Check if trigger already exists
    if ($("#hdr-search-trigger")) return;

    // 1. Desktop Trigger between nav and actions
    const searchWrap = document.createElement("div");
    searchWrap.className = "header-search";
    searchWrap.id = "header-search-wrap";
    searchWrap.innerHTML = `
      <button class="header-search__btn" type="button" id="hdr-search-trigger" aria-label="Search remedies and products" aria-haspopup="dialog">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>
        </svg>
        <span class="header-search__placeholder">Search remedies, superfoods…</span>
        <kbd class="header-search__kbd">Ctrl K</kbd>
      </button>
    `;

    const actions = $(".header__actions", headerInner);
    if (actions) {
      headerInner.insertBefore(searchWrap, actions);

      // 2. Mobile icon button in header__actions
      const mobileBtn = document.createElement("button");
      mobileBtn.className = "icon-btn header-search__icon-btn";
      mobileBtn.type = "button";
      mobileBtn.id = "hdr-search-mobile-btn";
      mobileBtn.setAttribute("aria-label", "Open search");
      mobileBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>
        </svg>
      `;
      // Insert before cart or first action
      actions.insertBefore(mobileBtn, actions.firstChild);

      mobileBtn.addEventListener("click", () => openModal());
    }

    $("#hdr-search-trigger", searchWrap).addEventListener("click", () => openModal());
  }

  /* Expose Global API */
  window.ChekSearch = {
    open: openModal,
    close: closeModal
  };

  // Initialize once DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      injectHeaderTrigger();
      ensureModal();
    });
  } else {
    injectHeaderTrigger();
    ensureModal();
  }
})();
