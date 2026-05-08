<?php
/**
 * [leaflet-circle] shortcode builder.
 *
 * @package BlocksForLeafletMap
 */

defined( 'ABSPATH' ) || exit;

/**
 * Build [leaflet-circle] shortcodes for every circle in the array.
 *
 * Circles missing lat/lng or with radius ≤ 0 are skipped.
 *
 * @param array<int,array<string,mixed>> $circles Circle objects from block attrs.
 * @return string Concatenated shortcodes (empty when none valid).
 */
function bflm_build_circle_shortcodes( array $circles ): string {
	$out = '';

	foreach ( $circles as $circle ) {
		$lat = isset( $circle['lat'] ) ? (float) $circle['lat'] : null;
		$lng = isset( $circle['lng'] ) ? (float) $circle['lng'] : null;
		if ( null === $lat || null === $lng ) {
			continue;
		}
		$radius = isset( $circle['radius'] ) && is_numeric( $circle['radius'] ) ? (float) $circle['radius'] : 1000.0;
		if ( $radius <= 0 ) {
			continue;
		}

		$tag = sprintf(
			'[leaflet-circle lat="%s" lng="%s" radius="%s"',
			esc_attr( (string) $lat ),
			esc_attr( (string) $lng ),
			esc_attr( (string) $radius )
		);

		if ( ! empty( $circle['fitbounds'] ) ) {
			$tag .= ' fitbounds="true"';
		}
		if ( isset( $circle['color'] ) && '' !== trim( (string) $circle['color'] ) ) {
			$tag .= sprintf( ' color="%s"', esc_attr( trim( (string) $circle['color'] ) ) );
		}
		if ( isset( $circle['weight'] ) && is_numeric( $circle['weight'] ) ) {
			$tag .= sprintf( ' weight="%s"', esc_attr( (string) (float) $circle['weight'] ) );
		}
		if ( isset( $circle['opacity'] ) && is_numeric( $circle['opacity'] ) ) {
			$tag .= sprintf( ' opacity="%s"', esc_attr( (string) (float) $circle['opacity'] ) );
		}
		if ( isset( $circle['dashArray'] ) && '' !== trim( (string) $circle['dashArray'] ) ) {
			$tag .= sprintf( ' dasharray="%s"', esc_attr( trim( (string) $circle['dashArray'] ) ) );
		}
		if ( isset( $circle['classname'] ) && '' !== trim( (string) $circle['classname'] ) ) {
			$tag .= sprintf( ' classname="%s"', esc_attr( trim( (string) $circle['classname'] ) ) );
		}
		if ( ! empty( $circle['fill'] ) ) {
			$tag .= ' fill="true"';
		}
		if ( isset( $circle['fillColor'] ) && '' !== trim( (string) $circle['fillColor'] ) ) {
			$tag .= sprintf( ' fillcolor="%s"', esc_attr( trim( (string) $circle['fillColor'] ) ) );
		}
		if ( isset( $circle['fillOpacity'] ) && is_numeric( $circle['fillOpacity'] ) ) {
			$tag .= sprintf( ' fillopacity="%s"', esc_attr( (string) (float) $circle['fillOpacity'] ) );
		}

		$popup = isset( $circle['popup'] ) ? wp_kses_post( (string) $circle['popup'] ) : '';
		if ( ! empty( $circle['visible'] ) && '' !== $popup ) {
			$tag .= ' visible="1"';
		}

		if ( '' !== $popup ) {
			$out .= $tag . ']' . $popup . '[/leaflet-circle]';
		} else {
			$out .= $tag . ' /]';
		}
	}

	return $out;
}
