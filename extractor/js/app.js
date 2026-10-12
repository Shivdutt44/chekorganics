/* ==========================================================================
   Store Extractor — UI controller
   ========================================================================== */
import { runExtraction, validateStore, normalizeStoreUrl, Requester, DEFAULT_OPTIONS, formatBytes } from "./core.js";
import { htmlTools } from "./html.js";
import { fullJson, datasetJson, toCsv, tableOf, buildXlsx, workbookSheets, buildZip, downloadImages } from "./export.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = n => (typeof n === "number" ? n.toLocaleString() : n ?? "–");
const clamp = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
};

const STATUS_LABEL = { idle: "Idle", running: "Running", completed: "Completed", partial: "Partially completed", failed: "Failed", cancelled: "Cancelled" };
const PAGE_SIZE = { list: 20, grid: 24 };

const state = {
  status: "idle",
  result: null,
  controller: null,
  lastInput: null,
  lastOptions: null,
  tab: "products",
  page: 1,
  q: "",
  filter: "",
  open: new Set(),
  shownLog: new Set(),
  busyExport: false,
};

/* ------------------------------------------------------------ helpers */
function toast(msg) {
  const el = $("#tpl-toast").content.firstElementChild.cloneNode(true);
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 2300);
}

async function copy(text, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast(label);
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function thumb(url, w = 240) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === "cdn.shopify.com" || u.pathname.startsWith("/cdn/shop/")) u.searchParams.set("width", String(w));
    return u.toString();
  } catch {
    return null;
  }
}

function filePrefix() {
  const host = state.result?.store?.canonicalDomain ? new URL(state.result.store.canonicalDomain).hostname : "store";
  const d = (state.result?.store?.extractedAt || new Date().toISOString()).slice(0, 10);
  return `${host}-${d}`;
}

const money = (n, cur) => (n === null || n === undefined ? "–" : `${cur ? cur + " " : ""}${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

/* ------------------------------------------------------------ last result (IndexedDB, best effort) */
const IDB = { name: "store-extractor", store: "results" };
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB.name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB.store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB.store, mode);
    const req = fn(tx.objectStore(IDB.store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}
const saveLast = result => idbDo("readwrite", s => s.put({ savedAt: new Date().toISOString(), result }, "last")).catch(() => {});
const loadLast = () => idbDo("readonly", s => s.get("last")).catch(() => null);
const forgetLast = () => idbDo("readwrite", s => s.delete("last")).catch(() => {});

/* ------------------------------------------------------------ options */
function readOptions() {
  const types = {};
  $$(".chip input[data-type]").forEach(i => {
    if (i.dataset.type !== "all") types[i.dataset.type] = i.checked;
  });
  return {
    types,
    enrichProducts: $("#opt-enrich").checked,
    collectionProductRefs: $("#opt-refs").checked,
    requestsPerSecond: clamp($("#opt-rps").value, 1, 8, DEFAULT_OPTIONS.requestsPerSecond),
    concurrency: clamp($("#opt-conc").value, 1, 6, DEFAULT_OPTIONS.concurrency),
    maxPages: clamp($("#opt-pages").value, 1, 400, DEFAULT_OPTIONS.maxPages),
    maxRetries: clamp($("#opt-retries").value, 0, 6, DEFAULT_OPTIONS.maxRetries),
  };
}

function syncChips(changed) {
  const boxes = $$(".chip input[data-type]");
  const all = boxes.find(b => b.dataset.type === "all");
  const rest = boxes.filter(b => b !== all);
  if (changed === all) rest.forEach(b => (b.checked = all.checked));
  else all.checked = rest.every(b => b.checked);
}

/* ------------------------------------------------------------ url errors */
function showUrlError(msg) {
  const el = $("#url-error");
  el.textContent = msg || "";
  el.hidden = !msg;
  $("#store-url").setAttribute("aria-invalid", msg ? "true" : "false");
}

function checkUrl() {
  try {
    normalizeStoreUrl($("#store-url").value);
    showUrlError("");
    return true;
  } catch (e) {
    showUrlError(e.message);
    $("#store-url").focus();
    return false;
  }
}

/* ------------------------------------------------------------ validation */
async function onValidate() {
  if (!checkUrl()) return;
  const btn = $('[data-action="validate"]');
  btn.disabled = true;
  btn.textContent = "Checking…";
  const box = $("#validation");
  box.hidden = false;
  box.innerHTML = '<p class="muted">Contacting the store…</p>';
  try {
    const requester = new Requester({ concurrency: 4, requestsPerSecond: 6, maxRetries: 1, timeoutMs: 15000 });
    renderValidation(await validateStore($("#store-url").value, { requester }));
  } catch (e) {
    box.innerHTML = `<p class="validation__msg"><span class="badge badge--failed">Error</span> ${esc(e.message)}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Validate store";
  }
}

