/*
 * ss_engine.js -- browser port of the SeedSigner 0.8.7 UI engine
 * (SeedSigner commit e0a80d4b33b8eb7fb1e9fd14a27b7cd11c7d2cd6, MIT License, Copyright (c) 2021 SeedSigner).
 *
 * Contents (Python source -> JS):
 *   PIL subset (Image/ImageDraw/ImageFont/ImageColor/ImageFilter) -> SSImage, SSImageDraw, SSFont, SSImageColor, SSImageFilter
 *   gui/components.py      -> SSGUIConstants, SSFontAwesomeIconConstants, SSSeedSignerIconConstants, SSFonts, SSTextArea, ...
 *   gui/keyboard.py        -> SSKeyboard, SSTextEntryDisplay
 *   gui/toast.py           -> SSToastOverlay, SSBaseToastOverlayManagerThread, SSDefaultToast, ...
 *   gui/renderer.py        -> SSRenderer
 *   gui/screens/screen.py  -> SSBaseScreen, SSButtonListScreen, SSLargeButtonScreen, SSQRDisplayScreen, ...
 *   hardware/buttons.py    -> SSHardwareButtons, SSHardwareButtonsConstants
 *   hardware/microsd.py    -> SSMicroSD (SIM)
 *   models/threads.py      -> SSBaseThread, SSThreadsafeCounter
 *   models/encode_qr.py    -> SSBaseQrEncoder, SSBaseStaticQrEncoder (base classes only); helpers/qr.py -> SSQR
 *   views/view.py          -> SSView, SSDestination, SSBackStackView, SSMainMenuView, ...
 *   views/screensaver.py   -> SSOpeningSplashView, SSOpeningSplashScreen, SSScreensaverScreen
 *   controller.py          -> SSController (main loop / back stack), SSController.start(canvas), SSController.press(key)
 *
 * Porting conventions (see BRIEF.md): Python snake_case field names are kept; dataclass constructors take ONE object
 * of fields; `__post_init__()` is kept as a method; blocking calls become `await`; threads are async loops.
 * Requires ss_fonts.js (SS_FONT_DATA) loaded first. Plain ES2020, no imports, no network.
 */
"use strict";

/* =====================================================================================================
 * Core helpers
 * ===================================================================================================== */

// Device pixels per logical (PIL) pixel. Set by SSController.start() from devicePixelRatio.
let SS_SCALE = 2;
// Run generation: bumped on (re)start so every pending sleep/wait of the previous run aborts.
let SS_GEN = 0;

class SSAbort extends Error {
    constructor() { super("SeedSigner run aborted (restart)"); this.name = "SSAbort"; }
}

// time.sleep(seconds) -> await ssSleep(seconds)
function ssSleep(seconds) {
    const gen = SS_GEN;
    return new Promise((resolve, reject) => {
        setTimeout(() => (gen === SS_GEN ? resolve() : reject(new SSAbort())), Math.max(0, seconds * 1000));
    });
}

// Python random.random() stand-in. SIM (VOIDFORGE rule): the page never calls the browser's random-number generator
// (VOIDFORGE keys come from dice only), so SeedSigner's few non-secret uses of `random` (screensaver path, backup-test
// word order and decoy words) use this small xorshift generator, seeded from the clock.
let _ss_rand_state = 0;
function ssRandom() {
    if (!_ss_rand_state) {
        const t = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
        _ss_rand_state = ((Date.now() ^ Math.floor(t * 1000)) >>> 0) || 0x9e3779b9;
    }
    let x = _ss_rand_state;
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    _ss_rand_state = x;
    return x / 4294967296;
}

// time.time() (seconds, float) and time.time_ns()
function ssTime() { return Date.now() / 1000; }
function ssTimeNs() { return Date.now() * 1e6; }

// Python int(x): truncate toward zero
function ssInt(x) { return Math.trunc(x); }

// Marks a dataclass default that must be produced fresh for each instance: field(default_factory=...)
class SSFactory { constructor(fn) { this.fn = fn; } }
function ssFactory(fn) { return new SSFactory(fn); }

const _ss_fields_cache = new WeakMap();
// Collects `static get _fields()` defaults along the class chain, base first (dataclass field inheritance order).
function ssCollectFields(cls) {
    if (_ss_fields_cache.has(cls)) return _ss_fields_cache.get(cls);
    const chain = [];
    let c = cls;
    while (c && c !== Function.prototype) {
        const d = Object.getOwnPropertyDescriptor(c, "_fields");
        if (d && d.get) chain.unshift(d.get.call(c));
        c = Object.getPrototypeOf(c);
    }
    const out = {};
    for (const f of chain) Object.assign(out, f);
    _ss_fields_cache.set(cls, out);
    return out;
}

// Applies dataclass defaults then the caller's fields (undefined = "not passed").
function ssInitFields(obj, fields) {
    const defaults = ssCollectFields(obj.constructor);
    for (const k of Object.keys(defaults)) {
        let v = defaults[k];
        if (v instanceof SSFactory) v = v.fn();
        obj[k] = v;
    }
    if (fields) {
        for (const k of Object.keys(fields)) {
            if (fields[k] !== undefined) obj[k] = fields[k];
        }
    }
}

/*
 * Root of every ported dataclass: `new X({field: value})` assigns defaults + fields, then runs `__post_init__()`.
 * Subclasses declare `static get _fields() { return {name: default, ...}; }` and override `__post_init__()`
 * (calling `super.__post_init__()` where the Python calls `super().__post_init__()`).
 * Do NOT use JS class-field syntax in subclasses (it would run after __post_init__).
 */
class SSDataclass {
    constructor(fields = {}) {
        ssInitFields(this, fields);
        this.__post_init__();
    }
    __post_init__() {}
}

// Python == for dataclasses / dicts / lists (deep, field-wise). Classes and other objects compare by identity.
function ssEq(a, b) {
    if (a === b) return true;
    if (a === null || b === null || a === undefined || b === undefined) return a === b;
    if (typeof a !== "object" || typeof b !== "object") return a === b;
    if (a instanceof SSImage || b instanceof SSImage) return a === b;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!ssEq(a[i], b[i])) return false;
        return true;
    }
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    if (typeof a.equals === "function") return a.equals(b);
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!ssEq(a[k], b[k])) return false;
    return true;
}

// Resolves a global class/function defined by another part (e.g. ssGet(() => SSScanView)); null if not loaded.
function ssGet(fn) {
    try { return fn(); } catch (e) { if (e instanceof ReferenceError) return null; throw e; }
}

// Settings access that tolerates the settings part not being loaded (values are SettingsConstants literals).
function ssSettingGet(attr, fallback) {
    const S = ssGet(() => SSSettings);
    if (!S) return fallback;
    try {
        const v = S.get_instance().get_value(attr);
        return (v === undefined || v === null) ? fallback : v;
    } catch (e) {
        return fallback;
    }
}
function ssSettingSet(attr, value) {
    const S = ssGet(() => SSSettings);
    if (S) { try { S.get_instance().set_value(attr, value); } catch (e) { console.warn(e); } }
}

/* =====================================================================================================
 * PIL-like imaging layer
 * ===================================================================================================== */

let _ss_color_ctx = null;
function _ssColorCtx() {
    if (!_ss_color_ctx) _ss_color_ctx = document.createElement("canvas").getContext("2d");
    return _ss_color_ctx;
}

// PIL color spec -> CSS color string (null = no paint)
function ssColor(c) {
    if (c === null || c === undefined) return null;
    if (typeof c === "number") {
        const r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255;
        return `rgb(${r},${g},${b})`;
    }
    if (Array.isArray(c)) {
        if (c.length >= 4) return `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;
        if (c.length === 1) return `rgb(${c[0]},${c[0]},${c[0]})`;
        return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
    if (typeof c === "string" && /^[0-9a-fA-F]{6}$/.test(c)) return "#" + c;
    return c;
}

const SSImageColor = {
    getrgb(color) {
        if (Array.isArray(color)) return color.slice(0, 3);
        const ctx = _ssColorCtx();
        ctx.fillStyle = "#000";
        ctx.fillStyle = ssColor(color);
        const s = ctx.fillStyle;   // "#rrggbb" or "rgba(...)"
        if (s[0] === "#") return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
        const m = s.match(/[\d.]+/g).map(Number);
        return [m[0], m[1], m[2]];
    },
};

const SSImageFilter = { SHARPEN: "SHARPEN" };

/*
 * SSImage: a PIL Image stand-in backed by a canvas at SS_SCALE device pixels per logical pixel.
 * All coordinates are logical pixels, like PIL.
 */
class SSImage {
    constructor(mode, width, height, color) {
        this.mode = mode || "RGB";
        this.width = Math.max(0, Math.round(width));
        this.height = Math.max(0, Math.round(height));
        this.scale = SS_SCALE;
        this.canvas = document.createElement("canvas");
        this.canvas.width = Math.max(1, Math.ceil(this.width * this.scale));
        this.canvas.height = Math.max(1, Math.ceil(this.height * this.scale));
        this.ctx = this.canvas.getContext("2d");
        this.ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
        if (this.mode !== "RGBA" && (color === undefined || color === null)) color = "black";  // PIL default for RGB is black
        if (color !== undefined && color !== null) {
            this.ctx.fillStyle = ssColor(color);
            this.ctx.fillRect(0, 0, this.width, this.height);
        }
    }

    // Image.new(mode, size, color)
    static new(mode, size, color) {
        if (mode && typeof mode === "object" && !Array.isArray(mode)) {
            return new SSImage(mode.mode, mode.size[0], mode.size[1], mode.color);
        }
        return new SSImage(mode, size[0], size[1], color);
    }

    // Image.alpha_composite(im1, im2)
    static alpha_composite(im1, im2) {
        const out = im1.copy();
        out.mode = "RGBA";
        out._draw_image(im2, 0, 0);
        return out;
    }

    // Builds an SSImage from a loaded HTMLImageElement (load_image converts to "RGB": no alpha).
    static from_element(el, mode = "RGB") {
        const img = new SSImage(mode, el.naturalWidth || el.width, el.naturalHeight || el.height, mode === "RGB" ? "black" : null);
        img.ctx.imageSmoothingEnabled = true;
        img.ctx.imageSmoothingQuality = "high";
        img.ctx.drawImage(el, 0, 0, img.width, img.height);
        return img;
    }

    get size() { return [this.width, this.height]; }

    _draw_image(src, x, y, w, h) {
        if (!src.width || !src.height) return;
        this.ctx.drawImage(src.canvas, 0, 0, src.canvas.width, src.canvas.height, x, y,
            w === undefined ? src.width : w, h === undefined ? src.height : h);
    }

    // Image.paste(im, box, mask). Without a mask, pixels are replaced (alpha included); with a mask, alpha-blended.
    paste(im, box, mask) {
        let x = 0, y = 0;
        if (Array.isArray(box)) { x = box[0]; y = box[1]; }
        if (typeof im === "string" || Array.isArray(im) || typeof im === "number") {
            // Paste a solid color into the box
            const w = box && box.length === 4 ? box[2] - box[0] : this.width;
            const h = box && box.length === 4 ? box[3] - box[1] : this.height;
            this.ctx.clearRect(x, y, w, h);
            this.ctx.fillStyle = ssColor(im);
            this.ctx.fillRect(x, y, w, h);
            return;
        }
        if (!im || !im.width || !im.height) return;
        if (mask) {
            // SIM: mask is treated as the source's own alpha (the only way SeedSigner uses it)
            this._draw_image(im, x, y);
            return;
        }
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(x, y, im.width, im.height);
        this.ctx.clip();
        this.ctx.clearRect(x, y, im.width, im.height);
        this._draw_image(im, x, y);
        if (this.mode !== "RGBA") {
            // RGB targets have no alpha: whatever was transparent becomes black
            this.ctx.globalCompositeOperation = "destination-over";
            this.ctx.fillStyle = "#000";
            this.ctx.fillRect(x, y, im.width, im.height);
        }
        this.ctx.restore();
    }

    // Image.crop((x0, y0, x1, y1))
    crop(box) {
        const [x0, y0, x1, y1] = box ? box : [0, 0, this.width, this.height];
        const out = new SSImage(this.mode, x1 - x0, y1 - y0, this.mode === "RGBA" ? null : "black");
        if (out.width && out.height) {
            out.ctx.save();
            out.ctx.setTransform(1, 0, 0, 1, 0, 0);
            out.ctx.clearRect(0, 0, out.canvas.width, out.canvas.height);
            out.ctx.drawImage(this.canvas, -Math.round(x0 * this.scale), -Math.round(y0 * this.scale));
            if (out.mode !== "RGBA") {
                out.ctx.globalCompositeOperation = "destination-over";
                out.ctx.fillStyle = "#000";
                out.ctx.fillRect(0, 0, out.canvas.width, out.canvas.height);
            }
            out.ctx.restore();
        }
        return out;
    }

    copy() { return this.crop([0, 0, this.width, this.height]); }

    convert(mode) {
        const out = this.copy();
        out.mode = mode;
        if (mode !== "RGBA") {
            out.ctx.save();
            out.ctx.globalCompositeOperation = "destination-over";
            out.ctx.fillStyle = "#000";
            out.ctx.fillRect(0, 0, out.width, out.height);
            out.ctx.restore();
        }
        return out;
    }

    // Image.resize(size, resample, box)
    resize(size, resample, box) {
        if (resample && typeof resample === "object") { box = resample.box; resample = resample.resample; }
        const out = new SSImage(this.mode, size[0], size[1], this.mode === "RGBA" ? null : "black");
        const [bx0, by0, bx1, by1] = box ? box : [0, 0, this.width, this.height];
        out.ctx.imageSmoothingEnabled = resample !== SSImage.Resampling.NEAREST;
        out.ctx.imageSmoothingQuality = "high";
        if (this.width && this.height && out.width && out.height) {
            out.ctx.drawImage(this.canvas, bx0 * this.scale, by0 * this.scale, (bx1 - bx0) * this.scale, (by1 - by0) * this.scale,
                0, 0, out.width, out.height);
        }
        return out;
    }

    // SIM: ImageFilter.SHARPEN after LANCZOS downsampling is not needed at device resolution; returns a copy.
    filter(_f) { return this.copy(); }

    // Image.putalpha(int): replaces the alpha channel with a constant
    putalpha(alpha) {
        const a = typeof alpha === "number" ? alpha : 255;
        const d = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        for (let i = 3; i < d.data.length; i += 4) d.data[i] = a;
        // putImageData ignores the transform and stores un-premultiplied values
        this.ctx.putImageData(d, 0, 0);
        this.mode = "RGBA";
    }

    // Image.tobytes(): raw RGB(A) bytes at logical resolution
    tobytes() {
        const small = document.createElement("canvas");
        small.width = Math.max(1, this.width);
        small.height = Math.max(1, this.height);
        const sctx = small.getContext("2d");
        sctx.drawImage(this.canvas, 0, 0, small.width, small.height);
        const d = sctx.getImageData(0, 0, small.width, small.height).data;
        const ch = this.mode === "RGBA" ? 4 : 3;
        const out = new Uint8Array(small.width * small.height * ch);
        for (let i = 0, j = 0; i < d.length; i += 4) {
            out[j++] = d[i]; out[j++] = d[i + 1]; out[j++] = d[i + 2];
            if (ch === 4) out[j++] = d[i + 3];
        }
        return out;
    }

    getpixel(xy) {
        const d = this.ctx.getImageData(Math.floor(xy[0] * this.scale), Math.floor(xy[1] * this.scale), 1, 1).data;
        return this.mode === "RGBA" ? [d[0], d[1], d[2], d[3]] : [d[0], d[1], d[2]];
    }
}
SSImage.Resampling = { NEAREST: 0, LANCZOS: 1, BILINEAR: 2, BICUBIC: 3 };
SSImage.NEAREST = 0; SSImage.LANCZOS = 1; SSImage.BILINEAR = 2; SSImage.BICUBIC = 3;

function _ssXY(xy) {
    // Accepts [x0,y0,x1,y1], [[x0,y0],[x1,y1]] or a flat list of more points; returns flat number list
    if (!Array.isArray(xy)) return [];
    if (xy.length && Array.isArray(xy[0])) return xy.flat();
    return xy;
}

function _ssOpts(args, names) {
    // Supports draw.rect(xy, {fill, outline}) and draw.rect(xy, fill, outline, ...) positional calls
    if (args.length === 1 && args[0] && typeof args[0] === "object" && !Array.isArray(args[0])) return args[0];
    const o = {};
    names.forEach((n, i) => { if (args[i] !== undefined) o[n] = args[i]; });
    return o;
}

function _ssRoundRectPath(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}

let _ss_scratch = null;
function _ssRGBA(color) {
    const ctx = _ssColorCtx();
    ctx.fillStyle = "#000";
    ctx.fillStyle = color;
    const v = ctx.fillStyle;
    if (v[0] === "#") return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), 255];
    const m = v.match(/[\d.]+/g).map(Number);
    return [m[0], m[1], m[2], m.length > 3 ? Math.round(m[3] * 255) : 255];
}

/*
 * PIL draws shapes aliased, so redrawing a shape in another color replaces it exactly. Canvas paths are
 * anti-aliased and would leave colored fringes when e.g. a button is redrawn unselected. Curved shapes are therefore
 * rasterized at device resolution with a hard 50% coverage threshold (crisp at devicePixelRatio, no fringes).
 */
function _ssAliasedPaint(im, bbox, color, paint) {
    if (!color) return;
    const S = im.scale;
    const x0 = Math.floor(bbox[0] * S) - 2, y0 = Math.floor(bbox[1] * S) - 2;
    const w = Math.ceil(bbox[2] * S) - x0 + 4, h = Math.ceil(bbox[3] * S) - y0 + 4;
    if (w <= 0 || h <= 0) return;
    if (!_ss_scratch) _ss_scratch = document.createElement("canvas");
    const c = _ss_scratch;
    if (c.width < w || c.height < h) { c.width = Math.max(c.width, w); c.height = Math.max(c.height, h); }
    const g = c.getContext("2d", { willReadFrequently: true });
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.setTransform(S, 0, 0, S, -x0, -y0);
    g.fillStyle = "#fff";
    g.strokeStyle = "#fff";
    paint(g);
    g.setTransform(1, 0, 0, 1, 0, 0);
    const d = g.getImageData(0, 0, w, h);
    const a = d.data;
    const [r, gg, b, al] = _ssRGBA(color);
    for (let i = 0; i < a.length; i += 4) {
        if (a[i + 3] >= 128) { a[i] = r; a[i + 1] = gg; a[i + 2] = b; a[i + 3] = al; }
        else { a[i + 3] = 0; }
    }
    g.putImageData(d, 0, 0);
    im.ctx.save();
    im.ctx.setTransform(1, 0, 0, 1, 0, 0);
    im.ctx.drawImage(c, 0, 0, w, h, x0, y0, w, h);
    im.ctx.restore();
}

/*
 * SSImageDraw: ImageDraw.Draw(img). Boxes are inclusive like PIL ((x0,y0,x1,y1) covers x1 and y1).
 * Methods accept PIL's keyword args as an options object: draw.rectangle(xy, {fill, outline, width}).
 */
class SSImageDraw {
    constructor(im) { this.im = im; }
    static Draw(im) { return new SSImageDraw(im); }
    get ctx() { return this.im.ctx; }

    rectangle(xy, ...args) {
        const o = _ssOpts(args, ["fill", "outline", "width"]);
        let [x0, y0, x1, y1] = _ssXY(xy);
        if (x1 < x0) [x0, x1] = [x1, x0];
        if (y1 < y0) [y0, y1] = [y1, y0];
        const w = x1 - x0 + 1, h = y1 - y0 + 1, lw = o.width === undefined ? 1 : o.width;
        const ctx = this.ctx;
        const fill = ssColor(o.fill), outline = ssColor(o.outline);
        if (fill) { ctx.fillStyle = fill; ctx.fillRect(x0, y0, w, h); }
        if (outline && lw > 0) {
            ctx.fillStyle = outline;
            ctx.beginPath();
            ctx.rect(x0, y0, w, h);
            if (w > 2 * lw && h > 2 * lw) ctx.rect(x0 + lw, y0 + h - lw, w - 2 * lw, -(h - 2 * lw));  // inner hole (reverse winding)
            ctx.fill("evenodd");
        }
    }

    rounded_rectangle(xy, ...args) {
        const o = _ssOpts(args, ["radius", "fill", "outline", "width"]);
        let [x0, y0, x1, y1] = _ssXY(xy);
        if (x1 < x0) [x0, x1] = [x1, x0];
        if (y1 < y0) [y0, y1] = [y1, y0];
        const w = x1 - x0 + 1, h = y1 - y0 + 1, lw = o.width === undefined ? 1 : o.width;
        const r = o.radius === undefined ? 0 : o.radius;
        const ctx = this.ctx;
        const fill = ssColor(o.fill), outline = ssColor(o.outline);
        const box = [x0, y0, x0 + w, y0 + h];
        if (fill) {
            _ssAliasedPaint(this.im, box, fill, (g) => { _ssRoundRectPath(g, x0, y0, w, h, r); g.fill(); });
        }
        if (outline && lw > 0) {
            _ssAliasedPaint(this.im, box, outline, (g) => {
                g.lineWidth = lw;
                _ssRoundRectPath(g, x0 + lw / 2, y0 + lw / 2, w - lw, h - lw, Math.max(0, r - lw / 2));
                g.stroke();
            });
        }
    }

    line(xy, ...args) {
        const o = _ssOpts(args, ["fill", "width"]);
        const p = _ssXY(xy);
        if (p.length < 4) return;
        const lw = o.width === undefined || o.width === 0 ? 1 : o.width;
        const ctx = this.ctx;
        ctx.strokeStyle = ssColor(o.fill === undefined ? "white" : o.fill);
        ctx.lineWidth = lw;
        ctx.lineCap = lw === 1 ? "square" : "butt";
        ctx.lineJoin = "miter";
        // PIL lines are centered on pixel centers
        const off = lw % 2 === 1 ? 0.5 : 0;
        ctx.beginPath();
        ctx.moveTo(p[0] + off, p[1] + off);
        for (let i = 2; i + 1 < p.length; i += 2) ctx.lineTo(p[i] + off, p[i + 1] + off);
        ctx.stroke();
        ctx.lineCap = "butt";
    }

    ellipse(xy, ...args) {
        const o = _ssOpts(args, ["fill", "outline", "width"]);
        const [x0, y0, x1, y1] = _ssXY(xy);
        const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2, rx = (x1 - x0 + 1) / 2, ry = (y1 - y0 + 1) / 2;
        const lw = o.width === undefined ? 1 : o.width;
        const fill = ssColor(o.fill), outline = ssColor(o.outline);
        const box = [x0, y0, x1 + 1, y1 + 1];
        if (fill) {
            _ssAliasedPaint(this.im, box, fill, (g) => { g.beginPath(); g.ellipse(cx, cy, Math.max(0, rx), Math.max(0, ry), 0, 0, Math.PI * 2); g.fill(); });
        }
        if (outline && lw > 0) {
            _ssAliasedPaint(this.im, box, outline, (g) => {
                g.lineWidth = lw;
                g.beginPath(); g.ellipse(cx, cy, Math.max(0, rx - lw / 2), Math.max(0, ry - lw / 2), 0, 0, Math.PI * 2); g.stroke();
            });
        }
    }

    // draw.arc(xy, start, end, fill, width): degrees, clockwise from 3 o'clock, stroke inside the box
    arc(xy, ...args) {
        let o;
        if (args.length === 1 && typeof args[0] === "object") o = args[0];
        else o = _ssOpts(args, ["start", "end", "fill", "width"]);
        const [x0, y0, x1, y1] = _ssXY(xy);
        const lw = o.width === undefined ? 1 : o.width;
        const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2;
        const rx = (x1 - x0 + 1) / 2 - lw / 2, ry = (y1 - y0 + 1) / 2 - lw / 2;
        const ctx = this.ctx;
        ctx.strokeStyle = ssColor(o.fill === undefined ? "white" : o.fill);
        ctx.lineWidth = lw;
        ctx.lineCap = "butt";
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(0, rx), Math.max(0, ry), 0, (o.start || 0) * Math.PI / 180, (o.end || 0) * Math.PI / 180, false);
        ctx.stroke();
    }

    polygon(xy, ...args) {
        const o = _ssOpts(args, ["fill", "outline", "width"]);
        const p = _ssXY(xy);
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.moveTo(p[0] + 0.5, p[1] + 0.5);
        for (let i = 2; i + 1 < p.length; i += 2) ctx.lineTo(p[i] + 0.5, p[i + 1] + 0.5);
        ctx.closePath();
        if (o.fill !== undefined && o.fill !== null) { ctx.fillStyle = ssColor(o.fill); ctx.fill(); }
        if (o.outline !== undefined && o.outline !== null) { ctx.strokeStyle = ssColor(o.outline); ctx.lineWidth = o.width || 1; ctx.stroke(); }
    }

    point(xy, ...args) {
        const o = _ssOpts(args, ["fill"]);
        const p = _ssXY(xy);
        this.ctx.fillStyle = ssColor(o.fill === undefined ? "white" : o.fill);
        for (let i = 0; i + 1 < p.length; i += 2) this.ctx.fillRect(p[i], p[i + 1], 1, 1);
    }

    // draw.text(xy, text, {fill, font, anchor, spacing, align})
    text(xy, text, ...args) {
        if (xy && !Array.isArray(xy) && typeof xy === "object") { args = [xy]; text = xy.text; xy = xy.xy; }
        let o;
        if (args.length === 1 && args[0] && typeof args[0] === "object" && !Array.isArray(args[0]) && !(args[0] instanceof SSFont)) o = args[0];
        else o = _ssOpts(args, ["fill", "font", "anchor", "spacing", "align"]);
        if (text === undefined && o.text !== undefined) text = o.text;
        if (text === null || text === undefined) return;
        text = String(text);
        const font = o.font || SSFonts.get_font("OpenSans-Regular", 10);
        const anchor = o.anchor || "la";
        const fill = ssColor(o.fill === undefined ? "white" : o.fill);
        const [x, y] = xy;
        if (text.indexOf("\n") >= 0) {
            // ImageDraw.multiline_text: line spacing = getbbox("A")[3] + spacing (default 4)
            const spacing = o.spacing === undefined ? 4 : o.spacing;
            const lines = text.split("\n");
            const lh = font.getbbox("A", { anchor: "la" })[3] + spacing;
            const widths = lines.map(l => font.getlength(l));
            const maxw = Math.max(...widths);
            let top = y;
            if (anchor[1] === "m") top = y - (lh * (lines.length - 1)) / 2;
            else if (anchor[1] === "d" || anchor[1] === "b") top = y - lh * (lines.length - 1);
            lines.forEach((l, i) => {
                let lx = x;
                if (anchor[0] === "m") lx = x - maxw / 2 + (o.align === "center" ? (maxw - widths[i]) / 2 : o.align === "right" ? maxw - widths[i] : 0) + widths[i] / 2;
                else if (anchor[0] === "r") lx = x;
                this._text_line([lx, top + i * lh], l, font, anchor, fill);
            });
            return;
        }
        this._text_line([x, y], text, font, anchor, fill);
    }

    _text_line(xy, text, font, anchor, fill) {
        if (!text.length) return;
        const off = font._anchor_offset(text, anchor);
        const bx = xy[0] - off[0], by = xy[1] + off[1];   // baseline origin
        const ctx = this.ctx;
        if (font.is_fontawesome) {
            ssDrawFontAwesome(ctx, text, bx, by, font.size, fill);
            return;
        }
        ctx.font = font.css;
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = fill;
        ctx.fillText(text, bx, by);
    }

    textlength(text, opts = {}) { return (opts.font || SSFonts.get_font("OpenSans-Regular", 10)).getlength(text); }
    textbbox(xy, text, opts = {}) {
        const b = (opts.font || SSFonts.get_font("OpenSans-Regular", 10)).getbbox(text, { anchor: opts.anchor || "la" });
        return [b[0] + xy[0], b[1] + xy[1], b[2] + xy[0], b[3] + xy[1]];
    }
}

/* =====================================================================================================
 * Fonts (PIL ImageFont.truetype stand-in honoring PIL's anchor semantics)
 * ===================================================================================================== */

// [unitsPerEm, hhea ascender, hhea descender] -> getmetrics() = (ceil(asc*size/upem), ceil(-desc*size/upem)) like FreeType
const SS_FONT_METRICS = {
    "OpenSans-Regular": [2048, 2189, -600],
    "OpenSans-SemiBold": [2048, 2189, -600],
    "Inconsolata-Regular": [1000, 859, -190],
    "Inconsolata-SemiBold": [1000, 859, -190],
    "seedsigner-icons": [1024, 960, -64],
    "Font_Awesome_6_Free-Solid-900": [512, 448, -64],
};
// TrueType fonts render hinted in FreeType (ink rounds to nearest px); the OTF icon fonts round outward.
const SS_FONT_HINTED = { "OpenSans-Regular": true, "OpenSans-SemiBold": true, "Inconsolata-Regular": true, "Inconsolata-SemiBold": true };

// FontAwesome 6 Free Solid metrics (font units, upem 512) for the codepoints SeedSigner uses:
// [advance, xMin, yMin, xMax, yMax]. The glyphs themselves are drawn by ssDrawFontAwesome (own shapes, no FA data).
const SS_FA_GLYPHS = {
    "": [384, 0, 64, 384, 288],      // angle-down
    "": [384, 0, 96, 384, 320],      // angle-up
    "": [512, 0, -32, 512, 416],     // camera
    "": [512, 0, -64, 512, 448],     // circle
    "": [640, -0.001, -64, 638.2, 448], // dice
    "": [448, 0, -32, 448, 416],     // dice-one
    "": [448, 0, -32, 448, 416],     // dice-two
    "": [448, 0, -32, 448, 416],     // dice-three
    "": [448, 0, -32, 448, 416],     // dice-four
    "": [448, 0, -32, 448, 416],     // dice-five
    "": [448, 0, -32, 448, 416],     // dice-six
    "": [576, 0, 0, 576, 384],       // keyboard
    "": [576, 0, -28.2, 576, 412.2], // map
    "X": [384, 0, -32, 384.02, 416.02], // x
};

let _ss_measure_ctx = null;

class SSFont {
    constructor(font_name, size) {
        this.font_name = font_name;
        this.path = font_name;
        this.size = size;
        this.is_fontawesome = font_name === SS_FA_FONT_NAME;
        this.family = "SSF-" + font_name;
        this.css = `${size}px "${this.family}"`;
        const m = SS_FONT_METRICS[font_name] || [1000, 1000, -250];
        this._ascent = Math.ceil(m[1] * size / m[0] - 1e-9);
        this._descent = Math.ceil(-m[2] * size / m[0] - 1e-9);
        this._hinted = !!SS_FONT_HINTED[font_name];
        this._cache = new Map();
    }

    // ImageFont.getmetrics() -> (ascent, descent)
    getmetrics() { return [this._ascent, this._descent]; }

    // Raw layout of one line: advance and ink extents (floats, px; inkTop/inkBottom measured from the baseline)
    _measure(text) {
        let r = this._cache.get(text);
        if (r) return r;
        if (this.is_fontawesome) {
            let adv = 0, l = Infinity, rr = -Infinity, t = -Infinity, b = Infinity;
            const s = this.size / 512;
            for (const ch of text) {
                const g = SS_FA_GLYPHS[ch] || [256, 0, 0, 0, 0];
                if (g[3] > g[1]) {
                    l = Math.min(l, adv + g[1] * s); rr = Math.max(rr, adv + g[3] * s);
                    t = Math.max(t, g[4] * s); b = Math.min(b, g[2] * s);
                }
                adv += g[0] * s;
            }
            r = { adv, inkL: l === Infinity ? 0 : l, inkR: rr === -Infinity ? 0 : rr, inkTop: t === -Infinity ? 0 : t, inkBottom: b === Infinity ? 0 : -b, empty: l === Infinity };
        } else {
            if (!_ss_measure_ctx) _ss_measure_ctx = document.createElement("canvas").getContext("2d");
            const ctx = _ss_measure_ctx;
            ctx.font = this.css;
            ctx.textAlign = "left";
            ctx.textBaseline = "alphabetic";
            const m = ctx.measureText(text);
            const empty = !text.trim().length;
            r = {
                adv: m.width,
                inkL: empty ? 0 : -m.actualBoundingBoxLeft,
                inkR: empty ? 0 : m.actualBoundingBoxRight,
                inkTop: empty ? 0 : m.actualBoundingBoxAscent,
                inkBottom: empty ? 0 : m.actualBoundingBoxDescent,
                empty,
                exact: false,
            };
            // Prefer the FreeType (hinted) extents tabulated from the real fonts where available
            const tab = SS_HINTED_INK[this.font_name];
            const gx = SS_GLYPH_X[this.font_name];
            if (!empty && tab && gx && this.size >= 10 && this.size <= 40) {
                const row = tab[this.size - 10];
                const upem = SS_FONT_METRICS[this.font_name][0];
                const s = this.size / upem;
                let top = 0, bottom = 0, ok = true, first = -1, last = -1;
                for (let i = 0; i < text.length; i++) {
                    const c = text.charCodeAt(i);
                    if (c === 32) continue;
                    if (c < 33 || c > 126) { ok = false; break; }
                    const k = (c - 33) * 2;
                    top = Math.max(top, row.charCodeAt(k) - 40);
                    bottom = Math.max(bottom, row.charCodeAt(k + 1) - 40);
                    if (first < 0) first = i;
                    last = i;
                }
                if (ok && first >= 0) {
                    r.inkTop = top;
                    r.inkBottom = bottom;
                    const gf = gx[text.charCodeAt(first) - 33], gl = gx[text.charCodeAt(last) - 33];
                    const pen_first = first ? ctx.measureText(text.slice(0, first)).width : 0;
                    const pen_last = ctx.measureText(text.slice(0, last + 1)).width - gl[0] * s;
                    r.inkL = pen_first + gf[1] * s;
                    r.inkR = pen_last + gl[2] * s;
                    r.exact = true;
                }
            }
        }
        this._cache.set(text, r);
        return r;
    }

    // PIL-style integer box relative to the left-baseline origin (always includes the origin, like FreeType/PIL)
    _box_ls(text) {
        const m = this._measure(text);
        if (!text.length) return [0, 0, 0, 0];
        // Tabulated extents are already integers; the OTF icon fonts round outward like FreeType
        const vround = this.is_fontawesome ? (v) => Math.ceil(v - 1e-9) : (v) => Math.ceil(v - 0.01);
        const left = Math.min(0, Math.floor(m.inkL + 0.01));
        const adv = Math.round(m.adv * 64) / 64;   // FreeType 26.6 fixed point
        const right = Math.max(Math.round(adv), m.empty ? 0 : Math.ceil(m.inkR - (this.is_fontawesome ? 1e-9 : 0.01)));
        const top = -Math.max(0, vround(m.inkTop));
        const bottom = Math.max(0, vround(m.inkBottom));
        return [left, top, right, bottom];
    }

    // [dx, dy]: anchor point relative to the left-baseline origin (dx to the right, dy = how far the baseline is BELOW the anchor)
    _anchor_offset(text, anchor) {
        anchor = anchor || "la";
        const m = this._measure(text);
        const box = this._box_ls(text);
        let dx = 0, dy = 0;
        switch (anchor[0]) {
            case "m": dx = Math.round(Math.round(m.adv * 64) / 128); break;
            case "r": dx = Math.round(Math.round(m.adv * 64) / 64); break;
            default: dx = 0;
        }
        switch (anchor[1]) {
            case "a": dy = this._ascent; break;
            case "t": dy = -box[1]; break;
            case "m": dy = Math.round((this._ascent - this._descent) / 2); break;
            case "b": dy = -box[3]; break;
            case "d": dy = -this._descent; break;
            default: dy = 0;   // "s" baseline
        }
        return [dx, dy];
    }

    // ImageFont.getbbox(text, anchor=...) -> [left, top, right, bottom] relative to the anchor point
    getbbox(text, opts) {
        if (text && typeof text === "object") { opts = text; text = opts.text; }
        const anchor = typeof opts === "string" ? opts : (opts && opts.anchor) || "la";
        text = String(text === undefined || text === null ? "" : text);
        if (!text.length) return [0, 0, 0, 0];
        if (text.indexOf("\n") >= 0) {
            // multiline: union of the lines (PIL getbbox does not support multiline; approximation)
            const lines = text.split("\n");
            const lh = this.getbbox("A", "la")[3] + 4;
            let b = [0, 0, 0, 0];
            lines.forEach((l, i) => {
                const lb = this.getbbox(l, anchor);
                b = [Math.min(b[0], lb[0]), Math.min(b[1], lb[1] + i * lh), Math.max(b[2], lb[2]), Math.max(b[3], lb[3] + i * lh)];
            });
            return b;
        }
        const box = this._box_ls(text);
        const [dx, dy] = this._anchor_offset(text, anchor);
        return [box[0] - dx, box[1] + dy, box[2] - dx, box[3] + dy];
    }

    // ImageFont.getlength(text) -> float advance
    getlength(text) {
        text = String(text === undefined || text === null ? "" : text);
        return Math.round(this._measure(text).adv * 64) / 64;
    }

    // Legacy PIL API
    getsize(text) { const b = this.getbbox(text, "la"); return [b[2], b[3]]; }
}

const SS_FA_FONT_NAME = "Font_Awesome_6_Free-Solid-900";

// gui/components.py Fonts (singleton font cache)
class SSFonts {
    static get_font(font_name, size, file_extension = "ttf") {
        if (font_name && typeof font_name === "object") { size = font_name.size; font_name = font_name.font_name; }
        if (!(font_name in SSFonts.fonts)) SSFonts.fonts[font_name] = {};
        if (!(size in SSFonts.fonts[font_name])) {
            if (!(font_name in SS_FONT_METRICS)) {
                // SIM: locale fonts (Noto*) are not bundled; fall back to OpenSans like an English-only build
                console.warn(`Font ${font_name} not bundled; using OpenSans-Regular`);
                SSFonts.fonts[font_name][size] = new SSFont("OpenSans-Regular", size);
            } else {
                SSFonts.fonts[font_name][size] = new SSFont(font_name, size);
            }
        }
        return SSFonts.fonts[font_name][size];
    }
}
SSFonts.fonts = {};
SSFonts.font_paths = [];

let _ss_assets_promise = null;
const SS_IMAGES = {};

// Loads the bundled fonts (SS_FONT_DATA from ss_fonts.js) and images; must finish before anything measures text.
function ssLoadAssets() {
    if (_ss_assets_promise) return _ss_assets_promise;
    const jobs = [];
    const data = ssGet(() => SS_FONT_DATA) || {};
    for (const name of Object.keys(data)) {
        // SIM (VOIDFORGE): the font is handed to FontFace as bytes, not as a url(data:...), so the page's
        // Content-Security-Policy (default-src 'none', no font-src) needs no change: nothing is fetched.
        const b64 = String(data[name]).replace(/^data:[^,]*,/, "");
        const bin = atob(b64), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const face = new FontFace("SSF-" + name, bytes.buffer);
        jobs.push(face.load().then(f => { document.fonts.add(f); }).catch(e => console.error("Font load failed", name, e)));
    }
    for (const name of Object.keys(SS_IMAGE_DATA)) {
        jobs.push(new Promise((resolve) => {
            const el = new Image();
            el.onload = () => { SS_IMAGES[name] = el; resolve(); };
            el.onerror = () => { console.error("Image load failed", name); resolve(); };
            el.src = SS_IMAGE_DATA[name];
        }));
    }
    _ss_assets_promise = Promise.all(jobs);
    return _ss_assets_promise;
}

/* =====================================================================================================
 * FontAwesome codepoints drawn as own vector shapes (Font Awesome itself is not embedded).
 * Shapes are designed in FA's glyph box (font units, upem 512, y up from the baseline) so that the
 * metrics in SS_FA_GLYPHS (used for layout) match what is drawn.
 * ===================================================================================================== */

function _ssFAPath(cp) {
    // Returns {fill: [ops...], rule, strokes: [{pts, w}], clipOut} in font units (y up)
    const P = [];   // path ops: ["M",x,y] ["L",x,y] ["C",...] ["Z"] ["O",cx,cy,r] (circle) ["R",x0,y0,x1,y1,r] (round rect)
    const S = [];   // strokes: {pts:[[x,y],...], w}
    const pip = (cx, cy) => P.push(["O", cx, cy, 44]);
    const die = (pips) => {
        P.push(["R", 0, -32, 448, 416, 64]);
        const L = 112, C = 224, R = 336, T = 304, M = 192, B = 80;
        const at = { TL: [L, T], TR: [R, T], ML: [L, M], C: [C, M], MR: [R, M], BL: [L, B], BR: [R, B] };
        pips.forEach(p => pip(at[p][0], at[p][1]));
    };
    switch (cp) {
        case "": S.push({ pts: [[40, 248], [192, 96], [344, 248]], w: 72 }); break;
        case "": S.push({ pts: [[40, 136], [192, 288], [344, 136]], w: 72 }); break;
        case "": P.push(["O", 256, 192, 256]); break;
        case "": // camera: body with a top bump, lens ring
            P.push(["M", 64, 352], ["L", 144, 352], ["L", 176, 416], ["L", 336, 416], ["L", 368, 352], ["L", 448, 352],
                ["C", 483, 352, 512, 323, 512, 288], ["L", 512, 32], ["C", 512, -3, 483, -32, 448, -32],
                ["L", 64, -32], ["C", 29, -32, 0, -3, 0, 32], ["L", 0, 288], ["C", 0, 323, 29, 352, 64, 352], ["Z"]);
            P.push(["O", 256, 160, 128]);
            P.push(["O", 256, 160, 80]);
            break;
        case "": die(["C"]); break;
        case "": die(["TL", "BR"]); break;
        case "": die(["TL", "C", "BR"]); break;
        case "": die(["TL", "TR", "BL", "BR"]); break;
        case "": die(["TL", "TR", "C", "BL", "BR"]); break;
        case "": die(["TL", "TR", "ML", "MR", "BL", "BR"]); break;
        case "": // dice: a tilted die (five) in front of a second die
            return { dice: true };
        case "": // keyboard: body with key holes and a space bar
            P.push(["R", 0, 0, 576, 384, 64]);
            for (let i = 0; i < 6; i++) P.push(["R", 64 + i * 80, 272, 112 + i * 80, 320, 8]);
            for (let i = 0; i < 6; i++) P.push(["R", 64 + i * 80, 168, 112 + i * 80, 216, 8]);
            P.push(["R", 64, 64, 112, 112, 8], ["R", 144, 64, 432, 112, 8], ["R", 464, 64, 512, 112, 8]);
            break;
        case "": // folded map: three panels
            P.push(["M", 0, 348], ["L", 176, 412], ["L", 176, 36], ["L", 0, -28], ["Z"]);
            P.push(["M", 200, 412], ["L", 376, 348], ["L", 376, -28], ["L", 200, 36], ["Z"]);
            P.push(["M", 400, 348], ["L", 576, 412], ["L", 576, 36], ["L", 400, -28], ["Z"]);
            break;
        case "X": // x
            S.push({ pts: [[56, 24], [328, 360]], w: 96, cap: "round" });
            S.push({ pts: [[328, 24], [56, 360]], w: 96, cap: "round" });
            break;
        default:
            return null;
    }
    return { P, S };
}

function _ssFAApply(ctx, ops, X, Y) {
    for (const op of ops) {
        switch (op[0]) {
            case "M": ctx.moveTo(X(op[1]), Y(op[2])); break;
            case "L": ctx.lineTo(X(op[1]), Y(op[2])); break;
            case "C": ctx.bezierCurveTo(X(op[1]), Y(op[2]), X(op[3]), Y(op[4]), X(op[5]), Y(op[6])); break;
            case "Z": ctx.closePath(); break;
            case "O": ctx.moveTo(X(op[1] + op[3]), Y(op[2])); ctx.arc(X(op[1]), Y(op[2]), Math.abs(X(op[3]) - X(0)), 0, Math.PI * 2); ctx.closePath(); break;
            case "R": {
                const x0 = X(op[1]), y0 = Y(op[4]), x1 = X(op[3]), y1 = Y(op[2]);
                const r = Math.abs(X(op[5]) - X(0)), w = x1 - x0, h = y1 - y0;
                ctx.moveTo(x0 + r, y0); ctx.lineTo(x1 - r, y0); ctx.arcTo(x1, y0, x1, y0 + r, r);
                ctx.lineTo(x1, y1 - r); ctx.arcTo(x1, y1, x1 - r, y1, r); ctx.lineTo(x0 + r, y1);
                ctx.arcTo(x0, y1, x0, y1 - r, r); ctx.lineTo(x0, y0 + r); ctx.arcTo(x0, y0, x0 + r, y0, r); ctx.closePath();
                if (w < 0 || h < 0) { /* degenerate */ }
                break;
            }
        }
    }
}

// Draws FA codepoints with the pen at the left-baseline origin (bx, by), like FreeType would draw the glyphs.
function ssDrawFontAwesome(ctx, text, bx, by, size, fill) {
    const s = size / 512;
    let pen = bx;
    for (const ch of text) {
        const g = SS_FA_GLYPHS[ch];
        const shape = _ssFAPath(ch);
        const ox = pen;
        const X = (u) => ox + u * s, Y = (u) => by - u * s;
        ctx.save();
        ctx.fillStyle = fill;
        ctx.strokeStyle = fill;
        if (shape && shape.dice) {
            // Back die (upright, right side), clipped away around the front die so the two stay separate
            const front = (c) => {
                // front die: rounded square of side 300 rotated -20 degrees, centered at (232, 196)
                const cx = 232, cy = 196, half = 150, rad = -20 * Math.PI / 180, r = 44;
                const rot = (x, y) => [cx + x * Math.cos(rad) - y * Math.sin(rad), cy + x * Math.sin(rad) + y * Math.cos(rad)];
                return { cx, cy, half, rad, r, rot };
            };
            const F = front();
            const frontPath = (grow) => {
                const p = new Path2D();
                const h = F.half + grow, r = F.r + grow;
                const corner = (x, y) => F.rot(x, y);
                const seq = [[-h + r, -h], [h - r, -h], [h, -h], [h, -h + r], [h, h - r], [h, h], [h - r, h], [-h + r, h], [-h, h], [-h, h - r], [-h, -h + r], [-h, -h], [-h + r, -h]];
                const P0 = corner(seq[0][0], seq[0][1]);
                p.moveTo(X(P0[0]), Y(P0[1]));
                for (let i = 1; i < seq.length; i += 3) {
                    const a = corner(seq[i][0], seq[i][1]), c = corner(seq[i + 1][0], seq[i + 1][1]), b = corner(seq[i + 2][0], seq[i + 2][1]);
                    p.lineTo(X(a[0]), Y(a[1]));
                    p.quadraticCurveTo(X(c[0]), Y(c[1]), X(b[0]), Y(b[1]));
                }
                p.closePath();
                return p;
            };
            ctx.save();
            const clip = new Path2D();
            clip.rect(X(-64), Y(512), 1024 * s, 640 * s);
            clip.addPath(frontPath(36));
            ctx.clip(clip, "evenodd");
            const back = new Path2D();
            _ssFAApplyPath(back, [["R", 360, 40, 638, 318, 40], ["O", 560, 120, 34]], X, Y);
            ctx.fill(back, "evenodd");
            ctx.restore();
            const fp = frontPath(0);
            const pips = [[-80, -80], [80, -80], [0, 0], [-80, 80], [80, 80]];
            for (const [px, py] of pips) {
                const c = F.rot(px, py);
                fp.moveTo(X(c[0] + 30), Y(c[1]));
                fp.arc(X(c[0]), Y(c[1]), 30 * s, 0, Math.PI * 2);
                fp.closePath();
            }
            ctx.fill(fp, "evenodd");
        } else if (shape) {
            if (shape.P.length) {
                const p = new Path2D();
                _ssFAApplyPath(p, shape.P, X, Y);
                ctx.fill(p, "evenodd");
            }
            for (const st of shape.S) {
                ctx.lineWidth = st.w * s;
                ctx.lineCap = st.cap || "round";
                ctx.lineJoin = "round";
                ctx.beginPath();
                ctx.moveTo(X(st.pts[0][0]), Y(st.pts[0][1]));
                for (let i = 1; i < st.pts.length; i++) ctx.lineTo(X(st.pts[i][0]), Y(st.pts[i][1]));
                ctx.stroke();
            }
        }
        ctx.restore();
        pen += (g ? g[0] : 256) * s;
    }
}

function _ssFAApplyPath(p, ops, X, Y) { _ssFAApply(p, ops, X, Y); }

/*
 * SSIcon has two uses:
 *  1. `new SSIcon({icon_name, icon_size, icon_color, screen_x, screen_y, ...})` -- the gui/components.py Icon component
 *     (handles seedsigner-icons and FontAwesome codepoints alike).
 *  2. `SSIcon(draw, codepoint, [x, y], size, color, anchor="la")` -- draws one FontAwesome codepoint directly; identical to
 *     `draw.text([x, y], codepoint, {fill: color, font: SSFonts.get_font(FA, size), anchor})` in PIL (default anchor "la").
 */
function SSIcon(...args) {
    if (new.target) return Reflect.construct(SSIconComponent, args, new.target === SSIcon ? SSIconComponent : new.target);
    const [draw, codepoint, xy, size, color, anchor] = args;
    const d = draw instanceof SSImageDraw ? draw : SSImageDraw.Draw(draw);
    d.text(xy, codepoint, { fill: color === undefined ? "white" : color, font: SSFonts.get_font(SS_FA_FONT_NAME, size || 22), anchor: anchor || "la" });
}
// Vertical ink extents of printable ASCII (U+0021-U+007E) as FreeType renders them hinted in PIL, per font and
// pixel size 10..40: two chars per glyph = (px above baseline, px below baseline) + 40. Generated with Pillow from the
// SeedSigner font files so getbbox() matches the device's layout math exactly.
const SS_HINTED_INK = {
  "OpenSans-Regular": [
    "/(/(/(0)/(/(/(/*/*/(/())+(*(/(/(/(/(/(/(/(/(/(/(/(-(-).(-(.(/(/)/(/(/(/(/(/(/(/(/(/*/(/(/(/(/(/(/*/(/(/(/(/(/(/(/(/(/*/(/*/((*0(-(/(-(/(-(/(-*/(0(0*/(/(-(-(-(-*-*-(-(.(-(-(-(-(-*-(/*/*/*,(",
    "0(0(0(0)0(0(0(0*0*0(/()*+(*(0(0(0(0(0(0(0(0(0(0(0(.(.*/(-(/(0(0)0(0(0(0(0(0(0(0(0(0*0(0(0(0(0(0(0*0(0(0(0(0(0(0(0(0(0*0(0*0((*1(.(0(.(0(.(0(.+0(1(1+0(0(.(.(.(.+.+.(.(/(.(.(.(.(.+.(0*0+0*-(",
    "1(1(1(1)1(1(1(1*1*1(0()*,(*(1(1(1(1(1(1(1(1(1(1(1(.(.*/(.(/(1(1)1(1(1(1(1(1(1(1(1(1*1(1(1(1(1(1(1*1(1(1(1(1(1(1(1(1(1*1(1*1((*1(.(1(.(1(.(1(.+1(1(1+1(1(.(.(.(.+.+.(.(/(.(.(.(.(.+.(1*1+1*-(",
    "1(1(1(2)1(1(1(1*1*2(0(*),(*(1(1(1(1(1(1(1(1(1(1(1(/(/)0(.(0(1(1)1(1(1(1(1(1(1(1(1(1*1(1(1(1(1(1(1*1(1(1(1(1(1(1(1(1(1*1(1*1((*2(/(2(/(2(/(2(/+2(2(2+2(2(/(/(/(/+/+/(/(1(/(/(/(/(/+/(1*2+1*-(",
    "2(2(2(3)2(2(2(2*2*3(0(*),(*(2(2(2(2(2(2(2(2(2(2(2(0(0)0(/(0(2(2)2(2(2(2(2(2(2(2(2(2+2(2(2(2(2(2(2*2(2(2(2(2(2(2(2(2(2*2(2*2((*2(0(3(0(3(0(3(0+3(3(3+3(3(0(0(0(0+0+0(0(2(0(0(0(0(0+0(2*3+2*.(",
    "3(3(3(3)3(3(3(3*3*4(2(**-(*(3(3(3(3(3(3(3(3(3(3(3(0(0*1(/(1(3(3)3(3(3(3(3(3(3(3(3(3+3(3(3(3(3(3(3*3(3(3(3(3(3(3(3(3(3*3(3*3((*3(0(4(0(4(0(4(0,4(3(3,4(4(0(0(0(0,0,0(0(2(0(0(0(0(0,0(3*4,3*.(",
    "4(4(4(4)4(4(4(4+4+5(2(**-(+(4(4(4(4(4(4(4(4(4(4(4(1(1*2(0(2(4(4)4(4(4(4(4(4(4(4(4(4+4(4(4(4(4(4(4+4(4(4(4(4(4(4(4(4(4+4(4+4((+5(1(5(1(5(1(5(1,5(4(4,5(5(1(1(1(1,1,1(1(3(1(1(1(1(1,1(4+5,4+/(",
    "4(4(4(5)4(4(4(4+4+5(3(**-(+(4(4(4(4(4(4(4(4(4(4(4(1(1*2(0(2(4(4*4(4(4(4(4(4(4(4(4(4+4(4(4(4(4(4(4+4(4(4(4(4(4(4(4(4(4+4(4+4((,5(1(5(1(5(1(5(1,5(5(5,5(5(1(1(1(1,1,1(1(3(1(1(1(1(1,1(4+5,4+/(",
    "5(5(5(6)5(5(5(5+5+6(3(**.(+(5(5(5(5(5(5(5(5(5(5(5(2(2*3(1(3(5(5*5(5(5(5(5(5(5(5(5(5+5(5(5(5(5(5(5+5(5(5(5(5(5(5(5(5(5+5(5+5((,6(2(6(2(6(2(6(2,6(6(6,6(6(2(2(2(2,2,2(2(4(2(2(2(2(2,2(5+6,5+/(",
    "6(6(6(6)6(6(6(6+6+7(3(*+.(+(6(6(6(6(6(6(6(6(6(6(6(2(2+4(1(4(6(6*6(6(6(6(6(6(6(6(6(6,6(6(6(6(6(6(6+6(6(6(6(6(6(6(6(6(6+6(6+6((,7(2(7(2(7(2(7(2-7(7(7-7(7(2(2(2(2-2-2(2(4(2(2(2(2(2-2(6+7-6+0(",
    "6(6(6(7)6(6(6(6+6+7(5(*+.(+(6(6(6(6(6(6(6(6(6(6(6(3(3+4(2(4(6(6*6(6(6(6(6(6(6(6(6(6,6(6(6(6(6(6(6+6(6(6(6(6(6(6(6(6(6+6(6+6((,7(3(7(3(7(3(7(3-7(8(8-7(7(3(3(3(3-3-3(3(5(3(3(3(3(3-3(6+7-6+0(",
    "7(7(7(8)7(7(7(7+7+8(5(*+.(+(7(7(7(7(7(7(7(7(7(7(7(4(4+5(2(5(7(7*7(7(7(7(7(7(7(7(7(7,7(7(7(7(7(7(7+7(7(7(7(7(7(7(7(7(7+7(7+7((,8(4(8(4(8(4(8(4-8(9(9-8(8(4(4(4(4-4-4(4(7(4(4(4(4(4-4(7+8-7+1(",
    "8(8(8(9)8(8(8(8+8+9(6(+*/(+(8(8(8(8(8(8(8(8(8(8(8(4(4*5(3(5(8(8*8(8(8(8(8(8(8(8(8(8,8(8(8(8(8(8(8,8(8(8(8(8(8(8(8(8(8+8(8+8((,9(4(9(4(9(4(9(4-9(9(9-9(9(4(4(4(4-4-4(4(7(4(4(4(4(4-4(8+9-8+1(",
    "9(9(9(9)9(9(9(9,9,:(6(++/(,(9(9(9(9(9(9(9(9(9(9(9(5(5+6(3(6(9(9*9(9(9(9(9(9(9(9(9(9,9(9(9(9(9(9(9,9(9(9(9(9(9(9(9(9(9,9(9,9((,:(5(:(5(:(5(:(5.:(:(:.:(:(5(5(5(5.5.5(5(8(5(5(5(5(5.5(9,:.9,2(",
    "9(9(9(:)9(9(9(9,9,:(7(++/(,(9(9(9(9(9(9(9(9(9(9(9(5(5+7(4(7(9(9*9(9(9(9(9(9(9(9(9(9,9(9(9(9(9(9(9,9(9(9(9(9(9(9(9(9(9,9(9,9((,;(5(:(5(:(5(:(5.:(:(:.:(:(5(5(5(5.5.5(5(8(5(5(5(5(5.5(9,:.9,2(",
    ":(:(:(;):(:(:(:,:,;(8(++0(,(:(:(:(:(:(:(:(:(:(:(:(5(5+7(4(7(:(:*:(:(:(:(:(:(:(:(:(:-:(:(:(:(:(:(:,:(:(:(:(:(:(:(:(:(:,:(:,:((,;(5(;(5(;(5(;(5.;(:(:.;(;(5(5(5(5.5.5(5(8(5(5(5(5(5.5(:,;.:,2(",
    ";(;(;(<*;(;(;(;,;,<(8(++0(,(;(;(;(;(;(;(;(;(;(;(;(6(6+8(5(8(;(;*;(;(;(;(;(;(;(;(;(;-;(;(;(;(;(;(;,;(;(;(;(;(;(;(;(;(;,;(;,;((,<(6(<(6(<(6(<(6.<(;(;.<(<(6(6(6(6.6.6(6(9(6(6(6(6(6.6(;,<.;,3(",
    ";(;(;(<*;(;(;(;,;,=(8(+,0(,(;(;(;(;(;(;(;(;(;(;(;(6(6,8(5(8(;(;*;(;(;(;(;(;(;(;(;(;-;(;(;(;(;(;(;,;(;(;(;(;(;(;(;(;(;,;(;,;((,<(6(=(6(=(6(=(6.=(;(;.=(=(6(6(6(6.6.6(6(9(6(6(6(6(6.6(;,=.;,3(",
    "<(<(<(=*<(<(<(<,<,=(9(+,1(,(<(<(<(<(<(<(<(<(<(<(<(7(7,9(6(9(<(<+<(<(<(<(<(<(<(<(<(<-<(<(<(<(<(<(<,<(<(<(<(<(<(<(<(<(<,<(<,<((-=(7(=(7(=(7(=(7/=(>(>/=(=(7(7(7(7/7/7(7(:(7(7(7(7(7/7(<,=/<,4(",
    "=(=(=(>*=(=(=(=-=->(:(+,1(,(=(=(=(=(=(=(=(=(=(=(=(8(8,:(6(:(=(=+=(=(=(=(=(=(=(=(=(=-=(=(=(=(=(=(=-=(=(=(=(=(=(=(=(=(=-=(=-=((-?(8(>(8(>(8(>(8/>(?(?/>(>(8(8(8(8/8/8(8(<(8(8(8(8(8/8(=->/=-4(",
    "=(=(=(?*=(=(=(=-=-?(;(+,1(,(=(=(=(=(=(=(=(=(=(=(=(8(8,:(7(:(=(=+=(=(=(=(=(=(=(=(=(=.=(=(=(=(=(=(=-=(=(=(=(=(=(=(=(=(=-=(=->((-?(8(?(8(?(8(?(8/?(?(?/?(?(8(8(8(8/8/8(8(<(8(8(8(8(8/8(=-?/=-4(",
    ">(>(>(@*>(>(>(>->-@(;(,,1(-(>(>(>(>(>(>(>(>(>(>(>(9(9,;(7(;(>(>+>(>(>(>(>(>(>(>(>(>.>(>(>(>(>(>(>->(>(>(>(>(>(>(>(>(>->(>->((-@(9(@(9(@(9(@(9/@(@(@/@(@(9(9(9(9/9/9(9(=(9(9(9(9(9/9(>-@/>-5(",
    "?(?(?(@*?(?(?(?-?-@(;(,,2(-(?(?(?(?(?(?(?(?(?(?(?(9(9,;(8(;(?(?+?(?(?(?(?(?(?(?(?(?.?(?(?(?(?(?(?-?(?(?(?(?(?(?(?(?(?-?(?-?((.@(9(@(9(@(9(@(90@(@(@0@(@(9(9(9(90909(9(=(9(9(9(9(909(?-@0?-5(",
    "@(@(@(A*@(@(@(@-@-A(<(,,2(-(@(@(@(@(@(@(@(@(@(@(@(:(:,<(8(<(@(@+@(@(@(@(@(@(@(@(@(@.@(@(@(@(@(@(@-@(@(@(@(@(@(@(@(@(@-@(@-@((.A(:(A(:(A(:(A(:0A(A(A0A(A(:(:(:(:0:0:(:(>(:(:(:(:(:0:(@-A0@-6(",
    "@(@(@(B*@(@(@(@-@-B(=(,,2(-(@(@(@(@(@(@(@(@(@(@(@(;(;,=(9(=(@(@+@(@(@(@(@(@(@(@(@(@.@(@(@(@(@(@(@-@(@(@(@(@(@(@(@(@(@-@(@-@((.B(;(B(;(B(;(B(;0B(B(B0B(B(;(;(;(;0;0;(;(?(;(;(;(;(;0;(@-B0@-6(",
    "A(A(A(C*A(A(A(A.A.C(>(,-3(-(A(A(A(A(A(A(A(A(A(A(A(;(;-=(9(=(A(A+A(A(A(A(A(A(A(A(A(A.A(A(A(A(A(A(A.A(A(A(A(A(A(A(A(A(A.A(A.A((.C(;(C(;(C(;(C(;0C(B(B0C(C(;(;(;(;0;0;(;(?(;(;(;(;(;0;(A.C0A.7(",
    "B(B(B(C*B(B(B(B.B.C(>(,-3(-(B(B(B(B(B(B(B(B(B(B(B(;(;->(9(>(B(B+B(B(B(B(B(B(B(B(B(B/B(B(B(B(B(B(B.B(B(B(B(B(B(B(B(B(B.B(B.B((.D(;(C(;(C(;(C(;1C(B(B1C(C(;(;(;(;1;1;(;(?(;(;(;(;(;1;(B.C1B.7(",
    "B(B(B(D*B(B(B(B.B.D(>(,-3(-(B(B(B(B(B(B(B(B(B(B(B(<(<->(:(>(B(B+B(B(B(B(B(B(B(B(B(B/B(B(B(B(B(B(B.B(B(B(B(B(B(B(B(B(B.B(B.C((.D(<(D(<(D(<(D(<1D(C(C1D(D(<(<(<(<1<1<(<(A(<(<(<(<(<1<(B.D1B.7(",
    "C(C(C(E*C(C(C(C.C.E(?(,-4(.(C(C(C(C(C(C(C(C(C(C(C(=(=-?(:(?(C(C+C(C(C(C(C(C(C(C(C(C/C(C(C(C(C(C(C.C(C(C(C(C(C(C(C(C(C.C(C.C((.E(=(E(=(E(=(E(=1E(E(E1E(E(=(=(=(=1=1=(=(B(=(=(=(=(=1=(C.E1C.8(",
    "D(D(D(F*D(D(D(D.D.F(@(--4(.(D(D(D(D(D(D(D(D(D(D(D(=(=-@(;(@(D(D,D(D(D(D(D(D(D(D(D(D/D(D(D(D(D(D(D.D(D(D(D(D(D(D(D(D(D.D(D.D((/F(=(F(=(F(=(F(=1F(F(F1F(F(=(=(=(=1=1=(=(B(=(=(=(=(=1=(D.F1D.8(",
    "E(E(E(F*E(E(E(E.E.F(@(--4(.(E(E(E(E(E(E(E(E(E(E(E(=(=-@(;(@(E(E,E(E(E(E(E(E(E(E(E(E/E(E(E(E(E(E(E.E(E(E(E(E(E(E(E(E(E.E(E.E((/F(=(F(=(F(=(F(=2F(F(F2F(F(=(=(=(=2=2=(=(B(=(=(=(=(=2=(E.F2E.9(",
  ],
  "OpenSans-SemiBold": [
    "/(/(/(0)/(/(/(/*/*/(.())+(*(/(/(/(/(/(/(/(/(/(/(/(-(-).(-(.(/(/)/(/(/(/(/(/(/(/(/(/*/(/(/(/(/(/(/*/(/(/(/(/(/(/(/(/(/*/(/*/((*0(-(/(-(/(-(/(-*/(/(/*/(/(-(-(-(-*-*-(-(.(-(-(-(-(-*-(/*/*/*-(",
    "0(0(0(0(0(0(0(0*0*0(0()*+(*(0(0(0(0(0(0(0(0(0(0(0(.(.*/(.(/(0(0)0(0(0(0(0(0(0(0(0(0*0(0(0(0(0(0(0*0(0(0(0(0(0(0(0(0(0*0(0*0((*1(.(0(.(0(.(0(.+0(0(0+0(0(.(.(.(.+.+.(.(/(.(.(.(.(.+.(0*0+0*-(",
    "1(1(1(1(1(1(1(1*1*1(0()*,(*(1(1(1(1(1(1(1(1(1(1(1(.(.*0(.(0(1(1)1(1(1(1(1(1(1(1(1(1*1(1(1(1(1(1(1*1(1(1(1(1(1(1(1(1(1*1(1*1((*1(.(1(.(1(.(1(.+1(1(1+1(1(.(.(.(.+.+.(.(/(.(.(.(.(.+.(1*1+1*.(",
    "1(1(1(2(1(1(1(1*1*2(0()*,(*(1(1(1(1(1(1(1(1(1(1(1(/(/*0(/(0(1(1)1(1(1(1(1(1(1(1(1(1*1(1(1(1(1(1(1*1(1(1(1(1(1(1(1(1(1*1(1*1((*2(/(2(/(2(/(2(/+2(2(2+2(2(/(/(/(/+/+/(/(1(/(/(/(/(/+/(1*2+1*.(",
    "2(2(2(3(2(2(2(2*2*3(1()*,(+(2(2(2(2(2(2(2(2(2(2(2(0(0*1(/(1(2(2)2(2(2(2(2(2(2(2(2(2+2(2(2(2(2(2(2*2(2(2(2(2(2(2(2(2(2*2(2*2((*2(0(3(0(3(0(3(0+3(3(3+3(3(0(0(0(0+0+0(0(2(0(0(0(0(0+0(2*3+2*.(",
    "3(3(3(4)3(3(3(3*3*4(1(**-(+(3(3(3(3(3(3(3(3(3(3(3(0(0*2(0(2(3(3)3(3(3(3(3(3(3(3(3(3+3(3(3(3(3(3(3*3(3(3(3(3(3(3(3(3(3*3(3*3((*3(0(4(0(4(0(4(0,4(4(4,4(4(0(0(0(0,0,0(0(2(0(0(0(0(0,0(3*4,3*/(",
    "4(4(4(5)4(4(4(4+4+5(2(**-(+(4(4(4(4(4(4(4(4(4(4(4(1(1*2(0(2(4(4)4(4(4(4(4(4(4(4(4(4+4(4(4(4(4(4(4+4(4(4(4(4(4(4(4(4(4+4(4+4((+5(1(5(1(5(1(5(1,5(5(5,5(5(1(1(1(1,1,1(1(3(1(1(1(1(1,1(4+5,4+/(",
    "4(4(4(6)4(4(4(4+4+5(3(**-(+(4(4(4(4(4(4(4(4(4(4(4(1(1*3(0(3(4(4)4(4(4(4(4(4(4(4(4(4+4(4(4(4(4(4(4+4(4(4(4(4(4(4(4(4(4+4(4+4((,5(1(5(1(5(1(5(1,5(5(5,5(5(1(1(1(1,1,1(1(3(1(1(1(1(1,1(4+5,4+/(",
    "5(5(5(6)5(5(5(5+5+6(3(**.(+(5(5(5(5(5(5(5(5(5(5(5(2(2*3(1(3(5(5*5(5(5(5(5(5(5(5(5(5+5(5(5(5(5(5(5+5(5(5(5(5(5(5(5(5(5+5(5+5((,6(2(6(2(6(2(6(2,6(6(6,6(6(2(2(2(2,2,2(2(4(2(2(2(2(2,2(5+6,5+0(",
    "6(6(6(7)6(6(6(6+6+7(4(*+.(+(6(6(6(6(6(6(6(6(6(6(6(3(3+4(1(4(6(6*6(6(6(6(6(6(6(6(6(6,6(6(6(6(6(6(6+6(6(6(6(6(6(6(6(6(6+6(6+6((,7(3(7(3(7(3(7(3-7(7(7-7(7(3(3(3(3-3-3(3(5(3(3(3(3(3-3(6+7,6+0(",
    "6(6(6(8)6(6(6(6+6+7(4(*+.(+(6(6(6(6(6(6(6(6(6(6(6(3(3+4(2(4(6(6*6(6(6(6(6(6(6(6(6(6,6(6(6(6(6(6(6+6(6(6(6(6(6(6(6(6(6+6(6+6((,7(3(7(3(7(3(7(3-7(7(7-7(7(3(3(3(3-3-3(3(5(3(3(3(3(3-3(6+7-6+1(",
    "7(7(7(8)7(7(7(7+7+8(5(*+/(,(7(7(7(7(7(7(7(7(7(7(7(4(4+5(2(5(7(7*7(7(7(7(7(7(7(7(7(7,7(7(7(7(7(7(7+7(7(7(7(7(7(7(7(7(7+7(7+7((,8(4(8(4(8(4(8(4-8(8(8-8(8(4(4(4(4-4-4(4(7(4(4(4(4(4-4(7+8-7+1(",
    "8(8(8(9)8(8(8(8+8+9(6(*+/(,(8(8(8(8(8(8(8(8(8(8(8(4(4+6(3(6(8(8*8(8(8(8(8(8(8(8(8(8,8(8(8(8(8(8(8,8(8(8(8(8(8(8(8(8(8+8(8+8((,9(4(9(4(9(4(9(4-9(9(9-9(9(4(4(4(4-4-4(4(7(4(4(4(4(4-4(8+9-8+1(",
    "9(9(9(:)9(9(9(9,9,:(6(++/(,(9(9(9(9(9(9(9(9(9(9(9(5(5+7(3(7(9(9*9(9(9(9(9(9(9(9(9(9,9(9(9(9(9(9(9,9(9(9(9(9(9(9(9(9(9,9(9,9((,:(5(:(5(:(5(:(5.:(:(:.:(:(5(5(5(5.5.5(5(8(5(5(5(5(5.5(9,:-9,2(",
    "9(9(9(:)9(9(9(9,9,:(7(++0(,(9(9(9(9(9(9(9(9(9(9(9(5(5+7(4(7(9(9*9(9(9(9(9(9(9(9(9(9-9(9(9(9(9(9(9,9(9(9(9(9(9(9(9(9(9,9(9,9((,;(5(:(5(:(5(:(5.:(:(:.:(:(5(5(5(5.5.5(5(8(5(5(5(5(5.5(9,:.9,2(",
    ":(:(:(;*:(:(:(:,:,;(7(++0(,(:(:(:(:(:(:(:(:(:(:(:(6(6+8(4(8(:(:*:(:(:(:(:(:(:(:(:(:-:(:(:(:(:(:(:,:(:(:(:(:(:(:(:(:(:,:(:,:((,;(6(;(6(;(6(;(6.;(;(;.;(;(6(6(6(6.6.6(6(9(6(6(6(6(6.6(:,;.:,3(",
    ";(;(;(<*;(;(;(;,;,<(8(++0(,(;(;(;(;(;(;(;(;(;(;(;(6(6+8(5(8(;(;*;(;(;(;(;(;(;(;(;(;-;(;(;(;(;(;(;,;(;(;(;(;(;(;(;(;(;,;(;,;((,<(6(<(6(<(6(<(6.<(<(<.<(<(6(6(6(6.6.6(6(9(6(6(6(6(6.6(;,<.;,3(",
    ";(;(;(<*;(;(;(;,;,=(9(+,1(-(;(;(;(;(;(;(;(;(;(;(;(7(7,9(5(9(;(;*;(;(;(;(;(;(;(;(;(;-;(;(;(;(;(;(;,;(;(;(;(;(;(;(;(;(;,;(;,;((,<(7(=(7(=(7(=(7.=(=(=.=(=(7(7(7(7.7.7(7(:(7(7(7(7(7.7(;,=.;,3(",
    "<(<(<(=*<(<(<(<,<,=(9(+,1(-(<(<(<(<(<(<(<(<(<(<(<(7(7,9(6(9(<(<*<(<(<(<(<(<(<(<(<(<-<(<(<(<(<(<(<,<(<(<(<(<(<(<(<(<(<,<(<,<((-=(7(=(7(=(7(=(7/=(=(=/=(=(7(7(7(7/7/7(7(:(7(7(7(7(7/7(<,=/<,4(",
    "=(=(=(>*=(=(=(=-=->(9(+,1(-(=(=(=(=(=(=(=(=(=(=(=(8(8,:(6(:(=(=*=(=(=(=(=(=(=(=(=(=.=(=(=(=(=(=(=-=(=(=(=(=(=(=(=(=(=-=(=-=((-?(8(>(8(>(8(>(8/>(>(>/>(>(8(8(8(8/8/8(8(;(8(8(8(8(8/8(=->/=-4(",
    "=(=(=(>*=(=(=(=-=-?(:(+,2(-(=(=(=(=(=(=(=(=(=(=(=(8(8,:(7(:(=(=*=(=(=(=(=(=(=(=(=(=.=(=(=(=(=(=(=-=(=(=(=(=(=(=(=(=(=-=(=-=((-?(8(?(8(?(8(?(8/?(>(>/?(?(8(8(8(8/8/8(8(<(8(8(8(8(8/8(=-?/=-5(",
    ">(>(>(@*>(>(>(>->-@(;(,,2(-(>(>(>(>(>(>(>(>(>(>(>(9(9,;(7(;(>(>+>(>(>(>(>(>(>(>(>(>.>(>(>(>(>(>(>->(>(>(>(>(>(>(>(>(>->(>->((.@(9(@(9(@(9(@(9/@(?(?/@(@(9(9(9(9/9/9(9(=(9(9(9(9(9/9(>-@/>-5(",
    "?(?(?(A*?(?(?(?-?-@(<(,,2(-(?(?(?(?(?(?(?(?(?(?(?(9(9,<(8(<(?(?+?(?(?(?(?(?(?(?(?(?.?(?(?(?(?(?(?-?(?(?(?(?(?(?(?(?(?-?(?-?((.@(9(@(9(@(9(@(90@(@(@0@(@(9(9(9(90909(9(=(9(9(9(9(909(?-@0?-6(",
    "@(@(@(A*@(@(@(@-@-A(<(,,2(-(@(@(@(@(@(@(@(@(@(@(@(:(:,<(8(<(@(@+@(@(@(@(@(@(@(@(@(@.@(@(@(@(@(@(@-@(@(@(@(@(@(@(@(@(@-@(@-@((.A(:(A(:(A(:(A(:0A(A(A0A(A(:(:(:(:0:0:(:(>(:(:(:(:(:0:(@-A0@-6(",
    "@(@(@(B*@(@(@(@-@-B(<(,,3(.(@(@(@(@(@(@(@(@(@(@(@(;(;,=(9(=(@(@+@(@(@(@(@(@(@(@(@(@.@(@(@(@(@(@(@-@(@(@(@(@(@(@(@(@(@-@(@-@((.B(;(B(;(B(;(B(;0B(A(A0B(B(;(;(;(;0;0;(;(?(;(;(;(;(;0;(@-B0@-6(",
    "A(A(A(C*A(A(A(A.A.C(=(,-3(.(A(A(A(A(A(A(A(A(A(A(A(;(;->(9(>(A(A+A(A(A(A(A(A(A(A(A(A/A(A(A(A(A(A(A.A(A(A(A(A(A(A(A(A(A.A(A.A((.C(;(C(;(C(;(C(;0C(B(B0C(C(;(;(;(;0;0;(;(?(;(;(;(;(;0;(A.C0A.7(",
    "B(B(B(C*B(B(B(B.B.C(>(,-3(.(B(B(B(B(B(B(B(B(B(B(B(;(;->(:(>(B(B+B(B(B(B(B(B(B(B(B(B/B(B(B(B(B(B(B.B(B(B(B(B(B(B(B(B(B.B(B.B((.D(;(C(;(C(;(C(;1C(C(C1C(C(;(;(;(;1;1;(;(?(;(;(;(;(;1;(B.C0B.7(",
    "B(B(B(D*B(B(B(B.B.D(?(,-4(.(B(B(B(B(B(B(B(B(B(B(B(<(<-?(:(?(B(B+B(B(B(B(B(B(B(B(B(B/B(B(B(B(B(B(B.B(B(B(B(B(B(B(B(B(B.B(B.B((.D(<(D(<(D(<(D(<1D(D(D1D(D(<(<(<(<1<1<(<(@(<(<(<(<(<1<(B.D1B.8(",
    "C(C(C(E*C(C(C(C.C.E(?(,-4(.(C(C(C(C(C(C(C(C(C(C(C(=(=-?(;(?(C(C+C(C(C(C(C(C(C(C(C(C/C(C(C(C(C(C(C.C(C(C(C(C(C(C(C(C(C.C(C.C((.E(=(E(=(E(=(E(=1E(D(D1E(E(=(=(=(=1=1=(=(B(=(=(=(=(=1=(C.E1C.8(",
    "D(D(D(E*D(D(D(D.D.F(?(--4(.(D(D(D(D(D(D(D(D(D(D(D(=(=-@(;(@(D(D+D(D(D(D(D(D(D(D(D(D/D(D(D(D(D(D(D.D(D(D(D(D(D(D(D(D(D.D(D.D((/F(=(F(=(F(=(F(=1F(E(E1F(F(=(=(=(=1=1=(=(B(=(=(=(=(=1=(D.F1D.9(",
    "E(E(E(F*E(E(E(E.E.F(@(--5(.(E(E(E(E(E(E(E(E(E(E(E(>(>-A(<(A(E(E+E(E(E(E(E(E(E(E(E(E0E(E(E(E(E(E(E.E(E(E(E(E(E(E(E(E(E.E(E.E((/F(>(F(>(F(>(F(>2F(F(F2F(F(>(>(>(>2>2>(>(C(>(>(>(>(>2>(E.F1E.9(",
  ],
  "Inconsolata-Regular": [
    "/(/(0)0)/(/(/(/)/)-(/()*,(*(/(/(/(/(/(/(/(/(/(/(/(,(,*.(-(.(/(/(/(/(/(/(/(/(/(/(/(/(0)/(/(/(/(/(/+/(/(/(/(/(/(/(/(/(/)/(/)/(()/(-(/(-(/(-(/(.*/(0(0*/)/(-(-(-(-*-*-(-(/(-(-(-(-(-*-(/)/*/)-(",
    "/(/(0)0)/(/(/(0)0).(/()*,(*(/(/(/(/(/(/(/(/(/(/(/(-(-*.(-(.(/(/(/(/(/(/(/(/(/(/(/(/(0)/(/(/(/(/(/+/(/(/(/(/(/(/(/(/(/)/(/)/(()0(-(/(-(/(-(/(.*/(0(0*/)/(-(-(-(-*-*-(-(/(-(-(-(-(-*-(0)/*0)-(",
    "0(0(1)1)0(0(0(1)1).(/()*,(*(0)0(0(0(0(0(0(0(0(0(0(-(-*/(.(/(0(0(0(0(0(0(0(0(0(0(0(0(1)0(1(0(0(0(0+0(0(0(0(1(0(0(0(0(0)0)0)0(()0(.(0(.(0(.(0(/*0(1(1*0)0(.(.(.(.*.*.(.(0(.(.(.(.(.*.(0)0*0)-(",
    "2(1(2)1)1(1(1(2)2)/(0()+-(*(1)1(1(1(1(1(1(1(1(1(1(.(.+/(.(/(2(1(1(1(1(1(1(1(1(1(1(1(2)1(2(1(1(1(1+1(1(1(1(2(1(1(1(1(1)1)1)1(()1(/(2(/(2(/(2(0*2(2(2*2)2(/(/(/(/*/*/(/(1(/(/(/(/(/*/(1)1*1)-(",
    "2(1(2)2)1(1(1(2)2)0(0()+-(*(1)1(1(1(1(1(1(1(1(1(1(.(.+0(.(0(2(1(1(1(1(1(1(1(1(1(1(1(2)1(2(1(1(1(1,1(1(1(1(2(1(1(1(1(1)1)1)1(()1(/(2(/(2(/(2(0*2(2(2*2)2(/(/(/(/*/*/(/(1(/(/(/(/(/*/(2)1*2).(",
    "2(2(2)2)1(1(2(3*3*0(0(**-(*(2)1(1(1(1(1(1(1(1(1(1(.(.*1(/(1(2(1(1(1(1(1(1(1(1(1(1(1(2)1(2(1(1(1(1,1(1(1(1(2(1(1(1(1(2)2)2)1(()3(/(2(/(2(/(2(0*2(2(3*2)2(/(/(/(/*/*/(/(1(/(/(/(/(/*/(3)1*3).(",
    "3(3(4)3)3(3(3(4*4*1(1(**/(*(3)3(3(3(3(3(3(3(3(3(3(/(/*1(/(1(3(3(3(3(3(3(3(3(3(3(3(3(4)3(4(3(3(3(3,3(3(3(3(4(3(3(3(3(3)3)3)3(()3(0(3(0(3(0(3(1+3(4(4+3)3(0(0(0(0+0+0(0(2(0(0(0(0(0+0(3*3*3*.(",
    "3(3(4)4)3(3(3(5*5*1(2(*+/(*(3)3(3(3(3(3(3(3(3(3(3(/(/+2(1(2(3(3(3(3(3(3(3(3(3(3(3(3(4)3(4(3(3(3(3,3(3(3(3(4(3(3(3(3(3*3)3*3())4(0(3(0(3(0(3(1+3(4(4+3)3(0(0(0(0+0+0(0(2(0(0(0(0(0+0(4*3+4*/(",
    "5(4(5)4)4(4(4(5*5*2(2(*+/(+(4)4(4(4(4(4(4(4(4(4(4(0(0+2(1(2(5(4(4(4(4(4(4(4(4(4(4(4(5)4(5(4(4(4(4,4(4(4(4(5(4(4(4(4(4*4)4*4())4(1(5(1(5(1(5(2+5(5(5+5)5(1(1(1(1+1+1(1(3(1(1(1(1(1+1(5*4+5*/(",
    "5(5(5)5)4(4(5(6*6*2(3(*+/(+(5)4(4(4(4(4(4(4(4(4(4(0(0+3(1(3(5(4(4(4(4(4(4(4(4(4(4(4(5)4(5(4(4(4(4,4(4(4(4(5(4(4(4(4(5*5)5*4((*5(1(5(1(5(1(5(2+5(5(5+5)5(1(1(1(1+1+1(1(3(1(1(1(1(1+1(5*4+5*/(",
    "5(5(5)5)4(4(5(7*7*3(3(*+0(+(5)4(4(4(4(4(4(4(4(4(4(0(0+3(2(3(5(4(4(4(4(4(4(4(4(4(4(4(5)4(5(4(4(4(4,4(4(4(4(5(4(4(4(4(5*5)5*4((*6(1(5(1(5(1(5(2+5(5(6+5)5(1(1(1(1+1+1(1(4(1(1(1(1(1+1(6*4+6*/(",
    "6(6(6)6)5(5(6(7*7*3(4(*,0(+(6)5(5(5(5(5(5(5(5(5(5(1(1,4(2(4(6(5(5(5(5(5(5(5(5(5(5(5(6)5(6(5(5(5(5-5(5(5(5(6(5(5(5(5(6*6)6*5((*7(2(6(2(6(2(6(3,6(7(7,6)6(2(2(2(2,2,2(2(5(2(2(2(2(2,2(7*5+7*0(",
    "7(7(6)7)6(5(7(8*8*4(4(*,0(+(7)6(6(6(6(6(6(6(6(6(6(1(1,4(3(4(7(5(5(5(5(5(5(5(5(5(5(5(6)5(6(5(5(5(5-5(5(5(5(6(5(5(5(5(7*7)7*5((*7(2(7(2(7(2(7(3,7(7(7,7)7(2(2(2(2,2,2(2(5(2(2(2(2(2,2(7*5+7*0(",
    "8(7(8)7)7(7(7(9*9*4(5(*,0(+(7)7(7(7(7(7(7(7(7(7(7(2(2,5(3(5(8(7(7(7(7(7(7(7(7(7(7(7(8)7(8(7(7(7(7-7(7(7(7(8(7(7(7(7(7*7)7*7((*8(3(8(3(8(3(8(4,8(8(8,8)8(3(3(3(3,3,3(3(6(3(3(3(3(3,3(8*7+8*1(",
    "8(8(8)8)7(7(8(:+:+5(5(*-1(+(8)7(7(7(7(7(7(7(7(7(7(2(2-6(3(6(8(7(7(7(7(7(7(7(7(7(7(7(8)7(8(7(7(7(7-7(7(7(7(8(7(7(7(7(8*8)8*7((*8(3(8(3(8(3(8(4,8(8(8,8)8(3(3(3(3,3,3(3(6(3(3(3(3(3,3(9*7,9*1(",
    "9(9(9)9*8(8(9(:+:+5(5(+,1(+(9)8(8(8(8(8(8(8(8(8(8(3(3,6(4(6(9(8(8(8(8(8(8(8(8(8(8(8(9)8(9(8(8(8(8-8(8(8(8(9(8(8(8(8(9*9)9*8((*9(3(9(3(9(3(9(4,9(8(9,9)9(3(3(3(3,3,3(3(6(3(3(3(3(3,3(:*8,:*2(",
    "9(9(9):*8(8(9(;+;+6(6(+,1(+(9)8(8(8(8(8(8(8(8(8(8(3(3,7(4(7(9(8(8(8(8(8(8(8(8(8(8(8(9)8(9(8(8(8(8-8(8(8(8(9(8(8(8(8(9*9)9*8((*:(4(9(4(9(4(9(5,9(:(:,9)9(4(4(4(4,4,4(4(7(4(4(4(4(4,4(:*8,:*2(",
    ":(:(:):*9(9(:(<+<+6(7(+,2(,(:)9(9(9(9(9(9(9(9(9(9(3(3,7(5(7(:(9(9(9(9(9(9(9(9(9(9(9(:)9(:(9(9(9(9-9(9(9(9(:(9(9(9(9(:*:):*9((*;(4(:(4(:(4(:(5-:(:(:-:):(4(4(4(4-4-4(4(7(4(4(4(4(4-4(;+9,;+2(",
    ";(;(:);*9(9(;(=+=+7(7(+-2(,(;)9(9(9(9(9(9(9(9(9(9(4(4-8(5(8(;(9(9(9(9(9(9(9(9(9(9(9(:)9(:(9(9(9(9.9(9(9(9(:(9(9(9(9(;*;);*9((*;(5(;(5(;(5(;(6-;(;(;-;);(5(5(5(5-5-5(5(9(5(5(5(5(5-5(<+9,<+2(",
    ";(;(;)<*:(:(;(=+=+8(7(+-2(,(;):(:(:(:(:(:(:(:(:(:(4(4-8(5(8(;(:(:(:(:(:(:(:(:(:(:(:(;):(;(:(:(:(:.:(:(:(:(;(:(:(:(:(;+;);+:((*<(5(;(5(;(5(;(6-;(;(;-;);(5(5(5(5-5-5(5(9(5(5(5(5(5-5(<+:,<+3(",
    "<(<(<)<*;(;(<(>+>+8(8(+-2(,(<);(;(;(;(;(;(;(;(;(;(5(5-9(6(9(<(;(;(;(;(;(;(;(;(;(;(;(<);(<(;(;(;(;.;(;(;(;(<(;(;(;(;(<+<)<+;((*<(6(<(6(<(6(<(7-<(<(=-<)<(6(6(6(6-6-6(6(:(6(6(6(6(6-6(=+;-=+3(",
    "=(=(<)=*;(;(=(?+?+9(8(+-4(,(=);(;(;(;(;(;(;(;(;(;(5(5-:(6(:(=(;(;(;(;(;(;(;(;(;(;(;(<);(<(;(;(;(;.;(;(;(;(<(;(;(;(;(=+=)=+;((*=(6(=(6(=(6(=(7-=(<(=-=)=(6(6(6(6-6-6(6(:(6(6(6(6(6-6(>+;->+3(",
    "=(=(=)=*<(<(=(@+@+9(8(+.4(,(=)<(<(<(<(<(<(<(<(<(<(6(6.:(6(:(=(<(<(<(<(<(<(<(<(<(<(<(=)<(=(<(<(<(<.<(<(<(<(=(<(<(<(<(=+=)=+<((+>(7(=(7(=(7(=(8-=(>(>-=)=(7(7(7(7-7-7(7(;(7(7(7(7(7-7(>+<->+4(",
    ">(>(>)>*=(=(>(@+@+:(:(+.4(,(>)=(=(=(=(=(=(=(=(=(=(6(6.;(7(;(>(=(=(=(=(=(=(=(=(=(=(=(>)=(>(=(=(=(=.=(=(=(=(>(=(=(=(=(>+>)>+=((+?(7(>(7(>(7(>(8.>(>(>.>)>(7(7(7(7.7.7(7(;(7(7(7(7(7.7(?+=-?+5(",
    "?(?(>)?*=(=(?(A,A,:(;(,-5(,(?)=(=(=(=(=(=(=(=(=(=(6(6-;(8(;(?(=(=(=(=(=(=(=(=(=(=(=(>)=(>(=(=(=(=.=(=(=(=(>(=(=(=(=(?+?)?+=((+?(8(?(8(?(8(?(9.?(?(?.?)?(8(8(8(8.8.8(8(<(8(8(8(8(8.8(@+=-@+5(",
    "?(?(?)?*>(>(?(B,B,;(;(,-5(,(?)>(>(>(>(>(>(>(>(>(>(7(7-<(9(<(?(>(>(>(>(>(>(>(>(>(>(>(?)>(?(>(>(>(>/>(>(>(>(?(>(>(>(>(?+?)?+>((+@(8(?(8(?(8(?(9.?(?(?.?)?(8(8(8(8.8.8(8(<(8(8(8(8(8.8(A+>-A+5(",
    "@(@(?)@*>(>(@(B,B,;(;(,.5(-(@*>(>(>(>(>(>(>(>(>(>(7(7.<(9(<(@(>(>(>(>(>(>(>(>(>(>(>(?)>(?(>(>(>(>/>(>(>(>(?(>(>(>(>(@+@*@+>((+@(8(@(8(@(8(@(9.@(?(@.@)@(8(8(8(8.8.8(8(=(8(8(8(8(8.8(A+>-A+6(",
    "A(A(@)@*?(?(A(C,C,<(<(,.5(-(A*?(?(?(?(?(?(?(?(?(?(8(8.=(9(=(A(?(?(?(?(?(?(?(?(?(?(?(@)?(@(?(?(?(?/?(?(?(?(@(?(?(?(?(A+A*A+?((+A(9(A(9(A(9(A(:.A(A(A.A)A(9(9(9(9.9.9(9(>(9(9(9(9(9.9(B,?.B,6(",
    "A(A(A(@*@(@(A(D,D,<(=(,.6(-(A*@(@(@(@(@(@(@(@(@(@(8(8.>(:(>(A(@(@(@(@(@(@(@(@(@(@(@(A)@(A(@(@(@(@/@(@(@(@(A(@(@(@(@(A+A*A+@((+B(9(A(9(A(9(A(:.A(A(A.A)A(9(9(9(9.9.9(9(>(9(9(9(9(9.9(C,@.C,6(",
    "B(B(A(B*@(@(B(E,E,=(=(,/6(-(B*@(@(@(@(@(@(@(@(@(@(9(9/>(:(>(B(@(@(@(@(@(@(@(@(@(@(@(A)@(A(@(@(@(@/@(@(@(@(A(@(@(@(@(B+B*B+@((+C(:(B(:(B(:(B(;/B(B(B/B)B(:(:(:(:/:/:(:(?(:(:(:(:(:/:(C,@.C,6(",
    "C(C(B(B*A(A(C(E,E,=(>(,/6(-(C*A(A(A(A(A(A(A(A(A(A(9(9/?(;(?(C(A(A(A(A(A(A(A(A(A(A(A(B)A(B(A(A(A(A/A(A(A(A(B(A(A(A(A(C,C*C,A((+C(:(C(:(C(:(C(;/C(B(B/C)C(:(:(:(:/:/:(:(?(:(:(:(:(:/:(D,A.D,7(",
  ],
  "Inconsolata-SemiBold": [
    "/(/(0)0)/(/(/(/)/)-(/()*,(*(/(/(/(/(/(/(/(/(/(/(/(,(,*.(-(.(/(/(/(/(/(/(/(/(/(/(/(/(0)/(/(/(/(/(/+/(/(/(/(/(/(/(/(/(/)/(/)/(()/(-(/(-(/(-(/(.*/(0(0*/)/(-(-(-(-*-*-(-(/(-(-(-(-(-*-(/)/*/)-(",
    "/(/(0)0)/(/(/(0)0).(/()*,(*(/(/(/(/(/(/(/(/(/(/(/(-(-*.(-(.(/(/(/(/(/(/(/(/(/(/(/(/(0)/(/(/(/(/(/+/(/(/(/(/(/(/(/(/(/)/(/)/(()0(-(/(-(/(-(/(.*/(0(0*/)/(-(-(-(-*-*-(-(/(-(-(-(-(-*-(0)/*0)-(",
    "0(0(1)1)0(0(0(1)1).(/(**-(*(0)0(0(0(0(0(0(0(0(0(0(-(-*/(.(/(0(0(0(0(0(0(0(0(0(0(0(0(1)0(1(0(0(0(0+0(0(0(0(1(0(0(0(0(0)0)0)0(()0(.(0(.(0(.(0(/*0(1(1*0)0(.(.(.(.*.*.(.(0(.(.(.(.(.*.(1)0*1)-(",
    "2(1(2)1)1(1(1(2)2)/(1(**.(*(1)1(1(1(1(1(1(1(1(1(1(.(.*0(/(0(2(1(1(1(1(1(1(1(1(1(1(1(2)1(2(1(1(1(1+1(1(1(1(2(1(1(1(1(1)1)1)1())1(/(2(/(2(/(2(0*2(2(2*2)2(/(/(/(/*/*/(/(1(/(/(/(/(/*/(1)1*1)-(",
    "2(1(2)2)1(1(1(2*2*0(1(**.(*(1)1(1(1(1(1(1(1(1(1(1(.(.*0(/(0(2(1(1(1(1(1(1(1(1(1(1(1(2)1(2(1(1(1(1,1(1(1(1(2(1(1(1(1(1)1)1)1())2(/(2(/(2(/(2(0*2(2(2*2)2(/(/(/(/*/*/(/(1(/(/(/(/(/*/(2)1*2).(",
    "2(2(2)2)1(1(2(3*3*0(1(**.(+(2)1(1(1(1(1(1(1(1(1(1(/(/*1(0(1(2(1(1(1(1(1(1(1(1(1(1(1(2)1(2(1(1(1(1,1(1(1(1(2(1(1(1(1(2)2)2)1())3(/(2(/(2(/(2(0*2(3(3*2)2(/(/(/(/*/*/(/(1(/(/(/(/(/*/(3)1*3).(",
    "3(3(4)3)3(3(3(4*4*1(2(*+.(+(3)3(3(3(3(3(3(3(3(3(3(/(/+1(0(1(3(3(3(3(3(3(3(3(3(3(3(3(4)3(4(3(3(3(3,3(3(3(3(4(3(3(3(3(3)3)3)3((*3(0(3(0(3(0(3(1+3(4(4+3)3(0(0(0(0+0+0(0(2(0(0(0(0(0+0(3)3*3).(",
    "3(3(4)4)3(3(3(5*5*1(2(*+/(+(3)3(3(3(3(3(3(3(3(3(3(/(/+2(0(2(3(3(3(3(3(3(3(3(3(3(3(3(4)3(4(3(3(3(3,3(3(3(3(4(3(3(3(3(3*3)3*3((*4(0(3(0(3(0(3(1+3(4(4+3)3(0(0(0(0+0+0(0(2(0(0(0(0(0+0(4*3+4*.(",
    "5(4(5)4)4(4(4(5*5*2(2(*+/(+(4)4(4(4(4(4(4(4(4(4(4(0(0+2(1(2(5(4(4(4(4(4(4(4(4(4(4(4(5)4(5(4(4(4(4,4(4(4(4(5(4(4(4(4(4*4)4*4((*4(1(5(1(5(1(5(2+5(5(5+5)5(1(1(1(1+1+1(1(3(1(1(1(1(1+1(5*4+5*/(",
    "5(5(5)5)4(4(5(6*6*2(2(*,/(+(5)4(4(4(4(4(4(4(4(4(4(0(0,3(1(3(5(4(4(4(4(4(4(4(4(4(4(4(5)4(5(4(4(4(4,4(4(4(4(5(4(4(4(4(5*5)5*4((*6(1(5(1(5(1(5(2+5(6(6+5)5(1(1(1(1+1+1(1(3(1(1(1(1(1+1(5*4+5*0(",
    "5(5(5)5)4(4(5(7*7*3(3(++0(+(5)4(4(4(4(4(4(4(4(4(4(1(1+4(2(4(5(4(4(4(4(4(4(4(4(4(4(4(5)4(5(4(4(4(4,4(4(4(4(5(4(4(4(4(5*5)5*4((*6(1(5(1(5(1(5(2+5(6(6+5)5(1(1(1(1+1+1(1(4(1(1(1(1(1+1(6*4+6*0(",
    "6(6(6)6)5(5(6(8*8*3(3(++0(+(6)5(5(5(5(5(5(5(5(5(5(1(1+4(2(4(6(5(5(5(5(5(5(5(5(5(5(5(6)5(6(5(5(5(5-5(5(5(5(6(5(5(5(5(6*6)6*5((*7(2(6(2(6(2(6(3,6(7(7,6)6(2(2(2(2,2,2(2(5(2(2(2(2(2,2(7*5+7*0(",
    "7(7(6)7)6(5(7(8*8*4(4(+,0(,(7)6(6(6(6(6(6(6(6(6(6(2(2,5(2(5(7(5(5(5(5(5(5(5(5(5(5(5(6)5(6(5(5(5(5-5(5(5(5(6(5(5(5(5(7*7)7*5((*7(2(7(2(7(2(7(3,7(7(7,7)7(2(2(2(2,2,2(2(5(2(2(2(2(2,2(8*5+8*1(",
    "8(7(8)7)7(7(7(9*9*4(5(+,0(,(7)7(7(7(7(7(7(7(7(7(7(2(2,5(3(5(8(7(7(7(7(7(7(7(7(7(7(7(8)7(8(7(7(7(7-7(7(7(7(8(7(7(7(7(7*7)7*7((*8(3(8(3(8(3(8(4,8(8(9,8)8(3(3(3(3,3,3(3(6(3(3(3(3(3,3(8*7+8*1(",
    "8(8(8)8)7(7(8(:+:+5(5(+,2(,(8)7(7(7(7(7(7(7(7(7(7(2(2,6(3(6(8(7(7(7(7(7(7(7(7(7(7(7(8)7(8(7(7(7(7-7(7(7(7(8(7(7(7(7(8*8)8*7((*9(3(8(3(8(3(8(4,8(9(9,8)8(3(3(3(3,3,3(3(6(3(3(3(3(3,3(9*7,9*1(",
    "9(9(9)8)8(8(9(:+:+6(5(+,2(,(9)8(8(8(8(8(8(8(8(8(8(3(3,6(4(6(9(8(8(8(8(8(8(8(8(8(8(8(9)8(9(8(8(8(8-8(8(8(8(9(8(8(8(8(9*9)9*8()*:(3(9(3(9(3(9(4,9(9(9,9)9(3(3(3(3,3,3(3(6(3(3(3(3(3,3(:*8,:*1(",
    "9(9(9):)8(8(9(;+;+6(6(+-2(,(9)8(8(8(8(8(8(8(8(8(8(3(3-7(5(7(9(8(8(8(8(8(8(8(8(8(8(8(9)8(9(8(8(8(8-8(8(8(8(9(8(8(8(8(9*9)9*8()*:(4(9(4(9(4(9(5,9(:(:,9)9(4(4(4(4,4,4(4(7(4(4(4(4(4,4(:*8,:*2(",
    ":(:(:):*9(9(:(<+<+7(7(+-2(,(:)9(9(9(9(9(9(9(9(9(9(4(4-8(5(8(:(9(9(9(9(9(9(9(9(9(9(9(:)9(:(9(9(9(9-9(9(9(9(:(9(9(9(9(:*:):*9((+;(4(:(4(:(4(:(5-:(:(:-:):(4(4(4(4-4-4(4(7(4(4(4(4(4-4(;*9,;*3(",
    ";(;(:);*9(9(;(=+=+7(8(,,3(,(;)9(9(9(9(9(9(9(9(9(9(4(4,8(6(8(;(9(9(9(9(9(9(9(9(9(9(9(:)9(:(9(9(9(9.9(9(9(9(:(9(9(9(9(;*;);*9((+;(5(;(5(;(5(;(6-;(;(<-;);(5(5(5(5-5-5(5(9(5(5(5(5(5-5(<*9,<*3(",
    ";(;(;)<*:(:(;(=+=+8(8(,-3(-(;):(:(:(:(:(:(:(:(:(:(5(5-9(6(9(;(:(:(:(:(:(:(:(:(:(:(:(;):(;(:(:(:(:.:(:(:(:(;(:(:(:(:(;+;);+:((+=(5(;(5(;(5(;(6-;(<(<-;);(5(5(5(5-5-5(5(9(5(5(5(5(5-5(=+:,=+3(",
    "<(<(<)<*;(;(<(>+>+8(9(,-3(-(<);(;(;(;(;(;(;(;(;(;(5(5-9(6(9(<(;(;(;(;(;(;(;(;(;(;(;(<);(<(;(;(;(;.;(;(;(;(<(;(;(;(;(<+<)<+;((+=(6(<(6(<(6(<(7-<(=(=-<)<(6(6(6(6-6-6(6(:(6(6(6(6(6-6(=+;-=+4(",
    "=(=(<)=*;(;(=(?+?+9(9(,-4(-(=);(;(;(;(;(;(;(;(;(;(6(6-:(7(:(=(;(;(;(;(;(;(;(;(;(;(;(<);(<(;(;(;(;.;(;(;(;(<(;(;(;(;(=+=)=+;((+>(6(=(6(=(6(=(7-=(=(=-=)=(6(6(6(6-6-6(6(:(6(6(6(6(6-6(>+;->+4(",
    "=(=(=)=*<(<(=(@+@+9(9(,.4(-(=)<(<(<(<(<(<(<(<(<(<(6(6.:(7(:(=(<(<(<(<(<(<(<(<(<(<(<(=)<(=(<(<(<(<.<(<(<(<(=(<(<(<(<(=+=)=+<((+>(7(=(7(=(7(=(8-=(>(>-=)=(7(7(7(7-7-7(7(;(7(7(7(7(7-7(?+<-?+4(",
    ">(>(>)>*=(=(>(@,@,:(9(,.4(-(>)=(=(=(=(=(=(=(=(=(=(6(6.;(8(;(>(=(=(=(=(=(=(=(=(=(=(=(>)=(>(=(=(=(=.=(=(=(=(>(=(=(=(=(>+>)>+=((+?(7(>(7(>(7(>(8.>(?(?.>)>(7(7(7(7.7.7(7(;(7(7(7(7(7.7(?+=-?+4(",
    "?(?(>)?*=(=(?(A,A,:(;(,.4(-(?)=(=(=(=(=(=(=(=(=(=(7(7.<(8(<(?(=(=(=(=(=(=(=(=(=(=(=(>)=(>(=(=(=(=.=(=(=(=(>(=(=(=(=(?+?*?+=((+@(8(?(8(?(8(?(9.?(@(@.?)?(8(8(8(8.8.8(8(<(8(8(8(8(8.8(@+=-@+6(",
    "?(?(?)?*>(>(?(B,B,;(;(,.5(-(?*>(>(>(>(>(>(>(>(>(>(7(7.<(8(<(?(>(>(>(>(>(>(>(>(>(>(>(?)>(?(>(>(>(>/>(>(>(>(?(>(>(>(>(?+?*?+>((+A(8(?(8(?(8(?(9.?(@(@.?)?(8(8(8(8.8.8(8(<(8(8(8(8(8.8(A+>-A+6(",
    "@(@(?)@*>(>(@(C,C,;(;(-.6(.(@*>(>(>(>(>(>(>(>(>(>(8(8.=(9(=(@(>(>(>(>(>(>(>(>(>(>(>(?)>(?(>(>(>(>/>(>(>(>(?(>(>(>(>(@+@*@+>((+A(8(@(8(@(8(@(9.@(@(@.@)@(8(8(8(8.8.8(8(=(8(8(8(8(8.8(A+>-A+6(",
    "A(A(@)@*?(?(A(C,C,<(<(-.6(.(A*?(?(?(?(?(?(?(?(?(?(8(8.=(9(=(A(?(?(?(?(?(?(?(?(?(?(?(@)?(@(?(?(?(?/?(?(?(?(@(?(?(?(?(A+A*A+?((+B(9(A(9(A(9(A(:.A(B(B.A)A(9(9(9(9.9.9(9(>(9(9(9(9(9.9(B+?.B+6(",
    "A(A(A)A*@(@(A(D,D,=(<(-.6(.(A*@(@(@(@(@(@(@(@(@(@(9(9.>(9(>(A(@(@(@(@(@(@(@(@(@(@(@(A)@(A(@(@(@(@/@(@(@(@(A(@(@(@(@(A+A*A+@((,B(9(A(9(A(9(A(:.A(B(B.A)A(9(9(9(9.9.9(9(>(9(9(9(9(9.9(C+@.C+7(",
    "B(B(A)B*@(@(B(E,E,=(=(-/7(.(B*@(@(@(@(@(@(@(@(@(@(9(9/?(;(?(B(@(@(@(@(@(@(@(@(@(@(@(A)@(A(@(@(@(@/@(@(@(@(A(@(@(@(@(B+B*B+@((,C(:(B(:(B(:(B(;/B(C(C/B)B(:(:(:(:/:/:(:(?(:(:(:(:(:/:(D+@.D+7(",
    "C(C(B)B*A(A(C(F,F,>(>(-/7(.(C*A(A(A(A(A(A(A(A(A(A(9(9/?(;(?(C(A(A(A(A(A(A(A(A(A(A(A(B)A(B(A(A(A(A/A(A(A(A(B(A(A(A(A(C,C*C,A((,D(:(C(:(C(:(C(;/C(C(C/C)C(:(:(:(:/:/:(:(?(:(:(:(:(:/:(D,A.D,7(",
  ],
};
// [advance, xMin, xMax] in font units for U+0021-U+007E (unhinted outlines; used for ink overhang on the right)
const SS_GLYPH_X = {
  "OpenSans-Regular": [[547,152,393],[821,133,688],[1323,51,1270],[1171,131,1036],[1686,104,1581],[1495,113,1491],[453,133,319],[606,82,545],[606,61,524],[1130,86,1038],[1171,104,1065],[502,63,365],[659,84,575],[545,152,393],[752,20,731],[1171,102,1069],[1171,188,715],[1171,100,1061],[1171,94,1051],[1171,43,1130],[1171,133,1053],[1171,117,1071],[1171,94,1067],[1171,104,1065],[1171,106,1061],[545,152,393],[545,63,389],[1171,104,1065],[1171,119,1049],[1171,104,1065],[879,27,825],[1841,121,1720],[1296,0,1296],[1327,201,1214],[1292,125,1231],[1493,201,1368],[1139,201,1016],[1057,201,1016],[1491,125,1341],[1511,201,1311],[571,201,371],[547,-160,360],[1257,201,1257],[1063,201,1016],[1849,201,1649],[1544,201,1343],[1595,125,1470],[1233,201,1128],[1595,125,1470],[1266,201,1231],[1124,106,1026],[1133,18,1114],[1491,186,1305],[1219,0,1219],[1896,27,1868],[1182,8,1174],[1147,0,1147],[1169,82,1087],[674,166,623],[752,23,733],[674,51,508],[1110,49,1059],[918,-4,922],[1182,393,786],[1139,94,973],[1255,176,1141],[975,115,907],[1255,115,1079],[1149,115,1042],[694,29,782],[1122,39,1073],[1257,176,1092],[518,162,358],[518,-111,358],[1075,176,1053],[518,176,342],[1905,176,1739],[1257,176,1092],[1237,115,1122],[1255,176,1141],[1255,115,1079],[836,176,807],[977,106,883],[723,31,680],[1257,164,1081],[1026,0,1026],[1593,23,1571],[1073,39,1032],[1032,2,1030],[958,82,877],[776,61,705],[1128,494,635],[776,72,715],[1171,104,1065]],
  "OpenSans-SemiBold": [[565,133,430],[893,133,760],[1323,47,1274],[1169,111,1063],[1765,84,1681],[1516,96,1513],[498,133,365],[649,82,588],[649,61,567],[1122,74,1044],[1169,96,1073],[547,63,412],[659,72,586],[563,133,430],[799,16,782],[1169,88,1081],[1169,154,780],[1169,90,1081],[1169,86,1069],[1169,39,1133],[1169,117,1065],[1169,94,1087],[1169,74,1085],[1169,88,1081],[1169,86,1079],[563,133,430],[569,63,428],[1169,96,1073],[1169,102,1065],[1169,96,1073],[928,16,877],[1839,111,1726],[1354,0,1354],[1352,193,1241],[1298,121,1231],[1503,193,1382],[1143,193,1020],[1090,193,1018],[1487,121,1329],[1538,193,1346],[625,193,432],[612,-156,426],[1309,193,1309],[1110,193,1051],[1890,193,1698],[1604,193,1411],[1612,121,1491],[1260,193,1161],[1612,121,1491],[1309,193,1290],[1126,100,1036],[1159,29,1128],[1520,180,1339],[1274,0,1274],[1937,12,1923],[1274,4,1270],[1212,0,1212],[1178,66,1112],[676,154,625],[799,16,782],[676,51,520],[1100,29,1071],[879,-4,883],[1212,362,848],[1188,90,1028],[1276,168,1171],[1014,102,948],[1276,102,1108],[1180,102,1081],[743,35,834],[1139,23,1102],[1300,168,1141],[571,154,418],[571,-121,418],[1171,168,1161],[571,168,403],[1958,168,1798],[1300,168,1141],[1251,102,1149],[1276,168,1171],[1276,102,1108],[883,168,846],[997,98,911],[805,39,752],[1300,158,1133],[1096,0,1096],[1673,20,1651],[1128,25,1102],[1098,0,1098],[979,68,907],[791,45,745],[1128,473,653],[760,45,715],[1169,96,1073]],
  "Inconsolata-Regular": [[500,180,299],[500,135,365],[500,25,476],[500,60,460],[500,28,482],[500,36,481],[500,210,290],[500,122,414],[500,114,406],[500,41,458],[500,45,456],[500,165,306],[500,111,391],[500,180,295],[500,64,437],[500,57,443],[500,88,300],[500,58,439],[500,69,427],[500,48,472],[500,64,445],[500,67,439],[500,79,432],[500,60,441],[500,68,439],[500,179,298],[500,165,306],[500,35,461],[500,45,456],[500,40,466],[500,64,434],[500,31,465],[500,16,484],[500,48,457],[500,41,469],[500,54,460],[500,59,441],[500,78,437],[500,35,460],[500,50,449],[500,81,403],[500,49,457],[500,42,471],[500,66,439],[500,41,460],[500,50,456],[500,27,473],[500,59,456],[500,29,473],[500,56,464],[500,52,455],[500,31,463],[500,50,454],[500,25,478],[500,17,488],[500,41,468],[500,28,473],[500,50,463],[500,131,418],[500,64,437],[500,131,418],[500,93,403],[500,35,466],[500,154,293],[500,49,445],[500,60,457],[500,56,457],[500,45,449],[500,49,445],[500,63,473],[500,38,475],[500,73,432],[500,100,396],[500,48,379],[500,66,479],[500,79,421],[500,38,470],[500,72,431],[500,39,461],[500,60,463],[500,42,442],[500,119,458],[500,57,440],[500,70,444],[500,64,442],[500,40,455],[500,16,481],[500,47,456],[500,22,443],[500,50,450],[500,53,408],[500,217,284],[500,54,409],[500,71,461]],
  "Inconsolata-SemiBold": [[500,166,313],[500,125,375],[500,19,483],[500,54,468],[500,22,485],[500,32,485],[500,202,298],[500,109,422],[500,106,419],[500,35,466],[500,41,461],[500,156,319],[500,107,395],[500,169,308],[500,52,449],[500,44,456],[500,76,314],[500,48,445],[500,52,437],[500,42,474],[500,57,455],[500,57,449],[500,70,440],[500,49,452],[500,54,445],[500,166,307],[500,156,318],[500,34,464],[500,43,459],[500,39,469],[500,60,442],[500,27,470],[500,14,487],[500,41,467],[500,34,476],[500,46,468],[500,54,451],[500,70,448],[500,28,468],[500,42,461],[500,74,419],[500,37,464],[500,38,485],[500,60,451],[500,35,468],[500,41,466],[500,22,481],[500,51,466],[500,23,480],[500,48,474],[500,40,461],[500,26,471],[500,41,462],[500,19,486],[500,13,492],[500,33,478],[500,20,483],[500,42,472],[500,122,426],[500,52,451],[500,123,427],[500,79,416],[500,33,468],[500,146,301],[500,40,449],[500,52,467],[500,45,464],[500,37,457],[500,42,453],[500,47,483],[500,32,481],[500,61,446],[500,90,410],[500,39,384],[500,57,487],[500,68,432],[500,33,476],[500,60,446],[500,31,469],[500,52,471],[500,32,450],[500,99,464],[500,49,448],[500,62,450],[500,54,450],[500,33,461],[500,12,485],[500,34,469],[500,17,451],[500,43,457],[500,42,412],[500,205,296],[500,50,420],[500,54,468]],
};
// Images from SeedSigner resources/img (MIT, Copyright (c) 2021 SeedSigner).
// SIM (VOIDFORGE): the third-party partner logo (resources/img/partners/hrf_logo.png) is left out of this file.
const SS_IMAGE_DATA = {
  "btc_logo_60x60.png": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAAA8CAMAAAANIilAAAAC91BMVEX////7khb6kRYXDQL5kRURCgEEAgAAAAD/lBanYQ7+kxbriBTuihW9bhD/9uv/7trEchG6bBBAJQY/JQX/lxv/lhvLdhL/rEsQCQEFAwD/x4X/+vXzjRX/oTH/1KH/8N/BcBH/oTKqYw89IwUPCQEaDwIZDwIYDgKlYA7/4Lq5axANCAEMBwFrPgn//Pj/tV7///7/9+//rk//niz/lRlXMgi/bxD/y47PeBI5IQXNdxK8bRA2HwX/vXD//PmZWQ3/vnH/ni0SCgKTVQ3/sFORVA3/1aTsiRRWMgf/pjzyjBXphxT/8uTYfRPFchH/tV3/9OarYw//uWb/nCj/miP/05//lBffgRPcgBO+bhD/xoM+JAVBJgb/t2OoYg7AbxGpYg//tFxDJwasZA//6c9uQAnCcRF0Qwr/1qb/rEr/lhqiXg7/+vRpPQn//Pr/+/b/oDD//v3/6M7/yYr/qkb//fr/3bb/sVT/5MT/xoT//vz/5sn/0Jn/xYD/lRj/6tLdgBNYMwj/4r//w3vKdRH/wnv/vW/HcxH/rlD/5cb/4sA4IAU3IAX/mB//slf/r1H/u2r/uGT/myb/1KKtZA//4sH/pz//pDn/69T/wHcVDAIUDAL/oTP/rUwTCwL/48KWVw3/79v/z5f/ny6ITwz/rU3/8uL/xH///fv/0Jj4kBX/s1r/v3P3jxX/9en/yoz/yIb1jhX0jhX/tmHxjBVVMQdUMQf/3rjwixVTMAf/zZP/yIfafxP/06D/37k8IwX/sVb/yIj/uWX/wXj/pDr/ojT/u2z/2Kv/1qX/1aX/pj3/37r/+fIbEAL/16j/qUX/tl//xH7/p0B4Rgp3RQptPwn/lxxyQgr/miT/zpT/umm3ahCkXw51RApxQgpwQQr/s1v/0Zr/nCf/+O//pTv/myX/yYn/u2v/rk7/8eD/+PD/5MX/mB7/7dj/+fH/r1D/+vP/8uP/lx3/+/f/6tH/niv/w3z/y4//mSD/7NX/qEH/4b7/sVUET+TYAAADmUlEQVRIx52XZUAUQRTHn9TOwakHWIQoiISApC0Kggp2d6Igohhgi93d3d3d3d3d3d3tB/d27s7bmbfH6v/bvPn/dmYn34CAyjvhkkZXX+tONu7W+V1zCsBdgMTOJDbMQmSyKRRUUBXcpBVDUll5OWcKj25OFDWssUXYugWxKC9rZXiAA8lEDnEKsN1iokJlXTDYtihRpVK2PGw7mKhU8bksXK44Ua1ceeSwS1bM9fhZJ7zndjJ4Pmp6CvCmL4ngK8qbw0Xw/vUAeEVInxfJN9maLX9hn4oom6MjQDoh/gCtufm2NsGTmaqwCuP1P/scAN6RiLcAN7gPa4zwKHumZqdI5Us++gCg8EfSRSzc57tVwgDr2Io0MOpD2Os+AL3q8HB+Cjux8Zz54K86vER+Wa8CEtyKr5g9Y60ZD9l61uY9zfRwQXTvVweZCntwuJWPCF9Bp2m4xFQ5kd3Uem7WEiTCjii8SyLqEjLtgGEE2k9lLI4CBNqg8DwJOCitlWKUHsFYbAKhieLiAggJp6UKlM7LmJyhDQovkdzZDaVxFI5lTHfAD4XXS+49htIqCrND5gfVUHiK5K5FC/W20ekawy4yaID+sptkr3Hs0P4jnrHdaMP+rKs/VMLgOcCrTDzr2gwrMdiVZ7N151zusAaDR9Ilcty0vmAhsrE2gDvC5nQzznLeIdMpvLwRb9sO9RE4t/ksb6pBcVfOVhV0ir/sYSh5VqEb25O1NQcNAg80n2VChtKmB7G2dnBZHog4e6FLcFfJHG2MtaXwCha+BwnywHnT+C4wxaJoYB3hNoZ3FvacN6j3yXo0tGgpDTRlt2QACLJb6qJsXewtFjUh0iPUsMImMvAt8SRJNA+knGt06jSgmsT2OhU7AK+GpT/i2VD2KLDy1R+9NfkV1h4g7UeIOes2FrlwsENfmpvf5MsnE9rZP17h0BcasvGeAF2/k5/6ET5cPXLZ6pbRiteNUJq96H6JE0XIV7HFh0qphb3xohO85BUp7wG+ESIeIP0U85Jmpvt5VmX5eAVn9OtO+orzm6GYzFlbTivCP/eCYCV4q3lCE4M5nrS8rsDGyLIhu6zkH+QoT6UE25L/n8QJQp5catmS5ZDEVWXPHb3RlLn8/6fMouIqZoZW3qH8TPCtaRG118y0+EApbSFlr1Yg06eRcwsr9Gmk2afqUeYTVMiGfZSl+qp80YkKcLrbLqlqJa1W2yDpdpvGgbjrD1ZS9eyP9m1GAAAAAElFTkSuQmCC",
  "logo_black_240.png": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPAAAADwCAYAAAA+VemSAAAACXBIWXMAAAsTAAALEwEAmpwYAAAF+GlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4gPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgNi4wLWMwMDYgNzkuZGFiYWNiYiwgMjAyMS8wNC8xNC0wMDozOTo0NCAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczpkYz0iaHR0cDovL3B1cmwub3JnL2RjL2VsZW1lbnRzLzEuMS8iIHhtbG5zOnBob3Rvc2hvcD0iaHR0cDovL25zLmFkb2JlLmNvbS9waG90b3Nob3AvMS4wLyIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0RXZ0PSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VFdmVudCMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIDIyLjQgKE1hY2ludG9zaCkiIHhtcDpDcmVhdGVEYXRlPSIyMDIxLTA5LTEwVDE1OjI0OjQ0LTA1OjAwIiB4bXA6TW9kaWZ5RGF0ZT0iMjAyMS0wOS0xMFQxNjoyODoyNS0wNTowMCIgeG1wOk1ldGFkYXRhRGF0ZT0iMjAyMS0wOS0xMFQxNjoyODoyNS0wNTowMCIgZGM6Zm9ybWF0PSJpbWFnZS9wbmciIHBob3Rvc2hvcDpDb2xvck1vZGU9IjMiIHBob3Rvc2hvcDpJQ0NQcm9maWxlPSJzUkdCIElFQzYxOTY2LTIuMSIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDo4OTJiOTQ2NS03YmIwLTQ2YzktOTY2MC0wYmI5YzU1NDFiY2IiIHhtcE1NOkRvY3VtZW50SUQ9ImFkb2JlOmRvY2lkOnBob3Rvc2hvcDpkYmEzOGQwZS00NjExLTZiNGQtYWYxNy1lYzljY2I2ZWNlYjkiIHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDo3MzRiMDQ4Yi0wZjdiLTQzZjMtOTRkYS0zYzkwYWRkMDkwNDIiPiA8eG1wTU06SGlzdG9yeT4gPHJkZjpTZXE+IDxyZGY6bGkgc3RFdnQ6YWN0aW9uPSJjcmVhdGVkIiBzdEV2dDppbnN0YW5jZUlEPSJ4bXAuaWlkOjczNGIwNDhiLTBmN2ItNDNmMy05NGRhLTNjOTBhZGQwOTA0MiIgc3RFdnQ6d2hlbj0iMjAyMS0wOS0xMFQxNToyNDo0NC0wNTowMCIgc3RFdnQ6c29mdHdhcmVBZ2VudD0iQWRvYmUgUGhvdG9zaG9wIDIyLjQgKE1hY2ludG9zaCkiLz4gPHJkZjpsaSBzdEV2dDphY3Rpb249InNhdmVkIiBzdEV2dDppbnN0YW5jZUlEPSJ4bXAuaWlkOjg5MmI5NDY1LTdiYjAtNDZjOS05NjYwLTBiYjljNTU0MWJjYiIgc3RFdnQ6d2hlbj0iMjAyMS0wOS0xMFQxNjoyODoyNS0wNTowMCIgc3RFdnQ6c29mdHdhcmVBZ2VudD0iQWRvYmUgUGhvdG9zaG9wIDIyLjQgKE1hY2ludG9zaCkiIHN0RXZ0OmNoYW5nZWQ9Ii8iLz4gPC9yZGY6U2VxPiA8L3htcE1NOkhpc3Rvcnk+IDwvcmRmOkRlc2NyaXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8+vjgP1QAAGqZJREFUeNrtnXd4FVXex39iAXbFFWXfdfV1QdTdVwHXVVZXUUFwRUWlSC8JJUBIKOmhSG9KM4LAUkRXQEQDUqSIKB0VEKVJJ3SQDlKSO2fm+/5xJuSWyc29Nzchke99ns8DD2TOzJ2cz5xzfud3zoiIHBGRC4SQYscREREQQootcoE3gZBiyQUKTAgFJoRQYEIIBSaEAhNCKDAhhAITQigwIRSYEEKBCSEUmBAKzJtBCAUmhFBgQggFJoQCE0IoMCGEAhNCKDAhFJgQQoEJIRSYEApMCKHAhBAKTAihwIRQYEIIBSaEUGBCCAUmhAITQigwIYQCE0KBCSEUmBBCgQkhFJgQCkwIocCEEApMCAWmwIRQYEIIBSaEUGBCKDAhhAITQigwIYQCE0KBCSEUmBBCgQmhwIQQCkwIocCEEApMCAUmhFBgQggFJoRQYEIoMCGEAhNCKDAhFJgQQoEJIRSYEEKBCaHAhBAKTAihwIQQCkwIBSaEUGBCCAUmhAITQigwIYQCE0IoMCEUmBBCgQkhFJgQCkyBCaHAhBAK7MbtJQVP3y3o+IhgZA3BjDqCrxsJ1rUQ/NBSsJ6QMJJdp75qKJheRzDwGUGz/xM89AcKHDBV/ijo85S+iec6C5BIyDUmSbA7SjC2puD1ioIbb6DAHtS8V/B+bcHmSFYWUjQFdv/7ofaCz18X1H/wOhf45fsESxqxgpDiK/bGJoLa5a8zgdtWFqxuZt+EBFYEUoxJFSBZ8H0TQb2//sYFrnCbIP01ry5JXvT7EzC+JjA7Blg2DNg4Hdg6B9i+EPj5i+uABfq7jnqUshRlkgVIEXxQU1Diht+gwL2eFGTGB3AjBpUHFvQAts0Hjm0GjEzwA+CDupSkqJOgRd7XVhDx0G9I4Pn1Avjy458Hts4FLIuyOn0mvEBBigsp+s+4fxRzgZ+9S7Czg78vWwKYnwQc3URBKfBvMsj12UvFVOAqdwjQ2R4beHczUgUYXx04sZNiUuDffJBrXv1iJnC9hwQuOzp3NcqcZHctBpYD1nxEISnwdcWXDYqJwA+XFqCfQ6Q5XoCxtYBLpygjBb4uA1wzXy/iAj/+Z8GF+FwyWT6Po4QU+LqXOK1WERb4ly62rN7JGavHUEAKTGyJX6lYBAWe9aqDuD0EWJNG+SgwccNMEDxyZxESOOFJe4zrfbGrRlM8Ckwc2BxRRAQuW0rgivO6wO4CpEdROgpM/HSlI6sUAYEXvOHVdU4Q4D/VKBwFJgFIXLbUNRT45b/4rpVEnABnDlE4CkwCYMIL11DgLa0dsqxWc9xLgUmgGPGCm0pcA4Gr/MFOiUxyk/e9pykaBSZBMrDaNRB4ZSOvPOcEAQ7/QNEoMAkSK1FQ+qZCFLhSOYdFCiMqUTIKTEJctdTjiUIUePKLDmPfvSsoWVESOE6AWAFiBOhaCAvZu9jn6pxLTkBhLqoPx88U8m4e3zUpRIE3RXhdwLDKFKwoCJwiQLQAzQUqSmAmloCVcgtUjMBqKUBLW+xkh+Ni9HFWc/0nOucsTM91C5lY+5gIgeossFJLQnUTmK0FaGFfS7LDTEWyAG0EaGbTxv73JD/fK8rt5yPsh4S9jQ3i9HezmgvMALGa2+W4bYeDrvq6zabOWM3se9gpj+sNoQW+0EVQ5uZCEPhPv3d4mq2bnP8Kuukz4Isk4LMo4POuwIrRwNEteR+XsVrvGbVzSR58qfeXcirTlQnsXxl4OdsXAqf3+ZZzZr/eCmjbPGD7In2+HYs1+1YC5w4VjMDZlamlQCXcCiM9DsbOpVCnD8C68AuMjHUwVoyDMf41mG3sipvsdlyMQKX8Hio9BsbC3jBnd4GZeKMW1EncrgI0EaguN8CY1gZq/TQYh36CdfEkjKPbYWyaDdfHUVDxZbRwMW4PjWSBFSVQo6vBWtAD5oLuMEZVhdXaz3frIFCDH4D5RXdYC3rAmPgKrM523esmsDoJzKnN4VrUF5lLhiBryWC/ZC4ZAmNhb6gJdWB1tM/TRWDECFwfNUfm3FRcnpuKK25cnpsK17zuMD5sjKzEMjCbuT2gwiFxD0Gr+wtB4LZVHAQ+ko/g1e45wOD7c8pK8KqUY6oBJ3f7Hpd1ERheObQu1vK3c8o5vAvoUU5H1IMt6+f5OeUc2xbYL3P0U8Da8eEVONludYc8DnXmCKxctiUyTRPGT59D9SgPq4N9XLzAaiMwNs+9epxlWVBrxutWO8FrB8Z2AjNS4PqwDYxju3M9l2VZUOeOQ01tD7OdlhApArQXmP0qQil19WeVUjDSqgONHFr9zgIr9maoMwc9voc5sY5udVsIjNmJME0z6FuqlIIaUwtopXsRWUtHeVxXbvfQdeYYsua+CSPmZiAyj55KoLwp+LhGIQj82eteJ+5TDjCN0OT9aTkwOIBNtVNLAftWeR67fV7oN6v//+aUs7qvrpjxwY9bMOGVnHK+eju4LtXwSsDRzfkXOFm3vMbQRwKuxEpdgepTAWhvd5XjBDh/xLNTcngrjI5u4+cU3dVVsSVhbF2Uq7hOIhsHfoTqfrdusZoJ1LTmvmK4LsJIukN3Ud2FiBKoweV9v9uCVKChwGonUBnfhdx+qKWDgQYCs5PAPLUvqGNdv+yBq+/fcno0+RE4XnC6m+CGghb4oPceVx81Ce3OXTiif1HxgX05DP2z5/EbpoV2o+IEeMutrC+6h74f8Du1cspZ9lZowZGlQ/IncFeBFV0C6tTuoG6/OfE5oJUtcDcBftnu2cHJ+A5GJ1vgZN1dNCMF6sC3oYkyozHQVD9ssqY0dHwAqEPrYLVxG2Mm6hY7a8B9vi3j3HigscDqKDB3Lw9d4MW9gQYCV7Qga//6oI83TuyEamPfxzB0pavcUYACV7zd4aTfTQjtzs3r6txiDa8EDL7P99+Xve15/I8zQ7tJ3QV4v0VOOV/2Dv41G9ld/ZUj3AQeHvKTF4c3hC5wa4GV9ncfIUzThFo7AeYnfaC2LfD4f3VwA8wON2k5swU+/rOnwPvWwoi2BU4QWE0ExvrJfrvLmXvWQZ095tNaqsunYCbeqcVsKXBNaZBrC24s7Q/rNfv+JmmBXf3L+wo8p5sWuIPA3Pl10NXPNE24Th2A6vsA0EZgRAtc+9eFVJWz0qNhNQlDUCtB0O6RAhT41YoOJw3liey6DIz4u+cX7n2HDhJd7dqOAbqX0sJNa+xbhpPAk+sAC3sB8xIdSADmJwM/vAtkue01vcRB4BmRem9qp3LmJABfpADfTvS8HieBpzYFFvTUZU1vBYx4xPkX17tc3vtf5yZwKwEmvOgr1LSWsGoLUFegWgiMr4fDPLkXxp4VMJLL6shvcgACd9PnMMY959xqHtkAY1JTqLjScHUQqG4lYYx9DWr3Gv0QuXgaxpDHcrrGeQhsmiaMMc/pSHhyaAIrVyaMKQ2BUbWA/zgwsTbUe9VhpJTWsYD4XAQ+ewB4txowqhqQ9jSQVhvY9LFvdT62w3O4kQ9GVC9AgeMe827NSgKXzwQv8MWTwNAHPctKe9z3566cBY5vdS7DSeCD3wd/LYscBDZV8OU4CXzhmMO4/1PnrnZ6p7AKbHzQENYL9hRNpD3dkyCwYrQUV4N2eQkcq4Nc5n7fB7XauxxmpAAN7W5vJ90jQD2BFSlQgyrCSr5RR6JTciLl/gS+GqRKtcfD0cEL7Lp8Aa4WAjwjwKtuvCZAfTsKH2lfrx1VdxT42Gb9IGlif6/GogNt2xf5Xu9b9wPt8i/wp68WoMBvVXcbsyYJMOi+0LrPlgmMedq3a/pFCnDlfGBlOAm8Y1Hw17LYQWCvgE7IAmesdv7ZbXN8x/7JtwA7vwqpC22mPerQhVYwFvaDOeQJWAPug9lFYDWw52fd5zDzEri9wEoSWBc9NyM0L52BSiqtJetuB5s6C6zupWF1v0V/vyiB1VlgdnWLQgcgMACozbNhNtIPKNeAikG2wFeQNaYGVN9KUMOq5PB2JVh9yvlO/+Qm8Ikd+t50dot71BU9zen9wBz9tH4o5FPg+fULUODJNexfVrZwaU+GPn20YYzecsd7M4Cet+p3IS3qpd8NdGpv4AIPuR9490ng3Sc0af8ERv4dmPIKsHtV4AIPr+xQzqPApJd9KnpIAgPA+/V9I5dLBwYvcGeBGXMT1K/Hcx2fWpYFdXwHjOXjYQx5VCcxdLKFykvgSIEx0LcFNJcMABroMqw2AmPcSzAO/QTz15OwLhyHdf4YrPPHYf56CsbBH6FGP697A04CW6Zz9HrZ27BqC4z+9wY9BrYsS7eMXqjL52EOrezZWubaAm/RPZzmArS1k0gaC7D7a99u/9CKYWmBlzYuQIGnPafnq66e8D8185e8MehRoGcAQaPprXzHiMEEseIFGHx34AL7Y/Kr4RF4+0LfrvT8pJCnkdQ7NQOaRjJNE65l4/XcbKydAulP4OYCY/QzHmWbpgnjg0a6QsfbmVgZ/mMhxu5vYNky+AissqB+nOnTKluWBXNgBRhREtYglrGoj+4W5yXwmQzg7SrAkMrAsEpA/6rA8qG+Y+BTB+DKvpf5DGKtaFaAAn9a12vax2vsFfTn1zPA+PKBJV8MewhQWaFHoXvcmn+BEwRIqxoegfcs9/35ufGhZ2I1F6gBlWDs+z4gkY2lg2E1DVTgpz0EsiwLxn+b6mmhOD0Xax7+0X+kdv86XV4T5y601f8euMb6Bsqs07txud/9UKcPhE/gpUN11DgvgQOc586a3UnfizCkVq5sUoACf/yqwwvJwvFZNQaY+DLQs4z/Srp6XN4CJziQKMDbDwcnsFMZCQJ83DI8Am+e7bmWOlGAJT1CF9jOxjLbCoyJdWFsWwzzyqVcZTZNE6pnWR2cyasLPcC3C2suGwnrDX1uK0Lg+jwRpso9oSdr72odqc1FYEx6CWZ1gdrve89cJ/bCdMvEClVgy7KglII5oY7uGodBYOPwJj1fHhOeeeDlBSnwxNpelWbU4+FN2M+6pHOJZ3cBet3m2w3+qH7Oz250EHj4w8CEWsD4GjbV9UNmajPg1K7ABU6r6lzOtKbAryfCI/C453PEzc5LXvhO8AJnB6RaC8xoO9n+dYHZXmD2Kgdz0D9gzOgI88oF3zHmtJY6gpxHEAtJ4vNGDTPzIlTPO3KCYrECs/89wJC/Ar0e8JlezNqzyr/A05oBdQQq8U6oS6fzrit+BDYNF9SXA2Clp8CanwprfiqwoAfU/BQY42rC6uSVIhqiwJZlIWtyXeCNMKVTJgqWNCrIKPRzXicceG/+hN23Blg9DMi84NC9PgG8ebtbcEuAwY+5tWAzfVvMXV/lPwqdIHqaKyxR6DW5BPAm+Y5j+/wROLglNIEjBMZ7NWDsWQnj2/dhxpXWYsXoaSTreYFKj/WQxrIsqIVv6kBUXtNIbQXmft90RbV/LcwWdnCnmx1pjrSnbLbNDU7gjxrpYxsKjJFV8x4G+J1G+hWuNgLUEi2XO83c0kezk0X8CJwdBMzG5x6sHqtXKYVpZdK8egUocGxlr/B7Ugnnuc5APssn6ZuYZOdTO+3m0f9uj2RvDH4i5/+2OLTAGWvDM43kPtbOj8Deq48unwU+6eW7xC5egB/eD20euI1AjXjKo4trnNwDI+UuWHXtaaMXBGpxH98WeGYHXanzSuRoKTAm1HSuwPuWwxj0T5gtBKqpwGwmUG0FllfuekACt7S75PUFxuI3/U81+RHYyLyEy6m3wdVKYMT64uqshUWEHcjLJZHDOnsIxkeRUFNbQ01vg8yJzWCczPDKMjsPV+JN+uEVhrXM0wtyHvjlCg5Pmn2rgq/sW6YB/R1ew7L6Pb3K6Mp5YEl/3xzm9Ej/XejxzwOfRgEz3fjUiy/7A1fO+U/k+LCBZxne5cyOAlaP8HwZ+QoHgSfUBma2Az5pq//eq7RnFD+bUU+ElkqZIDCbCFybZvmKdfk01LRYmENqwZjVFZbXghPTNKGGP6ynSPJKpYzX62GNLZ/mPp7esgRXvnoHxvefQB3bBsurBc3avx6uTnoaJi+BESswWwpcu78KSWDAguvwFmRlrEPWwY2+HPoJrv3fQ60eByuhNBCdi8AHvofV0E5UaS6waghcn3fz7Uand9IJHmFYWjj02QIU+J4yDntArxwZvMC75gADc1nI0LMM0P13zl9wldtrWn78JOTF05hSP/RppOzv3UeAuYPcehTDQ//FXTwRei50K4ExranfZX2OwZftC2G2srvZ3QQ47r2Y4dscge2URrODQJ07EFKHy9izAqq17sJmTXkjd4GzVz610+czzx3MW+Bd34Q8ijNnRQNvaIGzMrwEProZVhe36aG2AjXwHp/uvXHhJFzxpfIfyEoSNPlrAa9G2hflLUPd0O7cN1N1UkigY4chD+guaPbnh+mh36h+bquRFvQI/UEwwW010tIhIVzHXZ7536EI3FWPUdXPi4NK5Fd9K+pIbFe7d3Nqj6fABzfmrEZKzMmiUm/eB+PErqCDPeZ/m+nufAuBmuq7nBDTW+j/d9+Fo5FAjX3B+SE0PwlopFcjqb1rQhd46VCggUDFCtSxbZ7XfWInrK5uAscLVITA5bD6yUhv5zm3HCIP3F7AAn/wklclTikdePqjz1TKNP2LSsillUu2M79GVvE9x9a5vmPJQMXrf2/+WuBEAXoJMNItqWPN6OCWE45/Xg8XAv34S+SIFlitBUa6/4XtlmXB2L8Baui/crax6WbvkHFip2cXfPdy3ULHe0nVSqBiboaxYkKegSbLsmCcOQRjbH1Ybe2yWgnM957zCaiZE2vntMDuOzY2EhgzonxTRWfH6Ba4ucD1w/SQBVYz2wGNBWYrgWu750Mwa+fXUBFe6cMtBVnDPddeG4YB17CndLZWPuTdE1UIC/pbPexw8sPrQ76ByFgFTKjpW/mTBOhZFkhPdD4u8wIwqmpoa3DXjnXLd92po+lB3/CbgD1uY6+zB4BeZf0f07MMMKUesHVO8PfJ3zxwik6NtJoKjOHVYHz3IdT541BKXZ37NPatgzErBSpacpIOknIWzRuja8DYvQLq/HEYe9fCHP64c4XM3lWjmcAY/i8YG2bAOHf0aoU2TRPGlYtQ+9bDmNsHKulWPT7M3sMqTi+edy1PgzqVAXV8O4xlaTC73uy7midJt35mU4Hry0FQJ/dCndoHY+MMmD3v0l3WDgLVpzxcW+bBPHsY1tlDsM4c9M+5o1C/7IJr7SSouFJAF90Vd/WtiMx103Fpx3JkbpiBrIF/g9Xeq5FI0OPzzOXvIvPcL3BtnoOsvn/TWwLlcwz8fu1CEPj2koJL3jd62bD8TSdZFrA5HfjmLWDRm7pVXP0ucDiPPbEunwfWTwfWTQkcpwUDZzKADR8FXsb3U5zneI9tATZ+DGyYCmycnsOGqVraYHbgCEZg9/lge3sYlVISxrDKsMY8A2NA+RxxYx3mLO3dNsyOAjP5Fj2f3N7P3Gay3UOKEJgRAiO5JNSIR4H3noGZ9iSM3v8Ds6N9vo5e5dirf6w2+jWbZjfRKZZdcjlfst1LaCsw4+1jWttj91Sb9gIzSmAm3QgrqQSsxBv8k3wjzDi9QcHV+2GXo1oLMjsIjNZeq7bcr6eLQHUUXEm5FWaUvVIpOf9TSbUrFNKulD94d3UG/gX8FPAn0G1lsyP7MXYCfqRdEbvlUcHs7vTVbWiTgjxX9rLF1ra0/s6XZLfIsfacbEIA15b98/a0j+M7uWLcfsYf7tvfJjnkzXfNY6cY+6GCTpIzFZrPse+Z2ELcVnZ4dYeL2PgJJSsKApNi+ZbCRQ0LUeC/3OZwEQPupmQUmIQocESlQn430qevOnQ9di2maBSYBMmh9tfg5Wbly+Sy5I8fCkyCa32rXKP3A69s7pCZNS+RslFgEmDA8ViHa/iC76cqCNDbbVuc7Kjk6QwKR4FJAK1vypPXUGARwfuP2RK7h9jfqeq4zxE/FJjksKNN0G9iCL/AIoLMHg7zcvndL4sfCvwbbnmRLKhwe/68C5vArSrncqELulM8CkwcEkHGVMu3vOETWEQw7nV74YH3NrFfJFA+CkzcWt8t7cMib3gFFhFsaii+28R2F2BWKgWkwCRRcLGzoFzpIirwnbcIzg522GkjUYCJL1JCCnzdt741/jds8oZfYBHBg38QnO3svXeWzeh/6Tfc80OBr0N56z0YVnkLRmARwcNlBVcS/KwsWdiHQlLg6yfinChoWSns8hacwCKCh8sJjnby94b6KvolX5wvpsC/ZXoImt5XIPIWrMAigjtK6Z3m/T6dBlcAvpuU9/txKTBlKGYt7y/Rgn/eXWDyFrzAV7O1/p13FwP97tJvJNyxGDh7kMJ6fya/QimKC6n6DQt3li5YrwpNYBFBtXsER2MctihxHCeXAEY+DqRHAysmAFsX63e1nj2o39hw8eT1xaVTwLjqFKMoE2/X7WRBxP0F71OhCywiKFtK8N6zDntq+dvjKUU8d65MLaX3je5e+jrid/qhRlGKLimC9JcEle8sNHkLX+CrG8TfKni3htumZAmsAKR45jMjVTDrNcHjfy5ch66pwNlULitIe1qwqa1Xq8sKQor4tNCBaMHUfwtqXBtxi4bA7lS9SzD8ObcdLxPsNMxkttCkaHCgvWBybcGL5QUlbrj2zhQpgd2pdKcgsrJg9LOCWXUE3zQWfNdc8FOEYEukYGtr/Sch4WRra8GmCMG6Fnr6c249waQXBZ0fFVS7O99rd68fgQkhFJgQCkwIocCEEApMCKHAhFBgQggFJoRQYEIoMCGEAhNCKDAhhAITQoEJIRSYEEKBCSEUmBAKTAihwIQQCkwIBSaEUGBCCAUmhFBgQigwIYQCE0IoMCEUmAITQoEJIRSYEEKBCaHAhBAKTAihwIQQCkwIBSaEUGBCCAUmhAITQigwIYQCE0IoMCEUmBBCgQkhFJgQQoEJocCEEApMCKHAhFBgQggFJoRQYEIIBSaEAhNCKDAhhAITQigwIRSYEEKBCSEUmBAKTAihwIQQCkwIocCEUGBCCAUmhFBgQigwBSaEAhNCKDAhhAITQoEJIRSYEEKBCSEUmBAKTAihwIQQCkwIBSaEUGBCCAUmhFBgQigwIaToCswbQUjxRY7YJhNCihdH/h8eH4629cbIlwAAAABJRU5ErkJggg==",
};

/* =====================================================================================================
 * models/threads.py
 * ===================================================================================================== */

// threading.Thread stand-in: `async run()` is an async loop that checks `this.keep_running` and uses `await ssSleep()`.
class SSBaseThread {
    constructor() {
        this.keep_running = false;
        this._alive = false;
        this._started = false;
    }

    start() {
        if (this._alive) return;
        this.keep_running = true;
        this._alive = true;
        this._started = true;
        Promise.resolve()
            .then(() => this.run())
            .catch((e) => { if (!(e instanceof SSAbort)) console.error(`${this.constructor.name}:`, e); })
            .finally(() => { this._alive = false; });
    }

    stop() { this.keep_running = false; }

    is_alive() { return this._alive; }

    async run() {
        throw new Error(`Must implement run() in ${this.constructor.name}`);
    }
}

class SSThreadsafeCounter {
    constructor(initial_value = 0) {
        if (initial_value && typeof initial_value === "object") initial_value = initial_value.initial_value || 0;
        this.count = initial_value;
    }
    get cur_count() { return this.count; }
    increment(step = 1) { this.count += step; }
    set_value(value) { this.count = value; }
}

// threading.Lock stand-in. `await lock.acquire()` waits (FIFO) like the blocking Python lock.
class SSLock {
    constructor() { this._locked = false; this._waiters = []; }
    locked() { return this._locked; }
    acquire() {
        if (!this._locked) { this._locked = true; return Promise.resolve(true); }
        return new Promise((resolve) => this._waiters.push(resolve));
    }
    release() {
        if (this._waiters.length) {
            const next = this._waiters.shift();
            next(true);   // ownership handed over; stays locked
        } else {
            this._locked = false;
        }
    }
}

// `with lock:` -> await ssWithLock(lock, () => {...})
async function ssWithLock(lock, fn) {
    await lock.acquire();
    try { return await fn(); } finally { lock.release(); }
}

/* =====================================================================================================
 * gui/renderer.py
 * ===================================================================================================== */

class SSRenderer {
    static get_instance() {
        if (!SSRenderer._instance) throw new Error("Must call SSRenderer.configure_instance() first");
        return SSRenderer._instance;
    }

    static configure_instance(display_canvas) {
        const renderer = Object.create(SSRenderer.prototype);
        SSRenderer._instance = renderer;
        renderer.lock = new SSLock();
        renderer.display_canvas = display_canvas || null;
        renderer.initialize_display();
        return renderer;
    }

    get is_screenshot_generator() { return false; }

    initialize_display() {
        // SIM: the simulated device is always the "st7789 320x240" display (SeedSigner+), whatever display_config says.
        this.display_type = "st7789";
        this.canvas_width = 320;
        this.canvas_height = 240;
        this.canvas = SSImage.new("RGB", [this.canvas_width, this.canvas_height]);
        this.draw = SSImageDraw.Draw(this.canvas);
        const renderer = this;
        this.disp = {
            width: this.canvas_width,
            height: this.canvas_height,
            show_image(image, x, y) { renderer._present(image || renderer.canvas); },
            invert() {},
            cleanup() {},
        };
        if (this.display_canvas) {
            this.display_canvas.width = this.canvas_width * SS_SCALE;
            this.display_canvas.height = this.canvas_height * SS_SCALE;
            if (!this.display_canvas.style.width) this.display_canvas.style.width = this.canvas_width + "px";
            if (!this.display_canvas.style.height) this.display_canvas.style.height = this.canvas_height + "px";
            this._dctx = this.display_canvas.getContext("2d");
        }
    }

    _present(image) {
        if (!this._dctx) return;
        const ctx = this._dctx;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, this.display_canvas.width, this.display_canvas.height);
        ctx.imageSmoothingEnabled = image.scale !== SS_SCALE;
        ctx.drawImage(image.canvas, 0, 0, image.canvas.width, image.canvas.height,
            0, 0, image.width * SS_SCALE, image.height * SS_SCALE);
        // Settings "Invert colors" (hardware setting)
        if (ssSettingGet("color_inverted", "D") === "E") {
            ctx.globalCompositeOperation = "difference";
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, this.display_canvas.width, this.display_canvas.height);
        }
        ctx.restore();
    }

    // show_image(image=None, alpha_overlay=None, show_direct=False)
    show_image(image = null, alpha_overlay = null, show_direct = false) {
        if (image && !(image instanceof SSImage) && typeof image === "object") {
            ({ image = null, alpha_overlay = null, show_direct = false } = image);
        }
        if (show_direct) {
            this.disp.show_image(image, 0, 0);
            return;
        }
        if (alpha_overlay) {
            if (!image) image = this.canvas;
            image = SSImage.alpha_composite(image, alpha_overlay);
        }
        if (image) {
            // Always write to the current canvas, rather than trying to replace it
            this.canvas.paste(image, [0, 0]);
        }
        this.disp.show_image(this.canvas, 0, 0);
    }

    // SIM: the Python loop is paced by the SPI display; here each step waits one 1/30 s frame.
    async show_image_pan(image, start_x, start_y, end_x, end_y, rate, alpha_overlay = null) {
        let cur_x = start_x, cur_y = start_y, rate_x = rate, rate_y = rate;
        if (end_x - start_x < 0) rate_x = rate_x * -1;
        if (end_y - start_y < 0) rate_y = rate_y * -1;
        while ((cur_x !== end_x || cur_y !== end_y) && (rate_x !== 0 || rate_y !== 0)) {
            cur_x += rate_x;
            if ((rate_x > 0 && cur_x > end_x) || (rate_x < 0 && cur_x < end_x)) { cur_x -= rate_x; rate_x = 0; }
            cur_y += rate_y;
            if ((rate_y > 0 && cur_y > end_y) || (rate_y < 0 && cur_y < end_y)) { cur_y -= rate_y; rate_y = 0; }
            let crop = image.crop([cur_x, cur_y, cur_x + this.canvas_width, cur_y + this.canvas_height]);
            if (alpha_overlay) crop = SSImage.alpha_composite(crop, alpha_overlay);
            this.canvas.paste(crop, [0, 0]);
            this.disp.show_image(crop, 0, 0);
            await ssSleep(1 / 30);
        }
    }

    display_blank_screen() {
        this.draw.rectangle([0, 0, this.canvas_width, this.canvas_height], { outline: 0, fill: 0 });
        this.show_image();
    }
}
SSRenderer._instance = null;

/* =====================================================================================================
 * hardware/buttons.py
 * ===================================================================================================== */

class SSHardwareButtonsConstants {}
SSHardwareButtonsConstants.KEY_UP = "KEY_UP";
SSHardwareButtonsConstants.KEY_DOWN = "KEY_DOWN";
SSHardwareButtonsConstants.KEY_LEFT = "KEY_LEFT";
SSHardwareButtonsConstants.KEY_RIGHT = "KEY_RIGHT";
SSHardwareButtonsConstants.KEY_PRESS = "KEY_PRESS";
SSHardwareButtonsConstants.KEY1 = "KEY1";
SSHardwareButtonsConstants.KEY2 = "KEY2";
SSHardwareButtonsConstants.KEY3 = "KEY3";
SSHardwareButtonsConstants.OVERRIDE = "OVERRIDE";
SSHardwareButtonsConstants.ALL_KEYS = ["KEY_UP", "KEY_DOWN", "KEY_LEFT", "KEY_RIGHT", "KEY_PRESS", "KEY1", "KEY2", "KEY3"];
SSHardwareButtonsConstants.KEYS__LEFT_RIGHT_UP_DOWN = ["KEY_LEFT", "KEY_RIGHT", "KEY_UP", "KEY_DOWN"];
SSHardwareButtonsConstants.KEYS__ANYCLICK = ["KEY_PRESS", "KEY1", "KEY2", "KEY3"];

/*
 * SIM: GPIO levels are replaced by key state. A key is "LOW" (pressed) while it is held (keyboard keydown or
 * key_down() from the page). A tap that is already released when the 10 ms polling loop looks (a mouse click can go
 * down and up between two polls) still counts once: it stays pending until wait_for() returns it, or SS_KEY_LATCH_MS
 * after it can first be returned. Key repeat (SeedSigner's first_repeat_threshold rule) happens only while the key
 * is really held, never from a pending tap, so two quick taps count as two, as on the device. check_for_low() and
 * has_any_input() (toasts, the screensaver) see a tap as LOW for SS_KEY_LATCH_MS, as they would see a short press.
 */
const SS_KEY_LATCH_MS = 120;
const SS_TAP_MS = 110;
const SS_REPEAT_MIN_MS = 60;

class SSHardwareButtons {
    static get_instance() {
        if (!SSHardwareButtons._instance) {
            const hb = Object.create(SSHardwareButtons.prototype);
            hb.override_ind = false;
            hb.cur_input = null;            // Track which direction or button was last pressed
            hb.cur_input_started = null;    // Track when that input began
            hb.last_input_time = Date.now();
            hb.first_repeat_threshold = 225;  // Long-press time required before returning continuous input
            hb.next_repeat_threshold = 250;   // Amount of time where we no longer consider input a continuous hold
            hb._held = {};
            hb._down_at = {};
            hb._pending = {};               // SIM: a tap not yet returned by wait_for()
            hb._pend_at = {};
            SSHardwareButtons._instance = hb;
        }
        return SSHardwareButtons._instance;
    }

    // Static conveniences required by the brief: SSHardwareButtons.wait_for(keys), SSHardwareButtons.check_for_low(key)
    static wait_for(keys) { return SSHardwareButtons.get_instance().wait_for(keys); }
    static check_for_low(key, keys) { return SSHardwareButtons.get_instance().check_for_low(key, keys); }
    static has_any_input() { return SSHardwareButtons.get_instance().has_any_input(); }

    // GPIO level for check_for_low() / has_any_input(): held, or tapped less than SS_KEY_LATCH_MS ago
    _is_low(key) {
        if (this._held[key]) return true;
        const t = this._down_at[key];
        return t !== undefined && Date.now() - t < SS_KEY_LATCH_MS;
    }
    // For wait_for(): held, or a tap it has not returned yet (kept SS_KEY_LATCH_MS from when it can first be returned)
    _is_waiting(key) {
        if (this._held[key]) return true;
        if (!this._pending[key]) return false;
        if (Date.now() - this._pend_at[key] < SS_KEY_LATCH_MS) return true;
        this._pending[key] = false;   // a tap nobody waited for is gone, like a short press the device did not poll
        return false;
    }

    // Page/keyboard input
    key_down(key) {
        if (!SSHardwareButtonsConstants.ALL_KEYS.includes(key)) return;
        if (!this._held[key]) { this._down_at[key] = this._pend_at[key] = Date.now(); this._pending[key] = true; }
        this._held[key] = true;
    }
    key_up(key) { this._held[key] = false; }
    tap(key, ms = SS_TAP_MS) {
        this.key_down(key);
        setTimeout(() => this.key_up(key), ms);
    }

    /*
     * Block execution until one of the target keys is pressed.
     * Optionally override the wait by calling `trigger_override()`.
     */
    async wait_for(keys = []) {
        const controller = SSController.get_instance();
        this.override_ind = false;
        // Always yield to the browser event loop once (a held key must never spin the microtask queue)
        await ssSleep(0);

        while (true) {
            if (this.override_ind) {
                // Break out of the wait_for without waiting for user input
                this.override_ind = false;
                return SSHardwareButtonsConstants.OVERRIDE;
            }

            const cur_time = Date.now();
            if (cur_time - this.last_input_time > controller.screensaver_activation_ms && controller.is_screensaver_start_allowed) {
                // Start the screensaver. Will block execution until input detected.
                await controller.start_screensaver();

                // We're back. Update last_input_time to now.
                this.update_last_input_time();

                // Freeze any further processing for a moment to avoid having the wakeup
                //   input register in the resumed UI.
                await ssSleep(this.next_repeat_threshold / 1000.0);

                // Resume from a fresh loop
                continue;
            }

            // Check each candidate key to see if it was pressed
            for (const key of keys) {
                if (this._is_waiting(key)) {
                    if (this.cur_input !== key) {
                        this.cur_input = key;
                        this.cur_input_started = Date.now();
                        this.last_input_time = this.cur_input_started;
                        this._pending[key] = false;
                        return await this._return_key(key);
                    } else {
                        // Still pressing the same input
                        if (cur_time - this.last_input_time > this.next_repeat_threshold) {
                            // Too much time has elapsed to consider this the same continuous input.
                            this.cur_input_started = cur_time;
                            this.last_input_time = cur_time;
                            this._pending[key] = false;
                            return await this._return_key(key);
                        } else if (this._held[key] && this._down_at[key] <= this.cur_input_started &&
                                   cur_time - this.cur_input_started > this.first_repeat_threshold &&
                                   cur_time - this.last_input_time >= SS_REPEAT_MIN_MS) {
                            // We're good to relay this immediately as continuous input.
                            // (SIM: only while the key is held down without a break since this input began, and at
                            // most one repeat per SS_REPEAT_MIN_MS, the time a Pi needs to redraw a screen.)
                            this.last_input_time = cur_time;
                            this._pending[key] = false;
                            return await this._return_key(key);
                        } else if (this._pending[key]) {
                            // SIM: a new tap inside the "same press" window: keep it pending until the window ends
                            // (then it is a new separate press, as a second press after next_repeat_threshold is on the device).
                            this._pend_at[key] = Math.max(this._pend_at[key], this.last_input_time + this.next_repeat_threshold + 1);
                        }
                        // else: not yet at the first repeat threshold; ignore this round's input.
                    }
                }
            }

            await ssSleep(0.01);  // wait 10 ms to give CPU chance to do other things
        }
    }

    // SIM: in Python the Screen blocks on `with renderer.lock:` right after wait_for() returns while a toast holds
    // the lock. Waiting here gives every ported screen that behavior even if it does not take the lock itself.
    async _return_key(key) {
        const r = SSRenderer._instance;
        while (r && r.lock.locked()) await ssSleep(0.01);
        return key;
    }

    update_last_input_time() { this.last_input_time = Date.now(); }

    trigger_override() { this.override_ind = true; }

    // check_for_low(key=None, keys=None) -> true if one of the target keys/key is pressed
    check_for_low(key = null, keys = null) {
        if (key && typeof key === "object" && !Array.isArray(key)) { keys = key.keys || null; key = key.key || null; }
        if (Array.isArray(key)) { keys = key; key = null; }
        if (key) keys = [key];
        for (const k of keys || []) {
            if (this._is_low(k)) {
                this.update_last_input_time();
                return true;
            }
        }
        return false;
    }

    has_any_input() {
        for (const key of SSHardwareButtonsConstants.ALL_KEYS) {
            if (this._is_low(key)) return true;
        }
        return false;
    }
}
SSHardwareButtons._instance = null;

/* =====================================================================================================
 * hardware/microsd.py (SIM)
 * ===================================================================================================== */

// SIM: no real card. The card counts as inserted at boot (as on a device that just booted from it);
// the page can call SSMicroSD.get_instance().set_inserted(false/true) to simulate removing/inserting it.
class SSMicroSD {
    static get_instance() {
        if (!SSMicroSD._instance) {
            const m = Object.create(SSMicroSD.prototype);
            m._inserted = true;
            SSMicroSD._instance = m;
        }
        return SSMicroSD._instance;
    }
    get is_inserted() { return this._inserted; }
    start_detection() {}
    set_inserted(inserted) {
        if (inserted === this._inserted) return;
        this._inserted = inserted;
        const action = inserted ? SSMicroSD.ACTION__INSERTED : SSMicroSD.ACTION__REMOVED;
        const S = ssGet(() => SSSettings);
        if (S && typeof S.handle_microsd_state_change === "function") {
            try { S.handle_microsd_state_change(action); } catch (e) { console.warn(e); }
        }
        if (SSController._instance) {
            SSController.get_instance().activate_toast(new SSSDCardStateChangeToastManagerThread({ action }));
        }
    }
}
SSMicroSD._instance = null;
SSMicroSD.ACTION__INSERTED = "add";
SSMicroSD.ACTION__REMOVED = "remove";

/* =====================================================================================================
 * gui/components.py
 * ===================================================================================================== */

class SSGUIConstants {
    static _locale(locale) {
        return locale || ssSettingGet("locale", "en");
    }
    static get_body_font_name(locale = null) {
        locale = SSGUIConstants._locale(locale);
        return SSGUIConstants.BODY_FONT_NAME[locale] || SSGUIConstants.BODY_FONT_NAME["default"];
    }
    static get_body_font_size(locale = null) {
        locale = SSGUIConstants._locale(locale);
        return SSGUIConstants.BODY_FONT_SIZE[locale] || SSGUIConstants.BODY_FONT_SIZE["default"];
    }
    static get_top_nav_title_font_name() {
        const locale = SSGUIConstants._locale(null);
        return SSGUIConstants.TOP_NAV_TITLE_FONT_NAME[locale] || SSGUIConstants.TOP_NAV_TITLE_FONT_NAME["default"];
    }
    static get_top_nav_title_font_size() {
        const locale = SSGUIConstants._locale(null);
        return SSGUIConstants.TOP_NAV_TITLE_FONT_SIZE[locale] || SSGUIConstants.TOP_NAV_TITLE_FONT_SIZE["default"];
    }
    static get_button_font_name(locale = null) {
        locale = SSGUIConstants._locale(locale);
        return SSGUIConstants.BUTTON_FONT_NAME[locale] || SSGUIConstants.BUTTON_FONT_NAME["default"];
    }
    static get_button_font_size(locale = null) {
        locale = SSGUIConstants._locale(locale);
        return SSGUIConstants.BUTTON_FONT_SIZE[locale] || SSGUIConstants.BUTTON_FONT_SIZE["default"];
    }
}
(function (G) {
    G.EDGE_PADDING = 8;
    G.COMPONENT_PADDING = 8;
    G.LIST_ITEM_PADDING = 4;

    G.BACKGROUND_COLOR = "#000000";
    G.INACTIVE_COLOR = "#414141";
    G.ACCENT_COLOR = "#FF9F0A";   // Active Color
    G.WARNING_COLOR = "#FFD60A";
    G.DIRE_WARNING_COLOR = "#FF5700";
    G.ERROR_COLOR = "#FF1B0A";
    G.SUCCESS_COLOR = "#30D158";
    G.INFO_COLOR = "#409CFF";
    G.TESTNET_COLOR = "#00F100";
    G.REGTEST_COLOR = "#00CAF1";
    G.GREEN_INDICATOR_COLOR = "#00FF00";

    G.ICON_FONT_NAME__FONT_AWESOME = "Font_Awesome_6_Free-Solid-900";
    G.ICON_FONT_NAME__SEEDSIGNER = "seedsigner-icons";
    G.ICON_FONT_SIZE = 22;
    G.ICON_INLINE_FONT_SIZE = 24;
    G.ICON_LARGE_BUTTON_SIZE = 48;
    G.ICON_TOAST_FONT_SIZE = 30;
    G.ICON_PRIMARY_SCREEN_SIZE = 50;

    // Locale keys as in SettingsConstants (ar, zh_Hans_CN, hi, ja, ko, fa, th)
    G.BASE_LOCALE_FONTS = {
        "default": "OpenSans-Regular",
        "ar": "NotoSansAR-Regular",
        "zh_Hans_CN": "NotoSansSC-Regular",
        "hi": "NotoSansDevanagari-Regular",
        "ja": "NotoSansJP-Regular",
        "ko": "NotoSansKR-Regular",
        "fa": "NotoSansAR-Regular",   // Uses the Arabic font
        "th": "NotoSansTH-Regular",
    };

    G.TOP_NAV_TITLE_FONT_NAME = Object.assign({}, G.BASE_LOCALE_FONTS, { "default": "OpenSans-SemiBold" });
    G.TOP_NAV_TITLE_FONT_SIZE = { "default": 20, "zh_Hans_CN": 23, "hi": 22, "ja": 22, "ko": 23 };
    G.TOP_NAV_HEIGHT = 48;
    G.TOP_NAV_BUTTON_SIZE = 32;

    G.BODY_FONT_NAME = Object.assign({}, G.BASE_LOCALE_FONTS);
    G.BODY_FONT_SIZE = { "default": 17, "zh_Hans_CN": 18, "hi": 18, "ja": 18, "ko": 18 };
    G.BODY_FONT_MAX_SIZE = G.TOP_NAV_TITLE_FONT_SIZE["default"];
    G.BODY_FONT_MIN_SIZE = 15;
    G.BODY_FONT_COLOR = "#FCFCFC";
    G.BODY_LINE_SPACING = G.COMPONENT_PADDING;

    G.FIXED_WIDTH_FONT_NAME = "Inconsolata-Regular";
    G.FIXED_WIDTH_EMPHASIS_FONT_NAME = "Inconsolata-SemiBold";

    G.LABEL_FONT_SIZE = G.BODY_FONT_MIN_SIZE;
    G.LABEL_FONT_COLOR = "#777777";

    G.BUTTON_FONT_NAME = Object.assign({}, G.BASE_LOCALE_FONTS, { "default": "OpenSans-SemiBold" });
    G.BUTTON_FONT_SIZE = { "default": 18, "ar": 18, "fa": 18, "hi": 20, "ja": 20, "ko": 20, "zh_Hans_CN": 20 };
    G.BUTTON_FONT_COLOR = "#FCFCFC";
    G.BUTTON_BACKGROUND_COLOR = "#2C2C2C";
    G.BUTTON_HEIGHT = 32;
    G.BUTTON_SELECTED_FONT_COLOR = G.BACKGROUND_COLOR;

    G.NOTIFICATION_COLOR = "#00F100";
})(SSGUIConstants);

const SSFontAwesomeIconConstants = {
    ANGLE_DOWN: "",
    ANGLE_UP: "",
    CAMERA: "",
    CIRCLE: "",
    DICE: "",
    DICE_ONE: "",
    DICE_TWO: "",
    DICE_THREE: "",
    DICE_FOUR: "",
    DICE_FIVE: "",
    DICE_SIX: "",
    KEYBOARD: "",
    MAP: "",
    X: "X",
};

const SSSeedSignerIconConstants = {
    // Menu icons
    SCAN: "",
    SEEDS: "",
    SETTINGS: "",
    TOOLS: "",

    // Utility icons
    BACK: "",
    CHECK: "",
    CHECKBOX: "",
    CHECKBOX_SELECTED: "",
    CHEVRON_DOWN: "",
    CHEVRON_LEFT: "",
    CHEVRON_RIGHT: "",
    CHEVRON_UP: "",
    PLUS: "",
    POWER: "",
    RESTART: "",

    // Messaging icons
    INFO: "",
    SUCCESS: "",
    WARNING: "",
    ERROR: "",

    // Informational icons
    CHANGE: "",
    DERIVATION: "",
    FINGERPRINT: "",
    PASSPHRASE: "",

    // Misc icons
    BITCOIN_ALT: "",
    MICROSD: "",
    QRCODE: "",
    SIGN: "",

    // Input icons
    DELETE: "",
    SPACE: "",

    // Must be updated whenever new icons are added. See usage in `Icon` class below.
    MIN_VALUE: "",
    MAX_VALUE: "",
};

// load_image(image_name) -> SSImage ("RGB"); images are embedded (SS_IMAGE_DATA) and preloaded by ssLoadAssets()
function ssLoadImage(image_name) {
    const el = SS_IMAGES[image_name];
    if (!el) throw new Error(`Image ${image_name} not loaded`);
    return SSImage.from_element(el, "RGB");
}

class SSTextDoesNotFitException extends Error {}

class SSBaseComponent extends SSDataclass {
    static get _fields() { return { image_draw: null, canvas: null }; }

    __post_init__() {
        this.renderer = SSRenderer.get_instance();
        this.canvas_width = this.renderer.canvas_width;
        this.canvas_height = this.renderer.canvas_height;

        // Component threads will be managed in their parent's `Screen.display()`
        this.threads = [];

        if (!this.image_draw) this.set_image_draw(this.renderer.draw);
        if (!this.canvas) this.set_canvas(this.renderer.canvas);
    }

    set_image_draw(image_draw) { this.image_draw = image_draw; }
    set_canvas(canvas) { this.canvas = canvas; }

    render() { throw new Error("render() not implemented in the child class!"); }
}

/*
 * Not to be confused with an html <textarea>! This is a rect-delimited text display box that could be the main
 * body content of a screen or a sub-zone of text within a more complicated page.
 * Auto-calcs line breaks based on input text and font (only breaks on spaces).
 */
class SSTextArea extends SSBaseComponent {
    static get _fields() {
        return {
            text: "My text content",
            width: null,        // TODO: Implement autosize width?
            height: null,       // None = special case: autosize to min height
            screen_x: 0,
            screen_y: 0,
            scroll_y: 0,
            min_text_x: 0,      // Text can not start at x any less than this
            background_color: SSGUIConstants.BACKGROUND_COLOR,
            font_name: null,
            font_size: null,
            font_color: SSGUIConstants.BODY_FONT_COLOR,
            edge_padding: SSGUIConstants.EDGE_PADDING,
            is_text_centered: true,
            supersampling_factor: 2,  // 1 = disabled; 2 = default, double sample
            auto_line_break: true,
            is_horizontal_scrolling_enabled: false,
            horizontal_scroll_speed: 40,  // px per sec
            horizontal_scroll_begin_hold_secs: 2.0,
            horizontal_scroll_end_hold_secs: 1.0,
            height_ignores_below_baseline: false,
        };
    }

    __post_init__() {
        if (this.is_horizontal_scrolling_enabled && this.auto_line_break) {
            throw new Error("TextArea: Cannot have auto_line_break and horizontal scrolling enabled at the same time");
        }
        if (!this.font_name) this.font_name = SSGUIConstants.get_body_font_name();
        if (!this.font_size) this.font_size = SSGUIConstants.get_body_font_size();

        super.__post_init__();

        if (!this.width) this.width = this.canvas_width;

        if (this.screen_x + this.width > this.canvas_width) this.width = this.canvas_width - this.screen_x;

        this.line_spacing = SSGUIConstants.BODY_LINE_SPACING;

        // Calculate the actual font height from the "baseline" anchor ("_s")
        const font = SSFonts.get_font(this.font_name, this.font_size);

        // Note: from the baseline anchor, `top` is a negative number while `bottom` conveys the height of the
        // pixels that rendered below the baseline, if any (e.g. "py" in "python").
        const [left, top, full_text_width, bottom] = font.getbbox(this.text, { anchor: "ls" });
        this.text_height_above_baseline = -1 * top;
        this.text_height_below_baseline = bottom;

        // Initialize the text rendering relative to the baseline
        this.text_y = this.text_height_above_baseline;

        this.visible_width = this.width - Math.max(this.edge_padding, this.min_text_x) - this.edge_padding;

        if (this.is_horizontal_scrolling_enabled || !this.auto_line_break) {
            // Guaranteed to be a single line of text, possibly wider than self.width
            this.text_lines = [{ text: this.text, text_width: full_text_width }];
            this.text_width = full_text_width;

            // Not worth having the text twitch back and forth by such a small amount.
            const min_scrollable_diff = 1;

            if (this.text_width > this.visible_width + min_scrollable_diff) {
                // We'll have to left justify the text and scroll it (if scrolling is enabled, otherwise it'll just
                // run off the right edge).
                this.is_text_centered = false;
            } else {
                // The text fits; horizontal scrolling isn't needed
                this.is_horizontal_scrolling_enabled = false;
            }
        } else {
            // Figure out if and where to make line breaks in the text so that it fits in its bounding rect
            this.text_lines = ssReflowTextForWidth({
                text: this.text,
                width: this.width - 2 * this.edge_padding,
                font_name: this.font_name,
                font_size: this.font_size,
            });

            // Other components, like IconTextLine will need to know how wide the actual rendered text will be
            this.text_width = Math.max(...this.text_lines.map(line => line.text_width));
        }

        // Calculate the actual height
        let total_text_height;
        if (this.text_lines.length === 1) {
            total_text_height = this.text_height_above_baseline;
            if (!this.height_ignores_below_baseline) total_text_height += this.text_height_below_baseline;
        } else {
            // Multiply for the number of lines plus the spacer
            total_text_height = this.text_height_above_baseline * this.text_lines.length + this.line_spacing * (this.text_lines.length - 1);
            if (!this.height_ignores_below_baseline) {
                // Account for the last line possibly rendering below baseline
                total_text_height += this.text_lines[this.text_lines.length - 1].px_below_baseline || 0;
            }
        }

        this.text_offset_y = 0;
        if (this.height === null || this.height === undefined) {
            // Autoscale height to text lines
            this.height = total_text_height;
        } else {
            if (total_text_height > this.height) {
                // Let it render past the bottom edge.
                console.warn(`Text cannot fit in target rect with this font/size\n\ttotal_text_height: ${total_text_height} | self.height: ${this.height}`);
            } else {
                // Vertically center the text's starting point
                this.text_offset_y = ssInt((this.height - total_text_height) / 2);
                this.text_y += this.text_offset_y;  // (relative to text rendering baseline)
            }
        }

        if (this.font_size >= 20 && this.supersampling_factor !== 1) {
            this.supersampling_factor = 1;
        }
        // SIM: PIL supersampling (render 2x, LANCZOS down, SHARPEN) only exists to anti-alias on the 1:1 LCD
        // framebuffer; the canvas already renders text at device-pixel resolution, so it is always disabled here.
        // (resample_padding is cropped off in Python, so the layout is unchanged.)
        this.supersampling_factor = 1;

        if (this.height_ignores_below_baseline) {
            // Make sure we don't crop the pixels below the baseline
            total_text_height += this.text_height_below_baseline;
        }

        let image_width;
        if (this.is_horizontal_scrolling_enabled) {
            // Temp img will be the full width of the text
            image_width = this.text_width;
        } else {
            // Temp img will be the component's width, but must respect right edge padding
            image_width = this.width - this.edge_padding;
        }

        const img = SSImage.new("RGBA", [image_width, total_text_height], this.background_color);
        const draw = SSImageDraw.Draw(img);

        let cur_y = this.text_height_above_baseline;
        // centered: middle baseline; otherwise left baseline
        const anchor = this.is_text_centered ? "ms" : "ls";

        // Default, not-centered text will be relative to its left-justified starting point
        let text_x = Math.max(this.edge_padding, this.min_text_x);

        for (const line of this.text_lines) {
            if (this.is_text_centered) {
                // We'll render with a centered anchor so we just need the midpoint
                text_x = ssInt(this.width / 2);
                if (text_x - ssInt(line.text_width / 2) < this.min_text_x) {
                    // The left edge of the centered text will protrude too far; nudge it right
                    text_x = this.min_text_x + ssInt(line.text_width / 2);
                }
            } else if (this.is_horizontal_scrolling_enabled) {
                // Scrolling temp img isn't relative to any positioning other than its own text
                text_x = 0;
            }

            draw.text([text_x, cur_y], line.text, { fill: this.font_color, font, anchor });
            cur_y += this.text_height_above_baseline + this.line_spacing;
        }

        this.rendered_text_img = img;

        this.horizontal_text_scroll_thread = null;
        if (this.is_horizontal_scrolling_enabled) {
            this.horizontal_text_scroll_thread = new SSTextArea.HorizontalTextScrollThread({
                rendered_text_img: this.rendered_text_img,
                screen_x: this.screen_x + this.min_text_x,
                screen_y: this.screen_y + this.text_y - this.text_height_above_baseline,
                visible_width: this.visible_width,
                horizontal_scroll_speed: this.horizontal_scroll_speed,
                begin_hold_secs: this.horizontal_scroll_begin_hold_secs,
                end_hold_secs: this.horizontal_scroll_end_hold_secs,
            });
        }
    }

    render() {
        // Even if we need to animate for scrolling, all instances should explicitly render their initial state.
        let text_x = this.screen_x;
        let text_img = this.rendered_text_img;
        if (this.is_horizontal_scrolling_enabled) {
            // Scrolling text has no edge considerations so must be placed exactly
            text_x += this.min_text_x;
            // Must also account for the right edge running off our visible width
            text_img = text_img.crop([0, 0, this.visible_width, text_img.height]);
        }
        this.canvas.paste(text_img, [text_x, this.screen_y + this.text_y - this.text_height_above_baseline - this.scroll_y]);
    }

    // Used by ButtonListScreen
    set_scroll_y(scroll_y) {
        this.scroll_y = scroll_y;
        if (this.horizontal_text_scroll_thread) this.horizontal_text_scroll_thread.scroll_y = scroll_y;
    }
}

SSTextArea.HorizontalTextScrollThread = class HorizontalTextScrollThread extends SSBaseThread {
    constructor({ rendered_text_img, screen_x, screen_y, visible_width, horizontal_scroll_speed, begin_hold_secs, end_hold_secs }) {
        super();
        this.rendered_text_img = rendered_text_img;
        this.screen_x = screen_x;
        this.screen_y = screen_y;
        this.visible_width = visible_width;
        this.horizontal_scroll_speed = horizontal_scroll_speed;
        this.begin_hold_secs = begin_hold_secs;
        this.end_hold_secs = end_hold_secs;

        this.scroll_y = 0;
        this.scrolling_active = true;
        this.horizontal_scroll_position = 0;
        this.scroll_increment_sign = 1;  // flip to negative to scroll text to the right

        this.renderer = SSRenderer.get_instance();
    }

    stop_scrolling() { this.scrolling_active = false; }

    start_scrolling() {
        // Reset scroll position to left edge
        this.horizontal_scroll_position = 0;
        this.scroll_increment_sign = 1;
        this.scrolling_active = true;
    }

    async run() {
        const max_scroll = this.rendered_text_img.width - this.visible_width;
        let last_render_time = null;
        let hold_started_at = null;
        let cur_hold_duration = null;

        while (this.keep_running) {
            if (!this.scrolling_active) {
                await ssSleep(0.1);
                continue;
            }

            if (cur_hold_duration !== null) {
                // We're currently holding; see if we've held long enough
                const hold_time_elapsed = ssTime() - hold_started_at;
                if (hold_time_elapsed < cur_hold_duration) {
                    await ssSleep(0.1);
                    continue;
                } else {
                    hold_started_at = null;
                    cur_hold_duration = null;
                }
            } else {
                if (this.horizontal_scroll_position === 0) {
                    // Pause on initial (left-justified) position...
                    hold_started_at = ssTime();
                    cur_hold_duration = this.begin_hold_secs;
                    this.scroll_increment_sign = 1;
                    last_render_time = null;
                    continue;
                } else if (this.horizontal_scroll_position === max_scroll) {
                    // ...and slight pause at end of scroll
                    hold_started_at = ssTime();
                    cur_hold_duration = this.end_hold_secs;
                    last_render_time = null;
                    this.scroll_increment_sign = -1;
                    continue;
                }
            }

            const next_render_time = ssTime();
            let scroll_position_increment;
            if (!last_render_time) {
                // First frame when pulling off either end will move 1 pixel
                scroll_position_increment = 1 * this.scroll_increment_sign;
            } else {
                scroll_position_increment = ssInt(this.horizontal_scroll_speed * (next_render_time - last_render_time) * this.scroll_increment_sign);
            }

            // Only render an update if we're going to move at least 1px
            if (Math.abs(scroll_position_increment) > 0) {
                this.horizontal_scroll_position = Math.max(0, Math.min(this.horizontal_scroll_position + scroll_position_increment, max_scroll));

                await this.renderer.lock.acquire();
                try {
                    if (this.scrolling_active && this.keep_running) {
                        // The pre-rendered text img slides within a cropping window
                        const img = this.rendered_text_img.crop([this.horizontal_scroll_position, 0, this.horizontal_scroll_position + this.visible_width, this.rendered_text_img.height]);
                        this.renderer.canvas.paste(img, [this.screen_x, this.screen_y - this.scroll_y]);
                        this.renderer.show_image();
                    }
                } finally {
                    this.renderer.lock.release();
                }
                last_render_time = next_render_time;
            }

            // Free up the processor for a bit each loop
            await ssSleep(0.02);
        }
    }
};

/*
 * Convenience class: a single line of text, can be centered (e.g. TopNav title), automatically scrolls if it
 * does not fit the specified width.
 */
class SSScrollableTextLine extends SSTextArea {
    __post_init__() {
        this.auto_line_break = false;
        this.is_horizontal_scrolling_enabled = true;
        super.__post_init__();
    }
    get needs_scroll() { return this.horizontal_text_scroll_thread !== null; }
    get scroll_thread() { return this.horizontal_text_scroll_thread; }
}

// gui/components.py Icon (exposed as SSIcon; see the SSIcon function above)
class SSIconComponent extends SSBaseComponent {
    static get _fields() {
        return {
            screen_x: 0,
            screen_y: 0,
            icon_name: SSSeedSignerIconConstants.BITCOIN_ALT,
            icon_size: SSGUIConstants.ICON_FONT_SIZE,
            icon_color: SSGUIConstants.BODY_FONT_COLOR,
        };
    }

    __post_init__() {
        super.__post_init__();
        if (SSSeedSignerIconConstants.MIN_VALUE <= this.icon_name && this.icon_name <= SSSeedSignerIconConstants.MAX_VALUE) {
            this.icon_font = SSFonts.get_font(SSGUIConstants.ICON_FONT_NAME__SEEDSIGNER, this.icon_size, "otf");
        } else {
            this.icon_font = SSFonts.get_font(SSGUIConstants.ICON_FONT_NAME__FONT_AWESOME, this.icon_size);
        }
        // Set width/height based on exact pixels that are rendered
        const [left, top, width, bottom] = this.icon_font.getbbox(this.icon_name, { anchor: "ls" });
        this.width = width;
        this.height = -1 * top;
    }

    render() {
        this.image_draw.text([this.screen_x, this.screen_y + this.height], this.icon_name, {
            font: this.icon_font, fill: this.icon_color, anchor: "ls",
        });
    }
}
SSIcon.prototype = SSIconComponent.prototype;
Object.setPrototypeOf(SSIcon, SSIconComponent);   // static inheritance (e.g. _fields lookups)

// Renders an icon next to a label/value pairing. Icon is optional as is label.
class SSIconTextLine extends SSBaseComponent {
    static get _fields() {
        return {
            height: null,
            icon_name: null,
            icon_size: SSGUIConstants.ICON_FONT_SIZE,
            icon_color: SSGUIConstants.BODY_FONT_COLOR,
            label_text: null,
            value_text: "",
            font_name: null,
            font_size: null,
            is_text_centered: false,
            auto_line_break: false,
            screen_x: 0,
            screen_y: 0,
        };
    }

    __post_init__() {
        if (!this.font_name) this.font_name = SSGUIConstants.get_body_font_name();
        if (!this.font_size) this.font_size = SSGUIConstants.get_body_font_size();
        super.__post_init__();

        if (this.height !== null && this.height !== undefined && this.label_text) {
            throw new Error("Can't currently support vertical auto-centering and label text");
        }

        let text_screen_x;
        if (this.icon_name) {
            this.icon = new SSIcon({
                image_draw: this.image_draw,
                canvas: this.canvas,
                screen_x: this.screen_x,
                screen_y: 0,    // We'll update this later below
                icon_name: this.icon_name,
                icon_size: this.icon_size,
                icon_color: this.icon_color,
            });
            this.icon_horizontal_spacer = ssInt(SSGUIConstants.COMPONENT_PADDING / 2);
            text_screen_x = this.screen_x + this.icon.width + this.icon_horizontal_spacer;
        } else {
            text_screen_x = this.screen_x;
        }

        let label_padding_y;
        if (this.label_text) {
            this.label_textarea = new SSTextArea({
                image_draw: this.image_draw,
                canvas: this.canvas,
                text: this.label_text,
                font_size: SSGUIConstants.get_body_font_size() - 2,
                font_color: SSGUIConstants.LABEL_FONT_COLOR,
                edge_padding: 0,
                is_text_centered: !this.icon_name ? this.is_text_centered : false,
                auto_line_break: false,
                screen_x: text_screen_x,
                screen_y: this.screen_y,
            });
        } else {
            this.label_textarea = null;
        }

        let value_textarea_screen_y = this.screen_y;
        if (this.label_text) {
            label_padding_y = ssInt(SSGUIConstants.COMPONENT_PADDING / 2);
            value_textarea_screen_y += this.label_textarea.height + label_padding_y;
        }

        this.value_textarea = new SSTextArea({
            image_draw: this.image_draw,
            canvas: this.canvas,
            height: this.height,
            text: this.value_text,
            font_name: this.font_name,
            font_size: this.font_size,
            edge_padding: 0,
            is_text_centered: !this.icon_name ? this.is_text_centered : false,
            auto_line_break: this.auto_line_break,
            screen_x: text_screen_x,
            screen_y: value_textarea_screen_y,
        });

        let max_textarea_width;
        if (this.label_text) {
            if (!this.height) this.height = this.label_textarea.height + label_padding_y + this.value_textarea.height;
            max_textarea_width = Math.max(this.label_textarea.text_width, this.value_textarea.text_width);
        } else {
            if (!this.height) this.height = this.value_textarea.height;
            max_textarea_width = this.value_textarea.text_width;
        }

        // Now we can update the icon's y position
        if (this.icon_name) {
            const icon_y = this.screen_y + ssInt((this.height - this.icon.height) / 2);
            this.icon.screen_y = icon_y;
            this.height = Math.max(this.icon.height, this.height);
        }

        if (this.is_text_centered && this.icon_name) {
            const total_width = max_textarea_width + this.icon.width + this.icon_horizontal_spacer;
            this.icon.screen_x = this.screen_x + ssInt((this.canvas_width - this.screen_x - total_width) / 2);
            if (this.label_text) this.label_textarea.screen_x = this.icon.screen_x + this.icon.width + this.icon_horizontal_spacer;
            this.value_textarea.screen_x = this.icon.screen_x + this.icon.width + this.icon_horizontal_spacer;
        }

        this.width = this.canvas_width;
    }

    render() {
        if (this.label_textarea) this.label_textarea.render();
        this.value_textarea.render();
        if (this.icon_name) this.icon.render();
    }
}

/*
 * Display a Bitcoin address in a "{first 7} {middle} {last 7}" formatted view with a possible/likely line break in
 * the middle and using a fixed-width font. max_lines: forces truncation on long addresses to fit.
 */
class SSFormattedAddress extends SSBaseComponent {
    static get _fields() {
        return {
            width: 0,
            screen_x: 0,
            screen_y: 0,
            address: null,
            max_lines: null,
            font_name: SSGUIConstants.FIXED_WIDTH_FONT_NAME,
            font_size: 24,
            font_accent_color: SSGUIConstants.ACCENT_COLOR,
            font_base_color: SSGUIConstants.LABEL_FONT_COLOR,
        };
    }

    __post_init__() {
        super.__post_init__();
        if (this.width === 0) this.width = this.renderer.canvas_width;

        this.font = SSFonts.get_font(this.font_name, this.font_size);
        this.accent_font = SSFonts.get_font(SSGUIConstants.FIXED_WIDTH_EMPHASIS_FONT_NAME, this.font_size);

        // Fixed width font means we only have to measure one max-height character
        const [left, top, right, bottom] = this.font.getbbox("Q");
        const char_width = right - left, char_height = bottom - top;

        const n = 7;
        const a = this.address;
        const display_str = `${a.slice(0, n)} ${a.slice(n, a.length - n)} ${a.slice(a.length - n)}`;
        const split = (s) => s.split(/\s+/).filter(x => x.length);
        this.text_params = [];
        let cur_y = 0;

        if (this.max_lines === 1) {
            const addr_lines_x = ssInt((this.width - char_width * (2 * n + 3)) / 2);
            // Can only show first/last n truncated
            this.text_params.push([[addr_lines_x, cur_y], split(display_str)[0], this.font_accent_color, this.accent_font]);
            this.text_params.push([[addr_lines_x + char_width * n, cur_y], "...", this.font_base_color, this.font]);
            this.text_params.push([[addr_lines_x + char_width * (n + 3), cur_y], split(display_str)[2], this.font_accent_color, this.accent_font]);
            cur_y += char_height;
        } else {
            let max_chars_per_line = Math.floor(this.width / char_width);
            const num_lines = Math.ceil(display_str.length / max_chars_per_line);

            // Recalc chars per line to even out all x lines to the same width
            max_chars_per_line = Math.ceil(display_str.length / num_lines);

            let remaining_display_str = display_str;
            const addr_lines_x = this.screen_x + ssInt((this.width - char_width * max_chars_per_line) / 2);
            for (let i = 0; i < num_lines; i++) {
                const cur_str = remaining_display_str.slice(0, max_chars_per_line);
                if (i === 0) {
                    // Split cur_str into two sections to highlight first_n
                    this.text_params.push([[addr_lines_x, cur_y], split(cur_str)[0], this.font_accent_color, this.accent_font]);
                    this.text_params.push([[addr_lines_x + char_width * (n + 1), cur_y], split(cur_str)[1], this.font_base_color, this.font]);
                } else if (i === num_lines - 1) {
                    // Split cur_str into two sections to highlight last_n
                    this.text_params.push([[addr_lines_x, cur_y], split(cur_str)[0], this.font_base_color, this.font]);
                    this.text_params.push([[addr_lines_x + char_width * (cur_str.length - n), cur_y], split(cur_str)[1], this.font_accent_color, this.accent_font]);
                } else if (this.max_lines && i === this.max_lines - 1) {
                    // We can't fit the whole address. Have to truncate here and highlight the last_n.
                    this.text_params.push([[addr_lines_x, cur_y], cur_str.slice(0, cur_str.length - n - 3) + "...", this.font_base_color, this.font]);
                    this.text_params.push([[addr_lines_x + char_width * (cur_str.length - n), cur_y], a.slice(a.length - n), this.font_accent_color, this.accent_font]);
                    cur_y += char_height;
                    break;
                } else {
                    // This is a middle line with no highlighted section
                    this.text_params.push([[addr_lines_x, cur_y], cur_str, this.font_base_color, this.font]);
                }
                remaining_display_str = remaining_display_str.slice(max_chars_per_line);
                cur_y += char_height + SSGUIConstants.BODY_LINE_SPACING;
            }
        }
        this.height = cur_y;
    }

    render() {
        for (const p of this.text_params) {
            this.image_draw.text([p[0][0], p[0][1] + this.screen_y], p[1], { fill: p[2], font: p[3] });
        }
    }
}

// Python f"{x:,}" for integers / decimal strings
function _ssCommas(numStr) {
    const neg = numStr.startsWith("-");
    if (neg) numStr = numStr.slice(1);
    const [i, d] = numStr.split(".");
    const withCommas = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-" : "") + withCommas + (d !== undefined ? "." + d : "");
}

/*
 * Display btc value based on the SETTING__BTC_DENOMINATION Setting:
 * btc / sats / threshold (btc at or above 0.01 btc; otherwise sats) / btcsatshybrd
 */
class SSBtcAmount extends SSBaseComponent {
    static get _fields() {
        return { total_sats: null, icon_size: 34, font_size: 24, screen_x: 0, screen_y: null };
    }

    __post_init__() {
        super.__post_init__();
        this.paste_image = null;
        this.paste_coords = null;
        const denomination = ssSettingGet("denomination", "thr");
        const network = ssSettingGet("network", "M");
        const total_sats = Number(this.total_sats);

        let btc_unit = "tBtc";   // TRANSLATOR_NOTE: Testnet bitcoin
        let sats_unit = "tSats"; // TRANSLATOR_NOTE: Testnet sats
        let btc_color;
        if (network === "M") {
            btc_unit = "btc";
            sats_unit = "sats";
            btc_color = SSGUIConstants.ACCENT_COLOR;
        } else if (network === "T") {
            btc_color = SSGUIConstants.TESTNET_COLOR;
        } else if (network === "R") {
            btc_color = SSGUIConstants.REGTEST_COLOR;
        }

        const body_font_name = SSGUIConstants.get_body_font_name();
        const digit_font = SSFonts.get_font(body_font_name, this.font_size);
        const smaller_digit_font = SSFonts.get_font(body_font_name, this.font_size - 2);
        const unit_font_size = SSGUIConstants.get_button_font_size() + 2;

        // Render to a temp surface
        this.paste_image = SSImage.new("RGB", [this.canvas_width, this.icon_size], SSGUIConstants.BACKGROUND_COLOR);
        const draw = SSImageDraw.Draw(this.paste_image);

        // Render the circular Bitcoin icon
        let btc_icon = new SSIcon({
            image_draw: draw, canvas: this.paste_image, icon_name: SSSeedSignerIconConstants.BITCOIN_ALT,
            icon_color: btc_color, icon_size: this.icon_size, screen_x: 0, screen_y: 0,
        });
        btc_icon.render();
        let cur_x = btc_icon.width + ssInt(SSGUIConstants.COMPONENT_PADDING / 4);

        const sats_str = String(Math.trunc(total_sats));
        // Decimal(total_sats / 1e8).quantize(Decimal("0.12345678")) as an exact string
        const btc8 = (() => {
            const s = sats_str.padStart(9, "0");
            return s.slice(0, s.length - 8) + "." + s.slice(s.length - 8);
        })();
        let unit_text, text_y;

        if (denomination === "btc" ||
            (denomination === "thr" && total_sats >= 1e6) ||
            (denomination === "hyb" && total_sats >= 1e6 && sats_str.slice(-6) === "000000") ||
            total_sats > 1e10) {
            let decimal_btc = btc8;
            if (sats_str.slice(-8) === "00000000") {
                // Only whole btc units being displayed; truncate to a single decimal place
                decimal_btc = btc8.slice(0, btc8.length - 7);
            } else if (sats_str.slice(-6) === "000000") {
                // Bottom six digits are all zeroes; truncate to two decimal places
                decimal_btc = btc8.slice(0, btc8.length - 6);
            }
            let btc_text = _ssCommas(decimal_btc);
            if (btc_text.length >= 12) {
                // This is a large btc value that won't fit; omit sats
                const parts = btc_text.split(".");
                btc_text = parts[0] + "." + parts[parts.length - 1].slice(0, 2) + "...";
            }
            const font = digit_font;
            const [left, top, text_width, bottom] = font.getbbox(btc_text, { anchor: "ls" });
            const text_height = -1 * top + bottom;
            text_y = this.paste_image.height - ssInt((this.paste_image.height - text_height) / 2);
            draw.text([cur_x, text_y], btc_text, { font, fill: SSGUIConstants.BODY_FONT_COLOR, anchor: "ls" });
            cur_x += text_width;
            unit_text = btc_unit;
        } else if (denomination === "sats" ||
            (denomination === "thr" && total_sats < 1e6) ||
            (denomination === "hyb" && total_sats < 1e6)) {
            // Draw the sats side
            const sats_text = _ssCommas(sats_str);
            let font = digit_font;
            if (total_sats > 1e9) font = smaller_digit_font;
            const [left, top, text_width, bottom] = font.getbbox(sats_text, { anchor: "ls" });
            const text_height = -1 * top + bottom;
            text_y = this.paste_image.height - ssInt((this.paste_image.height - text_height) / 2);
            draw.text([cur_x, text_y], sats_text, { font, fill: SSGUIConstants.BODY_FONT_COLOR, anchor: "ls" });
            cur_x += text_width;
            unit_text = sats_unit;
        } else if (denomination === "hyb") {
            // Decimal(str(decimal_btc)[:-6])
            const btc_text = _ssCommas(btc8.slice(0, btc8.length - 6));
            let sats_text = _ssCommas(sats_str).slice(-7);
            while (sats_text[0] === "0") sats_text = sats_text.slice(1);

            btc_icon = new SSIcon({
                image_draw: draw, canvas: this.paste_image, icon_name: SSSeedSignerIconConstants.BITCOIN_ALT,
                icon_color: btc_color, icon_size: this.icon_size, screen_x: 0, screen_y: 0,
            });
            btc_icon.render();
            cur_x = btc_icon.width + ssInt(SSGUIConstants.COMPONENT_PADDING / 4);

            let [left, top, text_width, bottom] = smaller_digit_font.getbbox(btc_text, { anchor: "ls" });
            const text_height = -1 * top + bottom;
            text_y = this.paste_image.height - ssInt((this.paste_image.height - text_height) / 2);
            draw.text([cur_x, text_y], btc_text, { font: smaller_digit_font, fill: SSGUIConstants.BODY_FONT_COLOR, anchor: "ls" });
            cur_x += text_width - ssInt(SSGUIConstants.COMPONENT_PADDING / 2);

            // Draw the pipe separator
            const pipe_font = SSFonts.get_font(body_font_name, this.icon_size - 4);
            [left, top, text_width, bottom] = pipe_font.getbbox("|", { anchor: "ls" });
            draw.text([cur_x, text_y], "|", { font: pipe_font, fill: btc_color, anchor: "ls" });
            cur_x += text_width - ssInt(SSGUIConstants.COMPONENT_PADDING / 2);

            // Draw the sats side
            [left, top, text_width, bottom] = smaller_digit_font.getbbox(sats_text, { anchor: "ls" });
            draw.text([cur_x, text_y], sats_text, { font: smaller_digit_font, fill: SSGUIConstants.BODY_FONT_COLOR, anchor: "ls" });
            cur_x += text_width;
            unit_text = sats_unit;
        }

        // Draw the unit
        const unit_font = SSFonts.get_font(body_font_name, unit_font_size);
        const [ul, ut, unit_text_width, ub] = unit_font.getbbox(unit_text, { anchor: "ls" });
        const unit_font_height = -1 * ut;

        const unit_textarea = new SSTextArea({
            image_draw: draw,
            canvas: this.paste_image,
            text: ` ${unit_text}`,
            font_name: body_font_name,
            font_size: unit_font_size,
            font_color: SSGUIConstants.BODY_FONT_COLOR,
            supersampling_factor: 2,
            is_text_centered: false,
            edge_padding: 0,
            screen_x: cur_x,
            screen_y: text_y - unit_font_height,
        });
        unit_textarea.render();

        const final_x = cur_x + SSGUIConstants.COMPONENT_PADDING + unit_text_width;

        this.paste_image = this.paste_image.crop([0, 0, final_x, this.paste_image.height]);
        this.paste_coords = [ssInt((this.canvas_width - final_x) / 2), this.screen_y];

        this.width = this.canvas_width;
        this.height = this.paste_image.height;
    }

    render() { this.canvas.paste(this.paste_image, this.paste_coords); }
}

/*
 * Button: reusable in-memory text images (is_scrollable_text = true; default) or real-time text (false).
 * Selected labels that do not fit scroll horizontally (ScrollableTextLine).
 */
class SSButton extends SSBaseComponent {
    static get _fields() {
        return {
            text: "Button Label",
            active_text: null,   // Optional alt text to replace the button label when the button is selected
            screen_x: 0,
            screen_y: 0,
            scroll_y: 0,
            width: null,
            height: null,
            icon_name: null,     // Optional icon to accompany the text
            icon_size: SSGUIConstants.ICON_INLINE_FONT_SIZE,
            icon_color: SSGUIConstants.BUTTON_FONT_COLOR,
            selected_icon_color: "black",
            icon_y_offset: 0,
            is_icon_inline: true,   // True = render next to text; False = render centered above text
            right_icon_name: null,  // Optional icon rendered right-justified
            right_icon_size: SSGUIConstants.ICON_INLINE_FONT_SIZE,
            right_icon_color: SSGUIConstants.BUTTON_FONT_COLOR,
            text_y_offset: 0,
            background_color: SSGUIConstants.BUTTON_BACKGROUND_COLOR,
            selected_color: SSGUIConstants.ACCENT_COLOR,
            font_name: null,
            font_size: null,
            font_color: SSGUIConstants.BUTTON_FONT_COLOR,
            selected_font_color: SSGUIConstants.BUTTON_SELECTED_FONT_COLOR,
            outline_color: null,
            selected_outline_color: null,
            is_text_centered: true,
            is_selected: false,
            is_scrollable_text: true,
        };
    }

    __post_init__() {
        if (!this.font_name) this.font_name = SSGUIConstants.get_button_font_name();
        if (!this.font_size) this.font_size = SSGUIConstants.get_button_font_size();

        super.__post_init__();

        if (!this.width) this.width = this.canvas_width - 2 * SSGUIConstants.EDGE_PADDING;
        if (!this.height) this.height = SSGUIConstants.BUTTON_HEIGHT;
        if (!this.icon_color) this.icon_color = SSGUIConstants.BUTTON_FONT_COLOR;

        this.active_button_label = null;

        if (this.text !== null && this.text !== undefined) {
            this.font = SSFonts.get_font(this.font_name, this.font_size);

            // Calc true pixel height (any anchor from "baseline" will work)
            const [left, top, text_width, bottom] = this.font.getbbox(this.text, { anchor: "ls" });
            this.text_width = text_width;

            // Intentionally ignore any chars below the baseline for consistent vertical positioning
            this.text_height = -1 * top;

            // Total space available just for the text (will contract later if there are icons)
            this.visible_text_width = this.width - 2 * SSGUIConstants.COMPONENT_PADDING;

            if (this.text_width > this.visible_text_width && !this.is_scrollable_text) {
                console.warn(`Button label "${this.text}" will not fit but is_scrollable_text is False`);
            }

            if (this.is_text_centered && this.text_width < this.visible_text_width) {
                // Calculate the centered text's starting point, but relative to the "ls" anchor point.
                this.text_x = ssInt((this.width - this.text_width) / 2);
                this.text_anchor = "ls";  // left, baseline
            } else {
                // Text is left-justified or has to be because it will be scrolled
                this.is_text_centered = false;
                this.text_x = SSGUIConstants.COMPONENT_PADDING;
                this.text_anchor = "ls";
            }

            if (this.text_y_offset) {
                this.text_y = this.text_y_offset + this.text_height;
            } else {
                this.text_y = this.height - ssInt((this.height - this.text_height) / 2);
            }
        }

        // Preload the icon and its "_selected" variant
        const icon_padding = SSGUIConstants.COMPONENT_PADDING;
        if (this.icon_name) {
            this.icon = new SSIcon({ icon_name: this.icon_name, icon_size: this.icon_size, icon_color: this.icon_color });
            this.icon_selected = new SSIcon({ icon_name: this.icon_name, icon_size: this.icon_size, icon_color: this.selected_icon_color });

            if (this.icon_y_offset) {
                this.icon_y = this.icon_y_offset;
            } else {
                this.icon_y = Math.ceil((this.height - this.icon.height) / 2);
            }

            if (this.is_icon_inline) {
                this.visible_text_width -= this.icon.width + icon_padding;
                if (this.text_width > this.visible_text_width) {
                    this.is_text_centered = false;
                    this.text_x = SSGUIConstants.COMPONENT_PADDING;
                }

                if (this.is_text_centered) {
                    if (this.text) {
                        // Shift the text's "ls"-based anchor to the right to make room
                        this.text_x += ssInt((this.icon.width + icon_padding) / 2);
                        // Position the icon's left-based anchor on the left
                        this.icon_x = this.text_x - (this.icon.width + icon_padding);
                    } else {
                        this.icon_x = Math.ceil((this.width - this.icon.width) / 2);
                    }
                } else {
                    if (this.text) this.text_x += this.icon.width + icon_padding;
                    this.icon_x = SSGUIConstants.COMPONENT_PADDING;
                }
            } else {
                this.icon_x = ssInt((this.width - this.icon.width) / 2);
                if (this.text) this.text_y = this.icon_y + this.icon.height + SSGUIConstants.COMPONENT_PADDING;
            }
        }

        if (this.right_icon_name) {
            this.right_icon = new SSIcon({ icon_name: this.right_icon_name, icon_size: this.right_icon_size, icon_color: this.right_icon_color });
            this.right_icon_selected = new SSIcon({ icon_name: this.right_icon_name, icon_size: this.right_icon_size, icon_color: this.selected_icon_color });

            this.visible_text_width -= this.right_icon.width + icon_padding;
            if (this.text_width > this.visible_text_width) this.is_text_centered = false;

            this.right_icon_x = this.width - this.right_icon.width - SSGUIConstants.COMPONENT_PADDING;
            this.right_icon_y = Math.ceil((this.height - this.right_icon.height) / 2);
        }

        if (this.text && this.is_scrollable_text) {
            const button_kwargs = {
                text: this.active_text ? this.active_text : this.text,
                font_name: this.font_name,
                font_size: this.font_size,
                supersampling_factor: 1,
                font_color: this.selected_font_color,
                background_color: this.selected_color,
                screen_x: this.screen_x,
                screen_y: this.screen_y + this.text_y_offset,
                width: this.width,
                height: this.icon_name && !this.is_icon_inline ? this.text_height : this.height,
                min_text_x: this.icon_name && this.is_icon_inline ? this.text_x : SSGUIConstants.COMPONENT_PADDING,
                is_text_centered: this.is_text_centered,
                height_ignores_below_baseline: true,
                horizontal_scroll_speed: 30,  // px per sec
                horizontal_scroll_begin_hold_secs: 0.5,
                horizontal_scroll_end_hold_secs: 0.5,
            };

            // Just-in-time creation of BOTH the active and inactive labels
            this.active_button_label = null;
            this.active_button_label_kwargs = Object.assign({}, button_kwargs);

            button_kwargs.text = this.text;
            button_kwargs.font_color = this.font_color;
            button_kwargs.background_color = this.background_color;
            button_kwargs.auto_line_break = false;
            delete button_kwargs.horizontal_scroll_begin_hold_secs;
            delete button_kwargs.horizontal_scroll_end_hold_secs;

            this.inactive_button_label = null;
            this.inactive_button_label_kwargs = Object.assign({}, button_kwargs);
        }
    }

    render() {
        let background_color, font_color, outline_color;
        if (this.is_selected) {
            background_color = this.selected_color;
            font_color = this.selected_font_color;
            outline_color = this.selected_outline_color;
        } else {
            background_color = this.background_color;
            font_color = this.font_color;
            outline_color = this.outline_color;
        }

        this.image_draw.rounded_rectangle(
            [this.screen_x, this.screen_y - this.scroll_y, this.screen_x + this.width, this.screen_y + this.height - this.scroll_y],
            { fill: background_color, radius: 8, outline: outline_color, width: 2 }
        );

        if (this.text !== null && this.text !== undefined) {
            if (!this.is_scrollable_text) {
                // Just directly render the text for the current active/inactive state
                this.image_draw.text(
                    [this.screen_x + this.text_x, this.screen_y + this.text_y - this.scroll_y],
                    this.text, { fill: font_color, font: this.font, anchor: this.text_anchor }
                );
            } else {
                // Use just-in-time instantiation of pre-rendered ScrollableTextLine and TextArea
                if (this.is_selected) {
                    if (!this.active_button_label) {
                        this.active_button_label = new SSScrollableTextLine(this.active_button_label_kwargs);
                        if (this.active_button_label.needs_scroll) {
                            this.threads.push(this.active_button_label.scroll_thread);
                            this.active_button_label.scroll_thread.start();
                        }
                    }
                    this.active_button_label.set_scroll_y(this.scroll_y);
                    this.active_button_label.render();

                    if (this.active_button_label.needs_scroll) {
                        // Activate the scrollable text line
                        this.active_button_label.scroll_thread.start_scrolling();
                    }
                } else {
                    if (this.active_button_label && this.active_button_label.needs_scroll) {
                        this.active_button_label.scroll_thread.stop_scrolling();
                    }
                    if (!this.inactive_button_label) {
                        this.inactive_button_label = new SSTextArea(this.inactive_button_label_kwargs);
                    }
                    this.inactive_button_label.set_scroll_y(this.scroll_y);
                    this.inactive_button_label.render();
                }
            }
        }

        if (this.icon_name) {
            const icon = this.is_selected ? this.icon_selected : this.icon;
            icon.screen_y = this.screen_y + this.icon_y - this.scroll_y;
            icon.screen_x = this.screen_x + this.icon_x;
            icon.render();
        }

        if (this.right_icon_name) {
            const icon = this.is_selected ? this.right_icon_selected : this.right_icon;
            icon.screen_y = this.screen_y + this.right_icon_y - this.scroll_y;
            icon.screen_x = this.screen_x + this.right_icon_x;
            icon.render();
        }
    }
}

class SSCheckedSelectionButton extends SSButton {
    static get _fields() { return { is_checked: false }; }
    __post_init__() {
        this.is_text_centered = false;
        this.icon_name = SSSeedSignerIconConstants.CHECK;
        this.icon_color = SSGUIConstants.SUCCESS_COLOR;
        super.__post_init__();
        if (!this.is_checked) {
            // Remove the checkmark icon but leave the text_x spacing as-is
            this.icon_name = null;
            this.icon = null;
            this.icon_selected = null;
        }
    }
}

class SSCheckboxButton extends SSButton {
    static get _fields() { return { is_checked: false }; }
    __post_init__() {
        this.is_text_centered = false;
        if (this.is_checked) {
            this.icon_name = SSSeedSignerIconConstants.CHECKBOX_SELECTED;
            this.icon_color = SSGUIConstants.SUCCESS_COLOR;
        } else {
            this.icon_name = SSSeedSignerIconConstants.CHECKBOX;
            this.icon_color = SSGUIConstants.BODY_FONT_COLOR;
        }
        super.__post_init__();
    }
}

// A button that is just an icon (e.g. the BACK arrow)
class SSIconButton extends SSButton {
    static get _fields() {
        return {
            icon_size: SSGUIConstants.ICON_INLINE_FONT_SIZE,
            text: null,
            is_icon_inline: false,
            is_text_centered: true,
            is_scrollable_text: false,
        };
    }
}

// A button that is primarily a big icon (e.g. the Home screen buttons) w/text below the icon.
class SSLargeIconButton extends SSIconButton {
    static get _fields() {
        return {
            icon_size: SSGUIConstants.ICON_LARGE_BUTTON_SIZE,
            icon_y_offset: SSGUIConstants.COMPONENT_PADDING,
            is_scrollable_text: true,
        };
    }
}

class SSTopNav extends SSBaseComponent {
    static get _fields() {
        return {
            text: "Screen Title",
            width: null,
            height: SSGUIConstants.TOP_NAV_HEIGHT,
            background_color: SSGUIConstants.BACKGROUND_COLOR,
            icon_name: null,
            icon_color: SSGUIConstants.BODY_FONT_COLOR,
            font_name: null,
            font_size: null,
            font_color: SSGUIConstants.BODY_FONT_COLOR,
            show_back_button: true,
            show_power_button: false,
            is_selected: false,
        };
    }

    __post_init__() {
        if (!this.font_name) this.font_name = SSGUIConstants.get_top_nav_title_font_name();
        if (!this.font_size) this.font_size = SSGUIConstants.get_top_nav_title_font_size();

        super.__post_init__();
        if (!this.width) this.width = this.canvas_width;

        if (this.show_back_button) {
            this.left_button = new SSIconButton({
                icon_name: SSSeedSignerIconConstants.BACK,
                icon_size: SSGUIConstants.ICON_INLINE_FONT_SIZE,
                screen_x: SSGUIConstants.EDGE_PADDING,
                screen_y: SSGUIConstants.EDGE_PADDING - 1,  // Shifting it down 1px looks better.
                width: SSGUIConstants.TOP_NAV_BUTTON_SIZE,
                height: SSGUIConstants.TOP_NAV_BUTTON_SIZE,
            });
        }

        if (this.show_power_button) {
            this.right_button = new SSIconButton({
                icon_name: SSSeedSignerIconConstants.POWER,
                icon_size: SSGUIConstants.ICON_INLINE_FONT_SIZE,
                screen_x: this.width - SSGUIConstants.TOP_NAV_BUTTON_SIZE - SSGUIConstants.EDGE_PADDING,
                screen_y: SSGUIConstants.EDGE_PADDING,
                width: SSGUIConstants.TOP_NAV_BUTTON_SIZE,
                height: SSGUIConstants.TOP_NAV_BUTTON_SIZE,
            });
        }

        let min_text_x = SSGUIConstants.EDGE_PADDING;
        if (this.show_back_button) {
            // Don't let the title intrude on the BACK button
            min_text_x = this.left_button.screen_x + this.left_button.width + SSGUIConstants.COMPONENT_PADDING;
        }

        if (this.icon_name) {
            this.title = new SSIconTextLine({
                screen_x: 0,
                screen_y: 0,
                height: this.height,
                icon_name: this.icon_name,
                icon_color: this.icon_color,
                icon_size: SSGUIConstants.ICON_FONT_SIZE + 4,
                value_text: this.text,
                is_text_centered: true,
                font_name: this.font_name,
                font_size: this.font_size,
            });
        } else {
            this.title = new SSScrollableTextLine({
                screen_x: 0,
                screen_y: 0,
                min_text_x: min_text_x,
                width: this.width,
                height: this.height,
                text: this.text,
                is_text_centered: true,
                font_name: this.font_name,
                font_size: this.font_size,
                height_ignores_below_baseline: true,
            });
            if (this.title.needs_scroll) {
                // Add the scroll thread to TopNav's self.threads so it automatically runs for the life of the Component.
                this.threads.push(this.title.scroll_thread);
            }
        }
    }

    get selected_button() {
        if (!this.is_selected) return null;
        if (this.show_back_button) return SS_RET_CODE__BACK_BUTTON;
        if (this.show_power_button) return SS_RET_CODE__POWER_BUTTON;
        return null;
    }

    render() {
        this.title.render();
        this.render_buttons();
    }

    render_buttons() {
        if (this.show_back_button) {
            this.left_button.is_selected = this.is_selected;
            this.left_button.render();
        }
        if (this.show_power_button) {
            this.right_button.is_selected = this.is_selected;
            this.right_button.render();
        }
    }
}

function ssLinearInterp(a, b, t) {
    return [ssInt((1.0 - t) * a[0] + t * b[0]), ssInt((1.0 - t) * a[1] + t * b[1])];
}

// Points of a quadratic bezier curve between p1 and p3 with p2 as the control point
function ssCalcBezierCurve(p1, p2, p3, segments) {
    const t_step = 1.0 / segments;
    const points = [p1];
    for (let i = 1; i <= segments; i++) {
        const t = t_step * i;
        if (i === segments) { points.push(p3); break; }
        const l1_t = ssLinearInterp(p1, p2, t);
        const l2_t = ssLinearInterp(p2, p3, t);
        points.push(ssLinearInterp(l1_t, l2_t, t));
    }
    return points;
}

/*
 * reflow_text_for_width(text, width, font_name, font_size) -> [{text, text_width, px_below_baseline}]
 * Accepts ({text, width, font_name, font_size}) or positional args.
 */
function ssReflowTextForWidth(text, width, font_name, font_size) {
    if (text && typeof text === "object") ({ text, width, font_name, font_size } = text);
    if (!font_name) font_name = SSGUIConstants.get_body_font_name();
    if (!font_size) font_size = SSGUIConstants.get_body_font_size();
    const font = SSFonts.get_font(font_name, font_size);
    // Measure from left baseline ("ls")
    const [left0, top0, full_text_width, px_below_baseline0] = font.getbbox(text, { anchor: "ls" });

    // Assume we can break Asian text on any character
    const treat_chars_as_words = ["zh_Hans_CN", "zh_Hant_TW", "ja", "ko"].includes(ssSettingGet("locale", "en"));

    const text_lines = [];
    const _add_text_line = (t, text_width, px_below_baseline) => text_lines.push({ text: t, text_width, px_below_baseline });
    const pysplit = (s) => s.split(/\s+/).filter(x => x.length);

    if (text.indexOf("\n") < 0 && full_text_width < width) {
        // The whole text fits on one line
        _add_text_line(text, full_text_width, px_below_baseline0);
    } else {
        let words, word_spacer;
        const _binary_len_search = (min_index, max_index) => {
            // Try the middle of the range
            let index = Math.ceil((max_index + min_index) / 2);
            if (index === 0) index = 1;   // only one word in the last line

            // Measure rendered width from "left" anchor
            const [left, top, right, px_below_baseline] = font.getbbox(words.slice(0, index).join(word_spacer), { anchor: "ls" });
            const line_width = right - left;

            if (line_width >= width) {
                // Candidate line is still too long. Restrict search range down.
                if (min_index + 1 === index) {
                    if (index === 1) {
                        // One long, unbreakable word. Accept it and let it render off the edges.
                        return [index, line_width, px_below_baseline];
                    } else {
                        index -= 1;
                    }
                }
                return _binary_len_search(min_index, index);
            } else if (index === max_index) {
                // We have converged
                return [index, line_width, px_below_baseline];
            } else {
                // Candidate line is possibly shorter than necessary.
                return _binary_len_search(index, max_index);
            }
        };

        if (pysplit(text).length === 1 && !treat_chars_as_words) {
            console.warn("Text cannot fit in target rect with this font+size");
        }

        for (const line of text.split("\n")) {
            if (treat_chars_as_words) {
                words = Array.from(line);
                word_spacer = "";
            } else {
                words = pysplit(line);
                word_spacer = " ";
            }
            if (!words.length) {
                // It's a blank line
                _add_text_line("", 0, 0);
            } else {
                while (words.length) {
                    const [index, tw, px_below_baseline] = _binary_len_search(0, words.length);
                    _add_text_line(words.slice(0, index).join(word_spacer), tw, px_below_baseline);
                    words = words.slice(index);
                }
            }
        }
    }
    return text_lines;
}

/*
 * reflow_text_into_pages(text, width, height, font_name, font_size, line_spacer) -> [page strings]
 * Accepts ({text, width, height, font_name, font_size, line_spacer}) or positional args.
 */
function ssReflowTextIntoPages(text, width, height, font_name, font_size, line_spacer) {
    if (text && typeof text === "object") ({ text, width, height, font_name, font_size, line_spacer } = text);
    if (!font_name) font_name = SSGUIConstants.get_body_font_name();
    if (!font_size) font_size = SSGUIConstants.get_body_font_size();
    if (line_spacer === undefined || line_spacer === null) line_spacer = SSGUIConstants.BODY_LINE_SPACING;
    const reflowed_lines_dicts = ssReflowTextForWidth({ text, width, font_name, font_size });

    const lines = reflowed_lines_dicts.map(d => d.text);

    const font = SSFonts.get_font(font_name, font_size);
    // Measure the font's height above baseline and how far below it certain characters can render.
    const [left, top, right, bottom] = font.getbbox("Agjpqy", { anchor: "ls" });
    const font_height_above_baseline = -1 * top;
    const font_height_below_baseline = bottom;

    let lines_per_page = 0;
    for (let i = 1; i < height; i++) {
        if (height > font_height_above_baseline * i + line_spacer * (i - 1) + font_height_below_baseline) {
            lines_per_page = i;
        } else {
            break;
        }
    }

    const pages = [];
    for (let i = 0; i < lines.length; i += lines_per_page) {
        pages.push(lines.slice(i, i + lines_per_page).join("\n"));
    }
    return pages;
}

// Resizes the image to fill the target size, cropping the image if necessary.
function ssResizeImageToFill(img, target_size_x, target_size_y, sampling_method = SSImage.Resampling.NEAREST) {
    if (img.width === target_size_x && img.height === target_size_y) return img;

    const render_aspect_ratio = target_size_x / target_size_y;
    const source_frame_aspect_ratio = img.width / img.height;
    let box;
    if (render_aspect_ratio > source_frame_aspect_ratio) {
        // Render surface is wider than the source frame; preserve the width but crop the height
        const cropped_height = img.width * target_size_y / target_size_x;
        box = [0, ssInt((img.height - cropped_height) / 2), img.width, img.height - ssInt((img.height - cropped_height) / 2)];
    } else if (render_aspect_ratio < source_frame_aspect_ratio) {
        // Render surface is taller than the source frame; preserve the height but crop the width
        box = [
            ssInt((img.width - img.height * target_size_x / target_size_y) / 2),
            0,
            ssInt(img.width - (img.width - img.height * target_size_x / target_size_y) / 2),
            img.height,
        ];
    } else {
        box = null;
    }
    return img.resize([target_size_x, target_size_y], sampling_method, box);
}

/* =====================================================================================================
 * gui/keyboard.py
 * ===================================================================================================== */

/*
 * Note that it is up to the calling Screen to manage the Renderer.lock. The Keyboard and its child Keys should NOT
 * attempt to manage the lock.
 * Constructor: new SSKeyboard({draw, charset, font_name, font_size, selected_char, rows, cols, rect, additional_keys,
 *              auto_wrap, render_now, highlight_color})
 */
class SSKeyboard {
    constructor(opts = {}) {
        const K = SSKeyboard;
        const {
            draw,
            charset = "1234567890abcdefghijklmnopqrstuvwxyz",
            font_name = SSGUIConstants.FIXED_WIDTH_EMPHASIS_FONT_NAME,
            font_size = 24,
            selected_char = "a",
            rows = 4,
            cols = 10,
            rect = [0, 40, 240, 240],
            additional_keys = [K.KEY_BACKSPACE],
            auto_wrap = [K.WRAP_TOP, K.WRAP_BOTTOM, K.WRAP_LEFT, K.WRAP_RIGHT],
            render_now = true,
            highlight_color = SSGUIConstants.ACCENT_COLOR,
        } = opts;

        this.draw = draw;
        this.charset = charset;
        this.rows = rows;
        this.cols = cols;
        this.rect = rect;
        this.font = SSFonts.get_font(font_name, font_size);

        this.auto_wrap = auto_wrap;
        this.background_color = SSGUIConstants.BUTTON_BACKGROUND_COLOR;
        this.deactivated_background_color = SSGUIConstants.BACKGROUND_COLOR;
        this.highlight_color = highlight_color;

        const chars = Array.isArray(charset) ? charset.slice() : Array.from(charset);

        // Does the specified layout work?
        let additional_key_spaces = 0;
        for (const additional_key of additional_keys) additional_key_spaces += additional_key.size;
        if (rows * cols < chars.length + additional_key_spaces) {
            throw new Error(`charset will not fit in a ${rows}x${cols} layout | additional_keys: ${JSON.stringify(additional_keys)}`);
        }
        if (!selected_char) throw new Error("`selected_char` cannot be None");

        // Set up the rendering and state params
        this.active_keys = chars.slice();
        this.icon_key_font = SSFonts.get_font(SSGUIConstants.ICON_FONT_NAME__SEEDSIGNER, 26);

        // Fixed-width fonts will all have same height, ignoring below baseline (e.g. "Q" or "q")
        let [left, top, right, bottom] = this.font.getbbox("X", { anchor: "ls" });
        this.text_height = -1 * top;

        [left, top, right, bottom] = this.icon_key_font.getbbox(SSSeedSignerIconConstants.DELETE + SSSeedSignerIconConstants.SPACE, { anchor: "ls" });
        this.icon_key_height = -1 * top;

        this.x_start = rect[0];
        this.y_start = rect[1];
        this.x_gap = 2;
        this.key_width = ssInt((rect[2] - rect[0]) / cols) - this.x_gap;
        this.width = cols * this.key_width + (cols - 1) * this.x_gap;
        this.y_gap = 2;
        this.key_height = ssInt((rect[3] - rect[1]) / rows) - this.y_gap;
        this.height = rows * this.key_height + (rows - 1) * this.y_gap;

        // Two-dimensional list of Key obj row data
        this.keys = [];
        this.selected_key = { x: 0, y: 0 };  // Indices in the `keys` 2D list
        let cur_y = this.y_start;
        for (let i = 0; i < rows; i++) {
            const cur_row = [];
            let cur_x = this.x_start;
            let cur_index_x = 0;
            for (const letter of chars.slice(i * cols, (i + 1) * cols)) {
                let is_selected = false;
                if (letter === selected_char) {
                    is_selected = true;
                    this.selected_key.y = i;
                    this.selected_key.x = cur_index_x;
                }
                cur_row.push(new SSKeyboard.Key({
                    letter, screen_x: cur_x, screen_y: cur_y, index_x: cur_index_x, index_y: i, is_selected, keyboard: this,
                }));
                cur_x += this.key_width + this.x_gap;
                cur_index_x += 1;
            }
            this.keys.push(cur_row);
            if (i < rows - 1) {
                // increment to the next row and continue
                cur_y += this.key_height + this.y_gap;
            } else {
                // It's the last row; add the additional keys at the end
                for (const additional_key of additional_keys) {
                    this.keys[this.keys.length - 1].push(new SSKeyboard.Key({
                        letter: additional_key.letter,
                        code: additional_key.code,
                        screen_x: cur_x,
                        screen_y: cur_y,
                        index_x: cur_index_x,
                        index_y: i,
                        keyboard: this,
                        size: additional_key.size,
                        is_additional_key: true,
                    }));
                    cur_x += this.key_width * additional_key.size + this.x_gap;
                    cur_index_x += additional_key.size;
                }
            }
        }

        if (render_now) {
            // Render the keys
            this.render_keys();
            // Render the initial highlighted character
            this.update_from_input(null);
        }
    }

    update_active_keys(active_keys) {
        this.active_keys = active_keys;
        for (const row_keys of this.keys) {
            for (const key of row_keys) {
                // Note: ADDITIONAL_KEYS are never deactivated.
                key.is_active = !(!this.active_keys.includes(key.code) && !key.is_additional_key);
            }
        }
    }

    // Renders just the keys of the keyboard. Does NOT call renderer.show_image.
    render_keys(selected_letter = null) {
        // Start with a clear screen
        this.draw.rectangle(this.rect, { outline: 0, fill: 0 });
        this.keys.forEach((row_keys, i) => {
            row_keys.forEach((key, j) => {
                if (selected_letter && key.code === selected_letter) {
                    key.is_selected = true;
                    this.selected_key.y = i;
                    this.selected_key.x = j;
                }
                key.render_key();
            });
        });
    }

    get_selected_key() { return this.get_key_at(this.selected_key.x, this.selected_key.y); }

    get_key_at(index_x, index_y) {
        if (index_y < this.keys.length - 1) {
            // Not on the bottom row
            if (index_x < this.keys[index_y].length) return this.keys[index_y][index_x];
            return null;
        }
        let effective_index = 0;
        for (const cur_key of this.keys[index_y]) {
            if (index_x >= effective_index && index_x < effective_index + cur_key.size) return cur_key;
            effective_index += cur_key.size;
        }
        return null;
    }

    get_key_above(cur_x, cur_y) {
        let next_y = cur_y - 1;
        while (true) {
            if (next_y < 0) {
                // We started from the top row; auto_wrap or exit.
                if (this.auto_wrap.includes(SSKeyboard.WRAP_TOP)) {
                    next_y = this.keys.length - 1;
                } else {
                    return [cur_x, cur_y, SSKeyboard.EXIT_TOP];
                }
            }
            const target_key = this.get_key_at(cur_x, next_y);
            if (target_key) return [cur_x, next_y, null];
            next_y -= 1;
        }
    }

    get_key_below(cur_x, cur_y) {
        let next_y = cur_y + 1;
        while (true) {
            if (next_y === this.keys.length) {
                // We started from the bottom row; auto_wrap or exit.
                if (this.auto_wrap.includes(SSKeyboard.WRAP_BOTTOM)) {
                    next_y = 0;
                    return [cur_x, next_y, null];
                } else {
                    return [cur_x, cur_y, SSKeyboard.EXIT_BOTTOM];
                }
            }
            const target_key = this.get_key_at(cur_x, next_y);
            if (target_key !== null) return [cur_x, next_y, null];
            next_y += 1;
        }
    }

    /*
     * Returns the character currently highlighted or one of the EXIT_* codes if the user has navigated off the
     * keyboard past an edge that is not in `auto_wrap`. Does NOT call renderer.show_image.
     */
    update_from_input(input) {
        const HB = SSHardwareButtonsConstants;
        let key = this.get_key_at(this.selected_key.x, this.selected_key.y);

        // Before we update, undo our previously selected key
        key.is_selected = false;
        key.render_key();

        if (input === HB.KEY_RIGHT) {
            this.selected_key.x = key.index_x + key.size;
            const new_key = this.get_key_at(this.selected_key.x, this.selected_key.y);
            if (new_key === null) {
                if (this.auto_wrap.includes(SSKeyboard.WRAP_RIGHT)) {
                    this.selected_key.x = 0;
                } else {
                    this.selected_key.x -= 1;
                    return SSKeyboard.EXIT_RIGHT;
                }
            }
        } else if (input === HB.KEY_LEFT) {
            key = this.get_selected_key();
            this.selected_key.x = key.index_x - 1;
            if (this.selected_key.x < 0) {
                if (this.auto_wrap.includes(SSKeyboard.WRAP_LEFT)) {
                    const row = this.keys[this.selected_key.y];
                    this.selected_key.x = row[row.length - 1].index_x;
                } else {
                    this.selected_key.x += 1;
                    return SSKeyboard.EXIT_LEFT;
                }
            }
        } else if (input === HB.KEY_DOWN) {
            const [nx, ny, keyboard_exit] = this.get_key_below(this.selected_key.x, this.selected_key.y);
            this.selected_key.x = nx;
            this.selected_key.y = ny;
            if (keyboard_exit) return keyboard_exit;
        } else if (input === HB.KEY_UP) {
            const [nx, ny, keyboard_exit] = this.get_key_above(this.selected_key.x, this.selected_key.y);
            this.selected_key.x = nx;
            this.selected_key.y = ny;
            if (keyboard_exit) return keyboard_exit;
        } else if (input === SSKeyboard.ENTER_LEFT) {
            this.selected_key.x = 0;
        } else if (input === SSKeyboard.ENTER_RIGHT) {
            const row = this.keys[this.selected_key.y];
            this.selected_key.x = row[row.length - 1].index_x;
        } else if (input === SSKeyboard.ENTER_TOP) {
            this.selected_key.y = 0;
        } else if (input === SSKeyboard.ENTER_BOTTOM) {
            this.selected_key.y = this.keys.length - 1;
            while (true) {
                const k = this.get_key_at(this.selected_key.x, this.selected_key.y);
                if (k !== null) break;
                this.selected_key.y -= 1;   // Can't enter here. Jump up a row
            }
        }

        // Render the newly selected letter
        key = this.get_key_at(this.selected_key.x, this.selected_key.y);
        key.is_selected = true;
        key.render_key();
        return key.code;
    }

    set_selected_key(selected_letter) {
        if (selected_letter && typeof selected_letter === "object") selected_letter = selected_letter.selected_letter;
        // De-select the current selected_key
        this.get_selected_key().is_selected = false;
        for (let i = 0; i < this.keys.length; i++) {
            for (let j = 0; j < this.keys[i].length; j++) {
                const key = this.keys[i][j];
                if (selected_letter && key.code === selected_letter) {
                    key.is_selected = true;
                    this.selected_key.y = i;
                    this.selected_key.x = j;
                    return;
                }
            }
        }
        throw new Error(`\`selected_letter\` "${selected_letter}" not found in keyboard`);
    }

    set_selected_key_indices(x, y) {
        if (x && typeof x === "object") ({ x, y } = x);
        this.get_selected_key().is_selected = false;
        this.selected_key.y = y < this.keys.length ? y : this.keys.length - 1;
        this.selected_key.x = x < this.keys[this.selected_key.y].length ? x : this.keys[this.selected_key.y].length - 1;
        this.get_key_at(this.selected_key.x, this.selected_key.y).is_selected = true;
    }
}
(function (K) {
    K.WRAP_TOP = "wrap_top";
    K.WRAP_BOTTOM = "wrap_bottom";
    K.WRAP_LEFT = "wrap_left";
    K.WRAP_RIGHT = "wrap_right";

    K.EXIT_TOP = "exit_top";
    K.EXIT_BOTTOM = "exit_bottom";
    K.EXIT_LEFT = "exit_left";
    K.EXIT_RIGHT = "exit_right";
    K.EXIT_DIRECTIONS = [K.EXIT_TOP, K.EXIT_BOTTOM, K.EXIT_LEFT, K.EXIT_RIGHT];

    K.ENTER_TOP = "enter_top";
    K.ENTER_BOTTOM = "enter_bottom";
    K.ENTER_LEFT = "enter_left";
    K.ENTER_RIGHT = "enter_right";

    K.REGULAR_KEY_FONT = "regular";
    K.ICON_KEY_FONT = SSGUIConstants.ICON_FONT_NAME__SEEDSIGNER;

    K.KEY_BACKSPACE = { code: "DEL", letter: SSSeedSignerIconConstants.DELETE, font: K.ICON_KEY_FONT, size: 2 };
    K.KEY_SPACE = { code: "SPACE", letter: SSSeedSignerIconConstants.SPACE, font: K.ICON_KEY_FONT, size: 1 };
    K.KEY_SPACE_2 = { code: "SPACE", letter: SSSeedSignerIconConstants.SPACE, font: K.ICON_KEY_FONT, size: 2 };
    K.KEY_SPACE_5 = { code: "SPACE", letter: SSSeedSignerIconConstants.SPACE, font: K.ICON_KEY_FONT, size: 5 };
    K.KEY_CURSOR_LEFT = { code: "CURSOR_LEFT", letter: SSSeedSignerIconConstants.CHEVRON_LEFT, font: K.ICON_KEY_FONT, size: 1 };
    K.KEY_CURSOR_RIGHT = { code: "CURSOR_RIGHT", letter: SSSeedSignerIconConstants.CHEVRON_RIGHT, font: K.ICON_KEY_FONT, size: 1 };
    K.KEY_PREVIOUS_PAGE = { code: "PREV", letter: "<", font: K.REGULAR_KEY_FONT, size: 1 };
    K.ADDITIONAL_KEYS = {
        [K.KEY_SPACE.code]: K.KEY_SPACE,
        [K.KEY_BACKSPACE.code]: K.KEY_BACKSPACE,
        [K.KEY_CURSOR_LEFT.code]: K.KEY_CURSOR_LEFT,
        [K.KEY_CURSOR_RIGHT.code]: K.KEY_CURSOR_RIGHT,
        [K.KEY_PREVIOUS_PAGE.code]: K.KEY_PREVIOUS_PAGE,
    };
    // Python `x in Keyboard.ADDITIONAL_KEYS` -> SSKeyboard.is_additional_key_code(x)
    K.is_additional_key_code = (code) => Object.prototype.hasOwnProperty.call(K.ADDITIONAL_KEYS, code);
})(SSKeyboard);

// Keyboard.Key: info about each individual key in the keyboard and its state
SSKeyboard.Key = class Key extends SSDataclass {
    static get _fields() {
        return {
            letter: undefined, screen_x: undefined, screen_y: undefined, keyboard: undefined,
            index_x: null, index_y: null, code: null, size: 1, is_active: true, is_selected: false, is_additional_key: false,
        };
    }

    __post_init__() {
        if (!this.code) this.code = this.letter;
    }

    render_key() {
        const kb = this.keyboard;
        let font = kb.font;
        let text_height = kb.text_height;
        if (this.is_additional_key) {
            if (SSKeyboard.ADDITIONAL_KEYS[this.code].font === SSKeyboard.ICON_KEY_FONT) {
                font = kb.icon_key_font;
                text_height = kb.icon_key_height;
            }
        }

        let outline_color = "#333";
        let rect_color, font_color;
        if (!this.is_active) {
            rect_color = kb.deactivated_background_color;
            font_color = "#333";  // Show the letter but render as gray
            outline_color = kb.deactivated_background_color;
            if (this.is_selected) {
                // Inactive, selected just gets highlighted outline
                outline_color = kb.highlight_color;
            }
        } else if (this.is_selected) {
            rect_color = kb.highlight_color;  // Render solid background with the UI's hero color
            font_color = "black";
        } else {
            if (this.is_additional_key) {
                rect_color = "#000";
                font_color = "#999";
            } else {
                rect_color = kb.background_color;
                font_color = "#e8e8e8";
            }
        }

        kb.draw.rounded_rectangle(
            [this.screen_x, this.screen_y, this.screen_x + kb.key_width * this.size - 1, this.screen_y + kb.key_height],
            { outline: outline_color, fill: rect_color, radius: 4 }
        );

        kb.draw.text(
            [this.screen_x + ssInt(kb.key_width * this.size / 2), this.screen_y + kb.key_height - ssInt((kb.key_height - text_height) / 2)],
            this.letter,
            { fill: font_color, font, anchor: "ms" }
        );
    }
};

class SSTextEntryDisplayConstants {}
SSTextEntryDisplayConstants.CURSOR_MODE__BAR = "bar";
SSTextEntryDisplayConstants.CURSOR_MODE__BLOCK = "block";

class SSTextEntryDisplay extends SSDataclass {
    static get _fields() {
        return {
            canvas: undefined,
            rect: undefined,
            font_name: SSGUIConstants.FIXED_WIDTH_EMPHASIS_FONT_NAME,
            font_size: 24,
            accent_color: SSGUIConstants.ACCENT_COLOR,
            background_color: SSGUIConstants.BUTTON_BACKGROUND_COLOR,
            cursor_mode: SSTextEntryDisplayConstants.CURSOR_MODE__BLOCK,
            is_centered: true,
            cur_text: " ",
            text_offset: 0,
        };
    }

    __post_init__() {
        this.font = SSFonts.get_font(this.font_name, this.font_size);
    }

    get width() { return this.rect[2] - this.rect[0]; }
    get height() { return this.rect[3] - this.rect[1]; }

    // Render the live text entry display
    render(cur_text = null, cursor_position = null) {
        if (cur_text && typeof cur_text === "object") ({ cur_text = null, cursor_position = null } = cur_text);
        if (cur_text !== null && cur_text !== undefined) this.cur_text = cur_text;

        // Start by rendering to a new Image that we'll composite in at the end
        const image = SSImage.new("RGB", [this.width + 1, this.height + 1], "black");
        const draw = SSImageDraw.Draw(image);

        draw.rounded_rectangle([0, 0, this.width, this.height], { fill: this.background_color, radius: 4 });

        let [left, top, right, bottom] = this.font.getbbox("X", { anchor: "ls" });  // measure from baseline
        const text_height = -1 * top;  // ignoring below baseline

        if (this.cursor_mode === SSTextEntryDisplay.CURSOR_MODE__BLOCK) {
            const cursor_block_width = 18;

            // Draw n-1 of the selected letters
            [left, top, right, bottom] = this.font.getbbox(this.cur_text.slice(0, -1), { anchor: "ls" });
            const text_width = right;
            if (this.is_centered) {
                this.text_offset = ssInt(this.width - text_width - cursor_block_width) / 2;
            } else {
                this.text_offset = SSGUIConstants.COMPONENT_PADDING;
            }
            let cursor_block_offset = this.text_offset + text_width - 1;
            if (cursor_block_offset === 0) cursor_block_offset = 1;

            const end_pos_x = cursor_block_offset + cursor_block_width;
            if (end_pos_x >= this.width) {
                // Shift the display left
                cursor_block_offset -= end_pos_x - this.width + 1;
                this.text_offset -= end_pos_x - this.width + 1;
            }

            draw.text([this.text_offset, this.height - ssInt(text_height / 2)], this.cur_text.slice(0, -1), { fill: SSGUIConstants.ACCENT_COLOR, font: this.font, anchor: "ls" });

            // Draw the highlighted cursor block
            const cursor_color = "#666";
            draw.rectangle([cursor_block_offset, 1, cursor_block_offset + cursor_block_width, this.height - 1], { fill: cursor_color });
            draw.text([cursor_block_offset + 1, this.height - ssInt(text_height / 2)], this.cur_text.slice(-1), { fill: SSGUIConstants.ACCENT_COLOR, font: this.font, anchor: "ls" });
        } else {
            const cursor_bar_serif_half_width = 4;
            if (this.is_centered) throw new Error("Centered cursor bars not fully implemented");

            // Note: measures the `cur_text` argument (not self.cur_text), as the Python does
            [left, top, right, bottom] = this.font.getbbox(cur_text ? cur_text : "", { anchor: "ls" });
            const text_width = right;
            let cursor_bar_x, tw_left;

            const end_pos_x = 3 + text_width + cursor_bar_serif_half_width + 3;
            if (end_pos_x < this.width) {
                // The entire cur_text plus the cursor bar fits
                this.text_offset = 3 + cursor_bar_serif_half_width;
                const sub = cursor_position === null ? this.cur_text : this.cur_text.slice(0, cursor_position);
                [left, top, right, bottom] = this.font.getbbox(sub);
                tw_left = right - left;
                cursor_bar_x = this.text_offset + tw_left;
            } else {
                if (cursor_position === null) cursor_position = this.cur_text.length;
                // Is the cursor at either extreme?
                [left, top, right, bottom] = this.font.getbbox(this.cur_text.slice(0, cursor_position));
                tw_left = right - left;
                if (this.text_offset + tw_left + cursor_bar_serif_half_width + 3 >= this.width) {
                    // Cursor is at the extreme right; push the full tw_right off the right edge.
                    this.text_offset = this.width - (tw_left + cursor_bar_serif_half_width + 3);
                } else if (this.text_offset + tw_left < 3 + cursor_bar_serif_half_width) {
                    // Cursor is at the extreme left; push the full tw_left off the left edge.
                    this.text_offset = 3 + cursor_bar_serif_half_width - tw_left;
                }
                cursor_bar_x = this.text_offset + tw_left;
            }

            draw.text([this.text_offset, this.height - ssInt((this.height - text_height) / 2)], this.cur_text, { fill: this.accent_color, font: this.font, anchor: "ls" });

            // Render as an "I" bar
            const cursor_bar_color = "#ccc";
            draw.line([cursor_bar_x, 3, cursor_bar_x, this.height - 3], { fill: cursor_bar_color });
            draw.line([cursor_bar_x - cursor_bar_serif_half_width, 3, cursor_bar_x + cursor_bar_serif_half_width, 3], { fill: cursor_bar_color });
            draw.line([cursor_bar_x - cursor_bar_serif_half_width, this.height - 3, cursor_bar_x + cursor_bar_serif_half_width, this.height - 3], { fill: cursor_bar_color });
        }

        // Paste the display onto the main canvas
        this.canvas.paste(image, [this.rect[0], this.rect[1]]);
    }
}
SSTextEntryDisplay.CURSOR_MODE__BAR = "bar";
SSTextEntryDisplay.CURSOR_MODE__BLOCK = "block";

/* =====================================================================================================
 * gui/screens/screen.py
 * ===================================================================================================== */

// Must be huge numbers to avoid conflicting with the selected_button returned by the screens with buttons.
const SS_RET_CODE__BACK_BUTTON = 1000;
const SS_RET_CODE__POWER_BUTTON = 1001;

class SSBaseScreen extends SSBaseComponent {
    __post_init__() {
        super.__post_init__();
        this.hw_inputs = SSHardwareButtons.get_instance();

        // Implementation classes can add their own BaseThread to run in parallel with the main execution thread.
        this.threads = [];
        // Additional BaseComponent-derived objects; they'll be called to `render()` themselves in _render().
        this.components = [];
        // [SSImage, [x, y]] pairs pasted in _render()
        this.paste_images = [];
        // Tracks position on scrollable pages, determines which elements are visible.
        this.scroll_y = 0;
    }

    get_threads() {
        let threads = this.threads.slice();
        for (const component of this.components) threads = threads.concat(component.threads || []);
        return threads;
    }

    // Screen.display(): render, start threads, run the input loop, then stop all threads.
    async display() {
        try {
            await this.renderer.lock.acquire();
            try {
                await this._render();
                this.renderer.show_image();
            } finally {
                this.renderer.lock.release();
            }

            for (const t of this.get_threads()) {
                if (!t.is_alive()) t.start();
            }

            return await this._run();
        } finally {
            for (const t of this.get_threads()) t.stop();
            for (const t of this.get_threads()) {
                // Wait for each thread to stop; equivalent to `join()`
                while (t.is_alive()) await ssSleep(0.01);
            }
        }
    }

    // Brief alias: `await screen.run()` === Python `screen.display()`
    run() { return this.display(); }

    clear_screen() {
        // Clear the whole canvas
        this.image_draw.rectangle([0, 0, this.canvas_width, this.canvas_height], { fill: 0 });
    }

    _render() {
        this.clear_screen();
        for (const component of this.components) component.render();
        for (const [img, coords] of this.paste_images) this.canvas.paste(img, coords);
    }

    /*
     * Optional implementation step that's called during each _run() loop.
     * Loop will continue if it returns None (null/undefined); otherwise the Screen exits with that value.
     */
    _run_callback() { return null; }

    async _run() { throw new Error("Must implement in a child class"); }
}

// LoadingScreenThread(text=None): spinner (btc logo + orbiting arc). new SSLoadingScreenThread({text}) or ("text")
class SSLoadingScreenThread extends SSBaseThread {
    constructor(text = null) {
        super();
        if (text && typeof text === "object") text = text.text || null;
        this.text = text;
    }

    async run() {
        const renderer = SSRenderer.get_instance();
        const center_image = ssLoadImage("btc_logo_60x60.png");
        const orbit_gap = 2 * SSGUIConstants.COMPONENT_PADDING;
        const bounding_box = [
            ssInt((renderer.canvas_width - center_image.width) / 2 - orbit_gap),
            ssInt((renderer.canvas_height - center_image.height) / 2 - orbit_gap),
            ssInt((renderer.canvas_width + center_image.width) / 2 + orbit_gap),
            ssInt((renderer.canvas_height + center_image.height) / 2 + orbit_gap),
        ];
        let position = 0;
        const arc_sweep = 45;
        const arc_color = "#ff9416";
        const arc_trailing_color = "#80490b";

        // Need to flush the screen
        await ssWithLock(renderer.lock, () => {
            renderer.draw.rectangle([0, 0, renderer.canvas_width, renderer.canvas_height], { fill: SSGUIConstants.BACKGROUND_COLOR });
            renderer.canvas.paste(center_image, [bounding_box[0] + orbit_gap, bounding_box[1] + orbit_gap]);
            if (this.text) {
                new SSTextArea({
                    text: this.text,
                    font_size: SSGUIConstants.get_top_nav_title_font_size(),
                    screen_y: ssInt((renderer.canvas_height - bounding_box[3]) / 2),
                }).render();
            }
        });

        while (this.keep_running) {
            await ssWithLock(renderer.lock, () => {
                // SIM: PIL draws aliased arcs, so its "erase" arc removes the old arc exactly. Canvas arcs are
                // anti-aliased and would leave faint rings, so the whole orbit is cleared first (same visible result).
                renderer.draw.arc([bounding_box[0] - 1, bounding_box[1] - 1, bounding_box[2] + 1, bounding_box[3] + 1],
                    { start: 0, end: 360, fill: SSGUIConstants.BACKGROUND_COLOR, width: SSGUIConstants.COMPONENT_PADDING + 2 });
                // Render leading arc
                renderer.draw.arc(bounding_box, { start: position, end: position + arc_sweep, fill: arc_color, width: SSGUIConstants.COMPONENT_PADDING });
                // Render trailing arc
                renderer.draw.arc(bounding_box, { start: position - arc_sweep, end: position, fill: arc_trailing_color, width: SSGUIConstants.COMPONENT_PADDING });
                // Erase previous trailing arc leading arc
                renderer.draw.arc(bounding_box, { start: position - 2 * arc_sweep, end: position - arc_sweep, fill: SSGUIConstants.BACKGROUND_COLOR, width: SSGUIConstants.COMPONENT_PADDING });
                renderer.show_image();
            });
            position += arc_sweep;
            // SIM: the Python loop is paced by SPI display writes (~25 fps on a Pi Zero)
            await ssSleep(0.04);
        }
    }
}

class SSBaseTopNavScreen extends SSBaseScreen {
    static get _fields() {
        return {
            top_nav_icon_name: null,
            top_nav_icon_color: null,
            title: "Screen Title",
            title_font_size: SSGUIConstants.TOP_NAV_TITLE_FONT_SIZE["default"],
            show_back_button: true,
            show_power_button: false,
        };
    }

    __post_init__() {
        super.__post_init__();
        this.top_nav = new SSTopNav({
            icon_name: this.top_nav_icon_name,
            icon_color: this.top_nav_icon_color,
            text: this.title,
            font_size: this.title_font_size,
            width: this.canvas_width,
            height: SSGUIConstants.TOP_NAV_HEIGHT,
            show_back_button: this.show_back_button,
            show_power_button: this.show_power_button,
        });
        this.is_input_in_top_nav = false;
        this.components.push(this.top_nav);
    }

    async _run() {
        const HB = SSHardwareButtonsConstants;
        while (true) {
            if (!this.top_nav.show_back_button && !this.top_nav.show_power_button) {
                // There's no navigation away from this screen; nothing to do here
                await ssSleep(0.1);
                continue;
            }

            const user_input = await this.hw_inputs.wait_for(HB.ALL_KEYS);

            await this.renderer.lock.acquire();
            try {
                if (!this.top_nav.is_selected && [HB.KEY_LEFT, HB.KEY_UP].includes(user_input)) {
                    this.top_nav.is_selected = true;
                    this.top_nav.render_buttons();
                } else if (this.top_nav.is_selected && [HB.KEY_DOWN, HB.KEY_RIGHT].includes(user_input)) {
                    this.top_nav.is_selected = false;
                    this.top_nav.render_buttons();
                } else if (this.top_nav.is_selected && HB.KEYS__ANYCLICK.includes(user_input)) {
                    return this.top_nav.selected_button;
                } else {
                    // Nothing to do with this input
                    continue;
                }
                // Write the screen updates
                this.renderer.show_image();
            } finally {
                this.renderer.lock.release();
            }
        }
    }
}

/*
 * ButtonOption(button_label, icon_name=None, icon_color=None, right_icon_name=None, button_label_color=None,
 *              return_data=None, active_button_label=None, font_name=None, font_size=None)
 * new SSButtonOption("Scan", SSSeedSignerIconConstants.SCAN)  or  new SSButtonOption({button_label: "Scan", ...})
 * Python == is field-wise: use ssEq(a, b) or a.equals(b).
 */
class SSButtonOption {
    constructor(button_label, icon_name, icon_color, right_icon_name, button_label_color, return_data, active_button_label, font_name, font_size) {
        let f;
        if (button_label && typeof button_label === "object") f = button_label;
        else f = { button_label, icon_name, icon_color, right_icon_name, button_label_color, return_data, active_button_label, font_name, font_size };
        const defaults = { button_label: undefined, icon_name: null, icon_color: null, right_icon_name: null, button_label_color: null, return_data: null, active_button_label: null, font_name: null, font_size: null };
        for (const k of Object.keys(defaults)) this[k] = f[k] !== undefined ? f[k] : defaults[k];
    }
    equals(other) {
        if (!other || other.constructor !== this.constructor) return false;
        for (const k of ["button_label", "icon_name", "icon_color", "right_icon_name", "button_label_color", "return_data", "active_button_label", "font_name", "font_size"]) {
            if (!ssEq(this[k], other[k])) return false;
        }
        return true;
    }
}

// Same as ButtonOption but does NOT translate button_label or active_button_label.
class SSButtonOptionWithoutTranslation extends SSButtonOption {}

class SSButtonListScreen extends SSBaseTopNavScreen {
    static get _fields() {
        return {
            button_data: null,
            selected_button: 0,
            is_button_text_centered: true,
            is_bottom_list: false,
            button_font_name: null,
            button_font_size: null,
            button_selected_color: SSGUIConstants.ACCENT_COLOR,
            checked_buttons: null,
            // Enables returning w/buttons rendered at the same place
            scroll_y_initial_offset: null,
        };
    }

    // Python class attribute `Button_cls = Button`; subclasses override with `get Button_cls() { return SSX; }`
    // (an instance may also assign `this.Button_cls = ...`, as settings_screens.py does: the setter keeps it per instance)
    get Button_cls() { return this._ss_Button_cls || SSButton; }
    set Button_cls(v) { this._ss_Button_cls = v; }

    __post_init__() {
        if (!this.button_font_name) this.button_font_name = SSGUIConstants.get_button_font_name();
        if (!this.button_font_size) this.button_font_size = SSGUIConstants.get_button_font_size();
        super.__post_init__();

        const button_height = SSGUIConstants.BUTTON_HEIGHT;
        let button_list_height;
        if (this.button_data.length === 1) {
            button_list_height = button_height;
        } else {
            button_list_height = this.button_data.length * button_height + SSGUIConstants.LIST_ITEM_PADDING * (this.button_data.length - 1);
        }

        let button_list_y;
        if (this.is_bottom_list) {
            button_list_y = this.canvas_height - (button_list_height + SSGUIConstants.EDGE_PADDING);
        } else {
            button_list_y = this.top_nav.height + ssInt((this.canvas_height - this.top_nav.height - button_list_height) / 2);
        }

        this.has_scroll_arrows = false;
        if (button_list_y < this.top_nav.height) {
            // The button list is too long; force it to run off the bottom of the screen.
            button_list_y = this.top_nav.height;
            this.has_scroll_arrows = true;

            // How many buttons fit on the screen before we need to start scrolling?
            const num_buttons_pre_scroll = Math.floor((this.canvas_height - button_list_y - SSGUIConstants.EDGE_PADDING) / (button_height + SSGUIConstants.LIST_ITEM_PADDING));

            // Force a scroll offset when necessary if none was provided
            if (this.selected_button + 1 > num_buttons_pre_scroll && !this.scroll_y_initial_offset) {
                this.scroll_y_initial_offset = (button_height + SSGUIConstants.LIST_ITEM_PADDING) * (this.selected_button - num_buttons_pre_scroll + 1);
            }
        }

        this.buttons = [];
        this.button_data.forEach((button_option, i) => {
            if (!(button_option instanceof SSButtonOption)) throw new Error("Refactor to ButtonOption approach needed!");

            // English only: _() is the identity, so both ButtonOption flavors use the labels as-is
            const button_label = button_option.button_label;
            const active_button_label = button_option.active_button_label;

            const button_kwargs = {
                text: button_label,
                active_text: active_button_label,
                icon_name: button_option.icon_name,
                icon_color: button_option.icon_color ? button_option.icon_color : SSGUIConstants.BUTTON_FONT_COLOR,
                is_icon_inline: true,
                right_icon_name: button_option.right_icon_name,
                screen_x: SSGUIConstants.EDGE_PADDING,
                screen_y: button_list_y + i * (button_height + SSGUIConstants.LIST_ITEM_PADDING),
                scroll_y: this.scroll_y_initial_offset !== null && this.scroll_y_initial_offset !== undefined ? this.scroll_y_initial_offset : 0,
                width: this.canvas_width - 2 * SSGUIConstants.EDGE_PADDING,
                height: button_height,
                is_text_centered: this.is_button_text_centered,
                font_name: button_option.font_name ? button_option.font_name : this.button_font_name,
                font_size: button_option.font_size ? button_option.font_size : this.button_font_size,
                font_color: button_option.button_label_color ? button_option.button_label_color : SSGUIConstants.BUTTON_FONT_COLOR,
                selected_color: this.button_selected_color,
                is_scrollable_text: true,  // We need to use the ScrollableText class for long button labels
            };
            if (this.checked_buttons && this.checked_buttons.includes(i)) button_kwargs.is_checked = true;
            const ButtonCls = this.Button_cls;
            this.buttons.push(new ButtonCls(button_kwargs));
        });

        if (this.has_scroll_arrows) {
            this.arrow_half_width = 10;
            this.up_arrow_img = SSImage.new("RGBA", [2 * this.arrow_half_width, 8], "black");
            this.up_arrow_img_y = this.top_nav.height - 12;
            let arrow_draw = SSImageDraw.Draw(this.up_arrow_img);
            arrow_draw.line([this.arrow_half_width, 1, 0, 7], { fill: SSGUIConstants.BUTTON_FONT_COLOR });
            arrow_draw.line([this.arrow_half_width, 1, 2 * this.arrow_half_width, 7], { fill: SSGUIConstants.BUTTON_FONT_COLOR });

            this.down_arrow_img = SSImage.new("RGBA", [2 * this.arrow_half_width, 8], "black");
            this.down_arrow_img_y = this.canvas_height - 16 + 2;
            arrow_draw = SSImageDraw.Draw(this.down_arrow_img);
            arrow_draw.line([this.arrow_half_width, 7, 0, 1], { fill: SSGUIConstants.BUTTON_FONT_COLOR });
            arrow_draw.line([this.arrow_half_width, 7, 2 * this.arrow_half_width, 1], { fill: SSGUIConstants.BUTTON_FONT_COLOR });
        }

        const cur_selected_button = this.buttons[this.selected_button];
        cur_selected_button.is_selected = true;
    }

    get_threads() {
        let threads = super.get_threads();
        for (const button of this.buttons) {
            if (button.is_scrollable_text) threads = threads.concat(button.threads);
        }
        return threads;
    }

    _render() {
        super._render();
        this._render_visible_buttons();
        // Write the screen updates
        this.renderer.show_image();
    }

    _render_visible_buttons() {
        if (this.has_scroll_arrows) {
            this._render_up_arrow();
            this._render_down_arrow();
        }
        this.buttons.forEach((button, i) => {
            if (!this.has_scroll_arrows) {
                button.render();
                return;
            }
            const button_position_y = button.screen_y - button.scroll_y;
            if (button_position_y >= this.top_nav.height && button_position_y < this.down_arrow_img_y) {
                if (i === 0) this._hide_up_arrow();   // We rendered the top button; no more to scroll up for.
                if (i === this.buttons.length - 1) this._hide_down_arrow();  // no more to scroll down for.
                // Render the button after the arrows to cover up overlap
                button.render();
            }
        });
    }

    _render_up_arrow() {
        this.canvas.paste(this.up_arrow_img, [ssInt(this.canvas_width / 2) - this.arrow_half_width, this.up_arrow_img_y]);
    }
    _render_down_arrow() {
        this.canvas.paste(this.down_arrow_img, [ssInt(this.canvas_width / 2) - this.arrow_half_width, this.down_arrow_img_y]);
    }
    _hide_up_arrow() {
        this.image_draw.rectangle([
            ssInt(this.canvas_width / 2) - this.arrow_half_width, this.up_arrow_img_y,
            ssInt(this.canvas_width / 2) + this.arrow_half_width, this.up_arrow_img_y + this.up_arrow_img.height,
        ], { fill: "black" });
    }
    _hide_down_arrow() {
        this.image_draw.rectangle([
            ssInt(this.canvas_width / 2) - this.arrow_half_width, this.down_arrow_img_y,
            ssInt(this.canvas_width / 2) + this.arrow_half_width, this.down_arrow_img_y + this.down_arrow_img.height,
        ], { fill: "black" });
    }

    async _run() {
        const HB = SSHardwareButtonsConstants;
        while (true) {
            const ret = await this._run_callback();
            if (ret !== null && ret !== undefined) return ret;

            const user_input = await this.hw_inputs.wait_for([HB.KEY_UP, HB.KEY_DOWN, HB.KEY_LEFT, HB.KEY_RIGHT].concat(HB.KEYS__ANYCLICK));

            await this.renderer.lock.acquire();
            try {
                if (!this.top_nav.is_selected && (user_input === HB.KEY_LEFT || (user_input === HB.KEY_UP && this.selected_button === 0))) {
                    // SHORTCUT to escape long menu screens! OR keyed UP from the top of the list.
                    // Only move navigation up there if there's something to select
                    if (this.top_nav.show_back_button || this.top_nav.show_power_button) {
                        this.buttons[this.selected_button].is_selected = false;
                        this.buttons[this.selected_button].render();
                        this.top_nav.is_selected = true;
                        this.top_nav.render_buttons();
                    }
                } else if (user_input === HB.KEY_UP) {
                    if (this.top_nav.is_selected) {
                        // Can't go up any further
                    } else {
                        const cur_selected_button = this.buttons[this.selected_button];
                        this.selected_button -= 1;
                        const next_selected_button = this.buttons[this.selected_button];
                        cur_selected_button.is_selected = false;
                        next_selected_button.is_selected = true;
                        if (this.has_scroll_arrows && next_selected_button.screen_y - next_selected_button.scroll_y + next_selected_button.height < this.top_nav.height) {
                            // Selected a Button that's off the top of the screen
                            const frame_scroll = cur_selected_button.screen_y - next_selected_button.screen_y;
                            for (const button of this.buttons) button.scroll_y -= frame_scroll;
                            this._render_visible_buttons();
                        } else {
                            cur_selected_button.render();
                            next_selected_button.render();
                        }
                    }
                } else if (user_input === HB.KEY_DOWN || (this.top_nav.is_selected && user_input === HB.KEY_RIGHT)) {
                    if (this.selected_button === this.buttons.length - 1) {
                        // Already at the bottom of the list. May need to re-render if returning from top_nav.
                        if (!this.top_nav.is_selected) continue;
                    }
                    let cur_selected_button, next_selected_button;
                    if (this.top_nav.is_selected) {
                        this.top_nav.is_selected = false;
                        this.top_nav.render_buttons();
                        cur_selected_button = null;
                        next_selected_button = this.buttons[this.selected_button];
                        next_selected_button.is_selected = true;
                    } else {
                        cur_selected_button = this.buttons[this.selected_button];
                        this.selected_button += 1;
                        next_selected_button = this.buttons[this.selected_button];
                        cur_selected_button.is_selected = false;
                        next_selected_button.is_selected = true;
                    }

                    if (this.has_scroll_arrows && next_selected_button.screen_y - next_selected_button.scroll_y + next_selected_button.height > this.down_arrow_img_y) {
                        // Selected a Button that's off the bottom of the screen
                        const frame_scroll = next_selected_button.screen_y - cur_selected_button.screen_y;
                        for (const button of this.buttons) button.scroll_y += frame_scroll;
                        this._render_visible_buttons();
                    } else {
                        if (cur_selected_button) cur_selected_button.render();
                        next_selected_button.render();
                    }
                } else if (HB.KEYS__ANYCLICK.includes(user_input)) {
                    if (this.top_nav.is_selected) return this.top_nav.selected_button;
                    return this.selected_button;
                }

                // Write the screen updates
                this.renderer.show_image();
            } finally {
                this.renderer.lock.release();
            }
        }
    }
}

class SSLargeButtonScreen extends SSBaseTopNavScreen {
    static get _fields() {
        return {
            button_data: null,
            button_font_name: null,
            button_font_size: null,
            button_selected_color: SSGUIConstants.ACCENT_COLOR,
            selected_button: 0,
        };
    }

    __post_init__() {
        if (!this.button_font_name) this.button_font_name = SSGUIConstants.get_button_font_name();
        if (!this.button_font_size) this.button_font_size = SSGUIConstants.get_button_font_size() + 2;

        super.__post_init__();

        if (![2, 4].includes(this.button_data.length)) throw new Error("LargeButtonScreen only supports 2 or 4 buttons");

        // Maximize 2-across width
        const button_width = ssInt((this.canvas_width - 2 * SSGUIConstants.EDGE_PADDING - SSGUIConstants.COMPONENT_PADDING) / 2);
        // Maximize 2-row height
        const button_height = ssInt((this.canvas_height - this.top_nav.height - 2 * SSGUIConstants.COMPONENT_PADDING - SSGUIConstants.EDGE_PADDING) / 2);

        // Vertically center the buttons
        let button_start_y;
        if (this.button_data.length === 2) {
            button_start_y = this.top_nav.height + ssInt((this.canvas_height - (this.top_nav.height + SSGUIConstants.COMPONENT_PADDING) - button_height) / 2);
        } else {
            button_start_y = this.top_nav.height + ssInt((this.canvas_height - (this.top_nav.height + SSGUIConstants.COMPONENT_PADDING) - 2 * button_height - SSGUIConstants.COMPONENT_PADDING) / 2);
        }

        this.buttons = [];
        this.button_data.forEach((button_option, i) => {
            if (!(button_option instanceof SSButtonOption) || button_option.constructor !== SSButtonOption) throw new Error("Refactor needed!");
            const button_label = button_option.button_label;
            const icon_name = button_option.icon_name;

            const button_start_x = i % 2 === 0
                ? SSGUIConstants.EDGE_PADDING
                : SSGUIConstants.EDGE_PADDING + button_width + SSGUIConstants.COMPONENT_PADDING;

            const button_args = {
                text: button_label,
                screen_x: button_start_x,
                screen_y: button_start_y,
                width: button_width,
                height: button_height,
                is_text_centered: true,
                font_name: this.button_font_name,
                font_size: this.button_font_size,
                selected_color: this.button_selected_color,
            };
            let button;
            if (icon_name) {
                button_args.icon_name = icon_name;
                button_args.text_y_offset = ssInt(48 / 240 * this.renderer.canvas_height) + SSGUIConstants.COMPONENT_PADDING;
                button = new SSLargeIconButton(button_args);
            } else {
                button = new SSButton(button_args);
            }
            this.buttons.push(button);
            this.components.push(button);

            if (i === 1) button_start_y += button_height + SSGUIConstants.COMPONENT_PADDING;
        });

        this.buttons[this.selected_button].is_selected = true;
    }

    async _run() {
        const HB = SSHardwareButtonsConstants;
        const swap_selected_button = (new_selected_button) => {
            this.buttons[this.selected_button].is_selected = false;
            this.buttons[this.selected_button].render();
            this.selected_button = new_selected_button;
            this.buttons[this.selected_button].is_selected = true;
            this.buttons[this.selected_button].render();
        };

        while (true) {
            const ret = await this._run_callback();
            if (ret !== null && ret !== undefined) return ret;

            const user_input = await this.hw_inputs.wait_for([HB.KEY_UP, HB.KEY_DOWN, HB.KEY_LEFT, HB.KEY_RIGHT].concat(HB.KEYS__ANYCLICK));

            await this.renderer.lock.acquire();
            try {
                if (user_input === HB.KEY_UP) {
                    if ([0, 1].includes(this.selected_button)) {
                        // Move selection up to top_nav
                        this.top_nav.is_selected = true;
                        this.top_nav.render_buttons();
                        this.buttons[this.selected_button].is_selected = false;
                        this.buttons[this.selected_button].render();
                    } else if (this.buttons.length === 4) {
                        swap_selected_button(this.selected_button - 2);
                    }
                } else if (user_input === HB.KEY_DOWN) {
                    if (this.top_nav.is_selected) {
                        this.top_nav.is_selected = false;
                        this.top_nav.render_buttons();
                        this.buttons[this.selected_button].is_selected = true;
                        this.buttons[this.selected_button].render();
                    } else if ([2, 3].includes(this.selected_button)) {
                        // pass
                    } else if (this.buttons.length === 4) {
                        swap_selected_button(this.selected_button + 2);
                    }
                } else if (user_input === HB.KEY_RIGHT && !this.top_nav.is_selected) {
                    if ([0, 2].includes(this.selected_button)) swap_selected_button(this.selected_button + 1);
                } else if (user_input === HB.KEY_RIGHT && this.top_nav.is_selected && !this.top_nav.show_power_button) {
                    this.top_nav.is_selected = false;
                    this.top_nav.render_buttons();
                    this.buttons[this.selected_button].is_selected = true;
                    this.buttons[this.selected_button].render();
                } else if (user_input === HB.KEY_LEFT && !this.top_nav.is_selected) {
                    if ([1, 3].includes(this.selected_button)) {
                        swap_selected_button(this.selected_button - 1);
                    } else {
                        // Left from the far edge takes us up to the BACK arrow
                        if (this.top_nav.show_back_button) {
                            this.top_nav.is_selected = true;
                            this.top_nav.render_buttons();
                            this.buttons[this.selected_button].is_selected = false;
                            this.buttons[this.selected_button].render();
                        }
                    }
                } else if (HB.KEYS__ANYCLICK.includes(user_input)) {
                    if (this.top_nav.is_selected) return this.top_nav.selected_button;
                    return this.selected_button;
                }

                // Write the screen updates
                this.renderer.show_image();
            } finally {
                this.renderer.lock.release();
            }
        }
    }
}

/* ---------------------------------- QR (helpers/qr.py + models/encode_qr.py bases) ---------------------------------- */

// Normalizes the page's qrMatrix(text) -> {rows} result to a boolean module grid.
function ssQrModules(data) {
    const qm = ssGet(() => qrMatrix);
    if (!qm) throw new Error("qrMatrix() is not available on this page");
    let text = data;
    if (data instanceof Uint8Array || Array.isArray(data)) {
        // Binary payload (e.g. CompactSeedQR bytes): pass as a latin1 string
        text = Array.from(data, (b) => String.fromCharCode(b)).join("");
    }
    const m = qm(String(text));
    const rows = (m && m.rows) ? m.rows : m;
    return rows.map((row) => {
        const cells = typeof row === "string" ? Array.from(row) : Array.from(row);
        return cells.map((c) => {
            if (typeof c === "string") return c === "1" || c === "#" || c === "X" || c === "x" || c === "█" || c === "*";
            return !!c;
        });
    });
}

class SSQR {
    // QR.qrimage_io(data, width, height, border, background_color): qrencode -s 3 -l L, then resized NEAREST to width x height
    qrimage_io(data, width = 240, height = 240, border = 3, background_color = "808080") {
        if (data && typeof data === "object" && !(data instanceof Uint8Array) && !Array.isArray(data)) {
            ({ data, width = 240, height = 240, border = 3, background_color = "808080" } = data);
        }
        if (!(border >= 1 && border <= 10)) border = 3;
        const modules = ssQrModules(data);
        const n = modules.length;
        const dim = n + 2 * border;
        const img = SSImage.new("RGB", [dim, dim], ssColor(background_color));
        const ctx = img.ctx;
        ctx.fillStyle = "#000000";
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                if (modules[y][x]) ctx.fillRect(x + border, y + border, 1, 1);
            }
        }
        return img.resize([width, height], SSImage.Resampling.NEAREST).convert("RGBA");
    }
    qrimage(data, width = 240, height = 240, border = 3, style = null, background_color = "#444") {
        return this.qrimage_io(data, width, height, border, background_color);
    }
}
SSQR.STYLE__DEFAULT = 1;
SSQR.STYLE__ROUNDED = 2;
SSQR.STYLE__GRID = 3;

// models/encode_qr.py BaseQrEncoder (base class only; concrete encoders are ported with the views)
class SSBaseQrEncoder extends SSDataclass {
    static get _fields() { return { qr_density: "M" }; }
    __post_init__() { this.qr = new SSQR(); }
    get is_complete() { throw new Error("Not implemented in child class"); }
    get qr_max_fragment_size() { throw new Error("Not implemented in child class"); }
    seq_len() { throw new Error("Not implemented in child class"); }
    next_part() { throw new Error("Not implemented in child class"); }
    cur_part() { throw new Error("Not implemented in child class"); }
    restart() { /* only used by animated QR encoders */ }
    _create_parts() { throw new Error("Not implemented in child class"); }
    part_to_image(part, width, height, border = 3, background_color = "ffffff") {
        return this.qr.qrimage_io(part, width, height, border, background_color);
    }
    next_part_image(width = 240, height = 240, border = 3, background_color = "bdbdbd") {
        const part = this.next_part();
        return this.part_to_image(part, width, height, border, background_color);
    }
}

class SSBaseStaticQrEncoder extends SSBaseQrEncoder {
    seq_len() { return 1; }
    // static QRs only have a single part, which `next_part` always returns
    cur_part() { return this.next_part(); }
    get is_complete() { return true; }
}

// SIM convenience: wraps a plain string (static) or an array of part strings (animated) as an encoder.
class SSSimpleQrEncoder extends SSBaseQrEncoder {
    static get _fields() { return { parts: ssFactory(() => []) }; }
    __post_init__() { super.__post_init__(); this._index = -1; }
    get is_complete() { return true; }
    seq_len() { return this.parts.length; }
    next_part() { this._index = (this._index + 1) % this.parts.length; return this.parts[this._index]; }
    cur_part() { return this.parts[Math.max(0, this._index)]; }
    restart() { this._index = -1; }
}

class SSQRDisplayScreen extends SSBaseScreen {
    static get _fields() { return { qr_encoder: null }; }

    __post_init__() {
        super.__post_init__();
        if (typeof this.qr_encoder === "string") this.qr_encoder = new SSSimpleQrEncoder({ parts: [this.qr_encoder] });
        else if (Array.isArray(this.qr_encoder)) this.qr_encoder = new SSSimpleQrEncoder({ parts: this.qr_encoder });

        // Shared coordination var so the display thread can detect success
        this.qr_brightness = new SSThreadsafeCounter(ssSettingGet("qr_background_color", 62));
        this.tips_start_time = new SSThreadsafeCounter(ssTimeNs());

        this.threads.push(new SSQRDisplayScreen.QRDisplayThread({
            qr_encoder: this.qr_encoder,
            qr_brightness: this.qr_brightness,
            tips_start_time: this.tips_start_time,
        }));
    }

    async _run() {
        const HB = SSHardwareButtonsConstants;
        while (true) {
            const user_input = await this.hw_inputs.wait_for([HB.KEY_UP, HB.KEY_DOWN, HB.KEY_LEFT, HB.KEY_RIGHT].concat(HB.KEYS__ANYCLICK));
            if (user_input === HB.KEY_DOWN) {
                // Reduce QR code background brightness
                this.qr_brightness.set_value(Math.max(31, this.qr_brightness.cur_count - 31));
                this.tips_start_time.set_value(ssTimeNs());
            } else if (user_input === HB.KEY_UP) {
                // Increase QR code background brightness
                this.qr_brightness.set_value(Math.min(this.qr_brightness.cur_count + 31, 255));
                this.tips_start_time.set_value(ssTimeNs());
            } else {
                // Any other input exits the screen
                const t = this.threads[this.threads.length - 1];
                t.stop();
                while (t.is_alive()) await ssSleep(0.01);
                break;
            }
        }
        ssSettingSet("qr_background_color", this.qr_brightness.cur_count);
    }
}

SSQRDisplayScreen.QRDisplayThread = class QRDisplayThread extends SSBaseThread {
    constructor({ qr_encoder, qr_brightness, tips_start_time }) {
        super();
        this.qr_encoder = qr_encoder;
        this.qr_brightness = qr_brightness;
        this.renderer = SSRenderer.get_instance();
        this.tips_start_time = tips_start_time;
    }

    render_brightness_tip(image) {
        // Instantiate a temp Image and ImageDraw object to draw on
        const rectangle_width = image.width;
        const rectangle_height = SSGUIConstants.COMPONENT_PADDING * 2 + SSGUIConstants.get_body_font_size() * 2 + SSGUIConstants.BODY_LINE_SPACING;
        const rectangle = SSImage.new("RGBA", [rectangle_width, rectangle_height], [0, 0, 0, 0]);
        const img_draw = SSImageDraw.Draw(rectangle);

        const overlay_opacity = 224;

        // Semi-transparent background for the overlay, rounded edges, w/a 1-pixel gap from the edges
        img_draw.rounded_rectangle([1, 0, rectangle_width - 2, rectangle_height - 1], { radius: 8, fill: [0, 0, 0, overlay_opacity] });

        const chevron_up_icon = new SSIcon({
            image_draw: img_draw,
            canvas: rectangle,
            screen_x: SSGUIConstants.EDGE_PADDING * 2 + 1,
            screen_y: SSGUIConstants.COMPONENT_PADDING + 4,  // +4 fudge factor
            icon_name: SSSeedSignerIconConstants.CHEVRON_UP,
            icon_size: SSGUIConstants.get_body_font_size(),
        });
        chevron_up_icon.render();

        const chevron_down_icon = new SSIcon({
            image_draw: img_draw,
            canvas: rectangle,
            screen_x: chevron_up_icon.screen_x,
            screen_y: chevron_up_icon.screen_y + chevron_up_icon.icon_size + SSGUIConstants.BODY_LINE_SPACING,
            icon_name: SSSeedSignerIconConstants.CHEVRON_DOWN,
            icon_size: chevron_up_icon.icon_size,
        });
        chevron_down_icon.render();

        // TRANSLATOR_NOTE: Increase QR code screen brightness
        new SSTextArea({
            image_draw: img_draw,
            canvas: rectangle,
            text: "Brighter",
            font_size: SSGUIConstants.get_body_font_size(),
            font_name: SSGUIConstants.get_button_font_name(),
            background_color: [0, 0, 0, overlay_opacity],
            edge_padding: 0,
            is_text_centered: false,
            auto_line_break: false,
            width: ssInt(rectangle_width / 2),
            screen_x: chevron_up_icon.screen_x + SSGUIConstants.ICON_INLINE_FONT_SIZE,
            screen_y: chevron_up_icon.screen_y - 2,
        }).render();

        // TRANSLATOR_NOTE: Decrease QR code screen brightness
        new SSTextArea({
            image_draw: img_draw,
            canvas: rectangle,
            text: "Darker",
            font_size: SSGUIConstants.get_body_font_size(),
            font_name: SSGUIConstants.get_button_font_name(),
            background_color: [0, 0, 0, overlay_opacity],
            edge_padding: 0,
            is_text_centered: false,
            auto_line_break: false,
            width: ssInt(rectangle_width / 2),
            screen_x: chevron_down_icon.screen_x + SSGUIConstants.ICON_INLINE_FONT_SIZE,
            screen_y: chevron_down_icon.screen_y - 2,
        }).render();

        // Write our temp Image onto the main image
        image.paste(rectangle, [0, image.height - rectangle_height - 1], rectangle);
    }

    async run() {
        const is_brightness_tip_enabled = ssSettingGet("qr_brightness_tips", "E") === "E";
        let pending_encoder_restart = false;

        // Loop whether the QR is a single frame or animated; each loop might adjust brightness setting.
        while (this.keep_running) {
            // convert the qr_brightness integer (31-255) into hex triplets
            const hex_color = this.qr_brightness.cur_count.toString(16).repeat(3);

            // Display the brightness tips toast
            const duration = 1e9 * 1.2;  // 1.2 seconds
            let image;
            if (is_brightness_tip_enabled && ssTimeNs() - this.tips_start_time.cur_count < duration) {
                image = this.qr_encoder.part_to_image(this.qr_encoder.cur_part(), 240, 240, 2, hex_color);
                this.render_brightness_tip(image);
                pending_encoder_restart = true;
            } else {
                // Only advance the QR animation when the brightness tip is not displayed
                if (pending_encoder_restart) {
                    // Animated QRs should restart their frame sequence after the brightness tip is stowed.
                    this.qr_encoder.restart();
                    pending_encoder_restart = false;
                }
                image = this.qr_encoder.next_part_image(240, 240, 2, hex_color);
            }

            await ssWithLock(this.renderer.lock, () => {
                if (this.keep_running) this.renderer.show_image(image);
            });

            // Target n held frames per second before rendering next QR image
            await ssSleep(5 / 30.0);
        }
    }
};

/* ---------------------------------- Status / warning screens ---------------------------------- */

class SSLargeIconStatusScreen extends SSButtonListScreen {
    static get _fields() {
        return {
            title: "Success!",
            status_icon_name: SSSeedSignerIconConstants.SUCCESS,
            status_icon_size: SSGUIConstants.ICON_PRIMARY_SCREEN_SIZE,
            status_color: SSGUIConstants.SUCCESS_COLOR,
            status_headline: null,
            text: "",                     // The body text of the screen
            text_edge_padding: SSGUIConstants.EDGE_PADDING,
            button_data: null,
        };
    }

    __post_init__() {
        if (!this.button_data) this.button_data = [new SSButtonOption("OK")];
        this.is_bottom_list = true;
        super.__post_init__();

        this.status_icon = new SSIcon({
            icon_name: this.status_icon_name,
            icon_size: this.status_icon_size,
            icon_color: this.status_color,
        });
        this.status_icon.screen_y = this.top_nav.height - ssInt(SSGUIConstants.COMPONENT_PADDING / 2);
        this.status_icon.screen_x = ssInt((this.canvas_width - this.status_icon.width) / 2);
        this.components.push(this.status_icon);

        let next_y = this.status_icon.screen_y + this.status_icon.height + ssInt(SSGUIConstants.COMPONENT_PADDING / 2);
        if (this.status_headline) {
            this.warning_headline_textarea = new SSTextArea({
                text: this.status_headline,
                width: this.canvas_width,
                screen_y: next_y,
                font_color: this.status_color,
                auto_line_break: false,  // Force headline to be on one line
            });
            this.components.push(this.warning_headline_textarea);
            next_y = next_y + this.warning_headline_textarea.height;
        }

        if (this.text) {
            this.components.push(new SSTextArea({
                height: this.buttons[0].screen_y - next_y,
                text: this.text,
                width: this.canvas_width,
                edge_padding: this.text_edge_padding,  // Don't render all the way up to the far left/right edges
                screen_y: next_y,
            }));
        }
    }
}

class SSWarningEdgesThread extends SSBaseThread {
    constructor(args) {
        super();
        if (args && !Array.isArray(args) && args.args) args = args.args;
        this.args = args;
    }

    async run() {
        const screen = this.args[0];
        let inhale_step = 1;
        const inhale_max = 10;
        const inhale_hold = 8;
        let cur_inhale_hold = 0;
        let inhale_factor = 0;
        const rgb = SSImageColor.getrgb(screen.status_color);

        const render_border = (color, width) => {
            screen.image_draw.rectangle([0, 0, screen.canvas_width, screen.canvas_height], { fill: null, outline: color, width });
        };

        while (this.keep_running) {
            await ssWithLock(screen.renderer.lock, () => {
                if (!this.keep_running) return;
                // Ramp the edges from a darker version out to full color
                const inhale_scalar = inhale_factor * ssInt(255 / inhale_max);
                let index = 0;
                for (let n = 4; n >= 0; n--) {
                    // 34 == 0x22; just eyeballed a good step size
                    const r = Math.max(0, rgb[0] - 34 * n - inhale_scalar);
                    const g = Math.max(0, rgb[1] - 34 * n - inhale_scalar);
                    const b = Math.max(0, rgb[2] - 34 * n - inhale_scalar);
                    // `index` shrinks the border at each step
                    render_border([r, g, b], SSGUIConstants.EDGE_PADDING - 2 - index);
                    index++;
                }
                // Write the screen updates
                screen.renderer.show_image();
            });

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
            await ssSleep(0.05);
        }
    }
}

// WarningEdgesMixin: `class SSFooScreen extends SSWarningEdgesMixin(SSButtonListScreen) {...}` (Python MRO order)
const SSWarningEdgesMixin = (Base) => class WarningEdgesMixin extends Base {
    static get _fields() {
        return {
            status_color: SSGUIConstants.WARNING_COLOR,
            text_edge_padding: 2 * SSGUIConstants.EDGE_PADDING,
        };
    }
    __post_init__() {
        super.__post_init__();
        this.threads.push(new SSWarningEdgesThread([this]));
    }
};

// Exclamation point icon + yellow WARNING color
class SSWarningScreen extends SSWarningEdgesMixin(SSLargeIconStatusScreen) {
    static get _fields() {
        return {
            title: "Caution",
            status_icon_name: SSSeedSignerIconConstants.WARNING,
            status_color: SSGUIConstants.WARNING_COLOR,
            status_headline: "Privacy Leak!",     // The colored text under the alert icon
            button_data: ssFactory(() => [new SSButtonOption("I understand")]),
        };
    }
}

// Exclamation point icon + orange DIRE_WARNING color
class SSDireWarningScreen extends SSWarningScreen {
    static get _fields() {
        return {
            status_headline: "Classified Info!",
            status_color: SSGUIConstants.DIRE_WARNING_COLOR,
        };
    }
}

// X icon + red ERROR color
class SSErrorScreen extends SSWarningScreen {
    static get _fields() {
        return {
            title: "Error",
            status_icon_name: SSSeedSignerIconConstants.ERROR,
            status_color: SSGUIConstants.ERROR_COLOR,
        };
    }
}

class SSResetScreen extends SSBaseTopNavScreen {
    __post_init__() {
        this.title = "Restarting";
        this.show_back_button = false;
        super.__post_init__();
        this.components.push(new SSTextArea({
            text: "SeedSigner is restarting.\n\nAll in-memory data will be wiped.",
            screen_y: this.top_nav.height,
            height: this.canvas_height - this.top_nav.height,
        }));
    }
}

class SSPowerOffNotRequiredScreen extends SSBaseTopNavScreen {
    __post_init__() {
        this.title = "Just Unplug It";
        this.show_back_button = true;
        super.__post_init__();
        this.components.push(new SSTextArea({
            text: "It is safe to disconnect power at any time.",
            screen_y: this.top_nav.height,
            height: this.canvas_height - this.top_nav.height,
        }));
    }
}
// The brief's name for the power-off screen; 0.8.7 calls it PowerOffNotRequiredScreen.
const SSPowerOffScreen = SSPowerOffNotRequiredScreen;

/*
 * Generalized Screen for a single Keyboard layout writing user input to a TextEntryDisplay.
 * rows, cols, keyboard_font_name, keyboard_font_size (None = auto-size to Key height), key_height (None = maximize),
 * keys_charset, keys_to_values (e.g. dice icon to digit), return_after_n_chars, show_save_button (KEY3), initial_value
 */
class SSKeyboardScreen extends SSBaseTopNavScreen {
    static get _fields() {
        return {
            rows: null,
            cols: null,
            keyboard_font_name: SSGUIConstants.FIXED_WIDTH_EMPHASIS_FONT_NAME,
            keyboard_font_size: null,
            key_height: null,
            keys_charset: null,
            keys_to_values: null,
            return_after_n_chars: null,
            show_save_button: false,
            initial_value: "",
        };
    }

    __post_init__() {
        if (this.keyboard_font_size === null || this.keyboard_font_size === undefined) {
            this.keyboard_font_size = SSGUIConstants.get_top_nav_title_font_size() + 2;
        }
        super.__post_init__();

        this.user_input = this.initial_value ? this.initial_value : "";

        // Set up the keyboard params
        if (this.show_save_button) {
            const right_panel_buttons_width = 60;
            const hw_button_x = this.canvas_width - right_panel_buttons_width + SSGUIConstants.COMPONENT_PADDING;
            const hw_button_y = ssInt(this.canvas_height - SSGUIConstants.BUTTON_HEIGHT) / 2 + 60;

            this.keyboard_width = this.canvas_width - (SSGUIConstants.EDGE_PADDING + SSGUIConstants.COMPONENT_PADDING + right_panel_buttons_width - SSGUIConstants.COMPONENT_PADDING);

            // Render the right button panel (only has a Key3 "Save" button)
            this.save_button = new SSIconButton({
                icon_name: SSSeedSignerIconConstants.CHECK,
                icon_color: SSGUIConstants.SUCCESS_COLOR,
                width: right_panel_buttons_width,
                screen_x: hw_button_x,
                screen_y: hw_button_y,
            });
            this.components.push(this.save_button);
        } else {
            this.keyboard_width = this.canvas_width - 2 * SSGUIConstants.EDGE_PADDING;
        }

        const text_entry_display_y = this.top_nav.height;
        const text_entry_display_height = 30;

        const keyboard_start_y = text_entry_display_y + text_entry_display_height + SSGUIConstants.COMPONENT_PADDING;
        if (this.key_height === null || this.key_height === undefined) {
            this.key_height = ssInt((this.canvas_height - SSGUIConstants.EDGE_PADDING - text_entry_display_y - text_entry_display_height - SSGUIConstants.COMPONENT_PADDING - (this.rows - 1) * 2) / this.rows);
        }

        let font_size;
        if (this.keyboard_font_size) {
            font_size = this.keyboard_font_size;
        } else {
            // Scale with button height
            font_size = this.key_height - SSGUIConstants.COMPONENT_PADDING;
        }

        this.keyboard = new SSKeyboard({
            draw: this.renderer.draw,
            charset: this.keys_charset,
            font_name: this.keyboard_font_name,
            font_size: font_size,
            rows: this.rows,
            cols: this.cols,
            rect: [
                SSGUIConstants.EDGE_PADDING,
                keyboard_start_y,
                SSGUIConstants.EDGE_PADDING + this.keyboard_width,
                keyboard_start_y + this.rows * this.key_height + (this.rows - 1) * 2,
            ],
            auto_wrap: [SSKeyboard.WRAP_LEFT, SSKeyboard.WRAP_RIGHT],
            render_now: false,
        });
        this.keyboard.set_selected_key(Array.from(this.keys_charset)[0]);

        this.text_entry_display = new SSTextEntryDisplay({
            canvas: this.renderer.canvas,
            rect: [
                SSGUIConstants.EDGE_PADDING,
                text_entry_display_y,
                this.canvas_width - SSGUIConstants.EDGE_PADDING,
                text_entry_display_y + text_entry_display_height,
            ],
            cursor_mode: SSTextEntryDisplay.CURSOR_MODE__BAR,
            is_centered: false,
            cur_text: this.initial_value,
        });
    }

    _render() {
        super._render();
        this.keyboard.render_keys();
        this.text_entry_display.render();
        this.renderer.show_image();
    }

    async _run() {
        const HB = SSHardwareButtonsConstants;
        this.cursor_position = this.user_input.length;

        // Start the interactive update loop
        while (true) {
            let input = await this.hw_inputs.wait_for(HB.KEYS__LEFT_RIGHT_UP_DOWN.concat([HB.KEY_PRESS, HB.KEY3]));

            await this.renderer.lock.acquire();
            try {
                // Track if we need to update the title after input changes
                let title_needs_update = false;

                // Check possible exit conditions
                if (this.top_nav.is_selected && input === HB.KEY_PRESS) {
                    return SS_RET_CODE__BACK_BUTTON;
                } else if (this.show_save_button && input === HB.KEY3) {
                    // Save!
                    if (this.user_input.length === 0) continue;   // Don't try to submit zero input

                    // First show the save button reacting to the click
                    this.save_button.is_selected = true;
                    this.save_button.render();
                    this.renderer.show_image();

                    // Then return the input to the View
                    return this.user_input.trim();
                }

                // Process normal input
                if ([HB.KEY_UP, HB.KEY_DOWN].includes(input) && this.top_nav.is_selected) {
                    // We're navigating off the previous button
                    this.top_nav.is_selected = false;
                    this.top_nav.render_buttons();

                    // Override the actual input w/an ENTER signal for the Keyboard
                    input = input === HB.KEY_DOWN ? SSKeyboard.ENTER_TOP : SSKeyboard.ENTER_BOTTOM;
                } else if ([HB.KEY_LEFT, HB.KEY_RIGHT].includes(input) && this.top_nav.is_selected) {
                    continue;   // ignore
                }

                let ret_val = this.keyboard.update_from_input(input);

                // Now process the result from the keyboard
                if (SSKeyboard.EXIT_DIRECTIONS.includes(ret_val)) {
                    this.top_nav.is_selected = true;
                    this.top_nav.render_buttons();
                } else if (SSKeyboard.is_additional_key_code(ret_val) && input === HB.KEY_PRESS) {
                    if (ret_val === SSKeyboard.KEY_BACKSPACE.code) {
                        if (this.user_input.length > 0) {
                            this.user_input = this.user_input.slice(0, -1);
                            this.cursor_position -= 1;
                            title_needs_update = true;
                        }
                    }
                } else if (input === HB.KEY_PRESS && !SSKeyboard.is_additional_key_code(ret_val)) {
                    // User has locked in the current letter
                    if (this.keys_to_values) {
                        // Map the Key display char to its output value (e.g. dice icon to digit)
                        ret_val = this.keys_to_values[ret_val];
                    }
                    this.user_input += ret_val;
                    this.cursor_position += 1;
                    title_needs_update = true;

                    if (this.cursor_position === this.return_after_n_chars) return this.user_input;
                }

                // Update the title if input changed (add or delete)
                if (title_needs_update && this.update_title()) {
                    new SSTextArea({
                        text: this.title,
                        font_name: SSGUIConstants.get_top_nav_title_font_name(),
                        font_size: SSGUIConstants.get_top_nav_title_font_size(),
                        height: this.top_nav.height,
                    }).render();
                    this.top_nav.render_buttons();
                } else if (HB.KEYS__LEFT_RIGHT_UP_DOWN.includes(input)) {
                    // Live joystick movement; haven't locked this new letter in yet.
                }

                // Render the text entry display and cursor block
                this.text_entry_display.render(this.user_input);
                this.renderer.show_image();
            } finally {
                this.renderer.lock.release();
            }
        }
    }

    // Optionally update the self.title after each completed key input (e.g. to increment the dice roll count).
    update_title() { return false; }
}

class SSMainMenuScreen extends SSLargeButtonScreen {
    static get _fields() {
        return {
            // Override LargeButtonScreen defaults
            title_font_size: 26,
            show_back_button: false,
            show_power_button: true,
        };
    }
}

/* =====================================================================================================
 * gui/toast.py
 * ===================================================================================================== */

class SSToastOverlay extends SSBaseComponent {
    static get _fields() {
        return {
            icon_name: null,
            color: SSGUIConstants.NOTIFICATION_COLOR,
            font_color: SSGUIConstants.NOTIFICATION_COLOR,
            label_text: null,
            height: SSGUIConstants.ICON_TOAST_FONT_SIZE + 2 * SSGUIConstants.EDGE_PADDING,
            font_size: 19,
            outline_thickness: 2,  // pixels
        };
    }

    __post_init__() {
        super.__post_init__();

        let icon_delta_x = 0;
        if (this.icon_name) {
            this.icon = new SSIcon({
                image_draw: this.image_draw,
                canvas: this.canvas,
                screen_x: this.outline_thickness + SSGUIConstants.EDGE_PADDING,  // Push the icon further from the left edge
                icon_name: this.icon_name,
                icon_size: SSGUIConstants.ICON_TOAST_FONT_SIZE,
                icon_color: this.color,
            });
            icon_delta_x = this.icon.width + this.icon.screen_x;
        }

        this.label = new SSTextArea({
            image_draw: this.image_draw,
            canvas: this.canvas,
            text: this.label_text,
            font_size: this.font_size,
            font_color: this.font_color,
            edge_padding: 0,
            is_text_centered: false,
            auto_line_break: true,
            width: this.canvas_width - icon_delta_x - 2 * SSGUIConstants.COMPONENT_PADDING - 2 * this.outline_thickness,
            screen_x: icon_delta_x + SSGUIConstants.COMPONENT_PADDING,
            height_ignores_below_baseline: true,
        });

        if (this.label.height > SSGUIConstants.ICON_FONT_SIZE) {
            this.height = this.label.height + SSGUIConstants.EDGE_PADDING * 2;
        }

        // Vertically center the message and icon within the toast (for single- or multi-line messages).
        this.label.screen_y = this.canvas_height - this.height + this.outline_thickness + ssInt((this.height - 2 * this.outline_thickness - this.label.height) / 2);

        if (this.icon_name) {
            this.icon.screen_y = this.canvas_height - this.height + ssInt((this.height - this.icon.height) / 2);
        }
    }

    render() {
        // Render the toast's solid background
        this.image_draw.rounded_rectangle(
            [0, this.canvas_height - this.height, this.canvas_width, this.canvas_height],
            { fill: SSGUIConstants.BACKGROUND_COLOR, radius: 8, outline: this.color, width: this.outline_thickness }
        );
        // Draw the toast visual elements
        if (this.icon_name) this.icon.render();
        this.label.render();
        this.renderer.show_image();
    }
}

/*
 * The toast notification popup: a gui component (ToastOverlay) plus this manager thread that the Controller uses to
 * coordinate the Renderer.lock between competing toasts, the screensaver, and the current underlying Screen.
 */
class SSBaseToastOverlayManagerThread extends SSBaseThread {
    constructor(opts = {}) {
        super();
        const { activation_delay = 0, duration = 3 } = opts || {};
        // Subclass attrs that Python sets before super().__init__() (e.g. label_text, message) arrive in opts
        for (const k of Object.keys(opts || {})) {
            if (k !== "activation_delay" && k !== "duration" && opts[k] !== undefined) this[k] = opts[k];
        }
        this.activation_delay = activation_delay;  // seconds before toast is displayed
        this.duration = duration;                  // seconds toast is displayed
        this._toggle_renderer_lock = false;

        this.renderer = SSRenderer.get_instance();
        this.controller = SSController.get_instance();
        this.hw_inputs = SSHardwareButtons.get_instance();

        // Special case when screensaver is running
        this.hw_inputs.override_ind = true;

        this.toast = this.instantiate_toast();
    }

    instantiate_toast() { throw new Error("Must be implemented by subclass"); }

    // Placeholder for custom exit conditions
    should_keep_running() { return true; }

    toggle_renderer_lock() { this._toggle_renderer_lock = true; }

    async run() {
        const start = ssTime();
        while (ssTime() - start < this.activation_delay) {
            if (this.hw_inputs.has_any_input()) {
                // User has pressed a button, cancel the toast
                return;
            }
            await ssSleep(0.1);
        }

        let has_rendered = false;
        let previous_screen_state = null;
        // Hold onto the Renderer lock so we're guaranteed to restore the original screen before any other
        // listener can get a screen write in.
        await this.renderer.lock.acquire();
        try {
            while (this.keep_running && this.should_keep_running()) {
                if (this.hw_inputs.has_any_input()) break;   // User has pressed a button, hide the toast

                if (this._toggle_renderer_lock) {
                    // Controller has notified us that another process needs the lock
                    this._toggle_renderer_lock = false;
                    this.renderer.lock.release();
                    // pause to avoid race conditions reacquiring the lock
                    while (!this.renderer.lock.locked()) await ssSleep(0.1);
                    // Block while waiting to reacquire the lock
                    await this.renderer.lock.acquire();
                }

                if (!has_rendered) {
                    previous_screen_state = this.renderer.canvas.copy();
                    this.toast.render();
                    has_rendered = true;
                }

                if (ssTime() - start > this.activation_delay + this.duration && has_rendered) break;

                // Free up cpu resources for main thread
                await ssSleep(0.1);
            }
        } finally {
            // (SIM: not when the page has stopped the device while the toast showed: its screen is gone)
            if (has_rendered && this.renderer.lock.locked() && this.renderer.canvas) {
                // As far as we know, we currently hold the Renderer.lock
                this.renderer.show_image(previous_screen_state);
            }
            // We're done, release the lock
            this.renderer.lock.release();
        }
    }
}

class SSRemoveSDCardToastManagerThread extends SSBaseToastOverlayManagerThread {
    constructor(opts = {}) {
        const { activation_delay = 3, duration = 5 } = opts || {};
        super({ activation_delay, duration });
    }

    instantiate_toast() {
        const body_font_size = SSGUIConstants.get_body_font_size();
        return new SSToastOverlay({
            icon_name: SSSeedSignerIconConstants.MICROSD,
            label_text: "You can remove\nthe SD card now",
            font_size: body_font_size,
            height: body_font_size * 2 + SSGUIConstants.BODY_LINE_SPACING + SSGUIConstants.EDGE_PADDING,
        });
    }

    // Custom exit condition: keep running until the SD card is removed
    should_keep_running() { return SSMicroSD.get_instance().is_inserted; }
}

class SSSDCardStateChangeToastManagerThread extends SSBaseToastOverlayManagerThread {
    // new SSSDCardStateChangeToastManagerThread({action, activation_delay, duration})
    constructor(opts = {}) {
        if (typeof opts === "string") opts = { action: opts };
        const action = opts.action;
        if (![SSMicroSD.ACTION__INSERTED, SSMicroSD.ACTION__REMOVED].includes(action)) throw new Error(`Invalid MicroSD action: ${action}`);
        const message = action === SSMicroSD.ACTION__REMOVED ? "SD card removed" : "SD card inserted";
        super(Object.assign({}, opts, { message }));
    }

    instantiate_toast() {
        return new SSToastOverlay({
            icon_name: SSSeedSignerIconConstants.MICROSD,
            label_text: this.message,
        });
    }
}

/* Messaging toasts: new SSDefaultToast({label_text, activation_delay, duration}) or ("text") */
class SSDefaultToast extends SSBaseToastOverlayManagerThread {
    constructor(label_text = "This is a notification toast", activation_delay = 0, duration = 3) {
        let o = label_text;
        if (!(o && typeof o === "object")) o = { label_text, activation_delay, duration };
        super({
            label_text: o.label_text === undefined ? "This is a notification toast" : o.label_text,
            activation_delay: o.activation_delay === undefined ? 0 : o.activation_delay,
            duration: o.duration === undefined ? 3 : o.duration,
        });
    }

    instantiate_toast() {
        const body_font_size = SSGUIConstants.get_body_font_size();
        return new SSToastOverlay({
            label_text: this.label_text,
            color: SSGUIConstants.BODY_FONT_COLOR,
            font_color: SSGUIConstants.BODY_FONT_COLOR,
            font_size: body_font_size,
        });
    }
}

class SSInfoToast extends SSDefaultToast {
    instantiate_toast() {
        return new SSToastOverlay({
            icon_name: SSSeedSignerIconConstants.INFO, label_text: this.label_text, color: SSGUIConstants.INFO_COLOR,
            font_color: SSGUIConstants.BODY_FONT_COLOR, font_size: SSGUIConstants.get_body_font_size(),
        });
    }
}

class SSSuccessToast extends SSDefaultToast {
    instantiate_toast() {
        return new SSToastOverlay({
            icon_name: SSSeedSignerIconConstants.SUCCESS, label_text: this.label_text, color: SSGUIConstants.SUCCESS_COLOR,
            font_color: SSGUIConstants.BODY_FONT_COLOR, font_size: SSGUIConstants.get_body_font_size(),
        });
    }
}

class SSWarningToast extends SSDefaultToast {
    instantiate_toast() {
        return new SSToastOverlay({
            icon_name: SSSeedSignerIconConstants.WARNING, label_text: this.label_text, color: SSGUIConstants.WARNING_COLOR,
            font_color: SSGUIConstants.BODY_FONT_COLOR, font_size: SSGUIConstants.get_body_font_size(),
        });
    }
}

class SSDireWarningToast extends SSDefaultToast {
    instantiate_toast() {
        return new SSToastOverlay({
            icon_name: SSSeedSignerIconConstants.WARNING, label_text: this.label_text, color: SSGUIConstants.DIRE_WARNING_COLOR,
            font_color: SSGUIConstants.BODY_FONT_COLOR, font_size: SSGUIConstants.get_body_font_size(),
        });
    }
}

class SSErrorToast extends SSDefaultToast {
    instantiate_toast() {
        return new SSToastOverlay({
            icon_name: SSSeedSignerIconConstants.ERROR, label_text: this.label_text, color: SSGUIConstants.ERROR_COLOR,
            font_color: SSGUIConstants.BODY_FONT_COLOR, font_size: SSGUIConstants.get_body_font_size(),
        });
    }
}

/* =====================================================================================================
 * views/view.py
 * ===================================================================================================== */

// Empty class that just signals to the Controller to pop the most recent View off the back_stack.
class SSBackStackView {}

/*
 * Views contain the biz logic for each page. `async run()` returns an SSDestination.
 * Dataclass views: `static get _fields()` + `__post_init__()` (call super.__post_init__() first, like the Python).
 * Python views with `__init__(self, a, b)`: declare a/b in `_fields` and port the __init__ body into __post_init__().
 */
class SSView extends SSDataclass {
    _initialize() {
        this.controller = SSController.get_instance();
        this.settings = ssGet(() => SSSettings) ? SSSettings.get_instance() : null;

        this.renderer = SSRenderer.get_instance();
        this.canvas_width = this.renderer.canvas_width;
        this.canvas_height = this.renderer.canvas_height;

        this.screen = null;
        this._redirect = null;
        this.is_screensaver_allowed = true;
    }

    __post_init__() { this._initialize(); }

    get has_redirect() {
        if (!("_redirect" in this)) throw new Error(`${this.constructor.name} did not call super().__init__()`);
        return this._redirect !== null && this._redirect !== undefined;
    }

    // Set a redirect Destination in __post_init__ and return; Destination.run() will return it without running run().
    set_redirect(destination) {
        destination.skip_current_view = true;
        this._redirect = destination;
    }

    get_redirect() { return this._redirect; }

    // Instantiates the provided Screen_cls and runs its interactive display. Returns the user's input upon completion.
    async run_screen(Screen_cls, kwargs = {}) {
        this.screen = new Screen_cls(kwargs);
        return await this.screen.display();
    }

    async run() { throw new Error("Must implement in the child class"); }
}

// Destination(View_cls, view_args=None, skip_current_view=False, clear_history=False)
class SSDestination {
    constructor(View_cls, opts = {}) {
        this.View_cls = View_cls === undefined ? null : View_cls;
        const o = opts || {};
        this.view_args = o.view_args === undefined ? null : o.view_args;
        this.skip_current_view = !!o.skip_current_view;
        this.clear_history = !!o.clear_history;
        this.view = null;
    }

    toString() {
        let out = this.View_cls === null ? "None" : this.View_cls.name;
        if (this.view_args) {
            let a;
            try { a = JSON.stringify(this.view_args); } catch (e) { a = "{...}"; }
            out += `(${a})`;
        } else {
            out += "()";
        }
        if (this.clear_history) out += ` | clear_history: ${this.clear_history}`;
        return out;
    }

    _instantiate_view() {
        if (!this.view_args) this.view_args = {};
        this.view = new this.View_cls(this.view_args);
    }

    async _run_view() {
        if (this.view.has_redirect) return this.view.get_redirect();
        return await this.view.run();
    }

    async run() {
        this._instantiate_view();
        return await this._run_view();
    }

    // Equality test IGNORES the skip_current_view and clear_history options
    equals(obj) {
        return obj instanceof SSDestination && obj.View_cls === this.View_cls && ssEq(obj.view_args || null, this.view_args || null);
    }
}

// Resolves a view class from another part; falls back to NotYetImplementedView if that part is not loaded.
function _ssView(getter) { return ssGet(getter) || SSNotYetImplementedView; }

class SSMainMenuView extends SSView {
    async run() {
        const button_data = [SSMainMenuView.SCAN, SSMainMenuView.SEEDS, SSMainMenuView.TOOLS, SSMainMenuView.SETTINGS];
        const selected_menu_num = await this.run_screen(SSMainMenuScreen, {
            title: "Home",
            button_data: button_data,
        });

        if (selected_menu_num === SS_RET_CODE__POWER_BUTTON) return new SSDestination(SSPowerOptionsView);

        if (ssEq(button_data[selected_menu_num], SSMainMenuView.SCAN)) {
            return new SSDestination(_ssView(() => SSScanView));
        } else if (ssEq(button_data[selected_menu_num], SSMainMenuView.SEEDS)) {
            return new SSDestination(_ssView(() => SSSeedsMenuView));
        } else if (ssEq(button_data[selected_menu_num], SSMainMenuView.TOOLS)) {
            return new SSDestination(_ssView(() => SSToolsMenuView));
        } else if (ssEq(button_data[selected_menu_num], SSMainMenuView.SETTINGS)) {
            return new SSDestination(_ssView(() => SSSettingsMenuView));
        }
    }
}
SSMainMenuView.SCAN = new SSButtonOption("Scan", SSSeedSignerIconConstants.SCAN);
SSMainMenuView.SEEDS = new SSButtonOption("Seeds", SSSeedSignerIconConstants.SEEDS);
SSMainMenuView.TOOLS = new SSButtonOption("Tools", SSSeedSignerIconConstants.TOOLS);
SSMainMenuView.SETTINGS = new SSButtonOption("Settings", SSSeedSignerIconConstants.SETTINGS);

class SSPowerOptionsView extends SSView {
    async run() {
        const button_data = [SSPowerOptionsView.RESET, SSPowerOptionsView.POWER_OFF];
        const selected_menu_num = await this.run_screen(SSLargeButtonScreen, {
            title: "Reset / Power",
            show_back_button: true,
            button_data: button_data,
        });

        if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) {
            return new SSDestination(SSBackStackView);
        } else if (ssEq(button_data[selected_menu_num], SSPowerOptionsView.RESET)) {
            return new SSDestination(SSRestartView);
        } else if (ssEq(button_data[selected_menu_num], SSPowerOptionsView.POWER_OFF)) {
            return new SSDestination(SSPowerOffView);
        }
    }
}
SSPowerOptionsView.RESET = new SSButtonOption("Restart", SSSeedSignerIconConstants.RESTART);
SSPowerOptionsView.POWER_OFF = new SSButtonOption("Power off", SSSeedSignerIconConstants.POWER);

class SSRestartView extends SSView {
    async run() {
        if (!this.renderer.is_screenshot_generator) {
            new SSRestartView.DoResetThread().start();
        }
        await this.run_screen(SSResetScreen);
    }
}
SSRestartView.DoResetThread = class DoResetThread extends SSBaseThread {
    async run() {
        // Give the screen just enough time to display the reset message before exiting.
        await ssSleep(0.25);
        // SIM: os.execv() re-executes the process; here the app restarts from the splash with in-memory data wiped.
        SSController._restart();
    }
};

class SSPowerOffView extends SSView {
    async run() {
        await this.run_screen(SSPowerOffNotRequiredScreen);
        return new SSDestination(SSBackStackView);
    }
}

// Temporary View to use during dev.
class SSNotYetImplementedView extends SSView {
    static get _fields() { return { text: "This is still on our to-do list!" }; }

    async run() {
        await this.run_screen(SSWarningScreen, {
            title: "Work In Progress",
            status_headline: "Not Yet Implemented",
            text: this.text,
            button_data: [new SSButtonOption("Back to main menu")],
        });
        return new SSDestination(SSMainMenuView);
    }
}

class SSErrorView extends SSView {
    static get _fields() {
        return {
            title: "Error",
            show_back_button: true,
            status_icon_name: SSSeedSignerIconConstants.ERROR,
            status_headline: null,
            text: null,
            button_text: null,
            next_destination: null,
        };
    }

    async run() {
        await this.run_screen(SSErrorScreen, {
            title: this.title,
            status_icon_name: this.status_icon_name,
            status_headline: this.status_headline,
            text: this.text,
            button_data: [new SSButtonOption(this.button_text)],
            show_back_button: this.show_back_button,
        });
        return this.next_destination ? this.next_destination : new SSDestination(SSMainMenuView, { clear_history: true });
    }
}

class SSNetworkMismatchErrorView extends SSErrorView {
    static get _fields() { return { derivation_path: null }; }

    __post_init__() {
        // TRANSLATOR_NOTE: The network setting (mainnet/testnet/regtest) doesn't match the provided derivation path
        this.title = "Network Mismatch";
        this.status_icon_name = SSSeedSignerIconConstants.WARNING;
        this.show_back_button = false;
        // TRANSLATOR_NOTE: Button option to alter a setting
        this.button_text = "Change Setting";
        this.next_destination = new SSDestination(_ssView(() => SSSettingsEntryUpdateSelectionView), { view_args: { attr_name: "network" }, clear_history: true });
        super.__post_init__();

        let network = "mainnet";
        try { network = this.settings.get_value_display_name("network"); } catch (e) { /* settings part not loaded */ }

        // TRANSLATOR_NOTE: "network" will be mainnet/testnet/regtest.
        this.text = `Current network setting (${network}) doesn't match ${this.derivation_path}.`;
    }
}

class SSUnhandledExceptionView extends SSView {
    static get _fields() { return { error: undefined }; }

    __post_init__() {
        super.__post_init__();
        // Camera errors bubble up to here. Reroute to their custom error View.
        if (this.error[0] === "CameraConnectionError") {
            this.set_redirect(new SSDestination(SSCameraConnectionErrorView, { skip_current_view: true }));
        }
    }

    async run() {
        await this.run_screen(SSErrorScreen, {
            title: "System Error",
            status_headline: this.error[0],
            text: this.error[1] + "\n" + this.error[2],
            button_data: [new SSButtonOption("Back to Main Menu")],
        });
        return new SSDestination(SSMainMenuView, { clear_history: true });
    }
}

class SSCameraConnectionErrorView extends SSView {
    async run() {
        await this.run_screen(SSErrorScreen, {
            title: "Hardware Error",
            status_headline: "Cannot access camera",
            text: "Disconnect power and check for a loose camera connection.",
            button_data: [new SSButtonOption("Back to Main Menu")],
            show_back_button: false,
        });
        return new SSDestination(SSMainMenuView, { clear_history: true });
    }
}

class SSOptionDisabledView extends SSView {
    static get _fields() { return { settings_attr: undefined }; }

    __post_init__() {
        super.__post_init__();
        let display_name = this.settings_attr;
        const SD = ssGet(() => SSSettingsDefinition);
        if (SD) {
            this.settings_entry = SD.get_settings_entry(this.settings_attr);
            display_name = this.settings_entry.display_name;
        }
        // TRANSLATOR_NOTE: Inserts the name of a settings option (e.g. "Persistent Settings" is currently...)
        this.error_msg = `"${display_name}" is currently disabled in Settings.`;
    }

    async run() {
        const button_data = [SSOptionDisabledView.UPDATE_SETTING, SSOptionDisabledView.DONE];
        const selected_menu_num = await this.run_screen(SSWarningScreen, {
            title: "Option Disabled",
            status_headline: null,
            text: this.error_msg,
            button_data: button_data,
            show_back_button: false,
        });

        if (ssEq(button_data[selected_menu_num], SSOptionDisabledView.UPDATE_SETTING)) {
            return new SSDestination(_ssView(() => SSSettingsEntryUpdateSelectionView), { view_args: { attr_name: this.settings_attr }, clear_history: true });
        } else {
            return new SSDestination(SSMainMenuView, { clear_history: true });
        }
    }
}
SSOptionDisabledView.UPDATE_SETTING = new SSButtonOption("Update setting");
SSOptionDisabledView.DONE = new SSButtonOption("Back to Main Menu");

class SSRemoveMicroSDWarningView extends SSView {
    async run() {
        const button_data = [SSRemoveMicroSDWarningView.CONTINUE, SSRemoveMicroSDWarningView.SETTINGS];
        const selected_menu_num = await this.run_screen(SSWarningScreen, {
            title: "Action Required",
            status_icon_name: SSSeedSignerIconConstants.MICROSD,
            status_headline: null,
            text: "You must remove the\nMicroSD card to continue.",
            show_back_button: false,
            button_data: button_data,
        });

        if (ssEq(button_data[selected_menu_num], SSRemoveMicroSDWarningView.CONTINUE)) {
            if (!SSMicroSD.get_instance().is_inserted) {
                return new SSDestination(SSMainMenuView, { clear_history: true });
            } else {
                return new SSDestination(SSRemoveMicroSDWarningView, { clear_history: true });
            }
        } else if (ssEq(button_data[selected_menu_num], SSRemoveMicroSDWarningView.SETTINGS)) {
            return new SSDestination(_ssView(() => SSSettingsEntryUpdateSelectionView), {
                view_args: {
                    attr_name: "microsd_toast_timer",
                    blocking_view: SSRemoveMicroSDWarningView,
                    unblocking_view: SSMainMenuView,
                },
            });
        }
    }
}
SSRemoveMicroSDWarningView.CONTINUE = new SSButtonOption("Continue");
SSRemoveMicroSDWarningView.SETTINGS = new SSButtonOption("Settings");

/* =====================================================================================================
 * views/screensaver.py
 * ===================================================================================================== */

class SSLogoScreen extends SSBaseScreen {
    __post_init__() {
        super.__post_init__();
        this.logo = ssLoadImage("logo_black_240.png");
        // SIM (VOIDFORGE): SeedSigner lists ["hrf"] here; the third-party partner logo is not bundled, so there are none.
        this.partners = [];
        this.partner_logos = {};
        for (const partner of this.partners) {
            this.partner_logos[partner] = ssLoadImage(`partners/${partner}_logo.png`);
        }
    }

    async _run() {}

    get_random_partner() { return this.partners[Math.floor(ssRandom() * this.partners.length)]; }
}

class SSOpeningSplashView extends SSView {
    static get _fields() { return { force_partner_logos: null }; }

    async run() {
        await this.run_screen(SSOpeningSplashScreen, { force_partner_logos: this.force_partner_logos });
    }
}

class SSOpeningSplashScreen extends SSLogoScreen {
    static get _fields() { return { force_partner_logos: null }; }

    async _render() {
        const controller = SSController.get_instance();
        this.clear_screen();

        let show_partner_logos = ssSettingGet("partner_logos", "E") === "E";
        if (this.force_partner_logos !== null && this.force_partner_logos !== undefined) show_partner_logos = this.force_partner_logos;
        // SIM (VOIDFORGE): the partner part ("With support from:" and the partner logo, which moves the SeedSigner logo up
        // 56 px) is skipped even when the "Show partner logos" setting is on: the third-party logo is not in this file.
        if (this.partners.length === 0) show_partner_logos = false;

        const logo_offset_x = ssInt((this.canvas_width - this.logo.width) / 2);
        const logo_offset_y = show_partner_logos ? -56 : 0;

        const background = SSImage.new("RGBA", this.logo.size, "black");
        if (!this.renderer.is_screenshot_generator) {
            // Fade in alpha
            for (let i = 250; i > -1; i -= 25) {
                this.logo.putalpha(255 - i);
                this.renderer.canvas.paste(SSImage.alpha_composite(background, this.logo), [logo_offset_x, logo_offset_y]);
                this.renderer.show_image();
                // SIM: on the device each frame is paced by the SPI display write
                await ssSleep(0.03);
            }
        } else {
            this.renderer.canvas.paste(this.logo, [logo_offset_x, logo_offset_y]);
        }

        // Display version num below SeedSigner logo
        const font = SSFonts.get_font(SSGUIConstants.get_body_font_name(), SSGUIConstants.get_top_nav_title_font_size());
        const version = `v${SSController.VERSION}`;

        // The logo png is 240x240, but the actual logo is 70px tall, vertically centered
        const logo_height = 70;
        const version_x = ssInt(this.renderer.canvas_width / 2);
        const version_y = ssInt(this.canvas_height / 2) + ssInt(logo_height / 2) + logo_offset_y + SSGUIConstants.COMPONENT_PADDING;
        this.renderer.draw.text([version_x, version_y], version, { font, fill: SSGUIConstants.ACCENT_COLOR, anchor: "mt" });

        if (!this.renderer.is_screenshot_generator) this.renderer.show_image();

        if (show_partner_logos) {
            // Hold on the version num for a moment
            if (!this.renderer.is_screenshot_generator) await ssSleep(1);

            // Set up the partner logo
            const partner_logo = this.partner_logos[this.get_random_partner()];
            const sfont = SSFonts.get_font(SSGUIConstants.get_top_nav_title_font_name(), SSGUIConstants.get_body_font_size());
            // TRANSLATOR_NOTE: This is on the opening splash screen, displayed above the HRF logo
            const sponsor_text = "With support from:";
            const [left, top, tw, th] = sfont.getbbox(sponsor_text, { anchor: "lt" });

            const x = ssInt(this.renderer.canvas_width / 2);
            const y = this.canvas_height - SSGUIConstants.COMPONENT_PADDING - partner_logo.height - ssInt(SSGUIConstants.COMPONENT_PADDING / 2) - th;
            this.renderer.draw.text([x, y], sponsor_text, { font: sfont, fill: "#ccc", anchor: "mt" });
            this.renderer.canvas.paste(partner_logo, [ssInt((this.renderer.canvas_width - partner_logo.width) / 2), y + th + ssInt(SSGUIConstants.COMPONENT_PADDING / 2)]);

            this.renderer.show_image();
        }

        // Hold on the splash screen for a moment
        if (!this.renderer.is_screenshot_generator) await ssSleep(2);
    }
}

class SSScreensaverScreen extends SSLogoScreen {
    static get _fields() { return { buttons: null }; }

    __post_init__() {
        super.__post_init__();
        // Paste the logo in a bigger image that is the canvas + the logo dims (half the logo will render off the
        // canvas at each edge).
        this.image = SSImage.new("RGB", [this.renderer.canvas_width + this.logo.width, this.renderer.canvas_height + this.logo.height], [0, 0, 0]);

        // Place the logo centered on the larger image
        const logo_x = ssInt((this.image.width - this.logo.width) / 2);
        const logo_y = ssInt((this.image.height - this.logo.height) / 2);
        this.image.paste(this.logo, [logo_x, logo_y]);

        this.min_coords = [0, 0];
        this.max_coords = [this.renderer.canvas_width, this.renderer.canvas_height];

        // Update our first rendering position so we're centered
        this.cur_x = ssInt(this.logo.width / 2);
        this.cur_y = ssInt(this.logo.height / 2);

        this.increment_x = this.rand_increment();
        this.increment_y = this.rand_increment();

        this._is_running = false;
        this.last_screen = null;
    }

    get is_running() { return this._is_running; }

    rand_increment() {
        const max_increment = 10.0, min_increment = 1.0;
        const increment = min_increment + ssRandom() * (max_increment - min_increment);
        if (ssRandom() * 2 - 1 < 0.0) return -1.0 * increment;
        return increment;
    }

    async start() {
        if (this.is_running) return;
        this._is_running = true;

        // Store the current screen in order to restore it later
        this.last_screen = this.renderer.canvas.copy();

        // Screensaver must block any attempts to use the Renderer in another thread so it never gives up the lock
        // until it returns.
        await this.renderer.lock.acquire();
        try {
            while (this._is_running) {
                if (this.buttons.has_any_input() || this.buttons.override_ind) break;

                // Must crop the image to the exact display size
                const crop = this.image.crop([this.cur_x, this.cur_y, this.cur_x + this.renderer.canvas_width, this.cur_y + this.renderer.canvas_height]);
                this.renderer.disp.show_image(crop, 0, 0);

                this.cur_x += this.increment_x;
                this.cur_y += this.increment_y;

                // At each edge bump, calculate a new random rate of change for that axis
                if (this.cur_x < this.min_coords[0]) {
                    this.cur_x = this.min_coords[0];
                    this.increment_x = this.rand_increment();
                    if (this.increment_x < 0.0) this.increment_x *= -1.0;
                } else if (this.cur_x > this.max_coords[0]) {
                    this.cur_x = this.max_coords[0];
                    this.increment_x = this.rand_increment();
                    if (this.increment_x > 0.0) this.increment_x *= -1.0;
                }
                if (this.cur_y < this.min_coords[1]) {
                    this.cur_y = this.min_coords[1];
                    this.increment_y = this.rand_increment();
                    if (this.increment_y < 0.0) this.increment_y *= -1.0;
                } else if (this.cur_y > this.max_coords[1]) {
                    this.cur_y = this.max_coords[1];
                    this.increment_y = this.rand_increment();
                    if (this.increment_y > 0.0) this.increment_y *= -1.0;
                }
                // SIM: frame pacing of the SPI display (~30 fps)
                await ssSleep(1 / 30);
            }
        } finally {
            this._is_running = false;
            // Restore the original screen
            this.renderer.show_image(this.last_screen);
            this.renderer.lock.release();
        }
    }

    stop() { this._is_running = false; }
}

/* =====================================================================================================
 * controller.py
 * ===================================================================================================== */

class SSBackStack extends Array {
    toString() {
        if (this.length === 0) return "[]";
        let out = "[\n";
        for (let index = this.length - 1; index >= 0; index--) out += `    ${String(index).padStart(2)}: ${this[index]}\n`;
        return out + "]";
    }
}

/*
 * The Controller is a globally available singleton that maintains SeedSigner state.
 * Page API:  await SSController.start(canvasElement[, {initial_destination, skip_splash, scale}])
 *            SSController.press(keyName)          // "KEY_UP" ... "KEY3" (also "UP", "PRESS", "1", ...)
 */
class SSController {
    static get_instance() {
        if (SSController._instance) return SSController._instance;
        return SSController.configure_instance();
    }

    static reset_instance() {
        SSController._instance = null;
        SSController.configure_instance();
    }

    static configure_instance() {
        if (SSController._instance) throw new Error("Instance already configured");
        const controller = Object.create(SSController.prototype);
        SSController._instance = controller;

        controller.settings = ssGet(() => SSSettings) ? SSSettings.get_instance() : null;
        controller.microsd = SSMicroSD.get_instance();
        controller.microsd.start_detection();

        controller._storage = null;
        controller.psbt = null;
        controller.psbt_seed = null;
        controller.psbt_parser = null;
        controller.unverified_address = null;
        controller.multisig_wallet_descriptor = null;
        controller.image_entropy_preview_frames = null;
        controller.image_entropy_final_image = null;
        controller.address_explorer_data = null;
        controller.sign_message_data = null;
        controller.resume_main_flow = null;
        controller.screensaver = null;
        controller.toast_notification_thread = null;

        controller.back_stack = new SSBackStack();

        // Other behavior constants
        controller.screensaver_activation_ms = 2 * 60 * 1000;  // two minutes
        return controller;
    }

    // In-memory seed storage (models/seed_storage.py port lives in another part)
    get storage() {
        if (!this._storage) {
            const SS = ssGet(() => SSSeedStorage);
            this._storage = SS ? new SS() : { seeds: [], pending_seed: null };
        }
        return this._storage;
    }

    get_seed(seed_num) {
        if (seed_num < this.storage.seeds.length) return this.storage.seeds[seed_num];
        throw new Error(`There is no seed_num ${seed_num}; only ${this.storage.seeds.length} in memory.`);
    }

    discard_seed(seed_num) {
        if (seed_num < this.storage.seeds.length) this.storage.seeds.splice(seed_num, 1);
        else throw new Error(`There is no seed_num ${seed_num}; only ${this.storage.seeds.length} in memory.`);
    }

    pop_prev_from_back_stack() {
        if (this.back_stack.length > 0) {
            // Pop the top View (which is the current View_cls)
            this.back_stack.pop();
            if (this.back_stack.length > 0) {
                // One more pop back gives us the actual "back" View_cls
                return this.back_stack.pop();
            }
        }
        return new SSDestination(null);
    }

    clear_back_stack() { this.back_stack = new SSBackStack(); }

    // The main loop of the application (Python Controller.start(initial_destination=None)).
    async start(initial_destination = null, _opts = {}) {
        const gen = SS_GEN;   // SIM: the page stops (or restarts) the device by bumping SS_GEN; this loop then ends
        if (!_opts.skip_splash) await new SSOpeningSplashView().run();

        try {
            let next_destination = initial_destination ? initial_destination : new SSDestination(SSMainMenuView);

            // Set up our one-time toast notification tip to remove the SD card
            const timer = ssSettingGet("microsd_toast_timer", "E");
            if (timer === "E") {
                this.activate_toast(new SSRemoveSDCardToastManagerThread());
            } else if (timer === "inf") {
                next_destination = new SSDestination(SSRemoveMicroSDWarningView);
            }

            while (true) {
                if (gen !== SS_GEN) throw new SSAbort();
                // Destination(None) is a special case; render the Home screen
                if (next_destination.View_cls === null) next_destination = new SSDestination(SSMainMenuView);

                if (next_destination.View_cls === SSMainMenuView) {
                    // Home always wipes the back_stack and the state of temp vars
                    this.clear_back_stack();
                    this.resume_main_flow = null;
                    this.multisig_wallet_descriptor = null;
                    this.unverified_address = null;
                    this.address_explorer_data = null;
                    this.psbt = null;
                    this.psbt_parser = null;
                    this.psbt_seed = null;
                }

                try {
                    // Instantiate the View class and run it
                    this.current_destination = next_destination;   // (JS addition, for the page/debugging)
                    next_destination = await next_destination.run();
                } catch (e) {
                    if (e instanceof SSAbort) throw e;
                    if (gen !== SS_GEN) throw new SSAbort();   // an error from a run the page already stopped
                    // Display user-friendly error screen w/debugging info
                    console.error(e);
                    next_destination = this.handle_exception(e);
                }

                if (!next_destination) {
                    // Should only happen during dev when you hit an unimplemented option
                    next_destination = new SSDestination(SSNotYetImplementedView);
                }

                if (next_destination.skip_current_view) {
                    // Remove the current View from history; it's forwarding us straight to the next View
                    this.back_stack.pop();
                }

                // Hang on to this reference...
                const clear_history = next_destination.clear_history;

                if (next_destination.View_cls === SSBackStackView) {
                    // "Back" arrow was clicked; load the previous view
                    next_destination = this.pop_prev_from_back_stack();
                }

                // ...now apply it, if needed
                if (clear_history) this.clear_back_stack();

                // The next_destination always goes on the back_stack, unless it equals the current top.
                if (this.back_stack.length === 0 || !this.back_stack[this.back_stack.length - 1].equals(next_destination)) {
                    this.back_stack.push(next_destination);
                }
            }
        } finally {
            if (this.is_screensaver_running) this.screensaver.stop();
            if (this.toast_notification_thread && this.toast_notification_thread.is_alive()) this.toast_notification_thread.stop();
        }
    }

    get is_screensaver_running() { return this.screensaver !== null && this.screensaver.is_running; }

    async start_screensaver() {
        // If a toast is running, tell it to give up the Renderer.lock
        if (this.toast_notification_thread && this.toast_notification_thread.is_alive()) {
            this.toast_notification_thread.toggle_renderer_lock();
        }
        if (!this.screensaver) {
            this.screensaver = new SSScreensaverScreen({ buttons: SSHardwareButtons.get_instance() });
        }
        // Start the screensaver, but it will block until it can acquire the Renderer.lock.
        await this.screensaver.start();
    }

    // Reset the screensaver's timeout starting point to right now
    reset_screensaver_timeout() { SSHardwareButtons.get_instance().update_last_input_time(); }

    activate_toast(toast_manager_thread) {
        if (this.is_screensaver_running) {
            // New toast notifications break out of the Screensaver
            this.screensaver.stop();
        }
        if (this.toast_notification_thread && this.toast_notification_thread.is_alive()) {
            // Can only run one toast at a time
            this.toast_notification_thread.stop();
        }
        this.toast_notification_thread = toast_manager_thread;
        this.toast_notification_thread.start();
    }

    /*
     * Displays a user-friendly error screen with debugging info: exception type, "file, line, in function", message.
     * (Python formats these from the traceback; here from the JS Error.)
     */
    handle_exception(e) {
        const exception_type = (e && (e.name || (e.constructor && e.constructor.name))) || "Error";
        // Python keeps the text between the first and second ":" of "Type: message" (leading space included)
        const msg = e && e.message !== undefined ? String(e.message) : String(e);
        const exception_msg = (":" + " " + msg).split(":")[1];
        let line_info = null;
        const stack = (e && e.stack) ? String(e.stack).split("\n") : [];
        for (const l of stack) {
            const m = l.match(/at (?:(.+?) \()?(?:.*\/)?([^/\s()]+?):(\d+):\d+\)?$/) || l.match(/^(.*?)@(?:.*\/)?([^/\s]+?):(\d+):\d+$/);
            if (m) {
                line_info = `${m[2]}, ${m[3]}, in ${m[1] || "<module>"}`;
                break;
            }
        }
        const error = [exception_type, String(line_info), exception_msg];
        return new SSDestination(SSUnhandledExceptionView, { view_args: { error }, clear_history: true });
    }

    get is_screensaver_start_allowed() {
        // Confusingly, the top item in the `BackStack` is actually the *current* View
        const top = this.back_stack.length ? this.back_stack[this.back_stack.length - 1] : null;
        const active_view = top && top.view ? top.view : null;
        const allowed = active_view ? active_view.is_screensaver_allowed !== false : true;
        return !this.is_screensaver_running && allowed;
    }

    /* ------------------------------- Browser entry points ------------------------------- */

    // Runs the app on a <canvas>. Options: initial_destination (SSDestination), skip_splash (bool), scale (device px per px)
    static async start(canvasElement, opts = {}) {
        SS_GEN++;   // abort any previous run (restart)
        const gen = SS_GEN;
        SS_SCALE = opts.scale || Math.min(4, Math.max(1, Math.ceil((typeof window !== "undefined" && window.devicePixelRatio) || 1)));
        await ssLoadAssets();
        if (gen !== SS_GEN) return null;

        SSFonts.fonts = {};   // fonts measured before load would be wrong
        SSController._canvas = canvasElement;
        SSController._opts = opts;
        SSRenderer.configure_instance(canvasElement);
        SSHardwareButtons._instance = null;
        SSController._instance = null;
        const controller = SSController.get_instance();
        SSController._install_input_listeners(canvasElement);

        controller._run_promise = controller.start(opts.initial_destination || null, { skip_splash: !!opts.skip_splash })
            .catch((e) => { if (!(e instanceof SSAbort)) console.error("SeedSigner main loop stopped:", e); });
        return controller;
    }

    // SIM of RestartView's os.execv(): wipes in-memory state and boots again from the splash screen.
    static _restart() {
        SS_GEN++;
        const S = ssGet(() => SSSettings);
        if (S && ssSettingGet("persistent_settings", "D") !== "E") S._instance = null;   // settings are re-read on boot
        SSMicroSD._instance = null;
        const canvas = SSController._canvas, gen = SS_GEN;
        // (the page may stop the device before this fires; it then bumps SS_GEN and the restart is dropped)
        setTimeout(() => { if (gen === SS_GEN) SSController.start(canvas, { scale: SS_SCALE }); }, 0);
    }

    // Page D-pad / keys: SSController.press("KEY_UP" | "KEY_DOWN" | "KEY_LEFT" | "KEY_RIGHT" | "KEY_PRESS" | "KEY1" | "KEY2" | "KEY3")
    static press(keyName, ms) {
        const key = SSController._key_alias(keyName);
        if (!key) return false;
        SSHardwareButtons.get_instance().tap(key, ms);
        return true;
    }

    // For press-and-hold buttons (key repeat after 225 ms like the hardware): call key_down on pointerdown, key_up on pointerup
    static key_down(keyName) { const k = SSController._key_alias(keyName); if (k) SSHardwareButtons.get_instance().key_down(k); }
    static key_up(keyName) { const k = SSController._key_alias(keyName); if (k) SSHardwareButtons.get_instance().key_up(k); }

    static _key_alias(name) {
        if (!name) return null;
        const n = String(name).toUpperCase().replace(/^KEY_?/, "");
        const map = { UP: "KEY_UP", DOWN: "KEY_DOWN", LEFT: "KEY_LEFT", RIGHT: "KEY_RIGHT", PRESS: "KEY_PRESS", CENTER: "KEY_PRESS", OK: "KEY_PRESS", ENTER: "KEY_PRESS", "1": "KEY1", "2": "KEY2", "3": "KEY3" };
        return map[n] || null;
    }

    static _install_input_listeners() {
        if (SSController._listeners_installed || typeof window === "undefined") return;
        SSController._listeners_installed = true;
        const keymap = {
            ArrowUp: "KEY_UP", ArrowDown: "KEY_DOWN", ArrowLeft: "KEY_LEFT", ArrowRight: "KEY_RIGHT",
            Enter: "KEY_PRESS", " ": "KEY_PRESS", "1": "KEY1", "2": "KEY2", "3": "KEY3",
        };
        const target = (e) => e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable);
        window.addEventListener("keydown", (e) => {
            const k = keymap[e.key];
            if (!k || target(e) || !SSController.keyboard_enabled || !SSHardwareButtons._instance) return;
            e.preventDefault();
            if (!e.repeat) SSHardwareButtons.get_instance().key_down(k);
        });
        window.addEventListener("keyup", (e) => {
            const k = keymap[e.key];
            if (!k || !SSHardwareButtons._instance) return;
            SSHardwareButtons.get_instance().key_up(k);
        });
        window.addEventListener("blur", () => {
            if (!SSHardwareButtons._instance) return;
            for (const k of SSHardwareButtonsConstants.ALL_KEYS) SSHardwareButtons.get_instance().key_up(k);
        });
    }
}
SSController._instance = null;
SSController.VERSION = "0.8.7";
// Flow names used by resume_main_flow
SSController.FLOW__PSBT = "psbt";
SSController.FLOW__VERIFY_MULTISIG_ADDR = "multisig_addr";
SSController.FLOW__VERIFY_SINGLESIG_ADDR = "singlesig_addr";
SSController.FLOW__ADDRESS_EXPLORER = "address_explorer";
SSController.FLOW__SIGN_MESSAGE = "sign_message";
// The page can set this to false to stop the physical keyboard from driving the simulator
SSController.keyboard_enabled = true;
SSController._listeners_installed = false;
