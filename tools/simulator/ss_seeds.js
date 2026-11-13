/* =====================================================================================
   SeedSigner 0.8.7 (commit e0a80d4b) port: SEEDS part
   Sources: gui/screens/seed_screens.py, views/seed_views.py, models/seed.py,
            models/seed_storage.py, helpers/embit_utils.py (the parts the seed views use),
            models/encode_qr.py (SeedQR / xpub / generic encoders), helpers/qr.py (QR image).
   Must be loaded AFTER the engine part (it extends SSButtonListScreen, SSBaseTopNavScreen,
   SSBaseScreen, SSKeyboardScreen, SSLargeIconStatusScreen and SSView at load time).
   ===================================================================================== */

/* -------------------------------------------------------------------------------------
   0. Small adapters (every place this part touches an engine API it does not own)
   ------------------------------------------------------------------------------------- */

// Python int(x) truncates toward zero.
function ssSeedsInt(x) { return Math.trunc(x); }

// (aborts with SSAbort when the page stops or restarts the device meanwhile: SS_GEN, see the engine's ssSleep)
function ssSeedsSleep(ms) {
    const gen = (typeof SS_GEN !== "undefined") ? SS_GEN : 0;
    return new Promise((resolve, reject) => setTimeout(() => ((typeof SS_GEN === "undefined" || gen === SS_GEN) ? resolve() : reject(new SSAbort())), ms));
}

// Python `x in coll` for str (substring), list/array (membership) and dict/object (key).
function ssSeedsIn(x, coll) {
    if (coll === null || coll === undefined) return false;
    if (typeof coll === "string") return typeof x === "string" && coll.includes(x);
    if (Array.isArray(coll)) return coll.includes(x);
    if (coll instanceof Set || coll instanceof Map) return coll.has(x);
    if (typeof coll === "object") return Object.prototype.hasOwnProperty.call(coll, x);
    return false;
}

// Dataclass defaults: the subclass's own defaults first, then the caller's fields win.
function ssSeedsFields(defaults, fields) {
    const out = Object.assign({}, defaults);
    if (fields) {
        for (const k of Object.keys(fields)) {
            if (fields[k] !== undefined) out[k] = fields[k];
        }
    }
    return out;
}

// Runs a class's own post-`super().__post_init__()` code exactly once, whether the engine
// calls `__post_init__()` from its base constructor or runs post-init code in each constructor.
function ssSeedsRunPost(obj, cls, fn) {
    if (!obj.__ss_seeds_posted) {
        Object.defineProperty(obj, "__ss_seeds_posted", { value: new Set(), enumerable: false });
    }
    if (obj.__ss_seeds_posted.has(cls)) return;
    obj.__ss_seeds_posted.add(cls);
    fn.call(obj);
}

// Python dataclass equality for ButtonOption (compares every field by value).
const SS_SEEDS_BUTTON_OPTION_FIELDS = ["button_label", "icon_name", "icon_color", "right_icon_name",
    "button_label_color", "return_data", "active_button_label", "font_name", "font_size"];
function ssSeedsBtnEq(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (typeof a.equals === "function") return a.equals(b);
    for (const k of SS_SEEDS_BUTTON_OPTION_FIELDS) {
        const va = a[k] === undefined ? null : a[k];
        const vb = b[k] === undefined ? null : b[k];
        if (va !== vb) return false;
    }
    return true;
}
function ssSeedsBtnIn(a, list) { return list.some((b) => ssSeedsBtnEq(a, b)); }

// Class-level ButtonOption constants (Python class attributes), created lazily so that this
// file does not need SSButtonOption at load time. The same object is returned every time
// (SeedFinalizeView mutates PASSPHRASE.button_label just like the Python class attribute).
const SS_SEEDS_BO_CACHE = new Map();
function ssSeedsBO(key, fields, Cls) {
    if (!SS_SEEDS_BO_CACHE.has(key)) {
        const C = Cls || SSButtonOption;
        SS_SEEDS_BO_CACHE.set(key, new C(fields));
    }
    return SS_SEEDS_BO_CACHE.get(key);
}
function ssSeedsButtonOption(fields) { return new SSButtonOption(fields); }
function ssSeedsButtonOptionWithoutTranslation(fields) {
    const C = (typeof SSButtonOptionWithoutTranslation !== "undefined") ? SSButtonOptionWithoutTranslation : SSButtonOption;
    return new C(fields);
}

// Views of other parts (scan, tools, psbt). A missing one falls back to NotYetImplementedView.
function ssSeedsExt(getter) {
    try {
        const C = getter();
        if (C) return C;
    } catch (e) { /* not defined by any part */ }
    return SSNotYetImplementedView;
}

function ssSeedsDest(View_cls, opts) {
    return new SSDestination(View_cls, opts || {});
}

function ssSeedsHW(screen) {
    if (screen && screen.hw_inputs && typeof screen.hw_inputs.wait_for === "function") return screen.hw_inputs;
    if (typeof SSHardwareButtons.get_instance === "function") return SSHardwareButtons.get_instance();
    return SSHardwareButtons;
}
function ssSeedsWaitFor(screen, keys) { return ssSeedsHW(screen).wait_for(keys); }

function ssSeedsTriggerOverride() {
    const hw = ssSeedsHW(null);
    if (hw && typeof hw.trigger_override === "function") hw.trigger_override();
}

function ssSeedsRenderer() {
    return SSRenderer.get_instance();
}

function ssSeedsController() {
    return SSController.get_instance();
}

// components.py reflow_text_into_pages (engine). Fallback is a port of the same algorithm
// with a simple greedy word wrap standing in for reflow_text_for_width.
function ssSeedsReflowTextIntoPages(text, width, height) {
    let fn = null;
    if (typeof ssReflowTextIntoPages === "function") fn = ssReflowTextIntoPages;
    else if (typeof ss_reflow_text_into_pages === "function") fn = ss_reflow_text_into_pages;
    else if (typeof SSReflowTextIntoPages === "function") fn = SSReflowTextIntoPages;
    if (fn) {
        return fn.length <= 1 ? fn({ text, width, height }) : fn(text, width, height);
    }
    const font_name = SSGUIConstants.get_body_font_name();
    const font_size = SSGUIConstants.get_body_font_size();
    const line_spacer = SSGUIConstants.BODY_LINE_SPACING;
    const font = SSFonts.get_font(font_name, font_size);
    const lines = [];
    for (const para of String(text).split("\n")) {
        const words = para.split(" ");
        let cur = "";
        for (const w of words) {
            const trial = cur ? cur + " " + w : w;
            if (cur && font.getlength(trial) > width) { lines.push(cur); cur = w; } else { cur = trial; }
        }
        lines.push(cur);
    }
    const [, top, , bottom] = font.getbbox("Agjpqy", { anchor: "ls" });
    const above = -1 * top, below = bottom;
    let lines_per_page = 0;
    for (let i = 1; i < height; i++) {
        if (height > above * i + line_spacer * (i - 1) + below) lines_per_page = i;
        else break;
    }
    const pages = [];
    for (let i = 0; i < lines.length; i += lines_per_page) pages.push(lines.slice(i, i + lines_per_page).join("\n"));
    return pages;
}

/* Python BaseThread stand-in (threads become async loops that stop when the screen ends). */
class SSSeedsThread {
    constructor() {
        this.keep_running = false;
        this._ss_alive = false;
        this._ss_promise = null;
    }
    start() {
        this.keep_running = true;
        this._ss_alive = true;
        this._ss_promise = Promise.resolve()
            .then(() => this.run())
            .catch((e) => { if (!(typeof SSAbort !== "undefined" && e instanceof SSAbort)) console.error(e); })
            .finally(() => { this._ss_alive = false; });
    }
    stop() { this.keep_running = false; }
    is_alive() { return this._ss_alive; }
    async join() { if (this._ss_promise) await this._ss_promise; }
    async run() { }
}

/* models/threads.py ThreadsafeCounter (defined only if no other part defines it). */
if (typeof SSThreadsafeCounter === "undefined") {
    globalThis.SSThreadsafeCounter = class SSThreadsafeCounter {
        constructor(initial_value = 0) {
            if (initial_value && typeof initial_value === "object" && "initial_value" in initial_value) initial_value = initial_value.initial_value;
            this.count = initial_value;
        }
        get cur_count() { return this.count; }
        increment(step = 1) { this.count += step; }
        set_value(value) { this.count = value; }
    };
}

function ssSeedsHexColorToRgb(color) {
    const named = { black: [0, 0, 0], white: [255, 255, 255], orange: [255, 165, 0], red: [255, 0, 0], blue: [0, 0, 255] };
    if (named[color]) return named[color];
    let h = String(color).replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function ssSeedsRgbToHex(rgb) {
    return "#" + rgb.map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, "0")).join("");
}

/* gui/screens/screen.py WarningEdgesThread (port). */
class SSSeedsWarningEdgesThread extends SSSeedsThread {
    constructor(args) {
        super();
        this.args = args;
    }
    async run() {
        const screen = this.args[0];
        let inhale_step = 1;
        const inhale_max = 10;
        const inhale_hold = 8;
        let cur_inhale_hold = 0;
        let inhale_factor = 0;
        const rgb = ssSeedsHexColorToRgb(screen.status_color);

        const render_border = (color, width) => {
            screen.image_draw.rectangle(
                [0, 0, screen.canvas_width, screen.canvas_height],
                { fill: null, outline: color, width: width }
            );
        };

        while (this.keep_running) {
            // Ramp the edges from a darker version out to full color
            const inhale_scalar = inhale_factor * ssSeedsInt(255 / inhale_max);
            let index = 0;
            for (let n = 4; n > -1; n--) {
                // 34 == 0x22; just eyeballed a good step size
                const r = Math.max(0, rgb[0] - 34 * n - inhale_scalar);
                const g = Math.max(0, rgb[1] - 34 * n - inhale_scalar);
                const b = Math.max(0, rgb[2] - 34 * n - inhale_scalar);
                // `index` shrinks the border at each step
                render_border(ssSeedsRgbToHex([r, g, b]), SSGUIConstants.EDGE_PADDING - 2 - index);
                index += 1;
            }
            screen.renderer.show_image();

            if (inhale_factor === inhale_max) {
                inhale_step = -1;
            } else if (inhale_factor === 0 && inhale_step === -1) {
                cur_inhale_hold += 1;
                if (cur_inhale_hold > inhale_hold) {
                    inhale_step = 1;
                    cur_inhale_hold = 0;
                } else {
                    // It's about to be decremented below zero
                    inhale_factor = 1;
                }
            }
            inhale_factor += inhale_step;

            // Target ~10fps
            await ssSeedsSleep(50);
        }
    }
}

/* WarningEdgesMixin (Python mixin listed first in the bases) as a JS class factory. */
function ssSeedsWarningEdgesMixin(Base) {
    class SSSeedsWarningEdges extends Base {
        constructor(fields = {}) {
            super(ssSeedsFields({
                status_color: SSGUIConstants.WARNING_COLOR,
                text_edge_padding: 2 * SSGUIConstants.EDGE_PADDING,
            }, fields));
            ssSeedsRunPost(this, SSSeedsWarningEdges, this._ss_warning_edges_post);
        }
        __post_init__() {
            super.__post_init__();
            ssSeedsRunPost(this, SSSeedsWarningEdges, this._ss_warning_edges_post);
        }
        _ss_warning_edges_post() {
            this.threads.push(new SSSeedsWarningEdgesThread([this]));
        }
    }
    return SSSeedsWarningEdges;
}


/* -------------------------------------------------------------------------------------
   1. Crypto glue on top of VOIDFORGE (embit stand-ins). Networks follow embit NETWORKS.
   ------------------------------------------------------------------------------------- */
const SS_SEEDS_NETS = {
    main: { hrp: "bc", pkh: 0x00, sh: 0x05, ver: { xpub: "0488b21e", ypub: "049d7cb2", zpub: "04b24746", Ypub: "0295b43f", Zpub: "02aa7ed3" } },
    test: { hrp: "tb", pkh: 0x6f, sh: 0xc4, ver: { xpub: "043587cf", ypub: "044a5262", zpub: "045f1cf6", Ypub: "024289ef", Zpub: "02575483" } },
    regtest: { hrp: "bcrt", pkh: 0x6f, sh: 0xc4, ver: { xpub: "043587cf", ypub: "044a5262", zpub: "045f1cf6", Ypub: "024289ef", Zpub: "02575483" } },
};
const SS_SEEDS_HARDENED = 0x80000000;

// SettingsConstants.map_network_to_embit
function ssSeedsEmbitNetwork(network) {
    const SC = SSSettingsConstants;
    if (network === SC.MAINNET) return "main";
    if (network === SC.TESTNET) return "test";
    if (network === SC.REGTEST) return "regtest";
    if (network === "main" || network === "test" || network === "regtest") return network;
    return undefined;
}

function ssSeedsHexToBytes(h) { const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; }
function ssSeedsBytesToHex(b) { return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join(""); }
function ssSeedsBig(b) { let n = 0n; for (const x of b) n = (n << 8n) | BigInt(x); return n; }
function ssSeedsBig32(n) { return ssSeedsHexToBytes(n.toString(16).padStart(64, "0")); }
function ssSeedsConcat(...parts) {
    const o = new Uint8Array(parts.reduce((a, x) => a + x.length, 0));
    let i = 0;
    for (const x of parts) { o.set(x, i); i += x.length; }
    return o;
}

// embit bip32.parse_path
function ssSeedsParsePath(path) {
    if (Array.isArray(path)) return path.slice();
    let arr = String(path).replace(/\/+$/, "").split("/");
    if (arr[0] === "m") arr = arr.slice(1);
    if (arr.length === 0) return [];
    if (arr[0] === "") arr = arr.slice(1);
    return arr.map((e) => {
        let hardened = false;
        if (e.endsWith("h") || e.endsWith("'")) { hardened = true; e = e.slice(0, -1); }
        if (!/^[0-9]+$/.test(e)) throw new Error("invalid literal for int() with base 10: '" + e + "'");
        const i = parseInt(e, 10);
        if (i >= SS_SEEDS_HARDENED) throw new Error("Index is too big");
        return hardened ? i + SS_SEEDS_HARDENED : i;
    });
}

// embit bip32.detect_version(path, default="xpub", network)
function ssSeedsDetectVersion(derivation_path, embit_network) {
    const path = ssSeedsParsePath(derivation_path);
    const H = SS_SEEDS_HARDENED;
    let key = "xpub";
    if (path.length > 0) {
        if (path[0] === H + 84) key = "zpub";
        else if (path[0] === H + 49) key = "ypub";
        else if (path[0] === H + 48) {
            if (path.length >= 4) {
                if (path[3] === H + 1) key = "Ypub";
                else if (path[3] === H + 2) key = "Zpub";
            }
        } else if (path[0] === H + 44) key = "xpub";
        else if (path[0] === H + 86) key = "xpub";
    }
    return SS_SEEDS_NETS[embit_network].ver[key];
}

/* Public BIP-32 key, standing in for the embit HDKey that Seed.get_xpub() returns. */
class SSSeedsHDKey {
    constructor({ key, chain_code, depth, fingerprint, child_number }) {
        this.key = key;                 // 33-byte compressed public key
        this.chain_code = chain_code;   // 32 bytes
        this.depth = depth;
        this.fingerprint = fingerprint; // parent fingerprint (4 bytes), as embit HDKey.fingerprint
        this.child_number = child_number;
    }
    async to_string(version_hex) {
        const b = new Uint8Array(78);
        b.set(ssSeedsHexToBytes(version_hex), 0);
        b[4] = this.depth;
        b.set(this.fingerprint, 5);
        const cn = this.child_number >>> 0;
        b.set([(cn >>> 24) & 255, (cn >>> 16) & 255, (cn >>> 8) & 255, cn & 255], 9);
        b.set(this.chain_code, 13);
        b.set(this.key, 45);
        return base58check(b);
    }
    async my_fingerprint() { return (await hash160(this.key)).slice(0, 4); }
    async derive(path) {
        let pub = this.key, chain = this.chain_code, depth = this.depth, fp = this.fingerprint, cn = this.child_number;
        for (const i of ssSeedsParsePath(path)) {
            if (i >= SS_SEEDS_HARDENED) throw new Error("Can't do hardened with public key");
            fp = (await hash160(pub)).slice(0, 4);
            [pub, chain] = await ckdPub(pub, chain, i);
            depth += 1; cn = i;
        }
        return new SSSeedsHDKey({ key: pub, chain_code: chain, depth, fingerprint: fp, child_number: cn });
    }
}

// HDKey.from_seed(seed_bytes).derive(path) -> {k, c, depth, parent_fp, child_number}
async function ssSeedsDerivePrivate(seed_bytes, derivation_path) {
    let [k, c] = await masterFromSeed(seed_bytes);
    let depth = 0, parent_fp = new Uint8Array(4), child_number = 0;
    for (const i of ssSeedsParsePath(derivation_path)) {
        parent_fp = (await hash160(pubkeyBytes(k))).slice(0, 4);
        const hardened = i >= SS_SEEDS_HARDENED;
        [k, c] = await ckdPriv(k, c, hardened ? i - SS_SEEDS_HARDENED : i, hardened);
        depth += 1; child_number = i;
    }
    return { k, c, depth, parent_fp, child_number };
}

// embit_utils.get_xpub
async function ssSeedsGetXpub(seed_bytes, derivation_path) {
    const d = await ssSeedsDerivePrivate(seed_bytes, derivation_path);
    return new SSSeedsHDKey({ key: pubkeyBytes(d.k), chain_code: d.c, depth: d.depth, fingerprint: d.parent_fp, child_number: d.child_number });
}

// embit.script p2pkh / p2sh(p2wpkh) / p2wpkh / p2tr(...).address(network)
async function ssSeedsAddressFromPub(script_type, pub, embit_network) {
    const SC = SSSettingsConstants, N = SS_SEEDS_NETS[embit_network || "main"];
    if (script_type === SC.LEGACY_P2PKH) return base58check(Uint8Array.of(N.pkh, ...(await hash160(pub))));
    if (script_type === SC.NESTED_SEGWIT) return base58check(Uint8Array.of(N.sh, ...(await hash160(Uint8Array.of(0x00, 0x14, ...(await hash160(pub)))))));
    if (script_type === SC.NATIVE_SEGWIT) return bech32Encode(N.hrp, 0, await hash160(pub));
    if (script_type === SC.TAPROOT) return taprootAddressFromPoint(pointFromPub(pub), N.hrp);
    return undefined;
}

