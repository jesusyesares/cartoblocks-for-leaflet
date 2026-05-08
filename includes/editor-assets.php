<?php
/**
 * Editor-script localisation.
 *
 * Exposes the preview URL, nonces, and Leaflet Map default settings to the
 * block editor JS via `wp_localize_script` so edit.js can build the iframe
 * src without hard-coding admin-ajax.php URLs.
 *
 * @package BlocksForLeafletMap
 */

defined( 'ABSPATH' ) || exit;

/**
 * Localise bflmEditor data onto the block's editor script handle.
 *
 * Runs on enqueue_block_editor_assets (outer admin frame only).
 *
 * @return void
 */
function bflm_localise_editor_script(): void {
	$min_zoom = get_option( 'leaflet_default_min_zoom', '0' );
	$max_zoom = get_option( 'leaflet_default_max_zoom', '19' );

	$leaflet_defaults = array(
		'lat'             => (float) get_option( 'leaflet_default_lat', '44.67' ),
		'lng'             => (float) get_option( 'leaflet_default_lng', '-63.61' ),
		'zoom'            => (int) get_option( 'leaflet_default_zoom', '12' ),
		'height'          => sanitize_text_field( (string) get_option( 'leaflet_default_height', '250' ) ),
		'width'           => sanitize_text_field( (string) get_option( 'leaflet_default_width', '100%' ) ),
		'fitMarkers'      => (bool) get_option( 'leaflet_fit_markers', '0' ),
		'zoomControl'     => (bool) get_option( 'leaflet_show_zoom_controls', '0' ),
		'scrollWheelZoom' => (bool) get_option( 'leaflet_scroll_wheel_zoom', '0' ),
		'doubleClickZoom' => (bool) get_option( 'leaflet_double_click_zoom', '0' ),
		// Only pass non-default min/max zoom so empty-string "omit" behaviour is preserved.
		'minZoom'         => ( '' !== $min_zoom && '0' !== $min_zoom ) ? sanitize_text_field( (string) $min_zoom ) : '',
		'maxZoom'         => ( '' !== $max_zoom && '19' !== $max_zoom ) ? sanitize_text_field( (string) $max_zoom ) : '',
	);

	wp_localize_script(
		'blocks-for-leaflet-map-leaflet-map-block-editor-script',
		'bflmEditor',
		array(
			'previewUrl'      => admin_url( 'admin-ajax.php' ),
			'previewNonce'    => wp_create_nonce( 'bflm_preview_nonce' ),
			'geocodeNonce'    => wp_create_nonce( 'bflm_geocode_nonce' ),
			'leafletDefaults' => $leaflet_defaults,
		)
	);
	wp_set_script_translations(
		'blocks-for-leaflet-map-leaflet-map-block-editor-script',
		'blocks-for-leaflet-map',
		BFLM_PLUGIN_DIR . 'languages'
	);
}
add_action( 'enqueue_block_editor_assets', 'bflm_localise_editor_script' );
