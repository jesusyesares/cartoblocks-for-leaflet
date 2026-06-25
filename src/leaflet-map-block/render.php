<?php
/**
 * Server-side rendering for the Leaflet Map Block.
 *
 * Transforms block attributes into Leaflet Map plugin shortcodes, then runs
 * them through do_shortcode(). All shortcode-assembly logic lives in the
 * shared builders under includes/shortcodes/ — this file is a thin template
 * that orchestrates them and emits the wrapper HTML + inline scripts.
 *
 * Available variables (injected by WordPress):
 *   $attributes (array)    – block attributes as defined in block.json.
 *   $content    (string)   – inner block content (unused for this block).
 *   $block      (WP_Block) – block instance.
 *
 * @package BlocksForLeafletMap
 */

if ( ! defined( 'ABSPATH' ) ) {
	return;
}

// Canonicalise input + build all shortcodes via shared helpers.
$bflm_attrs = bflm_normalise_map_attrs( is_array( $attributes ) ? $attributes : array() );

$bflm_marker_shortcodes = bflm_build_marker_shortcodes(
	isset( $bflm_attrs['markers'] ) && is_array( $bflm_attrs['markers'] ) ? $bflm_attrs['markers'] : array()
);
$bflm_line_shortcodes = bflm_build_line_shortcodes(
	isset( $bflm_attrs['lines'] ) && is_array( $bflm_attrs['lines'] ) ? $bflm_attrs['lines'] : array()
);
$bflm_circle_shortcodes = bflm_build_circle_shortcodes(
	isset( $bflm_attrs['circles'] ) && is_array( $bflm_attrs['circles'] ) ? $bflm_attrs['circles'] : array()
);
$bflm_layer_shortcodes = bflm_build_layer_shortcodes(
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
<div <?php echo $bflm_wrapper_attributes; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- sanitized by get_block_wrapper_attributes(). ?>>
	<?php echo do_shortcode( $bflm_image_shortcode . $bflm_marker_shortcodes . $bflm_line_shortcodes . $bflm_circle_shortcodes ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- trusted output from registered shortcodes. ?>
	<script>
	( function () {
		var zoomOffset = <?php echo (float) $bflm_attrs['imageZoom']; ?>;
		var attempts   = 0;
		function fitImage() {
			var plugin = window.WPLeafletMapPlugin;
			if ( ! plugin || ! plugin.maps || ! plugin.maps[ 0 ] ) {
				if ( 50 > ++attempts ) { setTimeout( fitImage, 100 ); } return;
			}
			var map = plugin.maps[ 0 ];
			if ( ! map.is_image_map ) { return; }
			var overlay = null;
			map.eachLayer( function ( l ) { if ( ! overlay && l.getBounds && l.getElement ) { overlay = l; } } );
			if ( ! overlay ) { if ( 50 > ++attempts ) { setTimeout( fitImage, 100 ); } return; }
			var img = overlay.getElement();
			if ( ! img || ! img.naturalWidth ) { if ( 50 > ++attempts ) { setTimeout( fitImage, 100 ); } return; }
			var iw = img.naturalWidth;
			var ih = img.naturalHeight;
			var mw = map.getContainer().offsetWidth;
			var mh = map.getContainer().offsetHeight;
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
</div>
	<?php
} elseif ( $bflm_attrs['wmsEnabled'] ) {
	$bflm_wms_shortcode = bflm_build_wms_shortcode( $bflm_attrs );
	$bflm_wrap_id       = 'bflm-wrap-' . esc_attr( uniqid() );
	?>
<div id="<?php echo $bflm_wrap_id; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- esc_attr applied above. ?>" <?php echo $bflm_wrapper_attributes; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- sanitized by get_block_wrapper_attributes(). ?>>
	<?php echo do_shortcode( $bflm_wms_shortcode . $bflm_marker_shortcodes . $bflm_line_shortcodes . $bflm_circle_shortcodes ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- trusted output from registered shortcodes. ?>
</div>
<script>( function(){ var w=document.getElementById('<?php echo $bflm_wrap_id; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- esc_attr applied above. ?>'); window.WPLeafletMapPlugin=window.WPLeafletMapPlugin||[]; window.WPLeafletMapPlugin.push(function(){ var p=window.WPLeafletMapPlugin; var m=p.maps&&p.maps.find(function(x){return x&&x.getContainer&&w&&w.contains(x.getContainer());}); if(m&&m.invalidateSize){setTimeout(function(){m.invalidateSize();},50);} }); }() );</script>
	<?php
} else {
	$bflm_map_shortcode = bflm_build_map_shortcode( $bflm_attrs );
	$bflm_wrap_id       = 'bflm-wrap-' . esc_attr( uniqid() );
	?>
<div id="<?php echo $bflm_wrap_id; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- esc_attr applied above. ?>" <?php echo $bflm_wrapper_attributes; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- sanitized by get_block_wrapper_attributes(). ?>>
	<?php echo do_shortcode( $bflm_map_shortcode . $bflm_marker_shortcodes . $bflm_line_shortcodes . $bflm_circle_shortcodes . $bflm_layer_shortcodes . $bflm_overlay_shortcodes ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- trusted output from registered shortcodes; escaping would corrupt the map HTML and inline scripts. ?>
</div>
<script>( function(){ var w=document.getElementById('<?php echo $bflm_wrap_id; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- esc_attr applied above. ?>'); window.WPLeafletMapPlugin=window.WPLeafletMapPlugin||[]; window.WPLeafletMapPlugin.push(function(){ var p=window.WPLeafletMapPlugin; var m=p.maps&&p.maps.find(function(x){return x&&x.getContainer&&w&&w.contains(x.getContainer());}); if(m&&m.invalidateSize){setTimeout(function(){m.invalidateSize();},50);} }); }() );</script>
	<?php
}
