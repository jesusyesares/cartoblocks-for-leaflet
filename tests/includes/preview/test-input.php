<?php
/**
 * Characterization tests for includes/preview/input.php.
 *
 * These tests document the CURRENT behaviour of
 * bflm_preview_normalise_input() and bflm_preview_decode_json_collection().
 * They exist to lock in behaviour ahead of refactors, not to assert what the
 * "correct" behaviour should be — see CLAUDE.md notes on
 * includes/preview/input.php being the sole sanitisation boundary between
 * the preview AJAX endpoint's $_GET and the shared bflm_build_*_shortcodes()
 * builders.
 *
 * @package BlocksForLeafletMap
 */

use PHPUnit\Framework\TestCase;

/**
 * Tests for bflm_preview_normalise_input() and bflm_preview_decode_json_collection().
 */
class Test_Preview_Input extends TestCase {

	/**
	 * Case 1: an empty $_GET array yields the documented defaults for every key.
	 */
	public function test_empty_get_yields_defaults(): void {
		$attrs = bflm_preview_normalise_input( array() );

		$this->assertSame( 0.0, $attrs['lat'] );
		$this->assertSame( 0.0, $attrs['lng'] );
		$this->assertSame( 12, $attrs['zoom'] );

		$this->assertSame( '400px', $attrs['height'] );
		$this->assertSame( '100%', $attrs['width'] );

		$this->assertFalse( $attrs['scrollWheelZoom'] );
		$this->assertTrue( $attrs['zoomControl'] );
		$this->assertFalse( $attrs['fitMarkers'] );
		$this->assertFalse( $attrs['showScale'] );

		$this->assertSame( '', $attrs['attribution'] );
		$this->assertSame( '', $attrs['blockId'] );

		$this->assertSame( array(), $attrs['markers'] );
		$this->assertSame( array(), $attrs['lines'] );
		$this->assertSame( array(), $attrs['circles'] );
		$this->assertSame( array(), $attrs['layers'] );
		$this->assertSame( array(), $attrs['overlays'] );

		$this->assertFalse( $attrs['imageMap'] );
		$this->assertSame( '', $attrs['imageSrc'] );
		$this->assertSame( 0.0, $attrs['imageX'] );
		$this->assertSame( 0.0, $attrs['imageY'] );
		$this->assertSame( 0.0, $attrs['imageZoom'] );

		$this->assertFalse( $attrs['wmsEnabled'] );
		$this->assertSame( '', $attrs['wmsSource'] );
		$this->assertSame( '', $attrs['wmsLayer'] );
		$this->assertSame( '', $attrs['wmsCrs'] );

		foreach ( array( 'dragging', 'keyboard', 'doubleClickZoom', 'boxZoom', 'closePopupOnClick', 'tap', 'inertia' ) as $key ) {
			$this->assertSame( '', $attrs[ $key ], "Interaction attr {$key} should default to ''" );
		}

		$this->assertSame( '', $attrs['minZoom'] );
		$this->assertSame( '', $attrs['maxZoom'] );
		$this->assertSame( '', $attrs['maxBounds'] );

		foreach ( array( 'tileurl', 'tilesize', 'subdomains', 'mapid', 'accesstoken', 'zoomoffset', 'nowrap', 'detectretina' ) as $key ) {
			$this->assertSame( '', $attrs[ $key ], "Tile-layer attr {$key} should default to ''" );
		}
	}

	/**
	 * Case 2: lat/lng numeric strings are coerced to floats, zoom to absint.
	 */
	public function test_numeric_coercion_for_lat_lng_zoom(): void {
		$attrs = bflm_preview_normalise_input(
			array(
				'lat'  => '45.5',
				'lng'  => '-122.3',
				'zoom' => '5',
			)
		);

		$this->assertSame( 45.5, $attrs['lat'] );
		$this->assertSame( -122.3, $attrs['lng'] );
		$this->assertSame( 5, $attrs['zoom'] );
	}

