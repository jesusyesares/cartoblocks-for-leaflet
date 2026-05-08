<?php
/**
 * TGM Plugin Activation configuration.
 *
 * Owns the entire TGMPA integration: loads the vendored library, declares the
 * required plugin set, and registers the activation hook. The vendored library
 * itself (includes/class-tgm-plugin-activation.php) is upstream code and must
 * not be modified — see CLAUDE.md note on PR #20 reviewer comments.
 *
 * @package BlocksForLeafletMap
 */

defined( 'ABSPATH' ) || exit;

require_once BFLM_PLUGIN_DIR . 'includes/class-tgm-plugin-activation.php';

/**
 * Register required plugins with TGMPA.
 *
 * @return void
 */
function bflm_register_required_plugins(): void {
	$plugins = array(
		array(
			'name'     => 'Leaflet Map',
			'slug'     => 'leaflet-map',
			'required' => true,
		),
	);

	$config = array(
		'id'           => 'blocks-for-leaflet-map',
		'default_path' => '',
		'menu'         => 'tgmpa-install-plugins',
		'parent_slug'  => 'plugins.php',
		'capability'   => 'manage_options',
		'has_notices'  => true,
		'dismissable'  => false,
		'dismiss_msg'  => '',
		'is_automatic' => false,
		'message'      => '',
	);

	tgmpa( $plugins, $config );
}
add_action( 'tgmpa_register', 'bflm_register_required_plugins' );
