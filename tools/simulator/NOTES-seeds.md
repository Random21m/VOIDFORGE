# SEEDS part: ss_seeds.js

Load it after the engine part. At load time it extends SSBaseScreen, SSBaseTopNavScreen, SSButtonListScreen, SSKeyboardScreen, SSLargeIconStatusScreen and SSView.

## Python classes ported
- **seed_screens.py (all 22):** SeedMnemonicEntryScreen, SeedFinalizeScreen, SeedOptionsScreen, SeedWordsScreen, SeedBIP85SelectChildIndexScreen, SeedWordsBackupTestPromptScreen, SeedExportXpubCustomDerivationScreen, SeedExportXpubDetailsScreen, SeedAddPassphraseScreen, SeedReviewPassphraseScreen, SeedTranscribeSeedQRFormatScreen, SeedTranscribeSeedQRWholeQRScreen, SeedTranscribeSeedQRZoomedInScreen, SeedTranscribeSeedQRConfirmQRPromptScreen, AddressVerificationSigTypeScreen, SeedSelectSeedScreen, SeedAddressVerificationScreen (+ProgressThread), SeedAddressVerificationSuccessScreen, LoadMultisigWalletDescriptorScreen, MultisigWalletDescriptorScreen, SeedSignMessageConfirmMessageScreen, SeedSignMessageConfirmAddressScreen. Each one has the `SS` prefix.
- **seed_views.py (all 48):** every view from SeedsMenuView to SeedSignMessageSignedMessageQRView, including AddressVerificationStartView/SigTypeView, LoadMultisigWalletDescriptorView, MultisigWalletDescriptorView and the inner BruteForceAddressVerificationThread.
- **models:** SSSeed, SSElectrumSeed, SSInvalidSeedException, SSSeedStorage.
- **encode_qr.py:** these are exported only if no other part defines the same names: SSSeedQrEncoder, SSCompactSeedQrEncoder, SSGenericStaticQrEncoder, SSStaticXpubQrEncoder, SSSpecterLegacyXPubQrEncoder and SSUrXpubQrEncoder. The views always use the private `SSSeeds*` classes.
- **Other helpers:** embit_utils as `ssSeedsEmbitUtils`, also exported as `SSEmbitUtils` if no other part defines it. helpers/qr.py as `ssSeedsQRImage`. SSQRType and SSThreadsafeCounter are defined only if no other part defines them.

## Checked in node against SeedSigner's own test vectors (all pass)
- Fingerprint, zpub and addresses for the "abandon … about" seed.
- Taproot xpub and addresses.
- SeedQR and CompactSeedQR, test vectors 1 and 4.
- Static xpub output, Specter legacy parts, and every UR crypto-account part (mainnet and testnet).
- BIP-85 child seeds of 12 and 24 words.
- An Electrum segwit seed.
- The signed message verifies with VOIDFORGE's `verifyMessage`.
- Views run against a mock engine: load a seed, add a passphrase, export an xpub, view words, transcribe a SeedQR, BIP-85, sign a message, verify an address.

## VOIDFORGE functions used
mnemonicToSeed, fingerprintFromSeed, masterFromSeed, ckdPriv, ckdPub, pubkeyBytes, hash160, sha256bytes, base58check, bech32Encode, taprootAddressFromPoint, pointFromPub, bip85Mnemonic, multisigAddress, multisigScript, msgHashLegacy, emul/SG/SN, qrBuild, urEncode, CB, WORDLIST, verifyMessage (tests only).

**Electrum:** this part uses `electrumSeedType` (prefix "100" = SegWit) and `electrumToSeed(text, pass, true)`. The passphrase is already normalized the way SeedSigner normalizes it.

