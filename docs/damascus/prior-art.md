# VOIDFORGE method: prior-art search and a proposed version

Date of search: 2026-11-10. Read-only research; no repository was changed.

## 0. How to read this file, and what limits it

- **Fetched directly:** the source text was downloaded (mostly from `raw.githubusercontent.com`) and the quote was copied from it.
- **Snippet:** the host was blocked in this sandbox. These were blocked: groups.google.com, delvingbitcoin.org, bitcointalk.org, reddit, bitcoin.stackexchange.com, en.bitcoin.it, coldcard.com, help.blockstream.com, secretcodex32.com, btctranscripts.com, rudefox.io, trezor.io, penlock.io, iancoleman.io, mirror.b10c.me and gnusha.org. For these, the quote comes from the search engine's extract of the page. Re-check these before anything is published.
- I found nothing for "EntropyLab". The closest match was "Entropy32 Plus", a radioactive-decay seed generator described only in news coverage. I found no description of Passport's dice method: the passport2 README does not mention dice.
- A lot of new work appeared after the Coldcard entropy incident (disclosed around 2026-07-31), including Delving Bitcoin threads in August 2026 and new worksheets. Anything that claims to be "first" should therefore be worded as "we found no prior description of X", dated, and published.

---

## 1. Prior art, item by item

### Part 1: a printed sheet that turns pairs of dice into 5 bits with a 6x6 table (32 outcomes kept, 4 rejected), read in 11-bit groups against a numbered BIP39 list

**Verdict: done before.** The exact 2d6 rule (36 outcomes, 32 kept, 4 rejected, 5 unbiased bits) has been published as a BIP39 method. Sheets that turn rolls into binary and then into words, built so a person can audit them, are also older.

| Source | What it shows | Quote |
|---|---|---|
| seed-cat/analog-seed-entropy (README fetched; Delving Bitcoin thread 2814, dated 2026-08-17 by the mirror) https://github.com/seed-cat/analog-seed-entropy | The same 36 → 32 rejection on two d6, with doubles as the rejected cells | "Roll two dice, rerolling if you get doubles below 5 (reroll ⚀⚀, ⚁⚁, ⚂⚂, ⚃⚃)" ... "Retrying `4` of the outcomes (using doubles for easy identification) results in `32` unbiased outcomes through rejection sampling" ... "Performing this twice, we get `32 × 32 = 1024` possible outcomes / The final dice roll can be low or high, resulting in `2 × 1024 = 2048`" |
| Same project, card mode | Cards with rejection, mapped straight to words | "Dealing 3 cards results in `14 × 13 × 12 = 2184` possible outcomes, so we must retry `136`" |
| Blockstream d6 guide (snippet) https://help.blockstream.com/generate-recovery-phrase-offline-d6 | An exactly unbiased d6 → bits rule done by hand, then an 11-bit lookup | "1 to 00, 2 to 01, 3 to 10, and 4 to 11"; "Read the accumulated 11-bit value from left to right and use the binary words table to find the BIP-39 word." Blockstream also has d8, d8+d16+d16, coin, poker-card, tarot and Piacentine-card guides (same host). |
| Rudefox ShowMyWork, 2020 (snippet) https://rudefox.io/blog/2020-07-16-show-my-work.html | A worksheet made so that non-experts can audit dice → binary → words | "lets non-technical end-users audit seed generation, to verify the seed comes from 8-sided dice rolls and a set of lookup tables"; "record the dice rolls, binary and seed words in the provided worksheet" |
| Bip39-Kit (README fetched) https://github.com/boltadvantage/Bip39-Kit | Printed lookup tables for d8+d16+d16, 3d8+d4, and 5d6 with reroll rows. Words 1–23 need no computer. | "`dice-table-d6.txt` 5d6 per word, with reroll rows (21% of throws)"; "Steps 2 and 4 need no computer at all." |
| bitaps mnemonic-improvement (fetched) https://github.com/bitaps-com/mnemonic-offline-tool/blob/master/BIP/mnemonic-improvement.md | A dice word list with 5d6 per word and exclusions | "it is most convenient to use 5 cubes at a time"; "Some combinations are excluded for a uniform probability distribution." |
| Ian Coleman bip39 `entropy.js` (fetched) https://github.com/iancoleman/bip39/blob/master/src/js/entropy.js | Unbiased base-6 and card-to-bits mappings | "Average (4*2 + 2*1) / 6 = 1.66 bits per roll without bias"; "32 cards give 5 bits each". The older biased mode is described in issue 435 (snippet): "discarding some bits ... results in an uneven distribution" https://github.com/iancoleman/bip39/issues/435 |
| atoponce gist (snippet) https://gist.github.com/atoponce/44d50f0bbcd06811c8c8eeef13b79585 | BIP39 by hand with d8 or coins | "an 8-sided die (d8) can give us 3 uniform bits per toss" |
| SeedPicker (fetched) https://github.com/merland/seedpicker | 23 words chosen on paper, and the last word from a calculator | "The first 23 words must be randomly selected out of a predefined word list" ... "The final 24th word is calculated using a safe machine" |
| jimpudar/bip39_dice, 2020 (fetched) https://github.com/jimpudar/bip39_dice | Diceware-style mapping to N−1 words, plus coin bits for the last word | "we will generate the initial N-1 words ... and _then_ convert it back to the bytes that can be used to generate the checksum" |
| Diceware (Reinhold, 1995) (snippet) https://en.wikipedia.org/wiki/Diceware | The older dice → word-list idea | "a line for each of the 7,776 possible five-die combinations" |
| Privacy Guides, 2026-08 (snippet) https://discuss.privacyguides.net/t/how-to-securely-generate-a-random-bitcoin-seed/39825 | A published d6 worksheet | "generates a cryptocurrency seed phrase with only a 6-sided die" |

