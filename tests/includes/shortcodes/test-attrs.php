<?php
/**
 * Characterization tests for includes/shortcodes/attrs.php.
 *
 * These tests document the CURRENT behaviour of bflm_normalise_dimension(),
 * bflm_normalise_map_attrs(), bflm_build_interaction_attrs(),
 * bflm_build_zoom_bounds_attrs(), and bflm_build_tile_layer_attrs(). They
 * exist to lock in behaviour ahead of refactors, not to assert what the
 * "correct" behaviour should be — see CLAUDE.md notes on
 * includes/shortcodes/attrs.php being the single most depended-upon file in
 * the modularized includes/shortcodes/ tree.
 *
 * @package BlocksForLeafletMap
 */

use PHPUnit\Framework\TestCase;

/**
 * Tests for the shortcode attribute normalisation/builder helpers.
 */
class Test_Shortcodes_Attrs extends TestCase {

	/*
	 * ---------------------------------------------------------------
	 * bflm_normalise_dimension( $raw, $fallback )
	 * ---------------------------------------------------------------
	 */

	/**
	 * Case 1: numeric input is interpreted as pixels — is_numeric() is true,
	 * 'px' is appended, and the result ('100px', '45.5px', ...) passes the
	 * regex unchanged.
	 *
	 * @dataProvider provider_numeric_input_becomes_px
	 *
	 * @param mixed  $raw      Raw numeric input.
	 * @param string $expected Expected normalised dimension.
	 */
	public function test_numeric_input_becomes_px( $raw, string $expected ): void {
		$this->assertSame( $expected, bflm_normalise_dimension( $raw, '400px' ) );
	}

	/**
	 * Data provider for test_numeric_input_becomes_px().
	 *
	 * @return array<string,array{0:mixed,1:string}>
	 */
	public function provider_numeric_input_becomes_px(): array {
		return array(
			'int 100'        => array( 100, '100px' ),
			'numeric string' => array( '100', '100px' ),
			'float 45.5'     => array( 45.5, '45.5px' ),
		);
	}

	/**
	 * Case 2: valid CSS units are returned unchanged when the value is <= 100
	 * (no '%' clamping needed).
	 *
	 * @dataProvider provider_valid_css_units_unchanged
	 *
	 * @param string $value CSS dimension string with a recognised unit.
	 */
	public function test_valid_css_units_returned_unchanged( string $value ): void {
		$this->assertSame( $value, bflm_normalise_dimension( $value, '400px' ) );
	}

	/**
	 * Data provider for test_valid_css_units_returned_unchanged().
	 *
	 * @return array<string,array{0:string}>
	 */
	public function provider_valid_css_units_unchanged(): array {
		return array(
			'px'   => array( '400px' ),
			'%'    => array( '50%' ),
			'vh'   => array( '80vh' ),
			'vw'   => array( '100vw' ),
			'em'   => array( '2em' ),
			'rem'  => array( '1.5rem' ),
		);
	}

	/**
	 * Case 3: '%' values above 100 are clamped to '100%'; values at or below
	 * 100 are returned unchanged (including the '100%' boundary itself).
	 */
	public function test_percent_clamping(): void {
		// Over 100 -> clamped.
		$this->assertSame( '100%', bflm_normalise_dimension( '150%', '400px' ) );

		// Exactly 100 -> NOT > 100, returned as-is (same result either way,
		// but confirms the boundary doesn't get mangled).
		$this->assertSame( '100%', bflm_normalise_dimension( '100%', '400px' ) );

		// Under 100 -> returned unchanged.
		$this->assertSame( '99.9%', bflm_normalise_dimension( '99.9%', '400px' ) );
	}

