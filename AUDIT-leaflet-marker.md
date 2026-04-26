# [leaflet-marker] Shortcode Audit

## Source

| Item | Value |
|---|---|
| Primary file | `/wp-content/plugins/leaflet-map/shortcodes/class.marker-shortcode.php` |
| Base class | `/wp-content/plugins/leaflet-map/shortcodes/class.shortcode.php` |
| Shared helpers | `/wp-content/plugins/leaflet-map/class.leaflet-map.php` (methods: `add_popup_to_shape`, `json_sanitize`, `filter_float`) |
| Frontend JS | `/wp-content/plugins/leaflet-map/scripts/construct-leaflet-map.js` (method: `getIconOptions`) |
| Leaflet Map plugin version audited | **3.4.4** |

### How attribute parsing works (critical for reachability)

WordPress lowercases **all** shortcode attribute names before passing `$atts` to the handler.  
`class.shortcode.php::shortcode()` then calls `extract($atts, EXTR_SKIP)` directly — no `shortcode_atts()` is used.  
Result: every attribute name is available as a **lowercase PHP variable** inside `getHTML()`.  
The `$options` array uses camelCase keys for the JavaScript output, but the PHP-side `isset()` checks always use the all-lowercase variable — so every attribute below is reachable via shortcode regardless of how the user capitalises it.

---

## Attributes found in PHP source

> **Comma-separated pair** means a string like `"32,32"` that `getIconOptions()` splits on `,` and converts to a JavaScript array `[32, 32]`.

