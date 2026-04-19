=== Blocks for Leaflet Map ===
Contributors:      jesusyesares
Tags:              leaflet, map, openstreetmap, block, gutenberg
Requires at least: 6.0
Tested up to:      6.9
Stable tag:        0.3.7
Requires PHP:      7.4
License:           GPL-2.0-or-later
License URI:       https://www.gnu.org/licenses/gpl-2.0.html

A Gutenberg block that provides a visual editor for the Leaflet Map plugin shortcodes.

== Description ==

Blocks for Leaflet Map adds a native Gutenberg block that wraps the [Leaflet Map](https://wordpress.org/plugins/leaflet-map/) plugin shortcodes. Instead of writing shortcodes manually, you configure your map visually in the block editor — setting coordinates, zoom level, markers, and map options from the sidebar — and the plugin generates the correct shortcodes automatically.

**Features:**

* Interactive map preview in the editor — what you see is what you get.
* Pan, zoom, and drag markers directly on the map preview.
* Sidebar controls for latitude, longitude, zoom, height, scroll wheel zoom, and zoom controls.
* Add, edit, and remove markers with title and popup content (HTML supported).
* Multiple independent map blocks on the same page.
* Generates standard Leaflet Map shortcodes on the frontend — full compatibility with the Leaflet Map plugin ecosystem.

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

Yes. Each block is fully independent — different coordinates, zoom levels, and markers.

= Does the editor preview show real map tiles? =

Yes. The editor preview renders the map using the Leaflet Map plugin's own shortcode processing, so it looks identical to the frontend.

= What map tile provider does it use? =

Whatever you have configured in the Leaflet Map plugin settings. By default, OpenStreetMap tiles.

== Screenshots ==

1. Map block in the editor with sidebar controls.
2. Map with markers in the editor.
3. Frontend rendering with Leaflet Map shortcodes.

== Changelog ==

= 0.3.7 =
* Added: Address geocoding in the block inspector. New "Address" input mode in the Location panel lets you search for a place by name — the plugin queries Nominatim (OpenStreetMap) via a secure server-side AJAX endpoint and returns up to 5 candidates for you to choose from. The resolved coordinates are saved in the block; the address itself is editor-only metadata and never appears in the rendered shortcode, so no runtime geocoding happens on the frontend.

= 0.3.6 =
* Added: New "Tile Layer" panel in the block inspector with per-map tile layer override controls: Tile URL (with provider catalog links), Tile Size, Subdomains, Map ID, Access Token, Zoom Offset, No Wrap, and Detect Retina.
* Changed: Moved the existing Attribution control into the new Tile Layer panel for better grouping.
* Changed: Tile Size and Zoom Offset NumberControls now commit on blur to prevent intermediate iframe rebuilds.
* Changed: Tile Size minimum value raised to 64 to prevent runaway tile requests.

= 0.3.5 =
* Added: Zoom & Bounds panel with Min Zoom, Max Zoom, and Max Bounds attributes.
* Removed: touchZoom and bounceAtZoomLimits controls (not functional via shortcode due to Leaflet Map case-sensitivity bug).

= 0.3.4 =
* Added: Seven map interaction control attributes (dragging, keyboard, double-click zoom, box zoom, close popup on click, tap, inertia) with three-state model: Default (inherit Leaflet Map global settings), Enabled, or Disabled.

= 0.3.3 =
* Added: Show Scale toggle in Map Controls panel.
* Added: Custom Attribution field in Map Controls panel.

= 0.3.2 =
* Changed: Reorganized sidebar into collapsible panels: Location, Dimensions, Interaction, Map Controls, Markers.
* Added: "Fit to Markers" toggle in Location panel with live editor preview.
* Changed: Converted height to UnitControl with px, %, vh unit selector.
* Added: Width attribute with UnitControl (applied to block wrapper, not shortcode).
* Fixed: Prevented negative dimension values in height and width controls.
* Fixed: Backwards compatible with blocks created in earlier versions.

= 0.3.1 =
* Fixed: PHPCS ternary operator spacing warnings in render.php.

= 0.3.0 =
* Changed: Editor architecture — iframe-based preview using Leaflet Map shortcodes, identical to frontend.
* Changed: Bidirectional sync via postMessage — pan/zoom and marker drag sync between editor and preview.
* Added: Distribution packaging with wp-scripts plugin-zip.
* Added: Click overlay for block re-selection after losing focus.
* Added: Block instance isolation via clientId for multiple blocks per page.
* Fixed: OSM tile 403 errors in the editor.
* Fixed: Marker drag syncing across blocks.

= 0.2.1 =
* Changed: Replaced ServerSideRender with native Leaflet rendering in the editor.
* Added: Marker support with draggable markers and Inspector Controls.
* Added: Bidirectional sync between map and sidebar.
* Fixed: OSM tile 403 errors in development environments.

= 0.2.0 =
* Initial release with dynamic block, render.php shortcode generation, and ServerSideRender preview.
