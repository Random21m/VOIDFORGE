// VOIDFORGE screenshot comparison (Test upgrade): the main screens, on a desktop and a phone, in both themes and with larger
// text, are compared pixel by pixel with saved pictures in tests/fixtures/screens/. A change in layout, color or text that
// nobody meant shows up as a difference. The clock is frozen, animations are off and the seed comes from fixed rolls, so the
// same file gives the same pictures.
// Fonts differ between computers, so the saved pictures belong to one setup (the maintainer's test machine, Chromium from
// Playwright); this test is run there, not in CI.
//
// Run: node tests/screens.test.mjs              compare
//      UPDATE_SCREENS=1 node tests/screens.test.mjs   save new pictures after a change that was meant (look at them first)
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const { PNG } = require('pngjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + (process.env.VF_FILE || path.join(here, '..', 'voidforge.html'));
const DIR = path.join(here, 'fixtures', 'screens'), OUT = path.join(here, '..', 'screen-diffs');
const UPDATE = !!process.env.UPDATE_SCREENS;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('PASS ' + m); } else { fails.push(m); console.log('FAIL ' + m); } };

let browser;
try { browser = await chromium.launch(); } catch (e) { console.log('SCREENS: SKIPPED (no Chromium)'); process.exit(0); }
fs.mkdirSync(DIR, { recursive: true });

// Pixel comparison: a pixel differs when any color channel differs by more than 24 (anti-aliasing noise stays under that).
function compare(name, buf) {
  const file = path.join(DIR, name + '.png');
  if (UPDATE || !fs.existsSync(file)) { fs.writeFileSync(file, buf); console.log((UPDATE ? 'SAVED ' : 'NEW ') + name); return; }
  const a = PNG.sync.read(fs.readFileSync(file)), b = PNG.sync.read(buf);
  if (a.width !== b.width || a.height !== b.height) return ok(false, name + ': the size changed (' + a.width + 'x' + a.height + ' -> ' + b.width + 'x' + b.height + ')');
  const diff = new PNG({ width: a.width, height: a.height }); let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    const hit = d > 24; if (hit) n++;
    diff.data[i] = hit ? 255 : b.data[i] >> 2; diff.data[i + 1] = hit ? 0 : b.data[i + 1] >> 2; diff.data[i + 2] = hit ? 0 : b.data[i + 2] >> 2; diff.data[i + 3] = 255;
  }
  const share = n / (a.width * a.height);
  if (share > 0.001) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, name + '.diff.png'), PNG.sync.write(diff)); fs.writeFileSync(path.join(OUT, name + '.new.png'), buf); }
  ok(share <= 0.001, name + ': matches the saved picture (' + n + ' pixels differ, ' + (share * 100).toFixed(3) + '%' + (share > 0.001 ? '; see screen-diffs/' + name + '.diff.png' : '') + ')');
}

async function page(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'dark', ...opts }); await ctx.setOffline(true);
  await ctx.addInitScript(() => { const T = Date.UTC(2026, 10, 7, 12, 0, 0); const D = Date; class F extends D { constructor(...a) { super(...(a.length ? a : [T])); } static now() { return T; } } window.Date = F; });
  const p = await ctx.newPage(); p.on('dialog', (d) => d.accept());
  await p.goto(FILE); await p.waitForFunction(() => document.body.classList.contains('js-ok'));
  await p.waitForFunction(() => /PASSED/.test(document.getElementById('selfTestBadge').textContent), null, { timeout: 120000 });
  // The page's watch check rightly notices this added style sheet (and the test browser's automation flag) and shows its warning;
  // the warning is hidden here so it does not move the layout.
  await p.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; scroll-behavior: auto !important; } #watchWarn { display: none !important; }' });
  await p.evaluate(() => { const g = document.getElementById('sgGo'); if (g) g.click(); window.print = () => {}; });
  await p.waitForTimeout(400);
  return p;
}
const shot = async (p, name) => { await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(250); compare(name, await p.screenshot()); };
const forge = (p) => p.evaluate(async () => {
  const e = document.querySelector('input[name=words][value="12"]'); if (e) { e.checked = true; e.onchange && e.onchange(); }
  document.getElementById('rolls').value = '1'.repeat(25) + '2'.repeat(25); document.getElementById('rolls').oninput && document.getElementById('rolls').oninput(); await generate();
});
const AB = 'abandon '.repeat(11) + 'about';

for (const [vp, tag] of [[{ width: 1280, height: 900 }, 'desktop'], [{ width: 390, height: 844 }, 'phone']]) {
  const p = await page(vp);
  await shot(p, tag + '-make');
  await forge(p); await shot(p, tag + '-make-seed');
  await p.evaluate(async (m) => { showTab('check'); document.getElementById('phrase').value = m; await verify(); }, AB); await p.waitForTimeout(800); await shot(p, tag + '-check');
  await p.evaluate(() => showTab('tools')); await shot(p, tag + '-tools');
  await p.evaluate(() => showTab('about')); await shot(p, tag + '-about');
  await p.evaluate(() => { showTab('make'); heirOpen(); }); await p.waitForTimeout(400); await p.evaluate(() => window.scrollTo({ top: document.getElementById('heirCard').getBoundingClientRect().top + window.scrollY, behavior: 'instant' })); await p.waitForTimeout(250); compare(tag + '-heir', await p.screenshot());
  await p.context().close();
}
{ const p = await page({ width: 1280, height: 900 }); await p.evaluate(() => toggleTheme()); await forge(p); await shot(p, 'desktop-light-make-seed'); await p.context().close(); }
{ const p = await page({ width: 1280, height: 900 }); await p.evaluate(() => toggleSize()); await shot(p, 'desktop-big-text-make'); await p.context().close(); }
await browser.close();
console.log('SCREENS: ' + pass + ' pass, ' + fails.length + ' fail' + (UPDATE ? ' (pictures saved)' : ''));
process.exit(fails.length ? 1 : 0);
