Test data for tests/devbackup.test.mjs (VOIDFORGE v2.12.0: Open a signing device's backup).
Nothing here is a real person's wallet. Every vector is taken from the maker's own repository at the commit below, except the one
marked MADE.

krux/vectors.json
  Repository: https://github.com/selfcustody/krux   tag v26.09.0   commit 2b20e3370169731a0d89839a4113ad9a1b732078
  Each entry names its file and line. The key ("password") of the test_encryption.py vectors is "test key" (tests/test_encryption.py).
  - kef_qr_vectors: tests/test_encryption.py:42 ECB_ENCRYPTED_QR, :45 OLDECB_ENCRYPTED_QR, :46 CBC_ENCRYPTED_QR, :47 OLDCBC_ENCRYPTED_QR,
    :48 CTR_ENCRYPTED_QR, :49 GCM_ENCRYPTED_QR (KEF versions 5, 0, 10, 1, 15, 20; 100000 iterations). envelope_hex is the bytes literal of
    the repository. qr_text_base43 was computed from it by the repository's own algorithm (src/krux/baseconv.py:134-191) and checked
    by a round trip: it is NOT a literal in the repository.
  - kef_in_seeds_json: tests/test_encryption.py:78-81 (KEF_*ENTROPY_ONLY_JSON: a seeds.json with a b64_kef entry).
  - legacy_seeds_json: tests/test_encryption.py:82-83 (OLD_ECBWORDS_ONLY_JSON, OLD_CBCWORDS_ONLY_JSON: seeds.json "version" 0 and 1).
  - extra: tests/test_kef.py:1900 and :1908 (test_grind_alternate_decryption_key: keys "abc" and "key", v5, 10000 iterations, plaintext
    the 16 bytes "I'm 16 raw bytes"), :21 CTR_ENCRYPTED_KEF (key "key"), :22 GCM_ENCRYPTED_KEF (key "test key"), and :19 ECB_ENCRYPTED_KEF
    and :20 CBC_ENCRYPTED_KEF, which are STRUCTURE-ONLY (tests/test_kef.py:1100-1116): they must NOT decrypt with any of these keys.
    Where "password" has a note after " (", the key is the text before it.

coldcard/   (docs-backup.7z, tip-index-...-initial.7z, vectors.json)
  Repository: https://github.com/Coldcard/firmware   tag 2026-09-30T2025-v1.5.3Q   commit 4e5ba883e0bf8756036f8a84fdbc4b067aa7ad05
  - docs-backup.7z is docs/backup.7z; its 12-word password is in docs/backup-files.md:128-133 ("spice until comfort zoo ... skate").
  - tip-index-famous-embark-tobacco-rice-attitude-interest-mask-random-amazing-initial.7z is testing/data/ of the same name; the password
    is the 12 words in its file name (testing/test_hobble.py:332-333, pw = fn[5:-3].split('-')).
  - vectors.json: the password, the SHA-256 and Base64 of each file, the decryption values found by an independent Python script, and
    the decrypted text.

tapsigner/vectors.json
  Repository: https://github.com/coinkite/coinkite-tap-proto   commit 6ea18e9e94b5cc877885a9dd92518c28e814e251
  Coinkite publishes NO TAPSIGNER backup together with its key. README.md:368-389 shows a sample backup without the key, so it cannot be
  opened (kept in the file as readme_sample_official_but_incomplete, not used).
  MADE (not official): synthetic_NOT_OFFICIAL is a backup made exactly as docs/protocol.md:913-928 says (AES-128-CTR, zero IV, two text
  lines: the xprv and the path, with openssl): BIP32 test vector 1's master key, path m/84h/0h/0h, key 41 x 16 (the emulator's
  FIXED_AES_KEY, emulator/ecard.py:43), path text as path2str writes it (cktap/utils.py:55). The .sh form is built in the test from
  cktap/cli.py:862-872 (the Base64 body wrapped at 70 characters, between two END-OF-DATA lines).
