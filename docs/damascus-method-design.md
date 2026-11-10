# The Damascus method: design notes

Date: 2026-11-10. This file holds the math, the simulations and the numbers behind every claim in [damascus-method.md](damascus-method.md). The prior-art research is in section 10 below. Every number here can be reproduced with the scripts listed in section 9.

**Status:** these are design notes, not a review. Nobody has timed the method with real people yet, and no third party has reviewed it.

---

## 0. The final design in one screen

| Part | Choice |
|---|---|
| Source H (Hammer) | One pair of matching six-sided dice (or one die thrown twice), read with the **mirror 6x6 table**. 32 kept cells give 5 bits each; the doubles 1-1, 2-2, 3-3, 4-4 mean "throw again". 26 accepted pairs give 128 bits (24 words: 52 pairs, 256 bits). |
| Source A (Anvil) | Standard 52-card decks, each shuffled with a 30-second wash, 12 riffles and a cut, then read as a **knockout**: 8 cards dealt face up play 7 matches, giving 7 bits. A deck gives 6 octets plus 1 quad = 45 bits. A 12-word seed needs 3 deals (2 × 45 + 38). A 24-word seed needs 6 deals (5 × 45 + 31). |
| Mixing | F = H ⊕ A, cell by cell, in a 12 × 11 grid (24 × 11 for 24 words). The last row is partial: 7 cells for 12 words, 3 for 24. |
| Hallmarks | Each grid gets a **column hallmark M** (11 parity bits) and a **row hallmark R** (one parity bit per row). The optional **skew hallmark K** (11 bits) is the parity of the cells under each printed letter a–k, where cell (r, c) carries letter (r + c − 2) mod 11. All three marks are GF(2)-linear. |
| Seal | M(H) ⊕ M(A) = M(F) and R(H) ⊕ R(A) = R(F). This checks the hand XOR without redoing it. |
| Words | Each grid row is read as 3-4-4 bits (block, row, column) in the printed binary word table, so no arithmetic is needed. Each word is then checked in reverse: find it alphabetically and read its bits back from the table's headings. |
| Last word | The last 7 bits (12 words) or 3 bits (24 words) fix a range by hand: one table row of 16 words, or one block of 256. Two independent tools compute the word, and both must agree and land in that range. Then the fingerprint and the first address are compared. |
| Bias boxes | Dice: face tally and repeat count over the first 26 (or 52) pairs. Cards: a count of 1s and a "neighbor" count per deck. These catch gross defects only. |
| Assay | The Hammer sheet and the Anvil sheet can each be assayed by a different person. Each sheet, given its own checksum word, is a valid BIP39 phrase, and the two phrases form a Coldcard Seed XOR pair for F. |

---

## 1. Time, and the "one source is hostile" requirement (problem 1)

### 1.1 Requirement

If one source may be fully controlled by an attacker, the other source must deliver 128 bits (or 256 bits) of full entropy **on its own**. So both sources must each produce the full bit count, and the attacker's source must be fixed before the honest one is seen. Commit order matters: see 5.3 and worked example 2.

### 1.2 Options weighed (128 bits from one source)

The per-action costs are estimates, not measurements (see 1.4).

| Source | Bits per unit | Units for 128 bits | Hand time | Fails by | Verdict |
|---|---|---|---|---|---|
| d6 pairs, mirror table | 5 per kept pair (4.44 per pair thrown) | 29.25 pairs on average (95% ≤ 33, 99% ≤ 35; simulated) | ~7 min | bad dice (the equipment) | **chosen for H** |
| d8 | 3 per roll | 43 rolls | ~5 min | bad d8; d8s are less common, and precision d8s are rare | variant for H |
| d16 | 4 per roll | 32 rolls | ~4 min | hard to find, often poorly balanced | not recommended |
| coins | 1 per flip | 128 flips | ~11 min | flipping technique (same-side bias); boring, so people get sloppy | no |
| cards, pair order (26 bits per deck) | 26 per shuffle | 5 shuffles | ~14.5 min | the shuffle (the process) | slower |
| **cards, knockout octets (45 bits per deck)** | 45 per shuffle | 3 shuffles | **~11.5 min** | the shuffle (the process) | **chosen for A** |
| second dice set by a second person | 5 per pair | 29 pairs | ~7 min | dice again | weaker diversity: the same failure mode twice |

**Why dice plus cards.** Dice fail through the **equipment**: a loaded or badly made die is biased no matter how you throw it. Cards fail through the **process**: card bits depend only on the relative order of the cards, so any 52 distinct cards work, and only the shuffle matters. A seller can sell you loaded dice, but cannot sell you a "loaded shuffle". The two sources fail in unrelated ways, so mixing them protects against each one's typical failure.

