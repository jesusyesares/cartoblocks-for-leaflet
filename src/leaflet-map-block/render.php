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
	$m_alt     = isset( $marker['alt'] ) ? sanitize_text_field( $marker['alt'] ) : '';

	// Build the open tag incrementally; include optional attrs only when set.
	$m_open_tag = sprintf(
		'[leaflet-marker lat="%1$s" lng="%2$s"',
		esc_attr( $m_lat ),
		esc_attr( $m_lng )
	);

	// title: emit only when non-empty.
	if ( '' !== $m_title ) {
		$m_open_tag .= sprintf( ' title="%s"', esc_attr( $m_title ) );
	}

	// alt: emit only when non-empty.
	if ( '' !== $m_alt ) {
		$m_open_tag .= sprintf( ' alt="%s"', esc_attr( $m_alt ) );
	}

	// visible: emit as visible="1" when true — upstream uses FILTER_VALIDATE_BOOLEAN.
	if ( ! empty( $marker['visible'] ) ) {
		$m_open_tag .= ' visible="1"';
	}

	// draggable: emit as draggable="1" when true.
	if ( ! empty( $marker['draggable'] ) ) {
		$m_open_tag .= ' draggable="1"';
	}

	// opacity: emit only when set and differs from Leaflet's default of 1.
	if ( isset( $marker['opacity'] ) ) {
		$m_opacity = (float) $marker['opacity'];
		if ( abs( $m_opacity - 1.0 ) > 0.001 ) {
			$m_open_tag .= sprintf( ' opacity="%s"', esc_attr( $m_opacity ) );
		}
	}

	// zIndexOffset: emit only when non-zero.
	if ( isset( $marker['zIndexOffset'] ) ) {
		$m_zindex = (int) $marker['zIndexOffset'];
		if ( 0 !== $m_zindex ) {
			$m_open_tag .= sprintf( ' zindexoffset="%d"', $m_zindex );
		}
	}

	// SVG marker and custom image icon are mutually exclusive: SVG wins when both flags are set.
	if ( ! empty( $marker['useSvgMarker'] ) ) {
		$m_open_tag .= ' svg="true"';
		if ( isset( $marker['svgBackground'] ) && '' !== trim( $marker['svgBackground'] ) ) {
			$m_open_tag .= sprintf( ' background="%s"', esc_attr( trim( $marker['svgBackground'] ) ) );
		}
		if ( isset( $marker['svgIconClass'] ) && '' !== trim( $marker['svgIconClass'] ) ) {
			$m_open_tag .= sprintf( ' iconclass="%s"', esc_attr( trim( $marker['svgIconClass'] ) ) );
		}
		if ( isset( $marker['svgColor'] ) && '' !== trim( $marker['svgColor'] ) ) {
			$m_open_tag .= sprintf( ' color="%s"', esc_attr( trim( $marker['svgColor'] ) ) );
		}
	} elseif ( ! empty( $marker['useCustomIcon'] ) ) {
		// Custom icon: only emit the icon group when useCustomIcon is true.
		if ( ! empty( $marker['iconUrl'] ) ) {
			$m_open_tag .= sprintf( ' iconurl="%s"', esc_attr( $marker['iconUrl'] ) );
		}
		$icon_w = isset( $marker['iconWidth'] ) && is_numeric( $marker['iconWidth'] ) ? (int) $marker['iconWidth'] : null;
		$icon_h = isset( $marker['iconHeight'] ) && is_numeric( $marker['iconHeight'] ) ? (int) $marker['iconHeight'] : null;
		if ( null !== $icon_w && null !== $icon_h && $icon_w >= 1 && $icon_h >= 1 ) {
			$m_open_tag .= sprintf( ' iconsize="%d,%d"', $icon_w, $icon_h );
		}
		$icon_ax = isset( $marker['iconAnchorX'] ) && is_numeric( $marker['iconAnchorX'] ) ? (int) $marker['iconAnchorX'] : null;
		$icon_ay = isset( $marker['iconAnchorY'] ) && is_numeric( $marker['iconAnchorY'] ) ? (int) $marker['iconAnchorY'] : null;
		if ( null !== $icon_ax && null !== $icon_ay ) {
			$m_open_tag .= sprintf( ' iconanchor="%d,%d"', $icon_ax, $icon_ay );
		}
		$popup_ax = isset( $marker['popupAnchorX'] ) && is_numeric( $marker['popupAnchorX'] ) ? (int) $marker['popupAnchorX'] : null;
		$popup_ay = isset( $marker['popupAnchorY'] ) && is_numeric( $marker['popupAnchorY'] ) ? (int) $marker['popupAnchorY'] : null;
		if ( null !== $popup_ax && null !== $popup_ay ) {
			$m_open_tag .= sprintf( ' popupanchor="%d,%d"', $popup_ax, $popup_ay );
		}
		// Shadow: only emit shadow attributes when useShadow is also true.
		if ( ! empty( $marker['useShadow'] ) ) {
			if ( ! empty( $marker['shadowUrl'] ) ) {
				$m_open_tag .= sprintf( ' shadowurl="%s"', esc_attr( $marker['shadowUrl'] ) );
			}
			$shadow_w = isset( $marker['shadowWidth'] ) && is_numeric( $marker['shadowWidth'] ) ? (int) $marker['shadowWidth'] : null;
			$shadow_h = isset( $marker['shadowHeight'] ) && is_numeric( $marker['shadowHeight'] ) ? (int) $marker['shadowHeight'] : null;
			if ( null !== $shadow_w && null !== $shadow_h && $shadow_w >= 1 && $shadow_h >= 1 ) {
				$m_open_tag .= sprintf( ' shadowsize="%d,%d"', $shadow_w, $shadow_h );
			}
			$shadow_ax = isset( $marker['shadowAnchorX'] ) && is_numeric( $marker['shadowAnchorX'] ) ? (int) $marker['shadowAnchorX'] : null;
			$shadow_ay = isset( $marker['shadowAnchorY'] ) && is_numeric( $marker['shadowAnchorY'] ) ? (int) $marker['shadowAnchorY'] : null;
			if ( null !== $shadow_ax && null !== $shadow_ay ) {
				$m_open_tag .= sprintf( ' shadowanchor="%d,%d"', $shadow_ax, $shadow_ay );
			}
		}
	}

	if ( '' !== $m_content ) {
		$marker_shortcodes .= $m_open_tag . ']' . $m_content . '[/leaflet-marker]';
	} else {
		$marker_shortcodes .= $m_open_tag . ' /]';
	}
}

