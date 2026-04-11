/**
 * view-editor.js
 *
 * Re-initializes Leaflet maps after ServerSideRender injects the shortcode
 * HTML into the block editor.
 *
 * Root cause: React renders <ServerSideRender> output via dangerouslySetInnerHTML.
 * Browsers intentionally skip <script> tags inside innerHTML, so the
 * WPLeafletMapPlugin.push() callbacks in the shortcode output never run.
 *
 * Fix: a MutationObserver watches for new .WPLeafletMap divs; when one
 * appears it prunes stale map instances from WPLeafletMapPlugin (so that
 * createMap()'s index counter stays correct) and then re-executes every
 * <script> in the parent container by cloning them into a new node.
 */

import { addAction } from '@wordpress/hooks';

( function () {
	if ( typeof window === 'undefined' || typeof MutationObserver === 'undefined' ) {
		return;
	}

	/**
	 * Remove stale Leaflet map instances whose DOM containers are no
	 * longer attached to the document, then re-execute every <script>
	 * inside `root` so that WPLeafletMapPlugin callbacks run.
	 *
	 * @param {Element} root - Element that contains the map div + scripts.
	 */
	function reinitLeafletMaps( root ) {
		const plugin = window.WPLeafletMapPlugin;

		if ( plugin && Array.isArray( plugin.maps ) ) {
			// Destroy and remove any map whose container left the DOM.
			plugin.maps = plugin.maps.filter( ( map ) => {
				try {
					const container = map.getContainer();
					if ( ! document.contains( container ) ) {
						map.remove();
						return false;
					}
					return true;
				} catch ( e ) {
					return false;
				}
			} );

			// Keep markergroups in sync with the pruned maps array.
			const surviving = plugin.maps.length;
			const pruned = {};
			for ( let i = 1; i <= surviving; i++ ) {
				if ( plugin.markergroups[ i ] ) {
					pruned[ i ] = plugin.markergroups[ i ];
				}
			}
			plugin.markergroups = pruned;
		}

		// Re-execute every <script> in the rendered output by replacing each
		// one with a freshly created clone — the only way to force script
		// execution after innerHTML injection.
		root.querySelectorAll( 'script' ).forEach( ( oldScript ) => {
			const newScript = document.createElement( 'script' );
			Array.from( oldScript.attributes ).forEach( ( attr ) =>
				newScript.setAttribute( attr.name, attr.value )
			);
			newScript.textContent = oldScript.textContent;
			oldScript.parentNode.replaceChild( newScript, oldScript );
		} );
	}

	// Expose a named action so other editor code can trigger a reinit manually.
	addAction(
		'blocks-for-leaflet-map.reinitMaps',
		'blocks-for-leaflet-map/view-editor',
		reinitLeafletMaps
	);

	/**
	 * Watch for .WPLeafletMap containers injected by ServerSideRender.
	 * The observer must run in the same document as the editor canvas —
	 * wp-scripts bundles this file into the editor iframe automatically
	 * when it is listed as an editorScript in block.json.
	 */
	const observer = new MutationObserver( ( mutations ) => {
		for ( const mutation of mutations ) {
			for ( const node of mutation.addedNodes ) {
				if ( node.nodeType !== Node.ELEMENT_NODE ) {
					continue;
				}

				// ServerSideRender renders the full PHP output as direct
				// children; find any map container within the added subtree.
				const mapNodes = node.querySelectorAll( '.WPLeafletMap' );
				if ( mapNodes.length === 0 ) {
					continue;
				}

				// Scripts sit next to the map div inside the same wrapper.
				const scriptsRoot = mapNodes[ 0 ].parentElement || node;
				reinitLeafletMaps( scriptsRoot );
			}
		}
	} );

	function startObserver() {
		if ( document.body ) {
			observer.observe( document.body, {
				childList: true,
				subtree: true,
			} );
		}
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', startObserver );
	} else {
		startObserver();
	}
} )();
