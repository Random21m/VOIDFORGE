// VOIDFORGE house style (docs/STYLE.md), checked on the page as written: every tool box has a one-line hint and exactly one
// gold main action (or is listed as having none), the cards' own gold buttons are each the one of their panel, PRINT and CLEAR
// are never gold, results use the status classes (never an inline color, with or without a class), one warning style, only
// the listed tags and one per box, btn-row top, curly apostrophes and no straight quote marks in visible text and in the
// script's strings (all of the v2.15.0 code; never more in the older code), American spelling, and "review", never "audit".
// It reads the HTML only (no script runs); text the page's script makes is checked as the strings in its source.
// Run: node tests/style.test.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.VF_FILE || path.join(here, "..", "voidforge.html"), "utf8");
const d = new JSDOM(html).window.document;

let pass = 0; const fails = [];
const check = (name, cond, info) => { if (cond) { pass++; console.log("PASS " + name); } else { fails.push(name); console.log("FAIL " + name + (info ? "\n     " + info : "")); } };
const label = (b) => b.textContent.replace(/\s+/g, " ").trim();
const where = (e) => e.id ? "#" + e.id : (e.querySelector(":scope > summary") ? '"' + label(e.querySelector(":scope > summary")).slice(0, 50) + '"' : e.tagName);

// ---- which buttons are gold: a plain <button> is gold (the main action); these classes make a button gray or something else
const OLD_ROWS = 27;   // the older button rows that still have an inline margin (6, 10 or 12 px, not the 8 px of btn-row top); never more
const NOT_GOLD = ["secondary", "print-btn", "theme-toggle", "guide-btn", "size-btn", "dl-btn", "btn-clear", "btn-test", "linklike", "dict-link", "dict-cat",
  "ss-k", "tap", "cd-card", "ms-preset", "sg-go"];
const gold = (b) => !NOT_GOLD.some((c) => b.classList.contains(c)) && b.getAttribute("role") !== "tab" && !b.closest(".dm-fbar");   // tabs and the Damascus step bar are tabs

// ---- the tool boxes: <details> in the three tool tabs, not the small "How it works" boxes (wd-how) or the BIP21 request box
const TABS = ["tp-make", "tp-check", "tp-tools"];
const isBox = (e) => e.tagName === "DETAILS" && !e.matches(".wd-how, .bip21") && TABS.some((t) => e.closest("#" + t));
const boxes = [...d.querySelectorAll("details")].filter(isBox);
const boxOf = (e) => { for (let p = e.parentElement; p; p = p.parentElement) if (isBox(p)) return p; return null; };
check("the tool boxes are found (" + boxes.length + ")", boxes.length >= 40, boxes.length);

