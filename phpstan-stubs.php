<?php
/**
 * PHPStan-only constant stubs.
 *
 * Declares plugin constants whose runtime value is computed via a function
 * call (e.g. `plugin_dir_path( __FILE__ )` in cartoblocks-for-leaflet.php).
 * PHPStan can only discover `define()`'d constants when the value is a
 * literal it can statically evaluate, so this file re-declares them with
 * placeholder literal values purely so PHPStan recognises the constant
 * names when analysing `includes/*.php` files in isolation.
 *
 * This file is never loaded at runtime — it is only referenced via
 * `scanFiles` in phpstan.neon.
 *
 * @package BlocksForLeafletMap
 */

define( 'BFLM_PLUGIN_DIR', __DIR__ . '/' );

/**
 * PHP 8.0 polyfill signature.
 *
 * WordPress core (>= 5.9, wp-includes/compat.php) polyfills str_ends_with()
 * on PHP 7.4, and this plugin requires WordPress 6.8+, so the function is
 * always available at runtime. Declared here only so PHPStan, which analyses
 * against the plugin's PHP 7.4 platform requirement, recognises it.
 *
 * @param string $haystack The string to search in.
 * @param string $needle   The substring to search for.
 * @return bool Whether $haystack ends with $needle.
 */
function str_ends_with( $haystack, $needle ) {
	return true;
}