function renderValidation(v) {
  const box = $("#validation");
  const ok = v.reachable && v.isShopify;
  const s = v.store;
  box.innerHTML = `
    <div class="validation__head">
      <span class="badge badge--${ok ? "complete" : v.reachable ? "partial" : "failed"}">${ok ? "Extractable" : v.reachable ? "Limited" : "Not reachable"}</span>
      <span class="validation__name">${esc(s?.name || v.canonicalDomain)}</span>
      ${v.platform ? `<span class="muted">${esc(v.platform)} · ${esc(v.canonicalDomain)}</span>` : `<span class="muted">${esc(v.normalizedUrl)}</span>`}
    </div>
    <ul class="endpoints">
      ${Object.entries(v.endpoints)
        .map(([k, val]) => `<li><span class="badge badge--${val === "available" ? "available" : "unavailable"}">${val === "available" ? "OK" : "No"}</span><span><code>${esc(k)}</code>${val === "available" ? "" : ` <span class="muted">${esc(val)}</span>`}</span></li>`)
        .join("")}
    </ul>
    ${s ? `<p class="validation__msg muted">Currency ${esc(s.currency || "–")} · ${fmt(s.publishedProductsCount)} published products · ${fmt(s.publishedCollectionsCount)} published collections${s.myshopifyDomain ? ` · ${esc(s.myshopifyDomain)}` : ""}</p>` : ""}
    ${v.messages.map(m => `<p class="validation__msg">${esc(m)}</p>`).join("")}`;
}

/* ------------------------------------------------------------ run */
async function onStart(e) {
  e?.preventDefault();
  if (state.status === "running") return;
  if (!checkUrl()) return;
  const options = readOptions();
  if (!Object.values(options.types).some(Boolean)) {
    toast("Select at least one content type");
    return;
  }
  run($("#store-url").value, options);
}

async function run(input, options) {
  state.lastInput = input;
  state.lastOptions = options;
  state.controller = new AbortController();
  state.shownLog = new Set();
  $("#log").innerHTML = "";
  setStatus("running");
  $("#progress").hidden = false;
  $("#results").hidden = true;
  $("#progress").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });

  let result;
  try {
    result = await runExtraction(input, options, { signal: state.controller.signal, html: htmlTools, onProgress: queueProgress });
  } catch (err) {
    // Only input errors reach here (runExtraction keeps partial results for everything else).
    setStatus("failed");
    $("#stage-label").textContent = err.message;
    state.controller = null;
    return;
  }
  state.controller = null;
  state.result = result;
  state.tab = result.products.length ? "products" : result.collections.length ? "collections" : result.pages.length ? "pages" : result.images.length ? "images" : "errors";
  state.page = 1;
  state.q = "";
  state.filter = "";
  state.open.clear();
  $("#search").value = "";
  setStatus(result.status); // only now, after the extraction has actually returned
  renderResults();
  saveLast(result);
}

let pending = null;
function queueProgress(p) {
  pending = p;
  requestAnimationFrame(() => {
    if (pending) renderProgress(pending);
    pending = null;
  });
}

function renderProgress(p) {
  $("#bar-fill").style.width = p.percent + "%";
  $(".bar").setAttribute("aria-valuenow", String(p.percent));
  $("#stage-label").textContent = `${p.stageLabel} · ${p.percent}%`;
  const set = (k, v) => ($(`[data-stat="${k}"]`).textContent = v);
  set("requests", fmt(p.requests));
  set("discovered", fmt(p.discovered));
  set("processed", fmt(p.processed));
  set("extracted", fmt(p.extracted));
  set("images", fmt(p.images));
  set("failed", fmt(p.failed));
  set("retries", fmt(p.retries));
  set("elapsed", `${Math.round(p.elapsedMs / 1000)}s`);
  // The core sends the last 30 log lines each time; append only the ones not shown yet.
  const log = $("#log");
  let added = false;
  for (const l of p.log) {
    const key = l.at + l.msg;
    if (state.shownLog.has(key)) continue;
    state.shownLog.add(key);
    const li = document.createElement("li");
    li.textContent = `${l.at.slice(11, 19)}  ${l.msg}`;
    log.append(li);
    added = true;
  }
  if (added) {
    while (log.children.length > 200) log.firstElementChild.remove();
    log.scrollTop = log.scrollHeight;
  }
}

