import fs from 'fs';
const raw=JSON.parse(fs.readFileSync('products.json','utf8')).products;
const cols=JSON.parse(fs.readFileSync('collections.json','utf8'));
const handle2col={};
for(const c of cols) for(const h of c.products) (handle2col[h]??=[]).push(c.title);
const clean=s=>s.replace(/\s+/g,' ').trim();
const strip=h=>clean(h.replace(/<[^>]*>/g,' ')).slice(0,240);
const products=raw.map(p=>{
  const v=p.variants[0]||{};
  const price=parseFloat(v.price);
  const cmp=v.compare_at_price?parseFloat(v.compare_at_price):null;
  const imgs=p.images.map(i=>i.src);
  return {
    id:p.id, title:clean(p.title), handle:p.handle,
    price, compareAt:(cmp&&cmp>price)?cmp:null,
    image:imgs[0], images:imgs.slice(0,4),
    type:p.product_type||'', tags:p.tags,
    collections:handle2col[p.handle]||[],
    excerpt:strip(p.body_html||''),
    available: v.available!==false
  };
});
const data={products,collections:cols.filter(c=>c.handle!=='all-products').map(c=>({title:c.title,handle:c.handle,image:c.image}))};
fs.writeFileSync('../data.js','// CHEKORGANICS catalog data (from chekorganics.com)\nwindow.STORE='+JSON.stringify(data)+';\n');
console.log('products',products.length);
console.log('types', [...new Set(products.map(p=>p.type))]);
console.log('no image:', products.filter(p=>!p.image).length);
console.log(JSON.stringify(products.slice(0,2),null,1));
