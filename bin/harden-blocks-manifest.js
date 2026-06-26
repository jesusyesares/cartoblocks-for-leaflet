#!/usr/bin/env node
/**
 * Post-build hardening for build/blocks-manifest.php.
 *
 * wp-scripts regenerates build/blocks-manifest.php on every build without an
 * ABSPATH guard, which the WordPress.org Plugin Check flags as
 * `missing_direct_file_access_protection`. This script injects the standard
 * guard immediately after the opening PHP tag if it is not already present.
 *
 * Idempotent: safe to run repeatedly.
 */
'use strict';

const fs = require( 'fs' );
const path = require( 'path' );

const manifestPath = path.join( __dirname, '..', 'build', 'blocks-manifest.php' );

if ( ! fs.existsSync( manifestPath ) ) {
	// Nothing to harden — build may not have produced a manifest.
	process.exit( 0 );
}

const guard = "if ( ! defined( 'ABSPATH' ) ) {\n\texit; // Exit if accessed directly.\n}\n";
let contents = fs.readFileSync( manifestPath, 'utf8' );

if ( contents.includes( "defined( 'ABSPATH' )" ) ) {
	// Already hardened.
	process.exit( 0 );
}

// Insert the guard right after the opening "<?php" tag (and any trailing newline).
contents = contents.replace( /^<\?php\s*\n?/, ( match ) => match + guard );

fs.writeFileSync( manifestPath, contents );
console.log( 'Hardened build/blocks-manifest.php with ABSPATH guard.' );
