<?php
/**
 * PHPUnit bootstrap.
 *
 * Provides minimal shims for the WordPress functions used by the pure
 * sanitiser/builder functions under test, so they can run without a full
 * WordPress test environment. Each shim documents the simplification made
 * relative to WordPress core, and why it's sufficient for these tests.
 *
 * @package BlocksForLeafletMap
 */

if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', __DIR__ . '/' );
}

/**
 * Shim: absint().
 * Core behaviour: absolute value of an int cast. No simplification needed —
 * this is a one-line pure function in WordPress core itself.
 */
if ( ! function_exists( 'absint' ) ) {
	function absint( $maybeint ) {
		return abs( (int) $maybeint );
	}
}

/**
 * Shim: wp_unslash().
 * Core behaviour: recursively strips backslash-escaping added by PHP's
 * (legacy) magic_quotes-style superglobal escaping, which WordPress applies
 * unconditionally to $_GET/$_POST/etc. Core implementation is
 * stripslashes_deep() — same as this shim, no simplification.
 */
if ( ! function_exists( 'wp_unslash' ) ) {
	function wp_unslash( $value ) {
		return is_array( $value )
			? array_map( 'wp_unslash', $value )
			: stripslashes( (string) $value );
	}
}

/**
 * Shim: sanitize_text_field().
 * Core behaviour: strips tags, converts line breaks to spaces, strips
 * extra whitespace, strips octets. SIMPLIFICATION: this shim strips tags,
 * collapses whitespace/newlines to single spaces, and trims — it does NOT
 * replicate core's percent-encoded-octet stripping (e.g. "%ad"), since none
 * of the test inputs in this suite contain percent-encoded octets. If a
 * future test needs that behaviour, extend this shim rather than silently
 * relying on the gap.
 */
if ( ! function_exists( 'sanitize_text_field' ) ) {
	function sanitize_text_field( $str ) {
		$str = (string) $str;
		$str = wp_strip_all_tags( $str );
		$str = preg_replace( '/[\r\n\t ]+/', ' ', $str );
		return trim( $str );
	}
}

/**
 * Shim: wp_strip_all_tags().
 * Used by the sanitize_text_field() shim above. Core behaviour: strip_tags()
 * plus removal of script/style block contents. SIMPLIFICATION: this shim
 * omits the script/style-content removal (test inputs don't include
 * <script>/<style> blocks) and uses plain strip_tags().
 */
if ( ! function_exists( 'wp_strip_all_tags' ) ) {
	function wp_strip_all_tags( $str ) {
		return trim( strip_tags( (string) $str ) );
	}
}

/**
 * Shim: wp_kses_post().
 * Core behaviour: runs wp_kses() against the "post" allowed-HTML list
 * (a long list of tags/attributes considered safe in post content), strips
 * everything else. SIMPLIFICATION: this shim allows a small, explicit subset
 * sufficient for the attribution-field test cases in this suite — a basic
 * <a href> tag (the realistic attribution use case, e.g.
 * '<a href="https://openstreetmap.org">OSM</a>') plus plain text — and
 * strips <script> tags entirely (the realistic "should be stripped" test
 * case). It does NOT replicate the full "post" allowed-HTML list. If a
 * future test needs another tag/attribute, extend this shim explicitly and
 * document the addition here.
 */
if ( ! function_exists( 'wp_kses_post' ) ) {
	function wp_kses_post( $str ) {
		return wp_kses(
			(string) $str,
			array(
				'a' => array(
					'href'   => true,
					'title'  => true,
					'target' => true,
					'rel'    => true,
				),
				'em'     => array(),
				'strong' => array(),
			)
		);
	}
}

/**
 * Shim: wp_kses().
 * SIMPLIFICATION: strips any tag not in the $allowed_html whitelist
 * entirely (including its content, for <script>/<style> — for other
 * disallowed tags, strips only the tags and keeps inner text, matching
 * core's general behaviour for inline elements). For tags in the whitelist,
 * strips any attribute not in that tag's allowed-attribute list. This is
 * NOT a full reimplementation of wp_kses() (no protocol/URI validation on
 * href, no entity handling beyond what strip_tags/preg_replace do) — it
 * exists only to support the wp_kses_post() shim above for this test suite's
 * specific cases.
 */
if ( ! function_exists( 'wp_kses' ) ) {
	function wp_kses( $str, array $allowed_html ) {
		$str = (string) $str;
		// Strip <script>...</script> and <style>...</style> including content.
		$str = preg_replace( '#<(script|style)\b[^>]*>.*?</\1>#is', '', $str );
		// Strip any remaining tag whose name is not in the whitelist.
		$allowed_names = array_keys( $allowed_html );
		$str           = preg_replace_callback(
			'#<(/?)([a-zA-Z0-9]+)([^>]*)>#',
			static function ( $m ) use ( $allowed_names, $allowed_html ) {
				$tag = strtolower( $m[2] );
				if ( ! in_array( $tag, $allowed_names, true ) ) {
					return '';
				}
				if ( '/' === $m[1] ) {
					return '</' . $tag . '>';
				}
				$allowed_attrs = array_keys( $allowed_html[ $tag ] );
				$attrs         = '';
				if ( preg_match_all( '/([a-zA-Z0-9-]+)\s*=\s*"([^"]*)"/', $m[3], $am, PREG_SET_ORDER ) ) {
					foreach ( $am as $a ) {
						if ( in_array( strtolower( $a[1] ), $allowed_attrs, true ) ) {
							$attrs .= ' ' . strtolower( $a[1] ) . '="' . $a[2] . '"';
						}
					}
				}
				return '<' . $tag . $attrs . '>';
			},
			$str
		);
		return $str;
	}
}

// Load the files under test.
require_once dirname( __DIR__ ) . '/includes/shortcodes/attrs.php';
require_once dirname( __DIR__ ) . '/includes/preview/input.php';
