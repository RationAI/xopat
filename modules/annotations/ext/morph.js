
/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2013 PorkShoulderHolder
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:

 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.

 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */


OSDAnnotations.Morph = class {
    constructor(initmask) {
        this.width = initmask.width,
            this.height = initmask.height,
            this.data = new Uint8Array(initmask.data);
        if (this.data) {
            if (this.height * this.width != this.data.length)
                throw 'MORPH_DIMENSION_ERROR: incorrect dimensions';
        }
        else {
            // this.data = Array.apply(null, new Array(this.height * this.width)).map(Number.prototype.valueOf,0);
            this.data = Array(this.width * this.height).fill(0);
        }
        this.dilate = function () {
            // this.addBorder()
            let o = Array.from(this.data);
            let w = this.width;
            let h = this.height;
            for (var y = 0; y < h; y++) {
                for (var x = 0; x < w; x++) {
                    var ind = y * w + x;
                    this.data[ind] = o[ind] ? o[ind] : (this.adjacentIndices(ind).some(function (i) { return o[i]; }) ? 1 : 0);
                }
            }
            return {
                width: this.width,
                height: this.height,
                data: this.data
            };
        };
        this.addBorder = function () {
            this.width = this.width + 2;
            this.height = this.height + 2;
            let orig = this.data;
            this.data = new Uint8Array(this.width * this.height).fill(0);
            for (var y = 1; y < this.height - 1; y++) {
                for (var x = 1; x < this.width - 1; x++) {
                    this.data[y * this.width + x] = orig[(y - 1) * (this.width - 2) + (x - 1)];
                }
            }
            return {
                width: this.width,
                height: this.height,
                data: this.data
            };
        };
        this.adjacentIndices = function (ind) {
            var ul = ind - this.width - 1;
            var ll = ind + this.width - 1;
            let len = this.data.length;
            return [ul, ul + 1, ul + 2, ind - 1, ind + 1, ll, ll + 1, ll + 2].filter(function (i) { return i >= 0 && i < len; });
        };
    }
}
