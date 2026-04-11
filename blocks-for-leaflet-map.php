<?php
/**
 * Plugin Name:       Blocks for Leaflet Map
 * Plugin URI:        https://github.com/jesusyesares/blocks-for-leaflet-map
 * Description:       A dynamic Gutenberg block that wraps the Leaflet Map plugin shortcodes. Requires the "Leaflet Map" plugin to be installed and active.
 * Version:           0.1.0
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

define( 'BFLM_VERSION', '0.1.0' );
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
// Leaflet Map only hooks its enqueue_and_register() to wp_enqueue_scripts
// (frontend), so its handles are never registered in the admin context.
// We call the same static method here to register them, then enqueue the
// three handles the [leaflet-map] shortcode pipeline depends on:
//   • leaflet_stylesheet  – Leaflet CSS (CDN or custom URL from settings)
//   • leaflet_js          – Leaflet core JS
//   • wp_leaflet_map      – construct-leaflet-map.js (bootstraps every map)
// ---------------------------------------------------------------------------

/**
 * Enqueue Leaflet Map assets in the block editor so ServerSideRender
 * can render a live map preview inside the editor iframe.
 */
function bflm_enqueue_editor_assets(): void {
	// Register the Leaflet handles in the admin context (no-op on frontend).
	Leaflet_Map::enqueue_and_register();

	wp_enqueue_style( 'leaflet_stylesheet' );
	wp_enqueue_script( 'leaflet_js' );
	wp_enqueue_script( 'wp_leaflet_map' );
}
add_action( 'enqueue_block_editor_assets', 'bflm_enqueue_editor_assets' );
