# Security

## Status

VOIDFORGE is **not independently audited**. It is a single HTML file you can read, with automated tests (known-answer vectors, differential tests against independent libraries, and tests that deliberately break the code). That raises confidence; it does not mean VOIDFORGE has been independently audited. For large amounts, generate on dedicated hardware (SeedSigner, Coldcard, etc.) and use VOIDFORGE only to cross-check.

## How VOIDFORGE is checked

Every release passes all of these before it is published (RELEASING.md says how to run each):

- **The self-test in the page.** Known-answer vectors from the published standards (BIP39, BIP32, BIP84/86/49/44, BIP85, BIP352, Electrum's own test wallets and more) run each time the page opens; if one fails, the tools that make or check keys stay off.
- **Unit tests** (`tests/test.js`): over 1,550 checks of every feature, in a simulated browser.
- **Oracle tests** (`tests/oracle.test.mjs`): the same inputs through the page and through independent libraries (`@scure`, `@noble`, `bc-ur`, `bbqr`), compared byte for byte.
- **Property tests** (`tests/fuzz.test.mjs`): random inputs (seeds, Unicode passphrases, any derivation path, roll strings, damaged addresses, arbitrary text) through the page and the independent libraries.
- **Bitcoin Core** (`tests/core.test.mjs`): on a private test network, Core checks the page's descriptors and import commands for every address type, sees payments to the page's addresses in the watch-only wallet, derives the same multisig addresses, and makes the transactions and signed messages the page reads.
- **Device makers' rules** (`tests/vendor.test.mjs`): "Check your device's dice" against SeedSigner's, Coldcard's and Keystone's own dice code, and *Check a Coldcard seed mix* against Coinkite's own checker and vectors, read at pinned commits.
- **Other projects' own code** (v2.10.0): punch plates against Krux (`tests/krux.test.mjs`), raw card entropy against Ian Coleman's BIP39 tool (`tests/coleman.test.mjs`), new SLIP39 shares against python-shamir-mnemonic (`tests/slip39.test.mjs`), old Electrum seeds against Electrum's source and tests, encrypted descriptor backups against the official BIP138 vectors, signature checks against Bitcoin Core's `sighash.json` and `tx_valid.json` (`tests/sigcheck.test.mjs`), and (v2.11.0) codex32 against every BIP93 test vector, the BIP's own Python, python-codex32 and Coldcard's code (`tests/codex32.test.mjs`), and Taproot multisig against embit, @scure/btc-signer and BIP387's vectors. Each file is pinned by commit and SHA-256, and only its pure functions are run.
- **Device backups** (v2.12.0, `tests/devbackup.test.mjs`): TAPSIGNER, Krux and Coldcard backups against Krux's test vectors (Krux v26.09.0), Coinkite's sample Coldcard backups, and backups of every format and version made independently in the test with node:crypto.
- **Practice signer** (v2.13.0, `tests/simulator.test.mjs`, 185 checks): the SeedSigner 0.8.7 port is driven with its own buttons in a real Chromium, offline. Seeds, xpubs, addresses, SeedQR codes, signed transactions and signed messages are compared with `@scure`, `@noble` and `jsqr`, never with the page's own code. It is a port of SeedSigner's source, so SeedSigner's own checks do not apply to it.
- **The Damascus method** (v2.14.0, `tests/vfmethod.test.mjs`): the three worked examples and 2,000 random sheets (1,000 of 12 words and 1,000 of 24) give the same grids, hallmarks, words, last-word range and bias boxes in the page as in the method's reference code, and the same phrases, fingerprints and first addresses as `@scure/bip39`, `@scure/bip32` and `@scure/btc-signer`. The assay's two phrases are checked to XOR to the seed and the assay screen to show neither the Forge grid nor the seed. The printed sheets are checked for one page on Letter and A4, and the memory test checks the Damascus boxes are wiped. SeedSigner's own final-word steps are driven in the practice signer (and, when its source is given, SeedSigner's own Python is run) to agree on the last word, fingerprint and first address.
- **Lessons on the practice signer** (v2.14.0, `tests/simulator.test.mjs`): each of the six lessons is driven with the device's own keys, so every step must move on when the device shows the expected screen; the practice transaction is made from `@scure` keys, signed on the device, read from its screen and checked with `@scure/btc-signer` and `@noble`; CLEAR ALL must wipe it.
- **Three browser engines** (`tests/browsers.test.mjs`): Chromium, Firefox and WebKit.
- **Prints** (`tests/print.test.mjs`): every printed sheet is exactly one page on Letter and A4, in a real browser.
- **Memory** (`tests/memory.test.mjs`): after CLEAR ALL, auto-clear and END SESSION, a heap snapshot holds none of the seed words, rolls or passphrases.
- **Screens** (`tests/screens.test.mjs`): the main screens against saved pictures.
- **Mutation tests** (`tests/mutation.test.mjs`): about 2,500 deliberate small bugs; each one must be caught by the self-test or an end-to-end check. A bug that freezes the page counts as caught; one that only makes the checks run too long counts as not caught.
- **A fresh AI code review** before every release, by a model that did not write the code, and a full review of the whole file before the first signed release. These reviews do not mean VOIDFORGE has been independently audited.

