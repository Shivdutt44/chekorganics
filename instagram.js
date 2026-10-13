/* ==========================================================================
   CHEKORGANICS — Instagram-style profile on the homepage
   Profile header · story highlights · Posts / Videos feed · story player

   Data (all real):
   - stories + Videos tab: the brand's product videos (videos.js), grouped by
     collection, each tagged with its product (shoppable)
   - Posts tab + follower/post counts: instagram.json from the official
     Instagram API (.build/fetch-instagram.mjs). Without it, the Posts tab and
     the Instagram counts simply don't appear — nothing is invented.
   Load after data.js, app.js and videos.js.
   ========================================================================== */
(function () {
  "use strict";

  const LIVE = "https://www.chekorganics.com";
  const VIDEOS = ((window.SHOPPABLE_VIDEOS && window.SHOPPABLE_VIDEOS.videos) || []).filter(v => v && (v.hd || v.sd) && v.products && v.products.length);
  const PRODUCTS = new Map(((window.STORE && window.STORE.products) || []).map(p => [p.handle, p]));
  const SEEN_KEY = "chek_story_seen_v1";
  const GROUP_LABEL = { "All Products": "Gift sets", "Handmade Soaps": "Soaps", "Moisturisers": "Body care" };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = n => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  const compact = n => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e4 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K" : Number(n).toLocaleString("en-IN"));
  const fmtTime = s => (s == null || !isFinite(s) ? "" : Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0"));

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
  const thumb = (url, w) => {
    if (!url) return "";
    if (/^assets\//.test(url)) return url;
    try {
      const u = new URL(url, location.href);
      if (u.hostname === "cdn.shopify.com" || u.pathname.startsWith("/cdn/shop/")) u.searchParams.set("width", String(w));
      return u.toString();
    } catch (e) {
      return url;
    }
  };

  /* ---------------------------------------------------------------- data */
  const product = handle => {
    const p = PRODUCTS.get(handle);
    return p ? { handle, title: shortName(p.title), image: (p.images || [])[0] || null, price: p.price, compareAt: p.compareAt, available: p.available !== false, collection: p.primaryCollection || "More" } : null;
  };

  const live = new Map();
  function liveProduct(handle) {
    if (!live.has(handle)) {
      live.set(handle, fetch(LIVE + "/products/" + encodeURIComponent(handle) + ".js", { credentials: "omit" })
        .then(r => (r.ok ? r.json() : null))
        .then(j => (j ? { price: j.price / 100, compareAt: j.compare_at_price && j.compare_at_price > j.price ? j.compare_at_price / 100 : null, available: !!j.available } : null))
        .catch(() => null));
    }
    return live.get(handle);
  }

  const readSeen = () => {
    try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY)) || []); } catch (e) { return new Set(); }
  };
  const seen = readSeen();
  const markSeen = id => {
    seen.add(id);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200))); } catch (e) { /* ignore */ }
  };

  /* Story highlights: one circle per collection, in catalog order */
  function buildGroups() {
    const byLabel = new Map();
    VIDEOS.forEach(v => {
      const p = product(v.products[0]);
      if (!p) return;
      const label = GROUP_LABEL[p.collection] || p.collection;
      if (!byLabel.has(label)) byLabel.set(label, { label, cover: p.image || v.poster, stories: [] });
      byLabel.get(label).stories.push(v);
    });
    return [...byLabel.values()].sort((a, b) => b.stories.length - a.stories.length);
  }

  /* --------------------------------------------------------- the section */
  function init() {
    const root = document.getElementById("igapp");
    if (!root) return;
    const groups = buildGroups();

    // stories row
    const row = $("[data-ig-stories]", root);
    if (row && groups.length) {
      row.innerHTML = groups
        .map((g, i) => {
          const allSeen = g.stories.every(s => seen.has(s.id));
          return (
            '<button class="igs' + (allSeen ? " is-seen" : "") + '" type="button" data-group="' + i + '" aria-label="' + esc(g.label + " stories, " + g.stories.length + (g.stories.length === 1 ? " video" : " videos")) + '">' +
            '<span class="igs__ring"><img src="' + esc(thumb(g.cover, 160)) + '" alt="" width="72" height="72" loading="lazy" decoding="async"></span>' +
            '<span class="igs__label">' + esc(g.label) + "</span></button>"
          );
        })
        .join("");
      row.addEventListener("click", e => {
        const b = e.target.closest("[data-group]");
        if (b) Stories.open(groups, Number(b.dataset.group), 0, b);
      });
    } else if (row) row.hidden = true;

    // Instagram badge on the profile photo
    const avatar = $(".igp__avatar", root);
    if (avatar && !$(".igp__badge", avatar)) avatar.insertAdjacentHTML("beforeend", '<span class="igp__badge">' + igLogo() + "</span>");

    // header stats (real numbers only)
    paintStats(root, null);

    // Prev / Next for the story row and the feed rail
    railNav($('[data-ig-nav="stories"]', root), row);
    const feedNav = railNav($('[data-ig-nav="feed"]', root), $("[data-ig-grid]", root));

    // feed tabs: Videos now, Posts once instagram.json exists
    const feedState = { tab: "videos", posts: [] };
    const showFeed = () => {
      renderTabs(root, feedState);
      renderGrid(root, feedState, groups);
      feedNav.reset();
    };
    showFeed();
    $("[data-ig-tabs]", root).addEventListener("click", e => {
      const t = e.target.closest("[data-tab]");
      if (!t) return;
      feedState.tab = t.dataset.tab;
      showFeed();
    });
    $("[data-ig-grid]", root).addEventListener("click", e => {
      const v = e.target.closest("[data-video]");
      if (!v) return;
      e.preventDefault();
      Stories.open([{ label: "Videos", cover: null, stories: VIDEOS }], 0, Number(v.dataset.video), v);
    });

    const loadFeed = () =>
      fetch("instagram.json", { cache: "no-cache" })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null)
        .then(feed => {
          if (!feed) return;
          const posts = (Array.isArray(feed.posts) ? feed.posts : []).filter(p => p && /^https:\/\/(www\.)?instagram\.com\//.test(p.permalink || "") && /^assets\/instagram\/[\w-]+\.webp$/.test(p.image || ""));
          paintStats(root, feed);
          if (feed.avatar && /^assets\/instagram\/profile\.webp$/.test(feed.avatar)) $("[data-ig-avatar]", root).src = feed.avatar;
          if (posts.length) {
            feedState.posts = posts.slice(0, 12);
            feedState.tab = "posts";
            showFeed();
          }
        });
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) {
          io.disconnect();
          loadFeed();
        }
      }, { rootMargin: "600px 0px" });
      io.observe(root);
    } else loadFeed();
  }

  /* Prev / Next buttons for a horizontal row: disabled at either end, invisible when everything fits */
  function railNav(nav, scroller) {
    if (!nav || !scroller) return { reset() {} };
    const prev = $("[data-prev]", nav), next = $("[data-next]", nav);
    const update = () => {
      const max = scroller.scrollWidth - scroller.clientWidth;
      nav.classList.toggle("is-idle", max <= 4);
      prev.disabled = scroller.scrollLeft <= 4;
      next.disabled = scroller.scrollLeft >= max - 4;
    };
    const step = dir => scroller.scrollBy({
      left: dir * Math.max(160, scroller.clientWidth * 0.85),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
    prev.addEventListener("click", () => step(-1));
    next.addEventListener("click", () => step(1));
    scroller.addEventListener("scroll", () => requestAnimationFrame(update), { passive: true });
    scroller.addEventListener("load", update, true); // images change the row's width as they arrive
    window.addEventListener("resize", update, { passive: true });
    update();
    return {
      reset() {
        scroller.scrollLeft = 0;
        update();
      },
    };
  }

  function paintStats(root, feed) {
    const box = $("[data-ig-stats]", root);
    if (!box) return;
    const stats = [];
    if (feed && feed.mediaCount != null) stats.push([feed.mediaCount, "posts"]);
    if (feed && feed.followers != null) stats.push([feed.followers, "followers"]);
    if (VIDEOS.length) stats.push([VIDEOS.length, "shoppable videos"]);
    box.innerHTML = stats.map(([n, l]) => "<li><b>" + esc(compact(n)) + "</b> " + esc(l) + "</li>").join("");
  }

  function renderTabs(root, st) {
    const tabs = $("[data-ig-tabs]", root);
    const items = [];
    if (st.posts.length) items.push(["posts", "Posts", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17"/></svg>']);
    if (VIDEOS.length) items.push(["videos", "Videos", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M3 8.5h18M8.5 3l3 5.5M14 3l3 5.5"/><path d="m10.5 12 4 2.3-4 2.3z" fill="currentColor"/></svg>']);
    tabs.innerHTML = items
      .map(([k, label, icon]) => '<button type="button" role="tab" class="chip igt' + (st.tab === k ? " is-active" : "") + '" data-tab="' + k + '" aria-selected="' + (st.tab === k) + '">' + icon + "<span>" + label + "</span></button>")
      .join("");
    tabs.hidden = !items.length;
  }

  /* Instagram glyph: full-colour (gradient ids must be unique per instance) and plain white */
  let logoSeq = 0;
  function igLogo(cls) {
    const id = "ig-grad-" + ++logoSeq;
    return (
      '<svg class="' + (cls || "") + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<defs><radialGradient id="' + id + '" cx="30%" cy="107%" r="150%">' +
      '<stop offset="0" stop-color="#fdf497"/><stop offset=".05" stop-color="#fdf497"/><stop offset=".45" stop-color="#fd5949"/>' +
      '<stop offset=".6" stop-color="#d6249f"/><stop offset=".9" stop-color="#285aeb"/></radialGradient></defs>' +
      '<rect width="24" height="24" rx="6.5" fill="url(#' + id + ')"/>' +
      '<rect x="5" y="5" width="14" height="14" rx="4.2" fill="none" stroke="#fff" stroke-width="1.8"/>' +
      '<circle cx="12" cy="12" r="3.3" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="16.4" cy="7.6" r="1.05" fill="#fff"/></svg>'
    );
  }
  const IG_WHITE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>';

  // last tile of the feed: a Follow card with the Instagram logo
  const followCard = () =>
    '<a class="igg__tile igg__end" href="https://www.instagram.com/chekorganics/" target="_blank" rel="noopener" aria-label="Follow @chekorganics on Instagram (opens Instagram)">' +
    igLogo("igg__endlogo") +
    "<b>@chekorganics</b>" +
    '<span class="igg__endbtn">Follow on Instagram</span></a>';

  function renderGrid(root, st, groups) {
    const grid = $("[data-ig-grid]", root);
    if (st.tab === "posts" && st.posts.length) {
      grid.className = "igg igg--posts";
      grid.innerHTML = st.posts
        .map(p => {
          const kind = p.isReel ? "Reel" : p.type === "CAROUSEL_ALBUM" ? "Carousel" : p.type === "VIDEO" ? "Video" : "Post";
          const cap = String(p.caption || "").replace(/\s+/g, " ").trim();
          return (
            '<a class="igg__tile" href="' + esc(p.permalink) + '" target="_blank" rel="noopener" aria-label="' + esc(kind + ": " + (cap.slice(0, 90) || "Instagram post") + " (opens Instagram)") + '">' +
            '<img src="' + esc(p.image) + '" alt="' + esc(cap.slice(0, 120) || "Instagram post by @chekorganics") + '" loading="lazy" decoding="async">' +
            (kind !== "Post" ? '<span class="igg__kind">' + kind + "</span>" : "") +
            '<span class="igg__ig" title="Instagram">' + IG_WHITE + "</span>" +
            "</a>"
          );
        })
        .join("") + followCard();
      return;
    }
    grid.className = "igg igg--videos";
    grid.innerHTML = VIDEOS.map((v, i) => {
      const p = product(v.products[0]);
      return (
        '<a class="igg__tile" href="product.html?p=' + encodeURIComponent(v.products[0]) + '" data-video="' + i + '" aria-label="' + esc("Play video: " + (p ? p.title : "product video")) + '">' +
        '<img src="' + esc(thumb(v.poster, 420)) + '" alt="" loading="lazy" decoding="async">' +
        '<span class="igg__center">' + IG_WHITE + "</span>" +
        '<span class="igg__play"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>' + (v.duration ? fmtTime(v.duration) : "") + "</span>" +
        (p ? '<span class="igg__name">' + esc(p.title) + "</span>" : "") +
        "</a>"
      );
    }).join("") + followCard();
  }

  /* ------------------------------------------------------- story player */
  const Stories = (() => {
    let el, video, groups = [], gi = 0, si = 0, returnTo = null, muted = false, holdTimer = null, held = false, raf = 0, pausedByUser = false;

    function build() {
      el = document.createElement("div");
      el.className = "story";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-modal", "true");
      el.setAttribute("aria-label", "Stories");
      el.innerHTML =
        '<img class="story__backdrop" alt="" aria-hidden="true">' +
        '<button class="story__nav story__nav--prev" type="button" aria-label="Previous story group"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg></button>' +
        '<div class="story__frame">' +
        '<div class="story__bars" aria-hidden="true"></div>' +
        '<div class="story__head">' +
        '<img class="story__avatar" src="assets/brand/logo-mark.webp" alt="" width="34" height="34">' +
        '<div class="story__who"><b>chekorganics</b><span class="story__label"></span></div>' +
        '<button class="story__icon story__mute" type="button" aria-label="Mute"></button>' +
        '<button class="story__icon story__close" type="button" aria-label="Close stories"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' +
        "</div>" +
        '<video class="story__video" playsinline preload="auto"></video>' +
        '<div class="story__tap" aria-hidden="true"></div>' +
        '<span class="story__paused" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg></span>' +
        '<div class="story__shop"></div>' +
        "</div>" +
        '<button class="story__nav story__nav--next" type="button" aria-label="Next story group"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></button>';
      document.body.appendChild(el);
      video = $(".story__video", el);

      $(".story__close", el).addEventListener("click", close);
      $(".story__mute", el).addEventListener("click", () => {
        muted = !muted;
        video.muted = muted;
        paintMute();
      });
      $(".story__nav--prev", el).addEventListener("click", () => jumpGroup(-1));
      $(".story__nav--next", el).addEventListener("click", () => jumpGroup(1));
      el.addEventListener("click", e => {
        if (e.target === el || e.target.classList.contains("story__backdrop")) close();
        if (e.target.closest("[data-add]")) pause(true); // app.js adds to bag and opens the drawer
      });
      video.addEventListener("ended", next);
      video.addEventListener("loadedmetadata", tick);

      // tap left/right · hold to pause · swipe down to close · swipe sideways for groups
      const tap = $(".story__tap", el);
      let sx = 0, sy = 0;
      tap.addEventListener("pointerdown", e => {
        sx = e.clientX;
        sy = e.clientY;
        held = false;
        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => {
          held = true;
          pause(false);
        }, 220);
      });
      const end = e => {
        clearTimeout(holdTimer);
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (held) {
          held = false;
          if (!pausedByUser) resume();
          return;
        }
        if (dy > 90 && Math.abs(dy) > Math.abs(dx)) return close();
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) return jumpGroup(dx < 0 ? 1 : -1);
        const r = tap.getBoundingClientRect();
        if (e.clientX - r.left < r.width * 0.3) prev();
        else next();
      };
      tap.addEventListener("pointerup", end);
      tap.addEventListener("pointercancel", () => {
        clearTimeout(holdTimer);
        if (held && !pausedByUser) resume();
        held = false;
      });
      el.addEventListener("contextmenu", e => e.preventDefault());

      el.addEventListener("keydown", e => {
        if (e.key === "Escape") {
          if (!document.querySelector(".drawer.is-open")) close();
        } else if (e.key === "ArrowRight") next();
        else if (e.key === "ArrowLeft") prev();
        else if (e.key === " " && !e.target.closest("button, a")) {
          e.preventDefault();
          video.paused ? (pausedByUser = false, resume()) : pause(true);
        } else if (e.key === "Tab") {
          const f = $$("button:not([disabled]), a[href]", el).filter(x => x.offsetParent !== null);
          if (!f.length) return;
          if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
        }
      });
      document.addEventListener("visibilitychange", () => {
        if (document.hidden && isOpen()) pause(false);
        else if (!document.hidden && isOpen() && !pausedByUser && !document.querySelector(".drawer.is-open")) resume();
      });
    }

    const isOpen = () => !!(el && el.classList.contains("is-open"));

    function paintMute() {
      const b = $(".story__mute", el);
      b.setAttribute("aria-label", muted ? "Unmute" : "Mute");
      b.innerHTML = muted
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M16 9a4.5 4.5 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>';
    }

    function open(gs, g, s, from) {
      if (!el) build();
      groups = gs;
      returnTo = from || null;
      muted = false; // opened by a tap → sound allowed
      pausedByUser = false;
      el.classList.add("is-open");
      document.documentElement.classList.add("vviewer-lock");
      $$(".vcard video").forEach(v => v.pause()); // quiet the Watch & shop rail
      show(g, s);
      $(".story__close", el).focus({ preventScroll: true });
    }

    function close() {
      if (!isOpen()) return;
      cancelAnimationFrame(raf);
      video.pause();
      video.removeAttribute("src");
      video.load();
      el.classList.remove("is-open", "is-paused");
      document.documentElement.classList.remove("vviewer-lock");
      refreshRings();
      if (returnTo && document.contains(returnTo)) returnTo.focus({ preventScroll: true });
    }

    function show(g, s) {
      gi = g;
      si = s;
      const group = groups[gi];
      const v = group.stories[si];
      $(".story__bars", el).innerHTML = group.stories.map((_, i) => '<span class="story__bar"><i style="transform:scaleX(' + (i < si ? 1 : 0) + ')"></i></span>').join("");
      $(".story__label", el).textContent = group.label;
      $(".story__backdrop", el).src = thumb(v.poster, 360);
      $(".story__nav--prev", el).hidden = groups.length < 2;
      $(".story__nav--next", el).hidden = groups.length < 2;
      video.poster = thumb(v.poster, 720);
      video.src = v.hd || v.sd;
      video.muted = muted;
      video.classList.toggle("is-wide", !!(v.width && v.height && v.width > v.height));
      paintMute();
      el.classList.remove("is-paused");
      pausedByUser = false;
      markSeen(v.id);
      renderShop(v);
      const p = video.play();
      if (p) p.catch(err => {
        if (!err || err.name !== "NotAllowedError" || !isOpen()) return;
        muted = true; // sound refused by the browser → play muted, keep the unmute button visible
        video.muted = true;
        paintMute();
        video.play().catch(() => el.classList.add("is-paused"));
      });
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
      const nxt = group.stories[si + 1] || (groups[gi + 1] && groups[gi + 1].stories[0]);
      if (nxt && nxt.poster) new Image().src = thumb(nxt.poster, 720);
    }

    function tick() {
      if (!isOpen()) return;
      const bar = $$(".story__bar i", el)[si];
      if (bar && video.duration) bar.style.transform = "scaleX(" + Math.min(1, video.currentTime / video.duration) + ")";
      raf = requestAnimationFrame(tick);
    }

    function next() {
      const group = groups[gi];
      if (si + 1 < group.stories.length) show(gi, si + 1);
      else if (gi + 1 < groups.length) show(gi + 1, 0);
      else close();
    }

    function prev() {
      if (video.currentTime > 2.5) {
        video.currentTime = 0;
        return;
      }
      if (si > 0) show(gi, si - 1);
      else if (gi > 0) show(gi - 1, groups[gi - 1].stories.length - 1);
      else video.currentTime = 0;
    }

    function jumpGroup(dir) {
      const g = gi + dir;
      if (g >= 0 && g < groups.length) show(g, 0);
      else if (dir > 0) close();
    }

    function pause(byUser) {
      video.pause();
      if (byUser) pausedByUser = true;
      el.classList.add("is-paused");
    }

    function resume() {
      el.classList.remove("is-paused");
      video.play().catch(() => {});
    }

    function renderShop(v) {
      const box = $(".story__shop", el);
      const p = product(v.products[0]);
      if (!p) {
        box.innerHTML = "";
        return;
      }
      const price = info => (info.price != null ? money(info.price) + (info.compareAt ? " <s>" + money(info.compareAt) + "</s>" : "") : "");
      box.innerHTML =
        '<div class="story__product">' +
        (p.image ? '<img src="' + esc(thumb(p.image, 120)) + '" alt="" width="48" height="48">' : "") +
        '<div><a class="story__pname" href="product.html?p=' + encodeURIComponent(p.handle) + '">' + esc(p.title) + "</a>" +
        '<span class="story__price">' + price(p) + "</span></div>" +
        '<button class="story__add" type="button" data-add="' + esc(p.handle) + '"' + (p.available ? "" : " disabled") + ">" + (p.available ? "Add to bag" : "Sold out") + "</button></div>";
      liveProduct(p.handle).then(lp => {
        if (!lp || !isOpen() || groups[gi].stories[si] !== v) return;
        $(".story__price", box).innerHTML = price({ ...p, ...lp });
        const b = $(".story__add", box);
        b.disabled = !lp.available;
        b.textContent = lp.available ? "Add to bag" : "Sold out";
      });
    }

    // grey out highlight rings whose videos have all been watched
    function refreshRings() {
      const all = buildGroups();
      $$("[data-ig-stories] .igs").forEach(b => {
        const g = all[Number(b.dataset.group)];
        if (g) b.classList.toggle("is-seen", g.stories.every(s => seen.has(s.id)));
      });
    }

    return { open, close, isOpen };
  })();

  // Escape from anywhere (e.g. focus left on the drawer) closes the player once the bag is shut
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && Stories.isOpen() && !document.querySelector(".drawer.is-open") && !e.target.closest(".story")) Stories.close();
  });
  // when the bag drawer opened from a story is closed, put focus back in the player
  document.addEventListener("click", e => {
    if (Stories.isOpen() && e.target.closest(".overlay, .drawer__close, [data-close-drawer]")) {
      setTimeout(() => {
        const s = document.querySelector(".story");
        if (s && !document.querySelector(".drawer.is-open")) s.querySelector(".story__close").focus({ preventScroll: true });
      }, 50);
    }
  });

  document.addEventListener("DOMContentLoaded", init);
})();
