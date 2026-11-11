# Damascus method: questions and fixes

Short answers for when something goes wrong. The steps are in [damascus-quick-guide.md](damascus-quick-guide.md).

## I lost count while dealing

1. Stop. Do not guess the bits you were not sure of.
2. Cross out that deck's runs in grid A.
3. Gather the whole deck, shuffle it again (wash, 12 riffles, cut) and deal that deck again from its first group.
4. With the card record, you can also redo the matches from the cards you wrote down.

## A die rolled off the table

Throw that pair again. Only write a pair you saw land flat. A die that is tilted against something does not count either.

## A bias box says FAIL

- Dice: a fair pair of dice fails about 2 times in 100. Use other dice and start a new Hammer sheet. Never change the bits by hand.
- Cards: a good shuffle fails about 6 decks in 1,000. Shuffle again and redo that deck.
- The boxes only catch badly broken dice or a lazy shuffle. Small flaws pass. Using both dice and cards is what protects you.

## The seal will not match

1. Find the row whose hallmarks do not agree, and the column whose hallmarks do not agree.
2. The mistake is in the box where that row and that column cross.
3. Check that box three times: on the Hammer sheet, on the Anvil sheet, and the fold on the Forge sheet (same bits gives 0, different bits gives 1).
4. If a row is off but no column is, the row hallmark itself may be miscounted. The same goes for a column.
5. CHECK MY SHEETS in VOIDFORGE points to the box for you.

## The two tools give different last words

1. Check that both have the same 11 words (23 for 24 words), in the same order.
2. Check the bits you typed for the last word: 7 bits for 12 words, 3 for 24. On the SeedSigner, Heads = 1 and Tails = 0.
3. In VOIDFORGE, MAKE A SEED > Damascus, step 5 (Last word), type the same words and bits, in the same order.
4. If they still differ, stop. Do not use the seed until you know why.

## Are the last 7 bits coin flips?

No.

- Your Forge sheet's last row gives the last word's 7 bits (3 for 24 words). These are not new coin flips.
- SeedSigner asks for them under 'Coin flip entropy'. That is just its way of typing in 0s and 1s: enter each bit as Heads = 1, Tails = 0.
- The device then calculates the checksum (4 bits for 12 words, 8 for 24) and shows the final word. VOIDFORGE must show the same word.

## How do I make 24 words?

The same steps, with 52 good dice pairs and 6 decks. Choose 24 words before you print the sheets. The last row of grid F has 3 bits, which pick one block of the word table; choose 24 words on the SeedSigner too.

## Can I do it with a helper?

Yes.

1. One person fills in the Hammer sheet and the other the Anvil sheet, in separate rooms.
2. The card person writes down every card in the card record.
3. Each folds their sheet closed before seeing the other one.

The order matters. Whoever fills in a sheet after seeing the other sheet can choose the seed, and every check still passes. Worked example 2 shows this.

## Can I use only dice?

Yes: VOIDFORGE's Dice tab does that. But then one bad die is not covered. With the Damascus method, the seed is fully random if either the dice or the shuffle is good.

## Does my wallet take a Damascus seed?

Yes, if it takes standard 12- or 24-word BIP39 seeds. A Damascus seed is a normal BIP39 seed. Nothing about it shows how it was made.

## What do the hallmarks reveal?

The row and column hallmarks reveal 22 bits of a 12-word seed (34 bits for 24 words; the two share one bit, the count of all the 1s). That is not enough to find the seed, but it makes guessing easier. Keep them only next to the words, never on their own. Anyone who has the words has the money anyway.

## What is an assay?

Someone else (an assayer) checks one sheet only: the Hammer sheet, or the Anvil sheet with its card record. If the other sheet was made well and kept apart, one sheet shows nothing about the seed. In VOIDFORGE, choose "An assayer" under Who checks: it shows that sheet's hallmarks and its own Seed XOR phrase, never the seed.
