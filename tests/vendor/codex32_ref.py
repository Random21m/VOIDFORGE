"""codex32 (BIP93) from three outside implementations, for tests/codex32.test.mjs (v2.11.0).

Uses only files tests/vendor/fetch.sh downloads at pinned commits, each checked against the SHA-256 below before it is used:
- the BIP's own Python reference code: the <source lang="python"> blocks of bip-0093.mediawiki (bitcoin/bips at a34f044),
  run on their own (they define functions and constants only);
- python-codex32, the reference implementation in the codex32 project's repository (BlockstreamResearch/codex32 at 607da05,
  reference/python-codex32/src/codex32: only the library files; it uses no other module);
- Coldcard's shared/codex32.py and docs/rolls_codex32.py at the commit of release 1.5.3Q (4e5ba88): only the functions
  Share.parse, generate_share and encode_seed are used (rolls_codex32.py's main, which reads the terminal, is never called).
Nothing else from these repositories runs.

Reads JSON on stdin and prints JSON:
- "decode": [string, ...] -> per string {"ref": python-codex32's verdict, "bip": ms32_decode's verdict, "cc": Coldcard's
  Share.parse verdict}; each verdict is {"ok": true, "k", "id", "idx", "seed" (hex, for a secret)} or {"ok": false}.
- "recover": [[share, ...], ...] -> the master seed (hex) each implementation gets for the set: {"ref", "bip", "cc"}
  (Coldcard only for the lengths it reads: 48, 74 and 127 characters).
- "make": [{"rolls", "bits", "k", "n"}, ...] -> the strings python-codex32 makes from VOIDFORGE's stream, worked out here on its own
  from its description: block c = HMAC-SHA256(key = SHA-256(rolls), msg = "VOIDFORGE codex32 shares v1 " + settings + b"\\0" + c as 4
  bytes), settings = "<bits> <k>of<n>" or "<bits> secret"; the identifier is the low 5 bits of the first 4 bytes, then each of the k - 1
  random shares a, c, d, ... takes ceil(bits / 5) bytes the same way. The secret is the master seed (the first bits / 8 bytes of
  SHA-256 of the rolls) with zero padding, and every other share is interpolated (interpolate_at).
- "rolls": [{"rolls", "bits", "id"}, ...] -> Coldcard's encode_seed(SHA-256(rolls)[:bits/8], id): its dice-only codex32 secret.
Run with python3 -I (isolated: nothing from the current directory or the user's site-packages is loaded).
"""
import hashlib, hmac, json, math, re, sys, types
from pathlib import Path

SRC = Path(__file__).resolve().parent / "src"
PINNED = {
    "bips/bip-0093.mediawiki": "c847c6e513b64ee6ab10975690757d64a875f77c0e75866a86b733f3985784ec",
    "codex32/reference/python-codex32/src/codex32/__init__.py": "64746fcaa1f3fef705cb0759833a5b3d9313adf12851e360daf3f53e8dd6ec01",
    "codex32/reference/python-codex32/src/codex32/bech32.py": "4299be8f33917d1eac1b9a38aeffa0cae90a829a4a7f36255bd9550ea8487d7c",
    "codex32/reference/python-codex32/src/codex32/bip93.py": "8a819729b5156043509b7a3d2d34761c918f38789f10b3bdaf863f4e9d2aed0d",
    "codex32/reference/python-codex32/src/codex32/checksums.py": "15fbee2c66e3d6826b81734c82722524f6d6e2a72362432fd6c2cb5d875c2487",
    "codex32/reference/python-codex32/src/codex32/errors.py": "b1c5c48d6d9c9486c9603eab2078fbc227c1369c574d502a1b7a8cb7c3e4c9cd",
    "coldcard-codex32/shared/codex32.py": "e2258b5ffa45ec0f3a1840670fc52e3d307b8a58b1d7f9b9feaa2003ec007469",
    "coldcard-codex32/docs/rolls_codex32.py": "cd20a66824f544972dc6dbe6f1a115f7ee746073465bf6f834a9e477890cc289",
}
for name, want in PINNED.items():
    got = hashlib.sha256((SRC / name).read_bytes()).hexdigest()
    if got != want:
        raise SystemExit("codex32 reference: " + name + " is not the pinned file (SHA-256 " + got + ")")
LIB = SRC / "codex32/reference/python-codex32/src"
extra = sorted(p.name for p in (LIB / "codex32").iterdir() if p.is_file() and "codex32/reference/python-codex32/src/codex32/" + p.name not in PINNED)
if extra:
    raise SystemExit("python-codex32: unexpected files next to the pinned ones: " + ", ".join(extra))

# 1. The BIP's own Python: its four <source lang="python"> blocks, in one namespace.
text = (SRC / "bips/bip-0093.mediawiki").read_text()
blocks = re.findall(r'<source lang="python">\n(.*?)</source>', text, re.S)
if len(blocks) != 4:
    raise SystemExit("BIP93: expected 4 Python blocks, found %d" % len(blocks))
BIP = {}
exec(compile("\n".join(blocks), "bip-0093.mediawiki", "exec"), BIP)