// Tools that work in steps or modes, one at a time: each step or mode has its own gold action. Listed here, with the panel each
// gold button sits in ("" = the box itself), so a new gold button anywhere still fails. (docs/STYLE.md, rule 5)
const STEPS = {
  cdBox: { "cdBtn": "", "cdHexBtn": "cdHexBox" },                                                // cards, or hex in its own closed box
  drillBox: { "START DRILL": "drillStart", "CHECK MY PAPER": "drillRun" },                       // start, then type back from paper
  practiceBox: { "prStart": "", "prHide": "prShow", "prCheckBtn": "prCheck" },                   // start, hide the words, check the paper
  reforgeBox: { "reforgeWordsBtn": "reforgeWordsPanel", "reforgePassBtn": "reforgePassPanel" },  // modes: missing words or a passphrase
  xorBox: { "xorSplitBtn": "xorSplitPanel", "xorCombineBtn": "xorCombinePanel" },                // modes: split or combine
  s39Box: { "s39Btn": "s39CombinePanel", "s39mBtn": "s39MakePanel" },                            // modes: check and combine, or make
  c32Box: { "c32Btn": "c32CombinePanel", "c32mBtn": "c32MakePanel" },                            // modes: check and combine, or make
  msBox: { "msStartBtn": "msIntro", "ADD THIS KEY": "msRun", "msbBtn": "msDone" },               // set up, add each key, the finished wallet
  dmBox: { "dmBtn": "dmGoRow", "dmTourNext": "dmTour" },                                        // FORGE SEED, or NEXT while the guided practice runs (FORGE SEED is off then)
  ssBox: { "ssForgeBtn": "", "ssOwnGo": "ssOwnBox" },                                          // v2.17.0: FORGE SEED from the device, and Use it for real (HOLD UP TO THE DEVICE)
};
// Boxes with no main action, so no gold button: they show something, work as you type, or hold settings (their buttons, if
// any, are COPY, SHOW, HIDE or PRINT, all gray). Listed here, so a tool box without its gold button anywhere else fails.
const NO_ACTION = {
  rollStats: "shows the rolls", autoClearBox: "settings", rhBox: "settings", checkGuide: "instructions", explainBox: "shows the steps (gray SHOW)",
  addrBox: "shows addresses (gray COPY and QR)", seedQrBox: "shows the SeedQR (gray SHOW, PRINT)", watchBox: "shows keys (gray COPY and QR)", spBox: "shows an address",
  coreBox: "shows commands (gray COPY)", msCoreBox: "shows commands (gray COPY)", walletView: "shows addresses (gray buttons)", planBox: "works as you type (gray PRINT)",
  payCheck: "works as you type", costBox: "works as you type", dlBox: "works when a file is picked",
};
const keyOf = (b) => b.id || label(b);
const panelOf = (b, box, want) => { for (let p = b.parentElement; p && p !== box; p = p.parentElement) if (p.id && p.id === want) return want; return ""; };
{
  const bad = [];
  for (const box of boxes) {
    const g = [...box.querySelectorAll("button")].filter((b) => boxOf(b) === box && gold(b));
    const steps = STEPS[box.id];
    if (!steps) { if (NO_ACTION[box.id] ? g.length !== 0 : g.length !== 1) bad.push(where(box) + ": " + (g.length ? g.map(label).join(", ") : "no gold main action") + (NO_ACTION[box.id] ? " (listed as having none)" : "")); continue; }
    const got = g.map(keyOf), want = Object.keys(steps);
    if (got.length !== want.length || !want.every((k) => got.includes(k))) { bad.push(where(box) + " (steps): gold " + got.join(", ") + "; listed " + want.join(", ")); continue; }
    for (const b of g) { const p = steps[keyOf(b)]; if (p && panelOf(b, box, p) !== p) bad.push(where(box) + ": " + keyOf(b) + " is not in its panel #" + p); }
    for (const p of Object.values(steps)) if (p && !d.getElementById(p)) bad.push(where(box) + ": no panel #" + p);
  }
  check("exactly one gold main action per tool box (" + Object.keys(STEPS).length + " step or mode tools listed, each step or mode with its own; " + Object.keys(NO_ACTION).length + " boxes listed with none)", bad.length === 0, bad.join(" | "));
  const gone = Object.keys(NO_ACTION).filter((id) => !d.getElementById(id) || !isBox(d.getElementById(id)));
  check("every box listed as having no main action is a tool box on the page", gone.length === 0, gone.join(", "));
}

// ---- the cards themselves (VERIFY, the dice tool, the multisig card ...): outside the tool boxes, every gold button is the one
// gold button of its own panel (an element whose id ends in "Block"), or one of these, each in its own place ("" = anywhere in the card)
const CARD_GOLD = {
  cardGen: { "FORGE SEED": "genRight", "NEXT →": "guidePanel", "ADD THIS KEY & WIPE THE SEED": "msBanner" },
  cardCheck: { "VERIFY": "", "CHECK ADDRESS": "", "TRY ACCOUNTS 0 TO 20": "" },
};
{
  const bad = [], cards = [...d.querySelectorAll(".card")].filter((c) => TABS.some((t) => c.closest("#" + t)));
  for (const c of cards) {
    const g = [...c.querySelectorAll("button")].filter((b) => !boxOf(b) && gold(b)), listed = CARD_GOLD[c.id] || {}, seen = {}, blocks = new Map();
    for (const b of g) {
      const blk = b.closest('[id$="Block"]');
      if (blk && c.contains(blk)) { blocks.set(blk, (blocks.get(blk) || 0) + 1); continue; }
      const k = label(b);
      if (!(k in listed)) { bad.push(c.id + ": gold " + k + " is not listed"); continue; }
      if (listed[k] && !b.closest("#" + listed[k])) bad.push(c.id + ": " + k + " is not in #" + listed[k]);
      seen[k] = (seen[k] || 0) + 1;
    }
    for (const [blk, n] of blocks) if (n !== 1) bad.push(c.id + " #" + blk.id + ": " + n + " gold buttons");
    for (const k of Object.keys(listed)) if (seen[k] !== 1) bad.push(c.id + ": " + k + " found " + (seen[k] || 0) + " times");
  }
  check("the cards: every gold button outside a tool box is the one main action of its panel (" + cards.length + " cards)", cards.length >= 3 && bad.length === 0, bad.join(" | "));
}

