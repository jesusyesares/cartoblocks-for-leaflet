<?php
/**
 * Geocoder request helpers — pure functions that build the outgoing Nominatim
 * HTTP request. Kept free of hooks, output and wp_die() so they can be unit
 * tested without a full WordPress environment.
 *
 * @package BlocksForLeafletMap
 */

defined( 'ABSPATH' ) || exit;

/**
 * Default timeout, in seconds, for the Nominatim geocoding request.
 *
 * WordPress's HTTP API defaults to 5 seconds, which the first Nominatim
 * request after a quiet period occasionally exceeds (cURL error 28), making
 * the editor report "Geocoding request failed" until the user retries.
 */
if ( ! defined( 'BFLM_GEOCODE_TIMEOUT' ) ) {
	define( 'BFLM_GEOCODE_TIMEOUT', 15 );
}

/**
 * Returns the timeout, in seconds, for the Nominatim geocoding request.
 *
 * Filterable via `bflm_geocode_timeout`. Non-numeric or non-positive values
 * fall back to BFLM_GEOCODE_TIMEOUT so a bad filter can never produce a
 * zero (unlimited) or negative timeout.
 *
 * @return int Timeout in seconds, always >= 1.
 */
function bflm_geocode_timeout(): int {
	/**
	 * Filters the Nominatim geocoding request timeout.
	 *
	 * @param int $timeout Timeout in seconds. Default BFLM_GEOCODE_TIMEOUT.
	 */
	$timeout = (int) apply_filters( 'bflm_geocode_timeout', BFLM_GEOCODE_TIMEOUT );

	// Non-numeric values cast to 0, so this also catches strings and null.
	return $timeout < 1 ? BFLM_GEOCODE_TIMEOUT : $timeout;
}

/**
 * Builds the wp_safe_remote_get() arguments for a Nominatim request.
 *
 * @param string $user_agent      User-Agent header identifying the site.
 * @param string $accept_language Accept-Language header (e.g. "es-ES").
 * @return array<string, mixed> Request arguments.
 */
function bflm_geocode_request_args( string $user_agent, string $accept_language ): array {
	return array(
		'timeout'    => bflm_geocode_timeout(),
		'user-agent' => $user_agent,
		'headers'    => array(
			'Accept-Language' => $accept_language,
		),
	);
}
