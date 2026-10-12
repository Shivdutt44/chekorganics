const { chromium } = require('playwright');
const BASE = 'http://localhost:4173';
const OUT = __dirname + '/shots2/';
const fs = require('fs');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => errors.push('reqfail: ' + r.url()));

  // ---------- HOME + live sync ----------
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  const sync = await page.evaluate(() => ({
    pill: document.querySelector('#sync-pill').textContent.trim(),
    cls: document.querySelector('#sync-pill').className,
    cats: document.querySelectorAll('#cat-grid .cat').length,
    icons: document.querySelectorAll('#icon-rail .card').length,
    guarantee: document.querySelectorAll('.guarantee__item').length,
    favicon: document.querySelector('link[rel="icon"]').getAttribute('href'),
    apple: (document.querySelector('link[rel="apple-touch-icon"]') || {}).href
  }));
  console.log('HOME', JSON.stringify(sync, null, 1));
  await page.screenshot({ path: OUT + 'home-desktop.png', fullPage: true });

  // ---------- SHOP: live counts + chips ----------
  await page.goto(BASE + '/shop.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const shop = await page.evaluate(() => ({
    cards: document.querySelectorAll('#shop-grid .card').length,
    label: document.querySelector('#result-count').textContent,
    chips: Array.from(document.querySelectorAll('.chip')).map(c => c.textContent.replace(/\s+/g, ' ').trim()).slice(0, 4),
    pill: document.querySelector('#sync-pill').textContent.trim()
  }));
  console.log('SHOP', JSON.stringify(shop));
  await page.screenshot({ path: OUT + 'shop-desktop.png', fullPage: true });

  // ---------- CART: free shipping nudge ----------
  await page.locator('#shop-grid .card__foot button[data-add]').nth(2).click();
  await page.waitForTimeout(800);
  const cart = await page.evaluate(() => ({
    shipText: document.querySelector('[data-ship-text]').textContent.trim(),
    shipCost: document.querySelector('[data-ship-cost]').textContent.trim(),
    total: document.querySelector('[data-total]').textContent,
    cta: document.querySelector('[data-checkout]').textContent.trim(),
    href: document.querySelector('[data-checkout]').getAttribute('href'),
    trust: document.querySelectorAll('.drawer__trust span').length
  }));
  console.log('CART', JSON.stringify(cart));
  await page.screenshot({ path: OUT + 'cart-drawer.png' });

  // ---------- PDP: sticky bar, stock, recently viewed ----------
  await page.goto(BASE + '/product.html?p=chekorganics-bodyhues-noni-herbal-hair-oil-200ml', { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const pdp = await page.evaluate(() => ({
    title: document.querySelector('#pdp-title').textContent,
    stock: document.querySelector('#pdp-rating .stock').textContent.trim(),
    stickyExists: !!document.querySelector('#sticky-buy'),
    stickyOn: document.querySelector('#sticky-buy').classList.contains('is-on'),
    recentHidden: document.querySelector('#recent-wrap').hidden,
    guarantee: document.querySelectorAll('.guarantee__item').length
  }));
  console.log('PDP top', JSON.stringify(pdp));

  await page.evaluate(() => window.scrollTo(0, 1400));
  await page.waitForTimeout(700);
  console.log('PDP sticky after scroll:', await page.evaluate(() => document.querySelector('#sticky-buy').classList.contains('is-on')));

  // add from sticky bar
  await page.click('[data-sticky-add]');
  await page.waitForTimeout(700);
  console.log('sticky add → drawer open:', await page.locator('.drawer.is-open').count() === 1);

  // visit a second product to trigger recently-viewed
  await page.goto(BASE + '/product.html?p=chekorganics-mulika-manjan-ayurvedic-herbal-tooth-paste-18-herbs-fluoride-free', { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  const recent = await page.evaluate(() => ({
    hidden: document.querySelector('#recent-wrap').hidden,
    cards: document.querySelectorAll('#recent-grid .card').length
  }));
  console.log('RECENT', JSON.stringify(recent));
  await page.evaluate(() => document.querySelector('#recent-wrap').scrollIntoView());
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + 'product-recent.png' });

  // ---------- mobile ----------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + '/product.html?p=chekorganics-bodyhues-noni-turmeric-soap-100gm', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForTimeout(700);
  await page.screenshot({ path: OUT + 'product-mobile-sticky.png' });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: OUT + 'home-mobile.png', fullPage: true });

  console.log('ERRORS:', errors.length);
  errors.slice(0, 15).forEach(e => console.log('  ' + e));
  await browser.close();
})();
