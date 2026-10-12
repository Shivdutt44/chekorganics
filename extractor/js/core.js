/* ==========================================================================
   Shopify Store Extractor — core (browser-only, no backend)

   Runs entirely in the visitor's browser, so it can only read Shopify
   endpoints that send CORS headers (Access-Control-Allow-Origin: *):
     /meta.json · /products.json · /products/{handle}.js
     /collections.json · /collections/{handle}/products.json · /pages.json
     cdn.shopify.com images
   Storefront HTML, sitemaps, robots.txt, blogs/.atom and policy .json do not
   send CORS headers, so banners, posters, blog articles, SEO meta, JSON-LD
   and sitemap URLs are reported as unavailable — never guessed.

   This module has no DOM dependency: HTML helpers are injected, which keeps
   it testable under Node (see tests/).
   ========================================================================== */

export const PAGE_LIMIT = 250;

export const DEFAULT_OPTIONS = Object.freeze({
  types: { products: true, collections: true, pages: true, images: true },
  enrichProducts: true,        // /products/{handle}.js → image alt text, barcode, media
  maxEnrich: 1000,
  collectionProductRefs: true, // /collections/{handle}/products.json → product handles
  maxPages: 100,               // pagination cap per feed (100 × 250 = 25,000 items)
  concurrency: 3,
  requestsPerSecond: 3,
  maxRetries: 3,
  timeoutMs: 20000,
});

export const UNAVAILABLE_IN_BROWSER = Object.freeze({
  banners: "Homepage banners live in storefront HTML, which Shopify serves without CORS headers.",
  posters: "Posters/promotional graphics live in storefront HTML, which Shopify serves without CORS headers.",
  blogs: "Blog pages and /blogs/{handle}.atom are served without CORS headers; /blogs/{handle}/articles.json is not a public storefront endpoint.",
  articles: "Blog article pages are served without CORS headers.",
  sitemap: "sitemap.xml and robots.txt are served without CORS headers.",
  seo: "SEO titles, meta descriptions, canonical URLs and JSON-LD live in page HTML, which is served without CORS headers.",
  policies: "/policies/*.json and policy pages are served without CORS headers.",
});

/* ------------------------------------------------------------ errors */
export class ExtractError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export class CancelledError extends Error {
  constructor() {
    super("Extraction cancelled");
    this.code = "CANCELLED";
  }
}

/* ------------------------------------------------------------ URL input */
/**
 * Validates and normalises the Store URL field. Returns { inputUrl, origin, host }.
 * Always https: a GitHub Pages site is https, and browsers block http requests from it.
 */
export function normalizeStoreUrl(input) {
  let raw = String(input ?? "").trim();
  if (!raw) throw new ExtractError("INVALID_URL", "Enter a store URL, e.g. https://example.com");
  if (raw.length > 2048) throw new ExtractError("INVALID_URL", "That URL is too long.");
  if (/\s/.test(raw)) throw new ExtractError("INVALID_URL", "A URL can't contain spaces.");
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw);
  if (scheme && !/^https?$/i.test(scheme[1])) {
    throw new ExtractError("UNSUPPORTED_PROTOCOL", `"${scheme[1]}:" URLs aren't supported. Use the store's https:// address.`);
  }
  if (/^(javascript|data|file|ftp|mailto|blob):/i.test(raw)) {
    throw new ExtractError("UNSUPPORTED_PROTOCOL", "Only http(s) store URLs are supported.");
  }
  if (raw.startsWith("//")) raw = "https:" + raw;
  else if (!scheme) raw = "https://" + raw;

  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new ExtractError("INVALID_URL", "That doesn't look like a valid URL.");
  }
  if (u.username || u.password) throw new ExtractError("INVALID_URL", "URLs with a username or password aren't allowed.");
  if (u.port && u.port !== "443" && u.port !== "80") throw new ExtractError("INVALID_URL", "Custom ports aren't supported; enter the public store domain.");
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (/^\d+(\.\d+){3}$/.test(host) || host.startsWith("[")) throw new ExtractError("INVALID_URL", "Enter the store's domain name, not an IP address.");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new ExtractError("INVALID_URL", "Local and internal addresses aren't supported. Enter a public store domain.");
  }
  const labels = host.split(".");
  if (labels.length < 2 || labels.some(l => !l || l.length > 63 || !/^[a-z0-9-]+$/.test(l) || l.startsWith("-") || l.endsWith("-"))) {
    throw new ExtractError("INVALID_URL", "The domain name is malformed.");
  }
  if (!/^(xn--[a-z0-9-]+|[a-z]{2,63})$/.test(labels[labels.length - 1])) throw new ExtractError("INVALID_URL", "The domain has an invalid ending.");
  return { inputUrl: String(input).trim(), origin: `https://${host}`, host };
}

/* ------------------------------------------------------------ requests */
export const defaultSleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const t = setTimeout(done, Math.max(0, ms));
    function done() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(t);
      reject(new CancelledError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });

const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);

/**
 * Polite request queue: concurrency limit, minimum spacing between requests,
 * per-request timeout, bounded exponential backoff with jitter for transient
 * failures (network errors, 408/429/5xx). Never throws for HTTP failures —
 * returns { ok:false, error } so one bad URL never aborts the job.
 */
