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
$lat  = isset( $attributes['lat'] ) ? (float) $attributes['lat'] : 0.0;
$lng  = isset( $attributes['lng'] ) ? (float) $attributes['lng'] : 0.0;
$zoom = isset( $attributes['zoom'] ) ? (int) $attributes['zoom'] : 12;

// Height: accept string with unit (e.g., "400px", "50vh") or bare number for backwards compat.
$height_raw = isset( $attributes['height'] ) ? $attributes['height'] : '400px';
$height     = is_numeric( $height_raw ) ? $height_raw . 'px' : sanitize_text_field( $height_raw );
if ( ! preg_match( '/^\d+(\.\d+)?(px|%|vh|vw|em|rem)$/', $height ) ) {
	$height = '400px';
}

// Width: accept string with unit, default 100%.
$width_raw = isset( $attributes['width'] ) ? $attributes['width'] : '100%';
$width     = is_numeric( $width_raw ) ? $width_raw . 'px' : sanitize_text_field( $width_raw );
if ( ! preg_match( '/^\d+(\.\d+)?(px|%|vh|vw|em|rem)$/', $width ) ) {
	$width = '100%';
}
$scroll_wheel_zoom = ! empty( $attributes['scrollWheelZoom'] ) ? 'true' : 'false';
$zoom_control      = isset( $attributes['zoomControl'] ) && false === $attributes['zoomControl'] ? 'false' : 'true';
$fit_markers       = ! empty( $attributes['fitMarkers'] ) ? 'true' : 'false';
$show_scale        = ! empty( $attributes['showScale'] ) ? '1' : '0';
$attribution       = isset( $attributes['attribution'] ) ? $attributes['attribution'] : '';

// Interaction attributes: only include in shortcode when explicitly set (not empty = "Default").
$interaction_atts = array(
	'dragging'          => isset( $attributes['dragging'] ) ? $attributes['dragging'] : '',
	'keyboard'          => isset( $attributes['keyboard'] ) ? $attributes['keyboard'] : '',
	'doubleclickzoom'   => isset( $attributes['doubleClickZoom'] ) ? $attributes['doubleClickZoom'] : '',
	'boxzoom'           => isset( $attributes['boxZoom'] ) ? $attributes['boxZoom'] : '',
	'closepopuponclick' => isset( $attributes['closePopupOnClick'] ) ? $attributes['closePopupOnClick'] : '',
	'tap'               => isset( $attributes['tap'] ) ? $attributes['tap'] : '',
	'inertia'           => isset( $attributes['inertia'] ) ? $attributes['inertia'] : '',
);

$interaction_shortcode = '';
foreach ( $interaction_atts as $key => $value ) {
	if ( '' !== $value ) {
		$interaction_shortcode .= sprintf( ' %s="%s"', $key, esc_attr( $value ) );
	}
}

// Zoom & bounds attributes: only include when explicitly set.
$zoom_bounds_atts = array(
	'min_zoom'  => isset( $attributes['minZoom'] ) && '' !== $attributes['minZoom'] ? $attributes['minZoom'] : '',
	'max_zoom'  => isset( $attributes['maxZoom'] ) && '' !== $attributes['maxZoom'] ? $attributes['maxZoom'] : '',
	'maxbounds' => isset( $attributes['maxBounds'] ) && '' !== $attributes['maxBounds'] ? $attributes['maxBounds'] : '',
);

$zoom_bounds_shortcode = '';
foreach ( $zoom_bounds_atts as $key => $value ) {
	if ( '' !== $value ) {
		$zoom_bounds_shortcode .= sprintf( ' %s="%s"', $key, esc_attr( $value ) );
	}
}

$markers = isset( $attributes['markers'] ) && is_array( $attributes['markers'] )
	? $attributes['markers']
	: array();

// Build the [leaflet-map] shortcode.
// Keep in sync with buildShortcode() in src/leaflet-map-block/edit.js
// (LEAFLET_MAP_DESCRIPTORS table + buildShortcode function). Any attribute
// change here must be mirrored there (and vice versa) or the editor shortcode
// strip will drift from the frontend output.
// Width is not passed to the shortcode — it is applied to the wrapper div instead
// so the Leaflet Map shortcode always renders at 100% of its container.
$map_shortcode = sprintf(
	'[leaflet-map lat="%1$s" lng="%2$s" zoom="%3$d" height="%4$s" scrollwheel="%5$s" zoomcontrol="%6$s" fitbounds="%7$s" show_scale="%8$s"',
	esc_attr( $lat ),
	esc_attr( $lng ),
	$zoom,
	esc_attr( $height ),
	$scroll_wheel_zoom,
	$zoom_control,
	$fit_markers,
	$show_scale
);

