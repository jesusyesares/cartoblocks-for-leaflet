# Plan 010: PHPUnit characterization tests for shortcode attribute normalisation

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 313481a..HEAD -- includes/shortcodes/attrs.php tests/`
> If `includes/shortcodes/attrs.php` changed since this plan was written,
> compare the "Current state" excerpt against the live code before
> proceeding; on a mismatch, treat it as a STOP condition (the test cases in
> this plan are written against the EXACT current behaviour of that file). If
> `tests/` doesn't exist yet, plan 009 has not run — see "Depends on" below.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: **009** (PHPUnit infrastructure + `tests/bootstrap.php` +
  `phpunit.xml.dist` + `composer.json` `test` script must exist first — this
  plan only ADDS a test file and EXTENDS the bootstrap shim list, it does not
  recreate infrastructure)
- **Category**: testing
- **Planned at**: commit `313481a`, 2026-06-12
- **Issue**: none (found during /improve audit)

## Why this matters

`includes/shortcodes/attrs.php` is the single most depended-upon file in the
modularized `includes/shortcodes/` tree — every one of the
`bflm_build_*_shortcodes()` builders (map, marker, line, circle, layer,
overlay) calls `bflm_normalise_map_attrs()` (directly or via
`includes/preview/input.php`, already covered by plan 009) and several call
`bflm_build_interaction_attrs()`, `bflm_build_zoom_bounds_attrs()`, and
`bflm_build_tile_layer_attrs()`. A regression here silently breaks shortcode
generation across BOTH the frontend (`src/leaflet-map-block/render.php`) and
the editor preview (`includes/preview/template.php`) — this repo's CLAUDE.md
explicitly calls out this shared-builder architecture as a place where "any
new shortcode attribute must be added in one place — never duplicated
inline", making it high-leverage to characterize before any future change.

This plan extends plan 009's PHPUnit infrastructure (same `tests/bootstrap.php`,
same `phpunit.xml.dist`, same `composer test` command) — no new infrastructure
is created.

## Current state

`includes/shortcodes/attrs.php`, full file (180 lines) — already reproduced
in full in this plan for self-containedness:

```php
function bflm_normalise_dimension( $raw, string $default ): string {
	$value = is_numeric( $raw ) ? $raw . 'px' : sanitize_text_field( (string) $raw );
	if ( ! preg_match( '/^\d+(\.\d+)?(px|%|vh|vw|em|rem)$/', $value ) ) {
		return $default;
	}
	if ( str_ends_with( $value, '%' ) && (float) $value > 100 ) {
		return '100%';
	}
	return $value;
}

function bflm_normalise_map_attrs( array $attrs ): array {
	$out = $attrs;

	$out['lat']    = isset( $attrs['lat'] ) ? (float) $attrs['lat'] : 0.0;
	$out['lng']    = isset( $attrs['lng'] ) ? (float) $attrs['lng'] : 0.0;
	$out['zoom']   = isset( $attrs['zoom'] ) ? (int) $attrs['zoom'] : 12;
	$out['height'] = bflm_normalise_dimension( $attrs['height'] ?? '400px', '400px' );
	$out['width']  = bflm_normalise_dimension( $attrs['width'] ?? '100%', '100%' );

	$out['scrollWheelZoom'] = ! empty( $attrs['scrollWheelZoom'] );
	$out['zoomControl']     = ! ( isset( $attrs['zoomControl'] ) && false === $attrs['zoomControl'] );
	$out['fitMarkers']      = ! empty( $attrs['fitMarkers'] );
	$out['showScale']       = ! empty( $attrs['showScale'] );
	$out['attribution']     = isset( $attrs['attribution'] ) ? (string) $attrs['attribution'] : '';

	$out['imageMap']   = ! empty( $attrs['imageMap'] );
	$out['wmsEnabled'] = ! $out['imageMap'] && ! empty( $attrs['wmsEnabled'] );

	$out['imageSrc']  = $out['imageMap'] && isset( $attrs['imageSrc'] ) ? trim( (string) $attrs['imageSrc'] ) : '';
	$out['imageX']    = $out['imageMap'] && isset( $attrs['imageX'] ) ? (float) $attrs['imageX'] : 0.0;
	$out['imageY']    = $out['imageMap'] && isset( $attrs['imageY'] ) ? (float) $attrs['imageY'] : 0.0;
	$out['imageZoom'] = $out['imageMap'] && isset( $attrs['imageZoom'] ) ? (float) $attrs['imageZoom'] : 0.0;

	$out['wmsSource'] = $out['wmsEnabled'] && isset( $attrs['wmsSource'] ) ? trim( (string) $attrs['wmsSource'] ) : '';
	$out['wmsLayer']  = $out['wmsEnabled'] && isset( $attrs['wmsLayer'] ) ? trim( (string) $attrs['wmsLayer'] ) : '';
	$out['wmsCrs']    = $out['wmsEnabled'] && isset( $attrs['wmsCrs'] ) ? trim( (string) $attrs['wmsCrs'] ) : '';

	return $out;
}

