// ss_page.js: VOIDFORGE page glue for the SeedSigner 0.8.7 practice signer (CHECK A BACKUP > Practice signer).
// The device starts only when its box is opened, and stops when the box is closed, on CLEAR ALL, on auto-clear and on
// END SESSION (see clearAll(), autoWipe() and endSession()): every pending wait of the old run is aborted (SS_GEN), the
// camera is released, the seeds in its memory are overwritten and dropped, and the screen goes black.
// Keys: the five D-pad keys and KEY1-KEY3 on the case (mouse, touch or pen), or, only while the device has focus,
// the arrow keys, Enter or Space (joystick press) and 1, 2, 3 (KEY1, KEY2, KEY3). Nothing listens to the whole page.
"use strict";
let ssPageOn = false, ssPageRun = 0;
const SS_PAGE_KEYMAP = { ArrowUp: "KEY_UP", ArrowDown: "KEY_DOWN", ArrowLeft: "KEY_LEFT", ArrowRight: "KEY_RIGHT", Enter: "KEY_PRESS", " ": "KEY_PRESS", "1": "KEY1", "2": "KEY2", "3": "KEY3" };
const SS_PAGE_KEYS = { ssKUp: "KEY_UP", ssKLeft: "KEY_LEFT", ssKPress: "KEY_PRESS", ssKRight: "KEY_RIGHT", ssKDown: "KEY_DOWN", ssK1: "KEY1", ssK2: "KEY2", ssK3: "KEY3" };

// True while the device runs, or while anything of it is left after the box was closed (settings saved to its
// simulated microSD, text in the font caches), so auto-clear still wipes it.
function ssPageActive() {
  if (ssPageOn) return true;
  try { if (SS_SIM_MICROSD.settings_json) return true; } catch (e) { /* settings part missing */ }
  try { if (Object.keys(SSFonts.fonts).length) return true; } catch (e) { /* engine missing */ }
  return false;
}

async function ssPageStart() {
  if (ssPageOn) return;
  const c = document.getElementById("ssScreen");
  if (!c) return;
  ssPageOn = true;
  const run = ++ssPageRun;
  c.style.width = "100%"; c.style.height = "100%";   // the bezel sets the size (the engine would set 320 x 240 px)
  SSController._listeners_installed = true;           // never the engine's window-wide key listeners: see ssPageInit()
  // Device pixels per screen pixel: from the size the bezel really shows (page zoom and phone scaling included), so the
  // screen stays sharp; 1 to 4.
  const shown = c.getBoundingClientRect().width * (window.devicePixelRatio || 1) / 320;
  const scale = Math.min(4, Math.max(1, Math.ceil((shown > 0 ? shown : (window.devicePixelRatio || 1)) - 0.1)));
  try { await SSController.start(c, { scale }); }
  catch (e) { console.error("Practice signer did not start:", e); }
  if (run !== ssPageRun) ssPageStop();   // closed while the fonts were loading
}

// v2.16.1: does the device hold a secret now (a reason for re-hide to cover it: RH_HOLD in the main script)? Any seed in its
// memory, loaded or being made or typed in (the pending seed and words), unless it is a public seed with no passphrase (the
// lessons' test seeds, a Damascus practice seed: knownPhrase). A seed being loaded (the pending seed: a passphrase may be typed for
// it) and the passphrase screens always count, as does the SeedQR of a seed that is not public held up to its camera (LOAD INTO
// THE PRACTICE SIGNER). When it cannot tell, it says yes.
const SS_PASS_VIEWS = ["SSSeedAddPassphraseView", "SSSeedAddPassphraseExitDialogView", "SSSeedReviewPassphraseView"];
function ssSeedQrPhrase(t) {   // the words of a Standard SeedQR (4 digits per word), or ""
  if (!/^(\d{48}|\d{96})$/.test(String(t || ""))) return "";
  const w = String(t).match(/\d{4}/g).map((d) => WORDLIST[+d]);
  return w.every(Boolean) ? w.join(" ") : "";
}
function vfSignerHoldsSecret() {
  if (!ssPageOn) return false;
  try {
    const known = (m) => typeof knownPhrase === "function" && !!knownPhrase(m);
    const pub = (s) => !s.passphrase && known(s.mnemonic_str);
    if (ssLearnCam.key === "seedload" && ssLearnCam.frames) for (const f of ssLearnCam.frames) if (f && !known(ssSeedQrPhrase(f))) return true;
    const st = SSController._instance && SSController._instance._storage; if (!st) return false;
    for (const s of st.seeds || []) if (s && !pub(s)) return true;
    if (st.pending_seed) return true;
    const pm = Array.isArray(st._pending_mnemonic) ? st._pending_mnemonic.filter(Boolean) : [];
    if (pm.length && !pub({ mnemonic_str: pm.join(" "), passphrase: "" })) return true;
    const v = ssLearnState(); if (v && SS_PASS_VIEWS.includes(v.view)) return true;
    return false;
  } catch (e) { return true; }
}
// v2.16.1: the page's seed was wiped (wipeSeed: ADD THIS KEY & WIPE THE SEED in the multisig box, CLEAR ALL): no copy of it may be
// left in the practice signer. A one-click load stops and its SeedQR is put away (and overwritten); a device that still holds a
// seed that is not public is switched off, as when its box is closed (its seeds are wiped; settings saved to its microSD stay).
function vfSignerDropSeed() {
  if (!ssPageOn) return false;
  try { if (ssAuto.on) ssAutoEnd("Not loaded: the seed was wiped from the page.", "bad"); if (ssLearnCam.key === "seedload") ssLearnHide(); } catch (e) { /* lessons part missing */ }
  if (!vfSignerHoldsSecret()) return false;
  const b = document.getElementById("ssBox");
  ssPageStop();
  if (b && b.open) b.open = false;
  return true;
}

