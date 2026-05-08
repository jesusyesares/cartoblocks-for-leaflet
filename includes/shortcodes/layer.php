<?php
/**
 * Data-layer shortcode builders: [leaflet-geojson] / [leaflet-gpx] / [leaflet-kml].
 *
 * Tag is selected by layer.type. Unknown types fall back to leaflet-geojson.
 * Layers with empty src are skipped. Custom-icon attributes are emitted only
 * when useCustomIcon is true.
 *
 * @package BlocksForLeafletMap
 */

defined( 'ABSPATH' ) || exit;

/**
 * Build data-layer shortcodes for every layer in the array.
 *
 * @param array<int,array<string,mixed>> $layers Layer objects from block attrs.
 * @return string Concatenated shortcodes (empty when none valid).
 */
function bflm_build_layer_shortcodes( array $layers ): string {
	$tag_map = array(
		'geojson' => 'leaflet-geojson',
		'gpx'     => 'leaflet-gpx',
		'kml'     => 'leaflet-kml',
	);

	$out = '';

	foreach ( $layers as $layer ) {
		$src = isset( $layer['src'] ) ? trim( (string) $layer['src'] ) : '';
		if ( '' === $src ) {
			continue;
		}
		$type     = isset( $layer['type'] ) && isset( $tag_map[ $layer['type'] ] ) ? $layer['type'] : 'geojson';
		$tag_name = $tag_map[ $type ];

		$tag = sprintf( '[%s src="%s"', $tag_name, esc_attr( $src ) );

		if ( ! empty( $layer['fitbounds'] ) ) {
			$tag .= ' fitbounds="true"';
		}
		if ( isset( $layer['popupText'] ) && '' !== trim( (string) $layer['popupText'] ) ) {
			$tag .= sprintf( ' popup_text="%s"', esc_attr( trim( (string) $layer['popupText'] ) ) );
		}
		if ( isset( $layer['popupProperty'] ) && '' !== trim( (string) $layer['popupProperty'] ) ) {
			$tag .= sprintf( ' popup_property="%s"', esc_attr( trim( (string) $layer['popupProperty'] ) ) );
		}
		if ( ! empty( $layer['tableView'] ) ) {
			$tag .= ' table_view="1"';
		}
		if ( isset( $layer['color'] ) && '' !== trim( (string) $layer['color'] ) ) {
			$tag .= sprintf( ' color="%s"', esc_attr( trim( (string) $layer['color'] ) ) );
		}
		if ( isset( $layer['weight'] ) && is_numeric( $layer['weight'] ) ) {
			$tag .= sprintf( ' weight="%s"', esc_attr( (string) (float) $layer['weight'] ) );
		}
		if ( isset( $layer['opacity'] ) && is_numeric( $layer['opacity'] ) ) {
			$tag .= sprintf( ' opacity="%s"', esc_attr( (string) (float) $layer['opacity'] ) );
		}
		if ( isset( $layer['dashArray'] ) && '' !== trim( (string) $layer['dashArray'] ) ) {
			$tag .= sprintf( ' dasharray="%s"', esc_attr( trim( (string) $layer['dashArray'] ) ) );
		}
		if ( isset( $layer['classname'] ) && '' !== trim( (string) $layer['classname'] ) ) {
			$tag .= sprintf( ' classname="%s"', esc_attr( trim( (string) $layer['classname'] ) ) );
		}
		if ( ! empty( $layer['fill'] ) ) {
			$tag .= ' fill="true"';
		}
		if ( isset( $layer['fillColor'] ) && '' !== trim( (string) $layer['fillColor'] ) ) {
			$tag .= sprintf( ' fillcolor="%s"', esc_attr( trim( (string) $layer['fillColor'] ) ) );
		}
		if ( isset( $layer['fillOpacity'] ) && is_numeric( $layer['fillOpacity'] ) ) {
			$tag .= sprintf( ' fillopacity="%s"', esc_attr( (string) (float) $layer['fillOpacity'] ) );
		}

		if ( ! empty( $layer['useCustomIcon'] ) ) {
			if ( ! empty( $layer['iconUrl'] ) ) {
				$tag .= sprintf( ' iconurl="%s"', esc_attr( (string) $layer['iconUrl'] ) );
			}
			$icon_w = isset( $layer['iconWidth'] ) && is_numeric( $layer['iconWidth'] ) ? (int) $layer['iconWidth'] : null;
			$icon_h = isset( $layer['iconHeight'] ) && is_numeric( $layer['iconHeight'] ) ? (int) $layer['iconHeight'] : null;
			if ( null !== $icon_w && null !== $icon_h && $icon_w >= 1 && $icon_h >= 1 ) {
				$tag .= sprintf( ' iconsize="%d,%d"', $icon_w, $icon_h );
			}
			$icon_ax = isset( $layer['iconAnchorX'] ) && is_numeric( $layer['iconAnchorX'] ) ? (int) $layer['iconAnchorX'] : null;
			$icon_ay = isset( $layer['iconAnchorY'] ) && is_numeric( $layer['iconAnchorY'] ) ? (int) $layer['iconAnchorY'] : null;
			if ( null !== $icon_ax && null !== $icon_ay ) {
				$tag .= sprintf( ' iconanchor="%d,%d"', $icon_ax, $icon_ay );
			}
			$popup_ax = isset( $layer['popupAnchorX'] ) && is_numeric( $layer['popupAnchorX'] ) ? (int) $layer['popupAnchorX'] : null;
			$popup_ay = isset( $layer['popupAnchorY'] ) && is_numeric( $layer['popupAnchorY'] ) ? (int) $layer['popupAnchorY'] : null;
			if ( null !== $popup_ax && null !== $popup_ay ) {
				$tag .= sprintf( ' popupanchor="%d,%d"', $popup_ax, $popup_ay );
			}
		}

		$out .= $tag . ' /]';
	}

	return $out;
}
