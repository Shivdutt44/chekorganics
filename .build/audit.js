const { chromium } = require('playwright');
const BASE = 'http://localhost:4173';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

  for (const url of ['/index.html', '/shop.html', '/product.html?p=noni-herbal-shampoo-500ml']) {
    await page.goto(BASE + url, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);
    const audit = await page.evaluate(() => {
      const imgs = Array.from(document.images);
      const broken = imgs.filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src'));
      const doc = document.documentElement;
      const wide = Array.from(document.querySelectorAll('body *'))
        .filter(el => el.getBoundingClientRect().right > doc.clientWidth + 2)
        .slice(0, 5)
        .map(el => el.tagName + '.' + (el.className && el.className.baseVal === undefined ? String(el.className).slice(0, 40) : ''));
      const links = Array.from(document.querySelectorAll('a[href]'))
        .map(a => a.getAttribute('href'))
        .filter(h => h && !h.startsWith('http') && !h.startsWith('#') && !h.startsWith('mailto:'));
      return {
        title: document.title,
        images: imgs.length, broken,
        overflowX: doc.scrollWidth - doc.clientWidth, wide,
        font: getComputedStyle(document.querySelector('h1, h2')).fontFamily,
        localLinks: [...new Set(links)]
      };
    });
    console.log('\n== ' + url);
    console.log(' title:', audit.title);
    console.log(' images:', audit.images, '| broken:', audit.broken.length, audit.broken.slice(0, 3));
    console.log(' overflowX px:', audit.overflowX, '| wide els:', audit.wide);
    console.log(' display font:', audit.font);
    // verify every local link resolves
    for (const href of new Set(audit.localLinks)) {
      const res = await page.request.get(BASE + '/' + href.replace(/^\.\//, ''));
      if (!res.ok()) console.log('  BROKEN LINK', href, res.status());
    }
    console.log(' local links checked:', audit.localLinks.length);
  }

  await browser.close();
})();
