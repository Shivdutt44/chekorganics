/* ==========================================================================
   Exports — JSON, CSV, XLSX and ZIP, all generated in the browser with no
   third-party libraries.

   - CSV: RFC 4180 quoting, UTF-8 BOM for Excel, formula-injection guard
   - XLSX: real Office Open XML workbook, one sheet per dataset; every text
     value is written as an inline *string* cell, so Excel never evaluates it
     as a formula and URLs stay text
   - ZIP: store/deflate (CompressionStream when available), UTF-8 names
   ========================================================================== */
import { formatBytes, pool, hashString } from "./core.js";

/* ------------------------------------------------------------ crc32 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();
const toBytes = async d => (typeof d === "string" ? enc.encode(d) : d instanceof Uint8Array ? d : new Uint8Array(await d.arrayBuffer()));

async function deflateRaw(bytes) {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ zip */
export class ZipBuilder {
  constructor() {
    this.parts = [];
    this.central = [];
    this.offset = 0;
    this.names = new Set();
  }

  /** Adds a file. data: string | Uint8Array | Blob. compress:false for already-compressed media. */
  async add(name, data, { compress = true, date = new Date() } = {}) {
    let path = String(name).replace(/\\/g, "/").replace(/^\/+/, "").replace(/(^|\/)\.\.(?=\/|$)/g, "$1_");
    if (this.names.has(path)) {
      const dot = path.lastIndexOf(".");
      path = dot > 0 ? `${path.slice(0, dot)}-${this.names.size}${path.slice(dot)}` : `${path}-${this.names.size}`;
    }
    this.names.add(path);
    const raw = await toBytes(data);
    const crc = crc32(raw);
    let method = 0, payload = raw;
    if (compress && raw.length > 128) {
      const z = await deflateRaw(raw);
      if (z && z.length < raw.length) {
        method = 8;
        payload = z;
      }
    }
    if (this.offset + payload.length > 0xfffffff0) throw new Error("ZIP is larger than 4 GB; reduce the number of downloaded images.");
    const nameBytes = enc.encode(path);
    const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
    const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 file names
    local.setUint16(8, method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, payload.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    this.parts.push(new Uint8Array(local.buffer), nameBytes, payload);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, method, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, day, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, payload.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, this.offset, true);
    this.central.push(new Uint8Array(cd.buffer), nameBytes);
    this.offset += 30 + nameBytes.length + payload.length;
    return path;
  }