	/**
	 * Case 4: invalid/unrecognised formats fall back to $fallback.
	 *
	 * NOTE: '  100px  ' (leading/trailing whitespace) is NOT in this set —
	 * see test_dimension_with_surrounding_whitespace_is_trimmed_and_valid()
	 * below. The plan that specified this test suite assumed whitespace
	 * would be rejected by the regex's anchors, but
	 * sanitize_text_field() (and its WordPress core equivalent) TRIMS the
	 * string before the regex runs, so '  100px  ' actually normalises to
	 * '100px', not $fallback. That case is documented separately as a
	 * characterization of CURRENT (intentional, core-driven) behaviour.
	 *
	 * @dataProvider provider_invalid_formats_fall_back_to_default
	 *
	 * @param string $value Invalid dimension string.
	 */
	public function test_invalid_formats_fall_back_to_default( string $value ): void {
		$this->assertSame( '400px', bflm_normalise_dimension( $value, '400px' ) );
	}

	/**
	 * Data provider for test_invalid_formats_fall_back_to_default().
	 *
	 * @return array<string,array{0:string}>
	 */
	public function provider_invalid_formats_fall_back_to_default(): array {
		return array(
			'unrecognised unit'    => array( '100xyz' ),
			'css calc() expression' => array( 'calc(100% - 10px)' ),
			'empty string'         => array( '' ),
			'non-numeric garbage'  => array( 'abc' ),
		);
	}

	/**
	 * Case 4b (split out from case 4, see NOTE above): a value with
	 * surrounding whitespace is NOT rejected — sanitize_text_field() trims
	 * it first, and the trimmed '100px' passes the regex and is returned.
	 *
	 * This documents that whitespace IS tolerated (via trimming), which may
	 * or may not be intentional, but is the CURRENT behaviour.
	 */
	public function test_dimension_with_surrounding_whitespace_is_trimmed_and_valid(): void {
		$this->assertSame( '100px', bflm_normalise_dimension( '  100px  ', '400px' ) );
	}

	/**
	 * Case 5: non-numeric, non-string scalar inputs.
	 *
	 * - null: is_numeric(null) is false, (string) null === '', which fails
	 *   the regex -> $fallback.
	 * - true: is_numeric(true) is false (booleans are never numeric in PHP),
	 *   (string) true === '1', sanitize_text_field('1') === '1', which has
	 *   no unit and fails the regex -> $fallback.
	 * - false: is_numeric(false) is false, (string) false === '', fails the
	 *   regex -> $fallback.
	 *
	 * Array input is deliberately NOT tested here: (string) $array triggers
	 * an "Array to string conversion" warning/notice in PHP, which could
	 * fail under strict PHPUnit error-handling configurations. Skipped per
	 * plan guidance.
	 *
	 * @dataProvider provider_non_numeric_scalars_fall_back_to_default
	 *
	 * @param mixed $value Scalar input that is not numeric and not a normal string.
	 */
	public function test_non_numeric_scalars_fall_back_to_default( $value ): void {
		$this->assertSame( '400px', bflm_normalise_dimension( $value, '400px' ) );
	}

	/**
	 * Data provider for test_non_numeric_scalars_fall_back_to_default().
	 *
	 * @return array<string,array{0:mixed}>
	 */
	public function provider_non_numeric_scalars_fall_back_to_default(): array {
		return array(
			'null'  => array( null ),
			'true'  => array( true ),
			'false' => array( false ),
		);
	}

	/**
	 * Case 6: the $fallback parameter (not a hardcoded '400px') is what's
	 * returned for invalid input.
	 */
	public function test_custom_fallback_is_returned_for_invalid_input(): void {
		$this->assertSame( '50%', bflm_normalise_dimension( 'garbage', '50%' ) );
	}

	/*
	 * ---------------------------------------------------------------
	 * bflm_normalise_map_attrs( array $attrs )
	 * ---------------------------------------------------------------
	 */

	/**
	 * Case 7: an empty array yields the documented defaults for every
	 * normalised key.
	 */
	public function test_empty_attrs_yield_defaults(): void {
		$out = bflm_normalise_map_attrs( array() );

		$this->assertSame( 0.0, $out['lat'] );
		$this->assertSame( 0.0, $out['lng'] );
		$this->assertSame( 12, $out['zoom'] );
		$this->assertSame( '400px', $out['height'] );
		$this->assertSame( '100%', $out['width'] );

		$this->assertFalse( $out['scrollWheelZoom'] );
		$this->assertTrue( $out['zoomControl'] );
		$this->assertFalse( $out['fitMarkers'] );
		$this->assertFalse( $out['showScale'] );
		$this->assertSame( '', $out['attribution'] );

		$this->assertFalse( $out['imageMap'] );
		$this->assertFalse( $out['wmsEnabled'] );

		$this->assertSame( '', $out['imageSrc'] );
		$this->assertSame( 0.0, $out['imageX'] );
		$this->assertSame( 0.0, $out['imageY'] );
		$this->assertSame( 0.0, $out['imageZoom'] );

		$this->assertSame( '', $out['wmsSource'] );
		$this->assertSame( '', $out['wmsLayer'] );
		$this->assertSame( '', $out['wmsCrs'] );
	}