	/**
	 * Case 2b: zoom as a negative numeric string goes through absint().
	 *
	 * PHP's (int) cast on '-3' is -3; absint() (abs(intval()))) then turns
	 * that into 3. This is WordPress core's documented absint() behaviour,
	 * not a quirk of the shim.
	 */
	public function test_zoom_negative_string_is_absint_to_positive(): void {
		$attrs = bflm_preview_normalise_input( array( 'zoom' => '-3' ) );

		$this->assertSame( 3, $attrs['zoom'] );
	}

	/**
	 * Case 3: zoom defaults to 12 (not 0) when absent — the one simple scalar
	 * with a non-empty/non-zero default.
	 */
	public function test_zoom_defaults_to_twelve_when_absent(): void {
		$attrs = bflm_preview_normalise_input( array() );

		$this->assertSame( 12, $attrs['zoom'] );
	}

	/**
	 * Case 4: scrollWheelZoom / fitMarkers / showScale only become `true` for
	 * the literal string 'true'. Any other value — including the int 1,
	 * the string '1', or 'TRUE' — yields `false`.
	 *
	 * @dataProvider provide_strict_true_string_booleans
	 *
	 * @param mixed $value    Raw $_GET value (or omitted via null).
	 * @param bool  $expected Expected normalised boolean.
	 */
	public function test_strict_true_string_boolean_flags( $value, bool $expected ): void {
		foreach ( array( 'scrollWheelZoom', 'fitMarkers', 'showScale' ) as $key ) {
			$get = null === $value ? array() : array( $key => $value );

			$attrs = bflm_preview_normalise_input( $get );

			$this->assertSame( $expected, $attrs[ $key ], "Key {$key} with value " . var_export( $value, true ) );
		}
	}

	/**
	 * Data provider for test_strict_true_string_boolean_flags().
	 *
	 * @return array<string,array{0:mixed,1:bool}>
	 */
	public static function provide_strict_true_string_booleans(): array {
		return array(
			"'true' string => true"   => array( 'true', true ),
			"'false' string => false" => array( 'false', false ),
			"'1' string => false"     => array( '1', false ),
			'int 1 => false'          => array( 1, false ),
			"empty string => false"   => array( '', false ),
			'absent => false'         => array( null, false ),
		);
	}

	/**
	 * Case 5: zoomControl defaults to TRUE and is the only boolean inverted
	 * this way — only the literal string 'false' flips it to false.
	 */
	public function test_zoom_control_defaults_to_true_when_absent(): void {
		$attrs = bflm_preview_normalise_input( array() );

		$this->assertTrue( $attrs['zoomControl'] );
	}

	/**
	 * Case 5b: the literal string 'false' is the only value that disables
	 * zoomControl.
	 */
	public function test_zoom_control_false_string_disables_it(): void {
		$attrs = bflm_preview_normalise_input( array( 'zoomControl' => 'false' ) );

		$this->assertFalse( $attrs['zoomControl'] );
	}

	/**
	 * Case 5c: the literal string 'true' does not match the 'false' check,
	 * so zoomControl stays true — same end result as "absent", but via a
	 * different branch of the ternary (the `! ( isset && 'false' === ... )`
	 * condition is false either way it is reached via different operands).
	 */
	public function test_zoom_control_true_string_stays_true(): void {
		$attrs = bflm_preview_normalise_input( array( 'zoomControl' => 'true' ) );

		$this->assertTrue( $attrs['zoomControl'] );
	}

	/**
	 * Case 5d: NOTE — counterintuitive current behaviour. The string '0'
	 * does NOT disable zoomControl, because the source only checks for the
	 * literal string 'false' (`! ( isset( $get['zoomControl'] ) && 'false'
	 * === $get['zoomControl'] )`). '0' !== 'false', so the negation leaves
	 * zoomControl `true`. This is documented here as CURRENT, as-designed
	 * behaviour (per Plan 009's STOP-condition note) — not a bug to fix.
	 */
	public function test_zoom_control_zero_string_is_not_treated_as_false(): void {
		$attrs = bflm_preview_normalise_input( array( 'zoomControl' => '0' ) );

		// NOTE: counterintuitive but current/as-designed — '0' !== 'false'.
		$this->assertTrue( $attrs['zoomControl'] );
	}

