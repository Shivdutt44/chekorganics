import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeStoreUrl, paginate, Requester, imageInfo, ImageRegistry, normalizeProduct, enrichProduct,
  normalizeCollection, normalizePage, runExtraction, validateStore, CancelledError, toNumber,
} from "../js/core.js";
import { fakeStore, instantSleep, makeProducts } from "./helpers.mjs";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const requester = (fetchImpl, extra = {}) => new Requester({ fetchImpl, sleep: instantSleep(), requestsPerSecond: 1000, ...extra });

describe("store URL validation", () => {
  test("accepts and normalises store URLs", () => {
    assert.equal(normalizeStoreUrl("example.com").origin, "https://example.com");
    assert.equal(normalizeStoreUrl("  https://Example.COM/collections/all?x=1 ").origin, "https://example.com");
    assert.equal(normalizeStoreUrl("http://store-name.myshopify.com").origin, "https://store-name.myshopify.com");
    assert.equal(normalizeStoreUrl("//www.shop.co.uk/").origin, "https://www.shop.co.uk");
    assert.equal(normalizeStoreUrl("xn--bcher-kva.example").host, "xn--bcher-kva.example");
  });

  for (const [input, why] of [
    ["", "empty"],
    ["ftp://example.com", "ftp protocol"],
    ["file:///etc/passwd", "file protocol"],
    ["javascript:alert(1)", "javascript protocol"],
    ["https://user:pass@example.com", "credentials"],
    ["https://example.com:8080", "custom port"],
    ["http://127.0.0.1", "IPv4 literal"],
    ["http://[::1]/", "IPv6 literal"],
    ["localhost", "localhost"],
    ["shop.localhost", "*.localhost"],
    ["printer.local", ".local"],
    ["exa mple.com", "space"],
    ["example", "no TLD"],
    ["-bad-.com", "bad label"],
    ["example.c0m", "invalid TLD"],
  ]) {
    test(`rejects ${why}`, () => assert.throws(() => normalizeStoreUrl(input)));
  }
});

describe("pagination", () => {
  const feed = (total, { repeat = false } = {}) => async u => {
    const url = new URL(u);
    const limit = Number(url.searchParams.get("limit"));
    const page = repeat ? 1 : Number(url.searchParams.get("page"));
    return json({ products: makeProducts(total).slice((page - 1) * limit, page * limit) });
  };

  test("walks every page and stops on the short last page", async () => {
    const f = feed(520);
    let calls = 0;
    const r = await paginate(requester(async u => (calls++, f(u))), "https://s.test/products.json", "products");
    assert.equal(r.items.length, 520);
    assert.equal(r.pages, 3);
    assert.equal(r.complete, true);
    assert.equal(r.stopReason, "last-page");
    assert.equal(calls, 3);
  });

  test("an exact multiple of 250 ends on an empty page", async () => {
    const r = await paginate(requester(feed(500)), "https://s.test/products.json", "products");
    assert.equal(r.items.length, 500);
    assert.equal(r.stopReason, "empty-page");
    assert.equal(r.complete, true);
  });

  test("loop protection: a server that ignores ?page stops after one repeated page", async () => {
    const r = await paginate(requester(feed(600, { repeat: true })), "https://s.test/products.json", "products");
    assert.equal(r.items.length, 250);
    assert.equal(r.stopReason, "no-new-items");
    assert.equal(r.pages, 2);
  });

  test("page cap marks the feed incomplete", async () => {
    const r = await paginate(requester(feed(2000)), "https://s.test/products.json", "products", { maxPages: 2 });
    assert.equal(r.items.length, 500);
    assert.equal(r.complete, false);
    assert.equal(r.stopReason, "page-cap");
  });

  test("an error mid-way keeps earlier pages and reports the failure", async () => {
    const f = feed(600);
    const r = await paginate(requester(async u => (new URL(u).searchParams.get("page") === "2" ? new Response("x", { status: 404 }) : f(u))), "https://s.test/products.json", "products");
    assert.equal(r.items.length, 250);
    assert.equal(r.complete, false);
    assert.equal(r.error.code, "HTTP_404");
  });

  test("HTML instead of JSON (password page) is an error, not data", async () => {
    const r = await paginate(requester(async () => new Response("<!doctype html><title>Password</title>", { status: 200 })), "https://s.test/products.json", "products");
    assert.equal(r.stopReason, "unavailable");
    assert.equal(r.error.code, "NOT_JSON");
  });

  test("unexpected JSON shape is reported", async () => {
    const r = await paginate(requester(async () => json({ items: [] })), "https://s.test/products.json", "products");
    assert.equal(r.error.code, "UNEXPECTED_SHAPE");
  });
});