function bflm_build_interaction_attrs( array $attrs ): string {
	$map = array(
		'dragging'          => 'dragging',
		'keyboard'          => 'keyboard',
		'doubleClickZoom'   => 'doubleclickzoom',
		'boxZoom'           => 'boxzoom',
		'closePopupOnClick' => 'closepopuponclick',
		'tap'               => 'tap',
		'inertia'           => 'inertia',
	);

	$out = '';
	foreach ( $map as $attr_key => $shortcode_key ) {
		$value = isset( $attrs[ $attr_key ] ) ? (string) $attrs[ $attr_key ] : '';
		if ( '' === $value ) {
			continue;
		}
		if ( ! in_array( $value, array( 'true', 'false' ), true ) ) {
			continue;
		}
		$out .= sprintf( ' %s="%s"', $shortcode_key, esc_attr( $value ) );
	}
	return $out;
}

function bflm_build_zoom_bounds_attrs( array $attrs ): string {
	$out = '';

	$min_zoom = isset( $attrs['minZoom'] ) ? (string) $attrs['minZoom'] : '';
	$max_zoom = isset( $attrs['maxZoom'] ) ? (string) $attrs['maxZoom'] : '';
	$bounds   = isset( $attrs['maxBounds'] ) ? (string) $attrs['maxBounds'] : '';

	if ( '' !== $min_zoom && is_numeric( $min_zoom ) ) {
		$out .= sprintf( ' min_zoom="%s"', esc_attr( $min_zoom ) );
	}
	if ( '' !== $max_zoom && is_numeric( $max_zoom ) ) {
		$out .= sprintf( ' max_zoom="%s"', esc_attr( $max_zoom ) );
	}
	if ( '' !== $bounds ) {
		$out .= sprintf( ' maxbounds="%s"', esc_attr( $bounds ) );
	}

	return $out;
}

