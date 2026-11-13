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

## v2.17.0: the practice signer for real (ss_own.js)
Built into the last script block, after ss_page.js and ss_learn.js. Page glue only: nothing is drawn on the device or added to its
menus, and nothing is put into its memory. A PSBT, address, sortedmulti descriptor or signmessage request typed, chosen or scanned
next to the device is held up to its camera by the practice wallet (a PSBT as an animated UR crypto-psbt); the person chooses Scan.
- SIM: VOIDFORGE rule, called by SSPSBTFinalizeView.run (after Approve transaction, before sign_with) and by
  SSSeedSignMessageSignedMessageQRView.run (before sign_message): ssOwnSignGate. A PSBT whose key paths or global xpubs name another
  network than the device's setting is refused ("Wrong network" on SeedSigner's own ErrorView, Back returns to Sign Transaction). A
  seed that is not public (pubKind) signs a PSBT only after a yes to the page's confirm() (outputs checked; offline, or a warning
  that the computer is online), and a message only after a yes too (v2.17.0 review: offline as well); No shows "Not signed" and
  signs nothing. A public
  seed and the made-up practice transaction sign with no question.
- The signed PSBT offered as text and file is controller.psbt after PSBTParser.trim, the bytes the device's UR encoder shows; the
  untrimmed PSBT (the parser's, signed in place) is checked with the page's inspectPsbt and psbtSigCheck first.
- Schnorr nonces: no aux randomness, the key itself hashed into the nonce (see ssPsbtSchnorrSign); ECDSA: RFC 6979, low S, ground
  for a DER signature of at most 70 bytes with the extra data 1, 2, ... (embit; Bitcoin Core grinds the same way on R alone).
  @scure/btc-signer's own lowR grinding starts at 0 and so differs whenever the first R is high: the tests use their own reference.
- The device's online rule for seed QR codes (ssToolsSeedScanBlocked) takes the decoder: a public seed is read online, and the
  SeedQR of LOAD INTO THE PRACTICE SIGNER after the person said yes (ssLearnSeedScanOk).
- v2.17.0 review and hands-on test (ss_own.js unless named):
  - SIM: VOIDFORGE rule in ssOwnSignGate, after the network: every non_witness_utxo must hash (the page's own psbtStripWitness and
    dsha256) to the input's txid, hold its output, and agree with a witness_utxo if there is one; else "Forged coin?" on the
    device's ErrorView. SeedSigner 0.8.7 (embit InputScope.utxo, PSBTParser._parse_inputs) takes the amount without this check.
  - ssOwnSignGate signs a throwaway copy first (ssOwnDryRun): with nothing to sign it asks nothing (the device ends on Signing
    Failed); multisig change not verified by a descriptor that holds the seed's own key (derived at the key's origin) and owns
    every input (ssOwnMsigTrust) needs a second confirm() that names the amount. ctx: {parser, desc} from SSPSBTFinalizeView.run,
    {message} from SSSeedSignMessageSignedMessageQRView.run (the message lesson's practice message signs with no question).
  - SIM: VOIDFORGE fix in SSPSBTInputScope.vin: the sequence is kept exactly (embit: `self.sequence or 0xFFFFFFFF`).
  - SIM: VOIDFORGE fix in SSPSBTOverviewView.run: an input with neither utxo shows "Cannot read PSBT" (SeedSigner: System Error,
    "local variable 'script_pubkey' referenced before assignment").
  - SIM: VOIDFORGE rule in SSController.start (ss_engine.js): Home keeps multisig_wallet_descriptor (SeedSigner 0.8.7 controller.py
    sets it to None there); it is dropped when the device is switched off (ssPageStop) or another descriptor is scanned.
  - SIM: VOIDFORGE rule in ssToolsSeedScanBlocked (ss_tools_settings.js): a seed QR scan starts while online; once a real seed is
    read the device asks (confirm), Yes loads it, No shows "Not loaded". No question offline, for a public seed, or for the SeedQR
    of an approved LOAD INTO THE PRACTICE SIGNER.
