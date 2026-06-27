# Plan 001: Fix editor preview infinite reload loop when "Fit Map to Markers" is enabled

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 313481a..HEAD -- includes/preview/template.php src/leaflet-map-block/edit.js`
> If either file changed since this plan was written, compare the "Current
> state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `313481a`, 2026-06-12
- **Issue**: https://github.com/jesusyesares/blocks-for-leaflet-map/issues/23

## Why this matters

In the block editor, when a user enables "Fit Map to Markers" (`fitMarkers`
attribute → `fitbounds="true"` in the `[leaflet-map]` shortcode) with 2 or
more markers, the preview iframe enters an infinite reload loop:
`admin-ajax.php?action=bflm_preview&...` keeps re-firing forever. The
frontend (actual published page) is unaffected — this is purely an
editor-preview bug. This is the only open bug in the repo and is a
WordPress.org submission blocker: an editor that loops forever will fail
review or generate user complaints. The fix is small and follows an existing
pattern already used elsewhere in the same file for the exact same class of
problem (`bflm_set_view`).

## Current state

### The loop mechanism

1. `src/leaflet-map-block/edit.js` builds a `shortcode` string from block
   attributes (including `lat`, `lng`, `zoom`) on every render, and derives
   `previewUrlKey` from it. When `previewUrlKey` changes, a `useEffect`
   debounces (500ms) and reloads the preview `<iframe>`'s `src`
   (`src/leaflet-map-block/edit.js:1423-1456`).

2. Inside the iframe, `includes/preview/template.php` renders a self
   contained HTML page. When `fitMarkers` is enabled and there are markers,
   it calls `map.fitBounds(...)`:

   ```php
   // includes/preview/template.php:455-469
   // fitBounds: when enabled, adjust the map to contain all markers.
   // Intentionally not guarded by isProgrammaticMove — the resulting moveend
   // fires bflm_map_update so the editor lat/lng/zoom attributes reflect the
   // computed view (the user delegated view control to the map contents).
   var fitMarkersEnabled = <?php echo wp_json_encode( (bool) $fit_markers ); ?>;
   if ( fitMarkersEnabled && markers.length > 0 ) {
       var bounds = [];
       markers.forEach( function ( marker ) {
           var ll = marker.getLatLng();
           bounds.push( [ ll.lat, ll.lng ] );
       } );
       if ( bounds.length > 0 ) {
           map.fitBounds( bounds, { padding: [ 30, 30 ] } );
       }
   }
   ```

3. `map.fitBounds()` triggers Leaflet's `moveend` event. The `moveend`
   handler registered just above (lines 414-423) is **not** guarded for this
   case:

   ```php
   // includes/preview/template.php:413-423
   // User pans / zooms → notify the editor.
   map.on( 'moveend zoomend', function () {
       if ( isProgrammaticMove ) {
           return;
       }
       var center = map.getCenter();
       window.top.postMessage(
           { type: 'bflm_map_update', blockId: blockId, lat: center.lat, lng: center.lng, zoom: map.getZoom() },
           '*'
       );
   } );
   ```

   Because `isProgrammaticMove` is `false` at this point, the
   `fitBounds()`-triggered `moveend` posts `bflm_map_update` back to the
   editor with the fit-computed `lat`/`lng`/`zoom` (which is typically
   **fractional**, e.g. `13.42`, since Leaflet zoom from `fitBounds` is not
   snapped to an integer the way the saved `zoom` attribute is).

4. In `src/leaflet-map-block/edit.js`, the `bflm_map_update` handler stores
   these fractional values directly into block attributes:

   ```js
   // src/leaflet-map-block/edit.js:1513-1521
   if ( msg.type === 'bflm_map_update' ) {
       // Flag the update so the lat/lng/zoom effect skips the echo.
       isIframeUpdateRef.current = true;
       setAttributes( {
           lat: parseFloat( msg.lat.toFixed( 6 ) ),
           lng: parseFloat( msg.lng.toFixed( 6 ) ),
           zoom: msg.zoom,
       } );
       return;
   }
   ```

5. The new (fractional) `lat`/`lng`/`zoom` attributes change `shortcode` /
   `previewUrlKey` (the PHP shortcode builder at
   `includes/shortcodes/map.php:27-30` embeds these values into the
   `[leaflet-map lat="..." lng="..." zoom="..."]` shortcode used to build the
   preview URL). The 500ms debounced effect at edit.js:1425-1456 sees the new
   `previewUrlKey` and reloads `iframe.src`.

6. The reloaded iframe runs `fitBounds()` again (step 2). Because the
   container's reported size can vary slightly between loads (and because
   floating-point `fitBounds` results are sensitive to exact pixel
   dimensions), the newly computed `lat`/`lng`/`zoom` rarely matches the
   previous iteration's values exactly. `previewUrlKey` changes again →
   reload again → loop, indefinitely.

### The existing correct pattern (`bflm_set_view`)

The same file already has the correct pattern for "a programmatic map move
that must NOT be reported back to the editor as a user-driven view change":

```php
// includes/preview/template.php:592-600
if ( msg.type === 'bflm_set_view' ) {
    isProgrammaticMove = true;
    map.once( 'moveend', function () {
        isProgrammaticMove = false;
    } );
    map.setView( [ msg.lat, msg.lng ], msg.zoom, { animate: true } );
    return;
}
```

This sets `isProgrammaticMove = true` BEFORE the programmatic move, and
clears it on the resulting `moveend` (via `map.once`), so the `moveend`
handler at lines 414-423 sees `isProgrammaticMove === true` and does NOT
post `bflm_map_update`.

### The fix

Apply the exact same guard to the `fitBounds()` call. The comment at
template.php:456-458 claims the lack of a guard is "intentional" so that
"the editor lat/lng/zoom attributes reflect the computed view" — but in
practice this causes an infinite loop instead of a single one-time sync, so
this plan removes that one-time-sync behavior in favor of a stable, non
looping preview. (If one-time syncing of the fit-computed view back into
saved attributes is wanted later, it would need a one-shot guard — e.g. only
sync once per block insertion — which is out of scope here.)

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Build JS (not needed for this PHP-only fix, but confirm nothing else broke) | `npm run build` | exit 0, `build/` updated |
| PHP lint (only covers 2 files currently, won't catch this file — informational) | `composer lint` | exit 0 (if composer deps installed; if `vendor/` missing, skip and note in report) |
| Manual smoke test | See Step 2 below | iframe loads once and stays stable |

## Scope

**In scope** (the only file you should modify):
- `includes/preview/template.php`

**Out of scope** (do NOT touch, even though related):
- `src/leaflet-map-block/edit.js` — the loop is fully preventable from the
  template.php side by suppressing the redundant `bflm_map_update` message;
  do not change the React component for this fix.
- `includes/shortcodes/map.php` — the `(int)` cast on `zoom` here is correct
  and unrelated to this bug.
- Any other shortcode/template files.

## Git workflow

- Branch: `fix/issue-23-fitmarkers-oscillation` (matches existing convention,
  e.g. `fix/scope-postmessage-by-clientid`, `fix/v1.0.4-bugs`)
- One commit for the fix. Commit message style (conventional commits, see
  `git log`): `fix: stop fitBounds from triggering editor preview reload loop (#23)`
- Do NOT push or open a PR unless explicitly instructed — leave that to the
  operator.

## Steps

### Step 1: Guard the `fitBounds()` call with `isProgrammaticMove`

In `includes/preview/template.php`, locate the `fitMarkersEnabled` block
(around line 459-469, shown in "Current state" above). Replace it so that
`isProgrammaticMove` is set to `true` before `map.fitBounds()` is called, and
cleared on the resulting `moveend`, exactly like the `bflm_set_view` handler
does. Also update the comment to reflect the new behavior (remove the claim
that lack of a guard is intentional).

Target shape:

```js
// fitBounds: when enabled, adjust the map to contain all markers.
// Guarded by isProgrammaticMove (same pattern as bflm_set_view) so the
// resulting moveend does not post bflm_map_update back to the editor —
// otherwise the editor would update lat/lng/zoom attributes, which changes
// the preview URL, which reloads the iframe, which calls fitBounds again,
// looping forever (see issue #23).
var fitMarkersEnabled = <?php echo wp_json_encode( (bool) $fit_markers ); ?>;
if ( fitMarkersEnabled && markers.length > 0 ) {
    var bounds = [];
    markers.forEach( function ( marker ) {
        var ll = marker.getLatLng();
        bounds.push( [ ll.lat, ll.lng ] );
    } );
    if ( bounds.length > 0 ) {
        isProgrammaticMove = true;
        map.once( 'moveend', function () {
            isProgrammaticMove = false;
        } );
        map.fitBounds( bounds, { padding: [ 30, 30 ] } );
    }
}
```

Notes:
- `isProgrammaticMove` is declared once near the top of the `init()`
  function's enclosing IIFE (`var isProgrammaticMove = false;` at
  template.php:156) — it's already in scope here, do not re-declare it.