function bflm_build_tile_layer_attrs( array $attrs ): string {
	$out = '';

	if ( isset( $attrs['tileurl'] ) && '' !== $attrs['tileurl'] ) {
		$out .= sprintf( ' tileurl="%s"', esc_attr( (string) $attrs['tileurl'] ) );
	}
	if ( isset( $attrs['tilesize'] ) && '' !== $attrs['tilesize'] && is_numeric( $attrs['tilesize'] ) && (int) $attrs['tilesize'] >= 1 ) {
		$out .= sprintf( ' tilesize="%d"', (int) $attrs['tilesize'] );
	}
	if ( isset( $attrs['subdomains'] ) && '' !== $attrs['subdomains'] ) {
		$out .= sprintf( ' subdomains="%s"', esc_attr( (string) $attrs['subdomains'] ) );
	}
	if ( isset( $attrs['mapid'] ) && '' !== $attrs['mapid'] ) {
		$out .= sprintf( ' mapid="%s"', esc_attr( (string) $attrs['mapid'] ) );
	}
	if ( isset( $attrs['accesstoken'] ) && '' !== $attrs['accesstoken'] ) {
		$out .= sprintf( ' accesstoken="%s"', esc_attr( (string) $attrs['accesstoken'] ) );
	}
	if ( isset( $attrs['zoomoffset'] ) && '' !== $attrs['zoomoffset'] && is_numeric( $attrs['zoomoffset'] ) ) {
		$out .= sprintf( ' zoomoffset="%d"', (int) $attrs['zoomoffset'] );
	}
	if ( isset( $attrs['nowrap'] ) && in_array( (string) $attrs['nowrap'], array( 'true', 'false' ), true ) ) {
		$out .= sprintf( ' nowrap="%s"', esc_attr( (string) $attrs['nowrap'] ) );
	}
	if ( isset( $attrs['detectretina'] ) && in_array( (string) $attrs['detectretina'], array( 'true', 'false' ), true ) ) {
		$out .= sprintf( ' detect_retina="%s"', esc_attr( (string) $attrs['detectretina'] ) );
	}

	return $out;
}
```

**New WP function used here that plan 009's bootstrap does NOT yet shim**:
`esc_attr()` — used by `bflm_build_interaction_attrs()`,
`bflm_build_zoom_bounds_attrs()`, and `bflm_build_tile_layer_attrs()`. Plan
009's bootstrap shims `absint`, `wp_unslash`, `sanitize_text_field`,
`wp_strip_all_tags`, `wp_kses_post`, `wp_kses` — but NOT `esc_attr`. This
plan must add it (Step 1).

`bflm_normalise_dimension()` and `bflm_normalise_map_attrs()` are ALREADY
covered indirectly by plan 009 (via `bflm_normalise_dimension()` being
`require`'d in the bootstrap and exercised through
`bflm_preview_normalise_input()`'s `height` handling) — but plan 009 does not
test `bflm_normalise_dimension()` DIRECTLY with its full range of inputs, nor
does it test `bflm_normalise_map_attrs()` at all (that function is specific
to block-attribute input, not `$_GET`/preview input). This plan covers both
directly.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Run the new test suite | `composer test -- tests/includes/shortcodes/test-attrs.php` or `vendor/bin/phpunit tests/includes/shortcodes/test-attrs.php` | all tests pass |
| Run the FULL suite (009 + 010) | `composer test` | all tests pass |
| PHP syntax check (fallback) | `php -l tests/includes/shortcodes/test-attrs.php` | `No syntax errors detected` |

## Scope

**In scope**:
- `tests/bootstrap.php` — ADD an `esc_attr()` shim (extending plan 009's
  file, per its "Maintenance notes": "EXTEND the shim in
  `tests/bootstrap.php` ... don't create a second, divergent shim").
- `tests/includes/shortcodes/test-attrs.php` — new test file (this plan's
  main deliverable).

**Out of scope**:
- `includes/shortcodes/attrs.php` itself — NO production code changes. Same
  characterization-test philosophy as plan 009: if a test reveals
  surprising-but-intentional behaviour, document it with a `// NOTE:`
  comment and assert CURRENT behaviour; if it looks like a genuine bug, flag
  it in your report without fixing it.
- `includes/shortcodes/map.php`, `marker.php`, `line.php`, `circle.php`,
  `layer.php`, `overlay.php` — these call the functions tested here but
  build full shortcode STRINGS with additional concerns (escaping entire
  attribute lists, conditional tag emission). Testing them would require a
  much larger fixture surface and is not part of this plan. If, after
  completing this plan, the operator wants shortcode-builder-level tests,
  that would be a follow-up plan (note it in your report as a possible
  future item, but do not write it now).
- `tests/bootstrap.php`'s EXISTING shims (`absint`, `wp_unslash`,
  `sanitize_text_field`, `wp_kses_post`, `wp_kses`) — do not modify these,
  only ADD `esc_attr`.
- `phpunit.xml.dist`, `composer.json` — already configured by plan 009, no
  changes needed (the `<directory>tests</directory>` testsuite glob already
  picks up the new file automatically).

## Git workflow

- Branch: `test/phpunit-attrs` (separate from plan 009's branch — if plan 009
  has already been merged, branch from the post-009 state; if not yet merged,
  this plan cannot proceed — see "STOP conditions")
- One commit (bootstrap addition + new test file together, since the bootstrap
  change is purely additive and only meaningful in service of this test file).
- Commit message style: `test: add PHPUnit characterization tests for shortcode attrs normalisation`
- Do NOT push or open a PR unless explicitly instructed.

## Steps

### Step 0: Confirm plan 009's infrastructure exists

```bash
test -f tests/bootstrap.php && test -f phpunit.xml.dist && grep -q '"test"' composer.json && echo OK
```

**Verify**: prints `OK`. If any of these are missing, STOP — plan 009 has not
been executed yet (see "Depends on").

### Step 1: Add `esc_attr()` shim to `tests/bootstrap.php`

