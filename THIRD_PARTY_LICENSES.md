# Third-Party Licenses

xOpat's own source code is licensed under the MIT License — see [`LICENSE`](LICENSE)
(Copyright © 2022 RationAI Research Group).

xOpat also **bundles and redistributes** third-party open-source software (vendored
libraries under `src/libs/` and `src/external/`, fonts, and compiled artifacts shipped
inside some modules). Those components remain under **their own licenses**, and this
file preserves the required copyright and permission notices for them. Nothing here
relicenses that software; the xOpat MIT license applies only to xOpat's own code.

Build-time-only dependencies (installed under `node_modules/`, not shipped to the
browser) carry their own `LICENSE` files inside their packages and are not reproduced
here.

> **Maintainer note:** when you add, remove, upgrade, or re-vendor anything under
> `src/libs/`, `src/external/`, the fonts, or a module/plugin that ships a compiled
> third-party artifact, update the table and notices below. Keep upstream license
> banners intact when re-minifying/re-vendoring — do not strip them.

---

## 1. Bundled components (shipped to the browser)

| Component | Version | Where | License |
|---|---|---|---|
| OpenSeadragon | 6.0.1 | `src/libs/openseadragon.js` | BSD-3-Clause |
| Flex Render (OpenSeadragon drawer) | 0.0.1 | `src/libs/flex-renderer/` | BSD-3-Clause |
| OSD tile sources / tools (xOpat modifications) | — | `src/external/dziexttilesource.js`, `emptytilesource.js`, `previewsource.js`, `osd_tools.js` | BSD-3-Clause |
| jQuery | 3.5.1 | `src/libs/jquery.min.js` | MIT |
| i18next | (vendored min) | `src/libs/i18next.min.js` | MIT |
| jquery-i18next | (vendored min) | `src/libs/i18next.jquery.min.js` | MIT |
| Ajv (JSON Schema Validator) | 8.17.1 | `src/libs/ajv7.min.js` | MIT |
| KineticJS | 5.1.0 | `src/libs/kinetic-v5.1.0.min.js` | MIT |
| unzipit | 1.3.6 | `src/libs/unzipit.min.js` | MIT |
| jQuery.scrollTo | 2.1.3 | `src/libs/scrollTo.min.js` | MIT |
| Monaco Editor | 0.33.0 | `src/libs/monaco/` | MIT |
| Primer CSS | (vendored, legacy) | `src/libs/primer_css.css` | MIT |
| Tailwind CSS + DaisyUI (compiled) | Tailwind 3.4 / DaisyUI 4.x | `src/libs/tailwind.min.css` | MIT |
| js-cookie | 3.0.1 | `src/external/js.cookie.js` | MIT |
| noUiSlider | (vendored min) | `src/external/nouislider.min.js`, `nouislider.css` | MIT |
| EnjoyHint | (vendored) | `src/external/enjoyhint.js`, `enjoyhint.css` | MIT |
| stats.js | (vendored) | `src/external/stats.js` | MIT |
| BVSelect (autocomplete) | 1.3 | `src/external/autocomplete.js`, `autocomplete.css` | MIT |
| Font Awesome Free | 6.7.2 | `src/libs/fontawesome/` | Icons: CC BY 4.0 · Fonts: SIL OFL 1.1 · Code: MIT |
| Phosphor Icons (Light) | — | `src/libs/phoshor-icons/` | MIT |
| Little CMS (lcms2) — compiled into `icc_wasm.wasm` | 2.15 | `modules/icc_profile/` | MIT (see §4) |
| OpenSeadragon ScaleBar (NIST) | — | `src/external/scalebar.js` | U.S. Government work — public domain (see §5) |
| geotiff.js and its dependencies | — | `modules/geotiff/dist/` | MIT and others — see [`modules/geotiff/dist/bundled-licenses.txt`](modules/geotiff/dist/bundled-licenses.txt) |

`src/external/data-structures.ts` is original xOpat code and is covered by the xOpat
MIT license, not a third party.

---

## 2. MIT-licensed components

The following components are distributed under the **MIT License**. The permission
text (reproduced once below) applies to each; the individual copyright notices are:

