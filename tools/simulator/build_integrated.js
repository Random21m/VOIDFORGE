// Builds the integrated voidforge.html: the v2.12.0 release page + the practice signer.
// Usage: node build_integrated.js [out]   (default: the v213 worktree's voidforge.html)
const fs = require("fs"), path = require("path"), cp = require("child_process");
const W = __dirname;
const WT = fs.existsSync(path.join(W, "..", "..", "voidforge.html")) ? path.join(W, "..", "..") : path.join(W, "..", "vf-bundle", "v213");
const out = process.argv[2] || path.join(WT, "voidforge.html");
let html = cp.execSync("git show v2.12.0:voidforge.html", { cwd: WT, maxBuffer: 64 << 20 }).toString("utf8");
const before = Buffer.byteLength(html);
const rd = (f) => fs.readFileSync(path.join(W, f), "utf8");
const must = (cond, msg) => { if (!cond) throw new Error("build: " + msg); };
const rep = (a, b) => { must(html.split(a).length === 2, "not exactly once: " + a.slice(0, 80)); html = html.replace(a, () => b); };

// ---- 1. CSS (in the page's one style sheet) ----
const css = `
  /* Practice signer (SeedSigner 0.8.7 on the SeedSigner+ 320 x 240 screen). Drawn in design units (--u, 1px at full size):
     the pill case is 750 x 300 units and shrinks with the box on narrow screens, keys included. */
  #ssBox .ss-wrap { margin: 10px 0 0; }
  @supports (width: 1cqw) { #ssBox .ss-wrap { container-type: inline-size; } #ssBox .ss-wrap .ss-dev { --u: min(1px, calc(100cqw / 750)); } }
  #ssBox .ss-dev { --u: min(1px, calc((100vw - 72px) / 750)); position: relative; width: calc(750 * var(--u)); height: calc(300 * var(--u)); margin: 0 auto; box-sizing: border-box; background: #2C3136; border: calc(3 * var(--u)) solid #3A3F45; border-radius: calc(150 * var(--u)); outline: none; touch-action: manipulation; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
  #ssBox .ss-dev:focus-visible { box-shadow: 0 0 0 3px var(--accent); }
  #ssBox .ss-bezel { position: absolute; left: calc(199.5 * var(--u)); top: calc(15 * var(--u)); width: calc(344 * var(--u)); height: calc(264 * var(--u)); background: #000; border-radius: calc(10 * var(--u)); box-sizing: border-box; padding: calc(12 * var(--u)); }
  #ssBox .ss-bezel canvas { display: block; width: 100%; height: 100%; background: #000; image-rendering: auto; }
  #ssBox .ss-k { position: absolute; width: calc(54 * var(--u)); height: calc(54 * var(--u)); padding: 0; margin: 0; min-width: 0; min-height: 0; border: 0; border-radius: calc(7 * var(--u)); background: #E3B83F; box-shadow: inset 0 calc(-6 * var(--u)) 0 #9C7A22; cursor: pointer; touch-action: manipulation; }
  #ssBox .ss-k:hover { background: #E8C257; }
  #ssBox .ss-k.ss-down { background: #D6A92F; box-shadow: inset 0 calc(-2 * var(--u)) 0 #9C7A22; transform: translateY(calc(2 * var(--u))); }
  #ssBox #ssKUp { left: calc(83 * var(--u)); top: calc(30 * var(--u)); }
  #ssBox #ssKLeft { left: calc(23 * var(--u)); top: calc(90 * var(--u)); }
  #ssBox #ssKPress { left: calc(83 * var(--u)); top: calc(90 * var(--u)); }
  #ssBox #ssKRight { left: calc(143 * var(--u)); top: calc(90 * var(--u)); }
  #ssBox #ssKDown { left: calc(83 * var(--u)); top: calc(150 * var(--u)); }
  #ssBox #ssK1 { left: calc(613 * var(--u)); top: calc(39 * var(--u)); }
  #ssBox #ssK2 { left: calc(613 * var(--u)); top: calc(120 * var(--u)); }
  #ssBox #ssK3 { left: calc(613 * var(--u)); top: calc(201 * var(--u)); }
  #ssBox .ss-usb { position: absolute; left: calc(176 * var(--u)); bottom: calc(-3 * var(--u)); width: calc(34 * var(--u)); height: calc(9 * var(--u)); background: #15181B; border: calc(2 * var(--u)) solid #3A3F45; border-bottom: 0; border-radius: calc(5 * var(--u)) calc(5 * var(--u)) 0 0; box-sizing: border-box; }
  #ssBox .ss-warn { color: var(--warn-text); font-weight: 700; font-size: 13px; text-align: center; margin: 10px 0 0; }
`;
rep("\n</style>", css + "</style>");