// secp256k1 ecdsa_sign_recoverable (RFC 6979 nonce, low-S), for embit_utils.sign_message.
async function ssSeedsHmacSha256(key, data) {
    const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
function ssSeedsModInv(a, m) {
    let r0 = ((a % m) + m) % m, r1 = m, s0 = 1n, s1 = 0n;
    while (r1 !== 0n) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
    return ((s0 % m) + m) % m;
}
// libsecp256k1's nonce_function_rfc6979: HMAC-DRBG seeded with key32 || (msg32 mod n) || optional 32 bytes of extra data
// (embit's PrivateKey.sign grinds for a low R by passing a counter as the extra data, as Bitcoin Core does).
async function ssSeedsEcdsaSignRecoverable(msg32, d, extra = null) {
    const x = ssSeedsBig32(d);
    const z = ssSeedsBig(msg32) % SN;
    const seed = extra ? ssSeedsConcat(x, ssSeedsBig32(z), extra) : ssSeedsConcat(x, ssSeedsBig32(z));
    let V = new Uint8Array(32).fill(1), K = new Uint8Array(32);
    K = await ssSeedsHmacSha256(K, ssSeedsConcat(V, [0], seed));
    V = await ssSeedsHmacSha256(K, V);
    K = await ssSeedsHmacSha256(K, ssSeedsConcat(V, [1], seed));
    V = await ssSeedsHmacSha256(K, V);
    for (;;) {
        V = await ssSeedsHmacSha256(K, V);
        const k = ssSeedsBig(V);
        if (k >= 1n && k < SN) {
            const R = emul(k, SG);
            const r = R[0] % SN;
            if (r !== 0n) {
                let s = (ssSeedsModInv(k, SN) * ((z + r * d) % SN)) % SN;
                if (s !== 0n) {
                    let recid = ((R[1] & 1n) ? 1 : 0) | (R[0] >= SN ? 2 : 0);
                    if (s > SN / 2n) { s = SN - s; recid ^= 1; }
                    return { r, s, recid };
                }
            }
        }
        K = await ssSeedsHmacSha256(K, ssSeedsConcat(V, [0]));
        V = await ssSeedsHmacSha256(K, V);
    }
}


/* -------------------------------------------------------------------------------------
   2. helpers/embit_utils.py (only what seed_views.py uses; positional args as in Python)
   ------------------------------------------------------------------------------------- */
const ssSeedsEmbitUtils = {
    get_standard_derivation_path(network, wallet_type, script_type) {
        const SC = SSSettingsConstants;
        if (network === undefined) network = SC.MAINNET;
        if (wallet_type === undefined) wallet_type = SC.SINGLE_SIG;
        if (script_type === undefined) script_type = SC.NATIVE_SEGWIT;
        let network_path;
        if (network === SC.MAINNET) network_path = "0'";
        else if (network === SC.TESTNET) network_path = "1'";
        else if (network === SC.REGTEST) network_path = "1'";
        else throw new Error("Unexpected network");

        if (wallet_type === SC.SINGLE_SIG) {
            if (script_type === SC.LEGACY_P2PKH) return `m/44'/${network_path}/0'`;
            else if (script_type === SC.NESTED_SEGWIT) return `m/49'/${network_path}/0'`;
            else if (script_type === SC.NATIVE_SEGWIT) return `m/84'/${network_path}/0'`;
            else if (script_type === SC.TAPROOT) return `m/86'/${network_path}/0'`;
            else throw new Error("Unexpected script type");
        } else if (wallet_type === SC.MULTISIG) {
            if (script_type === SC.LEGACY_P2PKH) return `m/45'`; // BIP-45
            else if (script_type === SC.NESTED_SEGWIT) return `m/48'/${network_path}/0'/1'`;
            else if (script_type === SC.NATIVE_SEGWIT) return `m/48'/${network_path}/0'/2'`;
            else if (script_type === SC.TAPROOT) throw new Error("Taproot multisig not yet supported");
            else throw new Error("Unexpected script type");
        } else {
            throw new Error("Unexpected wallet type");
        }
    },

    async get_xpub(seed_bytes, derivation_path, embit_network = "main") {
        return ssSeedsGetXpub(seed_bytes, derivation_path);
    },

    async get_single_sig_address(xpub, script_type, index = 0, is_change = false, embit_network = "main") {
        if (script_type === undefined) script_type = SSSettingsConstants.NATIVE_SEGWIT;
        let pubkey;
        if (is_change) pubkey = (await xpub.derive([1, index])).key;
        else pubkey = (await xpub.derive([0, index])).key;
        return ssSeedsAddressFromPub(script_type, pubkey, embit_network);
    },

    /* The JS descriptor (set on controller.multisig_wallet_descriptor by the scan part) is
       expected to be {type: "ms-wsh"|"ms-sh-wsh"|"ms-tr", m, cosigners:[{fp, path, key}]}
       as VOIDFORGE's multisig functions use, or to offer its own derive_address(). */
    async get_multisig_address(descriptor, index = 0, is_change = false, embit_network = "main") {
        const branch_index = is_change ? 1 : 0;
        if (descriptor && typeof descriptor.derive_address === "function") {
            return descriptor.derive_address(index, branch_index, embit_network);
        }
        if (descriptor.type === "ms-tr") {
            // TODO: Not yet implemented!
            throw new Error("Taproot verification not yet implemented!");
        }
        if (descriptor.type === "ms-wsh" || descriptor.type === "ms-sh-wsh") {
            if (embit_network === "regtest") {
                const { script } = await multisigScript(descriptor.m, descriptor.cosigners, branch_index, index);
                const sh = await sha256bytes(script);
                if (descriptor.type === "ms-wsh") return bech32Encode("bcrt", 0, sh);
                return base58check(Uint8Array.from([0xc4, ...(await hash160(Uint8Array.from([0x00, 0x20, ...sh])))]));
            }
            return multisigAddress(descriptor.type, descriptor.m, descriptor.cosigners, branch_index, index, embit_network);
        }
        throw new Error(`${descriptor.type} address verification not yet implemented!`);
    },

    get_multisig_policy(descriptor) {
        // Extract (threshold, n) from a basic multisig descriptor.
        if (descriptor && typeof descriptor.get_multisig_policy === "function") return descriptor.get_multisig_policy();
        const n = descriptor.cosigners ? descriptor.cosigners.length : (descriptor.keys || []).length;
        if (!descriptor.m) throw new Error("Expected a basic multisig descriptor");
        return [String(descriptor.m), String(n)];
    },

    get_embit_network_name(settings_name) {
        const SC = SSSettingsConstants;
        const lookup = {};
        lookup[SC.MAINNET] = "main";
        lookup[SC.TESTNET] = "test";
        lookup[SC.REGTEST] = "regtest";
        return lookup[settings_name];
    },

    parse_derivation_path(derivation_path) {
        const SC = SSSettingsConstants;
        // Support either m/44'/... or m/44h/... style
        derivation_path = derivation_path.split("'").join("h");
        const sections = derivation_path.split("/");
        if (sections[1] === "48h") {
            // So far this helper is only meant for single sig message signing
            throw new Error("Not implemented");
        }
        const script_types = { "44h": SC.LEGACY_P2PKH, "49h": SC.NESTED_SEGWIT, "84h": SC.NATIVE_SEGWIT, "86h": SC.TAPROOT };
        const networks = { "0h": SC.MAINNET, "1h": [SC.TESTNET, SC.REGTEST] };

        const details = {};
        details["script_type"] = script_types[sections[1]];
        if (!details["script_type"]) details["script_type"] = SC.CUSTOM_DERIVATION;
        details["network"] = (sections[2] in networks) ? networks[sections[2]] : null;

        // Check if there's a standard change path
        const s2 = sections[sections.length - 2];
        if (s2 === "0" || s2 === "1") details["is_change"] = s2 === "1";
        else details["is_change"] = null;

        // Check if there's a standard address index
        const s1 = sections[sections.length - 1];
        if (/^[0-9]+$/.test(s1)) details["index"] = parseInt(s1, 10);
        else details["index"] = null;

        if (details["is_change"] !== null && details["index"] !== null) {
            // standard change and addr index; safe to truncate to the wallet level
            details["wallet_derivation_path"] = sections.slice(0, -2).join("/");
        } else {
            details["wallet_derivation_path"] = null;
        }

        details["clean_match"] = true;
        for (const k of Object.keys(details)) {
            if (details[k] === null || details[k] === undefined) {
                // At least one field couldn't be parsed
                details["clean_match"] = false;
                break;
            }
        }
        return details;
    },

    async sign_message(seed_bytes, derivation, msg, compressed = true, embit_network = "main") {
        // msg: a string (Python passes message.encode()); hashed as UTF-8 by msgHashLegacy
        const msghash = await msgHashLegacy(msg);
        const prv = await ssSeedsDerivePrivate(seed_bytes, derivation);
        const sig = await ssSeedsEcdsaSignRecoverable(msghash, prv.k);
        const c = compressed ? 4 : 0;
        const ser = ssSeedsConcat([27 + sig.recid + c], ssSeedsBig32(sig.r), ssSeedsBig32(sig.s));
        let bin = "";
        for (const b of ser) bin += String.fromCharCode(b);
        return btoa(bin);
    },
};
if (typeof SSEmbitUtils === "undefined") globalThis.SSEmbitUtils = ssSeedsEmbitUtils;


/* -------------------------------------------------------------------------------------
   3. models/seed.py
   ------------------------------------------------------------------------------------- */
class SSInvalidSeedException extends Error {
    constructor(msg) { super(msg); this.name = "InvalidSeedException"; }
}

class SSSeed {
    constructor({ mnemonic = null, passphrase = "", wordlist_language_code = null } = {}) {
        this._wordlist_language_code = wordlist_language_code || SSSettingsConstants.WORDLIST_LANGUAGE__ENGLISH;
        if (typeof mnemonic === "string") mnemonic = mnemonic.split(" ");
        if (!mnemonic || mnemonic.length === 0) {
            throw new Error("Must initialize a Seed with a mnemonic List[str]");
        }
        this._mnemonic = mnemonic.join(" ").trim().normalize("NFKD").split(/\s+/).filter((w) => w.length);

        this._passphrase = "";
        this.set_passphrase(passphrase, false);

        this.seed_bytes = null;
        this._ss_seed_cache = new Map();
        this._ss_fp_cache = new Map();
        this._ready = this._generate_seed();
        this._ready.catch(() => { });
    }

    // JS only: construct and wait for the PBKDF2 seed (throws SSInvalidSeedException)
    static async create(args) {
        const seed = new this(args);
        await seed._ready;
        return seed;
    }

    async ready() { await this._ready; return this; }

    static get_wordlist(wordlist_language_code) {
        if (wordlist_language_code === undefined || wordlist_language_code === null) wordlist_language_code = SSSettingsConstants.WORDLIST_LANGUAGE__ENGLISH;
        // TODO: Support other BIP-39 wordlist languages!
        if (wordlist_language_code === SSSettingsConstants.WORDLIST_LANGUAGE__ENGLISH) {
            return WORDLIST;
        } else {
            throw new Error(`Unrecognized wordlist_language_code ${wordlist_language_code}`);
        }
    }

    // embit bip39.mnemonic_to_bytes checks (length, words, checksum)
    async _ss_validate_bip39() {
        const words = this._mnemonic;
        if (words.length % 3 !== 0 || words.length < 12 || words.length > 24) throw new Error("Invalid recovery phrase");
        const wordlist = this.wordlist;
        const idx = words.map((w) => wordlist.indexOf(w));
        const bad = idx.indexOf(-1);
        if (bad >= 0) throw new Error(`Word '${words[bad]}' is not in the dictionary`);
        const bits = idx.map((i) => i.toString(2).padStart(11, "0")).join("");
        const cbits = words.length / 3;
        const ebits = bits.length - cbits;
        const entropy = new Uint8Array(ebits / 8);
        for (let i = 0; i < entropy.length; i++) entropy[i] = parseInt(bits.slice(i * 8, (i + 1) * 8), 2);
        const h = await sha256bytes(entropy);
        const hbits = Array.from(h).map((x) => x.toString(2).padStart(8, "0")).join("").slice(0, cbits);
        if (hbits !== bits.slice(ebits)) throw new Error("Checksum verification failed");
    }

    async _generate_seed() {
        if (this._ss_seed_cache.has(this._passphrase)) {
            this.seed_bytes = this._ss_seed_cache.get(this._passphrase);
            return;
        }
        try {
            await this._ss_validate_bip39();
            this.seed_bytes = await mnemonicToSeed(this.mnemonic_str, this._passphrase);
        } catch (e) {
            throw new SSInvalidSeedException(String(e && e.message ? e.message : e));
        }
        this._ss_seed_cache.set(this._passphrase, this.seed_bytes);
    }

    get mnemonic_str() { return this._mnemonic.join(" "); }
    get mnemonic_list() { return this._mnemonic; }
    get wordlist_language_code() { return this._wordlist_language_code; }
    get mnemonic_display_str() { return this._mnemonic.join(" ").normalize("NFC"); }
    get mnemonic_display_list() { return this._mnemonic.join(" ").normalize("NFC").split(" "); }
    get has_passphrase() { return this._passphrase !== ""; }
    get passphrase() { return this._passphrase; }
    get passphrase_display() { return this._passphrase.normalize("NFC"); }

    // Returns a Promise when the seed is regenerated (callers `await` it).
    set_passphrase(passphrase, regenerate_seed = true) {
        if (passphrase) {
            this._passphrase = String(passphrase).normalize("NFKD");
        } else {
            // Passphrase must always have a string value, even if it's just the empty string.
            this._passphrase = "";
        }
        if (regenerate_seed) {
            // Regenerate the internal seed since passphrase changes the result
            this._ready = this._generate_seed();
            return this._ready;
        }
        return Promise.resolve();
    }

    get wordlist() { return SSSeed.get_wordlist(this.wordlist_language_code); }

    set_wordlist_language_code(language_code) {
        // TODO: Support other BIP-39 wordlist languages!
        throw new Error("Not yet implemented!");
    }

    get script_override() { return null; }

    derivation_override(sig_type) { return null; }

    detect_version(derivation_path, network, sig_type) {
        if (network === undefined) network = SSSettingsConstants.MAINNET;
        return ssSeedsDetectVersion(derivation_path, ssSeedsEmbitNetwork(network));
    }

    get passphrase_label() { return SSSettingsConstants.LABEL__BIP39_PASSPHRASE; }
    get seedqr_supported() { return true; }
    get bip85_supported() { return true; }

    async get_fingerprint(network) {
        await this._ready;
        const key = ssSeedsBytesToHex(this.seed_bytes);
        if (!this._ss_fp_cache.has(key)) this._ss_fp_cache.set(key, await fingerprintFromSeed(this.seed_bytes));
        return this._ss_fp_cache.get(key);
    }

    async get_xpub(wallet_path = "/", network) {
        await this._ready;
        return ssSeedsEmbitUtils.get_xpub(this.seed_bytes, wallet_path, ssSeedsEmbitNetwork(network === undefined ? SSSettingsConstants.MAINNET : network));
    }

    async get_bip85_child_mnemonic(bip85_index, bip85_num_words, network) {
        // Derives the seed's nth BIP-85 child mnemonic
        await this._ready;
        const [k, c] = await masterFromSeed(this.seed_bytes);
        // TODO: Support other BIP-39 wordlist languages!
        return bip85Mnemonic(k, c, bip85_num_words, bip85_index);
    }

    // Python __eq__
    equals(other) {
        if (other instanceof SSSeed) {
            return !!this.seed_bytes && !!other.seed_bytes && ssSeedsBytesToHex(this.seed_bytes) === ssSeedsBytesToHex(other.seed_bytes);
        }
        return false;
    }
}

class SSElectrumSeed extends SSSeed {
    async _generate_seed() {
        if (this._mnemonic.length !== 12) {
            throw new SSInvalidSeedException(`Unsupported Electrum seed length: ${this._mnemonic.length}`);
        }
        if (this._ss_seed_cache.has(this._passphrase)) {
            this.seed_bytes = this._ss_seed_cache.get(this._passphrase);
            return;
        }
        // electrumSeedType(): HMAC-SHA512("Seed version", mnemonic) hex prefix; "SegWit" == "100"
        let kind = null;
        try { kind = await electrumSeedType(this.mnemonic_str); } catch (e) { kind = null; }
        // only support Electrum Segwit version for now
        if (kind === "SegWit") {   // SettingsConstants.ELECTRUM_SEED_SEGWIT == prefix
            // PBKDF2-HMAC-SHA512(mnemonic, "electrum" + passphrase, 2048); passphrase already normalized below
            this.seed_bytes = await electrumToSeed(this.mnemonic_str, this._passphrase, true);
        } else {
            throw new SSInvalidSeedException("Unsupported Electrum seed format");
        }
        this._ss_seed_cache.set(this._passphrase, this.seed_bytes);
    }

    set_passphrase(passphrase, regenerate_seed = true) {
        if (passphrase) {
            this._passphrase = SSElectrumSeed.normalize_electrum_passphrase(passphrase);
        } else {
            this._passphrase = "";
        }
        if (regenerate_seed) {
            this._ready = this._generate_seed();
            return this._ready;
        }
        return Promise.resolve();
    }

    static normalize_electrum_passphrase(passphrase) {
        passphrase = String(passphrase).normalize("NFKD");
        passphrase = passphrase.toLowerCase();
        passphrase = passphrase.split(/\s+/).filter((x) => x.length).join(" ");
        return passphrase;
    }

    get script_override() { return SSSettingsConstants.NATIVE_SEGWIT; }

    derivation_override(sig_type) {
        if (sig_type === undefined) sig_type = SSSettingsConstants.SINGLE_SIG;
        return sig_type === SSSettingsConstants.SINGLE_SIG ? "m/0h" : "m/1h";
    }

    detect_version(derivation_path, network, sig_type) {
        if (network === undefined) network = SSSettingsConstants.MAINNET;
        if (sig_type === undefined) sig_type = SSSettingsConstants.SINGLE_SIG;
        const N = SS_SEEDS_NETS[ssSeedsEmbitNetwork(network)];
        return sig_type === SSSettingsConstants.SINGLE_SIG ? N.ver.zpub : N.ver.Zpub;
    }

    get passphrase_label() { return SSSettingsConstants.LABEL__CUSTOM_EXTENSION; }
    get seedqr_supported() { return false; }
    get bip85_supported() { return false; }
}


/* -------------------------------------------------------------------------------------
   4. models/seed_storage.py
   ------------------------------------------------------------------------------------- */
class SSSeedStorage {
    constructor() {
        this.seeds = [];
        this.pending_seed = null;
        this._pending_mnemonic = [];
        this._pending_is_electrum = false;
    }

    set_pending_seed(seed) { this.pending_seed = seed; }

    get_pending_seed() { return this.pending_seed; }

    finalize_pending_seed() {
        // Finally store the pending seed and return its index
        let index = this.seeds.findIndex((s) => s === this.pending_seed || (s.equals && s.equals(this.pending_seed)));
        if (index < 0) {
            this.seeds.push(this.pending_seed);
            index = this.seeds.length - 1;
        }
        this.pending_seed = null;
        return index;
    }

    clear_pending_seed() { this.pending_seed = null; }

    async validate_mnemonic(mnemonic) {
        try {
            await SSSeed.create({ mnemonic });
        } catch (e) {
            if (e instanceof SSInvalidSeedException) return false;
            throw e;
        }
        return true;
    }

    num_seeds() { return this.seeds.length; }

    get pending_mnemonic() {
        // Always return a copy so that the internal List can't be altered
        return this._pending_mnemonic.slice();
    }

    get pending_mnemonic_length() { return this._pending_mnemonic.length; }

    init_pending_mnemonic(num_words = 12, is_electrum = false) {
        if (num_words && typeof num_words === "object") ({ num_words = 12, is_electrum = false } = num_words);
        this._pending_mnemonic = new Array(num_words).fill(null);
        this._pending_is_electrum = is_electrum;
    }

    update_pending_mnemonic(word, index) {
        // Replaces the nth word in the pending mnemonic; may specify a negative `index`.
        if (index >= this._pending_mnemonic.length) throw new Error(`index ${index} is too high`);
        if (index < 0) index = this._pending_mnemonic.length + index;
        this._pending_mnemonic[index] = word;
    }

    get_pending_mnemonic_word(index) {
        if (index < this._pending_mnemonic.length) return this._pending_mnemonic[index];
        return null;
    }

    async get_pending_mnemonic_fingerprint(network) {
        try {
            let seed;
            if (this._pending_is_electrum) seed = await SSElectrumSeed.create({ mnemonic: this._pending_mnemonic });
            else seed = await SSSeed.create({ mnemonic: this._pending_mnemonic });
            return await seed.get_fingerprint(network);
        } catch (e) {
            if (e instanceof SSInvalidSeedException) return null;
            throw e;
        }
    }

    async convert_pending_mnemonic_to_pending_seed() {
        if (this._pending_is_electrum) this.pending_seed = await SSElectrumSeed.create({ mnemonic: this._pending_mnemonic });
        else this.pending_seed = await SSSeed.create({ mnemonic: this._pending_mnemonic });
        this.discard_pending_mnemonic();
    }

    discard_pending_mnemonic() {
        this._pending_mnemonic = [];
        this._pending_is_electrum = false;
    }
}


/* -------------------------------------------------------------------------------------
   5. helpers/qr.py: QR images drawn with the engine's PIL-like layer
   ------------------------------------------------------------------------------------- */
const SS_SEEDS_QR_STYLE__DEFAULT = 1;
const SS_SEEDS_QR_STYLE__ROUNDED = 2;
const SS_SEEDS_QR_STYLE__GRID = 3;

// QR module matrix (error correction L, smallest version) for the data types SeedSigner feeds
// the `qrcode` library: digit strings -> numeric mode (SeedQR), bytes -> byte mode
// (CompactSeedQR), other text -> alphanumeric when possible, else UTF-8 bytes.
function ssSeedsQRRows(data) {
    // SIM: the page's encoder has error-correction level L tables only for versions 1-3
    // (enough for every SeedQR); larger codes (xpubs, signatures) fall back to level M.
    const build = (spec) => {
        try { return qrBuild(Object.assign({ level: "L" }, spec)).rows; }
        catch (e) { return qrBuild(Object.assign({}, spec, { level: "M" })).rows; }
    };
    if (data instanceof Uint8Array || Array.isArray(data)) {
        return build({ mode: "byte", bytes: Array.from(data) });
    }
    const s = String(data);
    if (/^[0-9]+$/.test(s)) return build({ mode: "numeric", digits: s });
    if (/^[0-9A-Z $%*+\-./:]+$/.test(s)) return build({ mode: "alnum", text: s });
    return build({ mode: "byte", bytes: Array.from(new TextEncoder().encode(s)) });
}

function ssSeedsColor(c) {
    if (typeof c === "string" && /^[0-9a-fA-F]{6}$/.test(c)) return "#" + c;
    return c;
}

// QR.qrimage(data, width, height, border, style, background_color)
function ssSeedsQRImage(data, width = 240, height = 240, border = 3, style = null, background_color = "#444") {
    const rows = ssSeedsQRRows(data);
    const n = rows.length;
    const total = n + 2 * border;
    const sx = width / total, sy = height / total;
    const rounded = style === SS_SEEDS_QR_STYLE__ROUNDED;
    // StyledPilImage (ROUNDED/GRID) ignores back_color: its SolidFillColorMask is white.
    const bg = (style === SS_SEEDS_QR_STYLE__ROUNDED || style === SS_SEEDS_QR_STYLE__GRID) ? "#ffffff" : ssSeedsColor(background_color);
    const img = SSImage.new("RGB", [width, height], bg);
    const draw = SSImageDraw.Draw(img);
    const is_eye = (r, c) => (r < 7 && c < 7) || (r < 7 && n - c < 8) || (n - r < 8 && c < 7);
    const box = (c, r) => [Math.round(c * sx), Math.round(r * sy), Math.round((c + 1) * sx) - 1, Math.round((r + 1) * sy) - 1];
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (!rows[r][c]) continue;
            const mc = c + border, mr = r + border;
            if (rounded && !is_eye(r, c)) {
                // CircleModuleDrawer: one circle the size of the module box
                draw.ellipse([mc * sx, mr * sy, (mc + 1) * sx, (mr + 1) * sy], { fill: "#000000" });
            } else if (style === SS_SEEDS_QR_STYLE__GRID && !is_eye(r, c)) {
                // GappedSquareModuleDrawer (size_ratio 0.8)
                const g = 0.1;
                draw.rectangle([(mc + g) * sx, (mr + g) * sy, (mc + 1 - g) * sx, (mr + 1 - g) * sy], { fill: "#000000" });
            } else {
                draw.rectangle(box(mc, mr), { fill: "#000000" });
            }
        }
    }
    if (rounded && n > 21) {
        // The ROUNDED style mis-renders the small lower-right registration box in 25x25
        // and 29x29; square it off as helpers/qr.py does (coordinates in 5px boxes).
        let starting_point;
        if (n === 25) starting_point = 16 + border;
        else if (n === 29) starting_point = 20 + border;
        else throw new Error(`Unrecognized qrimage size: ${n}`);
        const box_size = 5, k = width / (total * box_size), kh = height / (total * box_size);
        const sp = starting_point * box_size;
        const lines = [
            [sp, sp, sp + 5 * box_size - 1, sp + box_size - 1],                                         // top
            [sp + 4 * box_size, sp, sp + 5 * box_size - 1, sp + 5 * box_size - 1],                      // right
            [sp, sp, sp + box_size - 1, sp + 5 * box_size - 1],                                         // left
            [sp + box_size, sp + 4 * box_size, sp + 5 * box_size - 1, sp + 5 * box_size - 1],           // bottom
            [sp + 2 * box_size, sp + 2 * box_size, sp + 3 * box_size - 1, sp + 3 * box_size - 1],       // center dot
        ];
        for (const [x0, y0, x1, y1] of lines) {
            draw.rectangle([Math.round(x0 * k), Math.round(y0 * kh), Math.round((x1 + 1) * k) - 1, Math.round((y1 + 1) * kh) - 1], { fill: "#000000" });
        }
    }
    return img;
}

// QR.qrimage_io: `qrencode -l L -s 3 -m border` resized NEAREST (SIM: no qrencode binary; the
// page's QR encoder is used with square modules).
function ssSeedsQRImageIO(data, width = 240, height = 240, border = 3, background_color = "808080") {
    if (!(1 <= border && border <= 10)) border = 3;
    return ssSeedsQRImage(data, width, height, border, SS_SEEDS_QR_STYLE__DEFAULT, background_color);
}

// The engine's port of helpers/qr.py, when present, is used for display QR codes so every
// QRDisplayScreen looks the same; SeedQR transcription always uses ssSeedsQRImage.
function ssSeedsPartToImage(part, width, height, border, background_color) {
    if (typeof SSQR !== "undefined" && typeof part === "string") {
        try {
            const q = new SSQR();
            if (typeof q.qrimage_io === "function") return q.qrimage_io(part, width, height, border, background_color);
        } catch (e) { /* fall through */ }
    }
    return ssSeedsQRImageIO(part, width, height, border, background_color);
}


/* -------------------------------------------------------------------------------------
   6. models/encode_qr.py (the encoders the seed views use). Each is defined only if no
      other part already defines a class with the same name.
   ------------------------------------------------------------------------------------- */
class SSSeedsBaseQrEncoder {
    constructor(fields = {}) {
        Object.assign(this, ssSeedsFields({ qr_density: SSSettingsConstants.DENSITY__MEDIUM }, fields));
    }
    get is_complete() { throw new Error("Not implemented in child class"); }
    get qr_max_fragment_size() { throw new Error("Not implemented in child class"); }
    seq_len() { throw new Error("Not implemented in child class"); }
    next_part() { throw new Error("Not implemented in child class"); }
    cur_part() { throw new Error("Not implemented in child class"); }
    restart() { /* only used by animated QR encoders */ }
    part_to_image(part, width, height, border = 3, background_color = "ffffff") {
        return ssSeedsPartToImage(part, width, height, border, background_color);
    }
    next_part_image(width = 240, height = 240, border = 3, background_color = "bdbdbd") {
        const part = this.next_part();
        return this.part_to_image(part, width, height, border, background_color);
    }
    // JS only: async preparation (xpub derivation); views await it before showing the QR.
    async prepare() { return this; }
}

class SSSeedsSeedQrEncoder extends SSSeedsBaseQrEncoder {
    constructor(fields = {}) {
        super(ssSeedsFields({ mnemonic: null, wordlist_language_code: SSSettingsConstants.WORDLIST_LANGUAGE__ENGLISH }, fields));
        this.wordlist = SSSeed.get_wordlist(this.wordlist_language_code);
        this.data = "";
        // Output as Numeric data format
        for (const word of this.mnemonic) {
            const index = this.wordlist.indexOf(word);
            if (index < 0) throw new Error(`'${word}' is not in list`);
            this.data += String(index).padStart(4, "0");
        }
    }
    seq_len() { return 1; }
    cur_part() { return this.next_part(); }
    get is_complete() { return true; }
    next_part() { return this.data; }
}

class SSSeedsCompactSeedQrEncoder extends SSSeedsSeedQrEncoder {
    next_part() {
        // Output as binary data format
        let binary_str = "";
        for (const word of this.mnemonic) {
            const index = this.wordlist.indexOf(word);
            binary_str += index.toString(2).padStart(11, "0");
        }
        // We can exclude the checksum bits at the end
        if (this.mnemonic.length === 24) binary_str = binary_str.slice(0, -8);       // 8 checksum bits
        else if (this.mnemonic.length === 12) binary_str = binary_str.slice(0, -4);  // 4 checksum bits
        // Now convert to bytes, 8 bits at a time
        const as_bytes = [];
        for (let i = 0; i < Math.ceil(binary_str.length / 8); i++) {
            as_bytes.push(parseInt(binary_str.slice(i * 8, (i + 1) * 8), 2));
        }
        // Must return data as bytes so the QR is byte mode
        return Uint8Array.from(as_bytes);
    }
}

class SSSeedsGenericStaticQrEncoder extends SSSeedsBaseQrEncoder {
    constructor(fields = {}) {
        super(ssSeedsFields({ data: null }, fields));
    }
    seq_len() { return 1; }
    cur_part() { return this.next_part(); }
    get is_complete() { return true; }
    next_part() { return this.data; }
}

// BaseXpubQrEncoder.prep_xpub (async in JS)
async function ssSeedsPrepXpub(enc) {
    const version = enc.seed.detect_version(enc.derivation, enc.network, enc.sig_type);
    await enc.seed._ready;
    const root = await masterFromSeed(enc.seed.seed_bytes);
    enc.root_fingerprint = ssSeedsHexToBytes(await fingerprintFromSeed(enc.seed.seed_bytes));  // root.child(0).fingerprint
    enc.fingerprint = enc.root_fingerprint;
    enc.xpub = await ssSeedsGetXpub(enc.seed.seed_bytes, enc.derivation);
    enc.xpub_base58 = await enc.xpub.to_string(version);
    enc.xpubstring = "[" + ssSeedsBytesToHex(enc.fingerprint) + enc.derivation.slice(1) + "]" + enc.xpub_base58;
    return root;
}
const SS_SEEDS_XPUB_FIELDS = () => ({ seed: null, derivation: null, network: SSSettingsConstants.MAINNET, sig_type: null });

class SSSeedsStaticXpubQrEncoder extends SSSeedsBaseQrEncoder {
    constructor(fields = {}) {
        super(ssSeedsFields(SS_SEEDS_XPUB_FIELDS(), fields));
    }
    async prepare() { await ssSeedsPrepXpub(this); return this; }
    seq_len() { return 1; }
    cur_part() { return this.next_part(); }
    get is_complete() { return true; }
    next_part() {
        // Python re-runs prep_xpub() here; the result is the same string every time.
        return this.xpubstring;
    }
}

class SSSeedsBaseSimpleAnimatedQREncoder extends SSSeedsBaseQrEncoder {
    constructor(fields = {}) {
        super(fields);
        this.parts = [];
        this.part_num_sent = 0;
        this.sent_complete = false;
    }
    async prepare() { this._create_parts(); return this; }
    get is_complete() { return this.sent_complete; }
    seq_len() { return this.parts.length; }
    next_part() {
        // if part num sent is gt number of parts, start at 0
        if (this.part_num_sent > (this.parts.length - 1)) this.part_num_sent = 0;
        const part = this.parts[this.part_num_sent];
        // when parts sent eq num of parts in list
        if (this.part_num_sent === (this.parts.length - 1)) this.sent_complete = true;
        // increment to next part
        this.part_num_sent += 1;
        return part;
    }
    cur_part() {
        if (this.part_num_sent === 0) {
            // Rewind all the way back to the end
            this.part_num_sent = this.parts.length - 1;
        } else {
            this.part_num_sent -= 1;
        }
        return this.next_part();
    }
    restart() { this.part_num_sent = 0; }
}

class SSSeedsSpecterLegacyXPubQrEncoder extends SSSeedsBaseSimpleAnimatedQREncoder {
    constructor(fields = {}) {
        super(ssSeedsFields(SS_SEEDS_XPUB_FIELDS(), fields));
    }
    get qr_max_fragment_size() {
        const SC = SSSettingsConstants;
        const density_mapping = {};
        density_mapping[SC.DENSITY__LOW] = 40;
        density_mapping[SC.DENSITY__MEDIUM] = 65;
        density_mapping[SC.DENSITY__HIGH] = 90;
        return density_mapping[this.qr_density] !== undefined ? density_mapping[this.qr_density] : 65;
    }
    async prepare() {
        await ssSeedsPrepXpub(this);
        this._create_parts();
        return this;
    }
    _create_parts() {
        let start = 0;
        let stop = this.qr_max_fragment_size;
        const qr_cnt = Math.floor((this.xpubstring.length - 1) / this.qr_max_fragment_size) + 1;
        if (qr_cnt === 1) this.parts.push(this.xpubstring.slice(start, stop));
        let cnt = 0;
        while (cnt < qr_cnt && qr_cnt !== 1) {
            const part = "p" + String(cnt + 1) + "of" + String(qr_cnt) + " " + this.xpubstring.slice(start, stop);
            this.parts.push(part);
            start = start + this.qr_max_fragment_size;
            stop = stop + this.qr_max_fragment_size;
            if (stop > this.xpubstring.length) stop = this.xpubstring.length;
            cnt += 1;
        }
    }
}

/* Fountain (UR) encoders (helpers/ur2 UREncoder, written from BCR-2020-005): the message is cut into fragments of the
   length ur2's find_nominal_fragment_length picks (at least 10 bytes, at most the density's size); parts 1..seqLen
   carry one fragment each, later parts the XOR of the fragments chosen for that part number (ssUrChooseFragments in
   the scan part), as SeedSigner sends them. */
class SSSeedsBaseFountainQrEncoder extends SSSeedsBaseQrEncoder {
    constructor(fields = {}) {
        super(fields);
        this.ur_parts = null;
        this.seq_num = 0;
    }
    get qr_max_fragment_size() {
        const SC = SSSettingsConstants;
        const density_mapping = {};
        density_mapping[SC.DENSITY__LOW] = 10;
        density_mapping[SC.DENSITY__MEDIUM] = 30;
        density_mapping[SC.DENSITY__HIGH] = 120;
        return density_mapping[this.qr_density] !== undefined ? density_mapping[this.qr_density] : 30;
    }
    _ss_set_message(ur_type, cbor_bytes) {
        const msg = Array.from(cbor_bytes), min_fragment_len = 10, max_fragment_len = this.qr_max_fragment_size;
        // FountainEncoder.find_nominal_fragment_length
        let fl = null;
        for (let count = 1; count <= Math.floor(msg.length / min_fragment_len); count++) {
            fl = Math.ceil(msg.length / count);
            if (fl <= max_fragment_len) break;
        }
        if (fl === null) throw new Error("AssertionError");
        this._ur_type = ur_type;
        this._ur_msg = msg;
        this._ur_fl = fl;
        this._ur_crc = crc32(msg);
        this.ur_parts = new Array(Math.ceil(msg.length / fl)).fill(null);   // (only its length is used: seq_len)
    }
    get is_complete() { return this.seq_num >= this.seq_len(); }
    _create_parts() { /* parts are dynamically generated by the fountain encoder */ }
    seq_len() { return this.ur_parts.length; }
    // part number n (1-based): one fragment for n <= seqLen, else the XOR of the fragments chosen for n
    _ss_part(n) {
        const L = this.ur_parts.length, msg = this._ur_msg, fl = this._ur_fl, crc = this._ur_crc;
        if (L === 1) return ("ur:" + this._ur_type + "/" + bytewordsMin(msg)).toUpperCase();
        const mixed = new Array(fl).fill(0);
        for (const i of ssUrChooseFragments(n, L, crc)) for (let j = 0; j < fl; j++) mixed[j] ^= (msg[i * fl + j] || 0);
        return ("ur:" + this._ur_type + "/" + n + "-" + L + "/" + bytewordsMin(CB.arr([CB.uint(n), CB.uint(L), CB.uint(msg.length), CB.uint(crc), CB.bytes(mixed)]))).toUpperCase();
    }
    next_part() {
        this.seq_num = (this.seq_num + 1) % 0xffffffff;   // (wraps at 2^32, as ur2 does)
        return this._ss_part(this.seq_num);
    }
    cur_part() {
        if (this.seq_num === 0) return this.next_part();
        return this._ss_part(this.seq_num);
    }
    restart() { this.seq_num = 0; }
}

