<?php
/**
 * Tests for includes/geocoder-request.php.
 *
 * @package BlocksForLeafletMap
 */

use PHPUnit\Framework\TestCase;

/**
 * Tests for bflm_geocode_timeout() and bflm_geocode_request_args().
 */
class Test_Geocoder_Request extends TestCase {

	/**
	 * Clears any filters registered by a test.
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['bflm_test_filters']['bflm_geocode_timeout'] );
		parent::tearDown();
	}

	/**
	 * Registers a bflm_geocode_timeout filter returning a fixed value.
	 *
	 * @param mixed $value Value the filter returns.
	 */
	private function filter_timeout( $value ): void {
		$GLOBALS['bflm_test_filters']['bflm_geocode_timeout'] = array(
			static function () use ( $value ) {
				return $value;
			},
		);
	}

	/**
	 * The default timeout is longer than WordPress's 5-second HTTP default.
	 */
	public function test_default_timeout_exceeds_wp_default(): void {
		$this->assertSame( 15, bflm_geocode_timeout() );
		$this->assertGreaterThan( 5, bflm_geocode_timeout() );
	}

	/**
	 * A positive filtered value is used.
	 */
	public function test_filter_overrides_timeout(): void {
		$this->filter_timeout( 30 );
		$this->assertSame( 30, bflm_geocode_timeout() );
	}

	/**
	 * A numeric string from a filter is cast to int.
	 */
	public function test_numeric_string_filter_is_cast(): void {
		$this->filter_timeout( '20' );
		$this->assertSame( 20, bflm_geocode_timeout() );
	}

	/**
	 * Zero, negative and non-numeric filter values fall back to the default.
	 *
	 * @dataProvider invalid_timeouts
	 *
	 * @param mixed $value Invalid filtered value.
	 */
	public function test_invalid_filter_values_fall_back_to_default( $value ): void {
		$this->filter_timeout( $value );
		$this->assertSame( BFLM_GEOCODE_TIMEOUT, bflm_geocode_timeout() );
	}

	/**
	 * Invalid timeout values.
	 *
	 * @return array<string, array{0: mixed}>
	 */
	public function invalid_timeouts(): array {
		return array(
			'zero'        => array( 0 ),
			'negative'    => array( -10 ),
			'non-numeric' => array( 'abc' ),
			'null'        => array( null ),
		);
	}

	/**
	 * The request args carry the timeout and the identifying headers.
	 */
	public function test_request_args_include_timeout_and_headers(): void {
		$args = bflm_geocode_request_args( 'Nominatim query for https://example.test', 'es-ES' );

		$this->assertSame( 15, $args['timeout'] );
		$this->assertSame( 'Nominatim query for https://example.test', $args['user-agent'] );
		$this->assertSame( array( 'Accept-Language' => 'es-ES' ), $args['headers'] );
	}

	/**
	 * The request args reflect a filtered timeout.
	 */
	public function test_request_args_use_filtered_timeout(): void {
		$this->filter_timeout( 25 );
		$args = bflm_geocode_request_args( 'ua', 'en-US' );

		$this->assertSame( 25, $args['timeout'] );
	}
}