The re-check by an heir comes for free with any deterministic table, and ShowMyWork states it as its purpose.

### Part 2: two independent physical sources (dice and cards, possibly from two people), mixed by hand with XOR, so a single bad source cannot control the seed

**Verdict: partly done.** Each piece has prior art:

- **XOR used to combine entropy sources:** Glacier XORs dice with the computer's RNG.
- **XOR of BIP39 entropies done by hand:** Coldcard Seed XOR, including XORing existing seeds to make a new random wallet.
- **Commit-then-reveal multi-party mixing:** described in general terms.

I found **no published procedure that XORs two physical sources by hand to generate a seed**. All the XOR mixing I found is either done by software (Glacier) or presented as splitting a seed rather than generating one (Seed XOR).

| Source | Quote |
|---|---|
| Glacier Protocol `glacierscript.py` (fetched) https://github.com/GlacierProtocol/GlacierProtocol/blob/master/glacierscript.py | "An XOR of two pieces of data will be as random as the input with the most randomness. We can thus combine two entropy sources in this way as a safeguard against one source being compromised in some way." (code: `xor_hex_strings(dice_seed_hash, rng_seed_hash)`) |
| Coldcard `docs/seed-xor.md` (fetched) https://github.com/Coldcard/firmware/blob/master/docs/seed-xor.md | "Any two or more SEEDPLATES you have already encoded can be used together to make a new wallet based on their XOR." / "It is not hard to calculate a Seed XOR on paper" / "The checksum of each of the XOR-parts protects the final result, **assuming your XOR math is correct.**" / "It's not possible to calculate the checksum of the final seed phrase on paper (needs SHA256)." |
| Coldcard wordlist-paper (fetched) https://github.com/Coldcard/wordlist-paper | A hex XOR lookup table, a worksheet, and a word → hex list: "how to XOR two or more seed phrases together, using your hands... fully airgapped." |
| Hamming backups (Goucher, 2021) (snippet) https://cp4space.hatsya.com/2021/09/10/hamming-backups-a-2-of-3-variant-of-seedxor/ | 2-of-3 parity over Seed XOR, done with XOR only |
| LearnBitcoin "seed entropy mixer" (snippet) https://www.learnbitcoin.com/glossary/seed-entropy-mixer | Commit, then reveal, then XOR, with dice listed as an input: "Each participant generates their own entropy independently. Common methods: a hundred dice rolls ..."; "Without it, the last participant ... could ... adversarially pick their own to bias the result." |
| Trezor entropy check, Suite 25.2.2 (snippet) https://trezor.io/learn/security-privacy/how-trezor-keeps-you-safe/entropy-check-how-trezor-suite-verifies-wallet-generation | Host and device mixing with a commitment and a cut-and-choose audit: "the Trezor device commits to its own contribution"; "The device discards the candidates selected for checking, and Suite reconstructs them for verification." |
| seedroller (snippet) https://docs.rs/crate/seedroller/0.2.0 | Dice plus OS RNG, hashed together, so the result survives if one source fails |
| PCI DSS 3.6.6 split knowledge (snippet) https://kirkpatrickprice.com/video/pci-requirement-3-6-6-using-split-knowledge-dual-control/ | XOR key components held by different custodians, each with a check value. It is the banking equivalent of auditing the parts separately, but its KCVs need a computer. |