// ---- every tool box has its one-line hint in the summary
{
  const bad = boxes.filter((b) => { const s = b.querySelector(":scope > summary"), sm = s && s.querySelector(":scope > small"); return !sm || !sm.textContent.trim() || s.querySelectorAll(":scope > small").length !== 1; });
  check("every tool box summary has its one-line hint (<small>)", bad.length === 0, bad.map(where).join(", "));
}

// ---- PRINT and CLEAR are never gold (anywhere on the page); CLEAR in a tool is gray
{
  const all = [...d.querySelectorAll("button")];
  const pr = all.filter((b) => /^PRINT\b/.test(label(b)) && gold(b));
  check("every PRINT button is gray (" + all.filter((b) => /^PRINT\b/.test(label(b))).length + " buttons)", pr.length === 0, pr.map(label).join(", "));
  const cl = all.filter((b) => /^CLEAR\b/.test(label(b)));
  const clBad = cl.filter((b) => gold(b) || (label(b) === "CLEAR" && !b.classList.contains("secondary")));
  check("CLEAR is gray in every tool, CLEAR ALL is the red outline, never gold (" + cl.length + " buttons)", cl.length > 5 && clBad.length === 0, clBad.map((b) => label(b) + " " + b.className).join(", "));
}

// ---- results and hints: the status classes, never an inline color
{
  const bad = [...d.querySelectorAll(".status, .hint, .ms-test, .pass-warn, summary small")].filter((e) => /(^|;)\s*(color|background(-color)?)\s*:/i.test(e.getAttribute("style") || ""));
  check("no inline color on a status, hint or warning line (results use status ok / status bad)", bad.length === 0, bad.map((e) => (e.id || e.className) + ": " + e.getAttribute("style")).join(" | "));
  // result lines without a class too: a live region, a role=status line, or a line named ...Note, ...Status, ...Msg, ...Warn,
  // ...Count; only the neutral gray (var(--muted)) may stay inline there
  const res = [...d.querySelectorAll("[style]")].filter((e) => e.matches("[aria-live], [role=status], [role=alert]") || /(Note|Status|Msg|Warn|Count)$/.test(e.id))
    .filter((e) => [...(e.getAttribute("style") || "").matchAll(/(?:^|;)\s*(color|background(?:-color)?)\s*:\s*([^;]+)/gi)].some((m) => !/^var\(--muted\)\s*$/.test(m[2].trim())));
  check("no inline color on any result line, with or without a class (only the neutral gray)", res.length === 0, res.map((e) => (e.id || e.tagName) + ": " + e.getAttribute("style")).join(" | "));
  const dm = ["dmMsg", "dmCount", "wdMsg", "cdMsg"].map((id) => d.getElementById(id));
  check("the make-a-seed messages are status lines (dmMsg, wdMsg, cdMsg: status bad; dmCount: status)", dm.every((e) => e && e.classList.contains("status")) && ["dmMsg", "wdMsg", "cdMsg"].every((id) => d.getElementById(id).classList.contains("bad")));
}

// ---- one warning style
{
  const css = [...d.querySelectorAll("style")].map((s) => s.textContent).join("\n");
  const other = d.querySelectorAll(".ms-warn, .ss-warn");
  check("one warning style (ms-test): no ms-warn or ss-warn left, in the page or its style sheet", other.length === 0 && !/\.(ms|ss)-warn\b/.test(css), [...other].map((e) => e.id || e.className).join(", "));
  const inl = [...d.querySelectorAll(".ms-test[style]")].filter((e) => !/^\s*display\s*:\s*none;?\s*$/i.test(e.getAttribute("style")));
  check("warnings have no inline look of their own (only display:none until they show)", inl.length === 0, inl.map((e) => (e.id || "") + " " + e.getAttribute("style")).join(" | "));
}

