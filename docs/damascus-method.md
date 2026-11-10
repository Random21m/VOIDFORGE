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

The step labels are the ones printed on the sheets. Times are estimates for one person from the design notes; **nobody has timed the method yet**. With two people (one on dice, one on cards, in separate rooms) it takes about 31 minutes.

| Step | What you do | Time |
|---|---|---|
| Setup | Lay out the sheets, the dice, the cards and a pencil. | 1 min |
| **H1** | **Dice (Hammer sheet).** Throw both dice; read the left die first. Write both numbers in the next pair box. 1-1, 2-2, 3-3 or 4-4: cross the box out and throw again. Otherwise look up the pair in the mirror table (row = left die, column = right die) and write its 5 bits in the next shaded run of grid H. 26 good pairs fill the grid (about 29 throws); the last pair uses only 3 bits. | 7 min |
| **H2** | **Dice check (bias box).** In the first 26 pair boxes (crossed-out ones too), count how often each face came up, and count the repeats (a throw the same as the one before). The fail rules are printed on the sheet. | 1 min |
| **H3** | **Hallmarks on the Hammer sheet:** R for each row, M for each column. | 1.5 min |
| **H4** | Optional: grid H as a Seed XOR part (see Assay). | — |
| **A1** | **Shuffle (Anvil sheet).** Spread the cards face down and swirl them for 30 seconds, riffle shuffle 12 times, then cut. Three decks in all: shuffle the same deck again each time. | 4.25 min (1.4 a deck) |
| **A2** | **Deal and play.** Deal 8 cards face up. Play the 7 matches: 1 against 2, 3 against 4, 5 against 6, 7 against 8, then the two winners on the left, then the two winners on the right, then the final. The higher card wins and plays on. Write **1 if the right card is higher**, 0 if the left card is higher. Ace is lowest, King is highest; for the same rank, clubs < diamonds < hearts < spades. 6 groups of 8, then 4 cards (1 against 2, 3 against 4, then the two winners). On the third deck, stop when the grid is full. | 7.25 min (2.4 a deck, A3 included) |
| **A3** | **Card check (bias box), while you deal.** Count the neighbors: two cards side by side with the same suit and ranks next to each other. After each deck, count its 1s. | (in A2) |
| **A4** | **Hallmarks on the Anvil sheet.** With the card record (on for two people, optional for one), also write down every card. | 1.5 min (+4.5 for the card record) |
| **F1** | **Fold (Forge sheet).** Lay the Hammer and Anvil sheets side by side. For every box: same bits gives 0, different bits gives 1. | 2.5 min |
| **F2** | **Seal.** Hallmarks on grid F. Fold the Hammer and Anvil hallmarks the same way: the result must equal F's hallmarks. If one does not match, the mistake is where that row and that column cross. | 2 min |
| **F3** | **Words.** Split each row into 3 + 4 + 4 bits: block, row, column of the binary word table. | 3 min |
| **F4** | **Check the words.** Find each word alphabetically in the table and make sure its bits match the row. | 2 min |
| **F5** | **Last word.** Row 12 gives only 7 bits; the last word also holds a checksum that needs a computer. Those 7 bits pick one table row of 16 words. **SeedSigner:** Tools > Calc 12th/24th word > 12 words > type words 1 to 11 > Build Final Word > **Coin flip entropy** > enter the 7 bits (Heads = 1, Tails = 0). Final Word Calc shows the last word; Next shows the fingerprint (12th Word screen). For the first address: Load seed > Done > Address explorer > Native Segwit > Receive addresses, address 0. **VOIDFORGE:** MAKE A SEED > Word draw, the same 11 words and the 7 bits as the coin flips. Both tools must show the same last word, in that table row, and the same fingerprint and first address, as your wallet. | 4 min |
| **F6** | **Backup.** Copy the 12 words and, next to them, the hallmarks M and R (and K if you use it). Destroy the sheets you do not keep. | 2 min |
| | **Total** | **about 37 min to checked words, about 39 with the backup** |

- **Check my sheets:** on the Damascus tab, type the dice pairs and the card record (or grid A's bits). VOIDFORGE works out every grid, hallmark and word, shows the range of the last word, the last word, the fingerprint and the first address, and points to the row and column of any mistake you typed in. FORGE SEED then puts the seed into the page's usual tools.
- **24 words:** the same steps with 52 good dice pairs and 6 decks. Row 24 has 3 bits, which pick one block of 256 words; choose 24 words on the SeedSigner. About 71 minutes alone, or about 53 minutes with two people.

## What each check shows, and what it does not

| Check | Shows | Does **not** show |
|---|---|---|
| Bias boxes | The dice or deck has no gross defect: a missing face, invented numbers, an unshuffled deck. | That the dice or shuffle is fair. A die with one face 50% too likely passes about 19 times in 20. **Detects gross defects only.** |
| Seal (hallmarks M and R) | Your folding has no mistake. It catches every 1-, 2- and 3-box mistake, and about 99.97% of larger ones. | That the sheets are honest. Hallmarks catch mistakes, not cheating. |
| Word check | Every word matches its row. | Anything about the randomness. |
| Two tools agree, and the word is in the hand range | The SHA-256 last word is right. | That the tools are safe to use with real funds. Use offline devices. |
| Fingerprint and first address | Your wallet holds this seed. | That no one else has seen it. |
| Heir recheck (hallmarks on the backup) | The written words are the forged words. It catches any single wrong word, and every swap of two words when the skew hallmark K is used (12 words). VOIDFORGE: CHECK A BACKUP > Recheck a Damascus backup. | It needs the hallmarks. Keep them only next to the words: on their own they reveal 23 bits. |

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

## Prior art

Every single ingredient already exists: dice tables, XOR mixing, bias tests, two-tool checks and Seed XOR. The summary is in [damascus-method-design.md](damascus-method-design.md), sections 7 and 10. No novelty claim is made.
