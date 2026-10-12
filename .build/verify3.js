const { chromium } = require('playwright');
const BASE = 'http://localhost:4173';
const OUT = __dirname + '/shots3/';
const fs = require('fs');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const hero = await page.evaluate(() => {
    const slides = Array.from(document.querySelectorAll('.hero__slide'));
    const active = document.querySelector('.hero__slide.is-active');
    const img = active.querySelector('img');
    const panel = document.querySelector('.hero__panel.is-active');
    const box = document.querySelector('.hero').getBoundingClientRect();
    return {
      slides: slides.length,
      activeSrc: img.getAttribute('src'),
      imgLoaded: img.complete && img.naturalWidth > 0,
      imgNatural: img.naturalWidth + 'x' + img.naturalHeight,
      panelH1: panel.querySelector('h1').textContent.trim().slice(0, 60),
      panelCta: panel.querySelector('.btn--gold').textContent.trim(),
      heroHeight: Math.round(box.height),
      dots: document.querySelectorAll('[data-hero-dot]').length,
      activeDot: Array.from(document.querySelectorAll('[data-hero-dot]')).findIndex(d => d.classList.contains('is-active'))
    };
  });
  console.log('HERO', JSON.stringify(hero));
  await page.screenshot({ path: OUT + 'hero-desktop-slide1.png', clip: { x: 0, y: 0, width: 1440, height: 950 } });

  // arrow navigation
  await page.click('[data-hero-next]');
  await page.waitForTimeout(1400);
  const afterArrow = await page.evaluate(() => {
    const p = document.querySelector('.hero__panel.is-active');
    return {
      h1: p.querySelector('h1').textContent.trim().slice(0, 50),
      cta: p.querySelector('.btn--gold').textContent.trim(),
      src: document.querySelector('.hero__slide.is-active img').getAttribute('src'),
      loaded: document.querySelector('.hero__slide.is-active img').naturalWidth > 0
    };
  });
  console.log('AFTER NEXT', JSON.stringify(afterArrow));
  await page.screenshot({ path: OUT + 'hero-desktop-slide2.png', clip: { x: 0, y: 0, width: 1440, height: 950 } });

  // dot navigation back
  await page.click('[data-hero-dot="0"]');
  await page.waitForTimeout(900);
  console.log('DOT back to slide 1:', await page.evaluate(() => document.querySelector('.hero__panel.is-active h1').textContent.trim().slice(0, 40)));

  // autoplay (scroll so the hero leaves the pointer's area, then park outside it)
  await page.evaluate(() => window.scrollTo(0, 560));
  await page.mouse.move(700, 900);
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => Array.from(document.querySelectorAll('.hero__slide')).findIndex(s => s.classList.contains('is-active')));
  await page.waitForTimeout(7500);
  const after = await page.evaluate(() => Array.from(document.querySelectorAll('.hero__slide')).findIndex(s => s.classList.contains('is-active')));
  console.log('AUTOPLAY advanced:', before, '→', after, before !== after);

  // hover pauses
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.hover('#hero');
  await page.waitForTimeout(400);
  const h1 = await page.evaluate(() => Array.from(document.querySelectorAll('.hero__slide')).findIndex(s => s.classList.contains('is-active')));
  await page.waitForTimeout(7500);
  const h2 = await page.evaluate(() => Array.from(document.querySelectorAll('.hero__slide')).findIndex(s => s.classList.contains('is-active')));
  console.log('HOVER pause:', h1, '→', h2, h1 === h2);
  await page.mouse.move(0, 0);

  // full page screenshot desktop
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: OUT + 'home-desktop.png', fullPage: true });

  // mobile art swap
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const mob = await page.evaluate(() => {
    const active = document.querySelector('.hero__slide.is-active');
    const srcset = active.querySelector('source').getAttribute('srcset');
    const img = active.querySelector('img');
    return { srcset, currentSrc: img.currentSrc.split('/').pop(), heroH: Math.round(document.querySelector('.hero').getBoundingClientRect().height) };
  });
  console.log('MOBILE', JSON.stringify(mob));
  await page.screenshot({ path: OUT + 'hero-mobile-slide1.png' });
  await page.click('[data-hero-next]');
  await page.waitForTimeout(1400);
  await page.screenshot({ path: OUT + 'hero-mobile-slide2.png' });
  console.log('MOBILE slide2 loaded:', await page.evaluate(() => document.querySelector('.hero__slide.is-active img').naturalWidth > 0));

  console.log('ERRORS:', errors.length);
  errors.slice(0, 10).forEach(e => console.log('  ' + e));
  await browser.close();
})();