// Append interaction attributes (only those explicitly set).
$map_shortcode .= $interaction_shortcode;

// Append zoom & bounds attributes (only those explicitly set).
$map_shortcode .= $zoom_bounds_shortcode;

// Tile layer attributes: only include when explicitly set.
// Note: esc_url_raw() would strip {s}, {z}, {x}, {y} placeholders in tileurl because
// curly braces fall outside RFC 3986's allowed character set. esc_attr() is used instead,
// which only escapes HTML special characters and preserves template placeholders intact.
$tile_layer_atts = array();

if ( isset( $attributes['tileurl'] ) && '' !== $attributes['tileurl'] ) {
	$tile_layer_atts['tileurl'] = esc_attr( $attributes['tileurl'] );
}
if ( isset( $attributes['tilesize'] ) && '' !== $attributes['tilesize'] ) {
	$tile_layer_atts['tilesize'] = (int) $attributes['tilesize'];
}
if ( isset( $attributes['subdomains'] ) && '' !== $attributes['subdomains'] ) {
	$tile_layer_atts['subdomains'] = esc_attr( $attributes['subdomains'] );
}
if ( isset( $attributes['mapid'] ) && '' !== $attributes['mapid'] ) {
	$tile_layer_atts['mapid'] = esc_attr( $attributes['mapid'] );
}
if ( isset( $attributes['accesstoken'] ) && '' !== $attributes['accesstoken'] ) {
	$tile_layer_atts['accesstoken'] = esc_attr( $attributes['accesstoken'] );
}
if ( isset( $attributes['zoomoffset'] ) && '' !== $attributes['zoomoffset'] ) {
	$tile_layer_atts['zoomoffset'] = (int) $attributes['zoomoffset'];
}
if ( isset( $attributes['nowrap'] ) && '' !== $attributes['nowrap'] ) {
	$tile_layer_atts['nowrap'] = 'true' === $attributes['nowrap'] ? 'true' : 'false';
}
if ( isset( $attributes['detectretina'] ) && '' !== $attributes['detectretina'] ) {
	// Shortcode attribute is detect_retina (with underscore) — confirmed in
	// class.map-shortcode.php line 290 of bozdoz/wp-plugin-leaflet-map.
	$tile_layer_atts['detect_retina'] = 'true' === $attributes['detectretina'] ? 'true' : 'false';
}

$tile_layer_shortcode = '';
foreach ( $tile_layer_atts as $key => $value ) {
	if ( is_int( $value ) ) {
		$tile_layer_shortcode .= sprintf( ' %s="%d"', $key, $value );
	} else {
		$tile_layer_shortcode .= sprintf( ' %s="%s"', $key, $value );
	}
}

$map_shortcode .= $tile_layer_shortcode;

// Attribution: use wp_kses_post (allows safe HTML like links) and single quotes
// so inner double quotes (e.g., href="...") don't break the shortcode parser.
if ( '' !== $attribution ) {
	$map_shortcode .= sprintf( " attribution='%s'", wp_kses_post( $attribution ) );
}

$map_shortcode .= ']';

// Build [leaflet-marker] shortcodes for each marker.
$marker_shortcodes = '';
foreach ( $markers as $marker ) {
	if ( ! isset( $marker['lat'], $marker['lng'] ) ) {
		continue;
	}

	$m_lat     = (float) $marker['lat'];
	$m_lng     = (float) $marker['lng'];
	$m_title   = isset( $marker['title'] ) ? sanitize_text_field( $marker['title'] ) : '';
	$m_content = isset( $marker['content'] ) ? wp_kses_post( $marker['content'] ) : '';

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
	array(
		'class' => 'bflm-leaflet-map-block',
		'style' => sprintf( 'width:%s;', esc_attr( $width ) ),
	)
);

// Render: wrapper div → shortcode output (Leaflet Map plugin handles the rest).
?>
<div <?php echo $wrapper_attributes; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- sanitized by get_block_wrapper_attributes(). ?>>
	<?php echo do_shortcode( $map_shortcode . $marker_shortcodes ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- trusted output from registered shortcodes; escaping would corrupt the map HTML and inline scripts. ?>
</div>