**Why the knockout.** It needs 3 shuffles instead of 5, and dealing 8 cards per group means fewer gathers. The number of comparisons per bit is the same (one). For a 12-word seed the saving is about 3 minutes, about 20%. Tournaments with 16 or 32 cards give 48–49 bits per deck instead of 45 and still need 3 decks, so they are not worth the extra bookkeeping.

### 1.3 The knockout is exactly fair (proof sketch; exhaustive check in 2.3)

**Lemma.** Take a uniformly random ordering of 2m distinct cards, split into a left half L and a right half R of m cards each. Three things are mutually independent:

- the relative order inside L, which is uniform;
- the relative order inside R, which is uniform;
- the set of ranks that falls into L, which is a uniform m-subset.

The event "the maximum of L ∪ R lies in R" depends only on that subset, and it has probability m / 2m = 1/2.

**Induction.** In a balanced bracket of 2^k cards (8 or 4 here), every match is one such event about the subtree below it, and it is independent of all matches inside the two halves. So all 2^k − 1 match bits are independent and fair.

**Across groups.** Disjoint groups of positions in a uniformly shuffled deck have independent, uniform relative orders. So the 45 bits of a deck are independent and fair. Different decks are shuffled separately, so they are independent too.

**Ties are impossible** because the order is total: rank first (A low … K high), then suit, with clubs < diamonds < hearts < spades.

### 1.4 Time model

The per-action costs below are estimates. **None of this has been timed with real people (UNVERIFIED).**

| Action | Seconds |
|---|---|
| Throw two dice and read them | 3 |
| Write two numbers | 2 |
| Find the cell in the mirror table | 4 |
| Write 5 bits | 5 |
| **Dice pair, total** | **14 s per pair** |
| Wash a deck | 30 |
| One riffle (split, riffle, square) | 4.5 |
| **Shuffle, total (wash + 12 riffles + cut)** | **≈ 85 s per deck** |
| Deal one card face up | 0.75 |
| Compare two cards and write the bit | 1.5 |
| Extra time to find the winners in rounds 2–3 | 0.5 per match |
| Gather a group | 3 |
| Look at one adjacency for the neighbor count | 0.3 |
| **Octet, total** | **≈ 21–25 s** |
| Write one card for card record | 2 |
| XOR | 1.1 s per cell |
| Parity of one row or column | 3–4 s |
| Look up one word in the 3-4-4 table | 15 |
| Reverse-check one word | 10 |
| Two tools, the last word, fingerprint and address | 4 min |

**12 words, one person:**

| Step | Time |
|---|---|
| Setup | 1 |
| H1 dice | 7 |
| H2 bias | 1 |
| H3 marks | 1.5 |
| A1 3 shuffles | 4.25 |
| A2 + A3 deal, play and count | 7.25 |
| A4 marks | 1.5 |
| F1 XOR | 2.5 |
| F2 seal | 2 |
| F3 words | 3 |
| F4 word check | 2 |
| F5 last word and identity | 4 |
| **Total to checked words** | **≈ 37 min** |
| F6 backup copy | +2 → **≈ 39 min** |
| Card record (write down all 148 cards) | +4.5 → ≈ 43.5 min |
| **Two people** (H and A in parallel) | **≈ 31 min wall-clock** |

**24 words, one person:**

| Step | Time |
|---|---|
| Setup | 1 |
| Dice (58.5 pairs on average) | 13.7 |
| Dice bias | 1.5 |
| H marks | 3 |
| 6 shuffles | 8.5 |
| 34 octets and 6 quads | 14.3 |
| A marks | 3 |
| XOR | 5 |
| Seal | 3.5 |
| Words | 6 |
| Word check | 4 |
| Last word | 4 |
| Backup | 3.5 |
| **Total** | **≈ 71 min** |
| Two people | ≈ 53 min wall-clock |
| Card record | +9 min |

So the target of 12 words in 40 minutes or less is met by one person, without card record, under these estimates, with a margin of about 1 minute. It is met comfortably by two people. A 95th-percentile dice run (33 pairs) adds about 1 minute.

---

## 2. Unbiasedness (problem 2)

All results are from `sim/unbias.js` with 10^6 trials. The output is in `sim/results-unbias.txt`.

### 2.1 Mirror table, exact

- There are 36 cells: 32 are kept, and 4 are rejected (1-1, 2-2, 3-3, 4-4).
- The 32 kept cells carry 32 distinct 5-bit codes, each exactly once. For a fair die every cell has probability 1/36, so each code has probability exactly **1/32** given that the pair is kept.
- **Layout.** The unordered pair {a, b} with a < b sets the 4-bit prefix. These 15 classes are numbered in reading order (1,2), (1,3), …, (5,6). Class 15 is {5-5, 6-6}.
- **The 5th bit** is 1 when the second throw is higher; for class 15 it is 0 for 5-5 and 1 for 6-6.
- The mirror property was checked for all 15 pairs: (a,b) and (b,a) share their prefix and differ only in the 5th bit.

