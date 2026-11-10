// ss_tools_settings.js: SeedSigner 0.8.7 (commit e0a80d4b) TOOLS, SETTINGS and SCAN, ported to browser JavaScript.
// Ported from: views/tools_views.py, gui/screens/tools_screens.py, helpers/mnemonic_generation.py,
// models/settings_definition.py, models/settings.py, views/settings_views.py, gui/screens/settings_screens.py,
// views/scan_views.py, gui/screens/scan_screens.py, hardware/camera.py and the parts of models/decode_qr.py the scan routing needs.
//
// Two sections:
//   PART A has NO dependency on the engine at load time (settings, mnemonic generation, camera, QR decoder). The engine's
//          SSGUIConstants reads SSSettingsConstants, so PART A should be loaded BEFORE the engine.
//   PART B extends engine classes (SSView, SSBaseScreen, SSButtonListScreen, ...) at load time, so it must be loaded AFTER
//          the engine. Everything else (seed views, controller fields) is looked up only at run time.
// Python dataclass fields keep their snake_case names. Screens override __post_init__() and async _run()/_render().


/* =====================================================================================================================
   PART A: models and helpers (no engine classes needed at load time)
   ===================================================================================================================== */

// ---- small helpers -------------------------------------------------------------------------------------------------
function ssToolsInt(x) { return Math.trunc(x); }   // Python int() on a float truncates toward zero
// (aborts with SSAbort when the page stops or restarts the device meanwhile: SS_GEN, see ss_engine.js ssSleep)
function ssToolsSleep(ms) {
  const gen = (typeof SS_GEN !== "undefined") ? SS_GEN : 0;
  return new Promise((resolve, reject) => setTimeout(() => ((typeof SS_GEN === "undefined" || gen === SS_GEN) ? resolve() : reject(new SSAbort())), ms));
}
function ssToolsArg(args, key, def) { return (args && args[key] !== undefined) ? args[key] : def; }
function ssToolsConcat(a, b) { const o = new Uint8Array(a.length + b.length); o.set(a, 0); o.set(b, a.length); return o; }
function ssToolsHasKey(obj, key) { return obj !== null && obj !== undefined && Object.prototype.hasOwnProperty.call(obj, key); }
function ssToolsBits11(n) { return n.toString(2).padStart(11, "0"); }   // format(n, '011b')

// Dataclass subclass fields: the subclass constructor merges its own field defaults into the one fields object, and also
// stacks them so __post_init__ can adopt any field the engine's base constructor did not copy onto `this`.
const SS_TOOLS_PENDING_FIELDS = [];
function ssToolsFields(defaults, fields) {
  const out = Object.assign({}, defaults);
  if (fields) for (const k of Object.keys(fields)) if (fields[k] !== undefined) out[k] = fields[k];
  return out;
}
function ssToolsAdoptFields(obj) {
  const f = SS_TOOLS_PENDING_FIELDS[SS_TOOLS_PENDING_FIELDS.length - 1];
  if (!f) return;
  for (const k of Object.keys(f)) if (!(k in obj) || obj[k] === undefined) obj[k] = f[k];
}

// ---- models/settings_definition.py: SettingsConstants ----------------------------------------------------------------
class SSSettingsConstants {
  static get_detected_languages() {
    // SIM: SeedSigner scans the filesystem for translation catalogs. None are bundled here (English only), so only
    // English is detected, exactly as on a SeedSigner without the seedsigner-translations submodule.
    const C = SSSettingsConstants;
    return [[C.LOCALE__ENGLISH, C.ALL_LOCALES[C.LOCALE__ENGLISH]]];
  }

  static map_network_to_embit(network) {
    // Note these are `embit` constants; do not wrap for translation
    if (network === SSSettingsConstants.MAINNET) return "main";
    else if (network === SSSettingsConstants.TESTNET) return "test";
    if (network === SSSettingsConstants.REGTEST) return "regtest";
    return undefined;
  }
}
(function (C) {
  // Basic defaults
  C.OPTION__ENABLED = "E";
  C.OPTION__DISABLED = "D";
  C.OPTION__PROMPT = "P";
  C.OPTION__REQUIRED = "R";
  C.OPTIONS__ENABLED_DISABLED = [[C.OPTION__ENABLED, "Enabled"], [C.OPTION__DISABLED, "Disabled"]];
  C.OPTIONS__ONLY_DISABLED = [[C.OPTION__DISABLED, "Disabled"]];
  C.OPTIONS__PROMPT_REQUIRED_DISABLED = [[C.OPTION__PROMPT, "Prompt"], [C.OPTION__REQUIRED, "Required"], [C.OPTION__DISABLED, "Disabled"]];
  C.OPTIONS__ENABLED_DISABLED_REQUIRED = C.OPTIONS__ENABLED_DISABLED.concat([[C.OPTION__REQUIRED, "Required"]]);
  C.OPTIONS__ENABLED_DISABLED_PROMPT = C.OPTIONS__ENABLED_DISABLED.concat([[C.OPTION__PROMPT, "Prompt"]]);
  C.ALL_OPTIONS = C.OPTIONS__ENABLED_DISABLED_PROMPT.concat([[C.OPTION__REQUIRED, "Required"]]);

  // User-facing selection options
  C.XPUB_QR_FORMAT__UR_CRYPTO_ACCOUNT = "urca";
  C.XPUB_QR_FORMAT__STATIC = "sta";
  C.XPUB_QR_FORMAT__SPECTER_LEGACY = "spl";
  C.ALL_XPUB_QR_FORMATS = [
    [C.XPUB_QR_FORMAT__UR_CRYPTO_ACCOUNT, "Animated (default)"],
    [C.XPUB_QR_FORMAT__STATIC, "Static"],
    [C.XPUB_QR_FORMAT__SPECTER_LEGACY, "Specter legacy"],
  ];

  C.LOCALE__ARABIC = "ar";
  C.LOCALE__BENGALI = "bn";
  C.LOCALE__BULGARIAN = "bg";
  C.LOCALE__CATALAN = "ca";
  C.LOCALE__CHINESE_SIMPLIFIED = "zh_Hans_CN";
  C.LOCALE__CHINESE_TRADITIONAL = "zh_Hant_TW";
  C.LOCALE__CROATIAN = "hr";
  C.LOCALE__CZECH = "cs";
  C.LOCALE__DANISH = "da";
  C.LOCALE__DUTCH = "nl";
  C.LOCALE__EGYPTIAN = "ar_EG";
  C.LOCALE__ENGLISH = "en";
  C.LOCALE__ESTONIAN = "et";
  C.LOCALE__FINNISH = "fi";
  C.LOCALE__FRENCH = "fr";
  C.LOCALE__GAELIC = "gd";
  C.LOCALE__GERMAN = "de";
  C.LOCALE__GREEK = "el";
  C.LOCALE__GUJARATI = "gu";
  C.LOCALE__HAUSA = "ha";
  C.LOCALE__HEBREW = "he";
  C.LOCALE__HINDI = "hi";
  C.LOCALE__HUNGARIAN = "hu";
  C.LOCALE__INDONESIAN = "id";
  C.LOCALE__ITALIAN = "it";
  C.LOCALE__JAPANESE = "ja";
  C.LOCALE__JAVANESE = "jv";
  C.LOCALE__KOREAN = "ko";
  C.LOCALE__LAO = "lo";
  C.LOCALE__LATVIAN = "lv";
  C.LOCALE__LITHUANIAN = "lt";
  C.LOCALE__MALAY = "ms";
  C.LOCALE__MALTESE = "mt";
  C.LOCALE__MARATHI = "mr";
  C.LOCALE__NORWEGIAN = "no";
  C.LOCALE__PERSIAN = "fa";
  C.LOCALE__POLISH = "pl";
  C.LOCALE__PORTUGUESE_BR = "pt_BR";
  C.LOCALE__PORTUGUESE_PT = "pt_PT";
  C.LOCALE__PUNJABI = "pa";
  C.LOCALE__ROMANIAN = "ro";
  C.LOCALE__RUSSIAN = "ru";
  C.LOCALE__SLOVAK = "sk";
  C.LOCALE__SLOVENIAN = "sl";
  C.LOCALE__SPANISH = "es";
  C.LOCALE__SWEDISH = "sv";
  C.LOCALE__TAGALOG = "tl";
  C.LOCALE__TAMIL = "ta";
  C.LOCALE__TELUGU = "te";
  C.LOCALE__THAI = "th";
  C.LOCALE__TURKISH = "tr";
  C.LOCALE__UKRANIAN = "uk";
  C.LOCALE__URDU = "ur";
  C.LOCALE__VIETNAMESE = "vi";

  // Insertion order is kept (as Python dicts do). Commented-out entries are commented out in SeedSigner too.
  C.ALL_LOCALES = {};
  [
    // --------- Fully supported languages ---------
    [C.LOCALE__CATALAN, "Català"],
    [C.LOCALE__GERMAN, "Deutsch"],
    [C.LOCALE__ENGLISH, "English"],
    [C.LOCALE__SPANISH, "Español"],
    [C.LOCALE__FRENCH, "Français"],
    [C.LOCALE__ITALIAN, "Italiano"],
    [C.LOCALE__DUTCH, "Nederlands"],
    // --------- Beta languages ---------
    [C.LOCALE__CZECH, "(beta) Čeština"],
    [C.LOCALE__CHINESE_SIMPLIFIED, "(beta) 简体中文 (Chinese Simplified)"],
    [C.LOCALE__HINDI, "(beta) हिन्दी (Hindi)"],
    [C.LOCALE__INDONESIAN, "(beta) Indonesia (Indonesian)"],
    [C.LOCALE__JAPANESE, "(beta) 日本語 (Japanese)"],
    [C.LOCALE__KOREAN, "(beta) 한국어 (Korean)"],
    [C.LOCALE__PERSIAN, "(beta) فارسی (Persian)"],
    [C.LOCALE__POLISH, "(beta) Polski"],
    [C.LOCALE__PORTUGUESE_BR, "(beta) Português (Brasil)"],
    [C.LOCALE__THAI, "(beta) ไทย (Thai)"],
    [C.LOCALE__VIETNAMESE, "(beta) Tiếng Việt (Vietnamese)"],
    // --------- In Progress Languages ---------
    [C.LOCALE__GREEK, "(incomplete) Ελληνικά (Greek)"],
    [C.LOCALE__NORWEGIAN, "(incomplete) Norsk (Norwegian)"],
    [C.LOCALE__RUSSIAN, "(incomplete) русский (Russian)"],
    [C.LOCALE__TURKISH, "(incomplete) Türkçe (Turkish)"],
    // --------- Placeholders / Coming soon ---------
    [C.LOCALE__ARABIC, "العربية (Arabic)"],
    // [C.LOCALE__BENGALI, "বাংলা (Bengali)"],
    [C.LOCALE__BULGARIAN, "български (Bulgarian)"],
    // [C.LOCALE__CHINESE_TRADITIONAL, "繁體中文 (Chinese Traditional)"],
    [C.LOCALE__DANISH, "Dansk"],
    [C.LOCALE__ESTONIAN, "Eesti"],
    // [C.LOCALE__EGYPTIAN, "مصرى (Egyptian)"],
    [C.LOCALE__GAELIC, "Gaeilge"],
    // [C.LOCALE__GUJARATI, "ગુજરાતી (Gujarati)"],
    [C.LOCALE__HAUSA, "Hausa"],
    // [C.LOCALE__HEBREW, "עברית (Hebrew)"],
    [C.LOCALE__CROATIAN, "Hrvatski"],
    [C.LOCALE__JAVANESE, "Jawa (Javanese)"],
    // [C.LOCALE__LAO, "ລາວ (Lao)"],
    [C.LOCALE__LATVIAN, "Latviešu"],
    [C.LOCALE__LITHUANIAN, "Lietuvių"],
    [C.LOCALE__HUNGARIAN, "Magyar"],
    [C.LOCALE__MALAY, "Melayu"],
    [C.LOCALE__MALTESE, "Malti"],
    // [C.LOCALE__MARATHI, "मराठी (Marathi)"],
    [C.LOCALE__PORTUGUESE_PT, "Português (Portugal)"],
    // [C.LOCALE__PUNJABI, "ਪੰਜਾਬੀ (Punjabi)"],
    [C.LOCALE__ROMANIAN, "Română"],
    [C.LOCALE__SLOVAK, "Slovenčina"],
    [C.LOCALE__SLOVENIAN, "Slovenščina"],
    [C.LOCALE__FINNISH, "Suomi"],
    [C.LOCALE__SWEDISH, "Svenska"],
    [C.LOCALE__TAGALOG, "Tagalog"],
    // [C.LOCALE__TAMIL, "தமிழ் (Tamil)"],
    // [C.LOCALE__TELUGU, "తెలుగు (Telugu)"],
    [C.LOCALE__UKRANIAN, "українська (Ukranian)"],
    // [C.LOCALE__URDU, "اردو (Urdu)"],
  ].forEach(([k, v]) => { C.ALL_LOCALES[k] = v; });

  C.BTC_DENOMINATION__BTC = "btc";
  C.BTC_DENOMINATION__SATS = "sats";
  C.BTC_DENOMINATION__THRESHOLD = "thr";
  C.BTC_DENOMINATION__BTCSATSHYBRID = "hyb";
  C.ALL_BTC_DENOMINATIONS = [
    [C.BTC_DENOMINATION__BTC, "BTC"],
    [C.BTC_DENOMINATION__SATS, "sats"],
    [C.BTC_DENOMINATION__THRESHOLD, "Threshold at 0.01"],
    [C.BTC_DENOMINATION__BTCSATSHYBRID, "BTC | sats hybrid"],
  ];

  C.CAMERA_ROTATION__0 = 0;
  C.CAMERA_ROTATION__90 = 90;
  C.CAMERA_ROTATION__180 = 180;
  C.CAMERA_ROTATION__270 = 270;
  C.ALL_CAMERA_ROTATIONS = [
    [C.CAMERA_ROTATION__0, "0°"],
    [C.CAMERA_ROTATION__90, "90°"],
    [C.CAMERA_ROTATION__180, "180°"],
    [C.CAMERA_ROTATION__270, "270°"],
  ];

  // QR code constants
  C.DENSITY__LOW = "L";
  C.DENSITY__MEDIUM = "M";
  C.DENSITY__HIGH = "H";
  C.density_low = "Low";
  C.density_medium = "Medium";
  C.density_high = "High";
  C.ALL_DENSITIES = [[C.DENSITY__LOW, C.density_low], [C.DENSITY__MEDIUM, C.density_medium], [C.DENSITY__HIGH, C.density_high]];

  // Seed-related constants
  C.MAINNET = "M";
  C.TESTNET = "T";
  C.REGTEST = "R";
  C.ALL_NETWORKS = [[C.MAINNET, "Mainnet"], [C.TESTNET, "Testnet"], [C.REGTEST, "Regtest"]];

  C.PERSISTENT_SETTINGS__SD_INSERTED__HELP_TEXT = "Store Settings on SD card";
  C.PERSISTENT_SETTINGS__SD_REMOVED__HELP_TEXT = "Insert SD card to enable";

  C.SINGLE_SIG = "ss";
  C.MULTISIG = "ms";
  C.ALL_SIG_TYPES = [[C.SINGLE_SIG, "Single Sig"], [C.MULTISIG, "Multisig"]];

  C.LEGACY_P2PKH = "leg";
  C.NATIVE_SEGWIT = "nat";
  C.NESTED_SEGWIT = "nes";
  C.TAPROOT = "tr";
  C.CUSTOM_DERIVATION = "cus";
  C.ALL_SCRIPT_TYPES = [
    [C.NATIVE_SEGWIT, "Native Segwit"],
    [C.NESTED_SEGWIT, "Nested Segwit"],
    [C.LEGACY_P2PKH, "Legacy"],
    [C.TAPROOT, "Taproot"],
    [C.CUSTOM_DERIVATION, "Custom Derivation"],
  ];

  C.MICROSD_TOAST_TIMER_DISABLED = "D";
  C.MICROSD_TOAST_TIMER_FIVE_SECONDS = "E";
  C.MICROSD_TOAST_TIMER_FOREVER = "inf";
  C.ALL_MICROSD_TOAST_TIMERS = [
    [C.MICROSD_TOAST_TIMER_DISABLED, "Disabled"],
    [C.MICROSD_TOAST_TIMER_FIVE_SECONDS, "5 seconds"],
    [C.MICROSD_TOAST_TIMER_FOREVER, "Until SD removed"],
  ];

  C.WORDLIST_LANGUAGE__ENGLISH = "en";
  C.WORDLIST_LANGUAGE__CHINESE_SIMPLIFIED = "zh_Hans_CN";
  C.WORDLIST_LANGUAGE__CHINESE_TRADITIONAL = "zh_Hant_TW";
  C.WORDLIST_LANGUAGE__FRENCH = "fr";
  C.WORDLIST_LANGUAGE__ITALIAN = "it";
  C.WORDLIST_LANGUAGE__JAPANESE = "jp";
  C.WORDLIST_LANGUAGE__KOREAN = "kr";
  C.WORDLIST_LANGUAGE__PORTUGUESE = "pt";
  C.ALL_WORDLIST_LANGUAGES = [
    [C.WORDLIST_LANGUAGE__ENGLISH, "English"],
    // the other wordlists are commented out in SeedSigner 0.8.7 too
  ];

  // Individual SettingsEntry attr_names
  C.SETTING__LOCALE = "locale";
  C.SETTING__WORDLIST_LANGUAGE = "wordlist_language";
  C.SETTING__PERSISTENT_SETTINGS = "persistent_settings";
  C.SETTING__XPUB_QR_FORMAT = "xpub_qr";
  C.SETTING__BTC_DENOMINATION = "denomination";
  C.SETTING__DISPLAY_CONFIGURATION = "display_config";
  C.SETTING__DISPLAY_COLOR_INVERTED = "color_inverted";
  C.SETTING__NETWORK = "network";
  C.SETTING__QR_DENSITY = "qr_density";
  C.SETTING__SIG_TYPES = "sig_types";
  C.SETTING__SCRIPT_TYPES = "script_types";
  C.SETTING__XPUB_DETAILS = "xpub_details";
  C.SETTING__PASSPHRASE = "passphrase";
  C.SETTING__CAMERA_ROTATION = "camera_rotation";
  C.SETTING__COMPACT_SEEDQR = "compact_seedqr";
  C.SETTING__BIP85_CHILD_SEEDS = "bip85_child_seeds";
  C.SETTING__ELECTRUM_SEEDS = "electrum_seeds";
  C.SETTING__MESSAGE_SIGNING = "message_signing";
  C.SETTING__PRIVACY_WARNINGS = "privacy_warnings";
  C.SETTING__DIRE_WARNINGS = "dire_warnings";
  C.SETTING__QR_BRIGHTNESS_TIPS = "qr_brightness_tips";
  C.SETTING__PARTNER_LOGOS = "partner_logos";
  C.SETTING__MICROSD_TOAST_TIMER = "microsd_toast_timer";
  C.SETTING__DEBUG = "debug";

  // Hardware config settings
  C.DISPLAY_CONFIGURATION__ST7789__240x240 = "st7789_240x240";
  C.DISPLAY_CONFIGURATION__ST7789__320x240 = "st7789_320x240";
  C.DISPLAY_CONFIGURATION__ILI9341__320x240 = "ili9341_320x240";
  C.DISPLAY_CONFIGURATION__ILI9486__480x320 = "ili9486_480x320";
  C.ALL_DISPLAY_CONFIGURATIONS = [
    [C.DISPLAY_CONFIGURATION__ST7789__240x240, "st7789 240x240"],
    [C.DISPLAY_CONFIGURATION__ST7789__320x240, "st7789 320x240"],
    [C.DISPLAY_CONFIGURATION__ILI9341__320x240, "ili9341 320x240 (beta)"],
    // ili9486 is commented out in SeedSigner 0.8.7 too
  ];

  // Hidden settings
  C.SETTING__QR_BRIGHTNESS = "qr_background_color";

  // Structural constants
  C.CATEGORY__SYSTEM = "system";
  C.CATEGORY__DISPLAY = "display";
  C.CATEGORY__WALLET = "wallet";
  C.CATEGORY__FEATURES = "features";

  C.VISIBILITY__GENERAL = "general";
  C.VISIBILITY__ADVANCED = "advanced";
  C.VISIBILITY__HARDWARE = "hardware";
  C.VISIBILITY__DEVELOPER = "developer";
  C.VISIBILITY__HIDDEN = "hidden";

  C.TYPE__ENABLED_DISABLED = "enabled_disabled";
  C.TYPE__ENABLED_DISABLED_PROMPT = "enabled_disabled_prompt";
  C.TYPE__ENABLED_DISABLED_PROMPT_REQUIRED = "enabled_disabled_prompt_required";
  C.TYPE__SELECT_1 = "select_1";
  C.TYPE__MULTISELECT = "multiselect";
  C.TYPE__FREE_ENTRY = "free_entry";
  C.ALL_ENABLED_DISABLED_TYPES = [C.TYPE__ENABLED_DISABLED, C.TYPE__ENABLED_DISABLED_PROMPT, C.TYPE__ENABLED_DISABLED_PROMPT_REQUIRED];

  // Electrum seed constants
  C.ELECTRUM_SEED_STANDARD = "01";
  C.ELECTRUM_SEED_SEGWIT = "100";
  C.ELECTRUM_SEED_2FA = "101";
  C.ELECTRUM_PBKDF2_ROUNDS = 2048;

  // Label strings
  C.LABEL__BIP39_PASSPHRASE = "BIP-39 Passphrase";
  C.custom_extension = "Custom Extension";
  C.LABEL__CUSTOM_EXTENSION = C.custom_extension;
})(SSSettingsConstants);


// ---- models/settings_definition.py: SettingsEntry (dataclass) ----------------------------------------------------------
class SSSettingsEntry {
  constructor(fields = {}) {
    const C = SSSettingsConstants;
    const f = ssToolsFields({
      abbreviated_name: null,
      visibility: C.VISIBILITY__GENERAL,
      type: C.TYPE__ENABLED_DISABLED,
      help_text: null,
      selection_options: null,
      default_value: null,
    }, fields);
    this.category = f.category;
    this.attr_name = f.attr_name;
    this.display_name = f.display_name;
    this.abbreviated_name = f.abbreviated_name;
    this.visibility = f.visibility;
    this.type = f.type;
    this.help_text = f.help_text;
    this.selection_options = f.selection_options;
    this.default_value = f.default_value;
    this.__post_init__();
  }

  __post_init__() {
    const C = SSSettingsConstants;
    if (this.type === C.TYPE__ENABLED_DISABLED) this.selection_options = C.OPTIONS__ENABLED_DISABLED;
    else if (this.type === C.TYPE__ENABLED_DISABLED_PROMPT) this.selection_options = C.OPTIONS__ENABLED_DISABLED_PROMPT;
    else if (this.type === C.TYPE__ENABLED_DISABLED_PROMPT_REQUIRED) this.selection_options = C.ALL_OPTIONS;

    // Account for List[tuple] format as default_value (a tuple is a 2-item array here). SeedSigner also accepts a bare tuple
    // default; no entry uses one, and in JS it cannot be told apart from a list of values, so that branch is omitted.
    if (Array.isArray(this.default_value) && Array.isArray(this.default_value[0])) {
      this.default_value = this.default_value.map(v => v[0]);
    }

    if (!this.abbreviated_name) this.abbreviated_name = this.attr_name;
  }

  get selection_options_display_names() {
    if (Array.isArray(this.selection_options[0])) return this.selection_options.map(v => v[1]);
    // Always return a copy so the original can't be altered
    return this.selection_options.slice();
  }

  get_selection_option_value(i) {
    let value = this.selection_options[i];
    if (Array.isArray(value)) value = value[0];
    return value;
  }

  get_selection_option_display_name_by_value(value) {
    for (const option of this.selection_options) {
      let option_value, display_name;
      if (Array.isArray(option)) { option_value = option[0]; display_name = option[1]; }
      else { option_value = option; display_name = option; }
      if (option_value === value) return display_name;
    }
    return null;
  }