class SSSeedsUrXpubQrEncoder extends SSSeedsBaseFountainQrEncoder {
    constructor(fields = {}) {
        super(ssSeedsFields(SS_SEEDS_XPUB_FIELDS(), fields));
    }
    async prepare() {
        await ssSeedsPrepXpub(this);
        const my_fp = Number(ssSeedsBig(this.root_fingerprint));

        // derivation_to_keypath
        let arr = this.derivation.split("/");
        if (arr[0] === "m") arr = arr.slice(1);
        let components = [], depth = null;
        if (arr.length !== 0) {
            if (arr[arr.length - 1] === "") arr = arr.slice(0, -1);   // trailing slash
            components = arr.map((e) => {
                const last = e[e.length - 1];
                if (last === "h" || last === "'") return { index: parseInt(e.slice(0, -1), 10), hardened: true };
                return { index: parseInt(e, 10), hardened: false };
            });
            depth = components.length;
        }
        const comps = [];
        for (const pc of components) comps.push(CB.uint(pc.index), CB.bool(pc.hardened));
        const origin_pairs = [[CB.uint(1), CB.arr(comps)], [CB.uint(2), CB.uint(my_fp)]];
        if (depth !== null) origin_pairs.push([CB.uint(3), CB.uint(depth)]);
        const origin = CB.tag(304, CB.map(origin_pairs));

        // use_info: None on MAINNET, CoinInfo(type=None, network=1) otherwise
        const hdkey_pairs = [[CB.uint(3), CB.bytes(this.xpub.key)], [CB.uint(4), CB.bytes(this.xpub.chain_code)]];
        if (this.network !== SSSettingsConstants.MAINNET) hdkey_pairs.push([CB.uint(5), CB.tag(305, CB.map([[CB.uint(2), CB.uint(1)]]))]);
        hdkey_pairs.push([CB.uint(6), origin]);
        hdkey_pairs.push([CB.uint(8), CB.uint(Number(ssSeedsBig(this.xpub.fingerprint)))]);
        const ur_hdkey = CB.tag(303, CB.map(hdkey_pairs));

        // Output([...script expression tags], hdkey): outermost tag first
        const output = (tags) => tags.slice().reverse().reduce((item, t) => CB.tag(t, item), ur_hdkey);
        const ur_outputs = [];
        if (components.length > 0) {
            const c0 = components[0].index;
            if (c0 === 84) ur_outputs.push(output([404]));                  // Native Single Sig
            else if (c0 === 49) ur_outputs.push(output([400, 404]));        // Nested Single Sig
            else if (c0 === 48) {                                           // Multisig
                if (components.length >= 4) {
                    if (components[3].index === 2) ur_outputs.push(output([401]));          // Native Multisig
                    else if (components[3].index === 1) ur_outputs.push(output([400, 401])); // Nested Multisig
                }
            } else if (c0 === 86) ur_outputs.push(output([409]));           // P2TR
            else if (c0 === 44) ur_outputs.push(output([403]));             // P2PKH
            else if (c0 === 45) ur_outputs.push(output([400]));             // P2SH
        }
        // If empty, add all script types
        if (ur_outputs.length === 0) {
            ur_outputs.push(output([404]));
            ur_outputs.push(output([400, 404]));
            ur_outputs.push(output([401]));
            ur_outputs.push(output([400, 401]));
            ur_outputs.push(output([403]));
            ur_outputs.push(output([400]));
        }
        const ur_account = CB.map([[CB.uint(1), CB.uint(my_fp)], [CB.uint(2), CB.arr(ur_outputs)]]);
        this._ss_set_message("crypto-account", ur_account);
        return this;
    }
}

if (typeof SSBaseQrEncoder === "undefined") globalThis.SSBaseQrEncoder = SSSeedsBaseQrEncoder;
if (typeof SSSeedQrEncoder === "undefined") globalThis.SSSeedQrEncoder = SSSeedsSeedQrEncoder;
if (typeof SSCompactSeedQrEncoder === "undefined") globalThis.SSCompactSeedQrEncoder = SSSeedsCompactSeedQrEncoder;
if (typeof SSGenericStaticQrEncoder === "undefined") globalThis.SSGenericStaticQrEncoder = SSSeedsGenericStaticQrEncoder;
if (typeof SSStaticXpubQrEncoder === "undefined") globalThis.SSStaticXpubQrEncoder = SSSeedsStaticXpubQrEncoder;
if (typeof SSSpecterLegacyXPubQrEncoder === "undefined") globalThis.SSSpecterLegacyXPubQrEncoder = SSSeedsSpecterLegacyXPubQrEncoder;
if (typeof SSUrXpubQrEncoder === "undefined") globalThis.SSUrXpubQrEncoder = SSSeedsUrXpubQrEncoder;

// models/qr_type.py (only defined if another part has not)
if (typeof SSQRType === "undefined") {
    globalThis.SSQRType = {
        PSBT__BASE64: "psbt__base64", PSBT__SPECTER: "psbt__specter", PSBT__BASE43: "psbt__base43", PSBT__UR2: "psbt__ur2", PSBT__BBQR: "psbt__bbqr",
        SEED__SEEDQR: "seed__seedqr", SEED__COMPACTSEEDQR: "seed__compactseedqr", SEED__UR2: "seed__ur2", SEED__MNEMONIC: "seed__mnemonic",
        SEED__FOUR_LETTER_MNEMONIC: "seed__four_letter_mnemonic", SETTINGS: "settings", XPUB: "xpub", XPUB__SPECTER: "xpub__specter",
        XPUB__UR: "xpub__ur", BITCOIN_ADDRESS: "bitcoin_address", SIGN_MESSAGE: "sign_message", WALLET__SPECTER: "wallet__specter",
        WALLET__UR: "wallet__ur", WALLET__CONFIGFILE: "wallet__configfile", WALLET__GENERIC: "wallet__generic", OUTPUT__UR: "output__ur",
        ACCOUNT__UR: "account__ur", BYTES__UR: "bytes__ur", INVALID: "invalid",
    };
}


/* -------------------------------------------------------------------------------------
   7. gui/screens/seed_screens.py
   Pattern: constructor(fields) merges this class's dataclass defaults and the code that
   Python runs BEFORE super().__post_init__() into the fields; the code Python runs AFTER
   super().__post_init__() lives in _ss_post_<Class>() and runs exactly once.
   ------------------------------------------------------------------------------------- */
const SSG = () => SSGUIConstants;
const SSHB = () => SSHardwareButtonsConstants;

class SSSeedMnemonicEntryScreen extends SSBaseTopNavScreen {
    constructor(fields = {}) {
        super(ssSeedsFields({ initial_letters: null, wordlist: null }, fields));
        ssSeedsRunPost(this, SSSeedMnemonicEntryScreen, this._ss_post_SeedMnemonicEntryScreen);
    }
    __post_init__() {
        super.__post_init__();
        ssSeedsRunPost(this, SSSeedMnemonicEntryScreen, this._ss_post_SeedMnemonicEntryScreen);
    }
    _ss_post_SeedMnemonicEntryScreen() {
        const G = SSG();
        this.possible_alphabet = "abcdefghijklmnopqrstuvwxyz";

        // Measure the width required to display the longest word in the English BIP-39 wordlist.
        const matches_list_highlight_font_name = G.FIXED_WIDTH_EMPHASIS_FONT_NAME;
        const matches_list_highlight_font_size = G.get_button_font_size() + 4;
        let [left, top, right, bottom] = SSFonts.get_font(matches_list_highlight_font_name, matches_list_highlight_font_size).getbbox("mushroom", { anchor: "ls" });
        const matches_list_max_text_width = right - left;
        const matches_list_button_width = matches_list_max_text_width + 2 * G.COMPONENT_PADDING;

        // Set up the keyboard params
        this.keyboard_width = this.canvas_width - G.EDGE_PADDING - matches_list_button_width;
        const text_entry_display_y = this.top_nav.height;
        const text_entry_display_height = 30;

        this.arrow_up_is_active = false;
        this.arrow_down_is_active = false;

        // TODO: support other BIP-39 languages/charsets
        this.keyboard = new SSKeyboard({
            draw: this.image_draw,
            charset: this.possible_alphabet,
            rows: 5,
            cols: 6,
            rect: [
                G.EDGE_PADDING,
                text_entry_display_y + text_entry_display_height + 6,
                G.EDGE_PADDING + this.keyboard_width,
                this.canvas_height,
            ],
            auto_wrap: [SSKeyboard.WRAP_LEFT, SSKeyboard.WRAP_RIGHT],
        });

        this.text_entry_display = new SSTextEntryDisplay({
            canvas: this.canvas,
            rect: [
                G.EDGE_PADDING,
                text_entry_display_y,
                G.EDGE_PADDING + this.keyboard.width,
                text_entry_display_y + text_entry_display_height,
            ],
            is_centered: false,
            cur_text: this.initial_letters.join(""),
        });

        this.letters = this.initial_letters;

        // Initialize the current matches
        this.possible_words = [];
        if (this.letters.length > 1) {
            this.letters.push(" ");    // "Lock in" the last letter as if KEY_PRESS
            this.calc_possible_alphabet();
            this.keyboard.update_active_keys(this.possible_alphabet);
            this.keyboard.set_selected_key(this.letters[this.letters.length - 2]);
        } else {
            this.keyboard.set_selected_key(this.letters[this.letters.length - 1]);
        }

        this.matches_list_x = this.canvas_width - matches_list_button_width;
        this.matches_list_y = this.top_nav.height;
        this.highlighted_row_y = ssSeedsInt((this.canvas_height - G.BUTTON_HEIGHT) / 2);

        this.matches_list_highlight_button = new SSButton({
            text: "abcdefghijklmnopqrstuvwxyz",
            is_text_centered: false,
            font_name: G.FIXED_WIDTH_EMPHASIS_FONT_NAME,
            font_size: G.get_button_font_size() + 4,
            screen_x: this.matches_list_x,
            screen_y: this.highlighted_row_y,
            width: this.canvas_width - this.matches_list_x + G.COMPONENT_PADDING,
            height: ssSeedsInt(0.75 * G.BUTTON_HEIGHT),
            is_scrollable_text: false,
        });

        const arrow_button_width = G.BUTTON_HEIGHT + G.EDGE_PADDING;
        const arrow_button_height = ssSeedsInt(0.75 * G.BUTTON_HEIGHT);
        this.matches_list_up_button = new SSIconButton({
            icon_name: SSFontAwesomeIconConstants.ANGLE_UP,
            icon_size: G.ICON_INLINE_FONT_SIZE + 2,
            is_text_centered: false,
            screen_x: this.canvas_width - arrow_button_width + G.COMPONENT_PADDING,
            screen_y: this.highlighted_row_y - 3 * G.COMPONENT_PADDING - G.BUTTON_HEIGHT,
            width: arrow_button_width,
            height: arrow_button_height,
        });

        this.matches_list_down_button = new SSIconButton({
            icon_name: SSFontAwesomeIconConstants.ANGLE_DOWN,
            icon_size: G.ICON_INLINE_FONT_SIZE + 2,
            is_text_centered: false,
            screen_x: this.canvas_width - arrow_button_width + G.COMPONENT_PADDING,
            screen_y: this.highlighted_row_y + G.BUTTON_HEIGHT + 3 * G.COMPONENT_PADDING,
            width: arrow_button_width,
            height: arrow_button_height,
        });

        this.word_font = SSFonts.get_font(G.FIXED_WIDTH_EMPHASIS_FONT_NAME, G.get_button_font_size() + 4);
        [left, top, right, bottom] = this.word_font.getbbox("abcdefghijklmnopqrstuvwxyz", { anchor: "ls" });
        this.word_font_height = -1 * top;
        this.matches_list_row_height = this.word_font_height + G.COMPONENT_PADDING;
    }

    calc_possible_alphabet(new_letter = false) {
        if ((this.letters && this.letters.length > 1 && new_letter === false) || (this.letters.length > 0 && new_letter === true)) {
            const search_letters = this.letters.slice();
            if (new_letter === false) search_letters.pop();
            this.calc_possible_words();
            const letter_num = search_letters.length;
            const possible_letters = [];
            for (const word of this.possible_words) {
                if (word.length - 1 >= letter_num) possible_letters.push(word[letter_num]);
            }
            // remove duplicates and keep order
            this.possible_alphabet = Array.from(new Set(possible_letters));
        } else {
            this.possible_alphabet = "abcdefghijklmnopqrstuvwxyz";
            this.possible_words = [];
        }
    }

    calc_possible_words() {
        const prefix = this.letters.join("").trim();
        this.possible_words = this.wordlist.filter((i) => i.startsWith(prefix));
        this.selected_possible_words_index = 0;
    }

    render_possible_matches(highlight_word = null) {
        /* Internal helper method to render the KEY 1, 2, 3 word candidates. */
        const G = SSG();
        if (!this.possible_words || this.possible_words.length === 0) {
            // Clear the right panel
            this.renderer.draw.rectangle(
                [this.matches_list_x, this.top_nav.height, this.canvas_width, this.matches_list_y],
                { fill: G.BACKGROUND_COLOR }
            );
            return;
        }

        // Python renders a (W - x, canvas_height) image and pastes its crop from y=top_nav.height;
        // here the image is created already cropped and rows are drawn shifted up by that amount.
        const crop_y = this.top_nav.height;
        const img = SSImage.new("RGB", [this.canvas_width - this.matches_list_x, this.canvas_height - crop_y], G.BACKGROUND_COLOR);
        const draw = SSImageDraw.Draw(img);

        const word_indent = G.COMPONENT_PADDING;
        const highlighted_row = 3;
        const num_possible_rows = 11;

        if (!highlight_word) {
            const list_starting_index = this.selected_possible_words_index - highlighted_row;
            let row = 0;
            for (let i = list_starting_index; i < list_starting_index + num_possible_rows; i++, row++) {
                if (i < 0) continue;                            // not enough items above the highlighted row
                if (row === highlighted_row) continue;          // rendered as a Button below
                if (this.possible_words.length <= i) break;     // No more possible words to render

                if (row < highlighted_row) {
                    this.cur_y = this.highlighted_row_y - G.COMPONENT_PADDING - (highlighted_row - row - 1) * this.matches_list_row_height;
                } else if (row > highlighted_row) {
                    this.cur_y = this.highlighted_row_y + this.matches_list_highlight_button.height + (row - highlighted_row) * this.matches_list_row_height;
                }

                draw.text([word_indent, this.cur_y - crop_y], this.possible_words[i], {
                    fill: "#ddd",
                    font: this.word_font,
                    anchor: "ls",
                });
            }
        }

        this.canvas.paste(img, [this.matches_list_x, this.matches_list_y]);

        // Now render the buttons over the matches list
        this.matches_list_highlight_button.text = this.possible_words[this.selected_possible_words_index];
        this.matches_list_highlight_button.is_selected = true;
        this.matches_list_highlight_button.render();

        this.matches_list_up_button.render();
        this.matches_list_down_button.render();
    }

    _render() {
        super._render();
        this.keyboard.render_keys();
        this.text_entry_display.render();
        this.render_possible_matches();
        this.renderer.show_image();
    }

    async _run() {
        const HB = SSHB();
        const KB = SSKeyboard;
        for (;;) {
            let input = await ssSeedsWaitFor(this, HB.ALL_KEYS);

            if (this.is_input_in_top_nav) {
                if (input === HB.KEY_PRESS) {
                    // User clicked the "back" arrow
                    return SS_RET_CODE__BACK_BUTTON;
                } else if (input === HB.KEY_UP) {
                    input = KB.ENTER_BOTTOM;
                    this.is_input_in_top_nav = false;
                    // Re-render it without the highlight
                    this.top_nav.left_button.is_selected = false;
                    this.top_nav.left_button.render();
                } else if (input === HB.KEY_DOWN) {
                    input = KB.ENTER_TOP;
                    this.is_input_in_top_nav = false;
                    this.top_nav.left_button.is_selected = false;
                    this.top_nav.left_button.render();
                } else if (input === HB.KEY_RIGHT || input === HB.KEY_LEFT) {
                    // no action in this context
                    continue;
                }
            }

            const ret_val = this.keyboard.update_from_input(input);

            if (ssSeedsIn(ret_val, KB.EXIT_DIRECTIONS)) {
                this.is_input_in_top_nav = true;
                this.top_nav.left_button.is_selected = true;
                this.top_nav.left_button.render();
            } else if (ssSeedsIn(ret_val, KB.ADDITIONAL_KEYS)) {
                if (input === HB.KEY_PRESS && ret_val === KB.KEY_BACKSPACE["code"]) {
                    this.letters = this.letters.slice(0, -2);
                    this.letters.push(" ");

                    // Reactivate keys after deleting last letter
                    this.calc_possible_alphabet();
                    this.keyboard.update_active_keys(this.possible_alphabet);
                    this.keyboard.render_keys();

                    // Update the right-hand possible matches area
                    this.render_possible_matches();
                } else if (ret_val === KB.KEY_BACKSPACE["code"]) {
                    // We're just hovering over DEL but haven't clicked. Show blank (" ")
                    //   in the live text entry display at the top.
                    this.letters = this.letters.slice(0, -1);
                    this.letters.push(" ");
                }
            }

            // Has the user made a final selection of a candidate word?
            let final_selection = null;
            if (input === HB.KEY1 && this.possible_words.length) {
                // Scroll the list up
                this.selected_possible_words_index -= 1;
                if (this.selected_possible_words_index < 0) this.selected_possible_words_index = 0;

                if (!this.arrow_up_is_active) {
                    // Flash the up arrow as selected
                    this.arrow_up_is_active = true;
                    this.matches_list_up_button.is_selected = true;
                }
            } else if (input === HB.KEY2) {
                if (this.possible_words.length) {
                    final_selection = this.possible_words[this.selected_possible_words_index];
                }
            } else if (input === HB.KEY3 && this.possible_words.length) {
                // Scroll the list down
                this.selected_possible_words_index += 1;
                if (this.selected_possible_words_index >= this.possible_words.length) {
                    this.selected_possible_words_index = this.possible_words.length - 1;
                }
                if (!this.arrow_down_is_active) {
                    // Flash the down arrow as selected
                    this.arrow_down_is_active = true;
                    this.matches_list_down_button.is_selected = true;
                }
            }

            if (input !== HB.KEY1 && this.arrow_up_is_active) {
                // Deactivate the UP arrow and redraw
                this.arrow_up_is_active = false;
                this.matches_list_up_button.is_selected = false;
            }

            if (input !== HB.KEY3 && this.arrow_down_is_active) {
                // Deactivate the DOWN arrow and redraw
                this.arrow_down_is_active = false;
                this.matches_list_down_button.is_selected = false;
            }

            if (final_selection) {
                // Animate the selection storage, then return the word to the caller
                this.letters = (final_selection + " ").split("");
                this.render_possible_matches(final_selection);
                this.text_entry_display.cur_text = this.letters.join("");
                this.text_entry_display.render();
                this.renderer.show_image();

                return final_selection;
            } else if (input === HB.KEY_PRESS && ssSeedsIn(ret_val, this.possible_alphabet)) {
                // User has locked in the current letter
                if (this.letters[this.letters.length - 1] !== " ") {
                    // Save that locked in letter next; for now show a blank (" ") so the
                    // matches are not calculated against a second copy of the letter.
                    this.letters.push(" ");
                } else {
                    // clicked same letter twice in a row: replace the trailing space with
                    // the repeated letter and then append a trailing blank.
                    this.letters = this.letters.slice(0, -1);
                    this.letters.push(ret_val);
                    this.letters.push(" ");
                }

                // Recalc and deactivate keys after advancing
                this.calc_possible_alphabet();
                this.keyboard.update_active_keys(this.possible_alphabet);

                if (this.possible_alphabet.length === 1) {
                    // If there's only one possible letter left, select it
                    this.keyboard.set_selected_key(this.possible_alphabet[0]);
                }

                this.keyboard.render_keys();
            } else if (ssSeedsIn(input, HB.KEYS__LEFT_RIGHT_UP_DOWN) || input === KB.ENTER_TOP || input === KB.ENTER_BOTTOM) {
                if (ssSeedsIn(ret_val, this.possible_alphabet)) {
                    // Live joystick movement; haven't locked this new letter in yet.
                    this.letters = this.letters.slice(0, -1);
                    this.letters.push(ret_val);
                    this.calc_possible_words();  // live update our matches as we move
                } else {
                    // We've navigated to a deactivated letter
                }
            }

            // Render the text entry display and cursor block
            this.text_entry_display.cur_text = this.letters.join("");
            this.text_entry_display.render();

            // Update the right-hand possible matches area
            this.render_possible_matches();

            // Now issue one call to send the pixels to the screen
            this.renderer.show_image();
        }
    }
}


class SSSeedFinalizeScreen extends SSButtonListScreen {
    constructor(fields = {}) {
        const f = ssSeedsFields({ fingerprint: null, is_bottom_list: true, button_data: null }, fields);
        f.show_back_button = false;
        f.title = "Finalize Seed";
        super(f);
        ssSeedsRunPost(this, SSSeedFinalizeScreen, this._ss_post_SeedFinalizeScreen);
    }
    __post_init__() {
        this.show_back_button = false;
        this.title = "Finalize Seed";
        super.__post_init__();
        ssSeedsRunPost(this, SSSeedFinalizeScreen, this._ss_post_SeedFinalizeScreen);
    }
    _ss_post_SeedFinalizeScreen() {
        const G = SSG();
        this.fingerprint_icontl = new SSIconTextLine({
            icon_name: SSSeedSignerIconConstants.FINGERPRINT,
            icon_color: G.INFO_COLOR,
            icon_size: G.ICON_FONT_SIZE + 12,
            label_text: "fingerprint",
            value_text: this.fingerprint,
            font_size: G.get_body_font_size() + 2,
            is_text_centered: true,
            screen_y: this.top_nav.height + ssSeedsInt((this.buttons[0].screen_y - this.top_nav.height) / 2) - 30,
        });
        this.components.push(this.fingerprint_icontl);
    }
}


class SSSeedOptionsScreen extends SSButtonListScreen {
    constructor(fields = {}) {
        const f = ssSeedsFields({ fingerprint: null }, fields);
        f.top_nav_icon_name = SSSeedSignerIconConstants.FINGERPRINT;
        f.top_nav_icon_color = SSG().INFO_COLOR;
        f.title = f.fingerprint;
        f.is_button_text_centered = false;
        f.is_bottom_list = true;
        super(f);
    }
    __post_init__() {
        this.top_nav_icon_name = SSSeedSignerIconConstants.FINGERPRINT;
        this.top_nav_icon_color = SSG().INFO_COLOR;
        this.title = this.fingerprint;
        this.is_button_text_centered = false;
        this.is_bottom_list = true;
        super.__post_init__();
    }
}


class SSSeedWordsScreen extends ssSeedsWarningEdgesMixin(SSButtonListScreen) {
    constructor(fields = {}) {
        const f = ssSeedsFields({ words: null, page_index: 0, num_pages: 3, is_bottom_list: true, status_color: SSG().DIRE_WARNING_COLOR }, fields);
        // Displays the page number and total: (e.g. page 1 of 6)
        f.title = `Seed Words: ${f.page_index + 1}/${f.num_pages}`;
        super(f);
        ssSeedsRunPost(this, SSSeedWordsScreen, this._ss_post_SeedWordsScreen);
    }
    __post_init__() {
        this.title = `Seed Words: ${this.page_index + 1}/${this.num_pages}`;
        super.__post_init__();
        ssSeedsRunPost(this, SSSeedWordsScreen, this._ss_post_SeedWordsScreen);
    }
    _ss_post_SeedWordsScreen() {
        const G = SSG();
        const words_per_page = this.words.length;

        this.body_x = 0;
        this.body_y = this.top_nav.height - ssSeedsInt(G.COMPONENT_PADDING / 2);
        this.body_height = this.buttons[0].screen_y - this.body_y;

        // Have to supersample the whole body since it's all at the small font size
        const supersampling_factor = 1;
        const font = SSFonts.get_font(G.get_body_font_name(), (G.get_top_nav_title_font_size() + 2) * supersampling_factor);

        // Calc horizontal center based on longest word
        let max_word_width = 0;
        for (const word of this.words) {
            const [, , right] = font.getbbox(word, { anchor: "ls" });
            if (right > max_word_width) max_word_width = right;
        }

        // Measure the max digit height for the numbering boxes, from baseline
        const number_font = SSFonts.get_font(G.get_body_font_name(), G.get_button_font_size() * supersampling_factor);
        const [, top, right] = number_font.getbbox("24", { anchor: "ls" });
        const number_height = -1 * top;
        const number_width = right;
        const number_box_width = number_width + ssSeedsInt(G.COMPONENT_PADDING / 2 * supersampling_factor);
        const number_box_height = number_box_width;

        const number_box_x = ssSeedsInt(this.canvas_width * supersampling_factor - number_box_width - G.COMPONENT_PADDING * supersampling_factor - max_word_width) / 2;
        let number_box_y = G.COMPONENT_PADDING * supersampling_factor;

        // Set up our temp supersampled rendering surface
        this.body_img = SSImage.new("RGB", [this.canvas_width * supersampling_factor, this.body_height * supersampling_factor], G.BACKGROUND_COLOR);
        const draw = SSImageDraw.Draw(this.body_img);

        this.words.forEach((word, index) => {
            draw.rounded_rectangle(
                [number_box_x, number_box_y, number_box_x + number_box_width, number_box_y + number_box_height],
                { fill: G.BUTTON_BACKGROUND_COLOR, radius: 5 * supersampling_factor }
            );
            const baseline_y = number_box_y + number_box_height - ssSeedsInt((number_box_height - number_height) / 2);
            draw.text(
                [number_box_x + ssSeedsInt(number_box_width / 2), baseline_y],
                String(this.page_index * words_per_page + index + 1),
                { font: number_font, fill: G.INFO_COLOR, anchor: "ms" }  // Middle (centered), baSeline
            );

            // Now draw the word
            draw.text(
                [number_box_x + number_box_width + (G.COMPONENT_PADDING * supersampling_factor), baseline_y],
                word,
                { font: font, fill: G.BODY_FONT_COLOR, anchor: "ls" }  // Left, baSeline
            );

            number_box_y += number_box_height + (ssSeedsInt(1.5 * G.COMPONENT_PADDING) * supersampling_factor);
        });

        // Python: resize (no-op at supersampling 1) + ImageFilter.SHARPEN.
        // SIM: the SHARPEN filter is not applied (no per-pixel filter in the drawing layer).
        this.paste_images.push([this.body_img, [this.body_x, this.body_y]]);
    }
}


class SSSeedBIP85SelectChildIndexScreen extends SSKeyboardScreen {
    constructor(fields = {}) {
        const f = ssSeedsFields({}, fields);
        f.title = "BIP-85 Index";
        f.user_input = "";
        // Specify the keys in the keyboard
        f.rows = 3;
        f.cols = 5;
        f.keys_charset = "0123456789";
        f.show_save_button = true;
        super(f);
    }
    __post_init__() {
        this.title = "BIP-85 Index";
        this.user_input = "";
        this.rows = 3;
        this.cols = 5;
        this.keys_charset = "0123456789";
        this.show_save_button = true;
        super.__post_init__();
    }
}


class SSSeedWordsBackupTestPromptScreen extends SSButtonListScreen {
    constructor(fields = {}) {
        const f = ssSeedsFields({}, fields);
        f.title = "Verify Backup?";
        f.show_back_button = false;
        f.is_bottom_list = true;
        super(f);
        ssSeedsRunPost(this, SSSeedWordsBackupTestPromptScreen, this._ss_post_SeedWordsBackupTestPromptScreen);
    }
    __post_init__() {
        this.title = "Verify Backup?";
        this.show_back_button = false;
        this.is_bottom_list = true;
        super.__post_init__();
        ssSeedsRunPost(this, SSSeedWordsBackupTestPromptScreen, this._ss_post_SeedWordsBackupTestPromptScreen);
    }
    _ss_post_SeedWordsBackupTestPromptScreen() {
        this.components.push(new SSTextArea({
            text: "Optionally verify that your mnemonic backup is correct.",
            screen_y: this.top_nav.height,
            is_text_centered: true,
        }));
    }
}


class SSSeedExportXpubCustomDerivationScreen extends SSKeyboardScreen {
    constructor(fields = {}) {
        const f = ssSeedsFields({}, fields);
        f.title = "Derivation Path";
        f.user_input = "m/";
        // Specify the keys in the keyboard
        f.rows = 3;
        f.cols = 6;
        f.keys_charset = "/'0123456789";
        f.show_save_button = true;
        super(f);
    }
    __post_init__() {
        this.title = "Derivation Path";
        this.user_input = "m/";
        this.rows = 3;
        this.cols = 6;
        this.keys_charset = "/'0123456789";
        this.show_save_button = true;
        super.__post_init__();
    }
}