- **jQuery** — Copyright OpenJS Foundation and other contributors, https://jquery.org/
- **i18next** — Copyright © i18next authors (https://www.i18next.com/)
- **jquery-i18next** — Copyright © i18next authors
- **Ajv** — Copyright © 2015 Evgeny Poberezkin
- **KineticJS** — Copyright © 2013 Eric Rowell
- **unzipit** — Copyright © 2020 Greggman (Gregg Tavares)
- **jQuery.scrollTo** — Copyright © 2007-2015 Ariel Flesler
- **Monaco Editor** — Copyright © Microsoft Corporation. All rights reserved.
- **Primer CSS** — Copyright © GitHub, Inc.
- **Tailwind CSS** — Copyright © Tailwind Labs, Inc.
- **DaisyUI** — Copyright © 2020 Pouya Saadeghi
- **js-cookie** — Copyright © 2018 Klaus Hartl, Fagner Brack
- **noUiSlider** — Copyright © Léon Gersen
- **EnjoyHint** — Copyright © XB Software Ltd.
- **stats.js** — Copyright © 2009-2016 Mr.doob
- **BVSelect** — Copyright © Bruno Vieira
- **Phosphor Icons** — Copyright © 2023 Phosphor Icons
- **Little CMS (lcms2)** — Copyright © 1998-2020 Marti Maria Saguer (see §4)

```
MIT License

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

---

## 3. BSD-3-Clause components — OpenSeadragon and derivatives

**OpenSeadragon** (`src/libs/openseadragon.js`), the **Flex Render** drawer
(`src/libs/flex-renderer/`), and the xOpat-modified OpenSeadragon tile sources and
tools (`src/external/dziexttilesource.js`, `emptytilesource.js`, `previewsource.js`,
`osd_tools.js`) are distributed under the OpenSeadragon license:

```
Copyright (C) 2009 CodePlex Foundation
Copyright (C) 2010-2025 OpenSeadragon contributors
Portions Copyright (C) 2021 RationAI Research Group (modifications)

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

- Redistributions of source code must retain the above copyright notice,
  this list of conditions and the following disclaimer.

- Redistributions in binary form must reproduce the above copyright
  notice, this list of conditions and the following disclaimer in the
  documentation and/or other materials provided with the distribution.

- Neither the name of CodePlex Foundation nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```

Canonical text: https://openseadragon.github.io/license/

---

## 4. Little CMS (lcms2) — MIT, with a copyleft note

The color-management WebAssembly artifact shipped at
`modules/icc_profile/icc_wasm.wasm` is compiled from **Little CMS (lcms2) 2.15**,
which is licensed under the **MIT License** (Copyright © 1998-2020 Marti Maria Saguer;
full text at `modules/icc_profile/build/icc/lcms2-2.15/COPYING`).

**Copyleft note:** the vendored lcms2 source tree also contains two optional plugins —
`plugins/fast_float/` and `plugins/threaded/` — which are licensed under **GPL-3.0**
(`COPYING.GPL3`). These plugins are **not used, not compiled, and not linked** into
`icc_wasm.wasm`: the build (`modules/icc_profile/build/icc/icc_profile.c`) calls only
core lcms2 APIs (`cmsOpenProfileFromMem`, `cmsCreateTransform`, `cmsCreate_sRGBProfile`).
The GPL-3.0 files remain in-tree only as unused upstream source and retain their own
license notices. **No GPL code is distributed in any shipped/executable artifact.**

---

## 5. OpenSeadragon ScaleBar — U.S. Government work (public domain)

`src/external/scalebar.js` was developed at the National Institute of Standards and
Technology (NIST) by U.S. Federal Government employees and, per 17 U.S.C. §105, is not
subject to copyright protection in the United States and is in the public domain.
Author: Antoine Vandecreme <antoine.vandecreme@nist.gov>. Later modifications by the
xOpat authors are covered by the xOpat MIT license. NIST assumes no responsibility for
its use and makes no warranty; acknowledgement is appreciated.

---

## 6. Font Awesome Free 6.7.2 — multi-part license

Font Awesome Free (`src/libs/fontawesome/`) — Copyright © 2024 Fonticons, Inc. —
is released under three licenses depending on the asset:

- **Icons** (the SVG/glyph designs): **Creative Commons Attribution 4.0 International
  (CC BY 4.0)** — https://creativecommons.org/licenses/by/4.0/
  Attribution: "Font Awesome Free by @fontawesome — https://fontawesome.com".
- **Fonts** (the icon webfont files): **SIL Open Font License 1.1 (OFL-1.1)** —
  https://scripts.sil.org/OFL
- **Code** (CSS/JS): **MIT License** — see §2.

Full terms: https://fontawesome.com/license/free

---

## 7. Other modules and build-time dependencies

- **geotiff module** — `modules/geotiff/dist/bundled-licenses.txt` contains the full
  aggregated license notices for geotiff.js and its bundled dependencies.
- **NPM build/dev dependencies** — everything under `node_modules/` (esbuild, grunt,
  tailwindcss, postcss, cypress, etc.) is used only to build/test xOpat and is not
  shipped to end users. Each package retains its own `LICENSE` file inside its
  directory; consult those for redistribution if you bundle the toolchain.
- **Modules and plugins** authored by the xOpat project are covered by the xOpat MIT
  license unless a `LICENSE` file in the specific module/plugin states otherwise.
