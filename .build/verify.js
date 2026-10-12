const { chromium } = require('playwright');

const BASE = 'http://localhost:4173';
const OUT = __dirname + '/shots/';
const fs = require('fs');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => errors.push('reqfail: ' + r.url() + ' ' + (r.failure() && r.failure().errorText)));

  // ---------- HOME ----------
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const counts = await page.evaluate(() => ({
    cats: document.querySelectorAll('#cat-grid .cat').length,
    icons: document.querySelectorAll('#icon-rail .card').length,
    fresh: document.querySelectorAll('#new-rail .card').length,
    reviews: document.querySelectorAll('#review-grid .review').length,
    hero: !!document.querySelector('.hero__media img').naturalWidth
  }));
  console.log('HOME', JSON.stringify(counts));
  await page.screenshot({ path: OUT + 'home-desktop.png', fullPage: true });

  // reveal-on-scroll sanity: scroll to bottom
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(900);
  const hidden = await page.evaluate(() => Array.from(document.querySelectorAll('.reveal')).filter(e => !e.classList.contains('is-in')).length);
  console.log('HOME unrevealed blocks after scroll:', hidden);

  // ---------- SHOP ----------
  await page.goto(BASE + '/shop.html', { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  let grid = await page.locator('#shop-grid .card').count();
  console.log('SHOP all:', grid, '| count label:', await page.locator('#result-count').textContent());

  await page.locator('.chip', { hasText: 'Haircare' }).first().click();
  await page.waitForTimeout(400);
  console.log('SHOP Haircare:', await page.locator('#shop-grid .card').count(), '| heading:', await page.locator('#active-col').textContent());

  await page.locator('.chip', { hasText: 'All Products' }).first().click();
  await page.fill('#shop-search', 'lip balm');
  await page.waitForTimeout(400);
  console.log('SHOP search "lip balm":', await page.locator('#shop-grid .card').count());

  await page.fill('#shop-search', 'zzzznotfound');
  await page.waitForTimeout(400);
  console.log('SHOP empty state visible:', await page.locator('#empty').isVisible());
  await page.fill('#shop-search', '');
  await page.selectOption('#shop-sort', 'price-asc');
  await page.waitForTimeout(400);
  const cheapest = await page.locator('#shop-grid .card .price').first().textContent();
  console.log('SHOP sorted price-asc first:', cheapest.trim());
  await page.screenshot({ path: OUT + 'shop-desktop.png', fullPage: true });

  // ---------- CART ----------
  await page.locator('#shop-grid .card__foot button[data-add]').first().click();
  await page.waitForTimeout(700);
  const drawerOpen = await page.locator('.drawer.is-open').count();
  const badge = await page.locator('[data-cart-count]').first().textContent();
  const total = await page.locator('[data-total]').textContent();
  const checkout = await page.locator('[data-checkout]').getAttribute('href');
  console.log('CART open:', drawerOpen === 1, '| badge:', badge, '| total:', total, '| checkout:', checkout);
  await page.screenshot({ path: OUT + 'cart-drawer.png' });

  // qty + / remove
  await page.locator('.drawer [data-plus]').first().click();
  await page.waitForTimeout(300);
  console.log('CART after +1 badge:', await page.locator('[data-cart-count]').first().textContent(), '| total:', await page.locator('[data-total]').textContent());
  await page.locator('.drawer [data-close]').first().click();
  await page.waitForTimeout(400);

  // ---------- PRODUCT ----------
  await page.goto(BASE + '/product.html?p=chekorganics-noni-fruit-juice-ayush-certified-ayurvedic-wellness-elixir', { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  const pdp = await page.evaluate(() => ({
    title: document.querySelector('#pdp-title').textContent,
    price: document.querySelector('#pdp-price').textContent,
    thumbs: document.querySelectorAll('#gallery-thumbs button').length,
    related: document.querySelectorAll('#related-grid .card').length,
    tags: document.querySelectorAll('#pdp-tags .tag').length,
    buy: document.querySelector('#pdp-buy').getAttribute('href')
  }));
  console.log('PDP', JSON.stringify(pdp));
  await page.locator('#gallery-thumbs button').nth(1).click();
  await page.waitForTimeout(300);
  console.log('PDP gallery switched:', (await page.locator('#gallery-main').getAttribute('src')).split('/').pop());
  await page.click('#qty-plus');
  await page.click('#pdp-add');
  await page.waitForTimeout(700);
  console.log('PDP cart badge after adding qty 2:', await page.locator('[data-cart-count]').first().textContent());
  await page.screenshot({ path: OUT + 'product-desktop.png', fullPage: true });

  // ---------- MOBILE ----------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + 'home-mobile.png', fullPage: true });
  await page.click('[data-burger]');
  await page.waitForTimeout(600);
  console.log('MOBILE menu open:', await page.locator('.mobile-nav.is-open').count() === 1);
  await page.screenshot({ path: OUT + 'mobile-menu.png' });

  await page.goto(BASE + '/shop.html', { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: OUT + 'shop-mobile.png', fullPage: true });

  console.log('ERRORS:', errors.length);
  errors.slice(0, 20).forEach(e => console.log('  ' + e));

  await browser.close();
})();
