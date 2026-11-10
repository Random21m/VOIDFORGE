// Builds the integrated voidforge.html: the v2.12.0 release page + the practice signer.
// Usage: node build_integrated.js [out]   (default: the v213 worktree's voidforge.html)
const fs = require("fs"), path = require("path"), cp = require("child_process");
const W = __dirname;
const WT = fs.existsSync(path.join(W, "..", "..", "voidforge.html")) ? path.join(W, "..", "..") : path.join(W, "..", "vf-bundle", "v213");
const out = process.argv.slice(2).find((a) => !a.startsWith("--")) || path.join(WT, "voidforge.html");
// The base is the repo's voidforge.html with the practice signer of the last build taken out again (unbuild below),
// so edits made to the rest of the page since (version, dictionary, ...) are kept. "--check" only proves the unbuild:
// the page without the practice signer must equal the v2.12.0 page plus any later edits, so it is printed for comparison.
const rd = (f) => fs.readFileSync(path.join(W, f), "utf8");
const must = (cond, msg) => { if (!cond) throw new Error("build: " + msg); };
const HOOKS = [
  [`  msReset(); dbClear(); wipeSeed(); planClear(); camStop();
}`, `  msReset(); dbClear(); wipeSeed(); planClear(); camStop();
  if(typeof ssPageWipe === "function") ssPageWipe();   // v2.13.0: the practice signer (stops it, wipes its seeds, closes its box)
}`],
  [`for(const f of [reforgeStop, msReset, () => practiceMode(false), wipeSeed,`, `for(const f of [reforgeStop, msReset, () => practiceMode(false), () => ssPageWipe(), wipeSeed,`],
  [`function autoHasSecrets(){ return hasSeed() || !!dbGot ||`, `function autoHasSecrets(){ return hasSeed() || !!dbGot || (typeof ssPageActive === "function" && ssPageActive()) ||`],
  [`  reforgeStop(); msReset(); dbClear(); wipeSeed(); planClear(); clearChild(); hideExplain(); hideQr(); hideSeedQr();
  for(const id of AUTO_FIELDS)`, `  reforgeStop(); msReset(); dbClear(); wipeSeed(); planClear(); clearChild(); hideExplain(); hideQr(); hideSeedQr();
  if(typeof ssPageWipe === "function") ssPageWipe();   // v2.13.0: the practice signer
  for(const id of AUTO_FIELDS)`],
];
const once = (h, a) => h.split(a).length === 2;
function unbuild(h) {
  if (h.indexOf('<details id="ssBox">') < 0) return h;                       // no practice signer in it
  const cssA = h.indexOf("\n  /* Practice signer (SeedSigner 0.8.7"); must(cssA > 0, "unbuild: css start");
  const cssZ = h.indexOf("</style>", cssA); must(cssZ > cssA, "unbuild: css end");
  h = h.slice(0, cssA) + "\n" + h.slice(cssZ);
  const boxA = h.indexOf('\n    <details id="ssBox">'); must(boxA > 0, "unbuild: box start");
  const boxZ = h.indexOf("</details>", boxA); must(boxZ > boxA, "unbuild: box end");
  h = h.slice(0, boxA) + h.slice(boxZ + 10);
  for (const [a, b] of HOOKS) { must(once(h, b), "unbuild: hook not exactly once: " + a.slice(0, 60)); h = h.replace(b, () => a); }
  const tag = '<script>\n"use strict";\n// v2.13.0 practice signer: ';
  const sA = h.indexOf(tag); must(sA > 0, "unbuild: scripts start");
  const last = h.lastIndexOf(tag); const sZ = h.indexOf("</script>\n", last); must(sZ > last, "unbuild: scripts end");
  h = h.slice(0, sA) + h.slice(sZ + 10);
  must(h.indexOf("ssPage") < 0 && h.indexOf("ssBox") < 0, "unbuild: practice signer left in the page");
  return h;
}
let html = unbuild(fs.readFileSync(path.join(WT, "voidforge.html"), "utf8"));
if (process.argv.includes("--check")) { process.stdout.write(html); process.exit(0); }
const before = Buffer.byteLength(html);
const rep = (a, b) => { must(once(html, a), "not exactly once: " + a.slice(0, 80)); html = html.replace(a, () => b); };

