<?php
/**
 * Attribute normalisation helpers for shared shortcode builders.
 *
 * These helpers are pure (no side effects, no shortcode building). They
 * canonicalise raw block attributes / GET input into the shape consumed by
 * the bflm_build_*_shortcodes() builders in this directory.
 *
 * @package BlocksForLeafletMap
 */

defined( 'ABSPATH' ) || exit;

/**
 * Normalise a height/width dimension value.
 *
 * Accepts a numeric value (interpreted as pixels) or a string with a CSS unit
 * (px, %, vh, vw, em, rem). Falls back to $fallback when the input is invalid.
 * Clamps "%" values above 100 to "100%".
 *
 * @param mixed  $raw      Raw value from attributes or GET.
 * @param string $fallback Default value when input is invalid.
 * @return string Normalised dimension (e.g. "400px", "100%").
 */
function bflm_normalise_dimension( $raw, string $fallback ): string {
	$value = is_numeric( $raw ) ? $raw . 'px' : sanitize_text_field( (string) $raw );
	if ( ! preg_match( '/^\d+(\.\d+)?(px|%|vh|vw|em|rem)$/', $value ) ) {
		return $fallback;
	}
	if ( str_ends_with( $value, '%' ) && (float) $value > 100 ) {
		return '100%';
	}
	return $value;
}

/**
 * Normalise the full block-attributes array into the canonical shape consumed
 * by the shortcode builders.
 *
 * Casts numeric fields, validates dimensions, trims strings. Returns the same
 * keys as the input plus guaranteed defaults for required fields (lat/lng/zoom/
 * height/width). Optional fields are passed through unchanged so the builders
 * can decide whether to emit them.
 *
 * @param array<string,mixed> $attrs Raw block attributes.
 * @return array<string,mixed> Canonical attrs.
 */
function bflm_normalise_map_attrs( array $attrs ): array {
	$out = $attrs;

	$out['lat']    = isset( $attrs['lat'] ) ? (float) $attrs['lat'] : 0.0;
	$out['lng']    = isset( $attrs['lng'] ) ? (float) $attrs['lng'] : 0.0;
	$out['zoom']   = isset( $attrs['zoom'] ) ? (int) $attrs['zoom'] : 12;
	$out['height'] = bflm_normalise_dimension( $attrs['height'] ?? '400px', '400px' );
	$out['width']  = bflm_normalise_dimension( $attrs['width'] ?? '100%', '100%' );

	$out['scrollWheelZoom'] = ! empty( $attrs['scrollWheelZoom'] );
	$out['zoomControl']     = ! ( isset( $attrs['zoomControl'] ) && false === $attrs['zoomControl'] );
	$out['fitMarkers']      = ! empty( $attrs['fitMarkers'] );
	$out['showScale']       = ! empty( $attrs['showScale'] );
	$out['attribution']     = isset( $attrs['attribution'] ) ? (string) $attrs['attribution'] : '';

	$out['imageMap']   = ! empty( $attrs['imageMap'] );
	$out['wmsEnabled'] = ! $out['imageMap'] && ! empty( $attrs['wmsEnabled'] );

	$out['imageSrc']  = $out['imageMap'] && isset( $attrs['imageSrc'] ) ? trim( (string) $attrs['imageSrc'] ) : '';
	$out['imageX']    = $out['imageMap'] && isset( $attrs['imageX'] ) ? (float) $attrs['imageX'] : 0.0;
	$out['imageY']    = $out['imageMap'] && isset( $attrs['imageY'] ) ? (float) $attrs['imageY'] : 0.0;
	$out['imageZoom'] = $out['imageMap'] && isset( $attrs['imageZoom'] ) ? (float) $attrs['imageZoom'] : 0.0;

	$out['wmsSource'] = $out['wmsEnabled'] && isset( $attrs['wmsSource'] ) ? trim( (string) $attrs['wmsSource'] ) : '';
	$out['wmsLayer']  = $out['wmsEnabled'] && isset( $attrs['wmsLayer'] ) ? trim( (string) $attrs['wmsLayer'] ) : '';
	$out['wmsCrs']    = $out['wmsEnabled'] && isset( $attrs['wmsCrs'] ) ? trim( (string) $attrs['wmsCrs'] ) : '';

	return $out;
}

/**
 * Build the interaction-attributes fragment of the [leaflet-map] shortcode.
 *
 * Each attribute is emitted only when explicitly set ('' means "default" and
 * is omitted so the Leaflet Map plugin's global setting applies).
 *
 * @param array<string,mixed> $attrs Normalised block attrs.
 * @return string Leading-space fragment (e.g. ' dragging="true" inertia="false"').
 */
