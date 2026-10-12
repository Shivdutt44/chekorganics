const { chromium } = require('playwright');
const BASE = 'http://localhost:4173';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('console', m => console.log('[console:' + m.type() + ']', m.text()));
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  page.on('requestfailed', r => console.log('[reqfail]', r.url(), r.failure() && r.failure().errorText));
  page.on('response', r => { if (r.url().includes('/api/')) console.log('[api]', r.status(), r.url()); });

  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  const probe = await page.evaluate(async () => {
    const out = {};
    try {
      const r = await fetch('/api/products.json', { cache: 'no-store' });
      out.status = r.status;
      out.ok = r.ok;
      const j = await r.json();
      out.count = j.products.length;
    } catch (e) { out.fetchError = e.message; }
    out.pill = document.querySelector('#sync-pill').textContent.trim();
    out.sync = window.CHEK_SYNC || null;
    return out;
  });
  console.log('PROBE', JSON.stringify(probe));
  await browser.close();
})();