**Monte Carlo, 10^6 complete 12-word H sheets (26 × 10^6 symbols):**

| Check | Result |
|---|---|
| Code frequencies | χ²(31) = 31.8, p = 0.43 |
| Largest per-position bit deviation | 1.25 × 10⁻³, max z = 2.5 over 128 positions |
| Pairs thrown per sheet | mean 29.25 (theory 29.25); 95th pct 33; 99th pct 35; max 43 |

### 2.2 What the mirror bit guarantees for biased dice

If both readings in a pair come from the same die, or are otherwise exchangeable, then P(a,b) = p_a·p_b = P(b,a). So **in classes 0–14 the 5th bit is exactly fair for any bias**, and it is independent of the other 4 bits. In class 15, P(1) = p₆² / (p₅² + p₆²), which is biased. The other 4 bits follow the die's bias.

**Counter-example:** if the first throw always comes from a die with 6 at double weight and the second from a fair die, the 5th bit is biased by up to 0.167. So the sheet says "two dice from the same set, read left first", and design note 8 lists exchangeability as an assumption.

Entropy of one Hammer sheet (26 symbols) for one biased die, computed exactly:

| Die | Shannon entropy | Min-entropy |
|---|---|---|
| Fair | 130.0 | 130.0 |
| Precision die, one face +2% | 130.0 | 128.8 |
| ±10% (drilled pips) | 129.9 | 126.2 |
| One face +50% | 128.9 | 106.3 |
| One face at double weight | 126.6 | 90.8 |
| Loaded die, p₆ = 0.25 | 128.3 | 100.5 |
| Dead face | 114.2 | 114.2 |

So H alone gives full entropy only for good dice. **That is exactly why A is there.**

Like codex32's von Neumann sheet, the mirror trick guarantees only part of the output (one bit per symbol, outside class 15). It is a partial de-bias that keeps the one-glance lookup. It does **not** make a biased die safe.

### 2.3 Card knockout, exact and Monte Carlo

**Exhaustive check:**
- All 8! = 40,320 orders of 8 distinct cards give each of the 128 seven-bit patterns **exactly 315 times**.
- All 4! orders of 4 cards give each 3-bit pattern exactly 3 times.

**Monte Carlo, 10^6 uniformly shuffled decks (45 bits each):**

| Check | Result |
|---|---|
| Per-bit frequency | max |dev| = 1.7 × 10⁻³ (max z = 3.36 over 45 bits; P ≈ 3.5% for the largest of 45) |
| Each octet's pattern | χ²(127): p = 0.32, 0.39, 0.95, 0.33, 0.91, 0.36 |
| Quad | p = 0.21 |
| Joint octet 1 × octet 2 | χ²(16383) = 16598, p = 0.12 |
| Joint octet 6 × quad | p = 0.18 |
| Largest covariance over 990 bit pairs | 8 × 10⁻⁴ |

### 2.4 XOR with a hostile source

If H is uniform and independent of A, then F = H ⊕ A is uniform whatever A is (the one-time-pad argument). The same holds with H and A swapped.

Monte Carlo, 10^6 trials each, with fair dice and A set to all zeros, to 1010…, or to iid bits that are 90% ones:

- per-bit deviation ≤ 1.5 × 10⁻³;
- word-1 index χ²(2047): p = 0.35, 0.02 and 0.60. The 0.02 is one of many tests; the exact argument above is the proof.

### 2.5 How good must the shuffle be? (the card source's real assumption)

Under the Gilbert–Shannon–Reeds riffle model, starting from an order the attacker knows, a permutation with r rising sequences after k riffles has probability C(2^k + 52 − r, 52) / 2^(52k), following Bayer & Diaconis. The identity permutation (r = 1) is the most likely, which gives the deck's min-entropy.

Every 45-bit output of the knockout has exactly 52!/2^45 preimages. So **min-entropy(output) ≥ 45 − (log₂52! − min-entropy(deck))**. This is rigorous within the model.

| Riffles per deck | Deck min-entropy (of 225.6) | Proven min-entropy of the 12-word card sheet (of 128) | Same, 24 words (of 256) |
|---|---|---|---|
| 3 | 127.7 | 0 | 0 |
| 5 | 184.3 | 7.5 | 18.8 |
| 7 | 212.3 | 88.2 | 176.4 |
| 8 | 218.6 | 107.0 | 213.9 |
| 10 | 223.7 | 122.5 | 245.0 |
| **12** | **225.1** | **126.6** | **253.2** |
| 14 | 225.5 | 127.7 | 255.3 |

