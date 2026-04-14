<?php
/**
 * Plugin Name:       Blocks for Leaflet Map
 * Plugin URI:        https://github.com/jesusyesares/blocks-for-leaflet-map
 * Description:       A dynamic Gutenberg block that wraps the Leaflet Map plugin shortcodes. Requires the "Leaflet Map" plugin to be installed and active.
 * Version:           0.3.3
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

define( 'BFLM_VERSION', '0.3.3' );
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

		if ( '' !== $m_content ) {
			$marker_shortcodes .= sprintf(
				'[leaflet-marker lat="%1$s" lng="%2$s" title="%3$s"]%4$s[/leaflet-marker]',
				esc_attr( $m_lat ),
				esc_attr( $m_lng ),
				esc_attr( $m_title ),
				$m_content
			);
		} else {
			$marker_shortcodes .= sprintf(
				'[leaflet-marker lat="%1$s" lng="%2$s" title="%3$s"]',
				esc_attr( $m_lat ),
				esc_attr( $m_lng ),
				esc_attr( $m_title )
			);
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
	var blockId           = <?php echo wp_json_encode( $block_id ); ?>;
	var attempts          = 0;
	var MAX_ATTEMPTS      = 50;
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
		)
	);
}
add_action( 'enqueue_block_editor_assets', 'bflm_localise_editor_script' );