function setStatus(status) {
  state.status = status;
  const pill = $("#status-pill");
  pill.className = `pill pill--${status}`;
  pill.textContent = STATUS_LABEL[status] || status;
  const running = status === "running";
  $('[data-action="cancel"]').hidden = !running;
  $('[data-action="retry"]').hidden = running || !state.lastInput;
  $('[data-action="start"]').disabled = running;
  $('[data-action="start"]').textContent = running ? "Extracting…" : "Start extraction";
}

/* ------------------------------------------------------------ results */
const TABS = [
  { key: "products", label: "Products", grid: false },
  { key: "variants", label: "Variants", grid: false },
  { key: "collections", label: "Collections", grid: false },
  { key: "pages", label: "Pages", grid: false },
  { key: "images", label: "Images", grid: true },
  { key: "errors", label: "Errors", grid: false },
];

function rowsFor(tab) {
  const r = state.result;
  if (tab === "variants") return r.products.flatMap(p => p.variants.map(v => ({ ...v, _product: p })));
  return r[tab] || [];
}

function haystack(tab, x) {
  if (x._hay) return x._hay;
  let parts;
  if (tab === "products") parts = [x.title, x.handle, x.vendor, x.productType, ...(x.tags || []), ...x.variants.flatMap(v => [v.sku, v.barcode, v.title])];
  else if (tab === "variants") parts = [x.title, x.sku, x.barcode, x._product.title, x._product.handle];
  else if (tab === "collections") parts = [x.title, x.handle, x.descriptionText, ...(x.productHandles || [])];
  else if (tab === "pages") parts = [x.title, x.handle, x.contentText];
  else if (tab === "images") parts = [x.filename, x.alt, x.url, x.category, ...(x.sources || []).map(s => s.title)];
  else parts = [x.code, x.message, x.url, x.stage];
  Object.defineProperty(x, "_hay", { value: parts.filter(Boolean).join(" ").toLowerCase(), enumerable: false });
  return x._hay;
}

function filterOptions(tab) {
  if (tab === "images") {
    const cats = [...new Set(state.result.images.map(i => i.category))];
    return [["", "All categories"], ...cats.map(c => [c, c.replace(/_/g, " ")])];
  }
  if (tab === "products" || tab === "variants") return [["", "Any availability"], ["available", "Available"], ["soldout", "Sold out"]];
  if (tab === "errors") return [["", "All stages"], ...[...new Set(state.result.errors.map(e => e.stage))].map(s => [s, s])];
  return null;
}

function applyFilter(tab, x) {
  const f = state.filter;
  if (!f) return true;
  if (tab === "images") return x.category === f;
  if (tab === "products" || tab === "variants") return f === "available" ? x.available === true : x.available === false;
  if (tab === "errors") return x.stage === f;
  return true;
}

function renderResults() {
  const r = state.result;
  $("#results").hidden = false;
  const s = r.summary;
  const tiles = [
    ["Products", s.products], ["Variants", s.variants], ["Collections", s.collections], ["Pages", s.pages],
    ["Images", s.images], ["Failed URLs", s.failedUrls], ["Requests", s.requests], ["Time", `${Math.round(s.durationMs / 1000)}s`],
  ];
  $("#summary").innerHTML = tiles.map(([k, v]) => `<div><b>${esc(fmt(v))}</b><span>${esc(k)}</span></div>`).join("");

  const order = ["products", "productEnrichment", "variants", "collections", "collectionProductRefs", "pages", "images", "banners", "posters", "blogs", "articles", "sitemap", "seo", "policies"];
  const entries = Object.entries(r.coverage).sort((a, b) => (order.indexOf(a[0]) + 99) % 99 - (order.indexOf(b[0]) + 99) % 99);
  $("#coverage").innerHTML = entries
    .map(([k, c]) => `<div class="cov"><span class="cov__name">${esc(k.replace(/([A-Z])/g, " $1").replace(/^./, m => m.toUpperCase()))}</span><span><span class="badge badge--${esc(c.status)}">${esc(c.status)}</span></span><span class="cov__notes muted">${esc(c.notes.join(" "))}</span></div>`)
    .join("");

  $("#tabs").innerHTML = TABS.map(t => {
    const n = rowsFor(t.key).length;
    return `<button type="button" class="tab" role="tab" data-tab="${t.key}" aria-selected="${t.key === state.tab}">${t.label} <small>${fmt(n)}</small></button>`;
  }).join("");
  renderFilter();
  renderList();
}