class SSSeedExportXpubDetailsScreen extends ssSeedsWarningEdgesMixin(SSButtonListScreen) {
    constructor(fields = {}) {
        const f = ssSeedsFields({ is_bottom_list: true, fingerprint: null, derivation_path: "m/84'/0'/0'", xpub: "zpub6r..." }, fields);
        // Programmatically set up other args
        f.button_data = [ssSeedsButtonOption({ button_label: "Export xpub" })];
        f.title = "Xpub Details";
        super(f);
        ssSeedsRunPost(this, SSSeedExportXpubDetailsScreen, this._ss_post_SeedExportXpubDetailsScreen);
    }
    __post_init__() {
        if (!this.button_data || this.button_data.length !== 1 || this.button_data[0].button_label !== "Export xpub") {
            this.button_data = [ssSeedsButtonOption({ button_label: "Export xpub" })];
        }
        this.title = "Xpub Details";
        super.__post_init__();
        ssSeedsRunPost(this, SSSeedExportXpubDetailsScreen, this._ss_post_SeedExportXpubDetailsScreen);
    }
    _ss_post_SeedExportXpubDetailsScreen() {
        const G = SSG();
        // Set up the fingerprint and passphrase displays
        this.fingerprint_line = new SSIconTextLine({
            icon_name: SSSeedSignerIconConstants.FINGERPRINT,
            icon_color: G.INFO_COLOR,
            // Short for "BIP-32 Master Fingerprint"
            label_text: "Fingerprint",
            value_text: this.fingerprint,
            screen_x: G.COMPONENT_PADDING,
            screen_y: this.top_nav.height + G.COMPONENT_PADDING,
        });
        this.components.push(this.fingerprint_line);

        let last = this.components[this.components.length - 1];
        this.derivation_line = new SSIconTextLine({
            icon_name: SSSeedSignerIconConstants.DERIVATION,
            icon_color: G.INFO_COLOR,
            // Short for "Derivation Path"
            label_text: "Derivation",
            value_text: this.derivation_path,
            screen_x: G.COMPONENT_PADDING,
            screen_y: last.screen_y + last.height + ssSeedsInt(1.5 * G.COMPONENT_PADDING),
        });
        this.components.push(this.derivation_line);

        const font_name = G.FIXED_WIDTH_FONT_NAME;
        const font_size = G.get_body_font_size() + 2;
        const [left, , right] = SSFonts.get_font(font_name, font_size).getbbox("X");
        const char_width = right - left;
        const num_chars = ssSeedsInt((this.canvas_width - G.ICON_FONT_SIZE - 2 * G.COMPONENT_PADDING) / char_width) - 3;  // ellipsis

        last = this.components[this.components.length - 1];
        this.xpub_line = new SSIconTextLine({
            icon_name: SSFontAwesomeIconConstants.X,
            icon_color: G.INFO_COLOR,
            label_text: "Xpub",
            value_text: `${this.xpub.slice(0, Math.max(0, num_chars))}...`,
            font_name: G.FIXED_WIDTH_FONT_NAME,
            font_size: G.get_body_font_size() + 2,
            screen_x: G.COMPONENT_PADDING,
            screen_y: last.screen_y + last.height + ssSeedsInt(1.5 * G.COMPONENT_PADDING),
        });
        this.components.push(this.xpub_line);
    }
}


class SSSeedAddPassphraseScreen extends SSBaseTopNavScreen {
    constructor(fields = {}) {
        const f = ssSeedsFields({ passphrase: "", initial_keyboard: null }, fields);
        f.title = "BIP-39 Passphrase";
        super(f);
        ssSeedsRunPost(this, SSSeedAddPassphraseScreen, this._ss_post_SeedAddPassphraseScreen);
    }
    __post_init__() {
        // Python sets title = "BIP-39 Passphrase" here; the View's `title` kwarg is overwritten.
        this.title = "BIP-39 Passphrase";
        super.__post_init__();
        ssSeedsRunPost(this, SSSeedAddPassphraseScreen, this._ss_post_SeedAddPassphraseScreen);
    }
    _ss_post_SeedAddPassphraseScreen() {
        const G = SSG();
        const KB = SSKeyboard;
        const keys_lower = "abcdefghijklmnopqrstuvwxyz";
        const keys_upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const keys_number = "0123456789";

        // Present the most common/puncutation-related symbols & the most human-friendly
        //   symbols first (limited to 18 chars).
        const keys_symbol_1 = "!@#$%&();:,.-+='\"?";

        // Isolate the more math-oriented or just uncommon symbols
        const keys_symbol_2 = "^*[]{}_\\|<>/`~";

        // Set up the keyboard params
        this.right_panel_buttons_width = 56;

        const max_cols = 9;
        const text_entry_display_y = this.top_nav.height;
        const text_entry_display_height = 30;

        const keyboard_start_y = text_entry_display_y + text_entry_display_height + G.COMPONENT_PADDING;
        const rect = () => [
            G.COMPONENT_PADDING,
            keyboard_start_y,
            this.canvas_width - G.COMPONENT_PADDING - this.right_panel_buttons_width,
            this.canvas_height - G.EDGE_PADDING,
        ];
        this.keyboard_abc = new SSKeyboard({
            draw: this.renderer.draw,
            charset: keys_lower,
            rows: 4,
            cols: max_cols,
            rect: rect(),
            additional_keys: [KB.KEY_SPACE_5, KB.KEY_CURSOR_LEFT, KB.KEY_CURSOR_RIGHT, KB.KEY_BACKSPACE],
            auto_wrap: [KB.WRAP_LEFT, KB.WRAP_RIGHT],
        });

        this.keyboard_ABC = new SSKeyboard({
            draw: this.renderer.draw,
            charset: keys_upper,
            rows: 4,
            cols: max_cols,
            rect: rect(),
            additional_keys: [KB.KEY_SPACE_5, KB.KEY_CURSOR_LEFT, KB.KEY_CURSOR_RIGHT, KB.KEY_BACKSPACE],
            auto_wrap: [KB.WRAP_LEFT, KB.WRAP_RIGHT],
            render_now: false,
        });

        this.keyboard_digits = new SSKeyboard({
            draw: this.renderer.draw,
            charset: keys_number,
            rows: 3,
            cols: 5,
            rect: rect(),
            additional_keys: [KB.KEY_CURSOR_LEFT, KB.KEY_CURSOR_RIGHT, KB.KEY_BACKSPACE],
            auto_wrap: [KB.WRAP_LEFT, KB.WRAP_RIGHT],
            render_now: false,
        });

        this.keyboard_symbols_1 = new SSKeyboard({
            draw: this.renderer.draw,
            charset: keys_symbol_1,
            rows: 4,
            cols: 6,
            rect: rect(),
            additional_keys: [KB.KEY_SPACE_2, KB.KEY_CURSOR_LEFT, KB.KEY_CURSOR_RIGHT, KB.KEY_BACKSPACE],
            auto_wrap: [KB.WRAP_LEFT, KB.WRAP_RIGHT],
            render_now: false,
        });

        this.keyboard_symbols_2 = new SSKeyboard({
            draw: this.renderer.draw,
            charset: keys_symbol_2,
            rows: 4,
            cols: 6,
            rect: rect(),
            additional_keys: [KB.KEY_SPACE_2, KB.KEY_CURSOR_LEFT, KB.KEY_CURSOR_RIGHT, KB.KEY_BACKSPACE],
            auto_wrap: [KB.WRAP_LEFT, KB.WRAP_RIGHT],
            render_now: false,
        });

        this.text_entry_display = new SSTextEntryDisplay({
            canvas: this.renderer.canvas,
            rect: [
                G.EDGE_PADDING,
                text_entry_display_y,
                this.canvas_width - this.right_panel_buttons_width,
                text_entry_display_y + text_entry_display_height,
            ],
            cursor_mode: SSTextEntryDisplay.CURSOR_MODE__BAR,
            is_centered: false,
            cur_text: this.passphrase,
        });

        // Nudge the buttons off the right edge w/padding
        const hw_button_x = this.canvas_width - this.right_panel_buttons_width + G.COMPONENT_PADDING;

        // Calc center button position first
        const hw_button_y = ssSeedsInt((this.canvas_height - G.BUTTON_HEIGHT) / 2);

        this.hw_button1 = new SSButton({
            text: SSSeedAddPassphraseScreen.KEYBOARD__UPPERCASE_BUTTON_TEXT,
            is_text_centered: false,
            font_name: G.FIXED_WIDTH_EMPHASIS_FONT_NAME,
            font_size: G.get_button_font_size() + 4,
            width: this.right_panel_buttons_width,
            screen_x: hw_button_x,
            screen_y: hw_button_y - 3 * G.COMPONENT_PADDING - G.BUTTON_HEIGHT,
            is_scrollable_text: false,
        });

        this.hw_button2 = new SSButton({
            text: SSSeedAddPassphraseScreen.KEYBOARD__DIGITS_BUTTON_TEXT,
            is_text_centered: false,
            font_name: G.FIXED_WIDTH_EMPHASIS_FONT_NAME,
            font_size: G.get_button_font_size() + 4,
            width: this.right_panel_buttons_width,
            screen_x: hw_button_x,
            screen_y: hw_button_y,
            is_scrollable_text: false,
        });

        this.hw_button3 = new SSIconButton({
            icon_name: SSSeedSignerIconConstants.CHECK,
            icon_color: G.SUCCESS_COLOR,
            width: this.right_panel_buttons_width,
            screen_x: hw_button_x,
            screen_y: hw_button_y + 3 * G.COMPONENT_PADDING + G.BUTTON_HEIGHT,
            is_scrollable_text: false,
        });
    }

    _render() {
        super._render();
        const C = SSSeedAddPassphraseScreen;
        let cur_keyboard;
        // Change from the default lowercase keyboard for the screenshot generator
        if (this.initial_keyboard === C.KEYBOARD__UPPERCASE_BUTTON_TEXT) {
            cur_keyboard = this.keyboard_ABC;
            this.hw_button1.text = C.KEYBOARD__LOWERCASE_BUTTON_TEXT;
        } else if (this.initial_keyboard === C.KEYBOARD__DIGITS_BUTTON_TEXT) {
            cur_keyboard = this.keyboard_digits;
            this.hw_button2.text = C.KEYBOARD__SYMBOLS_1_BUTTON_TEXT;
        } else if (this.initial_keyboard === C.KEYBOARD__SYMBOLS_1_BUTTON_TEXT) {
            cur_keyboard = this.keyboard_symbols_1;
            this.hw_button2.text = C.KEYBOARD__SYMBOLS_2_BUTTON_TEXT;
        } else if (this.initial_keyboard === C.KEYBOARD__SYMBOLS_2_BUTTON_TEXT) {
            cur_keyboard = this.keyboard_symbols_2;
            this.hw_button2.text = C.KEYBOARD__DIGITS_BUTTON_TEXT;
        } else {
            cur_keyboard = this.keyboard_abc;
        }

        this.text_entry_display.render();
        this.hw_button1.render();
        this.hw_button2.render();
        this.hw_button3.render();
        cur_keyboard.render_keys();

        this.renderer.show_image();
    }

    async _run() {
        const HB = SSHB();
        const KB = SSKeyboard;
        const C = SSSeedAddPassphraseScreen;
        let cursor_position = this.passphrase.length;
        let cur_keyboard = this.keyboard_abc;
        let cur_button1_text = C.KEYBOARD__UPPERCASE_BUTTON_TEXT;
        let cur_button2_text = C.KEYBOARD__DIGITS_BUTTON_TEXT;

        // Start the interactive update loop
        for (;;) {
            let input = await ssSeedsWaitFor(this, HB.ALL_KEYS);
            let keyboard_swap = false;
            let ret_val;

            // Check our two possible exit conditions
            if (input === HB.KEY3) {
                // Save! First light up key3
                this.hw_button3.is_selected = true;
                this.hw_button3.render();
                this.renderer.show_image();
                return { passphrase: this.passphrase };
            } else if (input === HB.KEY_PRESS && this.top_nav.is_selected) {
                // Back button clicked
                return { passphrase: this.passphrase, is_back_button: true };
            }

            // Check for keyboard swaps
            if (input === HB.KEY1) {
                // First light up key1
                this.hw_button1.is_selected = true;
                this.hw_button1.render();

                // Return to the same button2 keyboard, if applicable
                if (cur_keyboard === this.keyboard_digits) cur_button2_text = C.KEYBOARD__DIGITS_BUTTON_TEXT;
                else if (cur_keyboard === this.keyboard_symbols_1) cur_button2_text = C.KEYBOARD__SYMBOLS_1_BUTTON_TEXT;
                else if (cur_keyboard === this.keyboard_symbols_2) cur_button2_text = C.KEYBOARD__SYMBOLS_2_BUTTON_TEXT;

                if (cur_button1_text === C.KEYBOARD__LOWERCASE_BUTTON_TEXT) {
                    this.keyboard_abc.set_selected_key_indices(cur_keyboard.selected_key["x"], cur_keyboard.selected_key["y"]);
                    cur_keyboard = this.keyboard_abc;
                    cur_button1_text = C.KEYBOARD__UPPERCASE_BUTTON_TEXT;
                } else {
                    this.keyboard_ABC.set_selected_key_indices(cur_keyboard.selected_key["x"], cur_keyboard.selected_key["y"]);
                    cur_keyboard = this.keyboard_ABC;
                    cur_button1_text = C.KEYBOARD__LOWERCASE_BUTTON_TEXT;
                }
                cur_keyboard.render_keys();

                // Show the changes; this loop will have two renders
                this.renderer.show_image();

                keyboard_swap = true;
                ret_val = null;
            } else if (input === HB.KEY2) {
                // First light up key2
                this.hw_button2.is_selected = true;
                this.hw_button2.render();
                this.renderer.show_image();

                // And reset for next redraw
                this.hw_button2.is_selected = false;

                // Return to the same button1 keyboard, if applicable
                if (cur_keyboard === this.keyboard_abc) cur_button1_text = C.KEYBOARD__LOWERCASE_BUTTON_TEXT;
                else if (cur_keyboard === this.keyboard_ABC) cur_button1_text = C.KEYBOARD__UPPERCASE_BUTTON_TEXT;

                if (cur_button2_text === C.KEYBOARD__DIGITS_BUTTON_TEXT) {
                    this.keyboard_digits.set_selected_key_indices(cur_keyboard.selected_key["x"], cur_keyboard.selected_key["y"]);
                    cur_keyboard = this.keyboard_digits;
                    cur_keyboard.render_keys();
                    cur_button2_text = C.KEYBOARD__SYMBOLS_1_BUTTON_TEXT;
                } else if (cur_button2_text === C.KEYBOARD__SYMBOLS_1_BUTTON_TEXT) {
                    this.keyboard_symbols_1.set_selected_key_indices(cur_keyboard.selected_key["x"], cur_keyboard.selected_key["y"]);
                    cur_keyboard = this.keyboard_symbols_1;
                    cur_keyboard.render_keys();
                    cur_button2_text = C.KEYBOARD__SYMBOLS_2_BUTTON_TEXT;
                } else if (cur_button2_text === C.KEYBOARD__SYMBOLS_2_BUTTON_TEXT) {
                    this.keyboard_symbols_2.set_selected_key_indices(cur_keyboard.selected_key["x"], cur_keyboard.selected_key["y"]);
                    cur_keyboard = this.keyboard_symbols_2;
                    cur_keyboard.render_keys();
                    cur_button2_text = C.KEYBOARD__DIGITS_BUTTON_TEXT;
                }
                cur_keyboard.render_keys();

                // Show the changes; this loop will have two renders
                this.renderer.show_image();

                keyboard_swap = true;
                ret_val = null;
            } else {
                // Process normal input
                if ((input === HB.KEY_UP || input === HB.KEY_DOWN) && this.top_nav.is_selected) {
                    // We're navigating off the previous button
                    this.top_nav.is_selected = false;
                    this.top_nav.render_buttons();

                    // Override the actual input w/an ENTER signal for the Keyboard
                    if (input === HB.KEY_DOWN) input = KB.ENTER_TOP;
                    else input = KB.ENTER_BOTTOM;
                } else if ((input === HB.KEY_LEFT || input === HB.KEY_RIGHT) && this.top_nav.is_selected) {
                    // ignore
                    continue;
                }

                ret_val = cur_keyboard.update_from_input(input);
            }

            // Now process the result from the keyboard
            if (ssSeedsIn(ret_val, KB.EXIT_DIRECTIONS)) {
                this.top_nav.is_selected = true;
                this.top_nav.render_buttons();
            } else if (ssSeedsIn(ret_val, KB.ADDITIONAL_KEYS) && input === HB.KEY_PRESS) {
                if (ret_val === KB.KEY_BACKSPACE["code"]) {
                    if (cursor_position === 0) {
                        // pass
                    } else if (cursor_position === this.passphrase.length) {
                        this.passphrase = this.passphrase.slice(0, -1);
                        cursor_position -= 1;
                    } else {
                        this.passphrase = this.passphrase.slice(0, cursor_position - 1) + this.passphrase.slice(cursor_position);
                        cursor_position -= 1;
                    }
                } else if (ret_val === KB.KEY_CURSOR_LEFT["code"]) {
                    cursor_position -= 1;
                    if (cursor_position < 0) cursor_position = 0;
                } else if (ret_val === KB.KEY_CURSOR_RIGHT["code"]) {
                    cursor_position += 1;
                    if (cursor_position > this.passphrase.length) cursor_position = this.passphrase.length;
                } else if (ret_val === KB.KEY_SPACE["code"]) {
                    if (cursor_position === this.passphrase.length) this.passphrase += " ";
                    else this.passphrase = this.passphrase.slice(0, cursor_position) + " " + this.passphrase.slice(cursor_position);
                    cursor_position += 1;
                }

                // Update the text entry display and cursor
                this.text_entry_display.render(this.passphrase, cursor_position);
            } else if (input === HB.KEY_PRESS && !ssSeedsIn(ret_val, KB.ADDITIONAL_KEYS)) {
                // User has locked in the current letter
                if (cursor_position === this.passphrase.length) this.passphrase += ret_val;
                else this.passphrase = this.passphrase.slice(0, cursor_position) + ret_val + this.passphrase.slice(cursor_position);
                cursor_position += 1;

                // Update the text entry display and cursor
                this.text_entry_display.render(this.passphrase, cursor_position);
            } else if (ssSeedsIn(input, HB.KEYS__LEFT_RIGHT_UP_DOWN) || keyboard_swap) {
                // Live joystick movement; haven't locked this new letter in yet.
            }

            if (keyboard_swap) {
                // Show the hw buttons' updated text and not active state
                this.hw_button1.text = cur_button1_text;
                this.hw_button2.text = cur_button2_text;
                this.hw_button1.is_selected = false;
                this.hw_button2.is_selected = false;
                this.hw_button1.render();
                this.hw_button2.render();
            }

            this.renderer.show_image();
        }
    }
}
SSSeedAddPassphraseScreen.KEYBOARD__LOWERCASE_BUTTON_TEXT = "abc";
SSSeedAddPassphraseScreen.KEYBOARD__UPPERCASE_BUTTON_TEXT = "ABC";
SSSeedAddPassphraseScreen.KEYBOARD__DIGITS_BUTTON_TEXT = "123";
SSSeedAddPassphraseScreen.KEYBOARD__SYMBOLS_1_BUTTON_TEXT = "!@#";
SSSeedAddPassphraseScreen.KEYBOARD__SYMBOLS_2_BUTTON_TEXT = "*[]";


class SSSeedReviewPassphraseScreen extends SSButtonListScreen {
    constructor(fields = {}) {
        const f = ssSeedsFields({ fingerprint_without: null, fingerprint_with: null, passphrase: null }, fields);
        f.title = "Verify Passphrase";
        f.is_bottom_list = true;
        super(f);
        ssSeedsRunPost(this, SSSeedReviewPassphraseScreen, this._ss_post_SeedReviewPassphraseScreen);
    }
    __post_init__() {
        // Customize defaults
        this.title = "Verify Passphrase";
        this.is_bottom_list = true;
        super.__post_init__();
        ssSeedsRunPost(this, SSSeedReviewPassphraseScreen, this._ss_post_SeedReviewPassphraseScreen);
    }
    _ss_post_SeedReviewPassphraseScreen() {
        const G = SSG();
        this.components.push(new SSIconTextLine({
            icon_name: SSSeedSignerIconConstants.FINGERPRINT,
            icon_color: G.INFO_COLOR,
            // Describes the effect of applying a BIP-39 passphrase; it changes the seed's fingerprint
            label_text: "changes fingerprint",
            value_text: `${this.fingerprint_without} >> ${this.fingerprint_with}`,
            is_text_centered: true,
            screen_y: this.buttons[0].screen_y - G.COMPONENT_PADDING - ssSeedsInt(G.get_body_font_size() * 2.5),
        }));

        if (this.passphrase !== this.passphrase.trim() || this.passphrase.includes("  ")) {
            this.passphrase = this.passphrase.split(" ").join("▉");
        }
        const available_height = this.components[this.components.length - 1].screen_y - this.top_nav.height + G.COMPONENT_PADDING;
        const max_font_size = G.get_top_nav_title_font_size() + 8;
        const min_font_size = G.get_top_nav_title_font_size() - 4;
        let font_size = max_font_size;
        const max_lines = 3;
        let passphrase = [this.passphrase];
        let found_solution = false;
        let char_width, char_height, num_lines;
        // Python `for font_size in range(max, min, -2)`: the loop variable advances once more
        // before the `if found_solution: break`, exactly as below.
        for (let fs = max_font_size; fs > min_font_size; fs -= 2) {
            font_size = fs;
            if (found_solution) break;
            const font = SSFonts.get_font(G.FIXED_WIDTH_FONT_NAME, font_size);
            const [left, top, right, bottom] = font.getbbox("X");
            char_width = right - left;
            char_height = bottom - top;
            for (num_lines = 1; num_lines <= max_lines; num_lines++) {
                // Break the passphrase into n lines
                const chars_per_line = Math.max(1, Math.ceil(this.passphrase.length / num_lines));  // max(): guard only for an empty string (unreachable)
                passphrase = [];
                for (let i = 0; i < this.passphrase.length; i += chars_per_line) {
                    passphrase.push(this.passphrase.slice(i, i + chars_per_line));
                }
                // See if it fits in this configuration
                if (char_width * passphrase[0].length <= this.canvas_width - 2 * G.EDGE_PADDING) {
                    // Width is good...
                    if (num_lines * char_height <= available_height) {
                        // And the height is good!
                        found_solution = true;
                        break;
                    }
                }
            }
            if (num_lines > max_lines) num_lines = max_lines;  // Python's loop var stays at the last value
        }

        // Set up each line of text
        let screen_y = this.top_nav.height + ssSeedsInt((available_height - char_height * num_lines) / 2) - G.COMPONENT_PADDING;
        for (const line of passphrase) {
            this.components.push(new SSTextArea({
                text: line,
                font_name: G.FIXED_WIDTH_FONT_NAME,
                font_size: font_size,
                font_color: "orange",
                is_text_centered: true,
                screen_y: screen_y,
            }));
            screen_y += char_height + 2;
        }
    }
}


class SSSeedTranscribeSeedQRFormatScreen extends SSButtonListScreen {
    constructor(fields = {}) {
        const f = ssSeedsFields({}, fields);
        f.is_bottom_list = true;
        super(f);
        ssSeedsRunPost(this, SSSeedTranscribeSeedQRFormatScreen, this._ss_post_SeedTranscribeSeedQRFormatScreen);
    }
    __post_init__() {
        this.is_bottom_list = true;
        super.__post_init__();
        ssSeedsRunPost(this, SSSeedTranscribeSeedQRFormatScreen, this._ss_post_SeedTranscribeSeedQRFormatScreen);
    }
    _ss_post_SeedTranscribeSeedQRFormatScreen() {
        const G = SSG();
        this.components.push(new SSIconTextLine({
            // Refers to the SeedQR type: Standard or Compact
            label_text: "Standard",
            // Briefly explains the Standard SeedQR data format
            value_text: "BIP-39 wordlist indices",
            is_text_centered: false,
            auto_line_break: true,
            screen_x: G.EDGE_PADDING,
            screen_y: this.top_nav.height + G.COMPONENT_PADDING,
        }));
        const last = this.components[this.components.length - 1];
        this.components.push(new SSIconTextLine({
            label_text: "Compact",
            // Briefly explains the Compact SeedQR data format
            value_text: "Raw entropy bits",
            is_text_centered: false,
            screen_x: G.EDGE_PADDING,
            screen_y: last.screen_y + last.height + 2 * G.COMPONENT_PADDING,
        }));
    }
}


class SSSeedTranscribeSeedQRWholeQRScreen extends ssSeedsWarningEdgesMixin(SSButtonListScreen) {
    constructor(fields = {}) {
        const f = ssSeedsFields({ qr_data: null, num_modules: null }, fields);
        f.title = "Transcribe SeedQR";
        // Refers to the QR code size: 21x21, 25x25, or 29x29
        const button_label = `Begin ${f.num_modules}x${f.num_modules}`;
        f.button_data = [ssSeedsButtonOption({ button_label: button_label })];
        f.is_bottom_list = true;
        f.status_color = SSG().DIRE_WARNING_COLOR;
        super(f);
        ssSeedsRunPost(this, SSSeedTranscribeSeedQRWholeQRScreen, this._ss_post_SeedTranscribeSeedQRWholeQRScreen);
    }
    __post_init__() {
        this.title = "Transcribe SeedQR";
        const button_label = `Begin ${this.num_modules}x${this.num_modules}`;
        if (!this.button_data || this.button_data.length !== 1 || this.button_data[0].button_label !== button_label) {
            this.button_data = [ssSeedsButtonOption({ button_label: button_label })];
        }
        this.is_bottom_list = true;
        this.status_color = SSG().DIRE_WARNING_COLOR;
        super.__post_init__();
        ssSeedsRunPost(this, SSSeedTranscribeSeedQRWholeQRScreen, this._ss_post_SeedTranscribeSeedQRWholeQRScreen);
    }
    _ss_post_SeedTranscribeSeedQRWholeQRScreen() {
        const G = SSG();
        const qr_height = this.buttons[0].screen_y - this.top_nav.height - G.COMPONENT_PADDING;
        const qr_width = qr_height;

        const qr_image = ssSeedsQRImage(this.qr_data, qr_width, qr_height, 1, SS_SEEDS_QR_STYLE__ROUNDED);

        this.paste_images.push([qr_image, [ssSeedsInt((this.canvas_width - qr_width) / 2), this.top_nav.height]]);
    }
}


class SSSeedTranscribeSeedQRZoomedInScreen extends SSBaseScreen {
    /*
    QR codes are defined by the number of "modules" (squares), e.g. 21x21 modules.
    Each module will be rendered as a square of pixels, e.g. 24x24 pixels.
    In this Screen, a "zone" will mean a square module area, e.g. 5x5 modules, that
    corresponds to the SeedQR templates which include zone guidelines and labels (e.g. "B-3").
    */
    constructor(fields = {}) {
        super(ssSeedsFields({ qr_data: null, num_modules: null, initial_zone_x: 0, initial_zone_y: 0 }, fields));
        ssSeedsRunPost(this, SSSeedTranscribeSeedQRZoomedInScreen, this._ss_post_SeedTranscribeSeedQRZoomedInScreen);
    }
    __post_init__() {
        super.__post_init__();
        ssSeedsRunPost(this, SSSeedTranscribeSeedQRZoomedInScreen, this._ss_post_SeedTranscribeSeedQRZoomedInScreen);
    }
    _ss_post_SeedTranscribeSeedQRZoomedInScreen() {
        const G = SSG();
        // Render an oversized QR code that we can view up close
        this.pixels_per_module = 24;

        // Border must accommodate the 3 blocks outside the center 5x5 mask plus up to
        // 1 empty block inside the 5x5 mask (29x29 has a 4-block final col/row).
        this.num_qr_border_modules = 4;
        if (this.num_modules === 21) {
            // Optimize for 21x21
            this.modules_per_zone = 7;  // i.e. a 7x7 group of modules
        } else {
            this.modules_per_zone = 5;
        }

        const total_qr_image_width = (this.num_qr_border_modules + this.num_modules + this.num_qr_border_modules) * this.pixels_per_module;
        this.qr_image = ssSeedsQRImage(this.qr_data, total_qr_image_width, total_qr_image_width, this.num_qr_border_modules, SS_SEEDS_QR_STYLE__ROUNDED);
        this.qr_image_width = total_qr_image_width;
        this.qr_image_height = total_qr_image_width;

        // Render gridlines over the QR code but don't draw on its external white border
        const qr_image_draw = SSImageDraw.Draw(this.qr_image);
        const ppm = this.pixels_per_module, b = this.num_qr_border_modules;
        for (let i = b; i < Math.floor(this.qr_image_width / ppm) - b; i++) {
            qr_image_draw.line([i * ppm, b * ppm, i * ppm, this.qr_image_height - b * ppm], { fill: "#bbb" });
            qr_image_draw.line([b * ppm, i * ppm, this.qr_image_width - b * ppm, i * ppm], { fill: "#bbb" });
        }

        // The zone mask (black at alpha 226) is drawn straight onto each frame in
        // _ss_draw_overlay(); see the SIM note there.
        this.zone_mask_offset_x = ssSeedsInt((this.canvas_width - (this.modules_per_zone * this.pixels_per_module)) / 2);
        this.zone_mask_offset_y = ssSeedsInt((this.canvas_height - (this.modules_per_zone * this.pixels_per_module)) / 2);

        this._ss_msg = "click to exit";
        this._ss_msg_font = SSFonts.get_font(G.get_body_font_name(), G.get_body_font_size());
        const [, top, right] = this._ss_msg_font.getbbox(this._ss_msg, { anchor: "ls" });
        this._ss_msg_height = -1 * top + G.COMPONENT_PADDING;
        this._ss_msg_width = right + 2 * G.COMPONENT_PADDING;
    }