// ---- 2. the box, right after <details id="practiceBox"> ... </details> in CHECK A BACKUP ----
const box = `
    <details id="ssBox">
      <summary>Practice signer: works like SeedSigner<span class="tag tag-ro">NEW</span></summary>
      <p class="hint" style="margin:8px 0;">A practice copy of SeedSigner 0.8.7 on the SeedSigner+ screen (320 x 240): the same screens, menus and buttons. Seeds made here are for practice only.</p>
      <div class="ss-wrap">
        <div class="ss-dev" id="ssDevice" tabindex="0" role="application" aria-label="Practice signer. While it has focus: arrow keys move, Enter or Space presses the joystick, 1, 2 and 3 are KEY1, KEY2 and KEY3.">
          <button type="button" class="ss-k" id="ssKUp" tabindex="-1" aria-label="Joystick up"></button>
          <button type="button" class="ss-k" id="ssKLeft" tabindex="-1" aria-label="Joystick left"></button>
          <button type="button" class="ss-k" id="ssKPress" tabindex="-1" aria-label="Joystick press"></button>
          <button type="button" class="ss-k" id="ssKRight" tabindex="-1" aria-label="Joystick right"></button>
          <button type="button" class="ss-k" id="ssKDown" tabindex="-1" aria-label="Joystick down"></button>
          <div class="ss-bezel"><canvas id="ssScreen" width="320" height="240" aria-label="Practice signer screen"></canvas></div>
          <button type="button" class="ss-k" id="ssK1" tabindex="-1" aria-label="KEY1"></button>
          <button type="button" class="ss-k" id="ssK2" tabindex="-1" aria-label="KEY2"></button>
          <button type="button" class="ss-k" id="ssK3" tabindex="-1" aria-label="KEY3"></button>
          <span class="ss-usb" aria-hidden="true"></span>
        </div>
      </div>
      <p class="ss-warn">PRACTICE ONLY: never put real coins on a seed made here.</p>
    </details>`;
{
  const a = html.indexOf('<details id="practiceBox">'); must(a > 0, "practiceBox");
  const z = html.indexOf("</details>", a); must(z > a, "practiceBox end");
  must(html.slice(a + 10, z).indexOf("<details") < 0, "practiceBox has a nested details");
  html = html.slice(0, z + 10) + box + html.slice(z + 10);
}

// ---- 3. hooks in the page's wipes ----
rep(`  msReset(); dbClear(); wipeSeed(); planClear(); camStop();
}`, `  msReset(); dbClear(); wipeSeed(); planClear(); camStop();
  if(typeof ssPageWipe === "function") ssPageWipe();   // v2.13.0: the practice signer (stops it, wipes its seeds, closes its box)
}`);
rep(`for(const f of [reforgeStop, msReset, () => practiceMode(false), wipeSeed,`, `for(const f of [reforgeStop, msReset, () => practiceMode(false), () => ssPageWipe(), wipeSeed,`);
rep(`function autoHasSecrets(){ return hasSeed() || !!dbGot ||`, `function autoHasSecrets(){ return hasSeed() || !!dbGot || (typeof ssPageActive === "function" && ssPageActive()) ||`);
rep(`  reforgeStop(); msReset(); dbClear(); wipeSeed(); planClear(); clearChild(); hideExplain(); hideQr(); hideSeedQr();
  for(const id of AUTO_FIELDS)`, `  reforgeStop(); msReset(); dbClear(); wipeSeed(); planClear(); clearChild(); hideExplain(); hideQr(); hideSeedQr();
  if(typeof ssPageWipe === "function") ssPageWipe();   // v2.13.0: the practice signer
  for(const id of AUTO_FIELDS)`);

// ---- 4. the scripts, after the main script: fonts, tools PART A, engine, seeds, tools PART B + PSBT (stage 2), page glue ----
const tools = rd("ss_tools_settings.js");
const mark = tools.indexOf("/* ====", tools.indexOf("PART B: views and screens") - 200);
must(mark > 0 && tools.slice(mark, mark + 400).includes("PART B: views and screens"), "PART B marker");
const parts = [
  ["ss_fonts.js", rd("ss_fonts.js")],
  ["ss_tools_settings.js PART A", tools.slice(0, mark)],
  ["ss_engine.js", rd("ss_engine.js")],
  ["ss_seeds.js", rd("ss_seeds.js")],
  ["ss_tools_settings.js PART B and ss_psbt.js", tools.slice(mark) + "\n" + rd("ss_psbt.js").replace(/^"use strict";$/m, "")],
  ["ss_page.js", rd("ss_page.js")],
];
let blocks = "";
for (const [name, code] of parts) {
  must(!/<\/script/i.test(code), name + " contains </script");
  must(!/<!--/.test(code), name + " contains <!--");
  must(!/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|@import/.test(code), name + " uses a network API");
  must(!/https?:\/\//.test(code), name + " has a URL");
  must(!/data-[a-z0-9]/.test(code), name + " names a data- attribute");
  blocks += `<script>\n"use strict";\n// v2.13.0 practice signer: ${name} (the page knows this script as its own: see "Is anything watching this page?")\nif(window.vfOwnEls) window.vfOwnEls.push(document.currentScript);\n${code.replace(/^"use strict";$/m, "")}\n</script>\n`;
}
{
  const z = html.lastIndexOf("</body>"); must(z > 0, "body end");
  const s = html.lastIndexOf("</script>", z); must(s > 0 && html.slice(s + 9, z).trim() === "", "main script is last before </body>");
  html = html.slice(0, s + 10) + blocks + html.slice(s + 10);
}
fs.writeFileSync(out, html);
console.log("page bytes before", before, "after", Buffer.byteLength(html), "->", out);
