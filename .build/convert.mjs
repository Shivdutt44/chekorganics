import sharp from 'sharp'; import fs from 'fs'; import path from 'path';
const root = path.resolve('../assets');
const walk = d => fs.readdirSync(d, {withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(path.join(d,e.name)) : [path.join(d,e.name)]);
const files = walk(root).filter(f => /\.(png|jpe?g)$/i.test(f));
let n = 0, saved = 0;
for (const f of files) {
  const before = fs.statSync(f).size;
  const out = f.replace(/\.(png|jpe?g)$/i, '.webp');
  try {
    const isHero = /hero-desktop/.test(f);
    await sharp(f).resize({width: isHero ? 1800 : 900, withoutEnlargement: true}).webp({quality: 82}).toFile(out);
    const after = fs.statSync(out).size;
    if (after < before) { fs.unlinkSync(f); saved += before - after; n++; }
    else { fs.unlinkSync(out); }
  } catch (e) { console.log('ERR', f, e.message); }
}
console.log('converted', n, 'freed', (saved/1048576).toFixed(1)+'MB');
