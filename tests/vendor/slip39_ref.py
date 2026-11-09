"""SLIP39 shares from the reference implementation, for tests/slip39.test.mjs (v2.10.0).

Uses the library files of python-shamir-mnemonic (the SLIP39 reference by Trezor/SatoshiLabs) at the commit pinned in
tests/vendor/fetch.sh. Only the library itself runs (no command-line tool, no tests, no setup code): every file is
checked against the SHA-256 below before it is loaded, and the library uses only Python's standard library (hashlib,
hmac, secrets, dataclasses, typing, collections, os.path to read its word list).

Reads JSON on stdin: {"make": [...], "combine": [...]} and prints {"make": [...], "combine": [...]}.
- make: {"rolls", "bits", "gt", "groups": [[T, N], ...], "passphrase", "ext", "e"}. The master secret is the first
  bits/8 bytes of SHA-256 of the rolls; the reference's random source (RANDOM_BYTES, which its own comment says can be
  replaced for deterministic testing) is replaced by VOIDFORGE's stream, worked out here on its own from its description:
  block c = HMAC-SHA256(key = SHA-256(rolls), msg = "VOIDFORGE SLIP39 shares v1 " + settings + b"\\0" + c as 4 bytes), where settings ends with
  " p" + SHA-256(passphrase) in hex when there is a passphrase.
  Then generate_mnemonics makes the shares. Gives the groups of words, or {"error": ...}.
- combine: {"mnemonics": [...], "passphrase"}. Gives combine_mnemonics' master secret in hex, or {"error": ...}.
Run with python3 -I (isolated: nothing from the current directory or the user's site-packages is loaded).
"""
import hashlib, hmac, json, sys
from pathlib import Path

SRC = Path(__file__).resolve().parent / "src" / "shamir"
PINNED = {  # python-shamir-mnemonic at 9fcb9c807c185e06d6269b65f3d795d3c724da3b
    "shamir_mnemonic/__init__.py": "efc4925a7f1c88c9d65d9788f9539a0aa11a4d86decc8b9e8240898bddfcb648",
    "shamir_mnemonic/cipher.py": "a921f5e25841858737665017e730c35ded9add520d011d77b5e75f94f5288071",
    "shamir_mnemonic/constants.py": "94638d1aa55bbed5a0a7c7be5c1e482aeb66c01d7f5e7027669ef6e420328d7a",
    "shamir_mnemonic/rs1024.py": "33cf739f7bcb84f24811c76448e4d3d7621911b25b977bf682c1e1ef5736525b",
    "shamir_mnemonic/shamir.py": "c8ac0441d151c9469af32d795712a2711bc52490aa8265c1cda1d756520f728e",
    "shamir_mnemonic/share.py": "0cc9a0ffd49c229a4703519c858f851fcfa1d82a01668324387d9646d0d1635d",
    "shamir_mnemonic/utils.py": "ab320ad2b4bc988cb103130eabb3c776703d7abc63aa3f21d08a16891d126b57",
    "shamir_mnemonic/wordlist.py": "ffb25bb5785236023600c112701c3273a22fc83955330aa891707749974bf715",
    "shamir_mnemonic/wordlist.txt": "bcc4555340332d169718aed8bf31dd9d5248cb7da6e5d355140ef4f1e601eec3",
}
for name, want in PINNED.items():
    got = hashlib.sha256((SRC / name).read_bytes()).hexdigest()
    if got != want:
        raise SystemExit("python-shamir-mnemonic: " + name + " is not the pinned file (SHA-256 " + got + ")")
extra = sorted(p.name for p in (SRC / "shamir_mnemonic").iterdir() if p.is_file() and "shamir_mnemonic/" + p.name not in PINNED)
if extra:
    raise SystemExit("python-shamir-mnemonic: unexpected files next to the pinned ones: " + ", ".join(extra))
sys.path.insert(0, str(SRC))
import shamir_mnemonic  # noqa: E402
from shamir_mnemonic import shamir as ref  # noqa: E402

LABEL = b"VOIDFORGE SLIP39 shares v1 "


def stream(key, settings):
    msg = LABEL + settings.encode() + b"\0"
    state = {"buf": b"", "c": 0}

    def take(n):
        while len(state["buf"]) < n:
            state["buf"] += hmac.new(key, msg + state["c"].to_bytes(4, "big"), "sha256").digest()
            state["c"] += 1
        out, state["buf"] = state["buf"][:n], state["buf"][n:]
        return out
    return take


def make(c):
    try:
        h = hashlib.sha256(c["rolls"].encode()).digest()
        settings = "%d %d %s ext%d e%d" % (c["bits"], c["gt"], ",".join("%dof%d" % (t, n) for t, n in c["groups"]), 1 if c["ext"] else 0, c["e"])
        if c["passphrase"]:  # v2.10.0 review fix: a passphrase is in the label too, as " p" + its SHA-256 in hex
            settings += " p" + hashlib.sha256(c["passphrase"].encode()).hexdigest()
        ref.RANDOM_BYTES = stream(h, settings)
        groups = shamir_mnemonic.generate_mnemonics(c["gt"], [tuple(g) for g in c["groups"]], h[:c["bits"] // 8],
                                                    c["passphrase"].encode(), c["ext"], c["e"])
        return {"groups": groups, "secret": h[:c["bits"] // 8].hex()}
    except Exception as e:  # the reference refuses the settings
        return {"error": str(e)}


def combine(c):
    try:
        return {"secret": shamir_mnemonic.combine_mnemonics(c["mnemonics"], c["passphrase"].encode()).hex()}
    except Exception as e:
        return {"error": str(e)}


job = json.load(sys.stdin)
print(json.dumps({"make": [make(c) for c in job.get("make", [])], "combine": [combine(c) for c in job.get("combine", [])]}))