function bflm_build_interaction_attrs( array $attrs ): string {
	$map = array(
		'dragging'          => 'dragging',
		'keyboard'          => 'keyboard',
		'doubleClickZoom'   => 'doubleclickzoom',
		'boxZoom'           => 'boxzoom',
		'closePopupOnClick' => 'closepopuponclick',
		'tap'               => 'tap',
		'inertia'           => 'inertia',
	);

	$out = '';
	foreach ( $map as $attr_key => $shortcode_key ) {
		$value = isset( $attrs[ $attr_key ] ) ? (string) $attrs[ $attr_key ] : '';
		if ( '' === $value ) {
			continue;
		}
		if ( ! in_array( $value, array( 'true', 'false' ), true ) ) {
			continue;
		}
		$out .= sprintf( ' %s="%s"', $shortcode_key, esc_attr( $value ) );
	}
	return $out;
}

/**
 * Build the zoom & bounds fragment of the [leaflet-map] shortcode.
 *
 * @param array<string,mixed> $attrs Normalised block attrs.
 * @return string Leading-space fragment (e.g. ' min_zoom="3" maxbounds="...").
 */
function bflm_build_zoom_bounds_attrs( array $attrs ): string {
	$out = '';

	$min_zoom = isset( $attrs['minZoom'] ) ? (string) $attrs['minZoom'] : '';
	$max_zoom = isset( $attrs['maxZoom'] ) ? (string) $attrs['maxZoom'] : '';
	$bounds   = isset( $attrs['maxBounds'] ) ? (string) $attrs['maxBounds'] : '';

	if ( '' !== $min_zoom && is_numeric( $min_zoom ) ) {
		$out .= sprintf( ' min_zoom="%s"', esc_attr( $min_zoom ) );
	}
	if ( '' !== $max_zoom && is_numeric( $max_zoom ) ) {
		$out .= sprintf( ' max_zoom="%s"', esc_attr( $max_zoom ) );
	}
	if ( '' !== $bounds ) {
		$out .= sprintf( ' maxbounds="%s"', esc_attr( $bounds ) );
	}

	return $out;
}

/**
 * Build the tile-layer fragment of the [leaflet-map] shortcode.
 *
 * Note: esc_url_raw() would strip {s}/{z}/{x}/{y} placeholders in tileurl
 * (curly braces fall outside RFC 3986). esc_attr() is used instead — it only
 * escapes HTML special characters and preserves template placeholders intact.
 *
 * @param array<string,mixed> $attrs Normalised block attrs.
 * @return string Leading-space fragment.
 */
function bflm_build_tile_layer_attrs( array $attrs ): string {
	$out = '';

	if ( isset( $attrs['tileurl'] ) && '' !== $attrs['tileurl'] ) {
		$out .= sprintf( ' tileurl="%s"', esc_attr( (string) $attrs['tileurl'] ) );
	}
	if ( isset( $attrs['tilesize'] ) && '' !== $attrs['tilesize'] && is_numeric( $attrs['tilesize'] ) && (int) $attrs['tilesize'] >= 1 ) {
		$out .= sprintf( ' tilesize="%d"', (int) $attrs['tilesize'] );
	}
	if ( isset( $attrs['subdomains'] ) && '' !== $attrs['subdomains'] ) {
		$out .= sprintf( ' subdomains="%s"', esc_attr( (string) $attrs['subdomains'] ) );
	}
	if ( isset( $attrs['mapid'] ) && '' !== $attrs['mapid'] ) {
		$out .= sprintf( ' mapid="%s"', esc_attr( (string) $attrs['mapid'] ) );
	}
	if ( isset( $attrs['accesstoken'] ) && '' !== $attrs['accesstoken'] ) {
		$out .= sprintf( ' accesstoken="%s"', esc_attr( (string) $attrs['accesstoken'] ) );
	}
	if ( isset( $attrs['zoomoffset'] ) && '' !== $attrs['zoomoffset'] && is_numeric( $attrs['zoomoffset'] ) ) {
		$out .= sprintf( ' zoomoffset="%d"', (int) $attrs['zoomoffset'] );
	}
	if ( isset( $attrs['nowrap'] ) && in_array( (string) $attrs['nowrap'], array( 'true', 'false' ), true ) ) {
		$out .= sprintf( ' nowrap="%s"', esc_attr( (string) $attrs['nowrap'] ) );
	}
	if ( isset( $attrs['detectretina'] ) && in_array( (string) $attrs['detectretina'], array( 'true', 'false' ), true ) ) {
		// Shortcode attribute is detect_retina (with underscore) — confirmed in
		// class.map-shortcode.php line 290 of bozdoz/wp-plugin-leaflet-map.
		$out .= sprintf( ' detect_retina="%s"', esc_attr( (string) $attrs['detectretina'] ) );
	}

	return $out;
}
