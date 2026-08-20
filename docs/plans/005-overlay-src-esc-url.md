# Plan 005: Validate image/video overlay src as a URL in the shortcode builder

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 313481a..HEAD -- includes/shortcodes/overlay.php`
> If this file changed since this plan was written, compare the "Current
> state" excerpt against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `313481a`, 2026-06-12
- **Issue**: none (proactive hardening, found during /improve audit)

## Why this matters

`includes/shortcodes/overlay.php` builds `[leaflet-image-overlay]` /
`[leaflet-video-overlay]` shortcodes from block attributes. The `src`
attribute (the image/video URL, normally chosen via the WordPress media
library, but stored as a free-text string in block attributes) is currently
escaped with `esc_attr()` only. `esc_attr()` HTML-attribute-encodes special
characters but does NOT validate that the value is a safe URL — it would
happily encode a `javascript:...` or other non-`http(s)` scheme into a
syntactically-valid shortcode attribute. `esc_url()` (or `esc_url_raw()` for
non-display contexts) is the WordPress-standard function for URL output and
additionally strips dangerous schemes.

This is defense-in-depth: the actual rendering of the `src` into an `<img>`
or `<video>` tag happens inside the upstream "Leaflet Map" plugin (not in
this codebase), so the practical exploitability depends on that plugin's own
handling. Regardless, `esc_url()` is the correct WPCS pattern for any
attribute that represents a URL, and this repo's CLAUDE.md mandates
`esc_url()` for URL output.

## Current state

`includes/shortcodes/overlay.php`, full relevant excerpt:

```php
// includes/shortcodes/overlay.php:22-42
function bflm_build_overlay_shortcodes( array $overlays ): string {
    $out = '';

    foreach ( $overlays as $overlay ) {
        $src    = isset( $overlay['src'] ) ? trim( (string) $overlay['src'] ) : '';
        $bounds = isset( $overlay['bounds'] ) ? trim( (string) $overlay['bounds'] ) : '';
        if ( '' === $src || '' === $bounds ) {
            continue;
        }

        $tag_name = ( isset( $overlay['type'] ) && 'video' === $overlay['type'] )
            ? 'leaflet-video-overlay'
            : 'leaflet-image-overlay';

        $tag = sprintf(
            '[%s src="%s" bounds="%s"',
            $tag_name,
            esc_attr( $src ),
            esc_attr( $bounds )
        );
```

`$bounds` is a coordinate-pair string (e.g. `"45.0,7.0;46.0,8.0"`), not a
URL — `esc_attr()` remains correct for it and should NOT be changed.
`$src` is the one that needs `esc_url()`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| PHP syntax check | `php -l includes/shortcodes/overlay.php` | `No syntax errors detected` |
| Manual smoke test | See Step 2 | image/video overlay still renders on frontend + editor preview |

## Scope

**In scope** (the only file you should modify):
- `includes/shortcodes/overlay.php`

**Out of scope**:
- `$bounds` (line 40 / `esc_attr( $bounds )`) — this is a coordinate string,
  not a URL. Do not change it.
- Other shortcode builder files (`marker.php`, `line.php`, `circle.php`,
  `layer.php`, `map.php`) — none of their string-typed fields represent URLs
  in the same way (verify this is still true by grepping for `src` / `url`
  in those files if curious, but no changes needed there for this plan).
- `includes/shortcodes/attrs.php` — `bflm_build_tile_layer_attrs()` there
  intentionally uses `esc_attr()` instead of `esc_url()`/`esc_url_raw()` for
  `tileurl`, with an explicit comment explaining why (`esc_url_raw()` would
  strip the `{s}/{z}/{x}/{y}` template placeholders). Do not "fix" that —
  it's correct as-is and a different situation (template URL vs. a concrete
  media file URL).

## Git workflow

- Branch: `fix/overlay-src-esc-url` (or bundle with plans 003/004 into a
  single security-hardening branch if the operator prefers — but each
  plan's commit should remain separable)
- One commit. Message style: `fix: validate overlay src as URL with esc_url()`
- Do NOT push or open a PR unless explicitly instructed.

## Steps

### Step 1: Change `esc_attr( $src )` to `esc_url( $src )`

In `includes/shortcodes/overlay.php`, in the `sprintf()` call building the
shortcode tag (around lines 36-41), change:

```php
$tag = sprintf(
    '[%s src="%s" bounds="%s"',
    $tag_name,
    esc_attr( $src ),
    esc_attr( $bounds )
);
```

to:

```php
$tag = sprintf(
    '[%s src="%s" bounds="%s"',
    $tag_name,
    esc_url( $src ),
    esc_attr( $bounds )
);
```

Only the `esc_attr( $src )` → `esc_url( $src )` change on the `src` line.
Leave `esc_attr( $bounds )` unchanged.

**Verify**: `grep -n "esc_url( \$src )\|esc_attr( \$src )" includes/shortcodes/overlay.php`
→ shows `esc_url( $src )` and does NOT show `esc_attr( $src )`.

### Step 2: Manual smoke test

1. In the block editor, add an Image Overlay or Video Overlay (use the
   block's overlay controls in the sidebar) with a real image/video URL from
   the media library, plus a bounds value.
2. Check the editor preview iframe — the overlay should render on the map.
3. Save/publish the post and view the frontend — the overlay should render
   there too.

**Verify**: The overlay image/video displays correctly in both the editor
preview and the frontend, identical to before the change — `esc_url()`
should pass through any well-formed `http://` or `https://` media URL
unchanged (it only strips disallowed schemes and encodes a small set of
characters, both no-ops for normal media library URLs).

Additionally, confirm `esc_url()` behavior for a deliberately malicious value
via WP-CLI (no browser needed):

```bash
wp eval "echo esc_url( 'javascript:alert(1)' );"
```

**Verify**: output is empty (or not a `javascript:` URL) — `esc_url()`
strips disallowed schemes, unlike `esc_attr()` which would have passed
`javascript:alert(1)` through unchanged (HTML-encoded but still a
`javascript:` URL string).

## Test plan

No PHPUnit suite currently covers `includes/shortcodes/`. If plan 010 (tests
for `includes/shortcodes/attrs.php`) is implemented and this plan lands
first, consider adding a similar test file
`tests/includes/shortcodes/test-overlay.php` with a case asserting that
`bflm_build_overlay_shortcodes()` strips a `javascript:` scheme from `src` —
but this is OPTIONAL and not required for this plan's "Done criteria". Do
not block on plan 010.

## Done criteria

ALL must hold:

- [ ] `includes/shortcodes/overlay.php` modified ONLY on the `esc_attr( $src
      )` → `esc_url( $src )` line — `git diff` shows a single-line change.
- [ ] `php -l includes/shortcodes/overlay.php` → `No syntax errors detected`.
- [ ] Step 2's smoke test confirms a real overlay image/video URL still
      renders correctly in both editor preview and frontend.
- [ ] Step 2's WP-CLI check confirms `esc_url('javascript:alert(1)')`
      produces empty/non-`javascript:` output.
- [ ] No files outside `includes/shortcodes/overlay.php` are modified.
- [ ] `plans/README.md` status row for plan 005 updated to DONE.

## STOP conditions

Stop and report back (do not improvise) if:

- The `sprintf()` call in `bflm_build_overlay_shortcodes()` does not match
  the "Current state" excerpt (different argument order, different escaping
  function already in place, etc.) — the file may have changed since this
  plan was written.
- After the change, Step 2's smoke test shows a previously-working overlay
  URL no longer renders. `esc_url()` can strip query strings or fragments in
  some edge cases if they contain disallowed characters — if a real media
  library URL is affected, report the exact URL pattern that broke (without
  including any sensitive query parameters if present) rather than reverting
  silently.

## Maintenance notes

- If a future overlay type adds another URL-typed field (e.g. a separate
  thumbnail URL), apply `esc_url()` to it too, following this same pattern.
- A reviewer should scrutinize: `esc_url()` defaults to allowing
  `http`, `https`, `ftp`, `ftps`, `mailto`, `news`, `irc`, `gopher`, `nntp`,
  `feed`, `telnet`, `mms`, `rtsp`, `svn`, `tel`, `fax`, `xmpp` schemes (the
  default `kses` allowed-protocols list). For an image/video overlay, only
  `http`/`https` (and possibly `data:` for inline images, though unlikely
  here) are realistic — if a future need arises to further restrict to
  `http`/`https` only, that would require `wp_kses_bad_protocol()` with a
  custom protocol list rather than plain `esc_url()`. Not needed for this
  plan, but worth knowing if overlay misuse is reported later.
