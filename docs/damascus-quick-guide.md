# How to make a Damascus seed

<img src="damascus/creator.webp" width="44" height="44" alt="Random's profile picture: a bloodhound in a Bitcoin cap"> The Damascus method, created by Random, 10 November 2026

Dated and signed origin record: tag [damascus-origin-2026-11-10](https://gitlab.com/random21m/voidforge/-/tags/damascus-origin-2026-11-10) on GitLab, timestamped in Bitcoin block 975,337 (OpenTimestamps) ([DAMASCUS-ORIGIN.md](../DAMASCUS-ORIGIN.md))

A Damascus seed is a normal 12-word Bitcoin seed that you make by hand from **dice** and **playing cards**, and check by hand as you go. Damascus steel is made by folding two different steels into one blade that is stronger than either. The Damascus method folds dice and cards into one seed.

**Time:** about 30 minutes once you know the steps; allow longer the first time.
**Practice first** with a practice sheet (FILL IN A PRACTICE SHEET on the Damascus tab) or throwaway rolls. Never put money on a practice seed.

Field-tested: a hand-made Damascus seed checked on a real SeedSigner and in Sparrow (10 November 2026).

Each part below has the steps, one action per line, then **What you should have now**, then **Why it works**. The step labels on the printed sheets (H1, A2, F5 ...) are shown in brackets.

---

## What you need

- The printed sheets: **Hammer** (dice), **Anvil** (cards), **Forge** (the result), and the **word table**. Print them from VOIDFORGE: MAKE A SEED, the Damascus tab.
- Two matching six-sided dice.
- One deck of 52 playing cards.
- A pencil.
- An offline VOIDFORGE and a SeedSigner for the last word.

Work in a private room. Phones away.

---

## Part 1: The Hammer (dice)

1. **Throw both dice.** Read the **left** die first. (H1)
2. **Write both numbers** in the next pair box.
3. **Rolled 1-1, 2-2, 3-3 or 4-4?** Cross the pair box out and throw both dice again.
4. **Look up the pair** in the mirror table on the Hammer sheet (a pair and its mirror, like 2-5 and 5-2, share the first 4 bits): the row is the left die, the column is the right die. It gives you 5 bits (like `01101`).
5. **Write the 5 bits** into the next shaded run of the grid (a run is the stretch of boxes for one pair or one group of cards, shaded and white in turn).
6. **Repeat** until the grid is full (26 good pairs). The last pair uses only 3 bits.
7. **Dice check:** in the first 26 pair boxes, including crossed-out boxes: 52 numbers, count how often each face came up, and count the repeats (a number the same as the number just before it, reading every number in order: left, right, then the next box). FAIL if any count is 18 or more, or 1 or fewer, or repeats are 2 or fewer. On a FAIL, use other dice and start a new Hammer sheet. (H2)

**What you should have now:** 26 good pairs in the pair boxes, grid H full (rows 1 to 11 with 11 bits, row 12 with 7), and PASS in the dice check.

### Why it works

- **Bit:** a 0 or a 1. **Entropy:** the randomness a seed is made from, 128 bits for 12 words.
- Two dice have 36 results. The 4 doubles 1-1 to 4-4 are thrown again, so 32 are left: exactly the 32 codes of 5 bits, each as likely as the others with fair dice.
- The fifth bit says which die was higher. It stays fair even with a biased die, because a die is as likely to be higher first as second.
- The dice check catches badly broken dice, not small flaws. The cards cover the rest (Part 4).

## Part 2: The Anvil (cards)

1. **Shuffle well:** spread the cards face down and swirl them for 30 seconds, riffle shuffle **12 times**, then cut. (A1)
2. **Deal 8 cards face up** in a row. (A2)
3. **Play the 7 matches** shown on the sheet: 1 against 2, 3 against 4, 5 against 6, 7 against 8, then the two winners on the left, then the two winners on the right, then the final.
   - The higher card wins and plays on.
   - In each match write **1 if the right card is higher**, **0 if the left card is higher**.
   - Ace is lowest, King is highest. For the same rank: clubs < diamonds < hearts < spades.
   - A group of 8 cards (an octet) gives 7 bits for its run of grid A; a group of 4 (a quad) gives 3.
4. **Deal the next 8 cards** and play again: 6 groups of 8 in all.
5. **Then deal 4 cards:** 1 against 2, 3 against 4, then the two winners.
6. **Do it 3 times in all:** shuffle the same deck again (step 1) each time. The last deck is shorter: on deck 3, deal 5 groups of 8, then 4 cards, and stop.
7. **Card check, while you deal:** count the neighbors: two cards dealt one after the other in the same group, with the same suit and ranks next to each other (like 7♥ 8♥). Ace and King are not neighbors, and two cards in different groups never count. After each deck, count its 1s. FAIL a deck if its 1s are 11 or fewer, or 34 or more (full 45-bit decks only), or its neighbors are 6 or more. On a FAIL, shuffle again and redo that deck. (A3)

**What you should have now:** grid A full (128 bits, row 12 with 7), the card record if you keep one, and PASS for each deck.

### Why it works

- **Match bit:** 1 if the right card is higher. In a well-shuffled deck, either card is equally likely to be the higher one, so each match is a fair bit.
- Every card has its own place in the order (rank, then suit), so there are no ties.
- The card check catches a lazy shuffle, not a small flaw. The dice cover the rest (Part 4).

## Part 3: Hallmarks (parity) on each sheet

A hallmark is a check bit: whether a row or a column holds an odd or an even number of 1s (its parity). On the Hammer sheet and on the Anvil sheet: (H3, A4)

- **Row hallmark R:** count the 1s in the row and write the result in the R box at the end of the row: odd: 1 3 5 7 9 11 → 1 · even: 0 2 4 6 8 10 → 0.
- **Column hallmark M:** count the 1s in the column and write the result in the M box under it, the same way.

**What you should have now:** on both sheets, an R box filled on every row and an M box under every column.

### Why it works

- **Parity:** whether a count is odd or even. A hallmark is the parity of the 1s in its row or column.
- One wrong box changes the parity of its row and of its column, so its hallmarks show where it is.

## Part 4: The Forge (XOR)

1. **Lay the Hammer and Anvil sheets side by side.** (F1)
2. **Work one row at a time:** finger on the same row on both sheets.
3. **For every box (this is XOR):** Same → 0. Different → 1. Write it in the same box on the Forge sheet.
4. **Hallmarks on the Forge sheet,** R and M, the same way as in Part 3. (F2)
5. **The seal:** for each R box and each M box, fold the Hammer hallmark with the Anvil hallmark (Same → 0. Different → 1.). The result must equal the Forge sheet’s hallmark.
6. **If one doesn’t match:** the mistake is where that row and that column cross. Fix it before you go on.

**What you should have now:** grid F full, its R and M boxes filled, and the seal agreeing in every box.

### Why it works

- **XOR (folding):** two bits in, one bit out: 0 0 → 0, 1 1 → 0, 0 1 → 1, 1 0 → 1. Forge = Hammer XOR Anvil.
- If either sheet is random, the Forge sheet is random too, even if the other sheet is bad or was made by someone you do not trust.
- The parity of a folded row is the fold of the two parities. So the seal checks all your folding at once, without doing it again.

## Part 5: The words

1. **Split each Forge row** into 3 + 4 + 4 bits: block, row, column. Block: which of the word table’s 8 blocks; row and column: where the word sits in that block. (F3)
2. **Look up the word** in the word table with those three parts and write it next to the row. No math needed.
3. **Check each word back:** find it alphabetically in the table and make sure its bits match the row. (F4)

**What you should have now:** words 1 to 11 next to rows 1 to 11, each one checked back.

### Why it works

- The 11 bits of a row are the word’s place on the BIP39 list (2,048 words, from 0). The word table lays the list out by those bits, so no arithmetic is needed.

## Part 6: The last word

Row 12 gives only 7 bits, because the last word also holds a checksum that needs a computer. (F5)

- Your Forge sheet’s last row gives the last word’s 7 bits (3 for 24 words). These are not new coin flips.
- SeedSigner asks for them under 'Coin flip entropy'. That is just its way of typing in 0s and 1s: enter each bit as Heads = 1, Tails = 0.
- The device then calculates the checksum (4 bits for 12 words, 8 for 24) and shows the final word. VOIDFORGE must show the same word.

1. **On the SeedSigner:** Tools > **Calc 12th/24th word** > 12 words > type words 1 to 11 > **Build Final Word** > **Coin flip entropy** > enter the 7 bits (**Heads = 1**, Tails = 0).
2. **Final Word Calc** shows the last word. Press Next: the 12th Word screen shows the fingerprint.
3. **In VOIDFORGE:** MAKE A SEED > Damascus, step 5 (Last word). Type the same 11 words and the 7 bits, then press CALCULATE LAST WORD.
4. **Both must show the same last word,** and it must be in the table row that the 7 bits point to.
5. **Compare the fingerprint** on both. They must match.
6. **Compare the first address.** On the SeedSigner: Load seed > Done > Address explorer > Native Segwit > Receive addresses, address 0. It must match VOIDFORGE’s first address.

**What you should have now:** the 12th word, the same on both tools, and the same fingerprint and first address on both.

### Why it works

- **Checksum:** the first 4 bits of SHA-256 of the 128 bits, added to the end so a wallet can tell a mistyped seed. Nobody can work out SHA-256 by hand, so two tools do it and must agree.
- The 7 bits fix the table row, so a tool that gave a word outside that row would be wrong.

## Part 7: Backup

1. **Copy the 12 words** to your backup (paper or metal). (F6)
2. **Copy the hallmarks next to them** (the row hallmarks and the column hallmarks). Later, anyone can recheck the words by hand with them.
3. **Keep the hallmarks only next to the words,** because they reveal part of the seed.
4. **Destroy the sheets you do not keep.** The Forge sheet *is* your seed.

**What you should have now:** the words and their hallmarks on your backup, and no other copy of the Forge sheet.

### Why it works

- The hallmarks reveal 22 bits of the seed: not enough to find it, but they make guessing easier. Next to the words they reveal nothing new.

---

## 24 words

The same steps, with 52 good dice pairs and 6 decks (on deck 6, the last: 4 groups of 8, then 4 cards). The last row has 3 bits, which pick one block of the word table; use 24 words on the SeedSigner. The dice check counts the first 52 pair boxes: 104 numbers, and FAIL if any count is 29 or more, or 6 or fewer, or repeats are 7 or fewer; the card check is the same. Allow about twice the time.

## Doing it with a helper (optional)

1. **One person does the Hammer sheet, the other the Anvil sheet, in separate rooms.**
2. **The card person writes down every card** in the card record on the Anvil sheet.
3. **Each folds their sheet closed** before seeing the other one. This matters: whoever sees the other sheet before finishing their own could steer the seed.
4. **Assay:** later, each sheet can be checked by a different person (an assayer) without anyone learning the seed. In VOIDFORGE, choose "An assayer" under Who checks. Optional, for the assay: each sheet is also a Seed XOR part (step H4 on the Hammer sheet).

## Check it all in VOIDFORGE (optional)

On the Damascus tab, the five steps (Hammer, Anvil, Forge, Words, Last word) follow these parts. Tap your dice and cards in as you go, or type them: VOIDFORGE checks each row, deck and word as you finish it, points to the box of any mistake, and works out the last word, fingerprint and first address. FORGE SEED then puts the seed into the page’s usual tools.

---

## What the checks catch, and what they do not

- **The seal and hallmarks** catch copying mistakes: every single slip, and nearly all bigger ones. They do not catch cheating.
- **The dice and card checks** catch badly broken dice or a lazy shuffle, not small flaws. Having **both** dice and cards is what protects you: if either one is good, the seed is fully random.
- **Two tools agreeing** on the last word, fingerprint and address shows the checksum is right.

The full method is in [damascus-method.md](damascus-method.md); the math and the tests are in [damascus-method-design.md](damascus-method-design.md).
