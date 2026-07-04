# WordPress Development Standards for 'CartoBlocks for Leaflet'

## Role
You are an expert WordPress Senior Developer. You follow the official WordPress Coding Standards (WPCS).

## General Rules
- **Prefix everything:** Use `bflm_` for functions, constants, and variables. Use `BFLM_` for PHP constants.
- **Native Functions:** Never use generic PHP if a WP function exists (e.g., use `wp_safe_remote_get()` instead of `curl`).
- **Security First:** - Sanitize all inputs (`sanitize_text_field`, `absint`, etc.).
    - Escape all outputs (`esc_html`, `esc_attr`, `esc_url`, `wp_kses_post`).
    - Use nonces for all state-changing actions.
- **Internationalization (i18n):** All strings must use `__()`, `_e()`, etc., with the `cartoblocks-for-leaflet` text domain.
- **Database:** Use `$wpdb` and its methods. Never write raw SQL without `prepare()`.

## Block Development (Gutenberg)
- Use **apiVersion 3**.
- Follow modern React patterns (Hooks, Functional Components).
- Prioritize WordPress components from `@wordpress/components` and `@wordpress/block-editor`.

## Documentation
- Use JSDoc for JavaScript and PHPDoc for PHP.
- Code must be self-explanatory and clean.

## Project Overview
WordPress Gutenberg block plugin that wraps the "Leaflet Map" plugin by bozdoz,
converting its shortcodes into a single configurable Gutenberg block.
- **Plugin slug:** `cartoblocks-for-leaflet` (display name "CartoBlocks for Leaflet"; renamed from "Blocks for Leaflet Map" / `blocks-for-leaflet-map` for the wp.org Plugin Review trademark concern)
- **Block:** `cartoblocks-for-leaflet/leaflet-map-block` (inserter title "Map for Leaflet")
- **Repo:** https://github.com/jesusyesares/cartoblocks-for-leaflet (renombrado desde blocks-for-leaflet-map; la URL vieja redirige)
- **Current version:** 1.0.7 (released — internal modularization, v1.1.0 milestone)
- **Goal:** Public release, eventually WordPress.org submission
- **Requires:** "Leaflet Map" plugin by bozdoz installed and active
- **Build tooling:** `wp-scripts` (`npm run build`, `npm run plugin-zip`)
- **Local dev environment:** Laravel Herd

## Architecture

### File layout (post v1.1.0 modularization)

```
cartoblocks-for-leaflet.php          ~95 lines, bootstrap only
includes/
├── filetypes.php                    upload_mimes / wp_check_filetype_and_ext filters
├── geocoder.php                     bflm_geocode_address() + AJAX hook
├── editor-assets.php                bflm_localise_editor_script() + hook
├── preview/
│   ├── input.php                    bflm_preview_normalise_input() — pure $_GET sanitiser
│   ├── inline-assets.php            bflm_preview_inline_css() / *_bridge_js() / *_imagefit_js() — enqueued iframe CSS/JS
│   ├── template.php                 bflm_preview_render_template() — full HTML page emission (enqueues inline-assets)
│   └── endpoint.php                 bflm_preview_map() — nonce verification + orchestration
└── shortcodes/
    ├── attrs.php                    bflm_normalise_map_attrs() + interaction/zoom/tile helpers
    ├── map.php                      [leaflet-map] / [leaflet-wms] / [leaflet-image]
    ├── marker.php                   [leaflet-marker]
    ├── line.php                     [leaflet-line] / [leaflet-polygon] + draw-mode helpers
    ├── circle.php                   [leaflet-circle]
    ├── layer.php                    [leaflet-geojson] / [leaflet-gpx] / [leaflet-kml]
    └── overlay.php                  [leaflet-image-overlay] / [leaflet-video-overlay]
src/leaflet-map-block/
├── render.php                       ~105 lines, frontend template (calls shared builders)
├── edit.js                          7457 lines (defer to v1.2.0 modularization)
├── editor.scss
└── block.json
```

### Iframe-based preview in the block editor
The block editor preview uses an iframe loaded via a `wp_ajax_bflm_preview` AJAX
endpoint. This solved OSM tile 403 errors caused by missing `Referer` headers in
the block editor context. Multiple blocks on the same page are isolated using
Gutenberg's `clientId` as `blockId` in all postMessage calls. A transparent
overlay restores block re-selectability after the iframe captures focus.

### Shortcode generation — shared builders
Both `src/leaflet-map-block/render.php` (frontend) and
`includes/preview/template.php` (editor iframe) call the **same**
`bflm_build_*_shortcodes()` helpers in `includes/shortcodes/`. Any new
shortcode attribute must be added in one place — the corresponding builder
file — never duplicated inline.

### Preview-endpoint security boundary
Nonce verification lives in `includes/preview/endpoint.php` and runs **before**
any `$_GET` parsing. `includes/preview/input.php` is a pure sanitiser — no
`wp_die`, no `header`, no `echo`, no hook registration. This makes the input
function trivially testable and keeps the security check in one place.

