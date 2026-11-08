# Releasing and verifying VOIDFORGE

## The online practice copy
For real funds VOIDFORGE runs offline, from a downloaded file. The only online copy is the practice demo at https://random21m.gitlab.io/voidforge/, which GitLab Pages builds from `main` (the `pages` job in `.gitlab-ci.yml`): it serves the released `voidforge.html` byte for byte inside the thin wrapper in `demo/` (amber banner, icons, offline copy), and only after `SHA256SUMS` and `CID.txt` check out. Do not host the file anywhere else.

## For maintainers: cutting a release
Order of work, so the long mutation run happens once: build the changes; run the normal tests; do the consistency sweep (below); get the fresh review and fix what it finds; then **freeze** the release (only real bugs go in after this, and anything new waits for the next release); run the full mutation suite once on the frozen file; then sign and publish. A fix after the freeze re-runs only the mutation targets it touches (`MUT_ONLY`), not the whole suite. Before any full run, check that the control passes: the unmodified file must pass the self-test and every probe.

1. Edit `voidforge.html`; bump the version in the footer and the changelog card.
2. Run every test on your own machine: `npm ci --ignore-scripts && npm test` (unit tests, the signed-release check against GnuPG and `@noble`, SLIP39 against every official test vector, oracle tests against `@scure` and the other independent libraries, the print test in a real Chromium, and the mutation tests). The mutation suite can be split into parts that run side by side: `MUT_SHARD=i/N node tests/mutation.test.mjs` for i = 0 to N-1, balanced by the measured time of each mutation (`tests/fixtures/mut-times.json`); every part must pass. (Up to v2.3.0 this ran on GitHub Actions in 20 shards. GitLab's free plan has far too few CI minutes for the mutation suite, so GitLab's `test` job runs only the unit, oracle and print tests, and is started by hand.)
   Also run the tests that need more than npm (each one says SKIPPED when what it needs is missing):
   - `node tests/fuzz.test.mjs`: random inputs (fast-check) through the page's functions, compared with `@scure`/`@noble` and with Electrum's own normalization results.
   - `node tests/browsers.test.mjs`: the same end-to-end check in Chromium, Firefox and WebKit (the CI image has all three).
   - `node tests/memory.test.mjs`: a heap snapshot in Chromium after CLEAR ALL, auto-clear and END SESSION must not hold the seed words, rolls or passphrases.
   - `node tests/screens.test.mjs`: the main screens against the pictures in `tests/fixtures/screens/` (made on the maintainer's test machine; after a change that was meant, look at `screen-diffs/` and save new pictures with `UPDATE_SCREENS=1`).
   - `sh tests/vendor/fetch.sh && node tests/vendor.test.mjs`: "Check your device's dice" against SeedSigner, Coldcard and Keystone's own dice rules, read from their source at pinned commits (needs python3 with `embit`).
   - `BITCOIN_BIN=... node tests/core.test.mjs`: the page's descriptors, import commands, multisig, PSBT reading and signed messages against Bitcoin Core on regtest. Download Core from bitcoincore.org and check it first: `sha256sum --ignore-missing -c SHA256SUMS` and `gpg --verify SHA256SUMS.asc SHA256SUMS` with the builder keys from github.com/bitcoin-core/guix.sigs (`builder-keys/`).
   - The mutation suite stops each mutant at its first failure and can resume: `MUT_RESULTS=results.jsonl MUT_SHARD=i/4 node tests/mutation.test.mjs` for i = 0 to 3 side by side; a restarted part skips what is already in its results file.
3. `sha256sum voidforge.html > SHA256SUMS` and write the file's content ID to `CID.txt` (CIDv1, raw, sha2-256: `python3 -c "import hashlib,base64; h=hashlib.sha256(open('voidforge.html','rb').read()).digest(); print('b'+base64.b32encode(bytes([1,0x55,0x12,0x20])+h).decode().lower().rstrip('='))" > CID.txt`), update **Current build** below, and commit.
4. Push the release branch, fast-forward `main` to the tested commit, push `main`, and tag that commit `vX.Y.Z`.
5. On GitLab: **Deploy > Releases > New release**, pick the tag, paste the SHA256 and the content ID into the description, and add four release links to the tagged files: `https://gitlab.com/random21m/voidforge/-/raw/vX.Y.Z/voidforge.html`, `.../SHA256SUMS`, `.../SHA256SUMS.asc` and `.../CID.txt`. Each link's title is just the file name (no colon, no address). Mark the previous release "Superseded by vX.Y.Z".
6. The `pages` job refreshes the online copy from `main`. Bump `CACHE` in `demo/sw.js` with every release, so saved copies pick up the new file.
7. Signed checksums: from v2.8.1 on, `SHA256SUMS` comes with a detached GPG signature (`SHA256SUMS.asc`) made on the maintainer's own computer. The private key never leaves it. On that computer, in the release folder:
   ```
   gpg --local-user 2509D11503B72CBFBCB5408F4B729F056A529340 --armor --detach-sign --output SHA256SUMS.asc SHA256SUMS
   gpg --verify SHA256SUMS.asc SHA256SUMS
   ```
   Commit `SHA256SUMS.asc` before tagging.
8. Optional timestamp (OpenTimestamps): proves the signed `SHA256SUMS` existed by a certain date, using Bitcoin's own blocks. It needs the `ots` client (`pip install opentimestamps-client`) and an internet connection, so do it on an online computer, after signing; only hashes leave the computer. `ots stamp SHA256SUMS` writes `SHA256SUMS.ots`; a few hours later `ots upgrade SHA256SUMS.ots` adds the Bitcoin block it was anchored in. Add `SHA256SUMS.ots` as a fifth release link. Anyone can check it with `ots verify SHA256SUMS.ots` (fully with their own Bitcoin node).

## For users: verifying a download
Do this on a machine you trust, then move the file by USB. From v2.8.1 on, check the signature first (the release key and its fingerprint are in SECURITY.md), then the hash:
```
gpg --import voidforge-signing-key.asc
gpg --verify SHA256SUMS.asc SHA256SUMS
sha256sum -c SHA256SUMS
```
Releases up to v2.8.0 are not signed; check those with `sha256sum -c SHA256SUMS` only.
`CID.txt` holds the same check as a content ID (CIDv1, raw, sha2-256), the format IPFS-style tools use. It is a second, independent way to confirm the file: compute it yourself with the one-line command in step 3 above and compare it with `CID.txt`.
Verify the file you downloaded, not the copy saved by the in-page "DOWNLOAD FOR USB" button (the browser re-serializes the page, so its hash differs). A matching hash proves you have the published file; it does not prove the code is safe, which depends on review.

Releases up to v2.3.0 were built on GitHub and also carry a GitHub build-provenance attestation (`gh attestation verify voidforge.html --repo Random21m/voidforge`, while that project is reachable). From v2.4.0 on, releases are published on GitLab and are checked with `SHA256SUMS` and `CID.txt` (and, from v2.8.1 on, the GPG signature).

## README refresh (every release)
The README has no screenshots or video for now; they will be redone once the project is feature-complete. Before the final candidate commit, re-read the README text so it describes what the page does now: new or changed features are described, retired wording is removed, and the online practice copy (https://random21m.gitlab.io/voidforge/) is still the right link and still serves the latest release.

## Consistency sweep (every release)
Before the final review, check that the same thing is named, counted, shown and styled the same way everywhere: the page, the printed sheets, the Bitcoin dictionary, the current changelog entry and these documents. In particular: buttons and tabs are quoted exactly as they read on screen (tabs in capitals, as their headings: MAKE A SEED, CHECK A BACKUP, EXTRA TOOLS, ABOUT & HELP); every address list shows the first 10 receive and the first 10 change addresses; testnet is written "TESTNET (practice coins only)"; every main action is a gold button and every PRINT button is gray; outside checks are called a review, and VOIDFORGE "has not been independently audited"; phones are "for learning and practice only, never for real funds"; American spelling. Hints that point to another part of the page ("above", "below", a tab) must still point the right way. Fix every difference before the review.

## Bitcoin dictionary (every release)
The in-page Bitcoin dictionary (ABOUT & HELP) is general, not only about VOIDFORGE. With every release add entries for any new feature, standard or term (a new BIP or SLIP must have an entry: the tests fail if the page names one that the dictionary lacks), check new definitions against a trustworthy source, add a fact check for any number or prefix in a new entry, and add mutation targets that change those facts. Also use the release to add a few missing general terms.

## Clean-up (after every release)
Mark the previous release "Superseded by vX", check that the README, REVIEW.md, RELEASING.md and the in-page changelog all name the new version, check that the online copy serves the new file (its SHA-256 matches `SHA256SUMS`), and leave no stray files in the repo (`git ls-files`).

## Current build
`voidforge.html` v2.9.0, SHA256: `3aec69a68a268bd3fb1e062dd50686dc61b59315dcf529708cd66cec544eecfa`
Content ID (CIDv1): `bafkreib25ru2ncrgrpj7whqgfxkqnbw4mg2zgfo46uuxbdgwntwfitxm7i`
(Recompute after any edit.)