export class Requester {
  constructor(opts = {}) {
    this.fetchImpl = opts.fetchImpl || ((...a) => globalThis.fetch(...a));
    this.sleep = opts.sleep || defaultSleep;
    this.random = opts.random || Math.random;
    this.now = opts.now || (() => Date.now());
    this.signal = opts.signal;
    this.concurrency = Math.max(1, opts.concurrency ?? 3);
    this.interval = 1000 / Math.max(0.2, opts.requestsPerSecond ?? 3);
    this.maxRetries = opts.maxRetries ?? 3;
    this.baseDelayMs = opts.baseDelayMs ?? 800;
    this.maxDelayMs = opts.maxDelayMs ?? 15000;
    this.timeoutMs = opts.timeoutMs ?? 20000;
    this.onEvent = opts.onEvent || (() => {});
    this.stats = { requests: 0, retries: 0, failures: 0, bytes: 0, rateLimited: 0 };
    this.active = 0;
    this.queue = [];
    this.nextAt = 0;
  }

  checkCancelled() {
    if (this.signal?.aborted) throw new CancelledError();
  }

  async slot() {
    if (this.active >= this.concurrency) await new Promise(r => this.queue.push(r));
    this.active++;
    const now = this.now();
    const at = Math.max(now, this.nextAt);
    this.nextAt = at + this.interval;
    if (at > now) await this.sleep(at - now, this.signal).catch(e => {
      this.release();
      throw e;
    });
  }

  release() {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  backoff(attempt) {
    const exp = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** attempt);
    return Math.round(exp * (0.5 + this.random() * 0.5));
  }

  async request(url, { as = "json", maxBytes = 25 * 1024 * 1024 } = {}) {
    let attempt = 0;
    for (;;) {
      this.checkCancelled();
      await this.slot();
      let res, err, body;
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      this.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        this.stats.requests++;
        this.onEvent({ type: "request", url });
        res = await this.fetchImpl(url, { signal: ctrl.signal, credentials: "omit", cache: "no-store", headers: as === "json" ? { accept: "application/json" } : {} });
        if (res.ok) {
          const len = Number(res.headers?.get?.("content-length"));
          if (len && len > maxBytes) throw new ExtractError("TOO_LARGE", `Response is ${formatBytes(len)} (limit ${formatBytes(maxBytes)})`);
          body = as === "blob" ? await res.blob() : await res.text();
          const size = as === "blob" ? body.size : body.length;
          if (size > maxBytes) throw new ExtractError("TOO_LARGE", `Response is ${formatBytes(size)} (limit ${formatBytes(maxBytes)})`);
          this.stats.bytes += size;
        }
      } catch (e) {
        err = e;
      } finally {
        clearTimeout(timer);
        this.signal?.removeEventListener("abort", onAbort);
        this.release();
      }

      if (this.signal?.aborted) throw new CancelledError();

      if (err) {
        if (err.code === "TOO_LARGE") return this.fail(url, err.code, err.message, attempt + 1);
        const timedOut = err.name === "AbortError";
        // A CORS block and a network outage look identical to a browser ("Failed to fetch"),
        // so network errors get one retry only.
        const limit = timedOut ? this.maxRetries : Math.min(1, this.maxRetries);
        if (attempt < limit) {
          await this.wait(url, attempt++, timedOut ? "timeout" : "network");
          continue;
        }
        return this.fail(url, timedOut ? "TIMEOUT" : "NETWORK_OR_CORS",
          timedOut ? `Timed out after ${Math.round(this.timeoutMs / 1000)}s` : "Network error or blocked by the browser (no CORS access to this endpoint)", attempt + 1);
      }

      if (res.status === 429) this.stats.rateLimited++;
      if (RETRY_STATUSES.has(res.status) && attempt < this.maxRetries) {
        if (res.status === 429) this.interval = Math.min(Math.max(this.interval * 2, 1000), 5000); // slow down for the rest of the job
        await this.wait(url, attempt++, `HTTP ${res.status}`, retryAfterMs(res));
        continue;
      }
      if (!res.ok) {
        const msg = res.status === 429 ? "Rate limited by the store (HTTP 429) after retries" : res.status === 404 ? "Not found (HTTP 404) — endpoint unavailable on this store" : `HTTP ${res.status}`;
        return this.fail(url, `HTTP_${res.status}`, msg, attempt + 1, res.status);
      }
      return { ok: true, status: res.status, url, finalUrl: res.url || url, body, attempts: attempt + 1, contentType: res.headers?.get?.("content-type") || "" };
    }
  }

  async wait(url, attempt, reason, minDelay = 0) {
    this.stats.retries++;
    const delay = Math.max(minDelay, this.backoff(attempt + 1));
    this.onEvent({ type: "retry", url, attempt: attempt + 1, reason, delay });
    await this.sleep(delay, this.signal);
  }

  fail(url, code, message, attempts, status = 0) {
    this.stats.failures++;
    this.onEvent({ type: "error", url, code, message });
    return { ok: false, status, url, attempts, error: { code, message } };
  }

  /** GET + JSON.parse. Treats HTML served with 200 (password page, app proxy) as an error. */
  async json(url) {
    const r = await this.request(url, { as: "json" });
    if (!r.ok) return r;
    const text = String(r.body).replace(/^﻿/, "");
    if (/^\s*</.test(text)) {
      return this.fail(url, "NOT_JSON", "The store returned HTML instead of JSON (password-protected store or endpoint disabled)", r.attempts, r.status);
    }
    try {
      return { ...r, data: JSON.parse(text), body: undefined };
    } catch (e) {
      return this.fail(url, "INVALID_JSON", `Invalid JSON: ${e.message}`, r.attempts, r.status);
    }
  }
}

