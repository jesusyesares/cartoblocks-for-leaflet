# Plan 003: Validate postMessage origin in the block editor's iframe listener

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 313481a..HEAD -- src/leaflet-map-block/edit.js`
> If this file changed since this plan was written, compare the "Current
> state" excerpt against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `313481a`, 2026-06-12
- **Issue**: none (proactive hardening, found during /improve audit)

## Why this matters

`src/leaflet-map-block/edit.js` listens for `window.message` events from its
preview `<iframe>` (the editor preview, served via the
`wp_ajax_bflm_preview` AJAX endpoint). The handler validates the message
shape (`msg.type` is a string) and which block instance it belongs to
(`msg.blockId === clientIdRef.current`), but does **not** validate
`event.origin`. Any script running in the same browsing context (e.g. a
malicious or compromised third-party admin-side script, or another
browser extension) can call `window.postMessage(...)` with a crafted
`{ type: 'bflm_map_update', blockId: <victim's clientId>, lat, lng, zoom }`
payload and have it accepted as if it came from the trusted preview iframe,
silently mutating the block's saved `lat`/`lng`/`zoom` attributes.

The fix is a standard one-line origin check, matching the convention already
documented in `includes/preview/template.php`'s own postMessage usage (which
explicitly discusses same-origin reasoning — see "Current state" for the
inbound side in that file, which is a separate, lower-risk listener not in
scope here).

## Current state

`src/leaflet-map-block/edit.js`, the iframe-to-editor message handler:

```js
// src/leaflet-map-block/edit.js:1495-1512
// ── Incoming postMessages from the preview iframe ─────────────────────────
useEffect( () => {
    /**
     * Handle postMessages sent by the preview iframe via window.top.
     *
     * @param {MessageEvent} event Browser message event.
     */
    function handleMessage( event ) {
        const msg = event.data;
        if ( ! msg || typeof msg.type !== 'string' ) {
            return;
        }

        // Ignore messages that belong to a different block instance.
        if ( msg.blockId !== clientIdRef.current ) {
            return;
        }

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
        // ... (additional msg.type branches follow, e.g. bflm_marker_update,
        // bflm_draw_point, bflm_draw_circle_center, etc.)
```

The listener is registered/torn down here:

```js
// src/leaflet-map-block/edit.js:1698-1699
window.addEventListener( 'message', handleMessage );
return () => window.removeEventListener( 'message', handleMessage );
```

The preview iframe (`includes/preview/template.php`) is always loaded from
the SAME WordPress origin — `admin-ajax.php?action=bflm_preview` on the same
site (see `buildPreviewUrl()` in `edit.js`, which constructs a same-origin
admin-ajax URL). So `event.origin` will always equal `window.location.origin`
for legitimate messages.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint JS | `npm run lint:js` | exit 0 (or only pre-existing warnings, no NEW errors on the changed lines) |
| Build | `npm run build` | exit 0, `build/leaflet-map-block/index.js` updated |
| Manual smoke test | See Step 2 | preview iframe still syncs map moves/marker drags to the editor |

## Scope

**In scope** (the only file you should modify):
- `src/leaflet-map-block/edit.js`

**Out of scope**:
- `includes/preview/template.php` — its inbound listener
  (`window.addEventListener('message', ...)` around line 587) already
  filters by `e.data.blockId !== blockId` and the comment there explicitly
  documents the same-origin reasoning for `'*'` as the postMessage target;
  that listener receives messages FROM the trusted parent editor frame, a
  lower-risk direction. Do not modify it as part of this plan.
- Any other postMessage call sites (`window.top.postMessage(...,'*')` in
  template.php) — changing the TARGET origin of outbound messages is a
  separate, larger change (would need to compute and pass the actual editor
  origin into the iframe) and is out of scope.

## Git workflow

- Branch: `fix/postmessage-origin-validation` (or similar — matches
  conventions like `fix/scope-postmessage-by-clientid`)
- One commit. Message style: `fix: validate postMessage origin in block editor iframe listener`
- Do NOT push or open a PR unless explicitly instructed.

## Steps

### Step 1: Add an origin check to `handleMessage`

