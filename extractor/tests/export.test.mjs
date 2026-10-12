import { test, describe } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { runExtraction } from "../js/core.js";
import { csvSafe, toCsv, tableOf, ZipBuilder, crc32, buildXlsx, workbookSheets, buildZip, fullJson, datasetJson, downloadImages, imageDimensions } from "../js/export.js";
import { fakeStore, instantSleep, readZip } from "./helpers.mjs";

const extract = () => runExtraction("shop.test", { requestsPerSecond: 1000, concurrency: 4 }, { fetchImpl: fakeStore({ productCount: 12 }), sleep: instantSleep() });

describe("CSV", () => {
  test("neutralises formula injection", () => {
    for (const s of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\tx", "\rx"]) assert.ok(csvSafe(s).replace(/^"/, "").startsWith("'"), s);
    assert.equal(csvSafe(-5), "-5", "real numbers are untouched");
    assert.equal(csvSafe("https://cdn.shopify.com/x.png"), "https://cdn.shopify.com/x.png");
  });

  test("quotes commas, quotes and newlines; writes a BOM and CRLF", () => {
    const csv = toCsv({ headers: ["a", "b"], rows: [['say "hi", ok', "line1\nline2"], [null, true]] });
    assert.ok(csv.startsWith("﻿a,b\r\n"));
    assert.ok(csv.includes('"say ""hi"", ok","line1\nline2"'));
    assert.ok(csv.includes(",true\r\n"));
  });

  test("every dataset produces a table with consistent columns", async () => {
    const r = await extract();
    for (const k of ["products", "variants", "collections", "pages", "images", "errors", "coverage"]) {
      const t = tableOf(r, k);
      assert.ok(t.rows.every(row => row.length === t.headers.length), k);
    }
    assert.equal(tableOf(r, "variants").rows.length, 24);
  });
});

describe("ZIP", () => {
  test("round-trips stored and deflated entries with correct CRCs and UTF-8 names", async () => {
    const zip = new ZipBuilder();
    const big = "hello world ".repeat(500);
    await zip.add("a.txt", "short");
    await zip.add("dir/big.json", big);
    await zip.add("images/ünïcode 🌿.bin", new Uint8Array([1, 2, 3, 4]), { compress: false });
    await zip.add("a.txt", "duplicate name gets renamed");
    await zip.add("../../evil.txt", "path traversal neutralised");
    const files = readZip(zip.toUint8Array());
    assert.equal(files.get("a.txt").content.toString(), "short");
    assert.equal(files.get("dir/big.json").content.toString(), big);
    assert.equal(files.get("dir/big.json").method, 8, "large text is deflated");
    assert.deepEqual([...files.get("images/ünïcode 🌿.bin").content], [1, 2, 3, 4]);
    assert.ok([...files.keys()].some(n => n.startsWith("a-")));
    assert.ok(![...files.keys()].some(n => n.includes("..")));
    for (const [, f] of files) assert.equal(crc32(f.content), f.crc);
  });

  test("crc32 matches zlib", () => {
    const data = Buffer.from("The quick brown fox jumps over the lazy dog");
    assert.equal(crc32(data), zlib.crc32(data));
  });

  test("full export bundle contains JSON, CSV and the image manifest", async () => {
    const r = await extract();
    const files = readZip((await buildZip(r)).toUint8Array());
    for (const name of ["README.txt", "extraction.json", "json/products.json", "json/variants.json", "json/collections.json", "json/pages.json", "json/images.json", "json/errors.json", "json/coverage.json", "csv/products.csv", "csv/images.csv", "image-manifest.json", "image-manifest.csv"]) {
      assert.ok(files.has(name), name);
    }
    const full = JSON.parse(files.get("extraction.json").content.toString());
    assert.equal(full.products.length, 12);
    assert.equal(full.summary.products, 12);
    assert.deepEqual(Object.keys(full).slice(0, 13), ["store", "products", "collections", "pages", "blogs", "articles", "banners", "posters", "images", "discoveredUrls", "errors", "coverage", "summary"]);
    const manifest = JSON.parse(files.get("image-manifest.json").content.toString());
    assert.equal(manifest.length, r.images.length);
    assert.ok(manifest.every(m => m.url && m.category && m.download));
  });
});

