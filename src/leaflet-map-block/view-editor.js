/**
 * view-editor.js
 *
 * Re-initialises Leaflet maps after ServerSideRender injects the shortcode HTML.
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
 *    window.bflmReinitLeafletMaps(root) directly (primary path) and also fires
 *    wp.hooks for any other listeners.
 * 2. bflmScheduleReinit debounces and calls bflmReinitLeafletMaps.
 * 3. bflmReinitLeafletMaps uses root.ownerDocument.defaultView (IFRAME window)
 *    for all Leaflet globals and creates script elements via the IFRAME document
 *    so they execute in the correct global scope.
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
		'BFLM: Checking for Leaflet library... ' + ( leafletExists ? 'Exists' : 'Missing' ) +
		( attempt > 0 ? ' (attempt ' + attempt + '/' + MAX_ATTEMPTS + ')' : '' ) +
		' | iframeWin.L=' + ( !! iframeWin?.L ) +
		' | iframeWin.WPLeafletMapPlugin=' + ( !! iframeWin?.WPLeafletMapPlugin )
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
 *
 * All Leaflet operations use the IFRAME's window via root.ownerDocument.defaultView.
 * All script elements are created via the IFRAME's document so they execute
 * in the correct global scope.
 *
 * IMPORTANT: Do NOT use `root instanceof Element` here — that check uses the
 * outer frame's Element and always fails for nodes from the iframe. Use nodeType.
 *
 * @param {Element} root Element wrapping the .WPLeafletMap div and its scripts.
 */
function bflmReinitLeafletMaps( root ) {
	try {
		// ── 0. Debug: log what was received ─────────────────────────────────
		// eslint-disable-next-line no-console
		console.log(
			'BFLM: bflmReinitLeafletMaps called. root type:', typeof root,
			'| nodeType:', root?.nodeType,
			'| outerHTML:', root?.outerHTML
		);

		// ── 1. Validate ──────────────────────────────────────────────────────
		// nodeType === 1 is ELEMENT_NODE. This works cross-frame; instanceof
		// Element does NOT (each frame has its own Element constructor).
		if ( ! root || root.nodeType !== 1 ) {
			// eslint-disable-next-line no-console
			console.warn( 'BFLM: root is not a DOM element, aborting.', root );
			return;
		}

		// Identify the iframe context from the root element's owner document.
		const iframeDoc = root.ownerDocument;
		const iframeWin = iframeDoc.defaultView;

		// eslint-disable-next-line no-console
		console.log( 'BFLM: Running in document: ' + iframeDoc.location?.href );

		// The root itself may be the .WPLeafletMap node (when triggerReinit
		// passes the map element directly) or it may be a wrapper containing it.
		const mapContainer = root.classList?.contains( 'WPLeafletMap' )
			? root
			: root.querySelector( '.WPLeafletMap' );

		if ( ! mapContainer ) {
			// eslint-disable-next-line no-console
			console.log( 'BFLM: No .WPLeafletMap container found in root, skipping.' );
			return;
		}

		// isConnected works across frame boundaries (unlike document.contains).
		if ( ! mapContainer.isConnected ) {
			// eslint-disable-next-line no-console
			console.log( 'BFLM: Container is not connected to the DOM, skipping.' );
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
						// Destroy maps that left the document OR belong to this block.
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
				console.log( 'BFLM: Stale _leaflet_id detected, clearing before reinit.' );
				delete mapContainer._leaflet_id;
			}

			// ── 3. Re-execute shortcode scripts ─────────────────────────────
			// Scripts must be created via the IFRAME's document so they execute
			// in the iframe's global scope (where L and WPLeafletMapPlugin live).

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
			// construct-leaflet-map.js listens for window.load. In the iframed
			// editor the load event may have already fired before the scripts were
			// injected, leaving ready=false and callbacks queued. Calling init()
			// here flushes the queue and sets ready=true so subsequent push()
			// calls execute immediately.
			if ( typeof plugin.init === 'function' ) {
				plugin.init();
			}

			// eslint-disable-next-line no-console
			console.log(
				'BFLM: Scripts executed. WPLeafletMapPlugin maps:',
				plugin?.maps?.length
			);

			// ── 5. Force Leaflet tile recalculation ─────────────────────────
			// Leaflet initialised inside an iframe or a hidden/dynamic container
			// may not calculate tile positions correctly until it receives a resize
			// event. Dispatching one after a short delay (to let Leaflet finish its
			// own init cycle) ensures tiles fill the map container.
			setTimeout( () => {
				iframeWin.dispatchEvent( new iframeWin.Event( 'resize' ) );
				// eslint-disable-next-line no-console
				console.log( 'BFLM: Dispatched resize event to iframe window.' );
			}, 100 );
		} );
	} catch ( err ) {
		// eslint-disable-next-line no-console
		console.error( 'BFLM: Unexpected error in bflmReinitLeafletMaps:', err );
	}
}

/**
 * Debounce reinit calls for the same root element.
 * Multiple rapid SSR responses (loading → content) coalesce into one call.
 *
 * @param {Element} root
 */
function bflmScheduleReinit( root ) {
	// eslint-disable-next-line no-console
	console.log( 'BFLM: Mutation detected! root:', root );

	if ( bflmPendingTimers.has( root ) ) {
		clearTimeout( bflmPendingTimers.get( root ) );
	}

	const timer = setTimeout( () => {
		bflmPendingTimers.delete( root );
		bflmReinitLeafletMaps( root );
	}, 50 );

	bflmPendingTimers.set( root, timer );
}

/**
 * wp.hooks action — called from edit.js when its block-scoped observer
 * (which watches the portal DOM inside the iframe) detects a new .WPLeafletMap.
 * Using a hooks action keeps view-editor.js independent of edit.js.
 */
addAction(
	'blocks-for-leaflet-map.reinitMaps',
	'blocks-for-leaflet-map/view-editor',
	bflmScheduleReinit
);

/**
 * Expose bflmReinitLeafletMaps on window so edit.js can call it directly.
 * Direct call bypasses the hooks layer entirely and avoids any timing issues
 * with hook registration order across script loads.
 */
window.bflmReinitLeafletMaps = bflmReinitLeafletMaps;

/**
 * On domReady, log the outer-frame URL so we can confirm this script is running
 * in the outer admin frame (not the iframe). No observer is started here —
 * observation is handled by edit.js which has access to the portal DOM.
 */
domReady( function () {
	// eslint-disable-next-line no-console
	console.log(
		'BFLM: view-editor.js domReady in outer frame: ' + window.location.href
	);
} );