    // SIM: Python alpha-composites an RGBA mask image (0,0,0,226) with a transparent window
    // and the zone labels over the cropped QR. Here the same shapes are drawn directly onto
    // the frame, the dark areas with an rgba() fill.
    _ss_draw_overlay(draw) {
        const G = SSG();
        const W = this.canvas_width, H = this.canvas_height;
        const ox = this.zone_mask_offset_x, oy = this.zone_mask_offset_y;
        const mask = "rgba(0, 0, 0, " + (226 / 255).toFixed(4) + ")";
        draw.rectangle([0, 0, W - 1, oy - 1], { fill: mask });
        draw.rectangle([0, H - oy + 1, W - 1, H - 1], { fill: mask });
        draw.rectangle([0, oy, ox - 1, H - oy], { fill: mask });
        draw.rectangle([W - ox + 1, oy, W - 1, H - oy], { fill: mask });
        draw.rectangle([ox, oy, W - ox, H - oy], { fill: null, outline: G.ACCENT_COLOR, width: 1 });

        draw.rectangle(
            [ssSeedsInt((W - this._ss_msg_width) / 2), H - this._ss_msg_height, ssSeedsInt((W + this._ss_msg_width) / 2), H],
            { fill: G.BACKGROUND_COLOR }
        );
        draw.text([ssSeedsInt(W / 2), H - ssSeedsInt(G.COMPONENT_PADDING / 2)], this._ss_msg, {
            fill: G.BODY_FONT_COLOR, font: this._ss_msg_font, anchor: "ms",  // Middle, baSeline
        });

        this.draw_zone_labels(draw);
    }

    draw_zone_labels(zone_labels_draw) {
        // Create overlay for zone labels (e.g. "D-5")
        const G = SSG();
        const zone_labels_x = ["1", "2", "3", "4", "5", "6"];
        const zone_labels_y = ["A", "B", "C", "D", "E", "F"];
        const W = this.canvas_width, H = this.canvas_height;

        zone_labels_draw.rectangle([this.zone_mask_offset_x, 0, W - this.zone_mask_offset_x, this.pixels_per_module], { fill: G.ACCENT_COLOR });
        zone_labels_draw.rectangle([0, this.zone_mask_offset_y, this.pixels_per_module, H - this.zone_mask_offset_y], { fill: G.ACCENT_COLOR });

        const label_font = SSFonts.get_font(G.FIXED_WIDTH_EMPHASIS_FONT_NAME, 28);
        const x_label = zone_labels_x[this.cur_zone_x];
        let [, top] = label_font.getbbox(x_label, { anchor: "ls" });
        const x_label_height = -1 * top;
        zone_labels_draw.text(
            [ssSeedsInt(W / 2), this.pixels_per_module - ssSeedsInt((this.pixels_per_module - x_label_height) / 2)],
            x_label,
            { fill: G.BUTTON_SELECTED_FONT_COLOR, font: label_font, anchor: "ms" }
        );

        const y_label = zone_labels_y[this.cur_zone_y];
        [, top] = label_font.getbbox(y_label, { anchor: "ls" });
        const y_label_height = -1 * top;
        zone_labels_draw.text(
            [ssSeedsInt(this.pixels_per_module / 2), ssSeedsInt((H + y_label_height) / 2)],
            y_label,
            { fill: G.BUTTON_SELECTED_FONT_COLOR, font: label_font, anchor: "ms" }
        );
    }

    // qr_image.crop((x, y, x + W, y + H)) composited with the overlay (outside the QR image = black)
    _ss_frame(px, py) {
        const frame = SSImage.new("RGB", [this.canvas_width, this.canvas_height], "#000000");
        frame.paste(this.qr_image, [-px, -py]);
        this._ss_draw_overlay(SSImageDraw.Draw(frame));
        return frame;
    }

    _render() {
        // Track our current zone-level (macro-module) position and our actual pixel
        // coordinates as we pan around across the QR code image.
        this.cur_zone_x = this.initial_zone_x;
        this.cur_zone_y = this.initial_zone_y;
        this.cur_pixel_x = (this.cur_zone_x * this.modules_per_zone * this.pixels_per_module) + this.num_qr_border_modules * this.pixels_per_module - this.zone_mask_offset_x;
        this.cur_pixel_y = (this.cur_zone_y * this.modules_per_zone * this.pixels_per_module) + this.num_qr_border_modules * this.pixels_per_module - this.zone_mask_offset_y;
        this.next_pixel_x = this.cur_pixel_x;
        this.next_pixel_y = this.cur_pixel_y;

        this.renderer.show_image(this._ss_frame(this.cur_pixel_x, this.cur_pixel_y));
    }

    // Renderer.show_image_pan (SIM: one frame per ~16 ms instead of the display's SPI speed)
    async _ss_show_image_pan(start_x, start_y, end_x, end_y, rate) {
        let cur_x = start_x, cur_y = start_y, rate_x = rate, rate_y = rate;
        if (end_x - start_x < 0) rate_x = rate_x * -1;
        if (end_y - start_y < 0) rate_y = rate_y * -1;
        while ((cur_x !== end_x || cur_y !== end_y) && (rate_x !== 0 || rate_y !== 0)) {
            cur_x += rate_x;
            if ((rate_x > 0 && cur_x > end_x) || (rate_x < 0 && cur_x < end_x)) {
                // We've moved too far; back up and undo that last move.
                cur_x -= rate_x;
                rate_x = 0;
            }
            cur_y += rate_y;
            if ((rate_y > 0 && cur_y > end_y) || (rate_y < 0 && cur_y < end_y)) {
                cur_y -= rate_y;
                rate_y = 0;
            }
            this.renderer.show_image(this._ss_frame(cur_x, cur_y));
            await ssSeedsSleep(16);
        }
    }

    async _run() {
        const HB = SSHB();
        for (;;) {
            const input = await ssSeedsWaitFor(this, HB.KEYS__LEFT_RIGHT_UP_DOWN.concat(HB.KEYS__ANYCLICK));
            const zones = Math.ceil(this.num_modules / this.modules_per_zone);

            if (ssSeedsIn(input, HB.KEYS__ANYCLICK)) {
                // User clicked to exit
                return;
            } else if (input === HB.KEY_RIGHT && this.cur_zone_x + 1 < zones) {
                this.next_pixel_x = this.cur_pixel_x + this.modules_per_zone * this.pixels_per_module;
                this.cur_zone_x += 1;
            } else if (input === HB.KEY_LEFT && this.cur_zone_x - 1 >= 0) {
                this.next_pixel_x = this.cur_pixel_x - this.modules_per_zone * this.pixels_per_module;
                this.cur_zone_x -= 1;
            } else if (input === HB.KEY_DOWN && this.cur_zone_y + 1 < zones) {
                this.next_pixel_y = this.cur_pixel_y + this.modules_per_zone * this.pixels_per_module;
                this.cur_zone_y += 1;
            } else if (input === HB.KEY_UP && this.cur_zone_y - 1 >= 0) {
                this.next_pixel_y = this.cur_pixel_y - this.modules_per_zone * this.pixels_per_module;
                this.cur_zone_y -= 1;
            } else {
                // User selected a direction that we can't advance any further
                continue;
            }

            await this._ss_show_image_pan(this.cur_pixel_x, this.cur_pixel_y, this.next_pixel_x, this.next_pixel_y, this.pixels_per_module);
            this.cur_pixel_x = this.next_pixel_x;
            this.cur_pixel_y = this.next_pixel_y;
        }
    }
}


class SSSeedTranscribeSeedQRConfirmQRPromptScreen extends SSButtonListScreen {
    constructor(fields = {}) {
        const f = ssSeedsFields({}, fields);
        f.is_bottom_list = true;
        super(f);
        ssSeedsRunPost(this, SSSeedTranscribeSeedQRConfirmQRPromptScreen, this._ss_post_ConfirmQRPrompt);
    }
    __post_init__() {
        this.is_bottom_list = true;
        super.__post_init__();
        ssSeedsRunPost(this, SSSeedTranscribeSeedQRConfirmQRPromptScreen, this._ss_post_ConfirmQRPrompt);
    }
    _ss_post_ConfirmQRPrompt() {
        this.components.push(new SSTextArea({
            text: "Optionally scan your transcribed SeedQR to confirm that it reads back correctly.",
            screen_y: this.top_nav.height,
            height: this.buttons[0].screen_y - this.top_nav.height,
        }));
    }
}


class SSAddressVerificationSigTypeScreen extends SSButtonListScreen {
    constructor(fields = {}) {
        const f = ssSeedsFields({ text: "" }, fields);
        f.is_bottom_list = true;
        super(f);
        ssSeedsRunPost(this, SSAddressVerificationSigTypeScreen, this._ss_post_text);
    }
    __post_init__() {
        this.is_bottom_list = true;
        super.__post_init__();
        ssSeedsRunPost(this, SSAddressVerificationSigTypeScreen, this._ss_post_text);
    }
    _ss_post_text() {
        this.components.push(new SSTextArea({ text: this.text, screen_y: this.top_nav.height }));
    }
}


class SSSeedSelectSeedScreen extends SSButtonListScreen {
    constructor(fields = {}) {
        const f = ssSeedsFields({ text: "" }, fields);
        f.is_bottom_list = true;
        super(f);
        ssSeedsRunPost(this, SSSeedSelectSeedScreen, this._ss_post_text);
    }
    __post_init__() {
        this.is_bottom_list = true;
        super.__post_init__();
        ssSeedsRunPost(this, SSSeedSelectSeedScreen, this._ss_post_text);
    }
    _ss_post_text() {
        this.components.push(new SSTextArea({ text: this.text, screen_y: this.top_nav.height }));
    }
}


class SSSeedAddressVerificationScreen extends SSButtonListScreen {
    /*
        "Skip 10" feature increments the `ThreadsafeCounter` via its `increment(step=10)`
        method. The next brute force round just checks the counter's value and resumes
        its work from the updated index.
    */
    constructor(fields = {}) {
        const f = ssSeedsFields({
            address: null, derivation_path: null, script_type: null, sig_type: null, network: null,
            is_mainnet: null, threadsafe_counter: null, verified_index: null,
        }, fields);
        f.title = "Verify Address";
        f.is_bottom_list = true;
        f.show_back_button = false;
        super(f);
        ssSeedsRunPost(this, SSSeedAddressVerificationScreen, this._ss_post_SeedAddressVerificationScreen);
    }
    __post_init__() {
        // Customize defaults
        this.title = "Verify Address";
        this.is_bottom_list = true;
        this.show_back_button = false;
        super.__post_init__();
        ssSeedsRunPost(this, SSSeedAddressVerificationScreen, this._ss_post_SeedAddressVerificationScreen);
    }
    _ss_post_SeedAddressVerificationScreen() {
        const G = SSG();
        const address_display = new SSFormattedAddress({
            address: this.address,
            max_lines: 1,
            screen_y: this.top_nav.height,
        });
        this.components.push(address_display);

        let text = `${this.sig_type} - ${this.script_type}`;
        if (!this.is_mainnet) text += ` (${this.network})`;
        let last = this.components[this.components.length - 1];
        this.components.push(new SSTextArea({
            text: text,
            font_size: G.LABEL_FONT_SIZE,
            font_color: G.LABEL_FONT_COLOR,
            is_text_centered: true,
            screen_y: last.screen_y + last.height + G.COMPONENT_PADDING,
        }));

        last = this.components[this.components.length - 1];
        this.threads.push(new SSSeedAddressVerificationScreen.ProgressThread({
            renderer: this.renderer,
            screen_y: last.screen_y + last.height + G.COMPONENT_PADDING,
            threadsafe_counter: this.threadsafe_counter,
            verified_index: this.verified_index,
        }));
    }

    _run_callback() {
        // Exit the screen on success via a non-None value (see ButtonListScreen._run()).
        if (this.verified_index.cur_count !== null && this.verified_index.cur_count !== undefined) {
            // Note that the ProgressThread will have already exited on its own.
            return 1;
        }
        return null;
    }
}
SSSeedAddressVerificationScreen.ProgressThread = class ProgressThread extends SSSeedsThread {
    constructor({ renderer, screen_y, threadsafe_counter, verified_index }) {
        super();
        this.renderer = renderer;
        this.screen_y = screen_y;
        this.threadsafe_counter = threadsafe_counter;
        this.verified_index = verified_index;
    }
    async run() {
        while (this.keep_running) {
            if (this.verified_index.cur_count !== null && this.verified_index.cur_count !== undefined) {
                // Break the Screen._run out of its `wait_for`; it will then call its
                // `_run_callback`, detect the success state and exit.
                ssSeedsTriggerOverride();
                return;
            }

            const textarea = new SSTextArea({
                // Inserts the nth address number (e.g. "Checking address 7")
                text: `Checking address ${this.threadsafe_counter.cur_count}`,
                font_name: SSG().get_body_font_name(),
                font_size: SSG().get_body_font_size(),
                screen_y: this.screen_y,
            });
            textarea.render();
            this.renderer.show_image();

            await ssSeedsSleep(100);
        }
    }
};


class SSSeedAddressVerificationSuccessScreen extends SSLargeIconStatusScreen {
    constructor(fields = {}) {
        const f = ssSeedsFields({ address: null, verified_index: null, verified_index_is_change: null }, fields);
        f.title = "Success!";
        f.status_headline = "Address Verified";
        f.button_data = [ssSeedsButtonOption({ button_label: "OK" })];
        f.is_bottom_list = true;
        f.show_back_button = false;
        super(f);
        ssSeedsRunPost(this, SSSeedAddressVerificationSuccessScreen, this._ss_post_Success);
    }
    __post_init__() {
        this.title = "Success!";
        this.status_headline = "Address Verified";
        if (!this.button_data || this.button_data.length !== 1 || this.button_data[0].button_label !== "OK") {
            this.button_data = [ssSeedsButtonOption({ button_label: "OK" })];
        }
        this.is_bottom_list = true;
        this.show_back_button = false;
        super.__post_init__();
        ssSeedsRunPost(this, SSSeedAddressVerificationSuccessScreen, this._ss_post_Success);
    }
    _ss_post_Success() {
        const G = SSG();
        let address_type;
        if (this.verified_index_is_change) {
            // Describes the address type (change or receive)
            address_type = "change address";
        } else {
            address_type = "receive address";
        }

        let last = this.components[this.components.length - 1];
        this.components.push(new SSFormattedAddress({
            screen_y: last.screen_y + last.height + G.COMPONENT_PADDING,
            address: this.address,
            max_lines: 1,  // Use abbreviated format w/ellipsis
        }));

        last = this.components[this.components.length - 1];
        this.components.push(new SSTextArea({
            text: address_type,
            screen_y: last.screen_y + last.height + 2 * G.COMPONENT_PADDING,
        }));

        // Describes the address index (e.g. "index 7")
        const index_str = `index ${this.verified_index}`;
        last = this.components[this.components.length - 1];
        this.components.push(new SSTextArea({
            text: index_str,
            screen_y: last.screen_y + last.height + G.COMPONENT_PADDING,
        }));
    }
}


class SSLoadMultisigWalletDescriptorScreen extends SSButtonListScreen {
    constructor(fields = {}) {
        const f = ssSeedsFields({}, fields);
        f.title = "Multisig Verification";
        f.is_bottom_list = true;
        super(f);
        ssSeedsRunPost(this, SSLoadMultisigWalletDescriptorScreen, this._ss_post_LoadMs);
    }
    __post_init__() {
        this.title = "Multisig Verification";
        this.is_bottom_list = true;
        super.__post_init__();
        ssSeedsRunPost(this, SSLoadMultisigWalletDescriptorScreen, this._ss_post_LoadMs);
    }
    _ss_post_LoadMs() {
        this.components.push(new SSTextArea({
            text: "Load your multisig wallet descriptor to verify your receive/self-transfer or change address.",
            screen_y: this.top_nav.height,
            height: this.buttons[0].screen_y - this.top_nav.height,
        }));
    }
}


class SSMultisigWalletDescriptorScreen extends SSButtonListScreen {
    constructor(fields = {}) {
        const f = ssSeedsFields({ policy: null, fingerprints: null }, fields);
        f.title = "Descriptor Loaded";
        f.is_bottom_list = true;
        super(f);
        ssSeedsRunPost(this, SSMultisigWalletDescriptorScreen, this._ss_post_MsDesc);
    }
    __post_init__() {
        this.title = "Descriptor Loaded";
        this.is_bottom_list = true;
        super.__post_init__();
        ssSeedsRunPost(this, SSMultisigWalletDescriptorScreen, this._ss_post_MsDesc);
    }
    _ss_post_MsDesc() {
        const G = SSG();
        this.components.push(new SSIconTextLine({
            // Label for the multisig wallet's signing policy (e.g. 2-of-3)
            label_text: "Policy",
            value_text: this.policy,
            font_size: 20,
            screen_y: this.top_nav.height,
            is_text_centered: true,
        }));
        const last = this.components[this.components.length - 1];
        this.components.push(new SSIconTextLine({
            label_text: "Signing Keys",
            value_text: this.fingerprints.join(" "),
            font_size: 24,
            font_name: G.FIXED_WIDTH_EMPHASIS_FONT_NAME,
            screen_y: last.screen_y + last.height + 2 * G.COMPONENT_PADDING,
            is_text_centered: true,
            auto_line_break: true,
        }));
    }
}


class SSSeedSignMessageConfirmMessageScreen extends SSButtonListScreen {
    constructor(fields = {}) {
        const f = ssSeedsFields({ page_num: null }, fields);
        const G = SSG();
        const renderer = ssSeedsRenderer();
        const start_y = G.TOP_NAV_HEIGHT + G.COMPONENT_PADDING;
        const end_y = renderer.canvas_height - G.EDGE_PADDING - G.BUTTON_HEIGHT - G.COMPONENT_PADDING;
        const message_height = end_y - start_y;

        // TODO: Pass the full message in from the View so that this Screen doesn't need to
        // interact with the Controller here.
        const sign_message_data = ssSeedsController().sign_message_data;
        if (!("paged_message" in sign_message_data)) {
            const paged = ssSeedsReflowTextIntoPages(
                sign_message_data["message"],
                renderer.canvas_width - 2 * G.EDGE_PADDING,
                message_height
            );
            sign_message_data["paged_message"] = paged;
        }

        if (f.page_num >= sign_message_data["paged_message"].length) {
            throw new Error("Bug in paged_message calculation");
        }

        if (sign_message_data["paged_message"].length === 1) {
            f.title = "Review Message";
        } else {
            f.title = `Message (pt ${f.page_num + 1}/${sign_message_data["paged_message"].length})`;
        }
        f.is_bottom_list = true;
        f.is_button_text_centered = true;
        f.button_data = [ssSeedsButtonOption({ button_label: "Next" })];
        f.sign_message_data = sign_message_data;
        f._ss_start_y = start_y;
        super(f);
        ssSeedsRunPost(this, SSSeedSignMessageConfirmMessageScreen, this._ss_post_ConfirmMessage);
    }
    __post_init__() {
        super.__post_init__();
        ssSeedsRunPost(this, SSSeedSignMessageConfirmMessageScreen, this._ss_post_ConfirmMessage);
    }
    _ss_post_ConfirmMessage() {
        const message_display = new SSTextArea({
            text: this.sign_message_data["paged_message"][this.page_num],
            is_text_centered: false,
            screen_y: this._ss_start_y,
        });
        this.components.push(message_display);
    }
}


class SSSeedSignMessageConfirmAddressScreen extends SSButtonListScreen {
    constructor(fields = {}) {
        const f = ssSeedsFields({ derivation_path: null, address: null }, fields);
        f.title = "Confirm Address";
        f.is_bottom_list = true;
        f.is_button_text_centered = true;
        f.button_data = [ssSeedsButtonOption({ button_label: "Sign message" })];
        super(f);
        ssSeedsRunPost(this, SSSeedSignMessageConfirmAddressScreen, this._ss_post_ConfirmAddress);
    }
    __post_init__() {
        this.title = "Confirm Address";
        this.is_bottom_list = true;
        this.is_button_text_centered = true;
        if (!this.button_data || this.button_data.length !== 1 || this.button_data[0].button_label !== "Sign message") {
            this.button_data = [ssSeedsButtonOption({ button_label: "Sign message" })];
        }
        super.__post_init__();
        ssSeedsRunPost(this, SSSeedSignMessageConfirmAddressScreen, this._ss_post_ConfirmAddress);
    }
    _ss_post_ConfirmAddress() {
        const G = SSG();
        const derivation_path_display = new SSIconTextLine({
            icon_name: SSSeedSignerIconConstants.DERIVATION,
            icon_color: G.INFO_COLOR,
            label_text: "derivation path",
            value_text: this.derivation_path,
            is_text_centered: true,
            screen_y: this.top_nav.height + G.COMPONENT_PADDING,
        });
        this.components.push(derivation_path_display);

        const address_display = new SSFormattedAddress({
            address: this.address,
            max_lines: 3,
            screen_y: derivation_path_display.screen_y + derivation_path_display.height + 2 * G.COMPONENT_PADDING,
        });
        this.components.push(address_display);
    }
}


/* -------------------------------------------------------------------------------------
   8. views/seed_views.py
   Python View.__init__ work that needs the async crypto (fingerprints, xpubs, BIP-85,
   signing) is done at the start of run(); everything else stays in the constructor.
   ------------------------------------------------------------------------------------- */
const SSSC = () => SSSettingsConstants;

class SSSeedsMenuView extends SSView {
    static get LOAD() { return ssSeedsBO("SeedsMenuView.LOAD", { button_label: "Load a seed" }); }

    constructor() {
        super();
        this.seeds = [];
    }

    async run() {
        for (const seed of this.controller.storage.seeds) {
            this.seeds.push({
                "fingerprint": await seed.get_fingerprint(this.settings.get_value(SSSC().SETTING__NETWORK)),
            });
        }

        if (this.seeds.length === 0) {
            // Nothing to do here unless we have a seed loaded
            return ssSeedsDest(SSLoadSeedView, { clear_history: true });
        }

        const button_data = [];
        for (const seed of this.seeds) {
            button_data.push(ssSeedsButtonOption({ button_label: seed["fingerprint"], icon_name: SSSeedSignerIconConstants.FINGERPRINT }));
        }
        button_data.push(SSSeedsMenuView.LOAD);

        const selected_menu_num = await this.run_screen(SSButtonListScreen, {
            title: "In-Memory Seeds",
            is_button_text_centered: false,
            button_data: button_data,
        });

        if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) {
            return ssSeedsDest(SSBackStackView);
        } else if (this.seeds.length > 0 && selected_menu_num < this.seeds.length) {
            return ssSeedsDest(SSSeedOptionsView, { view_args: { "seed_num": selected_menu_num } });
        } else if (ssSeedsBtnEq(button_data[selected_menu_num], SSSeedsMenuView.LOAD)) {
            return ssSeedsDest(SSLoadSeedView);
        }
    }
}


class SSSeedSelectSeedView extends SSView {
    /*
    Reusable seed selection UI. Prompts the user to select amongst the already-loaded
    seeds OR to load a seed.
    * `flow`: which user flow is in progress (verify single sig addr or sign message).
    */
    static get SCAN_SEED() { return ssSeedsBO("SeedSelectSeedView.SCAN_SEED", { button_label: "Scan a seed", icon_name: SSSeedSignerIconConstants.QRCODE }); }
    static get TYPE_12WORD() { return ssSeedsBO("SeedSelectSeedView.TYPE_12WORD", { button_label: "Enter 12-word seed", icon_name: SSFontAwesomeIconConstants.KEYBOARD }); }
    static get TYPE_24WORD() { return ssSeedsBO("SeedSelectSeedView.TYPE_24WORD", { button_label: "Enter 24-word seed", icon_name: SSFontAwesomeIconConstants.KEYBOARD }); }
    static get TYPE_ELECTRUM() { return ssSeedsBO("SeedSelectSeedView.TYPE_ELECTRUM", { button_label: "Enter Electrum seed", icon_name: SSFontAwesomeIconConstants.KEYBOARD }); }

    constructor({ flow } = {}) {
        super();
        this.flow = flow;
    }

    async run() {
        const C = SSSeedSelectSeedView;
        const seeds = this.controller.storage.seeds;
        let title, text;

        if (this.flow === SSController.FLOW__VERIFY_SINGLESIG_ADDR) {
            title = "Verify Address";
            if (seeds.length === 0) text = "Load the seed to verify";
            else text = "Select seed to verify";
        } else if (this.flow === SSController.FLOW__SIGN_MESSAGE) {
            title = "Sign Message";
            if (seeds.length === 0) text = "Load the seed to sign with";
            else text = "Select seed to sign with";
        } else {
            throw new Error(`Unsupported \`flow\` specified: ${this.flow}`);
        }

        const button_data = [];
        for (const seed of seeds) {
            const button_str = await seed.get_fingerprint(this.settings.get_value(SSSC().SETTING__NETWORK));
            button_data.push(ssSeedsButtonOption({ button_label: button_str, icon_name: SSSeedSignerIconConstants.FINGERPRINT, icon_color: "blue" }));
        }

        button_data.push(C.SCAN_SEED);
        button_data.push(C.TYPE_12WORD);
        button_data.push(C.TYPE_24WORD);

        if (this.settings.get_value(SSSC().SETTING__ELECTRUM_SEEDS) === SSSC().OPTION__ENABLED) {
            button_data.push(C.TYPE_ELECTRUM);
        }

        const selected_menu_num = await this.run_screen(SSSeedSelectSeedScreen, {
            title: title,
            text: text,
            is_button_text_centered: false,
            button_data: button_data,
        });

        if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) {
            return ssSeedsDest(SSBackStackView);
        }

        if (seeds.length > 0 && selected_menu_num < seeds.length) {
            // User selected one of the n seeds
            const view_args = { seed_num: selected_menu_num };
            if (this.flow === SSController.FLOW__VERIFY_SINGLESIG_ADDR) {
                return ssSeedsDest(SSSeedAddressVerificationView, { view_args: view_args });
            } else if (this.flow === SSController.FLOW__SIGN_MESSAGE) {
                this.controller.sign_message_data["seed_num"] = selected_menu_num;
                return ssSeedsDest(SSSeedSignMessageConfirmMessageView);
            }
        }

        this.controller.resume_main_flow = this.flow;

        if (ssSeedsBtnEq(button_data[selected_menu_num], C.SCAN_SEED)) {
            return ssSeedsDest(ssSeedsExt(() => SSScanView));
        } else if (ssSeedsBtnIn(button_data[selected_menu_num], [C.TYPE_12WORD, C.TYPE_24WORD])) {
            if (ssSeedsBtnEq(button_data[selected_menu_num], C.TYPE_12WORD)) {
                this.controller.storage.init_pending_mnemonic(12);
            } else {
                this.controller.storage.init_pending_mnemonic(24);
            }
            return ssSeedsDest(SSSeedMnemonicEntryView);
        } else if (ssSeedsBtnEq(button_data[selected_menu_num], C.TYPE_ELECTRUM)) {
            return ssSeedsDest(SSSeedElectrumMnemonicStartView);
        }
    }
}


/****************************************************************************
    Loading seeds, passphrases, etc
****************************************************************************/
class SSLoadSeedView extends SSView {
    static get SEED_QR() { return ssSeedsBO("LoadSeedView.SEED_QR", { button_label: "Scan a SeedQR", icon_name: SSSeedSignerIconConstants.QRCODE }); }
    static get TYPE_12WORD() { return ssSeedsBO("LoadSeedView.TYPE_12WORD", { button_label: "Enter 12-word seed", icon_name: SSFontAwesomeIconConstants.KEYBOARD }); }
    static get TYPE_24WORD() { return ssSeedsBO("LoadSeedView.TYPE_24WORD", { button_label: "Enter 24-word seed", icon_name: SSFontAwesomeIconConstants.KEYBOARD }); }
    static get TYPE_ELECTRUM() { return ssSeedsBO("LoadSeedView.TYPE_ELECTRUM", { button_label: "Enter Electrum seed", icon_name: SSFontAwesomeIconConstants.KEYBOARD }); }
    static get CREATE() { return ssSeedsBO("LoadSeedView.CREATE", { button_label: "Create a seed", icon_name: SSSeedSignerIconConstants.PLUS }); }

