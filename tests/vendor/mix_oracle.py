"""Expected Coldcard words for "Check a Coldcard seed mix" (v2.10.0), for tests/vendor.test.mjs.

Since 1.5.1Q (Q) and 5.6.1 (Mk4, Mk5), a new Coldcard seed mixes the device's 256-bit TRNG seed with the user's dice rolls or
coin flips. View TRNG Words (1.5.2Q, 5.6.2) shows the device's part as 24 words. The files come from Coldcard/firmware at the
commit of release 1.5.3Q (tests/vendor/fetch.sh), and are checked against the SHA-256 below before anything is read.

- shared/seed.py: the firmware. Only read: the exact lines of the formula, the byte strings, the minimum counts and the
  "not random" limits are looked up, and the test stops if any of them is no longer there.
- docs/verify_seed_mix.py: Coinkite's own checker ("public domain"). Its pure functions (the wordlist, mnemonic24_to_entropy,
  entropy_to_mnemonic, derive_seed) are taken out with Python's ast module and run; nothing else of it runs (not main(), not
  its imports other than hashlib.sha256).
- testing/test_rolls.py and testing/test_ux.py: Coinkite's test vectors and the formula their device tests use, checked here.

Reads a JSON list of {"trng": 64 hex digits, "symbols": "...", "method": "d" or "c", "words": 12 or 24, "tmp": bool} on stdin
and prints, for each, the words the Coldcard shows or why it refuses.
"""
import ast, hashlib, json, re, sys
from pathlib import Path

SRC = Path(__file__).parent / "src" / "coldcard-mix"
PIN = {
    "shared/seed.py": "0fd3bd9b8211339de9ed674a186c19a2d7162248881e73001273fa5a70837395",
    "docs/verify_seed_mix.py": "53ea42d33954aa3a63143af74e3b9ebc29438b5aa7b6b4d0ad58d3e57347075e",
    "testing/test_rolls.py": "3da001e318c18075bead331466eac3a644960edf2ad64cfdb8272858a3425f80",
    "testing/test_ux.py": "bece6aeb9557e6d32fcf9fecee9b093bf213f6d0bb924034afaef8bed70340df",
}

def read(name):
    b = (SRC / name).read_bytes()
    if hashlib.sha256(b).hexdigest() != PIN[name]:
        raise SystemExit("Coldcard " + name + ": not the pinned file (SHA-256 differs)")
    return b.decode()

def need(text, pattern, what):
    m = re.search(pattern, text, re.S)
    if not m:
        raise SystemExit("Coldcard: the rule '" + what + "' is no longer in the pinned source")
    return m

def firmware_rules():
    s = read("shared/seed.py")
    need(s, r"DOMAIN_SEED = b'CC\\x01S'\n", "the seed domain is b'CC\\x01S'")
    need(s, r"METHOD_DICE = b'D'\nMETHOD_COIN = b'C'\nPURPOSE_MASTER = b'M'\nPURPOSE_EPHEMERAL = b'T'", "dice D, coin C, master M, temporary T")
    need(s, r"MIN_DICE_ROLLS = const\(50\)\nMIN_COIN_FLIPS = const\(128\)", "at least 50 rolls or 128 flips")
    need(s, r"DICE_ENTROPY = SymbolEntropy\(\s*'Dice Rolls', DICE_ENTROPY_STORY, '123456', MIN_DICE_ROLLS, METHOD_DICE,\s*0\.30,", "dice 1 to 6, refused over 30%")
    need(s, r"COIN_ENTROPY = SymbolEntropy\(\s*'Coin Flips', COIN_ENTROPY_STORY, '10', MIN_COIN_FLIPS, METHOD_COIN,\s*0\.65,", "coin 1 or 0, refused over 65%")
    need(s, r"async def collect_symbol_entropy\(spec\):.*?md = sha256\(b'CC\\x01' \+ spec\.method\).*?md\.update\(ch\.encode\(\)\).*?if \(max\(counter\.values\(\)\) / count\) > spec\.max_freq:.*?return None.*?return md\.digest\(\)", "the rolls are hashed with b'CC\\x01' + method, refused over the limit")
    need(s, r"mix = DOMAIN_SEED \+ purpose \+ method \+ base_seed \+ extra_entropy\n\s+return ngu\.hash\.sha256d\(mix\)", "the seed is sha256d(domain + purpose + method + TRNG seed + roll hash)")
    need(s, r"async def make_new_wallet\(nwords\):\s+seed = await generate_seed_with_user_entropy\(PURPOSE_MASTER\)", "New Seed Words uses purpose M")
    need(s, r"async def ephemeral_seed_generate\(nwords\):\s+seed = await generate_seed_with_user_entropy\(PURPOSE_EPHEMERAL\)", "a temporary seed uses purpose T")
    need(s, r"if nwords == 12:\s+seed = seed\[0:16\]", "12 words use the first 16 bytes")
    need(s, r"async def view_trng_words\(_menu, _idx, item\):.*?words = bip39\.b2a_words\(item\.arg\)\.split\(' '\).*?These 24 words encode the full 256-bit device seed", "View TRNG Words shows the 32-byte TRNG seed as 24 words")
    need(s, r"MenuItem\('View TRNG Words', f=view_trng_words, arg=base_seed\)", "View TRNG Words shows the seed that is mixed")
    return {"min": {"d": 50, "c": 128}, "max_freq": {"d": 0.30, "c": 0.65}, "alphabet": {"d": "123456", "c": "10"}}

