# How to make a Damascus seed

A Damascus seed is a normal 12-word Bitcoin seed that you make by hand from **dice** and **playing cards**, and check by hand as you go. Like Damascus steel, two different materials are folded into one, and the result is stronger than either alone.

**Time:** about 40 minutes alone, about 30 minutes with a helper.
**Practice first** with throwaway rolls. Never put money on a practice seed.

---

## What you need

- The printed sheets: **Hammer** (dice), **Anvil** (cards), **Forge** (the result), and the **word table**.
- Two matching six-sided dice.
- One deck of 52 playing cards.
- A pencil.
- An offline VOIDFORGE and a SeedSigner (or our practice signer) for the last word.

Work in a private room. Phones away.

---

## Part 1: The Hammer (dice), about 8 minutes

1. **Throw both dice.** Read the **left** die first.
2. **Rolled 1-1, 2-2, 3-3 or 4-4?** Cross it out and throw again.
3. **Look up the pair** in the table at the top of the Hammer sheet. It gives you 5 bits (like `01101`).
4. **Write the 5 bits** into the next shaded box run in the grid.
5. **Repeat** until the grid is full (about 26 good throws). The last pair uses only 3 bits.
6. **Dice check:** count how many times each face (1 to 6) came up in the boxes printed for it. If the sheet says FAIL, use different dice and start the Hammer sheet again.

## Part 2: The Anvil (cards), about 12 minutes

1. **Shuffle well:** spread the cards face down and swirl them for 30 seconds, riffle shuffle **12 times**, then cut.
2. **Deal 8 cards face up** in a row.
3. **Play the 7 matches** shown on the sheet: 1 against 2, 3 against 4, 5 against 6, 7 against 8, then the winners, then the final.
   - In each match write **1 if the right card is higher**, **0 if the left card is higher**.
   - Ace is lowest, King is highest. For the same rank: clubs < diamonds < hearts < spades.
4. **Keep dealing** 8 cards at a time until the deck runs out (the last group is 4 cards).
5. **Do it 3 times in all:** reshuffle the same deck (step 1) each time.
6. **Card check:** count the 1s from each deck, as the sheet shows. A FAIL means the shuffle was too short: shuffle again and redo that deck.

## Part 3: Hallmarks on each sheet, about 3 minutes

On the Hammer sheet and on the Anvil sheet:

- **Row hallmark:** at the end of each row, write **1** if the row has an odd number of 1s, otherwise **0**.
- **Column hallmark:** under each column, write **1** if the column has an odd number of 1s, otherwise **0**.

## Part 4: The Forge (fold them together), about 5 minutes

1. **Lay the Hammer and Anvil sheets side by side.**
2. **For every box:** same bits gives **0**, different bits gives **1**. Write it in the same box on the Forge sheet.
3. **Hallmarks on the Forge sheet,** the same way as in Part 3.
4. **The seal:** fold the hallmarks the same way (Hammer hallmark and Anvil hallmark: same gives 0, different gives 1). The result must equal the Forge sheet's hallmarks.
   **If one doesn't match,** the mistake is where that row and that column cross. Fix it before you go on.

## Part 5: The words, about 5 minutes

1. **Split each Forge row** into 3 + 4 + 4 bits: block, row, column.
2. **Look up the word** in the word table with those three numbers and write it next to the row. No math needed.
3. **Check each word back:** find it alphabetically in the table and make sure its bits match the row.

## Part 6: The last word, about 4 minutes

Row 12 gives only 7 bits, because the last word also holds a checksum that needs a computer.

1. **On the SeedSigner:** Tools → **Calc 12th/24th word** → 12 words → type words 1 to 11 → **Build Final Word** → **Coin flip entropy** → enter the 7 bits (**Heads = 1**, Tails = 0).
2. **In VOIDFORGE:** enter the same 11 words and 7 bits.
3. **Both must show the same last word,** and it must be in the table row that the 7 bits point to.
4. **Compare the fingerprint and the first address** on both. They must match.

## Part 7: Backup, about 2 minutes

1. **Copy the 12 words** to your backup (paper or metal).
2. **Copy the hallmarks next to them** (the row hallmarks and the column hallmarks). Later, anyone can recheck the words by hand with them.
   **Keep the hallmarks only next to the words**, because they reveal part of the seed.
3. **Destroy the three sheets** you don't keep. The Forge sheet *is* your seed.

---

## Doing it with a helper (optional)

1. **One person does the Hammer sheet, the other the Anvil sheet, in separate rooms.**
2. **Each folds their sheet closed** before seeing the other one. This matters: whoever sees the other sheet first could steer the seed.
3. **Assay:** later, each sheet can be checked by a different person without anyone learning the seed. With the cards written down, the Anvil sheet can be checked the same way.

---

## What the checks catch, and what they don't

- **The seal and hallmarks** catch copying mistakes: every single slip, and nearly all bigger ones. They don't catch cheating.
- **The dice and card checks** catch badly broken dice or a lazy shuffle, not small flaws. Having **both** dice and cards is what protects you: if either one is good, the seed is fully random.
- **Two tools agreeing** on the last word, fingerprint and address proves the checksum is right.