	/**
	 * Case 6: attribution passes through wp_kses_post(). Plain text is
	 * unchanged, an <a href> tag is preserved (per the bootstrap's
	 * wp_kses_post shim), and a <script> payload is stripped to ''.
	 */
	public function test_attribution_plain_text_passes_through(): void {
		$attrs = bflm_preview_normalise_input( array( 'attribution' => '© OpenStreetMap' ) );

		$this->assertSame( '© OpenStreetMap', $attrs['attribution'] );
	}

	/**
	 * Case 6b: an <a href="..."> tag is preserved by the wp_kses_post() shim.
	 */
	public function test_attribution_anchor_tag_is_preserved(): void {
		$attrs = bflm_preview_normalise_input( array( 'attribution' => '<a href="https://openstreetmap.org">OSM</a>' ) );

		$this->assertSame( '<a href="https://openstreetmap.org">OSM</a>', $attrs['attribution'] );
	}

	/**
	 * Case 6c: a <script> payload is stripped entirely (including its
	 * content) by the wp_kses_post()/wp_kses() shims.
	 */
	public function test_attribution_script_tag_is_stripped(): void {
		$attrs = bflm_preview_normalise_input( array( 'attribution' => '<script>alert(1)</script>' ) );

		$this->assertSame( '', $attrs['attribution'] );
	}

	/**
	 * Case 6d: attribution defaults to '' when absent.
	 */
	public function test_attribution_defaults_to_empty_string_when_absent(): void {
		$attrs = bflm_preview_normalise_input( array() );

		$this->assertSame( '', $attrs['attribution'] );
	}

	/**
	 * Case 7: blockId passes through sanitize_text_field(); a normal string
	 * is unchanged, whitespace/newlines are collapsed, and it defaults to ''
	 * when absent.
	 */
	public function test_block_id_normal_string_passes_through(): void {
		$attrs = bflm_preview_normalise_input( array( 'blockId' => 'block-123' ) );

		$this->assertSame( 'block-123', $attrs['blockId'] );
	}

	/**
	 * Case 7b: whitespace/newlines in blockId are collapsed to single spaces
	 * and trimmed, per the sanitize_text_field() shim.
	 */
	public function test_block_id_whitespace_is_collapsed(): void {
		$attrs = bflm_preview_normalise_input( array( 'blockId' => "  hello\nworld  " ) );

		$this->assertSame( 'hello world', $attrs['blockId'] );
	}

	/**
	 * Case 7c: blockId defaults to '' when absent.
	 */
	public function test_block_id_defaults_to_empty_string_when_absent(): void {
		$attrs = bflm_preview_normalise_input( array() );

		$this->assertSame( '', $attrs['blockId'] );
	}

	/**
	 * Case 8: when imageMap is NOT the literal string 'true', the image-*
	 * fields are forced to '' / 0.0 regardless of whether imageSrc/imageX/
	 * imageY/imageZoom keys are present in $_GET.
	 */
	public function test_image_map_fields_ignored_when_image_map_not_enabled(): void {
		$attrs = bflm_preview_normalise_input(
			array(
				'imageSrc'  => 'foo.jpg',
				'imageX'    => '10',
				'imageY'    => '20',
				'imageZoom' => '2',
			)
		);

		$this->assertFalse( $attrs['imageMap'] );
		$this->assertSame( '', $attrs['imageSrc'] );
		$this->assertSame( 0.0, $attrs['imageX'] );
		$this->assertSame( 0.0, $attrs['imageY'] );
		$this->assertSame( 0.0, $attrs['imageZoom'] );
	}

