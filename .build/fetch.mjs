const base='https://www.chekorganics.com';
const j=async u=>(await fetch(u)).json();
const cols=(await j(base+'/collections.json')).collections;
const out=[];
for(const c of cols){
  if(c.handle==='home-page') continue;
  let p=[];
  try{ p=(await j(`${base}/collections/${c.handle}/products.json?limit=250`)).products; }catch(e){}
  out.push({handle:c.handle,title:c.title,image:c.image&&c.image.src,products:p.map(x=>x.handle)});
}
console.log(JSON.stringify(out));
