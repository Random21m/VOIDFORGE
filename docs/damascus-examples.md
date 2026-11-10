# Damascus method: worked examples

**Public: never put money on these.** Anyone can make these seeds from this page.

Each example lists what was written on the Hammer and Anvil sheets, and what VOIDFORGE's Check my sheets works out from them. Load them on the page: MAKE A SEED, the Damascus tab, Worked examples.

## Example 1 (12 words)

12 words. Dice: the digits of pi (only 1 to 6, read in pairs). Cards: a published shuffle.

**Public: never put money on this seed.**

### Hammer sheet: dice pairs, in the order thrown

```
14 15 26 53 53 23 46 26 43 33 25 24 11 63 35 15 24 44 52 31
64 62 62 62 34 25 34 21 16 21 46 51 32 23 66 43 44 65 55 22
```

### Anvil sheet: the card record, deck by deck

```
deck 1: 9D 3S AC 3D 9S 5D 2D 7C 4C TC 2S 8D JD QD JH TS 4D QS 8S AH AS 2H 7D 6D 3H KD 2C 9C 8H KS JC KC 5C KH 7H 4H 6C TD JS QH 3C 4S 6S 7S TH AD 5H 5S QC 9H 6H 8C
deck 2: JH 3D 5D 4C AS 8S 6S 6H 4S TS 8H TD KS KC 5S 5H JC TH AH QC AD 2C 4D KH 3H 4H 3S QD 9H 6C 2D QH 7S 8D QS TC 9S 6D 2H JD 7D KD 5C JS 7H 8C 3C 2S 9D 7C AC 9C
deck 3: AS 7H 6S 8S 3D 3S AC AH JS 9D JD 8C 9H 7S KD 5S 7D 2H 4H 9S 5H AD 7C 3C TC JC QC TH QD 6C 8D QS 4C 5D 6H TS KS 4D 6D TD 2D JH 4S 3H 8H 9C KH QH 2S KC 2C 5C
```

### Grid H

```
 1  001 0100 1111  R 0
 2  000 1101 0010  R 0
 3  100 0101 1110  R 0
 4  111 0001 1001  R 0
 5  001 1110 1101  R 1
 6  101 1010 1010  R 0
 7  011 1011 0101  R 1
 8  110 0001 0110  R 1
 9  101 0000 1000  R 1
10  010 0001 0011  R 0
11  011 1110 0110  R 1
12  000 0010       R 1
 M  111 1110 0011
```

Bias box: faces 1-6 came up 6, 11, 10, 9, 8, 8 times, 6 repeats: PASS.

### Grid A

```
 1  010 1001 1110  R 0
 2  001 1010 0101  R 1
 3  111 0011 0110  R 1
 4  101 1011 0101  R 1
 5  000 1000 0110  R 1
 6  000 1011 1111  R 1
 7  110 1111 1001  R 0
 8  110 1110 0000  R 1
 9  101 1111 0000  R 0
10  000 1101 0011  R 1
11  010 0111 1110  R 1
12  110 1100       R 0
 M  000 0000 0101
```

Bias boxes: deck 1: 25 ones, 3 neighbors, PASS; deck 2: 24 ones, 1 neighbors, PASS; deck 3: 21 ones, 2 neighbors, PASS.

### Grid F = H folded with A

```
 1  011 1101 0001  R 0  kick (978)
 2  001 0111 0111  R 1  confirm (376)
 3  011 0110 1000  R 1  home (873)
 4  010 1010 1100  R 1  few (685)
 5  001 0110 1011  R 0  coin (364)
 6  101 0001 0101  R 1  pencil (1302)
 7  101 0100 1100  R 1  praise (1357)
 8  000 1111 0110  R 0  burst (247)
 9  000 1111 1000  R 1  business (249)
10  010 1100 0000  R 1  fix (705)
11  001 1001 1000  R 0  credit (409)
12  110 1110       R 1  last word: swing (1761) to target (1776)
 M  111 1110 0110
```