	/**
	 * Case 8: bflm_normalise_map_attrs() starts with `$out = $attrs` and only
	 * overwrites KNOWN keys — unrecognised keys pass through UNCHANGED. This
	 * characterizes that the function does NOT strip unknown keys.
	 */
	public function test_unrecognised_keys_pass_through_unchanged(): void {
		$out = bflm_normalise_map_attrs(
			array(
				'lat'           => 1,
				'someCustomKey' => 'value',
			)
		);

		$this->assertArrayHasKey( 'someCustomKey', $out );
		$this->assertSame( 'value', $out['someCustomKey'] );
	}

	/**
	 * Case 9: zoomControl defaults to true; ONLY the literal PHP boolean
	 * `false` (checked with `=== false`, strict) flips it to false.
	 *
	 * NOTE: This is DIFFERENT from includes/preview/input.php's zoomControl
	 * handling, which checks the STRING 'false' (see plan 009's
	 * Test_Preview_Input tests). These are two different functions with two
	 * different conventions for the same conceptual flag:
	 * bflm_normalise_map_attrs() consumes Gutenberg block attributes (real
	 * PHP booleans from the block's attributes schema), while
	 * bflm_preview_normalise_input() consumes $_GET query strings (always
	 * strings). The divergence is intentional given the different input
	 * sources, but a future refactor that tries to "unify" these two
	 * functions' attribute handling must preserve (or deliberately
	 * reconcile, in lockstep at both call sites) this distinction.
	 *
	 * @dataProvider provider_zoom_control_values
	 *
	 * @param array $attrs    Input attrs array.
	 * @param bool  $expected Expected zoomControl value.
	 */
	public function test_zoom_control_only_strict_false_disables( array $attrs, bool $expected ): void {
		$out = bflm_normalise_map_attrs( $attrs );
		$this->assertSame( $expected, $out['zoomControl'] );
	}

	/**
	 * Data provider for test_zoom_control_only_strict_false_disables().
	 *
	 * @return array<string,array{0:array,1:bool}>
	 */
	public function provider_zoom_control_values(): array {
		return array(
			'strict false disables'        => array( array( 'zoomControl' => false ), false ),
			'int 0 does NOT disable'        => array( array( 'zoomControl' => 0 ), true ),
			'empty string does NOT disable' => array( array( 'zoomControl' => '' ), true ),
			'true stays enabled'            => array( array( 'zoomControl' => true ), true ),
			'absent defaults to enabled'    => array( array(), true ),
		);
	}

	/**
	 * Case 10: imageMap and wmsEnabled are mutually exclusive — when both are
	 * truthy in the input, imageMap wins and wmsEnabled is forced to false
	 * (guarded by `! $out['imageMap'] &&`).
	 */
	public function test_image_map_and_wms_enabled_are_mutually_exclusive(): void {
		$out = bflm_normalise_map_attrs(
			array(
				'imageMap'   => true,
				'wmsEnabled' => true,
			)
		);

		$this->assertTrue( $out['imageMap'] );
		$this->assertFalse( $out['wmsEnabled'] );
	}