	/**
	 * Case 8b: when imageMap === 'true', the image-* fields ARE populated
	 * from $_GET (imageSrc is trimmed via sanitize_text_field(), the
	 * coordinates are cast to float).
	 */
	public function test_image_map_fields_populated_when_image_map_enabled(): void {
		$attrs = bflm_preview_normalise_input(
			array(
				'imageMap'  => 'true',
				'imageSrc'  => 'foo.jpg',
				'imageX'    => '10',
				'imageY'    => '20',
				'imageZoom' => '2',
			)
		);

		$this->assertTrue( $attrs['imageMap'] );
		$this->assertSame( 'foo.jpg', $attrs['imageSrc'] );
		$this->assertSame( 10.0, $attrs['imageX'] );
		$this->assertSame( 20.0, $attrs['imageY'] );
		$this->assertSame( 2.0, $attrs['imageZoom'] );
	}

	/**
	 * Case 9: wmsEnabled is mutually exclusive with imageMap — when both
	 * imageMap and wmsEnabled are 'true', wmsEnabled is forced to false and
	 * the WMS fields stay ''.
	 */
	public function test_wms_enabled_is_disabled_when_image_map_is_enabled(): void {
		$attrs = bflm_preview_normalise_input(
			array(
				'imageMap'   => 'true',
				'wmsEnabled' => 'true',
				'wmsSource'  => 'my-wms-source',
				'wmsLayer'   => 'my-layer',
				'wmsCrs'     => 'EPSG:4326',
			)
		);

		$this->assertTrue( $attrs['imageMap'] );
		$this->assertFalse( $attrs['wmsEnabled'] );
		$this->assertSame( '', $attrs['wmsSource'] );
		$this->assertSame( '', $attrs['wmsLayer'] );
		$this->assertSame( '', $attrs['wmsCrs'] );
	}

	/**
	 * Case 9b: when imageMap is absent/false and wmsEnabled === 'true', the
	 * WMS fields populate from $_GET (trimmed via sanitize_text_field()).
	 */
	public function test_wms_enabled_populates_fields_when_image_map_disabled(): void {
		$attrs = bflm_preview_normalise_input(
			array(
				'wmsEnabled' => 'true',
				'wmsSource'  => 'my-wms-source',
				'wmsLayer'   => 'my-layer',
				'wmsCrs'     => 'EPSG:4326',
			)
		);

		$this->assertFalse( $attrs['imageMap'] );
		$this->assertTrue( $attrs['wmsEnabled'] );
		$this->assertSame( 'my-wms-source', $attrs['wmsSource'] );
		$this->assertSame( 'my-layer', $attrs['wmsLayer'] );
		$this->assertSame( 'EPSG:4326', $attrs['wmsCrs'] );
	}

	/**
	 * Case 10: each of the 7 interaction attrs passes through the strict
	 * 'true'/'false' whitelist — any other value (including absent) becomes
	 * '' (empty string, NOT boolean false).
	 *
	 * @dataProvider provide_interaction_attr_values
	 *
	 * @param mixed  $value    Raw $_GET value (or null for "absent").
	 * @param string $expected Expected normalised string.
	 */
	public function test_interaction_attrs_strict_true_false_whitelist( $value, string $expected ): void {
		foreach ( array( 'dragging', 'keyboard', 'doubleClickZoom', 'boxZoom', 'closePopupOnClick', 'tap', 'inertia' ) as $key ) {
			$get = null === $value ? array() : array( $key => $value );

			$attrs = bflm_preview_normalise_input( $get );

			$this->assertSame( $expected, $attrs[ $key ], "Key {$key} with value " . var_export( $value, true ) );
			$this->assertIsString( $attrs[ $key ], "Key {$key} must be a string, not a boolean" );
		}
	}