  get_selection_option_value_by_display_name(display_name) {
    for (const option of this.selection_options) {
      let option_value, option_display_name;
      if (Array.isArray(option)) { option_value = option[0]; option_display_name = option[1]; }
      else { option_value = option; option_display_name = option; }
      if (option_display_name === display_name) return option_value;
    }
    return null;
  }

  to_dict() {
    let selection_options = null;
    if (this.selection_options) {
      selection_options = this.selection_options.map(option => Array.isArray(option)
        ? {display_name: option[1], value: option[0]}
        : {display_name: option, value: option});
    }
    return {
      category: this.category,
      attr_name: this.attr_name,
      abbreviated_name: this.abbreviated_name,
      display_name: this.display_name,
      visibility: this.visibility,
      type: this.type,
      help_text: this.help_text,
      selection_options: selection_options,
      default_value: this.default_value,
    };
  }
}


// ---- models/settings_definition.py: SettingsDefinition ---------------------------------------------------------------
class SSSettingsDefinition {
  static get_settings_entries(visibility = SSSettingsConstants.VISIBILITY__GENERAL) {
    return SSSettingsDefinition.settings_entries.filter(entry => entry.visibility === visibility);
  }

  static get_settings_entry(attr_name) {
    for (const entry of SSSettingsDefinition.settings_entries) if (entry.attr_name === attr_name) return entry;
    return null;
  }

  static get_settings_entry_by_abbreviated_name(abbreviated_name) {
    for (const entry of SSSettingsDefinition.settings_entries) {
      if (abbreviated_name === entry.abbreviated_name || abbreviated_name === entry.attr_name) return entry;
    }
    return null;
  }

  static get_defaults(use_abbreviated_name = false, skip_hidden = false) {
    const as_dict = {};
    for (const entry of SSSettingsDefinition.settings_entries) {
      if (skip_hidden && entry.visibility === SSSettingsConstants.VISIBILITY__HIDDEN) continue;
      const attr_name = use_abbreviated_name ? entry.abbreviated_name : entry.attr_name;
      // Must copy the default_value list, otherwise we'd inadvertently change defaults when updating these attrs
      as_dict[attr_name] = Array.isArray(entry.default_value) ? entry.default_value.slice() : entry.default_value;
    }
    return as_dict;
  }

  static to_dict() {
    return {settings_entries: SSSettingsDefinition.settings_entries.map(e => e.to_dict())};
  }
}
SSSettingsDefinition.version = 1;
(function (C) {
  SSSettingsDefinition.settings_entries = [
    // General options
    new SSSettingsEntry({category: C.CATEGORY__SYSTEM,
      attr_name: C.SETTING__LOCALE,
      abbreviated_name: "lang",
      display_name: "Language",
      type: C.TYPE__SELECT_1,
      selection_options: C.get_detected_languages(),
      default_value: C.LOCALE__ENGLISH}),

    // TODO (SeedSigner): Support other BIP-39 wordlist languages! Until then, type == HIDDEN
    new SSSettingsEntry({category: C.CATEGORY__SYSTEM,
      attr_name: C.SETTING__WORDLIST_LANGUAGE,
      abbreviated_name: "wordlist_lang",
      display_name: "Mnemonic language",
      type: C.TYPE__SELECT_1,
      visibility: C.VISIBILITY__HIDDEN,
      selection_options: C.ALL_WORDLIST_LANGUAGES,
      default_value: C.WORDLIST_LANGUAGE__ENGLISH}),

    new SSSettingsEntry({category: C.CATEGORY__SYSTEM,
      attr_name: C.SETTING__PERSISTENT_SETTINGS,
      abbreviated_name: "persistent",
      display_name: "Persistent settings",
      help_text: C.PERSISTENT_SETTINGS__SD_INSERTED__HELP_TEXT,
      default_value: C.OPTION__DISABLED}),

    new SSSettingsEntry({category: C.CATEGORY__SYSTEM,
      attr_name: C.SETTING__BTC_DENOMINATION,
      abbreviated_name: "denom",
      display_name: "Denomination display",
      type: C.TYPE__SELECT_1,
      selection_options: C.ALL_BTC_DENOMINATIONS,
      default_value: C.BTC_DENOMINATION__THRESHOLD}),

    // Advanced options
    new SSSettingsEntry({category: C.CATEGORY__FEATURES,
      attr_name: C.SETTING__NETWORK,
      display_name: "Bitcoin network",
      type: C.TYPE__SELECT_1,
      visibility: C.VISIBILITY__ADVANCED,
      selection_options: C.ALL_NETWORKS,
      default_value: C.MAINNET}),

    new SSSettingsEntry({category: C.CATEGORY__FEATURES,
      attr_name: C.SETTING__QR_DENSITY,
      display_name: "QR code density",
      type: C.TYPE__SELECT_1,
      visibility: C.VISIBILITY__ADVANCED,
      selection_options: C.ALL_DENSITIES,
      default_value: C.DENSITY__MEDIUM}),

    new SSSettingsEntry({category: C.CATEGORY__FEATURES,
      attr_name: C.SETTING__SIG_TYPES,
      abbreviated_name: "sigs",
      display_name: "Sig types",
      type: C.TYPE__MULTISELECT,
      visibility: C.VISIBILITY__ADVANCED,
      selection_options: C.ALL_SIG_TYPES,
      default_value: C.ALL_SIG_TYPES}),

    new SSSettingsEntry({category: C.CATEGORY__FEATURES,
      attr_name: C.SETTING__SCRIPT_TYPES,
      abbreviated_name: "scripts",
      display_name: "Script types",
      type: C.TYPE__MULTISELECT,
      visibility: C.VISIBILITY__ADVANCED,
      selection_options: C.ALL_SCRIPT_TYPES,
      default_value: [C.NATIVE_SEGWIT, C.NESTED_SEGWIT, C.TAPROOT]}),

    new SSSettingsEntry({category: C.CATEGORY__FEATURES,
      attr_name: C.SETTING__XPUB_QR_FORMAT,
      display_name: "Xpub QR format",
      visibility: C.VISIBILITY__ADVANCED,
      type: C.TYPE__MULTISELECT,
      selection_options: C.ALL_XPUB_QR_FORMATS,
      default_value: [C.XPUB_QR_FORMAT__UR_CRYPTO_ACCOUNT, C.XPUB_QR_FORMAT__STATIC]}),

    new SSSettingsEntry({category: C.CATEGORY__FEATURES,
      attr_name: C.SETTING__XPUB_DETAILS,
      display_name: "Show xpub details",
      visibility: C.VISIBILITY__ADVANCED,
      default_value: C.OPTION__ENABLED}),

    new SSSettingsEntry({category: C.CATEGORY__FEATURES,
      attr_name: C.SETTING__PASSPHRASE,
      display_name: "BIP-39 passphrase",
      type: C.TYPE__SELECT_1,
      visibility: C.VISIBILITY__ADVANCED,
      selection_options: C.OPTIONS__ENABLED_DISABLED_REQUIRED,
      default_value: C.OPTION__ENABLED}),

    new SSSettingsEntry({category: C.CATEGORY__FEATURES,
      attr_name: C.SETTING__CAMERA_ROTATION,
      abbreviated_name: "camera",
      display_name: "Camera rotation",
      type: C.TYPE__SELECT_1,
      visibility: C.VISIBILITY__ADVANCED,
      selection_options: C.ALL_CAMERA_ROTATIONS,
      default_value: C.CAMERA_ROTATION__180}),

    new SSSettingsEntry({category: C.CATEGORY__FEATURES,
      attr_name: C.SETTING__COMPACT_SEEDQR,
      display_name: "Compact SeedQR",
      visibility: C.VISIBILITY__ADVANCED,
      default_value: C.OPTION__ENABLED}),

    new SSSettingsEntry({category: C.CATEGORY__FEATURES,
      attr_name: C.SETTING__BIP85_CHILD_SEEDS,
      abbreviated_name: "bip85",
      display_name: "BIP-85 child seeds",
      visibility: C.VISIBILITY__ADVANCED,
      default_value: C.OPTION__DISABLED}),

    new SSSettingsEntry({category: C.CATEGORY__FEATURES,
      attr_name: C.SETTING__ELECTRUM_SEEDS,
      abbreviated_name: "electrum",
      display_name: "Electrum seeds",
      help_text: "Native Segwit only",
      visibility: C.VISIBILITY__ADVANCED,
      default_value: C.OPTION__DISABLED}),

    new SSSettingsEntry({category: C.CATEGORY__FEATURES,
      attr_name: C.SETTING__MICROSD_TOAST_TIMER,
      display_name: "MicroSD notification duration",
      type: C.TYPE__SELECT_1,
      visibility: C.VISIBILITY__ADVANCED,
      selection_options: C.ALL_MICROSD_TOAST_TIMERS,
      default_value: C.MICROSD_TOAST_TIMER_FIVE_SECONDS}),

    new SSSettingsEntry({category: C.CATEGORY__FEATURES,
      attr_name: C.SETTING__MESSAGE_SIGNING,
      display_name: "Message signing",
      visibility: C.VISIBILITY__ADVANCED,
      default_value: C.OPTION__DISABLED}),

    new SSSettingsEntry({category: C.CATEGORY__FEATURES,
      attr_name: C.SETTING__PRIVACY_WARNINGS,
      abbreviated_name: "priv_warn",
      display_name: "Show privacy warnings",
      visibility: C.VISIBILITY__ADVANCED,
      default_value: C.OPTION__ENABLED}),

    new SSSettingsEntry({category: C.CATEGORY__FEATURES,
      attr_name: C.SETTING__DIRE_WARNINGS,
      abbreviated_name: "dire_warn",
      display_name: "Show dire warnings",
      visibility: C.VISIBILITY__ADVANCED,
      default_value: C.OPTION__ENABLED}),

    new SSSettingsEntry({category: C.CATEGORY__FEATURES,
      attr_name: C.SETTING__QR_BRIGHTNESS_TIPS,
      display_name: "Show QR brightness tips",
      visibility: C.VISIBILITY__ADVANCED,
      default_value: C.OPTION__ENABLED}),

    new SSSettingsEntry({category: C.CATEGORY__FEATURES,
      attr_name: C.SETTING__PARTNER_LOGOS,
      abbreviated_name: "partners",
      display_name: "Show partner logos",
      visibility: C.VISIBILITY__ADVANCED,
      default_value: C.OPTION__ENABLED}),

    // Hardware config
    new SSSettingsEntry({category: C.CATEGORY__SYSTEM,
      attr_name: C.SETTING__DISPLAY_CONFIGURATION,
      abbreviated_name: "disp_conf",
      display_name: "Display type",
      type: C.TYPE__SELECT_1,
      visibility: C.VISIBILITY__HARDWARE,
      selection_options: C.ALL_DISPLAY_CONFIGURATIONS,
      default_value: C.DISPLAY_CONFIGURATION__ST7789__240x240}),

    new SSSettingsEntry({category: C.CATEGORY__SYSTEM,
      attr_name: C.SETTING__DISPLAY_COLOR_INVERTED,
      abbreviated_name: "rgb_inv",
      display_name: "Invert colors",
      type: C.TYPE__ENABLED_DISABLED,
      visibility: C.VISIBILITY__HARDWARE,
      default_value: C.OPTION__DISABLED}),

    // Developer options: the only one (Debug) is commented out in SeedSigner 0.8.7 too.

    // "Hidden" settings with no UI interaction
    new SSSettingsEntry({category: C.CATEGORY__SYSTEM,
      attr_name: C.SETTING__QR_BRIGHTNESS,
      abbreviated_name: "qr_brightness",
      display_name: "QR background color",
      type: C.TYPE__FREE_ENTRY,
      visibility: C.VISIBILITY__HIDDEN,
      default_value: 62}),
  ];
})(SSSettingsConstants);


// ---- models/settings.py ---------------------------------------------------------------------------------------------
class SSInvalidSettingsQRData extends Error {
  constructor(message) { super(message || ""); this.name = "InvalidSettingsQRData"; }
}

// SIM: the microSD card. Settings are never written to the browser's storage: the "settings.json on the microSD" is this
// in-memory string, so Persistent settings only survive inside the current page (e.g. across the simulated Restart).
// The simulated card counts as inserted (Settings.HOSTNAME == SEEDSIGNER_OS), unless the engine provides SSMicroSD.
const SS_SIM_MICROSD = {inserted: true, settings_json: null};
function ssSettingsMicroSDInserted() {
  if (typeof SSMicroSD !== "undefined" && SSMicroSD && typeof SSMicroSD.get_instance === "function") {
    return !!SSMicroSD.get_instance().is_inserted;
  }
  return SS_SIM_MICROSD.inserted;
}

class SSSettings {
  static get_instance() {
    // This is the only way to access the one and only instance
    if (!SSSettings._instance) {
      const settings = Object.create(SSSettings.prototype);
      SSSettings._instance = settings;
      settings._data = SSSettingsDefinition.get_defaults();

      // SIM: the simulated device is a SeedSigner+ (st7789 320x240 screen), so its display type is already set the way the
      // owner of such a device sets it. The definition's default (st7789 240x240) is unchanged.
      settings._data[SSSettingsConstants.SETTING__DISPLAY_CONFIGURATION] = SSSettingsConstants.DISPLAY_CONFIGURATION__ST7789__320x240;

      // Read persistent settings file, if it exists (SIM: the in-memory microSD file)
      if (SS_SIM_MICROSD.settings_json !== null) settings.update(JSON.parse(SS_SIM_MICROSD.settings_json));

      // Load default/persistent locale setting
      settings.load_locale();
    }
    return SSSettings._instance;
  }

  static parse_settingsqr(data) {
    if (!data.startsWith("settings::")) throw new SSInvalidSettingsQRData();
    const tokens = data.trim().split(/\s+/);   // Python str.split()

    const version = tokens[0].split("::")[1];
    if (version !== "v1") throw new SSInvalidSettingsQRData(`Unsupported SettingsQR version: ${version}`);

    // Start parsing key/value settings at the nth split() index
    let split_index = 1;

    // handle optional "name" attr
    let config_name = null;
    if (tokens[1].includes("name=")) {
      config_name = data.split("name=")[1].trim().split(/\s+/)[0].replace(/_/g, " ");
      split_index += 1;
    }

    const updated_settings = {};
    for (const entry of tokens.slice(split_index)) {
      const kv = entry.split("=");
      if (kv.length < 2) throw new Error(`not enough values to unpack (expected 2, got ${kv.length})`);
      if (kv.length > 2) throw new Error(`too many values to unpack (expected 2, got ${kv.length})`);
      const abbreviated_name = kv[0];
      let value = kv[1];

      // Empty values ("some_setting= other_setting=E") are invalid
      if (value === "") throw new SSInvalidSettingsQRData(`${abbreviated_name} cannot be empty`);

      // Parse multi-value settings; integer-ize where needed
      if (value.includes(",")) {
        value = value.split(",").map(v => /^[0-9]+$/.test(v) ? parseInt(v, 10) : v);
      } else if (/^[0-9]+$/.test(value)) {
        value = parseInt(value, 10);
      }

      // Replace abbreviated name with full attr_name
      const settings_entry = SSSettingsDefinition.get_settings_entry_by_abbreviated_name(abbreviated_name);
      if (!settings_entry) {
        console.info(`Ignoring unrecognized attribute: ${abbreviated_name}`);
        continue;
      }

      // Validate value(s) against SettingsDefinition's valid options
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        // (as in SeedSigner, an entry without selection_options, i.e. the free-entry qr_brightness, raises here)
        if (!settings_entry.selection_options.map(opt => opt[0]).includes(v)) {
          if (settings_entry.attr_name === SSSettingsConstants.SETTING__PERSISTENT_SETTINGS && v === SSSettingsConstants.OPTION__ENABLED) {
            // Special case: trying to enable Persistent Settings when DISABLED is the only option allowed (because the
            // SD card is not inserted). Explicitly set to DISABLED.
            value = SSSettingsConstants.OPTION__DISABLED;
            break;
          }
          throw new SSInvalidSettingsQRData(`${abbreviated_name} = '${v}' is not valid`);
        }
      }

      updated_settings[settings_entry.attr_name] = value;
    }

    return [config_name, updated_settings];
  }

  toString() { return JSON.stringify(this._data, null, 4); }

  save() {
    if (this._data[SSSettingsConstants.SETTING__PERSISTENT_SETTINGS] === SSSettingsConstants.OPTION__ENABLED && ssSettingsMicroSDInserted()) {
      // SIM: written to the in-memory microSD stand-in, never to browser storage
      SS_SIM_MICROSD.settings_json = JSON.stringify(this._data, null, 4);
    }
  }

  update(new_settings) {
    // Replaces the current settings with the incoming dict. Hidden settings that have a value remain as-is; all other
    // missing settings are set to their default value.
    const C = SSSettingsConstants;
    for (const entry of SSSettingsDefinition.settings_entries) {
      if (!ssToolsHasKey(new_settings, entry.attr_name)) {
        if (entry.visibility === C.VISIBILITY__HIDDEN && ssToolsHasKey(this._data, entry.attr_name)) {
          new_settings[entry.attr_name] = this._data[entry.attr_name];
        } else {
          new_settings[entry.attr_name] = entry.default_value;
        }
      } else {
        // Clean the incoming data, if necessary
        if (entry.type === C.TYPE__MULTISELECT) {
          if (typeof new_settings[entry.attr_name] === "string") {
            new_settings[entry.attr_name] = new_settings[entry.attr_name].split(",").filter(value => value.trim());
          }
          const v = new_settings[entry.attr_name];
          if (!v || (Array.isArray(v) && v.length === 0)) {
            // Multiselect cannot be empty; load defaults to avoid issues
            new_settings[entry.attr_name] = entry.default_value;
          }
        }
      }
    }
    for (const key of Object.keys(new_settings)) this.set_value(key, new_settings[key]);
  }

  set_value(attr_name, value) {
    // Note that for multiselect, the value must be a List.
    if (!ssToolsHasKey(this._data, attr_name)) {
      console.log(`Setting ${attr_name} not recognized. Ignoring.`);
      return;
    }
    if (SSSettingsDefinition.get_settings_entry(attr_name).type === SSSettingsConstants.TYPE__MULTISELECT) {
      if (!Array.isArray(value)) throw new Error(`value must be a List for ${attr_name}`);
    }

    // Special handling for toggling persistence
    if (attr_name === SSSettingsConstants.SETTING__PERSISTENT_SETTINGS && value === SSSettingsConstants.OPTION__DISABLED) {
      // SIM: "os.remove(settings.json)" on the in-memory microSD
      SS_SIM_MICROSD.settings_json = null;
    }

    this._data[attr_name] = value;
    this.save();

    // Special handling for localization
    if (attr_name === SSSettingsConstants.SETTING__LOCALE) this.load_locale();
  }

  get_value(attr_name, default_if_none = null) {
    // Note that for multiselect, the current value is a List.
    if (!ssToolsHasKey(this._data, attr_name)) {
      if (default_if_none) return SSSettingsDefinition.get_settings_entry(attr_name).default_value;
      throw new Error(`Setting for ${attr_name} not found`);
    }
    return this._data[attr_name];
  }

  get_value_display_name(attr_name) {
    if (!ssToolsHasKey(this._data, attr_name)) throw new Error(`Setting for ${attr_name} not found`);
    const settings_entry = SSSettingsDefinition.get_settings_entry(attr_name);
    if ([SSSettingsConstants.TYPE__FREE_ENTRY, SSSettingsConstants.TYPE__MULTISELECT].includes(settings_entry.type)) {
      throw new Error(`Unsupported SettingsEntry.type: ${settings_entry.type}`);
    }
    return settings_entry.get_selection_option_display_name_by_value(this._data[attr_name]);
  }

  get_multiselect_value_display_names(attr_name) {
    if (!ssToolsHasKey(this._data, attr_name)) throw new Error(`Setting for ${attr_name} not found`);
    const settings_entry = SSSettingsDefinition.get_settings_entry(attr_name);
    if (settings_entry.type !== SSSettingsConstants.TYPE__MULTISELECT) throw new Error(`Unsupported SettingsEntry.type: ${settings_entry.type}`);
    const display_names = [];
    // Iterate through the selection_options list in order to preserve intended sort order
    for (const [value, display_name] of settings_entry.selection_options) {
      if (this._data[attr_name].includes(value)) display_names.push(display_name);
    }
    return display_names;
  }

  load_locale() {
    // SIM: English only; SeedSigner sets os.environ['LANGUAGE'] for gettext here.
    const locale = this.get_value(SSSettingsConstants.SETTING__LOCALE);
    console.log(`Set LANGUAGE locale to ${locale}`);
  }

  get debug() {
    return this._data[SSSettingsConstants.SETTING__DEBUG] === SSSettingsConstants.OPTION__ENABLED;
  }

  static handle_microsd_state_change(action) {
    // Enables/Disables the Persistent Settings option based on the MicroSD card state.
    // SIM: always behaves as SeedSigner OS (HOSTNAME == SEEDSIGNER_OS). Actions: "add" / "remove" (MicroSD.ACTION__*).
    const C = SSSettingsConstants;
    const ACTION__INSERTED = (typeof SSMicroSD !== "undefined" && SSMicroSD.ACTION__INSERTED) || "add";
    const ACTION__REMOVED = (typeof SSMicroSD !== "undefined" && SSMicroSD.ACTION__REMOVED) || "remove";
    if (action === ACTION__INSERTED) {
      const entry = SSSettingsDefinition.get_settings_entry(C.SETTING__PERSISTENT_SETTINGS);
      entry.selection_options = C.OPTIONS__ENABLED_DISABLED;
      entry.help_text = C.PERSISTENT_SETTINGS__SD_INSERTED__HELP_TEXT;
      if (SS_SIM_MICROSD.settings_json !== null) {
        SSSettings.get_instance()._data[C.SETTING__PERSISTENT_SETTINGS] = C.OPTION__ENABLED;
        SSSettings.get_instance().save();
      }
    } else if (action === ACTION__REMOVED) {
      SSSettings.get_instance()._data[C.SETTING__PERSISTENT_SETTINGS] = C.OPTION__DISABLED;
      const entry = SSSettingsDefinition.get_settings_entry(C.SETTING__PERSISTENT_SETTINGS);
      entry.selection_options = C.OPTIONS__ONLY_DISABLED;
      entry.help_text = C.PERSISTENT_SETTINGS__SD_REMOVED__HELP_TEXT;
    } else {
      throw new Error(`Invalid MicroSD action: ${action}`);
    }
  }
}
SSSettings._instance = null;
SSSettings.HOSTNAME = "seedsigner-os";          // SIM: behaves as SeedSigner OS
SSSettings.SEEDSIGNER_OS = "seedsigner-os";
SSSettings.SETTINGS_FILENAME = "/mnt/microsd/settings.json";   // SIM: name only; the file is SS_SIM_MICROSD.settings_json


// ---- helpers/mnemonic_generation.py (+ the embit bip39 functions it relies on) --------------------------------------
const SS_DICE__NUM_ROLLS__12WORD = 50;
const SS_DICE__NUM_ROLLS__24WORD = 99;

function ssToolsWordlist(wordlist_language_code = SSSettingsConstants.WORDLIST_LANGUAGE__ENGLISH) {
  // Seed.get_wordlist()
  if (typeof SSSeed !== "undefined" && SSSeed && typeof SSSeed.get_wordlist === "function") return SSSeed.get_wordlist(wordlist_language_code);
  if (wordlist_language_code === SSSettingsConstants.WORDLIST_LANGUAGE__ENGLISH) return WORDLIST;
  throw new Error(`Unrecognized wordlist_language_code ${wordlist_language_code}`);
}