function retryAfterMs(res) {
  // Shopify does not expose Retry-After to cross-origin scripts, but honour it if a store does.
  const v = res.headers?.get?.("retry-after");
  if (!v) return 0;
  if (/^\d+$/.test(v.trim())) return Math.min(Number(v) * 1000, 60000);
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : Math.min(Math.max(0, t - Date.now()), 60000);
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return "–";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

/* ------------------------------------------------------------ pagination */
/**
 * Walks a Shopify ?limit=250&page=N feed. Stops on an empty or short page,
 * on a page that adds no new ids (loop protection), on maxPages, or on error.
 * @returns {{ items:any[], complete:boolean, pages:number, stopReason:string, error:object|null }}
 */
export async function paginate(requester, baseUrl, key, { limit = PAGE_LIMIT, maxPages = 100, onPage } = {}) {
  const items = [];
  const seen = new Set();
  const sep = baseUrl.includes("?") ? "&" : "?";
  for (let page = 1; page <= maxPages; page++) {
    const url = `${baseUrl}${sep}limit=${limit}&page=${page}`;
    const r = await requester.json(url);
    if (!r.ok) {
      return { items, complete: false, pages: page - 1, stopReason: page === 1 ? "unavailable" : "error", error: { url, ...r.error, status: r.status } };
    }
    const list = r.data?.[key];
    if (!Array.isArray(list)) {
      return { items, complete: false, pages: page - 1, stopReason: "unexpected-shape", error: { url, code: "UNEXPECTED_SHAPE", message: `Response has no "${key}" array` } };
    }
    let added = 0;
    for (const it of list) {
      const id = it?.id ?? it?.handle ?? JSON.stringify(it);
      if (seen.has(id)) continue;
      seen.add(id);
      items.push(it);
      added++;
    }
    onPage?.({ page, received: list.length, added, total: items.length });
    if (list.length === 0) return { items, complete: true, pages: page, stopReason: "empty-page", error: null };
    if (added === 0) return { items, complete: true, pages: page, stopReason: "no-new-items", error: null };
    if (list.length < limit) return { items, complete: true, pages: page, stopReason: "last-page", error: null };
  }
  return { items, complete: false, pages: maxPages, stopReason: "page-cap", error: null };
}

/* ------------------------------------------------------------ value helpers */
export const toNumber = v => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const str = v => (v === undefined || v === null || v === "" ? null : String(v));
const arr = v => (Array.isArray(v) ? v : []);
const tagList = t => (Array.isArray(t) ? t : typeof t === "string" && t.trim() ? t.split(",") : []).map(x => String(x).trim()).filter(Boolean);
export const absolutize = (u, origin) => {
  if (!u) return null;
  try {
    const s = String(u).trim();
    return new URL(s.startsWith("//") ? "https:" + s : s, origin + "/").toString();
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------ images */
const SIZE_SUFFIX = /_(?:\d{1,5}x\d{0,5}|x\d{1,5}|pico|icon|thumb|small|compact|medium|large|grande|original|master)(?:@\dx)?(?:_crop_[a-z]+)?(?=\.[a-z0-9]+$)/i;
const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml", heic: "image/heic" };

/**
 * Normalises Shopify CDN image URLs. "store.com/cdn/shop/files/x.png" and
 * "cdn.shopify.com/s/files/1/…/files/x.png" are the same asset, so the
 * de-duplication key ignores the host, width/height/crop params and legacy
 * "_800x" size suffixes.
 */
export function imageInfo(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { key: String(url), canonicalUrl: String(url), filename: null, ext: null, mimeType: null, isShopifyCdn: false };
  }
  const p = u.pathname;
  let folder = null, file = null, m;
  if (u.hostname === "cdn.shopify.com" && (m = /^\/s\/files\/\d+\/\d+\/\d+\/\d+\/(?:(files|products|collections|articles)\/)?(.+)$/.exec(p))) {
    folder = m[1] || "files";
    file = m[2];
  } else if ((m = /^\/cdn\/shop\/(files|products|collections|articles)\/(.+)$/.exec(p))) {
    folder = m[1];
    file = m[2];
  }
  const canonical = new URL(u.toString());
  canonical.hash = "";
  ["width", "height", "crop", "format", "pad_color", "scale"].forEach(k => canonical.searchParams.delete(k));
  if (folder) canonical.pathname = canonical.pathname.replace(SIZE_SUFFIX, "");
  let filename;
  try {
    filename = decodeURIComponent(canonical.pathname.split("/").pop() || "");
  } catch {
    filename = canonical.pathname.split("/").pop() || "";
  }
  const ext = (/\.([a-z0-9]+)$/i.exec(filename) || [])[1]?.toLowerCase() || null;
  return {
    key: folder ? `shopify:${folder}/${file.replace(SIZE_SUFFIX, "")}`.toLowerCase() : canonical.toString(),
    canonicalUrl: canonical.toString(),
    filename: filename || null,
    ext,
    mimeType: MIME[ext] || null,
    isShopifyCdn: !!folder,
  };
}

const CATEGORY_PRIORITY = ["collection_image", "product_image", "page_image", "other"];

/** De-duplicates images across products, collections and pages, keeping provenance. */
export class ImageRegistry {
  constructor({ maxImages = 50000 } = {}) {
    this.map = new Map();
    this.maxImages = maxImages;
    this.truncated = false;
  }

  add({ url, alt = null, width = null, height = null, category, evidence, method, source }) {
    if (!url || /^data:/i.test(url)) return null;
    const info = imageInfo(url);
    let rec = this.map.get(info.key);
    if (!rec) {
      if (this.map.size >= this.maxImages) {
        this.truncated = true;
        return null;
      }
      rec = {
        id: hashString(info.key),
        url: info.canonicalUrl,
        originalSourceUrl: url,
        canonicalUrl: info.canonicalUrl,
        filename: info.filename,
        extension: info.ext,
        mimeType: info.mimeType,
        mimeTypeSource: info.mimeType ? "file extension" : null,
        isShopifyCdn: info.isShopifyCdn,
        alt: null,
        altTexts: [],
        width: null,
        height: null,
        dimensionsSource: null,
        category,
        categoryEvidence: evidence,
        categories: [],
        extractionMethods: [],
        sourcePages: [],
        sourceCount: 0,
        sources: [],
        download: { status: "not_requested" },
      };
      this.map.set(info.key, rec);
    }
    if (alt && String(alt).trim()) {
      const a = String(alt).trim();
      if (!rec.alt) rec.alt = a;
      if (!rec.altTexts.includes(a) && rec.altTexts.length < 5) rec.altTexts.push(a);
    }
    if (width && height && !rec.width) {
      rec.width = toNumber(width);
      rec.height = toNumber(height);
      rec.dimensionsSource = method;
    }
    if (!rec.categories.includes(category)) rec.categories.push(category);
    if (CATEGORY_PRIORITY.indexOf(category) < CATEGORY_PRIORITY.indexOf(rec.category)) {
      rec.category = category;
      rec.categoryEvidence = evidence;
    }
    if (!rec.extractionMethods.includes(method)) rec.extractionMethods.push(method);
    rec.sourceCount++;
    if (source?.url && !rec.sourcePages.includes(source.url) && rec.sourcePages.length < 25) rec.sourcePages.push(source.url);
    if (rec.sources.length < 25) rec.sources.push({ type: source?.type || null, title: source?.title || null, url: source?.url || null, method, evidence });
    return rec;
  }

  get size() {
    return this.map.size;
  }

  list() {
    return [...this.map.values()];
  }
}

/** Short, stable, non-cryptographic id (FNV-1a, 32-bit → base36). */
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, "0");
}

