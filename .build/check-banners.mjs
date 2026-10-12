import sharp from 'sharp';
import path from 'path';
const files = ['hero-1-desktop.webp','hero-2-desktop.webp','hero-1-mobile.webp','hero-2-mobile.webp'];
async function zone(f, x, y, w, h) {
  const buf = await sharp(path.resolve('../assets/brand', f)).extract({left:x, top:y, width:w, height:h}).png().toBuffer();
  const s = await sharp(buf).stats();
  const ch = s.channels;
  const luma = 0.2126*ch[0].mean + 0.7152*ch[1].mean + 0.0722*ch[2].mean;
  return { mean: +luma.toFixed(1), sd: +((ch[0].stdev+ch[1].stdev+ch[2].stdev)/3).toFixed(1) };
}
for (const f of files) {
  const m = await sharp(path.resolve('../assets/brand', f)).metadata();
  const W = m.width, H = m.height;
  const isD = f.includes('desktop');
  const textZone = isD ? await zone(f, 0, 0, Math.round(W*0.42), H) : await zone(f, 0, Math.round(H*0.52), W, Math.round(H*0.48));
  const artZone  = isD ? await zone(f, Math.round(W*0.55), 0, Math.round(W*0.45), H) : await zone(f, 0, 0, W, Math.round(H*0.5));
  console.log(f.padEnd(24), 'TEXT luma=' + textZone.mean, 'sd=' + textZone.sd, '| ART luma=' + artZone.mean, 'sd=' + artZone.sd);
}