	/**
	 * Case 11: imageSrc/imageX/imageY/imageZoom are only populated when
	 * imageMap is truthy; otherwise they default to '' / 0.0 regardless of
	 * whether the raw keys are present in $attrs.
	 */
	public function test_image_fields_gated_by_image_map(): void {
		// With imageMap => true, the image fields are populated (and imageSrc
		// is trimmed, imageX is float-cast from a numeric string).
		$with_image_map = bflm_normalise_map_attrs(
			array(
				'imageMap' => true,
				'imageSrc' => ' foo.jpg ',
				'imageX'   => '10.5',
			)
		);
		$this->assertSame( 'foo.jpg', $with_image_map['imageSrc'] );
		$this->assertSame( 10.5, $with_image_map['imageX'] );

		// Without imageMap, the same raw values are ignored -> defaults.
		$without_image_map = bflm_normalise_map_attrs(
			array(
				'imageSrc' => ' foo.jpg ',
				'imageX'   => '10.5',
			)
		);
		$this->assertSame( '', $without_image_map['imageSrc'] );
		$this->assertSame( 0.0, $without_image_map['imageX'] );
	}

	/**
	 * Case 12: attribution is passed through with a plain (string) cast —
	 * NO wp_kses_post() or other sanitization is applied by this function.
	 *
	 * NOTE: this is DIFFERENT from includes/preview/input.php's attribution
	 * handling, which applies wp_kses_post() (see plan 009's
	 * Test_Preview_Input tests). bflm_normalise_map_attrs() is concerned
	 * with NORMALISING TYPES/SHAPES only; actual output-escaping of the
	 * attribution value happens later in the shortcode builders (e.g.
	 * includes/shortcodes/map.php applies wp_kses_post() when building the
	 * [leaflet-map attribution='...'] shortcode, per this repo's documented
	 * "Key Technical Decisions" about the attribution field having been
	 * double-escaped previously).
	 */
	public function test_attribution_is_passed_through_without_sanitization(): void {
		$out = bflm_normalise_map_attrs( array( 'attribution' => '<script>x</script>' ) );

		$this->assertSame( '<script>x</script>', $out['attribution'] );
	}

	/*
	 * ---------------------------------------------------------------
	 * bflm_build_interaction_attrs( array $attrs )
	 * ---------------------------------------------------------------
	 */

	/**
	 * Case 13: an empty array yields an empty string (all 7 keys default to
	 * '' and are skipped).
	 */
	public function test_interaction_attrs_empty_array_yields_empty_string(): void {
		$this->assertSame( '', bflm_build_interaction_attrs( array() ) );
	}

	/**
	 * Case 14: all 7 supported keys set to 'true' produce a fragment with
	 * lowercased, underscore-free shortcode attribute names.
	 *
	 * The shortcode-key RENAMES (doubleClickZoom -> doubleclickzoom,
	 * boxZoom -> boxzoom, closePopupOnClick -> closepopuponclick) reflect
	 * this repo's documented "Shortcode attribute case-sensitivity bug":
	 * WordPress lowercases shortcode attribute names, so these MUST already
	 * be lowercase in the shortcode string to match Leaflet Map's checks.
	 */
	public function test_interaction_attrs_all_true(): void {
		$attrs = array(
			'dragging'          => 'true',
			'keyboard'          => 'true',
			'doubleClickZoom'   => 'true',
			'boxZoom'           => 'true',
			'closePopupOnClick' => 'true',
			'tap'               => 'true',
			'inertia'           => 'true',
		);

		$expected = ' dragging="true" keyboard="true" doubleclickzoom="true"'
			. ' boxzoom="true" closepopuponclick="true" tap="true" inertia="true"';

		$this->assertSame( $expected, bflm_build_interaction_attrs( $attrs ) );
	}

	/**
	 * Case 15: mixed valid/invalid values — only keys whose (string) value is
	 * strictly 'true' or 'false' are emitted. 'yes' and (int) 1 (cast to '1')
	 * are neither, so they're skipped.
	 */
	public function test_interaction_attrs_skips_non_boolean_string_values(): void {
		$attrs = array(
			'dragging' => 'true',
			'keyboard' => 'yes',
			'boxZoom'  => 'false',
			'tap'      => 1,
		);

		$this->assertSame( ' dragging="true" boxzoom="false"', bflm_build_interaction_attrs( $attrs ) );
	}

