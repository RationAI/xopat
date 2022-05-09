// noinspection JSUnresolvedVariable

/*
 * OpenSeadragon - ExtendedDziTileSource
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
 * @class ExtendedDziTileSource
 * @memberof OpenSeadragon
 * @extends OpenSeadragon.TileSource
 * @param {object} options configuration, output object of configureFromObject()
 * @property {String} tilesUrl
 * @property {String} fileFormat
 */
$.ExtendedDziTileSource = function( options ) {
    var i,
        rect,
        level;

    this._levelRects  = {};
    this.tilesUrl     = options.tilesUrl;
    this.fileFormat   = options.fileFormat;
    this.displayRects = options.displayRects;

    if ( this.displayRects ) {
        for ( i = this.displayRects.length - 1; i >= 0; i-- ) {
            rect = this.displayRects[ i ];
            for ( level = rect.minLevel; level <= rect.maxLevel; level++ ) {
                if ( !this._levelRects[ level ] ) {
                    this._levelRects[ level ] = [];
                }
                this._levelRects[ level ].push( rect );
            }
        }
    }

    $.TileSource.apply( this, [ options ] );

    if (!this.fileFormat) this.fileFormat = ".jpg";
    if (!this.greyscale) this.greyscale = "";
};

$.extend( $.ExtendedDziTileSource.prototype, $.TileSource.prototype, /** @lends OpenSeadragon.ExtendedDziTileSource.prototype */{

    /**
     * Determine if the data and/or url imply the image service is supported by
     * this tile source.
     * @param {Object|Array} data
     * @param {String} url
     */
    supports: function( data, url ){
        var ns;
        if ( data.ImageArray ) {
            ns = data.Image.xmlns;
        } else if ( data.documentElement ) {
            if ("ImageArray" == data.documentElement.localName || "ImageArray" == data.documentElement.tagName) {
                ns = data.documentElement.namespaceURI;
            }
        }
        ns = ns || "";
        return ns.indexOf('rationai.fi.muni.cz/deepzoom/images') !== -1;
    },

    /**
     *
     * @function
     * @param {Object|XMLDocument} data - the raw configuration
     * @param {String} url - the url the data was retrieved from if any.
     * @param {String} postData - data for the post request or null
     * @return {Object} options - A dictionary of keyword arguments sufficient
     *      to configure this tile sources constructor.
     */
    configure: function( data, url, postData ){

        var options = $.isPlainObject(data) ? configureFromObject(this, data) : configureFromXML(this, data);
        if (postData) {
            options.postData = postData.replace(/([^\/]+?)(\.(dzi|xml|js)?(\?[^\/]*)?)?\/?$/, '$1_files/');
        } else if (url) {
            url = url.replace(
                /([^\/]+?)(\.(dzi|xml|js)?(\?[^\/]*)?)?\/?$/, '$1_files/');
        }

        if (url && !options.tilesUrl) {
            options.tilesUrl = url;
            if (url.search(/\.(dzi|xml|js)\?/) != -1) {
                options.queryParams = url.match(/\?.*/);
            }else{
                options.queryParams = '';
            }
        }
        return options;
    },

    /**
     * @param {Number} level
     * @param {Number} x
     * @param {Number} y
     * @return {string}
     */
    getTileUrl: function( level, x, y ) {
        return this.postData ? `${this.tilesUrl}${this.queryParams}`
            : `${this.tilesUrl}${level}/${x}_${y}.${this.fileFormat}${this.greyscale}${this.queryParams}`;
    },

    /**
     * Responsible for retrieving the headers which will be attached to the image request for the
     * region specified by the given x, y, and level components.
     * This option is only relevant if {@link OpenSeadragon.Options}.loadTilesWithAjax is set to true.
     * The headers returned here will override headers specified at the Viewer or TiledImage level.
     * Specifying a falsy value for a header will clear its existing value set at the Viewer or
     * TiledImage level (if any).
     * @function
     * @param {Number} level
     * @param {Number} x
     * @param {Number} y
     * @returns {Object}
     */
    getTileAjaxHeaders: function( level, x, y ) {
        return {'Content-type': 'application/x-www-form-urlencoded'};
    },

    /**
     * Must use AJAX in order to work, i.e. loadTilesWithAjax : true is set.
     * It should return url-encoded string with the following structure:
     *   key=value&key2=value2...
     * or null in case GET is used instead.
     * @param level
     * @param x
     * @param y
     * @return {string || null} post data to send with tile configuration request
     */
    getTilePostData: function(level, x, y) {
        return this.postData ? `${this.postData}${level}/${x}_${y}.${this.fileFormat}${this.greyscale}` : null;
    },

    //TO-DOCS describe how meta is handled and error property treated
    getImageMetaAt: function(index) {
        return this.imageArray[index];
    },
    setFormat: function(format) {
        this.fileFormat = format;
    },

    getTileHashKey: function(level, x, y, url, ajaxHeaders, postData) {
        return `${x}_${y}/${level}/${this.postData}`;
    },

    /**
     * @function
     * @param {Number} level
     * @param {Number} x
     * @param {Number} y
     */
    tileExists: function( level, x, y ) {
        let rects = this._levelRects[ level ],
            rect,
            scale,
            xMin,
            yMin,
            xMax,
            yMax,
            i;

        if ((this.minLevel && level < this.minLevel) || (this.maxLevel && level > this.maxLevel)) {
            return false;
        }

        if ( !rects || !rects.length ) {
            return true;
        }

        for ( i = rects.length - 1; i >= 0; i-- ) {
            rect = rects[ i ];

            if ( level < rect.minLevel || level > rect.maxLevel ) {
                continue;
            }

            scale = this.getLevelScale( level );
            xMin = rect.x * scale;
            yMin = rect.y * scale;
            xMax = xMin + rect.width * scale;
            yMax = yMin + rect.height * scale;

            xMin = Math.floor( xMin / this._tileWidth );
            yMin = Math.floor( yMin / this._tileWidth ); // DZI tiles are square, so we just use _tileWidth
            xMax = Math.ceil( xMax / this._tileWidth );
            yMax = Math.ceil( yMax / this._tileWidth );

            if ( xMin <= x && x < xMax && yMin <= y && y < yMax ) {
                return true;
            }
        }

        return false;
    }
});


