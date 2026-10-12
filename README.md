# CHEKORGANICS — premium rebuild

A premium, dependency-free rebuild of **chekorganics.com**: every product, collection,
image, logo and review collected from the live store and re-presented in a faster,
more polished storefront.

## Run it

```bash
node .build/server.mjs     # → http://localhost:4173
```

Any static file server works (`npx serve .`). No build step, no framework, no runtime dependencies.

## Pages

| File | What it is |
|---|---|
| `index.html` | Homepage — hero, trust badges, 10 collections, 20 icon products, founder story, farm-to-formula journey, new launch, real results, 9 reviews, `WELCOME10` newsletter |
| `shop.html` | All 38 products with collection chips, live search, 5 sort options, URL-synced filters (`?c=Haircare`) |
| `product.html?p=<handle>` | Product detail — gallery + thumbnails, ratings, qty, add-to-bag, related products, buy link to the live store |
| `styles.css` | Design system (Fraunces + Inter, forest/gold/cream palette, responsive to 375px) |
| `app.js` | Cart (localStorage), drawer, cards, rails, per-page renderers, scroll reveals |
| `data.js` | Catalog: 38 products + 10 collections + ratings |

## What was collected from the live store

- **38 products** with titles, prices, variants, descriptions, tags, collections
- **10 collections** (Superfoods, Haircare, Skin Care, Handmade Soaps, Moisturisers, Lip Care, Men's Grooming, Oral Care, Eye Care, Herbal Hair Colours)
- **158 images** — product shots, collection images, hero banners, logo, founder photo, trust badges (AYUSH, awards, farm, cruelty-free, formulation, shipping), before/after results, farm photos
- **Ratings** for 13 products (from the store's rendered review widgets)

All imagery was downloaded to `assets/` and converted to WebP (900px, q82) —
**86 MB of source PNG/JPG became 13 MB**, so the store loads instantly and works offline.
Imagery and copy remain the property of CHEKORGANICS.

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
