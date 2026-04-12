<?php
/**
 * Plugin Name:       Blocks for Leaflet Map
 * Plugin URI:        https://github.com/jesusyesares/blocks-for-leaflet-map
 * Description:       A dynamic Gutenberg block that wraps the Leaflet Map plugin shortcodes. Requires the "Leaflet Map" plugin to be installed and active.
 * Version:           0.2.1
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

define( 'BFLM_VERSION', '0.2.1' );
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
// Editor asset loading — make Leaflet JS/CSS available in the block editor
// iframe (WP 6.3+).
//
// `enqueue_block_assets` fires inside the iframe as well as on the frontend.
// On the frontend the Leaflet Map plugin's own shortcode enqueue handles
// Leaflet automatically, so we guard with is_admin() to avoid double-loading.
//
// edit.js (editorScript) runs in the OUTER admin frame and accesses Leaflet
// via `mapContainerRef.current.ownerDocument.defaultView.L`. It reads tile
// configuration from `iframeWin.bflmConfig`, which we inject here via
// wp_add_inline_script on the `leaflet_js` handle (iframe scope).
// ---------------------------------------------------------------------------

/**
 * Enqueue Leaflet core assets inside the block editor iframe and inject the
 * tile configuration object (bflmConfig) that edit.js reads at map init time.
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

	// ── Referrer policy (iframe) ─────────────────────────────────────────────
	// The iframe's default referrer policy ("strict-origin-when-cross-origin")
	// strips the URL path, causing tile servers (e.g. OpenStreetMap) to return
	// 403 "Referer required" errors.
	//
	// We use document.head.prepend() so the meta becomes the absolute first
	// element in <head>, guaranteeing it is parsed before any network request
	// (including the Leaflet CSS from unpkg) that might otherwise fire under
	// the stricter default policy.
	wp_add_inline_script(
		'leaflet_js',
		"( function () { var m = document.createElement( 'meta' ); m.name = 'referrer'; m.content = 'no-referrer-when-downgrade'; document.head.prepend( m ); }() );",
		'before'
	);

	// ── Tile configuration for edit.js ───────────────────────────────────────
	// edit.js reads window.bflmConfig from the iframe window to initialise the
	// tile layer with the same URL/subdomains/attribution the admin has chosen
	// in the parent Leaflet Map plugin settings.
	$settings = Leaflet_Map::settings();

	$bflm_config = array(
		'tileUrl'        => $settings->get( 'map_tile_url' ),
		'tileSubdomains' => $settings->get( 'map_tile_url_subdomains' ),
		'attribution'    => $settings->get( 'default_attribution' ),
	);

	wp_add_inline_script(
		'leaflet_js',
		'window.bflmConfig = ' . wp_json_encode( $bflm_config ) . ';'
	);
}
add_action( 'enqueue_block_assets', 'bflm_enqueue_block_assets' );

// ---------------------------------------------------------------------------
// Referrer policy (outer frame) — belt-and-suspenders companion to the inline
// script injected into the iframe above.
//
// admin_head targets the outer admin document. WordPress propagates assets
// collected via _wp_get_iframed_editor_assets() into the iframe, but an
// explicit meta in the outer frame ensures the policy is active from the very
// first navigation, before the iframe initialises.
// ---------------------------------------------------------------------------

/**
 * Print a Referrer-Policy meta tag in the outer admin frame for the block
 * editor so tile servers receive the full site URL as Referer.
 */
function bflm_admin_referrer_policy(): void {
	if ( ! get_current_screen()?->is_block_editor() ) {
		return;
	}

	echo '<meta name="referrer" content="no-referrer-when-downgrade">' . "\n";
}
add_action( 'admin_head', 'bflm_admin_referrer_policy' );