Append to `tests/bootstrap.php` (before the final `require_once` lines that
load the files under test — shims must be defined before the files that use
them are loaded, though in PHP function-existence is resolved at call-time
not load-time, so technical ordering doesn't strictly matter, but keep all
shims grouped together for readability):

```php
/**
 * Shim: esc_attr().
 * Core behaviour: htmlspecialchars() with ENT_QUOTES, plus a filter hook
 * (`attribute_escape`) and a check for already-escaped `&#0-9;` sequences.
 * SIMPLIFICATION: this shim is htmlspecialchars( $str, ENT_QUOTES ) only —
 * no filter hook (no `apply_filters` shim exists or is needed for these
 * tests) and no special-casing of pre-escaped entities. Sufficient for all
 * test inputs in this suite, which are plain strings/numerics without
 * pre-existing HTML entities.
 */
if ( ! function_exists( 'esc_attr' ) ) {
	function esc_attr( $text ) {
		return htmlspecialchars( (string) $text, ENT_QUOTES );
	}
}
```

**Verify**: `php -l tests/bootstrap.php` → `No syntax errors detected`. Then
`grep -c "function esc_attr" tests/bootstrap.php` → `1`.

### Step 2: Write `tests/includes/shortcodes/test-attrs.php`

Test class extends `PHPUnit\Framework\TestCase` (same convention as plan
009). Cover at minimum these cases (derive exact expected values by reading
the "Current state" excerpt above):

**`bflm_normalise_dimension( $raw, $default )`**:

1. **Numeric input** (e.g. `100`, `'100'`, `45.5`) → `is_numeric()` is true →
   appends `'px'` → `'100px'`, `'100px'`, `'45.5px'`. Note: the regex
   `^\d+(\.\d+)?(px|%|vh|vw|em|rem)$` then validates this — `'100px'` matches,
   so it's returned as-is.
2. **Valid CSS units**: `'400px'`, `'50%'`, `'80vh'`, `'100vw'`, `'2em'`,
   `'1.5rem'` → each returned unchanged (regex matches, no `%` clamping
   needed for ≤100).
3. **`%` clamping**: `'150%'` → `'100%'` (clamped, per
   `str_ends_with($value,'%') && (float)$value > 100`). `'100%'` → `'100%'`
   (NOT > 100, returned as-is — boundary case, assert it does NOT fall into
   the clamp branch unnecessarily, though the result is the same either way —
   the point is `'100.0%'` style edge cases aren't mangled). `'99.9%'` →
   `'99.9%'` (unchanged).
4. **Invalid format** → falls back to `$default`: `'abc'`, `''`, `'100'`
   WAIT — `'100'` is numeric (case 1), so it becomes `'100px'`, which is
   valid. Use genuinely invalid strings instead: `'100xyz'`, `'calc(100% - 10px)'`,
   `'  100px  '` (note: NOT trimmed before the regex — leading/trailing
   whitespace makes the regex fail, since `^` and `$` anchor to the whole
   (untrimmed) string — confirm this produces `$default`, and add a `// NOTE:`
   comment that whitespace is NOT tolerated, which may or may not be
   intentional).
