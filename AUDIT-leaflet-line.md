# [leaflet-line] Shortcode Audit

## Source

| Item | Value |
|---|---|
| Primary file | `/wp-content/plugins/leaflet-map/shortcodes/class.line-shortcode.php` |
| Base class | `/wp-content/plugins/leaflet-map/shortcodes/class.shortcode.php` |
| Shared helpers | `/wp-content/plugins/leaflet-map/class.leaflet-map.php` (methods: `get_style_json`, `add_popup_to_shape`) |
| Leaflet Map plugin version audited | **3.4.4** |

### How attribute parsing works

Same as `[leaflet-marker]`: WordPress lowercases all shortcode attribute names; `class.shortcode.php` calls `extract($atts, EXTR_SKIP)` — no `shortcode_atts()`. All attribute names are available as lowercase PHP variables inside `getHTML()`. `get_style_json()` maps them explicitly to camelCase JS keys.

### Note on `[leaflet-polygon]`

`Leaflet_Line_Shortcode` is also the base class for `[leaflet-polygon]` — same attributes, same PHP logic, different `$type` property (`'polygon'` vs `'line'`) which switches `L.polyline` → `L.polygon`. The block will implement them as a single shared code path with a `type` attribute.

---

## Attributes found in PHP source

### Geometry (mutually exclusive; first non-empty one wins in source order)

| Attribute | Type | Format | Notes |
|---|---|---|---|
| `latlngs` | string | Semicolon/pipe/slash-separated `"lat, lng"` pairs, e.g. `"41,29; 44,18; 48,16"` | Primary attribute; parsed with `preg_split('/\s?[;|\/]\s?/')`, each pair split on `,` and cast to float |
| `coordinates` | string | Same format as `latlngs` | Alias; processed identically; ignored if `latlngs` is set |
| `addresses` | string | Semicolon/pipe/slash-separated address strings, e.g. `"Paris; London; Madrid"` | Server-side geocoding via `Leaflet_Geocoder` at render time; result cached in DB transient by the geocoder class; overrides `latlngs`/`coordinates` if set |

> **Point format detail**: each pair is `"lat, lng"` (comma-separated, optional spaces). Trailing separators are ignored by the `trim()` guard.

### Fit bounds

| Attribute | Type | Default | Notes |
|---|---|---|---|
| `fitbounds` | boolean | `false` | Calls `previous_map.fitBounds(shape.getBounds())` after adding the shape; assumed-boolean flag: `[leaflet-line fitbounds latlngs="…"]` |
| `fitline` | boolean | — | Backwards-compat alias for `fitbounds`; if set, overrides `fitbounds` |

### Style (via `get_style_json` → Leaflet Path options)

> All are optional. Omitting them uses Leaflet's own defaults.  
> Attribute names are lowercased by WordPress; `get_style_json` maps them explicitly to camelCase JS keys.

| Shortcode attribute | JS option | Type | Leaflet default | Sanitization | Notes |
|---|---|---|---|---|---|
| `stroke` | `stroke` | boolean | `true` | `FILTER_VALIDATE_BOOLEAN` | Whether to draw the stroke; set `false` for fill-only shapes |
| `color` | `color` | string (CSS color) | `"#3388ff"` | `FILTER_SANITIZE_FULL_SPECIAL_CHARS` | Stroke and default fill color |
| `weight` | `weight` | number (px) | `3` | `FILTER_VALIDATE_FLOAT` | Stroke width in pixels |
| `opacity` | `opacity` | float 0–1 | `1.0` | `FILTER_VALIDATE_FLOAT` | Stroke opacity |
| `linecap` | `lineCap` | string | `"round"` | `FILTER_SANITIZE_FULL_SPECIAL_CHARS` | SVG stroke-linecap: `butt`, `round`, or `square` |
| `linejoin` | `lineJoin` | string | `"round"` | `FILTER_SANITIZE_FULL_SPECIAL_CHARS` | SVG stroke-linejoin: `miter`, `round`, or `bevel` |
| `dasharray` | `dashArray` | string | `null` | `FILTER_SANITIZE_FULL_SPECIAL_CHARS` | SVG stroke-dasharray, e.g. `"2,15"` or `"5 10 2"` |
| `dashoffset` | `dashOffset` | string | `null` | `FILTER_SANITIZE_FULL_SPECIAL_CHARS` | SVG stroke-dashoffset |
| `fill` | `fill` | boolean | `false` (polyline) / `true` (polygon) | `FILTER_VALIDATE_BOOLEAN` | Whether to fill the shape; meaningful on polygons |
| `fillcolor` | `fillColor` | string (CSS color) | same as `color` | `FILTER_SANITIZE_FULL_SPECIAL_CHARS` | Fill color |
| `fillopacity` | `fillOpacity` | float 0–1 | `0.2` | `FILTER_VALIDATE_FLOAT` | Fill opacity |
| `fillrule` | `fillRule` | string | `"evenodd"` | `FILTER_SANITIZE_FULL_SPECIAL_CHARS` | SVG fill-rule: `nonzero` or `evenodd` |
| `classname` | `className` | string (CSS class) | `""` | `FILTER_SANITIZE_FULL_SPECIAL_CHARS` | Extra CSS class added to SVG element; example in shortcode-helper.php: `marching-ants` animation |

