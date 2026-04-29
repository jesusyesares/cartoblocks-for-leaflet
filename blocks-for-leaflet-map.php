<?php
/**
 * Plugin Name:       Blocks for Leaflet Map
 * Plugin URI:        https://github.com/jesusyesares/blocks-for-leaflet-map
 * Description:       A dynamic Gutenberg block that wraps the Leaflet Map plugin shortcodes. Requires the "Leaflet Map" plugin to be installed and active.
 * Version:           1.0.1
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Jesús Yesares García
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       blocks-for-leaflet-map
 *
 * @package BlocksForLeafletMap
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

define( 'BFLM_VERSION', '1.0.1' );
define( 'BFLM_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'BFLM_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'BFLM_LEAFLET_MAP_PLUGIN', 'leaflet-map/leaflet-map.php' );

// ---------------------------------------------------------------------------
// Dependency management via TGM Plugin Activation.
// ---------------------------------------------------------------------------

require_once BFLM_PLUGIN_DIR . 'includes/class-tgm-plugin-activation.php';

/**
 * Register required plugins with TGMPA.
 */
function bflm_register_required_plugins(): void {
	$plugins = array(
		array(
			'name'     => 'Leaflet Map',
			'slug'     => 'leaflet-map',
			'required' => true,
		),
	);

	$config = array(
		'id'           => 'blocks-for-leaflet-map',
		'default_path' => '',
		'menu'         => 'tgmpa-install-plugins',
		'parent_slug'  => 'plugins.php',
		'capability'   => 'manage_options',
		'has_notices'  => true,
		'dismissable'  => false,
		'dismiss_msg'  => '',
		'is_automatic' => false,
		'message'      => '',
	);

	tgmpa( $plugins, $config );
}
add_action( 'tgmpa_register', 'bflm_register_required_plugins' );

// ---------------------------------------------------------------------------
// Dependency check: "Leaflet Map" plugin must be active to register the block.
// ---------------------------------------------------------------------------

/**
 * Returns true when the Leaflet Map plugin is active.
 *
 * @return bool
 */