	/**
	 * Data provider for test_interaction_attrs_strict_true_false_whitelist().
	 *
	 * @return array<string,array{0:mixed,1:string}>
	 */
	public static function provide_interaction_attr_values(): array {
		return array(
			"'true' => 'true'"     => array( 'true', 'true' ),
			"'false' => 'false'"   => array( 'false', 'false' ),
			"'yes' => ''"          => array( 'yes', '' ),
			"'1' => ''"            => array( '1', '' ),
			"'' => ''"             => array( '', '' ),
			"'garbage' => ''"      => array( 'garbage', '' ),
			'absent => ""'         => array( null, '' ),
		);
	}

	/**
	 * Case 11: the pass-through string fields (minZoom, maxZoom, maxBounds,
	 * tileurl, tilesize, subdomains, mapid, accesstoken, zoomoffset, nowrap,
	 * detectretina) each apply sanitize_text_field( wp_unslash( ... ) ) when
	 * present (trimming surrounding whitespace) and default to '' when
	 * absent.
	 *
	 * @dataProvider provide_pass_through_string_fields
	 *
	 * @param string $key Attribute key under test.
	 */
	public function test_pass_through_string_field_trims_whitespace_when_present( string $key ): void {
		$attrs = bflm_preview_normalise_input( array( $key => '  256  ' ) );

		$this->assertSame( '256', $attrs[ $key ] );
	}

	/**
	 * @dataProvider provide_pass_through_string_fields
	 *
	 * @param string $key Attribute key under test.
	 */
	public function test_pass_through_string_field_defaults_to_empty_string_when_absent( string $key ): void {
		$attrs = bflm_preview_normalise_input( array() );

		$this->assertSame( '', $attrs[ $key ] );
	}

	/**
	 * Data provider for the pass-through string field tests.
	 *
	 * @return array<string,array{0:string}>
	 */
	public static function provide_pass_through_string_fields(): array {
		return array(
			'minZoom'      => array( 'minZoom' ),
			'maxZoom'      => array( 'maxZoom' ),
			'maxBounds'    => array( 'maxBounds' ),
			'tileurl'      => array( 'tileurl' ),
			'tilesize'     => array( 'tilesize' ),
			'subdomains'   => array( 'subdomains' ),
			'mapid'        => array( 'mapid' ),
			'accesstoken'  => array( 'accesstoken' ),
			'zoomoffset'   => array( 'zoomoffset' ),
			'nowrap'       => array( 'nowrap' ),
			'detectretina' => array( 'detectretina' ),
		);
	}

	/**
	 * Case 12: height passes through bflm_normalise_dimension(). A valid CSS
	 * dimension (e.g. '500px') passes through unchanged (verified by reading
	 * bflm_normalise_dimension() in includes/shortcodes/attrs.php: '500px'
	 * matches the /^\d+(\.\d+)?(px|%|vh|vw|em|rem)$/ pattern, does not end in
	 * '%', so it's returned as-is).
	 */
	public function test_height_valid_dimension_passes_through(): void {
		$attrs = bflm_preview_normalise_input( array( 'height' => '500px' ) );

		$this->assertSame( '500px', $attrs['height'] );
	}

	/**
	 * Case 12b: height defaults to '400px' when absent. The default
	 * '400px' is itself passed through bflm_normalise_dimension( '400px',
	 * '400px' ), which returns '400px' unchanged (it matches the dimension
	 * pattern and does not end in '%').
	 */
	public function test_height_defaults_to_400px_when_absent(): void {
		$attrs = bflm_preview_normalise_input( array() );

		$this->assertSame( '400px', $attrs['height'] );
	}

	/**
	 * Case 12c: an invalid height value falls back to '400px' via
	 * bflm_normalise_dimension()'s $fallback parameter (e.g. 'not-a-dimension'
	 * does not match the dimension regex).
	 */
	public function test_height_invalid_dimension_falls_back_to_400px(): void {
		$attrs = bflm_preview_normalise_input( array( 'height' => 'not-a-dimension' ) );

		$this->assertSame( '400px', $attrs['height'] );
	}