## Assumptions about the engine (please check)
- **Screen constructors:** they take one object of fields. The base constructor must copy every field onto `this`, including fields it does not know.
- **`__post_init__`:** the `ssSeedsRunPost` helper makes post-init code run once, whether the engine calls `__post_init__()` or runs the code in each constructor.
- **Engine names used:**
  - Components: SSButtonOption({button_label,…}), SSButton, SSIconButton, SSIconTextLine, SSTextArea and SSFormattedAddress, each taking a fields object.
  - Keyboard: SSKeyboard({draw, charset, rows, cols, rect, additional_keys, auto_wrap, render_now}), with its methods taking positional arguments, plus SSTextEntryDisplay.
  - Renderer and screens: `renderer.show_image(img?)`, SSLoadingScreenThread({text}), SSQRDisplayScreen({qr_encoder}).
  - Settings and controller: SSSettingsDefinition.get_settings_entry(), `settings.get_multiselect_value_display_names()`, and SSController.FLOW__* plus `get_instance()`.
  - Constants: SS_RET_CODE__BACK_BUTTON.
- **Threads:** threads in `this.threads` have start(), stop(), is_alive() and join(). Seed screens use the part's own `SSSeedsThread` and `SSSeedsWarningEdgesThread`, a port of WarningEdgesThread with the flashing edges. The WarningEdgesMixin is the factory `ssSeedsWarningEdgesMixin(Base)`.
- **`SSHardwareButtons.trigger_override()`:** address verification needs it to leave its screen once the address is found.
- **`ssReflowTextIntoPages`:** used if it exists. Otherwise a simple fallback runs.
- **Views from other parts:** they are looked up when needed through `ssSeedsExt`. A missing one opens NotYetImplementedView. These are: SSScanView, SSScanSeedQRView, SSScanPSBTView, SSScanWalletDescriptorView, SSToolsMenuView, SSToolsAddressExplorerAddressTypeView, SSToolsCalcFinalWord{FinalizePrompt,ShowFinalWord}View, SSPSBTOverviewView, SSPSBTChangeDetailsView, SSPSBTParser, SSScanScreen and SSDecodeQR.
- **Multisig descriptor:** `controller.multisig_wallet_descriptor` should be `{type:"ms-wsh"|"ms-sh-wsh"|"ms-tr", m, cosigners:[{fp, path, key}]}`, the shape VOIDFORGE uses, or it can provide its own `derive_address()`.

## Async differences (the behavior is the same)
- Crypto in the page is async, so the following are async and get awaited: SSSeed.create(), get_fingerprint(), get_xpub(), get_bip85_child_mnemonic(), set_passphrase() and the storage conversion.
- Python views that compute fingerprints, xpubs, BIP-85 words or signatures in `__init__` do that work at the start of `run()` instead.
- Encoders need `await enc.prepare()` before use.

## SIM stand-ins and things left out
- **Zoomed-in SeedQR:** the dark mask (alpha 226) is drawn with an `rgba()` fill directly on each frame, instead of being an RGBA image put on with `alpha_composite`. The pan draws one frame about every 16 ms.
- **QR codes:**
  - Python's QR library (`qrcode`) and the `qrencode` program are not available. QR codes use the page's `qrBuild`.
  - The rounded style is ported: circles for the modules, square finder patterns, the squared-off alignment block, and a white background.
  - Error correction is level L. Above version 3 it uses level M, because the page has no level-L tables for larger codes.
  - Text is encoded in a single mode (numeric, alphanumeric or byte) rather than split into mixed segments.
  - If the engine provides SSQR, display QR codes use it.
- **Animated UR:** the pure parts 1..n repeat. SeedSigner's fountain encoder sends mixed parts after part n, and the page has no fountain encoder. Parts 1..n match SeedSigner exactly.
- **SeedWordsScreen:** the PIL SHARPEN filter is not applied.
- **Message signing:** ECDSA signing (RFC 6979, low-S, recoverable) is written in this part, because the page only has verification.
- **Regtest:** addresses use the hrp "bcrt", which this part adds.
- **SeedTranscribeSeedQRConfirmScanView:** needs the scan part (SSScanScreen and SSDecodeQR). Without it, it opens NotYetImplementedView.
- **Screenshot-generator-only arguments:** `rand_seed` is ignored. `initial_keyboard` and `initial_zone_*` are kept.
- **Unreachable guard:** SeedReviewPassphraseScreen has a guard for an empty passphrase, which Python never reaches.
