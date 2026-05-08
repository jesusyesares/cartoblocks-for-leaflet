<?php
/**
 * Allow GeoJSON / GPX / KML / KMZ files in the WordPress Media Library.
 *
 * WordPress strips these MIME types from the default allowlist. Without these
 * filters the files upload successfully but are served as 404 by the web server
 * because WordPress marks them as invalid and does not write them to the
 * uploads directory.
 *
 * @package BlocksForLeafletMap
 */

defined( 'ABSPATH' ) || exit;

/**
 * Map the four data-layer extensions to their canonical MIME types.
 *
 * @param array<string,string> $mimes Existing extension → MIME map.
 * @return array<string,string>
 */
function bflm_allow_data_layer_mimes( array $mimes ): array {
	$mimes['geojson'] = 'application/geo+json';
	$mimes['gpx']     = 'application/gpx+xml';
	$mimes['kml']     = 'application/vnd.google-earth.kml+xml';
	$mimes['kmz']     = 'application/vnd.google-earth.kmz';
	return $mimes;
}
add_filter( 'upload_mimes', 'bflm_allow_data_layer_mimes' );

/**
 * Bypass the real-file-type check for GeoJSON / GPX / KML uploads.
 *
 * `wp_check_filetype_and_ext()` uses finfo / mime_content_type to inspect the
 * actual file bytes. These text-XML formats are often identified as text/plain
 * or application/xml, which does not match the registered MIME type and causes
 * WordPress to reject the upload. We trust the file extension alone for these
 * known-safe, editor-only types.
 *
 * @param array<string,string|bool> $checked   Array with keys: ext, type, proper_filename.
 * @param string                    $file      Full path to the file.
 * @param string                    $filename  The name of the file.
 * @param array<string,string>|null $mimes     Allowed MIME types (unused; extension checked directly).
 * @param string|false              $real_mime The real MIME type detected (unused).
 * @return array<string,string|bool>
 */
function bflm_fix_data_layer_filetype( array $checked, string $file, string $filename, ?array $mimes, $real_mime ): array { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter -- $file, $mimes, $real_mime required by filter signature.
	$ext     = strtolower( pathinfo( $filename, PATHINFO_EXTENSION ) );
	$allowed = array(
		'geojson' => 'application/geo+json',
		'gpx'     => 'application/gpx+xml',
		'kml'     => 'application/vnd.google-earth.kml+xml',
		'kmz'     => 'application/vnd.google-earth.kmz',
	);
	if ( isset( $allowed[ $ext ] ) ) {
		$checked['ext']  = $ext;
		$checked['type'] = $allowed[ $ext ];
	}
	return $checked;
}
add_filter( 'wp_check_filetype_and_ext', 'bflm_fix_data_layer_filetype', 10, 5 );