// embit.bip39.mnemonic_to_bytes, line for line (same error texts)
async function ssBip39MnemonicToBytes(mnemonic, ignore_checksum = false, wordlist = null) {
  if (!wordlist) wordlist = WORDLIST;
  const words = mnemonic.trim().split(/\s+/).filter(Boolean);
  if (words.length % 3 !== 0 || words.length < 12) throw new Error("Invalid recovery phrase");
  const binary_seed = [];
  let offset = 0;
  for (const word of words) {
    let index = wordlist.indexOf(word);
    if (index < 0) throw new Error(`Word '${word}' is not in the dictionary`);
    let remaining = 11;
    while (remaining > 0) {
      const bits_needed = 8 - offset;
      if (remaining === bits_needed) {
        if (bits_needed === 8) binary_seed.push(index);
        else binary_seed[binary_seed.length - 1] |= index;
        offset = 0;
        remaining = 0;
      } else if (remaining > bits_needed) {
        if (bits_needed === 8) binary_seed.push((index >> (remaining - 8)) & 0xff);
        else binary_seed[binary_seed.length - 1] |= index >> (remaining - bits_needed);
        remaining -= bits_needed;
        offset = 0;
        index &= (1 << remaining) - 1;
      } else {
        binary_seed.push((index << (8 - remaining)) & 0xff);
        offset = remaining;
        remaining = 0;
      }
    }
  }
  const checksum_length_bits = Math.floor(words.length * 11 / 33);
  const num_remainder = checksum_length_bits % 8;
  let checksum_length, bits_to_ignore;
  if (num_remainder) { checksum_length = Math.floor(checksum_length_bits / 8) + 1; bits_to_ignore = 8 - num_remainder; }
  else { checksum_length = Math.floor(checksum_length_bits / 8); bits_to_ignore = 0; }
  const raw = Uint8Array.from(binary_seed.map(b => b & 0xff));
  const data = raw.slice(0, raw.length - checksum_length), checksum = raw.slice(raw.length - checksum_length);
  const computed_checksum = (await sha256bytes(data)).slice(0, checksum_length);
  computed_checksum[computed_checksum.length - 1] &= 256 - (1 << bits_to_ignore);
  if (!ignore_checksum && checksum.some((b, i) => b !== computed_checksum[i])) throw new Error("Checksum verification failed");
  return data;
}

// embit.bip39.mnemonic_from_bytes (VOIDFORGE's entropyToMnemonic does the same bit layout)
async function ssBip39MnemonicFromBytes(entropy) {
  if (entropy.length % 4 !== 0) throw new Error("Byte array should be multiple of 4 long (16, 20, ..., 32)");
  return entropyToMnemonic(Uint8Array.from(entropy));
}

async function ssCalculateChecksum(mnemonic, wordlist_language_code = SSSettingsConstants.WORDLIST_LANGUAGE__ENGLISH) {
  // Provide 12- or 24-word mnemonic, returns complete mnemonic w/checksum as a list. If 11- or 23-words are provided,
  // append word `0000` to end of list as temp final word.
  if (typeof mnemonic === "string") mnemonic = mnemonic.match(/[^,\s]+/g) || [];
  if (mnemonic.length === 11 || mnemonic.length === 23) mnemonic.push(ssToolsWordlist(wordlist_language_code)[0]);
  if (mnemonic.length !== 12 && mnemonic.length !== 24) throw new Error("Pass in a 12- or 24-word mnemonic");
  const mnemonic_copy = mnemonic.slice();
  const mnemonic_bytes = await ssBip39MnemonicToBytes(mnemonic_copy.join(" ").normalize("NFKD"), true, ssToolsWordlist(wordlist_language_code));
  return (await ssBip39MnemonicFromBytes(mnemonic_bytes)).split(" ");
}

async function ssGenerateMnemonicFromBytes(entropy_bytes, wordlist_language_code = SSSettingsConstants.WORDLIST_LANGUAGE__ENGLISH) {
  ssToolsWordlist(wordlist_language_code);
  return (await ssBip39MnemonicFromBytes(entropy_bytes)).split(" ");
}

async function ssGenerateMnemonicFromDice(roll_data, wordlist_language_code = SSSettingsConstants.WORDLIST_LANGUAGE__ENGLISH) {
  // Dice rolls are treated as string data and hashed via SHA256 (iancoleman "Base 10" / bitcoiner.guide approach).
  let entropy_bytes = await sha256bytes(new TextEncoder().encode(roll_data));
  if (roll_data.length === SS_DICE__NUM_ROLLS__12WORD) {
    // 12-word mnemonic; only use 128bits / 16 bytes
    entropy_bytes = entropy_bytes.slice(0, 16);
  }
  return ssGenerateMnemonicFromBytes(entropy_bytes, wordlist_language_code);
}

async function ssGenerateMnemonicFromCoinFlips(coin_flips, wordlist_language_code = SSSettingsConstants.WORDLIST_LANGUAGE__ENGLISH) {
  let entropy_bytes = await sha256bytes(new TextEncoder().encode(coin_flips));
  if (coin_flips.length === 128) entropy_bytes = entropy_bytes.slice(0, 16);
  return ssGenerateMnemonicFromBytes(entropy_bytes, wordlist_language_code);
}

function ssGetPartialFinalWord(coin_flips, wordlist_language_code = SSSettingsConstants.WORDLIST_LANGUAGE__ENGLISH) {
  const binary_string = coin_flips + "0".repeat(11 - coin_flips.length);
  return ssToolsWordlist(wordlist_language_code)[parseInt(binary_string, 2)];
}

// The module object, so call sites read like the Python (`mnemonic_generation.generate_mnemonic_from_dice(...)`)
const SSMnemonicGeneration = {
  DICE__NUM_ROLLS__12WORD: SS_DICE__NUM_ROLLS__12WORD,
  DICE__NUM_ROLLS__24WORD: SS_DICE__NUM_ROLLS__24WORD,
  calculate_checksum: ssCalculateChecksum,
  generate_mnemonic_from_bytes: ssGenerateMnemonicFromBytes,
  generate_mnemonic_from_dice: ssGenerateMnemonicFromDice,
  generate_mnemonic_from_coin_flips: ssGenerateMnemonicFromCoinFlips,
  get_partial_final_word: ssGetPartialFinalWord,
};


// ---- Seed helpers on top of the seed helper's SSSeed --------------------------------------------------------------
// Seed(mnemonic, wordlist_language_code=...): embit validates the words and checksum while making the seed and SeedSigner
// raises InvalidSeedException(repr(e)). The validation is done here with the embit port so the result is the same whatever
// SSSeed does; SSSeed is then built positionally like the Python __init__(mnemonic, passphrase, wordlist_language_code).
async function ssToolsNewSeed(mnemonic, wordlist_language_code) {
  const words = mnemonic.join(" ").trim().normalize("NFKD").split(/\s+/);
  try {
    await ssBip39MnemonicToBytes(words.join(" "), false, ssToolsWordlist(wordlist_language_code));
  } catch (e) {
    const err = new Error(`ValueError('${e.message}')`);
    err.name = "InvalidSeedException";
    throw err;
  }
  // (the seeds part's SSSeed takes one object of fields and derives its bytes asynchronously: SSSeed.create waits for them)
  return await SSSeed.create({mnemonic: mnemonic, passphrase: "", wordlist_language_code: wordlist_language_code});
}

async function ssToolsSeedBytes(seed) {
  if (typeof seed.get_seed_bytes === "function") return await seed.get_seed_bytes();
  if (seed.seed_bytes) return seed.seed_bytes;
  // fallback: BIP-39 seed from the words and passphrase
  const words = seed.mnemonic_str !== undefined ? seed.mnemonic_str : seed._mnemonic.join(" ");
  const pass = seed.passphrase !== undefined ? seed.passphrase : (seed._passphrase || "");
  return mnemonicToSeed(words, pass);
}

// "m/84'/0'/0'" or "m/0h" -> [[84,true],[0,true],[0,true]] (the steps walletAddressesFrom takes)
function ssToolsParsePath(path) {
  const s = String(path || "").trim().replace(/[hH]/g, "'");
  if (!/^m(\/[0-9]+'?)*$/.test(s)) throw new Error(`Invalid derivation path: ${path}`);
  return s.split("/").slice(1).map(x => [parseInt(x, 10), x.endsWith("'")]);
}

// Seed.get_xpub(derivation_path, network): what the address explorer keeps as data["xpub"]. VOIDFORGE derives addresses
// from the master key along the path, so the "xpub" here is that master key plus the path steps.
async function ssToolsGetXpub(seed, derivation_path, network) {
  const root = await masterFromSeed(await ssToolsSeedBytes(seed));
  return {root, steps: ssToolsParsePath(derivation_path), derivation_path, network};
}

// embit_utils.get_single_sig_address for indexes [start, start+n)
async function ssToolsSingleSigAddresses(xpub, script_type, start, n, is_change, embit_network) {
  const C = SSSettingsConstants;
  const type = {[C.NATIVE_SEGWIT]: "wpkh", [C.NESTED_SEGWIT]: "sh-wpkh", [C.LEGACY_P2PKH]: "pkh", [C.TAPROOT]: "tr"}[script_type];
  if (!type) return new Array(n).fill(null);   // embit_utils returns None for other script types
  // SIM: VOIDFORGE knows the main and test networks only; regtest addresses are shown with the test network's prefixes.
  const net = embit_network === "main" ? "main" : "test";
  const rows = await walletAddressesFrom(xpub.root, xpub.steps, type, net, is_change ? 1 : 0, start, n);
  return rows.map(r => r.address);
}


// ---- hardware/camera.py ------------------------------------------------------------------------------------------
// SIM: browser camera. navigator.mediaDevices.getUserMedia (video only, never audio) stands in for the Pi camera. It is
// started only when a camera tool or a scan screen starts, and stopped when that screen ends.
class SSCameraConnectionError extends Error {
  constructor(message) { super(message || ""); this.name = "CameraConnectionError"; }
}

function ssToolsNewCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}
function ssToolsCtx2d(canvas) { return canvas.getContext("2d", {willReadFrequently: true}); }

// Draws `src` (video or canvas, sw x sh) center-cropped to the w:h aspect and scaled to w x h.
function ssToolsDrawCover(src, sw, sh, w, h, smooth) {
  const c = ssToolsNewCanvas(w, h), g = ssToolsCtx2d(c);
  g.imageSmoothingEnabled = !!smooth;
  if (smooth) g.imageSmoothingQuality = "high";
  let cw = sw, ch = sw * h / w;
  if (ch > sh) { ch = sh; cw = sh * w / h; }
  g.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, w, h);
  return c;
}

// PIL Image.rotate(angle) (counter-clockwise, same size, corners filled black)
function ssToolsRotateCanvas(canvas, angle) {
  const a = ((angle % 360) + 360) % 360;
  if (a === 0) return canvas;
  const c = ssToolsNewCanvas(canvas.width, canvas.height), g = ssToolsCtx2d(c);
  g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height);
  g.translate(c.width / 2, c.height / 2);
  g.rotate(-a * Math.PI / 180);
  g.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return c;
}

class SSCameraFrame {
  // A camera frame (the PIL Image / numpy frame of the Python): `mode` is what Image.tobytes() would give.
  constructor(canvas, mode) { this.canvas = canvas; this.width = canvas.width; this.height = canvas.height; this.mode = mode || "RGBA"; }
  get_rgba() { return ssToolsCtx2d(this.canvas).getImageData(0, 0, this.width, this.height).data; }
  tobytes() {
    const d = this.get_rgba();
    if (this.mode === "RGBA") return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
    const out = new Uint8Array(this.width * this.height * 3);
    for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { out[j] = d[i]; out[j + 1] = d[i + 1]; out[j + 2] = d[i + 2]; }
    return out;
  }
  wipe() {   // SIM: images must not stick around in memory
    try { const g = ssToolsCtx2d(this.canvas); g.clearRect(0, 0, this.width, this.height); this.canvas.width = this.canvas.height = 0; } catch (e) { /* nothing to wipe */ }
  }
}

// SIM (VOIDFORGE): the page's red CAMERA ON tag (body.cam-on) shows while the practice signer's camera is on, too.
function ssToolsCamTag(on) {
  try {
    if (on) document.body.classList.add("cam-on");
    else if (!(typeof cam !== "undefined" && cam && cam.stream)) document.body.classList.remove("cam-on");   // the page's own camera
  } catch (e) { /* no page */ }
}

class SSCamera {
  static get_instance() {
    if (!SSCamera._instance) {
      const cam = Object.create(SSCamera.prototype);
      cam._video_stream = null;
      cam._picamera = null;
      cam._camera_rotation = null;
      SSCamera._instance = cam;
    }
    SSCamera._instance._camera_rotation = parseInt(SSSettings.get_instance().get_value(SSSettingsConstants.SETTING__CAMERA_ROTATION), 10);
    return SSCamera._instance;
  }

  async _open() {
    if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new SSCameraConnectionError();
    let stream;
    const gen = SS_GEN;
    try {
      stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: "environment", width: {ideal: 1280}, height: {ideal: 720}}, audio: false});
    } catch (e) {
      // no camera, or permission refused: the Pi equivalent is PiCameraError -> CameraConnectionError
      throw new SSCameraConnectionError();
    }
    // SIM: the page stopped the device while the browser asked for the camera: release it at once
    if (gen !== SS_GEN) { try { stream.getTracks().forEach(t => t.stop()); } catch (e) { /* already stopped */ } throw new SSAbort(); }
    ssToolsCamTag(true);
    const video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.setAttribute("playsinline", "");
    video.srcObject = stream;
    try { await video.play(); } catch (e) { /* some browsers start muted video on their own */ }
    return {stream, video};
  }

  _close(handle) {
    if (!handle) return;
    ssToolsCamTag(false);
    try { handle.stream.getTracks().forEach(t => t.stop()); } catch (e) { /* already stopped */ }
    try { handle.video.pause(); } catch (e) { /* nothing to pause */ }
    handle.video.srcObject = null;
  }

  // SIM: the Pi camera module is mounted so that 90° + the "Camera rotation" setting (default 180°) makes the picture
  // upright. A browser camera is already upright, so only the difference from the default is applied.
  _sim_rotation() { return (90 + this._camera_rotation) - 270; }

  async _wait_ready(handle, ms) {
    const until = Date.now() + ms;
    while (!handle.video.videoWidth) {
      if (Date.now() > until) throw new SSCameraConnectionError();
      await ssToolsSleep(20);
    }
  }

  async start_video_stream_mode({resolution = [512, 384], framerate = 12, format = "bgr"} = {}) {
    if (this._video_stream !== null) this.stop_video_stream_mode();
    const handle = await this._open();
    this._video_stream = {handle, resolution, framerate, format};
  }

  read_video_stream(as_image = false) {
    if (!this._video_stream) throw new Error("Must call start_video_stream first.");
    const {handle, resolution} = this._video_stream;
    const v = handle.video;
    if (!v.videoWidth) return null;   // camera not ready yet
    // SIM: the Pi streams at `resolution`; here the browser frame is center-cropped to that aspect and scaled.
    const raw = ssToolsDrawCover(v, v.videoWidth, v.videoHeight, resolution[0], resolution[1], false);
    if (!as_image) return new SSCameraFrame(raw, "RGB");
    // Image.fromarray(...).convert('RGBA').rotate(90 + self._camera_rotation)
    return new SSCameraFrame(ssToolsRotateCanvas(raw, this._sim_rotation()), "RGBA");
  }

  stop_video_stream_mode() {
    if (this._video_stream !== null) {
      this._close(this._video_stream.handle);
      this._video_stream = null;
    }
  }

  async start_single_frame_mode({resolution = [720, 480]} = {}) {
    if (this._video_stream !== null) this.stop_video_stream_mode();
    if (this._picamera !== null) this.stop_single_frame_mode();
    const handle = await this._open();
    this._picamera = {handle, resolution};
  }

  async capture_frame() {
    if (this._picamera === null) throw new Error("Must call start_single_frame_mode first.");
    const {handle, resolution} = this._picamera;
    await this._wait_ready(handle, 5000);
    const v = handle.video;
    // SIM: a JPEG capture at `resolution` on the Pi; here a full-quality browser frame at that size (mode RGB)
    const raw = ssToolsDrawCover(v, v.videoWidth, v.videoHeight, resolution[0], resolution[1], true);
    return new SSCameraFrame(ssToolsRotateCanvas(raw, this._sim_rotation()), "RGB");
  }

  stop_single_frame_mode() {
    if (this._picamera !== null) {
      this._close(this._picamera.handle);
      this._picamera = null;
    }
  }
}
SSCamera._instance = null;

// PIL.ImageOps.autocontrast(image, cutoff=2) on the RGB bands; returns a new canvas.
function ssToolsAutocontrast(srcCanvas, cutoff) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const out = ssToolsNewCanvas(w, h), g = ssToolsCtx2d(out);
  g.drawImage(srcCanvas, 0, 0);
  const img = g.getImageData(0, 0, w, h), d = img.data;
  const luts = [];
  for (let band = 0; band < 3; band++) {
    const hist = new Array(256).fill(0);
    for (let i = band; i < d.length; i += 4) hist[d[i]]++;
    if (cutoff) {
      let n = 0;
      for (let ix = 0; ix < 256; ix++) n += hist[ix];
      let cut = Math.floor(n * cutoff / 100);
      for (let lo = 0; lo < 256; lo++) {
        if (cut > hist[lo]) { cut -= hist[lo]; hist[lo] = 0; } else { hist[lo] -= cut; cut = 0; }
        if (cut <= 0) break;
      }
      cut = Math.floor(n * cutoff / 100);
      for (let hi = 255; hi >= 0; hi--) {
        if (cut > hist[hi]) { cut -= hist[hi]; hist[hi] = 0; } else { hist[hi] -= cut; cut = 0; }
        if (cut <= 0) break;
      }
    }
    let lo = 0, hi = 255;
    for (lo = 0; lo < 256; lo++) if (hist[lo]) break;
    for (hi = 255; hi >= 0; hi--) if (hist[hi]) break;
    const lut = [];
    if (hi <= lo) { for (let ix = 0; ix < 256; ix++) lut.push(ix); }
    else {
      const scale = 255.0 / (hi - lo), offset = -lo * scale;
      for (let ix = 0; ix < 256; ix++) {
        let v = ssToolsInt(ix * scale + offset);
        if (v < 0) v = 0; else if (v > 255) v = 255;
        lut.push(v);
      }
    }
    luts.push(lut);
  }
  for (let i = 0; i < d.length; i += 4) { d[i] = luts[0][d[i]]; d[i + 1] = luts[1][d[i + 1]]; d[i + 2] = luts[2][d[i + 2]]; }
  g.putImageData(img, 0, 0);
  return out;
}

// gui/components.py resize_image_to_fill; `smooth` = BICUBIC (true) or NEAREST (false). Returns a new canvas.
function ssToolsResizeImageToFill(srcCanvas, target_size_x, target_size_y, smooth) {
  const iw = srcCanvas.width, ih = srcCanvas.height;
  if (iw === target_size_x && ih === target_size_y) return srcCanvas;
  const render_aspect_ratio = target_size_x / target_size_y, source_frame_aspect_ratio = iw / ih;
  let box;
  if (render_aspect_ratio > source_frame_aspect_ratio) {
    const cropped_height = iw * target_size_y / target_size_x;
    box = [0, ssToolsInt((ih - cropped_height) / 2), iw, ih - ssToolsInt((ih - cropped_height) / 2)];
  } else if (render_aspect_ratio < source_frame_aspect_ratio) {
    box = [ssToolsInt((iw - ih * target_size_x / target_size_y) / 2), 0, ssToolsInt(iw - (iw - ih * target_size_x / target_size_y) / 2), ih];
  } else {
    box = [0, 0, iw, ih];
  }
  const c = ssToolsNewCanvas(target_size_x, target_size_y), g = ssToolsCtx2d(c);
  g.imageSmoothingEnabled = !!smooth;
  if (smooth) g.imageSmoothingQuality = "high";
  g.drawImage(srcCanvas, box[0], box[1], box[2] - box[0], box[3] - box[1], 0, 0, target_size_x, target_size_y);
  return c;
}

// Pastes a canvas into an engine SSImage (renderer.canvas). The engine's SSImage is expected to expose its 2D context or
// backing canvas (ctx/_ctx/context/canvas/_canvas/el), or SSImage.fromCanvas(canvas).
function ssToolsImageCtx(img) {
  if (!img) return null;
  if (typeof CanvasRenderingContext2D !== "undefined" && img instanceof CanvasRenderingContext2D) return img;
  for (const k of ["ctx", "_ctx", "context", "g"]) if (img[k] && typeof img[k].drawImage === "function") return img[k];
  for (const k of ["canvas", "_canvas", "el", "cv"]) if (img[k] && typeof img[k].getContext === "function") return img[k].getContext("2d");
  if (typeof img.getContext === "function") return img.getContext("2d");
  return null;
}
function ssToolsPasteCanvas(dstImg, srcCanvas, x, y, sx, sy, sw, sh) {
  if (sx === undefined) { sx = 0; sy = 0; sw = srcCanvas.width; sh = srcCanvas.height; }
  const ctx = ssToolsImageCtx(dstImg);
  if (ctx) { ctx.drawImage(srcCanvas, sx, sy, sw, sh, x, y, sw, sh); return; }
  if (typeof SSImage !== "undefined" && typeof SSImage.fromCanvas === "function") {
    let src = srcCanvas;
    if (sx !== 0 || sy !== 0 || sw !== srcCanvas.width || sh !== srcCanvas.height) {
      src = ssToolsNewCanvas(sw, sh); ssToolsCtx2d(src).drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
    }
    dstImg.paste(SSImage.fromCanvas(src), [x, y]);
    return;
  }
  throw new Error("SIM: cannot paste a camera frame: SSImage exposes no 2D context (see NOTES-tools-settings.md)");
}


// ---- models/qr_type.py and the parts of models/decode_qr.py that the scan routing needs ---------------------------
const SSQRType = {
  PSBT__BASE64: "psbt__base64",
  PSBT__SPECTER: "psbt__specter",
  PSBT__BASE43: "psbt__base43",
  PSBT__UR2: "psbt__ur2",
  PSBT__BBQR: "psbt__bbqr",
  SEED__SEEDQR: "seed__seedqr",
  SEED__COMPACTSEEDQR: "seed__compactseedqr",
  SEED__UR2: "seed__ur2",
  SEED__MNEMONIC: "seed__mnemonic",
  SEED__FOUR_LETTER_MNEMONIC: "seed__four_letter_mnemonic",
  SETTINGS: "settings",
  XPUB: "xpub",
  XPUB__SPECTER: "xpub__specter",
  XPUB__UR: "xpub__ur",
  BITCOIN_ADDRESS: "bitcoin_address",
  SIGN_MESSAGE: "sign_message",
  WALLET__SPECTER: "wallet__specter",
  WALLET__UR: "wallet__ur",
  WALLET__CONFIGFILE: "wallet__configfile",
  WALLET__GENERIC: "wallet__generic",
  OUTPUT__UR: "output__ur",
  ACCOUNT__UR: "account__ur",
  BYTES__UR: "bytes__ur",
  INVALID: "invalid",
};

const SSDecodeQRStatus = {PART_COMPLETE: 1, PART_EXISTING: 2, COMPLETE: 3, FALSE: 4, INVALID: 5};