// ---- 1. CSS (in the page's one style sheet) ----
const css = `
  /* Practice signer (SeedSigner 0.8.7 on the SeedSigner+ 320 x 240 screen). Drawn in design units (--u, 1px at full size):
     the pill case is 750 x 300 units and shrinks with the box on narrow screens, keys included.
     Look: a molded case (rim, top face, light from above) drawn by one small inline SVG (data: URI, allowed by img-src data:);
     each key is an invisible 54 x 54 hit area whose ::before draws the gold cap (pills, round center); the screen frame is CSS. */
  #ssBox .ss-wrap { margin: 10px 0 0; }
  @supports (width: 1cqw) { #ssBox .ss-wrap { container-type: inline-size; } #ssBox .ss-wrap .ss-dev { --u: min(1px, calc(100cqw / 750)); } }
  #ssBox .ss-dev { --u: min(1px, calc((100vw - 72px) / 750)); --ss-sh: 0 calc(2 * var(--u)) calc(3 * var(--u)) rgba(0,0,0,.45), 0 calc(12 * var(--u)) calc(18 * var(--u)) calc(-4 * var(--u)) rgba(0,0,0,.5), 0 calc(26 * var(--u)) calc(44 * var(--u)) calc(-10 * var(--u)) rgba(0,0,0,.4); position: relative; width: calc(750 * var(--u)); height: calc(300 * var(--u)); margin: 0 auto; box-sizing: border-box; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 750 300' preserveAspectRatio='none'%3E%3Cdefs%3E%3ClinearGradient id='rim' x1='0' y1='0' x2='0' y2='1'%3E%3Cstop offset='0' stop-color='%23A9AEB3'/%3E%3Cstop offset='.03' stop-color='%236E747A'/%3E%3Cstop offset='.09' stop-color='%2341474D'/%3E%3Cstop offset='.6' stop-color='%233A3F45'/%3E%3Cstop offset='1' stop-color='%2325292D'/%3E%3C/linearGradient%3E%3ClinearGradient id='face' x1='0' y1='0' x2='0' y2='1'%3E%3Cstop offset='0' stop-color='%23363C42'/%3E%3Cstop offset='.5' stop-color='%232E3338'/%3E%3Cstop offset='1' stop-color='%23282C31'/%3E%3C/linearGradient%3E%3ClinearGradient id='sides' x1='0' y1='0' x2='1' y2='0'%3E%3Cstop offset='0' stop-color='%23000' stop-opacity='.16'/%3E%3Cstop offset='.12' stop-color='%23000' stop-opacity='0'/%3E%3Cstop offset='.5' stop-color='%23000' stop-opacity='.04'/%3E%3Cstop offset='.78' stop-color='%23000' stop-opacity='.22'/%3E%3Cstop offset='1' stop-color='%23000' stop-opacity='.38'/%3E%3C/linearGradient%3E%3CradialGradient id='sheen' cx='.3' cy='-.15' r='.6'%3E%3Cstop offset='0' stop-color='%23fff' stop-opacity='.06'/%3E%3Cstop offset='1' stop-color='%23fff' stop-opacity='0'/%3E%3C/radialGradient%3E%3ClinearGradient id='edge' x1='0' y1='0' x2='0' y2='1'%3E%3Cstop offset='0' stop-color='%23fff' stop-opacity='.22'/%3E%3Cstop offset='.12' stop-color='%23fff' stop-opacity='0'/%3E%3Cstop offset='.8' stop-color='%23000' stop-opacity='0'/%3E%3Cstop offset='1' stop-color='%23000' stop-opacity='.35'/%3E%3C/linearGradient%3E%3Cfilter id='b' x='-5%' y='-5%' width='110%' height='110%'%3E%3CfeGaussianBlur stdDeviation='1.5'/%3E%3C/filter%3E%3CclipPath id='tf'%3E%3Crect x='7' y='5' width='736' height='285' rx='142.5'/%3E%3C/clipPath%3E%3C/defs%3E%3Crect width='750' height='300' rx='150' fill='url(%23rim)'/%3E%3Crect width='750' height='300' rx='150' fill='url(%23sides)'/%3E%3Cg clip-path='url(%23tf)'%3E%3Crect width='750' height='300' fill='url(%23face)'/%3E%3Crect width='750' height='300' fill='url(%23sides)'/%3E%3Crect width='750' height='300' fill='url(%23sheen)'/%3E%3Crect x='7' y='5' width='736' height='285' rx='142.5' fill='none' stroke='url(%23edge)' stroke-width='5' filter='url(%23b)'/%3E%3Crect x='243' y='13.5' width='360' height='273' rx='12' fill='%23000' fill-opacity='.35' filter='url(%23b)'/%3E%3C/g%3E%3Crect x='7' y='5' width='736' height='285' rx='142.5' fill='none' stroke='%23000' stroke-opacity='.28' stroke-width='.8'/%3E%3Crect x='244' y='14.5' width='358' height='271' rx='10' fill='none' stroke='%23fff' stroke-opacity='.10' stroke-width='1'/%3E%3C/svg%3E") 0 0 / 100% 100% no-repeat border-box, #2C3136; border: calc(3 * var(--u)) solid transparent; border-radius: calc(150 * var(--u)); box-shadow: var(--ss-sh); outline: none; touch-action: manipulation; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
  #ssBox .ss-dev:focus-visible { box-shadow: var(--ss-sh), 0 0 0 3px var(--accent); }
  #ssBox .ss-bezel { position: absolute; left: calc(242 * var(--u)); top: calc(12 * var(--u)); width: calc(356 * var(--u)); height: calc(269 * var(--u)); box-sizing: border-box; padding: calc(14 * var(--u)) calc(22 * var(--u)) calc(15 * var(--u)) calc(14 * var(--u)); border-radius: calc(9 * var(--u)); background: linear-gradient(90deg, #5E5F5A, #686963 40%, #5A5B56) calc(334 * var(--u)) calc(11 * var(--u)) / calc(11 * var(--u)) calc(253 * var(--u)) no-repeat, linear-gradient(180deg, #6A6B65, #5A5B56) calc(10 * var(--u)) calc(254 * var(--u)) / calc(335 * var(--u)) calc(10 * var(--u)) no-repeat, #030405; box-shadow: inset 0 calc(11 * var(--u)) 0 #141619, inset calc(10 * var(--u)) 0 0 #181A1E, inset calc(-11 * var(--u)) 0 0 #3B3F46, inset 0 calc(-5 * var(--u)) 0 #42464D, 0 0 0 calc(1 * var(--u)) #0A0B0D; }
  #ssBox .ss-bezel::after { content: ""; position: absolute; top: calc(11 * var(--u)); right: calc(11 * var(--u)); bottom: calc(5 * var(--u)); left: calc(10 * var(--u)); pointer-events: none; background: linear-gradient(118deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.025) 36%, rgba(255,255,255,0) 36.3%); box-shadow: inset calc(2 * var(--u)) calc(3 * var(--u)) calc(5 * var(--u)) rgba(0,0,0,.7); }
  #ssBox .ss-bezel canvas { display: block; width: 100%; height: 100%; background: #000; image-rendering: auto; }
  #ssBox .ss-k { position: absolute; width: calc(54 * var(--u)); height: calc(54 * var(--u)); padding: 0; margin: 0; min-width: 0; min-height: 0; border: 0; border-radius: calc(12 * var(--u)); background: transparent; cursor: pointer; touch-action: manipulation; transition: transform 50ms; }
  #ssBox .ss-k::before { content: ""; position: absolute; left: 50%; top: 50%; width: calc(58 * var(--u)); height: calc(34 * var(--u)); transform: translate(-50%, -50%); border-radius: calc(29 * var(--u)); pointer-events: none; background: radial-gradient(70% 60% at 38% 22%, rgba(255,250,225,.42), rgba(255,250,225,0) 70%), linear-gradient(180deg, #F1CE63 0%, #E8BF48 40%, #E3B83F 55%, #CFA22E 80%, #B98C22 100%); box-shadow: inset 0 calc(1.2 * var(--u)) calc(0.8 * var(--u)) rgba(255,246,210,.8), inset 0 calc(-2.5 * var(--u)) calc(3 * var(--u)) rgba(110,76,6,.38), 0 0 0 calc(1 * var(--u)) rgba(26,20,4,.55), calc(1 * var(--u)) calc(2.5 * var(--u)) calc(3 * var(--u)) rgba(0,0,0,.45); transition: box-shadow 50ms, filter 50ms; }
  #ssBox #ssKLeft::before, #ssBox #ssKRight::before { width: calc(38 * var(--u)); height: calc(52 * var(--u)); border-radius: calc(19 * var(--u)); }
  #ssBox #ssKPress::before { width: calc(58 * var(--u)); height: calc(58 * var(--u)); border-radius: 50%; }
  #ssBox #ssK1::before, #ssBox #ssK2::before, #ssBox #ssK3::before { width: calc(56 * var(--u)); height: calc(33 * var(--u)); border-radius: calc(16.5 * var(--u)); }
  #ssBox .ss-k:hover::before { filter: brightness(1.03); }
  #ssBox .ss-k.ss-down, #ssBox .ss-k:active { transform: translateY(calc(1.6 * var(--u))); }
  #ssBox .ss-k.ss-down::before, #ssBox .ss-k:active::before { filter: brightness(.93); box-shadow: inset 0 calc(1 * var(--u)) calc(0.8 * var(--u)) rgba(255,246,210,.55), inset 0 calc(-1.5 * var(--u)) calc(2 * var(--u)) rgba(110,76,6,.38), 0 0 0 calc(1 * var(--u)) rgba(26,20,4,.6), calc(0.4 * var(--u)) calc(0.8 * var(--u)) calc(1 * var(--u)) rgba(0,0,0,.5); }
  #ssBox #ssKUp { left: calc(105 * var(--u)); top: calc(59 * var(--u)); }
  #ssBox #ssKLeft { left: calc(44 * var(--u)); top: calc(119 * var(--u)); }
  #ssBox #ssKPress { left: calc(105 * var(--u)); top: calc(119 * var(--u)); }
  #ssBox #ssKRight { left: calc(166 * var(--u)); top: calc(119 * var(--u)); }
  #ssBox #ssKDown { left: calc(105 * var(--u)); top: calc(179 * var(--u)); }
  #ssBox #ssK1 { left: calc(630 * var(--u)); top: calc(63 * var(--u)); }
  #ssBox #ssK2 { left: calc(630 * var(--u)); top: calc(119 * var(--u)); }
  #ssBox #ssK3 { left: calc(630 * var(--u)); top: calc(175 * var(--u)); }
  #ssBox .ss-warn { color: var(--warn-text); font-weight: 700; font-size: 13px; text-align: center; margin: 10px 0 0; }
  /* v2.14.0 Learn on the practice signer: lessons and a practice transaction, as page text below the device (never on its screen) */
  #ssBox [hidden] { display: none !important; }
  #ssBox .ss-learn { margin: 14px auto 0; max-width: 750px; }
  #ssBox .ss-learn .btn-row { align-items: center; }
  #ssBox .ss-learn select { width: auto; flex: 1 1 14em; min-width: 0; padding: 6px 8px; font-size: 13px; }
  #ssBox .ss-l-run { border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; margin: 0 0 10px; }
  #ssBox .ss-l-run p { margin: 6px 0; overflow-wrap: anywhere; }
  #ssBox .ss-l-do { font-size: 15px; line-height: 1.5; }
  #ssBox .ss-l-cam { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; font-size: 13px; margin: 0 0 10px; overflow-wrap: anywhere; }
  #ssBox #ssTxStatus { white-space: pre-line; overflow-wrap: anywhere; }
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
        </div>
      </div>
      <p class="ss-warn">PRACTICE ONLY: never put real coins on a seed made here.<br>It is a real signer: never type in or scan a real seed.</p>
      <div class="ss-learn" id="ssLearn">
        <h3 class="sec">Lessons</h3>
        <p class="hint" style="margin:0 0 8px;">Short lessons that walk you through the device, one press at a time. Each step moves on by itself when the device shows the right screen. The lessons use public test seeds only (such as abandon ... about): anyone can make them, so never put coins on them.</p>
        <div class="btn-row"><select id="ssLearnPick" aria-label="Lesson"></select><button type="button" id="ssLearnGo">START LESSON</button></div>
        <div class="ss-l-run" id="ssLearnRun" hidden>
          <p><b id="ssLearnName"></b> &middot; <span id="ssLearnCount"></span></p>
          <p class="hint" id="ssLearnNote"></p>
          <p class="ss-l-do" id="ssLearnDo"></p>
          <p class="hint" id="ssLearnSee"></p>
          <p class="status ok" id="ssLearnState" aria-live="polite"></p>
          <div class="btn-row" style="margin:6px 0 0;"><button type="button" class="secondary small" id="ssLearnBack">BACK</button><button type="button" class="secondary small" id="ssLearnNext">NEXT</button><button type="button" class="secondary small" id="ssLearnRestart">RESTART LESSON</button></div>
        </div>
        <div class="ss-l-cam" id="ssLearnCam" hidden><span>Held up to the device's camera: <b id="ssLearnCamWhat"></b>.</span><button type="button" class="secondary small" id="ssLearnCamOff">PUT IT AWAY</button></div>
        <h3 class="sec">Practice transaction</h3>
        <p class="hint" style="margin:0 0 8px;">Makes a PSBT that spends made-up coins of the seed on the device and holds it up to the device's camera. After you sign it, this page reads the signed PSBT from the device's screen and checks every signature with its own code.</p>
        <div class="btn-row"><select id="ssTxKind" aria-label="Kind of practice transaction"><option value="single">Single key: 2 inputs</option><option value="multi">2-of-3 multisig: 1 input</option></select><button type="button" id="ssTxGo">PRACTICE TRANSACTION</button></div>
        <p class="ms-warn" id="ssTxNet" hidden>Mainnet: these coins don't exist; this PSBT can never be broadcast.</p>
        <p class="status" id="ssTxStatus" aria-live="polite"></p>
        <p class="hint" id="ssTxCoins"></p>
      </div>
    </details>`;
{
  const a = html.indexOf('<details id="practiceBox">'); must(a > 0, "practiceBox");
  const z = html.indexOf("</details>", a); must(z > a, "practiceBox end");
  must(html.slice(a + 10, z).indexOf("<details") < 0, "practiceBox has a nested details");
  html = html.slice(0, z + 10) + box + html.slice(z + 10);
}

// ---- 3. hooks in the page's wipes ----
for (const [a, b] of HOOKS) rep(a, b);

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
  ["ss_page.js and ss_learn.js", rd("ss_page.js") + "\n" + rd("ss_learn.js").replace(/^"use strict";$/m, "")],
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
