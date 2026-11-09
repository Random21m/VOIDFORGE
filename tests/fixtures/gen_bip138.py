# Makes tests/fixtures/bip138/addresses.json with embit (an unrelated library): descriptors of many shapes (single key, multisig,
# Liana-style miniscript, Taproot script trees) built from the BIP48 keys of three public test phrases, with the first receive and
# change addresses embit derives. VOIDFORGE's descriptor reader (used by the BIP138 backup reader) must give exactly these.
# Run: python3 tests/fixtures/gen_bip138.py > tests/fixtures/bip138/addresses.json
import json, hashlib
from embit import bip39, bip32
from embit.descriptor import Descriptor
from embit.networks import NETWORKS
M = ["abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
     "legal winner thank year wave sausage worth useful legal winner thank yellow",
     "letter advice cage absurd amount doctor acoustic avoid letter advice cage above"]
NUMS = "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0"
def keys(net):
    coin = 1 if net == "test" else 0
    out = []
    for m in M:
        root = bip32.HDKey.from_seed(bip39.mnemonic_to_seed(m), version=NETWORKS[net]["xprv"])
        k = root.derive("m/48h/%dh/0h/2h" % coin).to_public()
        out.append("[%s/48h/%dh/0h/2h]%s" % (root.my_fingerprint.hex(), coin, k.to_base58(version=NETWORKS[net]["xpub"])))
    return out
H32 = hashlib.sha256(b"voidforge").hexdigest()
H20 = hashlib.new("ripemd160", b"voidforge").hexdigest()
T = [
 "wpkh(@0/<0;1>/*)", "sh(wpkh(@0/<0;1>/*))", "pkh(@0/<0;1>/*)", "tr(@0/<0;1>/*)",
 "wsh(sortedmulti(2,@0/<0;1>/*,@1/<0;1>/*,@2/<0;1>/*))", "sh(wsh(sortedmulti(2,@0/<0;1>/*,@1/<0;1>/*,@2/<0;1>/*)))",
 "wsh(multi(2,@2/<0;1>/*,@0/<0;1>/*,@1/<0;1>/*))", "sh(multi(1,@0/<0;1>/*,@1/<0;1>/*))", "sh(sortedmulti(2,@0/<0;1>/*,@1/<0;1>/*))",
 "wsh(sortedmulti(2,@0/0/*,@1/0/*))",
 "wsh(or_d(pk(@0/<0;1>/*),and_v(v:pkh(@1/<2;3>/*),older(52560))))",
 "wsh(andor(pk(@0/<0;1>/*),older(1000),pk(@1/<0;1>/*)))",
 "wsh(thresh(2,pk(@0/<0;1>/*),s:pk(@1/<0;1>/*),sln:older(144)))",
 "wsh(thresh(2,pk(@0/<0;1>/*),a:pk(@1/<0;1>/*),a:pk(@2/<0;1>/*)))",
 "wsh(or_i(and_v(v:pkh(@0/<0;1>/*),after(900000)),multi(2,@1/<0;1>/*,@2/<0;1>/*)))",
 "wsh(and_v(or_c(pk(@1/<0;1>/*),v:older(100)),pk(@0/<0;1>/*)))",
 "wsh(and_b(pk(@0/<0;1>/*),a:pk(@1/<0;1>/*)))",
 "wsh(or_b(pk(@0/<0;1>/*),a:pk(@1/<0;1>/*)))",
 "wsh(and_v(v:sha256(" + H32 + "),pk(@0/<0;1>/*)))",
 "wsh(and_v(v:hash256(" + H32 + "),pk(@0/<0;1>/*)))",
 "wsh(or_d(pk(@0/<0;1>/*),and_v(v:ripemd160(" + H20 + "),pk(@1/<0;1>/*))))",
 "wsh(or_d(pk(@0/<0;1>/*),and_v(v:hash160(" + H20 + "),pk(@1/<0;1>/*))))",
 "wsh(and_n(pk(@0/<0;1>/*),older(10)))",
 "wsh(or_i(pk(@0/<0;1>/*),pk(@1/<0;1>/*)))",
 "wsh(and_v(v:pk(@0/<0;1>/*),or_d(pk(@1/<0;1>/*),older(4194305))))",
 "wsh(c:or_i(pk_k(@0/<0;1>/*),pk_h(@1/<0;1>/*)))",
 "wsh(or_d(pk(@0/<0;1>/*),and_v(v:pk(@1/<0;1>/*),and_v(v:pk(@2/<0;1>/*),after(1900000000)))))",
 "wsh(and_v(v:pk(@0/<0;1>/*),dv:older(10)))" ,
 "wsh(andor(pk(@0/<0;1>/*),j:pk(@1/<0;1>/*),pk(@2/<0;1>/*)))",
 "wsh(or_d(pk(@0/<0;1>/*),and_v(v:pk(@1/<0;1>/*),n:older(5))))",
 "wsh(and_v(v:pk(@0/<0;1>/*),l:older(20)))",
 "wsh(and_v(v:pk(@0/<0;1>/*),u:older(20)))",
 "wsh(and_v(v:pk(@0/<0;1>/*),t:older(20)))",
 "wsh(thresh(1,pk(@0/<0;1>/*),s:pk(@1/<0;1>/*)))",
 "wsh(and_v(v:pk(@0/<0;1>/*),older(65536)))",
 "tr(" + NUMS + ",{multi_a(2,@0/<0;1>/*,@1/<0;1>/*),and_v(v:pk(@2/<0;1>/*),after(1900000000))})",
 "tr(@0/<0;1>/*,pk(@1/<0;1>/*))",
 "tr(@0/<0;1>/*,{pk(@1/<0;1>/*),{and_v(v:pk(@2/<0;1>/*),older(144)),sortedmulti_a(2,@0/<0;1>/*,@1/<0;1>/*)}})",
 "tr(" + NUMS + ",and_v(v:pk(@0/<0;1>/*),older(52560)))",
 "tr(@2/<0;1>/*,{{pk(@0/<0;1>/*),pk(@1/<0;1>/*)},and_v(v:pkh(@0/<2;3>/*),older(3))})",
]
out = []
for net in ["test", "main"]:
    K = keys(net)
    for t in T:
        if net == "main" and not t.startswith(("wsh(or_d(pk(@0/<0;1>/*),and_v(v:pkh", "tr(@0/<0;1>/*,{", "wsh(sortedmulti(2,@0/<0;1>")): continue
        s = t
        for i, k in enumerate(K): s = s.replace("@%d" % i, k)
        try: d = Descriptor.from_string(s)
        except Exception as e: print("# embit refuses", t, e, file=__import__("sys").stderr); continue
        multi = "<" in s
        rec = [d.derive(i, branch_index=0).address(NETWORKS[net]) if multi else d.derive(i).address(NETWORKS[net]) for i in range(3)]
        chg = [d.derive(i, branch_index=1).address(NETWORKS[net]) for i in range(3)] if multi else []
        out.append({"desc": s, "net": net, "receive": rec, "change": chg})
from importlib.metadata import version
print(json.dumps({"source": "embit " + version("embit"), "phrases": M, "vectors": out}, indent=1))
