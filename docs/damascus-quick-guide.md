# How to make a Damascus seed

<img src="damascus/creator.webp" width="44" height="44" alt="Random's profile picture: a bloodhound in a Bitcoin cap"> The Damascus method, created by Random, 10 November 2026

Dated and signed origin record: tag [damascus-origin-2026-11-10](https://gitlab.com/random21m/voidforge/-/tags/damascus-origin-2026-11-10) on GitLab, timestamped in Bitcoin block 975,337 (OpenTimestamps) ([DAMASCUS-ORIGIN.md](../DAMASCUS-ORIGIN.md))

A Damascus seed is a normal 12-word Bitcoin seed that you make by hand from **dice** and **playing cards**, and check by hand as you go. Damascus steel is made by folding two different steels into one blade that is stronger than either. The Damascus method folds dice and cards into one seed.

**Time:** about 40 minutes alone, about 30 minutes with a helper. These are estimates: nobody has timed the method yet.
**Practice first** with throwaway rolls. Never put money on a practice seed.

The step labels on the printed sheets (H1, A2, F5 ...) are shown in brackets.

---

## What you need

- The printed sheets: **Hammer** (dice), **Anvil** (cards), **Forge** (the result), and the **word table**. Print them from VOIDFORGE: MAKE A SEED, the Damascus tab.
- Two matching six-sided dice.
- One deck of 52 playing cards.
- A pencil.
- An offline VOIDFORGE and a SeedSigner for the last word.

Work in a private room. Phones away.

---

## Part 1: The Hammer (dice), about 8 minutes

1. **Throw both dice.** Read the **left** die first. (H1)
2. **Write both numbers** in the next pair box.
3. **Rolled 1-1, 2-2, 3-3 or 4-4?** Cross the pair box out and throw again.
4. **Look up the pair** in the mirror table on the Hammer sheet: the row is the left die, the column is the right die. It gives you 5 bits (like `01101`).
5. **Write the 5 bits** into the next shaded run of the grid.
6. **Repeat** until the grid is full (26 good pairs). The last pair uses only 3 bits.
7. **Dice check:** in the first 26 pair boxes (crossed-out ones too), count how often each face came up, and count the repeats (a throw the same as the one before). The sheet says when it is a FAIL. On a FAIL, use other dice and start a new Hammer sheet. (H2)

## Part 2: The Anvil (cards), about 12 minutes

1. **Shuffle well:** spread the cards face down and swirl them for 30 seconds, riffle shuffle **12 times**, then cut. (A1)
2. **Deal 8 cards face up** in a row. (A2)
3. **Play the 7 matches** shown on the sheet: 1 against 2, 3 against 4, 5 against 6, 7 against 8, then the two winners on the left, then the two winners on the right, then the final.
   - The higher card wins and plays on.
   - In each match write **1 if the right card is higher**, **0 if the left card is higher**.
   - Ace is lowest, King is highest. For the same rank: clubs < diamonds < hearts < spades.
4. **Deal the next 8 cards** and play again: 6 groups of 8 in all.
5. **Then deal 4 cards:** 1 against 2, 3 against 4, then the two winners.
6. **Do it 3 times in all:** shuffle the same deck again (step 1) each time. On the third deck, stop when the grid is full.
7. **Card check, while you deal:** count the neighbors, two cards side by side with the same suit and ranks next to each other (like 7♥ 8♥). After each deck, count its 1s. The sheet says when it is a FAIL. On a FAIL, shuffle again and redo that deck. (A3)

## Part 3: Hallmarks on each sheet, about 3 minutes

On the Hammer sheet and on the Anvil sheet: (H3, A4)

- **Row hallmark:** at the end of each row, write **1** if the row has an odd number of 1s, otherwise **0**.
- **Column hallmark:** under each column, write **1** if the column has an odd number of 1s, otherwise **0**.

## Part 4: The Forge (fold them together), about 5 minutes

1. **Lay the Hammer and Anvil sheets side by side.** (F1)
2. **For every box:** same bits gives **0**, different bits gives **1**. Write it in the same box on the Forge sheet.
3. **Hallmarks on the Forge sheet,** the same way as in Part 3. (F2)
4. **The seal:** fold the hallmarks the same way (Hammer hallmark and Anvil hallmark: same gives 0, different gives 1). The result must equal the Forge sheet's hallmarks.
5. **If one does not match,** the mistake is where that row and that column cross. Fix it before you go on.

## Part 5: The words, about 5 minutes

1. **Split each Forge row** into 3 + 4 + 4 bits: block, row, column. (F3)
2. **Look up the word** in the word table with those three parts and write it next to the row. No math needed.
3. **Check each word back:** find it alphabetically in the table and make sure its bits match the row. (F4)

## Part 6: The last word, about 4 minutes

Row 12 gives only 7 bits, because the last word also holds a checksum that needs a computer. (F5)

1. **On the SeedSigner:** Tools > **Calc 12th/24th word** > 12 words > type words 1 to 11 > **Build Final Word** > **Coin flip entropy** > enter the 7 bits (**Heads = 1**, Tails = 0).
2. **Final Word Calc** shows the last word. Press Next: the 12th Word screen shows the fingerprint.
3. **In VOIDFORGE:** MAKE A SEED > Word draw. Type the same 11 words, and the 7 bits as the coin flips.
4. **Both must show the same last word,** and it must be in the table row that the 7 bits point to.
5. **Compare the fingerprint** on both. They must match.
6. **Compare the first address.** On the SeedSigner: Load seed > Done > Address explorer > Native Segwit > Receive addresses, address 0. It must match VOIDFORGE's first address.

## Part 7: Backup, about 2 minutes

1. **Copy the 12 words** to your backup (paper or metal). (F6)
2. **Copy the hallmarks next to them** (the row hallmarks and the column hallmarks). Later, anyone can recheck the words by hand with them.
3. **Keep the hallmarks only next to the words,** because they reveal part of the seed.
4. **Destroy the sheets you do not keep.** The Forge sheet *is* your seed.

---

## 24 words

The same steps, with 52 good dice pairs and 6 decks. The last row has 3 bits, which pick one block of the word table; use 24 words on the SeedSigner. It takes about 70 minutes alone.

## Doing it with a helper (optional)

1. **One person does the Hammer sheet, the other the Anvil sheet, in separate rooms.**
2. **The card person writes down every card** in the card record on the Anvil sheet.
3. **Each folds their sheet closed** before seeing the other one. This matters: whoever sees the other sheet before finishing their own could steer the seed.
4. **Assay:** later, each sheet can be checked by a different person (an assayer) without anyone learning the seed. In VOIDFORGE, choose "An assayer" under Check my sheets.

## Check it all in VOIDFORGE (optional)

On the Damascus tab, type your dice pairs and your card record under **Check my sheets**. VOIDFORGE works out every grid, hallmark and word, and points to the row and column of any mistake.

---

## What the checks catch, and what they do not

- **The seal and hallmarks** catch copying mistakes: every single slip, and nearly all bigger ones. They do not catch cheating.
- **The dice and card checks** catch badly broken dice or a lazy shuffle, not small flaws. Having **both** dice and cards is what protects you: if either one is good, the seed is fully random.
- **Two tools agreeing** on the last word, fingerprint and address shows the checksum is right.

The full method is in [damascus-method.md](damascus-method.md); the math and the tests are in [damascus-method-design.md](damascus-method-design.md).