In `src/leaflet-map-block/edit.js`, inside `handleMessage` (starts at line
1502 per "Current state"), add an origin check immediately after the
function opens, BEFORE the existing `msg` shape check. Target shape:

```js
function handleMessage( event ) {
    // Reject messages from any origin other than this site — the preview
    // iframe is always same-origin (admin-ajax.php on this WordPress site).
    if ( event.origin !== window.location.origin ) {
        return;
    }

    const msg = event.data;
    if ( ! msg || typeof msg.type !== 'string' ) {
        return;
    }

    // Ignore messages that belong to a different block instance.
    if ( msg.blockId !== clientIdRef.current ) {
        return;
    }

    // ... rest unchanged
```

**Verify**: `grep -n "event.origin !== window.location.origin" src/leaflet-map-block/edit.js`
→ returns exactly one match, placed as the first statement inside
`handleMessage`.

### Step 2: Manual smoke test

Build and load the block editor:

```bash
npm run build
```

1. Open the block editor on a page with a `leaflet-map-block` (or insert a
   new one).
2. Drag the map (pan/zoom) inside the preview iframe.
3. Add or drag a marker.

**Verify**: The sidebar's lat/lng/zoom fields (and marker position fields)
update to reflect the map interaction — i.e., `bflm_map_update` /
`bflm_marker_update` messages are still being accepted. This confirms the
origin check did not break the legitimate same-origin postMessage flow
(since both the parent editor and the iframe are served from the same
WordPress origin, `event.origin === window.location.origin` should hold for
all real messages).

If a browser cannot be driven in your environment, state this explicitly and
rely on Step 1's grep-based verification plus the reasoning in "Current
state" (same-origin iframe ⇒ `event.origin` always matches) — but flag that
live verification is still recommended before this is marked DONE.

## Test plan

No existing JS unit test infrastructure covers `edit.js`'s postMessage
handling (per the broader audit, this file has zero test coverage and that's
a separate, larger effort — not in scope here). The manual smoke test in Step
2 is the verification for this plan.

## Done criteria

ALL must hold:

- [ ] `src/leaflet-map-block/edit.js` modified ONLY to add the origin check
      described in Step 1 — `git diff --stat` shows exactly one file
      changed, and the diff is a small addition (a few lines), not a
      restructuring.
- [ ] `npm run lint:js` exits 0, or any reported issues are pre-existing
      (not on the lines you added).
- [ ] `npm run build` exits 0.
- [ ] Manual smoke test (Step 2) performed: map pan/zoom and marker drag
      still sync from the preview iframe to the editor sidebar.
- [ ] No files outside `src/leaflet-map-block/edit.js` are modified.
- [ ] `plans/README.md` status row for plan 003 updated to DONE.

## STOP conditions

Stop and report back (do not improvise) if:

- `handleMessage` at `src/leaflet-map-block/edit.js` does not match the
  "Current state" excerpt (function signature, location, or the
  `msg.blockId !== clientIdRef.current` check are structured differently) —
  the file may have changed since this plan was written.
- After adding the origin check, the Step 2 smoke test shows that
  `bflm_map_update` / `bflm_marker_update` messages are NO LONGER being
  accepted (sidebar fields stop updating on map interaction). This would
  mean the preview iframe is NOT actually same-origin in some configurations
  (e.g. a multisite subdomain setup, or `admin-ajax.php` served from a
  different scheme/port) — do not work around this by loosening the check to
  `'*'`-equivalent; report back with the observed `event.origin` value vs
  `window.location.origin` so the correct allowed-origin can be determined.

## Maintenance notes

- If this site is ever used in a configuration where the admin-ajax preview
  iframe is NOT same-origin (e.g. a CDN/proxy that serves `/wp-admin/` and
  `/wp-content/` from different origins), this check would need to allow
  that specific origin instead of a strict equality — but that's a
  significant architecture change and should be treated separately if it
  ever comes up.
- A reviewer should scrutinize: the check uses `window.location.origin`
  (the origin of the EDITOR page, i.e. `/wp-admin/post.php`), and the iframe
  is loaded from `/wp-admin/admin-ajax.php` on the same site — both should
  share the same origin (scheme + host + port). Confirm this holds in the
  reviewer's environment too.
