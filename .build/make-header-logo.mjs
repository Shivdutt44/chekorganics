// Builds the header logo (assets/brand/logo-header.webp) from the store's own artwork:
// the round brand emblem (logo-mark.webp) beside the "CHEKORGANICS / Route to Roots"
// wordmark cut out of logo.webp, recoloured cream on a transparent background so it reads
// on the dark green header.   node make-header-logo.mjs   (run from .build/)
import sharp from "sharp";

const SRC_LOGO = "../assets/brand/logo.webp";   // 480×480, wordmark on brown
const SRC_MARK = "../assets/brand/logo-mark.webp"; // 512×512 emblem on brown
const OUT = "../assets/brand/logo-header.webp";

const H = 200;            // output height (renders at ~36–44px: crisp on 3× screens)
const GAP = 26;
const TEXT_H = 124;       // wordmark height relative to the emblem
const CREAM = [255, 250, 240];

// wordmark region in logo.webp (both lines), measured from the artwork
const WORD = { left: 12, top: 266, width: 456, height: 78 };

// 1. emblem: brown disc with the white seal, as on the store's profile picture
const disc = Buffer.from(`<svg width="${H}" height="${H}"><circle cx="${H / 2}" cy="${H / 2}" r="${H / 2}" fill="#fff"/></svg>`);
const emblem = await sharp(SRC_MARK).resize(H, H).composite([{ input: disc, blend: "dest-in" }]).png().toBuffer();

// 2. wordmark: brightness → alpha (brown background drops out, anti-aliasing kept)
const { data, info } = await sharp(SRC_LOGO).extract(WORD).raw().toBuffer({ resolveWithObject: true });
const BG_LUM = 0.299 * 143 + 0.587 * 69 + 0.114 * 37;
const rgba = Buffer.alloc(info.width * info.height * 4);
for (let i = 0, j = 0; i < data.length; i += info.channels, j += 4) {
  const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  const a = Math.max(0, Math.min(1, (lum - BG_LUM - 8) / (235 - BG_LUM)));
  rgba[j] = CREAM[0]; rgba[j + 1] = CREAM[1]; rgba[j + 2] = CREAM[2];
  rgba[j + 3] = Math.round(a * 255);
}
const word = await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
  .resize({ height: TEXT_H }).png().toBuffer();
const wordMeta = await sharp(word).metadata();

// 3. side by side, wordmark vertically centred
const W = H + GAP + wordMeta.width;
await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([
    { input: emblem, left: 0, top: 0 },
    { input: word, left: H + GAP, top: Math.round((H - TEXT_H) / 2) }
  ])
  .webp({ quality: 92, alphaQuality: 100 })
  .toFile(OUT);
console.log(`${OUT}: ${W}×${H}`);
