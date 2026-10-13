/* Composes hero banner artwork (desktop + mobile) for CHEKORGANICS
   from the collected farm photography and transparent product shots.
   Output: assets/brand/hero-{1,2}-{desktop,mobile}.webp
   Text stays in HTML (crisp, translatable, accessible) — art only here. */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const A = p => path.resolve('..', p);
const OUT = p => path.resolve('../assets/brand', p);
const P = h => path.resolve('../assets/products', h);

const DEEP = '#08190f', FOREST = '#0f3722', LEAF = '#1c6a44', GOLD = '#c29a45', GOLD2 = '#e3c47c';

/* ---------------------------------------------------------------- helpers */
const svg = s => Buffer.from(s);

async function circleImage(src, size, cropFocus) {
  const img = await sharp(src).resize(size, size, { fit: 'cover', position: cropFocus || sharp.strategy.attention }).png().toBuffer();
  const mask = svg(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
  return sharp(img).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

async function roundedImage(src, w, h, r) {
  const img = await sharp(src).resize(w, h, { fit: 'cover' }).png().toBuffer();
  const mask = svg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" fill="#fff"/></svg>`);
  return sharp(img).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

async function scaled(src, height) {
  const b = await sharp(src).resize(null, height, { fit: 'inside' }).png().toBuffer();
  const m = await sharp(b).metadata();
  return { buf: b, w: m.width, h: m.height };
}

function place(img, cx, baseY) {
  return { input: img.buf, left: Math.round(cx - img.w / 2), top: Math.round(baseY - img.h) };
}

/* ------------------------------------------------------------- backgrounds */
function desktopBase(opt) {
  const w = 1920, h = 800;
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${DEEP}"/><stop offset="0.55" stop-color="${FOREST}"/><stop offset="1" stop-color="${LEAF}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="${GOLD2}" stop-opacity="0.5"/>
      <stop offset="0.55" stop-color="${GOLD}" stop-opacity="0.16"/>
      <stop offset="1" stop-color="${GOLD}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#7de0a8" stop-opacity="0.22"/><stop offset="1" stop-color="#7de0a8" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="scrim" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${DEEP}" stop-opacity="0.96"/>
      <stop offset="0.42" stop-color="${DEEP}" stop-opacity="0.72"/>
      <stop offset="0.72" stop-color="${DEEP}" stop-opacity="0.12"/>
      <stop offset="1" stop-color="${DEEP}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${DEEP}" stop-opacity="0"/><stop offset="1" stop-color="${DEEP}" stop-opacity="0.85"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <ellipse cx="${opt.glowX}" cy="380" rx="620" ry="520" fill="url(#glow)"/>
  <ellipse cx="${opt.glow2X || 300}" cy="120" rx="520" ry="380" fill="url(#glow2)"/>
  ${opt.dots || ''}
  <rect width="${w}" height="${h}" fill="url(#scrim)"/>
  <rect x="0" y="${h - 240}" width="${w}" height="240" fill="url(#floor)" opacity="0.5"/>
  <circle cx="${opt.glowX}" cy="380" r="${opt.ring}" fill="none" stroke="${GOLD}" stroke-opacity="0.45" stroke-width="2"/>
  <circle cx="${opt.glowX}" cy="380" r="${opt.ring + 26}" fill="none" stroke="${GOLD2}" stroke-opacity="0.25" stroke-width="1.5" stroke-dasharray="3 14"/>
  <rect x="46" y="46" width="${w - 92}" height="${h - 92}" rx="26" fill="none" stroke="${GOLD2}" stroke-opacity="0.18"/>
  </svg>`);
}

function mobileBase(opt) {
  const w = 750, h = 1050;
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="${FOREST}"/><stop offset="0.45" stop-color="${DEEP}"/><stop offset="1" stop-color="#061209"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="${GOLD2}" stop-opacity="0.4"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#061209" stop-opacity="0.34"/>
      <stop offset="0.22" stop-color="#061209" stop-opacity="0.18"/>
      <stop offset="0.40" stop-color="#061209" stop-opacity="0.55"/>
      <stop offset="0.52" stop-color="#061209" stop-opacity="0.94"/>
      <stop offset="1" stop-color="#061209" stop-opacity="1"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <ellipse cx="${opt.gx}" cy="${opt.gy}" rx="420" ry="380" fill="url(#glow)"/>
  <circle cx="${opt.gx}" cy="${opt.gy}" r="${opt.ring}" fill="none" stroke="${GOLD}" stroke-opacity="0.4" stroke-width="2"/>
  <circle cx="${opt.gx}" cy="${opt.gy}" r="${opt.ring + 18}" fill="none" stroke="${GOLD2}" stroke-opacity="0.22" stroke-width="1.5" stroke-dasharray="3 11"/>
  <rect width="${w}" height="${h}" fill="url(#fade)"/>
  <rect x="22" y="22" width="${w - 44}" height="${h - 44}" rx="22" fill="none" stroke="${GOLD2}" stroke-opacity="0.16"/>
  </svg>`);
}

const HD_DESKTOP = 'C:/Users/shivd/.gemini/antigravity-ide/brain/f9e93b12-9557-47c4-8cd2-81a1a6ac9168/hero_1_desktop_hd_1791888327610.jpg';
const HD_MOBILE = 'C:/Users/shivd/.gemini/antigravity-ide/brain/f9e93b12-9557-47c4-8cd2-81a1a6ac9168/hero_1_mobile_hd_1791888356775.jpg';

/* -------------------------------------------------------------- slide one (Ultra-HD 8K) */
async function slide1Desktop() {
  return sharp(HD_DESKTOP)
    .resize(1920, 800, { fit: 'cover', position: 'right' })
    .webp({ quality: 95 })
    .toBuffer();
}

async function slide1Mobile() {
  return sharp(HD_MOBILE)
    .resize(750, 1050, { fit: 'cover', position: 'top' })
    .webp({ quality: 95 })
    .toBuffer();
}

/* -------------------------------------------------------------- slide two */
async function slide2Desktop() {
  const w = 1920, h = 800;
  const cardW = 820, cardH = 470, cardX = 1000, cardY = 165;
  const card = await roundedImage(A('assets/brand/launch.webp'), cardW, cardH, 26);
  const cream = await circleImage(A('assets/products/chekorganics-ashyukavach-organic-noni-sun-defence-cream-spf-30-natural-ayurvedic-sunscreen-broad-spectrum-protection-0.webp'), 300);
  const base = await sharp(desktopBase({ glowX: 1410, ring: 300, glow2X: 200 })).png().toBuffer();
  const deco = svg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect x="${cardX - 14}" y="${cardY - 14}" width="${cardW + 28}" height="${cardH + 28}" rx="34" fill="none" stroke="${GOLD2}" stroke-opacity="0.55" stroke-width="2"/>
    <rect x="${cardX + cardW - 120}" y="${cardY + cardH - 6}" width="240" height="12" rx="6" fill="${GOLD2}" opacity="0.35"/>
  </svg>`);
  return sharp(base).composite([
    { input: card, left: cardX, top: cardY },
    { input: deco, left: 0, top: 0 },
    { input: cream, left: 905, top: 470 }
  ]).webp({ quality: 84 }).toBuffer();
}

async function slide2Mobile() {
  const w = 750, h = 1050;
  const cardW = 560, cardH = 316, cardX = 95, cardY = 96;
  const card = await roundedImage(A('assets/brand/launch.webp'), cardW, cardH, 22);
  const cream = await circleImage(A('assets/products/chekorganics-ashyukavach-organic-noni-sun-defence-cream-spf-30-natural-ayurvedic-sunscreen-broad-spectrum-protection-0.webp'), 180);
  const base = await sharp(mobileBase({ gx: 375, gy: 250, ring: 190 })).png().toBuffer();
  const deco = svg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect x="${cardX - 10}" y="${cardY - 10}" width="${cardW + 20}" height="${cardH + 20}" rx="30" fill="none" stroke="${GOLD2}" stroke-opacity="0.5" stroke-width="2"/>
  </svg>`);
  return sharp(base).composite([
    { input: card, left: cardX, top: cardY },
    { input: deco, left: 0, top: 0 },
    { input: cream, left: 95, top: 330 }
  ]).webp({ quality: 84 }).toBuffer();
}

/* ------------------------------------------------------------------- run */
const jobs = [
  ['hero-1-desktop.webp', slide1Desktop],
  ['hero-1-mobile.webp', slide1Mobile],
  ['hero-2-desktop.webp', slide2Desktop],
  ['hero-2-mobile.webp', slide2Mobile]
];
for (const [name, fn] of jobs) {
  const buf = await fn();
  fs.writeFileSync(OUT(name), buf);
  const m = await sharp(OUT(name)).metadata();
  console.log(name.padEnd(24), m.width + 'x' + m.height, (buf.length / 1024).toFixed(0) + ' KB');
}
