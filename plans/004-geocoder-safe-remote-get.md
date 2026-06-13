# Plan 004: Use wp_safe_remote_get() in the geocoding AJAX endpoint

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 313481a..HEAD -- includes/geocoder.php`
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

`includes/geocoder.php` makes an outbound HTTP request to the Nominatim
geocoding API using `wp_remote_get()`. WordPress security best practice
(and the WordPress.org plugin review guidelines) recommend
`wp_safe_remote_get()` for outbound requests: it adds protections against
DNS rebinding / SSRF via redirects to internal/private IP ranges
(`is_ip_in_range` checks against the
`WP_HTTP_BLOCK_EXTERNAL`/`WP_ACCESSIBLE_HOSTS` allowlist and rejects
redirects to private/loopback addresses).

The request URL here is built from a hardcoded
`https://nominatim.openstreetmap.org/...` host, so the practical risk is
low — but `wp_safe_remote_get()` is a strict drop-in superset of
`wp_remote_get()`'s behavior for safe (non-internal) targets, so this is a
zero-risk best-practice alignment that WordPress.org reviewers specifically
look for.

## Current state

`includes/geocoder.php`, lines 62-75:

```php
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
```

The repo's PHPDoc comment above `bflm_geocode_address()` already documents
the function's security posture (nonce check, capability check, input
sanitization) — this plan adds the remote-request hardening to match.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| PHP syntax check | `php -l includes/geocoder.php` | `No syntax errors detected` |
| PHPCS (if `vendor/` installed) | `composer lint` | exit 0, or pre-existing warnings only — `geocoder.php` is not currently in `phpcs.xml`'s file list, so this may not cover it; that's expected and is addressed separately in plan 006 |
| Manual smoke test | See Step 2 | geocoding still returns results in the editor |

## Scope

**In scope** (the only file you should modify):
- `includes/geocoder.php`

**Out of scope**:
- Any other `wp_remote_get`/`wp_remote_post` usage in the codebase — search
  confirms `includes/geocoder.php:67` is the only outbound HTTP call in
  `includes/` and `src/leaflet-map-block/render.php`. If you find another
  occurrence elsewhere, do NOT change it as part of this plan — report it
  separately.
- `includes/class-tgm-plugin-activation.php` — vendored library, DO NOT
  MODIFY per this repo's CLAUDE.md, regardless of what HTTP functions it
  uses internally.

## Git workflow

- Branch: `fix/geocoder-safe-remote-get` (or bundle with plan 003/005 into a
  single `fix/security-hardening` branch if the operator prefers — but each
  plan's commit should remain separable)
- One commit. Message style: `fix: use wp_safe_remote_get for geocoding API request`
- Do NOT push or open a PR unless explicitly instructed.

## Steps

### Step 1: Replace `wp_remote_get` with `wp_safe_remote_get`

In `includes/geocoder.php`, change line 67 from:

```php
$response = wp_remote_get(
```

to:

```php
$response = wp_safe_remote_get(
```

No other changes to the function call's arguments or surrounding code are
needed — `wp_safe_remote_get()` has the same signature as `wp_remote_get()`.

**Verify**: `grep -n "wp_safe_remote_get\|wp_remote_get" includes/geocoder.php`
→ shows `wp_safe_remote_get` on line 67, and NO remaining occurrence of
`wp_remote_get` (without `safe_`) in this file.

### Step 2: Manual smoke test

1. In the block editor, open a `leaflet-map-block` and use its address
   search / geocoding UI (the field that calls the `bflm_geocode` AJAX
   action — look for an "Address" or "Search location" input in the block
   sidebar).
2. Enter a real-world address (e.g. "Eiffel Tower, Paris").

**Verify**: The geocoding request still returns candidate results (the UI
shows a list of matching locations to pick from), confirming
`wp_safe_remote_get()` successfully reaches `nominatim.openstreetmap.org`
(an external, non-private host — `wp_safe_remote_get()` only blocks
redirects to internal/private IP ranges, so a public API like Nominatim is
unaffected).

If a browser cannot be driven in your environment, you can alternatively
verify via WP-CLI from the plugin directory:

```bash
wp eval "var_dump( wp_safe_remote_get( 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=Paris', array( 'user-agent' => 'test' ) ) );" 2>&1 | head -5
```

**Verify**: output shows an array with `'response' => array('code' => 200, ...)`,
not a `WP_Error`.

## Test plan

No PHPUnit suite currently covers `includes/geocoder.php` (see plan 009/010
for the broader testing effort — those target `includes/preview/input.php`
and `includes/shortcodes/attrs.php` first, not this file). The manual/WP-CLI
smoke test in Step 2 is the verification for this plan.

## Done criteria

ALL must hold:

- [ ] `includes/geocoder.php` modified ONLY on line 67 (`wp_remote_get` →
      `wp_safe_remote_get`) — `git diff` shows a single-line change.
- [ ] `php -l includes/geocoder.php` → `No syntax errors detected`.
- [ ] Step 2's smoke test (browser or WP-CLI) confirms the geocoding request
      to `nominatim.openstreetmap.org` still succeeds.
- [ ] No files outside `includes/geocoder.php` are modified.
- [ ] `plans/README.md` status row for plan 004 updated to DONE.

## STOP conditions

Stop and report back (do not improvise) if:

- Line 67 of `includes/geocoder.php` is not `$response = wp_remote_get(` —
  the file may have changed since this plan was written; locate the correct
  line via `grep -n "wp_remote_get" includes/geocoder.php` and confirm it's
  the Nominatim request before changing it.
- After the change, Step 2's smoke test shows the geocoding request now
  FAILS where it previously succeeded. `wp_safe_remote_get()` should behave
  identically to `wp_remote_get()` for external hosts — a failure here would
  be unexpected and worth investigating before reporting DONE. Do not revert
  silently; report the failure with the `WP_Error` message if any.

## Maintenance notes

- If a future feature adds another outbound HTTP call (e.g. fetching tile
  layer metadata, or a different geocoding provider), use
  `wp_safe_remote_get()` / `wp_safe_remote_post()` from the start — this
  plan's change establishes that as the convention for this plugin.
- A reviewer should scrutinize: confirm the Nominatim contact-email /
  User-Agent conventions (lines 48-60, unchanged by this plan) are still
  correctly passed through to `wp_safe_remote_get()`'s `$args` array.