/**
 * @private
 * @inner
 * @function
 */
function configureFromXML( tileSource, xmlDoc ){

    if ( !xmlDoc || !xmlDoc.documentElement ) {
        throw new Error( $.getString( "Errors.Xml" ) );
    }

    var imagesArray    = xmlDoc.documentElement,
        root           = null,
        rootName       = imagesArray.localName || imagesArray.tagName,
        ns             = xmlDoc.documentElement.namespaceURI,
        configuration  = {ImageArray: []},
        displayRects   = [],
        dispRectNodes,
        dispRectNode,
        rectNode,
        sizeNode,
        i;

    if (imagesArray.childNodes.length < 1) throw new Error( "No images defined. There are zero images to display." );

    if ( rootName == "ImageArray" ) {

        try {
            let selectedNode = 0,
                maxWidth = Infinity,
                maxHeight = Infinity;

            for (let child = 0; child < imagesArray.childNodes.length; child++) {
                root = imagesArray.childNodes[child];

                sizeNode = root.getElementsByTagName("Size" )[ 0 ];
                if (sizeNode === undefined) {
                    sizeNode = root.getElementsByTagNameNS(ns, "Size" )[ 0 ];
                }

                let width = parseInt( sizeNode.getAttribute( "Width" ), 10 );
                let height = parseInt( sizeNode.getAttribute( "Height" ), 10 );

                if ( !$.imageFormatSupported( root.getAttribute( "Format" ) ) ) {
                    // noinspection ExceptionCaughtLocallyJS
                    throw new Error(
                        $.getString( "Errors.ImageFormat", root.getAttribute( "Format" ).toUpperCase() )
                    );
                }

                configuration.ImageArray.push({
                    xmlns:       "http://rationai.fi.muni.cz/deepzoom/images",
                    Url:         root.getAttribute( "Url" ),
                    Format:      root.getAttribute( "Format" ),
                    DisplayRect: null,
                    Overlap:     parseInt( root.getAttribute( "Overlap" ), 10 ),
                    TileSize:    parseInt( root.getAttribute( "TileSize" ), 10 ),
                    Size: {
                        Height: height,
                        Width:  width
                    }
                });
            }

            root = imagesArray.childNodes[selectedNode];

            dispRectNodes = root.getElementsByTagName("DisplayRect");
            if (dispRectNodes === undefined) {
                dispRectNodes = root.getElementsByTagNameNS(ns, "DisplayRect")[ 0 ];
            }

            for ( i = 0; i < dispRectNodes.length; i++ ) {
                dispRectNode = dispRectNodes[ i ];
                rectNode     = dispRectNode.getElementsByTagName("Rect")[ 0 ];
                if (rectNode === undefined) {
                    rectNode = dispRectNode.getElementsByTagNameNS(ns,  "Rect")[ 0 ];
                }

                displayRects.push({
                    Rect: {
                        X: parseInt( rectNode.getAttribute( "X" ), 10 ),
                        Y: parseInt( rectNode.getAttribute( "Y" ), 10 ),
                        Width: parseInt( rectNode.getAttribute( "Width" ), 10 ),
                        Height: parseInt( rectNode.getAttribute( "Height" ), 10 ),
                        MinLevel: parseInt( dispRectNode.getAttribute( "MinLevel" ), 10 ),
                        MaxLevel: parseInt( dispRectNode.getAttribute( "MaxLevel" ), 10 )
                    }
                });
            }

            if( displayRects.length ){
                configuration.DisplayRect = displayRects;
            }

            return configureFromObject( tileSource, configuration );

        } catch ( e ) {
            throw (e instanceof Error) ?
                e :
                new Error( $.getString("Errors.Dzi") );
        }
    } else if ( rootName == "Collection" ) {
        throw new Error( $.getString( "Errors.Dzc" ) );
    } else if ( rootName == "Error" ) {
        root = imagesArray.childNodes[0];
        let messageNode = root.getElementsByTagName("Message")[0];
        let message = messageNode.firstChild.nodeValue;
        throw new Error(message);
    }

    throw new Error( $.getString( "Errors.Dzi" ) );
}

