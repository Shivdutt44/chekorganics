/* Test helpers: an in-memory fake Shopify store and a tiny ZIP reader. */
import zlib from "node:zlib";

export const instantSleep = () => {
  const calls = [];
  const sleep = (ms, signal) => {
    calls.push(ms);
    if (signal?.aborted) return Promise.reject(Object.assign(new Error("cancelled"), { code: "CANCELLED" }));
    return Promise.resolve();
  };
  sleep.calls = calls;
  return sleep;
};

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export function makeProducts(n, start = 1) {
  return Array.from({ length: n }, (_, i) => {
    const id = start + i;
    return {
      id,
      title: `Product ${id}`,
      handle: `product-${id}`,
      body_html: `<p>Description ${id}</p><img src="//cdn.shopify.com/s/files/1/0001/0002/0003/files/desc-${id}.png?v=1&width=400" alt="Desc ${id}">`,
      vendor: "Brand",
      product_type: "Oil",
      tags: ["a", "b"],
      published_at: "2026-01-01T00:00:00Z",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      options: [{ name: "Size", position: 1, values: ["100ml", "200ml"] }],
      variants: [
        { id: id * 10 + 1, title: "100ml", option1: "100ml", sku: `SKU-${id}-1`, price: "349.00", compare_at_price: "399.00", available: true, requires_shipping: true, taxable: true, grams: 120, position: 1 },
        { id: id * 10 + 2, title: "200ml", option1: "200ml", sku: "", price: "599.50", compare_at_price: null, available: false, requires_shipping: true, taxable: true, grams: 240, position: 2 },
      ],
      images: [
        { id: id * 100, src: `https://cdn.shopify.com/s/files/1/0001/0002/0003/files/p-${id}.png?v=1`, width: 1080, height: 1080, position: 1, variant_ids: [] },
        // same asset as the shared image used by every product → must de-duplicate
        { id: id * 100 + 1, src: "https://cdn.shopify.com/s/files/1/0001/0002/0003/files/shared-badge.png?v=7", width: 400, height: 400, position: 2, variant_ids: [] },
      ],
    };
  });
}

/**
 * Fake store. routes can override any path (string → response factory).
 * Records every requested URL in fetch.calls.
 */
export function fakeStore({ productCount = 520, origin = "https://shop.test", routes = {}, delayMs = 0 } = {}) {
  const products = makeProducts(productCount);
  const collections = [
    { id: 1, title: "Haircare", handle: "haircare", description: "<p>Hair <b>care</b></p>", published_at: "2026-01-01", updated_at: "2026-01-02", products_count: 3, image: { src: "https://cdn.shopify.com/s/files/1/0001/0002/0003/collections/hair.png?v=1", alt: "Hair", width: 800, height: 600 } },
    { id: 2, title: "Empty", handle: "empty", description: "", published_at: "2026-01-01", updated_at: "2026-01-02", products_count: 0, image: null },
  ];
  const pages = [{ id: 9, title: "About Us", handle: "about-us", author: "Team", body_html: "<h2>Our story</h2><p>Hello</p><img src='/cdn/shop/files/team.jpg?v=3&width=800' alt='Team'>", created_at: "2026-01-01", published_at: "2026-01-01", updated_at: "2026-01-03" }];

  const pageOf = (list, url, key) => {
    const limit = Number(url.searchParams.get("limit")) || 30;
    const page = Number(url.searchParams.get("page")) || 1;
    return json({ [key]: list.slice((page - 1) * limit, page * limit) });
  };

  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    fetchImpl.calls.push(url.toString());
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    if (init.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    if (url.origin !== origin && url.hostname !== "cdn.shopify.com") throw new TypeError("Failed to fetch");
    const route = routes[url.pathname + url.search] || routes[url.pathname];
    if (route) return route(url, init);
    switch (url.pathname) {
      case "/meta.json":
        return json({ name: "Test Shop", currency: "INR", url: origin, domain: new URL(origin).host, myshopify_domain: "test.myshopify.com", published_products_count: productCount, published_collections_count: collections.length });
      case "/products.json":
        return pageOf(products, url, "products");
      case "/collections.json":
        return pageOf(collections, url, "collections");
      case "/pages.json":
        return pageOf(pages, url, "pages");
      case "/collections/haircare/products.json":
        return pageOf(products.slice(0, 3), url, "products");
      case "/collections/empty/products.json":
        return pageOf([], url, "products");
    }
    const m = /^\/products\/(.+)\.js$/.exec(url.pathname);
    if (m) {
      const p = products.find(x => x.handle === decodeURIComponent(m[1]));
      if (!p) return new Response("Not found", { status: 404 });
      return json({
        id: p.id,
        media: [{ id: 1, media_type: "image", alt: `Alt for ${p.title}`, src: p.images[0].src.replace("?v=1", "?v=1&width=900"), width: 1080, height: 1080, position: 1 }],
        variants: p.variants.map(v => ({ id: v.id, barcode: `890${v.id}`, sku: v.sku || null, inventory_management: "shopify" })),
      });
    }
    return new Response("<html>not found</html>", { status: 404, headers: { "content-type": "text/html" } });
  };
  fetchImpl.calls = [];
  return fetchImpl;
}

/** Minimal ZIP reader for tests: parses the central directory and inflates entries. */
export function readZip(bytes) {
  const buf = Buffer.from(bytes);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("no end of central directory");
  const count = buf.readUInt16LE(eocd + 10);
  let o = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(o) !== 0x02014b50) throw new Error("bad central directory entry");
    const method = buf.readUInt16LE(o + 10);
    const crc = buf.readUInt32LE(o + 16);
    const csize = buf.readUInt32LE(o + 20);
    const nameLen = buf.readUInt16LE(o + 28);
    const local = buf.readUInt32LE(o + 42);
    const name = buf.subarray(o + 46, o + 46 + nameLen).toString("utf8");
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtra = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + lNameLen + lExtra, local + 30 + lNameLen + lExtra + csize);
    const content = method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
    files.set(name, { content, crc, method });
    o += 46 + nameLen + buf.readUInt16LE(o + 30) + buf.readUInt16LE(o + 32);
  }
  return files;
}