### Popup (via `add_popup_to_shape`)

| Attribute / content | Notes |
|---|---|
| Shortcode inner content | HTML between `[leaflet-line]…[/leaflet-line]`; passed through `do_shortcode()` then escaped for JS |
| `message` | Attribute alternative to inner content; content wins if `message` is empty |
| `visible` | boolean; if set, `.openPopup()` is called automatically on load |

---

## Attributes not available (not read in PHP source)

These Leaflet Path / Polyline JS options exist in Leaflet but are not read anywhere by `get_style_json` or `getHTML`:

| Leaflet option | Reason unavailable |
|---|---|
| `interactive` | Not in `get_style_json` |
| `bubblingMouseEvents` | Not in `get_style_json` |
| `renderer` | Not applicable via shortcode |
| `smoothFactor` | Not in `get_style_json`; Leaflet polyline-specific option |
| `noClip` | Not in `get_style_json` |

These are omitted from the block implementation.

---

## Implementation Plan for v0.5.0

### Block attribute schema additions

```json
"lines": {
  "type": "array",
  "default": [],
  "items": {
    "type": "object",
    "properties": {
      "type":        { "type": "string", "default": "line" },
      "points":      { "type": "array", "default": [], "items": { "type": "object", "properties": { "lat": { "type": "number", "default": 0 }, "lng": { "type": "number", "default": 0 } } } },
      "fitbounds":   { "type": "boolean", "default": false },
      "color":       { "type": "string",  "default": "" },
      "weight":      { "type": ["number", "null"], "default": null },
      "opacity":     { "type": ["number", "null"], "default": null },
      "dashArray":   { "type": "string",  "default": "" },
      "classname":   { "type": "string",  "default": "" },
      "fill":        { "type": "boolean", "default": false },
      "fillColor":   { "type": "string",  "default": "" },
      "fillOpacity": { "type": ["number", "null"], "default": null },
      "popup":       { "type": "string",  "default": "" },
      "visible":     { "type": "boolean", "default": false }
    }
  }
}
```

> Fields omitted from MVP: `stroke`, `linecap`, `linejoin`, `dashoffset`, `fillrule` — low use, can be added in a later v0.5.x patch. `addresses`-based points are also deferred (server-side geocoding at render time is complex; users can use the map-level geocoding to find coordinates manually).

### Shortcode emission rules

- Emit `[leaflet-line …]` (self-closing, no content) when `popup` is empty.
- Emit `[leaflet-line …]popup content[/leaflet-line]` when `popup` is non-empty.
- For polygons: emit `[leaflet-polygon …]` instead.
- `type="line"` → `[leaflet-line]`; `type="polygon"` → `[leaflet-polygon]`.
- `points` array → `latlngs="lat1,lng1; lat2,lng2; …"` attribute.
- Omit style attributes at their Leaflet defaults (empty string, null, false).
- `fitbounds` → emit as bare flag attribute when true.
- `visible` → emit as bare flag attribute when true.

### UI (editor sidebar panel)

- New "Lines" panel (collapsible, same pattern as "Markers").
- Each line: collapsible item with:
  - Type toggle: Line / Polygon (radio or SelectControl).
  - Point list: add/remove points, each with lat/lng NumberControls.
  - Address search per point (reuse `bflmGeocodeAddress`).
  - Style subsection (collapsible): Color, Weight, Opacity, Dash Array, Class Name.
  - Fill subsection (collapsible, useful for polygons): Fill toggle, Fill Color, Fill Opacity.
  - Popup textarea + Visible toggle.
  - Fit Bounds toggle.
- Interactive map: clicking on map canvas adds a point to the active line (postMessage protocol extension needed).
- Marker drag already works via postMessage; line-point drag is a stretch goal for v0.5.x.

### AJAX preview handler (`bflm_preview`)

`render.php` builds shortcodes from `$_POST` attributes. Lines need the same treatment as markers: serialize the `lines` array into `[leaflet-line]`/`[leaflet-polygon]` shortcodes inside the `[leaflet-map]` block.

### Key risks

| Risk | Mitigation |
|---|---|
| Point list UX complexity | Keep MVP simple: just lat/lng inputs per point; no drag-to-add yet |
| `latlngs` string format | Serialize as `"lat1,lng1; lat2,lng2"` — matches Leaflet Map parser exactly |
| Polygon vs line distinction | Single `type` attribute on each line object; emitted as different shortcode tag |
| `[leaflet-polygon]` self-closing | Same self-closing vs content-wrapper pattern as `[leaflet-marker]` |

---

## Version Proposals

| Version | Scope |
|---|---|
| v0.5.0 | `[leaflet-line]` + `[leaflet-polygon]` MVP: points (lat/lng), basic style (color, weight, opacity, dashArray, fill, fillColor, fillOpacity), popup, fitbounds |
| v0.5.1 | Interactive point placement: click on map to add point to active line |
| v0.5.2 | Advanced style fields: linecap, linejoin, dashoffset, fillrule, classname |
