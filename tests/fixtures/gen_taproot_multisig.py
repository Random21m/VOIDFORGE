# Makes tests/fixtures/taproot-multisig/wallets.json with embit (an unrelated library), for v2.11.0 Taproot multisig:
# tr(<unspendable internal xpub>/<0;1>/*, sortedmulti_a(M, keys at m/48'/coin'/0'/3')) with the first 10 receive and change
# addresses, and the receive and change descriptors as embit writes them, with embit's descriptor checksum.
# The internal key is worked out here, apart from the page, by the rule in libnunchuk (nunchuk-io/libnunchuk b3fae992,
# src/descriptor.cpp GetUnspendableXpub): BIP341's point H as the key, SHA-256 of the cosigners' sorted 33-byte account
# public keys as the chain code, depth 0, parent fingerprint 0, child number 0.
# Run: python3 tests/fixtures/gen_taproot_multisig.py > tests/fixtures/taproot-multisig/wallets.json
import json, hashlib
from embit import bip39, bip32, ec
from embit.descriptor import Descriptor
from embit.descriptor.checksum import add_checksum
from embit.networks import NETWORKS
P = ["abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
     "legal winner thank year wave sausage worth useful legal winner thank yellow",
     "letter advice cage absurd amount doctor acoustic avoid letter advice cage above",
     "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong",
     "all hour make first leader extend hole alien behind guard gospel lava path output census museum junior mass reopen famous sing advance salt reform"]
H = "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0"
def nums_xpub(pubs, net):
    cc = hashlib.sha256(b"".join(sorted(set(pubs)))).digest()
    k = bip32.HDKey(ec.PublicKey.parse(bytes.fromhex("02" + H)), cc, version=NETWORKS[net]["xpub"], depth=0, fingerprint=b"\x00" * 4, child_number=0)
    return k.to_base58()
out = []
for net, m, idx in [("main", 2, [0, 1, 2]), ("test", 2, [0, 1, 2]), ("main", 3, [0, 1, 2, 3, 4]), ("test", 2, [3, 4]), ("main", 1, [1, 3])]:
    coin = 1 if net == "test" else 0
    keys, pubs = [], []
    for i in idx:
        root = bip32.HDKey.from_seed(bip39.mnemonic_to_seed(P[i]), version=NETWORKS[net]["xprv"])
        k = root.derive("m/48h/%dh/0h/3h" % coin).to_public()
        pubs.append(k.key.sec())
        keys.append({"fp": root.my_fingerprint.hex(), "xpub": k.to_base58(version=NETWORKS[net]["xpub"]), "path": "48h/%dh/0h/3h" % coin})
    ks = sorted("[%s/%s]%s" % (k["fp"], k["path"], k["xpub"]) for k in keys)
    nx = nums_xpub(pubs, net)
    body = lambda b: "tr(%s/%s/*,sortedmulti_a(%d,%s))" % (nx, b, m, ",".join(x + "/" + b + "/*" for x in ks))
    d = Descriptor.from_string(body("<0;1>"))
    rec = [d.derive(i, branch_index=0).address(NETWORKS[net]) for i in range(10)]
    chg = [d.derive(i, branch_index=1).address(NETWORKS[net]) for i in range(10)]
    d0, d1 = Descriptor.from_string(body("0")), Descriptor.from_string(body("1"))
    assert [d0.derive(i).address(NETWORKS[net]) for i in range(10)] == rec and [d1.derive(i).address(NETWORKS[net]) for i in range(10)] == chg
    out.append({"net": net, "m": m, "phrases": idx, "keys": keys, "nums": nx, "receive_desc": add_checksum(d0.to_string()), "change_desc": add_checksum(d1.to_string()), "multipath_desc": add_checksum(d.to_string()), "receive": rec, "change": chg})
from importlib.metadata import version
print(json.dumps({"source": "embit " + version("embit"), "phrases": P, "wallets": out}, indent=1))
