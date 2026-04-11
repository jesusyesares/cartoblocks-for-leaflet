<?php
/**
 * Server-side rendering for the Leaflet Map Block.
 *
 * Transforms block attributes into [leaflet-map] and [leaflet-marker] shortcodes
 * provided by the "Leaflet Map" plugin, then runs them through do_shortcode().
 *
 * Available variables (injected by WordPress):
 *   $attributes (array)   – block attributes as defined in block.json.
 *   $content    (string)  – inner block content (unused for this block).
 *   $block      (WP_Block) – block instance.
 *
 * @package BlocksForLeafletMap
 */

// Guard: should never be reached if the main plugin file bailed early,
// but keeps the file safe when loaded in isolation during tests.
if ( ! defined( 'ABSPATH' ) ) {
	return;
}

// Sanitize / cast all values coming from block attributes.
$lat               = isset( $attributes['lat'] )             ? (float) $attributes['lat']             : 0.0;
$lng               = isset( $attributes['lng'] )             ? (float) $attributes['lng']             : 0.0;
$zoom              = isset( $attributes['zoom'] )            ? (int) $attributes['zoom']              : 12;
$height            = isset( $attributes['height'] )          ? (int) $attributes['height']            : 400;
$scroll_wheel_zoom = ! empty( $attributes['scrollWheelZoom'] ) ? 'true' : 'false';
$zoom_control      = isset( $attributes['zoomControl'] ) && false === $attributes['zoomControl'] ? 'false' : 'true';
$fit_markers       = ! empty( $attributes['fitMarkers'] )    ? 'true' : 'false';
$markers           = isset( $attributes['markers'] ) && is_array( $attributes['markers'] )
	? $attributes['markers']
	: array();

// Build the [leaflet-map] shortcode.
$map_shortcode = sprintf(
	'[leaflet-map lat="%1$s" lng="%2$s" zoom="%3$d" height="%4$dpx" scrollwheel="%5$s" zoomcontrol="%6$s" fitbounds="%7$s"]',
	esc_attr( $lat ),
	esc_attr( $lng ),
	$zoom,
	$height,
	$scroll_wheel_zoom,
	$zoom_control,
	$fit_markers
);

// Build [leaflet-marker] shortcodes for each marker.
$marker_shortcodes = '';
foreach ( $markers as $marker ) {
	if ( ! isset( $marker['lat'], $marker['lng'] ) ) {
		continue;
	}

	$m_lat     = (float) $marker['lat'];
	$m_lng     = (float) $marker['lng'];
	$m_title   = isset( $marker['title'] )   ? sanitize_text_field( $marker['title'] )   : '';
	$m_content = isset( $marker['content'] ) ? wp_kses_post( $marker['content'] )        : '';

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

$wrapper_attributes = get_block_wrapper_attributes(
	array( 'class' => 'bflm-leaflet-map-block' )
);

// Render: wrapper div → shortcode output (Leaflet Map plugin handles the rest).
?>
<div <?php echo $wrapper_attributes; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- sanitized by get_block_wrapper_attributes(). ?>>
	<?php echo do_shortcode( $map_shortcode . $marker_shortcodes ); ?>
</div>