	/**
	 * Case 12d: a percentage height above 100% is clamped to '100%' by
	 * bflm_normalise_dimension()'s clamping branch
	 * (str_ends_with( $value, '%' ) && (float) $value > 100).
	 */
	public function test_height_percentage_above_100_is_clamped(): void {
		$attrs = bflm_preview_normalise_input( array( 'height' => '150%' ) );

		$this->assertSame( '100%', $attrs['height'] );
	}

	/**
	 * Case 13: width is ALWAYS '100%' — there is no 'width' key read from
	 * $_GET at all in bflm_preview_normalise_input(), so any 'width' value
	 * in $_GET is simply ignored.
	 */
	public function test_width_is_always_100_percent_regardless_of_get(): void {
		$attrs = bflm_preview_normalise_input( array( 'width' => '50%' ) );

		$this->assertSame( '100%', $attrs['width'] );
	}

	/**
	 * Case 14: bflm_preview_decode_json_collection() returns [] when the key
	 * is absent from $_GET.
	 */
	public function test_decode_json_collection_returns_empty_array_when_key_absent(): void {
		$this->assertSame( array(), bflm_preview_decode_json_collection( array(), 'markers' ) );
	}

	/**
	 * Case 15: a valid JSON array string decodes to the matching PHP array
	 * of associative arrays.
	 */
	public function test_decode_json_collection_decodes_valid_json_array(): void {
		$get = array( 'markers' => '[{"lat":1,"lng":2},{"lat":3,"lng":4}]' );

		$decoded = bflm_preview_decode_json_collection( $get, 'markers' );

		$this->assertSame(
			array(
				array(
					'lat' => 1,
					'lng' => 2,
				),
				array(
					'lat' => 3,
					'lng' => 4,
				),
			),
			$decoded
		);
	}

	/**
	 * Case 16: valid JSON that decodes to a non-array at the top level (a
	 * string, a number, or null) falls back to [].
	 *
	 * @dataProvider provide_non_array_json_values
	 *
	 * @param string $json Raw JSON string.
	 */
	public function test_decode_json_collection_returns_empty_array_for_non_array_json( string $json ): void {
		$decoded = bflm_preview_decode_json_collection( array( 'markers' => $json ), 'markers' );

		$this->assertSame( array(), $decoded );
	}

	/**
	 * Data provider for test_decode_json_collection_returns_empty_array_for_non_array_json().
	 *
	 * @return array<string,array{0:string}>
	 */
	public static function provide_non_array_json_values(): array {
		return array(
			'a JSON string'  => array( '"just a string"' ),
			'a JSON number'  => array( '42' ),
			'JSON null'      => array( 'null' ),
		);
	}

	/**
	 * Case 17: malformed JSON (json_decode returns null with an error) falls
	 * back to [].
	 */
	public function test_decode_json_collection_returns_empty_array_for_malformed_json(): void {
		$decoded = bflm_preview_decode_json_collection( array( 'markers' => '{not valid json' ), 'markers' );

		$this->assertSame( array(), $decoded );
	}

	/**
	 * Case 18: slashed JSON input (as WordPress's superglobal-slashing would
	 * produce, with literal backslashes before inner quotes) is unslashed by
	 * wp_unslash() BEFORE json_decode(), so it decodes successfully. This
	 * documents WHY wp_unslash() is called before json_decode() in
	 * bflm_preview_decode_json_collection().
	 */
	public function test_decode_json_collection_unslashes_before_decoding(): void {
		// Literal backslashes before the inner double-quotes, as produced by
		// WordPress's wp_magic_quotes() on superglobals.
		$slashed = '[{\\"lat\\":1}]';

		$decoded = bflm_preview_decode_json_collection( array( 'markers' => $slashed ), 'markers' );

		$this->assertSame( array( array( 'lat' => 1 ) ), $decoded );
	}
}