  finishParts() {
    const cdSize = this.central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.names.size, true);
    end.setUint16(10, this.names.size, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, this.offset, true);
    return [...this.parts, ...this.central, new Uint8Array(end.buffer)];
  }

  toBlob(type = "application/zip") {
    return new Blob(this.finishParts(), { type });
  }

  toUint8Array() {
    const parts = this.finishParts();
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

/* ------------------------------------------------------------ tabular views */
const join = (a, sep = " | ") => (Array.isArray(a) ? a.filter(x => x !== null && x !== undefined && x !== "").join(sep) : null);

/** Column definitions per dataset: [header, getter]. */
export const DATASETS = {
  products: {
    label: "Products",
    rows: r => r.products,
    cols: [
      ["id", p => p.id], ["handle", p => p.handle], ["title", p => p.title], ["vendor", p => p.vendor],
      ["product_type", p => p.productType], ["tags", p => join(p.tags, ", ")], ["status", p => p.status],
      ["url", p => p.url], ["price_min", p => p.priceMin], ["price_max", p => p.priceMax],
      ["compare_at_price_max", p => p.compareAtPriceMax], ["currency", p => p.currency], ["available", p => p.available],
      ["variants_count", p => p.variants.length], ["images_count", p => p.images.length], ["featured_image", p => p.featuredImage],
      ["image_urls", p => join(p.images.map(i => i.url))], ["options", p => join(p.options.map(o => `${o.name}: ${o.values.join("/")}`))],
      ["published_at", p => p.publishedAt], ["created_at", p => p.createdAt], ["updated_at", p => p.updatedAt],
      ["description_text", p => p.descriptionText],
    ],
  },
  variants: {
    label: "Variants",
    rows: r => r.products.flatMap(p => p.variants.map(v => ({ ...v, _p: p }))),
    cols: [
      ["product_id", v => v._p.id], ["product_handle", v => v._p.handle], ["product_title", v => v._p.title],
      ["variant_id", v => v.id], ["variant_title", v => v.title], ["option1", v => v.option1], ["option2", v => v.option2],
      ["option3", v => v.option3], ["sku", v => v.sku], ["barcode", v => v.barcode ?? null], ["price", v => v.price],
      ["compare_at_price", v => v.compareAtPrice], ["currency", v => v._p.currency], ["available", v => v.available],
      ["requires_shipping", v => v.requiresShipping], ["taxable", v => v.taxable], ["grams", v => v.grams],
      ["image_url", v => v.imageUrl], ["url", v => v.url],
    ],
  },
  collections: {
    label: "Collections",
    rows: r => r.collections,
    cols: [
      ["id", c => c.id], ["handle", c => c.handle], ["title", c => c.title], ["url", c => c.url],
      ["products_count", c => c.productsCount], ["product_handles_found", c => c.productHandles.length],
      ["product_refs_complete", c => c.productRefsComplete], ["product_handles", c => join(c.productHandles, ", ")],
      ["image_url", c => c.image?.url ?? null], ["image_alt", c => c.image?.alt ?? null],
      ["published_at", c => c.publishedAt], ["updated_at", c => c.updatedAt], ["description_text", c => c.descriptionText],
    ],
  },
  pages: {
    label: "Pages",
    rows: r => r.pages,
    cols: [
      ["id", p => p.id], ["handle", p => p.handle], ["title", p => p.title], ["url", p => p.url], ["author", p => p.author],
      ["published_at", p => p.publishedAt], ["updated_at", p => p.updatedAt], ["headings", p => join(p.headings.map(h => h.text))],
      ["images", p => join(p.images.map(i => i.url))], ["links_count", p => p.links.length], ["content_text", p => p.contentText],
    ],
  },
  images: {
    label: "Images",
    rows: r => r.images,
    cols: [
      ["id", i => i.id], ["url", i => i.url], ["original_source_url", i => i.originalSourceUrl], ["filename", i => i.filename],
      ["mime_type", i => i.mimeType], ["category", i => i.category], ["category_evidence", i => i.categoryEvidence],
      ["all_categories", i => join(i.categories, ", ")], ["alt", i => i.alt], ["width", i => i.width], ["height", i => i.height],
      ["source_pages", i => join(i.sourcePages)], ["source_count", i => i.sourceCount], ["extraction_methods", i => join(i.extractionMethods, ", ")],
      ["download_status", i => i.download?.status ?? null], ["local_file", i => i.download?.file ?? null],
    ],
  },
  errors: {
    label: "Errors",
    rows: r => r.errors,
    cols: [["stage", e => e.stage], ["code", e => e.code], ["message", e => e.message], ["url", e => e.url], ["status", e => e.status], ["item", e => e.item ?? null], ["at", e => e.at]],
  },
  coverage: {
    label: "Coverage",
    rows: r => Object.entries(r.coverage).map(([area, c]) => ({ area, ...c })),
    cols: [["area", c => c.area], ["status", c => c.status], ["source", c => c.source], ["notes", c => join(c.notes, " ")]],
  },
};

export function tableOf(result, dataset) {
  const def = DATASETS[dataset];
  if (!def) throw new Error(`Unknown dataset "${dataset}"`);
  return { headers: def.cols.map(c => c[0]), rows: (def.rows(result) || []).map(r => def.cols.map(c => c[1](r))) };
}

/* ------------------------------------------------------------ csv */
const FORMULA_START = /^[=+\-@\t\r]/;

/** Neutralises spreadsheet formula injection: text starting with = + - @ tab or CR gets a leading apostrophe. */
export function csvSafe(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  let s = String(v);
  if (FORMULA_START.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv({ headers, rows }) {
  const lines = [headers.map(csvSafe).join(","), ...rows.map(r => r.map(csvSafe).join(","))];
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/* ------------------------------------------------------------ xlsx */
const XML_INVALID = /[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu;
const xmlEsc = s => String(s).replace(XML_INVALID, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const CELL_MAX = 32767;

function colName(i) {
  let s = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

function cellXml(v, ref, style = 0) {
  const s = style ? ` s="${style}"` : "";
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
  if (typeof v === "boolean") return `<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`;
  let text = String(v);
  if (text.length > CELL_MAX) text = text.slice(0, CELL_MAX - 14) + " …[truncated]";
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(text)}</t></is></c>`;
}

function sheetXml({ headers, rows }) {
  const widths = headers.map((h, i) => Math.min(60, Math.max(h.length + 2, ...rows.slice(0, 200).map(r => String(r[i] ?? "").length + 1))));
  const cols = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(8, w)}" customWidth="1"/>`).join("")}</cols>`;
  const out = [`<row r="1">${headers.map((h, i) => cellXml(h, colName(i) + 1, 1)).join("")}</row>`];
  rows.forEach((r, ri) => out.push(`<row r="${ri + 2}">${r.map((v, i) => cellXml(v, colName(i) + (ri + 2))).join("")}</row>`));
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    cols +
    `<sheetData>${out.join("")}</sheetData>` +
    (rows.length ? `<autoFilter ref="A1:${colName(headers.length - 1)}${rows.length + 1}"/>` : "") +
    `</worksheet>`
  );
}

/** Builds an .xlsx workbook. sheets: [{ name, table:{headers, rows} }] → Blob */
export async function buildXlsx(sheets) {
  const zip = new ZipBuilder();
  const safeName = (n, i) => (String(n).replace(/[[\]:*?/\\]/g, " ").slice(0, 31).trim() || `Sheet${i + 1}`);
  await zip.add(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
      `</Types>`
  );
  await zip.add(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  );
  await zip.add(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
      sheets.map((s, i) => `<sheet name="${xmlEsc(safeName(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
      `</sheets></workbook>`
  );
  await zip.add(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  );
  await zip.add(
    "xl/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
      `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
      `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
      `</styleSheet>`
  );
  for (let i = 0; i < sheets.length; i++) await zip.add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheets[i].table));
  return zip.toBlob("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

export function workbookSheets(result) {
  return ["products", "variants", "collections", "pages", "images", "coverage", "errors"].map(k => ({ name: DATASETS[k].label, table: tableOf(result, k) }));
}

/* ------------------------------------------------------------ json */
const JSON_KEYS = ["store", "products", "collections", "pages", "blogs", "articles", "banners", "posters", "images", "discoveredUrls", "errors", "coverage", "summary"];

export function fullJson(result) {
  const out = {};
  for (const k of JSON_KEYS) out[k] = result[k] ?? null;
  out.status = result.status ?? null;
  return JSON.stringify(out, null, 2);
}

export function datasetJson(result, key) {
  const items = key === "variants" ? result.products.flatMap(p => p.variants.map(v => ({ ...v, productHandle: p.handle, productTitle: p.title }))) : result[key];
  return JSON.stringify({ store: result.store, type: key, count: Array.isArray(items) ? items.length : 0, coverage: result.coverage[key] ?? null, items: items ?? [] }, null, 2);
}

/* ------------------------------------------------------------ image download (optional) */
const ALLOWED_IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif" };

function sniffImage(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  const brand = String.fromCharCode(b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11]);
  if (brand === "ftypavif" || brand === "ftypavis") return "image/avif";
  return null;
}

/** Reads pixel dimensions from PNG/GIF/JPEG/WebP headers (null if unknown). */
export function imageDimensions(b, type) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (type === "image/png") return { width: dv.getUint32(16), height: dv.getUint32(20) };
    if (type === "image/gif") return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
    if (type === "image/webp") {
      const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (chunk === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      if (chunk === "VP8 ") return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
      if (chunk === "VP8L") {
        const bits = dv.getUint32(21, true);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    }
    if (type === "image/jpeg") {
      let o = 2;
      while (o + 9 < b.length) {
        if (b[o] !== 0xff) return null;
        const marker = b[o + 1];
        const len = dv.getUint16(o + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: dv.getUint16(o + 7), height: dv.getUint16(o + 5) };
        o += 2 + len;
      }
    }
  } catch { /* fall through */ }
  return null;
}

const slug = s => String(s || "image").toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "image";

async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Downloads public images (CORS-enabled Shopify CDN) for the ZIP.
 * Validates MIME type and magic bytes, enforces per-file and total size
 * limits, and de-duplicates identical files by SHA-256. Failures are recorded
 * per image; they never abort the export.
 * @returns {Promise<{ files: {path, bytes}[], stats }>}
 */
export async function downloadImages(images, requester, { maxCount = 200, maxBytesEach = 10 * 1024 * 1024, maxTotalBytes = 400 * 1024 * 1024, maxWidth = 2048, onProgress } = {}) {
  const files = [];
  const byHash = new Map();
  const stats = { requested: 0, downloaded: 0, duplicates: 0, failed: 0, skipped: 0, bytes: 0 };
  const queue = images.slice(0, maxCount);
  images.slice(maxCount).forEach(im => (im.download = { status: "skipped", reason: `over the ${maxCount}-image download limit` }));
  stats.skipped = images.length - queue.length;
  let done = 0;
  await pool(queue, requester.concurrency, async im => {
    let url = im.url;
    if (im.isShopifyCdn && maxWidth) {
      const u = new URL(url);
      u.searchParams.set("width", String(maxWidth)); // Shopify never upscales, so this only caps large originals
      url = u.toString();
    }
    stats.requested++;
    const r = await requester.request(url, { as: "blob", maxBytes: maxBytesEach });
    try {
      if (!r.ok) throw new Error(r.error?.message || "download failed");
      if (stats.bytes + r.body.size > maxTotalBytes) {
        im.download = { status: "skipped", reason: `total download limit (${formatBytes(maxTotalBytes)}) reached` };
        stats.skipped++;
        return;
      }
      const bytes = new Uint8Array(await r.body.arrayBuffer());
      const declared = (r.body.type || r.contentType || "").split(";")[0].trim().toLowerCase();
      const actual = sniffImage(bytes);
      if (!actual) throw new Error(`not a supported image (content-type "${declared || "unknown"}")`);
      const hash = await sha256Hex(bytes);
      const dims = imageDimensions(bytes, actual);
      if (byHash.has(hash)) {
        stats.duplicates++;
        im.download = { status: "duplicate", file: byHash.get(hash), sha256: hash, bytes: bytes.length, contentType: actual };
        return;
      }
      const path = `images/${im.category}/${slug(im.filename)}-${hashString(im.id + hash).slice(0, 6)}.${ALLOWED_IMAGE_TYPES[actual]}`;
      byHash.set(hash, path);
      files.push({ path, bytes });
      stats.downloaded++;
      stats.bytes += bytes.length;
      // The bytes decide the type: CDN content negotiation can serve e.g. WebP for a .png URL.
      im.download = { status: "downloaded", file: path, sha256: hash, bytes: bytes.length, contentType: actual, declaredContentType: declared || null, requestedUrl: url, pixelWidth: dims?.width ?? null, pixelHeight: dims?.height ?? null };
    } catch (e) {
      stats.failed++;
      im.download = { status: "failed", error: e.message, requestedUrl: url };
    } finally {
      done++;
      onProgress?.({ done, total: queue.length, stats });
    }
  });
  return { files, stats };
}

/* ------------------------------------------------------------ manifest + zip */
export function imageManifest(result) {
  return result.images.map(i => ({
    id: i.id,
    url: i.url,
    originalSourceUrl: i.originalSourceUrl,
    filename: i.filename,
    category: i.category,
    categoryEvidence: i.categoryEvidence,
    alt: i.alt,
    width: i.width,
    height: i.height,
    mimeType: i.mimeType,
    sourcePages: i.sourcePages,
    extractionMethods: i.extractionMethods,
    download: i.download,
  }));
}

function readme(result) {
  const lines = [
    `Shopify Store Extractor — ${result.store?.name || result.store?.canonicalDomain}`,
    `Store:        ${result.store?.canonicalDomain}`,
    `Extracted at: ${result.store?.extractedAt}`,
    `Status:       ${result.status}`,
    `Mode:         ${result.store?.mode}`,
    "",
    "Counts",
    ...Object.entries(result.summary).map(([k, v]) => `  ${k.padEnd(12)} ${v}`),
    "",
    "Coverage",
    ...Object.entries(result.coverage).map(([k, c]) => `  ${k.padEnd(22)} ${c.status.padEnd(12)} ${c.notes.join(" ")}`),
    "",
    "Files",
    "  extraction.json        everything in one file",
    "  json/<type>.json       one file per content type",
    "  csv/<type>.csv         spreadsheet-friendly tables",
    "  image-manifest.json    every image with source pages, category evidence and download status",
    "  images/                downloaded image files (only when image download was enabled)",
    "",
    "Imagery and copy remain the property of the store owner.",
  ];
  return lines.join("\r\n") + "\r\n";
}

export async function buildZip(result, { downloadedFiles = [] } = {}) {
  const zip = new ZipBuilder();
  await zip.add("README.txt", readme(result));
  await zip.add("extraction.json", fullJson(result));
  for (const k of ["products", "variants", "collections", "pages", "images", "errors"]) await zip.add(`json/${k}.json`, datasetJson(result, k));
  await zip.add("json/coverage.json", JSON.stringify(result.coverage, null, 2));
  await zip.add("json/summary.json", JSON.stringify(result.summary, null, 2));
  for (const k of ["products", "variants", "collections", "pages", "images", "errors", "coverage"]) await zip.add(`csv/${k}.csv`, toCsv(tableOf(result, k)));
  await zip.add("image-manifest.json", JSON.stringify(imageManifest(result), null, 2));
  await zip.add("image-manifest.csv", toCsv(tableOf(result, "images")));
  for (const f of downloadedFiles) await zip.add(f.path, f.bytes, { compress: false });
  return zip;
}
