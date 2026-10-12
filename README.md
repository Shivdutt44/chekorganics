# CHEKORGANICS — premium rebuild

A premium, dependency-free rebuild of **chekorganics.com**: every product, collection,
image, logo and review collected from the live store and re-presented in a faster,
more polished storefront.

## Run it

```bash
node .build/server.mjs     # → http://localhost:4173
```

Any static file server also works (`npx serve .`). The bundled server adds a **live catalog proxy**:

| Route | What it does |
|---|---|
| `/api/products.json` | Proxies `chekorganics.com/products.json?limit=250`, 5-min cache, `Access-Control-Allow-Origin: *` |
| `/api/collections.json` | Same for the collections feed |

## Dynamic catalog

Pages render instantly from the bundled snapshot, then `app.js` fetches the live
`products.json` feed and re-renders in place with current prices, stock and product set —
no reload. The header pill shows the state:

- `● Live catalog · 38 products · synced 04:12 pm` — hydrated from chekorganics.com
- `● Offline catalog · 38 products` — using the bundled snapshot

The feed is re-polled every 60 s while the tab stays open. Local images are preferred
(fast, offline-safe); unknown products fall back to the Shopify CDN.

## Hero banner artwork (generated for desktop + mobile)

`.build/make-banners.mjs` composes four hero banners from the collected photography —
farm shots (circular crop + gold ring), transparent product cut-outs, layered gradients,
glows and a hairline gold frame — laid out in SVG and rendered with `sharp`:

| File | Size | Use |
|---|---|---|
| `assets/brand/hero-1-desktop.webp` | 1920×800 · 67 KB | Slide 1 — Route to Roots |
| `assets/brand/hero-1-mobile.webp` | 750×1050 · 34 KB | Slide 1, portrait art |
| `assets/brand/hero-2-desktop.webp` | 1920×800 · 86 KB | Slide 2 — Ashyukavach SPF 30+ launch |
| `assets/brand/hero-2-mobile.webp` | 750×1050 · 47 KB | Slide 2, portrait art |

Text stays in HTML (crisp, accessible, editable); only the art is baked. The layout keeps
the text zone deliberately dark and the swap breakpoint sits at **960 px**, so portrait art
(with its built-in fade) covers phones and tablets. Measured mean luminance behind the
headline in the rendered page: **44–68/255 at 390–1024 px and 53–64 at 1200–1440 px**,
against cream text (~236) — every width clears a 5:1 contrast ratio.

The hero is a two-slide slider: autoplay every 6.5 s, arrows, dots, touch swipe, pause on
hover, and pause on keyboard focus (`:focus-visible`); autoplay is disabled entirely when
`prefers-reduced-motion` is set. `assets/brand/hero-desktop.webp` and `hero-mobile.webp`
are the original store banners, kept for reference.

Regenerate with:

```bash
cd .build && npm i && node make-banners.mjs
```

## Pages

| File | What it is |
|---|---|
| `index.html` | Homepage — hero, trust badges, 10 collections, 20 icon products, founder story, farm-to-formula journey, new launch, real results, 9 reviews, `WELCOME10` newsletter |
| `shop.html` | All 38 products with collection chips, live search, 5 sort options, URL-synced filters (`?c=Haircare`) |
| `product.html?p=<handle>` | Product detail — gallery + thumbnails, ratings, qty, add-to-bag, related products, buy link to the live store |
| `styles.css` | Design system (Fraunces + Inter, forest/gold/cream palette, skeletons, sticky buy bar, view transitions) |
| `app.js` | Live catalog sync, cart (localStorage) + drawer, cards, rails, per-page renderers, scroll reveals |
| `data.js` | Bundled catalog snapshot: 38 products + 10 collections + ratings |
| `assets/brand/favicon-32.jpg` | **Original store favicon** (32×32, as served by chekorganics.com) |
| `assets/brand/apple-touch-icon.jpg` | Original store icon at 512×512 |
| `assets/brand/og-share.png` | Original 1200×628 share card |

## What was collected from the live store

