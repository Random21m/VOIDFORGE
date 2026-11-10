# ss_engine.js notes (engine part)

Ported (Python -> JS, prefixed SS):
- PIL subset: Image (new, paste, crop, copy, resize, convert, filter, putalpha, tobytes, getpixel, alpha_composite),
  ImageDraw (rectangle, rounded_rectangle, line, ellipse, arc, polygon, point, text, textlength, textbbox),
  ImageFont (getbbox with all PIL anchors l/m/r x a/t/m/s/b/d, getlength, getmetrics), ImageColor.getrgb, ImageFilter.SHARPEN.
- gui/components.py: GUIConstants, FontAwesomeIconConstants, SeedSignerIconConstants, load_image (ssLoadImage), Fonts,
  TextDoesNotFitException, BaseComponent, TextArea (+HorizontalTextScrollThread), ScrollableTextLine, Icon (SSIcon),
  IconTextLine, FormattedAddress, BtcAmount, Button, CheckedSelectionButton, CheckboxButton, IconButton, LargeIconButton,
  TopNav, linear_interp, calc_bezier_curve, reflow_text_for_width, reflow_text_into_pages, resize_image_to_fill.
- gui/keyboard.py: Keyboard (+Key), TextEntryDisplayConstants, TextEntryDisplay.
- gui/toast.py: ToastOverlay, BaseToastOverlayManagerThread, RemoveSDCardToastManagerThread,
  SDCardStateChangeToastManagerThread, DefaultToast, InfoToast, SuccessToast, WarningToast, DireWarningToast, ErrorToast.
- gui/renderer.py: Renderer. gui/screens/screen.py: every class (BaseScreen, LoadingScreenThread, BaseTopNavScreen,
  ButtonOption, ButtonOptionWithoutTranslation, ButtonListScreen, LargeButtonScreen, QRDisplayScreen (+QRDisplayThread),
  LargeIconStatusScreen, WarningEdgesThread, WarningEdgesMixin, WarningScreen, DireWarningScreen, ErrorScreen, ResetScreen,
  PowerOffNotRequiredScreen (alias SSPowerOffScreen), KeyboardScreen, MainMenuScreen).
- hardware/buttons.py: HardwareButtons, HardwareButtonsConstants. hardware/microsd.py: MicroSD (SIM).
- models/threads.py: BaseThread, ThreadsafeCounter (+ SSLock for threading.Lock). helpers/qr.py: QR (via page qrMatrix).
  models/encode_qr.py: BaseQrEncoder, BaseStaticQrEncoder only (+ SSSimpleQrEncoder convenience).
- views/view.py: every class (BackStackView, View, Destination, MainMenuView, PowerOptionsView, RestartView, PowerOffView,
  NotYetImplementedView, ErrorView, NetworkMismatchErrorView, UnhandledExceptionView, CameraConnectionErrorView,
  OptionDisabledView, RemoveMicroSDWarningView). views/screensaver.py: LogoScreen, OpeningSplashView,
  OpeningSplashScreen, ScreensaverScreen. controller.py: BackStack, Controller (main loop, back stack, toasts, screensaver,
  handle_exception).

Left out: BackgroundImportThread, StopFlowBasedTest/FlowBasedTestException (test-suite only); display drivers;
locale-specific Noto fonts (non-English); concrete QR encoders (with the views).

SIM stand-ins (each marked `// SIM:` in the code):
- Display is always st7789 320x240; canvas drawn at devicePixelRatio. "Invert colors" applied as a canvas difference pass.
- GPIO -> key state (keyboard / page buttons); a tap released before the 10 ms poll still counts once (kept until wait_for
  returns it); key repeat only while a key is held down without a break (SeedSigner's 225/250 ms rule), at most one per 60 ms.
- wait_for() waits for the Renderer lock before returning a key (Python blocks on `with renderer.lock` right after).
- TextArea supersampling (2x + LANCZOS + SHARPEN) disabled: canvas already renders at device resolution. filter() = copy.
- Curved shapes are rasterized with a hard coverage threshold (PIL is aliased) so redraws leave no fringes;
  loading spinner clears its orbit each frame for the same reason.
- Animation pacing where Python is limited by SPI writes: splash fade 30 ms/step, spinner 40 ms, screensaver and
  show_image_pan 1/30 s per frame.
- FontAwesome glyphs are drawn as own vector shapes using FA's metrics (Font Awesome itself is not embedded).
- Text metrics: vertical ink extents of ASCII come from a table generated with Pillow/FreeType (hinted), so layout math
  matches the device; other characters use canvas measureText.
- RestartView: os.execv -> restart from splash, in-memory data wiped (settings reset unless persistent settings enabled).
- MicroSD: counts as inserted at boot; SSMicroSD.get_instance().set_inserted(bool) simulates removal/insertion.
- Missing views from other parts resolve to NotYetImplementedView.