class SSBaseQrDecoder {
  constructor() { this.total_segments = null; this.collected_segments = 0; this.complete = false; }
  get is_complete() { return this.complete; }
  add(segment, qr_type) { throw new Error("Not implemented in child class"); }
  get_qr_data() { throw new Error("get_qr_data must be implemented in decoder child class"); }
}
class SSBaseSingleFrameQrDecoder extends SSBaseQrDecoder {
  constructor() { super(); this.total_segments = 1; }
}
class SSBaseAnimatedQrDecoder extends SSBaseQrDecoder {
  constructor() { super(); this.segments = []; }
  current_segment_num(segment) { throw new Error("Not implemented in child class"); }
  total_segment_nums(segment) { throw new Error("Not implemented in child class"); }
  parse_segment(segment) { throw new Error("Not implemented in child class"); }
  get is_valid() { return true; }
  add(segment, qr_type = null) {
    if (this.total_segments === null) {
      this.total_segments = this.total_segment_nums(segment);
      this.segments = new Array(this.total_segments).fill(null);
    } else if (this.total_segments !== this.total_segment_nums(segment)) {
      throw new Error("Segment total changed unexpectedly");
    }
    const current_segment_num = this.current_segment_num(segment);
    if (this.segments[current_segment_num - 1] === null || this.segments[current_segment_num - 1] === undefined) {
      this.segments[current_segment_num - 1] = this.parse_segment(segment);
      this.collected_segments += 1;
      if (this.total_segments === this.collected_segments) {
        if (this.is_valid) { this.complete = true; return SSDecodeQRStatus.COMPLETE; }
        return SSDecodeQRStatus.INVALID;
      }
      return SSDecodeQRStatus.PART_COMPLETE;
    }
    return SSDecodeQRStatus.PART_EXISTING;
  }
}

// Specter "pMofN " parts (PSBT and wallet export). Collected only: their content is stage 2.
class SSSpecterPartsQrDecoder extends SSBaseAnimatedQrDecoder {
  current_segment_num(segment) { return parseInt(/^p(\d+)of(\d+) /i.exec(segment)[1], 10); }
  total_segment_nums(segment) { return parseInt(/^p(\d+)of(\d+) /i.exec(segment)[2], 10); }
  parse_segment(segment) { return segment.split(" ").slice(1).join(" "); }
}
class SSBBQRPsbtQrDecoder extends SSBaseAnimatedQrDecoder {
  constructor() { super(); this.encoding = null; }
  current_segment_num(segment) { return parseInt(segment.slice(6, 8), 36) + 1; }
  total_segment_nums(segment) { return parseInt(segment.slice(4, 6), 36); }
  parse_segment(segment) { this.encoding = segment[2]; return segment.slice(8).trim(); }
}

// SIM: stage 2. UR (crypto-psbt / crypto-output / crypto-account / bytes) parts are gathered and counted; completion uses
// VOIDFORGE's qrTextDecode when present. SeedSigner's fountain decoder (URDecoder) is not ported.
class SSStage2URDecoder {
  constructor() { this.parts = []; this.total = null; this._complete = false; }
  receive_part(s) {
    const key = s.toLowerCase();
    if (this.parts.includes(key)) return false;
    this.parts.push(key);
    const m = /^ur:[^/]+\/(\d+)-(\d+)\//i.exec(s);
    this.total = m ? parseInt(m[2], 10) : 1;
    if (!m) this._complete = true;
    else if (typeof qrTextDecode === "function") { try { this._complete = !!qrTextDecode(this.parts.join("\n")); } catch (e) { this._complete = false; } }
    else this._complete = this.parts.length >= this.total;
    return true;
  }
  is_complete() { return this._complete; }
  estimated_percent_complete(weight_mixed_frames = false) {
    if (this._complete) return 1;
    return this.total ? Math.min(0.99, this.parts.length / this.total) : 0;
  }
}

// Stage 2 single-frame formats (base64/base43 PSBT, generic or config-file descriptors): recognized and completed only.
class SSStage2SingleFrameDecoder extends SSBaseSingleFrameQrDecoder {
  constructor() { super(); this.data = null; }
  add(segment, qr_type) { this.data = segment; this.complete = true; this.collected_segments = 1; return SSDecodeQRStatus.COMPLETE; }
}

class SSSeedQrDecoder extends SSBaseSingleFrameQrDecoder {
  constructor(wordlist_language_code) {
    super();
    this.seed_phrase = [];
    this.wordlist_language_code = wordlist_language_code;
    this.wordlist = ssToolsWordlist(wordlist_language_code);
  }

  async add(segment, qr_type = SSQRType.SEED__SEEDQR) {
    if (qr_type === SSQRType.SEED__SEEDQR) {
      try {
        this.seed_phrase = [];
        // Parse 12 or 24-word QR code
        const num_words = ssToolsInt(segment.length / 4);
        for (let i = 0; i < num_words; i++) {
          const part = segment.slice(i * 4, i * 4 + 4);
          if (!/^\s*[+-]?\d+\s*$/.test(part)) throw new Error("ValueError");   // int() would raise
          let index = parseInt(part, 10);
          if (index < 0) index += this.wordlist.length;                       // Python negative list index
          if (index < 0 || index >= this.wordlist.length) throw new Error("IndexError");
          this.seed_phrase.push(this.wordlist[index]);
        }
        if (this.seed_phrase.length > 0) {
          if (this.is_12_or_24_word_phrase() === false) return SSDecodeQRStatus.INVALID;
          this.complete = true;
          this.collected_segments = 1;
          return SSDecodeQRStatus.COMPLETE;
        }
        return SSDecodeQRStatus.INVALID;
      } catch (e) {
        return SSDecodeQRStatus.INVALID;
      }
    }

    if (qr_type === SSQRType.SEED__COMPACTSEEDQR) {
      try {
        this.seed_phrase = (await ssBip39MnemonicFromBytes(segment)).split(" ");
        this.complete = true;
        this.collected_segments = 1;
        return SSDecodeQRStatus.COMPLETE;
      } catch (e) {
        console.error(e);
        return SSDecodeQRStatus.INVALID;
      }
    } else if (qr_type === SSQRType.SEED__MNEMONIC) {
      try {
        const seed_phrase_list = this.seed_phrase = segment.trim().split(" ");
        // embit mnemonic code to validate (Seed(...) raises on an invalid phrase)
        await ssBip39MnemonicToBytes(seed_phrase_list.join(" ").normalize("NFKD"), false, this.wordlist);
        this.seed_phrase = seed_phrase_list;
        if (this.is_12_or_24_word_phrase() === false) return SSDecodeQRStatus.INVALID;
        this.complete = true;
        this.collected_segments = 1;
        return SSDecodeQRStatus.COMPLETE;
      } catch (e) {
        return SSDecodeQRStatus.INVALID;
      }
    } else if (qr_type === SSQRType.SEED__FOUR_LETTER_MNEMONIC) {
      try {
        const seed_phrase_list = segment.trim().split(" ");
        const words = [];
        const _4LETTER_WORDLIST = this.wordlist.map(word => word.slice(0, 4).trim());
        for (const s of seed_phrase_list) {
          const idx = _4LETTER_WORDLIST.indexOf(s);
          if (idx < 0) throw new Error("ValueError");
          words.push(this.wordlist[idx]);
        }
        await ssBip39MnemonicToBytes(words.join(" ").normalize("NFKD"), false, this.wordlist);
        this.seed_phrase = words;
        if (this.is_12_or_24_word_phrase() === false) return SSDecodeQRStatus.INVALID;
        this.complete = true;
        this.collected_segments = 1;
        return SSDecodeQRStatus.COMPLETE;
      } catch (e) {
        return SSDecodeQRStatus.INVALID;
      }
    }
    return SSDecodeQRStatus.INVALID;
  }

  get_seed_phrase() { return this.complete ? this.seed_phrase.slice() : []; }
  is_12_or_24_word_phrase() { return this.seed_phrase.length === 12 || this.seed_phrase.length === 24; }
}

class SSSettingsQrDecoder extends SSBaseSingleFrameQrDecoder {
  constructor() { super(); this.data = null; }
  add(segment, qr_type = SSQRType.SETTINGS) {
    if (!segment.startsWith("settings::")) throw new Error("Invalid SettingsQR data");
    // Leave any other parsing or validation up to the Settings class itself.
    this.data = segment;
    this.complete = true;
    this.collected_segments = 1;
    return SSDecodeQRStatus.COMPLETE;
  }
}

class SSSignMessageQrDecoder extends SSBaseSingleFrameQrDecoder {
  constructor() { super(); this.message = null; this.derivation_path = null; }
  add(segment, qr_type = SSQRType.SIGN_MESSAGE) {
    // Expected QR data format: signmessage {derivation_path} ascii:{message}
    const parts = segment.trim().split(/\s+/);
    this.derivation_path = parts[1].replace(/h/g, "'");
    const fmt = parts[2].split(":")[0];
    this.message = segment.split(`${fmt}:`)[1];
    if (fmt !== "ascii") {
      console.info(`Sign message: Unsupported format: ${fmt}`);
      return SSDecodeQRStatus.INVALID;
    }
    this.complete = true;
    this.collected_segments = 1;
    return SSDecodeQRStatus.COMPLETE;
  }
  get_qr_data() { return {derivation_path: this.derivation_path, message: this.message}; }
}

class SSBitcoinAddressQrDecoder extends SSBaseSingleFrameQrDecoder {
  constructor() { super(); this.address = null; this.address_type = null; }
  add(segment, qr_type = SSQRType.BITCOIN_ADDRESS) {
    const C = SSSettingsConstants;
    const pieces = segment.split(":");
    const m = /^((bc1q|tb1q|bcrt1q|bc1p|tb1p|bcrt1p|[123]|[mn])[a-zA-HJ-NP-Z0-9]{25,64})/i.exec(pieces[pieces.length - 1]);
    if (m === null) return null;
    this.address = m[1];
    this.complete = true;
    this.collected_segments = 1;
    const addr_prefix = m[2].toLowerCase();
    const map = {
      "1": [C.LEGACY_P2PKH, C.MAINNET], "m": [C.LEGACY_P2PKH, C.TESTNET], "n": [C.LEGACY_P2PKH, C.TESTNET],
      "3": [C.NESTED_SEGWIT, C.MAINNET], "2": [C.NESTED_SEGWIT, C.TESTNET],
      "bc1q": [C.NATIVE_SEGWIT, C.MAINNET], "tb1q": [C.NATIVE_SEGWIT, C.TESTNET], "bcrt1q": [C.NATIVE_SEGWIT, C.REGTEST],
      "bc1p": [C.TAPROOT, C.MAINNET], "tb1p": [C.TAPROOT, C.TESTNET], "bcrt1p": [C.TAPROOT, C.REGTEST],
    };
    this.address_type = map[addr_prefix] || null;
    return SSDecodeQRStatus.COMPLETE;
  }
  get_address() { return this.address; }
  get_address_type() { return this.address_type; }
}

class SSDecodeQR {
  constructor(fields = {}) {
    this.wordlist_language_code = ssToolsArg(fields, "wordlist_language_code", SSSettingsConstants.WORDLIST_LANGUAGE__ENGLISH);
    this.complete = false;
    this.qr_type = null;
    this.decoder = null;
  }

  async add_image(image) {
    const data = SSDecodeQR.extract_qr_data(image, true);
    if (data === null || data === undefined) return SSDecodeQRStatus.FALSE;
    return this.add_data(data);
  }

  async add_data(data) {
    const T = SSQRType;
    if (data === null || data === undefined) return SSDecodeQRStatus.FALSE;
    const qr_type = SSDecodeQR.detect_segment_type(data, this.wordlist_language_code);

    if (this.qr_type === null) {
      this.qr_type = qr_type;
      if ([T.PSBT__UR2, T.OUTPUT__UR, T.ACCOUNT__UR, T.BYTES__UR].includes(this.qr_type)) this.decoder = new SSStage2URDecoder();   // SIM: stage 2
      else if (this.qr_type === T.PSBT__SPECTER) this.decoder = new SSSpecterPartsQrDecoder();                                       // SIM: stage 2
      else if (this.qr_type === T.PSBT__BASE64) this.decoder = new SSStage2SingleFrameDecoder();                                     // SIM: stage 2
      else if (this.qr_type === T.PSBT__BASE43) this.decoder = new SSStage2SingleFrameDecoder();                                     // SIM: stage 2
      else if (this.qr_type === T.PSBT__BBQR) this.decoder = new SSBBQRPsbtQrDecoder();                                             // SIM: stage 2
      else if ([T.SEED__SEEDQR, T.SEED__COMPACTSEEDQR, T.SEED__MNEMONIC, T.SEED__FOUR_LETTER_MNEMONIC, T.SEED__UR2].includes(this.qr_type)) {
        this.decoder = new SSSeedQrDecoder(this.wordlist_language_code);
      }
      else if (this.qr_type === T.SETTINGS) this.decoder = new SSSettingsQrDecoder();
      else if (this.qr_type === T.BITCOIN_ADDRESS) this.decoder = new SSBitcoinAddressQrDecoder();
      else if (this.qr_type === T.SIGN_MESSAGE) this.decoder = new SSSignMessageQrDecoder();
      else if (this.qr_type === T.WALLET__SPECTER) this.decoder = new SSSpecterPartsQrDecoder();                                    // SIM: stage 2
      else if (this.qr_type === T.WALLET__GENERIC) this.decoder = new SSStage2SingleFrameDecoder();                                 // SIM: stage 2
      else if (this.qr_type === T.WALLET__CONFIGFILE) this.decoder = new SSStage2SingleFrameDecoder();                              // SIM: stage 2
    } else if (this.qr_type !== qr_type) {
      throw new Error("QR Fragment Unexpected Type Change");
    }

    if (!this.decoder) return SSDecodeQRStatus.INVALID;   // Did not find any recognizable format

    // Process the binary formats first
    if (this.qr_type === T.SEED__COMPACTSEEDQR) {
      const rt = await this.decoder.add(data, T.SEED__COMPACTSEEDQR);
      if (rt === SSDecodeQRStatus.COMPLETE) this.complete = true;
      return rt;
    }

    // Convert to string data
    const qr_str = (data instanceof Uint8Array) ? new TextDecoder("utf-8").decode(data) : data;

    if ([T.PSBT__UR2, T.OUTPUT__UR, T.ACCOUNT__UR, T.BYTES__UR].includes(this.qr_type)) {
      const added_part = this.decoder.receive_part(qr_str);
      if (this.decoder.is_complete()) { this.complete = true; return SSDecodeQRStatus.COMPLETE; }
      return added_part ? SSDecodeQRStatus.PART_COMPLETE : SSDecodeQRStatus.PART_EXISTING;
    }
    const rt = await this.decoder.add(qr_str, this.qr_type);
    if (rt === SSDecodeQRStatus.COMPLETE) this.complete = true;
    return rt;
  }

  get_seed_phrase() { if (this.is_seed) return this.decoder.get_seed_phrase(); return undefined; }
  get_settings_data() { if (this.is_settings) return this.decoder.data; return undefined; }
  get_address() { if (this.is_address) return this.decoder.get_address(); return undefined; }
  get_address_type() { if (this.is_address) return this.decoder.get_address_type(); return undefined; }
  get_qr_data() { return this.decoder.get_qr_data(); }

  get_percent_complete(weight_mixed_frames = false) {
    const T = SSQRType;
    if (!this.decoder) return 0;
    if ([T.PSBT__UR2, T.OUTPUT__UR, T.ACCOUNT__UR, T.BYTES__UR].includes(this.qr_type)) {
      return ssToolsInt(this.decoder.estimated_percent_complete(weight_mixed_frames) * 100);
    } else if ([T.PSBT__SPECTER, T.PSBT__BBQR].includes(this.qr_type)) {
      if (this.decoder.total_segments === null) return 0;
      return ssToolsInt((this.decoder.collected_segments / this.decoder.total_segments) * 100);
    } else if (this.decoder.total_segments === 1) {
      // The single frame QR formats are all or nothing
      return this.decoder.complete ? 100 : 0;
    }
    return 0;
  }

  get is_complete() { return this.complete; }
  get is_invalid() { return this.qr_type === SSQRType.INVALID; }
  get is_psbt() {
    const T = SSQRType;
    return [T.PSBT__UR2, T.PSBT__SPECTER, T.PSBT__BASE64, T.PSBT__BASE43, T.PSBT__BBQR].includes(this.qr_type);
  }
  get is_seed() {
    const T = SSQRType;
    return [T.SEED__SEEDQR, T.SEED__COMPACTSEEDQR, T.SEED__UR2, T.SEED__MNEMONIC, T.SEED__FOUR_LETTER_MNEMONIC].includes(this.qr_type);
  }
  get is_address() { return this.qr_type === SSQRType.BITCOIN_ADDRESS; }
  get is_sign_message() { return this.qr_type === SSQRType.SIGN_MESSAGE; }
  get is_wallet_descriptor() {
    const T = SSQRType;
    // SIM: stage 2. SeedSigner also accepts a UR:BYTES multisig setup file here (CBOR check); not ported.
    return [T.WALLET__SPECTER, T.WALLET__UR, T.WALLET__CONFIGFILE, T.WALLET__GENERIC, T.OUTPUT__UR].includes(this.qr_type);
  }
  get is_settings() { return this.qr_type === SSQRType.SETTINGS; }

  // pyzbar stand-in: VOIDFORGE's own QR reader (qrDecodeRgba). Returns the raw bytes (binary=True), or null.
  static extract_qr_data(image, is_binary = false) {
    if (!image) return null;
    if (typeof qrDecodeRgba !== "function") return null;
    const r = qrDecodeRgba(image.get_rgba(), image.width, image.height);
    if (!r) return null;
    if (r.bytes && r.bytes.length) return is_binary ? Uint8Array.from(r.bytes) : r.text;
    return is_binary ? new TextEncoder().encode(r.text || "") : (r.text || "");
  }