These are worst-case lower bounds. They ignore the wash and the cut, and the true value is surely higher. They are still why the method asks for **12 riffles plus a 30-second wash**, not the usual 7 riffles.

Two caveats, both UNVERIFIED:
- Real human riffles are neater than the GSR model, which makes them less random.
- Washing ("smooshing") for about a minute is reported to randomize well, but I know that only from memory of Diaconis's work. I have not checked a source.

### 2.6 Bias boxes: detection power (`sim/bias.js`; results in `sim/results-bias.txt`)

**Dice, 12 words.** The tally covers the first 26 pairs = 52 throws, rejected pairs included. A sheet fails if any face count is ≥ 18 or ≤ 1, or if there are ≤ 2 repeats (expected 8.5). There are 200,000 trials per model, and 10^6 for the false-alarm table.

| Die or behavior | Sheet fails |
|---|---|
| Fair die (false alarm) | 1.9% |
| One face +50% | 5.5% |
| One face at double weight | 21.9% |
| Loaded die, p₆ = 0.25 | 9.2% |
| Dead face | 100% |
| Two dead faces | 100% |
| Invented numbers that never repeat | 100% |
| Invented numbers that repeat half as often as they should | 19.3% |
| Lazy throws (40% of throws keep the previous face) | 22.1% |

**Dice, 24 words.** The tally covers 104 throws. A sheet fails if a face count is ≥ 29 or ≤ 6, or if there are ≤ 7 repeats.

| Die or behavior | Sheet fails |
|---|---|
| Fair die | 2.4% |
| One face +50% | 16.1% |
| Double weight | 60.3% |
| p₆ = 0.25 | 29.2% |
| Dead face | 100% |
| Never repeats | 100% |
| Repeats half as often | 37.0% |
| Lazy throws | 27.1% |

**Cards, per deck** (45 bits, 45 neighbor checks inside groups). A deck fails if it has ≤ 11 or ≥ 34 ones, or ≥ 6 neighbors. Under an ideal shuffle the false-alarm rate is 0.61% per deck, about 1.8% for at least one of 3 decks. Starting from a new deck in Bicycle order:

| Shuffle | Deck fails |
|---|---|
| Cut only | 100% |
| 1 riffle | 100% |
| 2 riffles | 97% |
| 3 riffles | 43.9% |
| 4 riffles | 6.5% |
| 5 riffles | 1.4% |
| 10 overhand shuffles | 68.7% |
| 30 overhand shuffles | 1.0% |

The count of 1s almost never fires on these models. It is kept because it catches a deck sorted in the method's own card order (where every match gives 1) and someone writing the same bit by habit.

**Honest wording, used on the sheets:** *"detects gross defects only."*
- A die that is 50% heavy on one face passes about 19 times in 20 (12 words).
- A deck from an unknown or stacked start order with a few riffles passes the neighbor test.
- Protection against subtle bias comes from mixing two sources, never from these boxes.

---

## 3. Hallmarks (problem 3)

### 3.1 Exact specification

**Bit layout:** cell i (1 … 128, or 256) sits at row ⌈i/11⌉, column ((i − 1) mod 11) + 1. Rows 1–11 (or 1–23) are full words. Row 12 has 7 cells (row 24 has 3); its 4 (or 8) checksum bits are not part of any grid.

| Mark | Definition | Bits |
|---|---|---|
| **Column hallmark M** | M_c = XOR of all cells in column c, for c = 1…11 | 11 |
| **Row hallmark R** | R_r = XOR of all cells in row r | 12 (24) |
| **Skew hallmark K** (optional) | K_ℓ = XOR of the cells with letter ℓ, where cell (r, c) gets letter `abcdefghijk`[(r + c − 2) mod 11]. Row 1 reads a…k, and each later row shifts one letter left. The letters are printed in grid F. | 11 |

All three are GF(2)-linear maps. So for any sheets, **mark(H ⊕ A) = mark(H) ⊕ mark(A)**. This was tested on 6,000 random forges with zero failures, and it holds by construction.

### 3.2 What each set of marks catches

Results from `sim/marks.js`: 10^6 trials per error class, plus exact enumeration where shown. Each error is the difference between the true grid and the written grid. Every number is the percentage of real (non-null) errors caught.

**12 words:**

