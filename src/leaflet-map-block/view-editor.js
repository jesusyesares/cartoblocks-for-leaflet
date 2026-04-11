/**
 * view-editor.js
 *
 * Re-initialises Leaflet maps after ServerSideRender injects the shortcode HTML,
 * and provides bi-directional sync by dispatching a CustomEvent when the user
 * moves or zooms the map inside the editor.
 *
 * FRAME ARCHITECTURE (WordPress 6.3+ iframed editor)
 * ─────────────────────────────────────────────────
 * - editorScript files (including this one) execute in the OUTER admin frame.
 * - Block React components portal their DOM into the IFRAME document.
 * - Leaflet (L) and WPLeafletMapPlugin are injected into the IFRAME window
 *   via _wp_get_iframed_editor_assets() which captures enqueue_block_assets.
 * - This file therefore MUST NOT observe document.body (outer frame) nor call
 *   window.WPLeafletMapPlugin (outer frame – undefined).
 *
 * CORRECT PATTERN
 * ─────────────────────────────────────────────────
 * 1. edit.js attaches a MutationObserver to the block container (a portal node
 *    in the IFRAME document).  When SSR inserts a new .WPLeafletMap it calls
 *    window.bflmScheduleReinit(root) — the debounced entry point exposed here.
 * 2. bflmScheduleReinit coalesces rapid calls (SSR loading → loaded states)
 *    and calls bflmReinitLeafletMaps after 200 ms of silence.
 * 3. bflmReinitLeafletMaps uses root.ownerDocument.defaultView (IFRAME window)
 *    for all Leaflet globals and creates script elements via the IFRAME document
 *    so they execute in the correct global scope.
 * 4. After the map is re-created, moveend/zoomend listeners dispatch
 *    bflm-map-updated CustomEvents that bubble up to edit.js's container ref.
 *
 * CROSS-FRAME instanceof NOTE
 * ─────────────────────────────────────────────────
 * `root instanceof Element` fails when root belongs to the iframe and the check
 * runs in the outer frame — each browsing context has its own Element class.
 * Use `root.nodeType === 1` (a plain number comparison) instead.
 *
 * @package BlocksForLeafletMap
 */

import { addAction } from '@wordpress/hooks';
import domReady from '@wordpress/dom-ready';

// eslint-disable-next-line no-console
console.log( 'BFLM: Editor script loaded' );

/**
 * Per-root debounce timers.
 *
 * @type {Map<Element, ReturnType<typeof setTimeout>>}
 */
const bflmPendingTimers = new Map();

/**
 * Wait for Leaflet globals to be available in the iframe window, then run cb.
 * Retries up to MAX_ATTEMPTS times with DELAY_MS between each attempt.
 *
 * @param {Window}   iframeWin   The iframe's window object.
 * @param {Function} cb          Callback to invoke when Leaflet is ready.
 * @param {number}   [attempt=0] Current retry count (internal use).
 */
function bflmWhenLeafletReady( iframeWin, cb, attempt = 0 ) {
	const MAX_ATTEMPTS = 10;
	const DELAY_MS     = 300;

	const leafletExists = !! ( iframeWin && iframeWin.L && iframeWin.WPLeafletMapPlugin );

	// eslint-disable-next-line no-console
	console.log(
		'BFLM: Checking for Leaflet... ' + ( leafletExists ? 'Ready' : 'Waiting' ) +
		( attempt > 0 ? ' (attempt ' + attempt + '/' + MAX_ATTEMPTS + ')' : '' )
	);

	if ( leafletExists ) {
		cb();
		return;
	}

	if ( attempt >= MAX_ATTEMPTS ) {
		// eslint-disable-next-line no-console
		console.warn( 'BFLM: Leaflet not available after ' + MAX_ATTEMPTS + ' attempts. Giving up.' );
		return;
	}

	setTimeout( () => bflmWhenLeafletReady( iframeWin, cb, attempt + 1 ), DELAY_MS );
}

