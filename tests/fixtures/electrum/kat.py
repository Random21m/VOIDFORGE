# Known answers for the page's self-test, made with Electrum's own code (storage.py encrypt_before_writing, crypto.pw_encode)
import zlib, json, sys
from electrum.storage import WalletStorage
from electrum import crypto
import electrum_ecc as ecc
pw = "test password"
s = '{"seed_version": 74, "wallet_type": "standard"}'
k = WalletStorage.get_eckey_from_password(pw)
c = zlib.compress(s.encode(), level=zlib.Z_BEST_SPEED)
blob = crypto.ecies_encrypt_message(ecc.ECPubkey(bytes.fromhex(k.get_public_key_hex())), c, magic=b'BIE1').decode()
# check it the way Electrum opens a file
assert zlib.decompress(crypto.ecies_decrypt_message(WalletStorage.get_eckey_from_password(pw), blob, magic=b'BIE1')).decode() == s
seed = "bitter grass shiver impose acquire brush forget axis eager alone wine silver"
enc = crypto.pw_encode(seed, pw, version=1)
assert crypto.pw_decode(enc, pw, version=1) == seed
print(json.dumps({"bie1": blob, "plain": s, "pw": pw, "seed_enc": enc, "seed": seed, "eckey_pub": k.get_public_key_hex()}, indent=1))