  static detect_segment_type(s, wordlist_language_code = null) {
    const T = SSQRType;
    let str = null;
    if (typeof s === "string") str = s;
    else {
      try { str = new TextDecoder("utf-8", {fatal: true}).decode(s); } catch (e) { str = null; }   // UnicodeDecodeError
    }

    if (str !== null) {
      s = str;
      // PSBT
      if (/^UR:CRYPTO-PSBT\//i.test(s)) return T.PSBT__UR2;
      else if (/^UR:CRYPTO-OUTPUT\//i.test(s)) return T.OUTPUT__UR;
      else if (/^UR:CRYPTO-ACCOUNT\//i.test(s)) return T.ACCOUNT__UR;
      else if (/^p(\d+)of(\d+) ([A-Za-z0-9+\/=]+$)/i.test(s)) return T.PSBT__SPECTER;
      else if (/^UR:BYTES\//i.test(s)) return T.BYTES__UR;
      else if (SSDecodeQR.is_base64_psbt(s)) return T.PSBT__BASE64;
      else if (/^B\$[2HZ]P[0-9A-Z]{4}/.test(s)) return T.PSBT__BBQR;

      // Wallet Descriptor
      const desc_str = s.replace(/\n/g, "").replace(/ /g, "");
      if (/^p(\d+)of(\d+) /i.test(s)) return T.WALLET__SPECTER;
      else if (/^\{"label".*"descriptor":.*/i.test(desc_str)) return T.WALLET__SPECTER;
      else if (s.toLowerCase().includes("multisig setup file")) return T.WALLET__CONFIGFILE;
      else if (s.includes("sortedmulti")) return T.WALLET__GENERIC;

      // Seed
      if (/\d{48,96}/.test(s)) return T.SEED__SEEDQR;
      // Bitcoin Address
      else if (SSDecodeQR.is_bitcoin_address(s)) return T.BITCOIN_ADDRESS;
      // message signing
      else if (s.startsWith("signmessage")) return T.SIGN_MESSAGE;

      // config data
      if (s.startsWith("settings::")) return T.SETTINGS;

      // Seed
      const wordlist = ssToolsWordlist(wordlist_language_code || SSSettingsConstants.WORDLIST_LANGUAGE__ENGLISH);
      const _4LETTER_WORDLIST = wordlist.map(word => word.slice(0, 4).trim());
      const words = s.trim().split(" ");
      if (words.every(x => wordlist.includes(x))) return T.SEED__MNEMONIC;
      else if (words.every(x => _4LETTER_WORDLIST.includes(x))) return T.SEED__FOUR_LETTER_MNEMONIC;
      else if (SSDecodeQR.is_base43_psbt(s)) return T.PSBT__BASE43;
    }

    // Is it byte data?
    const bytes = (typeof s === "string") ? new TextEncoder().encode(s) : s;
    // 32 bytes for 24-word CompactSeedQR; 16 bytes for 12-word CompactSeedQR
    if (bytes.length === 32 || bytes.length === 16) return T.SEED__COMPACTSEEDQR;
    return T.INVALID;
  }

  static is_base64(s) {
    try { return btoa(atob(s)) === s; } catch (e) { return false; }
  }

  // SIM: embit's PSBT.parse is not ported (stage 2); a PSBT is recognized by its magic bytes "psbt\xff".
  static _has_psbt_magic(bytes) {
    return bytes.length > 5 && bytes[0] === 0x70 && bytes[1] === 0x73 && bytes[2] === 0x62 && bytes[3] === 0x74 && bytes[4] === 0xff;
  }

  static is_base64_psbt(s) {
    try {
      if (SSDecodeQR.is_base64(s)) {
        const bin = atob(s), b = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
        return SSDecodeQR._has_psbt_magic(b);
      }
    } catch (e) { return false; }
    return false;
  }

  static is_base43_psbt(s) {
    try { return SSDecodeQR._has_psbt_magic(SSDecodeQR.base43_decode(s)); } catch (e) { return false; }
  }

  static base43_decode(s) {
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$*+-./:";
    let long_value = 0n, power_of_base = 1n;
    for (let i = s.length - 1; i >= 0; i--) {
      const digit = chars.indexOf(s[i]);
      if (digit === -1) throw new Error(`Forbidden character ${s.charCodeAt(i)} for base 43`);
      long_value += BigInt(digit) * power_of_base;
      power_of_base *= 43n;
    }
    const result = [];
    while (long_value >= 256n) { result.push(Number(long_value % 256n)); long_value /= 256n; }
    result.push(Number(long_value));
    let nPad = 0;
    for (const c of s) { if (c === chars[0]) nPad++; else break; }
    for (let i = 0; i < nPad; i++) result.push(0);
    result.reverse();
    return Uint8Array.from(result);
  }

  static is_bitcoin_address(s) {
    if (/^bitcoin:.*/i.test(s)) return true;
    return /^((bc1|tb1|bcr|[123]|[mn])[a-zA-HJ-NP-Z0-9]{25,62})$/i.test(s);
  }
}


/* =====================================================================================================================
   PART B: views and screens (extend the engine's classes; load after the engine)
   ===================================================================================================================== */

// Class-level ButtonOptions (Python class attributes) are built on first use, then reused, so identity comparison works
// like the Python dataclass equality for these (each option object is unique per class and key).
const SS_TOOLS_OPT_CACHE = new Map();
function ssToolsOpt(cls, key, make) {
  let m = SS_TOOLS_OPT_CACHE.get(cls);
  if (!m) { m = {}; SS_TOOLS_OPT_CACHE.set(cls, m); }
  if (!m[key]) m[key] = new SSButtonOption(make());
  return m[key];
}
function ssToolsHw(screen) { return (screen && screen.hw_inputs) || SSHardwareButtons; }
function ssToolsAnyLow(hw, keys) { for (const k of keys) if (hw.check_for_low(k)) return true; return false; }
function ssToolsTouchInput(hw) { if (hw && typeof hw.update_last_input_time === "function") hw.update_last_input_time(); }
function ssToolsLoading(text) { return new SSLoadingScreenThread({text}); }
function ssToolsCamErrorDest() { return new SSDestination(SSCameraConnectionErrorView); }

// Icon(icon_name, icon_size).height (the pixels above the baseline)
function ssToolsIconHeight(icon_name, icon_size) {
  try {
    if (typeof SSIcon === "function" && /^class\b/.test(Function.prototype.toString.call(SSIcon))) {
      const ic = new SSIcon({icon_name, icon_size});
      if (typeof ic.height === "number") return ic.height;
    }
  } catch (e) { /* not the component class */ }
  try {
    const f = SSFonts.get_font(SSGUIConstants.ICON_FONT_NAME__FONT_AWESOME, icon_size);
    const bb = f.getbbox(icon_name, {anchor: "ls"});
    if (bb && isFinite(bb[1]) && bb[1] < 0) return -bb[1];
  } catch (e) { /* FontAwesome is drawn as SVG paths */ }
  return Math.round(icon_size * 448 / 512);   // SIM: FontAwesome 6 ascent (448 of 512 units)
}

// GenericStaticQrEncoder(data=...): the seed helper's port if present, else this minimal one
class SSToolsStaticQrEncoderSim {
  constructor(fields = {}) {
    this.qr_density = ssToolsArg(fields, "qr_density", SSSettingsConstants.DENSITY__MEDIUM);
    this.data = ssToolsArg(fields, "data", null);
  }
  get is_complete() { return true; }
  seq_len() { return 1; }
  next_part() { return this.data; }
  cur_part() { return this.next_part(); }
  restart() { }
}
function ssToolsStaticQrEncoder(data) {
  if (typeof SSGenericStaticQrEncoder !== "undefined") return new SSGenericStaticQrEncoder({data});
  return new SSToolsStaticQrEncoderSim({data});
}


/* ---- views/tools_views.py ---------------------------------------------------------------------------------------- */
class SSToolsMenuView extends SSView {
  static get IMAGE() { return ssToolsOpt(this, "IMAGE", () => ({button_label: "New seed", icon_name: SSFontAwesomeIconConstants.CAMERA})); }
  static get DICE() { return ssToolsOpt(this, "DICE", () => ({button_label: "New seed", icon_name: SSFontAwesomeIconConstants.DICE})); }
  static get KEYBOARD() { return ssToolsOpt(this, "KEYBOARD", () => ({button_label: "Calc 12th/24th word", icon_name: SSFontAwesomeIconConstants.KEYBOARD})); }
  static get ADDRESS_EXPLORER() { return ssToolsOpt(this, "ADDRESS_EXPLORER", () => ({button_label: "Address explorer"})); }
  static get VERIFY_ADDRESS() { return ssToolsOpt(this, "VERIFY_ADDRESS", () => ({button_label: "Verify address"})); }

  async run() {
    const V = SSToolsMenuView;
    const button_data = [V.IMAGE, V.DICE, V.KEYBOARD, V.ADDRESS_EXPLORER, V.VERIFY_ADDRESS];
    const selected_menu_num = await this.run_screen(SSButtonListScreen, {
      title: "Tools",
      is_button_text_centered: false,
      button_data: button_data,
    });

    if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) return new SSDestination(SSBackStackView);
    else if (button_data[selected_menu_num] === V.IMAGE) return new SSDestination(SSToolsImageEntropyLivePreviewView);
    else if (button_data[selected_menu_num] === V.DICE) return new SSDestination(SSToolsDiceEntropyMnemonicLengthView);
    else if (button_data[selected_menu_num] === V.KEYBOARD) return new SSDestination(SSToolsCalcFinalWordNumWordsView);
    else if (button_data[selected_menu_num] === V.ADDRESS_EXPLORER) return new SSDestination(SSToolsAddressExplorerSelectSourceView);
    else if (button_data[selected_menu_num] === V.VERIFY_ADDRESS) return new SSDestination(SSScanAddressView);
    return undefined;
  }
}


/* Image entropy Views */
class SSToolsImageEntropyLivePreviewView extends SSView {
  async run() {
    this.controller.image_entropy_preview_frames = null;
    let ret;
    try {
      ret = await this.run_screen(SSToolsImageEntropyLivePreviewScreen, {});
    } catch (e) {
      // SeedSigner: CameraConnectionError -> UnhandledExceptionView -> CameraConnectionErrorView
      if (e instanceof SSCameraConnectionError) return ssToolsCamErrorDest();
      throw e;
    }
    if (ret === SS_RET_CODE__BACK_BUTTON) return new SSDestination(SSBackStackView);

    this.controller.image_entropy_preview_frames = ret;
    return new SSDestination(SSToolsImageEntropyFinalImageView);
  }
}


class SSToolsImageEntropyFinalImageView extends SSView {
  async run() {
    if (!this.controller.image_entropy_final_image) {
      // Take the final full-res image
      const camera = SSCamera.get_instance();
      const max_dim = Math.max(this.canvas_width, this.canvas_height);
      try {
        // Final image will be at least 4x the number of pixels the screen can actually display.
        await camera.start_single_frame_mode({resolution: [2 * max_dim, 2 * max_dim]});
        await ssToolsSleep(250);
        this.controller.image_entropy_final_image = await camera.capture_frame();
      } catch (e) {
        if (e instanceof SSCameraConnectionError) return ssToolsCamErrorDest();
        throw e;
      } finally {
        camera.stop_single_frame_mode();
      }
    }

    // Prep a copy of the image for display: boost the contrast (preserving the original pixels) and resize it to fit
    const boosted_version = ssToolsAutocontrast(this.controller.image_entropy_final_image.canvas, 2);
    const display_version = ssToolsResizeImageToFill(boosted_version, this.canvas_width, this.canvas_height, true);

    const ret = await this.run_screen(SSToolsImageEntropyFinalImageScreen, {final_image: display_version});

    if (ret === SS_RET_CODE__BACK_BUTTON) {
      // Go back to live preview and reshoot
      if (this.controller.image_entropy_final_image) this.controller.image_entropy_final_image.wipe();
      this.controller.image_entropy_final_image = null;
      return new SSDestination(SSBackStackView);
    }
    return new SSDestination(SSToolsImageEntropyMnemonicLengthView);
  }
}


class SSToolsImageEntropyMnemonicLengthView extends SSView {
  static get TWELVE_WORDS() { return ssToolsOpt(this, "TWELVE_WORDS", () => ({button_label: "12 words", return_data: 12})); }
  static get TWENTYFOUR_WORDS() { return ssToolsOpt(this, "TWENTYFOUR_WORDS", () => ({button_label: "24 words", return_data: 24})); }

  async run() {
    const V = SSToolsImageEntropyMnemonicLengthView;
    const button_data = [V.TWELVE_WORDS, V.TWENTYFOUR_WORDS];
    const selected_menu_num = await this.run_screen(SSButtonListScreen, {
      title: "Mnemonic Length",
      button_data: button_data,
    });
    if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) return new SSDestination(SSBackStackView);

    const mnemonic_length = button_data[selected_menu_num].return_data;

    // The entropy calculation can take time, especially with a full image buffer. Show a loading spinner.
    this.loading_screen = ssToolsLoading("Calculating...");
    this.loading_screen.start();

    try {
      let preview_images = this.controller.image_entropy_preview_frames || [];
      let seed_entropy_image = this.controller.image_entropy_final_image;

      // Build in some hardware-level uniqueness via CPU unique Serial num.
      // SIM: a browser has no /proc/cpuinfo; SeedSigner's own fallback for a failed read is used: hash_bytes = b'0'
      let hash_bytes = new TextEncoder().encode("0");

      // Build in modest entropy via millis since power on (time.time())
      hash_bytes = await sha256bytes(ssToolsConcat(hash_bytes, new TextEncoder().encode(String(Date.now() / 1000))));

      // Build in better entropy by chaining the preview frames (SIM: browser camera frames, RGBA as in SeedSigner)
      for (const frame of preview_images) {
        hash_bytes = await sha256bytes(ssToolsConcat(hash_bytes, frame.tobytes()));
      }

      // Finally build in our headline entropy via the new full-res image (SIM: browser camera, RGB as the Pi's JPEG)
      let final_hash = await sha256bytes(ssToolsConcat(hash_bytes, seed_entropy_image.tobytes()));

      if (mnemonic_length === 12) {
        // 12-word mnemonic only uses the first 128 bits / 16 bytes of entropy
        final_hash = final_hash.slice(0, 16);
      }

      // Generate the mnemonic
      const mnemonic = await ssGenerateMnemonicFromBytes(final_hash);

      // Image should never get saved nor stick around in memory
      for (const frame of preview_images) frame.wipe();
      if (seed_entropy_image) seed_entropy_image.wipe();
      final_hash.fill(0);
      hash_bytes.fill(0);
      seed_entropy_image = null;
      preview_images = null;
      final_hash = null;
      hash_bytes = null;
      this.controller.image_entropy_preview_frames = null;
      this.controller.image_entropy_final_image = null;

      // Add the mnemonic as an in-memory Seed
      const seed = await ssToolsNewSeed(mnemonic, this.settings.get_value(SSSettingsConstants.SETTING__WORDLIST_LANGUAGE));
      this.controller.storage.set_pending_seed(seed);
    } finally {
      // Stop spinner even if an error occurs
      await this.loading_screen.stop();
    }

    // Cannot return BACK to this View
    return new SSDestination(SSSeedWordsWarningView, {view_args: {seed_num: null}, clear_history: true});
  }
}


/* Dice rolls Views */
class SSToolsDiceEntropyMnemonicLengthView extends SSView {
  async run() {
    // Since we're dynamically building the ButtonOption button_labels here, it's too awkward to use the class-level attrs.
    const twelve = "12 words ({} rolls)".replace("{}", SS_DICE__NUM_ROLLS__12WORD);
    const TWELVE = new SSButtonOption({button_label: twelve, return_data: SS_DICE__NUM_ROLLS__12WORD});
    const twenty_four = "24 words ({} rolls)".replace("{}", SS_DICE__NUM_ROLLS__24WORD);
    const TWENTY_FOUR = new SSButtonOption({button_label: twenty_four, return_data: SS_DICE__NUM_ROLLS__24WORD});

    const button_data = [TWELVE, TWENTY_FOUR];
    const selected_menu_num = await this.run_screen(SSButtonListScreen, {
      title: "Mnemonic Length",
      is_bottom_list: true,
      is_button_text_centered: true,
      button_data: button_data,
    });

    if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) return new SSDestination(SSBackStackView);
    else if (button_data[selected_menu_num] === TWELVE) {
      return new SSDestination(SSToolsDiceEntropyEntryView, {view_args: {total_rolls: SS_DICE__NUM_ROLLS__12WORD}});
    } else if (button_data[selected_menu_num] === TWENTY_FOUR) {
      return new SSDestination(SSToolsDiceEntropyEntryView, {view_args: {total_rolls: SS_DICE__NUM_ROLLS__24WORD}});
    }
    return undefined;
  }
}


class SSToolsDiceEntropyEntryView extends SSView {
  constructor(view_args = {}) {
    super(view_args);
    this.total_rolls = view_args.total_rolls;
  }

  async run() {
    const ret = await this.run_screen(SSToolsDiceEntropyEntryScreen, {return_after_n_chars: this.total_rolls});
    if (ret === SS_RET_CODE__BACK_BUTTON) return new SSDestination(SSBackStackView);

    const dice_seed_phrase = await ssGenerateMnemonicFromDice(ret);

    // Add the mnemonic as an in-memory Seed
    const seed = await ssToolsNewSeed(dice_seed_phrase, this.settings.get_value(SSSettingsConstants.SETTING__WORDLIST_LANGUAGE));
    this.controller.storage.set_pending_seed(seed);

    // Cannot return BACK to this View
    return new SSDestination(SSSeedWordsWarningView, {view_args: {seed_num: null}, clear_history: true});
  }
}


/* Calc final word Views */
class SSToolsCalcFinalWordNumWordsView extends SSView {
  static get TWELVE() { return ssToolsOpt(this, "TWELVE", () => ({button_label: "12 words", return_data: 12})); }
  static get TWENTY_FOUR() { return ssToolsOpt(this, "TWENTY_FOUR", () => ({button_label: "24 words", return_data: 24})); }

  async run() {
    const V = SSToolsCalcFinalWordNumWordsView;
    const button_data = [V.TWELVE, V.TWENTY_FOUR];
    const selected_menu_num = await this.run_screen(SSButtonListScreen, {
      title: "Mnemonic Length",
      is_bottom_list: true,
      is_button_text_centered: true,
      button_data: button_data,
    });
    if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) return new SSDestination(SSBackStackView);

    this.controller.storage.init_pending_mnemonic(button_data[selected_menu_num].return_data);
    return new SSDestination(SSSeedMnemonicEntryView, {view_args: {is_calc_final_word: true}});
  }
}


class SSToolsCalcFinalWordFinalizePromptView extends SSView {
  static get COIN_FLIPS() { return ssToolsOpt(this, "COIN_FLIPS", () => ({button_label: "Coin flip entropy"})); }
  static get SELECT_WORD() { return ssToolsOpt(this, "SELECT_WORD", () => ({button_label: "Word selection entropy"})); }
  static get ZEROS() { return ssToolsOpt(this, "ZEROS", () => ({button_label: "Finalize with zeros"})); }

  async run() {
    const V = SSToolsCalcFinalWordFinalizePromptView;
    const mnemonic = this.controller.storage.pending_mnemonic;
    const mnemonic_length = mnemonic.length;
    const num_entropy_bits = mnemonic_length === 12 ? 7 : 3;

    const button_data = [V.COIN_FLIPS, V.SELECT_WORD, V.ZEROS];
    const selected_menu_num = await this.run_screen(SSToolsCalcFinalWordFinalizePromptScreen, {
      mnemonic_length: mnemonic_length,
      num_entropy_bits: num_entropy_bits,
      button_data: button_data,
    });

    if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) return new SSDestination(SSBackStackView);
    else if (button_data[selected_menu_num] === V.COIN_FLIPS) return new SSDestination(SSToolsCalcFinalWordCoinFlipsView);
    else if (button_data[selected_menu_num] === V.SELECT_WORD) {
      // Clear the final word slot, just in case we're returning via BACK button
      this.controller.storage.update_pending_mnemonic(null, mnemonic_length - 1);
      return new SSDestination(SSSeedMnemonicEntryView, {view_args: {is_calc_final_word: true, cur_word_index: mnemonic_length - 1}});
    } else if (button_data[selected_menu_num] === V.ZEROS) {
      // User skipped the option to select a final word to provide last bits of entropy. We'll insert all zeros and
      // piggy-back on the coin flip attr
      const wordlist_language_code = this.settings.get_value(SSSettingsConstants.SETTING__WORDLIST_LANGUAGE);
      this.controller.storage.update_pending_mnemonic(ssToolsWordlist(wordlist_language_code)[0], mnemonic_length - 1);
      return new SSDestination(SSToolsCalcFinalWordShowFinalWordView, {view_args: {coin_flips: "0".repeat(num_entropy_bits)}});
    }
    return undefined;
  }
}


class SSToolsCalcFinalWordCoinFlipsView extends SSView {
  async run() {
    const mnemonic_length = this.controller.storage.pending_mnemonic.length;
    const total_flips = mnemonic_length === 12 ? 7 : 3;

    const ret_val = await this.run_screen(SSToolsCoinFlipEntryScreen, {return_after_n_chars: total_flips});
    if (ret_val === SS_RET_CODE__BACK_BUTTON) return new SSDestination(SSBackStackView);
    return new SSDestination(SSToolsCalcFinalWordShowFinalWordView, {view_args: {coin_flips: ret_val}});
  }
}


class SSToolsCalcFinalWordShowFinalWordView extends SSView {
  static get NEXT() { return ssToolsOpt(this, "NEXT", () => ({button_label: "Next"})); }

  constructor(view_args = {}) {
    super(view_args);
    this.coin_flips = ssToolsArg(view_args, "coin_flips", null);
  }

  // The rest of SeedSigner's __init__: it needs SHA-256 (async in a browser), so it runs at the start of run().
  async _init_final_word() {
    const coin_flips = this.coin_flips;
    const storage = this.controller.storage;
    // Construct the actual final word. The user's selected_final_word contributes 3 bits to a 24-word seed (plus 8-bit
    // checksum) or 7 bits to a 12-word seed (plus 4-bit checksum).
    const wordlist_language_code = this.settings.get_value(SSSettingsConstants.SETTING__WORDLIST_LANGUAGE);
    let wordlist = ssToolsWordlist(wordlist_language_code);

    // Prep the user's selected word / coin flips and the actual final word for the display.
    if (coin_flips) {
      this.selected_final_word = null;
      this.selected_final_bits = coin_flips;
    } else {
      // Convert the user's final word selection into its binary index equivalent
      const pm = storage.pending_mnemonic;
      this.selected_final_word = pm[pm.length - 1];
      this.selected_final_bits = ssToolsBits11(wordlist.indexOf(this.selected_final_word));
    }

    if (coin_flips) {
      // fill the last bits (what will eventually be the checksum) with zeros
      const binary_string = coin_flips + "0".repeat(11 - coin_flips.length);
      // retrieve the matching word for the resulting index
      const wordlist_index = parseInt(binary_string, 2);
      wordlist = ssToolsWordlist(this.settings.get_value(SSSettingsConstants.SETTING__WORDLIST_LANGUAGE));
      const word = wordlist[wordlist_index];
      // update the pending mnemonic with our new "final" (pre-checksum) word (index -1 = the last word)
      storage.update_pending_mnemonic(word, storage.pending_mnemonic.length - 1);
    }

    // Now calculate the REAL final word (has a proper checksum)
    const final_mnemonic = await ssCalculateChecksum(storage.pending_mnemonic, wordlist_language_code);

    // Update our pending mnemonic with the real final word
    storage.update_pending_mnemonic(final_mnemonic[final_mnemonic.length - 1], storage.pending_mnemonic.length - 1);

    const mnemonic = storage.pending_mnemonic;
    const mnemonic_length = mnemonic.length;

    // And grab the actual final word's checksum bits
    this.actual_final_word = mnemonic[mnemonic.length - 1];
    const num_checksum_bits = mnemonic_length === 12 ? 4 : 8;
    this.checksum_bits = ssToolsBits11(wordlist.indexOf(this.actual_final_word)).slice(-num_checksum_bits);
  }

  async run() {
    await this._init_final_word();
    const V = SSToolsCalcFinalWordShowFinalWordView;
    const button_data = [V.NEXT];
    const title = "Final Word Calc";

    const selected_menu_num = await this.run_screen(SSToolsCalcFinalWordScreen, {
      title: title,
      button_data: button_data,
      selected_final_word: this.selected_final_word,
      selected_final_bits: this.selected_final_bits,
      checksum_bits: this.checksum_bits,
      actual_final_word: this.actual_final_word,
    });

    if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) return new SSDestination(SSBackStackView);
    else if (button_data[selected_menu_num] === V.NEXT) return new SSDestination(SSToolsCalcFinalWordDoneView);
    return undefined;
  }
}


class SSToolsCalcFinalWordDoneView extends SSView {
  static get LOAD() { return ssToolsOpt(this, "LOAD", () => ({button_label: "Load seed"})); }
  static get DISCARD() { return ssToolsOpt(this, "DISCARD", () => ({button_label: "Discard", button_label_color: "red"})); }

  async run() {
    const V = SSToolsCalcFinalWordDoneView;
    const mnemonic = this.controller.storage.pending_mnemonic;
    const mnemonic_word_length = mnemonic.length;
    const final_word = mnemonic[mnemonic.length - 1];

    const button_data = [V.LOAD, V.DISCARD];
    const selected_menu_num = await this.run_screen(SSToolsCalcFinalWordDoneScreen, {
      final_word: final_word,
      mnemonic_word_length: mnemonic_word_length,
      fingerprint: await this.controller.storage.get_pending_mnemonic_fingerprint(this.settings.get_value(SSSettingsConstants.SETTING__NETWORK)),
      button_data: button_data,
    });

    if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) return new SSDestination(SSBackStackView);

    await this.controller.storage.convert_pending_mnemonic_to_pending_seed();

    if (button_data[selected_menu_num] === V.LOAD) return new SSDestination(SSSeedFinalizeView);
    else if (button_data[selected_menu_num] === V.DISCARD) return new SSDestination(SSSeedDiscardView);
    return undefined;
  }
}


/* Address Explorer Views */
class SSToolsAddressExplorerSelectSourceView extends SSView {
  static get SCAN_SEED() { return ssToolsOpt(this, "SCAN_SEED", () => ({button_label: "Scan a seed", icon_name: SSSeedSignerIconConstants.QRCODE})); }
  static get SCAN_DESCRIPTOR() { return ssToolsOpt(this, "SCAN_DESCRIPTOR", () => ({button_label: "Scan wallet descriptor", icon_name: SSSeedSignerIconConstants.QRCODE})); }
  static get TYPE_12WORD() { return ssToolsOpt(this, "TYPE_12WORD", () => ({button_label: "Enter 12-word seed", icon_name: SSFontAwesomeIconConstants.KEYBOARD, return_data: 12})); }
  static get TYPE_24WORD() { return ssToolsOpt(this, "TYPE_24WORD", () => ({button_label: "Enter 24-word seed", icon_name: SSFontAwesomeIconConstants.KEYBOARD, return_data: 24})); }
  static get TYPE_ELECTRUM() { return ssToolsOpt(this, "TYPE_ELECTRUM", () => ({button_label: "Enter Electrum seed", icon_name: SSFontAwesomeIconConstants.KEYBOARD})); }

  async run() {
    const V = SSToolsAddressExplorerSelectSourceView;
    const seeds = this.controller.storage.seeds;
    let button_data = [];
    for (const seed of seeds) {
      const button_str = await seed.get_fingerprint(this.settings.get_value(SSSettingsConstants.SETTING__NETWORK));
      button_data.push(new SSButtonOption({button_label: button_str, icon_name: SSSeedSignerIconConstants.FINGERPRINT}));
    }
    button_data = button_data.concat([V.SCAN_SEED, V.SCAN_DESCRIPTOR, V.TYPE_12WORD, V.TYPE_24WORD]);
    if (this.settings.get_value(SSSettingsConstants.SETTING__ELECTRUM_SEEDS) === SSSettingsConstants.OPTION__ENABLED) {
      button_data.push(V.TYPE_ELECTRUM);
    }

    const selected_menu_num = await this.run_screen(SSButtonListScreen, {
      title: "Address Explorer",
      button_data: button_data,
      is_button_text_centered: false,
      is_bottom_list: true,
    });

    if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) return new SSDestination(SSBackStackView);

    // Most of the options require us to go through a side flow(s) before we can continue to the address explorer. Set
    // the Controller-level flow so that it knows to re-route us once the side flow is complete.
    this.controller.resume_main_flow = SSController.FLOW__ADDRESS_EXPLORER;

    if (seeds.length > 0 && selected_menu_num < seeds.length) {
      // User selected one of the n seeds
      return new SSDestination(SSSeedExportXpubScriptTypeView, {view_args: {
        seed_num: selected_menu_num,
        sig_type: SSSettingsConstants.SINGLE_SIG,
      }});
    } else if (button_data[selected_menu_num] === V.SCAN_SEED) {
      return new SSDestination(SSScanSeedQRView);
    } else if (button_data[selected_menu_num] === V.SCAN_DESCRIPTOR) {
      return new SSDestination(SSScanWalletDescriptorView);
    } else if (button_data[selected_menu_num] === V.TYPE_12WORD || button_data[selected_menu_num] === V.TYPE_24WORD) {
      this.controller.storage.init_pending_mnemonic(button_data[selected_menu_num].return_data);
      return new SSDestination(SSSeedMnemonicEntryView);
    } else if (button_data[selected_menu_num] === V.TYPE_ELECTRUM) {
      return new SSDestination(SSSeedElectrumMnemonicStartView);
    }
    return undefined;
  }
}


// embit_utils.get_standard_derivation_path
function ssGetStandardDerivationPath(network = SSSettingsConstants.MAINNET, wallet_type = SSSettingsConstants.SINGLE_SIG, script_type = SSSettingsConstants.NATIVE_SEGWIT) {
  const C = SSSettingsConstants;
  let network_path;
  if (network === C.MAINNET) network_path = "0'";
  else if (network === C.TESTNET) network_path = "1'";
  else if (network === C.REGTEST) network_path = "1'";
  else throw new Error("Unexpected network");

  if (wallet_type === C.SINGLE_SIG) {
    if (script_type === C.LEGACY_P2PKH) return `m/44'/${network_path}/0'`;
    else if (script_type === C.NESTED_SEGWIT) return `m/49'/${network_path}/0'`;
    else if (script_type === C.NATIVE_SEGWIT) return `m/84'/${network_path}/0'`;
    else if (script_type === C.TAPROOT) return `m/86'/${network_path}/0'`;
    throw new Error("Unexpected script type");
  } else if (wallet_type === C.MULTISIG) {
    if (script_type === C.LEGACY_P2PKH) return "m/45'";
    else if (script_type === C.NESTED_SEGWIT) return `m/48'/${network_path}/0'/1'`;
    else if (script_type === C.NATIVE_SEGWIT) return `m/48'/${network_path}/0'/2'`;
    else if (script_type === C.TAPROOT) throw new Error("Taproot multisig not yet supported");
    throw new Error("Unexpected script type");
  }
  throw new Error("Unexpected wallet type");
}

