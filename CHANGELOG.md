# Changelog

All notable changes to the Blocks for Leaflet Map plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.1] - 2026-04-20

### Added
- Per-marker **Custom Icon** subsection (contributes to [#14](https://github.com/jesusyesares/blocks-for-leaflet-map/issues/14)):
  - Master **"Use custom icon"** toggle. Non-destructive: disabling it hides all icon fields but preserves the stored values so they are not lost if re-enabled.
  - **Icon image** selected via the WordPress Media Library (`MediaUpload`). Stores `iconurl` in the marker attributes and emits `iconurl=` in the `[leaflet-marker]` shortcode.
  - **Icon Size** (width × height in px) → `iconsize="W,H"`.
  - **Icon Anchor** (X/Y in px) → `iconanchor="X,Y"`.
  - **Popup Anchor** (X/Y in px) → `popupanchor="X,Y"`.
  - Optional **"Add shadow"** sub-toggle (also non-destructive) with its own Media Library picker, **Shadow Size**, and **Shadow Anchor** fields → `shadowurl=`, `shadowsize="W,H"`, `shadowanchor="X,Y"`.
- **Auto-fill on image selection**: when a new image is chosen via `MediaUpload`, the size and anchor numeric fields are immediately populated from `media.width` / `media.height`. Icon defaults use the bottom-center "pin" convention (`iconAnchorX = width/2`, `iconAnchorY = height`, `popupAnchorX = 0`, `popupAnchorY = -height`). Shadow defaults use the lower-left corner (`shadowAnchorX = 0`, `shadowAnchorY = height`), matching the Leaflet convention for a drop shadow projected by an upper-left light source. If `media.width`/`media.height` are absent (e.g. SVGs uploaded without dimension metadata), only the URL is set. Original dimensions are stored as `iconOriginalWidth`/`iconOriginalHeight` (and shadow equivalents) for use by the aspect-ratio lock.
- **"Lock aspect ratio" toggle** for icon size and shadow size (default on, independent for each). When active, editing either width or height recalculates the other dimension from the stored original aspect ratio (falls back to the current ratio for markers created before v0.4.1). All four anchor coordinates (X and Y for icon anchor + popup anchor, or X and Y for shadow anchor) are simultaneously rescaled using their proportional position within the current dimensions, preserving the marker's visual anchor point. All updates are dispatched in a single `handleUpdateMarker` call to avoid intermediate renders. Six new schema properties added to the marker items schema: `iconOriginalWidth`, `iconOriginalHeight`, `lockIconAspectRatio` (default `true`), `shadowOriginalWidth`, `shadowOriginalHeight`, `lockShadowAspectRatio` (default `true`). None are emitted to the shortcode.
- **"Anchor position" preset selector** (9-position `SelectControl`) above each anchor's X/Y `NumberControl` pair, for both Icon Anchor and Shadow Anchor. Presets: top-left, top-center, top-right, middle-left, middle-center, middle-right, bottom-left, bottom-center, bottom-right. Selecting a preset fills the X/Y fields in one `handleUpdateMarker` call. The selector reflects the current stored values via `getAnchorPreset()` (±1 px tolerance) and shows "Custom" (non-selectable) when the values don't match any preset. Disabled when the corresponding size fields are empty. Popup Anchor is intentionally excluded — its convention (usually negative Y relative to the icon) has different semantics and warrants its own design iteration.

### Fixed
- **Custom icon invisible in editor preview**: The PHP AJAX handler `bflm_preview_map()` decoded the `markers` JSON correctly (all custom icon fields were present in the payload), but the per-marker shortcode-building loop only processed `lat`, `lng`, `title`, `content`, `alt`, `visible`, `draggable`, `opacity`, and `zIndexOffset`. The `useCustomIcon` block added to `buildShortcode()` in JavaScript was never mirrored in PHP, so `iconurl`, `iconsize`, `iconanchor`, `popupanchor`, `shadowurl`, `shadowsize`, and `shadowanchor` were silently dropped before `do_shortcode()` was called. Fixed by replicating the same conditional icon-attribute logic in `bflm_preview_map()`. The frontend `render.php` was already correct and did not require a change.
- **Both markers disappear when only one has popup content**: WordPress' shortcode parser is greedy — a `[leaflet-marker]` opener with no matching `[/leaflet-marker]` was being paired with the closer of the next marker that did have content, producing a malformed shortcode that Leaflet Map could not render. Fixed by emitting content-less markers as self-closing shortcodes (`[leaflet-marker ... /]`), the standard WordPress form (same as `[gallery /]`). The parser now treats the self-closing tag as complete and does not search for a closer. Fix applied identically to all three serialization paths: `buildShortcode()` in `edit.js` (toolbar viewer), `bflm_preview_map()` in `blocks-for-leaflet-map.php` (editor iframe preview), and the marker loop in `render.php` (frontend).
- **Block validation warnings for nullable numeric marker attributes**: Nullable icon/shadow size and anchor coordinate attributes (`iconWidth`, `iconHeight`, `iconAnchorX`, `iconAnchorY`, `popupAnchorX`, `popupAnchorY`, `shadowWidth`, `shadowHeight`, `shadowAnchorX`, `shadowAnchorY`) were declared in `block.json` with `"type": "number"` only. When a field is cleared by the user, the value becomes `null`, which fails Gutenberg's block validation against a `number`-only schema. Switched all ten to `"type": ["number", "null"]` so cleared fields store and round-trip correctly without triggering save warnings.

### Changed
- **`__next40pxDefaultSize` opt-in**: Added the prop to the Opacity `RangeControl`, the Zoom Level `RangeControl`, and the two new "Anchor position" `SelectControl` elements (icon and shadow). Eliminates `"36px default size is deprecated"` console warnings introduced in WordPress 6.8, and pre-empts the breaking default-size change planned for WordPress 7.1. All other `SelectControl` and `RangeControl` instances in the file already carried the prop from earlier releases.

## [0.4.0] - 2026-04-20

### Added
- Six per-marker controls in the Markers panel, grouped under a collapsible "Advanced" subsection inside each marker card (closes part of [#14](https://github.com/jesusyesares/blocks-for-leaflet-map/issues/14)):
  - **Alt Text** — accessible alternative text for the marker image.
  - **Auto-open Popup** — opens the marker popup automatically on page load (`visible="1"`).
  - **Draggable** — allows visitors to drag the marker; the new position is logged to the browser console.
  - **Opacity** — marker icon opacity, 0–1 range, step 0.05.
  - **Z-Index Offset** — integer offset to raise or lower the marker in the stacking order relative to others. Help text notes that Leaflet already offsets markers by latitude, so values of 10+ are typically needed to see a visible change.
  - **Title** field now has help text ("Browser tooltip shown on hover. Also used as the marker's accessible name.").
- All new attributes are emitted conditionally: omitted from the `[leaflet-marker]` shortcode when at their Leaflet defaults (false booleans, opacity 1, zIndexOffset 0, empty strings). Matches the omit-when-default pattern used by map-level attributes since v0.3.x.

### Fixed
- Z-Index Offset NumberControl was not persisting changes. The blur-commit pattern (index-keyed object state + `onBlur`) failed because in React 18 automatic batching `onChange` and `onBlur` can fire within the same rendering cycle: the `onBlur` closure captured a stale `localZIndexOffsets = {}` reference, fell back to `marker.zIndexOffset ?? 0`, and called `handleUpdateMarker` with `0` — a no-op that never dirtied the post. Switched to direct `onChange` commit, matching all other per-marker controls. (Discovered and fixed during v0.4.0 manual testing, before merge.)

## [0.3.17] - 2026-04-19

### Changed
- Shortcode popover width increased: `min-width` raised from 320px to 480px, `max-width` from 520px to 720px, to reduce wrapping on long shortcodes with many attributes.
- Code block inside the popover now uses a VS Code Dark+ inspired color scheme: `#1e1e1e` background, `#d4d4d4` text, `#3c3c3c` border. No syntax highlighting is applied — the shortcode is plain monospace text. Padding adjusted to `10px 12px` for visual comfort.

### Fixed
- Clicking the Copy button no longer dismisses the popover. `@wordpress/components`'s `<Popover>` uses `mousedown` (not `click`) for its click-outside detection. The Copy button's `mousedown` event was bubbling up to the Popover's dismiss handler before `onClick` fired, closing the popover and making the "Copied!" feedback invisible. Adding `onMouseDown={ e => e.stopPropagation() }` to the Copy button prevents the dismiss while leaving `onClick` and the clipboard copy intact.

## [0.3.16] - 2026-04-19

### Changed
- Shortcode viewer relocated from an in-block strip to a toolbar popover. The previous strip rendered inside the block's DOM subtree, where Gutenberg's `draggable="true"` attribute on the block wrapper made text selection impossible — six iterations across v0.3.10–v0.3.15 attempted React bubble-phase `onMouseDown`, native capture-phase `mousedown` + `stopImmediatePropagation`, `dragstart` + `preventDefault` on the strip node, `dragstart` + `preventDefault` on `ownerDocument` with a closest-guard, and `draggable="false"` as a JSX attribute — none succeeded because the drag is initiated by the browser's OS-level DnD system on the block wrapper, which sits outside the strip's subtree. The `<Popover>` component renders via a React portal into the document body (outside the block's DOM subtree entirely), so none of the drag/selection constraints apply. The popover is anchored to the toolbar button via `anchor={ toggleButtonRef.current }`, closes on outside click or Escape via `onClose`, and is placed below the button via `placement="bottom-start"`. The toolbar button, Copy action, and "Copied!" feedback are unchanged. The `stripRef` ref and all dragstart/mousedown event-listener useEffects have been removed.

## [0.3.15] - 2026-04-19

### Fixed
- Drag-selecting shortcode text still failed at v0.3.14 (sixth iteration). All five previous JS-based approaches (React `onMouseDown`, capture-phase `mousedown` + `stopImmediatePropagation`, `dragstart` + `preventDefault` on the strip node, `dragstart` + `preventDefault` on `ownerDocument` with closest-guard) either targeted the wrong event or the wrong node. The HTML5 spec provides a simpler, declarative mechanism: `draggable="false"` on a descendant overrides `draggable="true"` on any ancestor. Added `draggable="false"` as a JSX attribute directly on the `.bflm-shortcode-strip` `<div>` and the `<pre>` inside it. The `dragstart` `useEffect` introduced in v0.3.13 and revised in v0.3.14 has been removed entirely — no JS is needed.

## [0.3.14] - 2026-04-19

### Fixed
- Drag-selecting shortcode text still failed at v0.3.13 (fifth iteration on this issue). Root cause: Gutenberg does not render the block wrapper — the element that carries `draggable="true"` for native HTML5 DnD — as an ancestor of the shortcode strip. The two elements are siblings in the rendered DOM, so `dragstart` events dispatched on the block wrapper never propagate into the strip's subtree. A listener attached to the strip itself therefore never fires. The fix attaches the `dragstart` listener to `strip.ownerDocument` instead — which receives all `dragstart` events regardless of where they originate — and guards with `e.target.closest('.bflm-shortcode-strip')` so that only drags starting inside the strip are cancelled via `preventDefault()`. Drags starting on the block wrapper (for Gutenberg block reordering) do not match the guard and proceed normally. Using `ownerDocument` (rather than the top-level `window.document`) also correctly handles the case where the Gutenberg canvas is rendered inside an iframe.

## [0.3.13] - 2026-04-19

### Fixed
- Drag-selecting shortcode text in the editor now works correctly. All previous attempts (React bubble-phase `onMouseDown`, capture-phase `mousedown` with `stopImmediatePropagation`) targeted the wrong event. The root cause is the block wrapper's `draggable="true"` attribute (native HTML5 DnD, set by Gutenberg for block reordering): the browser initiates a native drag on mousedown+movement at the OS level before JavaScript text selection can start, and JavaScript `stopPropagation`/`stopImmediatePropagation` on `mousedown` cannot veto it. The fix attaches a `dragstart` listener with `e.preventDefault()` on the shortcode strip container — this is the only point where native HTML5 drag can be cancelled. The `mousedown` listener (added in v0.3.12) has been removed entirely.

## [0.3.12] - 2026-04-19

### Fixed
- Drag-selecting shortcode text in the editor now works. React bubble-phase `onMouseDown` stopPropagation (added in v0.3.11) had no effect because Gutenberg attaches its block drag listener in the capture phase at the document or block-wrapper level, so our handler never ran first. The fix attaches a native `addEventListener('mousedown', block, true)` with `capture = true` directly on the shortcode strip container, calling both `stopPropagation` and `stopImmediatePropagation` — this runs before any bubble-phase listener and before any other capture-phase listener deeper in the tree. The old React-level `onMouseDown` props have been removed from the `<button>` and `<pre>` as they are superseded by this approach.

### Changed
- Copy button hover and active states updated: hover uses a soft blue-gray background (`#e7eef5`) with Gutenberg's primary blue border and text (`#2271b1`); active darkens to `#d5e2ee` / `#135e96` and adds a 1 px downward translate for a pressed effect. A 120 ms ease transition makes the state changes feel responsive.

## [0.3.11] - 2026-04-19

### Fixed
- Copy button in the shortcode viewer now works in insecure contexts (plain HTTP). The previous implementation relied on `navigator.clipboard.writeText`, which browsers only expose on HTTPS, localhost, or 127.0.0.1 — custom development domains such as `.test` silently got no clipboard object. A `document.execCommand('copy')` fallback via a hidden off-screen textarea has been added as a secondary path; the primary path still uses the Clipboard API when available.
- Text inside the shortcode strip can now be drag-selected for manual copying, and the Copy button responds correctly to hover/click interactions. Gutenberg sets `data-draggable="true"` on the block wrapper and intercepts `mousedown` on all descendants to initiate block reordering — preventing native text selection on the `<pre>` and suppressing interactive states on the Copy button. `onMouseDown` handlers calling `e.stopPropagation()` on both elements prevent the event from reaching Gutenberg's drag listener.

## [0.3.10] - 2026-04-19

### Fixed
- The Copy button in the shortcode viewer still crashed the block after v0.3.9 because the runtime version of `@wordpress/compose` bundled with WordPress uses an older `useCopyToClipboard` API (backed by clipboard.js) that throws "TypeError: First argument must be a String, HTMLElement, HTMLCollection, or NodeList" during first render when its ref target is not yet in the DOM. The v0.3.9 fix (switching from `<Button>` to a native `<button>`) addressed only the ref-forwarding symptom, not the root cause: the hook itself was incompatible with the runtime. The hook and its `@wordpress/compose` import have been removed entirely and replaced with a plain `onClick` handler using `navigator.clipboard.writeText`, which has no ref dependency and no runtime API coupling. Includes a silent fallback for insecure contexts where `navigator.clipboard` is unavailable.

## [0.3.9] - 2026-04-19

### Fixed
- Shortcode viewer crashed the block with "TypeError: First argument must be a String, HTMLElement, HTMLCollection, or NodeList" when the toolbar toggle was clicked. `@wordpress/components`'s `<Button>` does not reliably forward refs to its underlying DOM node, preventing `clipboard.js` from attaching its click listener. The Copy button now uses a native `<button>` element (which always receives the ref directly), styled to match a Gutenberg secondary small button via `editor.scss`.

## [0.3.8] - 2026-04-19

### Added
- Shortcode viewer (closes #13): a code icon button in the block toolbar toggles a strip below the map preview showing the exact `[leaflet-map]` and `[leaflet-marker]` shortcodes the block will emit on the frontend.
  - Built from a declarative `LEAFLET_MAP_DESCRIPTORS` table in `edit.js` that mirrors `render.php` attribute-for-attribute, with cross-reference comments in both files to prevent drift.
  - Includes a Copy button (`useCopyToClipboard` from `@wordpress/compose`) with a 2-second "Copied!" inline confirmation.
  - Shortcode text is selectable (overrides the block wrapper's `user-select: none`).
  - Strip is local editor UI state only (`useState`); never persisted as a block attribute and never rendered on the frontend.

## [0.3.7] - 2026-04-19

### Added
- Address geocoding in the block inspector (closes #7). New "Address" input mode in the Location panel lets you search for a place by name — the plugin queries Nominatim (OpenStreetMap) via a secure server-side AJAX endpoint (`wp_ajax_bflm_geocode`) and returns up to 5 candidates for you to choose from. The resolved coordinates are saved in the block; the address itself is editor-only metadata and never appears in the rendered shortcode, so no runtime geocoding happens on the frontend.

## [0.3.6] - 2026-04-18

### Added
- New "Tile Layer" panel in the block inspector with per-map tile layer override controls (closes #5):
  - Tile URL with provider catalog links (Free Tile Services, Leaflet Providers Preview, OSM Wiki) and format placeholder
  - Tile Size, Subdomains, Map ID, Access Token, Zoom Offset
  - No Wrap and Detect Retina (three-state: Default / Enabled / Disabled)
- Each control includes a `help` text explaining its purpose and when to use it.

### Changed
- Moved the existing Attribution control into the new Tile Layer panel for better grouping.
- Tile Size and Zoom Offset NumberControls now commit on blur (instead of on every keystroke) to prevent intermediate iframe rebuilds.
- Tile Size minimum value raised from 1 to 64 to prevent runaway tile requests when the value is set too low.

## [0.3.5] - 2026-04-15

### Added
- Zoom & Bounds panel in the block inspector with Min Zoom, Max Zoom, and Max Bounds attributes.

### Removed
- touchZoom and bounceAtZoomLimits interaction controls — Leaflet Map ignores these via shortcode due to a case-sensitivity bug in the plugin.

## [0.3.4] - 2026-04-15

### Added
- Seven map interaction control attributes (dragging, keyboard, double-click zoom, box zoom, close popup on click, tap, inertia) with a three-state model: Default (inherit Leaflet Map global settings), Enabled, or Disabled.

## [0.3.3] - 2026-04-14

### Added
- Show Scale toggle in the Map Controls panel.
- Custom Attribution field in the Map Controls panel.

### Fixed
- Attribution HTML was being mangled by double-escaping; switched to wp_kses_post and wrapped the value in single quotes in the shortcode string to preserve href="..." attributes.

## [0.3.2] - 2026-04-14

### Added
- "Fit to Markers" toggle in the Location panel with live editor preview.
- Width attribute with UnitControl (applied to block wrapper, not shortcode).

### Changed
- Reorganized sidebar into collapsible panels: Location, Dimensions, Interaction, Map Controls, Markers.
- Converted height to UnitControl with px, %, vh unit selector.

### Fixed
- Prevented negative dimension values in height and width controls.
- Backwards compatible with blocks created in earlier versions.

## [0.3.1] - 2026-04-14

### Fixed
- PHPCS ternary operator spacing warnings in render.php.

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