describe("XLSX", () => {
  test("builds a valid workbook where text (incl. formulas) is stored as strings", async () => {
    const r = await extract();
    r.products[0].title = '=HYPERLINK("http://evil","click") & <b>"x"</b>\u0001';
    const blob = await buildXlsx(workbookSheets(r));
    const files = readZip(new Uint8Array(await blob.arrayBuffer()));
    for (const n of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet7.xml"]) assert.ok(files.has(n), n);
    const wb = files.get("xl/workbook.xml").content.toString();
    assert.match(wb, /<sheet name="Products"/);
    assert.match(wb, /<sheet name="Variants"/);
    const sheet = files.get("xl/worksheets/sheet1.xml").content.toString();
    assert.ok(!sheet.includes("<f>"), "no formula cells");
    assert.ok(sheet.includes('t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;http://evil&quot;,&quot;click&quot;) &amp; &lt;b&gt;'));
    assert.ok(!sheet.includes("\u0001"), "invalid XML characters are stripped");
    assert.match(sheet, /<c r="I2"><v>349<\/v><\/c>/, "prices are numeric cells");
  });
});

describe("JSON", () => {
  test("full and per-type JSON parse back, including tricky characters", async () => {
    const r = await extract();
    r.pages[0].contentText = 'Line sep "quotes" \\ backslash </script>';
    const full = JSON.parse(fullJson(r));
    assert.equal(full.pages[0].contentText, r.pages[0].contentText);
    const v = JSON.parse(datasetJson(r, "variants"));
    assert.equal(v.count, 24);
    assert.equal(v.items[0].productHandle, "product-1");
  });
});

describe("image download", () => {
  const PNG = Uint8Array.from(Buffer.from("89504e470d0a1a0a0000000d494844520000000300000002080600000000000000", "hex"));

  test("validates type, enforces size, de-duplicates by hash and reports failures", async () => {
    const responses = {
      "a.png": () => new Response(PNG, { headers: { "content-type": "image/png" } }),
      "b.png": () => new Response(PNG, { headers: { "content-type": "image/png" } }), // same bytes as a.png
      "c.png": () => new Response("<html>nope</html>", { headers: { "content-type": "text/html" } }),
      "d.png": () => new Response(new Uint8Array(5000), { headers: { "content-type": "image/png" } }),
      "e.png": () => new Response("", { status: 404 }),
    };
    const images = Object.keys(responses).map((f, i) => ({ id: "i" + i, url: `https://cdn.shopify.com/s/files/1/1/1/1/files/${f}`, filename: f, category: "product_image", isShopifyCdn: true }));
    const { Requester } = await import("../js/core.js");
    const requested = [];
    const requester = new Requester({
      fetchImpl: async u => {
        requested.push(u);
        return responses[new URL(u).pathname.split("/").pop()]();
      },
      sleep: instantSleep(),
      requestsPerSecond: 1000,
      maxRetries: 0,
    });
    const { files, stats } = await downloadImages(images, requester, { maxBytesEach: 4000, maxWidth: 1600 });
    assert.equal(stats.downloaded, 1);
    assert.equal(stats.duplicates, 1);
    assert.equal(stats.failed, 3);
    assert.equal(files.length, 1);
    assert.match(files[0].path, /^images\/product_image\/a-[a-z0-9]+\.png$/);
    assert.equal(images[0].download.status, "downloaded");
    assert.equal(images[0].download.pixelWidth, 3);
    assert.equal(images[1].download.status, "duplicate");
    assert.match(images[2].download.error, /not a supported image/);
    assert.match(images[3].download.error, /limit/);
    assert.equal(images[4].download.status, "failed");
    assert.ok(requested.every(u => u.includes("width=1600")), "width cap applied to Shopify CDN URLs");
  });

  test("respects the max image count", async () => {
    const images = Array.from({ length: 5 }, (_, i) => ({ id: "x" + i, url: `https://cdn.shopify.com/s/files/1/1/1/1/files/${i}.png`, filename: `${i}.png`, category: "other" }));
    const { Requester } = await import("../js/core.js");
    const requester = new Requester({ fetchImpl: async () => new Response(PNG), sleep: instantSleep(), requestsPerSecond: 1000 });
    const { stats } = await downloadImages(images, requester, { maxCount: 2 });
    assert.equal(stats.skipped, 3);
    assert.equal(images[4].download.status, "skipped");
  });

  test("reads PNG dimensions from the header", () => {
    assert.deepEqual(imageDimensions(PNG, "image/png"), { width: 3, height: 2 });
  });
});
