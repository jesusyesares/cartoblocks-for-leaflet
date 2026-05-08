<?php
/**
 * Overlay shortcode builders: [leaflet-image-overlay] / [leaflet-video-overlay].
 *
 * Tag is selected by overlay.type ('video' → leaflet-video-overlay, otherwise
 * leaflet-image-overlay). Overlays with empty src or bounds are skipped.
 * keepaspectratio is only emitted on image overlays (video overlays do not
 * support that attribute upstream).
 *
 * @package BlocksForLeafletMap
 */

defined( 'ABSPATH' ) || exit;

/**
 * Build [leaflet-image-overlay] / [leaflet-video-overlay] shortcodes for every
 * overlay in the array.
 *
 * @param array<int,array<string,mixed>> $overlays Overlay objects from block attrs.
 * @return string Concatenated shortcodes (empty when none valid).
 */
function bflm_build_overlay_shortcodes( array $overlays ): string {
	$out = '';

	foreach ( $overlays as $overlay ) {
		$src    = isset( $overlay['src'] ) ? trim( (string) $overlay['src'] ) : '';
		$bounds = isset( $overlay['bounds'] ) ? trim( (string) $overlay['bounds'] ) : '';
		if ( '' === $src || '' === $bounds ) {
			continue;
		}

		$tag_name = ( isset( $overlay['type'] ) && 'video' === $overlay['type'] )
			? 'leaflet-video-overlay'
			: 'leaflet-image-overlay';

		$tag = sprintf(
			'[%s src="%s" bounds="%s"',
			$tag_name,
			esc_attr( $src ),
			esc_attr( $bounds )
		);

		if ( isset( $overlay['opacity'] ) && is_numeric( $overlay['opacity'] ) ) {
			$tag .= sprintf( ' opacity="%s"', esc_attr( (string) (float) $overlay['opacity'] ) );
		}
		if ( ! empty( $overlay['interactive'] ) ) {
			$tag .= ' interactive="true"';
		}
		if ( isset( $overlay['alt'] ) && '' !== trim( (string) $overlay['alt'] ) ) {
			$tag .= sprintf( ' alt="%s"', esc_attr( trim( (string) $overlay['alt'] ) ) );
		}
		if ( isset( $overlay['zIndex'] ) && is_numeric( $overlay['zIndex'] ) ) {
			$tag .= sprintf( ' zindex="%d"', (int) $overlay['zIndex'] );
		}
		if ( isset( $overlay['classname'] ) && '' !== trim( (string) $overlay['classname'] ) ) {
			$tag .= sprintf( ' classname="%s"', esc_attr( trim( (string) $overlay['classname'] ) ) );
		}
		if ( 'leaflet-image-overlay' === $tag_name && isset( $overlay['keepAspectRatio'] ) && false === $overlay['keepAspectRatio'] ) {
			$tag .= ' keepaspectratio="false"';
		}

		$out .= $tag . ' /]';
	}

	return $out;
}