Searches that found **nothing**: a hand XOR of dice and card grids, a two-person physical dice ceremony with sealed-paper commitment, and higher/lower card-pair comparison used as a bit source for seeds.

### Part 3: a bias check on the sheet (tally boxes or a threshold test) before the words are trusted

**Verdict: done before**, both in software and as the standard by-hand chi-square test. I found no BIP39 *paper sheet* with a printed pass/fail threshold, but that is a small difference. The math here is old, so it cannot carry a novelty claim.

| Source | Quote |
|---|---|
| Bip39-Kit (fetched) | Chi-square with power tables: "A d6 reaches 'catches a defective die' in 141 rolls"; "checks whether consecutive rolls look dependent (which catches lazy rolling, not bad dice)"; "Running face counts are deliberately not shown while you collect." It also has an exact von Neumann option: "The output is *exactly* unbiased for any per-die bias", but "it gives up the by-hand lookup." |
| Krux docs (fetched) https://github.com/selfcustody/krux/blob/main/docs/getting-started/usage/generating-a-mnemonic.en.md | "A low Shannon's entropy value could suggest that your dice are biased"; "a warning will appear suggesting that you add more rolls" |
| seedroller (snippet) | "Skewed distributions are rejected even if all 6 values appear." |
| codex32 dice de-biasing worksheet (snippet) https://secretcodex32.com/docs/2022-09-26--color.pdf and the MIT Expo 2022 talk https://btctranscripts.com/mit-bitcoin-expo/mit-bitcoin-expo-2022/long-term-trust-and-analog-computers | A von Neumann extractor for dice done by hand: "provides a dice de-biasing worksheet to generate random values from dice rolls by hand"; "you basically roll a bunch of dice twice and you extract one bit." |
| Hand chi-square for dice (snippet) https://www.athenopolis.net/2016/11/testing-dice-for-fairness.html and https://1eonline.info/d/dice.chi-square.htm | The usual tabletop method with a tally sheet |
| Precision-dice debate (snippets) https://www.metzdowd.com/pipermail/cryptography/2014-August/022392.html , https://www.goonhammer.com/hammer-of-math-do-you-actually-need-precision-dice , https://1password.community/discussion/comment/107982 | "biases that might be important to a casino have little effect on using dice to generate random quantities for cryptography" |

**My own power check** (simulation: `sim/chi.py`). The hand statistic is S = Σ(count − N/6)², and the 5% threshold is S ≥ 1.845·N.

