"""Expected values for old Electrum seeds (Electrum before 2.0), for tests/test.js: tests/fixtures/old-electrum.json.

Run: sh tests/vendor/fetch.sh && python3 -I tests/fixtures/gen_old_electrum.py tests/vendor/src/electrum > tests/fixtures/old-electrum.json
Needs python3 with embit 0.8.0 (pip install embit==0.8.0), whose secp256k1 adds the points.

Electrum's source is read at the pinned commit (tests/vendor/fetch.sh) and each file's SHA-256 is checked first. Nothing else from
it is run: the word list is read with ast.literal_eval; mn_encode and mn_decode, two pure functions, are taken out of
electrum/old_mnemonic.py and run on their own; the key stretch, the address sequence and the seed-type rules are looked up line by
line in electrum/keystore.py and electrum/mnemonic.py (this stops if one is gone) and then worked out here with hashlib and embit.
Electrum's own test vectors are read from its tests/test_mnemonic.py and tests/test_wallet_vertical.py.
"""
import ast, hashlib, json, re, sys
from pathlib import Path
from embit.util import secp256k1 as S

COMMIT = "54ff65dfe1b77ef6e00f00f296a557d86c454ca0"
FILES = {
    "electrum/old_mnemonic.py": "9cf503acd21f86cf14c782e456bba4bb38a0999314da25fce899e0d930c39e68",
}
src = Path(sys.argv[1])
def read(name):
    b = (src / name).read_bytes()
    if name in FILES and hashlib.sha256(b).hexdigest() != FILES[name]:
        raise SystemExit(name + ": not the pinned file (SHA-256 differs)")
    return b.decode()
def need(text, pattern, what):
    if not re.search(pattern, text, re.S):
        raise SystemExit("the rule '" + what + "' is no longer in the pinned Electrum source")

om = read("electrum/old_mnemonic.py")
a = om.index("_words = ("); b = om.index("\n)", a)
words = list(ast.literal_eval(om[a + len("_words = "):b + 2]))
assert len(words) == 1626 and len(set(words)) == 1626
ns = {"wordlist": words, "n": len(words), "is_hex_str": lambda s: bool(re.fullmatch("[0-9a-fA-F]*", s)), "Sequence": list}
tree = ast.parse(om)
for f in tree.body:
    if isinstance(f, ast.FunctionDef) and f.name in ("mn_encode", "mn_decode"):
        f.returns = None
        for arg in f.args.args: arg.annotation = None
        exec(compile(ast.Module(body=[f], type_ignores=[]), "old_mnemonic.py", "exec"), ns)
mn_encode, mn_decode = ns["mn_encode"], ns["mn_decode"]

ks = read("electrum/keystore.py")
need(ks, r"encoded_hex_seed = hex_seed\.encode\('ascii'\)\s+x = encoded_hex_seed\s+for i in range\(100000\):\s+x = hashlib\.sha256\(x \+ encoded_hex_seed\)\.digest\(\)\s+return string_to_number\(x\)", "stretch_key: 100,000 rounds of SHA-256(x + seed)")
need(ks, r"return privkey\.get_public_key_hex\(compressed=False\)\[2:\]", "mpk: the uncompressed public key without 04")
need(ks, r"return string_to_number\(sha256d\(\(\"%d:%d:\"%\(n, for_change\)\)\.encode\('ascii'\) \+ bfh\(mpk\)\)\)", "get_sequence: SHA256d(n:for_change: + mpk)")
need(ks, r"public_key = master_public_key \+ z\*ecc\.GENERATOR\s+return public_key\.get_public_key_bytes\(compressed=False\)", "address key: mpk + z*G, uncompressed")
need(ks, r"if t == 'old':\s+if passphrase:\s+raise Exception\(\"'old'-type electrum seed cannot have passphrase\"\)", "old seeds have no passphrase")
mn = read("electrum/mnemonic.py")
need(mn, r"def is_old_seed\(seed: str\) -> bool:.*?seed = normalize_text\(seed\)\s+words = seed\.split\(\).*?old_mnemonic\.mn_decode\(words\).*?return is_hex or \(uses_electrum_words and \(len\(words\) == 12 or len\(words\) == 24\)\)", "is_old_seed: 12 or 24 words of the old list")
need(mn, r"def calc_seed_type\(x: str\) -> str:\s+num_words = len\(x\.split\(\)\)\s+if is_old_seed\(x\):\s+return 'old'", "calc_seed_type: old seeds first")