// Overwrites what can be overwritten in a seed (byte arrays, word lists) before the references are dropped.
// (JavaScript strings cannot be wiped; dropping every reference lets the browser free them.)
function ssPageScrubSeed(s) {
  if (!s || typeof s !== "object") return;
  try {
    for (const k of Object.keys(s)) {
      const v = s[k];
      if (v instanceof Uint8Array) v.fill(0);
      else if (Array.isArray(v)) v.fill("");
      else if (v instanceof Map) { for (const x of v.values()) if (x instanceof Uint8Array) x.fill(0); v.clear(); }
    }
    s._mnemonic = []; s._passphrase = ""; s.seed_bytes = null;
  } catch (e) { /* best effort */ }
}

function ssPageStop() {
  ssPageOn = false; ssPageRun++;
  let ran = false;
  try { ran = !!SSRenderer._instance; SS_GEN++; } catch (e) { return; }   // aborts every pending sleep and key wait of the running device
  const ctl = SSController._instance;
  try { if (ctl && ctl.screensaver) ctl.screensaver.stop(); } catch (e) { /* not running */ }
  try { if (ctl && ctl.toast_notification_thread) ctl.toast_notification_thread.stop(); } catch (e) { /* not running */ }
  try { const k = SSCamera._instance; if (k) { k.stop_video_stream_mode(); k.stop_single_frame_mode(); } } catch (e) { /* no camera */ }
  try { if (typeof ssPsbtWipeController === "function") ssPsbtWipeController(ctl); } catch (e) { /* best effort: PSBTs, signatures, scanned data */ }
  try {
    const st = ctl && ctl._storage;
    if (st) {
      for (const s of st.seeds || []) ssPageScrubSeed(s);
      ssPageScrubSeed(st.pending_seed);
      if (Array.isArray(st._pending_mnemonic)) st._pending_mnemonic.fill(null);
      if (Array.isArray(st.seeds)) st.seeds.length = 0;
      st.pending_seed = null; st._pending_mnemonic = [];
    }
    if (ctl) {
      for (const f of ["psbt", "psbt_seed", "psbt_parser", "unverified_address", "multisig_wallet_descriptor", "image_entropy_preview_frames",
        "image_entropy_final_image", "address_explorer_data", "sign_message_data", "resume_main_flow", "current_destination"]) ctl[f] = null;
      ctl.back_stack = new SSBackStack(); ctl._storage = null;
    }
  } catch (e) { /* best effort */ }
  SSController._instance = null; SSHardwareButtons._instance = null;
  try { SSSettings._instance = null; } catch (e) { /* settings part missing */ }
  const c = ran ? document.getElementById("ssScreen") : null;   // (a device that never drew leaves the screen black already)
  if (c) { const g = c.getContext && c.getContext("2d"); if (g) { g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height); } }
  try { if (SSRenderer._instance) { SSRenderer._instance.canvas = null; SSRenderer._instance.draw = null; } SSRenderer._instance = null; } catch (e) { /* not started */ }
  // Every text the device ever drew or measured (seed words, passphrase, dice rolls) is a key in its fonts' measuring
  // caches: drop the fonts (the next start makes new ones), the scratch canvases, and any fields of a screen being built.
  try { SSFonts.fonts = {}; } catch (e) { /* engine missing */ }
  try { _ss_scratch = null; _ss_measure_ctx = null; _ss_color_ctx = null; } catch (e) { /* engine missing */ }
  try { SS_TOOLS_PENDING_FIELDS.length = 0; } catch (e) { /* tools part missing */ }
  try { if (typeof ssLearnWipe === "function") ssLearnWipe(); } catch (e) { /* lessons part missing */ }   // v2.14.0: lessons, practice wallet, practice PSBT
  try { if (typeof ssfDeviceOff === "function") ssfDeviceOff(); } catch (e) { /* page part missing */ }   // v2.14.0: a seed FORGE SEED took from it
}

