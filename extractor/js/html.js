/* ==========================================================================
   HTML helpers for body_html fields (product descriptions, page bodies).
   DOMParser documents are inert: scripts don't run and images don't load,
   so parsing untrusted store HTML here is safe.
   ========================================================================== */

const BLOCK = new Set(["P", "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "LI", "UL", "OL", "TABLE", "TR", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "FIGURE", "FIGCAPTION", "DL", "DT", "DD", "HR", "DETAILS", "SUMMARY"]);
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "IFRAME", "OBJECT", "EMBED", "BUTTON", "SELECT", "TEXTAREA"]);

const parser = typeof DOMParser !== "undefined" ? new DOMParser() : null;
const parse = html => parser.parseFromString(`<!doctype html><body>${html || ""}</body>`, "text/html");

function toText(html) {
  const doc = parse(html);
  let out = "";
  const walk = node => {
    if (node.nodeType === 3) {
      out += node.nodeValue;
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (SKIP.has(tag)) return;
    if (tag === "BR") {
      out += "\n";
      return;
    }
    const block = BLOCK.has(tag);
    if (block) out += "\n";
    if (tag === "LI") out += "• ";
    node.childNodes.forEach(walk);
    if (block) out += "\n";
    if (tag === "TD" || tag === "TH") out += "\t";
  };
  doc.body.childNodes.forEach(walk);
  return out
    .replace(/ /g, " ")
    .split("\n")
    .map(l => l.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function headings(html) {
  return [...parse(html).querySelectorAll("h1,h2,h3,h4,h5,h6")]
    .map(h => ({ level: Number(h.tagName[1]), text: h.textContent.replace(/\s+/g, " ").trim() }))
    .filter(h => h.text);
}

function abs(href, base) {
  if (!href) return null;
  const s = href.trim();
  if (!s || /^(data|javascript|mailto|tel|blob):/i.test(s)) return null;
  try {
    const u = new URL(s.startsWith("//") ? "https:" + s : s, base);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function links(html, base) {
  const seen = new Set();
  const out = [];
  parse(html).querySelectorAll("a[href]").forEach(a => {
    const url = abs(a.getAttribute("href"), base);
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ url, text: a.textContent.replace(/\s+/g, " ").trim() || null });
  });
  return out;
}

/** Largest candidate in a srcset string. */
export function bestFromSrcset(srcset) {
  let best = null;
  for (const part of String(srcset || "").split(/,\s+/)) {
    const [url, d] = part.trim().split(/\s+/);
    if (!url) continue;
    const w = /^(\d+)w$/.exec(d || "") ? Number(d.slice(0, -1)) : /^([\d.]+)x$/.exec(d || "") ? Number(d.slice(0, -1)) * 1000 : 0;
    if (!best || w > best.w) best = { url, w };
  }
  return best?.url || null;
}

/** Images inside an HTML fragment: <img> src/srcset/lazy data-* attributes and inline background images. */
function images(html, base) {
  const doc = parse(html);
  const out = [];
  doc.querySelectorAll("img").forEach(img => {
    const raw =
      bestFromSrcset(img.getAttribute("srcset") || img.getAttribute("data-srcset")) ||
      img.getAttribute("data-src") ||
      img.getAttribute("data-original") ||
      img.getAttribute("src");
    const url = abs(raw && raw.replace("{width}", "1080"), base);
    if (!url) return;
    const n = v => (Number(v) > 0 ? Number(v) : null);
    out.push({ url, alt: img.getAttribute("alt")?.trim() || null, width: n(img.getAttribute("width")), height: n(img.getAttribute("height")) });
  });
  doc.querySelectorAll("[style*='url(']").forEach(el => {
    for (const m of el.getAttribute("style").matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
      const url = abs(m[2], base);
      if (url) out.push({ url, alt: null, width: null, height: null });
    }
  });
  return out;
}

export const htmlTools = { toText, headings, links, images };
