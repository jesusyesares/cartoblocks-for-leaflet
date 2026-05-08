<?php
/**
 * [leaflet-marker] shortcode builder.
 *
 * SVG marker and custom image icon are mutually exclusive: SVG wins when both
 * flags are set. Mirror buildShortcode() in src/leaflet-map-block/edit.js.
 *
 * @package BlocksForLeafletMap
 */

defined( 'ABSPATH' ) || exit;

/**
 * Build [leaflet-marker] shortcodes for every marker in the array.
 *
 * Markers without lat/lng are skipped. Optional attributes (title, alt,
 * visible, draggable, opacity, zIndexOffset, SVG icon, custom image icon,
 * shadow) are emitted only when explicitly set.
 *
 * @param array<int,array<string,mixed>> $markers Marker objects from block attrs.
 * @return string Concatenated shortcodes (empty when none valid).
 */
function bflm_build_marker_shortcodes( array $markers ): string {
	$out = '';

	foreach ( $markers as $marker ) {
		if ( ! isset( $marker['lat'], $marker['lng'] ) ) {
			continue;
		}

		$m_lat     = (float) $marker['lat'];
		$m_lng     = (float) $marker['lng'];
		$m_title   = isset( $marker['title'] ) ? sanitize_text_field( (string) $marker['title'] ) : '';
		$m_content = isset( $marker['content'] ) ? wp_kses_post( (string) $marker['content'] ) : '';
		$m_alt     = isset( $marker['alt'] ) ? sanitize_text_field( (string) $marker['alt'] ) : '';

		$tag = sprintf(
			'[leaflet-marker lat="%1$s" lng="%2$s"',
			esc_attr( (string) $m_lat ),
			esc_attr( (string) $m_lng )
		);

		if ( '' !== $m_title ) {
			$tag .= sprintf( ' title="%s"', esc_attr( $m_title ) );
		}
		if ( '' !== $m_alt ) {
			$tag .= sprintf( ' alt="%s"', esc_attr( $m_alt ) );
		}
		if ( ! empty( $marker['visible'] ) ) {
			$tag .= ' visible="1"';
		}
		if ( ! empty( $marker['draggable'] ) ) {
			$tag .= ' draggable="1"';
		}
		if ( isset( $marker['opacity'] ) ) {
			$opacity = (float) $marker['opacity'];
			if ( abs( $opacity - 1.0 ) > 0.001 ) {
				$tag .= sprintf( ' opacity="%s"', esc_attr( (string) $opacity ) );
			}
		}
		if ( isset( $marker['zIndexOffset'] ) ) {
			$z = (int) $marker['zIndexOffset'];
			if ( 0 !== $z ) {
				$tag .= sprintf( ' zindexoffset="%d"', $z );
			}
		}

		if ( ! empty( $marker['useSvgMarker'] ) ) {
			$tag .= ' svg="true"';
			if ( isset( $marker['svgBackground'] ) && '' !== trim( (string) $marker['svgBackground'] ) ) {
				$tag .= sprintf( ' background="%s"', esc_attr( trim( (string) $marker['svgBackground'] ) ) );
			}
			if ( isset( $marker['svgIconClass'] ) && '' !== trim( (string) $marker['svgIconClass'] ) ) {
				$tag .= sprintf( ' iconclass="%s"', esc_attr( trim( (string) $marker['svgIconClass'] ) ) );
			}
			if ( isset( $marker['svgColor'] ) && '' !== trim( (string) $marker['svgColor'] ) ) {
				$tag .= sprintf( ' color="%s"', esc_attr( trim( (string) $marker['svgColor'] ) ) );
			}
		} elseif ( ! empty( $marker['useCustomIcon'] ) ) {
			if ( ! empty( $marker['iconUrl'] ) ) {
				$tag .= sprintf( ' iconurl="%s"', esc_attr( (string) $marker['iconUrl'] ) );
			}
			$icon_w = isset( $marker['iconWidth'] ) && is_numeric( $marker['iconWidth'] ) ? (int) $marker['iconWidth'] : null;
			$icon_h = isset( $marker['iconHeight'] ) && is_numeric( $marker['iconHeight'] ) ? (int) $marker['iconHeight'] : null;
			if ( null !== $icon_w && null !== $icon_h && $icon_w >= 1 && $icon_h >= 1 ) {
				$tag .= sprintf( ' iconsize="%d,%d"', $icon_w, $icon_h );
			}
			$icon_ax = isset( $marker['iconAnchorX'] ) && is_numeric( $marker['iconAnchorX'] ) ? (int) $marker['iconAnchorX'] : null;
			$icon_ay = isset( $marker['iconAnchorY'] ) && is_numeric( $marker['iconAnchorY'] ) ? (int) $marker['iconAnchorY'] : null;
			if ( null !== $icon_ax && null !== $icon_ay ) {
				$tag .= sprintf( ' iconanchor="%d,%d"', $icon_ax, $icon_ay );
			}
			$popup_ax = isset( $marker['popupAnchorX'] ) && is_numeric( $marker['popupAnchorX'] ) ? (int) $marker['popupAnchorX'] : null;
			$popup_ay = isset( $marker['popupAnchorY'] ) && is_numeric( $marker['popupAnchorY'] ) ? (int) $marker['popupAnchorY'] : null;
			if ( null !== $popup_ax && null !== $popup_ay ) {
				$tag .= sprintf( ' popupanchor="%d,%d"', $popup_ax, $popup_ay );
			}
			if ( ! empty( $marker['useShadow'] ) ) {
				if ( ! empty( $marker['shadowUrl'] ) ) {
					$tag .= sprintf( ' shadowurl="%s"', esc_attr( (string) $marker['shadowUrl'] ) );
				}
				$shadow_w = isset( $marker['shadowWidth'] ) && is_numeric( $marker['shadowWidth'] ) ? (int) $marker['shadowWidth'] : null;
				$shadow_h = isset( $marker['shadowHeight'] ) && is_numeric( $marker['shadowHeight'] ) ? (int) $marker['shadowHeight'] : null;
				if ( null !== $shadow_w && null !== $shadow_h && $shadow_w >= 1 && $shadow_h >= 1 ) {
					$tag .= sprintf( ' shadowsize="%d,%d"', $shadow_w, $shadow_h );
				}
				$shadow_ax = isset( $marker['shadowAnchorX'] ) && is_numeric( $marker['shadowAnchorX'] ) ? (int) $marker['shadowAnchorX'] : null;
				$shadow_ay = isset( $marker['shadowAnchorY'] ) && is_numeric( $marker['shadowAnchorY'] ) ? (int) $marker['shadowAnchorY'] : null;
				if ( null !== $shadow_ax && null !== $shadow_ay ) {
					$tag .= sprintf( ' shadowanchor="%d,%d"', $shadow_ax, $shadow_ay );
				}
			}
		}

		if ( '' !== $m_content ) {
			$out .= $tag . ']' . $m_content . '[/leaflet-marker]';
		} else {
			$out .= $tag . ' /]';
		}
	}

	return $out;
}