| Throws N | False alarm | Catches a face with double weight | Catches a face at +50% | Catches a face that never comes up |
|---|---|---|---|---|
| 60 | 5% | 41% | 14% | ~100% |
| 120 | 5% | 73% | 26% | ~100% |

So a hand check at seed-making volumes catches only **gross** defects. Be honest about this in the method. Protection against subtle bias has to come from mixing in a second source, not from the test.

### Part 4: the last word needs SHA-256, so two independent tools must agree

**Verdict: done before**, and widely recommended.

| Source | Quote |
|---|---|
| Glacier (snippet) https://vogelito.github.io/cryptoglacierdocs/docs/key-generation/generate-bip39-mnemonic | Two quarantined laptops; "The mnemonic shown should match on both computers" |
| Bip39-Kit (fetched) | "do them on an air-gapped machine, ideally twice on two different machines"; "feed the same 256 entropy bits to both `bip39.py` and Seed Tool and require identical words"; "check the wallet's first receive address matches what Seed Tool derived offline." |
| SeedSigner `docs/dice_verification.md` (fetched) https://github.com/SeedSigner/seedsigner/blob/dev/docs/dice_verification.md | "verify the seed generation code used in SeedSigner against other independent tools, to prove that they all generate the same results"; it checks fingerprint, zpub and addresses |
| Coldcard "Verifying Dice Roll Math" (snippet) https://coldcard.com/docs/verifying-dice-roll-math/ | "The seed value is calculated as SHA256 over the rolls, when expressed as an ASCII string." |
| Krux (fetched) | "SeedSigner or Coldcard ... share the same logic that Krux uses and will give the same mnemonic" |
| BIP-93 / codex32 (fetched) https://github.com/bitcoin/bips/blob/master/bip-0093.mediawiki | "it is effectively impossible to hand compute a BIP-0039 checksum" |
| Coldcard Seed XOR (fetched) | A hand check of the last word's *range* is also done before: "final word between: toward [730] - tree [73F]"; "But it must start with the indicated digit(s)." |

### The combination of parts 1–4

**Verdict: largely done.** Bip39-Kit alone covers parts 1, 3 and 4: printed dice → word tables, a chi-square test with power tables, two machines, and an address check. Glacier covers 2 (in software) and 4. Coldcard Seed XOR covers XOR by hand. The only element of the draft that I found **nowhere** is a second **physical** source mixed in **by hand**, and on its own that is a small step from Seed XOR and Glacier. **The draft as written is not original enough to call a new method.**

---

## 2. The real gaps found

1. **Nobody checks the hand XOR.** Coldcard explicitly assumes "your XOR math is correct" and offers no way to check it by hand. Every hand-mixing method I found has the same gap.
2. **Nobody audits the seed's origin without seeing the seed.** Every audit I found (ShowMyWork, Coldcard's dice math, SeedSigner verification, Bip39-Kit) means the checker re-derives the seed. Trezor's commit plus cut-and-choose avoids that, but it audits a device, not a person working on paper. PCI split knowledge audits separate components, but with computer KCVs.
3. **The word-lookup step has no hand-checkable transcription check.** BIP39's checksum needs SHA-256. Penlock adds per-word parity, but in a non-standard GF(29) encoding meant for splitting, not generation (snippet, https://groups.google.com/g/bitcoindev/c/8LkdxVc_nI0: "each BIP39 word is extended with two pre-computed parity symbols"). codex32 has hand checksums, but not for BIP39 (BIP-93: "impossible to recover compatible BIP-0039 words by hand").
4. **Bias resistance by hand has always cost the one-glance lookup.** Bip39-Kit says whitening "gives up the by-hand lookup". codex32's von Neumann sheet yields about 1 bit per 2 rolls.

The underlying principle for gaps 1 and 2 is known: linear checks commute with linear share operations. BIP-93: "Lagrange interpolation of valid codewords in a BCH code will always be a valid codeword. This means that derived shares will always have valid checksum." **No one has applied it to BIP39 generation from physical entropy.** That is where an honest novelty claim can sit.

