<?php
/**
 * Plugin Name:       Blocks for Leaflet Map
 * Plugin URI:        https://github.com/jesusyesares/blocks-for-leaflet-map
 * Description:       A dynamic Gutenberg block that wraps the Leaflet Map plugin shortcodes. Requires the "Leaflet Map" plugin to be installed and active.
 * Version:           0.4.3
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Jesús Yesares García
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       blocks-for-leaflet-map
 *
 * @package BlocksForLeafletMap
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

define( 'BFLM_VERSION', '0.4.3' );
define( 'BFLM_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'BFLM_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'BFLM_LEAFLET_MAP_PLUGIN', 'leaflet-map/leaflet-map.php' );

// ---------------------------------------------------------------------------
// Dependency check: "Leaflet Map" plugin must be active.
// ---------------------------------------------------------------------------

/**
 * Returns true when the Leaflet Map plugin is active.
 *
 * @return bool
 */
function bflm_is_leaflet_map_active(): bool {
	if ( ! function_exists( 'is_plugin_active' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}

	return is_plugin_active( BFLM_LEAFLET_MAP_PLUGIN );
}

/**
 * Display an admin notice when the Leaflet Map plugin is missing or inactive.
 */
function bflm_missing_dependency_notice(): void {
	$plugin_link = sprintf(
		'<a href="%s" target="_blank" rel="noopener noreferrer">%s</a>',
		esc_url( 'https://wordpress.org/plugins/leaflet-map/' ),
		esc_html__( 'Leaflet Map', 'blocks-for-leaflet-map' )
	);

	printf(
		'<div class="notice notice-error"><p>%s</p></div>',
		wp_kses(
			sprintf(
				/* translators: %s: linked plugin name */
				__( '<strong>Blocks for Leaflet Map</strong> requires the %s plugin to be installed and active.', 'blocks-for-leaflet-map' ),
				$plugin_link
			),
			array(
				'strong' => array(),
				'a'      => array(
					'href'   => array(),
					'target' => array(),
					'rel'    => array(),
				),
			)
		)
	);
}

if ( ! bflm_is_leaflet_map_active() ) {
	add_action( 'admin_notices', 'bflm_missing_dependency_notice' );
	return; // Stop loading — do not register the block.
}

// ---------------------------------------------------------------------------
// Block registration (only reached when Leaflet Map is active).
// ---------------------------------------------------------------------------

/**
 * Registers all blocks from the build manifest.
 *
 * @see https://make.wordpress.org/core/2025/03/13/more-efficient-block-type-registration-in-6-8/
 */
function bflm_register_blocks(): void {
	wp_register_block_types_from_metadata_collection(
		BFLM_PLUGIN_DIR . 'build',
		BFLM_PLUGIN_DIR . 'build/blocks-manifest.php'
	);
}
add_action( 'init', 'bflm_register_blocks' );

// ---------------------------------------------------------------------------
// Preview endpoint — AJAX handler that outputs a complete HTML page rendering
// the map via Leaflet Map shortcodes. The editor iframe loads this URL so the
// map is rendered exactly as it appears on the frontend.
// ---------------------------------------------------------------------------

/**
 * Output a minimal HTML page that renders the map via [leaflet-map] and
 * [leaflet-marker] shortcodes. Called by the editor iframe's src attribute.
 *
 * Security: nonce verified, all inputs sanitised, output escaped via shortcode
 * trusted output (same pattern as render.php).
 */
function bflm_preview_map(): void {
	// Verify nonce.
	$nonce = isset( $_GET['bflm_nonce'] ) ? sanitize_text_field( wp_unslash( $_GET['bflm_nonce'] ) ) : '';
	if ( ! wp_verify_nonce( $nonce, 'bflm_preview_nonce' ) ) {
		wp_die( esc_html__( 'Invalid or expired preview token.', 'blocks-for-leaflet-map' ), 403 );
	}

	// Sanitise map parameters.
	$lat        = isset( $_GET['lat'] ) ? (float) $_GET['lat'] : 0.0;
	$lng        = isset( $_GET['lng'] ) ? (float) $_GET['lng'] : 0.0;
	$zoom       = isset( $_GET['zoom'] ) ? absint( $_GET['zoom'] ) : 12;
	$height_raw = isset( $_GET['height'] ) ? sanitize_text_field( wp_unslash( $_GET['height'] ) ) : '400px';
	$height     = is_numeric( $height_raw ) ? $height_raw . 'px' : $height_raw;
	if ( ! preg_match( '/^\d+(\.\d+)?(px|%|vh|vw|em|rem)$/', $height ) ) {
		$height = '400px';
	}

	$scroll_wheel    = ! empty( $_GET['scrollWheelZoom'] ) && 'true' === $_GET['scrollWheelZoom'] ? 'true' : 'false';
	$zoom_ctrl       = ! isset( $_GET['zoomControl'] ) || 'false' !== $_GET['zoomControl'] ? 'true' : 'false';
	$block_id        = isset( $_GET['blockId'] ) ? sanitize_text_field( wp_unslash( $_GET['blockId'] ) ) : '';
	$markers_raw     = isset( $_GET['markers'] ) ? wp_unslash( $_GET['markers'] ) : '[]'; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- JSON decoded and each field sanitised below.
	$markers_decoded = json_decode( $markers_raw, true );
	$markers         = is_array( $markers_decoded ) ? $markers_decoded : array();
	$fit_markers     = ! empty( $_GET['fitMarkers'] ) && 'true' === $_GET['fitMarkers'] ? 'true' : 'false';
	$show_scale      = ! empty( $_GET['showScale'] ) && 'true' === $_GET['showScale'] ? '1' : '0';
	$attribution     = isset( $_GET['attribution'] ) ? wp_kses_post( wp_unslash( $_GET['attribution'] ) ) : '';

	// Interaction attributes: only include when explicitly set.
	$interaction_keys = array(
		'dragging'          => 'dragging',
		'keyboard'          => 'keyboard',
		'doubleClickZoom'   => 'doubleclickzoom',
		'boxZoom'           => 'boxzoom',
		'closePopupOnClick' => 'closepopuponclick',
		'tap'               => 'tap',
		'inertia'           => 'inertia',
	);

	$interaction_shortcode = '';
	foreach ( $interaction_keys as $get_key => $shortcode_key ) {
		$value = isset( $_GET[ $get_key ] ) ? sanitize_text_field( wp_unslash( $_GET[ $get_key ] ) ) : '';
		if ( '' !== $value && in_array( $value, array( 'true', 'false' ), true ) ) {
			$interaction_shortcode .= sprintf( ' %s="%s"', $shortcode_key, esc_attr( $value ) );
		}
	}

	// Zoom & bounds attributes: only include when explicitly set.
	$min_zoom   = isset( $_GET['minZoom'] ) ? sanitize_text_field( wp_unslash( $_GET['minZoom'] ) ) : '';
	$max_zoom   = isset( $_GET['maxZoom'] ) ? sanitize_text_field( wp_unslash( $_GET['maxZoom'] ) ) : '';
	$max_bounds = isset( $_GET['maxBounds'] ) ? sanitize_text_field( wp_unslash( $_GET['maxBounds'] ) ) : '';

	$zoom_bounds_shortcode = '';
	if ( '' !== $min_zoom && is_numeric( $min_zoom ) ) {
		$zoom_bounds_shortcode .= sprintf( ' min_zoom="%s"', esc_attr( $min_zoom ) );
	}
	if ( '' !== $max_zoom && is_numeric( $max_zoom ) ) {
		$zoom_bounds_shortcode .= sprintf( ' max_zoom="%s"', esc_attr( $max_zoom ) );
	}
	if ( '' !== $max_bounds ) {
		$zoom_bounds_shortcode .= sprintf( ' maxbounds="%s"', esc_attr( $max_bounds ) );
	}

	// Build shortcodes (same logic as render.php).
	// Width is applied to the editor block container, not the shortcode.
	$map_shortcode = sprintf(
		'[leaflet-map lat="%1$s" lng="%2$s" zoom="%3$d" height="%4$s" scrollwheel="%5$s" zoomcontrol="%6$s" fitbounds="%7$s" show_scale="%8$s"',
		esc_attr( $lat ),
		esc_attr( $lng ),
		$zoom,
		esc_attr( $height ),
		$scroll_wheel,
		$zoom_ctrl,
		$fit_markers,
		$show_scale
	);

	// Append interaction attributes (only those explicitly set).
	$map_shortcode .= $interaction_shortcode;

	// Append zoom & bounds attributes (only those explicitly set).
	$map_shortcode .= $zoom_bounds_shortcode;

	// Tile layer attributes: only include when explicitly set.
	// Note: esc_url_raw() strips {s}/{z}/{x}/{y} placeholders; esc_attr() used instead.
	$tile_preview_shortcode = '';

	$tileurl_preview = isset( $_GET['tileurl'] ) ? sanitize_text_field( wp_unslash( $_GET['tileurl'] ) ) : '';
	if ( '' !== $tileurl_preview ) {
		$tile_preview_shortcode .= sprintf( ' tileurl="%s"', esc_attr( $tileurl_preview ) );
	}

	$tilesize_preview = isset( $_GET['tilesize'] ) ? sanitize_text_field( wp_unslash( $_GET['tilesize'] ) ) : '';
	if ( '' !== $tilesize_preview && is_numeric( $tilesize_preview ) && (int) $tilesize_preview >= 1 ) {
		$tile_preview_shortcode .= sprintf( ' tilesize="%d"', (int) $tilesize_preview );
	}

	$subdomains_preview = isset( $_GET['subdomains'] ) ? sanitize_text_field( wp_unslash( $_GET['subdomains'] ) ) : '';
	if ( '' !== $subdomains_preview ) {
		$tile_preview_shortcode .= sprintf( ' subdomains="%s"', esc_attr( $subdomains_preview ) );
	}

	$mapid_preview = isset( $_GET['mapid'] ) ? sanitize_text_field( wp_unslash( $_GET['mapid'] ) ) : '';
	if ( '' !== $mapid_preview ) {
		$tile_preview_shortcode .= sprintf( ' mapid="%s"', esc_attr( $mapid_preview ) );
	}

	$accesstoken_preview = isset( $_GET['accesstoken'] ) ? sanitize_text_field( wp_unslash( $_GET['accesstoken'] ) ) : '';
	if ( '' !== $accesstoken_preview ) {
		$tile_preview_shortcode .= sprintf( ' accesstoken="%s"', esc_attr( $accesstoken_preview ) );
	}

	$zoomoffset_preview = isset( $_GET['zoomoffset'] ) ? sanitize_text_field( wp_unslash( $_GET['zoomoffset'] ) ) : '';
	if ( '' !== $zoomoffset_preview && is_numeric( $zoomoffset_preview ) ) {
		$tile_preview_shortcode .= sprintf( ' zoomoffset="%d"', (int) $zoomoffset_preview );
	}

	$nowrap_preview = isset( $_GET['nowrap'] ) ? sanitize_text_field( wp_unslash( $_GET['nowrap'] ) ) : '';
	if ( in_array( $nowrap_preview, array( 'true', 'false' ), true ) ) {
		$tile_preview_shortcode .= sprintf( ' nowrap="%s"', esc_attr( $nowrap_preview ) );
	}

	$detectretina_preview = isset( $_GET['detectretina'] ) ? sanitize_text_field( wp_unslash( $_GET['detectretina'] ) ) : '';
	if ( in_array( $detectretina_preview, array( 'true', 'false' ), true ) ) {
		// Shortcode attribute is detect_retina (with underscore) — confirmed in class.map-shortcode.php.
		$tile_preview_shortcode .= sprintf( ' detect_retina="%s"', esc_attr( $detectretina_preview ) );
	}

	$map_shortcode .= $tile_preview_shortcode;

	if ( '' !== $attribution ) {
		$map_shortcode .= sprintf( " attribution='%s'", wp_kses_post( $attribution ) );
	}

	$map_shortcode .= ']';

	$marker_shortcodes = '';
	foreach ( $markers as $marker ) {
		if ( ! isset( $marker['lat'], $marker['lng'] ) ) {
			continue;
		}
		$m_lat     = (float) $marker['lat'];
		$m_lng     = (float) $marker['lng'];
		$m_title   = isset( $marker['title'] ) ? sanitize_text_field( $marker['title'] ) : '';
		$m_content = isset( $marker['content'] ) ? wp_kses_post( $marker['content'] ) : '';
		$m_alt     = isset( $marker['alt'] ) ? sanitize_text_field( $marker['alt'] ) : '';

		// Build open tag incrementally; include optional attrs only when set.
		$m_open_tag = sprintf(
			'[leaflet-marker lat="%1$s" lng="%2$s"',
			esc_attr( $m_lat ),
			esc_attr( $m_lng )
		);

		if ( '' !== $m_title ) {
			$m_open_tag .= sprintf( ' title="%s"', esc_attr( $m_title ) );
		}
		if ( '' !== $m_alt ) {
			$m_open_tag .= sprintf( ' alt="%s"', esc_attr( $m_alt ) );
		}
		if ( ! empty( $marker['visible'] ) ) {
			$m_open_tag .= ' visible="1"';
		}
		if ( ! empty( $marker['draggable'] ) ) {
			$m_open_tag .= ' draggable="1"';
		}
		if ( isset( $marker['opacity'] ) ) {
			$m_opacity = (float) $marker['opacity'];
			if ( abs( $m_opacity - 1.0 ) > 0.001 ) {
				$m_open_tag .= sprintf( ' opacity="%s"', esc_attr( $m_opacity ) );
			}
		}
		if ( isset( $marker['zIndexOffset'] ) ) {
			$m_zindex = (int) $marker['zIndexOffset'];
			if ( 0 !== $m_zindex ) {
				$m_open_tag .= sprintf( ' zindexoffset="%d"', $m_zindex );
			}
		}

		// SVG marker and custom image icon are mutually exclusive: SVG wins when both flags are set.
		// Mirror buildShortcode() logic in edit.js and render.php.
		if ( ! empty( $marker['useSvgMarker'] ) ) {
			$m_open_tag .= ' svg="true"';
			if ( isset( $marker['svgBackground'] ) && '' !== trim( $marker['svgBackground'] ) ) {
				$m_open_tag .= sprintf( ' background="%s"', esc_attr( trim( $marker['svgBackground'] ) ) );
			}
			if ( isset( $marker['svgIconClass'] ) && '' !== trim( $marker['svgIconClass'] ) ) {
				$m_open_tag .= sprintf( ' iconclass="%s"', esc_attr( trim( $marker['svgIconClass'] ) ) );
			}
			if ( isset( $marker['svgColor'] ) && '' !== trim( $marker['svgColor'] ) ) {
				$m_open_tag .= sprintf( ' color="%s"', esc_attr( trim( $marker['svgColor'] ) ) );
			}
		} elseif ( ! empty( $marker['useCustomIcon'] ) ) {
			// Custom icon: mirror buildShortcode() logic in edit.js.
			$m_icon_url = isset( $marker['iconUrl'] ) ? sanitize_text_field( $marker['iconUrl'] ) : '';
			if ( '' !== $m_icon_url ) {
				$m_open_tag .= sprintf( ' iconurl="%s"', esc_attr( $m_icon_url ) );
			}
			$m_icon_w = isset( $marker['iconWidth'] )  ? (int) $marker['iconWidth']  : 0;
			$m_icon_h = isset( $marker['iconHeight'] ) ? (int) $marker['iconHeight'] : 0;
			if ( $m_icon_w >= 1 && $m_icon_h >= 1 ) {
				$m_open_tag .= sprintf( ' iconsize="%d,%d"', $m_icon_w, $m_icon_h );
			}
			$m_anchor_x = isset( $marker['iconAnchorX'] ) ? $marker['iconAnchorX'] : null;
			$m_anchor_y = isset( $marker['iconAnchorY'] ) ? $marker['iconAnchorY'] : null;
			if ( null !== $m_anchor_x && null !== $m_anchor_y ) {
				$m_open_tag .= sprintf( ' iconanchor="%d,%d"', (int) $m_anchor_x, (int) $m_anchor_y );
			}
			$m_popup_x = isset( $marker['popupAnchorX'] ) ? $marker['popupAnchorX'] : null;
			$m_popup_y = isset( $marker['popupAnchorY'] ) ? $marker['popupAnchorY'] : null;
			if ( null !== $m_popup_x && null !== $m_popup_y ) {
				$m_open_tag .= sprintf( ' popupanchor="%d,%d"', (int) $m_popup_x, (int) $m_popup_y );
			}
			// Shadow: only when useShadow is also true.
			if ( ! empty( $marker['useShadow'] ) ) {
				$m_shadow_url = isset( $marker['shadowUrl'] ) ? sanitize_text_field( $marker['shadowUrl'] ) : '';
				if ( '' !== $m_shadow_url ) {
					$m_open_tag .= sprintf( ' shadowurl="%s"', esc_attr( $m_shadow_url ) );
				}
				$m_shadow_w = isset( $marker['shadowWidth'] )  ? (int) $marker['shadowWidth']  : 0;
				$m_shadow_h = isset( $marker['shadowHeight'] ) ? (int) $marker['shadowHeight'] : 0;
				if ( $m_shadow_w >= 1 && $m_shadow_h >= 1 ) {
					$m_open_tag .= sprintf( ' shadowsize="%d,%d"', $m_shadow_w, $m_shadow_h );
				}
				$m_shadow_ax = isset( $marker['shadowAnchorX'] ) ? $marker['shadowAnchorX'] : null;
				$m_shadow_ay = isset( $marker['shadowAnchorY'] ) ? $marker['shadowAnchorY'] : null;
				if ( null !== $m_shadow_ax && null !== $m_shadow_ay ) {
					$m_open_tag .= sprintf( ' shadowanchor="%d,%d"', (int) $m_shadow_ax, (int) $m_shadow_ay );
				}
			}
		}

		if ( '' !== $m_content ) {
			$marker_shortcodes .= $m_open_tag . ']' . $m_content . '[/leaflet-marker]';
		} else {
			$marker_shortcodes .= $m_open_tag . ' /]';
		}
	}

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
</style>
	<?php wp_head(); ?>
</head>
<body>
<div id="map-wrap">
	<?php
	// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- trusted shortcode output, same rationale as render.php.
	echo do_shortcode( $map_shortcode . $marker_shortcodes );
	?>
</div>
<script>
( function () {
	var blockId            = <?php echo wp_json_encode( $block_id ); ?>;
	var minZoom            = <?php echo wp_json_encode( '' !== $min_zoom && is_numeric( $min_zoom ) ? (float) $min_zoom : null ); ?>;
	var maxZoom            = <?php echo wp_json_encode( '' !== $max_zoom && is_numeric( $max_zoom ) ? (float) $max_zoom : null ); ?>;
	var maxBoundsRaw       = <?php echo wp_json_encode( $max_bounds ); ?>;
	var attempts           = 0;
	var MAX_ATTEMPTS       = 50;
	var isProgrammaticMove = false;

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

		// Make each marker draggable and relay dragend to the editor.
		markers.forEach( function ( marker, i ) {
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

		// fitBounds: when enabled, adjust the map to contain all markers.
		// Intentionally not guarded by isProgrammaticMove — the resulting moveend
		// fires bflm_map_update so the editor lat/lng/zoom attributes reflect the
		// computed view (the user delegated view control to the map contents).
		var fitMarkersEnabled = <?php echo wp_json_encode( 'true' === $fit_markers ); ?>;
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

		// Receive setView commands sent by the editor.
		// Guard with blockId so only the matching block's message is acted on.
		window.addEventListener( 'message', function ( e ) {
			if ( ! e.data || e.data.type !== 'bflm_set_view' || e.data.blockId !== blockId ) {
				return;
			}
			// Clear the guard flag only after the (animated) move ends, not
			// immediately, so moveend does not echo during the transition.
			isProgrammaticMove = true;
			map.once( 'moveend', function () {
				isProgrammaticMove = false;
			} );
			map.setView( [ e.data.lat, e.data.lng ], e.data.zoom, { animate: true } );
		} );
	}

	init();
}() );
</script>
	<?php wp_footer(); ?>
</body>
</html>
	<?php
	die();
}
add_action( 'wp_ajax_bflm_preview', 'bflm_preview_map' );

// ---------------------------------------------------------------------------
// Editor script localisation — expose the preview URL and a nonce so edit.js
// can build the iframe src without hard-coding the admin-ajax URL.
// ---------------------------------------------------------------------------

/**
 * Localise bflmEditor data onto the block's editor script handle.
 * Runs on enqueue_block_editor_assets (outer admin frame only).
 */
function bflm_localise_editor_script(): void {
	wp_localize_script(
		'blocks-for-leaflet-map-leaflet-map-block-editor-script',
		'bflmEditor',
		array(
			'previewUrl'   => admin_url( 'admin-ajax.php' ),
			'previewNonce' => wp_create_nonce( 'bflm_preview_nonce' ),
			'geocodeNonce' => wp_create_nonce( 'bflm_geocode_nonce' ),
		)
	);
}
add_action( 'enqueue_block_editor_assets', 'bflm_localise_editor_script' );

// ---------------------------------------------------------------------------
// Geocode endpoint — AJAX handler that queries Nominatim for up to 5 address
// candidates and returns them as JSON for the block editor to display.
// ---------------------------------------------------------------------------

/**
 * Handle address geocoding requests from the block editor.
 *
 * Queries the Nominatim API for up to 5 candidates matching the submitted
 * address and returns a JSON-encoded list. Reuses Leaflet Map's User-Agent
 * and contact-email conventions, including the leaflet_map_nominatim_contact_email
 * filter, so the request is correctly attributed.
 *
 * Security: nonce verified via check_ajax_referer(), capability checked with
 * current_user_can(), input sanitised with sanitize_text_field().
 */
function bflm_geocode_address(): void {
	check_ajax_referer( 'bflm_geocode_nonce', '_ajax_nonce' );

	if ( ! current_user_can( 'edit_posts' ) ) {
		wp_send_json_error(
			array( 'message' => __( 'You do not have permission to perform this action.', 'blocks-for-leaflet-map' ) ),
			403
		);
	}

	if ( ! bflm_is_leaflet_map_active() ) {
		wp_send_json_error(
			array( 'message' => __( 'The Leaflet Map plugin is not active.', 'blocks-for-leaflet-map' ) )
		);
	}

	$address = isset( $_POST['address'] ) ? sanitize_text_field( wp_unslash( $_POST['address'] ) ) : '';

	if ( '' === $address ) {
		wp_send_json_error(
			array( 'message' => __( 'Please enter an address to search.', 'blocks-for-leaflet-map' ) )
		);
	}

	// Build contact email and User-Agent following Leaflet Map's osm_geocode() conventions,
	// including the leaflet_map_nominatim_contact_email filter.
	$contact_email = '';
	if ( class_exists( 'Leaflet_Map_Plugin_Settings' ) ) {
		$settings      = Leaflet_Map_Plugin_Settings::init();
		$contact_email = $settings->get( 'nominatim_contact_email' );
	}
	if ( empty( $contact_email ) ) {
		$contact_email = get_bloginfo( 'admin_email' );
	}
	$contact_email   = apply_filters( 'leaflet_map_nominatim_contact_email', $contact_email );
	$accept_language = str_replace( '_', '-', get_locale() );
	$user_agent      = 'Nominatim query for ' . get_bloginfo( 'url' ) . '; contact ' . $contact_email;

	$request_url = sprintf(
		'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=%s',
		rawurlencode( $address )
	);

	$response = wp_remote_get(
		$request_url,
		array(
			'user-agent' => $user_agent,
			'headers'    => array(
				'Accept-Language' => $accept_language,
			),
		)
	);

	if ( is_wp_error( $response ) ) {
		wp_send_json_error(
			array( 'message' => __( 'Geocoding request failed. Please try again.', 'blocks-for-leaflet-map' ) )
		);
	}

	$body = wp_remote_retrieve_body( $response );
	$data = json_decode( $body );

	if ( ! is_array( $data ) || empty( $data ) ) {
		wp_send_json_error(
			array( 'message' => __( 'No results found for that address.', 'blocks-for-leaflet-map' ) )
		);
	}

	$candidates = array();
	foreach ( $data as $item ) {
		if ( ! isset( $item->lat, $item->lon, $item->display_name ) ) {
			continue;
		}
		$candidates[] = array(
			'display_name' => sanitize_text_field( $item->display_name ),
			'lat'          => (float) $item->lat,
			'lng'          => (float) $item->lon,
		);
	}

	if ( empty( $candidates ) ) {
		wp_send_json_error(
			array( 'message' => __( 'No results found for that address.', 'blocks-for-leaflet-map' ) )
		);
	}

	wp_send_json_success( array( 'candidates' => $candidates ) );
}
add_action( 'wp_ajax_bflm_geocode', 'bflm_geocode_address' );