// ---- tags: only the listed ones (docs/STYLE.md)
{
  const TAGS = ["SECRET", "RECOMMENDED", "PUBLIC KEYS ONLY", "PUBLIC ADDRESSES", "PUBLIC TEXT ONLY", "NO WORDS, KEEP PRIVATE", "NO REAL KEYS", "PRACTICE ONLY", "TEST ONLY", "READ ONLY", "NO KEYS NEEDED", "USES THE WORDS ABOVE", "PRIVATE", "PUBLIC", "ADVANCED", "NEW"];
  const tags = [...d.querySelectorAll(".tag")].map(label), bad = tags.filter((t) => !TAGS.includes(t));
  check("tags are the listed ones (" + tags.length + " tags)", tags.length > 30 && bad.length === 0, [...new Set(bad)].join(", "));
  const many = boxes.filter((b) => { const t = [...b.querySelector(":scope > summary").querySelectorAll(".tag")].map(label); return t.filter((x) => x !== "ADVANCED" && x !== "NEW").length > 1 || new Set(t).size !== t.length; });
  check("one tag per tool box (and ADVANCED or NEW besides it)", many.length === 0, many.map(where).join(", "));
  const ss = d.querySelector("#ssBox > summary");
  check("the practice signer box is tagged SECRET (v2.16.1: it takes any seed, real ones too) and has its hint", !!ss && label(ss.querySelector(".tag")) === "SECRET" && ss.querySelector(".tag").classList.contains("tag-secret") && !!ss.querySelector("small"));
}

