<?php
/**
 * Tests for includes/migrations.php.
 *
 * @package BlocksForLeafletMap
 */

use PHPUnit\Framework\TestCase;

/**
 * Tests for bflm_rewrite_legacy_block_markup().
 */
class Test_Migrations extends TestCase {

	/**
	 * Case 1: a self-closing old-name block (this block has no save(), so its
	 * real-world serialized form is always self-closing) is rewritten.
	 */
	public function test_self_closing_block_is_rewritten(): void {
		$content = '<!-- wp:blocks-for-leaflet-map/leaflet-map-block {"lat":37.5,"lng":-3.6} /-->';

		$expected = '<!-- wp:cartoblocks-for-leaflet/leaflet-map-block {"lat":37.5,"lng":-3.6} /-->';

		$this->assertSame( $expected, bflm_rewrite_legacy_block_markup( $content ) );
	}

	/**
	 * Case 2: a paired opening/closing old-name block is rewritten on both delimiters.
	 */
	public function test_paired_open_close_block_is_rewritten(): void {
		$content = '<!-- wp:blocks-for-leaflet-map/leaflet-map-block {"lat":1} -->'
			. 'inner content'
			. '<!-- /wp:blocks-for-leaflet-map/leaflet-map-block -->';

		$expected = '<!-- wp:cartoblocks-for-leaflet/leaflet-map-block {"lat":1} -->'
			. 'inner content'
			. '<!-- /wp:cartoblocks-for-leaflet/leaflet-map-block -->';

		$this->assertSame( $expected, bflm_rewrite_legacy_block_markup( $content ) );
	}

	/**
	 * Case 3: multiple old blocks in the same post_content are all rewritten.
	 */
	public function test_multiple_old_blocks_all_rewritten(): void {
		$content = '<!-- wp:blocks-for-leaflet-map/leaflet-map-block {"lat":1} /-->'
			. '<!-- wp:paragraph --><p>text</p><!-- /wp:paragraph -->'
			. '<!-- wp:blocks-for-leaflet-map/leaflet-map-block {"lat":2} /-->';

		$result = bflm_rewrite_legacy_block_markup( $content );

		$this->assertSame( 2, substr_count( $result, 'wp:cartoblocks-for-leaflet/leaflet-map-block' ) );
		$this->assertStringNotContainsString( 'blocks-for-leaflet-map', $result );
	}

	/**
	 * Case 4: a post edited after the rename contains both an old block (from
	 * before 1.2.1) and a new one (added after) — only the old one changes.
	 */
	public function test_mixed_old_and_new_blocks_only_old_one_changes(): void {
		$content = '<!-- wp:blocks-for-leaflet-map/leaflet-map-block {"lat":1} /-->'
			. '<!-- wp:cartoblocks-for-leaflet/leaflet-map-block {"lat":2} /-->';

		$expected = '<!-- wp:cartoblocks-for-leaflet/leaflet-map-block {"lat":1} /-->'
			. '<!-- wp:cartoblocks-for-leaflet/leaflet-map-block {"lat":2} /-->';

		$this->assertSame( $expected, bflm_rewrite_legacy_block_markup( $content ) );
	}

	/**
	 * Case 5: content with no old blocks is returned byte-identical.
	 */
	public function test_content_without_old_blocks_is_unchanged(): void {
		$content = '<!-- wp:paragraph --><p>Nothing to see here.</p><!-- /wp:paragraph -->';

		$this->assertSame( $content, bflm_rewrite_legacy_block_markup( $content ) );
	}

	/**
	 * Case 6: false-positive guard — the old slug appearing as plain visible
	 * text (not as a block-comment delimiter) must NOT be rewritten.
	 */
	public function test_plain_text_mention_of_old_slug_is_not_rewritten(): void {
		$content = '<!-- wp:paragraph --><p>Migrated from blocks-for-leaflet-map/leaflet-map-block.</p><!-- /wp:paragraph -->';

		$this->assertSame( $content, bflm_rewrite_legacy_block_markup( $content ) );
	}

	/**
	 * Case 7: empty string input is handled without error.
	 */
	public function test_empty_string_is_unchanged(): void {
		$this->assertSame( '', bflm_rewrite_legacy_block_markup( '' ) );
	}
}