// Build [leaflet-line] / [leaflet-polygon] shortcodes. Keep in sync with
// buildLineShortcodes() in edit.js and the lines section in bflm_preview_map().
$lines = isset( $attributes['lines'] ) && is_array( $attributes['lines'] )
	? $attributes['lines']
	: array();

$line_shortcodes = '';
foreach ( $lines as $line ) {
	$l_points = isset( $line['points'] ) && is_array( $line['points'] ) ? $line['points'] : array();
	if ( count( $l_points ) < 2 ) {
		continue;
	}

	$l_tag = ( isset( $line['type'] ) && 'polygon' === $line['type'] ) ? 'leaflet-polygon' : 'leaflet-line';

	$latlngs_parts = array();
	foreach ( $l_points as $pt ) {
		$latlngs_parts[] = ( (float) ( isset( $pt['lat'] ) ? $pt['lat'] : 0 ) ) . ',' . ( (float) ( isset( $pt['lng'] ) ? $pt['lng'] : 0 ) );
	}
	$l_open = sprintf( '[%s latlngs="%s"', $l_tag, esc_attr( implode( '; ', $latlngs_parts ) ) );

	if ( ! empty( $line['fitbounds'] ) ) {
		$l_open .= ' fitbounds="true"';
	}
	if ( isset( $line['color'] ) && '' !== trim( $line['color'] ) ) {
		$l_open .= sprintf( ' color="%s"', esc_attr( trim( $line['color'] ) ) );
	}
	if ( isset( $line['weight'] ) && is_numeric( $line['weight'] ) ) {
		$l_open .= sprintf( ' weight="%s"', esc_attr( (float) $line['weight'] ) );
	}
	if ( isset( $line['opacity'] ) && is_numeric( $line['opacity'] ) ) {
		$l_open .= sprintf( ' opacity="%s"', esc_attr( (float) $line['opacity'] ) );
	}
	if ( isset( $line['dashArray'] ) && '' !== trim( $line['dashArray'] ) ) {
		$l_open .= sprintf( ' dasharray="%s"', esc_attr( trim( $line['dashArray'] ) ) );
	}
	if ( isset( $line['classname'] ) && '' !== trim( $line['classname'] ) ) {
		$l_open .= sprintf( ' classname="%s"', esc_attr( trim( $line['classname'] ) ) );
	}
	if ( ! empty( $line['fill'] ) ) {
		$l_open .= ' fill="true"';
	}
	if ( isset( $line['fillColor'] ) && '' !== trim( $line['fillColor'] ) ) {
		$l_open .= sprintf( ' fillcolor="%s"', esc_attr( trim( $line['fillColor'] ) ) );
	}
	if ( isset( $line['fillOpacity'] ) && is_numeric( $line['fillOpacity'] ) ) {
		$l_open .= sprintf( ' fillopacity="%s"', esc_attr( (float) $line['fillOpacity'] ) );
	}

	$l_popup = isset( $line['popup'] ) ? wp_kses_post( $line['popup'] ) : '';
	if ( ! empty( $line['visible'] ) && '' !== $l_popup ) {
		$l_open .= ' visible="1"';
	}

	if ( '' !== $l_popup ) {
		$line_shortcodes .= $l_open . ']' . $l_popup . '[/' . $l_tag . ']';
	} else {
		$line_shortcodes .= $l_open . ' /]';
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
	<?php echo do_shortcode( $map_shortcode . $marker_shortcodes . $line_shortcodes ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- trusted output from registered shortcodes; escaping would corrupt the map HTML and inline scripts. ?>
</div>