function bflm_is_leaflet_map_active(): bool {
	if ( ! function_exists( 'is_plugin_active' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}

	return is_plugin_active( BFLM_LEAFLET_MAP_PLUGIN );
}

if ( ! bflm_is_leaflet_map_active() ) {
	return; // Stop loading — TGMPA notice handles the rest.
}

// ---------------------------------------------------------------------------
// Block registration (only reached when Leaflet Map is active).
// ---------------------------------------------------------------------------

/**
 * Registers all blocks from the build manifest.
 *
 * @see https://make.wordpress.org/core/2025/03/13/more-efficient-block-type-registration-in-6-8/
 */
function bflm_register_blocks(): void {
	wp_register_block_types_from_metadata_collection(
		BFLM_PLUGIN_DIR . 'build',
		BFLM_PLUGIN_DIR . 'build/blocks-manifest.php'
	);
}
add_action( 'init', 'bflm_register_blocks' );

// ---------------------------------------------------------------------------
// Preview endpoint — AJAX handler that outputs a complete HTML page rendering
// the map via Leaflet Map shortcodes. The editor iframe loads this URL so the
// map is rendered exactly as it appears on the frontend.
// ---------------------------------------------------------------------------

/**
 * Output a minimal HTML page that renders the map via [leaflet-map] and
 * [leaflet-marker] shortcodes. Called by the editor iframe's src attribute.
 *
 * Security: nonce verified, all inputs sanitised, output escaped via shortcode
 * trusted output (same pattern as render.php).
 */
function bflm_preview_map(): void {
	// Verify nonce.
	$nonce = isset( $_GET['bflm_nonce'] ) ? sanitize_text_field( wp_unslash( $_GET['bflm_nonce'] ) ) : '';
	if ( ! wp_verify_nonce( $nonce, 'bflm_preview_nonce' ) ) {
		wp_die( esc_html__( 'Invalid or expired preview token.', 'blocks-for-leaflet-map' ), 403 );
	}

	// Sanitise map parameters.
	$lat        = isset( $_GET['lat'] ) ? (float) $_GET['lat'] : 0.0;
	$lng        = isset( $_GET['lng'] ) ? (float) $_GET['lng'] : 0.0;
	$zoom       = isset( $_GET['zoom'] ) ? absint( $_GET['zoom'] ) : 12;
	$height_raw = isset( $_GET['height'] ) ? sanitize_text_field( wp_unslash( $_GET['height'] ) ) : '400px';
	$height     = is_numeric( $height_raw ) ? $height_raw . 'px' : $height_raw;
	if ( ! preg_match( '/^\d+(\.\d+)?(px|%|vh|vw|em|rem)$/', $height ) ) {
		$height = '400px';
	}

	$scroll_wheel    = ! empty( $_GET['scrollWheelZoom'] ) && 'true' === $_GET['scrollWheelZoom'] ? 'true' : 'false';
	$zoom_ctrl       = ! isset( $_GET['zoomControl'] ) || 'false' !== $_GET['zoomControl'] ? 'true' : 'false';
	$block_id        = isset( $_GET['blockId'] ) ? sanitize_text_field( wp_unslash( $_GET['blockId'] ) ) : '';
	$markers_raw     = isset( $_GET['markers'] ) ? wp_unslash( $_GET['markers'] ) : '[]'; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- JSON decoded and each field sanitised below.
	$markers_decoded = json_decode( $markers_raw, true );
	$markers         = is_array( $markers_decoded ) ? $markers_decoded : array();

	$lines_raw     = isset( $_GET['lines'] ) ? wp_unslash( $_GET['lines'] ) : '[]'; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- JSON decoded and each field sanitised below.
	$lines_decoded = json_decode( $lines_raw, true );
	$lines         = is_array( $lines_decoded ) ? $lines_decoded : array();

	$circles_raw      = isset( $_GET['circles'] ) ? wp_unslash( $_GET['circles'] ) : '[]'; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- JSON decoded and each field sanitised below.
	$circles_decoded  = json_decode( $circles_raw, true );
	$circles          = is_array( $circles_decoded ) ? $circles_decoded : array();
	$layers_raw       = isset( $_GET['layers'] ) ? wp_unslash( $_GET['layers'] ) : '[]'; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- JSON decoded and each field sanitised below.
	$layers_decoded   = json_decode( $layers_raw, true );
	$layers           = is_array( $layers_decoded ) ? $layers_decoded : array();
	$overlays_raw     = isset( $_GET['overlays'] ) ? wp_unslash( $_GET['overlays'] ) : '[]'; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- JSON decoded and each field sanitised below.
	$overlays_decoded = json_decode( $overlays_raw, true );
	$overlays         = is_array( $overlays_decoded ) ? $overlays_decoded : array();
	$fit_markers      = ! empty( $_GET['fitMarkers'] ) && 'true' === $_GET['fitMarkers'] ? 'true' : 'false';
	$show_scale       = ! empty( $_GET['showScale'] ) && 'true' === $_GET['showScale'] ? '1' : '0';
	$attribution      = isset( $_GET['attribution'] ) ? wp_kses_post( wp_unslash( $_GET['attribution'] ) ) : '';
	$is_image_map     = ! empty( $_GET['imageMap'] ) && 'true' === $_GET['imageMap'];
	$image_src        = $is_image_map && isset( $_GET['imageSrc'] ) ? trim( sanitize_text_field( wp_unslash( $_GET['imageSrc'] ) ) ) : '';
	$image_x          = $is_image_map && isset( $_GET['imageX'] ) ? (float) $_GET['imageX'] : 0.0;
	$image_y          = $is_image_map && isset( $_GET['imageY'] ) ? (float) $_GET['imageY'] : 0.0;
	$image_zoom       = $is_image_map && isset( $_GET['imageZoom'] ) ? (float) $_GET['imageZoom'] : 0.0;
	$wms_enabled      = ! $is_image_map && ! empty( $_GET['wmsEnabled'] ) && 'true' === $_GET['wmsEnabled'];
	$wms_source       = $wms_enabled && isset( $_GET['wmsSource'] ) ? trim( sanitize_text_field( wp_unslash( $_GET['wmsSource'] ) ) ) : '';
	$wms_layer        = $wms_enabled && isset( $_GET['wmsLayer'] ) ? trim( sanitize_text_field( wp_unslash( $_GET['wmsLayer'] ) ) ) : '';
	$wms_crs          = $wms_enabled && isset( $_GET['wmsCrs'] ) ? trim( sanitize_text_field( wp_unslash( $_GET['wmsCrs'] ) ) ) : '';

	// Interaction attributes: only include when explicitly set.
	$interaction_keys = array(
		'dragging'          => 'dragging',
		'keyboard'          => 'keyboard',
		'doubleClickZoom'   => 'doubleclickzoom',
		'boxZoom'           => 'boxzoom',
		'closePopupOnClick' => 'closepopuponclick',
		'tap'               => 'tap',
		'inertia'           => 'inertia',
	);

	$interaction_shortcode = '';
	foreach ( $interaction_keys as $get_key => $shortcode_key ) {
		$value = isset( $_GET[ $get_key ] ) ? sanitize_text_field( wp_unslash( $_GET[ $get_key ] ) ) : '';
		if ( '' !== $value && in_array( $value, array( 'true', 'false' ), true ) ) {
			$interaction_shortcode .= sprintf( ' %s="%s"', $shortcode_key, esc_attr( $value ) );
		}
	}

	// Zoom & bounds attributes: only include when explicitly set.
	$min_zoom   = isset( $_GET['minZoom'] ) ? sanitize_text_field( wp_unslash( $_GET['minZoom'] ) ) : '';
	$max_zoom   = isset( $_GET['maxZoom'] ) ? sanitize_text_field( wp_unslash( $_GET['maxZoom'] ) ) : '';
	$max_bounds = isset( $_GET['maxBounds'] ) ? sanitize_text_field( wp_unslash( $_GET['maxBounds'] ) ) : '';

	$zoom_bounds_shortcode = '';
	if ( '' !== $min_zoom && is_numeric( $min_zoom ) ) {
		$zoom_bounds_shortcode .= sprintf( ' min_zoom="%s"', esc_attr( $min_zoom ) );
	}
	if ( '' !== $max_zoom && is_numeric( $max_zoom ) ) {
		$zoom_bounds_shortcode .= sprintf( ' max_zoom="%s"', esc_attr( $max_zoom ) );
	}
	if ( '' !== $max_bounds ) {
		$zoom_bounds_shortcode .= sprintf( ' maxbounds="%s"', esc_attr( $max_bounds ) );
	}

	// Build shortcodes (same logic as render.php).
	// Width is applied to the editor block container, not the shortcode.
	$map_shortcode = sprintf(
		'[leaflet-map lat="%1$s" lng="%2$s" zoom="%3$d" height="%4$s" scrollwheel="%5$s" zoomcontrol="%6$s" fitbounds="%7$s" show_scale="%8$s"',
		esc_attr( (string) $lat ),
		esc_attr( (string) $lng ),
		$zoom,
		esc_attr( $height ),
		$scroll_wheel,
		$zoom_ctrl,
		$fit_markers,
		$show_scale
	);

	// Append interaction attributes (only those explicitly set).
	$map_shortcode .= $interaction_shortcode;

	// Append zoom & bounds attributes (only those explicitly set).
	$map_shortcode .= $zoom_bounds_shortcode;

	// Tile layer attributes: only include when explicitly set.
	// Note: esc_url_raw() strips {s}/{z}/{x}/{y} placeholders; esc_attr() used instead.
	$tile_preview_shortcode = '';

	$tileurl_preview = isset( $_GET['tileurl'] ) ? sanitize_text_field( wp_unslash( $_GET['tileurl'] ) ) : '';
	if ( '' !== $tileurl_preview ) {
		$tile_preview_shortcode .= sprintf( ' tileurl="%s"', esc_attr( $tileurl_preview ) );
	}

	$tilesize_preview = isset( $_GET['tilesize'] ) ? sanitize_text_field( wp_unslash( $_GET['tilesize'] ) ) : '';
	if ( '' !== $tilesize_preview && is_numeric( $tilesize_preview ) && (int) $tilesize_preview >= 1 ) {
		$tile_preview_shortcode .= sprintf( ' tilesize="%d"', (int) $tilesize_preview );
	}

	$subdomains_preview = isset( $_GET['subdomains'] ) ? sanitize_text_field( wp_unslash( $_GET['subdomains'] ) ) : '';
	if ( '' !== $subdomains_preview ) {
		$tile_preview_shortcode .= sprintf( ' subdomains="%s"', esc_attr( $subdomains_preview ) );
	}

	$mapid_preview = isset( $_GET['mapid'] ) ? sanitize_text_field( wp_unslash( $_GET['mapid'] ) ) : '';
	if ( '' !== $mapid_preview ) {
		$tile_preview_shortcode .= sprintf( ' mapid="%s"', esc_attr( $mapid_preview ) );
	}

	$accesstoken_preview = isset( $_GET['accesstoken'] ) ? sanitize_text_field( wp_unslash( $_GET['accesstoken'] ) ) : '';
	if ( '' !== $accesstoken_preview ) {
		$tile_preview_shortcode .= sprintf( ' accesstoken="%s"', esc_attr( $accesstoken_preview ) );
	}

	$zoomoffset_preview = isset( $_GET['zoomoffset'] ) ? sanitize_text_field( wp_unslash( $_GET['zoomoffset'] ) ) : '';
	if ( '' !== $zoomoffset_preview && is_numeric( $zoomoffset_preview ) ) {
		$tile_preview_shortcode .= sprintf( ' zoomoffset="%d"', (int) $zoomoffset_preview );
	}

	$nowrap_preview = isset( $_GET['nowrap'] ) ? sanitize_text_field( wp_unslash( $_GET['nowrap'] ) ) : '';
	if ( in_array( $nowrap_preview, array( 'true', 'false' ), true ) ) {
		$tile_preview_shortcode .= sprintf( ' nowrap="%s"', esc_attr( $nowrap_preview ) );
	}

	$detectretina_preview = isset( $_GET['detectretina'] ) ? sanitize_text_field( wp_unslash( $_GET['detectretina'] ) ) : '';
	if ( in_array( $detectretina_preview, array( 'true', 'false' ), true ) ) {
		// Shortcode attribute is detect_retina (with underscore) — confirmed in class.map-shortcode.php.
		$tile_preview_shortcode .= sprintf( ' detect_retina="%s"', esc_attr( $detectretina_preview ) );
	}

	$map_shortcode .= $tile_preview_shortcode;

	if ( '' !== $attribution ) {
		$map_shortcode .= sprintf( " attribution='%s'", wp_kses_post( $attribution ) );
	}

	$map_shortcode .= ']';

	// Build [leaflet-wms] shortcode when wmsEnabled (mirrors render.php logic).
	if ( $wms_enabled ) {
		$wms_shortcode = sprintf(
			'[leaflet-wms lat="%1$s" lng="%2$s" zoom="%3$d" height="%4$s" scrollwheel="%5$s" zoomcontrol="%6$s"',
			esc_attr( (string) $lat ),
			esc_attr( (string) $lng ),
			$zoom,
			esc_attr( $height ),
			$scroll_wheel,
			$zoom_ctrl
		);
		if ( '' !== $wms_source ) {
			$wms_shortcode .= sprintf( ' src="%s"', esc_attr( $wms_source ) );
		}
		if ( '' !== $wms_layer ) {
			$wms_shortcode .= sprintf( ' layer="%s"', esc_attr( $wms_layer ) );
		}
		if ( '' !== $wms_crs ) {
			$wms_shortcode .= sprintf( ' crs="%s"', esc_attr( $wms_crs ) );
		}
		$wms_shortcode .= ']';
	}

	$real_marker_count = 0;
	$marker_shortcodes = '';
	foreach ( $markers as $marker ) {
		if ( ! isset( $marker['lat'], $marker['lng'] ) ) {
			continue;
		}
		++$real_marker_count;
		$m_lat     = (float) $marker['lat'];
		$m_lng     = (float) $marker['lng'];
		$m_title   = isset( $marker['title'] ) ? sanitize_text_field( $marker['title'] ) : '';
		$m_content = isset( $marker['content'] ) ? wp_kses_post( $marker['content'] ) : '';
		$m_alt     = isset( $marker['alt'] ) ? sanitize_text_field( $marker['alt'] ) : '';

		// Build open tag incrementally; include optional attrs only when set.
		$m_open_tag = sprintf(
			'[leaflet-marker lat="%1$s" lng="%2$s"',
			esc_attr( (string) $m_lat ),
			esc_attr( (string) $m_lng )
		);

		if ( '' !== $m_title ) {
			$m_open_tag .= sprintf( ' title="%s"', esc_attr( $m_title ) );
		}
		if ( '' !== $m_alt ) {
			$m_open_tag .= sprintf( ' alt="%s"', esc_attr( $m_alt ) );
		}
		if ( ! empty( $marker['visible'] ) ) {
			$m_open_tag .= ' visible="1"';
		}
		if ( ! empty( $marker['draggable'] ) ) {
			$m_open_tag .= ' draggable="1"';
		}
		if ( isset( $marker['opacity'] ) ) {
			$m_opacity = (float) $marker['opacity'];
			if ( abs( $m_opacity - 1.0 ) > 0.001 ) {
				$m_open_tag .= sprintf( ' opacity="%s"', esc_attr( (string) $m_opacity ) );
			}
		}
		if ( isset( $marker['zIndexOffset'] ) ) {
			$m_zindex = (int) $marker['zIndexOffset'];
			if ( 0 !== $m_zindex ) {
				$m_open_tag .= sprintf( ' zindexoffset="%d"', $m_zindex );
			}
		}

		// SVG marker and custom image icon are mutually exclusive: SVG wins when both flags are set.
		// Mirror buildShortcode() logic in edit.js and render.php.
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
			// Custom icon: mirror buildShortcode() logic in edit.js.
			$m_icon_url = isset( $marker['iconUrl'] ) ? sanitize_text_field( $marker['iconUrl'] ) : '';
			if ( '' !== $m_icon_url ) {
				$m_open_tag .= sprintf( ' iconurl="%s"', esc_attr( $m_icon_url ) );
			}
			$m_icon_w = isset( $marker['iconWidth'] ) ? (int) $marker['iconWidth'] : 0;
			$m_icon_h = isset( $marker['iconHeight'] ) ? (int) $marker['iconHeight'] : 0;
			if ( $m_icon_w >= 1 && $m_icon_h >= 1 ) {
				$m_open_tag .= sprintf( ' iconsize="%d,%d"', $m_icon_w, $m_icon_h );
			}
			$m_anchor_x = isset( $marker['iconAnchorX'] ) ? $marker['iconAnchorX'] : null;
			$m_anchor_y = isset( $marker['iconAnchorY'] ) ? $marker['iconAnchorY'] : null;
			if ( null !== $m_anchor_x && null !== $m_anchor_y ) {
				$m_open_tag .= sprintf( ' iconanchor="%d,%d"', (int) $m_anchor_x, (int) $m_anchor_y );
			}
			$m_popup_x = isset( $marker['popupAnchorX'] ) ? $marker['popupAnchorX'] : null;
			$m_popup_y = isset( $marker['popupAnchorY'] ) ? $marker['popupAnchorY'] : null;
			if ( null !== $m_popup_x && null !== $m_popup_y ) {
				$m_open_tag .= sprintf( ' popupanchor="%d,%d"', (int) $m_popup_x, (int) $m_popup_y );
			}
			// Shadow: only when useShadow is also true.
			if ( ! empty( $marker['useShadow'] ) ) {
				$m_shadow_url = isset( $marker['shadowUrl'] ) ? sanitize_text_field( $marker['shadowUrl'] ) : '';
				if ( '' !== $m_shadow_url ) {
					$m_open_tag .= sprintf( ' shadowurl="%s"', esc_attr( $m_shadow_url ) );
				}
				$m_shadow_w = isset( $marker['shadowWidth'] ) ? (int) $marker['shadowWidth'] : 0;
				$m_shadow_h = isset( $marker['shadowHeight'] ) ? (int) $marker['shadowHeight'] : 0;
				if ( $m_shadow_w >= 1 && $m_shadow_h >= 1 ) {
					$m_open_tag .= sprintf( ' shadowsize="%d,%d"', $m_shadow_w, $m_shadow_h );
				}
				$m_shadow_ax = isset( $marker['shadowAnchorX'] ) ? $marker['shadowAnchorX'] : null;
				$m_shadow_ay = isset( $marker['shadowAnchorY'] ) ? $marker['shadowAnchorY'] : null;
				if ( null !== $m_shadow_ax && null !== $m_shadow_ay ) {
					$m_open_tag .= sprintf( ' shadowanchor="%d,%d"', (int) $m_shadow_ax, (int) $m_shadow_ay );
				}
			}
		}

		if ( '' !== $m_content ) {
			$marker_shortcodes .= $m_open_tag . ']' . $m_content . '[/leaflet-marker]';
		} else {
			$marker_shortcodes .= $m_open_tag . ' /]';
		}
	}

	// Editor-only: show a draggable pin for each point only when the line is not yet
	// drawn (< 2 points). Once the line is rendered the pins are visual noise.
	// These are NOT added by render.php.
	$line_point_meta       = array();
	$line_point_shortcodes = '';
	foreach ( $lines as $l_idx => $line ) {
		$l_points = isset( $line['points'] ) && is_array( $line['points'] ) ? $line['points'] : array();
		if ( count( $l_points ) >= 2 ) {
			continue; // line is drawn; skip helper markers.
		}
		foreach ( $l_points as $p_idx => $pt ) {
			$pt_lat                 = (float) ( isset( $pt['lat'] ) ? $pt['lat'] : 0 );
			$pt_lng                 = (float) ( isset( $pt['lng'] ) ? $pt['lng'] : 0 );
			$label                  = sprintf( 'L%d·P%d', $l_idx + 1, $p_idx + 1 );
			$line_point_shortcodes .= sprintf(
				'[leaflet-marker lat="%s" lng="%s" title="%s" draggable="1" /]',
				esc_attr( (string) $pt_lat ),
				esc_attr( (string) $pt_lng ),
				esc_attr( $label )
			);
			$line_point_meta[]      = array(
				'lineIndex'  => $l_idx,
				'pointIndex' => $p_idx,
			);
		}
	}

	// Build [leaflet-line] / [leaflet-polygon] shortcodes. Keep in sync with
	// buildLineShortcodes() in edit.js and the lines section in render.php.
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
			$l_open .= sprintf( ' weight="%s"', esc_attr( (string) (float) $line['weight'] ) );
		}
		if ( isset( $line['opacity'] ) && is_numeric( $line['opacity'] ) ) {
			$l_open .= sprintf( ' opacity="%s"', esc_attr( (string) (float) $line['opacity'] ) );
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
			$l_open .= sprintf( ' fillopacity="%s"', esc_attr( (string) (float) $line['fillOpacity'] ) );
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

	// Build [leaflet-circle] shortcodes. Keep in sync with buildCircleShortcodes() in edit.js and render.php.
	$circle_shortcodes = '';
	foreach ( $circles as $circle ) {
		$c_lat = isset( $circle['lat'] ) ? (float) $circle['lat'] : null;
		$c_lng = isset( $circle['lng'] ) ? (float) $circle['lng'] : null;
		if ( null === $c_lat || null === $c_lng ) {
			continue;
		}
		$c_radius = isset( $circle['radius'] ) && is_numeric( $circle['radius'] ) ? (float) $circle['radius'] : 1000.0;
		if ( $c_radius <= 0 ) {
			continue;
		}
		$c_open = sprintf( '[leaflet-circle lat="%s" lng="%s" radius="%s"', esc_attr( (string) $c_lat ), esc_attr( (string) $c_lng ), esc_attr( (string) $c_radius ) );
		if ( ! empty( $circle['fitbounds'] ) ) {
			$c_open .= ' fitbounds="true"';
		}
		if ( isset( $circle['color'] ) && '' !== trim( $circle['color'] ) ) {
			$c_open .= sprintf( ' color="%s"', esc_attr( trim( $circle['color'] ) ) );
		}
		if ( isset( $circle['weight'] ) && is_numeric( $circle['weight'] ) ) {
			$c_open .= sprintf( ' weight="%s"', esc_attr( (string) (float) $circle['weight'] ) );
		}
		if ( isset( $circle['opacity'] ) && is_numeric( $circle['opacity'] ) ) {
			$c_open .= sprintf( ' opacity="%s"', esc_attr( (string) (float) $circle['opacity'] ) );
		}
		if ( isset( $circle['dashArray'] ) && '' !== trim( $circle['dashArray'] ) ) {
			$c_open .= sprintf( ' dasharray="%s"', esc_attr( trim( $circle['dashArray'] ) ) );
		}
		if ( isset( $circle['classname'] ) && '' !== trim( $circle['classname'] ) ) {
			$c_open .= sprintf( ' classname="%s"', esc_attr( trim( $circle['classname'] ) ) );
		}
		if ( ! empty( $circle['fill'] ) ) {
			$c_open .= ' fill="true"';
		}
		if ( isset( $circle['fillColor'] ) && '' !== trim( $circle['fillColor'] ) ) {
			$c_open .= sprintf( ' fillcolor="%s"', esc_attr( trim( $circle['fillColor'] ) ) );
		}
		if ( isset( $circle['fillOpacity'] ) && is_numeric( $circle['fillOpacity'] ) ) {
			$c_open .= sprintf( ' fillopacity="%s"', esc_attr( (string) (float) $circle['fillOpacity'] ) );
		}
		$c_popup = isset( $circle['popup'] ) ? wp_kses_post( $circle['popup'] ) : '';
		if ( ! empty( $circle['visible'] ) && '' !== $c_popup ) {
			$c_open .= ' visible="1"';
		}
		if ( '' !== $c_popup ) {
			$circle_shortcodes .= $c_open . ']' . $c_popup . '[/leaflet-circle]';
		} else {
			$circle_shortcodes .= $c_open . ' /]';
		}
	}

	// Build [leaflet-geojson] / [leaflet-gpx] / [leaflet-kml] shortcodes.
	// Keep in sync with buildLayerShortcodes() in edit.js and the matching loop in render.php.
	$layer_tag_map = array(
		'geojson' => 'leaflet-geojson',
		'gpx'     => 'leaflet-gpx',
		'kml'     => 'leaflet-kml',
	);

	$layer_shortcodes = '';
	foreach ( $layers as $layer ) {
		$l_src = isset( $layer['src'] ) ? trim( (string) $layer['src'] ) : '';
		if ( '' === $l_src ) {
			continue;
		}
		$l_type = isset( $layer['type'] ) && isset( $layer_tag_map[ $layer['type'] ] )
			? $layer['type']
			: 'geojson';
		$l_tag  = $layer_tag_map[ $l_type ];

		$l_open = sprintf( '[%s src="%s"', $l_tag, esc_attr( $l_src ) );
		if ( ! empty( $layer['fitbounds'] ) ) {
			$l_open .= ' fitbounds="true"';
		}
		if ( isset( $layer['popupText'] ) && '' !== trim( $layer['popupText'] ) ) {
			$l_open .= sprintf( ' popup_text="%s"', esc_attr( trim( $layer['popupText'] ) ) );
		}
		if ( isset( $layer['popupProperty'] ) && '' !== trim( $layer['popupProperty'] ) ) {
			$l_open .= sprintf( ' popup_property="%s"', esc_attr( trim( $layer['popupProperty'] ) ) );
		}
		if ( ! empty( $layer['tableView'] ) ) {
			$l_open .= ' table_view="1"';
		}
		if ( isset( $layer['color'] ) && '' !== trim( $layer['color'] ) ) {
			$l_open .= sprintf( ' color="%s"', esc_attr( trim( $layer['color'] ) ) );
		}
		if ( isset( $layer['weight'] ) && is_numeric( $layer['weight'] ) ) {
			$l_open .= sprintf( ' weight="%s"', esc_attr( (string) (float) $layer['weight'] ) );
		}
		if ( isset( $layer['opacity'] ) && is_numeric( $layer['opacity'] ) ) {
			$l_open .= sprintf( ' opacity="%s"', esc_attr( (string) (float) $layer['opacity'] ) );
		}
		if ( isset( $layer['dashArray'] ) && '' !== trim( $layer['dashArray'] ) ) {
			$l_open .= sprintf( ' dasharray="%s"', esc_attr( trim( $layer['dashArray'] ) ) );
		}
		if ( isset( $layer['classname'] ) && '' !== trim( $layer['classname'] ) ) {
			$l_open .= sprintf( ' classname="%s"', esc_attr( trim( $layer['classname'] ) ) );
		}
		if ( ! empty( $layer['fill'] ) ) {
			$l_open .= ' fill="true"';
		}
		if ( isset( $layer['fillColor'] ) && '' !== trim( $layer['fillColor'] ) ) {
			$l_open .= sprintf( ' fillcolor="%s"', esc_attr( trim( $layer['fillColor'] ) ) );
		}
		if ( isset( $layer['fillOpacity'] ) && is_numeric( $layer['fillOpacity'] ) ) {
			$l_open .= sprintf( ' fillopacity="%s"', esc_attr( (string) (float) $layer['fillOpacity'] ) );
		}
		if ( ! empty( $layer['useCustomIcon'] ) ) {
			if ( ! empty( $layer['iconUrl'] ) ) {
				$l_open .= sprintf( ' iconurl="%s"', esc_attr( $layer['iconUrl'] ) );
			}
			$l_iw = isset( $layer['iconWidth'] ) && is_numeric( $layer['iconWidth'] ) ? (int) $layer['iconWidth'] : null;
			$l_ih = isset( $layer['iconHeight'] ) && is_numeric( $layer['iconHeight'] ) ? (int) $layer['iconHeight'] : null;
			if ( null !== $l_iw && null !== $l_ih && $l_iw >= 1 && $l_ih >= 1 ) {
				$l_open .= sprintf( ' iconsize="%d,%d"', $l_iw, $l_ih );
			}
			$l_iax = isset( $layer['iconAnchorX'] ) && is_numeric( $layer['iconAnchorX'] ) ? (int) $layer['iconAnchorX'] : null;
			$l_iay = isset( $layer['iconAnchorY'] ) && is_numeric( $layer['iconAnchorY'] ) ? (int) $layer['iconAnchorY'] : null;
			if ( null !== $l_iax && null !== $l_iay ) {
				$l_open .= sprintf( ' iconanchor="%d,%d"', $l_iax, $l_iay );
			}
			$l_pax = isset( $layer['popupAnchorX'] ) && is_numeric( $layer['popupAnchorX'] ) ? (int) $layer['popupAnchorX'] : null;
			$l_pay = isset( $layer['popupAnchorY'] ) && is_numeric( $layer['popupAnchorY'] ) ? (int) $layer['popupAnchorY'] : null;
			if ( null !== $l_pax && null !== $l_pay ) {
				$l_open .= sprintf( ' popupanchor="%d,%d"', $l_pax, $l_pay );
			}
		}
		$layer_shortcodes .= $l_open . ' /]';
	}

	// Build [leaflet-image-overlay] / [leaflet-video-overlay] shortcodes.
	// Keep in sync with buildOverlayShortcodes() in edit.js and the matching loop in render.php.
	$overlay_shortcodes = '';
	foreach ( $overlays as $overlay ) {
		$o_src    = isset( $overlay['src'] ) ? trim( (string) $overlay['src'] ) : '';
		$o_bounds = isset( $overlay['bounds'] ) ? trim( (string) $overlay['bounds'] ) : '';
		if ( '' === $o_src || '' === $o_bounds ) {
			continue;
		}
		$o_tag  = ( isset( $overlay['type'] ) && 'video' === $overlay['type'] )
			? 'leaflet-video-overlay'
			: 'leaflet-image-overlay';
		$o_open = sprintf( '[%s src="%s" bounds="%s"', $o_tag, esc_attr( $o_src ), esc_attr( $o_bounds ) );
		if ( isset( $overlay['opacity'] ) && is_numeric( $overlay['opacity'] ) ) {
			$o_open .= sprintf( ' opacity="%s"', esc_attr( (string) (float) $overlay['opacity'] ) );
		}
		if ( ! empty( $overlay['interactive'] ) ) {
			$o_open .= ' interactive="true"';
		}
		if ( isset( $overlay['alt'] ) && '' !== trim( $overlay['alt'] ) ) {
			$o_open .= sprintf( ' alt="%s"', esc_attr( trim( $overlay['alt'] ) ) );
		}
		if ( isset( $overlay['zIndex'] ) && is_numeric( $overlay['zIndex'] ) ) {
			$o_open .= sprintf( ' zindex="%d"', (int) $overlay['zIndex'] );
		}
		if ( isset( $overlay['classname'] ) && '' !== trim( $overlay['classname'] ) ) {
			$o_open .= sprintf( ' classname="%s"', esc_attr( trim( $overlay['classname'] ) ) );
		}
		if ( 'leaflet-image-overlay' === $o_tag && isset( $overlay['keepAspectRatio'] ) && false === $overlay['keepAspectRatio'] ) {
			$o_open .= ' keepaspectratio="false"';
		}
		$overlay_shortcodes .= $o_open . ' /]';
	}

	// Render a complete, self-contained HTML page.
	// wp_head() / wp_footer() let the Leaflet Map plugin load its own assets.
	?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>">
<meta name="referrer" content="origin">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
	* { box-sizing: border-box; }
	html, body { margin: 0; padding: 0; background: #fff; overflow: hidden; }
	#map-wrap { width: 100%; }
	/* Draw-mode pin — reset Leaflet's default marker background/shadow */
	.bflm-draw-pin { background: none; border: none; }
</style>
	<?php wp_head(); ?>
</head>
<body>
<div id="map-wrap">
	<?php
	// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- trusted shortcode output, same rationale as render.php.
	if ( $is_image_map && '' !== $image_src ) {
		$image_shortcode = sprintf(
			'[leaflet-image src="%1$s" x="%2$s" y="%3$s" zoom="0" height="%4$s"]',
			esc_attr( $image_src ),
			esc_attr( (string) $image_x ),
			esc_attr( (string) $image_y ),
			esc_attr( $height )
		);
		echo do_shortcode( $image_shortcode . $marker_shortcodes . $line_shortcodes . $line_point_shortcodes . $circle_shortcodes ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		?>
		<script>
		( function () {
			var zoomOffset = <?php echo (float) $image_zoom; ?>;
			var attempts   = 0;
			function fitImage() {
				var plugin = window.WPLeafletMapPlugin;
				if ( ! plugin || ! plugin.maps || ! plugin.maps[ 0 ] ) {
					if ( ++attempts < 50 ) { setTimeout( fitImage, 100 ); }
					return;
				}
				var map = plugin.maps[ 0 ];
				if ( ! map.is_image_map ) { return; }

				// Find the ImageOverlay layer (has getBounds + getElement).
				var overlay = null;
				map.eachLayer( function ( l ) { if ( ! overlay && l.getBounds && l.getElement ) { overlay = l; } } );
				if ( ! overlay ) {
					if ( ++attempts < 50 ) { setTimeout( fitImage, 100 ); }
					return;
				}

				// Need image natural dimensions — wait until loaded.
				var img = overlay.getElement();
				if ( ! img || ! img.naturalWidth ) {
					if ( ++attempts < 50 ) { setTimeout( fitImage, 100 ); }
					return;
				}

				var iw = img.naturalWidth;
				var ih = img.naturalHeight;
				var mw = map.getContainer().offsetWidth;
				var mh = map.getContainer().offsetHeight;

				// In L.CRS.Simple, bozdoz projects the image at projected_zoom = bozdozZoom+1 = 1.
				// unproject([px,py], 1) = [px/2, py/2] world units.
				// So image world size = iw/2 × ih/2. At map zoom Z, viewport = mw/2^Z world units.
				// Fit: 2^Z = mw / (iw/2) = 2*mw/iw  →  Z = log2(2*mw/iw) = 1 + log2(mw/iw).
				var fitZoomX = Math.log( 2 * mw / iw ) / Math.LN2;
				var fitZoomY = Math.log( 2 * mh / ih ) / Math.LN2;
				var fitZoom  = Math.min( fitZoomX, fitZoomY );

				map.options.zoomSnap = 0;
				map.setMinZoom( fitZoom + zoomOffset );
				map.setMaxBounds( null );
				map.setView( [ 0, 0 ], fitZoom + zoomOffset, { animate: false } );
			}
			fitImage();
		} )();
		</script>
		<?php
	} elseif ( $wms_enabled ) {
		echo do_shortcode( $wms_shortcode . $marker_shortcodes . $line_shortcodes . $line_point_shortcodes . $circle_shortcodes ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	} else {
		echo do_shortcode( $map_shortcode . $marker_shortcodes . $line_shortcodes . $line_point_shortcodes . $circle_shortcodes . $layer_shortcodes . $overlay_shortcodes ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	}
	?>
</div>
<script>
( function () {
	var blockId            = <?php echo wp_json_encode( $block_id ); ?>;
	var minZoom            = <?php echo wp_json_encode( '' !== $min_zoom && is_numeric( $min_zoom ) ? (float) $min_zoom : null ); ?>;
	var maxZoom            = <?php echo wp_json_encode( '' !== $max_zoom && is_numeric( $max_zoom ) ? (float) $max_zoom : null ); ?>;
	var maxBoundsRaw       = <?php echo wp_json_encode( $max_bounds ); ?>;
	var realMarkerCount    = <?php echo wp_json_encode( $real_marker_count ); ?>;
	var linePointMeta      = <?php echo wp_json_encode( $line_point_meta ); ?>;
	var attempts           = 0;
	var MAX_ATTEMPTS       = 50;
	var isProgrammaticMove = false;

	// ── Draw mode state ───────────────────────────────────────────────────────
	// Holds the in-progress drawing overlays for click-to-draw mode.
	// All drawing happens client-side; each click also posts bflm_draw_point
	// to the editor so it can update block attributes (and thus undo history).
	var drawState = {
		active:    false,
		lineIndex: null,
		lineType:  'line',
		points:    [],
		pins:      [],
		shape:     null,
	};

	// Inline red pin icon used for draw-mode points (L.divIcon, no asset file).
	var DRAW_PIN_ICON = null;
	function getDrawPinIcon() {
		if ( DRAW_PIN_ICON ) return DRAW_PIN_ICON;
		var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 36" width="28" height="36">' +
			'<circle cx="14" cy="12" r="11" fill="#e53e3e" stroke="#fff" stroke-width="2"/>' +
			'<circle cx="10" cy="9" r="3" fill="rgba(255,255,255,0.35)"/>' +
			'<path d="M14 22 L9 36 L14 30 L19 36 Z" fill="#4a4a4a"/>' +
			'</svg>';
		DRAW_PIN_ICON = L.divIcon( {
			html:      svg,
			className: 'bflm-draw-pin',
			iconSize:    [ 28, 36 ],
			iconAnchor:  [ 14, 34 ],
		} );
		return DRAW_PIN_ICON;
	}

	function clearDrawPins() {
		drawState.pins.forEach( function ( pin ) { pin.remove(); } );
		drawState.pins = [];
	}

	function clearDrawOverlays( map ) {
		clearDrawPins();
		if ( drawState.shape ) {
			drawState.shape.remove();
			drawState.shape = null;
		}
		map.getContainer().style.cursor = '';
	}

	function startDraw( map, msg ) {
		clearDrawOverlays( map );
		drawState.active    = true;
		drawState.lineIndex = msg.lineIndex;
		drawState.lineType  = msg.lineType || 'line';
		drawState.points    = ( msg.existingPoints || [] ).map( function ( p ) {
			return [ p.lat, p.lng ];
		} );

		var strokeColor  = msg.color       || '#3388ff';
		var fillColor    = msg.fillColor   || '#3388ff';
		var fillOpacity  = msg.fillOpacity != null ? msg.fillOpacity : 0.2;

		// Render existing points as pins.
		drawState.points.forEach( function ( ll ) {
			var pin = L.marker( ll, { icon: getDrawPinIcon(), zIndexOffset: 1000 } ).addTo( map );
			drawState.pins.push( pin );
		} );

		// Create the live shape overlay.
		if ( drawState.lineType === 'polygon' ) {
			drawState.shape = L.polygon( drawState.points.length ? drawState.points : [ [ 0, 0 ] ], {
				color:       strokeColor,
				fillColor:   fillColor,
				fillOpacity: fillOpacity,
				weight:      2,
				interactive: false,
			} ).addTo( map );
		} else {
			drawState.shape = L.polyline( drawState.points.length ? drawState.points : [ [ 0, 0 ] ], {
				color:       strokeColor,
				weight:      2,
				interactive: false,
			} ).addTo( map );
		}
		if ( drawState.points.length < 1 ) {
			drawState.shape.setLatLngs( [] );
		}

		map.doubleClickZoom.disable();
		map.getContainer().style.cursor = 'crosshair';
	}

	function stopDraw( map ) {
		// Keep drawState.shape on the map so the line/polygon remains visible
		// without an iframe reload. Only remove the temporary draw pins.
		clearDrawPins();
		map.getContainer().style.cursor = '';
		drawState.active    = false;
		drawState.lineIndex = null;
		drawState.points    = [];
		drawState.shape     = null; // shape stays on map; we just drop the ref
		map.doubleClickZoom.enable();
	}

	// ── Circle draw mode state ────────────────────────────────────────────────
	// Two-click flow: phase 'center' (1st click) then phase 'edge' (2nd click).
	// After the 2nd click the center pin becomes draggable to reposition the circle.
	var circleDrawState = {
		active:      false,
		circleIndex: null,
		phase:       'center', // 'center' | 'edge'
		center:      null,     // [lat, lng]
		color:       '#3388ff',
		fillColor:   '#3388ff',
		fillOpacity: 0.2,
		shape:       null,     // L.circle — kept on map after draw ends
		preview:     null,     // L.marker (center pin) — stays as draggable handle
		guideLine:   null,     // L.polyline radius guide — removed after 2nd click
	};

	function clearCircleGuideLine() {
		if ( circleDrawState.guideLine ) {
			circleDrawState.guideLine.remove();
			circleDrawState.guideLine = null;
		}
	}

	function clearCirclePreview() {
		clearCircleGuideLine();
		if ( circleDrawState.preview ) {
			circleDrawState.preview.remove();
			circleDrawState.preview = null;
		}
	}

	function makeCenterDraggable( map ) {
		var pin = circleDrawState.preview;
		if ( ! pin ) return;
		pin.options.draggable = true;
		pin.dragging.enable();
		pin.on( 'dragstart', function () {
			// Prevent map drag from interfering.
			map.dragging.disable();
		} );
		pin.on( 'drag', function () {
			var ll = pin.getLatLng();
			if ( circleDrawState.shape ) {
				circleDrawState.shape.setLatLng( ll );
			}
		} );
		pin.on( 'dragend', function () {
			map.dragging.enable();
			var ll = pin.getLatLng();
			circleDrawState.center = [ ll.lat, ll.lng ];
			if ( circleDrawState.shape ) {
				circleDrawState.shape.setLatLng( ll );
			}
			window.top.postMessage(
				{
					type:        'bflm_draw_circle_center',
					blockId:     blockId,
					circleIndex: circleDrawState.circleIndex,
					lat:         parseFloat( ll.lat.toFixed( 6 ) ),
					lng:         parseFloat( ll.lng.toFixed( 6 ) ),
				},
				'*'
			);
		} );
	}

	function startCircleDraw( map, msg ) {
		// Always start fresh at phase='center' — user must click to place the
		// center. Any previous draw overlays (pin, shape, guide) are cleared.
		clearCirclePreview();
		if ( circleDrawState.shape ) {
			circleDrawState.shape.remove();
			circleDrawState.shape = null;
		}

		circleDrawState.active      = true;
		circleDrawState.circleIndex = msg.circleIndex;
		circleDrawState.phase       = 'center';
		circleDrawState.center      = null;
		circleDrawState.color       = msg.color       || '#3388ff';
		circleDrawState.fillColor   = msg.fillColor   || '#3388ff';
		circleDrawState.fillOpacity = msg.fillOpacity != null ? msg.fillOpacity : 0.2;

		map.doubleClickZoom.disable();
		map.getContainer().style.cursor = 'crosshair';
	}

	function stopCircleDraw( map ) {
		// Keep shape and center pin on the map — no reload needed.
		// Remove only the radius guide line.
		clearCircleGuideLine();
		map.getContainer().style.cursor = '';
		circleDrawState.active = false;
		circleDrawState.phase  = 'center';
		// Drop refs but leave shape + preview (center pin) in Leaflet's layer tree.
		circleDrawState.shape  = null;
		circleDrawState.center = null;
		// circleIndex kept briefly so the dragend handler can still post the right index.
		// Reset fully after a tick so the last dragend (if any) fires first.
		setTimeout( function () { circleDrawState.circleIndex = null; }, 0 );
		map.doubleClickZoom.enable();
	}

	/**
	 * Poll for the Leaflet Map plugin's map instance, then wire up
	 * bidirectional postMessage communication with the editor frame.
	 *
	 * window.top is used (not window.parent) because this iframe is nested
	 * two levels deep: outer admin frame → WP canvas iframe → this iframe.
	 * window.top reaches the outer admin frame where edit.js listens.
	 *
	 * '*' is used as the target origin for postMessage. Both this iframe and
	 * the editor run on the same WordPress origin (admin-ajax.php / wp-admin),
	 * so this is safe. Restrict to a specific origin for stricter isolation.
	 *
	 * blockId scopes every message to this specific block instance so that
	 * multiple map blocks on the same page do not interfere with each other.
	 */
	function init() {
		var plugin = window.WPLeafletMapPlugin;
		if ( ! plugin || ! plugin.maps || ! plugin.maps[ 0 ] ) {
			if ( ++attempts < MAX_ATTEMPTS ) {
				setTimeout( init, 200 );
			}
			return;
		}

		var map     = plugin.maps[ 0 ];
		var markers = plugin.markers || [];

		// Apply zoom & bounds constraints if set.
		if ( minZoom !== null ) {
			map.setMinZoom( minZoom );
		}
		if ( maxZoom !== null ) {
			map.setMaxZoom( maxZoom );
		}
		if ( maxBoundsRaw ) {
			try {
				var parts  = maxBoundsRaw.split( ';' );
				var sw     = parts[ 0 ].split( ',' );
				var ne     = parts[ 1 ].split( ',' );
				var bounds = [ [ parseFloat( sw[ 0 ] ), parseFloat( sw[ 1 ] ) ], [ parseFloat( ne[ 0 ] ), parseFloat( ne[ 1 ] ) ] ];
				if ( bounds.every( function ( p ) { return ! isNaN( p[ 0 ] ) && ! isNaN( p[ 1 ] ); } ) ) {
					map.setMaxBounds( bounds );
				}
			} catch ( e ) { /* ignore malformed input */ }
		} else {
			map.setMaxBounds( null );
		}

		// User pans / zooms → notify the editor.
		map.on( 'moveend zoomend', function () {
			if ( isProgrammaticMove ) {
				return;
			}
			var center = map.getCenter();
			window.top.postMessage(
				{ type: 'bflm_map_update', blockId: blockId, lat: center.lat, lng: center.lng, zoom: map.getZoom() },
				'*'
			);
		} );

		// Make each real marker draggable and relay dragend to the editor.
		markers.slice( 0, realMarkerCount ).forEach( function ( marker, i ) {
			if ( marker.dragging && ! marker.dragging.enabled() ) {
				marker.dragging.enable();
			}
			marker.on( 'dragend', function ( e ) {
				var pos = e.target.getLatLng();
				window.top.postMessage(
					{ type: 'bflm_marker_update', blockId: blockId, index: i, lat: pos.lat, lng: pos.lng },
					'*'
				);
			} );
		} );

		// Make each line-point helper marker draggable and relay dragend.
		markers.slice( realMarkerCount ).forEach( function ( marker, i ) {
			var meta = linePointMeta[ i ];
			if ( ! meta ) return;
			if ( marker.dragging && ! marker.dragging.enabled() ) {
				marker.dragging.enable();
			}
			marker.on( 'dragend', function ( e ) {
				var pos = e.target.getLatLng();
				window.top.postMessage(
					{ type: 'bflm_linepoint_update', blockId: blockId, lineIndex: meta.lineIndex, pointIndex: meta.pointIndex, lat: pos.lat, lng: pos.lng },
					'*'
				);
			} );
		} );

		// fitBounds: when enabled, adjust the map to contain all markers.
		// Intentionally not guarded by isProgrammaticMove — the resulting moveend
		// fires bflm_map_update so the editor lat/lng/zoom attributes reflect the
		// computed view (the user delegated view control to the map contents).
		var fitMarkersEnabled = <?php echo wp_json_encode( 'true' === $fit_markers ); ?>;
		if ( fitMarkersEnabled && markers.length > 0 ) {
			var bounds = [];
			markers.forEach( function ( marker ) {
				var ll = marker.getLatLng();
				bounds.push( [ ll.lat, ll.lng ] );
			} );
			if ( bounds.length > 0 ) {
				map.fitBounds( bounds, { padding: [ 30, 30 ] } );
			}
		}

		// ── Click-to-draw handlers ────────────────────────────────────────────
		// map.on('click') fires for single clicks; map.on('dblclick') for double.
		// Leaflet fires 'click' twice before 'dblclick' — use a small timeout to
		// suppress the spurious single-click that precedes a double-click.
		// ── Mousemove: live radius guide during circle edge phase ────────────
		map.on( 'mousemove', function ( e ) {
			if ( ! circleDrawState.active || circleDrawState.phase !== 'edge' ) return;
			var mlat = e.latlng.lat;
			var mlng = e.latlng.lng;
			var r = map.distance( circleDrawState.center, [ mlat, mlng ] );
			// Update live circle radius.
			if ( circleDrawState.shape ) {
				circleDrawState.shape.setRadius( r < 1 ? 1 : r );
			}
			// Update guide line from center to cursor.
			if ( circleDrawState.guideLine ) {
				circleDrawState.guideLine.setLatLngs( [ circleDrawState.center, [ mlat, mlng ] ] );
			}
		} );

		var clickTimer = null;
		map.on( 'click', function ( e ) {
			// ── Circle draw (2-click: center then edge) ───────────────────────
			if ( circleDrawState.active ) {
				var clat = e.latlng.lat;
				var clng = e.latlng.lng;
				if ( circleDrawState.phase === 'center' ) {
					// First click: place center pin, start L.circle (r=1) + guide line.
					circleDrawState.center  = [ clat, clng ];
					circleDrawState.phase   = 'edge';
					circleDrawState.preview = L.marker(
						[ clat, clng ],
						{ icon: getDrawPinIcon(), draggable: false, zIndexOffset: 1000 }
					).addTo( map );
					circleDrawState.shape = L.circle( [ clat, clng ], {
						radius:      1,
						color:       circleDrawState.color,
						fillColor:   circleDrawState.fillColor,
						fillOpacity: circleDrawState.fillOpacity,
						weight:      2,
						interactive: false,
					} ).addTo( map );
					circleDrawState.guideLine = L.polyline(
						[ [ clat, clng ], [ clat, clng ] ],
						{ color: '#888', weight: 1, dashArray: '4,6', interactive: false }
					).addTo( map );
					window.top.postMessage(
						{ type: 'bflm_draw_circle_center', blockId: blockId, circleIndex: circleDrawState.circleIndex, lat: clat, lng: clng },
						'*'
					);
				} else {
					// Second click: fix radius, remove guide, make center draggable.
					var radius = map.distance( circleDrawState.center, [ clat, clng ] );
					if ( radius < 1 ) radius = 1;
					if ( circleDrawState.shape ) {
						circleDrawState.shape.setRadius( radius );
					}
					clearCircleGuideLine();
					// Convert center pin to draggable handle for repositioning.
					makeCenterDraggable( map );
					window.top.postMessage(
						{ type: 'bflm_draw_circle_radius', blockId: blockId, circleIndex: circleDrawState.circleIndex, radius: radius },
						'*'
					);
					var ci = circleDrawState.circleIndex;
					stopCircleDraw( map );
					window.top.postMessage(
						{ type: 'bflm_draw_circle_end_request', blockId: blockId, circleIndex: ci },
						'*'
					);
				}
				return;
			}

			// ── Line/polygon draw ─────────────────────────────────────────────
			if ( ! drawState.active ) return;
			// Defer by 250ms; dblclick will clear this timer so only one point
			// is added per double-click (the dblclick ends drawing instead).
			clearTimeout( clickTimer );
			clickTimer = setTimeout( function () {
				var lat = e.latlng.lat;
				var lng = e.latlng.lng;
				drawState.points.push( [ lat, lng ] );

				// Add a red pin at this point.
				var pin = L.marker( [ lat, lng ], { icon: getDrawPinIcon(), zIndexOffset: 1000 } ).addTo( map );
				drawState.pins.push( pin );

				// Update live shape preview.
				if ( drawState.shape ) {
					drawState.shape.setLatLngs( drawState.points );
				}

				// Notify the editor so it can update block attributes + undo history.
				window.top.postMessage(
					{ type: 'bflm_draw_point', blockId: blockId, lineIndex: drawState.lineIndex, lat: lat, lng: lng },
					'*'
				);
			}, 250 );
		} );

		map.on( 'dblclick', function ( e ) {
			if ( ! drawState.active ) return;
			// Cancel the pending single-click so no extra point is added.
			clearTimeout( clickTimer );
			// Leaflet's default dblclick zoom is already disabled in draw mode.
			L.DomEvent.stopPropagation( e );
			var li = drawState.lineIndex;
			stopDraw( map );
			window.top.postMessage(
				{ type: 'bflm_draw_end_request', blockId: blockId, lineIndex: li },
				'*'
			);
		} );

		// ── Inbound messages from the editor ─────────────────────────────────
		window.addEventListener( 'message', function ( e ) {
			if ( ! e.data || typeof e.data.type !== 'string' || e.data.blockId !== blockId ) {
				return;
			}
			var msg = e.data;

			if ( msg.type === 'bflm_set_view' ) {
				isProgrammaticMove = true;
				map.once( 'moveend', function () {
					isProgrammaticMove = false;
				} );
				map.setView( [ msg.lat, msg.lng ], msg.zoom, { animate: true } );
				return;
			}

			if ( msg.type === 'bflm_draw_start' ) {
				startDraw( map, msg );
				return;
			}

			if ( msg.type === 'bflm_draw_end' ) {
				stopDraw( map );
				return;
			}

			if ( msg.type === 'bflm_draw_circle_start' ) {
				startCircleDraw( map, msg );
				return;
			}

			if ( msg.type === 'bflm_draw_circle_end' ) {
				stopCircleDraw( map );
				return;
			}
		} );

		// Signal the editor that this iframe is ready (or has rebuilt).
		// The editor uses this to re-send bflm_draw_start if a line was in draw
		// mode when an attribute change triggered a full iframe reload.
		window.top.postMessage(
			{ type: 'bflm_iframe_ready', blockId: blockId },
			'*'
		);
	}

	init();
}() );
</script>
	<?php wp_footer(); ?>
</body>
</html>
	<?php
	die();
}
add_action( 'wp_ajax_bflm_preview', 'bflm_preview_map' );

// ---------------------------------------------------------------------------
// Editor script localisation — expose the preview URL and a nonce so edit.js
// can build the iframe src without hard-coding the admin-ajax URL.
// ---------------------------------------------------------------------------

/**
 * Localise bflmEditor data onto the block's editor script handle.
 * Runs on enqueue_block_editor_assets (outer admin frame only).
 */
function bflm_localise_editor_script(): void {
	wp_localize_script(
		'blocks-for-leaflet-map-leaflet-map-block-editor-script',
		'bflmEditor',
		array(
			'previewUrl'   => admin_url( 'admin-ajax.php' ),
			'previewNonce' => wp_create_nonce( 'bflm_preview_nonce' ),
			'geocodeNonce' => wp_create_nonce( 'bflm_geocode_nonce' ),
		)
	);
	wp_set_script_translations(
		'blocks-for-leaflet-map-leaflet-map-block-editor-script',
		'blocks-for-leaflet-map',
		BFLM_PLUGIN_DIR . 'languages'
	);
}
add_action( 'enqueue_block_editor_assets', 'bflm_localise_editor_script' );

// ---------------------------------------------------------------------------
// Geocode endpoint — AJAX handler that queries Nominatim for up to 5 address
// candidates and returns them as JSON for the block editor to display.
// ---------------------------------------------------------------------------

/**
 * Handle address geocoding requests from the block editor.
 *
 * Queries the Nominatim API for up to 5 candidates matching the submitted
 * address and returns a JSON-encoded list. Reuses Leaflet Map's User-Agent
 * and contact-email conventions, including the leaflet_map_nominatim_contact_email
 * filter, so the request is correctly attributed.
 *
 * Security: nonce verified via check_ajax_referer(), capability checked with
 * current_user_can(), input sanitised with sanitize_text_field().
 */
function bflm_geocode_address(): void {
	check_ajax_referer( 'bflm_geocode_nonce', '_ajax_nonce' );

	if ( ! current_user_can( 'edit_posts' ) ) {
		wp_send_json_error(
			array( 'message' => __( 'You do not have permission to perform this action.', 'blocks-for-leaflet-map' ) ),
			403
		);
	}

	if ( ! bflm_is_leaflet_map_active() ) {
		wp_send_json_error(
			array( 'message' => __( 'The Leaflet Map plugin is not active.', 'blocks-for-leaflet-map' ) )
		);
	}

	$address = isset( $_POST['address'] ) ? sanitize_text_field( wp_unslash( $_POST['address'] ) ) : '';

	if ( '' === $address ) {
		wp_send_json_error(
			array( 'message' => __( 'Please enter an address to search.', 'blocks-for-leaflet-map' ) )
		);
	}

	// Build contact email and User-Agent following Leaflet Map's osm_geocode() conventions,
	// including the leaflet_map_nominatim_contact_email filter.
	$contact_email = '';
	if ( class_exists( 'Leaflet_Map_Plugin_Settings' ) ) {
		$settings      = Leaflet_Map_Plugin_Settings::init();
		$contact_email = $settings->get( 'nominatim_contact_email' );
	}
	if ( empty( $contact_email ) ) {
		$contact_email = get_bloginfo( 'admin_email' );
	}
	$contact_email   = apply_filters( 'bflm_nominatim_contact_email', $contact_email );
	$accept_language = str_replace( '_', '-', get_locale() );
	$user_agent      = 'Nominatim query for ' . get_bloginfo( 'url' ) . '; contact ' . $contact_email;

	$request_url = sprintf(
		'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=%s',
		rawurlencode( $address )
	);

	$response = wp_remote_get(
		$request_url,
		array(
			'user-agent' => $user_agent,
			'headers'    => array(
				'Accept-Language' => $accept_language,
			),
		)
	);

	if ( is_wp_error( $response ) ) {
		wp_send_json_error(
			array( 'message' => __( 'Geocoding request failed. Please try again.', 'blocks-for-leaflet-map' ) )
		);
	}

	$body = wp_remote_retrieve_body( $response );
	$data = json_decode( $body );

	if ( ! is_array( $data ) || empty( $data ) ) {
		wp_send_json_error(
			array( 'message' => __( 'No results found for that address.', 'blocks-for-leaflet-map' ) )
		);
	}

	$candidates = array();
	foreach ( $data as $item ) {
		if ( ! isset( $item->lat, $item->lon, $item->display_name ) ) {
			continue;
		}
		$candidates[] = array(
			'display_name' => sanitize_text_field( $item->display_name ),
			'lat'          => (float) $item->lat,
			'lng'          => (float) $item->lon,
		);
	}

	if ( empty( $candidates ) ) {
		wp_send_json_error(
			array( 'message' => __( 'No results found for that address.', 'blocks-for-leaflet-map' ) )
		);
	}

	wp_send_json_success( array( 'candidates' => $candidates ) );
}
add_action( 'wp_ajax_bflm_geocode', 'bflm_geocode_address' );

/**
 * Allow GeoJSON, GPX, and KML files to be uploaded via the WordPress Media Library.
 *
 * WordPress strips these MIME types from the default allowlist. Without this filter
 * the files upload successfully but are served as 404 by the web server because
 * WordPress marks them as invalid and does not write them to the uploads directory.
 *
 * @param array<string,string> $mimes Associative array of extension → MIME type.
 * @return array<string,string>
 */
function bflm_allow_data_layer_mimes( array $mimes ): array {
	$mimes['geojson'] = 'application/geo+json';
	$mimes['gpx']     = 'application/gpx+xml';
	$mimes['kml']     = 'application/vnd.google-earth.kml+xml';
	$mimes['kmz']     = 'application/vnd.google-earth.kmz';
	return $mimes;
}
add_filter( 'upload_mimes', 'bflm_allow_data_layer_mimes' );

/**
 * Bypass real-file-type check for GeoJSON/GPX/KML uploads.
 *
 * `wp_check_filetype_and_ext()` uses finfo/mime_content_type to inspect the
 * actual file bytes. These text-XML formats are often identified as text/plain
 * or application/xml, which does not match the registered MIME type and causes
 * WordPress to reject the upload. We trust the file extension alone for these
 * known-safe, editor-only types.
 *
 * @param array<string,string|bool> $checked   Array with keys: ext, type, proper_filename.
 * @param string                    $file      Full path to the file.
 * @param string                    $filename  The name of the file.
 * @param array<string,string>|null $mimes     Allowed MIME types (unused; extension checked directly).
 * @param string|false              $real_mime The real MIME type detected (unused).
 * @return array<string,string|bool>
 */
function bflm_fix_data_layer_filetype( array $checked, string $file, string $filename, ?array $mimes, $real_mime ): array { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- $mimes and $real_mime required by filter signature.
	$ext     = strtolower( pathinfo( $filename, PATHINFO_EXTENSION ) );
	$allowed = array(
		'geojson' => 'application/geo+json',
		'gpx'     => 'application/gpx+xml',
		'kml'     => 'application/vnd.google-earth.kml+xml',
		'kmz'     => 'application/vnd.google-earth.kmz',
	);
	if ( isset( $allowed[ $ext ] ) ) {
		$checked['ext']  = $ext;
		$checked['type'] = $allowed[ $ext ];
	}
	return $checked;
}
add_filter( 'wp_check_filetype_and_ext', 'bflm_fix_data_layer_filetype', 10, 5 );
