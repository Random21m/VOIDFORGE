# PSBT part (stage 2): ss_psbt.js

Built into the same script block as ss_tools_settings.js PART B (after it), so the page keeps six practice-signer blocks.

## Ported (Python -> SS)
- views/psbt_views.py, all 12 views: PSBTSelectSeedView, PSBTOverviewView, PSBTUnsupportedScriptTypeWarningView,
  PSBTNoChangeWarningView, PSBTMathView, PSBTAddressDetailsView, PSBTChangeDetailsView, PSBTAddressVerificationFailedView,
  PSBTOpReturnView, PSBTFinalizeView, PSBTSignedQRDisplayView, PSBTSigningErrorView.
- gui/screens/psbt_screens.py, all 7 screens: PSBTOverviewScreen (+ TxExplorerAnimationThread), PSBTMathScreen,
  PSBTAddressDetailsScreen, PSBTChangeDetailsScreen, PSBTOpReturnScreen, PSBTFinalizeScreen.
- models/psbt_parser.py: PSBTParser (every method, including the missing-fingerprint fill and verify_multisig_output).
- models/encode_qr.py: UrPsbtQrEncoder (on the seeds part's fountain encoder: pure parts, then mixed parts, see NOTES-seeds.md).
- embit, as far as SeedSigner uses it: PSBT (v0 and v2 parse, read from a stream with embit's own checks and leniencies, v0 serialize, fee, sighash, sign_with,
  sign_input_with_tapkey), Descriptor (sh/wsh/sh-wsh multi and sortedmulti; wpkh, sh-wpkh, pkh, tr key; owns,
  check_derivation, derive), and urtypes Output / Account -> descriptor text.
- The scan routing and decoders: see NOTES-tools-settings.md.

## Checked
- Signed PSBTs (P2WPKH with OP_RETURN, P2SH-P2WPKH, P2TR key path, 2-of-3 P2WSH) are byte for byte what embit 0.8.0
  (PSBT.sign_with + PSBTParser.trim) makes from the same PSBTs and seed; the signatures verify with @scure/btc-signer's
  signature hashes and @noble/curves, and btc-signer finalizes the transactions. Messages signed by the sign-message
  flow are byte for byte embit's (SeedSigner's embit_utils.sign_message).

## SIM stand-ins
- Signing: ECDSA is RFC 6979 + low S + low-R grinding (embit's PrivateKey.sign); Schnorr uses no aux randomness and,
  like the libsecp256k1 build embit ships, hashes the secret key itself into the nonce (see ssPsbtSchnorrSign).
- The overview chart (4x) and the math (2x) are drawn in the supersampled coordinates at device resolution; no LANCZOS
  shrink or SHARPEN (as the engine's TextArea).
- PSBTChangeDetailsView reads the change output's script directly instead of address_to_scriptpubkey(address) (same script).
- Descriptors: extended public keys only (VOIDFORGE's parseExtendedKey refuses private keys); miniscript other than
  multi/sortedmulti is kept as text and is not basic multisig (-> NotYetImplementedView, as in SeedSigner); a taproot
  script tree is kept as text too (tr(key,{tree}) -> NotYetImplementedView, as in SeedSigner).
- Signing in a taptree leaf (taproot_scripts) is not ported: SeedSigner's PSBTParser.trim drops such a signature, so its
  flow ends on "Signing Failed" either way.
- Wiping: ssPsbtWipeController (called by ssPageStop) overwrites the PSBT, signatures, descriptor, scanned decoder data
  and the signing root key held by PSBTParser.
