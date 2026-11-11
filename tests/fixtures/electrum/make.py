# Makes the Electrum wallet files for tests/recover.test.mjs with Electrum itself (spesmilo/electrum, installed from source),
# offline, from public test seeds only. Run with the venv's python: python -I make.py OUTDIR
import faulthandler; faulthandler.dump_traceback_later(120, exit=True)
import sys, os, json, shutil, tempfile, hashlib, base64, ast
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
tmp = tempfile.mkdtemp()
from electrum.simple_config import SimpleConfig
from electrum import constants, keystore, bitcoin
from electrum.wallet import restore_wallet_from_text, Wallet, Multisig_Wallet, Standard_Wallet
from electrum.wallet_db import WalletDB
from electrum.storage import WalletStorage, StorageEncryptionVersion
from electrum.version import ELECTRUM_VERSION
from electrum import crypto

from electrum.util import create_and_start_event_loop
_loop, _stop, _thread = create_and_start_event_loop()
config = SimpleConfig({'electrum_path': tmp, 'offline': True})
PW = "test password"
expected = {"electrum_version": ELECTRUM_VERSION, "cases": {}}

def summary(w):
    # the first 10 of each, made by Electrum's own derive_address (a file's gap limit can be below 10, as in Electrum 1.x)
    if hasattr(w, "derive_address"): d = {"recv": [w.derive_address(0, i) for i in range(10)], "change": [w.derive_address(1, i) for i in range(10)]}
    else: d = {"recv": w.get_receiving_addresses()[:10], "change": w.get_change_addresses()[:10]}
    ks = w.get_keystores()
    d["keystores"] = []
    for k in ks:
        e = {"type": k.type}
        try: e["fp"] = k.get_root_fingerprint()
        except Exception: pass
        try: e["derivation"] = k.get_derivation_prefix()
        except Exception: pass
        if hasattr(k, "xpub"): e["xpub"] = k.xpub
        d["keystores"].append(e)
    d["wallet_type"] = w.wallet_type
    d["txin_type"] = getattr(w, "txin_type", None)
    d["labels"] = len(w.db.get("labels", {}))
    return d

def reopen(path, password, encrypted_file):
    st = WalletStorage(path)
    if encrypted_file:
        st.decrypt(password)
    db = WalletDB(st.read(), storage=None, upgrade=True)
    return Wallet(db, config=config)

def case(name, text, password=None, encrypt_file=False, passphrase=None, labels=None, secrets=None):
    path = os.path.join(out, name)
    if os.path.exists(path): os.remove(path)
    r = restore_wallet_from_text(text, path=path, config=config, passphrase=passphrase, password=password, encrypt_file=encrypt_file)
    w = r["wallet"]
    if labels:
        for k, v in labels.items(): w.set_label(k, v)
        w.save_db()
    w2 = reopen(path, password, encrypt_file)
    s = summary(w2)
    s["password"] = password
    s["encrypted_file"] = encrypt_file
    if secrets: s.update(secrets(w2, password))
    expected["cases"][name] = s
    return w2

seg = "bitter grass shiver impose acquire brush forget axis eager alone wine silver"
std = "cycle rocket west magnet parrot shuffle foot correct salt library feed song"
old = "powerful random nobody notice nothing important anyway look away hidden message over"
bip39 = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

def seedsec(w, pw):
    k = w.keystore
    return {"seed": k.get_seed(pw), "passphrase": k.get_passphrase(pw) if hasattr(k, "get_passphrase") else "", "xprv": k.get_master_private_key(pw) if hasattr(k, "get_master_private_key") else None}

case("el-segwit-plain.json", seg, labels={"bc1q3g5tmkmlvxryhh843v4dz026avatc0zzr6h3af": "First payment", "bc1qdy94n2q5qcp0kg7v9yzwe6wvfkhnvyzje7nx2p": "Savings"}, secrets=seedsec)
case("el-segwit-pw.json", seg, password=PW, secrets=seedsec)
case("el-segwit-encrypted", seg, password=PW, encrypt_file=True, secrets=seedsec)
case("el-standard-ext-pw.json", std, password=PW, passphrase="Satoshi Nakamoto", secrets=seedsec)
case("el-old-pw.json", old, password=PW, secrets=lambda w, pw: {"seed": w.keystore.get_seed(pw), "mpk": w.keystore.mpk})
case("el-old-plain.json", old, secrets=lambda w, pw: {"seed": w.keystore.get_seed(pw), "mpk": w.keystore.mpk})

# BIP39 seed, BIP84 account, as Electrum's wizard does it: only the account xprv is kept (keystore.from_bip43_rootseed)
def bip39_case(name, deriv, password):
    path = os.path.join(out, name)
    if os.path.exists(path): os.remove(path)
    st = WalletStorage(path)
    db = WalletDB('', storage=st, upgrade=True)
    k = keystore.from_bip43_rootseed(keystore.bip39_to_seed(bip39, passphrase=""), derivation=deriv)
    k.update_password(None, password)
    db.put('keystore', k.dump()); db.put('wallet_type', 'standard')
    db.set_keystore_encryption(bool(password))
    w = Wallet(db, config=config); w.synchronize(); w.save_db()
    w2 = reopen(path, password, False)
    s = summary(w2); s["password"] = password; s["encrypted_file"] = False
    s["xprv"] = w2.keystore.get_master_private_key(password)
    expected["cases"][name] = s
