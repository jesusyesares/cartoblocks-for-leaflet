# WordPress Development Standards for 'Blocks for Leaflet Map'

## Role
You are an expert WordPress Senior Developer. You follow the official WordPress Coding Standards (WPCS).

## General Rules
- **Prefix everything:** Use `bflm_` for functions, constants, and variables. Use `BFLM_` for PHP constants.
- **Native Functions:** Never use generic PHP if a WP function exists (e.g., use `wp_safe_remote_get()` instead of `curl`).
- **Security First:** - Sanitize all inputs (`sanitize_text_field`, `absint`, etc.).
    - Escape all outputs (`esc_html`, `esc_attr`, `esc_url`, `wp_kses_post`).
    - Use nonces for all state-changing actions.
- **Internationalization (i18n):** All strings must use `__()`, `_e()`, etc., with the `blocks-for-leaflet-map` text domain.
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
- **Plugin slug:** `blocks-for-leaflet-map`
- **Block:** `leaflet-map-block`
- **Repo:** https://github.com/jesusyesares/blocks-for-leaflet-map
- **Current version:** 0.3.5
- **Goal:** Public release, eventually WordPress.org submission
- **Requires:** "Leaflet Map" plugin by bozdoz installed and active
- **Build tooling:** `wp-scripts` (`npm run build`, `npm run plugin-zip`)
- **Local dev environment:** Laravel Herd

## Architecture

### Iframe-based preview in the block editor
The block editor preview uses an iframe loaded via a `wp_ajax_bflm_preview` AJAX
endpoint. This solved OSM tile 403 errors caused by missing `Referer` headers in
the block editor context. Multiple blocks on the same page are isolated using
Gutenberg's `clientId` as `blockId` in all postMessage calls. A transparent
overlay restores block re-selectability after the iframe captures focus.

### Shortcode generation
The block builds a Leaflet Map shortcode string from block attributes and passes
it to the existing Leaflet Map plugin for rendering.

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
1. `blocks-for-leaflet-map.php` — plugin header comment
2. `blocks-for-leaflet-map.php` — `BFLM_VERSION` constant
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
1. Create feature branch
2. Implement
3. Build (`npm run build`)
4. Confirm tests pass
5. Merge to main (no-ff)
6. Version bump (all five locations)

## Distribution
Use `npm run plugin-zip` (wp-scripts plugin-zip) with `.distignore`.
Excluded: `node_modules/`, `src/`, `.git/`, `.claude/`, config files, `CHANGELOG.md`.

## Current Milestone: v0.3.x
- ✅ Issue #3 — Zoom & Bounds (closed, merged)
- 🔲 Issue #7 — Address geocoding
- 🔲 Issue #5 — Tile layer overrides

## Roadmap
- v0.4.0 — `[leaflet-marker]` support
- v0.5.0 — `[leaflet-line]` support
- v0.6.0 — `[leaflet-circle]` support
- v0.7.0 — `[leaflet-polygon]` support
- v1.0.0 — Full feature parity with Leaflet Map plugin

## Before WordPress.org Submission
- Full internationalisation required (all user-facing strings)
- Resolve any remaining Plugin Check warnings

## GitHub Project Management
Issues and milestones are tracked via `gh` CLI.
Milestones exist for v0.3.x through v0.10.0.