// CLEAR ALL, auto-clear and END SESSION: stop the device, wipe its memory (and the settings on its simulated microSD),
// and close the box.
// v2.15.0: the microSD's settings file goes first, and the settings object is dropped again after the stop, so a part that
// reads a setting while the device stops (the lesson panel asks for the network) cannot bring the old settings back: the
// next start loads the defaults.
function ssPageWipe() {
  try { SS_SIM_MICROSD.settings_json = null; } catch (e) { /* settings part missing */ }
  ssPageStop();
  try { SSSettings._instance = null; } catch (e) { /* settings part missing */ }
  const b = document.getElementById("ssBox");
  if (b && b.open) b.open = false;
}

// v2.14.0: OPEN PRACTICE SIGNER (the card under the header) and PRACTICE SIGNER in the MENU: CHECK A BACKUP, the box opened
// (which starts the device), scrolled into view, and the device focused so its keys work at once.
function ssPageOpen() {
  const mb = document.getElementById("menuBox"); if (mb) mb.open = false;
  if (typeof showTab === "function") showTab("check");
  const b = document.getElementById("ssBox"), dev = document.getElementById("ssDevice");
  if (!b || !dev) return;
  if (!b.open) b.open = true;
  b.scrollIntoView({ block: "start" });
  try { dev.focus({ preventScroll: true }); } catch (e) { dev.focus(); }
}

function ssPageInit() {
  const box = document.getElementById("ssBox"), dev = document.getElementById("ssDevice");
  if (!box || !dev) return;
  // Closing the box is like switching the device off: settings saved to its simulated microSD (Persistent settings) stay
  // until CLEAR ALL, auto-clear or END SESSION; everything else is wiped.
  box.addEventListener("toggle", () => { if (box.open) ssPageStart(); else ssPageStop(); });
  const hw = () => (ssPageOn && SSHardwareButtons._instance) ? SSHardwareButtons._instance : null;
  const allUp = () => { const h = hw(); if (h) for (const k of SSHardwareButtonsConstants.ALL_KEYS) h.key_up(k); };
  const btnOf = (k) => document.getElementById(Object.keys(SS_PAGE_KEYS).find(id => SS_PAGE_KEYS[id] === k) || "");
  dev.addEventListener("keydown", (e) => {
    const k = SS_PAGE_KEYMAP[e.key];
    if (!k || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    const b = btnOf(k); if (b) b.classList.add("ss-down");
    const h = hw(); if (h && !e.repeat) h.key_down(k);
  });
  dev.addEventListener("keyup", (e) => {
    const k = SS_PAGE_KEYMAP[e.key]; if (!k) return;
    const b = btnOf(k); if (b) b.classList.remove("ss-down");
    const h = hw(); if (h) h.key_up(k);
  });
  dev.addEventListener("blur", () => { allUp(); for (const id of Object.keys(SS_PAGE_KEYS)) { const b = document.getElementById(id); if (b) b.classList.remove("ss-down"); } });
  for (const id of Object.keys(SS_PAGE_KEYS)) {
    const b = document.getElementById(id), key = SS_PAGE_KEYS[id];
    if (!b) continue;
    b.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      try { dev.focus({ preventScroll: true, focusVisible: false }); } catch (err) { dev.focus(); }
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ }
      b.classList.add("ss-down");
      const h = hw(); if (h) h.key_down(key);
    });
    const up = () => { b.classList.remove("ss-down"); const h = hw(); if (h) h.key_up(key); };
    b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); b.addEventListener("lostpointercapture", up);
    b.addEventListener("contextmenu", (e) => e.preventDefault());
  }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ssPageInit); else ssPageInit();