function renderFilter() {
  const sel = $("#filter");
  const opts = filterOptions(state.tab);
  sel.hidden = !opts;
  if (opts) sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}"${v === state.filter ? " selected" : ""}>${esc(l)}</option>`).join("");
}

function renderList() {
  const tab = state.tab;
  const def = TABS.find(t => t.key === tab);
  const q = state.q.trim().toLowerCase();
  const all = rowsFor(tab).filter(x => applyFilter(tab, x) && (!q || haystack(tab, x).includes(q)));
  const size = def.grid ? PAGE_SIZE.grid : PAGE_SIZE.list;
  const pages = Math.max(1, Math.ceil(all.length / size));
  state.page = Math.min(state.page, pages);
  const slice = all.slice((state.page - 1) * size, state.page * size);
  $("#count").textContent = `${fmt(all.length)} ${all.length === 1 ? "result" : "results"}`;
  const list = $("#list");
  list.className = def.grid ? "list list--grid" : "list";
  list.innerHTML = slice.length ? slice.map((x, i) => renderItem(tab, x, (state.page - 1) * size + i)).join("") : `<div class="empty">${rowsFor(tab).length ? "Nothing matches your search." : emptyText(tab)}</div>`;
  renderPager(pages);
}

function emptyText(tab) {
  const cov = state.result.coverage[tab === "variants" ? "products" : tab];
  if (tab === "errors") return "No errors. Every request succeeded.";
  return cov ? `No ${tab} extracted. ${cov.notes.join(" ")}` : `No ${tab} extracted.`;
}

function renderPager(pages) {
  const p = state.page;
  if (pages <= 1) {
    $("#pager").innerHTML = "";
    return;
  }
  const nums = [...new Set([1, p - 1, p, p + 1, pages])].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  let html = `<button type="button" data-page="${p - 1}" ${p === 1 ? "disabled" : ""} aria-label="Previous page">‹</button>`;
  let prev = 0;
  for (const n of nums) {
    if (n - prev > 1) html += `<button type="button" disabled>…</button>`;
    html += `<button type="button" data-page="${n}" ${n === p ? 'aria-current="page"' : ""}>${n}</button>`;
    prev = n;
  }
  html += `<button type="button" data-page="${p + 1}" ${p === pages ? "disabled" : ""} aria-label="Next page">›</button>`;
  $("#pager").innerHTML = html;
}

function jsonOf(x) {
  if (x._product) {
    const { _product, ...v } = x;
    return { ...v, productHandle: _product.handle, productTitle: _product.title };
  }
  return x;
}

