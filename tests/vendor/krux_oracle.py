"""Expected punch plate layouts from Krux's own code, for tests/krux.test.mjs (v2.10.0).

Reads JSON on stdin: {"chunks": [[12 BIP39 words], ...], "mnemonics": ["words ...", ...], "reads": [["token", base], ...]}
and prints what Krux shows for them. Krux is not run as a program: the files are the ones tests/vendor/fetch.sh downloads
at the pinned commit, checked here by SHA-256, and only these functions are taken out of them (with Python's ast module)
and run on their own, with the BIP39 list from embit (the library Krux uses) and a stand-in display that records where
Krux would draw:
- utils.py, Utils.get_mnemonic_numbers: the word numbers in decimal, hexadecimal and octal (Krux: Other Formats, Numbers).
- tiny_seed.py, TinySeed._draw_punched: which cells of the 12 x 12 grid Krux fills for 12 words (Other Formats, Tinyseed);
  the column of each filled cell is read through TinySeed._draw_labels, which labels the columns 2048, 1024 ... 1.
- stack_1248.py, Stackbit._word_to_digits and Stackbit._draw_punched: the 4 digits and which boxes Krux outlines; each box is
  read through the labels Stackbit._draw_labels writes above and below it (upper_numbers and lower_numbers).
- mnemonic_loader.py, the to_word of load_key_from_digits, load_key_from_hexadecimal and load_key_from_octal: the word
  Krux reads back for a typed number, or "" when it refuses it.
"""
import ast, hashlib, json, re, sys
from pathlib import Path
from embit.wordlists.bip39 import WORDLIST

SRC = Path(__file__).parent / "src" / "krux" / "src" / "krux" / "pages"
PINNED = {
    "tiny_seed.py": "7dbb6f0bb6f735b15da24842945c134243cf8bfc0a57bf83cfba706391bea3c2",
    "stack_1248.py": "b5030fbb14b38d358294832ee044a752025efa267290d93080c406960010815f",
    "utils.py": "e3c3da9baf689eaf63905f7aa222454b75c605493deebdb32033053281046e5e",
    "mnemonic_loader.py": "87c347f44333b4fb316f371622f38da0c953d4599ccc7dc362e11c69a88911e3",
}

def source(name):
    b = (SRC / name).read_bytes()
    if hashlib.sha256(b).hexdigest() != PINNED[name]:
        raise SystemExit("krux: " + name + " is not the file of the pinned commit (run sh tests/vendor/fetch.sh)")
    return b.decode()

def func(tree, cls, name, inner=None):
    """The source of one function (a method of `cls`, or a function inside it), as a plain top-level function."""
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == cls:
            for f in node.body:
                if isinstance(f, ast.FunctionDef) and f.name == name:
                    if inner:
                        for g in ast.walk(f):
                            if isinstance(g, ast.FunctionDef) and g.name == inner and g is not f:
                                g.decorator_list = []
                                return ast.unparse(g)
                    f.decorator_list = []
                    return ast.unparse(f)
    raise SystemExit("krux: " + cls + "." + name + (" > " + inner if inner else "") + " is no longer in the pinned source")

def load(code, ns):
    exec(compile(code, "krux-extract", "exec"), ns)
    return ns

class Rec:
    def __init__(self): self.calls = []
    def fill_rectangle(self, *a): self.calls.append(a)
    def outline(self, *a): self.calls.append(a)
class Obj: pass

def main():
    req = json.load(sys.stdin)
    ts, sb, ut, ml = (ast.parse(source(n)) for n in ("tiny_seed.py", "stack_1248.py", "utils.py", "mnemonic_loader.py"))
    theme = Obj(); theme.highlight_color = 1; theme.fg_color = 2; theme.disabled_color = 3
    # Utils.get_mnemonic_numbers (a static method that reads Utils.BASE_HEX and Utils.BASE_OCT)
    U = type("Utils", (), {"BASE_DEC": 10, "BASE_HEX": 16, "BASE_OCT": 8})
    ns = load(func(ut, "Utils", "get_mnemonic_numbers"), {"Utils": U, "BASE_DEC": 10})   # the default argument is read from the class body
    numbers = ns["get_mnemonic_numbers"]
    # The column labels of the binary grid: _draw_labels starts at 2048 and halves it for each of the 12 columns.
    lab = func(ts, "TinySeed", "_draw_labels")
    if not re.search(r"bit_number = 2048\b.*?for _ in range\(12\):.*?bit_number //= 2", lab, re.S): raise SystemExit("krux: TinySeed column labels changed")
    tiny = load(func(ts, "TinySeed", "_draw_punched"), {"WORDLIST": WORDLIST, "theme": theme})["_draw_punched"]
    # Stackbit labels above and below each box column
    sl = func(sb, "Stackbit", "_draw_labels")
    up = json.loads(re.search(r"upper_numbers = (\[[0-9, ]+\])", sl).group(1)); low = json.loads(re.search(r"lower_numbers = (\[[0-9, ]+\])", sl).group(1))
    digits = load(func(sb, "Stackbit", "_word_to_digits"), {"WORDLIST": WORDLIST})["_word_to_digits"]
    spunch = load(func(sb, "Stackbit", "_draw_punched"), {"WORDLIST": WORDLIST, "theme": theme})["_draw_punched"]
    to_word = {b: load(func(ml, "MnemonicLoader", m, "to_word"), {"WORDLIST": WORDLIST})["to_word"] for b, m in ((10, "load_key_from_digits"), (16, "load_key_from_hexadecimal"), (8, "load_key_from_octal"))}

    out = {"labels": {"upper": up, "lower": low}, "words": {}, "mnemonics": [], "reads": []}
    for chunk in req["chunks"]:
        me = Obj(); me.ctx = Obj(); me.ctx.display = Rec(); me.x_offset, me.y_offset, me.x_pad, me.y_pad = 10, 30, 20, 20
        tiny(me, chunk, 0)
        cells = [[] for _ in chunk]
        for x, y, *_ in me.ctx.display.calls:
            row, col = (y - 3 - me.y_offset) // me.y_pad, (x - 3 - me.x_offset) // me.x_pad
            cells[row].append(2048 >> col)   # column col is labelled 2048 halved col times
        for w, c in zip(chunk, cells):
            sme = Obj(); sme.ctx = Obj(); sme.ctx.display = Rec(); sme.x_offset, sme.x_pad, sme.y_pad = 10, 16, 14
            d, dstr = digits(sme, w); spunch(sme, d, 50)
            boxes = [[], [], [], []]
            for x, y, *_ in sme.ctx.display.calls:
                col = (x - (sme.x_offset + sme.x_pad + 3)) // sme.x_pad; lower = y != 50 + 1
                boxes[0 if col == 0 else (col - 1) // 2 + 1].append((low if lower else up)[col])
            out["words"][w] = {"tiny": sorted(c, reverse=True), "digits": dstr, "stack": [sorted(b) for b in boxes]}
    for m in req["mnemonics"]:
        out["mnemonics"].append({"dec": numbers(m, 10), "hex": numbers(m, 16), "oct": numbers(m, 8)})
    for tok, base in req["reads"]:
        out["reads"].append(to_word[base](tok))
    json.dump(out, sys.stdout)

main()