bip39_case("bip39-84-pw.json", "m/84'/0'/0'", PW)
bip39_case("bip39-49.json", "m/49'/0'/0'", None)

zpub = "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs"
case("zpub-watch.json", zpub)
tv1 = "xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi"
case("xprv-master-pw.json", tv1, password=PW, secrets=lambda w, pw: {"xprv": w.keystore.get_master_private_key(pw)})

# imported keys: two keys made from a public phrase (sha256 of it), one legacy and one native SegWit
from electrum.bitcoin import serialize_privkey
k1 = hashlib.sha256(b"voidforge public test key 1").digest(); k2 = hashlib.sha256(b"voidforge public test key 2").digest()
wifs = serialize_privkey(k1, True, "p2pkh") + " " + serialize_privkey(k2, True, "p2wpkh")
def imp_secrets(w, pw):
    return {"keys": sorted(w.export_private_key(a, pw) for a in w.get_addresses()), "addresses": sorted(w.get_addresses())}
case("imported-keys-pw.json", wifs, password=PW, secrets=imp_secrets)
case("imported-addresses.json", "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu 1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2 3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
     labels={"1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2": "Old address"},
     secrets=lambda w, pw: {"addresses": sorted(w.get_addresses())})

# multisig 2-of-2, native SegWit (p2wsh): one Electrum seed (made for multisig, as the wizard does) and one Zpub
def ms_case(name, password):
    path = os.path.join(out, name)
    if os.path.exists(path): os.remove(path)
    st = WalletStorage(path)
    db = WalletDB('', storage=st, upgrade=True)
    k1 = keystore.from_seed(seg, passphrase=None, for_multisig=True)
    k1.update_password(None, password)
    k2 = keystore.from_seed(std, passphrase=None, for_multisig=True)
    # make cosigner 2 a Zpub: take k2's xpub and convert it to the p2wsh header Electrum uses for this wallet
    from electrum.bip32 import BIP32Node
    x2 = BIP32Node.from_xkey(k2.xpub)._replace(xtype=BIP32Node.from_xkey(k1.xpub).xtype).to_xpub()
    db.put('x1', k1.dump()); db.put('x2', keystore.from_xpub(x2).dump()); db.put('wallet_type', '2of2')
    db.set_keystore_encryption(bool(password))
    w = Wallet(db, config=config); w.synchronize(); w.save_db()
    w2 = reopen(path, password, False)
    s = summary(w2); s["password"] = password; s["encrypted_file"] = False; s["seed"] = w2.keystore.get_seed(password)
    expected["cases"][name] = s
ms_case("multisig-2of2-pw.json", PW)

# a wallet file with JSON patches appended (Electrum's partial writes): write a plain wallet, then add a label with partial writes on
def partial_case(name):
    path = os.path.join(out, name)
    if os.path.exists(path): os.remove(path)
    restore_wallet_from_text(seg, path=path, config=config)
    st = WalletStorage(path, allow_partial_writes=True)
    db = WalletDB(st.read(), storage=st, upgrade=True)
    w = Wallet(db, config=config)
    w.set_label("bc1q3g5tmkmlvxryhh843v4dz026avatc0zzr6h3af", "Added later")
    w.set_label("bc1qdy94n2q5qcp0kg7v9yzwe6wvfkhnvyzje7nx2p", "Added later too")
    db.write()
    raw = open(path).read()
    assert ",\n" in raw[raw.rfind("}") - 2000:], "no patch appended"
    w2 = reopen(path, None, False)
    s = summary(w2); s["password"] = None; s["encrypted_file"] = False; s["seed"] = w2.keystore.get_seed(None)
    expected["cases"][name] = s
partial_case("el-segwit-patched.json")


# ---- hand-made older formats, written exactly as the old Electrum code wrote them, then opened by today's Electrum to check them
from electrum.crypto import pw_encode
from electrum.wallet_db import WalletDB as _WDB
def load_text(text, password):
    db = _WDB(text, storage=None, upgrade=True)
    return Wallet(db, config=config)