def checker():
    # Takes only the pure parts of docs/verify_seed_mix.py and runs them, with hashlib's sha256 as their one import.
    src = read("docs/verify_seed_mix.py")
    tree = ast.parse(src)
    imports = [ast.unparse(n) for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom))]
    if imports != ["import argparse", "from hashlib import sha256"]:
        raise SystemExit("Coldcard verify_seed_mix.py: its imports changed: " + repr(imports))
    keep = [n for n in tree.body if (isinstance(n, ast.Assign) and [t.id for t in n.targets if isinstance(t, ast.Name)] in (["wl"], ["METHODS"]))
            or (isinstance(n, ast.FunctionDef) and n.name in ("mnemonic24_to_entropy", "entropy_to_mnemonic", "derive_seed"))]
    if len(keep) != 5:
        raise SystemExit("Coldcard verify_seed_mix.py: wl, METHODS and the three functions are no longer all there")
    ns = {"__builtins__": {"len": len, "ValueError": ValueError, "any": any, "int": int, "range": range, "next": next, "divmod": divmod}, "sha256": hashlib.sha256}
    exec(compile(ast.Module(body=keep, type_ignores=[]), "verify_seed_mix.py (pure parts)", "exec"), ns)
    if "b'CC\\x01' + method_id + symbols.encode()" not in src or "mix = b'CC\\x01S' + purpose + method_id + base_seed + user_entropy" not in src:
        raise SystemExit("Coldcard verify_seed_mix.py: the formula lines changed")
    return ns

def coinkite_vectors(ns):
    # testing/test_rolls.py: the all-zero TRNG words, 50 rolls '123456'*8+'12' and 128 flips '01'*64, both lengths.
    t = read("testing/test_rolls.py")
    base = ns["mnemonic24_to_entropy"](" ".join(["abandon"] * 23 + ["art"]))
    n = 0
    for name, symbols, method in (("test_trng_dice_mix", "123456" * 8 + "12", "d"), ("test_trng_coin_mix", "01" * 64, "c")):
        m = need(t, r"@pytest\.mark\.parametrize\('nwords, expected', \[\s*\(12, '([0-9a-f]{32})'\),\s*\(24, '([0-9a-f]{64})'\),\s*\]\)\s*def " + name, name)
        need(t, r"def " + name + r"\(.*?derive_seed\(base_seed, (rolls|flips), '" + method + r"', nwords\)", name + " uses derive_seed")
        for nw, want in ((12, m.group(1)), (24, m.group(2))):
            if ns["derive_seed"](base, symbols, method, nw).hex() != want:
                raise SystemExit("Coldcard " + name + " (" + str(nw) + " words): the checker does not give Coinkite's vector")
            n += 1
    u = read("testing/test_ux.py")
    need(u, r"dice_hash = hashlib\.sha256\(b'CC\\x01D' \+ rolls\.encode\(\)\)\.digest\(\)\s+mix = b'CC\\x01SMD' \+ base_seed \+ dice_hash\s+final_seed = hashlib\.sha256\(hashlib\.sha256\(mix\)\.digest\(\)\)\.digest\(\)\s+expected_seed = final_seed\[:16\] if nwords == 12 else final_seed", "the device test's dice formula")
    need(u, r"coin_hash = hashlib\.sha256\(b'CC\\x01C' \+ flips\.encode\(\)\)\.digest\(\)\s+mix = b'CC\\x01SMC' \+ base_seed \+ coin_hash", "the device test's coin formula")
    return {"base": base.hex(), "vectors": n}

def main():
    rules = firmware_rules()
    ns = checker()
    ck = coinkite_vectors(ns)
    out = []
    for c in json.load(sys.stdin):
        e = dict(c)
        s, m, nw = c["symbols"], c["method"], c["words"]
        base = bytes.fromhex(c["trng"])
        if any(ch not in rules["alphabet"][m] for ch in s) or len(s) < rules["min"][m]:
            e["refused"] = "too few or not " + rules["alphabet"][m]
        elif max(s.count(x) for x in set(s)) / len(s) > rules["max_freq"][m]:
            e["refused"] = "not random (over the limit)"
        else:
            seed = ns["derive_seed"](base, s, m, nw, tmp=c["tmp"])
            e["entropy"] = seed.hex()
            e["mnemonic"] = " ".join(ns["entropy_to_mnemonic"](seed))
            e["trng_words"] = " ".join(ns["entropy_to_mnemonic"](base))
        out.append(e)
    json.dump({"coinkite_vectors": ck, "cases": out}, sys.stdout)

main()