---

## 3. Proposed "VOIDFORGE method" (v2)

Target: 12 words (128 bits) entirely by hand except the checksum, in about 35 minutes. A 24-word "long forge" uses the same steps and takes about 65–70 minutes.

### Materials (printed by VOIDFORGE)

- Sheet **D** (dice), sheet **C** (cards) and sheet **E** (result). Each is a grid of 12 rows by 11 bit columns; row 12 uses only its first 7 columns (128 bits).
- A numbered BIP39 list giving each word's number and 11-bit binary.
- The 6x6 "mirror table".
- A bias box on each sheet.

### Step 1: Dice sheet D, using the mirror table

- Roll one die twice (row, then column), or roll two identical dice in a cup and read them left to right.
- The 4 rejected cells are the doubles 1-1, 2-2, 3-3 and 4-4. These are easy to spot (the same choice as analog-seed-entropy).
- **Layout (new detail):** cells (a,b) and (b,a) share the first 4 bits and differ only in the last bit. The last bit is 1 if a < b; for the kept doubles, 5-5 gives 0 and 6-6 gives 1.
  - For fair dice, all 32 codes are equally likely, so it is exact.
  - If both readings come from the same (or an exchangeable) die, P(a,b) = P(b,a). The last bit is then the codex32/von Neumann order bit, exactly fair under any per-face bias except for the single 5-5/6-6 class. This is one bias-proof bit in every symbol while keeping one-glance lookup.
  - The other 4 bits are still sensitive to bias. Do not claim more than this.
- 26 accepted cells give 130 bits; use 128. That is about 29 pair-rolls on average.
- Record each raw pair beside its code so an auditor can redo the lookup.

### Step 2: Card sheet C, a second source that fails differently

- Shuffle a 52-card deck thoroughly. Deal it out in pairs. Write **1 if the second card ranks higher** (A low … K high; ties broken by suit ♣<♦<♥<♠).
- For a uniformly shuffled deck, the 26 pair-order bits are exactly independent and fair. This is elementary permutation math (only the order inside each disjoint pair matters). I found no seed tool that uses it: Ian Coleman's card mode maps card values instead, and analog-seed-entropy uses 3-card draws.
- A poor shuffle shows up at once as lopsided bits.
- 5 decks give 130 bits. The second source can instead be a second person's dice, as long as it is independent.

### Step 3: Bias boxes (gross-failure detectors, presented as no more than that)

**Dice:**
- Tally every throw, including rejected ones.
- Compute S = Σ(count − N/6)². Fail if S ≥ 1.85·N.
- Repeat check: the number of throws equal to the previous one should be about N/6. Fail if it is below N/12. This catches invented or lazy rolls (as in Bip39-Kit).

**Cards, per deck:**

| Check | Fail if | False alarm (simulated) |
|---|---|---|
| Number of 1s among the 26 bits | ≤ 5 or ≥ 21 | 0.25% |
| Same-suit neighbours | ≥ 20 (a fair shuffle averages ~12) | ~1% |

**On a fail:** re-roll or reshuffle that source. Never "fix" the bits.

### Step 4: Mix

E = D ⊕ C, cell by cell: if the two bits are the same write 0, if they differ write 1.

For independent sources, the min-entropy of E is at least the larger of the two sources' min-entropies. So one good source is enough. Simulation: a die with one face at double weight combined with a 60/40-biased card bit still gives 4.986 of 5 bits per symbol.

### Step 5: Forge marks (the core new element)

**Making the mark:**
- For each sheet, write the parity of each of the 11 columns. That gives an 11-bit **mark** M(·).
- Optionally add a second mark, G(·), computed over the odd rows only. G catches swaps of adjacent words, which M misses.

**The forge seal:** for every column, the parities of D, C and E must XOR to 0. Because the mark is GF(2)-linear, M(E) = M(D) ⊕ M(C). This checks the whole hand XOR in 11 comparisons, which closes the gap Coldcard leaves open.

