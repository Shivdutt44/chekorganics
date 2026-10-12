const { chromium } = require('playwright');
const BASE = 'http://localhost:4173';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const fails = [];
  page.on('requestfailed', r => fails.push(r.url() + ' :: ' + (r.failure() && r.failure().errorText)));
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  const out = await page.evaluate(() => {
    const hero = document.querySelector('.hero__media img');
    const mobileSrc = document.querySelector('.hero__media source').getAttribute('srcset');
    return {
      heroLoaded: hero.complete && hero.naturalWidth > 0,
      heroW: hero.naturalWidth,
      mobileSrc,
      pillClass: document.querySelector('#sync-pill').className,
      pillText: document.querySelector('#sync-pill').textContent.trim()
    };
  });
  console.log('HERO', JSON.stringify(out));
  console.log('failed requests while idle:', fails);
  await browser.close();
})();
