# Changelog

All notable changes to the Blocks for Leaflet Map plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-04-13

### Changed
- Editor architecture: replaced direct Leaflet rendering in the block editor with an iframe-based preview that uses the Leaflet Map plugin's own shortcode processing — identical to the frontend output.
- Bidirectional sync: map pan/zoom and marker drag in the editor preview are now synced back to the block attributes via postMessage, and sidebar changes are sent to the preview without reloading tiles.

### Added
- Distribution packaging via `wp-scripts plugin-zip` with `.distignore` for clean zip builds.
- Click overlay on the map preview so the block can be re-selected after losing focus in the editor.
- Block instance isolation using Gutenberg's `clientId` — multiple map blocks on the same page no longer interfere with each other.

### Fixed
- OSM tile 403 errors in the block editor caused by missing Referer header on tile requests.
- Marker drag in one block no longer syncs to other blocks on the same page.

## [0.2.1] - 2026-04-12

### Changed
- Editor architecture: replaced ServerSideRender with native Leaflet map rendering directly in the block editor.
- Removed view-editor.js (~200 lines of cross-frame SSR patching logic).

### Added
- Marker support: draggable markers with Inspector Controls for adding, editing, and removing.
- Bidirectional sync between map and sidebar.
- Custom TileLayerWithReferrer subclass for OSM tile referrer policy.

### Fixed
- OSM tile 403 errors in development environments.

## [0.2.0] - 2026-04-11

### Added
- Initial dynamic block registration.
- render.php generating leaflet-map and leaflet-marker shortcodes from block attributes.
- ServerSideRender component in the editor for map preview.
- Block attributes: lat, lng, zoom, height, scrollWheelZoom, zoomControl, fitMarkers, markers.
- Dependency check: admin notice when Leaflet Map plugin is not active.