function actions(x, idx, url) {
  const open = state.open.has(`${state.tab}:${idx}`);
  return `<div class="item__actions">
    ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open ↗</a><button type="button" class="btn--link" data-copy-url="${esc(url)}">Copy URL</button>` : ""}
    <button type="button" class="btn--link" data-toggle-json="${idx}" aria-expanded="${open}">${open ? "Hide JSON" : "View JSON"}</button>
    <button type="button" class="btn--link" data-copy-json="${idx}">Copy JSON</button>
  </div>`;
}

function jsonBlock(x, idx) {
  return state.open.has(`${state.tab}:${idx}`) ? `<pre>${esc(JSON.stringify(jsonOf(x), null, 2))}</pre>` : "";
}

function renderItem(tab, x, idx) {
  if (tab === "images") {
    const t = thumb(x.url, 360);
    const src = x.sources?.[0];
    return `<article class="tile">
      <img class="tile__img" src="${esc(t)}" alt="${esc(x.alt || "")}" loading="lazy" decoding="async" referrerpolicy="no-referrer">
      <div class="tile__body">
        <span class="tile__name">${esc(x.filename || "image")}</span>
        <span><span class="badge badge--skipped">${esc(x.category.replace(/_/g, " "))}</span></span>
        <span class="tile__meta">${x.width ? `${x.width}×${x.height}px · ` : ""}${esc(x.alt ? `alt: "${x.alt}"` : "no alt text")}</span>
        <span class="tile__meta">${src?.url ? `From <a href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">${esc(src.title || src.url)}</a>` : ""}${x.sourceCount > 1 ? ` +${x.sourceCount - 1} more` : ""}</span>
        ${actions(x, idx, x.url)}
      </div>
      ${jsonBlock(x, idx)}
    </article>`;
  }
  let img = null, title = "", meta = "", text = "", url = null;
  if (tab === "products") {
    img = x.featuredImage;
    title = x.title;
    url = x.url;
    const price = x.priceMin === x.priceMax ? money(x.priceMin, x.currency) : `${money(x.priceMin, x.currency)} – ${money(x.priceMax, null)}`;
    meta = [x.handle, x.vendor, price, `${x.variants.length} variant${x.variants.length === 1 ? "" : "s"}`, `${x.images.length} images`, x.available === null ? null : x.available ? "available" : "sold out"].filter(Boolean).map(esc).join(" · ");
    text = x.descriptionText;
  } else if (tab === "variants") {
    img = x.imageUrl || x._product.featuredImage;
    title = `${x._product.title} — ${x.title}`;
    url = x.url;
    meta = [x.sku ? `SKU ${x.sku}` : "no SKU", x.barcode ? `barcode ${x.barcode}` : null, money(x.price, x._product.currency), x.compareAtPrice ? `was ${money(x.compareAtPrice, null)}` : null, x.available === null ? null : x.available ? "available" : "sold out"].filter(Boolean).map(esc).join(" · ");
  } else if (tab === "collections") {
    img = x.image?.url;
    title = x.title;
    url = x.url;
    meta = [x.handle, x.productsCount !== null ? `${x.productsCount} products` : null, x.productRefsSource ? `${x.productHandles.length} mapped${x.productRefsComplete ? "" : " (incomplete)"}` : null].filter(Boolean).map(esc).join(" · ");
    text = x.descriptionText;
  } else if (tab === "pages") {
    img = x.images[0]?.url;
    title = x.title;
    url = x.url;
    meta = [x.path, `${x.headings.length} headings`, `${x.images.length} images`, `${x.links.length} links`, x.updatedAt ? `updated ${x.updatedAt.slice(0, 10)}` : null].filter(Boolean).map(esc).join(" · ");
    text = x.contentText;
  } else {
    title = `${x.code}${x.status ? ` (HTTP ${x.status})` : ""}`;
    url = x.url;
    meta = [x.stage, x.item, x.at?.slice(11, 19)].filter(Boolean).map(esc).join(" · ");
    text = x.message;
  }
  const t = thumb(img, 160);
  return `<article class="item${t ? "" : " item--noimg"}">
    ${t ? `<img class="item__thumb" src="${esc(t)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}
    <div>
      <p class="item__title">${esc(title || "(untitled)")}</p>
      <p class="item__meta">${meta}</p>
      ${text ? `<p class="item__text">${esc(text.slice(0, 400))}</p>` : ""}
      ${actions(x, idx, url)}
    </div>
    ${jsonBlock(x, idx)}
  </article>`;
}

function itemAt(idx) {
  const tab = state.tab;
  const q = state.q.trim().toLowerCase();
  return rowsFor(tab).filter(x => applyFilter(tab, x) && (!q || haystack(tab, x).includes(q)))[idx];
}

/* ------------------------------------------------------------ exports */
async function onExport(kind) {
  const r = state.result;
  if (!r || state.busyExport) return;
  state.busyExport = true;
  const status = $("#export-status");
  const buttons = $$("[data-export]");
  buttons.forEach(b => (b.disabled = true));
  const type = $("#export-type").value;
  try {
    if (kind === "json") saveBlob(new Blob([fullJson(r)], { type: "application/json" }), `${filePrefix()}-extraction.json`);
    else if (kind === "type-json") saveBlob(new Blob([datasetJson(r, type)], { type: "application/json" }), `${filePrefix()}-${type}.json`);
    else if (kind === "type-csv") saveBlob(new Blob([toCsv(tableOf(r, type))], { type: "text/csv;charset=utf-8" }), `${filePrefix()}-${type}.csv`);
    else if (kind === "xlsx") {
      status.textContent = "Building Excel workbook…";
      saveBlob(await buildXlsx(workbookSheets(r)), `${filePrefix()}.xlsx`);
    } else if (kind === "zip") {
      let downloadedFiles = [];
      if ($("#zip-images").checked && r.images.length) {
        const max = clamp($("#zip-max").value, 1, 2000, 200);
        const width = clamp($("#zip-width").value, 200, 5000, 2048);
        status.textContent = `Downloading images… 0 / ${Math.min(max, r.images.length)}`;
        const requester = new Requester({ concurrency: 4, requestsPerSecond: 8, maxRetries: 2, timeoutMs: 30000 });
        const { files, stats } = await downloadImages(r.images, requester, {
          maxCount: max,
          maxWidth: width,
          onProgress: ({ done, total, stats: s }) => (status.textContent = `Downloading images… ${done} / ${total} · ${formatBytes(s.bytes)}${s.failed ? ` · ${s.failed} failed` : ""}`),
        });
        downloadedFiles = files;
        status.textContent = `Images: ${stats.downloaded} downloaded, ${stats.duplicates} duplicates, ${stats.failed} failed, ${stats.skipped} skipped. Building ZIP…`;
      } else status.textContent = "Building ZIP…";
      const zip = await buildZip(r, { downloadedFiles });
      const blob = zip.toBlob();
      saveBlob(blob, `${filePrefix()}.zip`);
      status.textContent = `ZIP ready (${formatBytes(blob.size)}).`;
      return;
    }
    status.textContent = "Download started.";
  } catch (e) {
    status.textContent = `Export failed: ${e.message}`;
  } finally {
    state.busyExport = false;
    buttons.forEach(b => (b.disabled = false));
  }
}