- `map.once('moveend', ...)` mirrors the exact idiom used by
  `bflm_set_view` at template.php:595-597.
- This block runs inside `init()`, which itself runs after `map.on('moveend
  zoomend', ...)` is registered (line 414) — confirm in the live file that
  the `fitMarkersEnabled` block is still textually AFTER that `map.on(...)`
  registration (it is, per "Current state" above). If the ordering has
  changed, the guard still works because `isProgrammaticMove` is checked at
  the time `moveend` fires, not at registration time — but note this in your
  report if the structure looks different.

**Verify**: `grep -n "isProgrammaticMove" includes/preview/template.php` →
should show the variable declaration (~line 156), the `bflm_set_view` usage
(~lines 593-597), AND the new `fitMarkersEnabled` usage (2 new occurrences:
the `isProgrammaticMove = true;` and the `map.once('moveend', ...)` callback
setting it back to `false`).

### Step 2: Manual smoke test in the browser

This bug only manifests in the live block editor with the iframe preview, so
a manual check is required (the project has no test suite — see plans
009/010 for that effort, unrelated to this fix).

1. Ensure the local WordPress site is running (Laravel Herd —
   `http://leafletblock.test` is the dev URL used in this project, but
   confirm with `wp option get siteurl` if running via WP-CLI in the plugin
   directory).