/* ------------------------------------------------------------ normalisers */
/* Fallback used when no DOM is available (Node, workers). The browser UI injects
   DOMParser-based helpers from html.js instead. */
function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? "").replace(/&amp;/g, "&") : null;
}
const stripTags = s => String(s || "").replace(/<(script|style)\b[\s\S]*?<\/(script|style)>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const noHtml = {
  toText: stripTags,
  headings: s => [...String(s || "").matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)].map(m => ({ level: Number(m[1]), text: stripTags(m[2]) })).filter(h => h.text),
  links: (s, base) => [...String(s || "").matchAll(/<a\b[^>]*>/gi)].map(m => absolutize(attr(m[0], "href"), base)).filter(u => u && /^https?:/.test(u)).map(url => ({ url, text: null })),
  images: (s, base) =>
    [...String(s || "").matchAll(/<img\b[^>]*>/gi)]
      .map(m => {
        const raw = attr(m[0], "data-src") || attr(m[0], "src");
        const url = raw && !/^data:/i.test(raw) ? absolutize(raw.replace("{width}", "1080"), base) : null;
        return url ? { url, alt: attr(m[0], "alt")?.trim() || null, width: toNumber(attr(m[0], "width")), height: toNumber(attr(m[0], "height")) } : null;
      })
      .filter(Boolean),
};

export function normalizeProduct(p, { origin, extractedAt, html = noHtml, currency = null }) {
  const url = `${origin}/products/${p.handle}`;
  const variants = arr(p.variants).map(v => {
    const out = {
      id: v.id ?? null,
      productId: p.id ?? null,
      title: str(v.title),
      option1: str(v.option1),
      option2: str(v.option2),
      option3: str(v.option3),
      sku: str(v.sku),
      price: toNumber(v.price),
      compareAtPrice: toNumber(v.compare_at_price),
      available: typeof v.available === "boolean" ? v.available : null,
      requiresShipping: typeof v.requires_shipping === "boolean" ? v.requires_shipping : null,
      taxable: typeof v.taxable === "boolean" ? v.taxable : null,
      grams: toNumber(v.grams),
      position: toNumber(v.position),
      imageUrl: v.featured_image?.src ? absolutize(v.featured_image.src, origin) : null,
      url: v.id ? `${url}?variant=${v.id}` : null,
      createdAt: str(v.created_at),
      updatedAt: str(v.updated_at),
    };
    if ("barcode" in v) out.barcode = str(v.barcode);
    return out;
  });
  const images = arr(p.images).map(im => ({
    id: im.id ?? null,
    url: absolutize(im.src, origin),
    alt: str(im.alt),
    width: toNumber(im.width),
    height: toNumber(im.height),
    position: toNumber(im.position),
    variantIds: arr(im.variant_ids),
  }));
  const prices = variants.map(v => v.price).filter(n => n !== null);
  const compares = variants.map(v => v.compareAtPrice).filter(n => n !== null);
  const anyAvail = variants.some(v => v.available === true);
  const allUnknown = variants.every(v => v.available === null);
  return {
    id: p.id ?? null,
    title: str(p.title),
    handle: str(p.handle),
    url,
    vendor: str(p.vendor),
    productType: str(p.product_type),
    tags: tagList(p.tags),
    status: p.published_at ? "published" : null,
    publishedAt: str(p.published_at),
    createdAt: str(p.created_at),
    updatedAt: str(p.updated_at),
    descriptionHtml: str(p.body_html),
    descriptionText: p.body_html ? html.toText(p.body_html) || null : null,
    descriptionHeadings: p.body_html ? html.headings(p.body_html) : [],
    descriptionImages: p.body_html ? html.images(p.body_html, url) : [],
    options: arr(p.options).map(o => ({ name: str(o.name), position: toNumber(o.position), values: arr(o.values).map(String) })),
    variants,
    images,
    featuredImage: images[0]?.url || null,
    priceMin: prices.length ? Math.min(...prices) : null,
    priceMax: prices.length ? Math.max(...prices) : null,
    compareAtPriceMax: compares.length ? Math.max(...compares) : null,
    currency,
    available: allUnknown ? null : anyAvail,
    seo: null, // only available from product page HTML (no CORS)
    sources: ["products.json"],
    extractedAt,
  };
}