# 2. python-codex32 (the library files only).
sys.path.insert(0, str(LIB))
from codex32 import Codex32String  # noqa: E402

# 3. Coldcard's two files, each run as a module of its own (they define functions and constants; nothing runs on load
# except rolls_codex32.py's imports of argparse, sys and hashlib).
def load(name, rel):
    m = types.ModuleType(name)
    exec(compile((SRC / rel).read_text(), rel, "exec"), m.__dict__)
    return m
CC = load("cc_codex32", "coldcard-codex32/shared/codex32.py")
CCR = load("cc_rolls", "coldcard-codex32/docs/rolls_codex32.py")


def bits_to_bytes(values):  # the payload's 5-bit values, 8 to a byte, padding dropped (the BIP's rule)
    acc, bits, out = 0, 0, []
    for v in values:
        acc, bits = (acc << 5) | v, bits + 5
        if bits >= 8:
            bits -= 8
            out.append((acc >> bits) & 255)
    return bytes(out)


def v_ref(s):
    try:
        c = Codex32String(s)
        r = {"ok": True, "k": c.k, "id": c.ident, "idx": c.share_idx}
        if c.share_idx == "s":
            r["seed"] = c.data().hex()
        return r
    except Exception:
        return {"ok": False}


def v_bip(s):
    try:
        d = BIP["ms32_decode"](s)
    except Exception:
        d = None
    if d is None:
        return {"ok": False}
    cs = BIP["CHARSET"]
    r = {"ok": True, "k": cs[d[0]], "id": "".join(cs[x] for x in d[1:5]), "idx": cs[d[5]]}
    if r["idx"] == "s":
        r["seed"] = bits_to_bytes(d[6:]).hex()
    return r


def v_cc(s):
    try:
        c = CC.Share.parse(s)
        r = {"ok": True, "k": str(c.threshold), "id": c.uid, "idx": c.index}
        if c.index == "s":
            r["seed"] = c.to_seed_and_pad()[0].hex()
        return r
    except Exception:
        return {"ok": False}


def recover(shares):
    out = {}
    try:
        out["ref"] = Codex32String.interpolate_at([Codex32String(x) for x in shares], "s").data().hex()
    except Exception as e:
        out["ref"] = "error: " + str(e)
    try:
        cs = BIP["CHARSET"]
        data = [[cs.index(ch) for ch in x.lower()[3:]] for x in shares]
        s = BIP["ms32_recover"](data)
        d = BIP["ms32_decode"]("ms1" + "".join(cs[v] for v in s))
        out["bip"] = bits_to_bytes(d[6:]).hex() if d is not None and cs[d[5]] == "s" else "error: not a valid secret"
    except Exception as e:
        out["bip"] = "error: " + str(e)
    if len(shares[0]) in (48, 74, 127):
        try:
            out["cc"] = CC.generate_share([CC.Share.parse(x) for x in shares], "s").to_seed_and_pad()[0].hex()
        except Exception as e:
            out["cc"] = "error: " + str(e)
    return out


LABEL = b"VOIDFORGE codex32 shares v1 "
ORDER = "acdefghjklmnpqrtuvwxyz023456789"


def make(c):
    try:
        h = hashlib.sha256(c["rolls"].encode()).digest()
        bits, k, n = c["bits"], c["k"], c["n"]
        settings = "%d %s" % (bits, "%dof%d" % (k, n) if k else "secret")
        msg, buf, cnt = LABEL + settings.encode() + b"\0", b"", 0

        def take(m):
            nonlocal buf, cnt
            while len(buf) < m:
                buf += hmac.new(h, msg + cnt.to_bytes(4, "big"), "sha256").digest()
                cnt += 1
            out, buf = buf[:m], buf[m:]
            return out
        cs = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
        ident = "".join(cs[b & 31] for b in take(4))
        secret = Codex32String.from_seed(h[:bits // 8], "ms1%d%s" % (k, ident), 0)
        if k == 0:
            return {"strings": [secret.s]}
        L = math.ceil(bits / 5)
        shares = [Codex32String.from_unchecksummed_string("ms1%d%s%s%s" % (k, ident, ORDER[j], "".join(cs[b & 31] for b in take(L)))) for j in range(k - 1)]
        base = [secret] + shares
        for j in range(k - 1, n):
            shares.append(Codex32String.interpolate_at(base, ORDER[j]))
        return {"strings": [x.s for x in shares]}
    except Exception as e:
        return {"error": str(e)}


def rolls(c):
    seed = hashlib.sha256(c["rolls"].encode("ascii")).digest()[:c["bits"] // 8]
    return CCR.encode_seed(seed, c["id"])


job = json.load(sys.stdin)
print(json.dumps({
    "decode": [{"ref": v_ref(s), "bip": v_bip(s), "cc": v_cc(s)} for s in job.get("decode", [])],
    "recover": [recover(x) for x in job.get("recover", [])],
    "make": [make(c) for c in job.get("make", [])],
    "rolls": [rolls(c) for c in job.get("rolls", [])],
}))