5. **Non-numeric, non-string input** (e.g. `null`, `true`, an array) — `(string)
   $raw` casts: `null` → `''` (invalid → default), `true` → `'1'` (is this
   `is_numeric(true)`? NO — `is_numeric()` returns `false` for booleans, so
   it goes to `sanitize_text_field((string) true)` = `sanitize_text_field('1')`
   = `'1'`, which does NOT match the regex (no unit) → returns `$default`).
   An array input would trigger a PHP warning/error on `(string) $raw` in
   PHP 8 (array to string conversion) — DO NOT test array input (would emit
   a deprecation notice that could fail strict PHPUnit error-handling config;
   skip this edge case and note it as "not tested — would require error
   suppression" in a comment).
6. **Custom `$default`**: call with a different `$default` value (e.g.
   `bflm_normalise_dimension('garbage', '50%')`) → returns `'50%'`, confirming
   the parameter (not a hardcoded `'400px'`) is what's returned.

**`bflm_normalise_map_attrs( array $attrs )`**:

7. **Empty array** → `lat=0.0`, `lng=0.0`, `zoom=12`, `height='400px'`,
   `width='100%'`, `scrollWheelZoom=false`, `zoomControl=true`,
   `fitMarkers=false`, `showScale=false`, `attribution=''`, `imageMap=false`,
   `wmsEnabled=false`, `imageSrc=''`, `imageX=0.0`, `imageY=0.0`,
   `imageZoom=0.0`, `wmsSource=''`, `wmsLayer=''`, `wmsCrs=''`.
8. **`$out = $attrs` passthrough of UNRECOGNISED keys**: pass
   `['lat'=>1, 'someCustomKey'=>'value']` → assert `$out['someCustomKey'] ===
   'value'` is STILL present in the output (the function does `$out = $attrs`
   first, then overwrites known keys — unrecognised keys pass through
   unchanged). This is an important characterization: the function does NOT
   strip unknown keys.
9. **`zoomControl` — boolean-`false`-only check**: `zoomControl` defaults to
   `true`. ONLY the literal PHP boolean `false` (`=== false`, strict) flips it
   to `false`. Test: `['zoomControl' => false]` → `false`; `['zoomControl' =>
   0]` → `true` (NOT strictly `=== false`, an `int` `0`, so stays `true`!);
   `['zoomControl' => '']` → `true`; `['zoomControl' => true]` → `true`;
   absent → `true`. This is DIFFERENT from `includes/preview/input.php`'s
   `zoomControl` logic (which checks the STRING `'false'`) — these are two
   different functions with two different conventions for the same
   conceptual flag (one consumes `$_GET` strings, one consumes block-attribute
   values which are real PHP booleans from Gutenberg's `attributes` schema).
   Add a `// NOTE:` comment explaining this divergence is intentional
   (different input sources).
10. **`imageMap`/`wmsEnabled` mutual exclusivity** (same pattern as plan 009
    case 9, but with REAL booleans not strings): `['imageMap' => true,
    'wmsEnabled' => true]` → `imageMap=true`, `wmsEnabled=false` (guarded by
    `! $out['imageMap'] &&`).
11. **`imageSrc`/`imageX`/etc. gating by `imageMap`**: same pattern as plan
    009 case 8 but with real types: `['imageMap' => true, 'imageSrc' => '
    foo.jpg ', 'imageX' => '10.5']` → `imageSrc='foo.jpg'` (trimmed),
    `imageX=10.5` (float-cast from string). Without `imageMap`, these fields
    are `''`/`0.0` regardless of presence in `$attrs`.
12. **`attribution` — plain `(string)` cast, NO `wp_kses_post`**: unlike
    `includes/preview/input.php`'s `attribution` handling (which applies
    `wp_kses_post()`), THIS function does `(string) $attrs['attribution']` —
    no sanitization at all. Test: `['attribution' => '<script>x</script>']` →
    `'<script>x</script>'` UNCHANGED (passed through verbatim). Add a
    `// NOTE:` comment: this function is for NORMALISING TYPES/SHAPES; actual
    output-escaping happens later in the shortcode builders (e.g.
    `includes/shortcodes/map.php` applies `wp_kses_post()` when building the
    `[leaflet-map attribution='...']` shortcode, per this repo's documented
    "Key Technical Decisions" about the attribution field). Confirm this by
    reading `includes/shortcodes/map.php`'s attribution handling if you want
    extra confidence, but the assertion here is just about THIS function's
    behaviour.

**`bflm_build_interaction_attrs( array $attrs )`**:

13. **Empty array** → `''` (empty string — no attrs set, all 7 keys
    default to `''` which is skipped).
14. **All 7 keys `'true'`**: `['dragging'=>'true', 'keyboard'=>'true',
    'doubleClickZoom'=>'true', 'boxZoom'=>'true',
    'closePopupOnClick'=>'true', 'tap'=>'true', 'inertia'=>'true']` →
    `' dragging="true" keyboard="true" doubleclickzoom="true"
    boxzoom="true" closepopuponclick="true" tap="true" inertia="true"'`
    (note the shortcode-key RENAMES: `doubleClickZoom`→`doubleclickzoom`,
    `boxZoom`→`boxzoom`, `closePopupOnClick`→`closepopuponclick` — all
    lowercased, no underscores. CLAUDE.md's "Shortcode attribute
    case-sensitivity bug" note explains WHY: WordPress lowercases shortcode
    attrs, so these MUST be lowercase to match Leaflet Map's checks).
15. **Mixed/invalid values**: `['dragging'=>'true', 'keyboard'=>'yes',
    'boxZoom'=>'false', 'tap'=>1]` → only `dragging` and `boxZoom` produce
    output (`'yes'` and `1` (int, cast to `'1'`) are neither `'true'` nor
    `'false'`, so skipped): `' dragging="true" boxzoom="false"'`.
16. **`esc_attr()` is applied**: not directly observable with `'true'`/`'false'`
    values (no special chars), but confirm via the shim — `esc_attr('true')
    === 'true'` (htmlspecialchars no-op on this string). No additional test
    needed beyond what's already covered, but mention in a comment that
    `esc_attr` is exercised (even if trivially) by every passing case.

**`bflm_build_zoom_bounds_attrs( array $attrs )`**:

17. **Empty array** → `''`.
18. **Valid numeric `minZoom`/`maxZoom`**: `['minZoom'=>'3', 'maxZoom'=>'18']`
    → `' min_zoom="3" max_zoom="18"'`.
19. **Non-numeric `minZoom`/`maxZoom` skipped**: `['minZoom'=>'abc']` → `''`
    (fails `is_numeric()`).
20. **`maxBounds` — any non-empty string passes** (no numeric check, unlike
    min/max zoom): `['maxBounds'=>'45.0,7.0;46.0,8.0']` →
    `' maxbounds="45.0,7.0;46.0,8.0"'`.
21. **All three combined**, confirming ORDER (`min_zoom`, then `max_zoom`,
    then `maxbounds`): `['minZoom'=>'2','maxZoom'=>'10','maxBounds'=>'1,1;2,2']`
    → `' min_zoom="2" max_zoom="10" maxbounds="1,1;2,2"'`.

**`bflm_build_tile_layer_attrs( array $attrs )`**:

22. **Empty array** → `''`.
23. **`tileurl` with template placeholders preserved**: `['tileurl' =>
    'https://{s}.tile.example/{z}/{x}/{y}.png']` → the `{`/`}` characters are
    NOT escaped by `esc_attr()`/`htmlspecialchars` (they're not among
    `&"'<>`), so output is
    `' tileurl="https://{s}.tile.example/{z}/{x}/{y}.png"'` UNCHANGED. This is
    the case the file's own docblock comment explains (why `esc_attr` not
    `esc_url_raw`) — confirm it holds with the shim.
24. **`tilesize` — integer validation, `>= 1` required**: `['tilesize' =>
    '256']` → `' tilesize="256"'`. `['tilesize' => '0']` → `''` (fails `>= 1`).
    `['tilesize' => '-5']` → `''` (fails `>= 1`... actually `(int)'-5' = -5`,
    `-5 >= 1` is false, so skipped — confirm). `['tilesize' => 'abc']` → `''`
    (fails `is_numeric`).
25. **`zoomoffset` — `(int)` cast, NO `>= 1` requirement (unlike `tilesize`)**:
    `['zoomoffset' => '-2']` → `' zoomoffset="-2"'` (negative allowed!
    different validation from `tilesize`). `['zoomoffset' => '0']` →
    `' zoomoffset="0"'` (zero allowed — `'' !== '0'` is true, `is_numeric('0')`
    is true, so it passes through — `(int) '0' === 0`, `sprintf(' zoomoffset="%d"', 0)`
    = `' zoomoffset="0"'`).
26. **`nowrap`/`detectretina` — strict `'true'`/`'false'` whitelist**, with
    `detectretina` renamed to `detect_retina` (underscore) in output:
    `['nowrap'=>'true', 'detectretina'=>'false']` →
    `' nowrap="true" detect_retina="false"'`. `['detectretina'=>'yes']` →
    `''` (not in whitelist, skipped).
27. **All fields combined**, confirming emission ORDER matches source order
    (`tileurl`, `tilesize`, `subdomains`, `mapid`, `accesstoken`,
    `zoomoffset`, `nowrap`, `detect_retina`): construct one `$attrs` array
    with all 8 keys set to valid values and assert the full concatenated
    output string matches that exact order.

Use `@dataProvider` for the parametrized variants (cases 1-6, 14-15, 24-26)
to keep the file manageable. Use clear method names (e.g.
`test_normalise_dimension_clamps_percent_over_100`,
`test_build_tile_layer_attrs_preserves_template_placeholders_in_tileurl`).

**Verify**: `vendor/bin/phpunit tests/includes/shortcodes/test-attrs.php` →
all tests green.

### Step 3: Run the FULL suite (009 + 010 together)

```bash
composer test
```

**Verify**: exit 0, all tests from BOTH plan 009's `test-input.php` and this
plan's `test-attrs.php` pass — confirms the shared `tests/bootstrap.php`
(with the new `esc_attr` shim added) doesn't break plan 009's existing tests.

## Test plan

This plan IS the test plan — Step 2 enumerates 27 test cases (cases 1-6
for `bflm_normalise_dimension`, 7-12 for `bflm_normalise_map_attrs`, 13-16
for `bflm_build_interaction_attrs`, 17-21 for `bflm_build_zoom_bounds_attrs`,
22-27 for `bflm_build_tile_layer_attrs`). The executor may add more if reading
the source reveals additional edge cases worth locking in.

## Done criteria

ALL must hold:

- [ ] `tests/bootstrap.php` has an `esc_attr()` shim added (additive only —
      existing shims from plan 009 unchanged).
- [ ] `tests/includes/shortcodes/test-attrs.php` exists, covers all 27 cases
      listed in Step 2 (or documents why a case was split/merged/expanded),
      grouped into 5 logical sections (one per function under test).
- [ ] `composer test` (full suite, both plan 009's and this plan's test
      files) exits 0 with all tests passing — OR, if `vendor/` is
      unavailable, `php -l` passes on all new/changed PHP files and this is
      noted in the report.
- [ ] `includes/shortcodes/attrs.php` is UNCHANGED (`git diff --stat` does
      not show this file).
- [ ] `plans/README.md` status row for plan 010 updated to DONE.

## STOP conditions

Stop and report back (do not improvise) if:

- `tests/bootstrap.php` or `phpunit.xml.dist` (from plan 009) do not exist —
  plan 009 must run first (see "Depends on").
- `includes/shortcodes/attrs.php` does not match the "Current state" excerpt
  — re-derive expected test values from the LIVE file rather than this
  plan's excerpt, or stop if the change is large enough that this plan's
  case list (Step 2) no longer makes sense.
- Any test case reveals a behaviour that looks like a genuine BUG rather than
  "surprising but as-designed" (e.g. case 9's `zoomControl` int-`0`-vs-bool-
  `false` distinction IS as-designed, per the strict `=== false` check — but
  if some OTHER case produces a fatal error, an infinite loop, or a value
  that would break a downstream shortcode builder in an obviously-unintended
  way) — write the test asserting CURRENT behaviour, do NOT fix it, and flag
  it prominently in your report.
- Adding the `esc_attr()` shim to `tests/bootstrap.php` causes any of plan
  009's EXISTING tests to fail (it shouldn't — `esc_attr` wasn't previously
  defined and plan 009's `test-input.php` doesn't call any function that uses
  `esc_attr`, but verify with Step 3's full-suite run). If it does, the two
  plans' shims may be conflicting — report rather than modifying plan 009's
  test file to "fix" it.

## Maintenance notes

- This plan + plan 009 together give `tests/bootstrap.php` shims for:
  `absint`, `wp_unslash`, `sanitize_text_field`, `wp_strip_all_tags`,
  `wp_kses_post`, `wp_kses`, `esc_attr`. Future test files for OTHER
  `includes/` functions will likely need to extend this list further
  (`esc_url`, `esc_html`, `wp_safe_remote_get`, etc., depending on what's
  tested next) — always extend the ONE shared bootstrap file, never fork it.
- If plan 005 (overlay `src` → `esc_url()`) lands and a future test plan
  covers `includes/shortcodes/overlay.php`, it will need an `esc_url()` shim
  — not needed by this plan, just noting the likely next addition.
- A reviewer should scrutinize: case 9's documentation of the
  `zoomControl` semantic DIVERGENCE between `bflm_normalise_map_attrs()`
  (strict `=== false` check on a real PHP boolean) and
  `bflm_preview_normalise_input()` (string `'false'` check, covered in plan
  009) — these are two genuinely different conventions for conceptually the
  same flag, driven by their different input sources (Gutenberg block
  attributes vs. `$_GET` query strings). If a future refactor tries to
  "unify" these two functions' attribute handling, this divergence is the
  single most important thing to preserve correctly (or deliberately
  reconcile, with both call sites updated in lockstep).