// embit_utils.get_multisig_policy. SIM: stage 2 (descriptor scanning routes to NotYetImplemented, so this is unreached);
// expects the descriptor object the stage-2 port provides ({threshold, keys, is_basic_multisig}).
function ssGetMultisigPolicy(descriptor) {
  if (!descriptor || !descriptor.is_basic_multisig) throw new Error("Expected a basic multisig descriptor");
  return [String(descriptor.threshold), String(descriptor.keys.length)];
}


class SSToolsAddressExplorerAddressTypeView extends SSView {
  static get RECEIVE() { return ssToolsOpt(this, "RECEIVE", () => ({button_label: "Receive addresses"})); }
  static get CHANGE() { return ssToolsOpt(this, "CHANGE", () => ({button_label: "Change addresses"})); }

  constructor(view_args = {}) {
    // If the explorer source is a seed, `seed_num` and `script_type` must be specified. `custom_derivation` can be
    // specified as needed. If the source is a multisig or single sig wallet descriptor, all three should be None.
    super(view_args);
    this.seed_num = ssToolsArg(view_args, "seed_num", null);
    this.script_type = ssToolsArg(view_args, "script_type", null);
    this.custom_derivation = ssToolsArg(view_args, "custom_derivation", null);
  }

  // The rest of SeedSigner's __init__ (xpub derivation is async here), run at the start of run().
  async _init_address_explorer_data() {
    const C = SSSettingsConstants;
    const network = this.settings.get_value(C.SETTING__NETWORK);

    // Store everything in the Controller's `address_explorer_data` so we don't have to keep passing vals around from
    // View to View and recalculating.
    const data = {
      seed_num: this.seed_num,
      network: this.settings.get_value(C.SETTING__NETWORK),
      embit_network: C.map_network_to_embit(network),
      script_type: this.script_type,
    };
    if (this.seed_num !== null) {
      this.seed = this.controller.storage.seeds[this.seed_num];
      data.seed_num = this.seed;
      const seed_derivation_override = this.seed.derivation_override(C.SINGLE_SIG);

      let derivation_path;
      if (this.script_type === C.CUSTOM_DERIVATION) derivation_path = this.custom_derivation;
      else if (seed_derivation_override) derivation_path = seed_derivation_override;
      else {
        derivation_path = ssGetStandardDerivationPath(this.settings.get_value(C.SETTING__NETWORK), C.SINGLE_SIG, this.script_type);
      }
      data.derivation_path = derivation_path;
      data.xpub = await ssToolsGetXpub(this.seed, derivation_path, network);
    } else {
      data.wallet_descriptor = this.controller.multisig_wallet_descriptor;
    }
    this.controller.address_explorer_data = data;
  }

  async run() {
    await this._init_address_explorer_data();
    const V = SSToolsAddressExplorerAddressTypeView;
    const data = this.controller.address_explorer_data;

    let wallet_descriptor_display_name = null;
    if (ssToolsHasKey(data, "wallet_descriptor")) {
      const [threshold, n] = ssGetMultisigPolicy(data.wallet_descriptor);
      wallet_descriptor_display_name = `${threshold} / ${n} multisig`;
    }
    const script_type = ssToolsHasKey(data, "script_type") ? data.script_type : null;

    const button_data = [V.RECEIVE, V.CHANGE];
    const selected_menu_num = await this.run_screen(SSToolsAddressExplorerAddressTypeScreen, {
      button_data: button_data,
      fingerprint: this.seed_num !== null ? await this.seed.get_fingerprint() : null,
      wallet_descriptor_display_name: wallet_descriptor_display_name,
      script_type: script_type,
      custom_derivation_path: this.custom_derivation,
    });

    if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) {
      // If we entered this flow via an already-loaded seed's SeedOptionsView, we need to clear the `resume_main_flow` so
      // that we don't get stuck in a SeedOptionsView redirect loop.
      const back_stack = this.controller.back_stack;
      if (back_stack.length > 1 && back_stack[back_stack.length - 2].View_cls === SSSeedOptionsView) {
        // The BackStack has the current View on the top with the real "back" in second position.
        this.controller.resume_main_flow = null;
        this.controller.address_explorer_data = null;
      }
      return new SSDestination(SSBackStackView);
    } else if (button_data[selected_menu_num] === V.RECEIVE || button_data[selected_menu_num] === V.CHANGE) {
      return new SSDestination(SSToolsAddressExplorerAddressListView, {view_args: {is_change: button_data[selected_menu_num] === V.CHANGE}});
    }
    return undefined;
  }
}


class SSToolsAddressExplorerAddressListView extends SSView {
  constructor(view_args = {}) {
    super(view_args);
    this.is_change = ssToolsArg(view_args, "is_change", false);
    this.start_index = ssToolsArg(view_args, "start_index", 0);
    this.selected_button_index = ssToolsArg(view_args, "selected_button_index", 0);
    this.initial_scroll = ssToolsArg(view_args, "initial_scroll", 0);
  }

  async run() {
    const C = SSSettingsConstants;
    this.loading_screen = null;

    let addresses = [];
    const data = this.controller.address_explorer_data;
    const addrs_per_screen = 10;

    const addr_storage_key = this.is_change ? "change_addrs" : "receive_addrs";

    if (ssToolsHasKey(data, addr_storage_key) && data[addr_storage_key].length >= this.start_index + addrs_per_screen) {
      // We already calculated this range of addresses; just retrieve them
      addresses = data[addr_storage_key].slice(this.start_index, this.start_index + addrs_per_screen);
    } else {
      try {
        this.loading_screen = ssToolsLoading("Calculating addrs...");
        this.loading_screen.start();

        if (!ssToolsHasKey(data, addr_storage_key)) data[addr_storage_key] = [];

        if (ssToolsHasKey(data, "xpub")) {
          // Single sig explore from seed
          if (ssToolsHasKey(data, "script_type") && data.script_type !== C.CUSTOM_DERIVATION) {
            // Standard derivation path
            const batch = await ssToolsSingleSigAddresses(data.xpub, data.script_type, this.start_index, addrs_per_screen, this.is_change, data.embit_network);
            for (const address of batch) {
              addresses.push(address);
              data[addr_storage_key].push(address);
            }
          } else {
            // TODO (SeedSigner): Custom derivation path
            throw new Error("Custom Derivation address explorer not yet implemented");
          }
        } else if (ssToolsHasKey(data, "wallet_descriptor")) {
          // SIM: stage 2 (multisig descriptors). SeedSigner derives with embit_utils.get_multisig_address here.
          const descriptor = data.wallet_descriptor;
          if (descriptor && descriptor.is_basic_multisig && typeof descriptor.derive_address === "function") {
            for (let i = this.start_index; i < this.start_index + addrs_per_screen; i++) {
              const address = await descriptor.derive_address(i, this.is_change, data.embit_network);
              addresses.push(address);
              data[addr_storage_key].push(address);
            }
          } else {
            throw new Error("Single sig descriptors not yet supported");
          }
        }
      } finally {
        // Everything is set. Stop the loading screen
        if (this.loading_screen) await this.loading_screen.stop();
      }
    }

    const selected_menu_num = await this.run_screen(SSToolsAddressExplorerAddressListScreen, {
      title: !this.is_change ? "Receive Addrs" : "Change Addrs",
      start_index: this.start_index,
      addresses: addresses,
      selected_button: this.selected_button_index,
      scroll_y_initial_offset: this.initial_scroll,
    });

    if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) return new SSDestination(SSBackStackView);

    if (selected_menu_num === addresses.length) {
      // User clicked NEXT
      return new SSDestination(SSToolsAddressExplorerAddressListView, {view_args: {is_change: this.is_change, start_index: this.start_index + addrs_per_screen}});
    }

    // Preserve the list's current scroll so we can return to the same spot
    const initial_scroll = this.screen.buttons[0].scroll_y;

    const index = selected_menu_num + this.start_index;
    return new SSDestination(SSToolsAddressExplorerAddressView, {
      view_args: {index: index, address: addresses[selected_menu_num], is_change: this.is_change, start_index: this.start_index, parent_initial_scroll: initial_scroll},
      skip_current_view: true,
    });
  }
}


class SSToolsAddressExplorerAddressView extends SSView {
  constructor(view_args = {}) {
    super(view_args);
    this.index = view_args.index;
    this.address = view_args.address;
    this.is_change = view_args.is_change;
    this.start_index = view_args.start_index;
    this.parent_initial_scroll = ssToolsArg(view_args, "parent_initial_scroll", 0);
  }

  async run() {
    const qr_encoder = ssToolsStaticQrEncoder(this.address);
    await this.run_screen(SSQRDisplayScreen, {qr_encoder: qr_encoder});

    // Exiting/Cancelling the QR display screen always returns to the list
    return new SSDestination(SSToolsAddressExplorerAddressListView, {
      view_args: {is_change: this.is_change, start_index: this.start_index, selected_button_index: this.index - this.start_index, initial_scroll: this.parent_initial_scroll},
      skip_current_view: true,
    });
  }
}


/* ---- gui/screens/tools_screens.py -------------------------------------------------------------------------------- */
class SSToolsImageEntropyLivePreviewScreen extends SSBaseScreen {
  __post_init__() {
    super.__post_init__();
    this.camera = SSCamera.get_instance();
    // If the stream is set to 320x240, we get pillarboxed frames (black bars on the sides). But passing in square dims
    // gives us an edge-to-edge image.
    const max_dimension = Math.max(this.canvas_width, this.canvas_height);
    // SIM: getUserMedia is asynchronous, so the stream is started at the top of _run() rather than here.
    this._stream_args = {resolution: [max_dimension, max_dimension], framerate: 24, format: "rgb"};
  }

  async _run() {
    const K = SSHardwareButtonsConstants, G = SSGUIConstants;
    const hw = ssToolsHw(this);
    await this.camera.start_video_stream_mode(this._stream_args);
    try {
      // save preview image frames to use as additional entropy below
      const preview_images = [];
      const max_entropy_frames = 50;
      const instructions_font = SSFonts.get_font(G.get_body_font_name(), G.get_button_font_size());

      while (true) {
        if (hw.check_for_low(K.KEY_LEFT)) {
          // Have to manually update last input time since we're not in a wait_for loop
          ssToolsTouchInput(hw);
          this.words = [];
          this.camera.stop_video_stream_mode();
          for (const f of preview_images) f.wipe();
          return SS_RET_CODE__BACK_BUTTON;
        }

        const frame = this.camera.read_video_stream(true);
        if (frame === null) {
          // Camera probably isn't ready yet
          await ssToolsSleep(10);
          continue;
        }

        // Account for the possibly different aspect ratio of the camera frame vs the display; crop any excess.
        let box = null;
        if (this.canvas_width !== frame.width) {
          const half_width_diff = ssToolsInt(Math.abs(this.canvas_width - frame.width) / 2);
          box = [half_width_diff, 0, frame.width - half_width_diff, frame.height];
        } else if (this.canvas_height !== frame.height) {
          const half_height_diff = ssToolsInt(Math.abs(this.canvas_height - frame.height) / 2);
          box = [0, half_height_diff, frame.width, frame.height - half_height_diff];
        }
        if (box) ssToolsPasteCanvas(this.renderer.canvas, frame.canvas, 0, 0, box[0], box[1], box[2] - box[0], box[3] - box[1]);
        else ssToolsPasteCanvas(this.renderer.canvas, frame.canvas, 0, 0);

        // Check for ANYCLICK to take final entropy image
        if (ssToolsAnyLow(hw, K.KEYS__ANYCLICK)) {
          ssToolsTouchInput(hw);
          this.camera.stop_video_stream_mode();
          this.renderer.draw.text(
            [ssToolsInt(this.renderer.canvas_width / 2), this.renderer.canvas_height - G.EDGE_PADDING],
            "Capturing image...",
            {fill: G.ACCENT_COLOR, font: instructions_font, stroke_width: 4, stroke_fill: G.BACKGROUND_COLOR, anchor: "ms"}
          );
          this.renderer.show_image();
          return preview_images;
        }

        // If we're still here, it's just another preview frame loop
        this.renderer.draw.text(
          [ssToolsInt(this.renderer.canvas_width / 2), this.renderer.canvas_height - G.EDGE_PADDING],
          "< " + "back" + "  |  " + "click a button",
          {fill: G.BODY_FONT_COLOR, font: instructions_font, stroke_width: 4, stroke_fill: G.BACKGROUND_COLOR, anchor: "ms"}
        );
        this.renderer.show_image();

        if (preview_images.length === max_entropy_frames) {
          // Keep a moving window of the last n preview frames; pop the oldest before we add the current frame.
          preview_images.shift().wipe();
        }
        preview_images.push(frame);

        // SIM: the Pi's read waits for the next frame of its 24 fps stream; here the loop paces itself to 24 fps.
        await ssToolsSleep(1000 / 24);
      }
    } finally {
      this.camera.stop_video_stream_mode();   // SIM: also release the browser camera if the screen ends with an error
    }
  }
}


class SSToolsImageEntropyFinalImageScreen extends SSBaseScreen {
  constructor(fields = {}) {
    const f = ssToolsFields({final_image: null}, fields);
    SS_TOOLS_PENDING_FIELDS.push(f);
    try { super(f); } finally { SS_TOOLS_PENDING_FIELDS.pop(); }
  }
  __post_init__() { ssToolsAdoptFields(this); super.__post_init__(); }

  async _run() {
    const K = SSHardwareButtonsConstants, G = SSGUIConstants;
    const instructions_font = SSFonts.get_font(G.get_body_font_name(), G.get_button_font_size());

    ssToolsPasteCanvas(this.renderer.canvas, this.final_image, 0, 0);
    const reshoot = "reshoot";
    const accept = "accept";
    this.renderer.draw.text(
      [ssToolsInt(this.renderer.canvas_width / 2), this.renderer.canvas_height - G.EDGE_PADDING],
      " < " + reshoot + "  |  " + accept + " > ",
      {fill: G.BODY_FONT_COLOR, font: instructions_font, stroke_width: 4, stroke_fill: G.BACKGROUND_COLOR, anchor: "ms"}
    );
    this.renderer.show_image();

    // LEFT = reshoot, RIGHT / ANYCLICK = accept
    const input = await ssToolsHw(this).wait_for([K.KEY_LEFT, K.KEY_RIGHT].concat(K.KEYS__ANYCLICK));
    if (input === K.KEY_LEFT) return SS_RET_CODE__BACK_BUTTON;
    return undefined;
  }
}


class SSToolsDiceEntropyEntryScreen extends SSKeyboardScreen {
  __post_init__() {
    const FA = SSFontAwesomeIconConstants;
    this.title = "Dice Roll {}/{}".replace("{}", 1).replace("{}", this.return_after_n_chars);

    // Specify the keys in the keyboard
    this.rows = 3;
    this.cols = 3;
    this.keyboard_font_name = SSGUIConstants.ICON_FONT_NAME__FONT_AWESOME;
    this.keyboard_font_size = 36;
    this.keys_charset = [FA.DICE_ONE, FA.DICE_TWO, FA.DICE_THREE, FA.DICE_FOUR, FA.DICE_FIVE, FA.DICE_SIX].join("");

    // Map Key display chars to actual output values
    this.keys_to_values = {
      [FA.DICE_ONE]: "1",
      [FA.DICE_TWO]: "2",
      [FA.DICE_THREE]: "3",
      [FA.DICE_FOUR]: "4",
      [FA.DICE_FIVE]: "5",
      [FA.DICE_SIX]: "6",
    };

    // Now initialize the parent class
    super.__post_init__();
  }

  update_title() {
    this.title = "Dice Roll {}/{}".replace("{}", this.cursor_position + 1).replace("{}", this.return_after_n_chars);
    return true;
  }
}


class SSToolsCalcFinalWordFinalizePromptScreen extends SSButtonListScreen {
  constructor(fields = {}) {
    const f = ssToolsFields({mnemonic_length: null, num_entropy_bits: null}, fields);
    SS_TOOLS_PENDING_FIELDS.push(f);
    try { super(f); } finally { SS_TOOLS_PENDING_FIELDS.pop(); }
  }

  __post_init__() {
    ssToolsAdoptFields(this);
    const G = SSGUIConstants;
    this.title = "Build Final Word";
    this.is_bottom_list = true;
    this.is_button_text_centered = true;
    super.__post_init__();

    const text = `The ${this.mnemonic_length}th word is built from ${this.num_entropy_bits} more entropy bits plus auto-calculated checksum.`;
    this.components.push(new SSTextArea({
      text: text,
      screen_y: this.top_nav.height + ssToolsInt(G.COMPONENT_PADDING / 2),
    }));
  }
}


class SSToolsCoinFlipEntryScreen extends SSKeyboardScreen {
  __post_init__() {
    const G = SSGUIConstants;
    // Override values set by the parent class
    this.title = "Coin Flip {}/{}".replace("{}", 1).replace("{}", this.return_after_n_chars);

    // Specify the keys in the keyboard
    this.rows = 1;
    this.cols = 4;
    this.key_height = G.get_top_nav_title_font_size() + 2 + 2 * G.EDGE_PADDING;
    this.keys_charset = "10";

    // Now initialize the parent class
    super.__post_init__();

    this.components.push(new SSTextArea({
      text: "Heads = 1",
      screen_y: this.keyboard.rect[3] + 4 * G.COMPONENT_PADDING,
    }));
    const prev = this.components[this.components.length - 1];
    this.components.push(new SSTextArea({
      text: "Tails = 0",
      screen_y: prev.screen_y + prev.height + G.COMPONENT_PADDING,
    }));
  }

  update_title() {
    this.title = "Coin Flip {}/{}".replace("{}", this.cursor_position + 1).replace("{}", this.return_after_n_chars);
    return true;
  }
}


class SSToolsCalcFinalWordScreen extends SSButtonListScreen {
  constructor(fields = {}) {
    const f = ssToolsFields({selected_final_word: null, selected_final_bits: null, checksum_bits: null, actual_final_word: null}, fields);
    SS_TOOLS_PENDING_FIELDS.push(f);
    try { super(f); } finally { SS_TOOLS_PENDING_FIELDS.pop(); }
  }

  __post_init__() {
    ssToolsAdoptFields(this);
    const G = SSGUIConstants;
    this.is_bottom_list = true;
    super.__post_init__();
    const last = () => this.components[this.components.length - 1];

    // First what's the total bit display width and where do the checksum bits start?
    const bit_font_size = G.get_button_font_size("default") + 2;   // bit font size should not vary by locale
    const font = SSFonts.get_font(G.FIXED_WIDTH_EMPHASIS_FONT_NAME, bit_font_size);
    const bit_display_width = font.getbbox("0".repeat(11), {anchor: "lt"})[2];
    let checksum_x = font.getbbox("0".repeat(11 - this.checksum_bits.length), {anchor: "lt"})[2];
    const bit_display_x = ssToolsInt((this.canvas_width - bit_display_width) / 2);
    checksum_x += bit_display_x;

    let y_spacer = G.COMPONENT_PADDING;
    if (G.get_body_font_size() > G.get_body_font_size("default")) y_spacer -= 1;

    // Display the user's additional entropy input
    let selection_text, keeper_selected_bits, discard_selected_bits;
    if (this.selected_final_word) {
      selection_text = this.selected_final_word;
      keeper_selected_bits = this.selected_final_bits.slice(0, 11 - this.checksum_bits.length);
      // The word's least significant bits will be rendered differently to convey the fact that they're being discarded.
      discard_selected_bits = this.selected_final_bits.slice(-1 * this.checksum_bits.length);
    } else {
      // User entered coin flips or all zeros
      selection_text = this.selected_final_bits;
      keeper_selected_bits = this.selected_final_bits;
      // We'll append spacer chars to preserve the vertical alignment (most significant n bits always rendered in same column)
      discard_selected_bits = "_".repeat(this.checksum_bits.length);
    }

    const your_input = `Your input: "${selection_text}"`;
    this.components.push(new SSTextArea({
      text: your_input,
      screen_y: this.top_nav.height + G.COMPONENT_PADDING - 2,   // Nudge to last line doesn't get too close to "Next" button
      height_ignores_below_baseline: true,
    }));

    // ...and that entropy's associated 11 bits
    let screen_y = last().screen_y + last().height + y_spacer;
    const first_bits_line = new SSTextArea({
      text: keeper_selected_bits,
      font_name: G.FIXED_WIDTH_EMPHASIS_FONT_NAME,
      font_size: bit_font_size,
      edge_padding: 0,
      screen_x: bit_display_x,
      screen_y: screen_y,
      is_text_centered: false,
    });
    this.components.push(first_bits_line);

    // Render the least significant bits that will be replaced by the checksum in a de-emphasized font color.
    if (discard_selected_bits.includes("_")) screen_y += ssToolsInt(first_bits_line.height / 2);   // center the underscores vertically like hypens
    this.components.push(new SSTextArea({
      text: discard_selected_bits,
      font_name: G.FIXED_WIDTH_EMPHASIS_FONT_NAME,
      font_color: G.LABEL_FONT_COLOR,
      font_size: bit_font_size,
      edge_padding: 0,
      screen_x: checksum_x,
      screen_y: screen_y,
      is_text_centered: false,
    }));

    // Show the checksum...
    this.components.push(new SSTextArea({
      text: "Checksum",
      edge_padding: 0,
      screen_y: first_bits_line.screen_y + first_bits_line.height + 2 * G.COMPONENT_PADDING,
      height_ignores_below_baseline: true,
    }));

    // ...and its actual bits. Prepend spacers to keep vertical alignment
    const checksum_spacer = "_".repeat(11 - this.checksum_bits.length);
    screen_y = last().screen_y + last().height + y_spacer;

    // This time we de-emphasize the prepended spacers that are irrelevant
    this.components.push(new SSTextArea({
      text: checksum_spacer,
      font_name: G.FIXED_WIDTH_EMPHASIS_FONT_NAME,
      font_color: G.LABEL_FONT_COLOR,
      font_size: bit_font_size,
      edge_padding: 0,
      screen_x: bit_display_x,
      screen_y: screen_y + ssToolsInt(first_bits_line.height / 2),   // center the underscores vertically like hypens
      is_text_centered: false,
    }));

    // And especially highlight (orange!) the actual checksum bits
    this.components.push(new SSTextArea({
      text: this.checksum_bits,
      font_name: G.FIXED_WIDTH_EMPHASIS_FONT_NAME,
      font_size: bit_font_size,
      font_color: G.ACCENT_COLOR,
      edge_padding: 0,
      screen_x: checksum_x,
      screen_y: screen_y,
      is_text_centered: false,
    }));

    // And now the *actual* final word after merging the bit data
    this.components.push(new SSTextArea({
      text: `Final Word: "${this.actual_final_word}"`,
      screen_y: last().screen_y + last().height + 2 * G.COMPONENT_PADDING,
      height_ignores_below_baseline: true,
    }));

    // Once again show the bits that came from the user's entropy...
    const num_checksum_bits = this.checksum_bits.length;
    const user_component = this.selected_final_bits.slice(0, 11 - num_checksum_bits);
    screen_y = last().screen_y + last().height + y_spacer;
    this.components.push(new SSTextArea({
      text: user_component,
      font_name: G.FIXED_WIDTH_EMPHASIS_FONT_NAME,
      font_size: bit_font_size,
      edge_padding: 0,
      screen_x: bit_display_x,
      screen_y: screen_y,
      is_text_centered: false,
    }));

    // ...and append the checksum's bits, still highlighted in orange
    this.components.push(new SSTextArea({
      text: this.checksum_bits,
      font_name: G.FIXED_WIDTH_EMPHASIS_FONT_NAME,
      font_color: G.ACCENT_COLOR,
      font_size: bit_font_size,
      edge_padding: 0,
      screen_x: checksum_x,
      screen_y: screen_y,
      is_text_centered: false,
    }));
  }
}


