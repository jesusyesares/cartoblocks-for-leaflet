<?php
/**
 * Preview-endpoint HTML template.
 *
 * Receives the canonical attrs array from bflm_preview_normalise_input() and
 * emits the full self-contained HTML page that the editor iframe loads. All
 * shortcode building goes through the shared bflm_build_*_shortcodes() helpers
 * in includes/shortcodes/. The inline JS bridges the iframe to edit.js via
 * window.top.postMessage.
 *
 * @package BlocksForLeafletMap
 */

defined( 'ABSPATH' ) || exit;

/**
 * Render the complete preview page (HTML + inline JS).
 *
 * Echoes directly. The caller (bflm_preview_map() in endpoint.php) is
 * responsible for the trailing die().
 *
 * @param array<string,mixed> $attrs Canonical attrs from bflm_preview_normalise_input().
 * @return void
 */
function bflm_preview_render_template( array $attrs ): void {
	// Shortcode strings to feed do_shortcode().
	$marker_shortcodes  = bflm_build_marker_shortcodes( isset( $attrs['markers'] ) && is_array( $attrs['markers'] ) ? $attrs['markers'] : array() );
	$line_shortcodes    = bflm_build_line_shortcodes( isset( $attrs['lines'] ) && is_array( $attrs['lines'] ) ? $attrs['lines'] : array() );
	$circle_shortcodes  = bflm_build_circle_shortcodes( isset( $attrs['circles'] ) && is_array( $attrs['circles'] ) ? $attrs['circles'] : array() );
	$layer_shortcodes   = bflm_build_layer_shortcodes( isset( $attrs['layers'] ) && is_array( $attrs['layers'] ) ? $attrs['layers'] : array() );
	$overlay_shortcodes = bflm_build_overlay_shortcodes( isset( $attrs['overlays'] ) && is_array( $attrs['overlays'] ) ? $attrs['overlays'] : array() );

	// Editor-only draw-mode helper pins (markers shown for partially-drawn lines).
	$line_helpers          = bflm_build_line_point_helpers( isset( $attrs['lines'] ) && is_array( $attrs['lines'] ) ? $attrs['lines'] : array() );
	$line_point_shortcodes = $line_helpers['shortcodes'];
	$line_point_meta       = $line_helpers['meta'];

	// Real-marker count = markers passed by the editor that are renderable
	// (had lat+lng). The line-point helpers come after them in the marker layer
	// list, so the JS uses this to slice draggable real markers vs draw helpers.
	$real_marker_count = 0;
	$markers           = isset( $attrs['markers'] ) && is_array( $attrs['markers'] ) ? $attrs['markers'] : array();
	foreach ( $markers as $marker ) {
		if ( isset( $marker['lat'], $marker['lng'] ) ) {
			++$real_marker_count;
		}
	}

	// Build the right top-level shortcode for the chosen mode.
	$is_image_map    = ! empty( $attrs['imageMap'] ) && '' !== $attrs['imageSrc'];
	$wms_enabled     = ! $is_image_map && ! empty( $attrs['wmsEnabled'] );
	$map_shortcode   = bflm_build_map_shortcode( $attrs );
	$wms_shortcode   = $wms_enabled ? bflm_build_wms_shortcode( $attrs ) : '';
	$image_shortcode = $is_image_map ? bflm_build_image_shortcode( $attrs ) : '';

	// JSON values pre-computed for the inline JS.
	$block_id    = isset( $attrs['blockId'] ) ? (string) $attrs['blockId'] : '';
	$min_zoom    = isset( $attrs['minZoom'] ) ? (string) $attrs['minZoom'] : '';
	$max_zoom    = isset( $attrs['maxZoom'] ) ? (string) $attrs['maxZoom'] : '';
	$max_bounds  = isset( $attrs['maxBounds'] ) ? (string) $attrs['maxBounds'] : '';
	$fit_markers = ! empty( $attrs['fitMarkers'] );
	$image_zoom  = isset( $attrs['imageZoom'] ) ? (float) $attrs['imageZoom'] : 0.0;

	// Register a virtual handle (no external file: src = false) for this preview
	// page's own CSS/JS. Inline content is attached via wp_add_inline_style() /
	// wp_add_inline_script() below and printed by wp_head() / wp_footer(), so no
	// raw <style>/<script> tags are emitted by this template (Plugin Review:
	// "Use wp_enqueue commands"). admin-ajax.php does not fire wp_enqueue_scripts,
	// so registration/enqueueing happens here, before wp_head() is called.
	wp_register_style( 'bflm-preview', false, array(), BFLM_VERSION );
	wp_enqueue_style( 'bflm-preview' );
	wp_add_inline_style( 'bflm-preview', bflm_preview_inline_css() );

	// Main iframe↔editor bridge script. The PHP-computed values are injected as a
	// small "before" data object; the static logic is attached as an "after"
	// script so no PHP is interpolated into executable JS.
	wp_register_script( 'bflm-preview', false, array(), BFLM_VERSION, true );
	wp_enqueue_script( 'bflm-preview' );
	wp_add_inline_script(
		'bflm-preview',
		'window.bflmPreviewData = ' . wp_json_encode(
			array(
				'blockId'         => $block_id,
				'minZoom'         => '' !== $min_zoom && is_numeric( $min_zoom ) ? (float) $min_zoom : null,
				'maxZoom'         => '' !== $max_zoom && is_numeric( $max_zoom ) ? (float) $max_zoom : null,
				'maxBounds'       => $max_bounds,
				'realMarkerCount' => $real_marker_count,
				'linePointMeta'   => $line_point_meta,
				'fitMarkers'      => (bool) $fit_markers,
			)
		) . ';',
		'before'
	);
	wp_add_inline_script( 'bflm-preview', bflm_preview_bridge_js(), 'after' );

	// Image-map fit script — only enqueued for image maps. Its single PHP value
	// (the zoom offset) is passed as a "before" data var.
	if ( $is_image_map ) {
		wp_register_script( 'bflm-preview-imagefit', false, array(), BFLM_VERSION, true );
		wp_enqueue_script( 'bflm-preview-imagefit' );
		wp_add_inline_script(
			'bflm-preview-imagefit',
			'window.bflmImageFitData = { zoomOffset: ' . wp_json_encode( $image_zoom ) . ' };',
			'before'
		);
		wp_add_inline_script( 'bflm-preview-imagefit', bflm_preview_imagefit_js(), 'after' );
	}

	// Render a complete, self-contained HTML page.
	// wp_head() / wp_footer() let the Leaflet Map plugin load its own assets and
	// print the inline CSS/JS registered above.
	?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>">
<meta name="referrer" content="origin">
<meta name="viewport" content="width=device-width, initial-scale=1">
	<?php wp_head(); ?>
</head>
<body>
<div id="map-wrap">
	<?php
	// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- trusted shortcode output, same rationale as render.php.
	if ( $is_image_map ) {
		echo do_shortcode( $image_shortcode . $marker_shortcodes . $line_shortcodes . $line_point_shortcodes . $circle_shortcodes ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		// Image-fit logic is enqueued as the 'bflm-preview-imagefit' script above.
	} elseif ( $wms_enabled ) {
		echo do_shortcode( $wms_shortcode . $marker_shortcodes . $line_shortcodes . $line_point_shortcodes . $circle_shortcodes ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	} else {
		echo do_shortcode( $map_shortcode . $marker_shortcodes . $line_shortcodes . $line_point_shortcodes . $circle_shortcodes . $layer_shortcodes . $overlay_shortcodes ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	}
	?>
</div>
	<?php
	// The iframe↔editor bridge script is enqueued as the 'bflm-preview' script
	// above (logic in bflm_preview_bridge_js(), data in window.bflmPreviewData)
	// and printed by wp_footer() below.
	?>
	<?php wp_footer(); ?>
</body>
</html>
	<?php
}
