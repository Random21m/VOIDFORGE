# Security

## Status

VOIDFORGE is **not independently audited**. It is a single HTML file you can read, with automated tests (known-answer vectors, differential tests against independent libraries, and tests that deliberately break the code). That raises confidence; it does not mean VOIDFORGE has been independently audited. For large amounts, generate on dedicated hardware (SeedSigner, Coldcard, etc.) and use VOIDFORGE only to cross-check.

## How VOIDFORGE is checked

Every release passes all of these before it is published (RELEASING.md says how to run each):

- **The self-test in the page.** Known-answer vectors from the published standards (BIP39, BIP32, BIP84/86/49/44, BIP85, BIP352, Electrum's own test wallets and more) run each time the page opens; if one fails, the tools that make or check keys stay off.
- **Unit tests** (`tests/test.js`): over 1,250 checks of every feature, in a simulated browser.
- **Oracle tests** (`tests/oracle.test.mjs`): the same inputs through the page and through independent libraries (`@scure`, `@noble`, `bc-ur`, `bbqr`), compared byte for byte.
- **Property tests** (`tests/fuzz.test.mjs`): random inputs (seeds, Unicode passphrases, any derivation path, roll strings, damaged addresses, arbitrary text) through the page and the independent libraries.
- **Bitcoin Core** (`tests/core.test.mjs`): on a private test network, Core checks the page's descriptors and import commands for every address type, sees payments to the page's addresses in the watch-only wallet, derives the same multisig addresses, and makes the transactions and signed messages the page reads.
- **Device makers' rules** (`tests/vendor.test.mjs`): "Check your device's dice" against SeedSigner's, Coldcard's and Keystone's own dice code, read at pinned commits.
- **Three browser engines** (`tests/browsers.test.mjs`): Chromium, Firefox and WebKit.
- **Prints** (`tests/print.test.mjs`): every printed sheet is exactly one page on Letter and A4, in a real browser.
- **Memory** (`tests/memory.test.mjs`): after CLEAR ALL, auto-clear and END SESSION, a heap snapshot holds none of the seed words, rolls or passphrases.
- **Screens** (`tests/screens.test.mjs`): the main screens against saved pictures.
- **Mutation tests** (`tests/mutation.test.mjs`): about 1,800 deliberate small bugs; each one must be caught by the self-test or an end-to-end check.
- **A fresh AI code review** before every release, by a model that did not write the code, and a full review of the whole file before the first signed release. These reviews do not mean VOIDFORGE has been independently audited.

THREAT_MODEL.md says what VOIDFORGE protects, against whom, and what it cannot do.

## Reporting a vulnerability

Please report privately, not in a public issue:

1. On GitLab, open a **confidential issue**: [new issue](https://gitlab.com/random21m/voidforge/-/issues/new?issuable_template=Security), choose the *Security* template and make sure **This issue is confidential** is ticked, so only the maintainer can read it, or
2. If that is unavailable, open an issue that says only "security report, please contact me" and **no details**; the maintainer will arrange a private channel.

Please include the version (shown at the bottom of the page), the browser, and steps to reproduce. Reports of anything that could leak a seed, passphrase or rolls, produce a wrong seed or address, or weaken the offline guarantees are the most important.

## What is in scope

- Wrong seed words, fingerprint or first receive address for given inputs
- Anything that causes the page to make a network request, store data (beyond the theme and text size, and the start-notice flag kept for one tab session), or expose a seed, rolls or passphrase
- A signed message reported VALID when it is not
- Weaknesses in the self-test gate or the release/verification process

## Known limits (not vulnerabilities)

- The secp256k1 code is not constant-time. This is acceptable offline but is why the tool must never run on a networked or shared computer.
- The self-test runs inside the same file it checks, so a tampered file could fake a pass. Verify the SHA256 with a tool that is not the page (see RELEASING.md).
- The randomness check is advisory and cannot prove your dice or coin are fair.
- After FORGE the page lists the first 10 receive and 10 change addresses of native SegWit and Taproot, account 0; Open this wallet shows any address type, account or custom path. A wallet app on another path or type shows other addresses (the Wallet Detective helps find them).
- The PSBT inspector can check that an output marked as change is really the wallet's own only when that wallet's words are typed in CHECK A BACKUP (and only for single-key outputs). Without them it says the mark is unchecked: a change mark is written by whoever made the PSBT.
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