/**
 * Destroy any Leaflet map inside `root`, then re-execute the shortcode scripts
 * so WPLeafletMapPlugin recreates the map with the updated attributes.
 * After re-creation, attaches moveend/zoomend listeners for bi-directional sync.
 *
 * All Leaflet operations use the IFRAME's window via root.ownerDocument.defaultView.
 * All script elements are created via the IFRAME's document so they execute
 * in the correct global scope.
 *
 * IMPORTANT: Do NOT use `root instanceof Element` — use `root.nodeType === 1`.
 *
 * @param {Element} root Element wrapping the .WPLeafletMap div and its scripts.
 */
function bflmReinitLeafletMaps( root ) {
	try {
		// ── 1. Validate ──────────────────────────────────────────────────────
		// nodeType === 1 is ELEMENT_NODE. Works cross-frame; instanceof fails.
		if ( ! root || root.nodeType !== 1 ) {
			// eslint-disable-next-line no-console
			console.warn( 'BFLM: root is not a DOM element, aborting.', root );
			return;
		}

		// Identify the iframe context from the root element's owner document.
		const iframeDoc = root.ownerDocument;
		const iframeWin = iframeDoc.defaultView;

		// eslint-disable-next-line no-console
		console.log( 'BFLM: bflmReinitLeafletMaps — running in: ' + iframeDoc.location?.href );

		// The root itself may be the .WPLeafletMap node or a wrapper containing it.
		const mapContainer = root.classList?.contains( 'WPLeafletMap' )
			? root
			: root.querySelector( '.WPLeafletMap' );

		if ( ! mapContainer ) {
			// eslint-disable-next-line no-console
			console.log( 'BFLM: No .WPLeafletMap found in root, skipping.' );
			return;
		}

		// isConnected works across frame boundaries (unlike document.contains).
		if ( ! mapContainer.isConnected ) {
			// eslint-disable-next-line no-console
			console.log( 'BFLM: Container not connected to DOM, skipping.' );
			return;
		}

		// eslint-disable-next-line no-console
		console.log( 'BFLM: Container found, re-initializing...', mapContainer );

		// Wait for Leaflet to be available in the iframe before proceeding.
		bflmWhenLeafletReady( iframeWin, () => {
			const plugin = iframeWin.WPLeafletMapPlugin;

			// ── 2. Destroy existing Leaflet instances in this block ──────────

			if ( plugin && Array.isArray( plugin.maps ) ) {
				plugin.maps = plugin.maps.filter( ( map ) => {
					try {
						const container = map.getContainer();
						const shouldDestroy =
							! container.isConnected || root.contains( container );
						if ( shouldDestroy ) {
							map.remove();
							return false;
						}
						return true;
					} catch ( e ) {
						return false;
					}
				} );

				// Keep markergroups index aligned with surviving maps.
				const pruned = {};
				plugin.maps.forEach( ( _map, idx ) => {
					const key = idx + 1;
					if ( plugin.markergroups[ key ] ) {
						pruned[ key ] = plugin.markergroups[ key ];
					}
				} );
				plugin.markergroups = pruned;
			}

			// Belt-and-suspenders: clear stale _leaflet_id so L.map() won't throw.
			if ( mapContainer._leaflet_id ) {
				// eslint-disable-next-line no-console
				console.log( 'BFLM: Clearing stale _leaflet_id.' );
				delete mapContainer._leaflet_id;
			}

			// ── 3. Re-execute shortcode scripts ─────────────────────────────
			// Scripts created via iframeDoc execute in the iframe's global scope.

			const scripts = root.querySelectorAll( 'script' );

			if ( ! scripts.length ) {
				// eslint-disable-next-line no-console
				console.log( 'BFLM: No shortcode scripts found in root.' );
				return;
			}

			scripts.forEach( ( oldScript ) => {
				const newScript = iframeDoc.createElement( 'script' ); // ← iframe doc!
				Array.from( oldScript.attributes ).forEach( ( attr ) =>
					newScript.setAttribute( attr.name, attr.value )
				);
				newScript.textContent = oldScript.textContent;
				oldScript.parentNode.replaceChild( newScript, oldScript );
			} );

			// ── 4. Flush the WPLeafletMapPlugin callback queue ──────────────
			// In the iframed editor the load event may have already fired before
			// scripts were injected, leaving ready=false and callbacks queued.
			// init() flushes the queue and sets ready=true.
			if ( typeof plugin.init === 'function' ) {
				plugin.init();
			}

			// eslint-disable-next-line no-console
			console.log(
				'BFLM: Scripts executed. Maps count:',
				plugin?.maps?.length
			);

			// ── 5. Attach bi-directional sync listeners ──────────────────────
			// Find the Leaflet map whose DOM container is our .WPLeafletMap div.
			// After plugin.init() the map is fully created and present in plugin.maps.
			const leafletMap = Array.isArray( plugin.maps )
				? plugin.maps.find( ( m ) => {
					try { return m.getContainer() === mapContainer; } catch ( e ) { return false; }
				} )
				: null;

			if ( leafletMap ) {
				// Remove previous listeners to prevent duplicates on reinit.
				leafletMap.off( 'moveend zoomend' );

				leafletMap.on( 'moveend zoomend', () => {
					const center = leafletMap.getCenter();
					mapContainer.dispatchEvent(
						new iframeWin.CustomEvent( 'bflm-map-updated', {
							bubbles: true,
							detail: {
								lat:  center.lat,
								lng:  center.lng,
								zoom: leafletMap.getZoom(),
							},
						} )
					);
				} );

				// eslint-disable-next-line no-console
				console.log( 'BFLM: Bi-directional sync listeners attached.' );
			} else {
				// eslint-disable-next-line no-console
				console.warn( 'BFLM: Could not find Leaflet map instance for container.' );
			}

			// ── 6. Force Leaflet tile recalculation ─────────────────────────
			// Leaflet in an iframe may not calculate tile positions correctly
			// until it receives a resize event.
			setTimeout( () => {
				iframeWin.dispatchEvent( new iframeWin.Event( 'resize' ) );
				// eslint-disable-next-line no-console
				console.log( 'BFLM: Dispatched resize to iframe window.' );
			}, 100 );
		} );
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error( 'BFLM: Unexpected error in bflmReinitLeafletMaps:', err );
	}
}

