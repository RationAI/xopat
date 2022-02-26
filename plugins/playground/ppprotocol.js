/*
 * Python Playground Protocol
 *
 * Based on OpenSeadragon.DziTileSource:
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

PythonPlayground.Protocol = class extends OpenSeadragon.TileSource {
    /**
     * Taken from DZI processing, the same
     */
    constructor(options) {
        super(options);

        let i,
            rect,
            level;

        this._levelRects  = {};
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

        if (!this.fileFormat) this.fileFormat = ".jpg";
        if (!this.greyscale) this.greyscale = "";
    }

    /**
     * Support http://rationai.fi.muni.cz/deepzoom/playground
     */
    supports( data, url ){
        var ns;
        if ( data.Image ) {
            ns = data.Image.xmlns;
        } else if ( data.documentElement) {
            if ("Image" === data.documentElement.localName || "Image" === data.documentElement.tagName) {
                ns = data.documentElement.namespaceURI;
            }
        }

        ns = (ns || '').toLowerCase();

        return ns.indexOf('http://rationai.fi.muni.cz/deepzoom/playground') !== -1;
    }

    /**
     * Initialization phase, similar to OSD
     * @param ready
     * @param url
     * @param postData
     * @param headers
     * @param useCredentials
     */
    static initialize(ready, abort, server, image, algorithm, postData=null, headers={}, useCredentials=false) {
        const URL = `${server}/init/${algorithm}?Deepzoom=${image}.dzi`;
        OpenSeadragon.makeAjaxRequest( {
            url: URL,
            postData: postData,
            withCredentials: useCredentials,
            headers: headers,
            success: function( xhr ) {
                let data;
                if (xhr.responseText.match(/\s*<.*/)){
                    try {
                        data = ( xhr.responseXML && xhr.responseXML.documentElement ) ? xhr.responseXML :
                            OpenSeadragon.parseXml( xhr.responseText );
                    } catch (e){
                        data = xhr.responseText;
                    }
                } else if ( xhr.responseText.match(/\s*[{[].*/) ){
                    try {
                        data = OpenSeadragon.parseJSON(xhr.responseText);
                    } catch(e){
                        data =  xhr.responseText;
                    }
                } else {
                    data = xhr.responseText;
                }
                if( typeof (data) === "string" ) data = OpenSeadragon.parseXml( data );
                let protocol = new PythonPlayground.Protocol(
                    PythonPlayground.Protocol.prototype.configure(data, URL, postData)
                );
                protocol.rootServer = server;
                protocol.imageSource = image;
                protocol.algorithm = algorithm;
                ready(protocol);
            },
            error: function ( xhr, exc ) {
                let msg;
                try {
                    msg = "HTTP " + xhr.status + " attempting to load TileSource";
                } catch ( e ) {
                    let formattedExc;
                    if ( typeof ( exc ) === "undefined" || !exc.toString ) {
                        formattedExc = "Unknown error";
                    } else {
                        formattedExc = exc.toString();
                    }

                    msg = formattedExc + " attempting to load TileSource";
                }
                abort(msg);
            }
        });
    }

    /**
     * @function
     * @param {Object|XMLDocument} data - the raw configuration
     * @param {String} url - the url the data was retrieved from if any.
     * @param {String} postData - data for the post request or null
     * @return {Object} options - A dictionary of keyword arguments sufficient
     *      to configure this tile sources constructor.
     */
    configure( data, url, postData ){

        function configureFromXML( tileSource, xmlDoc ){
            if ( !xmlDoc || !xmlDoc.documentElement ) {
                throw "Reponse is not a valid XML document.";
            }

            var root           = xmlDoc.documentElement,
                rootName       = root.localName || root.tagName,
                ns             = xmlDoc.documentElement.namespaceURI,
                configuration  = null,
                displayRects   = [],
                dispRectNodes,
                dispRectNode,
                rectNode,
                sizeNode,
                i;

            if ( rootName === "Image" ) {
                sizeNode = root.getElementsByTagName("Size" )[ 0 ];
                if (sizeNode === undefined) {
                    sizeNode = root.getElementsByTagNameNS(ns, "Size" )[ 0 ];
                }

                configuration = {
                    Image: {
                        xmlns:       "http://rationai.fi.muni.cz/deepzoom/playground",
                        Url:         root.getAttribute( "Url" ),
                        Format:      root.getAttribute( "Format" ),
                        DisplayRect: null,
                        Overlap:     parseInt( root.getAttribute( "Overlap" ), 10 ),
                        TileSize:    parseInt( root.getAttribute( "TileSize" ), 10 ),
                        Size: {
                            Height: parseInt( sizeNode.getAttribute( "Height" ), 10 ),
                            Width:  parseInt( sizeNode.getAttribute( "Width" ), 10 )
                        }
                    }
                };

                if ( !OpenSeadragon.imageFormatSupported( configuration.Image.Format ) ) {
                    throw new Error(
                        OpenSeadragon.getString( "Errors.ImageFormat", configuration.Image.Format.toUpperCase() )
                    );
                }

                dispRectNodes = root.getElementsByTagName("DisplayRect" );
                if (dispRectNodes === undefined) {
                    dispRectNodes = root.getElementsByTagNameNS(ns, "DisplayRect" )[ 0 ];
                }

                for ( i = 0; i < dispRectNodes.length; i++ ) {
                    dispRectNode = dispRectNodes[ i ];
                    rectNode     = dispRectNode.getElementsByTagName("Rect" )[ 0 ];
                    if (rectNode === undefined) {
                        rectNode = dispRectNode.getElementsByTagNameNS(ns, "Rect" )[ 0 ];
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
                    configuration.Image.DisplayRect = displayRects;
                }
                return configureFromObject( tileSource, configuration );

            } else if ( rootName === "Error" ) {
                var messageNode = root.getElementsByTagName("Message")[0];
                throw messageNode.firstChild.nodeValue;
            }

            throw "Unknown XML format: node <" + rootName + ">";
        }

        function configureFromObject( tileSource, configuration ){
            var imageData     = configuration.Image,
                fileFormat    = imageData.Format,
                sizeData      = imageData.Size,
                dispRectData  = imageData.DisplayRect || [],
                width         = parseInt( sizeData.Width, 10 ),
                height        = parseInt( sizeData.Height, 10 ),
                tileSize      = parseInt( imageData.TileSize, 10 ),
                tileOverlap   = parseInt( imageData.Overlap, 10 ),
                displayRects  = [],
                rectData,
                i;

            for ( i = 0; i < dispRectData.length; i++ ) {
                rectData = dispRectData[ i ].Rect;

                displayRects.push( new OpenSeadragon.DisplayRect(
                    parseInt( rectData.X, 10 ),
                    parseInt( rectData.Y, 10 ),
                    parseInt( rectData.Width, 10 ),
                    parseInt( rectData.Height, 10 ),
                    parseInt( rectData.MinLevel, 10 ),
                    parseInt( rectData.MaxLevel, 10 )
                ));
            }

            return OpenSeadragon.extend(true, {
                width: width, /* width *required */
                height: height, /* height *required */
                tileSize: tileSize, /* tileSize *required */
                tileOverlap: tileOverlap, /* tileOverlap *required */
                minLevel: null, /* minLevel */
                maxLevel: null, /* maxLevel */
                fileFormat: fileFormat, /* fileFormat */
                displayRects: displayRects /* displayRects */
            }, configuration );
        }
        return OpenSeadragon.isPlainObject(data) ? configureFromObject(this, data) : configureFromXML(this, data);
    }

    /**
     * @function
     * @param {Number} level
     * @param {Number} x
     * @param {Number} y
     */
    getTileUrl( level, x, y ) {
        return this.postData ? `${this.rootServer}/algorithm/${this.algorithm}`
            : `${this.rootServer}/algorithm/${this.algorithm}?Deepzoom=${this.imageSource}_files/${level}/${x}_${y}.${this.fileFormat}${this.greyscale}`;
    }

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
    getTileAjaxHeaders( level, x, y ) {
        return {'Content-type': 'application/x-www-form-urlencoded'};
    }

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
    getTilePostData(level, x, y) {
        return this.postData ? `Deepzoom=${this.imageSource}_files/${level}/${x}_${y}.${this.fileFormat}${this.greyscale}` : null;
    }

    /**
     * @function
     * @param {Number} level
     * @param {Number} x
     * @param {Number} y
     */
    tileExists( level, x, y ) {
        var rects = this._levelRects[ level ],
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
};