### Leaflet Map dependency — native plugin dependencies
The "Leaflet Map" dependency is declared with the `Requires Plugins: leaflet-map`
header in `cartoblocks-for-leaflet.php` (WordPress 6.5+ native plugin
dependencies). WordPress core blocks activation until Leaflet Map is installed
and active and shows the install/activate prompt on the Plugins screen — no
vendored installer library. `bflm_is_leaflet_map_active()` remains as a
defensive runtime guard for edge cases (e.g. the dependency force-deactivated
mid-request). The former TGM Plugin Activation library was removed in the
v1.2.x cycle (replaced all 3 inline-`<style>` Plugin Review flags it carried).

## Key Technical Decisions

### Shortcode attribute case-sensitivity bug in Leaflet Map
WordPress lowercases all shortcode attribute names. Leaflet Map checks some
attributes only in camelCase. Affected attributes (`touchZoom`, `bounceAtZoomLimits`,
`zoomAnimation`, `fadeAnimation`, `markerZoomAnimation`, `worldCopyJump`) cannot
be set via shortcode. Decision: these controls are not implemented — no JS workarounds.

### Always review Leaflet Map source before implementing any attribute
Discovered that `attribution` HTML was mangled because `esc_attr()` was applied
on top of Leaflet Map's own `wp_kses_post()` sanitization. Fixed by using
`wp_kses_post()` directly and wrapping the attribution value in single quotes
in the shortcode string.

### Three-state model for boolean controls
All boolean attributes use Default / Enabled / Disabled. "Default" omits the
attribute from the shortcode entirely, letting Leaflet Map use its global settings.

### render.php Plugin Check warnings
Plugin Check reports false positives for variables in `render.php`. These are
known and outstanding — do not attempt to suppress them with workarounds that
break functionality.

## Version Bump Locations
All five locations must be updated on every release:
1. `cartoblocks-for-leaflet.php` — plugin header comment
2. `cartoblocks-for-leaflet.php` — `BFLM_VERSION` constant
3. `src/leaflet-map-block/block.json`
4. `readme.txt`
5. `package.json`

## Versioning Scheme
- Third digit: bug fixes / improvements within a feature
- Second digit: new shortcode feature added
- 1.0.0: full feature parity with Leaflet Map plugin
- No alpha/beta labels

## Development Protocol
Mandatory for every feature:
1. Create feature branch off `develop`
2. Implement
3. Build (`npm run build`)
4. Confirm tests pass (`npm test` + `composer test`)
5. Merge to `develop` (no-ff)
6. Version bump (all five locations) when cutting a release
7. `develop` → `main` + tag on release (currently kept in lockstep — `main` mirrors the latest tagged release)

## Distribution
Use `npm run plugin-zip` (wp-scripts plugin-zip) with `.distignore`.
Excluded: `node_modules/`, `src/`, `.git/`, `.claude/`, `plans/`, config files, `CHANGELOG.md`.

## Testing
- JS: `npm test` (Jest, via `@wordpress/scripts`)
- PHP: `composer test` (PHPUnit 9.6, `tests/` — 115 tests / 304 assertions as of 1.0.7)
- Lint/static analysis: `composer lint`, `composer phpstan` (covers `includes/`)

## Completed Milestone: v1.1.0 (released as 1.0.7)
- ✅ PR #21 — Extract shortcode builders to `includes/shortcodes/`
- ✅ PR #22 — Slim `render.php` to use shared builders (614 → 105 lines)
- ✅ PR #24 — Split `blocks-for-leaflet-map.php` into per-feature includes (1450 → 95 lines)
- ✅ PR #25/#26 — docs + version bump to 1.0.7
- ✅ Issue #23 — fitMarkers editor preview reload loop, fixed + smoke-tested
- ✅ PHPCS/PHPStan coverage expanded to `includes/`
- ✅ PHPUnit 9.6 suite added (`tests/`, 115 tests)
- ✅ Security hardening: postMessage origin validation, `wp_safe_remote_get` for geocoder, `esc_url` on overlay `src`
- ✅ `@wordpress/*` deps pinned to semver ranges; `.pot` regenerated

## Current Milestone: v1.2.0 — split `edit.js` into smaller modules
`src/leaflet-map-block/edit.js` is 7457 lines. Candidate module seams:
- Shortcode-builder / URL-building helpers (~lines 95–994)
- Iframe postMessage sync (~lines 1337–1700)
- Marker/line/circle attribute handlers (~lines 1702–2488)
- Geocoding UI (~lines 1161–1773)
- Remaining slimmer main edit component (~1500 lines)

## Roadmap
- v0.4.0 → v1.0.0 — completed (full shortcode parity)
- v1.1.0 — completed, released as 1.0.7 (internal modularization)
- **v1.2.0 — split `edit.js` into smaller modules (next)**
- v1.3.0+ — i18n completion + WordPress.org submission

## Before WordPress.org Submission
- Full internationalisation required (all user-facing strings) — `.pot` regenerated
  at 1.0.7 but coverage audit (untranslated strings) still pending
- Resolve any remaining Plugin Check warnings
- Issue #27 (GPX from Media Library not rendering) — root cause is upstream
  (Leaflet Map's `leaflet-ajax-geojson.js` / `Content-Type` for `.gpx`). Add a
  "Known Limitations" note to `readme.txt` and/or file upstream at
  bozdoz/wp-plugin-leaflet-map. Does not block submission.

## GitHub Project Management
Issues and milestones are tracked via `gh` CLI.
Milestones exist for v0.3.x through v0.10.0.