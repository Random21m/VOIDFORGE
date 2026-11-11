# VOIDFORGE house style

Every tool box on the page follows the same rules, so the page looks and works the same everywhere.
`tests/style.test.mjs` checks the rules marked **(checked)**.

## A tool box

A tool box is a `<details>` in MAKE A SEED, CHECK A BACKUP or EXTRA TOOLS (not the small "How it works" boxes, class `wd-how`).

1. **Title** in the `<summary>`: what the tool does, in plain words.
2. **One tag** after the title, if the tool needs one (see Tags).
3. **One-line hint** in the summary: `<small>` with one short sentence that says what you get. **(checked)**
4. **Inputs**, then the buttons in a `btn-row`, then the result.
5. **Exactly one gold main action** per tool: a plain `<button>`. Everything else is gray, class `secondary`. **(checked)**
   - Every PRINT button is gray. **(checked)**
   - CLEAR is gray. CLEAR ALL and END SESSION, which wipe the whole page, use the red outline (`btn-clear`); never gold. **(checked)**
   - A tool that works in steps (START, then CHECK) or in modes (split or combine) may give each step or mode its own gold
     action, when the steps or modes show one at a time. Each one is listed in `tests/style.test.mjs` (STEPS), with its panel.
6. **Result** in a `class="status"` line: `status ok` (green) when it worked, `status bad` (red) when it did not, plain `status`
   for a neutral count. Never an inline color on a status or hint line. **(checked)**

## Warnings

One warning style: `class="ms-test"` (a filled bar, dark text, left aligned). It is for PRACTICE, TESTNET, TEST ONLY and every
other "never put money on this" notice. No other warning classes (`ms-warn`, `ss-warn` are gone). **(checked)**

Page-wide banners at the top (offline, watch check, practice mode) keep their own place and look; the About tab's standing
disclaimer box is a panel, not a notice.

## Tags

Short, in capitals, one per box (two only for ADVANCED and NEW). The list: SECRET, RECOMMENDED, PUBLIC KEYS ONLY,
PUBLIC ADDRESSES, PUBLIC TEXT ONLY, NO WORDS, KEEP PRIVATE (one tag), NO REAL KEYS, PRACTICE ONLY, TEST ONLY, READ ONLY, NO KEYS NEEDED, USES THE WORDS ABOVE, and in the
"What can someone do with this?" guide PRIVATE and PUBLIC; ADVANCED and NEW.
A new tag is added to this list and to the test first. **(checked)**

## Headings and spacing

- `h3 class="sec"` for a section heading inside a box, `h4 class="sec"` for a sub-heading.
- `class="hint"` for help text. `btn-row top` for a button row under an input or a paragraph (no inline margin).

## Words

- American English, plain and short. Do not dumb anything down: say the exact thing, in few words.
- Curly apostrophes in visible text (don’t, device’s), written `&rsquo;` or ’. **(checked)**
- **review**, never "audit". The one exception is the fixed phrase "has not been independently audited" (and its short
  form "not independently audited" in the notice strip). **(checked)**
- Tabs are quoted in capitals, as on the tab: MAKE A SEED, CHECK A BACKUP, EXTRA TOOLS, ABOUT &amp; HELP. Buttons are quoted
  as they read: FORGE SEED, PRINT SEED.
- **practice seed**: a seed made in practice (a Damascus practice sheet, the practice signer). **public test seed**: a
  published phrase anyone can know (BIP39 test vectors such as abandon ... about). Never put money on either.
- Button labels are the action, with no "PRACTICE:" style prefix; a PRACTICE banner says it when it matters.

## What the test does not see

`tests/style.test.mjs` reads the page as written (the HTML). Text and buttons that the page's script makes later (results,
the Damascus checker, the practice signer's lessons) follow the same rules by hand.
