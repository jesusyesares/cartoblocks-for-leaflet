<?php
/**
 * Geocode endpoint — AJAX handler that queries Nominatim for up to 5 address
 * candidates and returns them as JSON for the block editor to display.
 *
 * @package BlocksForLeafletMap
 */

defined( 'ABSPATH' ) || exit;

/**
 * Handle address geocoding requests from the block editor.
 *
 * Queries the Nominatim API for up to 5 candidates matching the submitted
 * address and returns a JSON-encoded list. Reuses Leaflet Map's User-Agent
 * and contact-email conventions, including the leaflet_map_nominatim_contact_email
 * filter, so the request is correctly attributed.
 *
 * Security: nonce verified via check_ajax_referer(), capability checked with
 * current_user_can(), input sanitised with sanitize_text_field().
 *
 * @return void
 */
function bflm_geocode_address(): void {
	check_ajax_referer( 'bflm_geocode_nonce', '_ajax_nonce' );

	if ( ! current_user_can( 'edit_posts' ) ) {
		wp_send_json_error(
			array( 'message' => __( 'You do not have permission to perform this action.', 'blocks-for-leaflet-map' ) ),
			403
		);
	}

	if ( ! bflm_is_leaflet_map_active() ) {
		wp_send_json_error(
			array( 'message' => __( 'The Leaflet Map plugin is not active.', 'blocks-for-leaflet-map' ) )
		);
	}

	$address = isset( $_POST['address'] ) ? sanitize_text_field( wp_unslash( $_POST['address'] ) ) : '';

	if ( '' === $address ) {
		wp_send_json_error(
			array( 'message' => __( 'Please enter an address to search.', 'blocks-for-leaflet-map' ) )
		);
	}

	// Build contact email and User-Agent following Leaflet Map's osm_geocode() conventions,
	// including the leaflet_map_nominatim_contact_email filter.
	$contact_email = '';
	if ( class_exists( 'Leaflet_Map_Plugin_Settings' ) ) {
		$settings      = Leaflet_Map_Plugin_Settings::init();
		$contact_email = $settings->get( 'nominatim_contact_email' );
	}
	if ( empty( $contact_email ) ) {
		$contact_email = get_bloginfo( 'admin_email' );
	}
	$contact_email   = apply_filters( 'bflm_nominatim_contact_email', $contact_email );
	$accept_language = str_replace( '_', '-', get_locale() );
	$user_agent      = 'Nominatim query for ' . get_bloginfo( 'url' ) . '; contact ' . $contact_email;

	$request_url = sprintf(
		'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=%s',
		rawurlencode( $address )
	);

	$response = wp_remote_get(
		$request_url,
		array(
			'user-agent' => $user_agent,
			'headers'    => array(
				'Accept-Language' => $accept_language,
			),
		)
	);

	if ( is_wp_error( $response ) ) {
		wp_send_json_error(
			array( 'message' => __( 'Geocoding request failed. Please try again.', 'blocks-for-leaflet-map' ) )
		);
	}

	$body = wp_remote_retrieve_body( $response );
	$data = json_decode( $body );

	if ( ! is_array( $data ) || empty( $data ) ) {
		wp_send_json_error(
			array( 'message' => __( 'No results found for that address.', 'blocks-for-leaflet-map' ) )
		);
	}

	$candidates = array();
	foreach ( $data as $item ) {
		if ( ! isset( $item->lat, $item->lon, $item->display_name ) ) {
			continue;
		}
		$candidates[] = array(
			'display_name' => sanitize_text_field( $item->display_name ),
			'lat'          => (float) $item->lat,
			'lng'          => (float) $item->lon,
		);
	}

	if ( empty( $candidates ) ) {
		wp_send_json_error(
			array( 'message' => __( 'No results found for that address.', 'blocks-for-leaflet-map' ) )
		);
	}

	wp_send_json_success( array( 'candidates' => $candidates ) );
}
add_action( 'wp_ajax_bflm_geocode', 'bflm_geocode_address' );
