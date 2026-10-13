// Stamps a version on every local CSS/JS reference in the site's pages
// (app.js → app.js?v=<stamp>) so browsers fetch fresh files after each deploy instead of
// serving cached ones for up to 10 minutes (GitHub Pages: Cache-Control max-age=600).
//
//   node .build/bust-cache.mjs          (run from the site root before committing)
import fs from "fs";

const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12); // yyyymmddhhmm
const pages = fs.readdirSync(".").filter(f => f.endsWith(".html"));
let changed = 0;
for (const page of pages) {
  const before = fs.readFileSync(page, "utf8");
  const after = before.replace(/(<(?:script|link)\b[^>]*?\b(?:src|href)=")([a-z0-9_-]+\.(?:js|css))(?:\?v=[0-9a-z]+)?(")/gi, `$1$2?v=${stamp}$3`);
  if (after !== before) { fs.writeFileSync(page, after); changed++; }
}
console.log(`v=${stamp} → ${changed} page(s)`);