THREAT_MODEL.md says what VOIDFORGE protects, against whom, and what it cannot do.

## Reporting a vulnerability

Please report privately, not in a public issue:

1. On GitLab, open a **confidential issue**: [new issue](https://gitlab.com/random21m/voidforge/-/issues/new?issuable_template=Security), choose the *Security* template and make sure **This issue is confidential** is ticked, so only the maintainer can read it, or
2. If that is unavailable, open an issue that says only "security report, please contact me" and **no details**; the maintainer will arrange a private channel.

Please include the version (shown at the bottom of the page), the browser, and steps to reproduce. Reports of anything that could leak a seed, passphrase or rolls, produce a wrong seed or address, or weaken the offline guarantees are the most important.

## What is in scope

- Wrong seed words, fingerprint or first receive address for given inputs
- Anything that causes the page to make a network request, store data (beyond the theme and text size, and the start-notice flag kept for one tab session), turn the camera on without a SCAN button being pressed, or expose a seed, rolls or passphrase
- A signed message reported VALID when it is not
- Weaknesses in the self-test gate or the release/verification process

## Known limits (not vulnerabilities)

- The secp256k1 code is not constant-time. This is acceptable offline but is why the tool must never run on a networked or shared computer.
- The self-test runs inside the same file it checks, so a tampered file could fake a pass. Verify the SHA256 with a tool that is not the page (see RELEASING.md).
- The randomness check is advisory and cannot prove your dice or coin are fair.
- After FORGE the page lists the first 10 receive and 10 change addresses of native SegWit and Taproot, account 0; Open this wallet shows any address type, account or custom path. A wallet app on another path or type shows other addresses (the Wallet Detective helps find them).
- The PSBT inspector can check that an output marked as change is really the wallet's own only when that wallet's words are typed in CHECK A BACKUP (and only for single-key outputs). Without them it says the mark is unchecked: a change mark is written by whoever made the PSBT.
- The Practice signer (v2.13.0) adds about 1 MB of code to the page (the file grew from about 1.4 MB to 2.4 MB). It is for practice only: never put real coins on a seed made in it. It is a real, working signer that starts on Mainnet, like SeedSigner: it can sign real transactions, so never type in or scan a real seed. It wipes with CLEAR ALL, auto-clear, END SESSION and closing its box (closing keeps only the settings saved to its practice microSD, and a later auto-clear still wipes them). It reads a SeedQR only while the page is offline. It decodes animated UR fountain codes. It is a port, not SeedSigner itself: a screen, a wording or a rule can differ from the real device (it leaves out Taproot script-path signing), so check what the real device shows before you trust it. Its fonts and code are credited in THIRD_PARTY_NOTICES.md.
- The Damascus method (v2.14.0) is a hand method. Its hallmarks catch copying mistakes, not cheating; its dice and card checks catch badly broken dice or a lazy shuffle, not small flaws; and anyone who sees one sheet before filling in the other can choose the seed. Hallmarks reveal part of the seed (22 bits for 12 words, 34 for 24), so keep them only next to the words. Practice sheets are made from a published rule and are never seeds to keep. The assay shows an assayer one sheet's hallmarks and its own Seed XOR phrase, never the seed, but only if the other sheet was made well and kept apart. The method and its checks have not been independently audited.
- The practice signer's lessons (v2.14.0) use public test seeds only, and the practice transaction spends made-up coins that can never be broadcast. Never put real coins on a seed from a lesson, and never type a real seed into the practice signer.
- Phones: for learning and practice only, never for real funds. File previews (Quick Look, email, phone Files) do not run the page.

## Release signing key

Releases from v2.8.1 on are signed with this OpenPGP key (ed25519, created 2026-11-06, expires 2028-11-05 unless extended):

`2509 D115 03B7 2CBF BCB5  408F 4B72 9F05 6A52 9340`

The public key is [`voidforge-signing-key.asc`](voidforge-signing-key.asc) in this repository. It carries no email address. **Releases up to v2.8.0 are not signed**; check them with `SHA256SUMS` and `CID.txt` (see RELEASING.md). From v2.8.1, the first signed release, each release also has `SHA256SUMS.asc`. To check it:

```
gpg --import voidforge-signing-key.asc
gpg --verify SHA256SUMS.asc SHA256SUMS
sha256sum -c SHA256SUMS
```

A good signature names the fingerprint above; compare all 40 characters. The fingerprint is also on the release pages, so a single altered copy can be noticed.

## Supported versions

Only the latest release is supported.

## Security acknowledgements

Thanks to everyone who reports problems responsibly.

| Date | Reporter | Issue | Advisory |
|---|---|---|---|
| 2026-10-27 | MrHodlX | Release workflow could sign files that had been changed after dependencies were installed; fixed in v1.8.1 | GHSA-8xcw-qx5p-8rmr (on the former GitHub page) |