2. Open the block editor on a page containing a `leaflet-map-block`, or
   insert a new one.
3. Add 2+ markers at different lat/lng positions (use the marker UI controls
   in the block sidebar).
4. Toggle "Fit Map to Markers" ON.
5. Open the browser DevTools Network tab, filter for `admin-ajax.php`.

**Verify**: Before the fix, `admin-ajax.php?action=bflm_preview...` requests
fire continuously / repeatedly without stopping. After the fix, the iframe
should load ONCE (or update a small, bounded number of times in response to
your own edits) and then go idle — no continuous re-firing. The map should
visually settle on a view containing both markers.

If you cannot run a browser (headless-only environment), state this
explicitly in your report and rely on Step 1's code-level verification plus
the "Done criteria" below — but flag that live verification is still needed
before this is marked DONE.

## Test plan

No automated test exists for this (it requires a running browser + iframe +
postMessage + AJAX loop — out of reach for a PHPUnit/JS-unit test in this
codebase's current state). The manual smoke test in Step 2 is the
verification. Do not attempt to write a Playwright/E2E test for this as part
of this plan — that would be a separate, larger effort.

## Done criteria

ALL must hold:

- [ ] `includes/preview/template.php` modified ONLY in the `fitMarkersEnabled`
      block (plus its comment) — `git diff --stat` shows exactly one file
      changed.
- [ ] `grep -c "isProgrammaticMove" includes/preview/template.php` returns a
      higher count than before the change (at least 2 more occurrences: the
      new `= true;` assignment and the `map.once('moveend', ...)` callback).
- [ ] Manual smoke test (Step 2) performed: iframe with `fitMarkers` enabled
      and 2+ markers loads and stabilizes — no continuous
      `admin-ajax.php?action=bflm_preview` requests.
- [ ] No files outside `includes/preview/template.php` are modified
      (`git status` / `git diff --stat`).
- [ ] `plans/README.md` status row for plan 001 updated to DONE (or BLOCKED
      with reason if the smoke test could not be completed).

## STOP conditions

Stop and report back (do not improvise) if:

- The code at `includes/preview/template.php` around lines 413-423 (the
  `moveend zoomend` handler) or lines 455-469 (the `fitMarkersEnabled` block)
  does not match the "Current state" excerpts above — the file may have
  changed since this plan was written.
- `isProgrammaticMove` is not declared in the scope you expect (search for
  `var isProgrammaticMove` — should be near the top of the enclosing IIFE,
  around line 156).
- After applying the fix, the manual smoke test STILL shows continuous
  reload requests. In that case, the root cause may involve a second
  contributing factor (e.g. `zoom` precision mismatch between the JS
  `shortcode` builder and the PHP `(int) $attrs['zoom']` cast in
  `includes/shortcodes/map.php:30`) — do not attempt a second fix without
  reporting back first, since that would touch `edit.js` (out of scope for
  this plan).

## Maintenance notes

- This fix relies on `fitBounds()`'s `moveend` firing synchronously/soon
  enough for `map.once('moveend', ...)` to catch it before any other code
  reads `isProgrammaticMove`. If Leaflet's behavior changes (e.g. animated
  `fitBounds` with a delayed `moveend`), re-verify this guard still
  suppresses the message.
- If a future feature wants the fit-computed view to be saved back into the
  block's `lat`/`lng`/`zoom` attributes (e.g. so the frontend also opens at
  the fitted view), that needs a deliberate one-shot sync — NOT the
  always-on `bflm_map_update` that caused this loop. Don't re-introduce the
  unguarded path.
- A reviewer should scrutinize: does disabling `bflm_map_update` for
  `fitBounds` moves change any other observable behavior? (Expected: no —
  the frontend already renders correctly without this sync, per the original
  issue report, and the saved `lat`/`lng`/`zoom` attrs simply keep whatever
  value the user last set manually or via drag.)
