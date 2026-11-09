#!/bin/sh
# Fetches only the dice files of SeedSigner, Coldcard and Keystone at pinned commits into tests/vendor/src (not committed).
# Used by tests/vendor.test.mjs. v2.10.0: also the library files of python-shamir-mnemonic (the SLIP39 reference), used by
# tests/slip39.test.mjs through tests/vendor/slip39_ref.py, which checks each file's SHA-256 before using it. Change a commit here on purpose only, after reading what changed in that file.
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
get shamir https://github.com/trezor/python-shamir-mnemonic 9fcb9c807c185e06d6269b65f3d795d3c724da3b shamir_mnemonic/__init__.py shamir_mnemonic/cipher.py shamir_mnemonic/constants.py shamir_mnemonic/rs1024.py shamir_mnemonic/shamir.py shamir_mnemonic/share.py shamir_mnemonic/utils.py shamir_mnemonic/wordlist.py shamir_mnemonic/wordlist.txt