describe("requester: retries, rate limits, concurrency, cancellation", () => {
  test("retries transient 503 with bounded, jittered backoff", async () => {
    let n = 0;
    const sleep = instantSleep();
    const r = new Requester({ fetchImpl: async () => (++n < 3 ? new Response("", { status: 503 }) : json({ ok: 1 })), sleep, requestsPerSecond: 1000, baseDelayMs: 100, maxDelayMs: 1000, random: () => 1 });
    const res = await r.json("https://s.test/x");
    assert.equal(res.ok, true);
    assert.equal(n, 3);
    assert.equal(r.stats.retries, 2);
    const backoffs = sleep.calls.filter(ms => ms >= 100);
    assert.deepEqual(backoffs, [200, 400]);
  });

  test("does not retry a 404", async () => {
    let n = 0;
    const r = requester(async () => (n++, new Response("", { status: 404 })));
    const res = await r.json("https://s.test/x");
    assert.equal(res.ok, false);
    assert.equal(res.error.code, "HTTP_404");
    assert.equal(n, 1);
  });

  test("429 is retried, slows the request rate, then reported", async () => {
    let n = 0;
    const r = requester(async () => (n++, new Response("", { status: 429 })), { maxRetries: 2 });
    const before = r.interval;
    const res = await r.json("https://s.test/x");
    assert.equal(n, 3);
    assert.equal(res.error.code, "HTTP_429");
    assert.match(res.error.message, /Rate limited/);
    assert.ok(r.interval > before);
    assert.equal(r.stats.rateLimited, 3);
  });

  test("honours Retry-After when the header is exposed", async () => {
    let n = 0;
    const sleep = instantSleep();
    const r = new Requester({ fetchImpl: async () => (++n === 1 ? new Response("", { status: 429, headers: { "retry-after": "7" } }) : json({})), sleep, requestsPerSecond: 1000, baseDelayMs: 10 });
    await r.json("https://s.test/x");
    assert.ok(sleep.calls.includes(7000));
  });

  test("network/CORS failures get one retry only", async () => {
    let n = 0;
    const r = requester(async () => {
      n++;
      throw new TypeError("Failed to fetch");
    });
    const res = await r.json("https://s.test/x");
    assert.equal(n, 2);
    assert.equal(res.error.code, "NETWORK_OR_CORS");
  });

  test("never exceeds the concurrency limit", async () => {
    let active = 0, peak = 0;
    const r = new Requester({
      fetchImpl: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise(res => setTimeout(res, 5));
        active--;
        return json({});
      },
      concurrency: 2,
      requestsPerSecond: 1000,
    });
    await Promise.all(Array.from({ length: 10 }, (_, i) => r.json(`https://s.test/${i}`)));
    assert.equal(peak, 2);
  });

  test("spaces requests by the configured rate", async () => {
    let clock = 0;
    const waits = [];
    const r = new Requester({
      fetchImpl: async () => json({}),
      now: () => clock,
      sleep: async ms => {
        waits.push(ms);
        clock += ms;
      },
      requestsPerSecond: 4,
      concurrency: 1,
    });
    for (let i = 0; i < 4; i++) await r.json("https://s.test/x");
    assert.deepEqual(waits, [250, 250, 250]);
  });

  test("aborting throws CancelledError", async () => {
    const ctrl = new AbortController();
    const r = new Requester({ fetchImpl: async () => json({}), signal: ctrl.signal });
    ctrl.abort();
    await assert.rejects(r.json("https://s.test/x"), CancelledError);
  });

  test("rejects oversized responses", async () => {
    const r = new Requester({ fetchImpl: async () => new Response("x".repeat(2000)), sleep: instantSleep(), requestsPerSecond: 1000 });
    const res = await r.request("https://s.test/x", { maxBytes: 1000 });
    assert.equal(res.error.code, "TOO_LARGE");
  });
});

