<?php
/**
 * Map-level shortcode builders: [leaflet-map], [leaflet-wms], [leaflet-image].
 *
 * Width is always emitted as 100% so the Leaflet container fills the wrapper
 * exactly — wrapper width is applied as a CSS style on the outer <div>, not
 * via the shortcode itself, to avoid double-percentage shrinking.
 *
 * @package BlocksForLeafletMap
 */

defined( 'ABSPATH' ) || exit;

/**
 * Build the [leaflet-map] shortcode (standard tile-based view).
 *
 * @param array<string,mixed> $attrs Normalised attrs (see bflm_normalise_map_attrs()).
 * @return string Full shortcode including trailing ']'.
 */
function bflm_build_map_shortcode( array $attrs ): string {
	$scroll_wheel = ! empty( $attrs['scrollWheelZoom'] ) ? 'true' : 'false';
	$zoom_ctrl    = ! empty( $attrs['zoomControl'] ) ? 'true' : 'false';
	$fit_markers  = ! empty( $attrs['fitMarkers'] ) ? 'true' : 'false';
	$show_scale   = ! empty( $attrs['showScale'] ) ? '1' : '0';

	$out = sprintf(
		'[leaflet-map lat="%1$s" lng="%2$s" zoom="%3$d" height="%4$s" width="100%%" scrollwheel="%5$s" zoomcontrol="%6$s" fitbounds="%7$s" show_scale="%8$s"',
		esc_attr( (string) $attrs['lat'] ),
		esc_attr( (string) $attrs['lng'] ),
		(int) $attrs['zoom'],
		esc_attr( (string) $attrs['height'] ),
		$scroll_wheel,
		$zoom_ctrl,
		$fit_markers,
		$show_scale
	);

	$out .= bflm_build_interaction_attrs( $attrs );
	$out .= bflm_build_zoom_bounds_attrs( $attrs );
	$out .= bflm_build_tile_layer_attrs( $attrs );

	$attribution = isset( $attrs['attribution'] ) ? (string) $attrs['attribution'] : '';
	if ( '' !== $attribution ) {
		// wp_kses_post allows safe HTML (links). Single quotes wrap the value so
		// inner double quotes (e.g. href="...") do not break the shortcode parser.
		$out .= sprintf( " attribution='%s'", wp_kses_post( $attribution ) );
	}

	return $out . ']';
}

/**
 * Build the [leaflet-wms] shortcode (used when wmsEnabled is true).
 *
 * @param array<string,mixed> $attrs Normalised attrs.
 * @return string Full shortcode including trailing ']'.
 */
function bflm_build_wms_shortcode( array $attrs ): string {
	$scroll_wheel = ! empty( $attrs['scrollWheelZoom'] ) ? 'true' : 'false';
	$zoom_ctrl    = ! empty( $attrs['zoomControl'] ) ? 'true' : 'false';

	$out = sprintf(
		'[leaflet-wms lat="%1$s" lng="%2$s" zoom="%3$d" height="%4$s" width="100%%" scrollwheel="%5$s" zoomcontrol="%6$s"',
		esc_attr( (string) $attrs['lat'] ),
		esc_attr( (string) $attrs['lng'] ),
		(int) $attrs['zoom'],
		esc_attr( (string) $attrs['height'] ),
		$scroll_wheel,
		$zoom_ctrl
	);

	if ( ! empty( $attrs['wmsSource'] ) ) {
		$out .= sprintf( ' src="%s"', esc_attr( (string) $attrs['wmsSource'] ) );
	}
	if ( ! empty( $attrs['wmsLayer'] ) ) {
		$out .= sprintf( ' layer="%s"', esc_attr( (string) $attrs['wmsLayer'] ) );
	}
	if ( ! empty( $attrs['wmsCrs'] ) ) {
		$out .= sprintf( ' crs="%s"', esc_attr( (string) $attrs['wmsCrs'] ) );
	}

	return $out . ']';
}

/**
 * Build the [leaflet-image] shortcode (used when imageMap is true).
 *
 * @param array<string,mixed> $attrs Normalised attrs.
 * @return string Full shortcode including trailing ']'.
 */
function bflm_build_image_shortcode( array $attrs ): string {
	return sprintf(
		'[leaflet-image src="%1$s" x="%2$s" y="%3$s" zoom="0" height="%4$s" width="100%%"]',
		esc_attr( (string) $attrs['imageSrc'] ),
		esc_attr( (string) $attrs['imageX'] ),
		esc_attr( (string) $attrs['imageY'] ),
		esc_attr( (string) $attrs['height'] )
	);
}