    async run() {
        const C = SSLoadSeedView;
        const button_data = [C.SEED_QR, C.TYPE_12WORD, C.TYPE_24WORD];

        if (this.settings.get_value(SSSC().SETTING__ELECTRUM_SEEDS) === SSSC().OPTION__ENABLED) {
            button_data.push(C.TYPE_ELECTRUM);
        }

        button_data.push(C.CREATE);

        const selected_menu_num = await this.run_screen(SSButtonListScreen, {
            title: "Load a Seed",
            is_button_text_centered: false,
            button_data: button_data,
        });

        if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) {
            return ssSeedsDest(SSBackStackView);
        }

        const sel = button_data[selected_menu_num];
        if (ssSeedsBtnEq(sel, C.SEED_QR)) {
            return ssSeedsDest(ssSeedsExt(() => SSScanSeedQRView));
        } else if (ssSeedsBtnEq(sel, C.TYPE_12WORD)) {
            this.controller.storage.init_pending_mnemonic(12);
            return ssSeedsDest(SSSeedMnemonicEntryView);
        } else if (ssSeedsBtnEq(sel, C.TYPE_24WORD)) {
            this.controller.storage.init_pending_mnemonic(24);
            return ssSeedsDest(SSSeedMnemonicEntryView);
        } else if (ssSeedsBtnEq(sel, C.TYPE_ELECTRUM)) {
            return ssSeedsDest(SSSeedElectrumMnemonicStartView);
        } else if (ssSeedsBtnEq(sel, C.CREATE)) {
            return ssSeedsDest(ssSeedsExt(() => SSToolsMenuView));
        }
    }
}


class SSSeedMnemonicEntryView extends SSView {
    constructor({ cur_word_index = 0, is_calc_final_word = false } = {}) {
        super();
        this.cur_word_index = cur_word_index;
        this.cur_word = this.controller.storage.get_pending_mnemonic_word(cur_word_index);
        this.is_calc_final_word = is_calc_final_word;
    }

    async run() {
        const ret = await this.run_screen(SSSeedMnemonicEntryScreen, {
            // Inserts the word number (e.g. "Seed Word #6")
            title: `Seed Word #${this.cur_word_index + 1}`,  // Human-readable 1-indexing!
            initial_letters: this.cur_word ? this.cur_word.split("") : ["a"],
            wordlist: SSSeed.get_wordlist(this.settings.get_value(SSSC().SETTING__WORDLIST_LANGUAGE)),
        });

        if (ret === SS_RET_CODE__BACK_BUTTON) {
            // 1. Backing out of the first word cancels the mnemonic entry process;
            //    return to whichever `View` routed us here initially.
            // 2. Backing out of the current word returns to the previous word.
            if (this.cur_word_index === 0) {
                this.controller.storage.discard_pending_mnemonic();
            }
            return ssSeedsDest(SSBackStackView);
        }

        // ret will be our new mnemonic word
        this.controller.storage.update_pending_mnemonic(ret, this.cur_word_index);

        if (this.is_calc_final_word && this.cur_word_index === this.controller.storage.pending_mnemonic_length - 2) {
            // Time to calculate the last word. User must decide how they want to specify
            // the last bits of entropy for the final word.
            return ssSeedsDest(ssSeedsExt(() => SSToolsCalcFinalWordFinalizePromptView));
        }

        if (this.is_calc_final_word && this.cur_word_index === this.controller.storage.pending_mnemonic_length - 1) {
            // Time to calculate the last word. User must either select a final word to
            // contribute entropy to the checksum word OR we assume 0 ("abandon").
            return ssSeedsDest(ssSeedsExt(() => SSToolsCalcFinalWordShowFinalWordView));
        }

        if (this.cur_word_index < this.controller.storage.pending_mnemonic_length - 1) {
            return ssSeedsDest(SSSeedMnemonicEntryView, {
                view_args: {
                    "cur_word_index": this.cur_word_index + 1,
                    "is_calc_final_word": this.is_calc_final_word,
                },
            });
        } else {
            // Attempt to finalize the mnemonic
            try {
                await this.controller.storage.convert_pending_mnemonic_to_pending_seed();
            } catch (e) {
                if (e instanceof SSInvalidSeedException) return ssSeedsDest(SSSeedMnemonicInvalidView);
                throw e;
            }
            return ssSeedsDest(SSSeedFinalizeView);
        }
    }
}


class SSSeedMnemonicInvalidView extends SSView {
    static get EDIT() { return ssSeedsBO("SeedMnemonicInvalidView.EDIT", { button_label: "Review & edit" }); }
    static get DISCARD() { return ssSeedsBO("SeedMnemonicInvalidView.DISCARD", { button_label: "Discard", button_label_color: "red" }); }

    constructor() {
        super();
        this.mnemonic = this.controller.storage.pending_mnemonic;
    }

    async run() {
        const C = SSSeedMnemonicInvalidView;
        const button_data = [C.EDIT, C.DISCARD];
        const selected_menu_num = await this.run_screen(SSDireWarningScreen, {
            title: "Invalid Mnemonic!",
            status_icon_name: SSSeedSignerIconConstants.ERROR,
            status_headline: null,
            text: "Checksum failure; not a valid seed phrase.",
            show_back_button: false,
            button_data: button_data,
        });

        if (ssSeedsBtnEq(button_data[selected_menu_num], C.EDIT)) {
            return ssSeedsDest(SSSeedMnemonicEntryView, { view_args: { "cur_word_index": 0 } });
        } else if (ssSeedsBtnEq(button_data[selected_menu_num], C.DISCARD)) {
            this.controller.storage.discard_pending_mnemonic();
            return ssSeedsDest(SSMainMenuView);
        }
    }
}


class SSSeedFinalizeView extends SSView {
    static get FINALIZE() { return ssSeedsBO("SeedFinalizeView.FINALIZE", { button_label: "Done" }); }
    static get PASSPHRASE() { return ssSeedsBO("SeedFinalizeView.PASSPHRASE", { button_label: "BIP-39 Passphrase" }); }

    constructor() {
        super();
        this.seed = this.controller.storage.get_pending_seed();
    }

    async _ss_init_fingerprint() {
        const network = this.settings.get_value(SSSC().SETTING__NETWORK);
        // Python compares the bound method `get_fingerprint` with "" (always False), so it
        // always takes this branch: display the "naked" seed's fingerprint.
        const passphrase = this.seed.passphrase;
        await this.seed.set_passphrase("");
        this.fingerprint = await this.seed.get_fingerprint(network);
        await this.seed.set_passphrase(passphrase);
    }

    async run() {
        const C = SSSeedFinalizeView;
        await this._ss_init_fingerprint();

        const button_data = [C.FINALIZE];
        C.PASSPHRASE.button_label = this.seed.passphrase_label;
        if (this.settings.get_value(SSSC().SETTING__PASSPHRASE) !== SSSC().OPTION__DISABLED) {
            button_data.push(C.PASSPHRASE);
        }

        const selected_menu_num = await this.run_screen(SSSeedFinalizeScreen, {
            fingerprint: this.fingerprint,
            button_data: button_data,
        });

        if (ssSeedsBtnEq(button_data[selected_menu_num], C.FINALIZE)) {
            const seed_num = this.controller.storage.finalize_pending_seed();
            return ssSeedsDest(SSSeedOptionsView, { view_args: { "seed_num": seed_num }, clear_history: true });
        } else if (ssSeedsBtnEq(button_data[selected_menu_num], C.PASSPHRASE)) {
            return ssSeedsDest(SSSeedAddPassphraseView);
        }
    }
}


class SSSeedAddPassphraseView extends SSView {
    /* initial_keyboard: used by the screenshot generator to render each different keyboard layout. */
    constructor({ initial_keyboard = SSSeedAddPassphraseScreen.KEYBOARD__LOWERCASE_BUTTON_TEXT } = {}) {
        super();
        this.initial_keyboard = initial_keyboard;
        this.seed = this.controller.storage.get_pending_seed();
    }

    async run() {
        const passphrase_title = this.seed.passphrase_label;
        const ret_dict = await this.run_screen(SSSeedAddPassphraseScreen, {
            passphrase: this.seed.passphrase,
            title: passphrase_title,
            initial_keyboard: this.initial_keyboard,
        });

        // The new passphrase will be the return value; it might be empty.
        await this.seed.set_passphrase(ret_dict["passphrase"]);

        if (("is_back_button" in ret_dict) || this.seed.passphrase.length === 0) {
            return ssSeedsDest(SSSeedAddPassphraseExitDialogView);
        } else {
            return ssSeedsDest(SSSeedReviewPassphraseView);
        }
    }
}


class SSSeedAddPassphraseExitDialogView extends SSView {
    static get EDIT() { return ssSeedsBO("SeedAddPassphraseExitDialogView.EDIT", { button_label: "Edit passphrase" }); }
    static get DISCARD() { return ssSeedsBO("SeedAddPassphraseExitDialogView.DISCARD", { button_label: "Discard passphrase", button_label_color: "red" }); }
    static get SKIP() { return ssSeedsBO("SeedAddPassphraseExitDialogView.SKIP", { button_label: "Skip passphrase" }); }  // NOT red since we're not throwing anything away

    constructor() {
        super();
        this.seed = this.controller.storage.get_pending_seed();
    }

    async run() {
        const C = SSSeedAddPassphraseExitDialogView;
        let title, message, button_data;
        if (this.seed.passphrase) {
            title = "Discard passphrase?";
            message = "Your current passphrase entry will be erased.";
            button_data = [C.EDIT, C.DISCARD];
        } else {
            title = "Skip passphrase?";
            message = "You have not entered a passphrase yet.";
            button_data = [C.EDIT, C.SKIP];
        }

        const selected_menu_num = await this.run_screen(SSWarningScreen, {
            title: title,
            status_headline: null,
            text: message,
            show_back_button: false,
            button_data: button_data,
        });

        if (ssSeedsBtnEq(button_data[selected_menu_num], C.EDIT)) {
            return ssSeedsDest(SSSeedAddPassphraseView);
        } else if (ssSeedsBtnIn(button_data[selected_menu_num], [C.DISCARD, C.SKIP])) {
            await this.seed.set_passphrase("");
            return ssSeedsDest(SSSeedFinalizeView);
        }
    }
}


class SSSeedReviewPassphraseView extends SSView {
    /* Display the completed passphrase back to the user. */
    static get EDIT() { return ssSeedsBO("SeedReviewPassphraseView.EDIT", { button_label: "Edit passphrase" }); }
    static get DONE() { return ssSeedsBO("SeedReviewPassphraseView.DONE", { button_label: "Done" }); }

    constructor() {
        super();
        this.seed = this.controller.storage.get_pending_seed();
    }

    async run() {
        const C = SSSeedReviewPassphraseView;
        // Get the before/after fingerprints
        const network = this.settings.get_value(SSSC().SETTING__NETWORK);
        const passphrase = this.seed.passphrase;
        const fingerprint_with = await this.seed.get_fingerprint(network);
        await this.seed.set_passphrase("");
        const fingerprint_without = await this.seed.get_fingerprint(network);
        await this.seed.set_passphrase(passphrase);

        const button_data = [C.EDIT, C.DONE];

        // Because we have an explicit "Edit" button, we disable "BACK" to keep the
        // routing options sane.
        const selected_menu_num = await this.run_screen(SSSeedReviewPassphraseScreen, {
            fingerprint_without: fingerprint_without,
            fingerprint_with: fingerprint_with,
            passphrase: this.seed.passphrase,
            button_data: button_data,
            show_back_button: false,
        });

        if (ssSeedsBtnEq(button_data[selected_menu_num], C.EDIT)) {
            return ssSeedsDest(SSSeedAddPassphraseView);
        } else if (ssSeedsBtnEq(button_data[selected_menu_num], C.DONE)) {
            const seed_num = this.controller.storage.finalize_pending_seed();
            return ssSeedsDest(SSSeedOptionsView, { view_args: { "seed_num": seed_num }, clear_history: true });
        }
    }
}


class SSSeedDiscardView extends SSView {
    static get KEEP() { return ssSeedsBO("SeedDiscardView.KEEP", { button_label: "Keep seed" }); }
    static get DISCARD() { return ssSeedsBO("SeedDiscardView.DISCARD", { button_label: "Discard", button_label_color: "red" }); }

    constructor({ seed_num = null } = {}) {
        super();
        this.seed_num = seed_num;
        if (this.seed_num !== null && this.seed_num !== undefined) {
            this.seed = this.controller.get_seed(this.seed_num);
        } else {
            this.seed_num = null;
            this.seed = this.controller.storage.pending_seed;
        }
    }

    async run() {
        const C = SSSeedDiscardView;
        const button_data = [C.KEEP, C.DISCARD];

        const fingerprint = await this.seed.get_fingerprint(this.settings.get_value(SSSC().SETTING__NETWORK));
        // Inserts the seed fingerprint
        const text = `Wipe seed ${fingerprint} from the device?`;
        const selected_menu_num = await this.run_screen(SSWarningScreen, {
            title: "Discard Seed?",
            status_headline: null,
            text: text,
            show_back_button: false,
            button_data: button_data,
        });

        if (ssSeedsBtnEq(button_data[selected_menu_num], C.KEEP)) {
            // Use skip_current_view=True to prevent BACK from landing on this warning screen
            if (this.seed_num !== null) {
                return ssSeedsDest(SSSeedOptionsView, { view_args: { "seed_num": this.seed_num }, skip_current_view: true });
            } else {
                return ssSeedsDest(SSSeedFinalizeView, { skip_current_view: true });
            }
        } else if (ssSeedsBtnEq(button_data[selected_menu_num], C.DISCARD)) {
            if (this.seed_num !== null) {
                this.controller.discard_seed(this.seed_num);
            } else {
                this.controller.storage.clear_pending_seed();
            }
            return ssSeedsDest(SSMainMenuView, { clear_history: true });
        }
    }
}


class SSSeedElectrumMnemonicStartView extends SSView {
    /* Currently just a warning display before entering an Electrum seed. */
    async run() {
        await this.run_screen(SSWarningScreen, {
            title: "Electrum Warning",
            status_headline: null,
            text: "Some features are disabled for Electrum seeds.",
            show_back_button: false,
        });

        this.controller.storage.init_pending_mnemonic(12, true);

        return ssSeedsDest(SSSeedMnemonicEntryView);
    }
}


/****************************************************************************
    Views for actions on individual seeds:
****************************************************************************/
class SSSeedOptionsView extends SSView {
    static get SCAN_PSBT() { return ssSeedsBO("SeedOptionsView.SCAN_PSBT", { button_label: "Scan transaction", icon_name: SSSeedSignerIconConstants.QRCODE }); }
    static get EXPORT_XPUB() { return ssSeedsBO("SeedOptionsView.EXPORT_XPUB", { button_label: "Export xpub" }); }
    static get EXPLORER() { return ssSeedsBO("SeedOptionsView.EXPLORER", { button_label: "Address explorer" }); }
    static get SIGN_MESSAGE() { return ssSeedsBO("SeedOptionsView.SIGN_MESSAGE", { button_label: "Sign message" }); }
    static get BACKUP() { return ssSeedsBO("SeedOptionsView.BACKUP", { button_label: "Backup seed", right_icon_name: SSSeedSignerIconConstants.CHEVRON_RIGHT }); }
    static get BIP85_CHILD_SEED() { return ssSeedsBO("SeedOptionsView.BIP85_CHILD_SEED", { button_label: "BIP-85 child seed" }); }
    static get DISCARD() { return ssSeedsBO("SeedOptionsView.DISCARD", { button_label: "Discard seed", button_label_color: "red" }); }

    constructor({ seed_num } = {}) {
        super();
        this.seed_num = seed_num;
        this.seed = this.controller.get_seed(this.seed_num);
    }

    async run() {
        const C = SSSeedOptionsView;
        const SC = SSSC();

        if (this.controller.unverified_address) {
            if (this.controller.resume_main_flow === SSController.FLOW__VERIFY_SINGLESIG_ADDR) {
                // Jump straight back into the single sig addr verification flow
                this.controller.resume_main_flow = null;
                return ssSeedsDest(SSSeedAddressVerificationView, { view_args: { seed_num: this.seed_num }, skip_current_view: true });
            }
        }

        if (this.controller.resume_main_flow === SSController.FLOW__ADDRESS_EXPLORER) {
            // Jump straight back into the address explorer script type selection flow
            // But don't cancel the `resume_main_flow` as we'll still need that after
            // derivation path is specified.
            return ssSeedsDest(SSSeedExportXpubScriptTypeView, { view_args: { seed_num: this.seed_num, sig_type: SC.SINGLE_SIG }, skip_current_view: true });
        } else if (this.controller.resume_main_flow === SSController.FLOW__SIGN_MESSAGE) {
            this.controller.sign_message_data["seed_num"] = this.seed_num;
            return ssSeedsDest(SSSeedSignMessageConfirmMessageView, { skip_current_view: true });
        }

        if (this.controller.psbt) {
            let matches = false;
            try {
                matches = await SSPSBTParser.has_matching_input_fingerprint(this.controller.psbt, this.seed, this.settings.get_value(SC.SETTING__NETWORK));
            } catch (e) {
                if (!(e instanceof ReferenceError)) throw e;
            }
            if (matches) {
                if (this.controller.resume_main_flow && this.controller.resume_main_flow === SSController.FLOW__PSBT) {
                    // Re-route us directly back to the start of the PSBT flow
                    this.controller.resume_main_flow = null;
                    this.controller.psbt_seed = this.seed;
                    return ssSeedsDest(ssSeedsExt(() => SSPSBTOverviewView), { skip_current_view: true });
                }
            }
        }

        const button_data = [];
        button_data.push(C.SCAN_PSBT);
        button_data.push(C.EXPORT_XPUB);
        button_data.push(C.EXPLORER);
        button_data.push(C.BACKUP);

        if (this.settings.get_value(SC.SETTING__MESSAGE_SIGNING) === SC.OPTION__ENABLED) {
            button_data.push(C.SIGN_MESSAGE);
        }

        if (this.settings.get_value(SC.SETTING__BIP85_CHILD_SEEDS) === SC.OPTION__ENABLED && this.seed.bip85_supported) {
            button_data.push(C.BIP85_CHILD_SEED);
        }

        button_data.push(C.DISCARD);

        const selected_menu_num = await this.run_screen(SSSeedOptionsScreen, {
            button_data: button_data,
            fingerprint: await this.seed.get_fingerprint(this.settings.get_value(SC.SETTING__NETWORK)),
        });

        if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) {
            // Force BACK to always return to the Main Menu
            return ssSeedsDest(SSMainMenuView);
        }

        const sel = button_data[selected_menu_num];
        if (ssSeedsBtnEq(sel, C.SCAN_PSBT)) {
            this.controller.psbt_seed = this.controller.get_seed(this.seed_num);
            return ssSeedsDest(ssSeedsExt(() => SSScanPSBTView));
        } else if (ssSeedsBtnEq(sel, C.EXPORT_XPUB)) {
            return ssSeedsDest(SSSeedExportXpubSigTypeView, { view_args: { seed_num: this.seed_num } });
        } else if (ssSeedsBtnEq(sel, C.EXPLORER)) {
            this.controller.resume_main_flow = SSController.FLOW__ADDRESS_EXPLORER;
            return ssSeedsDest(SSSeedExportXpubScriptTypeView, { view_args: { seed_num: this.seed_num, sig_type: SC.SINGLE_SIG } });
        } else if (ssSeedsBtnEq(sel, C.SIGN_MESSAGE)) {
            this.controller.sign_message_data = { seed_num: this.seed_num };
            this.controller.resume_main_flow = SSController.FLOW__SIGN_MESSAGE;
            return ssSeedsDest(ssSeedsExt(() => SSScanView));
        } else if (ssSeedsBtnEq(sel, C.BACKUP)) {
            return ssSeedsDest(SSSeedBackupView, { view_args: { seed_num: this.seed_num } });
        } else if (ssSeedsBtnEq(sel, C.BIP85_CHILD_SEED)) {
            return ssSeedsDest(SSSeedBIP85SelectNumWordsView, { view_args: { "seed_num": this.seed_num } });
        } else if (ssSeedsBtnEq(sel, C.DISCARD)) {
            return ssSeedsDest(SSSeedDiscardView, { view_args: { seed_num: this.seed_num } });
        }
    }
}


class SSSeedBackupView extends SSView {
    static get VIEW_WORDS() { return ssSeedsBO("SeedBackupView.VIEW_WORDS", { button_label: "View seed words" }); }
    static get EXPORT_SEEDQR() { return ssSeedsBO("SeedBackupView.EXPORT_SEEDQR", { button_label: "Export as SeedQR" }); }

    constructor({ seed_num } = {}) {
        super();
        this.seed_num = seed_num;
        this.seed = this.controller.get_seed(this.seed_num);
    }

    async run() {
        const C = SSSeedBackupView;
        const button_data = [C.VIEW_WORDS];

        if (this.seed.seedqr_supported) {
            button_data.push(C.EXPORT_SEEDQR);
        }

        const selected_menu_num = await this.run_screen(SSButtonListScreen, {
            title: "Backup Seed",
            button_data: button_data,
            is_bottom_list: true,
        });

        if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) {
            return ssSeedsDest(SSBackStackView);
        } else if (ssSeedsBtnEq(button_data[selected_menu_num], C.VIEW_WORDS)) {
            return ssSeedsDest(SSSeedWordsWarningView, { view_args: { "seed_num": this.seed_num } });
        } else if (ssSeedsBtnEq(button_data[selected_menu_num], C.EXPORT_SEEDQR)) {
            return ssSeedsDest(SSSeedTranscribeSeedQRFormatView, { view_args: { "seed_num": this.seed_num } });
        }
    }
}


/****************************************************************************
    Export Xpub flow
****************************************************************************/
class SSSeedExportXpubSigTypeView extends SSView {
    static get SINGLE_SIG() { return ssSeedsBO("SeedExportXpubSigTypeView.SINGLE_SIG", { button_label: "Single Sig", return_data: SSSC().SINGLE_SIG }); }
    static get MULTISIG() { return ssSeedsBO("SeedExportXpubSigTypeView.MULTISIG", { button_label: "Multisig", return_data: SSSC().MULTISIG }); }

    constructor({ seed_num } = {}) {
        super();
        this.seed_num = seed_num;
    }

    async run() {
        const C = SSSeedExportXpubSigTypeView;
        const SC = SSSC();
        if (this.settings.get_value(SC.SETTING__SIG_TYPES).length === 1) {
            // Nothing to select; skip this screen
            return ssSeedsDest(SSSeedExportXpubScriptTypeView, {
                view_args: { "seed_num": this.seed_num, "sig_type": this.settings.get_value(SC.SETTING__SIG_TYPES)[0] },
                skip_current_view: true,
            });
        }

        const button_data = [C.SINGLE_SIG, C.MULTISIG];

        const selected_menu_num = await this.run_screen(SSButtonListScreen, {
            title: "Export Xpub",
            button_data: button_data,
        });

        if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) {
            return ssSeedsDest(SSBackStackView);
        }

        return ssSeedsDest(SSSeedExportXpubScriptTypeView, { view_args: { "seed_num": this.seed_num, "sig_type": button_data[selected_menu_num].return_data } });
    }
}


class SSSeedExportXpubScriptTypeView extends SSView {
    constructor({ seed_num, sig_type } = {}) {
        super();
        this.seed_num = seed_num;
        this.sig_type = sig_type;
    }

    async run() {
        const SC = SSSC();
        const args = { "seed_num": this.seed_num, "sig_type": this.sig_type };

        let script_types = this.settings.get_value(SC.SETTING__SCRIPT_TYPES);

        const seed = this.controller.storage.seeds[this.seed_num];
        if (seed.script_override) {
            // This seed only allows one script type
            script_types = [seed.script_override];
        }

        if (script_types.length === 1) {
            // Nothing to select; skip this screen
            args["script_type"] = script_types[0];

            if (this.controller.resume_main_flow === SSController.FLOW__ADDRESS_EXPLORER) {
                delete args["sig_type"];
                return ssSeedsDest(ssSeedsExt(() => SSToolsAddressExplorerAddressTypeView), { view_args: args, skip_current_view: true });
            } else {
                return ssSeedsDest(SSSeedExportXpubQRFormatView, { view_args: args, skip_current_view: true });
            }
        }

        let title = "Export Xpub";
        if (this.controller.resume_main_flow === SSController.FLOW__ADDRESS_EXPLORER) {
            title = "Address Explorer";
        }

        const button_data = [];
        for (const [script_type, display_name] of SC.ALL_SCRIPT_TYPES) {
            if (ssSeedsIn(script_type, this.settings.get_value(SC.SETTING__SCRIPT_TYPES))) {
                button_data.push(ssSeedsButtonOption({ button_label: display_name, return_data: script_type }));
            }
        }

        const selected_menu_num = await this.run_screen(SSButtonListScreen, {
            title: title,
            is_button_text_centered: false,
            button_data: button_data,
            is_bottom_list: true,
        });

        if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) {
            // If previous view is SeedOptionsView then that should be where resume_main_flow started (otherwise it would have been skipped).
            const bs = this.controller.back_stack;
            if (bs.length >= 2 && bs[bs.length - 2].View_cls === SSSeedOptionsView) {
                this.controller.resume_main_flow = null;
            }
            return ssSeedsDest(SSBackStackView);
        } else {
            args["script_type"] = button_data[selected_menu_num].return_data;

            if (args["script_type"] === SC.CUSTOM_DERIVATION) {
                return ssSeedsDest(SSSeedExportXpubCustomDerivationView, { view_args: args });
            }

            if (this.controller.resume_main_flow === SSController.FLOW__ADDRESS_EXPLORER) {
                delete args["sig_type"];
                return ssSeedsDest(ssSeedsExt(() => SSToolsAddressExplorerAddressTypeView), { view_args: args });
            } else {
                return ssSeedsDest(SSSeedExportXpubQRFormatView, { view_args: args });
            }
        }
    }
}


class SSSeedExportXpubCustomDerivationView extends SSView {
    constructor({ seed_num, sig_type, script_type } = {}) {
        super();
        this.seed_num = seed_num;
        this.sig_type = sig_type;
        this.script_type = script_type;
        this.custom_derivation_path = "m/";
    }

    async run() {
        const ret = await this.run_screen(SSSeedExportXpubCustomDerivationScreen, {
            initial_value: this.custom_derivation_path,
        });

        if (ret === SS_RET_CODE__BACK_BUTTON) {
            return ssSeedsDest(SSBackStackView);
        }

        // ret will be the custom derivation path
        const custom_derivation = ret;

        if (this.controller.resume_main_flow === SSController.FLOW__ADDRESS_EXPLORER) {
            return ssSeedsDest(ssSeedsExt(() => SSToolsAddressExplorerAddressTypeView), {
                view_args: { seed_num: this.seed_num, script_type: this.script_type, custom_derivation: custom_derivation },
            });
        }

        return ssSeedsDest(SSSeedExportXpubQRFormatView, {
            view_args: {
                "seed_num": this.seed_num,
                "sig_type": this.sig_type,
                "script_type": this.script_type,
                "custom_derivation": custom_derivation,
            },
        });
    }
}


class SSSeedExportXpubQRFormatView extends SSView {
    constructor({ seed_num, sig_type, script_type, custom_derivation = null } = {}) {
        super();
        this.seed_num = seed_num;
        this.sig_type = sig_type;
        this.script_type = script_type;
        this.custom_derivation = custom_derivation;
    }

    async run() {
        const SC = SSSC();
        const args = {
            "seed_num": this.seed_num,
            "sig_type": this.sig_type,
            "script_type": this.script_type,
            "custom_derivation": this.custom_derivation,
        };
        if (this.settings.get_value(SC.SETTING__XPUB_QR_FORMAT).length === 1) {
            // Nothing to select; skip this screen
            args["xpub_qr_format"] = this.settings.get_value(SC.SETTING__XPUB_QR_FORMAT)[0];
            return ssSeedsDest(SSSeedExportXpubWarningView, { view_args: args, skip_current_view: true });
        }

        const button_data = [];
        const names = this.settings.get_multiselect_value_display_names(SC.SETTING__XPUB_QR_FORMAT);
        const values = this.settings.get_value(SC.SETTING__XPUB_QR_FORMAT);
        for (let i = 0; i < Math.min(names.length, values.length); i++) {
            button_data.push(ssSeedsButtonOption({ button_label: names[i], return_data: values[i] }));
        }

        const selected_menu_num = await this.run_screen(SSButtonListScreen, {
            title: "Xpub QR Format",
            is_button_text_centered: false,
            button_data: button_data,
            is_bottom_list: true,
        });

        if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) {
            return ssSeedsDest(SSBackStackView);
        }