| Error | M alone | M + R (default) | M + odd-row parity | M + K | **M + R + K** |
|---|---|---|---|---|---|
| One bit (miscopy or wrong XOR cell) | 100 | 100 | 100 | 100 | 100 |
| Two random bits (exact, 8,128 pairs) | 91.61 | **100** | 96.19 | 99.91 | 100 |
| Three random bits | 100 | 100 | 100 | 100 | 100 |
| Four random bits | 97.97 | 99.97 | 99.57 | 99.96 | 100 |
| Two bits in one word | 100 | 100 | 100 | 100 | 100 |
| Wrong word (random) | 100 | 100 | 100 | 100 | 100 |
| Neighboring line in the list (±1) | 100 | 100 | 100 | 100 | 100 |
| Two adjacent bits transposed | 100 | 100 | 100 | 100 | 100 |
| XOR row slip (F row i made with A row i+1) | 100 (1 − 1/2048) | 100 | 100 | 100 | 100 |
| A word left out, later words move up | 99.96 | 99.995 | 100 | 100 | 100 |
| **Adjacent words swapped** | **0** | **50.0** | 100 | 99.95 | **100** |
| **Any two words swapped** (exact) | **0** | **50.0** | 54.5 | 99.95 | **100** |

**24 words:**

| Error | M alone | M + R | M + K | M + R + K |
|---|---|---|---|---|
| Two random bits (exact, 32,640 pairs) | 91.26 | 100 | 99.54 | 100 |
| Four random bits | 97.83 | 99.99 | 99.96 | 100 |
| Adjacent swap | 0 | 50.0 | 99.95 | 100 |
| Any swap (exact) | 0 | 50.0 | 94.8 | 97.4 |
| All other classes | as for 12 words, ≥ 99.95 | | | |

### 3.3 Reading the numbers, and the choice

- **Plain column parity misses too much.** It misses 8.4% of two-bit errors and every swap. That is why the method adds the **row hallmark R**: an ordinary 2D parity that is hand-friendly, because you count the 1s in each row anyway while reading the word. M + R catches every 1-, 2- and 3-bit error and every single wrong word; it misses only "rectangles" of 4 or more bits (0.03%). It is the **default seal**.
- **Swaps** are the one thing 2D parity is weak on (50%). They happen when words are copied to the backup, so the **optional skew hallmark K** is aimed at the heir check. With M + R + K, a 12-word backup catches 100% of swaps of different words.
  - Why 100%: K misses a swap only when the two words are bit-complements, or are 11 rows apart. R always catches the complement case, because 11 is odd. No pair of full rows in a 12-word grid is 11 apart.
  - For 24 words, swaps between rows 11 apart (for example rows 1 and 12) can only be caught by R. That gives 97.4% overall. No 11-letter pattern can reach 100% for 23 rows. Catching every swap would need every two rows' letter patterns to differ in every column. That is a Latin rectangle, which has at most 11 rows. Some other pattern might score a little above 97.4%; we did not search for one.
- **At generation**, the word check (F4) compares each word's read-back bits with its grid row directly, which catches 100%. The marks are what lets the **XOR** be checked without redoing it, and what lets an **heir** check the backup later.
- **Marks catch mistakes, not cheating.** They are short and linear, not a commitment. Someone who wants to fake a sheet can make the marks match. Example 2 shows a cheating card sheet that passes every check.
- **Leakage.** Each mark is a function of the secret. M + R reveal 23 bits of a 12-word seed (35 bits for 24 words); K adds 11. Store marks only next to the words. An assayer who sees only M(H) or only M(A) learns nothing about F (5.2). Anyone who sees both learns M(F).

### 3.4 Heir check, by hand

The heir needs the backup words and their marks, a blank grid F and the binary word table.

1. Look up each word alphabetically and write its 11 bits into the grid. For the last word, only its first 7 bits (or 3) go in.
2. Compute M and R (and K) and compare them with the marks on the backup.
3. A single wrong bit can be located exactly: the bad row is the one whose R differs, and the bad column is the one whose M differs. A wrong word shows up as one bad row.

---

## 4. The last word (problem 4)

**By hand:**
- **12 words.** Row 12 holds 7 bits b₁…b₇. Bits 1–3 pick the block and bits 4–7 pick the row of the binary word table. The last word is one of the 16 words in that row, numbers 16p + 1 … 16p + 16 (1-based), where p is the 7-bit value.
- **24 words.** Row 24 holds 3 bits, which pick one block of 256 words.
- Coldcard's Seed XOR document prints the same kind of range ("final word between: toward [730] - tree [73F]").

**Two independent tools must give the same word, and it must lie in the hand range:**

**Tool A: VOIDFORGE, MAKE A SEED → Word draw.**
1. Type words 1–11 (or 1–23); the first four letters of each are enough.
2. Type the 7 (or 3) grid bits in the flips box as 1s and 0s.

VOIDFORGE computes the last word with the standard checksum and shows the fingerprint and addresses. This is checked in the VOIDFORGE source in `vf-bundle/next/voidforge.html`: `wdNeeds()` asks for 11 words and 7 flips for 12 words, and the flips box keeps only the characters 0 and 1.