Seal: M(H) 11111100011 folded with M(A) 00000000101 gives M(F) 11111100110. Row hallmarks: R(H) 000010111011, R(A) 011111010110, R(F) 011101101101. Skew hallmark K(F) 10011111110.

Last word: the last 7 bits 1101110 allow swing to target; the checksum picks **sword**.

**Words:** kick confirm home few coin pencil praise burst business fix credit sword

Master fingerprint 70b5da37. First address (BIP84, m/84'/0'/0'/0/0): bc1qk6763xzzpyx3vx6wcgmgeshj4s26wxlfmzns3k.

## Example 2 (12 words)

12 words. Dice: the digits of e. Cards: the card person saw the Hammer sheet first and placed the cards to steer the seed. It lands on a published BIP39 test phrase, and every check still passes: hallmarks catch mistakes, not cheating. This is why each sheet is folded closed before the other is seen.

**Public: never put money on this seed.**

### Hammer sheet: dice pairs, in the order thrown

```
12 12 45 45 23 53 62 41 35 26 62 45 24 36 55 46 66 62 24 66
33 53 54 54 51 32 15 25 16 64 24 24 66 31 32 35 21 14 13 56
```

### Anvil sheet: the card record, deck by deck

```
deck 1: 5D 3D 2S 3H 8D TH 7C KC 8H TD 4S 4C 7H 6H JD AC 5C 4D TC 6S JH KH QH QS KS 9H 7D 9C 6D 2C 3S 7S 2D 3C AS 2H QC 8S 9D KD 9S TS 8C JS 4H AH 6C QD JC 5S AD 5H
deck 2: 9D 4C 6H 7C TC KS QC 9H 3H 5C 6S 7H 3D TD JD 7S 2H AS 4S QH 8H 6C JH 5S 8S QD 3C AC KC QS 6D 5D 9C 3S TS JC TH 4H 9S AD 5H 8D 8C 4D KH KD 2S 2D 2C 7D JS AH
deck 3: JD JH 4C 2D KC 8H 7C 8D 9D 8C 9H 6D QH 6S AD AC 5C 4D QS 7S 6H 2H 3D 9C TS TC KH 2C 2S TH QC KD 5S 4H 7H 9S KS 3H 5H 4S 5D JS 8S TD QD AS 6C AH 3S JC 7D 3C
```

### Grid H

```
 1  000 0100 0011  R 1
 2  100 1110 0101  R 0
 3  011 1010 0100  R 1
 4  000 0100 1010  R 1
 5  110 0011 0000  R 0
 6  110 0101 1011  R 1
 7  011 1111 1011  R 1
 8  011 1111 1100  R 0
 9  000 1101 1111  R 1
10  110 1001 1000  R 1
11  110 0000 1100  R 0
12  101 0001       R 1
 M  010 0111 1111
```

Bias box: faces 1-6 came up 4, 10, 8, 9, 11, 10 times, 8 repeats: PASS.

### Grid A

```
 1  011 1011 1000  R 0
 2  011 0011 1010  R 0
 3  101 0101 1010  R 0
 4  111 1011 1101  R 1
 5  001 1000 1111  R 0
 6  011 1010 0110  R 0
 7  100 0001 0100  R 1
 8  100 1000 0011  R 0
 9  011 0010 0100  R 0
10  001 0100 0111  R 1
11  000 1111 0010  R 1
12  010 1110       R 0
 M  000 1010 1010
```

Bias boxes: deck 1: 27 ones, 3 neighbors, PASS; deck 2: 20 ones, 2 neighbors, PASS; deck 3: 17 ones, 0 neighbors, PASS.

### Grid F = H folded with A

```
 1  011 1111 1011  R 1  legal (1020)
 2  111 1101 1111  R 0  winner (2016)
 3  110 1111 1110  R 1  thank (1791)
 4  111 1111 0111  R 0  year (2040)
 5  111 1011 1111  R 0  wave (1984)
 6  101 1111 1101  R 1  sausage (1534)
 7  111 1110 1111  R 0  worth (2032)
 8  111 0111 1111  R 0  useful (1920)
 9  011 1111 1011  R 1  legal (1020)
10  111 1101 1111  R 0  winner (2016)
11  110 1111 1110  R 1  thank (1791)
12  111 1111       R 1  last word: wrap (2033) to zoo (2048)
 M  010 1101 0101
```

Seal: M(H) 01001111111 folded with M(A) 00010101010 gives M(F) 01011010101. Row hallmarks: R(H) 101101101101, R(A) 000100100110, R(F) 101001001011. Skew hallmark K(F) 11001101001.

Last word: the last 7 bits 1111111 allow wrap to zoo; the checksum picks **yellow**.

**Words:** legal winner thank year wave sausage worth useful legal winner thank yellow

Master fingerprint b8688df1. First address (BIP84, m/84'/0'/0'/0/0): bc1qgkju4yvvtuz0s8vqn837q396jezu2h8ex7gk98.

## Example 3 (24 words)

24 words. Dice: the digits of the square root of 2. Cards: a published shuffle, six decks.

**Public: never put money on this seed.**

### Hammer sheet: dice pairs, in the order thrown

```
41 42 13 56 23 35 41 62 42 65 66 15 36 43 16 63 32 44 62 13
53 53 43 26 41 52 35 13 46 23 12 22 42 43 65 55 32 12 64 41
21 43 53 14 13 22 26 65 25 55 25 55 51 15 22 65 14 15 51 65
24 53 45 66 21 42 51 41 64 16 55 23 22 34 43
```

### Anvil sheet: the card record, deck by deck

```
deck 1: 8C 4D 3S AH KH 3D KC JH 5H 2S KS AC 5C TD 5S AS JS QD 3C 6H 7D 7C QH 6D 4C 6C TC 2C TS 4S 9S 4H 2H 6S AD 3H 8H 7H JC 9C 9D 7S 8S 8D JD KD 5D QC 9H 2D QS TH
deck 2: 9D 7D AC KS JD QH 2S TD AS KH 6H QD 7C 4S 8C KD 8S JC TC QS 3S 4H QC 3H 9H 9S 6S 5C 3D 5H 2H 8H 2D KC 6C 3C 7H 6D AH 2C 5S TH 4D 8D JH JS 5D 9C AD TS 4C 7S
deck 3: 9S 5H 6D 8D QC TH QH AC 8H 3D 4D 2S 5S AH 4S 7H 9C 2H JS 9H 5D 2D KC 6H KS QD 6S JH 6C 3S JD AD 7C KH 3H 8S 4H TC 8C 7D 9D 3C 5C JC QS 7S TS TD 2C 4C AS KD
deck 4: 7H JD 4H 6H 9C AD KS KD 8C 7D 9H KC 8S 2H 2S TS 5H 4S 3H AH 3D 6D 3C JC 6C AC 5D 4C 3S QD 8H 9S 8D 5C TC TD 7S 5S AS 9D QH JH QC QS KH 7C 2D JS 2C 6S 4D TH
deck 5: JC 2C AC 3D 7S 5S 9D 4S 4D 9S 6S 5H TC 2D KH 8H 8D TS KD AH 3C TH 4C JH TD 4H 3H KS QH QC JS 5D KC 2S QS 6C JD 8C QD 6D 7C 9H 9C 3S 5C 6H 7H 2H AS 8S AD 7D
deck 6: 8C 3C KH 6H 4S QC KC TH 6C KS 9S 8S AC JS QH 7C 8D 2C 6S QS 7S JD TC 6D JH 9H 7H 9D 2H 4D 5H 2D 5D 7D 5C JC TS TD 5S AH 8H AD 3D 3S QD 4C 2S 9C KD AS 4H 3H
```

### Grid H

```
 1  001 0001 1000  R 1
 2  001 1111 0101  R 1
 3  011 1010 1001  R 0
 4  001 0000 0110  R 1
 5  011 1001 1111  R 0
 6  001 1110 1111  R 0
 7  001 0010 0110  R 0
 8  110 0101 0100  R 1
 9  000 0011 1010  R 0
10  010 1001 0010  R 0
11  100 0100 1000  R 1
12  111 0101 0100  R 0
13  011 1101 1010  R 1
14  110 0001 0110  R 1
15  010 0101 1100  R 1
16  111 1001 0100  R 0
17  000 1110 1000  R 0
18  100 0000 0100  R 0
19  101 0100 0010  R 0
20  100 0111 0001  R 1
21  111 0001 1111  R 0
22  111 0011 1111  R 1
23  110 0011 0001  R 1
24  111            R 1
 M  010 0011 1110
```

Bias box: faces 1-6 came up 14, 21, 19, 16, 19, 15 times, 17 repeats: PASS.

### Grid A

```
 1  000 0001 0010  R 0
 2  100 1100 0111  R 0
 3  000 1011 1000  R 0
 4  110 0110 0100  R 1
 5  101 1110 0110  R 1
 6  101 0111 0110  R 1
 7  101 1010 1001  R 0
 8  000 1111 0011  R 0
 9  100 1000 1100  R 0
10  010 1000 0011  R 0
11  101 0001 0111  R 0
12  000 0010 0101  R 1
13  111 1100 0110  R 1
14  101 1100 0110  R 0
15  110 0110 0101  R 0
16  011 1001 0110  R 0
17  111 1010 0010  R 0
18  100 0011 1011  R 0
19  110 0100 1000  R 0
20  000 0101 0100  R 1
21  101 1000 1011  R 0
22  010 1001 0011  R 1
23  010 0011 0010  R 0
24  111            R 1
 M  100 1010 0010
```

Bias boxes: deck 1: 18 ones, 2 neighbors, PASS; deck 2: 26 ones, 1 neighbors, PASS; deck 3: 19 ones, 1 neighbors, PASS; deck 4: 26 ones, 1 neighbors, PASS; deck 5: 18 ones, 3 neighbors, PASS; deck 6: 15 ones, 2 neighbors, PASS.

### Grid F = H folded with A

```
 1  001 0000 1010  R 1  candy (267)
 2  101 0011 0010  R 1  play (1331)
 3  011 0001 0001  R 0  giraffe (786)
 4  111 0110 0010  R 0  unable (1891)
 5  110 0111 1001  R 1  song (1658)
 6  100 1001 1001  R 1  nasty (1178)
 7  100 1000 1111  R 0  music (1168)
 8  110 1010 0111  R 1  stay (1704)
 9  100 1011 0110  R 0  nothing (1207)
10  000 0001 0001  R 0  acquire (18)
11  001 0101 1111  R 1  cloud (352)
12  111 0111 0001  R 1  until (1906)
13  100 0001 1100  R 0  logic (1053)
14  011 1101 0000  R 1  key (977)
15  100 0011 1001  R 1  mango (1082)
16  100 0000 0010  R 0  leopard (1027)
17  111 0100 1010  R 0  true (1867)
18  000 0011 1111  R 0  among (64)
19  011 0000 1010  R 0  genuine (779)
20  100 0010 0101  R 0  lucky (1062)
21  010 1001 0100  R 0  family (661)
22  101 1010 1100  R 0  remain (1453)
23  100 0000 0011  R 1  lesson (1028)
24  000            R 0  last word: abandon (1) to cable (256)
 M  110 1001 1100
```

Seal: M(H) 01000111110 folded with M(A) 10010100010 gives M(F) 11010011100. Row hallmarks: R(H) 110100010010111000010111, R(A) 000111000001100000010101, R(F) 110011010011011000000010. Skew hallmark K(F) 00101101110.

Last word: the last 3 bits 000 allow abandon to cable; the checksum picks **artist**.

**Words:** candy play giraffe unable song nasty music stay nothing acquire cloud until logic key mango leopard true among genuine lucky family remain lesson artist

Master fingerprint 116ab0ba. First address (BIP84, m/84'/0'/0'/0/0): bc1qflh2d4a2mud6x6rvkk63dzu55kz0h2uklskzy2.
