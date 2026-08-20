<?php
/**
 * Legacy block-name rewrite — pure helper.
 *
 * The plugin was renamed from "Blocks for Leaflet Map" (slug
 * `blocks-for-leaflet-map`) to "CartoBlocks for Leaflet" in v1.2.1, which
 * also renamed the block itself from `blocks-for-leaflet-map/leaflet-map-block`
 * to `cartoblocks-for-leaflet/leaflet-map-block`. No backward-compatible
 * alias was ever registered, so any post_content saved before that rename
 * still contains the old block name and can no longer be resolved by
 * WordPress core's block parser (shows as an "unsupported block" in the
 * editor).
 *
 * Pure helper: takes raw post_content and returns it with the old block name
 * rewritten. Performs **no** database access, no hook registration — those
 * concerns belong to the orchestrator in cartoblocks-for-leaflet.php
 * (bflm_migrate_legacy_block_names_maybe()).
 *
 * @package BlocksForLeafletMap
 */

defined( 'ABSPATH' ) || exit;

/**
 * Rewrite the old block name to the current one inside serialized block markup.
 *
 * Matches only the literal `wp:` / `/wp:` block-comment delimiter followed by
 * the old namespace, so plain-text mentions of the old slug elsewhere in post
 * content are left untouched.
 *
 * @param string $content Raw post_content.
 * @return string Rewritten post_content (unchanged if no match).
 */
function bflm_rewrite_legacy_block_markup( string $content ): string {
	return (string) preg_replace(
		'#(<!--\s*/?wp:)blocks-for-leaflet-map(/leaflet-map-block\b)#',
		'$1cartoblocks-for-leaflet$2',
		$content
	);
}
