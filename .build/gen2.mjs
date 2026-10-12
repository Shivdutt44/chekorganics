import fs from 'fs'; import path from 'path';
const raw = JSON.parse(fs.readFileSync('products.json','utf8')).products;
const cols = JSON.parse(fs.readFileSync('collections.json','utf8'));
const ratings = JSON.parse(fs.readFileSync('ratings.json','utf8'));
const featured = ["chekorganics-noni-fruit-juice-ayush-certified-ayurvedic-wellness-elixir","chekorganics-bodyhues-noni-herbal-hair-oil-200ml","noni-herbal-shampoo-500ml","noni-herbal-shampoo","chekorganics-bodyhues-noni-herbal-bath-powder-250g","chekorganics-bodyhues-instarang-noni-herbal-hair-color","chekorganics-bodyhues-noni-turmeric-soap-100gm","chekorganics-bodyhues-organic-noni-body-butter-50g-copy","chekorganics-bodyhues-organic-noni-body-butter-50g","chekorganics-bodyhues-organic-pulpy-papaya-de-tanning-bath-bar-100g","chekorganics-bodyhues-passion-fruit-lip-balm","chekorganics-bodyhues-noni-herbal-hair-oil-500ml","chekorganics-superfoods-spirulina-powder-100g","chekorganics-noni-herbal-hair-pack-250gm-copy","chekorganics-ashyukavach-organic-noni-sun-defence-cream-spf-30-natural-ayurvedic-sunscreen-broad-spectrum-protection","chekorganics-bodyhues-nourishing-noni-lip-balm-clear-transparent","chekorganics-mulika-manjan-ayurvedic-herbal-tooth-paste-18-herbs-fluoride-free","chekorganics-noni-eyebrow-growth-roll-on-10ml","chekorganic-sanjeeva-thailam-100-ayurvedic-multipurpose-oil-100ml","chekorganics-bodyhues-organic-noni-fruit-bath-bar-100g"];

const clean = s => s.replace(/\s+/g,' ').trim();
const strip = h => clean(h.replace(/<[^>]*>/g,' ')).replace(/&amp;/g,'&').slice(0,220);
const handle2cols = {};
for (const c of cols) for (const h of c.products) (handle2cols[h] ??= []).push(c.title);
const extOf = src => (src.match(/\.(png|jpe?g|webp|gif)/i) || ['.jpg'])[0].toLowerCase();
const local = (src, i, handle) => {
  const f = `assets/products/${handle}-${i}`.replace(/\.(png|jpe?g|webp|gif)$/i, '') + '.webp';
  return fs.existsSync(path.resolve('..', f)) ? f : src;
};

const products = raw.map(p => {
  const v = p.variants[0] || {};
  const price = parseFloat(v.price);
  const cmp = v.compare_at_price ? parseFloat(v.compare_at_price) : null;
  const imgs = p.images.map(i => i.src);
  const r = ratings[p.handle];
  const colsFor = handle2cols[p.handle] || [];
  let badge = null;
  if (r && r.reviews >= 4) badge = 'Bestseller';
  else if (featured.includes(p.handle) && r) badge = 'Top rated';
  else if (/launch|sun defence|spf/i.test(p.title)) badge = 'New launch';
  return {
    id: p.id, title: clean(p.title), handle: p.handle,
    price, compareAt: cmp && cmp > price ? cmp : null,
    images: imgs.map((s,i) => local(s,i,p.handle)),
    type: p.product_type || '', tags: p.tags,
    collections: colsFor,
    primaryCollection: colsFor.find(c => c !== 'All Products') || 'All Products',
    excerpt: strip(p.body_html || ''),
    rating: r ? r.rating : null, reviews: r ? r.reviews : 0,
    available: v.available !== false, badge,
    featured: featured.indexOf(p.handle)
  };
}).sort((a,b) => (a.featured < 0 ? 99 : a.featured) - (b.featured < 0 ? 99 : b.featured));

const colBlurb = {
  'Superfoods': 'Farm-grown Noni, Spirulina, Amla & Moringa — raw nutrition, zero compromise.',
  'Haircare': 'Noni-powered oils, shampoos & packs for stronger roots and thicker hair.',
  'Skin Care': 'Ayurvedic glow rituals: sun defence, de-tan, kajal & nourishing butters.',
  'Handmade Soaps': 'Cold-process bars, cured slow with turmeric, neem, papaya & charcoal.',
  'Moisturisers': 'Body milks & butters that drink into skin — 7x longer hydration.',
  'Lip Care': 'Passion-fruit & Noni balms for soft, glossy, naturally tinted lips.',
  "Men's Grooming": 'DUDE range — beard, hair & beard oil built for Indian summers.',
  'Oral Care': 'MULIKA MANJAN: 18+ herbs, fluoride-free, dentist-revered.',
  'Eye Care': 'AshyuKajal — 32 Ayurvedic herbs, handcrafted on Amavasya.',
  'Herbal Hair Colours': 'INSTARANG — 100% chemical-free colour that covers greys naturally.'
};
const prodByHandle = Object.fromEntries(raw.map(p => [p.handle, p]));
const collections = cols.filter(c => c.handle !== 'all-products' && c.handle !== 'home-page').map(c => {
  const img = c.image ? `assets/collections/${c.handle}.webp` : null;
  const first = c.products.map(h => prodByHandle[h]).find(Boolean);
  const firstImg = first && first.images[0] ? local(first.images[0].src, 0, first.handle) : null;
  return {
    title: c.title, handle: c.handle, count: c.products.length,
    image: img && fs.existsSync(path.resolve('..', img)) ? img : firstImg,
    blurb: colBlurb[c.title] || ''
  };
});

const out = { products, collections, featuredCount: featured.length };
fs.writeFileSync('../data.js',
  '/* CHEKORGANICS catalog — collected from chekorganics.com */\nwindow.STORE = ' + JSON.stringify(out, null, 0) + ';\n');
console.log('products', products.length, '| collections', collections.length);
console.log('missing collection imgs:', collections.filter(c=>!c.image).map(c=>c.title));
console.log('missing product imgs:', products.filter(p=>!p.images.length || p.images.some(i=>i.startsWith('http'))).length);
