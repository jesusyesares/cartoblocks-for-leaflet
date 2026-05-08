<?php
/**
 * [leaflet-line] / [leaflet-polygon] shortcode builders.
 *
 * Tag is selected by line.type ('polygon' → leaflet-polygon, otherwise
 * leaflet-line). Lines with fewer than 2 points are skipped.
 *
 * @package BlocksForLeafletMap
 */

defined( 'ABSPATH' ) || exit;

/**
 * Build [leaflet-line] / [leaflet-polygon] shortcodes for every line in the array.
 *
 * @param array<int,array<string,mixed>> $lines Line objects from block attrs.
 * @return string Concatenated shortcodes (empty when none valid).
 */
function bflm_build_line_shortcodes( array $lines ): string {
	$out = '';

	foreach ( $lines as $line ) {
		$points = isset( $line['points'] ) && is_array( $line['points'] ) ? $line['points'] : array();
		if ( count( $points ) < 2 ) {
			continue;
		}

		$tag_name = ( isset( $line['type'] ) && 'polygon' === $line['type'] ) ? 'leaflet-polygon' : 'leaflet-line';

		$latlngs_parts = array();
		foreach ( $points as $pt ) {
			$pt_lat          = (float) ( isset( $pt['lat'] ) ? $pt['lat'] : 0 );
			$pt_lng          = (float) ( isset( $pt['lng'] ) ? $pt['lng'] : 0 );
			$latlngs_parts[] = $pt_lat . ',' . $pt_lng;
		}
		$tag = sprintf( '[%s latlngs="%s"', $tag_name, esc_attr( implode( '; ', $latlngs_parts ) ) );

		if ( ! empty( $line['fitbounds'] ) ) {
			$tag .= ' fitbounds="true"';
		}
		if ( isset( $line['color'] ) && '' !== trim( (string) $line['color'] ) ) {
			$tag .= sprintf( ' color="%s"', esc_attr( trim( (string) $line['color'] ) ) );
		}
		if ( isset( $line['weight'] ) && is_numeric( $line['weight'] ) ) {
			$tag .= sprintf( ' weight="%s"', esc_attr( (string) (float) $line['weight'] ) );
		}
		if ( isset( $line['opacity'] ) && is_numeric( $line['opacity'] ) ) {
			$tag .= sprintf( ' opacity="%s"', esc_attr( (string) (float) $line['opacity'] ) );
		}
		if ( isset( $line['dashArray'] ) && '' !== trim( (string) $line['dashArray'] ) ) {
			$tag .= sprintf( ' dasharray="%s"', esc_attr( trim( (string) $line['dashArray'] ) ) );
		}
		if ( isset( $line['classname'] ) && '' !== trim( (string) $line['classname'] ) ) {
			$tag .= sprintf( ' classname="%s"', esc_attr( trim( (string) $line['classname'] ) ) );
		}
		if ( ! empty( $line['fill'] ) ) {
			$tag .= ' fill="true"';
		}
		if ( isset( $line['fillColor'] ) && '' !== trim( (string) $line['fillColor'] ) ) {
			$tag .= sprintf( ' fillcolor="%s"', esc_attr( trim( (string) $line['fillColor'] ) ) );
		}
		if ( isset( $line['fillOpacity'] ) && is_numeric( $line['fillOpacity'] ) ) {
			$tag .= sprintf( ' fillopacity="%s"', esc_attr( (string) (float) $line['fillOpacity'] ) );
		}

		$popup = isset( $line['popup'] ) ? wp_kses_post( (string) $line['popup'] ) : '';
		if ( ! empty( $line['visible'] ) && '' !== $popup ) {
			$tag .= ' visible="1"';
		}

		if ( '' !== $popup ) {
			$out .= $tag . ']' . $popup . '[/' . $tag_name . ']';
		} else {
			$out .= $tag . ' /]';
		}
	}

	return $out;
}

/**
 * Build draw-mode helper [leaflet-marker] shortcodes (preview only).
 *
 * Emits a draggable pin for each point of any line that does not yet have ≥2
 * points (i.e. the line is still being drawn). Once a line is drawn the
 * helper pins become visual noise so they are skipped. Frontend (render.php)
 * never emits these.
 *
 * @param array<int,array<string,mixed>> $lines Line objects.
 * @return array{shortcodes:string, meta:array<int,array{lineIndex:int,pointIndex:int}>}
 *               Shortcodes + per-pin metadata used by the editor for drag mapping.
 */
function bflm_build_line_point_helpers( array $lines ): array {
	$shortcodes = '';
	$meta       = array();

	foreach ( $lines as $line_index => $line ) {
		$points = isset( $line['points'] ) && is_array( $line['points'] ) ? $line['points'] : array();
		if ( count( $points ) >= 2 ) {
			continue;
		}
		foreach ( $points as $point_index => $pt ) {
			$pt_lat      = (float) ( isset( $pt['lat'] ) ? $pt['lat'] : 0 );
			$pt_lng      = (float) ( isset( $pt['lng'] ) ? $pt['lng'] : 0 );
			$label       = sprintf( 'L%d·P%d', $line_index + 1, $point_index + 1 );
			$shortcodes .= sprintf(
				'[leaflet-marker lat="%s" lng="%s" title="%s" draggable="1" /]',
				esc_attr( (string) $pt_lat ),
				esc_attr( (string) $pt_lng ),
				esc_attr( $label )
			);
			$meta[]      = array(
				'lineIndex'  => $line_index,
				'pointIndex' => $point_index,
			);
		}
	}

	return array(
		'shortcodes' => $shortcodes,
		'meta'       => $meta,
	);
}