| Attribute name (shortcode) | PHP variable | JS option / field | Type | Default | Sanitization / filter | Reachable via shortcode? | Notes |
|---|---|---|---|---|---|---|---|
| `lat` | `$lat` | `L.marker([lat, lng])` | float | `0` | `filter_float()` (validates float, replaces `,` with `.`) | ✅ Yes | Also aliased as `y` |
| `y` | `$y` | same as `lat` | float | `0` | `filter_float()` | ✅ Yes | Image-map alias for `lat`; if both given, `lat` wins |
| `lng` | `$lng` | `L.marker([lat, lng])` | float | `0` | `filter_float()` | ✅ Yes | Also aliased as `x` |
| `x` | `$x` | same as `lng` | float | `0` | `filter_float()` | ✅ Yes | Image-map alias for `lng`; if both given, `lng` wins |
| `address` | `$address` | geocoded → `lat`/`lng` | string | — | Passed to `Leaflet_Geocoder`; result replaces `lat`/`lng` | ✅ Yes | Geocoded at render time; result is cached |
| `draggable` | `$draggable` | `markerOptions.draggable` | boolean | — | `FILTER_VALIDATE_BOOLEAN` | ✅ Yes | When true, `dragend` logs new coords to console; also works as assumed-boolean flag `[leaflet-marker draggable]` |
| `title` | `$title` | `markerOptions.title` | string | — | `FILTER_SANITIZE_SPECIAL_CHARS` | ✅ Yes | Native browser tooltip on hover |
| `alt` | `$alt` | `markerOptions.alt` | string | — | `FILTER_SANITIZE_FULL_SPECIAL_CHARS` | ✅ Yes | Alt text for the marker image (accessibility) |
| `zindexoffset` | `$zindexoffset` | `markerOptions.zIndexOffset` | integer | — | `FILTER_VALIDATE_INT` | ✅ Yes | Adjust z-order; positive = on top |
| `opacity` | `$opacity` | `markerOptions.opacity` | float 0–1 | — | `FILTER_VALIDATE_FLOAT` | ✅ Yes | Marker icon opacity |
| `iconurl` | `$iconurl` | `iconOptions.iconUrl` → `new L.Icon(…)` | URL string | — | `FILTER_SANITIZE_URL` | ✅ Yes | Setting this causes `getIconOptions()` to create a custom `L.Icon`; should be paired with `iconsize` and `iconanchor` |
| `iconsize` | `$iconsize` | `iconOptions.iconSize` | comma-sep pair e.g. `"32,32"` | — | `FILTER_SANITIZE_FULL_SPECIAL_CHARS`; split+`Number()` by JS | ✅ Yes | Pixel width,height of the icon |
| `iconanchor` | `$iconanchor` | `iconOptions.iconAnchor` | comma-sep pair e.g. `"16,32"` | — | `FILTER_SANITIZE_FULL_SPECIAL_CHARS`; split+`Number()` by JS | ✅ Yes | Point of the icon that corresponds to the marker lat/lng |
| `shadowurl` | `$shadowurl` | `iconOptions.shadowUrl` | URL string | — | `FILTER_SANITIZE_URL` | ✅ Yes | Shadow image URL |
| `shadowsize` | `$shadowsize` | `iconOptions.shadowSize` | comma-sep pair | — | `FILTER_SANITIZE_FULL_SPECIAL_CHARS`; split+`Number()` by JS | ✅ Yes | Pixel size of the shadow |
| `shadowanchor` | `$shadowanchor` | `iconOptions.shadowAnchor` | comma-sep pair | — | `FILTER_SANITIZE_FULL_SPECIAL_CHARS`; split+`Number()` by JS | ✅ Yes | Anchor point of the shadow |
| `popupanchor` | `$popupanchor` | `iconOptions.popupAnchor` | comma-sep pair | auto-computed from `iconSize` | `FILTER_SANITIZE_FULL_SPECIAL_CHARS`; split+`Number()` by JS | ✅ Yes | Auto-computed by `getIconOptions()` if omitted: `[0, -iconHeight - 3]` |
| `tooltipanchor` | `$tooltipanchor` | `iconOptions.tooltipAnchor` | comma-sep pair | — | `FILTER_SANITIZE_FULL_SPECIAL_CHARS`; split+`Number()` by JS | ✅ Yes | Offset for Leaflet tooltip from icon; only meaningful if a tooltip is bound externally — the shortcode itself does **not** bind tooltips |
| `svg` | `$svg` | switches marker constructor to `L.SVGMarker` | boolean | — | `FILTER_VALIDATE_BOOLEAN` | ✅ Yes | Enqueues `leaflet_svg_icon_js`; enables SVG icon group below; assumed-boolean: `[leaflet-marker svg]` |
| `background` | `$background` | SVGMarker `background` option | string (color) | — | `FILTER_SANITIZE_FULL_SPECIAL_CHARS` | ✅ Yes | Background color of SVG marker pin; only meaningful when `svg` is also set |
| `iconclass` | `$iconclass` | SVGMarker `iconClass` option | string (CSS class) | — | `FILTER_SANITIZE_FULL_SPECIAL_CHARS` | ✅ Yes | CSS class injected into SVG icon; intended for Font Awesome e.g. `"fab fa-wordpress-simple"`; only meaningful when `svg` is also set |
| `color` | `$color` | SVGMarker `color` option | string (color) | — | `FILTER_SANITIZE_FULL_SPECIAL_CHARS` | ✅ Yes | Foreground / icon color for SVG marker; only meaningful when `svg` is also set |
| *(shortcode content)* | `$content` | `marker.bindPopup(…)` | HTML string | — | `do_shortcode()`, `addslashes()`, `htmlspecialchars()`; a `leaflet_map_popup_message` filter is available | ✅ Yes | Content between `[leaflet-marker]…[/leaflet-marker]`; may contain shortcodes and HTML |
| `message` | `$message` | `marker.bindPopup(…)` | HTML string | — | same as content | ✅ Yes | Shortcode attribute alternative to inner content; content wins if `message` is empty |
| `visible` | `$visible` | `.openPopup()` | boolean | `false` | `FILTER_VALIDATE_BOOLEAN` | ✅ Yes | If truthy, popup opens automatically on page load; assumed-boolean: `[leaflet-marker visible]Hello![/leaflet-marker]` |

---

## Documented but unreachable / unimplemented attributes

None of the attributes shown in the readme are broken or unreachable. However, the following **Leaflet JS marker options** are commonly expected but are **not read anywhere in the PHP source** and therefore cannot be set via shortcode:

| Attribute | Reason not available |
|---|---|
| `riseOnHover` | Not in `$options` array; no `isset($riseonhover)` check |
| `riseOffset` | Not in `$options` array |
| `keyboard` | Not in `$options` array (exists on `[leaflet-map]` but not `[leaflet-marker]`) |
| `interactive` / `clickable` | Not in `$options` array |
| Tooltip *text* / `tooltip` | `tooltipAnchor` is accepted as an icon option, but there is no `bindTooltip()` call in the shortcode; no tooltip content attribute exists |

---

## Already implemented in Blocks for Leaflet Map

Reading `src/leaflet-map-block/block.json` (markers item schema) and `render.php` + `edit.js`:

