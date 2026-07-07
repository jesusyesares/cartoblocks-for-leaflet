<?php
/**
 * Inline CSS/JS for the editor preview iframe.
 *
 * These helpers return the preview page's own static stylesheet and scripts as
 * strings. The HTML template (template.php) attaches them to a virtual
 * 'bflm-preview' / 'bflm-preview-imagefit' handle via wp_add_inline_style() /
 * wp_add_inline_script() so the page emits no raw <style>/<script> tags
 * (WordPress Plugin Review: "Use wp_enqueue commands").
 *
 * The JS bodies contain no interpolated PHP. The per-request values the bridge
 * needs (blockId, zoom limits, marker counts, etc.) are passed separately as a
 * `window.bflmPreviewData` / `window.bflmImageFitData` object via a "before"
 * inline data script, then read at the top of each logic script below.
 *
 * @package BlocksForLeafletMap
 */

defined( 'ABSPATH' ) || exit;

/**
 * Preview-page stylesheet (formerly the inline <style> block in the <head>).
 *
 * @return string CSS rules.
 */
function bflm_preview_inline_css(): string {
	return <<<'CSS'
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; overflow: hidden; }
#map-wrap { width: 100%; }
/* Draw-mode pin — reset Leaflet's default marker background/shadow */
.bflm-draw-pin { background: none; border: none; }
/* Overlay corner-resize handle — small filled square, no Leaflet default marker chrome */
.bflm-overlay-handle {
	background: #fff;
	border: 2px solid #2271b1;
	border-radius: 2px;
	cursor: nwse-resize;
}
/* Overlay move handle — centre marker used to drag the whole overlay */
.bflm-overlay-move-handle {
	background: rgba(34, 113, 177, 0.5);
	border: 2px solid #2271b1;
	border-radius: 50%;
	cursor: move;
}
CSS;
}

/**
 * Image-map fit script (formerly the inline <script> after the image shortcode).
 *
 * Reads its single per-request value (the zoom offset) from
 * window.bflmImageFitData, set by the "before" data script in template.php.
 *
 * @return string JavaScript.
 */
function bflm_preview_imagefit_js(): string {
	return <<<'JS'
( function () {
	var data       = window.bflmImageFitData || {};
	var zoomOffset = data.zoomOffset || 0;
	var attempts   = 0;
	function fitImage() {
		var plugin = window.WPLeafletMapPlugin;
		if ( ! plugin || ! plugin.maps || ! plugin.maps[ 0 ] ) {
			if ( 50 > ++attempts ) { setTimeout( fitImage, 100 ); }
			return;
		}
		var map = plugin.maps[ 0 ];
		if ( ! map.is_image_map ) { return; }

		// Find the ImageOverlay layer (has getBounds + getElement).
		var overlay = null;
		map.eachLayer( function ( l ) { if ( ! overlay && l.getBounds && l.getElement ) { overlay = l; } } );
		if ( ! overlay ) {
			if ( 50 > ++attempts ) { setTimeout( fitImage, 100 ); }
			return;
		}

		// Need image natural dimensions — wait until loaded.
		var img = overlay.getElement();
		if ( ! img || ! img.naturalWidth ) {
			if ( 50 > ++attempts ) { setTimeout( fitImage, 100 ); }
			return;
		}

		var iw = img.naturalWidth;
		var ih = img.naturalHeight;
		var mw = map.getContainer().offsetWidth;
		var mh = map.getContainer().offsetHeight;

		// In L.CRS.Simple, bozdoz projects the image at projected_zoom = bozdozZoom+1 = 1.
		// unproject([px,py], 1) = [px/2, py/2] world units.
		// So image world size = iw/2 × ih/2. At map zoom Z, viewport = mw/2^Z world units.
		// Fit: 2^Z = mw / (iw/2) = 2*mw/iw  →  Z = log2(2*mw/iw) = 1 + log2(mw/iw).
		var fitZoomX = Math.log( 2 * mw / iw ) / Math.LN2;
		var fitZoomY = Math.log( 2 * mh / ih ) / Math.LN2;
		var fitZoom  = Math.min( fitZoomX, fitZoomY );

		map.options.zoomSnap = 0;
		map.setMinZoom( fitZoom + zoomOffset );
		map.setMaxBounds( null );
		map.setView( [ 0, 0 ], fitZoom + zoomOffset, { animate: false } );

		// Stash fitZoom on the map instance so the moveend/zoomend listener (in
		// the bridge script) can convert the real Leaflet zoom back into the
		// block's imageZoom offset when the user pans/zooms the image map by hand.
		map.bflmFitZoom = fitZoom;
	}
	fitImage();
} )();
JS;
}

/**
 * Main iframe↔editor bridge script (formerly the large inline <script> before
 * wp_footer()).
 *
 * Reads all per-request values from window.bflmPreviewData, set by the "before"
 * data script in template.php.
 *
 * @return string JavaScript.
 */
