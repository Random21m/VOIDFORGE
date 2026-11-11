// VOIDFORGE house style (docs/STYLE.md), checked on the page as written: every tool box has a one-line hint and exactly one
// gold main action, PRINT and CLEAR are never gold, results use the status classes (never an inline color), one warning style,
// only the listed tags, curly apostrophes in visible text, and "review", never "audit" (but the fixed disclaimer phrase).
// It reads the HTML only (no script runs), so text the page's script makes later is outside it; see docs/STYLE.md.
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
};
const keyOf = (b) => b.id || label(b);
const panelOf = (b, box, want) => { for (let p = b.parentElement; p && p !== box; p = p.parentElement) if (p.id && p.id === want) return want; return ""; };
{
  const bad = [];
  for (const box of boxes) {
    const g = [...box.querySelectorAll("button")].filter((b) => boxOf(b) === box && gold(b));
    const steps = STEPS[box.id];
    if (!steps) { if (g.length > 1) bad.push(where(box) + ": " + g.map(label).join(", ")); continue; }
    const got = g.map(keyOf), want = Object.keys(steps);
    if (got.length !== want.length || !want.every((k) => got.includes(k))) { bad.push(where(box) + " (steps): gold " + got.join(", ") + "; listed " + want.join(", ")); continue; }
    for (const b of g) { const p = steps[keyOf(b)]; if (p && panelOf(b, box, p) !== p) bad.push(where(box) + ": " + keyOf(b) + " is not in its panel #" + p); }
    for (const p of Object.values(steps)) if (p && !d.getElementById(p)) bad.push(where(box) + ": no panel #" + p);
  }
  check("one gold main action per tool box (" + Object.keys(STEPS).length + " step or mode tools listed, each step or mode with its own)", bad.length === 0, bad.join(" | "));
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
  const TAGS = ["SECRET", "RECOMMENDED", "PUBLIC KEYS ONLY", "PUBLIC ADDRESSES", "NO WORDS, KEEP PRIVATE", "NO REAL KEYS", "PRACTICE ONLY", "TEST ONLY", "READ ONLY", "NO KEYS NEEDED", "USES THE WORDS ABOVE", "PRIVATE", "PUBLIC", "ADVANCED", "NEW"];
  const tags = [...d.querySelectorAll(".tag")].map(label), bad = tags.filter((t) => !TAGS.includes(t));
  check("tags are the listed ones (" + tags.length + " tags)", tags.length > 30 && bad.length === 0, [...new Set(bad)].join(", "));
  const ss = d.querySelector("#ssBox > summary");
  check("the practice signer box is tagged PRACTICE ONLY and has its hint", !!ss && label(ss.querySelector(".tag")) === "PRACTICE ONLY" && !!ss.querySelector("small"));
}

// ---- visible text: curly apostrophes, "review" not "audit"
const changelog = [...d.querySelectorAll("#tp-about details")].find((x) => /^Changelog$/.test(label(x.querySelector("summary") || x)));
const visible = [];
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
}
{
  const ok = /not (been )?independently audited/gi;
  const bad = visible.filter(([t]) => /audit/i.test(t.replace(ok, ""))).map(([t, p]) => (p.id || p.tagName) + ": " + t.trim().slice(0, 70));
  // the page's script too, but the BIP39 word list (which has the word "audit")
  const src = [...d.querySelectorAll("script")].map((s) => s.textContent).join("\n").replace(/"audit"/g, "").replace(ok, "");
  const inScript = (src.match(/.{0,40}audit.{0,30}/gi) || []);
  check('"review", never "audit", in the text and the script (only "has not been independently audited")', bad.length === 0 && inScript.length === 0, bad.concat(inScript).slice(0, 5).join(" | "));
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
