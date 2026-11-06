# Releasing and verifying VOIDFORGE

## Do not host it as a live web page
VOIDFORGE must run offline. Do **not** enable GitHub Pages or any hosting for this repo, and do not add an `index.html` or any page that points people at an online copy. Distribute only a downloaded release file.

## For maintainers: cutting a release
1. Edit `voidforge.html`; bump the version in the footer and the changelog card.
2. `npm ci && npm test` must pass (unit tests, oracle tests against `@scure`, mutation tests). CI runs the mutation tests in 20 parallel shards (`MUT_SHARD=i/20`), balanced by the measured time of each mutation (`tests/fixtures/mut-times.json`; refresh it from a full run's logs when many mutations change), because GitHub stops any single job after 6 hours; all shards must pass.
3. `sha256sum voidforge.html > SHA256SUMS` and write the file's content ID to `CID.txt` (CIDv1, raw, sha2-256: `python3 -c "import hashlib,base64; h=hashlib.sha256(open('voidforge.html','rb').read()).digest(); print('b'+base64.b32encode(bytes([1,0x55,0x12,0x20])+h).decode().lower().rstrip('='))" > CID.txt`), commit, push, and wait for the green check on the `test` workflow. (Work-in-progress commits can carry `[skip ci]` in the message so they do not start a run; the final candidate commit must not. Pushes to `main` and to tags do not start `test` runs; only the branch push does.)
4. On GitHub: Releases, Create a new release, create the tag (for example `v1.2.3`), and paste the SHA256 into the description. Publish.
5. The `release` workflow then runs by itself: it first looks for a green `test` run on the exact tagged commit and reuses it (if there is none, it re-runs every test), checks `SHA256SUMS`, records a signed build-provenance attestation, and attaches `voidforge.html`, `SHA256SUMS` and `CID.txt` to the release (from v1.19.1; for older tags that have no `CID.txt` the workflow cannot be re-run). Check the Actions tab for a green run.
   - If it fails, or for an older release, run it by hand: Actions, `release`, Run workflow, enter the tag.
6. Optional: sign the tag with GPG (`git tag -s`) if you have a key you use regularly. Do not let it block a release.

Workflow actions are pinned to full commit hashes (version in the trailing comment), so a moved tag cannot change what runs. To update one, look up the new tag's commit with `git ls-remote --tags https://github.com/actions/<name>` and change the hash and comment together. The release workflow has run successfully on GitHub for v1.3.0.

## For users: verifying a download
Do this on a machine you trust, then move the file by USB.
```
sha256sum -c SHA256SUMS
gh attestation verify voidforge.html --repo Random21m/voidforge     # needs the GitHub CLI
```
`CID.txt` holds the same check as a content ID (CIDv1, raw, sha2-256), the format IPFS-style tools use. It is a second, independent way to confirm the file: compute it yourself with the one-line command in step 3 above and compare it with `CID.txt`.
The attestation proves the file came from this repository's release workflow at a specific commit. It does not prove the code is safe; that depends on review. Verify the file you downloaded, not the copy saved by the in-page "DOWNLOAD FOR USB" button (the browser re-serializes the page, so its hash differs).

## README refresh (every release)
The README has no screenshots or video for now; they will be redone once the project is feature-complete. Before the final candidate commit, re-read the README text so it describes what the page does now: new or changed features are described, retired wording is removed, and the online practice copy (https://random21m.github.io/VOIDFORGE/) is still the right link and still serves the latest release.

## Bitcoin dictionary (every release)
The in-page Bitcoin dictionary (ABOUT & HELP) is general, not only about VOIDFORGE. With every release add entries for any new feature, standard or term (a new BIP or SLIP must have an entry: the tests fail if the page names one that the dictionary lacks), check new definitions against a trustworthy source, add a fact check for any number or prefix in a new entry, and add mutation targets that change those facts. Also use the release to add a few missing general terms.

## Clean-up (after every release)
Delete red and cancelled workflow runs (`gh api -X DELETE repos/Random21m/VOIDFORGE/actions/runs/<id>`), mark the previous release "Superseded by vX", check that the README, REVIEW.md, RELEASING.md and the in-page changelog all name the new version, and leave no stray files in the repo (`git ls-files`). A run that failed only because of a flaky test is re-run after the test is fixed, and the fix is recorded in the notes.

## Current build
`voidforge.html` v2.4.0, SHA256: `f269f0000c581c07935cf444d342624178255c82aedcf30915dbe4edebe12b1c`
Content ID (CIDv1): `bafkreihsnhyaadcydqdzgxhuitjueysbpasvzavo3tzqsfo34tw6xyjldq`
(Recompute after any edit.)
