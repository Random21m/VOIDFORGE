"""Expected words from the device makers' own dice rules, for tests/vendor.test.mjs.

Reads a JSON list of {"rolls": "...", "words": 12 or 24} on stdin and prints what SeedSigner, Coldcard and Keystone
make from those rolls. The makers' code is not run (it is downloaded code): instead, the exact lines that make the
words are looked up in their source at the pinned commits (tests/vendor/fetch.sh), and the test stops if any of them is
no longer there. The words are then worked out by those rules with Python's SHA-256 and embit's BIP39 (the library
SeedSigner itself uses):
- SeedSigner (src/seedsigner/helpers/mnemonic_generation.py): SHA-256 of the roll digits; 50 rolls give the first 16
  bytes (12 words), 99 rolls all 32 (24 words).
- Coldcard (shared/seed.py, add_dice_rolls and approve_word_list): SHA-256 of every roll typed; at least 50 rolls for
  12 words and 99 for 24; refused when any face is more than 30% of the rolls; 12 words use the first 16 bytes.
- Keystone (gui_dice_rolls_widgets.c, gui_model.c): each 6 typed as 0, then SHA-256; at least 50 rolls (100 for 24
  words), at most 256; 16 or 32 bytes of the hash.
"""
import hashlib, json, re, sys
from pathlib import Path
from embit import bip39

SRC = Path(__file__).parent / "src"

def need(text, pattern, who, what):
    if not re.search(pattern, text, re.S):
        raise SystemExit(who + ": the rule '" + what + "' is no longer in the pinned source")

def rules():
    ss = (SRC / "seedsigner/src/seedsigner/helpers/mnemonic_generation.py").read_text()
    need(ss, r"DICE__NUM_ROLLS__12WORD = 50\b", "SeedSigner", "50 rolls for 12 words")
    need(ss, r"DICE__NUM_ROLLS__24WORD = 99\b", "SeedSigner", "99 rolls for 24 words")
    need(ss, r"def generate_mnemonic_from_dice\(roll_data.*?entropy_bytes = hashlib\.sha256\(roll_data\.encode\(\)\)\.digest\(\)\s+if len\(roll_data\) == DICE__NUM_ROLLS__12WORD:.*?entropy_bytes = entropy_bytes\[:16\]", "SeedSigner", "SHA-256 of the rolls, 16 bytes for 50 rolls")
    cc = (SRC / "coldcard/shared/seed.py").read_text()
    need(cc, r"threshold = 99 if sec_bit > 128 else 50", "Coldcard", "at least 50 or 99 rolls")
    need(cc, r"md = sha256\(seed\)", "Coldcard", "the hash starts from the empty seed")
    need(cc, r"if ch in '123456':.*?md\.update\(ch\)", "Coldcard", "every roll is hashed")
    need(cc, r"bad_dist = any\(\(v / count\) > 0\.30 for _, v in counter\.items\(\)\)\s+if bad_dist:\s+if enforce:\s+await ux_show_story\(BAD_DICE_MSG\)\s+return 0, seed", "Coldcard", "refused when one face is more than 30%")
    need(cc, r"count, seed = await add_dice_rolls\(count, seed, True, nwords, enforce=True\)", "Coldcard", "new seeds enforce the rules")
    need(cc, r"if nwords == 12:\s+seed = seed\[0:16\]", "Coldcard", "12 words use the first 16 bytes")
    kw = (SRC / "keystone/src/ui/gui_widgets/gui_dice_rolls_widgets.c").read_text()
    km = (SRC / "keystone/src/ui/gui_model/gui_model.c").read_text()
    num = lambda name: int(re.search(r"#define\s+" + name + r"\s+(\d+)", kw).group(1))
    ks = {"min12": num("DICE_ROLLS_128_BIT_MIN_LEN"), "min24": num("DICE_ROLLS_256_BIT_MIN_LEN"), "max": num("DICE_ROLLS_MAX_LEN")}
    need(kw, r"if \(c == '6'\) \{\s*temp\[i\] = '0';", "Keystone", "each 6 is typed as 0")
    need(kw, r"sha256\(\(struct sha256 \*\)hash, temp, rollsLen\)", "Keystone", "SHA-256 of the rolls")
    need(km, r"entropyLen = \(mnemonicNum == 24\) \? 32 : 16;", "Keystone", "16 or 32 bytes of the hash")
    need(km, r"if \(mnemonicNum == 24 && SecretCacheGetDiceRollsLen\(\) < 100\)", "Keystone", "100 rolls for 24 words")
    return ks

def words(h, n):
    return bip39.mnemonic_from_bytes(h[:32 if n == 24 else 16])

def main():
    ks = rules()
    out = []
    for c in json.load(sys.stdin):
        r, n = c["rolls"], c["words"]
        e = {"rolls": r, "words": n}
        e["seedsigner"] = {"words": words(hashlib.sha256(r.encode()).digest(), n)} if len(r) == {12: 50, 24: 99}[n] else {"refused": "takes exactly %d rolls" % {12: 50, 24: 99}[n]}
        if len(r) < {12: 50, 24: 99}[n]:
            e["coldcard"] = {"refused": "too few rolls"}
        elif any(r.count(f) / len(r) > 0.30 for f in "123456"):
            e["coldcard"] = {"refused": "one face is more than 30% of the rolls"}
        else:
            e["coldcard"] = {"words": words(hashlib.sha256(r.encode()).digest(), n)}
        if len(r) < (ks["min24"] if n == 24 else ks["min12"]):
            e["keystone"] = {"refused": "too few rolls"}
        elif len(r) > ks["max"]:
            e["keystone"] = {"refused": "too many rolls"}
        else:
            e["keystone"] = {"words": words(hashlib.sha256(r.replace("6", "0").encode()).digest(), n)}
        out.append(e)
    json.dump({"keystone_rules": ks, "cases": out}, sys.stdout)

main()
