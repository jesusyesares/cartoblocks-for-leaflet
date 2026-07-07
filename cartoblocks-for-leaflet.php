<?php
/**
 * Plugin Name:       CartoBlocks for Leaflet
 * Plugin URI:        https://github.com/jesusyesares/cartoblocks-for-leaflet
 * Description:       A dynamic Gutenberg block that wraps the Leaflet Map plugin shortcodes. Requires the "Leaflet Map" plugin to be installed and active.
 * Version:           1.2.5
 * Requires at least: 6.8
 * Requires PHP:      7.4
 * Requires Plugins:  leaflet-map
 * Author:            Jesús Yesares García
 * Author URI:        https://jesusyesares.com
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       cartoblocks-for-leaflet
 *
 * @package BlocksForLeafletMap
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

define( 'BFLM_VERSION', '1.2.5' );
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
// Dependency on the "Leaflet Map" plugin is declared via the "Requires Plugins"
// header above (WordPress 6.5+ native plugin dependencies). WordPress core
// prevents activation until Leaflet Map is installed and active, and shows the
// install/activate prompt on the Plugins screen. The runtime guard below
// (bflm_is_leaflet_map_active) remains as a defensive check.
// ---------------------------------------------------------------------------

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
	// Defensive guard. WordPress core normally blocks activation while the
	// "Leaflet Map" dependency (declared in the "Requires Plugins" header) is
	// missing, so this early return only triggers in edge cases such as the
	// dependency being force-deactivated programmatically mid-request.
	return;
}

// ---------------------------------------------------------------------------
// Block registration + editor integration (only reached when Leaflet Map is
// active). The preview endpoint, geocoder, and editor-asset localisation
// each live in their own file under includes/.
// ---------------------------------------------------------------------------

require_once BFLM_PLUGIN_DIR . 'includes/preview/input.php';
require_once BFLM_PLUGIN_DIR . 'includes/preview/inline-assets.php';
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
