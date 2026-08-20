# Plan 009: PHPUnit characterization tests for the preview input sanitiser (+ test infrastructure)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 313481a..HEAD -- includes/preview/input.php composer.json`
> If `includes/preview/input.php` changed since this plan was written,
> compare the "Current state" excerpt against the live code before
> proceeding; on a mismatch, treat it as a STOP condition (the test cases in
> this plan are written against the EXACT current behaviour of that file —
> if the function's behaviour changed, the "expected" values in the test
> table may now be wrong).

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (this plan ESTABLISHES the test infrastructure that
  plan 010 depends on)
- **Category**: testing
- **Planned at**: commit `313481a`, 2026-06-12
- **Issue**: none (found during /improve audit)

## Why this matters

This plugin has **zero automated PHP tests**. `includes/preview/input.php`
is the highest-value first target: its own docblock states it is "a pure
helper" — "Performs **no** nonce verification, no `wp_die()`, no `echo`, no
`header()`" — making it trivially testable without bootstrapping a full
WordPress test environment. It's also security-relevant: it's the sole
sanitisation boundary between the preview AJAX endpoint's `$_GET` superglobal
and the shared `bflm_build_*_shortcodes()` builders (per this repo's CLAUDE.md:
"Nonce verification lives in `includes/preview/endpoint.php` and runs
**before** any `$_GET` parsing... `includes/preview/input.php` is a pure
sanitiser").

Characterization tests here lock in CURRENT behaviour (type coercion,
defaults, the `'true'`/`'false'`-string handling for booleans, JSON-collection
decoding) so that future refactors (e.g. the v1.2.0 `edit.js` modularization,
or plan 006's PHPCS/PHPStan fixes touching `includes/`) can be made with
confidence. This plan also establishes the PHPUnit infrastructure
(bootstrap, WP-function shims, `phpunit.xml.dist`, composer wiring) that
plan 010 (tests for `includes/shortcodes/attrs.php`) will reuse.

## Current state

`includes/preview/input.php`, full file (109 lines) — relevant excerpts:

```php
function bflm_preview_normalise_input( array $get ): array {
	$attrs = array();

	$attrs['lat']  = isset( $get['lat'] ) ? (float) $get['lat'] : 0.0;
	$attrs['lng']  = isset( $get['lng'] ) ? (float) $get['lng'] : 0.0;
	$attrs['zoom'] = isset( $get['zoom'] ) ? absint( $get['zoom'] ) : 12;

	$height_raw       = isset( $get['height'] ) ? sanitize_text_field( wp_unslash( $get['height'] ) ) : '400px';
	$attrs['height']  = bflm_normalise_dimension( $height_raw, '400px' );
	$attrs['width']   = '100%';

	$attrs['scrollWheelZoom'] = ! empty( $get['scrollWheelZoom'] ) && 'true' === $get['scrollWheelZoom'];
	$attrs['zoomControl']     = ! ( isset( $get['zoomControl'] ) && 'false' === $get['zoomControl'] );
	$attrs['fitMarkers']      = ! empty( $get['fitMarkers'] ) && 'true' === $get['fitMarkers'];
	$attrs['showScale']       = ! empty( $get['showScale'] ) && 'true' === $get['showScale'];

	$attrs['attribution'] = isset( $get['attribution'] ) ? wp_kses_post( wp_unslash( $get['attribution'] ) ) : '';
	$attrs['blockId']     = isset( $get['blockId'] ) ? sanitize_text_field( wp_unslash( $get['blockId'] ) ) : '';

	// Collections.
	$attrs['markers']  = bflm_preview_decode_json_collection( $get, 'markers' );
	$attrs['lines']    = bflm_preview_decode_json_collection( $get, 'lines' );
	$attrs['circles']  = bflm_preview_decode_json_collection( $get, 'circles' );
	$attrs['layers']   = bflm_preview_decode_json_collection( $get, 'layers' );
	$attrs['overlays'] = bflm_preview_decode_json_collection( $get, 'overlays' );

	// Image-map mode.
	$attrs['imageMap']  = ! empty( $get['imageMap'] ) && 'true' === $get['imageMap'];
	$attrs['imageSrc']  = $attrs['imageMap'] && isset( $get['imageSrc'] ) ? trim( sanitize_text_field( wp_unslash( $get['imageSrc'] ) ) ) : '';
	$attrs['imageX']    = $attrs['imageMap'] && isset( $get['imageX'] ) ? (float) $get['imageX'] : 0.0;
	$attrs['imageY']    = $attrs['imageMap'] && isset( $get['imageY'] ) ? (float) $get['imageY'] : 0.0;
	$attrs['imageZoom'] = $attrs['imageMap'] && isset( $get['imageZoom'] ) ? (float) $get['imageZoom'] : 0.0;

	// WMS mode.
	$attrs['wmsEnabled'] = ! $attrs['imageMap'] && ! empty( $get['wmsEnabled'] ) && 'true' === $get['wmsEnabled'];
	$attrs['wmsSource']  = $attrs['wmsEnabled'] && isset( $get['wmsSource'] ) ? trim( sanitize_text_field( wp_unslash( $get['wmsSource'] ) ) ) : '';
	$attrs['wmsLayer']   = $attrs['wmsEnabled'] && isset( $get['wmsLayer'] ) ? trim( sanitize_text_field( wp_unslash( $get['wmsLayer'] ) ) ) : '';
	$attrs['wmsCrs']     = $attrs['wmsEnabled'] && isset( $get['wmsCrs'] ) ? trim( sanitize_text_field( wp_unslash( $get['wmsCrs'] ) ) ) : '';

	// Interaction attrs — pass through as raw 'true'/'false'/'' strings; bflm_build_interaction_attrs() handles them.
	foreach ( array( 'dragging', 'keyboard', 'doubleClickZoom', 'boxZoom', 'closePopupOnClick', 'tap', 'inertia' ) as $key ) {
		$value = isset( $get[ $key ] ) ? sanitize_text_field( wp_unslash( $get[ $key ] ) ) : '';
		$attrs[ $key ] = in_array( $value, array( 'true', 'false' ), true ) ? $value : '';
	}

	// Zoom & bounds.
	$attrs['minZoom']   = isset( $get['minZoom'] ) ? sanitize_text_field( wp_unslash( $get['minZoom'] ) ) : '';
	$attrs['maxZoom']   = isset( $get['maxZoom'] ) ? sanitize_text_field( wp_unslash( $get['maxZoom'] ) ) : '';
	$attrs['maxBounds'] = isset( $get['maxBounds'] ) ? sanitize_text_field( wp_unslash( $get['maxBounds'] ) ) : '';

	// Tile-layer overrides.
	$attrs['tileurl']      = isset( $get['tileurl'] ) ? sanitize_text_field( wp_unslash( $get['tileurl'] ) ) : '';
	$attrs['tilesize']     = isset( $get['tilesize'] ) ? sanitize_text_field( wp_unslash( $get['tilesize'] ) ) : '';
	$attrs['subdomains']   = isset( $get['subdomains'] ) ? sanitize_text_field( wp_unslash( $get['subdomains'] ) ) : '';
	$attrs['mapid']        = isset( $get['mapid'] ) ? sanitize_text_field( wp_unslash( $get['mapid'] ) ) : '';
	$attrs['accesstoken']  = isset( $get['accesstoken'] ) ? sanitize_text_field( wp_unslash( $get['accesstoken'] ) ) : '';
	$attrs['zoomoffset']   = isset( $get['zoomoffset'] ) ? sanitize_text_field( wp_unslash( $get['zoomoffset'] ) ) : '';
	$attrs['nowrap']       = isset( $get['nowrap'] ) ? sanitize_text_field( wp_unslash( $get['nowrap'] ) ) : '';
	$attrs['detectretina'] = isset( $get['detectretina'] ) ? sanitize_text_field( wp_unslash( $get['detectretina'] ) ) : '';

	return $attrs;
}

function bflm_preview_decode_json_collection( array $get, string $key ): array {
	if ( ! isset( $get[ $key ] ) ) {
		return array();
	}
	// JSON decoded and each field sanitised by the consuming builder; raw input is unslashed only.
	$raw     = wp_unslash( $get[ $key ] ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
	$decoded = json_decode( $raw, true );
	return is_array( $decoded ) ? $decoded : array();
}
```

Line 13: `defined( 'ABSPATH' ) || exit;` — this guard means the file CANNOT be
`require`'d directly outside a WordPress context unless `ABSPATH` is defined
first. The bootstrap (Step 2) must define it.

`bflm_preview_normalise_input()` calls `bflm_normalise_dimension()` (defined
in `includes/shortcodes/attrs.php`) — the bootstrap must load that file too
(or at minimum stub the function), since `'400px'` defaults flow through it.

**WordPress functions called by this file that need shims** (none of these
have side effects beyond string/value transformation — safe to shim with
pure-PHP equivalents):

| Function | Behaviour needed for these tests |
|---|---|
| `absint( $val )` | `abs( (int) $val )` |
| `sanitize_text_field( $str )` | strips tags, extra whitespace, line breaks — see Step 3 for the exact shim |
| `wp_unslash( $val )` | `stripslashes_deep()` — removes backslash-escaping (WordPress adds slashes to superglobals) |
| `wp_kses_post( $str )` | full `wp_kses` with the "post" allowed-HTML list — see Step 3 for a SIMPLIFIED shim sufficient for these tests (document the simplification) |

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install dev deps | `composer install --no-interaction --prefer-dist` | exit 0, creates `vendor/` |
| Run the new test suite | `composer test` (after Step 5 wires it up) or `vendor/bin/phpunit` | all tests pass |
| PHP syntax check (fallback) | `php -l tests/includes/preview/test-input.php` | `No syntax errors detected` |

**Note**: like plan 006, this checkout may not have `vendor/` installed. If
`composer install` fails (no network access), write all files per this plan,
then run `php -l` on the new test file and the bootstrap as a fallback, and
report that the suite could not be EXECUTED locally but is ready for CI.

## Scope

**In scope** (files you will create):
- `composer.json` — add `phpunit/phpunit` to `require-dev`, add a `test`
  script, add an `autoload-dev` or test-bootstrap reference as needed.
- `phpunit.xml.dist` — PHPUnit configuration (bootstrap file, test suite
  directory).
- `tests/bootstrap.php` — defines `ABSPATH` and shims the 4 WordPress
  functions listed above, then `require`s the files under test.
- `tests/includes/preview/test-input.php` — the actual test cases for
  `bflm_preview_normalise_input()` and `bflm_preview_decode_json_collection()`.
- `.gitignore` — add `.phpunit.result.cache` if not already covered by an
  existing pattern (check first).

**Out of scope**:
- `includes/preview/input.php` itself — NO production code changes. This is
  a pure characterization-test plan. If a test reveals behaviour that looks
  like a BUG (not just "surprising but intentional"), do NOT fix it — write
  the test asserting CURRENT behaviour, and add a `// NOTE:` comment in the
  test plus a line in your final report flagging it as a candidate follow-up.
- `includes/shortcodes/attrs.php` — plan 010 covers this. This plan only
  needs `bflm_normalise_dimension()` from it as a dependency (loaded via
  `require` in the bootstrap, not stubbed — it's pure PHP, no WP functions
  inside it per its signature `function bflm_normalise_dimension( $raw,
  string $default ): string`).
- `includes/preview/endpoint.php`, `includes/preview/template.php` — these
  have side effects (`wp_die`, `header`, hook registration per CLAUDE.md) and
  are explicitly OUT OF SCOPE for unit testing without a full WP test
  environment. Not part of this plan.
- `phpcs.xml` / `phpstan.neon` — plan 006 handles whether `tests/` is linted;
  do not modify those configs here (but see "Maintenance notes").
- `.distignore` — ALREADY excludes `tests/`, `phpunit.xml.dist`,
  `.phpunit.result.cache`, and `bin/` (confirmed present). No change needed.

## Git workflow

- Branch: `test/phpunit-preview-input`
- Commit 1: infrastructure (`composer.json`, `phpunit.xml.dist`,
  `tests/bootstrap.php`, `.gitignore` if changed).
- Commit 2: the test file (`tests/includes/preview/test-input.php`).
- Commit message style: `test: add PHPUnit suite + characterization tests for preview input sanitiser`
- Do NOT push or open a PR unless explicitly instructed.

## Steps

### Step 1: Add PHPUnit to composer

`composer.json` currently:

```json
{
	"require-dev": {
		"squizlabs/php_codesniffer": "^3.13",
		"wp-coding-standards/wpcs": "^3.3",
		"phpstan/phpstan": "^2.1",
		"szepeviktor/phpstan-wordpress": "^2.0"
	},
	"config": {
		"allow-plugins": {
			"dealerdirect/phpcodesniffer-composer-installer": true
		}
	},
	"scripts": {
		"lint": "phpcs",
		"lint:fix": "phpcbf",
		"phpstan": "phpstan analyse"
	}
}
```

Add `phpunit/phpunit` and a `test` script. Use a version compatible with
PHP 7.4+ (this repo's `testVersion` floor per `phpcs.xml`) — PHPUnit 9.x
supports PHP 7.3-8.x and is the right choice (PHPUnit 10+ requires PHP 8.1+).

```json
{
	"require-dev": {
		"squizlabs/php_codesniffer": "^3.13",
		"wp-coding-standards/wpcs": "^3.3",
		"phpstan/phpstan": "^2.1",
		"szepeviktor/phpstan-wordpress": "^2.0",
		"phpunit/phpunit": "^9.6"
	},
	"config": {
		"allow-plugins": {
			"dealerdirect/phpcodesniffer-composer-installer": true
		}
	},
	"scripts": {
		"lint": "phpcs",
		"lint:fix": "phpcbf",
		"phpstan": "phpstan analyse",
		"test": "phpunit"
	}
}
```

**Verify**: `grep -n "phpunit" composer.json` shows both the `require-dev`
entry and the `test` script.

### Step 2: Create `phpunit.xml.dist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<phpunit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="vendor/phpunit/phpunit/phpunit.xsd"
         bootstrap="tests/bootstrap.php"
         colors="true"
         cacheResultFile=".phpunit.result.cache">
    <testsuites>
        <testsuite name="unit">
            <directory>tests</directory>
        </testsuite>
    </testsuites>
</phpunit>
```

**Verify**: file exists at repo root, valid XML (`php -r "var_dump(simplexml_load_file('phpunit.xml.dist') !== false);"` → `bool(true)`).

### Step 3: Create `tests/bootstrap.php`

This file defines `ABSPATH` (satisfying the `defined( 'ABSPATH' ) || exit;`
guards in `includes/preview/input.php` and `includes/shortcodes/attrs.php`),
shims the 4 WordPress functions, and loads the files under test.

```php
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
```

**Verify**: `php -l tests/bootstrap.php` → `No syntax errors detected`.

Note for the executor: the `wp_kses`/`wp_kses_post` shims are intentionally
simplified — re-read the docblocks above carefully when writing test cases in
Step 4, and only assert outcomes these shims can actually produce. Do not
write a test that assumes full WordPress `wp_kses_post()` fidelity (e.g.
URL-protocol filtering on `href` is NOT implemented by this shim).

### Step 4: Write `tests/includes/preview/test-input.php`

Test class name convention: `Test_<Description>` extending
`PHPUnit\Framework\TestCase` (PHPUnit 9.x style — `PHPUnit\Framework\TestCase`,
not the deprecated `WP_UnitTestCase` which requires a full WP test env).

Cover at minimum these cases (derive exact expected values by reading the
"Current state" excerpt above — do not guess):

**`bflm_preview_normalise_input()`**:

1. **Empty `$get` array** → defaults: `lat=0.0`, `lng=0.0`, `zoom=12`,
   `height='400px'`, `width='100%'`, `scrollWheelZoom=false`,
   `zoomControl=true`, `fitMarkers=false`, `showScale=false`,
   `attribution=''`, `blockId=''`, all 5 collections `=[]`, `imageMap=false`,
   `imageSrc=''`, `imageX=0.0`, `imageY=0.0`, `imageZoom=0.0`,
   `wmsEnabled=false`, `wmsSource=''`, `wmsLayer=''`, `wmsCrs=''`, all 7
   interaction keys `=''`, `minZoom=''`, `maxZoom=''`, `maxBounds=''`, all 8
   tile-layer keys `=''`.
2. **Numeric coercion**: `lat`/`lng` as numeric strings (`'45.5'`, `'-122.3'`)
   → coerced to floats `45.5`, `-122.3`. `zoom` as `'5'` → `absint` → `int(5)`.
   `zoom` as a negative string `'-3'` → `absint('-3')` → `3` (document: PHP's
   `(int)` cast on `'-3'` is `-3`, then `abs(-3)` is `3` — confirm this is
   indeed the shim's behaviour, since `absint` in WP core is
   `abs( intval( $maybeint ) )`).
3. **`zoom` absent** → defaults to `12` (not `0`) — this is the ONE field
   with a non-empty/non-zero default among the simple scalars; worth its own
   assertion since it's easy to regress.
4. **Boolean flags — the `'true'`/`'false'` STRING contract**: for
   `scrollWheelZoom`, `fitMarkers`, `showScale` — only the literal string
   `'true'` yields `true`; ANY other value (`'1'`, `1`, `true` (actual PHP
   bool), `'TRUE'`, `'yes'`) yields `false`. Write a `@dataProvider` covering
   at least: `'true'` → `true`; `'false'` → `false`; `'1'` → `false`;
   `1` (int) → `false`; `''` → `false`; absent → `false`.
5. **`zoomControl` — INVERTED default logic**: this is the only boolean with
   a default of `true`. Only the literal string `'false'` flips it to
   `false`. Cover: absent → `true`; `'false'` → `false`; `'true'` → `true`
   (note: `'true'` doesn't match the `'false'` check, so stays `true` — same
   end result as absent, but via a different code path; worth asserting both
   produce `true`); `'0'` → `true` (NOT `'false'`, so stays `true` — this may
   be COUNTERINTUITIVE; assert it as current behaviour, add a `// NOTE:`
   comment).
6. **`attribution` — `wp_kses_post()` passthrough**: a plain string passes
   through unchanged (e.g. `'© OpenStreetMap'`); an `<a href="...">` tag is
   preserved (per the bootstrap's `wp_kses_post` shim); a `<script>alert(1)</script>`
   payload is stripped to empty string (per the shim's script-stripping).
   Absent → `''`.
7. **`blockId` — `sanitize_text_field` passthrough**: a normal string passes
   through; a string with extra whitespace/newlines is collapsed (per the
   `sanitize_text_field` shim); absent → `''`.
8. **`imageMap` gating**: when `imageMap` is NOT `'true'`, `imageSrc`,
   `imageX`, `imageY`, `imageZoom` are ALL `''`/`0.0` regardless of whether
   those keys are present in `$get` (i.e., set `imageSrc=>'foo.jpg'`,
   `imageX=>'10'` in `$get` WITHOUT `imageMap=>'true'`, and assert the
   normalised output still has `imageSrc=''`, `imageX=0.0`). Then with
   `imageMap=>'true'` AND those keys present, assert they ARE populated
   (`imageSrc='foo.jpg'` (after `trim`+`sanitize_text_field`), `imageX=10.0`).
9. **`wmsEnabled` gating — mutual exclusivity with `imageMap`**: when
   `imageMap=>'true'` AND `wmsEnabled=>'true'` are BOTH set, assert
   `wmsEnabled` is `false` (the `! $attrs['imageMap'] &&` guard in the source
   takes precedence) and `wmsSource`/`wmsLayer`/`wmsCrs` are all `''` even if
   present in `$get`. Then with `imageMap` absent/false and
   `wmsEnabled=>'true'`, assert `wmsEnabled=true` and the WMS fields populate.
10. **Interaction attrs — strict `'true'`/`'false'` whitelist**: for each of
    `dragging`, `keyboard`, `doubleClickZoom`, `boxZoom`, `closePopupOnClick`,
    `tap`, `inertia` — value `'true'` → `'true'` (string); `'false'` →
    `'false'` (string); any other value (`'yes'`, `'1'`, `''`, absent) →
    `''` (empty string, NOT boolean `false`). At least one
    `@dataProvider`-driven test across all 7 keys with `'true'`/`'false'`/
    `'garbage'` values.
11. **Pass-through string fields**: `minZoom`, `maxZoom`, `maxBounds`,
    `tileurl`, `tilesize`, `subdomains`, `mapid`, `accesstoken`, `zoomoffset`,
    `nowrap`, `detectretina` — each: present → `sanitize_text_field(
    wp_unslash( ... ) )` applied (test with a value containing leading/
    trailing whitespace, e.g. `'  256  '` → `'256'`); absent → `''`.
12. **`height` → `bflm_normalise_dimension()`**: present with a valid CSS
    dimension (e.g. `'500px'`) → passed through `bflm_normalise_dimension()`
    (read that function's current behaviour in `includes/shortcodes/attrs.php`
    to determine the exact expected output — do not assume identity passthrough
    without checking; e.g. it may clamp `%` values > 100). Absent → default
    `'400px'` (also passed through `bflm_normalise_dimension('400px', '400px')`
    — assert whatever that function currently returns for its own default,
    which should be `'400px'` unchanged, but VERIFY by reading the function).
13. **`width` is ALWAYS `'100%'`**: regardless of any `width`-like key in
    `$get` (there is no `width` key read from `$get` at all in this
    function) — assert `$attrs['width'] === '100%'` even if `$get['width']`
    is set to something else (it's simply ignored).

**`bflm_preview_decode_json_collection()`**:

14. **Key absent** → `[]`.
15. **Valid JSON array string** (e.g.
    `'[{"lat":1,"lng":2},{"lat":3,"lng":4}]'`) → decoded to the matching PHP
    array (2 elements, each an associative array with `lat`/`lng` keys).
16. **Valid JSON but NOT an array at the top level** (e.g. `'"just a string"'`
    or `'42'` or `'null'`) → `[]` (the `is_array( $decoded ) ? $decoded :
    array()` fallback).
17. **Malformed JSON** (e.g. `'{not valid json'`) → `[]` (`json_decode`
    returns `null` on error, `is_array(null)` is `false`).
18. **Slashed input**: a JSON string containing escaped quotes as WordPress's
    superglobal-slashing would produce them (e.g. the raw `$_GET` value
    `'[{\\"lat\\":1}]'` with literal backslashes before the inner quotes) →
    `wp_unslash()` removes the backslashes BEFORE `json_decode`, so this
    should decode successfully to `[['lat' => 1]]`. This is the most
    important case — it documents WHY `wp_unslash()` is called before
    `json_decode()`.

For each test, use clear method names (e.g.
`test_zoom_control_defaults_to_true_when_absent`,
`test_image_map_fields_ignored_when_image_map_not_enabled`) and one assertion
focus per test (or a `@dataProvider` for parametrized variants of the same
rule, per cases 4/10).

**Verify**: `vendor/bin/phpunit tests/includes/preview/test-input.php` (or
`composer test -- tests/includes/preview/test-input.php`) → all tests green.

### Step 5: Run the full suite

```bash
composer test
```

**Verify**: exit 0, all tests pass (this should currently be ONLY the file
from Step 4, since this plan creates the first tests in the repo).

### Step 6: Check `.gitignore` for the PHPUnit cache file

```bash
grep -n "phpunit" .gitignore
```

**Verify**: if `.phpunit.result.cache` is NOT already ignored, add it to
`.gitignore`. (`.distignore` already excludes it from the distribution zip —
this is a separate concern, about not committing it to git at all.)

## Test plan

This plan IS the test plan — Step 4 enumerates 18 test cases. No additional
tests beyond what's specified above are required, but the executor may add
MORE cases if reading the source reveals additional edge cases worth locking
in (e.g. if `bflm_normalise_dimension()` has surprising clamping behaviour
discovered while writing case 12 — add a dedicated test for it).

## Done criteria

ALL must hold:

- [ ] `composer.json` includes `phpunit/phpunit` in `require-dev` and a
      `test` script.
- [ ] `phpunit.xml.dist` exists at repo root, valid XML, bootstraps
      `tests/bootstrap.php`, runs the `tests/` directory.
- [ ] `tests/bootstrap.php` exists, defines `ABSPATH`, shims `absint`,
      `wp_unslash`, `sanitize_text_field`, `wp_strip_all_tags`, `wp_kses_post`,
      `wp_kses`, loads `includes/shortcodes/attrs.php` and
      `includes/preview/input.php`.
- [ ] `tests/includes/preview/test-input.php` exists, covers all 18 cases
      listed in Step 4 (or documents why a case was split/merged/expanded).
- [ ] `composer test` (or `vendor/bin/phpunit`) exits 0 with all tests
      passing — OR, if `vendor/` is unavailable, `php -l` passes on all new
      PHP files and this is noted in the report (see fallback in "Commands
      you will need").
- [ ] `includes/preview/input.php` and `includes/shortcodes/attrs.php` are
      UNCHANGED (`git diff --stat` shows neither file).
- [ ] `plans/README.md` status row for plan 009 updated to DONE, and plan
      010's "Depends on: 009" note confirmed satisfiable (infrastructure
      exists for it to extend).

## STOP conditions

Stop and report back (do not improvise) if:

- `includes/preview/input.php` does not match the "Current state" excerpt —
  the file may have changed since this plan was written; re-derive expected
  test values from the LIVE file rather than this plan's excerpt, or stop if
  the change is large enough that this plan's case list (Step 4) no longer
  makes sense.
- Any of the 18 test cases, once written against the bootstrap shims, reveals
  that `bflm_preview_normalise_input()` or
  `bflm_preview_decode_json_collection()` has a behaviour that looks like a
  genuine BUG (not just "surprising but as-designed", e.g. case 5's
  `zoomControl`/`'0'` quirk, which IS as-designed and should just be
  documented). If something looks like an actual bug (e.g. a fatal error,
  an uncaught type-juggling crash, or a security-relevant sanitisation gap
  not already covered by plans 003-005) — write the test asserting CURRENT
  behaviour (so it's documented), do NOT fix it, and flag it prominently in
  your final report as a new finding for the operator to triage.
- `bflm_normalise_dimension()` in `includes/shortcodes/attrs.php` (loaded by
  the bootstrap) itself calls any WP function not in the 4-function shim
  list above — if so, read that function's current source, add whatever
  ADDITIONAL shim is needed (document it the same way, with a SIMPLIFICATION
  note), and proceed; if the additional shim would be non-trivial (e.g. it
  needs `wp_parse_args` with deep array merging, `apply_filters`, etc.), STOP
  and report instead of writing a complex shim.

## Maintenance notes

- The 6 WP-function shims in `tests/bootstrap.php` are INTENTIONALLY
  simplified (each docblock says how). If a future test file (plan 010 or
  later) needs a behaviour these shims don't cover, EXTEND the shim in
  `tests/bootstrap.php` (single source of truth for all test files) and
  update its docblock — don't create a second, divergent shim in a different
  bootstrap file.
- Plan 010 (tests for `includes/shortcodes/attrs.php`) depends on this
  plan's infrastructure — it should add `tests/includes/shortcodes/` test
  files using the SAME `tests/bootstrap.php` (already `require`s
  `includes/shortcodes/attrs.php`, so no bootstrap change needed for plan 010
  unless it needs additional shims).
- Plan 006 (expand PHPCS/PHPStan to `includes/`) should decide whether
  `tests/` is linted by PHPCS/PHPStan too — if plan 006 runs AFTER this plan,
  its executor will see `tests/` exists and should make that call (this
  plan's "Test plan" section for plan 006 already anticipates this).
- A reviewer should scrutinize: do the 18 test cases' EXPECTED VALUES
  actually match `includes/preview/input.php`'s CURRENT code (not what the
  function "should" do)? These are characterization tests — correctness of
  the VALUES, not the BEHAVIOUR, is what to check. If a value looks wrong,
  re-derive it from the source rather than "fixing" the test to what seems
  more correct.
