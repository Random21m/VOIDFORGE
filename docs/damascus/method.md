# The VOIDFORGE method

**Make a standard 12- or 24-word Bitcoin seed (BIP39) from dice and playing cards, checked by hand.**

## What you need

- The printed forge sheet: sheets D, C and E (`forge-sheet.pdf`; for 24 words, `forge-sheet-24.pdf`).
- The binary word table (`bip39-binary-table.pdf`).
- Two matching six-sided dice and a cup.
- One deck of 52 playing cards.
- A pencil.
- Two offline tools for the last word, for example VOIDFORGE and a SeedSigner.

## Why it is built this way

- **Two different sources.** The seed is the dice bits XOR the card bits. If either source is good, the seed is fully random, even if the other source is bad or comes from someone you do not trust.
- **Different failures.** Dice fail when the dice are bad. Cards fail when the shuffle is bad. The two rarely fail together.
- **Forge marks.** These are simple parity counts. They let you check your own XOR and word lookups by hand. Later, they let your heir check the words.

## Steps for 12 words

Times are estimates for one person; nobody has timed the method yet. With two people (one on dice, one on cards) it takes about 31 minutes.

| # | Step | Time |
|---|---|---|
| 1 | **Dice (sheet D).** Throw both dice and read the left one first. Write the pair. If you rolled 1-1, 2-2, 3-3 or 4-4, cross it out and throw again. Otherwise, look up the 5 bits in the mirror table and write them in the next shaded run of grid D. You need 26 good pairs, about 29 throws. | 7 min |
| 2 | **Dice bias box.** Tally the faces in the first 26 pairs, and count repeats (a throw that equals the one before it). Fail rules are printed on the sheet. | 1 min |
| 3 | **Cards (sheet C).** Wash the deck face down for 30 seconds, riffle it 12 times, and cut. Deal 8 cards face up and play the 7 numbered matches. In each match, write **1 if the right card is higher**. A deck gives 6 groups of 8 plus one group of 4. You need 3 decks (shuffle the same deck again). | 11.5 min |
| 4 | **Card bias box.** While dealing, count "neighbors": two cards side by side with the same suit and ranks next to each other. Also count the 1s each deck gave. | (during step 3) |
| 5 | **Marks on D and C.** For each row write 1 if it has an odd number of 1s, otherwise 0. That is row mark R. Do the same for each column. That is column mark M. | 3 min |
| 6 | **XOR (sheet E).** Lay D and C side by side. For each cell: same bits → 0, different bits → 1. | 2.5 min |
| 7 | **Forge seal.** Work out M and R for E. Then check that M(D) XOR M(C) = M(E), and the same for R. | 2 min |
| 8 | **Words.** Split each row of E into 3, 4 and 4 bits, which give the block, row and column in the binary word table. | 3 min |
| 9 | **Check the words.** Find each word in alphabetical order in the table, read its bits from the headings, and compare them with the row. | 2 min |
| 10 | **Last word.** Its first 7 bits are row 12 of E, which gives one table row of 16 words. Enter words 1–11 and those 7 bits in **two** tools (VOIDFORGE Word draw; SeedSigner Calc final word, heads = 1). Both must show the same word, and it must be in that row. Then compare the master fingerprint and the first address in both tools and in your wallet. | 4 min |
| 11 | **Backup.** Copy the 12 words *and* the marks M and R (and K if you like) to your backup. Destroy the sheets you don't keep. | 2 min |
| | **Total** | **≈ 37 min to checked words, ≈ 39 min with the backup** |

- **Audit mode** (writing down every card so someone else can check the cards later) adds about 4.5 minutes.
- **24 words:** the same steps with 52 dice pairs and 6 decks. It takes about 71 minutes alone, or about 53 minutes with two people. The last word's 3 sheet bits pick one block of 256 words.

## What each check proves, and what it does not

| Check | Proves | Does **not** prove |
|---|---|---|
| Bias boxes | The dice or deck has no gross defect: a missing face, invented numbers, an unshuffled deck. | That the dice or shuffle is fair. A die with one face 50% too likely passes about 19 times in 20. **Detects gross defects only.** |
| Forge seal (M and R) | Your XOR has no mistake. It catches every 1-, 2- and 3-cell mistake, and about 99.97% of larger ones. | That the sheets are honest. Marks catch mistakes, not cheating. |
| Word check | Every word matches its row. | Anything about the randomness. |
| Two tools agree, and the word is in the hand range | The SHA-256 last word is right. | That the tools are safe to use with real funds. Use offline devices. |
| Fingerprint and first address | Your wallet holds this seed. | That no one else has seen it. |
| Heir check (marks on the backup) | The written words are the forged words. It catches any single wrong word, and every swap of two words when the optional skew mark K is used (12 words). | It needs the marks. Keep them only next to the words, because the marks alone reveal 23 bits. |

## Split-sheet audit (optional)

1. Two different people can each check one sheet:
   - one checks sheet D (dice, table lookups, bias box, marks);
   - the other checks sheet C (from the card record).
2. Neither learns anything about the seed, **as long as**:
   - the other source was good;
   - they never share their sheets;
   - neither sheet was seen before the other was finished. Fill each sheet in private, then fold it and hand it over.
3. With their own last words added by a tool, sheets D and C are also a valid Coldcard **Seed XOR** pair for your seed.

**Commit order matters.** Worked example 2 shows what happens if the card person sees the dice first: they can choose any seed they want, and every check still passes.

## Is it new?

Every single ingredient already exists: dice tables, XOR mixing, bias tests, two-tool checks and Seed XOR. See [prior-art.md](prior-art.md).

What we claim is the **combination**, dated 2026-11-10 and worded carefully. As far as we could find, this is the first BIP39 method that:

1. mixes two different physical sources by hand;
2. checks that hand mix, and later the backup, with XOR-linear forge marks (M(E) = M(D) ⊕ M(C));
3. lets two different people each audit one source sheet without learning the seed, with the two sheets also forming a Seed XOR pair.

The math, simulations and open questions are in [design-notes.md](design-notes.md).

Worked examples you can follow on paper are in `ref/examples/`. They are public seeds: **never put money on them**.