**Lookup check:**
- After converting each E row to its word through the numbered list, recompute M from the *printed binaries of the chosen words*.
- It must equal M(E). This catches any single wrong-word lookup, with a 1/2047 miss rate for two random errors. G catches transpositions of adjacent words.

**Heir check:**
- Write M(E) (and G) beside the words on the backup.
- Later, anyone holding the backup can re-verify the 11 hand words with pencil and the list. Whoever holds the backup already holds the seed, so this costs nothing.
- Never store a mark apart from the words: each mark reveals 11 bits.

### Step 6: Last word and import

- Row 12 fixes the first 7 bits, so the 12th word must lie in a known block of 16 consecutive words. That much is checked by hand.
- The exact word comes from VOIDFORGE and one independent tool (SeedSigner, Coldcard, offline Ian Coleman, or Bip39-Kit). The two must agree.
- Then compare the fingerprint and the first address across both tools and the wallet.

### Step 7: Split-sheet audit (optional)

- If C is uniform, sheet D is statistically independent of E, and the same holds the other way round.
- Auditor 1 can re-check D in full (rolls → codes, bias box, M(D)). Auditor 2 can do the same for C. **Neither learns anything about the seed**, provided the two never pool their sheets and the source each did not see was good.
- The owner checks the seal. If a third party must also check the seal, they see M(E), which is 11 bits. That leaves 117 bits for a 12-word seed and 245 bits for a 24-word seed.

**Seed XOR compatibility:** with a tool, complete D and C with their own checksum words. They then form a valid **Coldcard Seed XOR 2-of-2 set for E**, because Seed XOR XORs the entropy and recomputes the checksum. That gives two more things:
- a third, independent verification path (import D and C into a Coldcard as Seed XOR and check that the fingerprint matches);
- an optional split backup, where the generation transcript is itself the backup. Store the two parts apart.

**Caveat:** if one source was weak, the other sheet is no longer zero-knowledge.

### Time budget (12 words)

| Task | Time |
|---|---|
| Dice (~29 pair-rolls plus tallies) | ~9 min |
| Cards (5 × shuffle and 26 comparisons) | ~13 min |
| XOR | ~2 min |
| Words | ~4 min |
| Marks and seal | ~4 min |
| Bias boxes | ~2 min |
| **Total** | **≈ 34–38 min** |

Coverage of the stated goals:
- ≥128 bits: yes.
- Exactly uniform for fair inputs: yes.
- Gross bias detected: yes.
- Everything hand-checkable except SHA-256: yes.
- Standard BIP39: yes.

### What could honestly be claimed (draft wording)

> "As far as we could find, the VOIDFORGE method is the first BIP39 generation procedure that (1) mixes two physical entropy sources of different kinds by hand, (2) verifies that mixing and the word lookup by hand with XOR-linear 'forge marks' (M(E) = M(D) ⊕ M(C)), and (3) lets each source's transcript be audited by a different person without revealing the seed, with the two transcripts forming a standard Seed XOR pair."

**Do not claim novelty for:**
- the 2d6 36 → 32 table (seed-cat, 2026);
- dice → bits → word sheets (ShowMyWork 2020, Blockstream, Bip39-Kit);
- XOR mixing (Glacier, Seed XOR);
- bias tests (Bip39-Kit, Krux, seedroller);
- von Neumann for dice (codex32);
- two-tool agreement (Glacier, SeedSigner, Bip39-Kit);
- the general principle that linear checks commute with share operations (codex32/BIP-93).

**Before publishing:**
- Re-check the blocked hosts listed in section 0, especially the Delving Bitcoin threads 2814 and 2822, the codex32 booklet's dice worksheet, the Penlock v1 docs and the Privacy Guides worksheet.
- Ask on Delving Bitcoin or bitcoindev whether XOR-linear marks for hand mixing have been described.
- Publish dated.
