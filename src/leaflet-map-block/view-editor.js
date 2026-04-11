/**
 * view-editor.js
 *
 * Loaded inside the block editor iframe as an editorScript (block.json).
 * Watches for .WPLeafletMap containers injected by ServerSideRender and
 * re-initialises Leaflet maps after each server response.
 *
 * Why a MutationObserver?
 * React renders <ServerSideRender> output via dangerouslySetInnerHTML.
 * Browsers intentionally skip <script> tags inserted this way, so the
 * WPLeafletMapPlugin.push() callbacks in the [leaflet-map] shortcode output
 * never run. We detect the new container and replay those scripts.
 *
 * Race-condition fix:
 * A per-container debounce (setTimeout 50 ms) ensures we wait for the browser
 * to fully commit the new HTML before reading the DOM. This avoids the
 * "Map container not found" error that Leaflet throws when createMap() is
 * called during an intermediate render state.
 *
 * @package BlocksForLeafletMap
 */

import { addAction } from '@wordpress/hooks';
import domReady from '@wordpress/dom-ready';

// eslint-disable-next-line no-console
console.log( 'BFLM: Editor script loaded' );

/**
 * Map of pending debounce timers keyed by the root element.
 * Prevents multiple rapid-fire mutations from triggering concurrent reinits
 * on the same container.
 *
 * @type {Map<Element, number>}
 */
const bflmPendingTimers = new Map();

/**
 * Destroy any Leaflet map instance that lives inside `root`, remove it from
 * WPLeafletMapPlugin, then re-execute every <script> so that the fresh
 * shortcode callbacks run and a new map is created.
 *
 * @param {Element} root Element that wraps the .WPLeafletMap div and scripts.
 */
function bflmReinitLeafletMaps( root ) {
	// --- 1. Validate -------------------------------------------------------

	if ( ! ( root instanceof Element ) ) {
		return;
	}

	const mapContainer = root.querySelector( '.WPLeafletMap' );

	if ( ! mapContainer ) {
		// eslint-disable-next-line no-console
		console.log( 'BFLM: No .WPLeafletMap container found in root, skipping.' );
		return;
	}

	if ( ! document.contains( mapContainer ) ) {
		// eslint-disable-next-line no-console
		console.log( 'BFLM: Container is not attached to the DOM, skipping.' );
		return;
	}

	// eslint-disable-next-line no-console
	console.log( 'BFLM: Container found, re-initializing...', mapContainer );

	// --- 2. Destroy existing Leaflet instances in this block ---------------

	const plugin = window.WPLeafletMapPlugin;

	if ( plugin && Array.isArray( plugin.maps ) ) {
		plugin.maps = plugin.maps.filter( ( map ) => {
			try {
				const container = map.getContainer();

				// Remove maps that have left the document OR belong to
				// the block we are about to reinit.
				const shouldDestroy =
					! document.contains( container ) ||
					root.contains( container );

				if ( shouldDestroy ) {
					map.remove();
					return false;
				}

				return true;
			} catch ( e ) {
				// getContainer() throws if the map was already removed.
				return false;
			}
		} );

		// Keep markergroups index aligned with the surviving maps array.
		const pruned = {};
		plugin.maps.forEach( ( _map, idx ) => {
			const key = idx + 1;
			if ( plugin.markergroups[ key ] ) {
				pruned[ key ] = plugin.markergroups[ key ];
			}
		} );
		plugin.markergroups = pruned;
	}

	// Belt-and-suspenders: if Leaflet still has _leaflet_id on the container
	// (e.g. after a failed destroy), clear it so L.map() does not throw
	// "Map container is already initialized".
	if ( mapContainer._leaflet_id ) {
		// eslint-disable-next-line no-console
		console.log( 'BFLM: Stale _leaflet_id detected, clearing before reinit.' );
		delete mapContainer._leaflet_id;
	}

	// --- 3. Re-execute shortcode scripts -----------------------------------
	// Replacing a <script> node with a clone is the only way to force
	// execution after innerHTML/dangerouslySetInnerHTML injection.

	const scripts = root.querySelectorAll( 'script' );

	if ( ! scripts.length ) {
		// eslint-disable-next-line no-console
		console.log( 'BFLM: No scripts found in root, nothing to execute.' );
		return;
	}

	scripts.forEach( ( oldScript ) => {
		const newScript = document.createElement( 'script' );
		Array.from( oldScript.attributes ).forEach( ( attr ) =>
			newScript.setAttribute( attr.name, attr.value )
		);
		newScript.textContent = oldScript.textContent;
		oldScript.parentNode.replaceChild( newScript, oldScript );
	} );

	// eslint-disable-next-line no-console
	console.log( 'BFLM: Scripts executed. WPLeafletMapPlugin maps:', plugin?.maps?.length );
}

/**
 * Schedule a debounced reinit for `root`.
 *
 * If the same root triggers another mutation within 50 ms (common when
 * ServerSideRender transitions through loading states), the earlier timer
 * is cancelled and replaced, so reinit only runs once on the final DOM state.
 *
 * @param {Element} root
 */
function bflmScheduleReinit( root ) {
	if ( bflmPendingTimers.has( root ) ) {
		clearTimeout( bflmPendingTimers.get( root ) );
	}

	const timer = setTimeout( () => {
		bflmPendingTimers.delete( root );
		bflmReinitLeafletMaps( root );
	}, 50 );

	bflmPendingTimers.set( root, timer );
}

// Expose reinit as a wp.hooks action so edit.js (or external code) can
// call it without importing this module directly.
addAction(
	'blocks-for-leaflet-map.reinitMaps',
	'blocks-for-leaflet-map/view-editor',
	bflmScheduleReinit  // schedules, does not run immediately.
);

/**
 * Single MutationObserver on document.body (inside the editor iframe).
 * edit.js intentionally has no observer of its own — this is the sole
 * trigger point to avoid double-fires on the same mutation.
 */
domReady( function () {
	if ( typeof MutationObserver === 'undefined' ) {
		return;
	}

	const observer = new MutationObserver( ( mutations ) => {
		for ( const mutation of mutations ) {
			for ( const node of mutation.addedNodes ) {
				if ( node.nodeType !== Node.ELEMENT_NODE ) {
					continue;
				}

				// ServerSideRender wraps its output in a div; the .WPLeafletMap
				// container and its sibling <script> are children of that div.
				const mapNodes = node.querySelectorAll( '.WPLeafletMap' );
				if ( ! mapNodes.length ) {
					continue;
				}

				const scriptsRoot = mapNodes[ 0 ].parentElement || node;

				// eslint-disable-next-line no-console
				console.log( 'BFLM: MutationObserver detected .WPLeafletMap, scheduling reinit.' );
				bflmScheduleReinit( scriptsRoot );
			}
		}
	} );

	observer.observe( document.body, {
		childList: true,
		subtree: true,
	} );
} );
