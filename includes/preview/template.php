<?php
/**
 * Preview-endpoint HTML template.
 *
 * Receives the canonical attrs array from bflm_preview_normalise_input() and
 * emits the full self-contained HTML page that the editor iframe loads. All
 * shortcode building goes through the shared bflm_build_*_shortcodes() helpers
 * in includes/shortcodes/. The inline JS bridges the iframe to edit.js via
 * window.top.postMessage.
 *
 * @package BlocksForLeafletMap
 */

defined( 'ABSPATH' ) || exit;

/**
 * Render the complete preview page (HTML + inline JS).
 *
 * Echoes directly. The caller (bflm_preview_map() in endpoint.php) is
 * responsible for the trailing die().
 *
 * @param array<string,mixed> $attrs Canonical attrs from bflm_preview_normalise_input().
 * @return void
 */
function bflm_preview_render_template( array $attrs ): void {
	// Shortcode strings to feed do_shortcode().
	$marker_shortcodes = bflm_build_marker_shortcodes( isset( $attrs['markers'] ) && is_array( $attrs['markers'] ) ? $attrs['markers'] : array() );
	$line_shortcodes   = bflm_build_line_shortcodes( isset( $attrs['lines'] ) && is_array( $attrs['lines'] ) ? $attrs['lines'] : array() );
	$circle_shortcodes = bflm_build_circle_shortcodes( isset( $attrs['circles'] ) && is_array( $attrs['circles'] ) ? $attrs['circles'] : array() );
	$layer_shortcodes  = bflm_build_layer_shortcodes( isset( $attrs['layers'] ) && is_array( $attrs['layers'] ) ? $attrs['layers'] : array() );
	$overlay_shortcodes = bflm_build_overlay_shortcodes( isset( $attrs['overlays'] ) && is_array( $attrs['overlays'] ) ? $attrs['overlays'] : array() );

	// Editor-only draw-mode helper pins (markers shown for partially-drawn lines).
	$line_helpers          = bflm_build_line_point_helpers( isset( $attrs['lines'] ) && is_array( $attrs['lines'] ) ? $attrs['lines'] : array() );
	$line_point_shortcodes = $line_helpers['shortcodes'];
	$line_point_meta       = $line_helpers['meta'];

	// Real-marker count = markers passed by the editor that are renderable
	// (had lat+lng). The line-point helpers come after them in the marker layer
	// list, so the JS uses this to slice draggable real markers vs draw helpers.
	$real_marker_count = 0;
	$markers           = isset( $attrs['markers'] ) && is_array( $attrs['markers'] ) ? $attrs['markers'] : array();
	foreach ( $markers as $marker ) {
		if ( isset( $marker['lat'], $marker['lng'] ) ) {
			++$real_marker_count;
		}
	}

	// Build the right top-level shortcode for the chosen mode.
	$is_image_map  = ! empty( $attrs['imageMap'] ) && '' !== $attrs['imageSrc'];
	$wms_enabled   = ! $is_image_map && ! empty( $attrs['wmsEnabled'] );
	$map_shortcode = bflm_build_map_shortcode( $attrs );
	$wms_shortcode = $wms_enabled ? bflm_build_wms_shortcode( $attrs ) : '';
	$image_shortcode = $is_image_map ? bflm_build_image_shortcode( $attrs ) : '';

	// JSON values pre-computed for the inline JS.
	$block_id     = isset( $attrs['blockId'] ) ? (string) $attrs['blockId'] : '';
	$min_zoom     = isset( $attrs['minZoom'] ) ? (string) $attrs['minZoom'] : '';
	$max_zoom     = isset( $attrs['maxZoom'] ) ? (string) $attrs['maxZoom'] : '';
	$max_bounds   = isset( $attrs['maxBounds'] ) ? (string) $attrs['maxBounds'] : '';
	$fit_markers  = ! empty( $attrs['fitMarkers'] );
	$image_zoom   = isset( $attrs['imageZoom'] ) ? (float) $attrs['imageZoom'] : 0.0;

	// Render a complete, self-contained HTML page.
	// wp_head() / wp_footer() let the Leaflet Map plugin load its own assets.
	?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>">
<meta name="referrer" content="origin">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
	* { box-sizing: border-box; }
	html, body { margin: 0; padding: 0; background: #fff; overflow: hidden; }
	#map-wrap { width: 100%; }
	/* Draw-mode pin — reset Leaflet's default marker background/shadow */
	.bflm-draw-pin { background: none; border: none; }
</style>
	<?php wp_head(); ?>
</head>
<body>
<div id="map-wrap">
	<?php
	// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- trusted shortcode output, same rationale as render.php.
	if ( $is_image_map ) {
		echo do_shortcode( $image_shortcode . $marker_shortcodes . $line_shortcodes . $line_point_shortcodes . $circle_shortcodes ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		?>
		<script>
		( function () {
			var zoomOffset = <?php echo (float) $image_zoom; ?>;
			var attempts   = 0;
			function fitImage() {
				var plugin = window.WPLeafletMapPlugin;
				if ( ! plugin || ! plugin.maps || ! plugin.maps[ 0 ] ) {
					if ( ++attempts < 50 ) { setTimeout( fitImage, 100 ); }
					return;
				}
				var map = plugin.maps[ 0 ];
				if ( ! map.is_image_map ) { return; }

				// Find the ImageOverlay layer (has getBounds + getElement).
				var overlay = null;
				map.eachLayer( function ( l ) { if ( ! overlay && l.getBounds && l.getElement ) { overlay = l; } } );
				if ( ! overlay ) {
					if ( ++attempts < 50 ) { setTimeout( fitImage, 100 ); }
					return;
				}

				// Need image natural dimensions — wait until loaded.
				var img = overlay.getElement();
				if ( ! img || ! img.naturalWidth ) {
					if ( ++attempts < 50 ) { setTimeout( fitImage, 100 ); }
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
			}
			fitImage();
		} )();
		</script>
		<?php
	} elseif ( $wms_enabled ) {
		echo do_shortcode( $wms_shortcode . $marker_shortcodes . $line_shortcodes . $line_point_shortcodes . $circle_shortcodes ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	} else {
		echo do_shortcode( $map_shortcode . $marker_shortcodes . $line_shortcodes . $line_point_shortcodes . $circle_shortcodes . $layer_shortcodes . $overlay_shortcodes ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	}
	?>
</div>
<script>
( function () {
	var blockId            = <?php echo wp_json_encode( $block_id ); ?>;
	var minZoom            = <?php echo wp_json_encode( '' !== $min_zoom && is_numeric( $min_zoom ) ? (float) $min_zoom : null ); ?>;
	var maxZoom            = <?php echo wp_json_encode( '' !== $max_zoom && is_numeric( $max_zoom ) ? (float) $max_zoom : null ); ?>;
	var maxBoundsRaw       = <?php echo wp_json_encode( $max_bounds ); ?>;
	var realMarkerCount    = <?php echo wp_json_encode( $real_marker_count ); ?>;
	var linePointMeta      = <?php echo wp_json_encode( $line_point_meta ); ?>;
	var attempts           = 0;
	var MAX_ATTEMPTS       = 50;
	var isProgrammaticMove = false;

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
		if ( drawState.points.length < 1 ) {
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
			window.top.postMessage(
				{
					type:        'bflm_draw_circle_center',
					blockId:     blockId,
					circleIndex: circleDrawState.circleIndex,
					lat:         parseFloat( ll.lat.toFixed( 6 ) ),
					lng:         parseFloat( ll.lng.toFixed( 6 ) ),
				},
				'*'
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
	 * window.top is used (not window.parent) because this iframe is nested
	 * two levels deep: outer admin frame → WP canvas iframe → this iframe.
	 * window.top reaches the outer admin frame where edit.js listens.
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
			if ( ++attempts < MAX_ATTEMPTS ) {
				setTimeout( init, 200 );
			}
			return;
		}

		var map     = plugin.maps[ 0 ];
		var markers = plugin.markers || [];

		// setTimeout 200ms after init — by then CSS has applied the container's
		// final percentage-width size so invalidateSize gets the correct dimensions.
		setTimeout( function () { map.invalidateSize(); }, 200 );

		// Apply zoom & bounds constraints if set.
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

		// User pans / zooms → notify the editor.
		map.on( 'moveend zoomend', function () {
			if ( isProgrammaticMove ) {
				return;
			}
			var center = map.getCenter();
			window.top.postMessage(
				{ type: 'bflm_map_update', blockId: blockId, lat: center.lat, lng: center.lng, zoom: map.getZoom() },
				'*'
			);
		} );

		// Make each real marker draggable and relay dragend to the editor.
		markers.slice( 0, realMarkerCount ).forEach( function ( marker, i ) {
			if ( marker.dragging && ! marker.dragging.enabled() ) {
				marker.dragging.enable();
			}
			marker.on( 'dragend', function ( e ) {
				var pos = e.target.getLatLng();
				window.top.postMessage(
					{ type: 'bflm_marker_update', blockId: blockId, index: i, lat: pos.lat, lng: pos.lng },
					'*'
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
				window.top.postMessage(
					{ type: 'bflm_linepoint_update', blockId: blockId, lineIndex: meta.lineIndex, pointIndex: meta.pointIndex, lat: pos.lat, lng: pos.lng },
					'*'
				);
			} );
		} );

		// fitBounds: when enabled, adjust the map to contain all markers.
		// Intentionally not guarded by isProgrammaticMove — the resulting moveend
		// fires bflm_map_update so the editor lat/lng/zoom attributes reflect the
		// computed view (the user delegated view control to the map contents).
		var fitMarkersEnabled = <?php echo wp_json_encode( (bool) $fit_markers ); ?>;
		if ( fitMarkersEnabled && markers.length > 0 ) {
			var bounds = [];
			markers.forEach( function ( marker ) {
				var ll = marker.getLatLng();
				bounds.push( [ ll.lat, ll.lng ] );
			} );
			if ( bounds.length > 0 ) {
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
				circleDrawState.shape.setRadius( r < 1 ? 1 : r );
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
					window.top.postMessage(
						{ type: 'bflm_draw_circle_center', blockId: blockId, circleIndex: circleDrawState.circleIndex, lat: clat, lng: clng },
						'*'
					);
				} else {
					// Second click: fix radius, remove guide, make center draggable.
					var radius = map.distance( circleDrawState.center, [ clat, clng ] );
					if ( radius < 1 ) radius = 1;
					if ( circleDrawState.shape ) {
						circleDrawState.shape.setRadius( radius );
					}
					clearCircleGuideLine();
					// Convert center pin to draggable handle for repositioning.
					makeCenterDraggable( map );
					window.top.postMessage(
						{ type: 'bflm_draw_circle_radius', blockId: blockId, circleIndex: circleDrawState.circleIndex, radius: radius },
						'*'
					);
					var ci = circleDrawState.circleIndex;
					stopCircleDraw( map );
					window.top.postMessage(
						{ type: 'bflm_draw_circle_end_request', blockId: blockId, circleIndex: ci },
						'*'
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
				window.top.postMessage(
					{ type: 'bflm_draw_point', blockId: blockId, lineIndex: drawState.lineIndex, lat: lat, lng: lng },
					'*'
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
			window.top.postMessage(
				{ type: 'bflm_draw_end_request', blockId: blockId, lineIndex: li },
				'*'
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
		window.top.postMessage(
			{ type: 'bflm_iframe_ready', blockId: blockId },
			'*'
		);
	}

	init();
}() );
</script>
	<?php wp_footer(); ?>
</body>
</html>
	<?php
}
