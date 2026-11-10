"""Krux's own KEF code as an oracle for tests/devbackup.test.mjs (v2.12.0).

Reads JSON on stdin: {"official": [...], "open": [...], "make": [...]} and prints what Krux's kef.py (selfcustody/krux,
src/krux/kef.py, fetched by tests/vendor/fetch.sh at the pinned commit 28d14c216006e278fd263afead3357becb83aa43, which is the same file
as in the tag v26.09.0) does with them:
- "open": {"envelope": hex, "password": text}: kef.unwrap and kef.Cipher(...).decrypt: the plaintext in hex, or null.
- "make": {"version", "id": hex, "field": the 3-byte iterations field as a number, "password", "entropy": hex}: kef.Cipher(...).encrypt with
  fail_unsafe left on (as Krux does) and kef.wrap: the envelope in hex, or null where Krux refuses to encrypt that data.
- "official": the same as "open", Krux's own test vectors (tests/test_encryption.py), to show that the stand-ins below are faithful.
kef.py is not changed. It imports three MicroPython modules (ucryptolib, uhashlib_hw, deflate) that do not exist in Python, so they are
supplied here as small stand-ins made from the `cryptography` package, hashlib and zlib; kef.py's own code does all the KEF rules: the
layouts, padding, checks, retries for NUL padding and the ID and iteration rules. The file's SHA-256 is checked first.
"""
import hashlib, importlib.util, io, json, os, sys, types, zlib
from pathlib import Path
from cryptography.hazmat.primitives.ciphers import Cipher as _C, algorithms, modes

SRC = Path(__file__).parent / "src" / "krux" / "src" / "krux" / "kef.py"
PINNED = "deb09c47bf20998696f11ed9b9fcc95bcb856b2def8428190c1044c1cf119a59"
COMMIT = "28d14c216006e278fd263afead3357becb83aa43"

raw = SRC.read_bytes()
if hashlib.sha256(raw).hexdigest() != PINNED:
    raise SystemExit("krux: kef.py is not the file of the pinned commit (run sh tests/vendor/fetch.sh)")

# ---- stand-ins for MicroPython's ucryptolib / uhashlib_hw / deflate ----
ucryptolib = types.ModuleType("ucryptolib")
ucryptolib.MODE_ECB, ucryptolib.MODE_CBC, ucryptolib.MODE_CTR, ucryptolib.MODE_GCM = 1, 2, 6, 7

class _AES:
    """ucryptolib.aes(key, mode, iv=None, nonce=None, mac_len=...): .encrypt, .decrypt, and for GCM .digest and .verify."""
    def __init__(self, key, mode, iv=None, nonce=None, mac_len=16):
        self.key, self.mode, self.mac_len = key, mode, mac_len
        if mode == ucryptolib.MODE_CBC:
            self.alg = modes.CBC(iv)
        elif mode == ucryptolib.MODE_ECB:
            self.alg = modes.ECB()
        elif mode == ucryptolib.MODE_CTR:
            if nonce is None or len(nonce) != 12:
                raise ValueError("CTR needs a 12-byte nonce")
            self.alg = modes.CTR(nonce + b"\0\0\0\0")      # Krux: the 12-byte nonce, then a 4-byte counter from 0
        elif mode == ucryptolib.MODE_GCM:
            self.iv = iv
        self.tag = None
    def encrypt(self, data):
        if self.mode == ucryptolib.MODE_GCM:
            e = _C(algorithms.AES(self.key), modes.GCM(self.iv)).encryptor()
            out = e.update(data) + e.finalize(); self.tag = e.tag; return out
        e = _C(algorithms.AES(self.key), self.alg).encryptor(); return e.update(data) + e.finalize()
    def decrypt(self, data):
        if self.mode == ucryptolib.MODE_GCM:       # decrypt without checking, then verify(): counter blocks start at iv || 00000002
            d = _C(algorithms.AES(self.key), modes.CTR(self.iv + b"\0\0\0\2")).decryptor(); out = d.update(data) + d.finalize()
            e = _C(algorithms.AES(self.key), modes.GCM(self.iv)).encryptor(); e.update(out); e.finalize(); self.tag = e.tag
            return out
        d = _C(algorithms.AES(self.key), self.alg).decryptor(); return d.update(data) + d.finalize()
    def digest(self):
        return self.tag
    def verify(self, tag):
        if self.tag[:len(tag)] != tag:
            raise ValueError("MAC check failed")
ucryptolib.aes = _AES

uhashlib_hw = types.ModuleType("uhashlib_hw")
uhashlib_hw.pbkdf2_hmac_sha256 = lambda key, salt, it: hashlib.pbkdf2_hmac("sha256", key, salt, it)
uhashlib_hw.sha256 = lambda data=b"": hashlib.sha256(data)

deflate = types.ModuleType("deflate")
class DeflateIO:
    """Raw deflate with a 1 KiB window (zlib wbits -10), as the KEF specification says."""
    def __init__(self, stream, *a, **k): self.s, self.buf = stream, b""
    def __enter__(self): return self
    def __exit__(self, *a):
        if a[0] is None and self.buf is not None and getattr(self, "w", False):
            c = zlib.compressobj(wbits=-10); self.s.write(c.compress(self.buf) + c.flush())
        return False
    def write(self, d): self.w = True; self.buf += d
    def read(self): return zlib.decompressobj(-15).decompress(self.s.read())
deflate.DeflateIO = DeflateIO
sys.modules.update({"ucryptolib": ucryptolib, "uhashlib_hw": uhashlib_hw, "deflate": deflate})

spec = importlib.util.spec_from_file_location("kef", str(SRC)); kef = importlib.util.module_from_spec(spec); sys.modules["kef"] = kef; spec.loader.exec_module(kef)

def opened(j):
    try:
        id_, version, iterations, payload = kef.unwrap(bytes.fromhex(j["envelope"]))
        p = kef.Cipher(j["password"], id_, iterations).decrypt(payload, version)
        return p.hex() if p else None
    except Exception as e:
        return None

def made(j):
    try:
        field = j["field"]; iterations = field * 10000 if field <= 10000 else field
        id_ = bytes.fromhex(j["id"]); v = j["version"]
        mode = kef.VERSIONS[v]["mode"]; iv = os.urandom(kef.MODE_IVS.get(mode, 0))
        payload = kef.Cipher(j["password"], id_, iterations).encrypt(bytes.fromhex(j["entropy"]), v, iv)
        return kef.wrap(id_, v, iterations, payload).hex()
    except Exception as e:
        return None

J = json.load(sys.stdin)
print(json.dumps({"krux_commit": COMMIT, "kef_sha256": hashlib.sha256(raw).hexdigest(), "kef_sha256_pinned": PINNED,
                  "official": [opened(j) for j in J.get("official", [])], "opened": [opened(j) for j in J.get("open", [])],
                  "made": [made(j) for j in J.get("make", [])]}))