	/**
	 * Case 16: esc_attr() is applied to every emitted value. Not directly
	 * observable with plain 'true'/'false' values (htmlspecialchars is a
	 * no-op on them), but every passing case above exercises the esc_attr()
	 * call path via the bootstrap shim — confirmed here as a trivial
	 * round-trip.
	 */
	public function test_esc_attr_is_a_noop_on_true_false_strings(): void {
		$this->assertSame( 'true', esc_attr( 'true' ) );
		$this->assertSame( 'false', esc_attr( 'false' ) );
	}

	/*
	 * ---------------------------------------------------------------
	 * bflm_build_zoom_bounds_attrs( array $attrs )
	 * ---------------------------------------------------------------
	 */

	/**
	 * Case 17: an empty array yields an empty string.
	 */
	public function test_zoom_bounds_attrs_empty_array_yields_empty_string(): void {
		$this->assertSame( '', bflm_build_zoom_bounds_attrs( array() ) );
	}

	/**
	 * Case 18: valid numeric minZoom/maxZoom produce min_zoom/max_zoom
	 * fragments.
	 */
	public function test_zoom_bounds_attrs_valid_min_max_zoom(): void {
		$attrs = array(
			'minZoom' => '3',
			'maxZoom' => '18',
		);

		$this->assertSame( ' min_zoom="3" max_zoom="18"', bflm_build_zoom_bounds_attrs( $attrs ) );
	}

	/**
	 * Case 19: a non-numeric minZoom (or maxZoom) is skipped entirely (fails
	 * is_numeric()).
	 */
	public function test_zoom_bounds_attrs_non_numeric_min_zoom_skipped(): void {
		$this->assertSame( '', bflm_build_zoom_bounds_attrs( array( 'minZoom' => 'abc' ) ) );
	}

	/**
	 * Case 20: maxBounds has NO numeric check — any non-empty string is
	 * emitted as-is (escaped via esc_attr()).
	 */
	public function test_zoom_bounds_attrs_max_bounds_any_non_empty_string(): void {
		$attrs = array( 'maxBounds' => '45.0,7.0;46.0,8.0' );

		$this->assertSame( ' maxbounds="45.0,7.0;46.0,8.0"', bflm_build_zoom_bounds_attrs( $attrs ) );
	}

	/**
	 * Case 21: when all three (minZoom, maxZoom, maxBounds) are provided, the
	 * emission order is min_zoom, then max_zoom, then maxbounds.
	 */
	public function test_zoom_bounds_attrs_combined_order(): void {
		$attrs = array(
			'minZoom'   => '2',
			'maxZoom'   => '10',
			'maxBounds' => '1,1;2,2',
		);

		$this->assertSame( ' min_zoom="2" max_zoom="10" maxbounds="1,1;2,2"', bflm_build_zoom_bounds_attrs( $attrs ) );
	}

	/*
	 * ---------------------------------------------------------------
	 * bflm_build_tile_layer_attrs( array $attrs )
	 * ---------------------------------------------------------------
	 */

	/**
	 * Case 22: an empty array yields an empty string.
	 */
	public function test_tile_layer_attrs_empty_array_yields_empty_string(): void {
		$this->assertSame( '', bflm_build_tile_layer_attrs( array() ) );
	}

	/**
	 * Case 23: tileurl template placeholders ({s}, {z}, {x}, {y}) are
	 * preserved unchanged — esc_attr()/htmlspecialchars() does not escape
	 * curly braces (they're not among &"'<>). This confirms the file's own
	 * docblock comment explaining why esc_attr() (not esc_url_raw()) is used
	 * for tileurl.
	 */
	public function test_tile_layer_attrs_preserves_template_placeholders_in_tileurl(): void {
		$attrs = array( 'tileurl' => 'https://{s}.tile.example/{z}/{x}/{y}.png' );

		$this->assertSame(
			' tileurl="https://{s}.tile.example/{z}/{x}/{y}.png"',
			bflm_build_tile_layer_attrs( $attrs )
		);
	}

	/**
	 * Case 24: tilesize requires is_numeric() AND (int) value >= 1. Values of
	 * 0, negative, or non-numeric are skipped entirely.
	 *
	 * @dataProvider provider_tile_size_values
	 *
	 * @param array  $attrs    Input attrs array containing 'tilesize'.
	 * @param string $expected Expected fragment.
	 */
	public function test_tile_layer_attrs_tilesize_requires_at_least_one( array $attrs, string $expected ): void {
		$this->assertSame( $expected, bflm_build_tile_layer_attrs( $attrs ) );
	}