| Attribute | Where |
|---|---|
| `lat` | `block.json` items schema → `render.php` → emitted as `lat="…"` |
| `lng` | `block.json` items schema → `render.php` → emitted as `lng="…"` |
| `title` | `block.json` items schema → `render.php` → emitted as `title="…"` |
| `content` (popup body) | `block.json` items schema → `render.php` → emitted as inner content between `[leaflet-marker]…[/leaflet-marker]` |
| `alt` | Added v0.4.0 — `block.json` items schema → `render.php` → emitted as `alt="…"` |
| `visible` | Added v0.4.0 — `block.json` items schema → `render.php` → emitted as `visible="1"` when true |
| `draggable` | Added v0.4.0 — `block.json` items schema → `render.php` → emitted as `draggable="1"` when true |
| `opacity` | Added v0.4.0 — `block.json` items schema → `render.php` → emitted as `opacity="…"` when ≠ 1 |
| `zindexoffset` | Added v0.4.0 — `block.json` items schema (as `zIndexOffset`) → `render.php` → emitted as `zindexoffset="…"` when ≠ 0 |
| `iconurl` | Added v0.4.1 — gated on `useCustomIcon` block flag; `render.php` emits `iconurl="…"` via `esc_attr()` |
| `iconsize` | Added v0.4.1 — stored as `iconWidth` + `iconHeight`; `render.php` emits `iconsize="W,H"` when both ≥ 1 |
| `iconanchor` | Added v0.4.1 — stored as `iconAnchorX` + `iconAnchorY`; `render.php` emits `iconanchor="X,Y"` when both numeric |
| `popupanchor` | Added v0.4.1 — stored as `popupAnchorX` + `popupAnchorY`; `render.php` emits `popupanchor="X,Y"` when both numeric |
| `shadowurl` | Added v0.4.1 — additionally gated on `useShadow` block flag; `render.php` emits `shadowurl="…"` via `esc_attr()` |
| `shadowsize` | Added v0.4.1 — stored as `shadowWidth` + `shadowHeight`; `render.php` emits `shadowsize="W,H"` when both ≥ 1 |
| `shadowanchor` | Added v0.4.1 — stored as `shadowAnchorX` + `shadowAnchorY`; `render.php` emits `shadowanchor="X,Y"` when both numeric |

`tooltipanchor`, `svg`, `background`, `iconclass`, `color`, `message`, `address`, `x`, `y` are **not yet implemented** (see proposals below).

---

## Proposed grouping for v0.4.x releases

> Shipped sections are marked ✅. Remaining sections are proposals only — human review required before starting any branch.

### v0.4.0 — Popup & visibility ✅ Shipped in v0.4.0

Complete the popup story for the basic marker use case.

| Attribute | Notes |
|---|---|
| `message` | Already partially implemented (content); this adds the `message=` attr as an alternative |
| `visible` | Auto-open popup on load; boolean toggle |

Implementation note: `visible` currently requires no block attribute changes — it just needs an additional field in the marker object schema and emitted in `render.php`. Low risk.

---

### v0.4.1 — Marker behaviour ✅ Shipped in v0.4.0

Non-visual options that change how the marker interacts with the user.

| Attribute | Notes |
|---|---|
| `draggable` | Boolean |
| `opacity` | Float 0–1 |
| `zindexoffset` | Integer; exposed as `zIndexOffset` in JS |
| `alt` | String; accessibility |
| `title` | Already in schema but not yet exposed in the editor UI as a labelled field — wire up the panel control |

---

### v0.4.2 — Custom icon (image) ✅ Shipped in v0.4.1

The icon group: URL + dimensions + anchors. These should be exposed together because `iconUrl` without `iconSize`/`iconAnchor` leads to broken layouts.

| Attribute | Notes |
|---|---|
| `iconurl` | URL string; emitted via `esc_attr()` (same reasoning as tile URLs — avoid stripping characters) |
| `iconsize` | Comma-sep pair e.g. `"32,32"` |
| `iconanchor` | Comma-sep pair |
| `shadowurl` | URL string |
| `shadowsize` | Comma-sep pair |
| `shadowanchor` | Comma-sep pair |
| `popupanchor` | Comma-sep pair; auto-computed by Leaflet if omitted |

Implementation note: UI could offer a grouped "Custom icon" panel that collapses when `iconurl` is empty.

---

### v0.4.3 — SVG marker

The SVG marker group: all three attributes only make sense together with `svg=true`.

