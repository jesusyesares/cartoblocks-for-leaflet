<?php
/**
 * Preview-endpoint input normalisation.
 *
 * Pure helper: takes the raw $_GET array and returns a canonical, sanitised
 * array consumed by includes/preview/template.php. Performs **no** nonce
 * verification, no wp_die(), no echo, no header() — those concerns belong to
 * includes/preview/endpoint.php (the orchestrator).
 *
 * @package BlocksForLeafletMap
 */

defined( 'ABSPATH' ) || exit;

/**
 * Normalise and sanitise the preview-endpoint $_GET payload.
 *
 * Returns a canonical array containing both:
 *   - The same keys produced by bflm_normalise_map_attrs() (so the shared
 *     bflm_build_*_shortcodes() builders accept it directly).
 *   - Preview-only extras: blockId, fitMarkers/showScale already coerced into
 *     the strings that bflm_build_map_shortcode() expects, the four JSON-decoded
 *     collections (markers/lines/circles/layers/overlays).
 *
 * @param array<string,mixed> $get Raw $_GET superglobal (or compatible array).
 * @return array<string,mixed> Canonical attrs.
 */
function bflm_preview_normalise_input( array $get ): array {
	$attrs = array();

	$attrs['lat']  = isset( $get['lat'] ) ? (float) $get['lat'] : 0.0;
	$attrs['lng']  = isset( $get['lng'] ) ? (float) $get['lng'] : 0.0;
	$attrs['zoom'] = isset( $get['zoom'] ) ? absint( $get['zoom'] ) : 12;

	$height_raw      = isset( $get['height'] ) ? sanitize_text_field( wp_unslash( $get['height'] ) ) : '400px';
	$attrs['height'] = bflm_normalise_dimension( $height_raw, '400px' );
	$attrs['width']  = '100%';

	$attrs['scrollWheelZoom'] = ! empty( $get['scrollWheelZoom'] ) && 'true' === $get['scrollWheelZoom'];
	$attrs['zoomControl']     = ! ( isset( $get['zoomControl'] ) && 'false' === $get['zoomControl'] );
	$attrs['fitMarkers']      = ! empty( $get['fitMarkers'] ) && 'true' === $get['fitMarkers'];
	$attrs['showScale']       = ! empty( $get['showScale'] ) && 'true' === $get['showScale'];

	$attrs['attribution'] = isset( $get['attribution'] ) ? wp_kses_post( wp_unslash( $get['attribution'] ) ) : '';
	$attrs['blockId']     = isset( $get['blockId'] ) ? sanitize_text_field( wp_unslash( $get['blockId'] ) ) : '';

	// Collections.
	$attrs['markers']  = bflm_preview_decode_json_collection( $get, 'markers' );
	$attrs['lines']    = bflm_preview_decode_json_collection( $get, 'lines' );
	$attrs['circles']  = bflm_preview_decode_json_collection( $get, 'circles' );
	$attrs['layers']   = bflm_preview_decode_json_collection( $get, 'layers' );
	$attrs['overlays'] = bflm_preview_decode_json_collection( $get, 'overlays' );

	// Image-map mode.
	$attrs['imageMap']  = ! empty( $get['imageMap'] ) && 'true' === $get['imageMap'];
	$attrs['imageSrc']  = $attrs['imageMap'] && isset( $get['imageSrc'] ) ? trim( sanitize_text_field( wp_unslash( $get['imageSrc'] ) ) ) : '';
	$attrs['imageX']    = $attrs['imageMap'] && isset( $get['imageX'] ) ? (float) $get['imageX'] : 0.0;
	$attrs['imageY']    = $attrs['imageMap'] && isset( $get['imageY'] ) ? (float) $get['imageY'] : 0.0;
	$attrs['imageZoom'] = $attrs['imageMap'] && isset( $get['imageZoom'] ) ? (float) $get['imageZoom'] : 0.0;

	// WMS mode.
	$attrs['wmsEnabled'] = ! $attrs['imageMap'] && ! empty( $get['wmsEnabled'] ) && 'true' === $get['wmsEnabled'];
	$attrs['wmsSource']  = $attrs['wmsEnabled'] && isset( $get['wmsSource'] ) ? trim( sanitize_text_field( wp_unslash( $get['wmsSource'] ) ) ) : '';
	$attrs['wmsLayer']   = $attrs['wmsEnabled'] && isset( $get['wmsLayer'] ) ? trim( sanitize_text_field( wp_unslash( $get['wmsLayer'] ) ) ) : '';
	$attrs['wmsCrs']     = $attrs['wmsEnabled'] && isset( $get['wmsCrs'] ) ? trim( sanitize_text_field( wp_unslash( $get['wmsCrs'] ) ) ) : '';

	// Interaction attrs — pass through as raw 'true'/'false'/'' strings; bflm_build_interaction_attrs() handles them.
	foreach ( array( 'dragging', 'keyboard', 'doubleClickZoom', 'boxZoom', 'closePopupOnClick', 'tap', 'inertia' ) as $key ) {
		$value         = isset( $get[ $key ] ) ? sanitize_text_field( wp_unslash( $get[ $key ] ) ) : '';
		$attrs[ $key ] = in_array( $value, array( 'true', 'false' ), true ) ? $value : '';
	}

	// Zoom & bounds.
	$attrs['minZoom']   = isset( $get['minZoom'] ) ? sanitize_text_field( wp_unslash( $get['minZoom'] ) ) : '';
	$attrs['maxZoom']   = isset( $get['maxZoom'] ) ? sanitize_text_field( wp_unslash( $get['maxZoom'] ) ) : '';
	$attrs['maxBounds'] = isset( $get['maxBounds'] ) ? sanitize_text_field( wp_unslash( $get['maxBounds'] ) ) : '';

	// Tile-layer overrides.
	$attrs['tileurl']      = isset( $get['tileurl'] ) ? sanitize_text_field( wp_unslash( $get['tileurl'] ) ) : '';
	$attrs['tilesize']     = isset( $get['tilesize'] ) ? sanitize_text_field( wp_unslash( $get['tilesize'] ) ) : '';
	$attrs['subdomains']   = isset( $get['subdomains'] ) ? sanitize_text_field( wp_unslash( $get['subdomains'] ) ) : '';
	$attrs['mapid']        = isset( $get['mapid'] ) ? sanitize_text_field( wp_unslash( $get['mapid'] ) ) : '';
	$attrs['accesstoken']  = isset( $get['accesstoken'] ) ? sanitize_text_field( wp_unslash( $get['accesstoken'] ) ) : '';
	$attrs['zoomoffset']   = isset( $get['zoomoffset'] ) ? sanitize_text_field( wp_unslash( $get['zoomoffset'] ) ) : '';
	$attrs['nowrap']       = isset( $get['nowrap'] ) ? sanitize_text_field( wp_unslash( $get['nowrap'] ) ) : '';
	$attrs['detectretina'] = isset( $get['detectretina'] ) ? sanitize_text_field( wp_unslash( $get['detectretina'] ) ) : '';

	return $attrs;
}

/**
 * Decode a JSON-encoded collection from $_GET safely.
 *
 * Returns an empty array when the field is missing, malformed, or not an
 * array after decoding.
 *
 * @param array<string,mixed> $get $_GET payload.
 * @param string              $key Field name (e.g. "markers").
 * @return array<int,mixed>
 */
function bflm_preview_decode_json_collection( array $get, string $key ): array {
	if ( ! isset( $get[ $key ] ) ) {
		return array();
	}
	// JSON decoded and each field sanitised by the consuming builder; raw input is unslashed only.
	$raw     = wp_unslash( $get[ $key ] ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
	$decoded = json_decode( $raw, true );
	return is_array( $decoded ) ? $decoded : array();
}