**Tool B: SeedSigner, Tools → Calc 12th/24th word.**
1. Choose 12 (or 24) words and enter words 1–11 (or 1–23).
2. On the Build Final Word screen choose "Coin flip entropy" and enter the 7 (or 3) bits, with **Heads = 1, Tails = 0**.
3. The Final Word Calc screen shows the final word and its checksum bits; Next shows the 12th Word (or 24th Word) screen with the fingerprint.
4. For the first address: Load seed → Done → Address explorer → Native Segwit → Receive addresses, address 0.

This was checked in SeedSigner's source (`views/tools_views.py`, `gui/screens/tools_screens.py`) and on VOIDFORGE's practice signer, a port of SeedSigner 0.8.7, driven key by key in `tests/vfmethod.test.mjs`; not on a real device. SeedSigner pads the flips with zeros and then recomputes the checksum, so the result is the correct word for these bits. "Word selection entropy" also works if you pick the first word of the hand range.

**Alternative tool: Ian Coleman's bip39 page, offline.**
1. Tick "Show entropy details" and paste the 128 (or 256) bits of grid F as binary.
2. Keep "Mnemonic Length: Use Raw Entropy (3 words per 32 bits)". This is the default in the source. Any other length makes the page **SHA-256-hash the entropy**: `src/js/index.js`, "Use entropy hash if not using raw entropy", fetched from GitHub.
3. All 12 (or 24) words must match.

The UI steps were not run in a browser: UNVERIFIED.

**Coldcard:** Coldcard can import 11 words plus a chosen last word. How its screens show the candidate last words for 12 words was not checked: UNVERIFIED.

**Identity cross-check:**
1. Write the master fingerprint from tool A, tool B and the real wallet device.
2. Write the first and last 6 characters of the first receive address, BIP84 path m/84'/0'/0'/0/0, from tool A and from the wallet.
3. All of them must agree.

The reference code prints both values. The fingerprint code is checked against BIP84's vector (abandon … about → `73c5da0a`, `bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu`) and against an independent path that uses Node's PBKDF2, HMAC-SHA512 and RIPEMD-160 with noble secp256k1.

---

## 5. Assay and Seed XOR (problem 5)

### 5.1 Each sheet is a standard phrase

The 128 (or 256) bits of grid H read as words 1–11 (or 1–23) plus the first bits of the last word. A tool adds H's own checksum, so H becomes a valid BIP39 phrase. The same holds for A.

Coldcard Seed XOR XORs the parts' entropy (checksums excluded) and recomputes the checksum of the result (Coldcard `docs/seed-xor.md`, fetched). So **{phrase H, phrase A} is a 2-of-2 Seed XOR set for F**.

**Tests (ref/test.js), all passing:**
- On 3,000 random 12-word forges and 3,000 random 24-word forges, `@scure/bip39` confirms that H and A are valid phrases, that entropy(H) ⊕ entropy(A) = entropy(F), and that Seed-XOR-combining the two phrases gives exactly phrase F.
- M, R and K satisfy mark(F) = mark(H) ⊕ mark(A) on every trial.
- The same Seed XOR code reproduces both worked examples in Coldcard's documentation (12 words: "… real **trade**"; 24 words: "… primary **indoor**"). So the semantics match Coldcard's.

### 5.2 Why an assayer learns nothing about F

If A is uniform and independent of H, then F = H ⊕ A is independent of H. That is the one-time-pad argument again. So the assayer of the Hammer sheet, who sees H's pairs, bits, bias box, M(H) and R(H), learns **zero** bits about F. The same holds for the assayer of A, with the roles swapped.

What each assayer checks:

| Assayer | Re-checks | Signs off |
|---|---|---|
| H | Every pair in the mirror table, the runs in the grid, the bias box, R(H) and M(H) | M(H), R(H) |
| A | Every match from the card record, the bias box, R(A) and M(A) | M(A), R(A) |
| Owner | The seal | — |

The owner checks the seal using the two signed mark sets. This ties the assayed sheets to the seed in the sense that any honest XOR mistake would show. It does **not** make them a cryptographic binding (3.3).

### 5.3 Conditions and caveats

- **Commit order.** The sheet finished second must not see the first. Each person fills and folds their sheet in private, and both are handed over before either is revealed. Worked example 2 shows what happens otherwise: the card sheet was chosen after seeing the dice, and the seed became a published test vector, with every check passing.
- **A weak source breaks the zero-knowledge claim.** If A was weak (for example, a bad shuffle), the H assayer does learn something about F, and the other way round.
- **Collusion.** If the two assayers pool their sheets, they have the seed. If they only share marks, they learn M(F) and R(F): 23 bits.
- **Checksum tools.** Computing H's checksum word on a device shows H to that device. That is fine only if A never goes to the same device.
- **What the assay does not prove.** It does not prove that the dice and cards were really used. It proves only that the written transcript is self-consistent.