        args["xpub_qr_format"] = button_data[selected_menu_num].return_data;

        return ssSeedsDest(SSSeedExportXpubWarningView, { view_args: args });
    }
}


class SSSeedExportXpubWarningView extends SSView {
    constructor({ seed_num, sig_type, script_type, xpub_qr_format, custom_derivation } = {}) {
        super();
        this.seed_num = seed_num;
        this.sig_type = sig_type;
        this.script_type = script_type;
        this.xpub_qr_format = xpub_qr_format;
        this.custom_derivation = custom_derivation;
    }

    async run() {
        const SC = SSSC();
        const destination = ssSeedsDest(SSSeedExportXpubDetailsView, {
            view_args: {
                "seed_num": this.seed_num,
                "sig_type": this.sig_type,
                "script_type": this.script_type,
                "xpub_qr_format": this.xpub_qr_format,
                "custom_derivation": this.custom_derivation,
            },
            skip_current_view: true,  // Prevent going BACK to WarningViews
        });

        if (this.settings.get_value(SC.SETTING__PRIVACY_WARNINGS) === SC.OPTION__DISABLED) {
            // Skip the WarningView entirely
            return destination;
        }

        const selected_menu_num = await this.run_screen(SSWarningScreen, {
            status_headline: "Privacy Leak!",
            text: "Xpub can be used to view all future transactions.",
        });

        if (selected_menu_num === 0) {
            // User clicked "I Understand"
            return destination;
        } else if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) {
            return ssSeedsDest(SSBackStackView);
        }
    }
}


class SSSeedExportXpubDetailsView extends SSView {
    /*
        Collects the user input from all the previous screens leading up to this and
        finally calculates the xpub and displays the summary view to the user.
    */
    constructor({ seed_num, sig_type, script_type, xpub_qr_format, custom_derivation } = {}) {
        super();
        this.sig_type = sig_type;
        this.script_type = script_type;
        this.xpub_qr_format = xpub_qr_format;
        this.custom_derivation = custom_derivation;

        this.seed_num = seed_num;
        this.seed = this.controller.get_seed(this.seed_num);
    }

    async run() {
        const SC = SSSC();
        const seed_derivation_override = this.seed.derivation_override(this.sig_type);
        let derivation_path;
        if (this.script_type === SC.CUSTOM_DERIVATION) {
            derivation_path = this.custom_derivation;
        } else if (seed_derivation_override) {
            derivation_path = seed_derivation_override;
        } else {
            derivation_path = ssSeedsEmbitUtils.get_standard_derivation_path(
                this.settings.get_value(SC.SETTING__NETWORK),
                this.sig_type,
                this.script_type
            );
        }

        let selected_menu_num;
        if (this.settings.get_value(SC.SETTING__XPUB_DETAILS) === SC.OPTION__DISABLED) {
            // We're just skipping right past this screen
            selected_menu_num = 0;
        } else {
            // The derivation calc takes a few moments. Run the loading screen while we wait.
            this.loading_screen = new SSLoadingScreenThread({ text: "Generating xpub..." });
            this.loading_screen.start();

            let fingerprint, xpub_base58;
            try {
                const version = this.seed.detect_version(
                    derivation_path,
                    this.settings.get_value(SC.SETTING__NETWORK),
                    this.sig_type
                );
                await this.seed._ready;
                fingerprint = await fingerprintFromSeed(this.seed.seed_bytes);
                const xpub = await ssSeedsGetXpub(this.seed.seed_bytes, derivation_path);
                xpub_base58 = await xpub.to_string(version);
            } finally {
                await this.loading_screen.stop();
            }

            selected_menu_num = await this.run_screen(SSSeedExportXpubDetailsScreen, {
                fingerprint: fingerprint,
                derivation_path: derivation_path,
                xpub: xpub_base58,
            });
        }

        if (selected_menu_num === 0) {
            return ssSeedsDest(SSSeedExportXpubQRDisplayView, {
                view_args: {
                    seed_num: this.seed_num,
                    xpub_qr_format: this.xpub_qr_format,
                    derivation_path: derivation_path,
                    sig_type: this.sig_type,
                },
            });
        } else if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) {
            return ssSeedsDest(SSBackStackView);
        }
    }
}


class SSSeedExportXpubQRDisplayView extends SSView {
    constructor({ seed_num, xpub_qr_format, derivation_path, sig_type } = {}) {
        super();
        const SC = SSSC();
        if (sig_type === undefined) sig_type = SC.SINGLE_SIG;
        this.seed = this.controller.get_seed(seed_num);

        const encoder_args = {
            seed: this.seed,
            derivation: derivation_path,
            network: this.settings.get_value(SC.SETTING__NETWORK),
            qr_density: this.settings.get_value(SC.SETTING__QR_DENSITY),
            sig_type: sig_type,
        };

        if (xpub_qr_format === SC.XPUB_QR_FORMAT__STATIC) {
            this.qr_encoder = new SSSeedsStaticXpubQrEncoder(encoder_args);
        } else if (xpub_qr_format === SC.XPUB_QR_FORMAT__SPECTER_LEGACY) {
            this.qr_encoder = new SSSeedsSpecterLegacyXPubQrEncoder(encoder_args);
        } else {
            // Default: UR crypto-account
            this.qr_encoder = new SSSeedsUrXpubQrEncoder(encoder_args);
        }
    }

    async run() {
        await this.qr_encoder.prepare();
        await this.run_screen(SSQRDisplayScreen, {
            qr_encoder: this.qr_encoder,
        });

        return ssSeedsDest(SSMainMenuView);
    }
}


/****************************************************************************
    View Seed Words flow
****************************************************************************/
class SSSeedWordsWarningView extends SSView {
    constructor({ seed_num, bip85_data = null } = {}) {
        super();
        this.seed_num = seed_num === undefined ? null : seed_num;
        this.bip85_data = bip85_data;
    }

    async run() {
        const SC = SSSC();
        const destination = ssSeedsDest(SSSeedWordsView, {
            view_args: {
                seed_num: this.seed_num,
                page_index: 0,
                bip85_data: this.bip85_data,
            },
            skip_current_view: true,  // Prevent going BACK to WarningViews
        });
        if (this.settings.get_value(SC.SETTING__DIRE_WARNINGS) === SC.OPTION__DISABLED) {
            // Forward straight to showing the words
            return destination;
        }

        const selected_menu_num = await this.run_screen(SSDireWarningScreen, {
            text: "You must keep your seed words private & away from all online devices.",
        });

        if (selected_menu_num === 0) {
            // User clicked "I Understand"
            return destination;
        } else if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) {
            return ssSeedsDest(SSBackStackView);
        }
    }
}


class SSSeedWordsView extends SSView {
    static get NEXT() { return ssSeedsBO("SeedWordsView.NEXT", { button_label: "Next" }); }
    static get DONE() { return ssSeedsBO("SeedWordsView.DONE", { button_label: "Done" }); }

    constructor({ seed_num, bip85_data = null, page_index = 0 } = {}) {
        super();
        this.seed_num = seed_num === undefined ? null : seed_num;
        if (this.seed_num === null) {
            this.seed = this.controller.storage.get_pending_seed();
        } else {
            this.seed = this.controller.get_seed(this.seed_num);
        }
        this.bip85_data = bip85_data;
        this.page_index = page_index;
    }

    async run() {
        const C = SSSeedWordsView;
        // Slice the mnemonic to our current 4-word section
        const words_per_page = 4;  // TODO: eventually make this configurable for bigger screens?

        let mnemonic, title;
        if (this.bip85_data !== null && this.bip85_data !== undefined) {
            mnemonic = (await this.seed.get_bip85_child_mnemonic(this.bip85_data["child_index"], this.bip85_data["num_words"])).split(" ");
            // Inserts the child index (e.g. "Child #0")
            title = `Child #${this.bip85_data["child_index"]}`;
        } else {
            mnemonic = this.seed.mnemonic_display_list;
            title = "Seed Words";
        }
        const words = mnemonic.slice(this.page_index * words_per_page, (this.page_index + 1) * words_per_page);

        const button_data = [];
        const num_pages = ssSeedsInt(mnemonic.length / words_per_page);
        if (this.page_index < num_pages - 1 || this.seed_num === null) {
            button_data.push(C.NEXT);
        } else {
            button_data.push(C.DONE);
        }

        const selected_menu_num = await this.run_screen(SSSeedWordsScreen, {
            title: `${title}: ${this.page_index + 1}/${num_pages}`,
            words: words,
            page_index: this.page_index,
            num_pages: num_pages,
            button_data: button_data,
        });

        if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) {
            return ssSeedsDest(SSBackStackView);
        }

        if (ssSeedsBtnEq(button_data[selected_menu_num], C.NEXT)) {
            if (this.seed_num === null && this.page_index === num_pages - 1) {
                return ssSeedsDest(SSSeedWordsBackupTestPromptView, {
                    view_args: { seed_num: this.seed_num, bip85_data: this.bip85_data },
                });
            } else {
                return ssSeedsDest(SSSeedWordsView, {
                    view_args: { seed_num: this.seed_num, page_index: this.page_index + 1, bip85_data: this.bip85_data },
                });
            }
        } else if (ssSeedsBtnEq(button_data[selected_menu_num], C.DONE)) {
            // Must clear history to avoid BACK button returning to private info
            return ssSeedsDest(SSSeedWordsBackupTestPromptView, {
                view_args: { seed_num: this.seed_num, bip85_data: this.bip85_data },
            });
        }
    }
}


/****************************************************************************
    BIP-85 - Derive child mnemonic (seed) flow (Application number 39')
****************************************************************************/
class SSSeedBIP85SelectNumWordsView extends SSView {
    static get WORDS_12() { return ssSeedsBO("SeedBIP85SelectNumWordsView.WORDS_12", { button_label: "12 Words" }); }
    static get WORDS_24() { return ssSeedsBO("SeedBIP85SelectNumWordsView.WORDS_24", { button_label: "24 Words" }); }

    constructor({ seed_num } = {}) {
        super();
        this.seed_num = seed_num;
        this.num_words = 0;
    }

    async run() {
        const C = SSSeedBIP85SelectNumWordsView;
        const button_data = [C.WORDS_12, C.WORDS_24];

        const selected_menu_num = await this.run_screen(SSButtonListScreen, {
            title: "BIP-85 Num Words",
            button_data: button_data,
        });

        if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) {
            return ssSeedsDest(SSBackStackView);
        }

        if (ssSeedsBtnEq(button_data[selected_menu_num], C.WORDS_12)) this.num_words = 12;
        else if (ssSeedsBtnEq(button_data[selected_menu_num], C.WORDS_24)) this.num_words = 24;

        return ssSeedsDest(SSSeedBIP85SelectChildIndexView, {
            view_args: { seed_num: this.seed_num, num_words: this.num_words },
        });
    }
}


class SSSeedBIP85SelectChildIndexView extends SSView {
    // View to retrieve the derived seed index
    constructor({ seed_num, num_words } = {}) {
        super();
        this.seed_num = seed_num;
        this.num_words = num_words;
    }

    async run() {
        // TODO: Change this later to use the generic Screen input keyboard
        const ret = await this.run_screen(SSSeedBIP85SelectChildIndexScreen, {});

        if (ret === SS_RET_CODE__BACK_BUTTON) {
            return ssSeedsDest(SSBackStackView);
        }

        // Python int(ret): an empty entry raises ValueError (System Error screen)
        if (!/^\s*[+-]?[0-9]+\s*$/.test(String(ret))) {
            throw new Error(`invalid literal for int() with base 10: '${ret}'`);
        }
        const child_index = parseInt(String(ret), 10);
        if (!(0 <= child_index && child_index < 2 ** 31)) {
            return ssSeedsDest(SSSeedBIP85InvalidChildIndexView, {
                view_args: { seed_num: this.seed_num, num_words: this.num_words },
                skip_current_view: true,
            });
        }

        return ssSeedsDest(SSSeedWordsWarningView, {
            view_args: {
                seed_num: this.seed_num,
                bip85_data: { child_index: child_index, num_words: this.num_words },
            },
        });
    }
}


class SSSeedBIP85InvalidChildIndexView extends SSView {
    constructor({ seed_num, num_words } = {}) {
        super();
        this.seed_num = seed_num;
        this.num_words = num_words;
    }

    async run() {
        await this.run_screen(SSDireWarningScreen, {
            title: "BIP-85 Index Error",
            show_back_button: false,
            status_icon_name: SSSeedSignerIconConstants.ERROR,
            status_headline: "Invalid Child Index",
            text: "BIP-85 Child Index must be between 0 and 2^31-1.",
            button_data: [ssSeedsButtonOption({ button_label: "Try again" })],
        });

        return ssSeedsDest(SSSeedBIP85SelectChildIndexView, {
            view_args: { seed_num: this.seed_num, num_words: this.num_words },
            skip_current_view: true,
        });
    }
}


/****************************************************************************
    Seed Words Backup Test
****************************************************************************/
class SSSeedWordsBackupTestPromptView extends SSView {
    static get VERIFY() { return ssSeedsBO("SeedWordsBackupTestPromptView.VERIFY", { button_label: "Verify" }); }
    static get SKIP() { return ssSeedsBO("SeedWordsBackupTestPromptView.SKIP", { button_label: "Skip" }); }

    constructor({ seed_num, bip85_data = null } = {}) {
        super();
        this.seed_num = seed_num === undefined ? null : seed_num;
        this.bip85_data = bip85_data;
    }

    async run() {
        const C = SSSeedWordsBackupTestPromptView;
        const button_data = [C.VERIFY, C.SKIP];
        const selected_menu_num = await this.run_screen(SSSeedWordsBackupTestPromptScreen, {
            button_data: button_data,
        });

        if (ssSeedsBtnEq(button_data[selected_menu_num], C.VERIFY)) {
            return ssSeedsDest(SSSeedWordsBackupTestView, {
                view_args: { seed_num: this.seed_num, bip85_data: this.bip85_data },
            });
        } else if (ssSeedsBtnEq(button_data[selected_menu_num], C.SKIP)) {
            if (this.seed_num !== null) {
                return ssSeedsDest(SSSeedOptionsView, { view_args: { seed_num: this.seed_num } });
            } else {
                return ssSeedsDest(SSSeedFinalizeView);
            }
        }
    }
}


class SSSeedWordsBackupTestView extends SSView {
    /* Note: `rand_seed` is ONLY USED BY THE SCREENSHOT GENERATOR (ignored here: the engine's ssRandom is used). */
    constructor({ seed_num, bip85_data = null, confirmed_list = null, cur_index = null, rand_seed = null } = {}) {
        super();
        this.seed_num = seed_num === undefined ? null : seed_num;
        if (this.seed_num === null) {
            this.seed = this.controller.storage.get_pending_seed();
        } else {
            this.seed = this.controller.get_seed(this.seed_num);
        }
        this.bip85_data = bip85_data;

        this.confirmed_list = confirmed_list;
        if (!this.confirmed_list || this.confirmed_list.length === 0) {
            this.confirmed_list = [];
        }

        this.cur_index = cur_index;
        this.rand_seed = rand_seed;
    }

    async run() {
        if (this.bip85_data !== null && this.bip85_data !== undefined) {
            this.mnemonic_list = (await this.seed.get_bip85_child_mnemonic(this.bip85_data["child_index"], this.bip85_data["num_words"])).split(" ");
        } else {
            this.mnemonic_list = this.seed.mnemonic_display_list;
        }

        const random = () => ssRandom();   // SIM: VOIDFORGE rule, no browser random-number call (see ssRandom)

        if (this.cur_index === null || this.cur_index === undefined) {
            this.cur_index = ssSeedsInt(random() * this.mnemonic_list.length);
            while (this.confirmed_list.includes(this.cur_index)) {
                this.cur_index = ssSeedsInt(random() * this.mnemonic_list.length);
            }
        }

        const real_word = ssSeedsButtonOptionWithoutTranslation({ button_label: this.mnemonic_list[this.cur_index] });
        const fake_word1 = ssSeedsButtonOptionWithoutTranslation({ button_label: WORDLIST[ssSeedsInt(random() * 2047)] });
        const fake_word2 = ssSeedsButtonOptionWithoutTranslation({ button_label: WORDLIST[ssSeedsInt(random() * 2047)] });
        const fake_word3 = ssSeedsButtonOptionWithoutTranslation({ button_label: WORDLIST[ssSeedsInt(random() * 2047)] });

        const button_data = [real_word, fake_word1, fake_word2, fake_word3];
        // random.shuffle
        for (let i = button_data.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [button_data[i], button_data[j]] = [button_data[j], button_data[i]];
        }

        // Inserts the word number (e.g. "Verify Word #1")
        const title = `Verify Word #${this.cur_index + 1}`;
        const selected_menu_num = await this.run_screen(SSButtonListScreen, {
            title: title,
            show_back_button: false,
            button_data: button_data,
            is_bottom_list: true,
            is_button_text_centered: true,
        });

        if (ssSeedsBtnEq(button_data[selected_menu_num], real_word)) {
            this.confirmed_list.push(this.cur_index);
            if (this.confirmed_list.length === this.mnemonic_list.length) {
                // Successfully confirmed the full mnemonic!
                return ssSeedsDest(SSSeedWordsBackupTestSuccessView, {
                    view_args: { seed_num: this.seed_num },
                });
            } else {
                // Continue testing the remaining words
                return ssSeedsDest(SSSeedWordsBackupTestView, {
                    view_args: { seed_num: this.seed_num, confirmed_list: this.confirmed_list, bip85_data: this.bip85_data },
                });
            }
        } else {
            // Picked the WRONG WORD!
            return ssSeedsDest(SSSeedWordsBackupTestMistakeView, {
                view_args: {
                    seed_num: this.seed_num,
                    bip85_data: this.bip85_data,
                    cur_index: this.cur_index,
                    wrong_word: button_data[selected_menu_num].button_label,
                    confirmed_list: this.confirmed_list,
                },
            });
        }
    }
}


class SSSeedWordsBackupTestMistakeView extends SSView {
    static get REVIEW() { return ssSeedsBO("SeedWordsBackupTestMistakeView.REVIEW", { button_label: "Review seed words" }); }
    static get RETRY() { return ssSeedsBO("SeedWordsBackupTestMistakeView.RETRY", { button_label: "Try again" }); }

    constructor({ seed_num, bip85_data = null, cur_index = null, wrong_word = null, confirmed_list = null } = {}) {
        super();
        this.seed_num = seed_num === undefined ? null : seed_num;
        this.bip85_data = bip85_data;
        this.cur_index = cur_index;
        this.wrong_word = wrong_word;
        this.confirmed_list = confirmed_list;
    }

    async run() {
        const C = SSSeedWordsBackupTestMistakeView;
        const button_data = [C.REVIEW, C.RETRY];

        // Inserts the word number and the word (e.g. "Word #1 is not "apple"!")
        const text = `Word #${this.cur_index + 1} is not "${this.wrong_word}"!`;

        // User selected the wrong word during the mnemonic backup test
        const status_headline = "Wrong Word!";

        const selected_menu_num = await this.run_screen(SSDireWarningScreen, {
            title: "Verification Error",
            show_back_button: false,
            status_icon_name: SSSeedSignerIconConstants.ERROR,
            status_headline: status_headline,
            button_data: button_data,
            text: text,
        });

        if (ssSeedsBtnEq(button_data[selected_menu_num], C.REVIEW)) {
            return ssSeedsDest(SSSeedWordsView, {
                view_args: { seed_num: this.seed_num, bip85_data: this.bip85_data },
            });
        } else if (ssSeedsBtnEq(button_data[selected_menu_num], C.RETRY)) {
            return ssSeedsDest(SSSeedWordsBackupTestView, {
                view_args: {
                    seed_num: this.seed_num,
                    confirmed_list: this.confirmed_list,
                    cur_index: this.cur_index,
                    bip85_data: this.bip85_data,
                },
            });
        }
    }
}


class SSSeedWordsBackupTestSuccessView extends SSView {
    constructor({ seed_num } = {}) {
        super();
        this.seed_num = seed_num === undefined ? null : seed_num;
    }

    async run() {
        await this.run_screen(SSLargeIconStatusScreen, {
            title: "Backup Verified",
            show_back_button: false,
            status_headline: "Success!",
            text: "All mnemonic backup words were successfully verified!",
            button_data: [ssSeedsButtonOption({ button_label: "OK" })],
        });

        if (this.seed_num !== null) {
            return ssSeedsDest(SSSeedOptionsView, { view_args: { seed_num: this.seed_num }, clear_history: true });
        } else {
            return ssSeedsDest(SSSeedFinalizeView);
        }
    }
}


/****************************************************************************
    Export as SeedQR
****************************************************************************/
class SSSeedTranscribeSeedQRFormatView extends SSView {
    // SeedQR dims for 12-word seeds
    static get STANDARD_12() { return ssSeedsBO("SeedTranscribeSeedQRFormatView.STANDARD_12", { button_label: "Standard: 25x25", return_data: 25 }); }
    static get COMPACT_12() { return ssSeedsBO("SeedTranscribeSeedQRFormatView.COMPACT_12", { button_label: "Compact: 21x21", return_data: 21 }); }
    // SeedQR dims for 24-word seeds
    static get STANDARD_24() { return ssSeedsBO("SeedTranscribeSeedQRFormatView.STANDARD_24", { button_label: "Standard: 29x29", return_data: 29 }); }
    static get COMPACT_24() { return ssSeedsBO("SeedTranscribeSeedQRFormatView.COMPACT_24", { button_label: "Compact: 25x25", return_data: 25 }); }

    constructor({ seed_num } = {}) {
        super();
        this.seed_num = seed_num;
    }

    async run() {
        const C = SSSeedTranscribeSeedQRFormatView;
        const SC = SSSC();
        const seed = this.controller.get_seed(this.seed_num);

        if (this.settings.get_value(SC.SETTING__COMPACT_SEEDQR) !== SC.OPTION__ENABLED) {
            // Only configured for standard SeedQR
            return ssSeedsDest(SSSeedTranscribeSeedQRWarningView, {
                view_args: {
                    "seed_num": this.seed_num,
                    "seedqr_format": SSQRType.SEED__SEEDQR,
                    "num_modules": C.STANDARD_12.return_data,
                },
                skip_current_view: true,
            });
        }

        let button_data;
        if (seed.mnemonic_list.length === 12) button_data = [C.STANDARD_12, C.COMPACT_12];
        else button_data = [C.STANDARD_24, C.COMPACT_24];

        const selected_menu_num = await this.run_screen(SSSeedTranscribeSeedQRFormatScreen, {
            title: "SeedQR Format",
            button_data: button_data,
        });

        if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) {
            return ssSeedsDest(SSBackStackView);
        }

        let seedqr_format;
        if (ssSeedsBtnIn(button_data[selected_menu_num], [C.STANDARD_12, C.STANDARD_24])) {
            seedqr_format = SSQRType.SEED__SEEDQR;
        } else {
            seedqr_format = SSQRType.SEED__COMPACTSEEDQR;
        }

        const num_modules = button_data[selected_menu_num].return_data;

        return ssSeedsDest(SSSeedTranscribeSeedQRWarningView, {
            view_args: {
                "seed_num": this.seed_num,
                "seedqr_format": seedqr_format,
                "num_modules": num_modules,
            },
        });
    }
}


class SSSeedTranscribeSeedQRWarningView extends SSView {
    constructor({ seed_num, seedqr_format, num_modules = 29 } = {}) {
        super();
        this.seed_num = seed_num;
        this.seedqr_format = seedqr_format === undefined ? SSQRType.SEED__SEEDQR : seedqr_format;
        this.num_modules = num_modules;
    }

    async run() {
        const SC = SSSC();
        const destination = ssSeedsDest(SSSeedTranscribeSeedQRWholeQRView, {
            view_args: {
                "seed_num": this.seed_num,
                "seedqr_format": this.seedqr_format,
                "num_modules": this.num_modules,
            },
            skip_current_view: true,  // Prevent going BACK to WarningViews
        });

        if (this.settings.get_value(SC.SETTING__DIRE_WARNINGS) === SC.OPTION__DISABLED) {
            // Forward straight to transcribing the SeedQR
            return destination;
        }

        const selected_menu_num = await this.run_screen(SSDireWarningScreen, {
            status_headline: "SeedQR is your private key!",
            text: "Never photograph or scan it into a device that connects to the internet.",
        });

        if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) {
            return ssSeedsDest(SSBackStackView);
        } else {
            // User clicked "I Understand"
            return destination;
        }
    }
}


function ssSeedsSeedQrData(seed, seedqr_format, wordlist_language_code) {
    const encoder_args = { mnemonic: seed.mnemonic_list, wordlist_language_code: wordlist_language_code };
    let e;
    if (seedqr_format === SSQRType.SEED__SEEDQR) e = new SSSeedsSeedQrEncoder(encoder_args);
    else if (seedqr_format === SSQRType.SEED__COMPACTSEEDQR) e = new SSSeedsCompactSeedQrEncoder(encoder_args);
    return e.next_part();
}


class SSSeedTranscribeSeedQRWholeQRView extends SSView {
    constructor({ seed_num, seedqr_format, num_modules } = {}) {
        super();
        this.seed_num = seed_num;
        this.seedqr_format = seedqr_format;
        this.num_modules = num_modules;
        this.seed = this.controller.get_seed(seed_num);
    }

    async run() {
        const data = ssSeedsSeedQrData(this.seed, this.seedqr_format, this.settings.get_value(SSSC().SETTING__WORDLIST_LANGUAGE));

        const ret = await this.run_screen(SSSeedTranscribeSeedQRWholeQRScreen, {
            qr_data: data,
            num_modules: this.num_modules,
        });

        if (ret === SS_RET_CODE__BACK_BUTTON) {
            return ssSeedsDest(SSBackStackView);
        } else {
            return ssSeedsDest(SSSeedTranscribeSeedQRZoomedInView, {
                view_args: {
                    "seed_num": this.seed_num,
                    "seedqr_format": this.seedqr_format,
                },
            });
        }
    }
}


class SSSeedTranscribeSeedQRZoomedInView extends SSView {
    /* initial_zone_x, initial_zone_y: used by the screenshot generator. */
    constructor({ seed_num, seedqr_format, initial_zone_x = 0, initial_zone_y = 0 } = {}) {
        super();
        this.seed_num = seed_num;
        this.seedqr_format = seedqr_format;
        this.seed = this.controller.get_seed(seed_num);
        this.initial_zone_x = initial_zone_x;
        this.initial_zone_y = initial_zone_y;
        this.is_screensaver_allowed = false;
    }

    async run() {
        const data = ssSeedsSeedQrData(this.seed, this.seedqr_format, this.settings.get_value(SSSC().SETTING__WORDLIST_LANGUAGE));

        let num_modules;
        if (this.seed.mnemonic_list.length === 24) {
            num_modules = this.seedqr_format === SSQRType.SEED__COMPACTSEEDQR ? 25 : 29;
        } else {
            num_modules = this.seedqr_format === SSQRType.SEED__COMPACTSEEDQR ? 21 : 25;
        }

        await this.run_screen(SSSeedTranscribeSeedQRZoomedInScreen, {
            qr_data: data,
            num_modules: num_modules,
            initial_zone_x: this.initial_zone_x,
            initial_zone_y: this.initial_zone_y,
        });

        return ssSeedsDest(SSSeedTranscribeSeedQRConfirmQRPromptView, { view_args: { "seed_num": this.seed_num } });
    }
}


class SSSeedTranscribeSeedQRConfirmQRPromptView extends SSView {
    static get SCAN() { return ssSeedsBO("SeedTranscribeSeedQRConfirmQRPromptView.SCAN", { button_label: "Confirm SeedQR", icon_name: SSSeedSignerIconConstants.QRCODE }); }
    static get DONE() { return ssSeedsBO("SeedTranscribeSeedQRConfirmQRPromptView.DONE", { button_label: "Done" }); }

    constructor({ seed_num } = {}) {
        super();
        this.seed_num = seed_num;
        this.seed = this.controller.get_seed(seed_num);
    }

    async run() {
        const C = SSSeedTranscribeSeedQRConfirmQRPromptView;
        const button_data = [C.SCAN, C.DONE];

        const selected_menu_option = await this.run_screen(SSSeedTranscribeSeedQRConfirmQRPromptScreen, {
            title: "Confirm SeedQR?",
            button_data: button_data,
        });

        if (selected_menu_option === SS_RET_CODE__BACK_BUTTON) {
            return ssSeedsDest(SSBackStackView);
        } else if (ssSeedsBtnEq(button_data[selected_menu_option], C.SCAN)) {
            return ssSeedsDest(SSSeedTranscribeSeedQRConfirmScanView, { view_args: { "seed_num": this.seed_num } });
        } else if (ssSeedsBtnEq(button_data[selected_menu_option], C.DONE)) {
            return ssSeedsDest(SSSeedOptionsView, { view_args: { "seed_num": this.seed_num }, clear_history: true });
        }
    }
}