describe("images", () => {
  test("store-domain, CDN, width params and legacy size suffixes share one key", () => {
    const a = imageInfo("https://www.shop.test/cdn/shop/files/Hero.jpg?v=12&width=800");
    const b = imageInfo("https://cdn.shopify.com/s/files/1/0638/2904/9431/files/Hero.jpg?v=12");
    const c = imageInfo("https://cdn.shopify.com/s/files/1/0638/2904/9431/files/Hero_1200x.jpg?v=12");
    assert.equal(a.key, b.key);
    assert.equal(b.key, c.key);
    assert.equal(a.filename, "Hero.jpg");
    assert.equal(a.mimeType, "image/jpeg");
    assert.ok(!a.canonicalUrl.includes("width="));
    assert.notEqual(imageInfo("https://cdn.shopify.com/s/files/1/0638/2904/9431/files/Other.jpg").key, a.key);
  });

  test("registry de-duplicates, keeps provenance and prefers the more specific category", () => {
    const reg = new ImageRegistry();
    reg.add({ url: "https://cdn.shopify.com/s/files/1/1/1/1/files/x.png?width=200", category: "product_image", evidence: "p", method: "products.json", source: { type: "product", url: "https://s/p1" } });
    reg.add({ url: "https://s.test/cdn/shop/files/x.png?v=1", alt: "X alt", width: 10, height: 20, category: "collection_image", evidence: "c", method: "collections.json", source: { type: "collection", url: "https://s/c1" } });
    reg.add({ url: "data:image/png;base64,AAAA", category: "other", evidence: "", method: "x" });
    const [rec] = reg.list();
    assert.equal(reg.size, 1);
    assert.equal(rec.category, "collection_image");
    assert.deepEqual(rec.categories, ["product_image", "collection_image"]);
    assert.equal(rec.alt, "X alt");
    assert.equal(rec.width, 10);
    assert.deepEqual(rec.sourcePages, ["https://s/p1", "https://s/c1"]);
    assert.equal(rec.sourceCount, 2);
  });
});

describe("normalisers", () => {
  test("product: numbers are numbers, missing values are null, nothing invented", () => {
    const [raw] = makeProducts(1);
    raw.tags = "x, y ,z";
    const p = normalizeProduct(raw, { origin: "https://s.test", extractedAt: "t" });
    assert.equal(p.url, "https://s.test/products/product-1");
    assert.deepEqual(p.tags, ["x", "y", "z"]);
    assert.equal(p.variants[0].price, 349);
    assert.equal(p.variants[1].price, 599.5);
    assert.equal(p.variants[1].compareAtPrice, null);
    assert.equal(p.variants[1].sku, null);
    assert.equal("barcode" in p.variants[0], false, "barcode is only set when the store exposes it");
    assert.equal(p.priceMin, 349);
    assert.equal(p.priceMax, 599.5);
    assert.equal(p.available, true);
    assert.equal(p.currency, null);
    assert.equal(p.seo, null);
    assert.equal(p.images[0].alt, null);
  });

  test("product enrichment adds alt text and barcodes from products/{handle}.js", () => {
    const [raw] = makeProducts(1);
    const p = normalizeProduct(raw, { origin: "https://s.test", extractedAt: "t" });
    enrichProduct(p, { media: [{ media_type: "image", alt: "Bottle front", src: raw.images[0].src + "&width=500" }], variants: [{ id: raw.variants[0].id, barcode: "8901" }] }, "https://s.test");
    assert.equal(p.images[0].alt, "Bottle front");
    assert.equal(p.variants[0].barcode, "8901");
    assert.ok(p.sources.includes("products/{handle}.js"));
  });

  test("collection and page", () => {
    const c = normalizeCollection({ id: 1, title: "T", handle: "t", products_count: "4", image: { src: "//cdn.shopify.com/s/files/1/1/1/1/collections/a.png", alt: null } }, { origin: "https://s.test", extractedAt: "t" });
    assert.equal(c.productsCount, 4);
    assert.equal(c.image.url, "https://cdn.shopify.com/s/files/1/1/1/1/collections/a.png");
    const pg = normalizePage({ id: 2, title: "About", handle: "about", body_html: "<p>Hi <b>there</b></p>" }, { origin: "https://s.test", extractedAt: "t" });
    assert.equal(pg.path, "/pages/about");
    assert.equal(pg.contentText, "Hi there");
    assert.equal(pg.contentHtml, "<p>Hi <b>there</b></p>");
  });

  test("toNumber", () => {
    assert.equal(toNumber("1,299.50"), 1299.5);
    assert.equal(toNumber(""), null);
    assert.equal(toNumber("abc"), null);
    assert.equal(toNumber(0), 0);
  });
});

