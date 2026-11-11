# NOTES: tools, settings, scan (ss_tools_settings.js)

Source: SeedSigner 0.8.7 (e0a80d4b). The file has two sections:
- PART A: settings models, mnemonic generation, camera, QR decoder. It needs no engine class at load time. Load it BEFORE the engine, because the engine's SSGUIConstants reads SSSettingsConstants.
- PART B: views and screens. They extend SSView, SSBaseScreen, SSBaseTopNavScreen, SSButtonListScreen and SSKeyboardScreen, so load PART B AFTER the engine.

## Ported classes (Python name -> SS name)
- tools_views.py: ToolsMenuView, ToolsImageEntropyLivePreviewView, ToolsImageEntropyFinalImageView, ToolsImageEntropyMnemonicLengthView, ToolsDiceEntropyMnemonicLengthView, ToolsDiceEntropyEntryView, ToolsCalcFinalWordNumWordsView, ToolsCalcFinalWordFinalizePromptView, ToolsCalcFinalWordCoinFlipsView, ToolsCalcFinalWordShowFinalWordView, ToolsCalcFinalWordDoneView, ToolsAddressExplorerSelectSourceView, ToolsAddressExplorerAddressTypeView, ToolsAddressExplorerAddressListView, ToolsAddressExplorerAddressView.
- tools_screens.py: ToolsImageEntropyLivePreviewScreen, ToolsImageEntropyFinalImageScreen, ToolsDiceEntropyEntryScreen, ToolsCalcFinalWordFinalizePromptScreen, ToolsCoinFlipEntryScreen, ToolsCalcFinalWordScreen, ToolsCalcFinalWordDoneScreen, ToolsAddressExplorerAddressTypeScreen, ToolsAddressExplorerAddressListScreen.
- mnemonic_generation.py: every function (ssCalculateChecksum, ssGenerateMnemonicFromBytes/Dice/CoinFlips, ssGetPartialFinalWord, SS_DICE__NUM_ROLLS__12WORD/24WORD; also as the object SSMnemonicGeneration). embit's mnemonic_to_bytes is ported line for line (ssBip39MnemonicToBytes). Checked against embit: the same dice rolls give the same words, and calc-final-word gives the same final word.
- settings_definition.py: SettingsConstants (every constant, including all locales), SettingsEntry, SettingsDefinition (all 24 entries with their attr names, abbreviations, display names, types, options, defaults, visibility and help texts).
- settings.py: Settings (get_instance, parse_settingsqr, save, update, set_value, get_value, get_value_display_name, get_multiselect_value_display_names, load_locale, debug, handle_microsd_state_change), InvalidSettingsQRData.
- settings_views.py: SettingsMenuView, LocaleSelectionView, SettingsEntryUpdateSelectionView, SettingsSelectionRequiredWarningView, SettingsIngestSettingsQRView, IOTestView, DonateView.
- settings_screens.py: SettingsEntryUpdateSelectionScreen, IOTestScreen, DonateScreen, SettingsQRConfirmationScreen.
- scan_views.py: ScanView, ScanPSBTView, ScanSeedQRView, ScanWalletDescriptorView, ScanAddressView, ScanInvalidQRTypeView.
- scan_screens.py: ScanScreen and ScanScreen.LivePreviewThread (as SSScanScreenLivePreviewThread).
- camera.py: Camera, CameraConnectionError (as SSCamera, SSCameraConnectionError).
- decode_qr.py / qr_type.py, as far as the routing needs: QRType, DecodeQRStatus, DecodeQR (detect_segment_type, add_data, get_percent_complete, the is_* checks, base43_decode), SeedQrDecoder, SettingsQrDecoder, SignMessageQrDecoder, BitcoinAddressQrDecoder, BaseAnimatedQrDecoder.
- embit_utils.py: get_standard_derivation_path, get_single_sig_address (on VOIDFORGE's walletAddressesFrom), get_multisig_policy (on the descriptor object of ss_psbt.js, stage 2).

The settings menu in the code goes General -> Advanced -> Hardware. "Dev Options" exists but has no entries, and nothing links to it.

## Engine conventions this file assumes (please check when integrating)
- Screen base constructors copy every field they are given onto `this`, then call `this.__post_init__()`. Subclasses here override `__post_init__()`, call `super.__post_init__()`, and implement `async _run()`. Subclass dataclass fields are merged into the fields object, and `ssToolsAdoptFields` sets any of them the base constructor did not copy.
- `View.run_screen` may be async; every call is awaited. View constructors take `view_args` and call `super(view_args)`.
- Uses `SSButtonOption({button_label, ...})`, `SSDestination(View, {view_args, skip_current_view, clear_history})`, `SSLoadingScreenThread({text})` with start() and stop(), `SSController.FLOW__ADDRESS_EXPLORER`, and the controller's `back_stack[i].View_cls`.
- `screen.hw_inputs` is used if set, otherwise `SSHardwareButtons`. `check_for_low` is called once per key.
- `draw.text(xy, text, {fill, font, anchor, stroke_width, stroke_fill})`. If the engine ignores the stroke, the outline around the camera hint text is missing.
- Camera frames are pasted through the SSImage's 2D context (`ctx`, `_ctx`, `context`, `canvas`, `_canvas`, `el`) or `SSImage.fromCanvas`. See `ssToolsImageCtx`.
- SSSeed is built positionally: `new SSSeed(words, "", wordlist_language_code)`. If the seed exposes `ready`, it is awaited. Seed bytes are read from `get_seed_bytes()` or `seed_bytes`, falling back to the BIP-39 seed. `get_fingerprint` and the storage methods are awaited.
- `update_pending_mnemonic(word, -1)` is called as `(word, length - 1)`, which means the same thing, so the JS storage does not need to handle negative indexes.
- Seed-side names referenced: SSSeedWordsWarningView, SSSeedMnemonicEntryView, SSSeedFinalizeView, SSSeedDiscardView, SSSeedOptionsView, SSSeedExportXpubScriptTypeView, SSSeedElectrumMnemonicStartView, SSSeedAddPassphraseView, and optionally SSGenericStaticQrEncoder. If that encoder is missing, an internal one is used.
- Engine names referenced: SSMainMenuView, SSBackStackView, SSErrorView, SSNotYetImplementedView, SSCameraConnectionErrorView, SSWarningScreen, SSQRDisplayScreen, SSTextArea, SSIconTextLine, SSButton, SSIconButton, SSCheckboxButton, SSCheckedSelectionButton, SSFonts, SSRenderer, and the icon and GUI constants.

## SIM stand-ins (each marked `// SIM:` in the code)
- Camera: `getUserMedia` (video only, never audio, rear camera preferred) stands in for the Pi camera. It starts only when a camera tool, a scan or the I/O test runs, and it stops when that screen ends, including when the screen ends with an error. Frames are center-cropped to the Pi stream's size: 320x320 for the entropy preview, 640x640 for the final image, 480x480 for scanning and 320x240 for the I/O test. The rotation applied is the "Camera rotation" setting minus 180°, so the default setting gives an upright picture. If no camera is available or permission is refused, SeedSigner's own CameraConnectionErrorView is shown.
- Image entropy is computed the same way as tools_views.py: sha256 chains over b'0' (SeedSigner's fallback when there is no CPU serial), then `str(time.time())`, then each preview frame's RGBA bytes (the last 50 frames), then the final image's RGB bytes. A 12-word seed uses the first 16 bytes. Frames are wiped after use. The preview runs at about 24 fps.
- Settings persistence: the microSD settings.json is an in-memory string (SS_SIM_MICROSD). Nothing is written to browser storage. The card counts as inserted, and the device behaves as SeedSigner OS. Closing the box keeps only these settings; a later auto-clear, CLEAR ALL or END SESSION wipes them. A wipe removes the settings file first and drops the settings object after the device stops, and the page's lesson panel never reads settings while the device is off, so the next start loads the defaults (v2.15.0; the simulator test's settings_wipe scenario). The network setting starts on Mainnet, as on SeedSigner.
- Display type: the starting value is "st7789 320x240", because this is a SeedSigner+. The definition's default (st7789 240x240) is unchanged. As on a real device, a SettingsQR without `disp_conf` resets it to the default. `renderer.initialize_display()` and `disp.invert()` are called only if the engine provides them.
- Language: English only, as get_detected_languages() reports when no catalogs are present.
- I/O test: a 50 ms pause between the "selected" and "unselected" renders keeps the key highlight visible. On the device, the display's transfer time does this.
- Scan: one async loop at the stream framerate (6 fps) replaces the camera, decoder and preview threads. pyzbar is replaced by VOIDFORGE's `qrDecodeRgba`. The progress overlay (RGBA 0,0,0,191) is drawn in place, at the same coordinates.
- Address explorer: `data.xpub` is the account's extended public key (the seeds part's HDKey stand-in), as in SeedSigner; addresses come from the seeds part's get_single_sig_address (bcrt1 on regtest).

## Stage 2 (see NOTES-psbt.md)
- The scan routing is complete: PSBT -> PSBTSelectSeedView, wallet descriptor -> MultisigWalletDescriptorView (single-sig
  descriptors -> NotYetImplementedView, as in SeedSigner), address -> AddressVerificationStartView, sign message ->
  SeedSignMessageStartView. The PSBT and descriptor decoders of decode_qr.py are ported (Specter, BBQr, base64, base43,
  generic and Coldcard config-file descriptors, Specter wallet JSON, UR crypto-psbt / crypto-output / crypto-account /
  bytes); a PSBT is recognized by fully parsing it (SSPSBT.parse), as embit does.
- UR parts: SSURDecoder is a fountain decoder written from BCR-2020-005 (Xoshiro256** seeded by SHA-256, the degree
  sampler, the shuffle, XOR reduction of mixed parts, CRC-32), so an animation finishes from mixed parts as on the
  device. Checked against SeedSigner's own ur2 decoder part by part (accepted or not, both percents, complete) on 81
  sequences made with @ngraveio/bc-ur with pure parts skipped.
- For the integrator: VOIDFORGE's own camera reads a SeedQR only while the computer is offline; the scanner here follows
  the same rule (ssToolsSeedScanBlocked).
