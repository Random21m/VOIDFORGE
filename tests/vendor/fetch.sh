#!/bin/sh
# Fetches only the dice files of SeedSigner, Coldcard and Keystone (and Coldcard's seed mix files) at pinned commits into tests/vendor/src (not committed).
# Used by tests/vendor.test.mjs. Change a commit here on purpose only, after reading what changed in that file.
set -eu
cd "$(dirname "$0")"
mkdir -p src
get() { # name, repository, commit, files...
  name=$1; repo=$2; commit=$3; shift 3
  if [ ! -d "src/$name/.git" ]; then git clone -q --filter=blob:none --no-checkout "$repo" "src/$name"; fi
  git -C "src/$name" fetch -q --depth 1 origin "$commit" 2>/dev/null || true
  git -C "src/$name" checkout -q "$commit" -- "$@"
  echo "$name $(git -C "src/$name" rev-parse "$commit")"
}
get seedsigner https://github.com/SeedSigner/seedsigner 995ce5c65df4bd333f61cd3dd992b39a49138a1d src/seedsigner/helpers/mnemonic_generation.py
get coldcard https://github.com/Coldcard/firmware 09766a1473246f0abe7d853b3635c0a03be125a7 shared/seed.py
get keystone https://github.com/KeystoneHQ/keystone3-firmware 3690bf1f36cb9e817f9a2412a9fc7560c08953f0 src/ui/gui_widgets/gui_dice_rolls_widgets.c src/ui/gui_model/gui_model.c src/ui/gui_widgets/gui_single_phrase_widgets.c
# v2.10.0: Coldcard's seed mix (dice or coin flips mixed with the device's TRNG words), at the commit of release 1.5.3Q (the
# same shared/seed.py as Mk4/Mk5 5.6.3): the firmware code, Coinkite's own checker docs/verify_seed_mix.py and its tests.
get coldcard-mix https://github.com/Coldcard/firmware 4e5ba883e0bf8756036f8a84fdbc4b067aa7ad05 shared/seed.py docs/verify_seed_mix.py testing/test_rolls.py testing/test_ux.py