describe("full extraction against a fake store", () => {
  const fastEnv = fetchImpl => ({ fetchImpl, sleep: instantSleep() });
  const fast = { requestsPerSecond: 1000, concurrency: 4 };

  test("extracts, paginates, de-duplicates and verifies counts", async () => {
    const store = fakeStore({ productCount: 520 });
    const progress = [];
    const r = await runExtraction("shop.test", fast, { ...fastEnv(store), onProgress: p => progress.push(p.percent) });
    assert.equal(r.status, "completed");
    assert.equal(r.products.length, 520);
    assert.equal(r.summary.variants, 1040);
    assert.equal(new Set(r.products.map(p => p.id)).size, 520);
    assert.equal(r.coverage.products.status, "complete");
    assert.equal(r.coverage.products.verifiedCount, true);
    assert.equal(r.store.currency, "INR");
    assert.equal(r.products[0].currency, "INR");
    assert.equal(r.products[0].images[0].alt, "Alt for Product 1");
    assert.equal(r.products[0].variants[0].barcode, "89011");
    assert.equal(r.collections.length, 2);
    assert.deepEqual(r.collections.find(c => c.handle === "haircare").productHandles, ["product-1", "product-2", "product-3"]);
    assert.equal(r.pages.length, 1);
    assert.equal(r.pages[0].images[0].url, "https://shop.test/cdn/shop/files/team.jpg?v=3&width=800");
    // 520 product images + 1 shared badge + 520 description images + 1 collection + 1 page
    assert.equal(r.images.length, 1043);
    const badge = r.images.find(i => i.filename === "shared-badge.png");
    assert.equal(badge.sourceCount, 520);
    assert.equal(badge.sourcePages.length, 25, "provenance list is capped");
    assert.equal(r.coverage.banners.status, "unavailable");
    assert.equal(r.coverage.blogs.status, "unavailable");
    assert.deepEqual(r.banners, []);
    assert.equal(r.errors.length, 0);
    assert.ok(progress.at(-1) === 100);
    assert.ok(progress.every((p, i) => i === 0 || p >= progress[i - 1] || p === 100), "progress never goes backwards");
  });

  test("only the selected content types are extracted", async () => {
    const store = fakeStore({ productCount: 5 });
    const r = await runExtraction("shop.test", { ...fast, types: { products: false, collections: true, pages: false, images: false } }, fastEnv(store));
    assert.equal(r.products.length, 0);
    assert.equal(r.collections.length, 2);
    assert.equal(r.coverage.products.status, "skipped");
    const feedPages = store.calls.filter(u => new URL(u).pathname === "/products.json" && new URL(u).searchParams.has("page"));
    assert.deepEqual(feedPages, [], "the products feed is never paged");
    assert.ok(store.calls.some(u => u.includes("/collections/haircare/products.json")), "collection mapping still runs");
  });

  test("a failing endpoint is recorded and the rest still runs (partial)", async () => {
    const store = fakeStore({
      productCount: 5,
      routes: {
        "/pages.json": () => new Response("{}", { status: 404 }),
        "/products/product-2.js": () => new Response("", { status: 500 }),
      },
    });
    const r = await runExtraction("shop.test", fast, fastEnv(store));
    assert.equal(r.status, "partial");
    assert.equal(r.products.length, 5);
    assert.equal(r.coverage.pages.status, "unavailable");
    assert.equal(r.coverage.productEnrichment.status, "partial");
    assert.ok(r.errors.some(e => e.stage === "enrich" && e.item === "product-2" && e.code === "HTTP_500"));
    assert.ok(r.errors.some(e => e.stage === "pages" && e.code === "HTTP_404"));
    assert.equal(r.summary.failedUrls, 2);
  });

  test("a store that can't be reached fails cleanly", async () => {
    const r = await runExtraction("other.test", fast, fastEnv(fakeStore()));
    assert.equal(r.status, "failed");
    assert.equal(r.errors[0].code, "UNREACHABLE");
    assert.equal(r.products.length, 0);
  });

  test("count mismatch with meta.json downgrades coverage to partial", async () => {
    const store = fakeStore({ productCount: 3, routes: { "/meta.json": () => json({ name: "S", url: "https://shop.test", published_products_count: 4 }) } });
    const r = await runExtraction("shop.test", fast, fastEnv(store));
    assert.equal(r.coverage.products.status, "partial");
    assert.match(r.coverage.products.notes.join(" "), /reports 4 published, but 3/);
  });

  test("cancelling keeps the data collected so far", async () => {
    const ctrl = new AbortController();
    const store = fakeStore({ productCount: 40 });
    let seen = 0;
    const r = await runExtraction("shop.test", { ...fast, concurrency: 1 }, {
      fetchImpl: async (u, init) => {
        if (/\.js$/.test(new URL(u).pathname) && ++seen === 5) ctrl.abort();
        return store(u, init);
      },
      signal: ctrl.signal,
      sleep: instantSleep(),
    });
    assert.equal(r.status, "cancelled");
    assert.equal(r.products.length, 40);
    assert.equal(r.coverage.collections.status, "partial");
  });

  test("validation reports endpoint availability without throwing", async () => {
    const store = fakeStore({ routes: { "/pages.json": () => new Response("<html>", { status: 200 }) } });
    const v = await validateStore("https://shop.test", { requester: requester(store) });
    assert.equal(v.isShopify, true);
    assert.equal(v.endpoints["products.json"], "available");
    assert.match(v.endpoints["pages.json"], /HTML instead of JSON/);
    assert.equal(v.store.publishedProductsCount, 520);
  });
});