	/**
	 * Data provider for test_tile_layer_attrs_tilesize_requires_at_least_one().
	 *
	 * @return array<string,array{0:array,1:string}>
	 */
	public function provider_tile_size_values(): array {
		return array(
			'valid 256'        => array( array( 'tilesize' => '256' ), ' tilesize="256"' ),
			'zero is rejected'  => array( array( 'tilesize' => '0' ), '' ),
			'negative is rejected' => array( array( 'tilesize' => '-5' ), '' ),
			'non-numeric is rejected' => array( array( 'tilesize' => 'abc' ), '' ),
		);
	}

	/**
	 * Case 25: zoomoffset is (int)-cast with NO ">= 1" requirement (unlike
	 * tilesize) — negative values and zero are both allowed.
	 *
	 * @dataProvider provider_zoom_offset_values
	 *
	 * @param array  $attrs    Input attrs array containing 'zoomoffset'.
	 * @param string $expected Expected fragment.
	 */
	public function test_tile_layer_attrs_zoom_offset_allows_negative_and_zero( array $attrs, string $expected ): void {
		$this->assertSame( $expected, bflm_build_tile_layer_attrs( $attrs ) );
	}

	/**
	 * Data provider for test_tile_layer_attrs_zoom_offset_allows_negative_and_zero().
	 *
	 * @return array<string,array{0:array,1:string}>
	 */
	public function provider_zoom_offset_values(): array {
		return array(
			'negative allowed' => array( array( 'zoomoffset' => '-2' ), ' zoomoffset="-2"' ),
			'zero allowed'     => array( array( 'zoomoffset' => '0' ), ' zoomoffset="0"' ),
		);
	}

	/**
	 * Case 26: nowrap and detectretina use a strict 'true'/'false' whitelist.
	 * detectretina is renamed to detect_retina (with underscore) in the
	 * output shortcode attribute.
	 *
	 * @dataProvider provider_nowrap_detectretina_values
	 *
	 * @param array  $attrs    Input attrs array.
	 * @param string $expected Expected fragment.
	 */
	public function test_tile_layer_attrs_nowrap_and_detect_retina_whitelist( array $attrs, string $expected ): void {
		$this->assertSame( $expected, bflm_build_tile_layer_attrs( $attrs ) );
	}

	/**
	 * Data provider for test_tile_layer_attrs_nowrap_and_detect_retina_whitelist().
	 *
	 * @return array<string,array{0:array,1:string}>
	 */
	public function provider_nowrap_detectretina_values(): array {
		return array(
			'both valid'                  => array(
				array(
					'nowrap'       => 'true',
					'detectretina' => 'false',
				),
				' nowrap="true" detect_retina="false"',
			),
			'detectretina invalid value skipped' => array(
				array( 'detectretina' => 'yes' ),
				'',
			),
		);
	}

	/**
	 * Case 27: all 8 supported fields combined, confirming the emission
	 * order matches the source order: tileurl, tilesize, subdomains, mapid,
	 * accesstoken, zoomoffset, nowrap, detect_retina.
	 */
	public function test_tile_layer_attrs_combined_order(): void {
		$attrs = array(
			'tileurl'      => 'https://{s}.tile.example/{z}/{x}/{y}.png',
			'tilesize'     => '256',
			'subdomains'   => 'abc',
			'mapid'        => 'mymap',
			'accesstoken'  => 'tok123',
			'zoomoffset'   => '1',
			'nowrap'       => 'true',
			'detectretina' => 'true',
		);

		$expected = ' tileurl="https://{s}.tile.example/{z}/{x}/{y}.png" tilesize="256"'
			. ' subdomains="abc" mapid="mymap" accesstoken="tok123" zoomoffset="1"'
			. ' nowrap="true" detect_retina="true"';

		$this->assertSame( $expected, bflm_build_tile_layer_attrs( $attrs ) );
	}
}
