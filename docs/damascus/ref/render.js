// Renders the printable sheets to PDF (Letter and A4) and PNG, and checks that every page fits.
'use strict';
const path = require('path'), fs = require('fs');
let pw; try { pw = require('playwright-core'); } catch { pw = require('/opt/node-tools/node_modules/playwright-core'); }
const ROOT = path.join(__dirname, '..');
const PX = 96, LIMIT = { Letter: { w: 8.5, h: 11 }, A4: { w: 8.27, h: 11.69 } };

(async () => {
  const browser = await pw.chromium.launch();
  const report = [];
  for (const [file, sel, margin] of [['forge-sheet.html', '.page', 0.35], ['forge-sheet-24.html', '.page', 0.35], ['bip39-binary-table.html', '.pg', 0.3]]) {
    const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 900, height: 1200 } });
    const page = await ctx.newPage();
    await page.goto('file://' + path.join(ROOT, file));
    await page.emulateMedia({ media: 'print' });
    const boxes = await page.$$eval(sel, els => els.map(e => { const r = e.getBoundingClientRect(); return { w: r.width, h: e.scrollHeight, sw: e.scrollWidth }; }));
    for (const [fmt, L] of Object.entries(LIMIT)) {
      const maxH = (L.h - 2 * margin) * PX, maxW = (L.w - 2 * margin) * PX;
      boxes.forEach((b, i) => { const okH = b.h <= maxH, okW = b.sw <= maxW + 0.5; report.push(`${file} page ${i + 1} ${fmt}: content ${(b.sw / PX).toFixed(2)} x ${(b.h / PX).toFixed(2)} in, printable ${(maxW / PX).toFixed(2)} x ${(maxH / PX).toFixed(2)} in -> ${okH && okW ? 'fits' : 'OVERFLOW'}`); });
      const out = file.replace('.html', fmt === 'Letter' ? '.pdf' : '-a4.pdf');
      await page.pdf({ path: path.join(ROOT, out), format: fmt, printBackground: true, preferCSSPageSize: false });
      const n = (fs.readFileSync(path.join(ROOT, out), 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
      report.push(`${out}: ${n} pages (expected ${boxes.length})`);
    }
    const clipped = await page.$$eval('td[data-i]', els => els.filter(e => e.scrollWidth > e.clientWidth + 0.5).map(e => e.textContent));
    if (file.startsWith('bip39')) report.push(`${file}: ${clipped.length} clipped word cells ${clipped.slice(0, 10).join(', ')}`);
    await page.emulateMedia({ media: 'screen' });
    await page.screenshot({ path: path.join(ROOT, file.replace('.html', '.png')), fullPage: true });
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'results', 'render-results.txt'), report.join('\n') + '\n');
  console.log(report.join('\n'));
})();
