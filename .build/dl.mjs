import fs from 'fs'; import path from 'path';
const OUT = path.resolve('../assets');
const data = JSON.parse(fs.readFileSync('products.json','utf8')).products;
const B = 'https://cdn.shopify.com';
const brand = {
  'logo.png': 'https://www.chekorganics.com/cdn/shop/files/2_66db1a97-92b4-4807-8964-fd4914b35bd4.png?v=1777289316&width=480',
  'logo-mark.jpg': 'https://www.chekorganics.com/cdn/shop/files/CkekOtganics_Logo_Profile_Picture-07.jpg?v=1&width=512',
  'hero-desktop.jpg': 'https://www.chekorganics.com/cdn/shop/files/Hero_banner_desktop_1440_X_600.jpg?v=1783507635&width=1800',
  'hero-mobile.jpg': 'https://www.chekorganics.com/cdn/shop/files/webiste_hero_potrait_Banner_750_x_1000_px_3.jpg?v=1783507650&width=900',
  'founder.jpg': 'https://www.chekorganics.com/cdn/shop/files/keerthi_profile_image.jpg?v=1753770127&width=700',
  'badge-ayush.png': 'https://www.chekorganics.com/cdn/shop/files/Ayush_Logo_No_BG_website_trust_badges_icons_80_x_80_px.png?v=1778133602&width=240',
  'badge-awards.png': 'https://www.chekorganics.com/cdn/shop/files/Awards_icon_badges_80_x_80_px_No_BG.png?width=240',
  'badge-farmer.png': 'https://www.chekorganics.com/cdn/shop/files/Farmer_icon_website_trust_badges_80_x_80_px_No_BG.png?width=240',
  'badge-1.png': 'https://www.chekorganics.com/cdn/shop/files/website_trust_badges_icons_80_x_80_px_2.png?width=240',
  'badge-2.png': 'https://www.chekorganics.com/cdn/shop/files/website_trust_badges_icons_80_x_80_px_4.png?width=240',
  'badge-3.png': 'https://www.chekorganics.com/cdn/shop/files/website_trust_badges_icons_80_x_80_px_5.png?width=240',
  'badge-4.png': 'https://www.chekorganics.com/cdn/shop/files/website_trust_badges_icons_80_x_80_px_2.png?width=240',
  'journey.png': 'https://www.chekorganics.com/cdn/shop/files/Green_Organic_Yoga_YouTube_Thumbnail_1980_x_1020px_900_x_900px_1980_x_1020px_YouTube_Thumbnail_YouTube_Channel_Art.png?v=1777530371&width=1600',
  'launch.png': 'https://www.chekorganics.com/cdn/shop/files/ElevenLabs_image_nano-banana-2__img1Chekor..._2026-03-07T08_10_25.png?v=1773035262&width=1600',
  'result-hair.png': 'https://www.chekorganics.com/cdn/shop/files/Instarang_before_after_-_Haircare_9.png?width=1200',
  'result-skin.png': 'https://www.chekorganics.com/cdn/shop/files/Noni_Skin_healing_gel_-_no_surgery_130.png?width=1200',
  'result-wellness.png': 'https://www.chekorganics.com/cdn/shop/files/Noni_Juice_-_post_OPH_surgery.png?width=1200',
  'farm-1.jpg': 'https://www.chekorganics.com/cdn/shop/files/20210705_212210.jpg?width=900',
  'farm-2.jpg': 'https://www.chekorganics.com/cdn/shop/files/20210705_212427-min.jpg?width=900',
  'farm-3.jpg': 'https://www.chekorganics.com/cdn/shop/files/IMG20220926143220.jpg?width=900',
  'story-1.jpg': 'https://www.chekorganics.com/cdn/shop/files/60.jpg?width=900',
  'story-2.jpg': 'https://www.chekorganics.com/cdn/shop/files/61.jpg?width=900',
  'story-3.jpg': 'https://www.chekorganics.com/cdn/shop/files/1.jpg?width=900',
  'story-4.jpg': 'https://www.chekorganics.com/cdn/shop/files/7.jpg?width=900',
};
const collImg = {
  'superfoods-1': 'https://cdn.shopify.com/s/files/1/0638/2904/9431/collections/Nonijuice800mlbottlefront.png?v=1753420919&width=800',
  'mens-grooming': 'https://cdn.shopify.com/s/files/1/0638/2904/9431/collections/Men_dude_hair_oil.png?v=1753876774&width=800',
  'chekorganics-ashyukajal-noni-kajal': 'https://cdn.shopify.com/s/files/1/0638/2904/9431/collections/AshyuKajal.png?v=1779168480&width=800',
};
const jobs = [];
for (const [name, url] of Object.entries(brand)) jobs.push([path.join(OUT,'brand',name), url]);
for (const [h, url] of Object.entries(collImg)) jobs.push([path.join(OUT,'collections',h+'.png'), url]);
for (const p of data) {
  p.images.map(i=>i.src).forEach((src, i) => {
    const ext = (src.match(/\.(png|jpe?g|webp|gif)/i)||['.jpg'])[0].toLowerCase();
    jobs.push([path.join(OUT,'products', `${p.handle}-${i}${ext}`), src + (src.includes('?')?'&':'?') + 'width=900']);
  });
}
let ok=0, fail=[];
async function run(job){
  const [dest, url] = job;
  try {
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) { ok++; return; }
    fs.mkdirSync(path.dirname(dest), {recursive:true});
    const r = await fetch(url, {headers:{'user-agent':'Mozilla/5.0'}});
    if (!r.ok) throw new Error(r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 500) throw new Error('tiny');
    fs.writeFileSync(dest, buf); ok++;
  } catch(e){ fail.push(url+' :: '+e.message); }
}
const queue = jobs.slice();
async function worker(){ while(queue.length){ await run(queue.shift()); } }
await Promise.all(Array.from({length:8}, worker));
console.log('downloaded', ok, 'failed', fail.length);
fail.forEach(f=>console.log('FAIL', f));
