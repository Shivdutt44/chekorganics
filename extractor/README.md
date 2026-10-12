# Store Extractor

A static, browser-only tool that extracts a Shopify store's **public** catalog data and
exports it as JSON, CSV, Excel (.xlsx) or a ZIP. It has no server and no build step, so it
runs on GitHub Pages as-is.

```
https://<user>.github.io/<repo>/extractor/
https://<user>.github.io/<repo>/extractor/?store=example.com   ← pre-fills the URL
```

## What it extracts

A page on GitHub Pages can only read another site's data when that site sends CORS headers.
Shopify sends them for its JSON feeds, so this is what the tool can read:

| Source | Data |
|---|---|
| `meta.json` | Store name, currency, published product and collection counts (used to verify completeness) |
| `products.json` (paged, 250 per page) | Products, variants, options, prices, availability, tags, SKUs, images |
| `products/{handle}.js` (optional) | Image alt text, barcodes, product media incl. video previews |
| `collections.json` | Collections, descriptions, collection images |
| `collections/{handle}/products.json` (optional) | Which products belong to each collection |
| `pages.json` | Pages (HTML, clean text, headings, links, images), on stores that expose it |
| `cdn.shopify.com` | Image files, only when you choose to include them in the ZIP |

**Not available in a browser:** homepage banners, posters and other theme images, blogs and
articles, `sitemap.xml`/`robots.txt`, SEO meta, JSON-LD, and policy pages. Shopify serves
storefront HTML without CORS headers. These areas are marked `unavailable` in every export
and nothing is guessed. Reading them needs a small server-side proxy, such as a
Cloudflare Worker.

## How it behaves

- **Validation:** the URL is normalised to `https://host`. Other protocols, credentials, ports,
  IP addresses and local hostnames are rejected. The store's primary domain from `meta.json` is used.
- **Politeness:** configurable requests/second and parallel requests (default 3 and 3), a
  20 s timeout, and bounded exponential backoff with jitter for 408/429/5xx. A 429 also slows
  the rest of the job down. Network/CORS failures get one retry.
- **Pagination:** stops on an empty or short page, on a page that adds no new IDs (loop
  protection), or at the page cap (default 100 pages = 25,000 items).
- **De-duplication:** products and collections by handle/ID. Images by asset key, which
  treats `store.com/cdn/shop/files/x.png`, `cdn.shopify.com/s/files/…/files/x.png`,
  `?width=` variants and `_800x` suffixes as one image. Every image keeps its source pages.
- **Completeness:** product and collection counts are checked against `meta.json`. Each area
  gets a coverage status (`complete`, `partial`, `unavailable`, `skipped`) with notes.
- **Errors and cancellation:** failed URLs are listed with stage, code and message.
  One failure never stops the job, and cancelling keeps what was collected so far.
- **Image download (optional):** checks the MIME type and the file's magic bytes, caps size
  per file and in total, de-duplicates by SHA-256, and caps width via Shopify's `width=`
  parameter. Each image's result is recorded in `image-manifest.json`.
- **Exports:** JSON (full + per type), CSV (UTF-8 BOM, formula-injection guard), XLSX
  (one sheet per dataset; text stored as literal strings, so nothing is evaluated as a formula)
  and a ZIP bundle with a README, JSON, CSV and the image manifest.
- The last extraction is kept in IndexedDB so a reload can restore it.

## Files

| File | Purpose |
|---|---|
| `index.html`, `extractor.css` | UI, using the storefront's design tokens |
| `js/core.js` | URL validation, request queue, pagination, normalisers, image registry, the extraction job (no DOM) |
| `js/html.js` | DOMParser helpers for `body_html` (inert: no scripts run, no images load) |
| `js/export.js` | CSV, XLSX and ZIP writers, image downloader |
| `js/app.js` | UI controller |
| `tests/` | `node:test` suite with a fake store (no network) |

## Tests

```bash
cd extractor
npm test        # Node 20+; no dependencies to install
```

## Manual check

1. Serve the repo (`npx serve .` or GitHub Pages) and open `/extractor/`.
2. Enter `ftp://x` and check you get a protocol error. Enter a real store and click **Validate store**.
3. **Start extraction**. Progress, stats and the log should update, and the status should end as Completed or Partially completed.
4. Try search, the category filter, pagination, **View JSON** and **Copy URL**.
5. Download Full JSON, Excel, a per-type CSV, and the ZIP with "Include image files" ticked.
6. Start again and click **Cancel**. The status should change to Cancelled.
7. Reload the page. The "last extraction" notice should appear.

Extracted imagery and copy remain the property of the store owner.