/** Merges /products/{handle}.js into a product: image alt text, barcode, media (incl. video), inventory policy. */
export function enrichProduct(product, js, origin) {
  if (!js || typeof js !== "object") return product;
  const mediaByKey = new Map();
  for (const m of arr(js.media)) {
    const src = m.src || m.preview_image?.src;
    if (src) mediaByKey.set(imageInfo(absolutize(src, origin)).key, m);
  }
  for (const im of product.images) {
    const m = mediaByKey.get(imageInfo(im.url).key);
    if (m && m.alt && !im.alt) im.alt = String(m.alt);
  }
  product.media = arr(js.media).map(m => ({
    id: m.id ?? null,
    type: str(m.media_type),
    alt: str(m.alt),
    url: absolutize(m.src || m.preview_image?.src, origin),
    previewImage: absolutize(m.preview_image?.src, origin),
    width: toNumber(m.width ?? m.preview_image?.width),
    height: toNumber(m.height ?? m.preview_image?.height),
    position: toNumber(m.position),
  }));
  const jsVariants = new Map(arr(js.variants).map(v => [v.id, v]));
  for (const v of product.variants) {
    const jv = jsVariants.get(v.id);
    if (!jv) continue;
    if ("barcode" in jv) v.barcode = str(jv.barcode);
    if (!v.sku && jv.sku) v.sku = str(jv.sku);
    if ("inventory_management" in jv) v.inventoryManagement = str(jv.inventory_management);
    if (typeof jv.available === "boolean" && v.available === null) v.available = jv.available;
  }
  product.sources.push("products/{handle}.js");
  return product;
}

export function normalizeCollection(c, { origin, extractedAt, html = noHtml }) {
  const url = `${origin}/collections/${c.handle}`;
  return {
    id: c.id ?? null,
    title: str(c.title),
    handle: str(c.handle),
    url,
    descriptionHtml: str(c.description ?? c.body_html),
    descriptionText: c.description || c.body_html ? html.toText(c.description ?? c.body_html) || null : null,
    publishedAt: str(c.published_at),
    updatedAt: str(c.updated_at),
    productsCount: toNumber(c.products_count),
    image: c.image?.src
      ? { url: absolutize(c.image.src, origin), alt: str(c.image.alt), width: toNumber(c.image.width), height: toNumber(c.image.height) }
      : null,
    productHandles: [],
    productRefsSource: null,
    productRefsComplete: null,
    seo: null,
    sources: ["collections.json"],
    extractedAt,
  };
}

export function normalizePage(pg, { origin, extractedAt, html = noHtml }) {
  const url = `${origin}/pages/${pg.handle}`;
  const body = pg.body_html || "";
  return {
    id: pg.id ?? null,
    title: str(pg.title),
    handle: str(pg.handle),
    path: `/pages/${pg.handle}`,
    url,
    author: str(pg.author),
    createdAt: str(pg.created_at),
    publishedAt: str(pg.published_at),
    updatedAt: str(pg.updated_at),
    contentHtml: str(body),
    contentText: body ? html.toText(body) || null : null,
    headings: body ? html.headings(body) : [],
    links: body ? html.links(body, url) : [],
    images: body ? html.images(body, url) : [],
    seo: null,
    sources: ["pages.json"],
    extractedAt,
  };
}

/* ------------------------------------------------------------ validation */
/**
 * Probes the store's CORS-readable endpoints. Never throws for network/HTTP
 * failures; returns a report the UI can show.
 */
export async function validateStore(input, { requester }) {
  const { origin, inputUrl, host } = normalizeStoreUrl(input);
  const probe = path => requester.json(origin + path);
  const [meta, products, collections, pages] = await Promise.all([
    probe("/meta.json"),
    probe("/products.json?limit=1"),
    probe("/collections.json?limit=1"),
    probe("/pages.json?limit=1"),
  ]);
  const ep = (r, key) => (r.ok && (key ? Array.isArray(r.data?.[key]) : r.data && typeof r.data === "object") ? "available" : r.error?.message || "unavailable");
  const endpoints = {
    "meta.json": ep(meta),
    "products.json": ep(products, "products"),
    "collections.json": ep(collections, "collections"),
    "pages.json": ep(pages, "pages"),
  };
  const m = meta.ok ? meta.data : null;
  const canonicalDomain = m?.url ? normalizeOrigin(m.url) : m?.domain ? `https://${m.domain}` : null;
  const reachable = [meta, products, collections, pages].some(r => r.ok);
  const isShopify = !!(m?.myshopify_domain || (products.ok && Array.isArray(products.data?.products)));
  const extractable = Object.values(endpoints).filter(v => v === "available").length;
  const messages = [];
  if (!reachable) {
    messages.push("None of the store's public JSON endpoints could be read. Check the domain, or the store may be password-protected, not on Shopify, or blocking cross-origin requests.");
  } else if (!isShopify) {
    messages.push("The store responded, but Shopify product data couldn't be confirmed.");
  }
  if (canonicalDomain && normalizeOrigin(canonicalDomain) !== origin) messages.push(`The store's primary domain is ${canonicalDomain}. Extraction will use it.`);
  return {
    inputUrl,
    normalizedUrl: origin,
    host,
    canonicalDomain: canonicalDomain || origin,
    reachable,
    isShopify,
    platform: isShopify ? "Shopify" : null,
    extractable: extractable > 0,
    endpoints,
    store: m
      ? {
          name: str(m.name),
          description: str(m.description),
          currency: str(m.currency),
          moneyFormat: str(m.money_format),
          country: str(m.country),
          province: str(m.province),
          city: str(m.city),
          domain: str(m.domain),
          myshopifyDomain: str(m.myshopify_domain),
          shipsToCountries: arr(m.ships_to_countries),
          publishedProductsCount: toNumber(m.published_products_count),
          publishedCollectionsCount: toNumber(m.published_collections_count),
        }
      : null,
    messages,
  };
}