| Attribute | Notes |
|---|---|
| `svg` | Boolean toggle; enabling it switches the marker constructor |
| `background` | Color string (e.g. `"red"`, `"#ff0000"`) |
| `iconclass` | CSS class string for Font Awesome or similar icon font |
| `color` | Foreground color string |

Implementation note: `svg` requires the `leaflet_svg_icon_js` script to be enqueued. Confirm whether the AJAX preview iframe picks this up automatically from `do_shortcode()` output.

---

### v0.4.4 — Address geocoding for markers

Extend the per-marker object to accept an address that is geocoded at render time.

| Attribute | Notes |
|---|---|
| `address` | String; geocoded server-side by `Leaflet_Geocoder`; result replaces `lat`/`lng` in the shortcode |

Implementation note: This is a larger feature — it changes the marker data model and the editor UI. The geocoder caches results in `$wpdb`. Confirm whether per-marker geocoding uses the same endpoint as the map-level geocoding already implemented in edit.js.

---

### v0.4.5 — Tooltip anchor (deferred)

| Attribute | Notes |
|---|---|
| `tooltipanchor` | Comma-sep pair; only useful to power users who also bind a tooltip via custom JS or a third-party extension |

Implementation note: May be too niche for a standalone release. Consider bundling with v0.4.2 (icon group) since it is an icon option, or deferring until tooltip *text* is also supported (which would require upstream changes to bozdoz's plugin).

---

## Open questions / ambiguities

1. **`address` for markers vs. the map**: The map-level `address` goes through the block's own geocoding endpoint (`wp_ajax_bflm_geocode`). Marker-level `address` goes through `Leaflet_Geocoder` at `do_shortcode()` render time (server-side). These are two different paths. Is that acceptable UX, or should the editor geocode marker addresses upfront (storing resulting lat/lng)?

2. **`iconUrl` sanitization**: The upstream code uses `FILTER_SANITIZE_URL` (PHP), which strips non-URL characters. This is fine for plain image URLs but would strip Leaflet tile template placeholders. Since icon URLs never have `{x}/{y}/{z}`, `FILTER_SANITIZE_URL` is safe here — but should we still use `esc_attr()` in `render.php` for consistency with the tile-URL pattern? Confirm before implementing.

3. **`tooltipanchor` without tooltip text**: Should we expose `tooltipanchor` at all if there is no way to set tooltip text via shortcode? It is accepted by the PHP but has no effect unless the user also writes custom JS.

4. **SVG marker script in the iframe preview**: The AJAX preview iframe renders via `do_shortcode()`. When `svg=true` the marker shortcode calls `wp_enqueue_script('leaflet_svg_icon_js')`. Does the iframe AJAX endpoint honour late-enqueued scripts, or will the SVG script be missing from the preview? Needs a runtime test.

5. **`message` vs. `content`**: Both set the popup text. The block currently uses the shortcode inner-content approach (`[leaflet-marker]…[/leaflet-marker]`), which already works. Adding `message=` as a second path may be confusing. Recommend keeping only the content approach and not exposing `message` as a separate block attribute.

6. **`visible` attribute naming in block.json**: The upstream attribute is `visible` (boolean flag). In block.json, boolean attributes for the map use the pattern `scrollWheelZoom`, `zoomControl`, etc. Suggest naming the block attribute `markerAutoOpen` or `popupOpen` to be more descriptive — but the shortcode key must still be `visible`.

7. **Per-marker UI in the editor**: The current marker list has only lat/lng/title/content fields. Adding draggable, opacity, iconurl, etc. will significantly increase complexity. Consider a collapsible "Advanced" section per marker, or a separate sidebar panel, to avoid overwhelming the UI.

---

## v0.4.2 — SVG marker (audit findings)

> Read-only audit conducted 2026-04-26 against Leaflet Map plugin v3.4.4.  
> Source files examined: `class.marker-shortcode.php`, `leaflet-svg-icon.js`, `class.leaflet-map.php`, `default-filters.php` (WordPress core).  
> No implementation code was written during this audit.

### Per-attribute findings

#### `svg`

| Item | Detail |
|---|---|
| PHP variable | `$svg` |
| Shortcode key | `svg` (all lowercase; WordPress normalises before dispatch) |
| Sanitization | `FILTER_VALIDATE_BOOLEAN` — accepts `"true"`, `"1"`, `"yes"`, `"on"` (case-insensitive); assumed-boolean form `[leaflet-marker svg]` also works |
| Default | Not set → evaluated as falsy → standard `L.marker` / `L.Icon` path is used |
| Side effects | 1. Calls `wp_enqueue_script('leaflet_svg_icon_js')` unconditionally when truthy. 2. Sets `$default_marker = 'new L.SVGMarker'` instead of `'new L.marker'`. |
| Interaction with `iconurl` | `L.SVGMarker.initialize()` creates its own `L.SVGIcon` unconditionally. The `getIconOptions()` path (which creates `L.Icon` from `iconurl`) is only triggered when `svg` is falsy. Setting both `svg=true` and `iconurl=…` means `svg` wins — the `iconurl` is silently ignored. |

#### `background`

| Item | Detail |
|---|---|
| PHP variable | `$background` |
| Sanitization | `FILTER_SANITIZE_FULL_SPECIAL_CHARS` — HTML-encodes special chars; NOT `sanitize_hex_color`. Any CSS color string is accepted (named colors, `#rrggbb`, `rgb(…)`, `hsl(…)`). |
| JS default | `'#2b82cb'` — defined in `L.SVGIcon.prototype.options` in `leaflet-svg-icon.js` |
| Rendering | Passed to `L.SVGMarker` options → `L.SVGIcon` applies it as the `fill` attribute on the main SVG `<path>` element (the pin shape). |
| Block attribute type | Should be `string`; no enum constraint — any valid CSS color. A color picker (`ColorPicker` / `ColorPalette` from `@wordpress/components`) would be the natural UI. |

#### `iconclass`

| Item | Detail |
|---|---|
| PHP variable | `$iconclass` (lowercase — WordPress normalises attribute names) |
| JS options key | `iconClass` (camelCase) — PHP extracts `$iconclass` into the `$options` array as `'iconClass' => $iconclass` |
| Sanitization | `FILTER_SANITIZE_FULL_SPECIAL_CHARS` |
| JS default | `''` (empty string) |
| Rendering | Applied as the `className` of an `<i>` element rendered inside the SVG pin. Intended for icon-font glyph classes such as `"fas fa-star"` or `"fab fa-wordpress-simple"`. |
| Dependency | Requires an icon font CSS (e.g., Font Awesome) to be enqueued in the page. Leaflet Map does **not** enqueue any icon font. If the CSS is absent, the `<i>` element exists in the DOM but renders as a blank/invisible element. |
| Block attribute type | `string`, free text input. A `TextControl` is sufficient. |

#### `color`

| Item | Detail |
|---|---|
| PHP variable | `$color` |
| Sanitization | `FILTER_SANITIZE_FULL_SPECIAL_CHARS` |
| JS default | `'white'` — defined in `L.SVGIcon.prototype.options` |
| Rendering | Applied as the inline `color` CSS property on the `<i>` element inside the SVG pin. Controls the foreground/text color of the icon-font glyph. Only visually meaningful when `iconclass` is also set. |
| Block attribute type | `string`; same CSS color string as `background`. A `ColorPicker` is appropriate. |

---

### `L.SVGIcon` defaults (from `leaflet-svg-icon.js`)

These values apply when `svg=true` is set but the corresponding attribute is omitted:

| Option | Default |
|---|---|
| `iconSize` | `[26, 42]` |
| `popupAnchor` | `[1, -42]` |
| `iconClass` | `''` |
| `background` | `'#2b82cb'` |
| `color` | `'white'` |

`L.SVGIcon` does **not** accept `iconUrl`, `shadowUrl`, `iconAnchor`, `shadowAnchor`, `shadowSize` — those belong to the `L.Icon` path. Mixing them with `svg=true` has no effect.

---

### Asset enqueueing in the AJAX preview iframe

The block's AJAX preview handler (`bflm_preview_map()`) follows the sequence:
`wp_head()` → `do_shortcode($map_shortcode . $marker_shortcodes)` → `wp_footer()`

**Question 1: Is `leaflet_svg_icon_js` registered by the time `do_shortcode` runs?**

Yes. `enqueue_and_register()` is hooked to `wp_enqueue_scripts`. WordPress hooks `wp_enqueue_scripts` to `wp_head` at priority 1 (`add_action('wp_head','wp_enqueue_scripts',1)` — `wp-includes/default-filters.php` line 345). So calling `wp_head()` triggers `enqueue_and_register()`, which calls `wp_register_script('leaflet_svg_icon_js', …)`. By the time `do_shortcode()` runs, the handle exists and `wp_enqueue_script('leaflet_svg_icon_js')` inside the marker shortcode will succeed.

**Question 2: When does the script actually print?**

`leaflet_svg_icon_js` is registered with `$in_footer = false` (head placement requested). However, its dependency `leaflet_js` is registered with `$in_footer = true` (footer). WordPress propagates the footer constraint to all dependents — any script that depends on a footer script is also deferred to the footer regardless of its own `$in_footer` flag. Result: `leaflet_svg_icon_js` prints in the footer via `wp_footer()` → `print_footer_scripts()`.

**Question 3: Does `wp_footer()` run after `do_shortcode()` in the AJAX handler?**

Yes — the AJAX handler calls `do_shortcode()` before `wp_footer()`. Scripts enqueued during `do_shortcode()` (including `leaflet_svg_icon_js`) are therefore in the queue when `wp_footer()` flushes them.

**Conclusion: iframe SVG asset risk is LOW.**  
The normal `wp_head → do_shortcode → wp_footer` sequence in the AJAX handler means the SVG script will be present in the iframe. The risk is not structural — it follows the same path as `leaflet_js` itself, which already works. A runtime test with `svg=true` in the editor should confirm, but no special workaround is expected to be needed.

---

### Icon font dependency (NOT resolved automatically)

`leaflet_svg_icon_js` reaches the iframe automatically. The icon font CSS does **not**.

If a user sets `iconclass` to a Font Awesome class, the CSS must be enqueued by their theme or another plugin. The block has no way to know which icon font is in use, and Leaflet Map does not provide one. This means:

- In the **frontend**: `iconclass` glyphs appear only if the theme/plugin enqueues the font.
- In the **editor iframe preview**: The iframe's `wp_head()` output reflects whatever is enqueued on the site, so if Font Awesome is site-wide, it will appear in the preview too.
- **No action needed in the block** — this is a user-side dependency. The block should document it (help text on the `iconclass` field: "Requires an icon font such as Font Awesome to be active on your site").

---

### Implementation plan (outline)

1. **New block attributes** (in `block.json` marker items schema):
   - `useSvgMarker`: `boolean`, default `false` — master toggle, mirrors the `useCustomIcon` pattern
   - `svgBackground`: `string`, default `''` — omit from shortcode when empty; Leaflet uses `'#2b82cb'`
   - `svgIconClass`: `string`, default `''`
   - `svgColor`: `string`, default `''`

2. **Shortcode emission** (`render.php` and `buildShortcode()` in `edit.js`):
   - Emit `svg="true"` when `useSvgMarker` is true
   - Emit `background="…"`, `iconclass="…"`, `color="…"` when non-empty and `useSvgMarker` is true
   - `useSvgMarker` and `useCustomIcon` should be mutually exclusive at the UI level — the shortcode itself rejects the combination (SVG path ignores `iconurl`), so it is a user confusion risk

3. **Editor UI**:
   - Collapsible "SVG Marker" subsection (sibling to "Custom Icon"), appearing below the existing advanced fields
   - Master `ToggleControl` for `useSvgMarker`; disabling it hides but does not clear the sub-fields (non-destructive, consistent with `useCustomIcon`)
   - `ColorPicker` or `ColorPalette` for `svgBackground` and `svgColor`; prefill defaults `'#2b82cb'` / `'white'` as placeholder text so the user can see what they are overriding
   - `TextControl` for `svgIconClass` with help text about icon font dependency
   - When `useSvgMarker` is toggled on while `useCustomIcon` is also on: automatically disable `useCustomIcon` (or show a notice)

4. **AJAX preview handler** (`blocks-for-leaflet-map.php`):
   - Mirror the three new attributes in the PHP marker loop (same pattern as the custom icon block added in v0.4.1)
   - No special script enqueue needed — `do_shortcode()` triggers it automatically

5. **Runtime testing checklist**:
   - [ ] `svg=true` marker renders correctly in the frontend
   - [ ] `svg=true` marker renders correctly in the editor iframe preview
   - [ ] `background` color change reflects immediately in the preview
   - [ ] `iconclass` with a Font Awesome class shows the glyph when FA is available
   - [ ] `color` changes the glyph foreground color
   - [ ] Setting `useSvgMarker=true` when `useCustomIcon=true` produces correct shortcode (SVG attributes only; `iconurl` etc. suppressed)
   - [ ] Disabling `useSvgMarker` restores the default blue pin without losing the entered color values