---

## 6. Reference implementation and tests (problem 6)

**In this repository:** the reference library is kept as `tests/fixtures/damascus/vf.js` (a copy of `ref/vf.js`), with the worked examples' inputs next to it. The page's own port is MAKE A SEED, the Damascus tab; `tests/vfmethod.test.mjs` checks it against the reference library and `@scure/bip39` / `@scure/bip32`, and drives the practice signer (a port of SeedSigner 0.8.7). The other `ref/` and `sim/` files named in this section and in section 9 live in the method's working folder, not in this repository; their results are quoted from that folder.

| File | Content |
|---|---|
| `ref/vf.js` | Library: mirror table, dice → bits, card knockout, deck plan, grids, marks M/R/K, hand words and range, own SHA-256 checksum, bias boxes, fingerprint and address, `forge()`. |
| `ref/forge.js` | CLI. Usage: `node ref/forge.js input.json [--md out.md] [--json out.json]`. Input: `{"words":12, "dice":"14 15 26 …", "cards":["9D 3S AC …", …]}` with dice pairs in throw order, "again" pairs included. |
| `ref/transcript.js` | Renders a forge as a paper-style transcript. |
| `ref/test.js` | The test suite. Last run: **211,473 checks, 0 failures**, saved in `ref/results/test-results.txt`. |
| `ref/make-examples.js` | Builds the 3 worked examples. |
| `ref/build-sheet.js`, `ref/render.js` | Build and render the sheets. `ref/results/render-results.txt` confirms every page fits on Letter and on A4, page counts are 3, 7 and 4, and no word cell is clipped. |

What `ref/test.js` checks:
- **BIP39 vectors:** the 8 official vectors (00…, 7f…, 80…, ff…, at 128 and 256 bits), with both its own checksum code and `@scure/bip39`.
- **BIP84 vector:** the fingerprint and first address.
- **Coldcard examples:** the documented 12- and 24-word Seed XOR examples.
- **Independent re-implementations:** the mirror table rebuilt from its verbal rule; the knockout recomputed as "which half holds the maximum" on 20,000 octets and 20,000 quads; the deck plans.
- **6,000 random end-to-end forges:**
  - F = H ⊕ A;
  - phrases match `@scure/bip39`;
  - H and A are valid phrases, and their Seed XOR equals F;
  - marks are linear;
  - the hand words equal the tool words;
  - the last word lies inside the hand range and starts with the sheet bits;
  - the fingerprint matches `@scure/bip32` and the independent path (on every 10th trial).
- **Mutation tests:**

  | Mutation | 12 words | 24 words |
  |---|---|---|
  | One cell flipped, caught by M + R | 1000/1000 | 1000/1000 |
  | One word replaced, caught by M | 1000/1000 | 1000/1000 |
  | Two words swapped, caught by M + R | 487/1000 | 504/1000 |
  | Two words swapped, caught by M + R + K | 1000/1000 | 977/1000 |

- **The printed sheets:** all 36 mirror cells and 128 skew letters in `forge-sheet.html`, and all 2,048 words in `bip39-binary-table.html`, are parsed and compared with the code.

**Worked examples** ([damascus-examples.md](damascus-examples.md); inputs in `tests/fixtures/damascus/`). All are public and must never hold funds.

| # | Seed | Dice | Cards | Result |
|---|---|---|---|---|
| 1 | 12 words | Digits of π (1–6 kept, read in pairs) | Published SHA-256 shuffle | "kick confirm home … sword", fingerprint `70b5da37` |
| 2 | 12 words | Digits of e | Chosen after seeing H, so F = 7f7f…7f | The official vector "legal winner thank year wave sausage worth useful legal winner thank yellow", fingerprint `b8688df1`. It teaches commit order. |
| 3 | 24 words | Digits of √2 | Published shuffle, 6 decks | "candy play giraffe … artist", fingerprint `116ab0ba` |

---

## 7. Prior art (no novelty claim)

This page makes **no claim that the method is new**. The owner has asked developers publicly whether the combination below was described before; any claim waits for their answers. The prior-art search (2026-11-10) is summarized in section 10.

What the method does, as a combination: it (1) mixes two physical sources of different kinds by hand; (2) checks that hand mixing, and later the backed-up words, by hand with linear hallmarks (M(F) = M(H) ⊕ M(A), R likewise); and (3) lets each source's sheet be assayed by a different person without revealing the seed, the two sheets also forming a standard Coldcard Seed XOR pair.

Each ingredient has prior art:

| Element | Prior art |
|---|---|
| The 2d6 36 → 32 table | seed-cat/analog-seed-entropy |
| Sheets that turn dice into bits and then words | ShowMyWork, Blockstream, Bip39-Kit |
| XOR mixing | Glacier, Seed XOR |
| Bias tests | Bip39-Kit, Krux |
| Von Neumann-style dice de-biasing | codex32 |
| Agreement between two tools | Glacier, SeedSigner, Bip39-Kit |
| Linear checks that commute with share arithmetic, in general | BIP-93 / codex32 |
| 2D parity | textbook |

The **mirror layout** and the **card knockout** are small details; each is an obvious step.

---

## 8. Claims still marked UNVERIFIED

1. **Prior-art sources seen only as search snippets.** These hosts were blocked in this sandbox, so the quotes may be inaccurate or out of date:
   - Delving Bitcoin threads 2814 and 2822;
   - the codex32 booklet's dice worksheet and its MIT Expo 2022 transcript;
   - Penlock (groups.google.com);
   - the Privacy Guides worksheet;
   - Blockstream's d6 guide;
   - Rudefox ShowMyWork;
   - the Trezor entropy check;
   - learnbitcoin "seed entropy mixer";
   - Hamming backups (Goucher);
   - atoponce's gist;
   - seedroller;
   - the PCI DSS split-knowledge page;
   - the Ian Coleman issue 435 text;
   - Coldcard's "Verifying Dice Roll Math" page.
2. **Whether the combination was described before.** A negative search is not proof; the owner has asked developers publicly.
3. **All step times** are estimates from assumed per-action costs (1.4). No person has done the method with a stopwatch yet.
4. **Real shuffles versus the GSR model**, and the claim that washing for 30–60 seconds randomizes a deck (Diaconis; from memory, source not checked).
5. **Exchangeability of two dice read left-first** from a cup throw. It is assumed, not measured. The safe choice is one die thrown twice.
6. **Tool UI details that were not run:**
   - SeedSigner's menu path: read in the code and run on the practice signer (a port of SeedSigner 0.8.7), but not on a real device;
   - Ian Coleman's binary entropy auto-detection;
   - Coldcard's Seed XOR import screens, and how it lists candidate last words for 12 words;
   - VOIDFORGE Word draw's behavior: read in the code and README, not clicked through for this note. (Check my sheets on the Damascus tab is tested in `tests/vfmethod.test.mjs`.)
7. **Coldcard Seed XOR support for 12-word parts** comes from `docs/seed-xor.md` on GitHub ("One 12-, 18-, or 24-word seed phrase becomes two or more parts"). It was not tested on a device.
8. **The BIP84 address and fingerprint vector**, and the 8 BIP39 vectors, were written from memory of the published vectors. They agree with `@scure/bip39` and `@scure/bip32`, so a shared mistake is unlikely but not ruled out.

---

## 9. How to reproduce

In this repository: `node tests/vfmethod.test.mjs`. In the method's working folder:

```sh
cd vfmethod            # node_modules is a symlink to vf-bundle/next/node_modules
node sim/unbias.js 1000000     # -> sim/results-unbias.txt   (about 1 min)
node sim/bias.js 1000000       # -> sim/results-bias.txt     (about 3 min)
node sim/marks.js 1000000      # stdout -> sim/results-marks.txt (about 4 min)
node ref/test.js 3000          # -> ref/results/test-results.txt
node ref/make-examples.js      # -> ref/examples/
node ref/build-sheet.js && node ref/render.js   # sheets, PDFs (Letter + A4), PNGs
```

---

## 10. Prior-art search, summary (2026-11-10)

Read-only research. Some hosts were blocked in the research sandbox, so their quotes came from search-engine snippets: these are UNVERIFIED until re-checked (listed in section 8).

| Part | Verdict | Main sources |
|---|---|---|
| A printed sheet that turns dice pairs into 5 bits with a 6x6 table (32 kept, 4 rejected), read in 11-bit groups | Done before | seed-cat/analog-seed-entropy (the same 36 → 32 rule); Blockstream's d6 guide; Rudefox ShowMyWork (2020); Bip39-Kit; bitaps; Ian Coleman's `entropy.js` |
| Two separate physical sources mixed by hand with XOR | Partly done | Glacier XORs dice with a computer RNG in software; Coldcard Seed XOR XORs existing seeds by hand; commit-then-reveal mixing is described in general. No published procedure was found that XORs two physical sources by hand to make a seed (a negative search, not proof). |
| A bias check on the sheet before the words are trusted | Done before | Bip39-Kit (chi-square with power tables), Krux, seedroller; the by-hand chi-square test is textbook |
| The last word needs SHA-256, so two tools must agree | Done before, and widely recommended | Glacier, Bip39-Kit, SeedSigner (dice verification doc), Krux |
| Linear check marks that commute with share arithmetic | Done before in general | BIP-93 / codex32 |

The full search, with quotes and links, is in the method's working folder (`prior-art.md`). No novelty claim is made (section 7).

