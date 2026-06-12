<?php
/**
 * PHPStan-only constant stubs.
 *
 * Declares plugin constants whose runtime value is computed via a function
 * call (e.g. `plugin_dir_path( __FILE__ )` in blocks-for-leaflet-map.php).
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