function normalizeOrigin(u) {
  try {
    const x = new URL(String(u).startsWith("http") ? u : `https://${u}`);
    return `https://${x.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ the job */
export const STAGES = ["validate", "products", "enrich", "collections", "collectionRefs", "pages", "images", "done"];

/**
 * Runs a full extraction. Partial results are always returned; the job only
 * throws CancelledError (caught by the UI) — every other failure is recorded
 * in result.errors and reflected in result.coverage.
 *
 * @param {string} input store URL
 * @param {object} opts DEFAULT_OPTIONS overrides
 * @param {object} env { fetchImpl, signal, onProgress, html, sleep, now }
 */
export async function runExtraction(input, opts = {}, env = {}) {
  const options = { ...DEFAULT_OPTIONS, ...opts, types: { ...DEFAULT_OPTIONS.types, ...(opts.types || {}) } };
  const now = env.now || (() => Date.now());
  const startedAt = now();
  const html = env.html || noHtml;
  const errors = [];
  const progress = {
    stage: "validate",
    stageLabel: "Validating store",
    percent: 0,
    requests: 0,
    retries: 0,
    failed: 0,
    discovered: 0,
    processed: 0,
    extracted: 0,
    images: 0,
    elapsedMs: 0,
    log: [],
  };
  const requester = new Requester({
    fetchImpl: env.fetchImpl,
    sleep: env.sleep,
    signal: env.signal,
    concurrency: options.concurrency,
    requestsPerSecond: options.requestsPerSecond,
    maxRetries: options.maxRetries,
    timeoutMs: options.timeoutMs,
    onEvent: ev => {
      if (ev.type === "retry") note(`Retry ${ev.attempt} for ${shortUrl(ev.url)} (${ev.reason}) in ${Math.round(ev.delay / 100) / 10}s`);
      emit();
    },
  });
  const STAGE_WEIGHT = { validate: [0, 5], products: [5, 35], enrich: [35, 60], collections: [60, 68], collectionRefs: [68, 85], pages: [85, 93], images: [93, 99], done: [100, 100] };
  let stageFrac = 0;

  function note(msg) {
    progress.log.push({ at: new Date(now()).toISOString(), msg });
    if (progress.log.length > 200) progress.log.shift();
  }
  function emit() {
    const [a, b] = STAGE_WEIGHT[progress.stage] || [0, 100];
    progress.percent = Math.min(100, Math.round(a + (b - a) * Math.min(1, stageFrac)));
    progress.requests = requester.stats.requests;
    progress.retries = requester.stats.retries;
    progress.failed = errors.length;
    progress.images = images.size;
    progress.elapsedMs = now() - startedAt;
    env.onProgress?.({ ...progress, log: progress.log.slice(-30) });
  }
  function stage(name, label) {
    progress.stage = name;
    progress.stageLabel = label;
    stageFrac = 0;
    note(label);
    emit();
  }
  function recordError(where, err, extra = {}) {
    errors.push({ stage: where, url: err?.url || extra.url || null, code: err?.code || "ERROR", message: err?.message || String(err), status: err?.status || null, at: new Date(now()).toISOString(), ...extra });
    emit();
  }

  const images = new ImageRegistry();
  const result = {
    store: null,
    products: [],
    collections: [],
    pages: [],
    blogs: [],
    articles: [],
    banners: [],
    posters: [],
    images: [],
    discoveredUrls: [],
    errors,
    coverage: {},
    summary: {},
  };

  const want = options.types;
  // Hoisted so a cancelled or crashed run can still return what it collected.
  const productsByHandle = new Map();
  let collectionsSoFar = [];
  let pagesSoFar = [];
  let forcedStatus = null;

  try {
    await stages();
  } catch (e) {
    if (e?.code === "CANCELLED") {
      note("Cancelled — keeping the data collected so far");
      return finish("cancelled");
    }
    recordError("internal", { code: "INTERNAL", message: e?.message || String(e) });
    return finish("failed");
  }
  return finish(forcedStatus);

  async function stages() {
  /* -------- validate */
  stage("validate", "Validating store");
  const v = await validateStore(input, { requester });
  const origin = v.canonicalDomain || v.normalizedUrl;
  const extractedAt = new Date(now()).toISOString();
  const currency = v.store?.currency || null;
  result.store = {
    inputUrl: v.inputUrl,
    canonicalDomain: origin,
    platform: v.platform,
    extractedAt,
    name: v.store?.name ?? null,
    currency,
    currencySource: currency ? "meta.json" : null,
    details: v.store,
    endpoints: v.endpoints,
    mode: "browser (CORS-readable JSON endpoints only)",
  };
  if (!v.reachable) {
    recordError("validate", { code: "UNREACHABLE", message: v.messages[0] || "Store unreachable", url: v.normalizedUrl });
    forcedStatus = "failed";
    return;
  }
  const ctx = { origin, extractedAt, html };

  /* -------- products */
  if (want.products || want.images) {
    stage("products", "Fetching products.json");
    const r = await paginate(requester, `${origin}/products.json`, "products", {
      maxPages: options.maxPages,
      onPage: ({ page, total }) => {
        stageFrac = v.store?.publishedProductsCount ? total / v.store.publishedProductsCount : Math.min(0.95, page / 10);
        progress.discovered = total;
        note(`products.json page ${page}: ${total} products so far`);
        emit();
      },
    });
    if (r.error) recordError("products", r.error);
    for (const p of r.items) {
      if (!p?.handle || productsByHandle.has(p.handle)) continue;
      productsByHandle.set(p.handle, normalizeProduct(p, { ...ctx, currency }));
    }
    result.coverage.products = coverageFor(r, productsByHandle.size, v.store?.publishedProductsCount, "products.json");

    if (want.products && options.enrichProducts && productsByHandle.size) {
      stage("enrich", "Fetching image alt text & barcodes (products/{handle}.js)");
      const list = [...productsByHandle.values()].slice(0, options.maxEnrich);
      let done = 0, failed = 0;
      await pool(list, options.concurrency, async p => {
        const jr = await requester.json(`${origin}/products/${encodeURIComponent(p.handle)}.js`);
        if (jr.ok) enrichProduct(p, jr.data, origin);
        else {
          failed++;
          recordError("enrich", { ...jr.error, url: jr.url }, { item: p.handle });
        }
        done++;
        progress.processed = done;
        stageFrac = done / list.length;
        emit();
      });
      result.coverage.productEnrichment = {
        status: failed === 0 && list.length === productsByHandle.size ? "complete" : "partial",
        source: "products/{handle}.js",
        notes: [
          `${list.length - failed} of ${productsByHandle.size} products enriched with image alt text, barcode and media.`,
          ...(list.length < productsByHandle.size ? [`Enrichment capped at ${options.maxEnrich} products.`] : []),
        ],
      };
    }

    for (const p of productsByHandle.values()) {
      p.images.forEach(im => images.add({ url: im.url, alt: im.alt, width: im.width, height: im.height, category: "product_image", evidence: "product image in products.json", method: "products.json", source: { type: "product", title: p.title, url: p.url } }));
      (p.media || []).filter(m => m.type !== "image" && m.previewImage).forEach(m =>
        images.add({ url: m.previewImage, alt: m.alt, width: m.width, height: m.height, category: "product_image", evidence: `preview image of product ${m.type}`, method: "products/{handle}.js", source: { type: "product", title: p.title, url: p.url } })
      );
      p.descriptionImages.forEach(im => images.add({ url: im.url, alt: im.alt, width: im.width, height: im.height, category: "product_image", evidence: "embedded in the product description HTML", method: "product body_html", source: { type: "product", title: p.title, url: p.url } }));
    }
    if (want.products) result.products = [...productsByHandle.values()];
    progress.extracted += result.products.length;
    emit();
  }

  /* -------- collections */
  if (want.collections || want.images) {
    stage("collections", "Fetching collections.json");
    const r = await paginate(requester, `${origin}/collections.json`, "collections", {
      maxPages: options.maxPages,
      onPage: ({ total, page }) => {
        stageFrac = Math.min(0.95, page / 4);
        note(`collections.json page ${page}: ${total} collections so far`);
        emit();
      },
    });
    if (r.error) recordError("collections", r.error);
    const seen = new Set();
    const collections = (collectionsSoFar = []);
    for (const c of r.items) {
      if (!c?.handle || seen.has(c.handle)) continue;
      seen.add(c.handle);
      collections.push(normalizeCollection(c, ctx));
    }
    result.coverage.collections = coverageFor(r, collections.length, v.store?.publishedCollectionsCount, "collections.json", {
      countNote: "meta.json's published_collections_count can include collections that collections.json doesn't list, so a small difference isn't necessarily missing data.",
    });

    if (want.collections && options.collectionProductRefs && collections.length) {
      stage("collectionRefs", "Mapping products to collections");
      let done = 0, incomplete = 0;
      await pool(collections, options.concurrency, async c => {
        const pr = await paginate(requester, `${origin}/collections/${encodeURIComponent(c.handle)}/products.json`, "products", { maxPages: options.maxPages });
        c.productHandles = pr.items.map(p => p.handle).filter(Boolean);
        c.productRefsSource = "collections/{handle}/products.json";
        c.productRefsComplete = pr.complete;
        if (!pr.complete) incomplete++;
        if (pr.error) recordError("collectionRefs", pr.error, { item: c.handle });
        done++;
        progress.processed = done;
        stageFrac = done / collections.length;
        emit();
      });
      result.coverage.collectionProductRefs = {
        status: incomplete ? "partial" : "complete",
        source: "collections/{handle}/products.json",
        notes: incomplete ? [`Product lists for ${incomplete} collection(s) are incomplete; see errors.`] : [],
      };
    }

    for (const c of collections) {
      if (c.image?.url) images.add({ url: c.image.url, alt: c.image.alt, width: c.image.width, height: c.image.height, category: "collection_image", evidence: "collection image in collections.json", method: "collections.json", source: { type: "collection", title: c.title, url: c.url } });
      if (c.descriptionHtml) html.images(c.descriptionHtml, c.url).forEach(im => images.add({ url: im.url, alt: im.alt, width: im.width, height: im.height, category: "collection_image", evidence: "embedded in the collection description HTML", method: "collection description", source: { type: "collection", title: c.title, url: c.url } }));
    }
    if (want.collections) result.collections = collections;
    progress.extracted += result.collections.length;
    emit();
  }

  /* -------- pages */
  if (want.pages || want.images) {
    stage("pages", "Fetching pages.json");
    const r = await paginate(requester, `${origin}/pages.json`, "pages", {
      maxPages: options.maxPages,
      onPage: ({ total, page }) => {
        stageFrac = Math.min(0.95, page / 4);
        note(`pages.json page ${page}: ${total} pages so far`);
        emit();
      },
    });
    if (r.error) recordError("pages", r.error);
    const seen = new Set();
    const pages = (pagesSoFar = []);
    for (const pg of r.items) {
      if (!pg?.handle || seen.has(pg.handle)) continue;
      seen.add(pg.handle);
      pages.push(normalizePage(pg, ctx));
    }
    result.coverage.pages = coverageFor(r, pages.length, null, "pages.json", {
      extraNotes: ["pages.json is an optional endpoint: it isn't available on every store. Policy pages (/policies/*) aren't readable from a browser."],
    });
    for (const pg of pages) {
      pg.images.forEach(im => images.add({ url: im.url, alt: im.alt, width: im.width, height: im.height, category: "page_image", evidence: "image inside the page body_html", method: "pages.json", source: { type: "page", title: pg.title, url: pg.url } }));
    }
    if (want.pages) result.pages = pages;
    progress.extracted += result.pages.length;
    emit();
  }

  /* -------- images */
  if (want.images) {
    stage("images", "De-duplicating images");
    result.images = images.list();
    result.coverage.images = {
      status: "partial",
      source: "products.json, products/{handle}.js, collections.json, pages.json",
      notes: [
        `${result.images.length} unique images found in product, collection and page data.`,
        "Theme images (banners, posters, section graphics, logos) only appear in storefront HTML, which a browser can't read cross-origin.",
        ...(images.truncated ? ["The image list hit its safety cap; some images were not recorded."] : []),
      ],
    };
  }
  }

  function finish(forced) {
    if (forced === "cancelled" || forced === "failed") {
      if (want.products && !result.products.length) result.products = [...productsByHandle.values()];
      if (want.collections && !result.collections.length) result.collections = collectionsSoFar;
      if (want.pages && !result.pages.length) result.pages = pagesSoFar;
      if (want.images && !result.images.length) result.images = images.list();
      for (const t of ["products", "collections", "pages", "images"]) {
        if (want[t] && !result.coverage[t]) result.coverage[t] = { status: forced === "cancelled" ? "partial" : "failed", source: null, notes: [forced === "cancelled" ? "Cancelled before this step finished." : "Stopped by an error before this step finished."] };
      }
    }
    for (const [key, reason] of Object.entries(UNAVAILABLE_IN_BROWSER)) {
      result.coverage[key] = result.coverage[key] || { status: "unavailable", source: null, notes: [reason] };
    }
    for (const t of ["products", "collections", "pages", "images"]) {
      if (!want[t] && !result.coverage[t]) result.coverage[t] = { status: "skipped", source: null, notes: ["Not selected."] };
    }
    const variants = result.products.reduce((n, p) => n + p.variants.length, 0);
    result.summary = {
      products: result.products.length,
      variants,
      collections: result.collections.length,
      pages: result.pages.length,
      blogs: 0,
      articles: 0,
      banners: 0,
      posters: 0,
      images: result.images.length,
      failedUrls: new Set(errors.filter(e => e.url).map(e => e.url)).size,
      requests: requester.stats.requests,
      retries: requester.stats.retries,
      bytes: requester.stats.bytes,
      durationMs: now() - startedAt,
    };
    // Images are always "partial" in browser mode (theme images need HTML), so they don't
    // downgrade the job; "completed" means every CORS-readable feed that was selected was fully read.
    const selectedCoverage = ["products", "collections", "pages"].filter(t => want[t]).map(t => result.coverage[t]?.status);
    let status = forced;
    if (!status) {
      const total = result.products.length + result.collections.length + result.pages.length + result.images.length;
      if (!total && errors.length) status = "failed";
      else if (errors.length || selectedCoverage.some(s => s !== "complete")) status = "partial";
      else status = "completed";
    }
    result.status = status;
    result.finishedAt = new Date(now()).toISOString();
    stage("done", status === "failed" ? "Extraction failed" : status === "partial" ? "Finished with partial results" : "Extraction complete");
    stageFrac = 1;
    emit();
    return result;
  }
}

function coverageFor(r, count, expected, source, { countNote, extraNotes = [] } = {}) {
  const notes = [...extraNotes];
  let status;
  if (r.stopReason === "unavailable") {
    status = "unavailable";
    notes.unshift(`${source} could not be read: ${r.error?.message || "unavailable"}.`);
  } else if (!r.complete) {
    status = "partial";
    notes.unshift(r.stopReason === "page-cap" ? `Stopped at the pagination cap (${r.pages} pages).` : `Pagination stopped early at page ${r.pages + 1}: ${r.error?.message || r.stopReason}.`);
  } else {
    status = "complete";
    notes.unshift(`All ${r.pages} page(s) of ${source} read (${count} items).`);
  }
  if (expected !== null && expected !== undefined) {
    if (count === expected) notes.push(`Count verified: matches the store's published count (${expected}) from meta.json.`);
    else {
      notes.push(`The store reports ${expected} published, but ${count} were extracted.${countNote ? " " + countNote : ""}`);
      if (status === "complete" && !countNote) status = "partial";
    }
  }
  return { status, source, verifiedCount: expected === count && expected !== null && expected !== undefined, notes };
}

/** Runs fn over items with at most `limit` in flight. Cancellation propagates. */
export async function pool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

function shortUrl(u) {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
}
