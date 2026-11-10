# SeedSigner+ practice simulator: port brief (shared by every helper)

Goal: a FAITHFUL in-browser port of SeedSigner 0.8.7's user interface (commit e0a80d4b33b8eb7fb1e9fd14a27b7cd11c7d2cd6), running on the
320x240 display ("st7789 320x240", what the SeedSigner+ uses), for practice inside VOIDFORGE (one offline HTML file). Same screens,
same menus, same wording, same button behavior, same layout numbers, SeedSigner's own screen colors (GUIConstants). Only differences:
it runs in a browser, the case around the screen is drawn by the page, and seeds/keys come from VOIDFORGE's own crypto functions.

Source of truth: /tmp/claude-0/-home-user/28807a2f-32e3-5d43-9289-50b966fc57a2/scratchpad/ss-research/src/src/seedsigner (read it; do not
run it). Spec summary: /tmp/claude-0/-home-user/28807a2f-32e3-5d43-9289-50b966fc57a2/scratchpad/ss-research/spec.md.
Never invent screens, text or behavior: port what the code does. Where a hardware feature cannot exist in a browser (microSD, power
off, camera hardware), keep the screens and text exactly and note the stand-in in a comment `// SIM:`.

## Port rules (so the parts fit together)
- Plain browser JavaScript (ES2020), no imports, no libraries, no network. Every global you create starts with `SS` (classes `SSxxx`,
  functions `ssXxx`, constants `SS_XXX`) so nothing clashes with the 13,000-line page it goes into.
- Port Python classes to JS classes with the SAME names prefixed SS: `ButtonListScreen` -> `SSButtonListScreen`, `SeedOptionsView` ->
  `SSSeedOptionsView`, `GUIConstants` -> `SSGUIConstants`, `Button` (component) -> `SSButton`. Same field names in camelCase is NOT
  wanted: keep the Python snake_case field names (`button_data`, `show_back_button`, `is_bottom_list`) so the port stays checkable
  line by line against the Python.
- Python dataclass `__post_init__` -> the JS constructor takes ONE object of fields: `new SSButtonListScreen({title: "Load a Seed",
  button_data: [...], is_button_text_centered: false})`, applies defaults exactly as the dataclass does, then runs the post-init code.
- Screens: `async run()` returns what `_run()` returns in Python (an index, or SS_RET_CODE__BACK_BUTTON = 1000, SS_RET_CODE__POWER_BUTTON = 1001).
  Input: `await SSHardwareButtons.wait_for(keys)` resolves to one of the strings in SSHardwareButtonsConstants (KEY_UP, KEY_DOWN,
  KEY_LEFT, KEY_RIGHT, KEY_PRESS, KEY1, KEY2, KEY3), exactly as hardware_buttons.wait_for in Python; `SSHardwareButtons.check_for_low(key)`
  is the non-blocking check. Threads (animations, scrolling button text, flashing warning edges, QR frames) become `setInterval`/async
  loops that stop when the screen finishes.
- Views: `class SSXxxView extends SSView` with `async run()` returning `new SSDestination(SSOtherView, {view_args: {...},
  skip_current_view: false, clear_history: false})`, exactly mirroring the Python. `this.run_screen(SSScreenClass, {fields})` is
  View.run_screen. The controller (port of controller.py's loop and back_stack) is in the engine.
- Drawing: the engine provides a PIL-like layer over a 320x240 canvas: `SSImage.new(mode, [w, h], color)`, `img.paste(other, [x, y])`,
  `SSImageDraw.Draw(img)` with `.text([x, y], text, {fill, font, anchor})`, `.rounded_rectangle([x0, y0, x1, y1], {fill, outline,
  width, radius})`, `.rectangle(...)`, `.line(...)`, `.ellipse(...)`, `.arc(...)`; `SSFonts.get_font(font_name, size)` returning a font
  with `.getbbox(text, {anchor})` and `.getlength(text)` (port of gui/components.py Fonts). Port component code that uses PIL by
  calling these with the same arguments. Font names as in GUIConstants: "OpenSans-Regular", "OpenSans-SemiBold",
  "Inconsolata-Regular", "Inconsolata-SemiBold", "seedsigner-icons", and FontAwesome icons are drawn by the engine as SVG paths
  (call `SSIcon(draw, codepoint_constant, [x, y], size, color)` for FontAwesome codepoints; seedsigner-icons glyphs are real font text).
- Crypto / models: do not port embit. Seeds, words, fingerprints, xpubs, addresses, SeedQR come from these existing VOIDFORGE
  functions (all async unless noted): mnemonicToSeed(mnemonic, passphrase) -> Uint8Array; fingerprintFromSeed(seed) -> "8 hex";
  entropyToMnemonic(bytes) -> "words"; checkPhrase(words) -> {ok, mnemonic}; WORDLIST (array, sync); watchOnlyFromSeed(seed, type,
  account, net) -> {xpub, key, fp, ...} with type "wpkh" | "sh-wpkh" | "tr" | "ms-wsh" ...; walletAddressesFrom(root, steps, type, net,
  chain, from, n) where root = await masterFromSeed(seed); qrMatrix(text) -> {rows} (sync); sha256bytes(bytes). Port
  models/seed.py and models/seed_storage.py as small JS classes on top of these (SSSeed, SSSeedStorage) keeping the method names
  the views call.
- Settings: port models/settings_definition.py fully (every entry, option, default, visibility) as data; SSSettings.get_instance()
  with get_value / set_value like the Python.
- Text: English only (gettext `_()` -> plain string; keep the exact English source strings). No translations.
- Output: one JS file per helper part (path given in your task) plus a short NOTES.md listing every Python class ported, anything
  left out (with the reason), and every `// SIM:` stand-in.
