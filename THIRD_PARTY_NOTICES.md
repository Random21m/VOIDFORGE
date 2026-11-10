# Third-party notices

VOIDFORGE itself is MIT licensed (see [LICENSE](LICENSE)). From v2.13.0 the file `voidforge.html` also carries the work of others, for the **Practice signer** (CHECK A BACKUP). Their notices are here. The page's own code has no other bundled libraries.

## SeedSigner (the Practice signer's code)

The Practice signer is a port to JavaScript of the user interface of SeedSigner 0.8.7 (commit `e0a80d4b33b8eb7fb1e9fd14a27b7cd11c7d2cd6`). The screens, menus, wording and layout numbers follow SeedSigner's own source. SeedSigner is MIT licensed. Its license, copied from `LICENSE.md` in that source:

```
MIT License

Copyright (c) 2021 SeedSigner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

VOIDFORGE is not made by, or endorsed by, the SeedSigner project.

## Fonts and icons inside the Practice signer

The page embeds these fonts as data (WOFF2), so it still works from one file with no network. They are the fonts SeedSigner itself uses (`src/seedsigner/resources/fonts/` in release 0.8.7).

### Open Sans (Regular and SemiBold), subset

- Copyright: Digitized data copyright (c) 2010-2011, Google Corporation.
- License: Apache License, Version 2.0 (https://www.apache.org/licenses/LICENSE-2.0).
- Changed: the fonts are subset (Basic Latin, Latin-1, Latin Extended-A, Greek, basic Cyrillic, a few Vietnamese letters, general punctuation, U+2122 and U+2212), hinting is removed, and they are converted to WOFF2.
- The full license text is at the address above. UNVERIFIED: it is not copied here, because the font's own license file was not available when this notice was written.

### Inconsolata (Regular and SemiBold)

- Copyright: Copyright 2006 The Inconsolata Project Authors (https://github.com/cyrealtype/Inconsolata).
- License: SIL Open Font License, Version 1.1 (https://openfontlicense.org, also https://scripts.sil.org/OFL).
- Changed: only converted from TTF to WOFF2. No glyph changes.
- The full license text is at the address above. UNVERIFIED: it is not copied here, because the font's own license file was not available when this notice was written. The font is not sold on its own, and its name is not used for a changed font.

### seedsigner-icons

- Copyright: Copyright (c) 2021 SeedSigner. This icon font is part of SeedSigner and under its MIT license (above).
- Changed: only converted from OTF to WOFF2.

### Font Awesome

Not included. The few Font Awesome symbols SeedSigner uses are drawn in the page as plain shapes with Font Awesome's measurements.