/**
 * Debounce reinit calls for the same root element.
 * A 200 ms window coalesces the SSR "loading" and "loaded" mutations that fire
 * in rapid succession, preventing double execution on every attribute change.
 *
 * This is the function exposed on window and called by edit.js — routing all
 * callers through the debounce ensures a single execution per SSR cycle.
 *
 * @param {Element} root
 */
function bflmScheduleReinit( root ) {
	// eslint-disable-next-line no-console
	console.log( 'BFLM: Scheduling reinit...' );

	if ( bflmPendingTimers.has( root ) ) {
		clearTimeout( bflmPendingTimers.get( root ) );
	}

	const timer = setTimeout( () => {
		bflmPendingTimers.delete( root );
		bflmReinitLeafletMaps( root );
	}, 200 );

	bflmPendingTimers.set( root, timer );
}

/**
 * wp.hooks action — kept for any third-party listeners. edit.js uses the
 * window.bflmScheduleReinit direct call as its primary path.
 */
addAction(
	'blocks-for-leaflet-map.reinitMaps',
	'blocks-for-leaflet-map/view-editor',
	bflmScheduleReinit
);

/**
 * Expose the debounced scheduler on window.
 * edit.js calls window.bflmScheduleReinit(root) directly so every code path
 * goes through the debounce — preventing the double-execution that occurred
 * when the direct bflmReinitLeafletMaps call bypassed the timer.
 */
window.bflmScheduleReinit    = bflmScheduleReinit;
window.bflmReinitLeafletMaps = bflmReinitLeafletMaps; // kept for debugging.

/**
 * On domReady, log the outer-frame URL to confirm this script runs in the
 * outer admin frame (not the iframe).
 */
domReady( function () {
	// eslint-disable-next-line no-console
	console.log(
		'BFLM: view-editor.js domReady — outer frame: ' + window.location.href
	);
} );
