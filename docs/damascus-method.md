# The Damascus method

<img src="damascus/creator.webp" width="44" height="44" alt="Random's profile picture: a bloodhound in a Bitcoin cap"> The Damascus method, created by Random, 10 November 2026

Dated and signed origin record: tag [damascus-origin-2026-11-10](https://gitlab.com/random21m/voidforge/-/tags/damascus-origin-2026-11-10) on GitLab, timestamped in Bitcoin block 975,337 (OpenTimestamps) ([DAMASCUS-ORIGIN.md](../DAMASCUS-ORIGIN.md))

**Make a standard 12- or 24-word Bitcoin seed (BIP39) from dice and playing cards, checked by hand.**

Damascus steel is made by folding two different steels into one blade that is stronger than either. The Damascus method folds dice and cards into one seed. The seed it makes is a Damascus seed: a normal BIP39 seed that any BIP39 wallet takes.

The short, plain version is [damascus-quick-guide.md](damascus-quick-guide.md). Questions and fixes: [damascus-faq.md](damascus-faq.md). The math, simulations and open questions: [damascus-method-design.md](damascus-method-design.md). Worked examples: [damascus-examples.md](damascus-examples.md) (public: never put money on them).

## What you need

- The printed sheets: the **Hammer sheet** (H, dice), the **Anvil sheet** (A, cards), the **Forge sheet** (F, the result), and the **binary word table**. VOIDFORGE prints them: MAKE A SEED, the Damascus tab (PRINT DAMASCUS KIT, or one sheet at a time; 12 or 24 words; Letter or A4). The kit is also in [damascus-kit.html](damascus-kit.html) (12 words) and [damascus-kit-24.html](damascus-kit-24.html).
- Two matching six-sided dice and a cup (or one die, thrown twice).
- One deck of 52 playing cards.
- A pencil.
- Two offline tools for the last word: VOIDFORGE and a SeedSigner.

## Why it is built this way

- **Two different sources.** The seed is the dice bits folded with the card bits (XOR: same bits give 0, different bits give 1). If either source is good, the seed is fully random, even if the other source is bad or comes from someone you do not trust.
- **Different failures.** Dice fail when the dice are bad. Cards fail when the shuffle is bad. The two rarely fail together.
- **Hallmarks.** A row hallmark R and a column hallmark M on each grid: 1 if the row (or column) has an odd number of 1s, otherwise 0. They let you check your folding and your word lookups by hand. Later, they let your heir check the words. The optional skew hallmark K also catches two words written in swapped places.

## Steps for 12 words

The step labels are the ones printed on the sheets. **Time:** about 30 minutes once you know the steps; allow longer the first time (about twice as long for 24 words). Field-tested: a hand-made Damascus seed checked on a real SeedSigner and in Sparrow (10 November 2026).

| Step | What you do |
|---|---|
| Setup | Lay out the sheets, the dice, the cards and a pencil. |
| **H1** | **Dice (Hammer sheet).** Throw both dice; read the left die first. Write both numbers in the next pair box. 1-1, 2-2, 3-3 or 4-4: cross the box out and throw both dice again. Otherwise look up the pair in the mirror table (row = left die, column = right die) and write its 5 bits in the next shaded run of grid H. 26 good pairs fill the grid (about 29 throws); the last pair uses only 3 bits. |
| **H2** | **Dice check (bias box).** In the first 26 pair boxes (crossed-out ones too), count how often each face came up, and count the repeats (a number the same as the number just before it, reading every number in order: left, right, then the next box). The fail rules are printed on the sheet. |
| **H3** | **Hallmarks on the Hammer sheet:** R for each row, M for each column. |
| **H4** | Optional: grid H as a Seed XOR part (see Assay). |
| **A1** | **Shuffle (Anvil sheet).** Spread the cards face down and swirl them for 30 seconds, riffle shuffle 12 times, then cut. Three decks in all: shuffle the same deck again each time. |
| **A2** | **Deal and play.** Deal 8 cards face up. Play the 7 matches: 1 against 2, 3 against 4, 5 against 6, 7 against 8, then the two winners on the left, then the two winners on the right, then the final. The higher card wins and plays on. Write **1 if the right card is higher**, 0 if the left card is higher. Ace is lowest, King is highest; for the same rank, clubs < diamonds < hearts < spades. 6 groups of 8, then 4 cards (1 against 2, 3 against 4, then the two winners). The last deck is shorter: on deck 3, deal 5 groups of 8, then 4 cards, and stop. |
| **A3** | **Card check (bias box), while you deal.** Count the neighbors: two cards side by side with the same suit and ranks next to each other (Ace and King are not neighbors). After each deck, count its 1s. |
| **A4** | **Hallmarks on the Anvil sheet.** With the card record (on for two people, optional for one), also write down every card. |
| **F1** | **Fold (Forge sheet): Forge = Hammer XOR Anvil.** Lay the Hammer and Anvil sheets side by side. Work one row at a time: finger on the same row on both sheets. For every box: Same → 0. Different → 1. |
| **F2** | **Seal.** Hallmarks on grid F. Fold the Hammer and Anvil hallmarks the same way: the result must equal F's hallmarks. If one doesn't match: the mistake is where that row and that column cross. |
| **F3** | **Words.** Split each row into 3 + 4 + 4 bits: block, row, column of the binary word table. |
| **F4** | **Check the words.** Find each word alphabetically in the table and make sure its bits match the row. |
| **F5** | **Last word.** Row 12 gives only 7 bits; the last word also holds a checksum that needs a computer. Those 7 bits pick one table row of 16 words. Your Forge sheet's last row gives the last word's 7 bits (3 for 24 words). These are not new coin flips. SeedSigner asks for them under 'Coin flip entropy'. That is just its way of typing in 0s and 1s: enter each bit as Heads = 1, Tails = 0. The device then calculates the checksum (4 bits for 12 words, 8 for 24) and shows the final word. VOIDFORGE must show the same word. **SeedSigner:** Tools > Calc 12th/24th word > 12 words > type words 1 to 11 > Build Final Word > **Coin flip entropy** > enter the 7 bits (Heads = 1, Tails = 0). Final Word Calc shows the last word; Next shows the fingerprint (12th Word screen). For the first address: Load seed > Done > Address explorer > Native Segwit > Receive addresses, address 0. **VOIDFORGE:** MAKE A SEED > Damascus, step 5 (Last word): the same 11 words and the 7 bits, then CALCULATE LAST WORD (or, with the dice and cards typed in, step 5 shows the last word by itself). Both tools must show the same last word, in that table row, and the same fingerprint and first address, as your wallet. |
| **F6** | **Backup.** Copy the 12 words and, next to them, the hallmarks M and R (and K if you use it). Destroy the sheets you do not keep. |

- **On the page, step by step:** the Damascus tab follows these steps in five parts (Hammer, Anvil, Forge, Words, Last word) with a progress bar. Tap the dice and the cards as you go (or type them) and each row, deck and word is checked as you finish it. **Check my sheets:** on the Damascus tab, type the dice pairs and the card record (or grid A's bits). VOIDFORGE works out every grid, hallmark and word, shows the range of the last word, the last word, the fingerprint and the first address, and points to the row and column of any mistake you typed in. FORGE SEED then puts the seed into the page's usual tools.
- **24 words:** the same steps with 52 good dice pairs and 6 decks (on deck 6, the last: 4 groups of 8, then 4 cards). Row 24 has 3 bits, which pick one block of 256 words; choose 24 words on the SeedSigner.

## What each check shows, and what it does not

| Check | Shows | Does **not** show |
|---|---|---|
| Bias boxes | The dice or deck has no gross defect: a missing face, invented numbers, an unshuffled deck. | That the dice or shuffle is fair. A die with one face 50% too likely passes about 19 times in 20. **Detects gross defects only.** |
| Seal (hallmarks M and R) | Your folding has no mistake. It catches every 1-, 2- and 3-box mistake, and about 99.97% of larger ones. | That the sheets are honest. Hallmarks catch mistakes, not cheating. |
| Word check | Every word matches its row. | Anything about the randomness. |
| Two tools agree, and the word is in the hand range | The SHA-256 last word is right. | That the tools are safe to use with real funds. Use offline devices. |
| Fingerprint and first address | Your wallet holds this seed. | That no one else has seen it. |
| Heir recheck (hallmarks on the backup) | The written words are the forged words. It catches any single wrong word except a wrong last word in the same table row (block, for 24 words), which only the checksum catches, and every swap of two words when the skew hallmark K is used (12 words). VOIDFORGE: CHECK A BACKUP > Recheck a Damascus backup. | It needs the hallmarks. Keep them only next to the words: on their own they reveal 22 bits (34 for 24 words). |

## Assay (optional)

1. Two different people can each check one sheet:
   - an assayer for the Hammer sheet (pair boxes, table lookups, bias box, hallmarks);
   - an assayer for the Anvil sheet (from the card record).
2. Neither learns anything about the seed, **as long as**:
   - the other source was good;
   - they never share their sheets;
   - neither sheet was seen before the other was finished. Fill each sheet in private, then fold it closed and hand it over.
3. Each sheet, with its own last word added by a tool, is a valid BIP39 phrase, and the two phrases are a Coldcard **Seed XOR** pair for your seed. On the Damascus tab, choose "An assayer" under Check my sheets: it shows that sheet's hallmarks and its own Seed XOR phrase, never the seed.

**The order matters.** Worked example 2 shows what happens if the card person sees the dice first: they can choose any seed they want, and every check still passes.

## Practice sheets: the published rule

PRACTICE on the Damascus tab fills in practice sheet 1, 2, 3 ... up to 100, then starts again at 1. A practice sheet is made by this rule, never by the page's own random numbers (the page makes none), so anyone can make the same sheet:

1. Practice sheet N reads 32-bit numbers, big-endian, from SHA-256 of the text `VOIDFORGE Damascus practice N block k` (UTF-8), for k = 0, 1, 2 ... Each hash gives eight numbers.
2. A number from 0 to m - 1 is drawn by rejection: a 32-bit number at or above the largest multiple of m (below 2^32) is skipped; otherwise the draw is the number modulo m.
3. **Dice:** pairs of draws, each 1 + a draw from 0 to 5 (first throw, then second), until the grid has 26 good pairs (52 for 24 words). Pairs that say "throw again" are kept, as on paper.
4. **Cards:** for each deck, the 52 cards in the order clubs, diamonds, hearts, spades, Ace to King in each suit, shuffled by Fisher-Yates: for i from 51 down to 1, swap card i with card j, where j is a draw from 0 to i.

The dice and the cards are drawn from one stream, dice first. Practice sheets 1 to 100 of both lengths make public phrases: VOIDFORGE knows all 200 of them (and the three worked examples), says PRACTICE on the Damascus tab whenever the dice and cards make one, keeps FORGE SEED off for them, and warns about them in CHECK A BACKUP. `tests/vfmethod.test.mjs` makes all 200 again from this rule with node:crypto.

## Prior art

Every single ingredient already exists: dice tables, XOR mixing, bias tests, two-tool checks and Seed XOR. The summary is in [damascus-method-design.md](damascus-method-design.md), sections 7 and 10. No novelty claim is made.
