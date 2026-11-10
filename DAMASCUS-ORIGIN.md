# The Damascus method: origin record

**Created by:** Random, with VOIDFORGE (gitlab.com/random21m/voidforge)
**Date created:** 10 November 2026

## What it is

The Damascus method makes a standard BIP39 Bitcoin seed (12 or 24 words) by hand from two different physical sources, dice and playing cards, and checks the work by hand. Like Damascus steel, two different materials are folded into one.

- **The Hammer sheet (dice):** throws of two dice, looked up in a "mirror" 6x6 table that turns each pair into 5 bits.
- **The Anvil sheet (cards):** a well-shuffled 52-card deck played as knockout matches ("1 if the right card is higher"), 3 decks for 12 words.
- **The Forge sheet:** the two grids folded together by hand (XOR). If either source is good and was finished before the other was seen, the seed is fully random.
- **Hallmarks:** row and column parity marks (and an optional skew hallmark). Because they are XOR-linear, the Hammer's hallmarks folded with the Anvil's must equal the Forge's. That checks the hand folding and the word lookup by hand, and later lets an heir recheck the written words.
- **Assay:** each source sheet can be checked by a different person without that person learning the seed. The two sheets, each completed with its own last word, are also a valid Seed XOR pair for the seed.
- **The last word:** its checksum needs SHA-256, so two independent tools (for example VOIDFORGE and a SeedSigner) must agree on it, then on the fingerprint and first address.

## What we claim, and what we do not

Every single ingredient existed before: dice tables, XOR mixing, bias tests, Seed XOR, and two tools agreeing on the last word. The prior work we found is listed, with links, in `docs/damascus/prior-art.md`.

What we claim is the combination. As of 10 November 2026, we found no prior description of a BIP39 method that:

1. folds two different physical sources together by hand;
2. checks that folding, the word lookup and later the backup by hand with XOR-linear hallmarks; and
3. lets each source sheet be checked by a different person without revealing the seed.

If earlier work is found, we will credit it here.

## Proof of the date

- This record and the design documents below were published in this public repository under the tag `damascus-origin-2026-11-10`.
- The owner signs this file with the VOIDFORGE release key (`DAMASCUS-ORIGIN.md.asc`).
- The owner anchors this file's SHA-256 in the Bitcoin blockchain with OpenTimestamps (`DAMASCUS-ORIGIN.md.ots`). Anyone can verify it at opentimestamps.org.

The design files appear below with their SHA-256 fingerprints, under `docs/damascus/`. Early files use the working name "VOIDFORGE method" and the letters D (dice), C (cards) and E (result). These are the Hammer, Anvil and Forge sheets.

