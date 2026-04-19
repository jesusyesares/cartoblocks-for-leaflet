=== Blocks for Leaflet Map ===
Contributors:      jesusyesares
Tags:              leaflet, map, openstreetmap, block, gutenberg
Requires at least: 6.0
Tested up to:      6.9
Stable tag:        0.3.15
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

= 0.3.15 =
* Fixed: Drag-selecting shortcode text still failed at v0.3.14. Previous attempts used JavaScript event listeners to cancel the native HTML5 drag. The HTML5 spec provides a simpler mechanism: `draggable="false"` on a descendant overrides `draggable="true"` on an ancestor. Added `draggable="false"` directly to the `.bflm-shortcode-strip` div and the `<pre>` inside it as JSX attributes. The dragstart useEffect (added in v0.3.13, revised in v0.3.14) has been removed entirely.

= 0.3.14 =
* Fixed: Drag-selecting shortcode text still failed at v0.3.13. Root cause: Gutenberg renders the block wrapper (the element with `draggable="true"`) as a sibling of the shortcode strip rather than as its ancestor, so `dragstart` events fired on the wrapper never propagated to a listener attached to the strip. The listener is now installed on `strip.ownerDocument` (which also handles the editor canvas being iframed) and filters by whether the event originates inside the strip subtree. Block reordering drags that start outside the strip remain unaffected.

= 0.3.13 =
* Fixed: Drag-selecting shortcode text in the editor now works correctly. The previous fix (capture-phase mousedown + stopImmediatePropagation) targeted the wrong event — the browser's native HTML5 drag system is triggered by the block wrapper's `draggable="true"` attribute and cannot be vetoed via mousedown. The fix attaches a `dragstart` listener with `preventDefault()` on the shortcode strip container, which cancels the native drag before it can suppress text selection.

= 0.3.12 =
* Fixed: Drag-selecting shortcode text in the editor now works. Previous attempts with React-level `onMouseDown` stopPropagation had no effect because Gutenberg attaches its block drag listener in the capture phase at a higher level. The fix attaches a native `mousedown` listener in the capture phase directly on the shortcode strip container, calling `stopImmediatePropagation` so no further listeners (Gutenberg's included) see the event.
* Changed: Copy button hover and active states are now visually distinct — hover uses a soft blue-gray palette matching Gutenberg's primary blue, active darkens the background and adds a subtle press effect.

= 0.3.11 =
* Fixed: Copy button in the shortcode viewer now works in insecure contexts (plain HTTP). The previous implementation relied on `navigator.clipboard.writeText`, which browsers only expose on HTTPS, localhost, or 127.0.0.1 — custom development domains such as `.test` silently got no clipboard object. A `document.execCommand('copy')` fallback via a temporary textarea has been added.
* Fixed: Text inside the shortcode strip can now be drag-selected for manual copying, and the Copy button responds to hover/click interactions. The block wrapper's `data-draggable="true"` attribute (set by Gutenberg for block reordering) was intercepting `mousedown` events on all descendants before the browser could start native text selection or register button interactions. Adding `onMouseDown` with `stopPropagation` on the `<pre>` and the Copy button restores normal behaviour.

= 0.3.10 =
* Fixed: The Copy button in the shortcode viewer still crashed the block after v0.3.9 because the runtime version of `@wordpress/compose` bundled with WordPress uses an older `useCopyToClipboard` API that throws during first render when its ref target is not yet in the DOM. The hook has been removed entirely and replaced with a plain `onClick` handler using `navigator.clipboard.writeText`, which has no ref dependency and no runtime API coupling.

= 0.3.9 =
* Fixed: Shortcode viewer crashed the block with "TypeError: First argument must be a String, HTMLElement, HTMLCollection, or NodeList" when the toolbar toggle was clicked. The Copy button now uses a native HTML button element so the clipboard ref attaches correctly.

= 0.3.8 =
* Added: Shortcode viewer — a code icon button in the block toolbar toggles a strip below the map preview that shows the exact [leaflet-map] and [leaflet-marker] shortcodes the block will emit on the frontend. The strip includes a Copy button for one-click clipboard access and a 2-second "Copied!" confirmation. The strip is editor-only local UI state and never appears on the frontend.

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
