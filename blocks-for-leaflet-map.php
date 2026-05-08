<?php
/**
 * Plugin Name:       Blocks for Leaflet Map
 * Plugin URI:        https://github.com/jesusyesares/blocks-for-leaflet-map
 * Description:       A dynamic Gutenberg block that wraps the Leaflet Map plugin shortcodes. Requires the "Leaflet Map" plugin to be installed and active.
 * Version:           1.0.6
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

define( 'BFLM_VERSION', '1.0.6' );
define( 'BFLM_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'BFLM_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'BFLM_LEAFLET_MAP_PLUGIN', 'leaflet-map/leaflet-map.php' );

// ---------------------------------------------------------------------------
// Shared shortcode builders. Pure functions used by render.php (frontend) and
// the bflm_preview_map() editor iframe endpoint to avoid duplicating the
// shortcode-assembly logic.
// ---------------------------------------------------------------------------

require_once BFLM_PLUGIN_DIR . 'includes/shortcodes/attrs.php';
require_once BFLM_PLUGIN_DIR . 'includes/shortcodes/map.php';
require_once BFLM_PLUGIN_DIR . 'includes/shortcodes/marker.php';
require_once BFLM_PLUGIN_DIR . 'includes/shortcodes/line.php';
require_once BFLM_PLUGIN_DIR . 'includes/shortcodes/circle.php';
require_once BFLM_PLUGIN_DIR . 'includes/shortcodes/layer.php';
require_once BFLM_PLUGIN_DIR . 'includes/shortcodes/overlay.php';

// ---------------------------------------------------------------------------
// TGM Plugin Activation — bootstraps the "Leaflet Map" dependency installer.
// (Loads the vendored library + registers the activation hook.)
// ---------------------------------------------------------------------------

require_once BFLM_PLUGIN_DIR . 'includes/tgm-config.php';

// ---------------------------------------------------------------------------
// File-type filters — allow GeoJSON / GPX / KML / KMZ uploads.
// ---------------------------------------------------------------------------

require_once BFLM_PLUGIN_DIR . 'includes/filetypes.php';

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
// Block registration + editor integration (only reached when Leaflet Map is
// active). The preview endpoint, geocoder, and editor-asset localisation
// each live in their own file under includes/.
// ---------------------------------------------------------------------------

require_once BFLM_PLUGIN_DIR . 'includes/preview/input.php';
require_once BFLM_PLUGIN_DIR . 'includes/preview/template.php';
require_once BFLM_PLUGIN_DIR . 'includes/preview/endpoint.php';
require_once BFLM_PLUGIN_DIR . 'includes/editor-assets.php';
require_once BFLM_PLUGIN_DIR . 'includes/geocoder.php';

/**
 * Registers all blocks from the build manifest.
 *
 * @see https://make.wordpress.org/core/2025/03/13/more-efficient-block-type-registration-in-6-8/
 *
 * @return void
 */
function bflm_register_blocks(): void {
	wp_register_block_types_from_metadata_collection(
		BFLM_PLUGIN_DIR . 'build',
		BFLM_PLUGIN_DIR . 'build/blocks-manifest.php'
	);
}
add_action( 'init', 'bflm_register_blocks' );
