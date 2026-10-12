import sharp from 'sharp';
import fs from 'fs';
const files = [
  '../assets/brand/farm-1.webp','../assets/brand/farm-2.webp','../assets/brand/farm-3.webp',
  '../assets/brand/story-1.webp','../assets/brand/story-3.webp','../assets/brand/journey.webp',
  '../assets/brand/launch.webp','../assets/brand/logo.webp',
  '../assets/products/chekorganics-noni-fruit-juice-ayush-certified-ayurvedic-wellness-elixir-0.webp',
  '../assets/products/chekorganics-bodyhues-noni-herbal-hair-oil-200ml-0.webp',
  '../assets/products/noni-herbal-shampoo-500ml-0.webp',
  '../assets/products/chekorganics-ashyukavach-organic-noni-sun-defence-cream-spf-30-natural-ayurvedic-sunscreen-broad-spectrum-protection-0.webp',
  '../assets/products/chekorganics-bodyhues-noni-turmeric-soap-100gm-0.webp',
  '../assets/products/chekorganics-mulika-manjan-ayurvedic-herbal-tooth-paste-18-herbs-fluoride-free-0.webp'
];
for (const f of files) {
  try {
    const m = await sharp(f).metadata();
    const stats = await sharp(f).stats();
    const alpha = stats.isOpaque ? 'opaque' : 'alpha';
    console.log(f.replace('../assets/','').padEnd(78), m.width + 'x' + m.height, m.format, alpha);
  } catch (e) { console.log('ERR', f, e.message); }
}