class SSSeedTranscribeSeedQRConfirmScanView extends SSView {
    constructor({ seed_num } = {}) {
        super();
        this.seed_num = seed_num;
        this.seed = this.controller.get_seed(seed_num);
        const wordlist_language_code = this.settings.get_value(SSSC().SETTING__WORDLIST_LANGUAGE);
        // SIM: the camera decoder belongs to the scan part (SSDecodeQR / SSScanScreen).
        this.decoder = (typeof SSDecodeQR !== "undefined") ? new SSDecodeQR({ wordlist_language_code: wordlist_language_code }) : null;
    }

    async run() {
        if (!this.decoder || typeof SSScanScreen === "undefined") {
            return ssSeedsDest(SSNotYetImplementedView);
        }
        // SIM: VOIDFORGE rule: the page reads seed QR codes only while the computer is offline
        if (typeof ssToolsSeedScanBlocked === "function" && ssToolsSeedScanBlocked()) return ssToolsOfflineOnlyDest();

        // Run the live preview and QR code capture process
        const scanning_done = await this.run_screen(SSScanScreen, {
            decoder: this.decoder,
            instructions_text: "Scan your SeedQR",
        });

        // If the scanning was canceled because the back button was pressed, return to
        // BackStackView (SeedTranscribeSeedQRConfirmQRPromptView).
        if (scanning_done === false) {
            return ssSeedsDest(SSBackStackView, { skip_current_view: false });
        }

        if (this.decoder.is_complete) {
            if (this.decoder.is_seed) {
                const seed_mnemonic = this.decoder.get_seed_phrase();
                // Found a valid mnemonic seed! But does it match?
                const same = Array.isArray(seed_mnemonic) && seed_mnemonic.length === this.seed.mnemonic_list.length &&
                    seed_mnemonic.every((w, i) => w === this.seed.mnemonic_list[i]);
                if (!same) {
                    return ssSeedsDest(SSSeedTranscribeSeedQRConfirmWrongSeedView, { skip_current_view: true });
                } else {
                    return ssSeedsDest(SSSeedTranscribeSeedQRConfirmSuccessView, { view_args: { "seed_num": this.seed_num } });
                }
            }
        }

        // Will trigger if a different kind of QR code is scanned (non SeedQR)
        return ssSeedsDest(SSSeedTranscribeSeedQRConfirmInvalidQRView, { skip_current_view: true });
    }
}


class SSSeedTranscribeSeedQRConfirmWrongSeedView extends SSView {
    /* A valid SeedQR was scanned but it did NOT match the one we just transcribed! */
    async run() {
        await this.run_screen(SSDireWarningScreen, {
            title: "Confirm SeedQR",
            status_headline: "Error!",
            text: "Your transcribed SeedQR does not match your original seed!",
            show_back_button: false,
            button_data: [ssSeedsButtonOption({ button_label: "Review SeedQR" })],
        });

        // Skip BACK to the zoomed in transcription view
        return ssSeedsDest(SSBackStackView, { skip_current_view: true });
    }
}


class SSSeedTranscribeSeedQRConfirmInvalidQRView extends SSView {
    /* A QR code was scanned but it was not a SeedQR. */
    async run() {
        await this.run_screen(SSDireWarningScreen, {
            title: "Confirm SeedQR",
            status_headline: "Error!",
            text: "Your transcribed SeedQR could not be read!",
            show_back_button: false,
            button_data: [ssSeedsButtonOption({ button_label: "Review SeedQR" })],
        });

        // Skip BACK to the zoomed in transcription view
        return ssSeedsDest(SSBackStackView, { skip_current_view: true });
    }
}


class SSSeedTranscribeSeedQRConfirmSuccessView extends SSView {
    /* The SeedQR we just scanned matched the one we just transcribed. */
    constructor({ seed_num } = {}) {
        super();
        this.seed_num = seed_num;
    }

    async run() {
        await this.run_screen(SSLargeIconStatusScreen, {
            title: "Confirm SeedQR",
            status_headline: "Success!",
            text: "Your transcribed SeedQR successfully scanned and yielded the same seed.",
            show_back_button: false,
            button_data: [ssSeedsButtonOption({ button_label: "OK" })],
        });

        return ssSeedsDest(SSSeedOptionsView, { view_args: { "seed_num": this.seed_num } });
    }
}


/****************************************************************************
    Address verification
****************************************************************************/
class SSAddressVerificationStartView extends SSView {
    constructor({ address, script_type, network } = {}) {
        super();
        this.controller.unverified_address = {
            address: address,
            script_type: script_type,
            network: network,
        };
    }

    async run() {
        const SC = SSSC();
        const ua = this.controller.unverified_address;
        let sig_type, destination;

        if (ua["script_type"] === SC.LEGACY_P2PKH) {
            // Legacy P2PKH addresses are always singlesig
            sig_type = SC.SINGLE_SIG;
            destination = ssSeedsDest(SSSeedSelectSeedView, { view_args: { flow: SSController.FLOW__VERIFY_SINGLESIG_ADDR }, skip_current_view: true });
        }

        if (ua["script_type"] === SC.NESTED_SEGWIT) {
            // No way to differentiate single sig from multisig
            return ssSeedsDest(SSAddressVerificationSigTypeView, { skip_current_view: true });
        }

        if (ua["script_type"] === SC.NATIVE_SEGWIT) {
            if (ua["address"].length >= 62) {
                // Mainnet/testnet are 62, regtest is 64
                sig_type = SC.MULTISIG;
                if (this.controller.multisig_wallet_descriptor) {
                    // Can jump straight to the brute-force verification View
                    destination = ssSeedsDest(SSSeedAddressVerificationView, { skip_current_view: true });
                } else {
                    this.controller.resume_main_flow = SSController.FLOW__VERIFY_MULTISIG_ADDR;
                    destination = ssSeedsDest(SSLoadMultisigWalletDescriptorView, { skip_current_view: true });
                }
            } else {
                sig_type = SC.SINGLE_SIG;
                destination = ssSeedsDest(SSSeedSelectSeedView, { view_args: { flow: SSController.FLOW__VERIFY_SINGLESIG_ADDR }, skip_current_view: true });
            }
        } else if (ua["script_type"] === SC.TAPROOT) {
            sig_type = SC.SINGLE_SIG;
            destination = ssSeedsDest(SSSeedSelectSeedView, { view_args: { flow: SSController.FLOW__VERIFY_SINGLESIG_ADDR }, skip_current_view: true });
        }

        const derivation_path = ssSeedsEmbitUtils.get_standard_derivation_path(ua["network"], sig_type, ua["script_type"]);

        ua["sig_type"] = sig_type;
        ua["derivation_path"] = derivation_path;

        return destination;
    }
}


class SSAddressVerificationSigTypeView extends SSView {
    static get SINGLE_SIG() { return ssSeedsBO("AddressVerificationSigTypeView.SINGLE_SIG", { button_label: "Single Sig" }); }
    static get MULTISIG() { return ssSeedsBO("AddressVerificationSigTypeView.MULTISIG", { button_label: "Multisig" }); }

    async run() {
        const C = SSAddressVerificationSigTypeView;
        const SC = SSSC();
        const button_data = [C.SINGLE_SIG, C.MULTISIG];
        const selected_menu_num = await this.run_screen(SSAddressVerificationSigTypeScreen, {
            title: "Verify Address",
            text: "Sig type can't be auto-detected from this address. Please specify:",
            button_data: button_data,
            is_bottom_list: true,
        });

        let sig_type, destination;
        if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) {
            this.controller.unverified_address = null;
            return ssSeedsDest(SSBackStackView);
        } else if (ssSeedsBtnEq(button_data[selected_menu_num], C.SINGLE_SIG)) {
            sig_type = SC.SINGLE_SIG;
            destination = ssSeedsDest(SSSeedSelectSeedView, { view_args: { flow: SSController.FLOW__VERIFY_SINGLESIG_ADDR } });
        } else if (ssSeedsBtnEq(button_data[selected_menu_num], C.MULTISIG)) {
            sig_type = SC.MULTISIG;
            if (this.controller.multisig_wallet_descriptor) {
                destination = ssSeedsDest(SSSeedAddressVerificationView);
            } else {
                this.controller.resume_main_flow = SSController.FLOW__VERIFY_MULTISIG_ADDR;
                destination = ssSeedsDest(SSLoadMultisigWalletDescriptorView);
            }
        }

        this.controller.unverified_address["sig_type"] = sig_type;
        const derivation_path = ssSeedsEmbitUtils.get_standard_derivation_path(
            this.controller.unverified_address["network"],
            sig_type,
            this.controller.unverified_address["script_type"]
        );
        this.controller.unverified_address["derivation_path"] = derivation_path;

        return destination;
    }
}


class SSSeedAddressVerificationView extends SSView {
    /*
        Creates a worker "thread" (async loop) to brute-force calculate addresses. Writes its
        iteration status to a shared counter that the Screen's ProgressThread displays.
        Performs single sig verification on `seed_num` if specified, otherwise multisig.
    */
    // Option when scanning for a matching address; skips ten addresses ahead
    static get SKIP_10() { return ssSeedsBO("SeedAddressVerificationView.SKIP_10", { button_label: "Skip 10" }); }
    static get CANCEL() { return ssSeedsBO("SeedAddressVerificationView.CANCEL", { button_label: "Cancel" }); }

    constructor({ seed_num = null } = {}) {
        super();
        const SC = SSSC();
        this.seed_num = seed_num;
        this.is_multisig = this.controller.unverified_address["sig_type"] === SC.MULTISIG;
        this.seed_derivation_override = "";
        if (!this.is_multisig) {
            if (seed_num === null || seed_num === undefined) {
                // Shouldn't be able to get here
                throw new Error("Can't validate a single sig addr without specifying a seed");
            }
            this.seed_num = seed_num;
            this.seed = this.controller.get_seed(seed_num);
            this.seed_derivation_override = this.seed.derivation_override(SC.SINGLE_SIG);
        } else {
            this.seed = null;
        }
        this.address = this.controller.unverified_address["address"];
        this.derivation_path = this.seed_derivation_override ? this.seed_derivation_override : this.controller.unverified_address["derivation_path"];
        this.script_type = this.controller.unverified_address["script_type"];
        this.sig_type = this.controller.unverified_address["sig_type"];
        this.network = this.controller.unverified_address["network"];

        // TODO: This should be in `Seed` or `PSBT` utility class
        const embit_network = ssSeedsEmbitNetwork(this.network);

        // Shared counter: current addr index; the Screen shows it and "Skip 10" bumps it.
        this.threadsafe_counter = new SSThreadsafeCounter();

        // Shared coordination var so the display thread can detect success
        this.verified_index = new SSThreadsafeCounter(null);
        this.verified_index_is_change = new SSThreadsafeCounter(null);

        // Create the brute-force calculation thread that will run in the background
        this.addr_verification_thread = new SSSeedAddressVerificationView.BruteForceAddressVerificationThread({
            address: this.address,
            seed: this.seed,
            descriptor: this.controller.multisig_wallet_descriptor,
            script_type: this.script_type,
            embit_network: embit_network,
            derivation_path: this.derivation_path,
            threadsafe_counter: this.threadsafe_counter,
            verified_index: this.verified_index,
            verified_index_is_change: this.verified_index_is_change,
        });
    }

    async run() {
        const C = SSSeedAddressVerificationView;
        const SC = SSSC();
        // Start brute-force calculations from the zero-th index
        try {
            this.addr_verification_thread.start();

            const button_data = [C.SKIP_10, C.CANCEL];

            const script_type_settings_entry = SSSettingsDefinition.get_settings_entry(SC.SETTING__SCRIPT_TYPES);
            const script_type_display = script_type_settings_entry.get_selection_option_display_name_by_value(this.script_type);

            const sig_type_settings_entry = SSSettingsDefinition.get_settings_entry(SC.SETTING__SIG_TYPES);
            const sig_type_display = sig_type_settings_entry.get_selection_option_display_name_by_value(this.sig_type);

            const network_settings_entry = SSSettingsDefinition.get_settings_entry(SC.SETTING__NETWORK);
            const network_display = network_settings_entry.get_selection_option_display_name_by_value(this.network);
            const mainnet = network_settings_entry.get_selection_option_display_name_by_value(SC.MAINNET);

            // Display the Screen to show the brute-forcing progress. The loop handles the
            // SKIP_10 button presses: increment the counter and show the screen again.
            for (;;) {
                const selected_menu_num = await this.run_screen(SSSeedAddressVerificationScreen, {
                    address: this.address,
                    derivation_path: this.derivation_path,
                    script_type: script_type_display,
                    sig_type: sig_type_display,
                    network: network_display,
                    is_mainnet: network_display === mainnet,
                    threadsafe_counter: this.threadsafe_counter,
                    verified_index: this.verified_index,
                    button_data: button_data,
                });

                if (this.verified_index.cur_count !== null) break;

                if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) break;

                if (selected_menu_num === null || selected_menu_num === undefined) {
                    await ssSeedsSleep(100);
                    continue;
                }

                if (ssSeedsBtnEq(button_data[selected_menu_num], C.SKIP_10)) {
                    this.threadsafe_counter.increment(10);
                } else if (ssSeedsBtnEq(button_data[selected_menu_num], C.CANCEL)) {
                    break;
                }
            }

            if (this.verified_index.cur_count !== null) {
                // Successfully verified the addr; update the data
                this.controller.unverified_address["verified_index"] = this.verified_index.cur_count;
                this.controller.unverified_address["verified_index_is_change"] = this.verified_index_is_change.cur_count === 1;
                return ssSeedsDest(SSSeedAddressVerificationSuccessView, { view_args: { seed_num: this.seed_num } });
            }
        } finally {
            // Halt the thread if the user gave up (will already be stopped if it verified the target addr).
            this.addr_verification_thread.stop();
            // Block until the thread has stopped
            await this.addr_verification_thread.join();
        }

        return ssSeedsDest(SSMainMenuView);
    }
}
SSSeedAddressVerificationView.BruteForceAddressVerificationThread = class BruteForceAddressVerificationThread extends SSSeedsThread {
    constructor({ address, seed, descriptor, script_type, embit_network, derivation_path, threadsafe_counter, verified_index, verified_index_is_change }) {
        // Either seed or descriptor will be None
        super();
        this.address = address;
        this.seed = seed;
        this.descriptor = descriptor;
        this.script_type = script_type;
        this.embit_network = embit_network;
        this.derivation_path = derivation_path;
        this.threadsafe_counter = threadsafe_counter;
        this.verified_index = verified_index;
        this.verified_index_is_change = verified_index_is_change;
    }

    async run() {
        const U = ssSeedsEmbitUtils;
        if (this.seed) {
            // Python does this in __init__; it is async here
            this.xpub = await this.seed.get_xpub(this.derivation_path, SSSettings.get_instance().get_value(SSSC().SETTING__NETWORK));
        }
        while (this.keep_running) {
            const i = this.threadsafe_counter.cur_count;
            let receive_address, change_address;

            if (this.descriptor) {
                receive_address = await U.get_multisig_address(this.descriptor, i, false, this.embit_network);
                change_address = await U.get_multisig_address(this.descriptor, i, true, this.embit_network);
            } else {
                receive_address = await U.get_single_sig_address(this.xpub, this.script_type, i, false, this.embit_network);
                change_address = await U.get_single_sig_address(this.xpub, this.script_type, i, true, this.embit_network);
            }

            if (this.address === receive_address) {
                this.verified_index.set_value(i);
                this.verified_index_is_change.set_value(0);
                this.keep_running = false;
                break;
            } else if (this.address === change_address) {
                this.verified_index.set_value(i);
                this.verified_index_is_change.set_value(1);
                this.keep_running = false;
                break;
            }

            // Increment our index counter
            this.threadsafe_counter.increment();

            // SIM: let the screen and input handlers run between rounds
            await ssSeedsSleep(0);
        }
    }
};


class SSSeedAddressVerificationSuccessView extends SSView {
    constructor({ seed_num = null } = {}) {
        super();
        this.seed_num = seed_num;
        if (this.seed_num !== null && this.seed_num !== undefined) {
            this.seed = this.controller.get_seed(seed_num);
        }
    }

    async run() {
        await this.run_screen(SSSeedAddressVerificationSuccessScreen, {
            address: this.controller.unverified_address["address"],
            verified_index: this.controller.unverified_address["verified_index"],
            verified_index_is_change: this.controller.unverified_address["verified_index_is_change"],
        });

        return ssSeedsDest(SSMainMenuView);
    }
}


class SSLoadMultisigWalletDescriptorView extends SSView {
    static get SCAN() { return ssSeedsBO("LoadMultisigWalletDescriptorView.SCAN", { button_label: "Scan descriptor", icon_name: SSSeedSignerIconConstants.QRCODE }); }
    static get CANCEL() { return ssSeedsBO("LoadMultisigWalletDescriptorView.CANCEL", { button_label: "Cancel" }); }

    async run() {
        const C = SSLoadMultisigWalletDescriptorView;
        const button_data = [C.SCAN, C.CANCEL];
        const selected_menu_num = await this.run_screen(SSLoadMultisigWalletDescriptorScreen, {
            button_data: button_data,
            show_back_button: false,
        });

        if (ssSeedsBtnEq(button_data[selected_menu_num], C.SCAN)) {
            return ssSeedsDest(ssSeedsExt(() => SSScanWalletDescriptorView));
        } else if (ssSeedsBtnEq(button_data[selected_menu_num], C.CANCEL)) {
            if (this.controller.resume_main_flow === SSController.FLOW__PSBT) {
                return ssSeedsDest(SSBackStackView);
            } else {
                return ssSeedsDest(SSMainMenuView);
            }
        }
    }
}


class SSMultisigWalletDescriptorView extends SSView {
    static get RETURN() { return ssSeedsBO("MultisigWalletDescriptorView.RETURN", { button_label: "Return to transaction" }); }
    static get VERIFY_ADDR() { return ssSeedsBO("MultisigWalletDescriptorView.VERIFY_ADDR", { button_label: "Verify addr" }); }
    static get ADDRESS_EXPLORER() { return ssSeedsBO("MultisigWalletDescriptorView.ADDRESS_EXPLORER", { button_label: "Address explorer" }); }
    static get OK() { return ssSeedsBO("MultisigWalletDescriptorView.OK", { button_label: "OK" }); }

    async run() {
        const C = SSMultisigWalletDescriptorView;
        const descriptor = this.controller.multisig_wallet_descriptor;

        // descriptor.keys[i].fingerprint (embit) or descriptor.cosigners[i].fp (VOIDFORGE)
        const fingerprints = [];
        const keys = descriptor.keys || descriptor.cosigners || [];
        for (const key of keys) {
            let fingerprint = key.fingerprint !== undefined ? key.fingerprint : key.fp;
            if (fingerprint instanceof Uint8Array) fingerprint = ssSeedsBytesToHex(fingerprint);
            fingerprints.push(String(fingerprint).toLowerCase());
        }

        const [threshold, n] = ssSeedsEmbitUtils.get_multisig_policy(descriptor);
        // Multisig policy. For a "2 of 3" policy, "threshold" = 2; "n" = 3
        const policy = `${threshold} of ${n}`;

        let button_data = [C.OK];
        if (this.controller.resume_main_flow) {
            if (this.controller.resume_main_flow === SSController.FLOW__PSBT) {
                button_data = [C.RETURN];
            } else if (this.controller.resume_main_flow === SSController.FLOW__VERIFY_MULTISIG_ADDR && this.controller.unverified_address) {
                const verify_addr_display = `${C.VERIFY_ADDR.button_label} ${this.controller.unverified_address["address"].slice(0, 7)}`;
                button_data = [ssSeedsButtonOption({ button_label: verify_addr_display })];
            } else if (this.controller.resume_main_flow === SSController.FLOW__ADDRESS_EXPLORER) {
                button_data = [C.ADDRESS_EXPLORER];
            }
        }

        const selected_menu_num = await this.run_screen(SSMultisigWalletDescriptorScreen, {
            policy: policy,
            fingerprints: fingerprints,
            button_data: button_data,
        });

        if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) {
            this.controller.multisig_wallet_descriptor = null;
            return ssSeedsDest(SSBackStackView);
        } else if (ssSeedsBtnEq(button_data[selected_menu_num], C.RETURN)) {
            // Jump straight back to PSBT change verification
            this.controller.resume_main_flow = null;
            return ssSeedsDest(ssSeedsExt(() => SSPSBTChangeDetailsView), { view_args: { change_address_num: 0 } });
        } else if (button_data[selected_menu_num].button_label.startsWith(C.VERIFY_ADDR.button_label)) {
            this.controller.resume_main_flow = null;
            return ssSeedsDest(SSSeedAddressVerificationView);
        } else if (ssSeedsBtnEq(button_data[selected_menu_num], C.ADDRESS_EXPLORER)) {
            this.controller.resume_main_flow = null;
            return ssSeedsDest(ssSeedsExt(() => SSToolsAddressExplorerAddressTypeView));
        }

        return ssSeedsDest(SSMainMenuView);
    }
}


/****************************************************************************
    Sign Message Views
****************************************************************************/
class SSSeedSignMessageStartView extends SSView {
    /*
    Routes users straight through to the "Sign" screen if a signing `seed_num` has
    already been selected. Otherwise routes to `SeedSelectSeedView` to select or load a seed first.
    */
    constructor({ derivation_path, message } = {}) {
        super();
        const SC = SSSC();
        this.derivation_path = derivation_path;
        this.message = message;

        if (this.settings.get_value(SC.SETTING__MESSAGE_SIGNING) === SC.OPTION__DISABLED) {
            this.set_redirect(ssSeedsDest(SSOptionDisabledView, { view_args: { settings_attr: SC.SETTING__MESSAGE_SIGNING } }));
            return;
        }

        // calculate the actual receive address
        const addr_format = ssSeedsEmbitUtils.parse_derivation_path(derivation_path);
        if (!addr_format["clean_match"]) {
            this.set_redirect(ssSeedsDest(SSNotYetImplementedView, { view_args: { text: "Signing messages for custom derivation paths not supported" } }));
            this.controller.resume_main_flow = null;
            return;
        }

        // Note: addr_format["network"] can be MAINNET or [TESTNET, REGTEST]
        if (!ssSeedsIn(this.settings.get_value(SC.SETTING__NETWORK), addr_format["network"])) {
            this.set_redirect(ssSeedsDest(SSNetworkMismatchErrorView, { view_args: { derivation_path: this.derivation_path } }));
            // cleanup. Note: We could leave this in place so the user can resume the
            // flow, but for now we avoid complications and keep things simple.
            this.controller.resume_main_flow = null;
            return;
        }

        let data = this.controller.sign_message_data;
        if (!data) {
            data = {};
            this.controller.sign_message_data = data;
        }
        data["derivation_path"] = derivation_path;
        data["message"] = message;
        data["addr_format"] = addr_format;

        // May be None
        this.seed_num = data["seed_num"] === undefined ? null : data["seed_num"];

        if (this.seed_num !== null) {
            // We already know which seed we're signing with
            this.set_redirect(ssSeedsDest(SSSeedSignMessageConfirmMessageView, { skip_current_view: true }));
        } else {
            this.set_redirect(ssSeedsDest(SSSeedSelectSeedView, { view_args: { flow: SSController.FLOW__SIGN_MESSAGE }, skip_current_view: true }));
        }
    }

    async run() {
        // Python's View.run() raises when not overridden; every path above sets a redirect.
        throw new Error("Must implement in the child class");
    }
}


class SSSeedSignMessageConfirmMessageView extends SSView {
    constructor({ page_num = 0 } = {}) {
        super();
        this.page_num = page_num;  // Note: zero-indexed numbering!
    }

    async run() {
        const selected_menu_num = await this.run_screen(SSSeedSignMessageConfirmMessageScreen, {
            page_num: this.page_num,
        });

        if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) {
            if (this.page_num === 0) {
                // We're exiting this flow entirely
                this.controller.resume_main_flow = null;
                this.controller.sign_message_data = null;
            }
            return ssSeedsDest(SSBackStackView);
        }

        // User clicked "Next"
        if (this.page_num === this.controller.sign_message_data["paged_message"].length - 1) {
            // We've reached the end of the paged message
            return ssSeedsDest(SSSeedSignMessageConfirmAddressView);
        } else {
            return ssSeedsDest(SSSeedSignMessageConfirmMessageView, { view_args: { page_num: this.page_num + 1 } });
        }
    }
}


class SSSeedSignMessageConfirmAddressView extends SSView {
    constructor() {
        super();
        const SC = SSSC();
        const data = this.controller.sign_message_data;
        const seed_num = data["seed_num"] === undefined ? null : data["seed_num"];
        this.derivation_path = data["derivation_path"];

        if (seed_num === null || !this.derivation_path) {
            throw new Error("Routing error: sign_message_data hasn't been set");
        }

        // calculate the actual receive address
        this._ss_seed = this.controller.storage.seeds[seed_num];
        const addr_format = ssSeedsEmbitUtils.parse_derivation_path(this.derivation_path);
        if (!addr_format["clean_match"] || addr_format["script_type"] === SC.CUSTOM_DERIVATION) {
            throw new Error("Signing messages for custom derivation paths not supported");
        }

        if (addr_format["network"] !== SC.MAINNET) {
            // We're in either Testnet or Regtest or...?
            if ([SC.TESTNET, SC.REGTEST].includes(this.settings.get_value(SC.SETTING__NETWORK))) {
                addr_format["network"] = this.settings.get_value(SC.SETTING__NETWORK);
            } else {
                this.set_redirect(ssSeedsDest(SSNetworkMismatchErrorView, { view_args: { derivation_path: this.derivation_path } }));
                // cleanup. Note: We could leave this in place so the user can resume the
                // flow, but for now we avoid complications and keep things simple.
                this.controller.resume_main_flow = null;
                this.controller.sign_message_data = null;
                return;
            }
        }
        this._ss_addr_format = addr_format;
    }

    async run() {
        // Python computes the address in __init__ (async here)
        const addr_format = this._ss_addr_format;
        const xpub = await this._ss_seed.get_xpub(addr_format["wallet_derivation_path"], addr_format["network"]);
        const embit_network = ssSeedsEmbitUtils.get_embit_network_name(addr_format["network"]);
        this.address = await ssSeedsEmbitUtils.get_single_sig_address(xpub, addr_format["script_type"], addr_format["index"], addr_format["is_change"], embit_network);

        const selected_menu_num = await this.run_screen(SSSeedSignMessageConfirmAddressScreen, {
            derivation_path: this.derivation_path,
            address: this.address,
        });

        if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) {
            return ssSeedsDest(SSBackStackView);
        }

        // User clicked "Sign Message"
        return ssSeedsDest(SSSeedSignMessageSignedMessageQRView);
    }
}


class SSSeedSignMessageSignedMessageQRView extends SSView {
    /* Displays the signed message as a QR code. */
    constructor() {
        super();
        const data = this.controller.sign_message_data;
        this.seed_num = data["seed_num"];
        this._ss_seed = this.controller.get_seed(this.seed_num);
        this._ss_derivation_path = data["derivation_path"];
        this._ss_message = data["message"];
    }

    async run() {
        // Python signs in __init__ (async here)
        await this._ss_seed._ready;
        // SIM: VOIDFORGE rule (v2.17.0, ssOwnSignGate in ss_own.js): a seed that is not public signs a message while this computer is
        // online only after a yes to the page's question
        if (typeof ssOwnSignGate === "function") {
            const stop = await ssOwnSignGate("msg", this._ss_seed, null, (this.settings || SSSettings.get_instance()).get_value(SSSC().SETTING__NETWORK));
            if (stop) return stop;
        }
        this.signed_message = await ssSeedsEmbitUtils.sign_message(this._ss_seed.seed_bytes, this._ss_derivation_path, this._ss_message);

        const qr_encoder = new SSSeedsGenericStaticQrEncoder({ data: this.signed_message });

        await this.run_screen(SSQRDisplayScreen, {
            qr_encoder: qr_encoder,
        });

        // cleanup
        this.controller.resume_main_flow = null;
        this.controller.sign_message_data = null;

        // Exiting/Canceling the QR display screen always returns Home
        return ssSeedsDest(SSMainMenuView, { skip_current_view: true });
    }
}
