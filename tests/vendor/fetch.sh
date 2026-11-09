#!/bin/sh
# Fetches only the dice files of SeedSigner, Coldcard and Keystone, and the punch plate files of Krux (v2.10.0), at pinned commits
# into tests/vendor/src (not committed).
# Used by tests/vendor.test.mjs and tests/krux.test.mjs. Change a commit here on purpose only, after reading what changed in that file.
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
get krux https://github.com/selfcustody/krux 28d14c216006e278fd263afead3357becb83aa43 src/krux/pages/tiny_seed.py src/krux/pages/stack_1248.py src/krux/pages/utils.py src/krux/pages/mnemonic_loader.py