/**
 * @private
 * @inner
 * @function
 */
function configureFromObject( tileSource, configuration ){
    var firstImage    = configuration.ImageArray[0],
        fileFormat    = firstImage.Format,
        dispRectData  = configuration.DisplayRect || [],
        width         = Infinity,
        height        = Infinity,
        tileSize      = undefined,
        tileOverlap   = undefined,
        displayRects  = [],
        rectData,
        i;

    for (let image of configuration.ImageArray) {
        let imageWidth = parseInt( image.Size.Width, 10 ),
            imageHeight = parseInt( image.Size.Height, 10 ),
            imageTileSize = parseInt( image.TileSize, 10 ),
            imageTileOverlap = parseInt( image.Overlap, 10 );

        if (imageWidth < 1 || imageHeight < 1) {
            image.error = "Missing image data.";
            continue;
        }

        if (tileSize === undefined) {
            tileSize = imageTileSize;
        }

        if (tileOverlap === undefined) {
            tileOverlap = imageTileOverlap;
        }

        if (imageTileSize !== tileSize || imageTileOverlap !== tileOverlap) {
            image.error = "Incompatible layer: the rendering might contain artifacts.";
        }

        if (imageWidth < width || imageHeight < height) {
            //possibly experiment with taking maximum
            width = imageWidth;
            height = imageHeight;
        }
    }

    for ( i = 0; i < dispRectData.length; i++ ) {
        rectData = dispRectData[ i ].Rect;

        displayRects.push( new $.DisplayRect(
            parseInt( rectData.X, 10 ),
            parseInt( rectData.Y, 10 ),
            parseInt( rectData.Width, 10 ),
            parseInt( rectData.Height, 10 ),
            parseInt( rectData.MinLevel, 10 ),
            parseInt( rectData.MaxLevel, 10 )
        ));
    }

    return $.extend(true, {
        width: width, /* width *required */
        height: height, /* height *required */
        tileSize: tileSize, /* tileSize *required */
        tileOverlap: tileOverlap, /* tileOverlap *required */
        minLevel: null, /* minLevel */
        maxLevel: null, /* maxLevel */
        fileFormat: fileFormat, /* fileFormat */
        imageArray: configuration.ImageArray,
        displayRects: displayRects /* displayRects */
    }, configuration );
}

}( OpenSeadragon ));