class SSToolsCalcFinalWordDoneScreen extends SSButtonListScreen {
  constructor(fields = {}) {
    const f = ssToolsFields({final_word: null, mnemonic_word_length: 12, fingerprint: null}, fields);
    SS_TOOLS_PENDING_FIELDS.push(f);
    try { super(f); } finally { SS_TOOLS_PENDING_FIELDS.pop(); }
  }

  __post_init__() {
    ssToolsAdoptFields(this);
    const G = SSGUIConstants;
    // Manually specify 12 vs 24 case for easier ordinal translation
    this.title = this.mnemonic_word_length === 12 ? "12th Word" : "24th Word";
    this.is_bottom_list = true;
    super.__post_init__();

    this.components.push(new SSTextArea({
      text: `"${this.final_word}"`,
      font_size: 26,
      is_text_centered: true,
      screen_y: this.top_nav.height + G.COMPONENT_PADDING,
    }));

    const prev = this.components[this.components.length - 1];
    this.components.push(new SSIconTextLine({
      icon_name: SSSeedSignerIconConstants.FINGERPRINT,
      icon_color: G.INFO_COLOR,
      label_text: "fingerprint",
      value_text: this.fingerprint,
      is_text_centered: true,
      screen_y: prev.screen_y + prev.height + 3 * G.COMPONENT_PADDING,
    }));
  }
}


class SSToolsAddressExplorerAddressTypeScreen extends SSButtonListScreen {
  constructor(fields = {}) {
    const f = ssToolsFields({fingerprint: null, wallet_descriptor_display_name: null, script_type: null, custom_derivation_path: null}, fields);
    SS_TOOLS_PENDING_FIELDS.push(f);
    try { super(f); } finally { SS_TOOLS_PENDING_FIELDS.pop(); }
  }

  __post_init__() {
    ssToolsAdoptFields(this);
    const G = SSGUIConstants, C = SSSettingsConstants;
    this.title = "Address Explorer";
    this.is_bottom_list = true;
    super.__post_init__();
    const last = () => this.components[this.components.length - 1];

    if (this.fingerprint) {
      this.components.push(new SSIconTextLine({
        icon_name: SSSeedSignerIconConstants.FINGERPRINT,
        icon_color: G.INFO_COLOR,
        label_text: "Fingerprint",
        value_text: this.fingerprint,
        screen_x: G.EDGE_PADDING,
        screen_y: this.top_nav.height + G.COMPONENT_PADDING,
      }));

      if (this.script_type !== C.CUSTOM_DERIVATION) {
        this.components.push(new SSIconTextLine({
          icon_name: SSSeedSignerIconConstants.DERIVATION,
          label_text: "Derivation",
          value_text: SSSettingsDefinition.get_settings_entry(C.SETTING__SCRIPT_TYPES).get_selection_option_display_name_by_value(this.script_type),
          screen_x: G.EDGE_PADDING,
          screen_y: last().screen_y + last().height + 2 * G.COMPONENT_PADDING,
        }));
      } else {
        this.components.push(new SSIconTextLine({
          icon_name: SSSeedSignerIconConstants.DERIVATION,
          label_text: "Derivation",
          value_text: this.custom_derivation_path,
          screen_x: G.EDGE_PADDING,
          screen_y: last().screen_y + last().height + 2 * G.COMPONENT_PADDING,
        }));
      }
    } else {
      this.components.push(new SSIconTextLine({
        label_text: "Wallet descriptor",
        value_text: this.wallet_descriptor_display_name,
        is_text_centered: true,
        screen_x: G.EDGE_PADDING,
        screen_y: this.top_nav.height + G.COMPONENT_PADDING,
      }));
    }
  }
}


class SSToolsAddressExplorerAddressListScreen extends SSButtonListScreen {
  constructor(fields = {}) {
    const f = ssToolsFields({start_index: 0, addresses: null}, fields);
    SS_TOOLS_PENDING_FIELDS.push(f);
    try { super(f); } finally { SS_TOOLS_PENDING_FIELDS.pop(); }
  }

  __post_init__() {
    ssToolsAdoptFields(this);
    const G = SSGUIConstants;
    this.button_font_name = G.FIXED_WIDTH_EMPHASIS_FONT_NAME;
    this.button_font_size = G.get_button_font_size() + 4;
    this.is_button_text_centered = false;
    this.is_bottom_list = true;

    const bb = SSFonts.get_font(this.button_font_name, this.button_font_size).getbbox("X");
    const char_width = bb[2] - bb[0];

    const last_addr_index = this.start_index + this.addresses.length - 1;
    const index_digits = String(last_addr_index).length;

    // Calculate how many pixels we have available within each address button, remembering to account for the index
    // number that will be displayed. (The parent's post_init has not run yet, so use the Renderer singleton.)
    const available_width = SSRenderer.get_instance().canvas_width - 2 * G.EDGE_PADDING - 2 * G.COMPONENT_PADDING - (index_digits + 1) * char_width;
    const displayable_chars = ssToolsInt(available_width / char_width) - 3;   // ellipsis
    const displayable_half = ssToolsInt(displayable_chars / 2);

    this.button_data = [];
    this.addresses.forEach((address, i) => {
      const cur_index = i + this.start_index;
      // (Intentionally NOT marked for translation in SeedSigner.)
      const tail = displayable_half === 0 ? address : address.slice(-1 * displayable_half);   // Python addr[-0:] is the whole string
      const button_label = `${cur_index}:${address.slice(0, displayable_half)}...${tail}`;
      const active_button_label = `${cur_index}:${address}`;
      this.button_data.push(new SSButtonOption({button_label: button_label, active_button_label: active_button_label}));
    });

    const button_label = `Next ${this.addresses.length}`;
    this.button_data.push(new SSButtonOption({button_label: button_label, right_icon_name: SSSeedSignerIconConstants.CHEVRON_RIGHT}));

    super.__post_init__();
  }
}


/* ---- views/scan_views.py ----------------------------------------------------------------------------------------- */
// SIM: VOIDFORGE rule. The page's own camera reads a SeedQR only while the computer is offline (navigator.onLine false);
// the practice signer follows the same rule for every seed QR (SeedQR, CompactSeedQR, mnemonic QR), shown on SeedSigner's
// own error screen.
function ssToolsSeedScanBlocked() {   // SIM: VOIDFORGE rule
  return typeof navigator !== "undefined" && navigator.onLine === true;
}
function ssToolsOfflineOnlyDest() {   // SIM: VOIDFORGE rule
  return new SSDestination(SSErrorView, {view_args: {
    title: "Error",
    status_headline: "Offline only",
    text: "VOIDFORGE reads seed QR codes only while this computer is offline.",
    button_text: "Back",
    next_destination: new SSDestination(SSBackStackView, {skip_current_view: true}),
  }});
}

class SSScanView extends SSView {
  // The catch-all generic scanning View that will accept any of our supported QR formats and will route to the most
  // sensible next step. Also the base class for the more specific scanning flows.
  constructor(view_args = {}) {
    super(view_args);
    // Define the decoder here to make it available to child classes' is_valid_qr_type checks.
    this.wordlist_language_code = this.settings.get_value(SSSettingsConstants.SETTING__WORDLIST_LANGUAGE);
    this.decoder = new SSDecodeQR({wordlist_language_code: this.wordlist_language_code});
  }

  get instructions_text() { return this.constructor.instructions_text; }
  get invalid_qr_type_message() { return this.constructor.invalid_qr_type_message; }
  get is_valid_qr_type() { return true; }

  async run() {
    const C = SSSettingsConstants;
    // SIM: VOIDFORGE rule: a scan that is only for a SeedQR does not start while the computer is online
    if (this instanceof SSScanSeedQRView && ssToolsSeedScanBlocked()) return ssToolsOfflineOnlyDest();
    // Start the live preview and background QR reading
    try {
      await this.run_screen(SSScanScreen, {instructions_text: this.instructions_text, decoder: this.decoder});
    } catch (e) {
      if (e instanceof SSCameraConnectionError) return ssToolsCamErrorDest();
      throw e;
    }

    // A long scan might have exceeded the screensaver timeout; ensure screensaver doesn't immediately engage.
    if (typeof this.controller.reset_screensaver_timeout === "function") this.controller.reset_screensaver_timeout();

    // Handle the results
    if (this.decoder.is_complete) {
      if (!this.is_valid_qr_type) {
        // We recognized the QR type but it was not the type expected for the current flow.
        return new SSDestination(SSErrorView, {view_args: {
          title: "Error",
          status_headline: "Wrong QR Type",
          text: this.invalid_qr_type_message + `, received "${this.decoder.qr_type.replace(/__/g, ": ").replace(/_/g, " ")}" format`,
          button_text: "Back",
          next_destination: new SSDestination(SSBackStackView, {skip_current_view: true}),
        }});
      }

      if (this.decoder.is_seed && ssToolsSeedScanBlocked()) {
        // SIM: VOIDFORGE rule: a seed QR read while the computer is online is dropped, not loaded
        this.decoder = new SSDecodeQR({wordlist_language_code: this.wordlist_language_code});
        return ssToolsOfflineOnlyDest();
      }

      if (this.decoder.is_seed) {
        const seed_mnemonic = this.decoder.get_seed_phrase();
        if (!seed_mnemonic || seed_mnemonic.length === 0) {
          // seed is not valid, Exit if not valid with message
          return new SSDestination(SSNotYetImplementedView);
        }
        // Found a valid mnemonic seed! All new seeds should be considered pending (might set a passphrase, SeedXOR,
        // etc) until finalized.
        this.controller.storage.set_pending_seed(await ssToolsNewSeed(seed_mnemonic, this.wordlist_language_code));
        if (this.settings.get_value(C.SETTING__PASSPHRASE) === C.OPTION__REQUIRED) return new SSDestination(SSSeedAddPassphraseView);
        return new SSDestination(SSSeedFinalizeView);

      } else if (this.decoder.is_psbt) {
        // SIM: stage 2. SeedSigner: controller.psbt = decoder.get_psbt(); controller.psbt_parser = None;
        //      return Destination(PSBTSelectSeedView, skip_current_view=True)
        return new SSDestination(SSNotYetImplementedView);

      } else if (this.decoder.is_settings) {
        const data = this.decoder.get_settings_data();
        return new SSDestination(SSSettingsIngestSettingsQRView, {view_args: {data: data}});

      } else if (this.decoder.is_wallet_descriptor) {
        // SIM: stage 2. SeedSigner parses the descriptor (rewriting /0/* to /{0,1}/*), sends single-sig descriptors to
        //      NotYetImplementedView, sets controller.multisig_wallet_descriptor and goes to MultisigWalletDescriptorView
        //      (skip_current_view=True).
        return new SSDestination(SSNotYetImplementedView);

      } else if (this.decoder.is_address) {
        // SIM: stage 2. SeedSigner: Destination(AddressVerificationStartView, skip_current_view=True,
        //      view_args={address, script_type, network}) from decoder.get_address() / get_address_type().
        return new SSDestination(SSNotYetImplementedView);

      } else if (this.decoder.is_sign_message) {
        // SIM: stage 2. SeedSigner: Destination(SeedSignMessageStartView, view_args={derivation_path, message}).
        return new SSDestination(SSNotYetImplementedView);

      } else {
        return new SSDestination(SSNotYetImplementedView);
      }
    } else if (this.decoder.is_invalid) {
      // For now, don't even try to re-do the attempted operation, just reset and start everything over.
      this.controller.resume_main_flow = null;
      return new SSDestination(SSScanInvalidQRTypeView);
    }

    return new SSDestination(SSMainMenuView);
  }
}
SSScanView.instructions_text = "Scan a QR code";
SSScanView.invalid_qr_type_message = "QRCode not recognized or not yet supported.";


class SSScanPSBTView extends SSScanView {
  get is_valid_qr_type() { return this.decoder.is_psbt; }
}
SSScanPSBTView.instructions_text = "Scan Transaction";
SSScanPSBTView.invalid_qr_type_message = "Expected a transaction";

class SSScanSeedQRView extends SSScanView {
  get is_valid_qr_type() { return this.decoder.is_seed; }
}
SSScanSeedQRView.instructions_text = "Scan SeedQR";
SSScanSeedQRView.invalid_qr_type_message = "Expected a SeedQR";

class SSScanWalletDescriptorView extends SSScanView {
  get is_valid_qr_type() { return this.decoder.is_wallet_descriptor; }
}
SSScanWalletDescriptorView.instructions_text = "Scan descriptor";
SSScanWalletDescriptorView.invalid_qr_type_message = "Expected a wallet descriptor QR";

class SSScanAddressView extends SSScanView {
  get is_valid_qr_type() { return this.decoder.is_address; }
}
SSScanAddressView.instructions_text = "Scan address QR";
SSScanAddressView.invalid_qr_type_message = "Expected an address QR";


class SSScanInvalidQRTypeView extends SSView {
  async run() {
    // (SeedSigner intentionally uses the WarningScreen here even though the title says "Error".)
    await this.run_screen(SSWarningScreen, {
      title: "Error",
      status_headline: "Unknown QR Type",
      text: "QRCode is invalid or is a data format not yet supported.",
      button_data: [new SSButtonOption({button_label: "Back to Main Menu"})],
    });
    return new SSDestination(SSMainMenuView, {clear_history: true});
  }
}


/* ---- gui/screens/scan_screens.py --------------------------------------------------------------------------------- */
// ScanScreen.LivePreviewThread. SIM: SeedSigner renders the preview in its own thread; here the screen's frame loop calls
// render_frame() for each new camera frame (same drawing, same positions).
class SSScanScreenLivePreviewThread {
  constructor({decoder, renderer, instructions_text, render_rect, frame_decode_status}) {
    this.camera = SSCamera.get_instance();
    this.decoder = decoder;
    this.renderer = renderer;
    this.instructions_text = instructions_text;
    this.render_rect = render_rect ? render_rect : [0, 0, this.renderer.canvas_width, this.renderer.canvas_height];
    this.frame_decode_status = frame_decode_status;
    this.render_width = this.render_rect[2] - this.render_rect[0];
    this.render_height = this.render_rect[3] - this.render_rect[1];
    this.decoder_fps = "0.0";
    this.keep_running = true;

    const G = SSGUIConstants;
    this.instructions_font = SSFonts.get_font(G.get_body_font_name(), G.get_button_font_size());
    // pre-calculate how big the animated QR percent display can be
    const bb = this.instructions_font.getbbox("100%");
    this.progress_text_width = bb[2] - bb[0];
    this.num_frames = 0;
  }

  render_frame(frameImage) {
    const G = SSGUIConstants;
    if (!frameImage) return;
    this.num_frames += 1;
    const cw = this.renderer.canvas_width, ch = this.renderer.canvas_height;

    let scan_text = null;
    let progress_percentage = this.decoder.get_percent_complete();
    if (progress_percentage === 0) scan_text = this.instructions_text;   // We've just started scanning, no results yet

    // Use nearest neighbor resizing for max speed; shown directly at (0, 0) as renderer.show_image(frame, show_direct=True)
    const frame = ssToolsResizeImageToFill(frameImage.canvas, this.render_width, this.render_height, false);
    ssToolsPasteCanvas(this.renderer.canvas, frame, 0, 0);
    const draw = this.renderer.draw;

    if (scan_text) {
      // Temp solution (SeedSigner): render a slight 1px shadow behind the text
      draw.text([ssToolsInt(cw / 2 + 2), ch - G.EDGE_PADDING + 2], scan_text, {fill: "black", font: this.instructions_font, anchor: "ms"});
      // Render the onscreen instructions
      draw.text([ssToolsInt(cw / 2), ch - G.EDGE_PADDING], scan_text, {fill: G.BODY_FONT_COLOR, font: this.instructions_font, anchor: "ms"});
    } else {
      // Render the progress bar: a (canvas_width - 2*EDGE_PADDING) x BUTTON_HEIGHT overlay pasted at
      // (EDGE_PADDING, canvas_height - EDGE_PADDING - BUTTON_HEIGHT). Drawn in place with the same offsets.
      const rect_w = cw - 2 * G.EDGE_PADDING, rect_h = G.BUTTON_HEIGHT;
      const ox = G.EDGE_PADDING, oy = ch - G.EDGE_PADDING - rect_h;

      // Start with a background rounded rectangle, same dims as the buttons; overlay (0, 0, 0, 191)
      const overlay_color = "rgba(0, 0, 0, " + (191 / 255).toFixed(3) + ")";
      draw.rounded_rectangle([ox, oy, ox + rect_w - 1, oy + rect_h - 1], {fill: overlay_color, radius: 8});

      const progress_bar_thickness = 4;
      const progress_bar_width = rect_w - 2 * G.EDGE_PADDING - this.progress_text_width - ssToolsInt(G.EDGE_PADDING / 2);
      const progress_bar_xy = [
        [G.EDGE_PADDING, ssToolsInt((rect_h - progress_bar_thickness) / 2)],
        [G.EDGE_PADDING + progress_bar_width, ssToolsInt(rect_h + progress_bar_thickness) / 2],
      ];
      draw.rounded_rectangle([ox + progress_bar_xy[0][0], oy + progress_bar_xy[0][1], ox + progress_bar_xy[1][0], oy + progress_bar_xy[1][1]],
        {fill: G.INACTIVE_COLOR, radius: 8});

      progress_percentage = this.decoder.get_percent_complete(true);
      draw.rounded_rectangle([ox + progress_bar_xy[0][0], oy + progress_bar_xy[0][1],
        ox + G.EDGE_PADDING + ssToolsInt(progress_percentage * progress_bar_width / 100.0), oy + progress_bar_xy[1][1]],
        {fill: G.GREEN_INDICATOR_COLOR, radius: 8});

      const text = `${progress_percentage}%`;
      draw.text([ox + rect_w - G.EDGE_PADDING, oy + ssToolsInt(rect_h / 2)], text,
        {fill: G.BODY_FONT_COLOR, font: this.instructions_font, anchor: "rm"});

      // Render the dot to indicate successful QR frame read
      const indicator_size = 10;
      const status_color_map = {
        [SSScanScreen.FRAME__ADDED_PART]: G.SUCCESS_COLOR,
        [SSScanScreen.FRAME__REPEATED_PART]: G.INACTIVE_COLOR,
        [SSScanScreen.FRAME__MISS]: null,
      };
      const status_color = status_color_map[this.frame_decode_status.cur_count];
      if (status_color) {
        // Good! Most recent frame successfully decoded. Draw the onscreen indicator dot
        draw.ellipse([
          cw - G.EDGE_PADDING - indicator_size, ch - G.EDGE_PADDING - G.BUTTON_HEIGHT - G.COMPONENT_PADDING - indicator_size,
          cw - G.EDGE_PADDING, ch - G.EDGE_PADDING - G.BUTTON_HEIGHT - G.COMPONENT_PADDING,
        ], {fill: status_color, outline: "black", width: 1});
      }
    }
    this.renderer.show_image();
  }

  stop() { this.keep_running = false; }
}


class SSScanScreen extends SSBaseScreen {
  // Live preview + decoder. SIM: the Pi balances three threads (camera, decoder, preview) at ~6 fps; here one async
  // loop paced at `framerate` reads a frame, shows it, decodes it and checks the LEFT/RIGHT keys.
  constructor(fields = {}) {
    const f = ssToolsFields({decoder: null, instructions_text: null, resolution: [480, 480], framerate: 6, render_rect: null}, fields);
    SS_TOOLS_PENDING_FIELDS.push(f);
    try { super(f); } finally { SS_TOOLS_PENDING_FIELDS.pop(); }
  }

  __post_init__() {
    ssToolsAdoptFields(this);
    super.__post_init__();

    // TODO (SeedSigner): Arrange this with UI elements rather than text
    this.instructions_text = "< " + "back" + "  |  " + this.instructions_text;

    this.camera = SSCamera.get_instance();
    // SIM: the stream is started at the top of _run() (getUserMedia is asynchronous)
    this.frames_decode_status = {cur_count: 0, set_value(v) { this.cur_count = v; }};   // ThreadsafeCounter

    this.preview_thread = new SSScanScreenLivePreviewThread({
      decoder: this.decoder,
      renderer: this.renderer,
      instructions_text: this.instructions_text,
      render_rect: this.render_rect,
      frame_decode_status: this.frames_decode_status,
    });
  }

  async _run() {
    const K = SSHardwareButtonsConstants;
    const hw = ssToolsHw(this);
    await this.camera.start_video_stream_mode({resolution: this.resolution, framerate: this.framerate, format: "rgb"});
    try {
      let num_frames = 0;
      const start_time = Date.now();
      while (true) {
        // live preview (Python: LivePreviewThread)
        this.preview_thread.render_frame(this.camera.read_video_stream(true));

        const frame = this.camera.read_video_stream();
        if (frame !== null) {
          const status = await this.decoder.add_image(frame);

          num_frames += 1;
          this.preview_thread.decoder_fps = (num_frames / Math.max(0.001, (Date.now() - start_time) / 1000)).toFixed(2);

          if (status === SSDecodeQRStatus.COMPLETE || status === SSDecodeQRStatus.INVALID) {
            this.camera.stop_video_stream_mode();
            break;
          }

          // Notify the live preview thread how our most recent decode went
          if (status === SSDecodeQRStatus.FALSE) {
            this.frames_decode_status.set_value(SSScanScreen.FRAME__MISS);
          } else {
            if (status === SSDecodeQRStatus.PART_COMPLETE) this.frames_decode_status.set_value(SSScanScreen.FRAME__ADDED_PART);
            else if (status === SSDecodeQRStatus.PART_EXISTING) this.frames_decode_status.set_value(SSScanScreen.FRAME__REPEATED_PART);
          }

          if (hw.check_for_low(K.KEY_RIGHT) || hw.check_for_low(K.KEY_LEFT)) {
            this.camera.stop_video_stream_mode();
            return false;
          }
        }
        await ssToolsSleep(ssToolsInt(1000 / this.framerate));
      }
      return undefined;
    } finally {
      this.preview_thread.stop();
      this.camera.stop_video_stream_mode();   // SIM: always release the browser camera
    }
  }
}
SSScanScreen.FRAME__ADDED_PART = 1;
SSScanScreen.FRAME__REPEATED_PART = 2;
SSScanScreen.FRAME__MISS = 3;
SSScanScreen.LivePreviewThread = SSScanScreenLivePreviewThread;


/* ---- views/settings_views.py ------------------------------------------------------------------------------------- */
class SSSettingsMenuView extends SSView {
  static get ADVANCED() { return ssToolsOpt(this, "ADVANCED", () => ({button_label: "Advanced", right_icon_name: SSSeedSignerIconConstants.CHEVRON_RIGHT})); }
  static get HARDWARE() { return ssToolsOpt(this, "HARDWARE", () => ({button_label: "Hardware", right_icon_name: SSSeedSignerIconConstants.CHEVRON_RIGHT})); }
  static get IO_TEST() { return ssToolsOpt(this, "IO_TEST", () => ({button_label: "I/O test"})); }
  static get DONATE() { return ssToolsOpt(this, "DONATE", () => ({button_label: "Donate"})); }

  constructor(view_args = {}) {
    super(view_args);
    this.visibility = ssToolsArg(view_args, "visibility", SSSettingsConstants.VISIBILITY__GENERAL);
    this.selected_attr = ssToolsArg(view_args, "selected_attr", null);
    // Used to preserve the rendering position in the list
    this.initial_scroll = ssToolsArg(view_args, "initial_scroll", 0);
  }