/* ------------------------------------------------------------ events */
function bind() {
  $("#store-form").addEventListener("submit", onStart);
  $("#store-url").addEventListener("input", () => showUrlError(""));
  $('[data-action="validate"]').addEventListener("click", onValidate);
  $('[data-action="cancel"]').addEventListener("click", () => {
    state.controller?.abort();
    $("#stage-label").textContent = "Cancelling…";
  });
  $('[data-action="retry"]').addEventListener("click", () => state.lastInput && run(state.lastInput, state.lastOptions || readOptions()));
  $$(".chip input[data-type]").forEach(i => i.addEventListener("change", () => syncChips(i)));

  $("#tabs").addEventListener("click", e => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    state.tab = b.dataset.tab;
    state.page = 1;
    state.filter = "";
    state.open.clear();
    $$("#tabs .tab").forEach(t => t.setAttribute("aria-selected", String(t === b)));
    renderFilter();
    renderList();
  });
  let t;
  $("#search").addEventListener("input", e => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.q = e.target.value;
      state.page = 1;
      renderList();
    }, 150);
  });
  $("#filter").addEventListener("change", e => {
    state.filter = e.target.value;
    state.page = 1;
    renderList();
  });
  $("#pager").addEventListener("click", e => {
    const b = e.target.closest("[data-page]");
    if (!b || b.disabled) return;
    state.page = Number(b.dataset.page);
    renderList();
    $("#tabs").scrollIntoView({ block: "start" });
  });
  $("#list").addEventListener("click", e => {
    const u = e.target.closest("[data-copy-url]");
    if (u) return copy(u.dataset.copyUrl, "URL copied");
    const j = e.target.closest("[data-copy-json]");
    if (j) return copy(JSON.stringify(jsonOf(itemAt(Number(j.dataset.copyJson))), null, 2), "JSON copied");
    const tg = e.target.closest("[data-toggle-json]");
    if (tg) {
      const key = `${state.tab}:${tg.dataset.toggleJson}`;
      state.open.has(key) ? state.open.delete(key) : state.open.add(key);
      renderList();
    }
  });
  $$("[data-export]").forEach(b => b.addEventListener("click", () => onExport(b.dataset.export)));

  $('[data-action="restore"]').addEventListener("click", async () => {
    const saved = await loadLast();
    if (!saved?.result) return;
    state.result = saved.result;
    state.tab = "products";
    state.page = 1;
    $("#restore").hidden = true;
    $("#progress").hidden = true;
    renderResults();
    $("#results").scrollIntoView({ block: "start" });
  });
  $('[data-action="forget"]').addEventListener("click", async () => {
    await forgetLast();
    $("#restore").hidden = true;
  });

  window.addEventListener("beforeunload", e => {
    if (state.status === "running") {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

async function init() {
  bind();
  const fromQuery = new URLSearchParams(location.search).get("store");
  if (fromQuery) $("#store-url").value = fromQuery;
  try {
    const saved = await loadLast();
    if (saved?.result?.store) {
      $("[data-restore-label]").textContent = `${saved.result.store.name || saved.result.store.canonicalDomain}, ${new Date(saved.savedAt).toLocaleString()}`;
      $("#restore").hidden = false;
    }
  } catch {
    /* storage unavailable (private mode) — the tool still works */
  }
}

init();
