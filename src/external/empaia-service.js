// noinspection JSUnresolvedVariable

/*
 * OpenSeadragon - EmpaiaTileSource
 *
 * Copyright (C) 2009 CodePlex Foundation
 * Copyright (C) 2010-2013 OpenSeadragon contributors
 * Copyright (C) 2021 RationAI Research Group (Modifications)
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 * - Redistributions of source code must retain the above copyright notice,
 *   this list of conditions and the following disclaimer.
 *
 * - Redistributions in binary form must reproduce the above copyright
 *   notice, this list of conditions and the following disclaimer in the
 *   documentation and/or other materials provided with the distribution.
 *
 * - Neither the name of CodePlex Foundation nor the names of its
 *   contributors may be used to endorse or promote products derived from
 *   this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
 * TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
 * LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

(function( $ ){

    /**
     * @class EmpaiaTileSource
     * @memberof OpenSeadragon
     * @extends OpenSeadragon.TileSource
     * @param {object} options configuration, output object of configureFromObject()
     * @property {String} tilesUrl
     * @property {String} fileFormat
     */
    $.EmpaiaTileSource = function( options ) {
        var i,
            rect,
            level;

        this.fileId = options.id;
        this.innerFormat = options.format;
        this.tilesUrl     = options.tilesUrl;

        this.level_meta = {};
        //Asume levels ordered by downsample factor asc (biggest level first)
        //options.levels.sort((x, y) => x.downsample_factor - y.downsample_factor);
        // let OSD_level;
        // for (let i = options.levels-1; i >= 0; i--) {
        //     let level = options.levels[i];
        //     level_meta[i] = OSD_level++;
        // }


        $.TileSource.apply( this, [ {
            width: options.extent.x,
            height: options.extent.y,
            tileSize: options.tile_extent.x,
            //todo osd support for non-rect sizes?
            // this.tileSizeX = options.tile_extent.x;
            // this.tileSizeY = options.tile_extent.y;
            maxLevel: options.levels.length,
            minLevel: 1,
            tileOverlap: 0
        } ] );
    };

    $.extend( $.EmpaiaTileSource.prototype, $.TileSource.prototype, /** @lends OpenSeadragon.EmpaiaTileSource.prototype */{

        /**
         * Determine if the data and/or url imply the image service is supported by
         * this tile source.
         * @param {(Object|Array)} data
         * @param {String} url
         */
        supports: function( data, url ){
            const match = url.match(/^(\/[^\/].*\/v\d+)\/slides\/[^\/\s]+\/info$/i);
            if (match) {
                data.tilesUrl = match[1];
                return true;
            }
            return false;
        },

        /**
         * @function
         * @param {(Object|XMLDocument)} data - the raw configuration
         * @param {String} url - the url the data was retrieved from if any.
         * @param {String} postData - data for the post request or null
         * @return {Object} options - A dictionary of keyword arguments sufficient
         *      to configure this tile sources constructor.
         */
        configure: function( data, url, postData ) {
            return data;
        },

        /**
         * @param {Number} level
         * @param {Number} x
         * @param {Number} y
         * @return {string}
         */
        getTileUrl: function( level, x, y ) {
            return this.getUrl(level, x, y);
        },

        /**
         * More generic for other approaches
         * @param {Number} level
         * @param {Number} x
         * @param {Number} y
         * @param {String} tiles optionally, provide tiles URL
         * @return {string}
         */
        getUrl: function( level, x, y, tiles=this.tilesUrl ) {
            level = this.maxLevel-level; //OSD assumes max level is biggest number, query vice versa,
            return `${tiles}/slides/${this.fileId}/tile/level/${level}/tile/${x}/${y}`
        },

    });

}( OpenSeadragon ));