```
c691585fcabe5c4356a3928f685c2a78511b3b65d87a7959aa39698bb207dac6  ./bip39-binary-table-a4.pdf
ab7daf6f51c8748bf854867929aba08eaa3a7a1f5f673903c00bf69251751c7c  ./bip39-binary-table.html
5e45b076ac9108accd9538f93f2c5f8a3679b67c526a703b5f86bfd4a294da2f  ./bip39-binary-table.pdf
22bfd10e5dbe54744d6b4bc2dda91a2debba8650d8e7d1c81238280496b9f4e2  ./bip39-binary-table.png
8b22811e21dd3fc7f0ca3bf7731a57a80d84adcda4975122647699cba190a172  ./damascus-quick-guide.md
6e53652729d0b6fae3136a7b343164a5c75861b7ea64415c1fe0adecca4a2140  ./design-notes.md
9a26bfe3cac5e9d62d2a223a77089e31a6717c793ce4c07e4b07ed8fb9ba9747  ./forge-sheet-24-a4.pdf
1bb41fccf8911694e142064682d9b1d3f79df56db081ad69908a53fc0ba245c9  ./forge-sheet-24.html
471661a6ff0b55a1e378eb7c8ca69f9d4c7bf30bfcd1fb94f7fa1444e9fc6edf  ./forge-sheet-24.pdf
989e0fc157f363385c2cded2072e5861476f373a83da870488b50f8535f2e66d  ./forge-sheet-24.png
a0d19ae3ad398d927dd1d1198eb965e1743f87ad1c1e6c17553f13238a371cd5  ./forge-sheet-a4.pdf
04582628418801309cce8ae862b4071e02a3e83ee34b0ed5c296010182f9d72e  ./forge-sheet.html
f956e818239cab64e95d2c99a29f4f76feeb5b5858306640aba5167d5a3531cd  ./forge-sheet.pdf
d56bc25995361e61626757f491ea3afeef6ec1df280ffc4d68d17e9180a52b18  ./forge-sheet.png
fd77a94334e662e595eecbe983f4bda26937bb686d71d2ddf17ec44ba2639175  ./method.md
949ca179eb0922aa4d790d3cfec468bdef359a33c44befa4842d3bb54e5a02fe  ./prior-art.md
d4027324360485b55fb31c1b084812176f15f3a0cffee6d4b45cc39cc9ed7131  ./ref/build-sheet.js
345d99daa0a438885df8d8dfb487c80d8ad89ff99cb30763c2a98a8920af6c23  ./ref/examples/example-1.json
7ac4d84a7b9308ca8d37ae1e65ea7a82ac1f6cf89a097fecf5e329fb4377dad7  ./ref/examples/example-1.md
3813f44b4d37932e87c4248690d9016676c78d350b6a6703bf8fcfef8fe96433  ./ref/examples/example-2.json
7acd768b60ac9822f47cb720361f791ba12525220d916643afd94fd69f79ee07  ./ref/examples/example-2.md
95abc262f8f958055e22715aa3480060f9a7034a203b1f93ebecb1edbb4eede9  ./ref/examples/example-3.json
bc07d636908fa942fc3e23eef3eedf3c66c774e57c495f1b0c731e4683ba431b  ./ref/examples/example-3.md
8711a92eb9eff972049ddf0d6045d10cfacafba926301f2503ed4f337ba1921a  ./ref/forge.js
ed1b727378a6d68438d0815b04429a0f379afd8950f8a4e7cc7147db08dfeba7  ./ref/make-examples.js
211e3aac1af2525d975daa51cd8d1dd3167b9e5252489544bda8d196ce7671b7  ./ref/render.js
24da2e2e47f25b7ea80f290680191b03d8514258cf47c1d77d2f1c056e661b02  ./ref/results/render-results.txt
a977f2d7ccbe83ee608f81ff424ff038a8a6d0f0c869b6ad798cd57f87bcddce  ./ref/results/test-results.txt
cbb8c3e62c545407e5519da461b7fab55adea6cb65b6a952573e725d04c4536b  ./ref/test.js
00a69d26e6811f90c4eb72247f894686a4fb9540f3678ed244b48ae1cc8fa8bf  ./ref/transcript.js
3cb504f1f3ada6e7300d4e496d04872e6ae6a491cc9c60dba4487729988c1fb7  ./ref/vf.js
12f00e00e517b0cb42fef35c7bd2ddb88a0650ba0e4fe524cacb4b5fbd0a9da5  ./sim/bias.js
7d313fa57d410cc8b9e3756f0170a5f235b1a6ea51e799fae3d00ff87b595b73  ./sim/chi.py
626fcf75234c08764d45e0b4ec348c35a8667e615028516787e5d2290b07b892  ./sim/marks.js
38ff259182f3421904ea508e08c31bd91cfdd91298a53c5e0c313edf934e23d4  ./sim/prng.js
8e099da76096d761ff8bc31c3c9b48e1e2d32701a233bc75f1a95a01e8345d0a  ./sim/results-bias.txt
f8dde5f042248dc7eb570e1ea3d0a33538889fda3dd9f1f80816a65eee2d9d75  ./sim/results-marks.txt
7c3546e58617be2fde880979ad825263ed8bacf557b60f4a8ea39d9ce9996904  ./sim/results-unbias.txt
7d573ec198cd953a73aa00986aa2475d141647e9d7325657ac1f30f360818ad4  ./sim/sim.py
732f39546f9f02f1d9c068c22487167bb57a2b3db8ab9f1e1238549032bbddf1  ./sim/stats.js
3065e43e319cf32e4e3bfae5cba4c7572ac8cfb6e7a5a0489a321e3907757248  ./sim/unbias.js
aa61bd2d07765cf6faf35f9e671bff29ac4e6882fca36a403bcfb10e4a25a17b  ./trial/trial.html
488e19abec9da1a7ac26b6e2afa471d4d4e6cfb9d9584a2fcb769323b75bbb06  ./trial/trial.pdf
```