- **38 products** with titles, prices, variants, descriptions, tags, collections
- **10 collections** (Superfoods, Haircare, Skin Care, Handmade Soaps, Moisturisers, Lip Care, Men's Grooming, Oral Care, Eye Care, Herbal Hair Colours)
- **158 images** — product shots, collection images, hero banners, logo, founder photo, trust badges (AYUSH, awards, farm, cruelty-free, formulation, shipping), before/after results, farm photos
- **Ratings** for 13 products (from the store's rendered review widgets)

All imagery was downloaded to `assets/` and converted to WebP (900px, q82) —
**86 MB of source PNG/JPG became 13 MB**, so the store loads instantly and works offline.
Imagery and copy remain the property of CHEKORGANICS.

## App-like feel

- Cross-document **View Transitions** (`@view-transition { navigation: auto }`) with a CSS fallback fade
- **Skeleton shimmer cards** while a catalog slot is empty
- **Prefetch on hover** for shop/product links, so navigation feels instant
- Spring-eased cart drawer, popping cart badge, staggered scroll reveals, floating hero cards

## CRO layer

- **Free-shipping progress bar** in the cart drawer with a real "Add ₹X more" nudge (₹3,000 threshold) and shipping-cost state
- **Sticky add-to-bag bar** on product pages (thumbnail, name, price, Add to bag + buy-now) that slides in once the buy box scrolls away
- **Stock line** (in stock · dispatched in 24 hrs / sold out) + rating + review count above the price
- **Guarantee strip** (AYUSH, farm to bottle, chemical free, free shipping, 10,000+ customers) on home and product pages
- **Recently viewed products** rail on product pages (localStorage)
- Checkout CTA carries the live bag total; drawer shows COD / AYUSH / returns trust row
- Comparison-price anchoring (`Save ₹X` badges) and review-count proof on every card

## Mobile app shell (`ux.js` + `ux.css`)

Loaded on every page in the order `data.js → ux.js → app.js`. `ux.js` must run before
`app.js`, so it can read the store's real ratings before `app.js` modifies `window.STORE`.

- **Bottom navigation** (≤768px): Home · Shop · Categories (opens the menu) · Account · Bag
  (with a live count). It hides while you scroll down or type, and comes back when you
  scroll up. The header becomes a compact app bar, and the product page's sticky buy bar
  sits above the nav.
- **Scroll progress**: a thin gold bar at the top, plus a back-to-top button whose ring
  fills as you scroll.
- **Account menu**: a person icon in the header (a bottom sheet on phones) with Log in,
  Sign up, My orders, Track an order and Help. All of them link to the real Shopify
  accounts on chekorganics.com.
- **Footer accordions** on phones (≤640px). On larger screens the menus stay open.
- **Shopper notifications** (bottom left): the first appears after 9s, then at most 5 per
  page, 22–36s apart. They pause while the bag, menu or dialogs are open, and can be
  dismissed for the session. They only show real data:
  - by default, real ratings from the store's review widgets (`data.js`);
  - real recent orders, if you publish a feed and point to it from each page's `<head>`:
    ```html
    <meta name="chek:sales-feed" content="https://example.com/recent-sales.json">
    ```
    ```json
    [{ "handle": "noni-herbal-shampoo", "city": "Pune", "at": "2026-10-12T09:40:00Z" }]
    ```
    Only orders from the last 72 hours for products in the catalog are shown. Generate the
    feed from Shopify orders (Shopify Flow, an app or a small serverless job). Admin API
    keys can't be used from a public page.
- **Installable**: `manifest.webmanifest`, home-screen icons, `theme-color`, and
  `viewport-fit=cover` with safe-area padding for notched phones.
- **Mobile fixes**: form fields at 16px (no iOS zoom on focus), 42–46px tap targets, product
  card ratings that fit two columns, no shadow strip from the closed cart drawer, and no
  tap highlight or double-tap delay.

## Shoppable videos ("Watch & shop" on the homepage)

`shoppable.js` renders 14 short videos as a reels-style rail. Each video is tagged with a product:

- **Rail:** muted autoplay for cards on screen; off-screen videos aren't downloaded. A "+" on each
  card adds to the bag. There's no autoplay with reduced motion or Data Saver.
- **Viewer:** a full-screen player with sound, a progress bar and swipe navigation (arrows and
  keys on desktop). The tagged product shows its live price and stock from `products/{handle}.js`,
  with Add to bag and View product.

The data lives in `videos.js`, generated from the brand's own videos on Shopify's CDN:
6 from the live homepage's shoppable video widget, plus 8 attached to products. To pick up
new videos:

```bash
cd .build && node fetch-videos.mjs      # rewrites ../videos.js
```

Instagram isn't scraped. Instagram requires a login and its terms forbid scraping. A new reel
shows up here once the same video is uploaded to Shopify, either in the homepage video widget
or as product media, and the script is re-run.

## Cart & checkout

The bag is a local preview (localStorage). **Checkout** hands off to the real store with a
proper Shopify permalink: `chekorganics.com/cart/<variantId>:<qty>`, so a click-through
cart actually works on the live site.

## Regenerating the data

```bash
cd .build
npm i                      # sharp, for image conversion
node fetch.mjs > collections.json
node dl.mjs                 # downloads images to ../assets
node convert.mjs            # PNG/JPG → WebP
node gen2.mjs               # writes ../data.js
```
