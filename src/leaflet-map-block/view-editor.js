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
 * Why not window.WPLeafletMapPlugin.init()?
 * init() is a one-shot "flush the queue" call. The queue is empty because
 * the shortcode scripts never ran — so calling init() again does nothing.
 * The only fix is to actually execute the inline scripts.
 *
 * @package BlocksForLeafletMap
 */

import { addAction } from '@wordpress/hooks';
import domReady from '@wordpress/dom-ready';

console.log( 'BFLM: Editor script loaded' ); // eslint-disable-line no-console

/**
 * Remove stale Leaflet map instances whose containers are no longer in the
 * document, then re-execute every <script> inside `root` by replacing each
 * with a freshly created clone — the only reliable way to force script
 * execution after an innerHTML injection.
 *
 * @param {Element} root Element that wraps the map div and its sibling scripts.
 */
function bflmReinitLeafletMaps( root ) {
	const plugin = window.WPLeafletMapPlugin;

	if ( plugin && Array.isArray( plugin.maps ) ) {
		// Destroy and prune maps whose DOM containers left the document.
		plugin.maps = plugin.maps.filter( ( map ) => {
			try {
				if ( document.contains( map.getContainer() ) ) {
					return true;
				}
				map.remove();
				return false;
			} catch ( e ) {
				return false;
			}
		} );

		// Keep markergroups index in sync with the surviving maps.
		const pruned = {};
		plugin.maps.forEach( ( _map, idx ) => {
			const key = idx + 1;
			if ( plugin.markergroups[ key ] ) {
				pruned[ key ] = plugin.markergroups[ key ];
			}
		} );
		plugin.markergroups = pruned;
	}

	// Re-execute each <script> in the rendered output.
	root.querySelectorAll( 'script' ).forEach( ( oldScript ) => {
		const newScript = document.createElement( 'script' );
		Array.from( oldScript.attributes ).forEach( ( attr ) =>
			newScript.setAttribute( attr.name, attr.value )
		);
		newScript.textContent = oldScript.textContent;
		oldScript.parentNode.replaceChild( newScript, oldScript );
	} );
}

// Expose as a named wp.hooks action so external code can trigger reinit.
addAction(
	'blocks-for-leaflet-map.reinitMaps',
	'blocks-for-leaflet-map/view-editor',
	bflmReinitLeafletMaps
);

/**
 * Start a MutationObserver scoped to document.body (inside the editor iframe).
 * Fires whenever ServerSideRender inserts a new .WPLeafletMap node.
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

				const mapNodes = node.querySelectorAll( '.WPLeafletMap' );
				if ( ! mapNodes.length ) {
					continue;
				}

				// Scripts live next to the .WPLeafletMap div in the same wrapper.
				const scriptsRoot = mapNodes[ 0 ].parentElement || node;
				bflmReinitLeafletMaps( scriptsRoot );
			}
		}
	} );

	observer.observe( document.body, {
		childList: true,
		subtree: true,
	} );
} );
