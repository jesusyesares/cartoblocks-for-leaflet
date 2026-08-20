<?php
/**
 * Plugin Name:       CartoBlocks for Leaflet
 * Plugin URI:        https://github.com/jesusyesares/cartoblocks-for-leaflet
 * Description:       A dynamic Gutenberg block that wraps the Leaflet Map plugin shortcodes. Requires the "Leaflet Map" plugin to be installed and active.
 * Version:           1.2.7
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

define( 'BFLM_VERSION', '1.2.7' );
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
require_once BFLM_PLUGIN_DIR . 'includes/migrations.php';

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

// ---------------------------------------------------------------------------
// One-time migration of post_content still using the pre-1.2.1 block name
// (see includes/migrations.php for the pure rewrite helper).
// ---------------------------------------------------------------------------

/**
 * Finds posts still containing the pre-1.2.1 block name and rewrites them.
 *
 * Runs at most once per site: gated by the `bflm_legacy_block_migrated`
 * option, so the LIKE query only ever executes on the first admin page load
 * after this fix ships (and never again afterwards — on multisite, each
 * site's own admin_init handles its own migration independently).
 *
 * @return void
 */
function bflm_migrate_legacy_block_names(): void {
	if ( get_option( 'bflm_legacy_block_migrated' ) ) {
		return;
	}

	global $wpdb;

	$like = '%' . $wpdb->esc_like( 'wp:blocks-for-leaflet-map/leaflet-map-block' ) . '%';

	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
	$posts = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT ID, post_content FROM {$wpdb->posts} WHERE post_content LIKE %s AND post_status != 'trash'",
			$like
		)
	);

	$migrated_count = 0;

	foreach ( $posts as $post ) {
		$rewritten = bflm_rewrite_legacy_block_markup( $post->post_content );

		if ( $rewritten === $post->post_content ) {
			continue;
		}

		wp_update_post(
			array(
				'ID'           => $post->ID,
				'post_content' => $rewritten,
			)
		);

		++$migrated_count;
	}

	update_option( 'bflm_legacy_block_migrated', true );

	if ( $migrated_count > 0 ) {
		set_transient( 'bflm_legacy_block_migrated_count', $migrated_count, DAY_IN_SECONDS );
	}
}

/**
 * Runs the legacy block-name migration for administrators, then shows a
 * one-time admin notice reporting how many posts/pages were updated.
 *
 * @return void
 */
function bflm_migrate_legacy_block_names_maybe(): void {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}

	bflm_migrate_legacy_block_names();

	$count = get_transient( 'bflm_legacy_block_migrated_count' );

	if ( false === $count ) {
		return;
	}

	delete_transient( 'bflm_legacy_block_migrated_count' );

	add_action(
		'admin_notices',
		static function () use ( $count ) {
			printf(
				'<div class="notice notice-success is-dismissible"><p>%s</p></div>',
				esc_html(
					sprintf(
						/* translators: %d: number of updated posts/pages. */
						_n(
							'CartoBlocks for Leaflet updated %d map block to the current block format.',
							'CartoBlocks for Leaflet updated %d map blocks to the current block format.',
							$count,
							'cartoblocks-for-leaflet'
						),
						$count
					)
				)
			);
		}
	);
}
add_action( 'admin_init', 'bflm_migrate_legacy_block_names_maybe' );
