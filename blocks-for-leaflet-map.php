<?php
/**
 * Plugin Name:       Blocks for Leaflet Map
 * Plugin URI:        https://github.com/jesusyesares/blocks-for-leaflet-map
 * Description:       A dynamic Gutenberg block that wraps the Leaflet Map plugin shortcodes. Requires the "Leaflet Map" plugin to be installed and active.
 * Version:           0.1.1
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

define( 'BFLM_VERSION', '0.1.1' );
define( 'BFLM_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'BFLM_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'BFLM_LEAFLET_MAP_PLUGIN', 'leaflet-map/leaflet-map.php' );

// ---------------------------------------------------------------------------
// Dependency check: "Leaflet Map" plugin must be active.
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

/**
 * Display an admin notice when the Leaflet Map plugin is missing or inactive.
 */
function bflm_missing_dependency_notice(): void {
	$plugin_link = sprintf(
		'<a href="%s" target="_blank" rel="noopener noreferrer">%s</a>',
		esc_url( 'https://wordpress.org/plugins/leaflet-map/' ),
		esc_html__( 'Leaflet Map', 'blocks-for-leaflet-map' )
	);

	printf(
		'<div class="notice notice-error"><p>%s</p></div>',
		wp_kses(
			sprintf(
				/* translators: %s: linked plugin name */
				__( '<strong>Blocks for Leaflet Map</strong> requires the %s plugin to be installed and active.', 'blocks-for-leaflet-map' ),
				$plugin_link
			),
			array(
				'strong' => array(),
				'a'      => array(
					'href'   => array(),
					'target' => array(),
					'rel'    => array(),
				),
			)
		)
	);
}

if ( ! bflm_is_leaflet_map_active() ) {
	add_action( 'admin_notices', 'bflm_missing_dependency_notice' );
	return; // Stop loading — do not register the block.
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
// Editor asset loading — make Leaflet JS/CSS available in the block editor.
//
// IMPORTANT: `enqueue_block_assets` fires inside the block editor iframe
// (WP 6.3+) as well as on the frontend, unlike `enqueue_block_editor_assets`
// which only fires in the outer admin frame. Leaflet must load inside the
// iframe where ServerSideRender renders the block preview.
//
// On the frontend the Leaflet Map plugin's own shortcode enqueue handles
// Leaflet automatically, so we guard with is_admin() to avoid double-loading.
//
// view-editor.js is NOT enqueued here — it is declared as a second entry in
// the block's editorScript array (block.json) so WordPress registers and
// loads it inside the iframe automatically.
// ---------------------------------------------------------------------------

/**
 * Enqueue Leaflet Map core assets inside the block editor iframe.
 *
 * Leaflet_Map::enqueue_and_register() is normally hooked to wp_enqueue_scripts
 * (frontend only). We call it explicitly here so the handles are registered
 * in the admin/iframe context before we enqueue them.
 */
function bflm_enqueue_block_assets(): void {
	if ( ! is_admin() ) {
		// On the frontend the parent plugin's shortcode handles Leaflet.
		return;
	}

	// Register handles in the current (iframe) context, then enqueue.
	Leaflet_Map::enqueue_and_register();

	wp_enqueue_style( 'leaflet_stylesheet' );
	wp_enqueue_script( 'leaflet_js' );
	wp_enqueue_script( 'wp_leaflet_map' );
}
add_action( 'enqueue_block_assets', 'bflm_enqueue_block_assets' );

// ---------------------------------------------------------------------------
// Referrer policy — tile servers (e.g. OpenStreetMap) require a Referer header
// to serve tiles. WordPress 6.3+ renders the block editor inside an iframe
// whose default referrer policy is "strict-origin-when-cross-origin", which
// strips the full URL and can cause 403 "Access blocked" errors on map tiles.
//
// Printing a <meta name="referrer"> tag in admin_head propagates into the
// editor iframe via _wp_get_iframed_editor_assets(), ensuring the site URL
// is sent as Referer on cross-origin tile requests.
// ---------------------------------------------------------------------------

/**
 * Print a Referrer-Policy meta tag in the block editor so tile servers receive
 * the full site URL as Referer and do not block tile requests with 403 errors.
 */
function bflm_admin_referrer_policy(): void {
	if ( ! get_current_screen()?->is_block_editor() ) {
		return;
	}

	echo '<meta name="referrer" content="no-referrer-when-downgrade">' . "\n";
}
add_action( 'admin_head', 'bflm_admin_referrer_policy' );
