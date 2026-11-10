"""SeedSigner's own final-word code, for tests/vfmethod.test.mjs (v2.14.0, the Damascus method).

Usage: python3 -I -B tests/vendor/seedsigner_final_word.py <path to SeedSigner's src folder>
(the folder that holds the seedsigner package, from a checkout of github.com/SeedSigner/seedsigner; it needs embit).

Reads one JSON object a line on stdin: {"words": [the first 11 or 23 words], "flips": "the 7 or 3 bits, Heads = 1"} and prints
the final word as JSON, one a line. It does what ToolsCalcFinalWordShowFinalWordView does for coin flips (views/tools_views.py):
the flips padded with zeros to 11 bits pick a word, that word is put last, and mnemonic_generation.calculate_checksum gives the
real final word. Nothing else from SeedSigner runs.
"""
import json
import sys

sys.path.insert(0, sys.argv[1])
from seedsigner.helpers import mnemonic_generation as mg  # noqa: E402

wordlist = mg.Seed.get_wordlist(mg.SettingsConstants.WORDLIST_LANGUAGE__ENGLISH)
for line in sys.stdin:
    if not line.strip():
        continue
    q = json.loads(line)
    flips = q["flips"]
    temp = wordlist[int(flips + "0" * (11 - len(flips)), 2)]
    print(json.dumps(mg.calculate_checksum(list(q["words"]) + [temp])[-1]))