// ---- visible text: curly apostrophes, "review" not "audit"
const changelog = [...d.querySelectorAll("#tp-about details")].find((x) => /^Changelog$/.test(label(x.querySelector("summary") || x)));
const visible = [];
const QUOTED = /(^|[\s(])'[A-Za-z][^'\n]{0,60}[A-Za-z.!?]'(?=$|[\s.,;:!?)])/;   // 'a phrase in straight quotes'
const OLD_APOS = 204, OLD_QUOTES = 37;   // the older script's straight apostrophes and quote marks (v2.15.0); never more
{
  const tw = d.createTreeWalker(d.body, 4);   // text nodes
  for (let n; (n = tw.nextNode());) {
    const p = n.parentElement; if (p.closest("script, style, textarea, code, pre, kbd, noscript") || (changelog && changelog.contains(p))) continue;
    if (n.data.trim()) visible.push([n.data, p]);
  }
  for (const e of d.querySelectorAll("[placeholder]")) visible.push([e.getAttribute("placeholder"), e]);
}
{
  const bad = visible.filter(([t]) => /[A-Za-z]'[A-Za-z]|[a-z]s' /.test(t)).map(([t, p]) => (p.id || p.tagName) + ": " + t.trim().slice(0, 70));
  check("curly apostrophes in visible text, buttons, hints and placeholders (the frozen changelog aside)", bad.length === 0, bad.slice(0, 6).join(" | "));
  const qm = visible.filter(([t]) => QUOTED.test(t)).map(([t, p]) => (p.id || p.tagName) + ": " + t.trim().slice(0, 70));
  check("no straight quotes used as quote marks in visible text ('like this')", qm.length === 0, qm.slice(0, 6).join(" | "));
}
// Text the script makes: its double-quoted strings. The v2.15.0 code (re-hide, the passphrase check, practice, Link as QR, the
// Damascus quick path and guided practice) has no straight apostrophe and no straight quote marks at all; the older script may
// not get more of them than it has (they are moved over by hand, a few at a time).
{
  const src = [...d.querySelectorAll("script")].map((x) => x.textContent).join("\n");
  const strs = (t) => [...t.matchAll(/"(?:[^"\\\n]|\\.)*"/g)].map((m) => m[0].slice(1, -1));
  const region = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); return i < 0 || j < 0 ? null : src.slice(i, j); };
  const NEW = [['// ===== v2.15.0 "Stop costly mistakes"', "function mkSelfTests(eq){"], ["// ---- v2.15.0 guided practice", "function dmLoadExample("], ["function dmLiveAll(st){", "function dmFlowRender("]].map(([a, b]) => region(a, b));
  const badNew = NEW.flatMap((r) => r ? strs(r).filter((x) => /[A-Za-z]'[A-Za-z]/.test(x) || QUOTED.test(x)) : ["(region not found)"]);
  check("script text of the v2.15.0 code: curly apostrophes, no straight quote marks (" + NEW.map((r) => r ? strs(r).length : 0).join(" + ") + " strings)", badNew.length === 0, badNew.slice(0, 5).join(" | "));
  const all = strs(src), ap = all.filter((x) => /[A-Za-z]'[A-Za-z]/.test(x)).length, qq = all.filter((x) => QUOTED.test(x)).length;
  check("script text of the older code: no more straight apostrophes (" + ap + " of at most " + OLD_APOS + ") or straight quote marks (" + qq + " of at most " + OLD_QUOTES + ") than before", ap <= OLD_APOS && qq <= OLD_QUOTES);
}
{
  const ok = /not (been )?independently audited/gi;
  const bad = visible.filter(([t]) => /audit/i.test(t.replace(ok, ""))).map(([t, p]) => (p.id || p.tagName) + ": " + t.trim().slice(0, 70));
  // the page's script too, but the BIP39 word list (which has the word "audit")
  const src = [...d.querySelectorAll("script")].map((s) => s.textContent).join("\n").replace(/"audit"/g, "").replace(ok, "");
  const inScript = (src.match(/.{0,40}audit.{0,30}/gi) || []);
  check('"review", never "audit", in the text and the script (only "has not been independently audited")', bad.length === 0 && inScript.length === 0, bad.concat(inScript).slice(0, 5).join(" | "));
}

// ---- button rows: btn-row top under an input or a paragraph, never an inline margin (none in the v2.15.0 boxes, no new ones elsewhere)
{
  const rows = [...d.querySelectorAll(".btn-row[style]")].filter((e) => /margin/.test(e.getAttribute("style")));
  const inNew = rows.filter((e) => e.closest("#ppBox, #lqBox, #rhBox, #dmBox"));
  check("button rows use btn-row top, not an inline margin (none in the v2.15.0 boxes; " + rows.length + " older rows, at most " + OLD_ROWS + ")", inNew.length === 0 && rows.length <= OLD_ROWS && d.querySelectorAll(".btn-row.top").length >= 20, inNew.map(where).join(", "));
}

// ---- American spelling, in the visible text and in the script's sentences
{
  const BRIT = /\b(colour|behaviour|favour|honour|labour|neighbour|centre|metre|litre|theatre|organis|recognis|realis(e|ed|ing)\b|analys(e|ed|ing)\b|apologis|customis|minimis|maximis|prioritis|summaris|normalis|licence|defence|offence|practis|grey|cheque|catalogue|programme|travelled|cancelled|labelled|modelling|fulfil\b|enrol\b|judgement|aluminium|whilst|amongst|learnt|spelt)/i;
  const src = [...d.querySelectorAll("script")].map((x) => x.textContent).join("\n");
  const sentences = [...src.matchAll(/"(?:[^"\\\n]|\\.)*"/g)].map((m) => m[0]).filter((x) => / [a-z]+ /i.test(x));
  const bad = visible.filter(([t]) => BRIT.test(t)).map(([t, p]) => (p.id || p.tagName) + ": " + t.trim().slice(0, 60)).concat(sentences.filter((x) => BRIT.test(x)).map((x) => x.slice(0, 60)));
  check("American spelling (color, center, gray, behavior ...) in the text and the script's sentences", bad.length === 0, bad.slice(0, 5).join(" | "));
}

// ---- button labels: no "PRACTICE:" style prefix (the PRACTICE banner says it)
{
  const bad = [...d.querySelectorAll("button")].map(label).filter((t) => /^PRACTICE: /.test(t));
  check('no button label starts with "PRACTICE:"', bad.length === 0, bad.join(", "));
  check("the Damascus tab's practice button reads FILL IN A PRACTICE SHEET", label(d.getElementById("dmPracticeBtn")) === "FILL IN A PRACTICE SHEET");
}

// ---- the start row: one gold main action, the practice signer choice gray and naming the lessons
{
  const row = d.getElementById("startRow"), g = row ? [...row.querySelectorAll("button")].filter(gold) : [];
  const ss = d.getElementById("ssPromoBtn");
  check("the start row has one gold main action (I FOUND A BITCOIN BACKUP); OPEN PRACTICE SIGNER is gray and mentions the lessons",
    !!row && g.length === 1 && g[0].id === "heirBtn" && !!ss && row.contains(ss) && ss.classList.contains("secondary") && /lessons/.test(ss.parentElement.textContent), g.map(label).join(", "));
}

console.log("\nSTYLE: " + pass + " pass, " + fails.length + " fail");
if (fails.length) { console.log("FAILED: " + fails.join("; ")); process.exit(1); }