N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
def sha(b): return hashlib.sha256(b).digest()
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
def b58check(p):
    p = p + sha(sha(p))[:4]; v = int.from_bytes(p, "big"); s = ""
    while v: v, r = divmod(v, 58); s = B58[r] + s
    return "1" * (len(p) - len(p.lstrip(b"\0"))) + s
def h160(b): return hashlib.new("ripemd160", sha(b)).digest()
def stretch(hex_seed):
    e = hex_seed.encode("ascii"); x = e
    for _ in range(100000): x = sha(x + e)
    return int.from_bytes(x, "big")
def wallet(hex_seed, net=0x00, count=10):
    k = stretch(hex_seed); assert 0 < k < N
    mpk_pub = S.ec_pubkey_create(k.to_bytes(32, "big")); mpk = S.ec_pubkey_serialize(mpk_pub, S.EC_UNCOMPRESSED)[1:]
    out = {"hex": hex_seed, "mpk": mpk.hex(), "receive": [], "change": []}
    for chain, key in ((0, "receive"), (1, "change")):
        for i in range(count):
            z = int.from_bytes(sha(sha(("%d:%d:" % (i, chain)).encode("ascii") + mpk)), "big") % N
            p = S.ec_pubkey_parse(b"\x04" + mpk); S.ec_pubkey_tweak_add(p, z.to_bytes(32, "big"))   # p becomes mpk + z*G
            q = S.ec_pubkey_serialize(p, S.EC_UNCOMPRESSED)
            out[key].append(b58check(bytes([net]) + h160(q)))
    return out

tm = read("tests/test_mnemonic.py"); tw = read("tests/test_wallet_vertical.py")
m = re.search(r"class Test_OldMnemonic.*?seed = '([0-9a-f]+)'.*?words = '([a-z ]+)'", tm, re.S)
vec_mnemonic = {"hex": m.group(1), "words": m.group(2)}
assert " ".join(mn_encode(vec_mnemonic["hex"])) == vec_mnemonic["words"] and mn_decode(vec_mnemonic["words"].split()) == vec_mnemonic["hex"]
seed_types = []
blk = tm[tm.index('# "old"'):tm.index('# "standard"')]
for mm in re.finditer(r"\('([^']*)'( \* 4)?, '([a-z]*)'\),", blk):
    seed_types.append([mm.group(1) * (4 if mm.group(2) else 1), mm.group(3)])
assert len(seed_types) >= 8
wallets = []
for name in ("test_electrum_seed_old", "test_electrum_seed_old_odd_length_hex"):
    body = tw[tw.index("def " + name + "("):]; body = body[:body.index("\n    async def ", 10)]
    g = lambda pat: re.search(pat, body).group(1)
    v = {"test": name, "words": g(r"seed_words = '([a-z ]+)'"), "hex": g(r"seed_hex = '([0-9a-f]+)'"), "mpk": g(r"ks\.mpk, '([0-9a-f]+)'"),
         "receive0": g(r"get_receiving_addresses\(\)\[0\], '([1-9A-HJ-NP-Za-km-z]+)'"), "change0": g(r"get_change_addresses\(\)\[0\], '([1-9A-HJ-NP-Za-km-z]+)'")}
    assert mn_decode(v["words"].split()) == v["hex"]
    w = wallet(v["hex"], count=1)
    assert (w["mpk"], w["receive"][0], w["change"][0]) == (v["mpk"], v["receive0"], v["change0"]), name
    wallets.append(v)
cases = []
for i in range(6):
    h = hashlib.sha256(b"voidforge-old-electrum-%d" % i).hexdigest()[:64 if i == 5 else 32]
    ws = mn_encode(h); assert mn_decode(ws) == h
    c = wallet(h); c["words"] = " ".join(ws); cases.append(c)
t = wallet(cases[0]["hex"], net=0x6f, count=10); t["words"] = cases[0]["words"]
json.dump({"source": {"repository": "spesmilo/electrum on GitHub", "commit": COMMIT, "files": FILES},
           "words_sha256": hashlib.sha256(("\n".join(words) + "\n").encode()).hexdigest(), "words": words,
           "mnemonic_vector": vec_mnemonic, "seed_types": seed_types, "wallets": wallets, "cases": cases, "testnet": t},
          sys.stdout, indent=1)
print()
