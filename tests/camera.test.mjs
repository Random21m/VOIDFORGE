// Camera scanning end to end (v2.9.0), in a real Chromium with a stand-in camera: Chromium's fake video device plays a
// video file that shows one QR code (made by the independent `qrcode` package), and the page must read it through
// getUserMedia, a canvas and its own QR reader, fill the right box, and turn the camera off.
// Cases: an address QR (bitcoin: link) for Explain an address; a PSBT QR for Inspect a transaction; a SeedQR, only while
// the browser is offline. An engine that is not installed is reported as SKIPPED.
// Run: node tests/camera.test.mjs
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import path from 'path';
const require = createRequire(import.meta.url);
const pw = require('playwright-core');
const QR = require('qrcode');
const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + (process.env.VF_FILE || path.join(here, '..', 'voidforge.html'));
let pass = 0, fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fail++; };

// A Y4M video (the format Chromium's fake camera reads): W x H, grey background, the QR code in the middle, 6 pixels a module.
function y4m(text, file, mode) {
  const W = 640, H = 480, m = QR.create(text, mode ? { errorCorrectionLevel: 'M', mode } : { errorCorrectionLevel: 'M' }).modules, n = m.size, px = 6, x0 = (W - n * px) >> 1, y0 = (H - n * px) >> 1;
  const Y = Buffer.alloc(W * H, 200);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const mx = Math.floor((x - x0) / px), my = Math.floor((y - y0) / px); if (mx >= 0 && my >= 0 && mx < n && my < n && m.get(my, mx)) Y[y * W + x] = 20; }
  const uv = Buffer.alloc((W / 2) * (H / 2), 128), frame = Buffer.concat([Buffer.from('FRAME\n'), Y, uv, uv]);
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), ...Array(10).fill(frame)]));
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-cam-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* leave it */ } });

const ADDR = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';   // BIP84 test vector address (public)
const PSBT = 'cHNidP8BAHECAAAAAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAAAAAAD/////AZBfAQAAAAAAFgAUwM68A3ffyxAWkaDsUz8QPgI6b1QAAAAAAAEBH6CGAQAAAAAAFgAUnn6tm41JrjXrtvZoQh+sVJS/jAwAAA==';
const SEEDQR = '0'.repeat(44) + '0003';   // SeedQR of "abandon ... about" (the last word, about, is number 3)
const cases = [
  ['an address QR (bitcoin: link) fills Explain an address with the plain address', 'checkAddr', 'bitcoin:' + ADDR + '?amount=0.001', ADDR, false],
  ['a PSBT QR fills Inspect a transaction', 'psbtInput', PSBT, PSBT, false],
  ['a SeedQR fills the words box while the browser is offline', 'phrase', SEEDQR, SEEDQR, true],
];
let ran = false;
for (const [label, target, text, want, offline] of cases) {
  const vid = path.join(dir, target + '.y4m'); y4m(text, vid, target === 'phrase' ? 'numeric' : null);
  let browser;
  try { browser = await pw.chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + vid] }); }
  catch (e) { console.log('SKIPPED chromium (not installed here: ' + String(e.message).split('\n')[0].slice(0, 80) + ')'); break; }
  ran = true;
  try {
    const ctx = await browser.newContext(); await ctx.grantPermissions(['camera']); if (offline) await ctx.setOffline(true);
    const p = await ctx.newPage(); const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (d) => d.accept());
    await p.goto(FILE); await p.waitForFunction(() => /PASSED|FAILED/.test(document.getElementById('selfTestBadge').textContent), null, { timeout: 180000 });
    await p.evaluate(() => { const g = document.getElementById('sgGo'); if (g) g.click(); });
    await p.evaluate((t) => { showTab(t === 'psbtInput' ? 'tools' : 'check'); const d = document.getElementById(t).closest('details'); if (d) d.open = true; document.getElementById('cam-' + t).click(); }, target);
    await p.waitForFunction((t) => document.getElementById(t).value !== '', target, { timeout: 30000 });
    const r = await p.evaluate((t) => ({ v: document.getElementById(t).value, on: document.body.classList.contains('cam-on'), src: document.getElementById('camVideo').srcObject, msg: document.getElementById('camMsg').textContent }), target);
    ok(r.v === want && !r.on && r.src === null && /^Read\. The camera is off/.test(r.msg) && errors.length === 0, 'camera: ' + label + ' and turns the camera off' + (r.v === want ? '' : ' [got ' + r.v.slice(0, 60) + ']') + (errors.length ? ' [page errors: ' + errors.join(' | ') + ']' : ''));
  } catch (e) { ok(false, 'camera: ' + label + ' [the test stopped: ' + String(e.message).split('\n')[0] + ']'); }
  await browser.close();
}
if (!ran) { console.log('CAMERA: SKIPPED'); process.exit(0); }
console.log('CAMERA: ' + pass + ' pass, ' + fail + ' fail'); process.exit(fail ? 1 : 0);
