/* ==========================================================================
   CHEKORGANICS — admin product manager (admin-products.js)
   Shopify-style product list + product editor for admin.html.
   Every save writes one Firestore document per product (`products/{handle}`) through
   FirebaseDB; app.js layers those documents over the store catalog for shoppers.
   ========================================================================== */
(function () {
  "use strict";

  const $id = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = n => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const clone = o => JSON.parse(JSON.stringify(o));
  const LIVE = "https://www.chekorganics.com";
  const COLLECTIONS = ((window.STORE && window.STORE.collections) || []).map(c => c.title);
  // product images may be bundled assets or https URLs; nothing that could break out of an attribute
  const IMAGE_OK = /^(https:\/\/|assets\/)[^"'<>\s]+$/;

  let base = {};          // handle -> product as the store catalog has it (bundled, then live feed)
  let edits = {};         // handle -> Firestore edits document
  let ready = null;       // load promise
  let tab = "all", query = "", collectionFilter = "", sortBy = "title-asc";
  const selected = new Set();
  let editing = null;     // { handle, isNew, images: [], original: "<json>" }

  /* ------------------------------------------------------------- helpers */
  function toast(msg, bad) {
    let t = $id("pm-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "pm-toast";
      t.className = "pm-toast";
      t.setAttribute("role", "status");
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.toggle("is-bad", !!bad);
    t.classList.add("is-on");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("is-on"), 3200);
  }

  const slugify = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);

  function friendlyError(err) {
    const code = (err && err.code) || "";
    if (/permission/i.test(code) || /permission/i.test(err && err.message)) {
      return "Permission denied — deploy the latest firestore.rules / storage.rules (see README), and make sure you are signed in as the Super Admin.";
    }
    if (/storage\/(unknown|bucket-not-found|project-not-found)/.test(code)) {
      return "Firebase Storage is not enabled for this project yet. Enable it in the Firebase console, or paste an image URL instead.";
    }
    return (err && err.message) || "Something went wrong.";
  }

  /* -------------------------------------------------------- catalog data */
  // Same rules as overlayProduct() in app.js — keep the two in step.
  function overlay(p, o) {
    if (typeof o.title === "string" && o.title.trim()) p.title = o.title.trim();
    if (o.price !== "" && o.price != null && Number(o.price) >= 0) p.price = Number(o.price);
    if ("compareAt" in o) p.compareAt = Number(o.compareAt) > p.price ? Number(o.compareAt) : null;
    if (Array.isArray(o.images) && o.images.length) p.images = o.images.slice();
    if (typeof o.description === "string") p.excerpt = o.description;
    if (typeof o.type === "string") p.type = o.type;
    if (Array.isArray(o.tags)) p.tags = o.tags.slice();
    if (Array.isArray(o.collections) && o.collections.length) {
      p.collections = o.collections.includes("All Products") ? o.collections.slice() : ["All Products"].concat(o.collections);
    }
    if ("badge" in o) p.badge = o.badge || null;
    if (o.trackInventory) p.available = Number(o.inventory) > 0;
    else if ("available" in o) p.available = o.available !== false;
    return p;
  }

  function blank(handle) {
    return { handle, title: "", price: 0, compareAt: null, images: [], excerpt: "", type: "", tags: [], collections: ["All Products"], badge: null, available: true };
  }

  // the product as shoppers see it, plus admin-only fields
  function view(handle) {
    const b = base[handle];
    const e = edits[handle];
    const p = overlay(b ? clone(b) : blank(handle), e || {});
    p.status = e ? (e.deleted ? "deleted" : e.status || "active") : "active";
    p.sku = (e && e.sku) || "";
    p.trackInventory = !!(e && e.trackInventory);
    p.inventory = e && e.inventory != null ? Number(e.inventory) : 0;
    p.edited = !!e;
    p.isNew = !b;
    p.updatedAt = (e && e.updatedAt) || "";
    return p;
  }

  async function fetchJson(url, ms) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms || 8000);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadAll() {
    base = {};
    ((window.STORE && window.STORE.products) || []).forEach(p => { base[p.handle] = clone(p); });

    // the storefront prefers the live Shopify feed, so the admin starts from it too
    for (const url of ["/api/products.json", LIVE + "/products.json?limit=250"]) {
      try {
        const raw = await fetchJson(url);
        if (!raw || !Array.isArray(raw.products)) continue;
        raw.products.forEach(lp => {
          const v = (lp.variants && lp.variants[0]) || {};
          const price = parseFloat(v.price) || 0;
          const cmp = v.compare_at_price ? parseFloat(v.compare_at_price) : null;
          const known = base[lp.handle];
          if (known) {
            known.title = String(lp.title || known.title).replace(/\s+/g, " ").trim();
            known.price = price;
            known.compareAt = cmp && cmp > price ? cmp : null;
            known.available = v.available !== false;
          } else {
            const imgs = (lp.images || []).map(i => (typeof i === "string" ? i : i.src)).filter(Boolean);
            if (!imgs.length) return;
            base[lp.handle] = Object.assign(blank(lp.handle), {
              title: String(lp.title || "").replace(/\s+/g, " ").trim(), price,
              compareAt: cmp && cmp > price ? cmp : null, images: imgs, type: lp.product_type || "",
              tags: lp.tags || [], available: v.available !== false
            });
          }
        });
        break;
      } catch (e) { /* try the next source */ }
    }

    edits = (window.FirebaseDB && window.FirebaseDB.getProductOverrides && await window.FirebaseDB.getProductOverrides()) || {};
    updateKpi();
  }

  const allHandles = () => Array.from(new Set(Object.keys(base).concat(Object.keys(edits))));

  function updateKpi() {
    const k = $id("kpi-products");
    if (k) k.textContent = allHandles().map(view).filter(p => p.status === "active").length;
  }

  /* ---------------------------------------------------------------- list */
  function listRows() {
    const q = query.trim().toLowerCase();
    let rows = allHandles().map(view).filter(p => p.status !== "deleted");
    if (tab !== "all") rows = rows.filter(p => p.status === tab);
    if (collectionFilter) rows = rows.filter(p => (p.collections || []).includes(collectionFilter));
    if (q) rows = rows.filter(p => [p.title, p.handle, p.type, p.sku].concat(p.tags || []).join(" ").toLowerCase().includes(q));
    const by = {
      "title-asc": (a, b) => a.title.localeCompare(b.title),
      "title-desc": (a, b) => b.title.localeCompare(a.title),
      "price-asc": (a, b) => a.price - b.price,
      "price-desc": (a, b) => b.price - a.price,
      "inventory-asc": (a, b) => (a.trackInventory ? a.inventory : 1e9) - (b.trackInventory ? b.inventory : 1e9),
      "updated-desc": (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))
    }[sortBy];
    return rows.sort(by);
  }

  function statusPill(s) {
    const label = { active: "Active", draft: "Draft", archived: "Archived" }[s] || s;
    return '<span class="pm-pill pm-pill--' + esc(s) + '">' + esc(label) + "</span>";
  }

  function inventoryCell(p) {
    if (p.trackInventory) {
      const n = p.inventory;
      return '<span class="' + (n <= 0 ? "pm-bad" : n < 10 ? "pm-warn" : "") + '">' + n + " in stock</span>";
    }
    return p.available ? '<span class="pm-muted">Not tracked</span>' : '<span class="pm-bad">Sold out</span>';
  }

  function renderList() {
    const panel = $id("panel-products");
    if (!panel) return;
    const rows = listRows();
    const counts = { all: 0, active: 0, draft: 0, archived: 0 };
    allHandles().map(view).forEach(p => { if (p.status !== "deleted") { counts.all++; if (counts[p.status] != null) counts[p.status]++; } });

    $id("pm-tabs").innerHTML = ["all", "active", "draft", "archived"].map(t =>
      '<button type="button" class="pm-tab' + (t === tab ? " is-active" : "") + '" data-pm-tab="' + t + '">' +
        ({ all: "All", active: "Active", draft: "Draft", archived: "Archived" }[t]) + ' <span>' + counts[t] + "</span></button>"
    ).join("");

    // drop selections that are no longer visible
    const visible = new Set(rows.map(p => p.handle));
    Array.from(selected).forEach(h => { if (!visible.has(h)) selected.delete(h); });

    const body = $id("pm-tbody");
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="pm-empty">No products match these filters.</td></tr>';
    } else {
      body.innerHTML = rows.map(p => {
        const img = (p.images || [])[0];
        return '<tr class="pm-row" data-pm-open="' + esc(p.handle) + '">' +
          '<td class="pm-check" data-pm-stop><input type="checkbox" data-pm-select="' + esc(p.handle) + '"' + (selected.has(p.handle) ? " checked" : "") + ' aria-label="Select ' + esc(p.title) + '"></td>' +
          '<td><div class="pm-prod">' +
            (img && IMAGE_OK.test(img) ? '<img src="' + esc(img) + '" alt="" loading="lazy">' : '<span class="pm-noimg">🌿</span>') +
            '<div><b>' + esc(p.title || "(untitled)") + '</b>' +
            '<small>' + esc(p.handle) + (p.isNew ? " · added here" : p.edited ? " · edited" : "") + "</small></div>" +
          "</div></td>" +
          "<td>" + statusPill(p.status) + "</td>" +
          "<td>" + inventoryCell(p) + "</td>" +
          '<td class="pm-muted">' + esc(p.type || "—") + "</td>" +
          '<td class="pm-muted">' + esc((p.collections || []).filter(c => c !== "All Products").join(", ") || "—") + "</td>" +
          '<td class="pm-price">' + money(p.price) + (p.compareAt ? " <s>" + money(p.compareAt) + "</s>" : "") + "</td>" +
        "</tr>";
      }).join("");
    }

    const all = $id("pm-select-all");
    all.checked = rows.length > 0 && rows.every(p => selected.has(p.handle));
    all.indeterminate = !all.checked && rows.some(p => selected.has(p.handle));
    const bulk = $id("pm-bulk");
    bulk.hidden = selected.size === 0;
    $id("pm-bulk-count").textContent = selected.size + " selected";
    $id("pm-count").textContent = rows.length + " product" + (rows.length === 1 ? "" : "s");
  }

  /* ---------------------------------------------------------- save layer */
  // the full edits document for a product: what is shown now plus `changes`
  function docFor(handle, changes) {
    const p = view(handle);
    const doc = {
      title: p.title, description: p.excerpt || "", price: Number(p.price) || 0,
      compareAt: p.compareAt || null, images: (p.images || []).slice(), status: p.status === "deleted" ? "active" : p.status,
      type: p.type || "", tags: (p.tags || []).slice(), collections: (p.collections || []).slice(),
      badge: p.badge || null, sku: p.sku || "", trackInventory: !!p.trackInventory,
      inventory: Number(p.inventory) || 0, available: p.available !== false, isNew: !base[handle]
    };
    return Object.assign(doc, changes || {});
  }

  async function persist(handle, doc) {
    const saved = await window.FirebaseDB.saveProduct(handle, doc);
    edits[handle] = saved;
    updateKpi();
    return saved;
  }

  async function bulk(action) {
    const handles = Array.from(selected);
    if (!handles.length) return;
    if (action === "delete" && !confirm("Delete " + handles.length + " product(s) from the store? This hides them for shoppers.")) return;
    try {
      for (const h of handles) {
        if (action === "delete") {
          if (base[h]) await persist(h, docFor(h, { deleted: true }));
          else { await window.FirebaseDB.removeProductOverride(h); delete edits[h]; }
        } else {
          await persist(h, docFor(h, { status: action }));
        }
      }
      selected.clear();
      toast(handles.length + " product(s) updated");
    } catch (err) {
      toast(friendlyError(err), true);
    }
    renderList();
  }

  function exportCsv() {
    const cell = v => '"' + String(v == null ? "" : v).replace(/^[=+\-@]/, "'$&").replace(/"/g, '""') + '"';
    const head = ["Handle", "Title", "Status", "Price", "Compare At", "Track Inventory", "Inventory", "SKU", "Type", "Collections", "Tags", "Image"];
    const lines = listRows().map(p => [p.handle, p.title, p.status, p.price, p.compareAt || "", p.trackInventory ? "yes" : "no",
      p.trackInventory ? p.inventory : "", p.sku, p.type, (p.collections || []).join("; "), (p.tags || []).join("; "), (p.images || [])[0] || ""].map(cell).join(","));
    const blob = new Blob([head.join(",") + "\n" + lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "chekorganics_products.csv";
    a.click();
  }

  /* -------------------------------------------------------------- editor */
  function show(which) {
    $id("panel-products").style.display = which === "list" ? "block" : "none";
    $id("panel-product-edit").style.display = which === "edit" ? "block" : "none";
    const title = $id("page-title");
    if (title) title.textContent = which === "list" ? "Products" : editing && editing.isNew && !edits[editing.handle] ? "Add product" : "Edit product";
    window.scrollTo({ top: 0 });
  }

  function openEditor(handle, prefill) {
    const isNew = !handle;
    const p = isNew ? Object.assign(view("__new__"), prefill || {}, { status: "active" }) : view(handle);
    if (isNew) { p.isNew = true; p.edited = false; }
    editing = { handle: isNew ? "" : handle, isNew, images: (p.images || []).slice(), original: "" };

    const collBoxes = COLLECTIONS.map(c =>
      '<label class="pm-checkline"><input type="checkbox" name="pe-coll" value="' + esc(c) + '"' + ((p.collections || []).includes(c) ? " checked" : "") + "> " + esc(c) + "</label>"
    ).join("");

    $id("pm-editor").innerHTML =
      '<div class="pm-edit-head">' +
        '<button type="button" class="pm-back" id="pe-back" aria-label="Back to products">←</button>' +
        "<h3>" + esc(p.title || "Add product") + "</h3>" +
        (isNew ? "" : statusPill(p.status)) +
        '<div class="pm-edit-actions">' +
          (isNew ? "" : '<a class="btn-detail" target="_blank" rel="noopener" href="product.html?p=' + encodeURIComponent(p.handle) + '">View on store ↗</a>') +
          (isNew ? "" : '<button type="button" class="btn-detail" id="pe-duplicate">Duplicate</button>') +
        "</div>" +
      "</div>" +

      '<div class="pm-grid">' +
        '<div class="pm-col">' +
          '<section class="pm-card">' +
            '<label class="pm-label" for="pe-title">Title</label>' +
            '<input class="pm-input" id="pe-title" maxlength="200" value="' + esc(p.title) + '" placeholder="Noni Herbal Hair Oil 200ml">' +
            '<label class="pm-label" for="pe-desc">Description</label>' +
            '<textarea class="pm-input" id="pe-desc" rows="8" maxlength="5000" placeholder="Benefits, ingredients, how to use…">' + esc(p.excerpt || "") + "</textarea>" +
          "</section>" +

          '<section class="pm-card">' +
            '<div class="pm-card-head"><h4>Media</h4><span class="pm-muted">First image is the main photo</span></div>' +
            '<div class="pm-media" id="pe-media"></div>' +
            '<div class="pm-media-add">' +
              '<label class="btn-detail pm-upload">⬆ Upload images<input type="file" id="pe-file" accept="image/*" multiple hidden></label>' +
              '<input class="pm-input" id="pe-img-url" placeholder="…or paste an image URL (https://…)">' +
              '<button type="button" class="btn-detail" id="pe-img-add">Add URL</button>' +
            "</div>" +
            '<p class="pm-muted pm-small" id="pe-upload-status"></p>' +
          "</section>" +

          '<section class="pm-card">' +
            "<h4>Pricing</h4>" +
            '<div class="pm-row2">' +
              '<div><label class="pm-label" for="pe-price">Price (₹)</label><input class="pm-input" id="pe-price" type="number" min="0" step="0.01" value="' + esc(p.price) + '"></div>' +
              '<div><label class="pm-label" for="pe-compare">Compare-at price (₹)</label><input class="pm-input" id="pe-compare" type="number" min="0" step="0.01" value="' + esc(p.compareAt || "") + '" placeholder="Shown struck through"></div>' +
            "</div>" +
            '<p class="pm-muted pm-small" id="pe-discount"></p>' +
          "</section>" +

          '<section class="pm-card">' +
            "<h4>Inventory</h4>" +
            '<div class="pm-row2">' +
              '<div><label class="pm-label" for="pe-sku">SKU</label><input class="pm-input" id="pe-sku" maxlength="64" value="' + esc(p.sku) + '"></div>' +
              '<div><label class="pm-label" for="pe-qty">Quantity</label><input class="pm-input" id="pe-qty" type="number" step="1" value="' + esc(p.inventory) + '"></div>' +
            "</div>" +
            '<label class="pm-checkline"><input type="checkbox" id="pe-track"' + (p.trackInventory ? " checked" : "") + "> Track quantity (sold out at 0)</label>" +
            '<label class="pm-checkline" id="pe-avail-wrap"><input type="checkbox" id="pe-avail"' + (p.available !== false ? " checked" : "") + "> In stock (when quantity isn't tracked)</label>" +
          "</section>" +

          '<section class="pm-card">' +
            "<h4>Search engine listing</h4>" +
            '<label class="pm-label" for="pe-handle">URL handle</label>' +
            '<input class="pm-input" id="pe-handle" value="' + esc(p.handle === "__new__" ? "" : p.handle) + '"' + (isNew ? ' placeholder="made from the title"' : " readonly") + ">" +
            '<p class="pm-muted pm-small">' + (isNew ? "Can't be changed after the first save (links and carts use it)." : "Fixed: links, carts and reviews use it.") + "</p>" +
          "</section>" +
        "</div>" +

        '<div class="pm-col pm-col--side">' +
          '<section class="pm-card">' +
            "<h4>Status</h4>" +
            '<select class="pm-input" id="pe-status">' +
              ["active", "draft", "archived"].map(s => '<option value="' + s + '"' + (p.status === s ? " selected" : "") + ">" + s[0].toUpperCase() + s.slice(1) + "</option>").join("") +
            "</select>" +
            '<p class="pm-muted pm-small">Draft and archived products are hidden from the store.</p>' +
          "</section>" +
          '<section class="pm-card">' +
            "<h4>Product organization</h4>" +
            '<label class="pm-label" for="pe-type">Type</label>' +
            '<input class="pm-input" id="pe-type" maxlength="80" value="' + esc(p.type || "") + '">' +
            '<span class="pm-label">Collections</span><div class="pm-colls">' + collBoxes + "</div>" +
            '<label class="pm-label" for="pe-tags">Tags</label>' +
            '<input class="pm-input" id="pe-tags" value="' + esc((p.tags || []).join(", ")) + '" placeholder="Comma separated">' +
            '<label class="pm-label" for="pe-badge">Badge on card</label>' +
            '<input class="pm-input" id="pe-badge" maxlength="24" value="' + esc(p.badge || "") + '" placeholder="e.g. Bestseller">' +
          "</section>" +
          (isNew ? "" :
          '<section class="pm-card pm-danger">' +
            (base[p.handle] && edits[p.handle] ? '<button type="button" class="btn-detail" id="pe-revert">↺ Discard all edits (use store data)</button>' : "") +
            '<button type="button" class="btn-detail pm-delete" id="pe-delete">Delete product</button>' +
          "</section>") +
        "</div>" +
      "</div>" +

      '<div class="pm-savebar" id="pe-savebar" hidden>' +
        "<span>Unsaved changes</span>" +
        '<button type="button" class="btn-detail" id="pe-discard">Discard</button>' +
        '<button type="button" class="pm-save" id="pe-save">Save</button>' +
      "</div>";

    renderMedia();
    bindEditor();
    syncInventoryUi();
    showDiscount();
    editing.original = JSON.stringify(collect());
    show("edit");
  }

  function renderMedia() {
    const box = $id("pe-media");
    if (!box) return;
    box.innerHTML = editing.images.length ? editing.images.map((src, i) =>
      '<figure class="pm-thumb' + (i === 0 ? " is-main" : "") + '">' +
        (IMAGE_OK.test(src) ? '<img src="' + esc(src) + '" alt="">' : '<span class="pm-noimg">?</span>') +
        '<figcaption>' +
          '<button type="button" data-img-move="' + i + '" data-dir="-1" aria-label="Move left"' + (i === 0 ? " disabled" : "") + ">←</button>" +
          '<button type="button" data-img-move="' + i + '" data-dir="1" aria-label="Move right"' + (i === editing.images.length - 1 ? " disabled" : "") + ">→</button>" +
          '<button type="button" data-img-del="' + i + '" aria-label="Remove image">✕</button>' +
        "</figcaption>" +
      "</figure>"
    ).join("") : '<p class="pm-muted">No images yet — a product needs at least one to show in the store.</p>';
  }

  function collect() {
    const val = id => ($id(id) ? $id(id).value : "");
    const compare = val("pe-compare") === "" ? null : Number(val("pe-compare"));
    const badge = val("pe-badge").trim();
    return {
      title: val("pe-title").trim(),
      description: val("pe-desc").replace(/\r\n/g, "\n").trim(),
      price: Number(val("pe-price")) || 0,
      compareAt: compare,
      images: editing.images.slice(),
      status: val("pe-status") || "active",
      type: val("pe-type").trim(),
      tags: val("pe-tags").split(",").map(s => s.trim()).filter(Boolean).slice(0, 50),
      collections: ["All Products"].concat(Array.from(document.querySelectorAll('input[name="pe-coll"]:checked')).map(i => i.value)),
      badge: badge || null,
      sku: val("pe-sku").trim(),
      trackInventory: !!($id("pe-track") && $id("pe-track").checked),
      inventory: Math.trunc(Number(val("pe-qty")) || 0),
      available: !!($id("pe-avail") && $id("pe-avail").checked)
    };
  }

  // an unsaved new product with a title (e.g. a duplicate) counts as a change to save
  const isDirty = () => !!editing && ((editing.isNew && !!collect().title) || JSON.stringify(collect()) !== editing.original);

  function markDirty() {
    const bar = $id("pe-savebar");
    if (bar) bar.hidden = !isDirty();
  }

  function syncInventoryUi() {
    const track = $id("pe-track").checked;
    $id("pe-qty").disabled = !track;
    $id("pe-avail-wrap").style.opacity = track ? 0.5 : 1;
    $id("pe-avail").disabled = track;
  }

  function showDiscount() {
    const price = Number($id("pe-price").value) || 0;
    const cmp = Number($id("pe-compare").value) || 0;
    const el = $id("pe-discount");
    if (!el) return;
    if (cmp && cmp > price && price > 0) el.textContent = "Shoppers see " + Math.round((1 - price / cmp) * 100) + "% off (save " + money(cmp - price) + ")";
    else if (cmp && cmp <= price) el.textContent = "Compare-at must be higher than the price, or it is ignored.";
    else el.textContent = "";
  }

  async function toWebp(file) {
    // shrink phone photos before upload: max 1600px, WebP
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, "image/webp", 0.85));
    return blob || file;
  }

  async function uploadFiles(files) {
    const status = $id("pe-upload-status");
    const handle = editing.handle || slugify($id("pe-handle").value || $id("pe-title").value) || "new-product";
    for (const [i, file] of Array.from(files).entries()) {
      if (!/^image\//.test(file.type)) continue;
      status.textContent = "Uploading " + (i + 1) + " of " + files.length + "…";
      try {
        const blob = await toWebp(file);
        const url = await window.FirebaseDB.uploadProductImage(blob, handle, file.name.replace(/\.[^.]+$/, "") + ".webp");
        editing.images.push(url);
        renderMedia();
        markDirty();
      } catch (err) {
        status.textContent = "";
        toast(friendlyError(err), true);
        return;
      }
    }
    status.textContent = "Uploaded — remember to Save.";
  }

  function bindEditor() {
    const root = $id("pm-editor");
    root.oninput = e => {
      if (e.target.id === "pe-title" && editing.isNew && !$id("pe-handle").dataset.touched) $id("pe-handle").value = slugify(e.target.value);
      if (e.target.id === "pe-handle") e.target.dataset.touched = "1";
      if (e.target.id === "pe-price" || e.target.id === "pe-compare") showDiscount();
      markDirty();
    };
    root.onchange = e => {
      if (e.target.id === "pe-track") syncInventoryUi();
      if (e.target.id === "pe-file" && e.target.files.length) { uploadFiles(e.target.files); e.target.value = ""; }
      markDirty();
    };
    root.onclick = e => {
      const mv = e.target.closest("[data-img-move]");
      if (mv) {
        const i = Number(mv.dataset.imgMove), j = i + Number(mv.dataset.dir);
        [editing.images[i], editing.images[j]] = [editing.images[j], editing.images[i]];
        renderMedia(); markDirty();
        return;
      }
      const del = e.target.closest("[data-img-del]");
      if (del) { editing.images.splice(Number(del.dataset.imgDel), 1); renderMedia(); markDirty(); }
    };

    $id("pe-img-add").onclick = () => {
      const input = $id("pe-img-url");
      const url = input.value.trim();
      if (!IMAGE_OK.test(url)) { toast("Enter an https:// image URL", true); return; }
      editing.images.push(url);
      input.value = "";
      renderMedia(); markDirty();
    };
    $id("pe-back").onclick = () => leaveEditor();
    $id("pe-discard").onclick = () => openEditor(editing.isNew && !edits[editing.handle] ? null : editing.handle);
    $id("pe-save").onclick = save;
    const dup = $id("pe-duplicate");
    if (dup) dup.onclick = () => {
      if (isDirty() && !confirm("Discard unsaved changes and duplicate?")) return;
      const p = collect();
      openEditor(null, { title: "Copy of " + p.title, excerpt: p.description, price: p.price, compareAt: p.compareAt, images: p.images,
        type: p.type, tags: p.tags, collections: p.collections, badge: p.badge, sku: "", trackInventory: p.trackInventory,
        inventory: p.inventory, available: p.available });
      markDirty();
    };
    const del = $id("pe-delete");
    if (del) del.onclick = removeProduct;
    const rev = $id("pe-revert");
    if (rev) rev.onclick = revert;
  }

  async function save() {
    const data = collect();
    if (!data.title) { toast("Title is required", true); $id("pe-title").focus(); return; }
    if (data.price < 0) { toast("Price can't be negative", true); return; }
    let handle = editing.handle;
    if (editing.isNew && !handle) {
      handle = slugify($id("pe-handle").value || data.title);
      if (!handle) { toast("Enter a URL handle", true); return; }
      if (base[handle] || edits[handle]) { toast("A product with the handle \"" + handle + "\" already exists", true); return; }
      if (!data.images.length) { toast("Add at least one image before saving a new product", true); return; }
    }
    const btn = $id("pe-save");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      await persist(handle, Object.assign(data, { isNew: !base[handle] }));
      toast("Product saved — shoppers see it within 5 minutes");
      openEditor(handle);
    } catch (err) {
      toast(friendlyError(err), true);
      btn.disabled = false;
      btn.textContent = "Save";
    }
  }

  async function removeProduct() {
    const h = editing.handle;
    if (!confirm("Delete \"" + view(h).title + "\"? Shoppers will no longer see it.")) return;
    try {
      if (base[h]) await persist(h, docFor(h, { deleted: true }));
      else { await window.FirebaseDB.removeProductOverride(h); delete edits[h]; updateKpi(); }
      editing = null;
      toast("Product deleted");
      show("list");
      renderList();
    } catch (err) {
      toast(friendlyError(err), true);
    }
  }

  async function revert() {
    const h = editing.handle;
    if (!confirm("Discard every edit to this product and use the store's own data again?")) return;
    try {
      await window.FirebaseDB.removeProductOverride(h);
      delete edits[h];
      updateKpi();
      toast("Edits discarded");
      openEditor(h);
    } catch (err) {
      toast(friendlyError(err), true);
    }
  }

  function leaveEditor() {
    if (isDirty() && !confirm("You have unsaved changes. Leave without saving?")) return false;
    editing = null;
    show("list");
    renderList();
    return true;
  }

  /* -------------------------------------------------------------- wiring */
  function bindList() {
    $id("pm-search").oninput = e => { query = e.target.value; renderList(); };
    $id("pm-coll").innerHTML = '<option value="">All collections</option>' + COLLECTIONS.map(c => '<option value="' + esc(c) + '">' + esc(c) + "</option>").join("");
    $id("pm-coll").onchange = e => { collectionFilter = e.target.value; renderList(); };
    $id("pm-sort").onchange = e => { sortBy = e.target.value; renderList(); };
    $id("pm-add").onclick = () => openEditor(null);
    $id("pm-export").onclick = exportCsv;
    $id("pm-tabs").onclick = e => { const b = e.target.closest("[data-pm-tab]"); if (b) { tab = b.dataset.pmTab; renderList(); } };
    $id("pm-select-all").onchange = e => { listRows().forEach(p => (e.target.checked ? selected.add(p.handle) : selected.delete(p.handle))); renderList(); };
    $id("pm-bulk").onclick = e => { const b = e.target.closest("[data-pm-bulk]"); if (b) bulk(b.dataset.pmBulk); };
    $id("pm-tbody").onclick = e => {
      const box = e.target.closest("[data-pm-select]");
      if (box) { box.checked ? selected.add(box.dataset.pmSelect) : selected.delete(box.dataset.pmSelect); renderList(); return; }
      if (e.target.closest("[data-pm-stop]")) return;
      const row = e.target.closest("[data-pm-open]");
      if (row) openEditor(row.dataset.pmOpen);
    };
    document.addEventListener("keydown", e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && editing && $id("panel-product-edit").style.display !== "none") {
        e.preventDefault();
        if (isDirty()) save();
      }
    });
    window.addEventListener("beforeunload", e => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } });
  }

  let bound = false;
  window.AdminProducts = {
    // called by admin.html when the Products view is opened
    async open() {
      if (!bound) { bindList(); bound = true; }
      editing = null;
      show("list");
      if (!ready) {
        $id("pm-tbody").innerHTML = '<tr><td colspan="7" class="pm-empty">Loading products…</td></tr>';
        ready = loadAll().catch(err => { ready = null; toast(friendlyError(err), true); });
      }
      await ready;
      renderList();
    },
    // called before switching to another view; false keeps the editor open
    leave() {
      if (editing && isDirty() && !confirm("You have unsaved changes. Leave without saving?")) return false;
      editing = null;
      return true;
    },
    refreshKpi() {
      if (!ready) ready = loadAll().catch(() => { ready = null; });
    }
  };
})();
