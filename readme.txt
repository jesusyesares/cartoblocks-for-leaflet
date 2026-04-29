=== Blocks for Leaflet Map ===
Contributors:      jesusyesares
Tags:              leaflet, map, openstreetmap, block, gutenberg
Requires at least: 6.0
Tested up to:      6.9
Stable tag:        0.10.0
Requires PHP:      7.4
License:           GPL-2.0-or-later
License URI:       https://www.gnu.org/licenses/gpl-2.0.html

A Gutenberg block that gives you a full visual editor for all Leaflet Map plugin shortcodes — no shortcode writing required.

== Description ==

Blocks for Leaflet Map adds a native Gutenberg block that wraps the [Leaflet Map](https://wordpress.org/plugins/leaflet-map/) plugin shortcodes. Configure your map visually in the block editor — the plugin generates the correct shortcodes automatically, and the frontend is rendered entirely by Leaflet Map.

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

* The [Leaflet Map](https://wordpress.org/plugins/leaflet-map/) plugin must be installed and active.
* WordPress 6.0 or higher.
* PHP 7.4 or higher.

== Installation ==

1. Make sure the [Leaflet Map](https://wordpress.org/plugins/leaflet-map/) plugin is installed and active.
2. Upload the `blocks-for-leaflet-map` folder to `/wp-content/plugins/`, or install the plugin through the WordPress plugins screen.
3. Activate the plugin through the Plugins screen.
4. In the block editor, search for "Leaflet Map Block" and add it to your page or post.

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

Yes. All user-facing strings are wrapped in `__()` with the `blocks-for-leaflet-map` textdomain. A `.pot` file is included in the `languages/` directory.

== Screenshots ==

1. Map block in the editor with the Location and Dimensions sidebar panels.
2. Markers panel — adding a marker with custom icon and popup content.
3. Data Layers panel — loading a GeoJSON file with style and popup configuration.
4. Circles panel — 2-click draw mode active on the map preview.
5. Tile Layer panel — WMS source toggle with URL, layer, and CRS fields.
6. Shortcode Viewer toolbar popover showing the generated shortcode.
7. Frontend rendering — map with markers, lines, and a GeoJSON layer.

== Changelog ==

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