# Electrum 1.x (lib/wallet.py of 1.9.8: WalletStorage.write is repr(self.data), read is ast.literal_eval; pw_encode is
# base64(iv + AES-256-CBC(sha256d(password)))). Written as Python 2 wrote it: u'' strings, integer keys.
ks_old = keystore.from_seed(old, passphrase=None)
old_hex = ks_old._get_hex_seed(None)
mpk = ks_old.mpk
from electrum.bitcoin import pubkey_to_address
imp_wif = serialize_privkey(k1, True, "p2pkh", internal_use=False).split(":")[1]
from electrum_ecc import ECPrivkey
imp_addr = pubkey_to_address("p2pkh", ECPrivkey(k1).get_public_key_hex(compressed=True))
w1 = ("{'accounts': {0: {0: [u'1FJEEB8ihPMbzs2SkLmr37dHyRFzakqUmo'], 1: []}}, 'fee_per_kb': 20000, 'gap_limit': 5, "
      "'imported_keys': {u'" + imp_addr + "': u'" + pw_encode(imp_wif, PW, version=1) + "'}, "
      "'labels': {u'1FJEEB8ihPMbzs2SkLmr37dHyRFzakqUmo': u'Caf\\xe9 \\u2615', u'" + imp_addr + "': u'Imported'}, "
      "'master_public_key': u'" + mpk + "', 'seed': '" + pw_encode(old_hex, PW, version=1) + "', 'seed_version': 4, "
      "'use_change': True, 'use_encryption': True, 'contacts': [], 'frozen_addresses': [], 'addr_history': {}, 'transactions': {}}")
open(os.path.join(out, "electrum-1x-default_wallet"), "w").write(w1)
w = load_text(w1, PW)
s = summary(w); s["password"] = PW; s["encrypted_file"] = False; s["seed"] = w.keystore.get_seed(PW); s["hex_seed"] = old_hex
s["imported_keys"] = {imp_addr: imp_wif}; s["labels_in_file"] = 2
expected["cases"]["electrum-1x-default_wallet"] = s
# Electrum 2.0 to 2.6 (lib/wallet.py of 2.0: storage is json.dumps(indent=4, sort_keys=True); NewWallet keeps the root xpub as
# master_public_keys["x/"] and its xprv, encrypted, as master_private_keys["x/"]; seed_version 11)
ks_std = keystore.from_seed(std, passphrase=None)
xprv_std = ks_std.get_master_private_key(None)
w2 = json.dumps({"accounts": {"0": {"xpub": ks_std.xpub, "0": [], "1": []}}, "labels": {"0": "Main account"}, "master_private_keys": {"x/": pw_encode(xprv_std, PW, version=1)},
  "master_public_keys": {"x/": ks_std.xpub}, "seed": pw_encode(std, PW, version=1), "seed_version": 11, "use_encryption": True, "wallet_type": "standard", "gap_limit": 20}, indent=4, sort_keys=True)
open(os.path.join(out, "electrum-2.0-wallet.json"), "w").write(w2)
w = load_text(w2, PW)
s = summary(w); s["password"] = PW; s["encrypted_file"] = False; s["seed"] = w.keystore.get_seed(PW); s["xprv"] = w.keystore.get_master_private_key(PW)
expected["cases"]["electrum-2.0-wallet.json"] = s

# ---- a two-factor (TrustedCoin) wallet as the plugin's wizard writes it (plugins/trustedcoin/trustedcoin.py: x1 = from_xprv(xprv1),
# x2 = from_xpub(xpub2), x3 = TrustedCoin's key from make_xpub(get_signing_xpub(xtype), long_user_id)), from Electrum's own test seed
from electrum.plugins.trustedcoin import trustedcoin as tc
from electrum import bip32 as _b32
tfa = 'kiss live scene rude gate step hip quarter bunker oxygen motor glove'
xprv1, xpub1, xprv2, xpub2 = tc.TrustedCoinPlugin.xkeys_from_seed(tfa, '')
lid, sid = tc.get_user_id({'x1': {'xpub': xpub1}, 'x2': {'xpub': xpub2}})
xpub3 = tc.make_xpub(tc.get_signing_xpub(_b32.xpub_type(xpub1)), lid)
kk1 = keystore.from_xprv(xprv1); kk1.update_password(None, PW)
data = {'x1': kk1.dump(), 'x2': keystore.from_xpub(xpub2).dump(), 'x3': keystore.from_xpub(xpub3).dump(), 'wallet_type': '2fa', 'use_encryption': True, 'seed_version': 74, 'labels': {}, 'genesis_blockhash': constants.net.GENESIS}
open(os.path.join(out, "el-2fa-pw.json"), "w").write(json.dumps(data, indent=4, sort_keys=True))
d2 = dict(data); d2['wallet_type'] = '2of3'
w = load_text(json.dumps(d2), PW)
s = summary(w); s["wallet_type"] = "2fa"; s["password"] = PW; s["encrypted_file"] = False; s["xprv"] = w.keystore.get_master_private_key(PW)
assert s["recv"][0] == '35L8XmCDoEBKeaWRjvmZvoZvhp8BXMMMPV' and s["change"][0] == '3PeZEcumRqHSPNN43hd4yskGEBdzXgY8Cy'
expected["cases"]["el-2fa-pw.json"] = s

json.dump(expected, open(os.path.join(out, "expected-electrum.json"), "w"), indent=1, sort_keys=True)
print("ok", ELECTRUM_VERSION, len(expected["cases"]))
_loop.call_soon_threadsafe(_stop.set_result, 1)
_thread.join(timeout=5)
os._exit(0)