function bflm_preview_bridge_js(): string {
	return <<<'JS'
( function () {
	var data               = window.bflmPreviewData || {};
	var blockId            = data.blockId;
	var minZoom            = data.minZoom != null ? data.minZoom : null;
	var maxZoom            = data.maxZoom != null ? data.maxZoom : null;
	var maxBoundsRaw       = data.maxBounds || '';
	var realMarkerCount    = data.realMarkerCount || 0;
	var linePointMeta      = data.linePointMeta || [];
	var attempts           = 0;
	var MAX_ATTEMPTS       = 50;
	var isProgrammaticMove = false;

	// ── Editor reply channel (Playground-safe) ────────────────────────────────
	// Outbound messages used to go to window.top on the assumption that the
	// wp-admin editor page is the top browsing context. Inside WordPress
	// Playground (wp.org "Live Preview") the whole site runs in nested iframes,
	// so window.top is the Playground shell and messages sent there are lost.
	// Instead, capture event.source from the first message the editor sends
	// (edit.js posts bflm_editor_hello on iframe load) and reply to that
	// window — correct at any nesting depth. window.top stays as the fallback
	// until the handshake arrives, so the classic wp-admin case keeps working
	// even if the hello never comes.
	var editorWindow   = null;
	var readyAnnounced = false;

	function postToEditor( message ) {
		( editorWindow || window.top ).postMessage( message, '*' );
	}

	// Registered immediately — NOT inside init() — so the editor's hello is not
	// missed while init() is still polling for the Leaflet map instance.
	window.addEventListener( 'message', function ( e ) {
		if ( ! e.data || 'string' !== typeof e.data.type || e.data.blockId !== blockId || ! e.source ) {
			return;
		}
		var firstContact = null === editorWindow;
		editorWindow     = e.source;
		// If the map announced readiness before the handshake (that message
		// went to window.top and was lost in Playground), repeat it to the
		// now-known editor window so draw-mode re-sync still works.
		if ( firstContact && readyAnnounced ) {
			postToEditor( { type: 'bflm_iframe_ready', blockId: blockId } );
		}
	} );

	// ── Draw mode state ───────────────────────────────────────────────────────
	// Holds the in-progress drawing overlays for click-to-draw mode.
	// All drawing happens client-side; each click also posts bflm_draw_point
	// to the editor so it can update block attributes (and thus undo history).
	var drawState = {
		active:    false,
		lineIndex: null,
		lineType:  'line',
		points:    [],
		pins:      [],
		shape:     null,
	};

	// Inline red pin icon used for draw-mode points (L.divIcon, no asset file).
	var DRAW_PIN_ICON = null;
	function getDrawPinIcon() {
		if ( DRAW_PIN_ICON ) return DRAW_PIN_ICON;
		var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 36" width="28" height="36">' +
			'<circle cx="14" cy="12" r="11" fill="#e53e3e" stroke="#fff" stroke-width="2"/>' +
			'<circle cx="10" cy="9" r="3" fill="rgba(255,255,255,0.35)"/>' +
			'<path d="M14 22 L9 36 L14 30 L19 36 Z" fill="#4a4a4a"/>' +
			'</svg>';
		DRAW_PIN_ICON = L.divIcon( {
			html:      svg,
			className: 'bflm-draw-pin',
			iconSize:    [ 28, 36 ],
			iconAnchor:  [ 14, 34 ],
		} );
		return DRAW_PIN_ICON;
	}

	function clearDrawPins() {
		drawState.pins.forEach( function ( pin ) { pin.remove(); } );
		drawState.pins = [];
	}

	function clearDrawOverlays( map ) {
		clearDrawPins();
		if ( drawState.shape ) {
			drawState.shape.remove();
			drawState.shape = null;
		}
		map.getContainer().style.cursor = '';
	}

	function startDraw( map, msg ) {
		clearDrawOverlays( map );
		drawState.active    = true;
		drawState.lineIndex = msg.lineIndex;
		drawState.lineType  = msg.lineType || 'line';
		drawState.points    = ( msg.existingPoints || [] ).map( function ( p ) {
			return [ p.lat, p.lng ];
		} );

		var strokeColor  = msg.color       || '#3388ff';
		var fillColor    = msg.fillColor   || '#3388ff';
		var fillOpacity  = msg.fillOpacity != null ? msg.fillOpacity : 0.2;

		// Render existing points as pins.
		drawState.points.forEach( function ( ll ) {
			var pin = L.marker( ll, { icon: getDrawPinIcon(), zIndexOffset: 1000 } ).addTo( map );
			drawState.pins.push( pin );
		} );

		// Create the live shape overlay.
		if ( drawState.lineType === 'polygon' ) {
			drawState.shape = L.polygon( drawState.points.length ? drawState.points : [ [ 0, 0 ] ], {
				color:       strokeColor,
				fillColor:   fillColor,
				fillOpacity: fillOpacity,
				weight:      2,
				interactive: false,
			} ).addTo( map );
		} else {
			drawState.shape = L.polyline( drawState.points.length ? drawState.points : [ [ 0, 0 ] ], {
				color:       strokeColor,
				weight:      2,
				interactive: false,
			} ).addTo( map );
		}
		if ( 1 > drawState.points.length ) {
			drawState.shape.setLatLngs( [] );
		}

		map.doubleClickZoom.disable();
		map.getContainer().style.cursor = 'crosshair';
	}

	function stopDraw( map ) {
		// Keep drawState.shape on the map so the line/polygon remains visible
		// without an iframe reload. Only remove the temporary draw pins.
		clearDrawPins();
		map.getContainer().style.cursor = '';
		drawState.active    = false;
		drawState.lineIndex = null;
		drawState.points    = [];
		drawState.shape     = null; // shape stays on map; we just drop the ref
		map.doubleClickZoom.enable();
	}

	// ── Circle draw mode state ────────────────────────────────────────────────
	// Two-click flow: phase 'center' (1st click) then phase 'edge' (2nd click).
	// After the 2nd click the center pin becomes draggable to reposition the circle.
	var circleDrawState = {
		active:      false,
		circleIndex: null,
		phase:       'center', // 'center' | 'edge'
		center:      null,     // [lat, lng]
		color:       '#3388ff',
		fillColor:   '#3388ff',
		fillOpacity: 0.2,
		shape:       null,     // L.circle — kept on map after draw ends
		preview:     null,     // L.marker (center pin) — stays as draggable handle
		guideLine:   null,     // L.polyline radius guide — removed after 2nd click
	};

	function clearCircleGuideLine() {
		if ( circleDrawState.guideLine ) {
			circleDrawState.guideLine.remove();
			circleDrawState.guideLine = null;
		}
	}

	function clearCirclePreview() {
		clearCircleGuideLine();
		if ( circleDrawState.preview ) {
			circleDrawState.preview.remove();
			circleDrawState.preview = null;
		}
	}

	function makeCenterDraggable( map ) {
		var pin = circleDrawState.preview;
		if ( ! pin ) return;
		pin.options.draggable = true;
		pin.dragging.enable();
		pin.on( 'dragstart', function () {
			// Prevent map drag from interfering.
			map.dragging.disable();
		} );
		pin.on( 'drag', function () {
			var ll = pin.getLatLng();
			if ( circleDrawState.shape ) {
				circleDrawState.shape.setLatLng( ll );
			}
		} );
		pin.on( 'dragend', function () {
			map.dragging.enable();
			var ll = pin.getLatLng();
			circleDrawState.center = [ ll.lat, ll.lng ];
			if ( circleDrawState.shape ) {
				circleDrawState.shape.setLatLng( ll );
			}
			postToEditor(
				{
					type:        'bflm_draw_circle_center',
					blockId:     blockId,
					circleIndex: circleDrawState.circleIndex,
					lat:         parseFloat( ll.lat.toFixed( 6 ) ),
					lng:         parseFloat( ll.lng.toFixed( 6 ) ),
				}
			);
		} );
	}

	function startCircleDraw( map, msg ) {
		// Always start fresh at phase='center' — user must click to place the
		// center. Any previous draw overlays (pin, shape, guide) are cleared.
		clearCirclePreview();
		if ( circleDrawState.shape ) {
			circleDrawState.shape.remove();
			circleDrawState.shape = null;
		}

		circleDrawState.active      = true;
		circleDrawState.circleIndex = msg.circleIndex;
		circleDrawState.phase       = 'center';
		circleDrawState.center      = null;
		circleDrawState.color       = msg.color       || '#3388ff';
		circleDrawState.fillColor   = msg.fillColor   || '#3388ff';
		circleDrawState.fillOpacity = msg.fillOpacity != null ? msg.fillOpacity : 0.2;

		map.doubleClickZoom.disable();
		map.getContainer().style.cursor = 'crosshair';
	}

	function stopCircleDraw( map ) {
		// Keep shape and center pin on the map — no reload needed.
		// Remove only the radius guide line.
		clearCircleGuideLine();
		map.getContainer().style.cursor = '';
		circleDrawState.active = false;
		circleDrawState.phase  = 'center';
		// Drop refs but leave shape + preview (center pin) in Leaflet's layer tree.
		circleDrawState.shape  = null;
		circleDrawState.center = null;
		// circleIndex kept briefly so the dragend handler can still post the right index.
		// Reset fully after a tick so the last dragend (if any) fires first.
		setTimeout( function () { circleDrawState.circleIndex = null; }, 0 );
		map.doubleClickZoom.enable();
	}

	/**
	 * Poll for the Leaflet Map plugin's map instance, then wire up
	 * bidirectional postMessage communication with the editor frame.
	 *
	 * Outbound messages go through postToEditor() (see top of file): the editor
	 * window captured from the bflm_editor_hello handshake, with window.top as
	 * the pre-handshake fallback. Nesting depth varies — two levels in classic
	 * wp-admin (admin frame → WP canvas iframe → this iframe), deeper inside
	 * WordPress Playground — so no fixed ancestor is assumed.
	 *
	 * '*' is used as the target origin for postMessage. Both this iframe and
	 * the editor run on the same WordPress origin (admin-ajax.php / wp-admin),
	 * so this is safe. Restrict to a specific origin for stricter isolation.
	 *
	 * blockId scopes every message to this specific block instance so that
	 * multiple map blocks on the same page do not interfere with each other.
	 */
	function init() {
		var plugin = window.WPLeafletMapPlugin;
		if ( ! plugin || ! plugin.maps || ! plugin.maps[ 0 ] ) {
			if ( MAX_ATTEMPTS > ++attempts ) {
				setTimeout( init, 200 );
			}
			return;
		}

		var map     = plugin.maps[ 0 ];
		var markers = plugin.markers || [];

		// setTimeout 200ms after init — by then CSS has applied the container's
		// final percentage-width size so invalidateSize gets the correct dimensions.
		setTimeout( function () { map.invalidateSize(); }, 200 );

		// Apply zoom & bounds constraints if set. Skip for image maps: their
		// own fitImage() (in the bflm-preview-imagefit script) computes and sets
		// minZoom/maxBounds from the image's real dimensions — these tile-map
		// constraints (inherited from the block's regular minZoom/maxZoom
		// attributes) would otherwise clobber that fit, since this init() poll
		// has no guaranteed ordering against fitImage()'s own poll.
		if ( ! map.is_image_map ) {
			if ( minZoom !== null ) {
				map.setMinZoom( minZoom );
			}
			if ( maxZoom !== null ) {
				map.setMaxZoom( maxZoom );
			}
			if ( maxBoundsRaw ) {
				try {
					var parts  = maxBoundsRaw.split( ';' );
					var sw     = parts[ 0 ].split( ',' );
					var ne     = parts[ 1 ].split( ',' );
					var bounds = [ [ parseFloat( sw[ 0 ] ), parseFloat( sw[ 1 ] ) ], [ parseFloat( ne[ 0 ] ), parseFloat( ne[ 1 ] ) ] ];
					if ( bounds.every( function ( p ) { return ! isNaN( p[ 0 ] ) && ! isNaN( p[ 1 ] ); } ) ) {
						map.setMaxBounds( bounds );
					}
				} catch ( e ) { /* ignore malformed input */ }
			} else {
				map.setMaxBounds( null );
			}
		}

		// User starts/ends a drag → tell the editor to suppress the
		// focus-restoring overlay so it doesn't get remounted on top of the
		// iframe mid-gesture (Gutenberg's isSelected flips false the moment
		// focus crosses into this iframe's separate browsing context).
		map.on( 'dragstart', function () {
			postToEditor( { type: 'bflm_map_drag_start', blockId: blockId } );
		} );
		map.on( 'dragend', function () {
			postToEditor( { type: 'bflm_map_drag_end', blockId: blockId } );
		} );

		// User pans / zooms → notify the editor. Image maps report through a
		// separate message (bflm_image_update): their shortcode always keeps
		// zoom="0" and uses imageX/imageY/imageZoom instead of lat/lng/zoom,
		// so the real Leaflet zoom (fitZoom + imageZoom offset) must be
		// converted back to an offset using the fitZoom stashed by fitImage().
		map.on( 'moveend zoomend', function () {
			if ( isProgrammaticMove ) {
				return;
			}
			var center = map.getCenter();
			if ( map.is_image_map ) {
				if ( 'number' !== typeof map.bflmFitZoom ) {
					return;
				}
				postToEditor(
					{
						type:      'bflm_image_update',
						blockId:   blockId,
						imageX:    center.lat,
						imageY:    center.lng,
						imageZoom: map.getZoom() - map.bflmFitZoom,
					}
				);
				return;
			}
			postToEditor(
				{ type: 'bflm_map_update', blockId: blockId, lat: center.lat, lng: center.lng, zoom: map.getZoom() }
			);
		} );

		// Make each real marker draggable and relay dragend to the editor.
		markers.slice( 0, realMarkerCount ).forEach( function ( marker, i ) {
			if ( marker.dragging && ! marker.dragging.enabled() ) {
				marker.dragging.enable();
			}
			marker.on( 'dragend', function ( e ) {
				var pos = e.target.getLatLng();
				postToEditor(
					{ type: 'bflm_marker_update', blockId: blockId, index: i, lat: pos.lat, lng: pos.lng }
				);
			} );
		} );

		// Make each line-point helper marker draggable and relay dragend.
		markers.slice( realMarkerCount ).forEach( function ( marker, i ) {
			var meta = linePointMeta[ i ];
			if ( ! meta ) return;
			if ( marker.dragging && ! marker.dragging.enabled() ) {
				marker.dragging.enable();
			}
			marker.on( 'dragend', function ( e ) {
				var pos = e.target.getLatLng();
				postToEditor(
					{ type: 'bflm_linepoint_update', blockId: blockId, lineIndex: meta.lineIndex, pointIndex: meta.pointIndex, lat: pos.lat, lng: pos.lng }
				);
			} );
		} );

		// ── Overlay corner-resize + move handles ────────────────────────────────
		// Each image/video overlay gets 4 draggable corner markers (SW/SE/NW/NE)
		// to adjust its bounds, plus a centre marker to drag the whole overlay
		// without resizing it — instead of typing lat/lng pairs by hand.
		// plugin.overlays is populated in the same document order as the
		// [leaflet-image-overlay]/[leaflet-video-overlay] shortcodes emitted by
		// bflm_build_overlay_shortcodes() (includes/shortcodes/overlay.php), so
		// array index here matches the overlays attribute index in edit.js.
		// Handle drags must not start/extend the underlying map pan — markers
		// already stop their own propagation to the map's click/dblclick chain,
		// but Leaflet's drag handler still lets the originalEvent bubble to the
		// document, so map.dragging stays untouched here regardless.
		var CORNER_ICON = L.divIcon( {
			className: 'bflm-overlay-handle',
			iconSize:  [ 12, 12 ],
		} );
		var MOVE_ICON = L.divIcon( {
			className: 'bflm-overlay-move-handle',
			iconSize:  [ 18, 18 ],
		} );

		/**
		 * Wire the 4 corner-resize handles + 1 move handle for a single overlay
		 * layer. Extracted to a named function (rather than an inline forEach
		 * callback) so it can be re-invoked by rebuildOverlays() after a live
		 * bflm_set_overlays postMessage replaces the overlay layers — not just
		 * once at initial page load.
		 *
		 * @param {L.ImageOverlay|L.VideoOverlay} layer        The overlay layer.
		 * @param {number}                        overlayIndex Index matching the
		 *                                                      `overlays` block attribute.
		 */
		function setupOverlayHandles( layer, overlayIndex ) {
			if ( ! layer.getBounds ) {
				return;
			}

			var corners = {};
			var moveHandle;
			var moveDragStart = null;

			function cornersFromBounds( b ) {
				return {
					sw: b.getSouthWest(),
					se: L.latLng( b.getSouth(), b.getEast() ),
					nw: L.latLng( b.getNorth(), b.getWest() ),
					ne: b.getNorthEast(),
				};
			}

			function postOverlayUpdate( bounds ) {
				postToEditor(
					{
						type:         'bflm_overlay_update',
						blockId:      blockId,
						overlayIndex: overlayIndex,
						sw:           bounds.getSouthWest().lat + ',' + bounds.getSouthWest().lng,
						ne:           bounds.getNorthEast().lat + ',' + bounds.getNorthEast().lng,
					}
				);
			}

			/** Re-derive bounds from the two opposite-corner handles being dragged and apply to the layer + the other two handles. */
			function applyCorner( key, latlng ) {
				var b      = layer.getBounds();
				var sw     = b.getSouthWest();
				var ne     = b.getNorthEast();
				var newSw  = L.latLng( sw.lat, sw.lng );
				var newNe  = L.latLng( ne.lat, ne.lng );

				if ( key === 'sw' ) {
					newSw = latlng;
				} else if ( key === 'ne' ) {
					newNe = latlng;
				} else if ( key === 'se' ) {
					newSw = L.latLng( latlng.lat, newSw.lng );
					newNe = L.latLng( newNe.lat, latlng.lng );
				} else if ( key === 'nw' ) {
					newSw = L.latLng( newSw.lat, latlng.lng );
					newNe = L.latLng( latlng.lat, newNe.lng );
				}

				var newBounds = L.latLngBounds( newSw, newNe );
				layer.setBounds( newBounds );

				var c = cornersFromBounds( newBounds );
				Object.keys( corners ).forEach( function ( k ) {
					if ( k !== key ) {
						corners[ k ].setLatLng( c[ k ] );
					}
				} );
				moveHandle.setLatLng( newBounds.getCenter() );

				return newBounds;
			}

			var initialCorners = cornersFromBounds( layer.getBounds() );

			[ 'sw', 'se', 'nw', 'ne' ].forEach( function ( key ) {
				var handle = L.marker( initialCorners[ key ], {
					icon:        CORNER_ICON,
					draggable:   true,
					zIndexOffset: 2000,
				} ).addTo( map );

				handle.on( 'drag', function ( e ) {
					applyCorner( key, e.target.getLatLng() );
				} );

				handle.on( 'dragend', function () {
					postOverlayUpdate( layer.getBounds() );
				} );

				corners[ key ] = handle;
			} );

			// Centre handle: drags the whole overlay (translate, no resize).
			moveHandle = L.marker( layer.getBounds().getCenter(), {
				icon:         MOVE_ICON,
				draggable:    true,
				zIndexOffset: 1900,
			} ).addTo( map );

			moveHandle.on( 'dragstart', function ( e ) {
				moveDragStart = {
					handleLatLng: e.target.getLatLng(),
					bounds:       layer.getBounds(),
				};
			} );

			moveHandle.on( 'drag', function ( e ) {
				if ( ! moveDragStart ) {
					return;
				}
				var current = e.target.getLatLng();
				var dLat    = current.lat - moveDragStart.handleLatLng.lat;
				var dLng    = current.lng - moveDragStart.handleLatLng.lng;
				var sw      = moveDragStart.bounds.getSouthWest();
				var ne      = moveDragStart.bounds.getNorthEast();
				var newBounds = L.latLngBounds(
					L.latLng( sw.lat + dLat, sw.lng + dLng ),
					L.latLng( ne.lat + dLat, ne.lng + dLng )
				);

				layer.setBounds( newBounds );
				var c = cornersFromBounds( newBounds );
				Object.keys( corners ).forEach( function ( k ) {
					corners[ k ].setLatLng( c[ k ] );
				} );
			} );

			moveHandle.on( 'dragend', function () {
				moveDragStart = null;
				postOverlayUpdate( layer.getBounds() );
			} );

			// Cmd/Ctrl + drag directly on the image: same translate as the move
			// handle, but without needing to grab the small centre dot. Plain
			// drag on the image still pans the map (Leaflet's default), so the
			// modifier key is what disambiguates "move the image" from
			// "pan the map" when the cursor is over the overlay.
			var imgDragStart = null;

			function onImgMouseDown( e ) {
				if ( ! ( e.metaKey || e.ctrlKey ) ) {
					return;
				}
				L.DomEvent.stop( e );
				map.dragging.disable();
				imgDragStart = {
					containerPoint: map.mouseEventToContainerPoint( e ),
					bounds:         layer.getBounds(),
				};
				document.addEventListener( 'mousemove', onImgMouseMove );
				document.addEventListener( 'mouseup', onImgMouseUp );
			}

			function onImgMouseMove( e ) {
				if ( ! imgDragStart ) {
					return;
				}
				var current  = map.mouseEventToLatLng( e );
				var start     = map.containerPointToLatLng( imgDragStart.containerPoint );
				var dLat      = current.lat - start.lat;
				var dLng      = current.lng - start.lng;
				var sw        = imgDragStart.bounds.getSouthWest();
				var ne        = imgDragStart.bounds.getNorthEast();
				var newBounds = L.latLngBounds(
					L.latLng( sw.lat + dLat, sw.lng + dLng ),
					L.latLng( ne.lat + dLat, ne.lng + dLng )
				);

				layer.setBounds( newBounds );
				moveHandle.setLatLng( newBounds.getCenter() );
				var c = cornersFromBounds( newBounds );
				Object.keys( corners ).forEach( function ( k ) {
					corners[ k ].setLatLng( c[ k ] );
				} );
			}

			function onImgMouseUp() {
				document.removeEventListener( 'mousemove', onImgMouseMove );
				document.removeEventListener( 'mouseup', onImgMouseUp );
				map.dragging.enable();
				if ( imgDragStart ) {
					imgDragStart = null;
					postOverlayUpdate( layer.getBounds() );
				}
			}

			layer.on( 'add', function () {
				var el = layer.getElement();
				if ( el ) {
					el.addEventListener( 'mousedown', onImgMouseDown );
				}
			} );
			if ( map.hasLayer( layer ) ) {
				var existingEl = layer.getElement();
				if ( existingEl ) {
					existingEl.addEventListener( 'mousedown', onImgMouseDown );
				}
			}
		}

		( plugin.overlays || [] ).forEach( setupOverlayHandles );

		/**
		 * Live rebuild of every overlay layer for this block, used by the
		 * bflm_set_overlays message handler below. Removes all current overlay
		 * layers (and their handles) from the map, then recreates them from
		 * `newOverlays` using the SAME option set as bflm_build_overlay_shortcodes()
		 * (includes/shortcodes/overlay.php) / buildOverlayShortcodes() (edit.js),
		 * so the live preview matches the eventual shortcode-rendered output.
		 *
		 * Overlays with empty src or bounds are skipped, mirroring the PHP/JS
		 * shortcode builders. Bounds are parsed from "lat1,lng1;lat2,lng2".
		 *
		 * Corner-resize + move handles are re-wired via setupOverlayHandles()
		 * after recreation so dragging keeps working without a full reload.
		 *
		 * @param {Array<Object>} newOverlays Overlay objects from the `overlays` block attribute.
		 */
		function rebuildOverlays( newOverlays ) {
			// Remove existing overlay layers (e.g. handle markers stay attached
			// to layers we're about to discard — Leaflet GC's their listeners
			// when the layer itself is removed from the map).
			( plugin.overlays || [] ).forEach( function ( layer ) {
				if ( map.hasLayer( layer ) ) {
					map.removeLayer( layer );
				}
			} );
			// Remove any leftover corner/move handle markers from the previous
			// set — they are plain L.marker instances added directly to `map`,
			// not tracked anywhere else, so find them by icon class.
			map.eachLayer( function ( l ) {
				if (
					l instanceof L.Marker &&
					l.options &&
					l.options.icon &&
					l.options.icon.options &&
					( 'bflm-overlay-handle' === l.options.icon.options.className ||
						'bflm-overlay-move-handle' === l.options.icon.options.className )
				) {
					map.removeLayer( l );
				}
			} );

			plugin.overlays = [];

			( newOverlays || [] ).forEach( function ( overlay ) {
				var src    = ( overlay.src || '' ).toString().trim();
				var bounds = ( overlay.bounds || '' ).toString().trim();
				if ( ! src || ! bounds ) {
					return;
				}

				var parts = bounds.split( /[;,]/ ).map( parseFloat );
				if ( parts.length < 4 || parts.some( isNaN ) ) {
					return;
				}
				var llBounds = [ [ parts[ 0 ], parts[ 1 ] ], [ parts[ 2 ], parts[ 3 ] ] ];

				var options = {};
				if ( null != overlay.opacity ) options.opacity = parseFloat( overlay.opacity );
				if ( overlay.interactive ) options.interactive = true;
				if ( overlay.alt && overlay.alt.toString().trim() ) options.alt = overlay.alt.toString().trim();
				if ( null != overlay.zIndex ) options.zIndex = parseInt( overlay.zIndex, 10 );
				if ( overlay.classname && overlay.classname.toString().trim() ) options.className = overlay.classname.toString().trim();
				if ( 'video' !== overlay.type && false === overlay.keepAspectRatio ) options.keepAspectRatio = false;

				var layer = 'video' === overlay.type
					? L.videoOverlay( src, llBounds, options )
					: L.imageOverlay( src, llBounds, options );

				layer.addTo( plugin.getCurrentGroup() );
				plugin.overlays.push( layer );
			} );

			plugin.overlays.forEach( setupOverlayHandles );
		}

		// fitBounds: when enabled, adjust the map to contain all markers.
		// Guarded by isProgrammaticMove (same pattern as bflm_set_view) so the
		// resulting moveend does not post bflm_map_update back to the editor —
		// otherwise the editor would update lat/lng/zoom attributes, which changes
		// the preview URL, which reloads the iframe, which calls fitBounds again,
		// looping forever (see issue #23).
		var fitMarkersEnabled = !! data.fitMarkers;
		if ( fitMarkersEnabled && markers.length > 0 ) {
			var bounds = [];
			markers.forEach( function ( marker ) {
				var ll = marker.getLatLng();
				bounds.push( [ ll.lat, ll.lng ] );
			} );
			if ( bounds.length > 0 ) {
				isProgrammaticMove = true;
				map.once( 'moveend', function () {
					isProgrammaticMove = false;
				} );
				map.fitBounds( bounds, { padding: [ 30, 30 ] } );
			}
		}

		// ── Click-to-draw handlers ────────────────────────────────────────────
		// map.on('click') fires for single clicks; map.on('dblclick') for double.
		// Leaflet fires 'click' twice before 'dblclick' — use a small timeout to
		// suppress the spurious single-click that precedes a double-click.
		// ── Mousemove: live radius guide during circle edge phase ────────────
		map.on( 'mousemove', function ( e ) {
			if ( ! circleDrawState.active || circleDrawState.phase !== 'edge' ) return;
			var mlat = e.latlng.lat;
			var mlng = e.latlng.lng;
			var r = map.distance( circleDrawState.center, [ mlat, mlng ] );
			// Update live circle radius.
			if ( circleDrawState.shape ) {
				circleDrawState.shape.setRadius( 1 > r ? 1 : r );
			}
			// Update guide line from center to cursor.
			if ( circleDrawState.guideLine ) {
				circleDrawState.guideLine.setLatLngs( [ circleDrawState.center, [ mlat, mlng ] ] );
			}
		} );

		var clickTimer = null;
		map.on( 'click', function ( e ) {
			// ── Circle draw (2-click: center then edge) ───────────────────────
			if ( circleDrawState.active ) {
				var clat = e.latlng.lat;
				var clng = e.latlng.lng;
				if ( circleDrawState.phase === 'center' ) {
					// First click: place center pin, start L.circle (r=1) + guide line.
					circleDrawState.center  = [ clat, clng ];
					circleDrawState.phase   = 'edge';
					circleDrawState.preview = L.marker(
						[ clat, clng ],
						{ icon: getDrawPinIcon(), draggable: false, zIndexOffset: 1000 }
					).addTo( map );
					circleDrawState.shape = L.circle( [ clat, clng ], {
						radius:      1,
						color:       circleDrawState.color,
						fillColor:   circleDrawState.fillColor,
						fillOpacity: circleDrawState.fillOpacity,
						weight:      2,
						interactive: false,
					} ).addTo( map );
					circleDrawState.guideLine = L.polyline(
						[ [ clat, clng ], [ clat, clng ] ],
						{ color: '#888', weight: 1, dashArray: '4,6', interactive: false }
					).addTo( map );
					postToEditor(
						{ type: 'bflm_draw_circle_center', blockId: blockId, circleIndex: circleDrawState.circleIndex, lat: clat, lng: clng }
					);
				} else {
					// Second click: fix radius, remove guide, make center draggable.
					var radius = map.distance( circleDrawState.center, [ clat, clng ] );
					if ( 1 > radius ) radius = 1;
					if ( circleDrawState.shape ) {
						circleDrawState.shape.setRadius( radius );
					}
					clearCircleGuideLine();
					// Convert center pin to draggable handle for repositioning.
					makeCenterDraggable( map );
					postToEditor(
						{ type: 'bflm_draw_circle_radius', blockId: blockId, circleIndex: circleDrawState.circleIndex, radius: radius }
					);
					var ci = circleDrawState.circleIndex;
					stopCircleDraw( map );
					postToEditor(
						{ type: 'bflm_draw_circle_end_request', blockId: blockId, circleIndex: ci }
					);
				}
				return;
			}

			// ── Line/polygon draw ─────────────────────────────────────────────
			if ( ! drawState.active ) return;
			// Defer by 250ms; dblclick will clear this timer so only one point
			// is added per double-click (the dblclick ends drawing instead).
			clearTimeout( clickTimer );
			clickTimer = setTimeout( function () {
				var lat = e.latlng.lat;
				var lng = e.latlng.lng;
				drawState.points.push( [ lat, lng ] );

				// Add a red pin at this point.
				var pin = L.marker( [ lat, lng ], { icon: getDrawPinIcon(), zIndexOffset: 1000 } ).addTo( map );
				drawState.pins.push( pin );

				// Update live shape preview.
				if ( drawState.shape ) {
					drawState.shape.setLatLngs( drawState.points );
				}

				// Notify the editor so it can update block attributes + undo history.
				postToEditor(
					{ type: 'bflm_draw_point', blockId: blockId, lineIndex: drawState.lineIndex, lat: lat, lng: lng }
				);
			}, 250 );
		} );

		map.on( 'dblclick', function ( e ) {
			if ( ! drawState.active ) return;
			// Cancel the pending single-click so no extra point is added.
			clearTimeout( clickTimer );
			// Leaflet's default dblclick zoom is already disabled in draw mode.
			L.DomEvent.stopPropagation( e );
			var li = drawState.lineIndex;
			stopDraw( map );
			postToEditor(
				{ type: 'bflm_draw_end_request', blockId: blockId, lineIndex: li }
			);
		} );

		// ── Inbound messages from the editor ─────────────────────────────────
		window.addEventListener( 'message', function ( e ) {
			if ( ! e.data || typeof e.data.type !== 'string' || e.data.blockId !== blockId ) {
				return;
			}
			var msg = e.data;

			if ( msg.type === 'bflm_set_view' ) {
				isProgrammaticMove = true;
				map.once( 'moveend', function () {
					isProgrammaticMove = false;
				} );
				map.setView( [ msg.lat, msg.lng ], msg.zoom, { animate: true } );
				return;
			}

			if ( msg.type === 'bflm_set_interaction' ) {
				// Three-state values arrive as 'true' / 'false' / '' (default,
				// left untouched — the constructor option already applied it).
				// Each Leaflet interaction handler exposes enable()/disable(),
				// so toggling here avoids waiting for a full iframe reload.
				[ 'dragging', 'keyboard', 'doubleClickZoom', 'boxZoom', 'tap' ].forEach( function ( key ) {
					if ( ! ( key in msg ) || '' === msg[ key ] || ! map[ key ] ) {
						return;
					}
					if ( 'true' === msg[ key ] ) {
						map[ key ].enable();
					} else if ( 'false' === msg[ key ] ) {
						map[ key ].disable();
					}
				} );
				return;
			}

			if ( msg.type === 'bflm_set_image_view' ) {
				if ( 'number' !== typeof map.bflmFitZoom ) {
					return;
				}
				isProgrammaticMove = true;
				map.once( 'moveend', function () {
					isProgrammaticMove = false;
				} );
				map.setView( [ msg.imageX, msg.imageY ], map.bflmFitZoom + msg.imageZoom, { animate: true } );
				return;
			}

			if ( msg.type === 'bflm_set_overlays' ) {
				// Live overlay edits (src/bounds/opacity/etc.) — rebuild every
				// overlay layer for this block without reloading the iframe.
				// Adding/removing an overlay also lands here (the editor sends
				// the full overlays array either way), but the editor only
				// forces a full iframe reload on COUNT changes (see
				// previewUrlKey in edit.js) — this handler keeps the live
				// preview correct regardless of which case triggered it.
				rebuildOverlays( msg.overlays || [] );
				return;
			}

			if ( msg.type === 'bflm_draw_start' ) {
				startDraw( map, msg );
				return;
			}

			if ( msg.type === 'bflm_draw_end' ) {
				stopDraw( map );
				return;
			}

			if ( msg.type === 'bflm_draw_circle_start' ) {
				startCircleDraw( map, msg );
				return;
			}

			if ( msg.type === 'bflm_draw_circle_end' ) {
				stopCircleDraw( map );
				return;
			}
		} );

		// Signal the editor that this iframe is ready (or has rebuilt).
		// The editor uses this to re-send bflm_draw_start if a line was in draw
		// mode when an attribute change triggered a full iframe reload.
		// readyAnnounced lets the hello handshake handler (top of file) repeat
		// this message if it fired before the editor window was known.
		readyAnnounced = true;
		postToEditor(
			{ type: 'bflm_iframe_ready', blockId: blockId }
		);
	}

	init();
}() );
JS;
}
