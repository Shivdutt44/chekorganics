const { chromium } = require('playwright');
const sharp = require(require('path').resolve(__dirname, 'node_modules/sharp'));
const BASE = 'http://localhost:4173';
const OUT = __dirname + '/shots3/';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const widths = [390, 768, 900, 960, 1024, 1200, 1440];
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    const clip = await page.evaluate(() => {
      const hero = document.querySelector('.hero').getBoundingClientRect();
      const h1 = document.querySelector('.hero__panel.is-active h1').getBoundingClientRect();
      return {
        hero: { x: Math.round(hero.x), y: Math.round(hero.y), width: Math.round(hero.width), height: Math.round(hero.height) },
        h1: { x: Math.round(h1.x), y: Math.round(h1.y), width: Math.round(h1.width), height: Math.round(h1.height) },
        src: document.querySelector('.hero__slide.is-active img').currentSrc.split('/').pop()
      };
    });
    const file = OUT + 'hero-w' + w + '.png';
    await page.screenshot({ path: file, clip: { x: clip.hero.x, y: clip.hero.y, width: clip.hero.width, height: Math.min(clip.hero.height, 900) } });
    // sample the band right behind the headline
    const band = await sharp(file)
      .extract({ left: Math.max(0, clip.h1.x - clip.hero.x - 10), top: Math.max(0, clip.h1.y - clip.hero.y - 10), width: Math.min(clip.h1.width + 20, clip.hero.width), height: Math.min(clip.h1.height + 20, Math.min(clip.hero.height, 900)) })
      .png().toBuffer();
    const s = await sharp(band).stats();
    const luma = 0.2126 * s.channels[0].mean + 0.7152 * s.channels[1].mean + 0.0722 * s.channels[2].mean;
    console.log('width', w, '| art:', clip.src, '| behind-headline luma:', +luma.toFixed(1));
  }
  await browser.close();
})();
