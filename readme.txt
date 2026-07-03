=== CartoBlocks for Leaflet ===
Contributors:      glycymeris
Tags:              leaflet, map, openstreetmap, block, gutenberg
Requires at least: 6.8
Tested up to:      7.0
Stable tag:        1.2.2
Requires PHP:      7.4
License:           GPL-2.0-or-later
License URI:       https://www.gnu.org/licenses/gpl-2.0.html

A Gutenberg block that gives you a full visual editor for all Leaflet Map plugin shortcodes — no shortcode writing required.

== Description ==

CartoBlocks for Leaflet adds a native Gutenberg block that wraps the [Leaflet Map](https://wordpress.org/plugins/leaflet-map/) plugin shortcodes. Configure your map visually in the block editor — the plugin generates the correct shortcodes automatically, and the frontend is rendered entirely by Leaflet Map.

**Core map features:**

* Interactive live preview in the editor — what you see is what you get.
* Pan, zoom, and drag markers directly on the map preview.
* Sidebar controls for coordinates, zoom level, height, width, and scroll-wheel zoom.
* Address geocoding — search by place name (Nominatim/OpenStreetMap), pick from up to 5 candidates.
* Fit map to markers toggle.
* Full tile layer override: custom tile URL, tile size, subdomains, Map ID, access token, zoom offset, no-wrap, detect retina.
* WMS tile source support (`[leaflet-wms]`) — toggle in Tile Layer panel; configure source URL, layer name, and CRS.
* Image map mode (`[leaflet-image]`) — replace tiles with a flat image (floor plans, diagrams, custom maps) on `L.CRS.Simple`.
* Map Controls panel: min/max zoom, max bounds, scale bar, custom attribution.
* Interaction controls: dragging, keyboard, double-click zoom, box zoom, close-popup-on-click, tap, inertia — each with Default / Enabled / Disabled three-state model.

**Markers (`[leaflet-marker]`):**

* Add, edit, and remove markers with title and popup content (HTML supported).
* Per-marker: alt text, auto-open popup, draggable, opacity, z-index offset.
* Custom icon via WordPress Media Library — width/height with aspect-ratio lock, icon anchor and popup anchor with 9-position presets.
* SVG marker mode — background color, icon color (theme palette + custom picker), icon CSS class (Font Awesome / any icon font).
* Per-marker address geocoder.
* Drag markers on the live preview to update coordinates in real time.

**Lines and polygons (`[leaflet-line]`):**

* Click-to-draw lines and polygons directly on the map preview.
* Per-line/polygon: color, weight, opacity, dash array, CSS class, fill, fill color, fill opacity, popup text.
* Per-point address geocoder.

**Circles (`[leaflet-circle]`):**

* 2-click draw on the map preview — first click places center, second click sets radius.
* Live radius guide line and draggable center pin post-draw.
* m/km unit toggle (stored in meters).
* Per-circle: color, weight, opacity, dash array, CSS class, fill, fill color, fill opacity, popup text.
* Per-circle address geocoder.

**Data layers (`[leaflet-geojson]`, `[leaflet-gpx]`, `[leaflet-kml]`):**

* Load external GeoJSON, GPX, or KML files by URL.
* Full attribute parity: fitbounds, popup template with `{property}` interpolation, popup property, table view.
* Style controls: color, weight, opacity, dash array, CSS class, fill, fill color, fill opacity.
* Custom point icon with aspect-ratio lock and anchor presets.

**Image and video overlays (`[leaflet-image-overlay]`, `[leaflet-video-overlay]`):**

* Pin raster images or videos to geo coordinates via SW/NE bounds.
* Controls: opacity, interactivity, alt text, z-index, CSS class.
* Aspect-ratio lock for image overlays.

**Developer-friendly:**

* Generates standard Leaflet Map shortcodes — full compatibility with the Leaflet Map plugin ecosystem.
* Multiple independent map blocks per page, fully isolated.
* Shortcode viewer in the toolbar — inspect and copy the generated shortcode at any time.
* All strings are translation-ready (`.pot` file included).

**Requirements:**

* The [Leaflet Map](https://wordpress.org/plugins/leaflet-map/) plugin must be installed and active. This is declared as a plugin dependency, so WordPress will guide you to install and activate it before this plugin can be activated.
* WordPress 6.8 or higher.
* PHP 7.4 or higher.

== Installation ==

1. Upload the `cartoblocks-for-leaflet` folder to `/wp-content/plugins/`, or install the plugin through the WordPress plugins screen.
2. Activate the plugin through the Plugins screen. If the [Leaflet Map](https://wordpress.org/plugins/leaflet-map/) plugin is not yet installed and active, WordPress prompts you to install and activate it first (it is a required dependency).
3. In the block editor, search for "Map for Leaflet" and add it to your page or post.

== External services ==

This plugin connects to one external service: the Nominatim geocoding API
operated by the OpenStreetMap Foundation. It is used **only** in the block
editor, and **only** when you click the address search button to look up the
coordinates of a place name. It is never called on the frontend of your site
and is never called automatically.

When you perform an address search, the text you type into the search field is
sent to `https://nominatim.openstreetmap.org/search` so it can be matched
against OpenStreetMap data and returned as a list of candidate locations. The
request also includes your site URL and administrator contact email in the
User-Agent header, following Nominatim's usage policy for attribution. No other
personal data is transmitted. If you have configured a Nominatim contact email
in the Leaflet Map plugin settings, that value is used instead.

* Service provider: OpenStreetMap Foundation (Nominatim)
* Terms / usage policy: https://operations.osmfoundation.org/policies/nominatim/
* Privacy policy: https://wiki.osmfoundation.org/wiki/Privacy_Policy

Note: GeoJSON, GPX, and KML data layers, and any map tiles, are loaded by the
Leaflet Map plugin (and your browser) from whatever URLs **you** enter. Those
requests are made by the Leaflet Map plugin, not by CartoBlocks for Leaflet.

Note: if "Use WMS tile source" is enabled but the WMS Source field is left
empty, the Leaflet Map plugin falls back to a free public demo WMS service
operated by terrestris GmbH (`ows.mundialis.de`). That service displays a
watermark and is also a third-party request — provide your own WMS URL to
avoid it.

== Known Limitations ==

**GPX data layers from the Media Library may not render.**

When a `.gpx` file is uploaded to the WordPress Media Library and used as the
source of a GPX data layer, the track may fail to draw, while GeoJSON and KML
layers work in the same setup. This is an upstream limitation in the Leaflet
Map plugin, not in CartoBlocks for Leaflet: its GeoJSON/GPX/KML loader reads the
response as XML (`responseXML`), which the browser only populates when the file
is served with an XML `Content-Type` (`text/xml`, `application/xml`, or a
`+xml` subtype). Many web servers serve `.gpx` as `text/plain` or
`application/octet-stream`, so the track is never parsed. The same behaviour
occurs when using the Leaflet Map plugin's `[leaflet-gpx]` shortcode directly.

Workarounds: serve the GPX file from a host that sets an XML `Content-Type`
(e.g. `application/gpx+xml`), or configure your web server to serve `.gpx` as
XML. GeoJSON and KML layers are unaffected.

== Frequently Asked Questions ==

= Does this plugin replace the Leaflet Map plugin? =

No. This plugin requires Leaflet Map to be installed and active. It provides a Gutenberg block interface for creating maps, but the actual map rendering on the frontend is handled entirely by Leaflet Map's shortcodes.

= Can I use multiple map blocks on the same page? =

Yes. Each block is fully independent — different coordinates, zoom levels, markers, layers, and settings.

= Does the editor preview show real map tiles? =

Yes. The editor preview renders the map using the Leaflet Map plugin's own shortcode processing via an iframe, so it looks identical to the frontend.

= What map tile provider does it use? =

Whatever you have configured in the Leaflet Map plugin settings. By default, OpenStreetMap tiles.

= Can I use a WMS tile source? =

Yes. Toggle "Use WMS tile source" in the Tile Layer panel and enter the WMS URL, layer name, and CRS. The WMS source must be CORS-enabled for the editor preview to load (same requirement as the frontend).

Note: if you leave the WMS Source field empty, the Leaflet Map plugin falls
back to a free public demo WMS service (`ows.mundialis.de`, operated by
terrestris GmbH), which displays a "terrestris" watermark and QR code overlay
on the map. This is not added by CartoBlocks for Leaflet — enter your own WMS
URL to remove it.

= Can I load GeoJSON, GPX, or KML files? =

Yes. Use the "Data Layers" panel in the block inspector. Add one or more layers, choose the type (GeoJSON, GPX, KML), and enter the file URL. Style options and popup configuration are available per layer.

= Can I use a floor plan or custom image as the map? =

Yes. Toggle "Image map mode" in the Location panel and select an image from the Media Library (or enter a URL). The map switches to `L.CRS.Simple` — markers, lines, circles, and polygons remain usable, and coordinates become pixel positions.

= Can I overlay an image or video on a geo map? =

Yes. Use the "Overlays" panel to pin raster images or videos to geographic coordinates using SW/NE bounds.

= Can I use custom marker icons? =

Yes. Each marker has a "Custom Icon" subsection where you can select an image from the Media Library, set size and anchor with aspect-ratio lock, and choose from nine anchor presets. You can also use SVG markers with background color, icon color, and an icon-font CSS class.

= Where can I see the shortcode the block generates? =

Click the `<>` button in the block toolbar to open the Shortcode Viewer. It shows the exact shortcode that will be rendered on the frontend, with a one-click copy button.

= Does it support translations? =

Yes. All user-facing strings are wrapped in `__()` with the `cartoblocks-for-leaflet` textdomain. A `.pot` file is included in the `languages/` directory.

== Screenshots ==

1. Map block in the editor with the Location and Dimensions sidebar panels.
2. Markers panel — adding a marker with custom icon and popup content.
3. Data Layers panel — loading a GeoJSON file with style and popup configuration.
4. Circles panel — 2-click draw mode active on the map preview.
5. Tile Layer panel — WMS source toggle with URL, layer, and CRS fields.
6. Shortcode Viewer toolbar popover showing the generated shortcode.
7. Frontend rendering — map with markers, lines, and a GeoJSON layer.

== Changelog ==\
\
= 1.2.2 =\
* Changed: The frontend no longer prints inline <script> tags. Map resize and image-map fit logic moved to the block's view script, enqueued via the WordPress enqueue API, per WordPress Plugin Review guidelines.\
* Improved: Image-map fit now targets the correct map when multiple map blocks are on the same page.\
\
= 1.2.1 =\
* Changed: Renamed the plugin to "CartoBlocks for Leaflet" (slug `cartoblocks-for-leaflet`) for a more distinctive name, per WordPress Plugin Review guidelines. Updated the Contributors list and plugin metadata.\
* Changed: Moved the block to the Media category and gave its icon the Leaflet green accent.\
\
= 1.2.0 =\
* Changed: Replaced the bundled TGM Plugin Activation library with WordPress 6.5+ native plugin dependencies (the "Requires Plugins" header). WordPress now guides you to install and activate the required Leaflet Map plugin before activation. Minimum WordPress version is 6.8.\
* Changed: The editor preview iframe now enqueues its CSS/JS via the WordPress enqueue API instead of printing inline <style>/<script> tags, per WordPress Plugin Review guidelines.\
* Removed: ~3,900 lines of vendored third-party code (TGM Plugin Activation).\
\
= 1.1.1 =\
* i18n: Wrapped the remaining untranslated UI placeholder and added translator comments for two placeholder strings so all user-facing text is translation-ready. Regenerated the translation template (.pot). No change to plugin behaviour.\
* Docs: Added a "Known Limitations" note documenting that GPX data layers sourced from the Media Library may not render (upstream Content-Type limitation).\
\
= 1.1.0 =\
* New: Image and video overlay shortcodes ([leaflet-image-overlay] / [leaflet-video-overlay]) with drag-to-move and drag-to-resize handles in the editor preview.\
* New: Overlay bounds auto-fill centred on the current map view; overlays update live in the editor without an iframe reload.\
* Improved: Interaction toggles (dragging, keyboard, double-click zoom, etc.) now apply live in the preview.\
* Fixed: Image-map drag and zoom now sync with the sidebar controls in both the editor preview and the frontend; width is passed to [leaflet-image].\
* Fixed: Iframe no longer reloads mid-drag, which previously killed map panning.\
* Hardened: ABSPATH guard added to the generated blocks-manifest.php; Nominatim external service disclosed in the readme.\
\
= 1.0.7 =\
* Refactor: Internal modularization (no behaviour change). Plugin code is split into focused files under `includes/` so each feature has one home: shortcode builders, preview endpoint, geocoder, editor assets, file-type filters, TGM config. Main plugin file slimmed from 1450 to 95 lines; render.php from 614 to 105 lines. Frontend output is byte-identical to 1.0.6.\
\
= 1.0.6 =\
* Improved: Replaced "Anchor position" dropdown selects with a visual 3×3 grid for marker icon, shadow, and data-layer icon anchors.

= 1.0.5 =
* Fixed: Map container now fills the block wrapper exactly — width applied to wrapper div, shortcode always gets width="100%" to prevent tile gap.
* Fixed: invalidateSize called via WPLeafletMapPlugin.push so Leaflet recalculates tile layout after CSS settles.

= 1.0.4 =
* Fixed: New blocks now inherit the Default Width from Leaflet Map Settings.
* Fixed: Zoom Level slider min/max now respect the Min Zoom and Max Zoom block attributes.

= 1.0.3 =
* Fixed: New blocks now also inherit Fit Bounds, Zoom Controls, Scroll Wheel Zoom, Double Click Zoom, Min Zoom, and Max Zoom from Leaflet Map Settings.

= 1.0.2 =
* Fixed: New blocks now inherit Default Latitude, Longitude, Zoom, and Height from the Leaflet Map plugin Settings page instead of hardcoded placeholder values.

= 1.0.1 =
* Added: TGM Plugin Activation — guided one-click install of the required Leaflet Map plugin when not present.

= 1.0.0 =
* Full feature parity with the Leaflet Map plugin — all shortcodes wrapped: markers, lines, polygons, circles, GeoJSON/GPX/KML data layers, image map, WMS, image overlay, video overlay.
* Added: Full internationalisation (264 translatable strings, .pot file included).
* Added: wp_set_script_translations() wired for block editor translation loading.

= 0.10.0 =
* Added: `[leaflet-image-overlay]` and `[leaflet-video-overlay]` shortcode support via new "Overlays" panel. Pin raster images or videos to geo coordinates with configurable bounds, opacity, interactivity, z-index, CSS class, alt text, and aspect-ratio lock (image only).

= 0.9.0 =
* Added: `[leaflet-wms]` shortcode support via "Use WMS tile source" toggle in the Tile Layer panel. Replaces the standard OSM/raster tile layer with a WMS source. Configurable URL, layer name, and CRS.

= 0.8.0 =
* Added: `[leaflet-image]` shortcode support — "Image map mode" toggle in the Location panel replaces tiles with a flat image on `L.CRS.Simple`.
* Added: MediaUpload picker (WordPress Media Library) and plain URL fallback for the image source.
* Added: Center X / Center Y pixel coordinate fields (replaces Lat/Lng in image mode).

= 0.7.1 =
* Fixed: Removed unreachable `circleMarker` toggle from Data Layers (WordPress lowercases shortcode attributes; bozdoz checks camelCase — same trap as `touchZoom`).
* Fixed: Help text clarifies bare property name required for "Single property to display" (e.g. `ciudad`, not `{ciudad}`).
* Fixed: Warning added in "Default feature style" panel that styles apply to line/polygon features only.

= 0.7.0 =
* Added: `[leaflet-geojson]`, `[leaflet-gpx]`, and `[leaflet-kml]` shortcode support via new "Data Layers" panel.
* Added: Full attribute parity — source URL, fitbounds, popup template, popup property, table view, full style options, custom point icon with aspect-ratio lock and anchor presets.
* Added: 16 new Jest unit tests for `buildLayerShortcodes` (35 total).

= 0.6.0 =
* Added: `[leaflet-circle]` shortcode support with full attribute parity.
* Added: 2-click draw mode in the editor preview.
* Added: Live radius guide line and draggable center pin post-draw.
* Added: m/km unit toggle (stored in meters).
* Added: Per-circle address geocoder.

= 0.5.0 =
* Added: `[leaflet-line]` and `[leaflet-polygon]` shortcode support with full attribute parity.
* Added: Click-to-draw mode for lines and polygons in the editor preview.
* Added: Per-point address geocoder and crosshair overlay during draw mode.
* Added: GitHub Actions CI (PHPStan + PHPCS + Jest).

= 0.4.3 =
* Added: Per-marker "Search by address" helper using Nominatim geocoding.

= 0.4.2 =
* Added: SVG marker support — background color, icon color (theme palette + custom picker), icon CSS class.
* Added: Mutual-exclusion guard between SVG mode and custom icon mode.

= 0.4.1 =
* Added: Custom icon support — Media Library picker, size with aspect-ratio lock, icon/popup anchor with 9-position presets, optional shadow.
* Fixed: Custom icon not visible in editor iframe preview.
* Fixed: Content-less markers causing sibling markers to disappear (self-closing shortcode fix).

= 0.4.0 =
* Added: Per-marker advanced controls — alt text, auto-open popup, draggable, opacity, z-index offset.

= 0.3.x =
* Added: Shortcode viewer toolbar popover with copy button.
* Added: Address geocoding in Location panel (Nominatim, server-side AJAX).
* Added: Tile Layer panel with full tile override controls.
* Added: Zoom & Bounds panel (min/max zoom, max bounds).
* Added: Interaction controls panel (7 three-state toggles).
* Added: Map Controls panel (scale bar, custom attribution).
* Changed: iframe-based editor preview with postMessage bidirectional sync.
* Fixed: OSM tile 403 errors in the editor.

= 0.2.0 =
* Initial release with dynamic block, render.php shortcode generation, and ServerSideRender preview.
