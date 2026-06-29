<?php
/**
 * Preview AJAX endpoint orchestrator.
 *
 * Verifies the nonce, then delegates input parsing to
 * bflm_preview_normalise_input() (input.php) and HTML rendering to
 * bflm_preview_render_template() (template.php).
 *
 * @package BlocksForLeafletMap
 */

defined( 'ABSPATH' ) || exit;

/**
 * Output a complete HTML page that renders the map via Leaflet Map plugin
 * shortcodes. Called by the editor iframe's src attribute.
 *
 * Security: nonce verified before any input is read; all $_GET fields are
 * sanitised inside bflm_preview_normalise_input(); shortcode output is
 * trusted via the same rationale as render.php.
 *
 * @return void
 */
function bflm_preview_map(): void {
	$nonce = isset( $_GET['bflm_nonce'] ) ? sanitize_text_field( wp_unslash( $_GET['bflm_nonce'] ) ) : '';
	if ( ! wp_verify_nonce( $nonce, 'bflm_preview_nonce' ) ) {
		wp_die( esc_html__( 'Invalid or expired preview token.', 'cartoblocks-for-leaflet' ), 403 );
	}

	$attrs = bflm_preview_normalise_input( $_GET ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- nonce verified above.
	bflm_preview_render_template( $attrs );
	die();
}
add_action( 'wp_ajax_bflm_preview', 'bflm_preview_map' );