  async run() {
    const C = SSSettingsConstants, V = SSSettingsMenuView;
    const settings_entries = SSSettingsDefinition.get_settings_entries(this.visibility);
    const button_data = settings_entries.map(e => new SSButtonOption({button_label: e.display_name}));

    let selected_button = 0;
    if (this.selected_attr) {
      for (let i = 0; i < settings_entries.length; i++) {
        if (settings_entries[i].attr_name === this.selected_attr) { selected_button = i; break; }
      }
    }

    let title, next_destination;
    if (this.visibility === C.VISIBILITY__GENERAL) {
      title = "Settings";
      // Set up the next nested level of menuing
      button_data.push(V.ADVANCED);
      next_destination = new SSDestination(SSSettingsMenuView, {view_args: {visibility: C.VISIBILITY__ADVANCED}});
      button_data.push(V.IO_TEST);
      button_data.push(V.DONATE);
    } else if (this.visibility === C.VISIBILITY__ADVANCED) {
      title = "Advanced";
      // The hardware options nest below "Advanced"
      button_data.push(V.HARDWARE);
      next_destination = new SSDestination(SSSettingsMenuView, {view_args: {visibility: C.VISIBILITY__HARDWARE}});
    } else if (this.visibility === C.VISIBILITY__HARDWARE) {
      title = "Hardware";
      next_destination = null;
    } else if (this.visibility === C.VISIBILITY__DEVELOPER) {
      title = "Dev Options";
      next_destination = null;
    }

    const selected_menu_num = await this.run_screen(SSButtonListScreen, {
      title: title,
      is_button_text_centered: false,
      button_data: button_data,
      selected_button: selected_button,
      scroll_y_initial_offset: this.initial_scroll,
    });

    // Preserve our scroll position in this Screen so we can return
    const initial_scroll = this.screen.buttons[0].scroll_y;

    if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) {
      if (this.visibility === C.VISIBILITY__GENERAL) return new SSDestination(SSMainMenuView);
      else if (this.visibility === C.VISIBILITY__ADVANCED) return new SSDestination(SSSettingsMenuView);
      return new SSDestination(SSSettingsMenuView, {view_args: {visibility: C.VISIBILITY__ADVANCED}});
    }

    if (button_data[selected_menu_num] === V.ADVANCED) return next_destination;
    else if (button_data[selected_menu_num] === V.HARDWARE) return next_destination;
    else if (button_data[selected_menu_num] === V.IO_TEST) return new SSDestination(SSIOTestView);
    else if (button_data[selected_menu_num] === V.DONATE) return new SSDestination(SSDonateView);
    else if (settings_entries[selected_menu_num].attr_name === C.SETTING__LOCALE) return new SSDestination(SSLocaleSelectionView);
    return new SSDestination(SSSettingsEntryUpdateSelectionView, {view_args: {attr_name: settings_entries[selected_menu_num].attr_name, parent_initial_scroll: initial_scroll}});
  }
}


class SSLocaleSelectionView extends SSView {
  async run() {
    const C = SSSettingsConstants, G = SSGUIConstants;
    const cur_language_code = this.settings.get_value(C.SETTING__LOCALE);

    let selected_button = 0;
    const button_data = [];
    // SIM: English only (see SSSettingsConstants.get_detected_languages)
    C.get_detected_languages().forEach(([language_code, display_name], i) => {
      // Unique to this View: override each button's font so we can display each language name in its native script.
      button_data.push(new SSButtonOption({
        button_label: display_name,
        return_data: language_code,
        font_name: G.get_button_font_name(language_code),
        font_size: G.get_button_font_size(language_code),
      }));
      if (language_code === cur_language_code) selected_button = i;   // Highlight the current selection
    });

    const selected_menu_num = await this.run_screen(SSSettingsEntryUpdateSelectionScreen, {
      display_name: SSSettingsDefinition.get_settings_entry(C.SETTING__LOCALE).display_name,
      button_data: button_data,
      selected_button: selected_button,
      checked_buttons: [selected_button],
    });

    if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) return new SSDestination(SSSettingsMenuView);

    // Set the new language
    this.settings.set_value(C.SETTING__LOCALE, button_data[selected_menu_num].return_data);
    return new SSDestination(SSSettingsMenuView);
  }
}


class SSSettingsEntryUpdateSelectionView extends SSView {
  // Handles changes to all selection-type settings (Multiselect, SELECT_1, Enabled/Disabled, etc).
  constructor(view_args = {}) {
    super(view_args);
    this.settings_entry = SSSettingsDefinition.get_settings_entry(view_args.attr_name);
    this.selected_button = ssToolsArg(view_args, "selected_button", null);
    this.parent_initial_scroll = ssToolsArg(view_args, "parent_initial_scroll", 0);
    // If the setting remains unchanged, navigation should return to blocking_view (if set)
    this.blocking_view = ssToolsArg(view_args, "blocking_view", null);
    // unblocking_view is an optional target to navigate to once the setting actually changes.
    this.unblocking_view = ssToolsArg(view_args, "unblocking_view", null);
  }

  async run() {
    const C = SSSettingsConstants;
    const initial_value = this.settings.get_value(this.settings_entry.attr_name);
    const button_data = [];
    const checked_buttons = [];
    this.settings_entry.selection_options.forEach((option, i) => {
      let value, display_name;
      if (Array.isArray(option)) { value = option[0]; display_name = option[1]; }
      else { value = option; display_name = option; }
      button_data.push(new SSButtonOption({button_label: display_name}));

      if ((Array.isArray(initial_value) && initial_value.includes(value)) || value === initial_value) {
        checked_buttons.push(i);
        // Highlight the selection (for multiselect highlight the first selected option).
        if (this.selected_button === null) this.selected_button = i;
      }
    });
    if (this.selected_button === null) this.selected_button = 0;

    const ret_value = await this.run_screen(SSSettingsEntryUpdateSelectionScreen, {
      display_name: this.settings_entry.display_name,
      help_text: this.settings_entry.help_text,
      button_data: button_data,
      selected_button: this.selected_button,
      checked_buttons: checked_buttons,
      settings_entry_type: this.settings_entry.type,
    });

    let destination = null;
    const settings_menu_view_destination = new SSDestination(SSSettingsMenuView, {view_args: {
      visibility: this.settings_entry.visibility,
      selected_attr: this.settings_entry.attr_name,
      initial_scroll: this.parent_initial_scroll,
    }});

    if (ret_value === SS_RET_CODE__BACK_BUTTON) {
      if (this.settings_entry.type === C.TYPE__MULTISELECT) {
        // After the user finishes toggling multiselect options, initial_value will have their final selections when
        // they hit BACK to exit. All current multiselect settings require at least one option to be selected.
        if (!initial_value || initial_value.length === 0) {
          return new SSDestination(SSSettingsSelectionRequiredWarningView, {view_args: {attr_name: this.settings_entry.attr_name}});
        }
      }
      if (this.blocking_view) return new SSDestination(this.blocking_view, {clear_history: true});
      return settings_menu_view_destination;
    }

    const value = this.settings_entry.get_selection_option_value(ret_value);
    let updated_value;

    if (this.settings_entry.type === C.TYPE__FREE_ENTRY) {
      updated_value = ret_value;
      destination = settings_menu_view_destination;
    } else if (this.settings_entry.type === C.TYPE__MULTISELECT) {
      updated_value = initial_value.slice();
      if (!checked_buttons.includes(ret_value)) {
        // This is a new selection to add
        updated_value.push(value);
      } else {
        // This is a de-select to remove
        updated_value.splice(updated_value.indexOf(value), 1);
      }
    } else {
      // All other types are single selects (e.g. Enabled/Disabled, SELECT_1)
      if (value === initial_value && !this.blocking_view) return settings_menu_view_destination;
      updated_value = value;
    }

    this.settings.set_value(this.settings_entry.attr_name, updated_value);

    if (this.settings_entry.attr_name === C.SETTING__DISPLAY_CONFIGURATION) {
      // SIM: the page's screen is fixed at 320x240; the engine's renderer decides what initialize_display() does.
      if (this.renderer && typeof this.renderer.initialize_display === "function") this.renderer.initialize_display();
    } else if (this.settings_entry.attr_name === C.SETTING__DISPLAY_COLOR_INVERTED) {
      // SIM: the display driver's invert(); applied only if the engine's renderer provides it.
      if (this.renderer && this.renderer.disp && typeof this.renderer.disp.invert === "function") {
        this.renderer.disp.invert(updated_value === C.OPTION__ENABLED);
      }
    }

    if (destination) return destination;

    // If this selection view was opened from a blocking flow (e.g. RemoveMicroSDWarningView), prevent navigation away
    // until the setting actually changes. If it hasn't changed, return to the blocking view so it can re-evaluate.
    if (this.blocking_view) {
      const current_value = this.settings.get_value(this.settings_entry.attr_name);
      if (current_value === initial_value) return new SSDestination(this.blocking_view, {clear_history: true});
      else if (this.unblocking_view) return new SSDestination(this.unblocking_view, {clear_history: true});
    }

    // All selects stay in place; re-initialize where in the list we left off
    this.selected_button = ret_value;

    return new SSDestination(SSSettingsEntryUpdateSelectionView, {
      view_args: {attr_name: this.settings_entry.attr_name, parent_initial_scroll: this.parent_initial_scroll, selected_button: this.selected_button, blocking_view: this.blocking_view, unblocking_view: this.unblocking_view},
      skip_current_view: true,
    });
  }
}


class SSSettingsSelectionRequiredWarningView extends SSView {
  constructor(view_args = {}) {
    super(view_args);
    this.settings_entry = SSSettingsDefinition.get_settings_entry(view_args.attr_name);
  }

  async run() {
    const title = "Selection Required";
    const text = `At least one option must be selected for "${this.settings_entry.display_name}".`;
    const button_text = "Return to setting";

    await this.run_screen(SSWarningScreen, {
      title: title,
      status_headline: null,
      text: text,
      button_data: [new SSButtonOption({button_label: button_text})],
      show_back_button: false,
    });
    return new SSDestination(SSSettingsEntryUpdateSelectionView, {view_args: {attr_name: this.settings_entry.attr_name}});
  }
}


class SSSettingsIngestSettingsQRView extends SSView {
  constructor(view_args = {}) {
    super(view_args);
    const C = SSSettingsConstants;
    // May raise an Exception which will bubble up to the Controller to display to the user.
    const [config_name, settings_update_dict] = SSSettings.parse_settingsqr(view_args.data);
    this.config_name = config_name;

    const changes_display_driver = (
      ssToolsHasKey(settings_update_dict, C.SETTING__DISPLAY_CONFIGURATION) &&
      this.settings.get_value(C.SETTING__DISPLAY_CONFIGURATION) !== settings_update_dict[C.SETTING__DISPLAY_CONFIGURATION]);

    this.settings.update(settings_update_dict);

    if (changes_display_driver && this.renderer && typeof this.renderer.initialize_display === "function") {
      this.renderer.initialize_display();   // SIM: see SSSettingsEntryUpdateSelectionView
    }

    if (ssSettingsMicroSDInserted() && this.settings.get_value(C.SETTING__PERSISTENT_SETTINGS) === C.OPTION__ENABLED) {
      this.status_message = "Persistent Settings enabled. Settings saved to SD card.";
    } else {
      this.status_message = "Settings updated in temporary memory";
    }
  }

  async run() {
    await this.run_screen(SSSettingsQRConfirmationScreen, {
      title: "Settings QR",
      config_name: this.config_name,
      status_message: this.status_message,
    });
    // Only one exit point
    return new SSDestination(SSMainMenuView);
  }
}


/* Misc */
class SSIOTestView extends SSView {
  async run() {
    try {
      await this.run_screen(SSIOTestScreen, {});
    } catch (e) {
      if (e instanceof SSCameraConnectionError) return ssToolsCamErrorDest();
      throw e;
    }
    return new SSDestination(SSSettingsMenuView);
  }
}


class SSDonateView extends SSView {
  async run() {
    await this.run_screen(SSDonateScreen, {});
    return new SSDestination(SSSettingsMenuView);
  }
}


/* ---- gui/screens/settings_screens.py ----------------------------------------------------------------------------- */
class SSSettingsEntryUpdateSelectionScreen extends SSButtonListScreen {
  constructor(fields = {}) {
    const f = ssToolsFields({display_name: null, help_text: null, checked_buttons: null, settings_entry_type: SSSettingsConstants.TYPE__ENABLED_DISABLED}, fields);
    SS_TOOLS_PENDING_FIELDS.push(f);
    try { super(f); } finally { SS_TOOLS_PENDING_FIELDS.pop(); }
  }

  __post_init__() {
    ssToolsAdoptFields(this);
    const G = SSGUIConstants;
    this.title = "Settings";
    this.is_bottom_list = true;
    if (this.settings_entry_type === SSSettingsConstants.TYPE__MULTISELECT) this.Button_cls = SSCheckboxButton;
    else this.Button_cls = SSCheckedSelectionButton;
    super.__post_init__();

    this.components.push(new SSTextArea({
      text: this.display_name,
      font_size: G.BODY_FONT_MAX_SIZE,
      is_text_centered: true,
      auto_line_break: true,
      screen_y: this.top_nav.height + G.COMPONENT_PADDING,
    }));

    if (this.help_text) {
      const prev = this.components[this.components.length - 1];
      const prev_component_bottom = prev.screen_y + prev.height;
      this.components.push(new SSTextArea({
        text: this.help_text,
        font_color: G.LABEL_FONT_COLOR,
        is_text_centered: true,
        screen_y: prev_component_bottom + G.COMPONENT_PADDING,
        auto_line_break: true,
      }));
    }
  }
}


class SSIOTestScreen extends SSBaseTopNavScreen {
  __post_init__() {
    const G = SSGUIConstants, FA = SSFontAwesomeIconConstants, SI = SSSeedSignerIconConstants;
    this.title = "I/O Test";
    this.show_back_button = false;
    this.resolution = [96, 96];
    this.framerate = 10;
    this.instructions_text = null;
    super.__post_init__();

    // D-pad pictogram
    const input_button_width = G.BUTTON_HEIGHT + 2;
    const input_button_height = input_button_width + 2;
    const dpad_center_x = G.EDGE_PADDING + input_button_width + G.COMPONENT_PADDING;
    const dpad_center_y = ssToolsInt((this.canvas_height - input_button_height) / 2);

    this.joystick_click_button = new SSIconButton({
      icon_name: FA.CIRCLE,
      icon_size: G.ICON_INLINE_FONT_SIZE - 6,
      width: input_button_width,
      height: input_button_height,
      screen_x: dpad_center_x,
      screen_y: dpad_center_y,
      outline_color: G.ACCENT_COLOR,
    });
    this.components.push(this.joystick_click_button);

    this.joystick_up_button = new SSIconButton({
      icon_name: SI.CHEVRON_UP,
      icon_size: G.ICON_INLINE_FONT_SIZE,
      width: input_button_width,
      height: input_button_height,
      screen_x: dpad_center_x,
      screen_y: dpad_center_y - input_button_height - G.COMPONENT_PADDING,
      outline_color: G.ACCENT_COLOR,
    });
    this.components.push(this.joystick_up_button);

    this.joystick_down_button = new SSIconButton({
      icon_name: SI.CHEVRON_DOWN,
      icon_size: G.ICON_INLINE_FONT_SIZE,
      width: input_button_width,
      height: input_button_height,
      screen_x: dpad_center_x,
      screen_y: dpad_center_y + input_button_height + G.COMPONENT_PADDING,
      outline_color: G.ACCENT_COLOR,
    });
    this.components.push(this.joystick_down_button);

    this.joystick_left_button = new SSIconButton({
      icon_name: SI.CHEVRON_LEFT,
      icon_size: G.ICON_INLINE_FONT_SIZE,
      width: input_button_width,
      height: input_button_height,
      screen_x: dpad_center_x - input_button_width - G.COMPONENT_PADDING,
      screen_y: dpad_center_y,
      outline_color: G.ACCENT_COLOR,
    });
    this.components.push(this.joystick_left_button);

    this.joystick_right_button = new SSIconButton({
      icon_name: SI.CHEVRON_RIGHT,
      icon_size: G.ICON_INLINE_FONT_SIZE,
      width: input_button_width,
      height: input_button_height,
      screen_x: dpad_center_x + input_button_width + G.COMPONENT_PADDING,
      screen_y: dpad_center_y,
      outline_color: G.ACCENT_COLOR,
    });
    this.components.push(this.joystick_right_button);

    // Hardware keys UI
    const font = SSFonts.get_font(G.get_button_font_name(), G.get_button_font_size());
    const text_width = font.getbbox("Clear", {anchor: "ls"})[2];
    const icon_height = ssToolsIconHeight(FA.CAMERA, G.ICON_INLINE_FONT_SIZE);
    const key_button_width = text_width + 2 * G.COMPONENT_PADDING + G.EDGE_PADDING;
    const key_button_height = icon_height + ssToolsInt(1.5 * G.COMPONENT_PADDING);
    const key2_y = ssToolsInt(this.canvas_height / 2) - ssToolsInt(key_button_height / 2);

    this.key2_button = new SSButton({
      text: "Clear",   // Initialize with text to set vertical centering
      width: key_button_width,
      height: key_button_height,
      screen_x: this.canvas_width - key_button_width + G.EDGE_PADDING,
      screen_y: key2_y,
      outline_color: G.ACCENT_COLOR,
      is_scrollable_text: false,   // Text has to dynamically update, can't use scrollable Button
    });
    if (!(this.renderer && this.renderer.is_screenshot_generator)) {
      // The button text should be empty for its initial state ("Clear" doesn't make any sense until a test image is captured).
      this.key2_button.text = " ";
    }
    this.components.push(this.key2_button);

    this.key1_button = new SSIconButton({
      icon_name: FA.CAMERA,
      width: key_button_width,
      height: key_button_height,
      screen_x: this.canvas_width - key_button_width + G.EDGE_PADDING,
      screen_y: key2_y - 3 * G.COMPONENT_PADDING - key_button_height,
      outline_color: G.ACCENT_COLOR,
    });
    this.components.push(this.key1_button);

    this.key3_button = new SSButton({
      text: "Exit",
      width: key_button_width,
      height: key_button_height,
      screen_x: this.canvas_width - key_button_width + G.EDGE_PADDING,
      screen_y: key2_y + 3 * G.COMPONENT_PADDING + key_button_height,
      outline_color: G.ACCENT_COLOR,
      is_scrollable_text: false,
    });
    this.components.push(this.key3_button);
  }

  async _run() {
    const G = SSGUIConstants, K = SSHardwareButtonsConstants;
    const hw = ssToolsHw(this);
    // SIM: on the device each show_image() is an SPI transfer of tens of ms, which keeps a key's highlight visible
    // between its "selected" and "unselected" renders; a browser blit is instant, so the same pause is made explicit.
    const SS_SIM_DISPLAY_TRANSFER_MS = 50;
    let cur_selected_button = this.key1_button;
    const msg_height = G.ICON_LARGE_BUTTON_SIZE + 2 * G.COMPONENT_PADDING;
    const camera_message = new SSTextArea({
      text: "Capturing image...",
      font_size: G.get_top_nav_title_font_size(),
      is_text_centered: true,
      height: msg_height,
      screen_y: ssToolsInt((this.canvas_height - msg_height) / 2),
    });

    while (true) {
      const input = await hw.wait_for(K.ALL_KEYS);

      if (input === K.KEY1) {
        cur_selected_button = this.key1_button;
        // Render edges around message box
        this.image_draw.rectangle([
          -1, ssToolsInt((this.canvas_height - msg_height) / 2) - 1,
          this.canvas_width + 1, ssToolsInt((this.canvas_height + msg_height) / 2) + 1,
        ], {fill: "black", outline: G.ACCENT_COLOR, width: 1});
        cur_selected_button.is_selected = true;
        cur_selected_button.render();
        camera_message.render();
        this.renderer.show_image();

        // Snap a pic, render it as the background, re-render all onscreen elements
        const camera = SSCamera.get_instance();
        try {
          await camera.start_single_frame_mode({resolution: [this.canvas_width, this.canvas_height]});

          // Reset the button state
          cur_selected_button.is_selected = false;
          cur_selected_button.render();
          this.renderer.show_image();

          await ssToolsSleep(250);
          const background_frame = await camera.capture_frame();
          const display_version = ssToolsAutocontrast(background_frame.canvas, 2);
          background_frame.wipe();
          ssToolsPasteCanvas(this.canvas, display_version, 0, this.top_nav.height);
          this.key2_button.text = "Clear";
          for (const component of this.components) component.render();
          this.renderer.show_image();
        } finally {
          camera.stop_single_frame_mode();
        }
        continue;

      } else if (input === K.KEY2) {
        cur_selected_button = this.key2_button;
        // Clear the background
        cur_selected_button.is_selected = true;
        this._render();
        this.renderer.show_image();
        await ssToolsSleep(SS_SIM_DISPLAY_TRANSFER_MS);

        // And then re-render Key2 in its initial state
        this.key2_button.text = " ";
        cur_selected_button.is_selected = false;
        cur_selected_button.render();
        this.renderer.show_image();
        continue;

      } else if (input === K.KEY3) {
        // Exit
        cur_selected_button = this.key3_button;
        cur_selected_button.is_selected = true;
        cur_selected_button.render();
        this.renderer.show_image();
        return undefined;

      } else if (input === K.KEY_PRESS) cur_selected_button = this.joystick_click_button;
      else if (input === K.KEY_UP) cur_selected_button = this.joystick_up_button;
      else if (input === K.KEY_DOWN) cur_selected_button = this.joystick_down_button;
      else if (input === K.KEY_LEFT) cur_selected_button = this.joystick_left_button;
      else if (input === K.KEY_RIGHT) cur_selected_button = this.joystick_right_button;

      cur_selected_button.is_selected = true;
      cur_selected_button.render();
      this.renderer.show_image();
      await ssToolsSleep(SS_SIM_DISPLAY_TRANSFER_MS);

      cur_selected_button.is_selected = false;
      cur_selected_button.render();
      this.renderer.show_image();

      await ssToolsSleep(100);
    }
  }
}


class SSDonateScreen extends SSBaseTopNavScreen {
  __post_init__() {
    const G = SSGUIConstants;
    this.title = "Donate";
    super.__post_init__();

    this.components.push(new SSTextArea({
      text: "SeedSigner is 100%% free & open source, funded solely by the Bitcoin community.\n\nDonate onchain or LN at:".replace("%%", "%"),
      screen_y: this.top_nav.height + 3 * G.COMPONENT_PADDING,
    }));

    const prev = this.components[this.components.length - 1];
    this.components.push(new SSTextArea({
      text: "seedsigner.com",
      font_name: G.get_body_font_name(),
      font_size: 28,
      font_color: G.ACCENT_COLOR,
      supersampling_factor: 1,
      screen_y: prev.screen_y + prev.height + G.COMPONENT_PADDING,
    }));
  }
}


class SSSettingsQRConfirmationScreen extends SSButtonListScreen {
  constructor(fields = {}) {
    const f = ssToolsFields({config_name: null, title: "Settings QR", status_message: "Settings updated...", is_bottom_list: true}, fields);
    SS_TOOLS_PENDING_FIELDS.push(f);
    try { super(f); } finally { SS_TOOLS_PENDING_FIELDS.pop(); }
  }

  __post_init__() {
    ssToolsAdoptFields(this);
    // Customize defaults
    this.button_data = [new SSButtonOption({button_label: "Home"})];
    this.show_back_button = false;
    super.__post_init__();

    let start_y = this.top_nav.height + 20;
    if (this.config_name) {
      this.config_name_textarea = new SSTextArea({
        text: `"${this.config_name}"`,   // User-supplied string (from SettingsQR); not translated
        is_text_centered: true,
        auto_line_break: true,
        screen_y: start_y,
      });
      this.components.push(this.config_name_textarea);
      start_y = this.config_name_textarea.screen_y + 50;
    }

    this.components.push(new SSTextArea({
      text: this.status_message,
      is_text_centered: true,
      auto_line_break: true,
      screen_y: start_y,
    }));
  }
}
