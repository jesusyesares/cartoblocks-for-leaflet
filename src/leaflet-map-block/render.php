<?php
/**
 * Server-side rendering for the Leaflet Map Block.
 *
 * Transforms block attributes into Leaflet Map plugin shortcodes, then runs
 * them through do_shortcode(). All shortcode-assembly logic lives in the
 * shared builders under includes/shortcodes/ — this file is a thin template
 * that orchestrates them and emits the wrapper HTML.
 *
 * Frontend behaviour (invalidateSize, image-fit) is handled by view.js,
 * which is registered as the block's `viewScript` and enqueued automatically
 * by WordPress on pages that contain this block. Data attributes on the
 * wrapper element carry any per-instance values that view.js needs.
 *
 * Available variables (injected by WordPress):
 *   $attributes (array)    – block attributes as defined in block.json.
 *   $content    (string)   – inner block content (unused for this block).
 *   $block      (WP_Block) – block instance.
 *
 * @package BlocksForLeafletMap
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

// Canonicalise input + build all shortcodes via shared helpers.
$bflm_attrs = bflm_normalise_map_attrs( isset( $attributes ) && is_array( $attributes ) ? $attributes : array() );

$bflm_marker_shortcodes  = bflm_build_marker_shortcodes(
	isset( $bflm_attrs['markers'] ) && is_array( $bflm_attrs['markers'] ) ? $bflm_attrs['markers'] : array()
);
$bflm_line_shortcodes    = bflm_build_line_shortcodes(
	isset( $bflm_attrs['lines'] ) && is_array( $bflm_attrs['lines'] ) ? $bflm_attrs['lines'] : array()
);
$bflm_circle_shortcodes  = bflm_build_circle_shortcodes(
	isset( $bflm_attrs['circles'] ) && is_array( $bflm_attrs['circles'] ) ? $bflm_attrs['circles'] : array()
);
$bflm_layer_shortcodes   = bflm_build_layer_shortcodes(
	isset( $bflm_attrs['layers'] ) && is_array( $bflm_attrs['layers'] ) ? $bflm_attrs['layers'] : array()
);
$bflm_overlay_shortcodes = bflm_build_overlay_shortcodes(
	isset( $bflm_attrs['overlays'] ) && is_array( $bflm_attrs['overlays'] ) ? $bflm_attrs['overlays'] : array()
);

$bflm_wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class' => 'bflm-leaflet-map-block',
		'style' => sprintf( 'width:%s;', esc_attr( (string) $bflm_attrs['width'] ) ),
	)
);

// Render: wrapper div → shortcode output (Leaflet Map plugin handles the rest).
if ( $bflm_attrs['imageMap'] && '' !== $bflm_attrs['imageSrc'] ) {
	$bflm_image_shortcode = bflm_build_image_shortcode( $bflm_attrs );
	?>
<div data-bflm-image-zoom="<?php echo esc_attr( (string) (float) $bflm_attrs['imageZoom'] ); ?>" <?php echo $bflm_wrapper_attributes; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- sanitized by get_block_wrapper_attributes(). ?>>
	<?php echo do_shortcode( $bflm_image_shortcode . $bflm_marker_shortcodes . $bflm_line_shortcodes . $bflm_circle_shortcodes ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- trusted output from registered shortcodes. ?>
</div>
	<?php
} elseif ( $bflm_attrs['wmsEnabled'] ) {
	$bflm_wms_shortcode = bflm_build_wms_shortcode( $bflm_attrs );
	?>
<div <?php echo $bflm_wrapper_attributes; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- sanitized by get_block_wrapper_attributes(). ?>>
	<?php echo do_shortcode( $bflm_wms_shortcode . $bflm_marker_shortcodes . $bflm_line_shortcodes . $bflm_circle_shortcodes ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- trusted output from registered shortcodes. ?>
</div>
	<?php
} else {
	$bflm_map_shortcode = bflm_build_map_shortcode( $bflm_attrs );
	?>
<div <?php echo $bflm_wrapper_attributes; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- sanitized by get_block_wrapper_attributes(). ?>>
	<?php echo do_shortcode( $bflm_map_shortcode . $bflm_marker_shortcodes . $bflm_line_shortcodes . $bflm_circle_shortcodes . $bflm_layer_shortcodes . $bflm_overlay_shortcodes ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- trusted output from registered shortcodes. ?>
</div>
	<?php
}
