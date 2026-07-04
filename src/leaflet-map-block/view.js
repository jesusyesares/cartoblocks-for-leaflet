/**
 * Frontend view script for the Leaflet Map Block.
 *
 * Replaces the three inline <script> blocks that were previously emitted by
 * render.php (Plugin Review: "Use wp_enqueue commands"). Registered as
 * `viewScript` in block.json so WordPress enqueues it automatically on any
 * page that renders at least one instance of this block.
 *
 * Two behaviours, selected per wrapper element via data attributes:
 *
 * 1. Image maps (`data-bflm-image-zoom` present):
 *    Polls for the Leaflet Map plugin instance, finds the map whose container
 *    is inside the wrapper, then runs the image-fit calculation (zoom + offset).
 *    Retries up to 50 × 100 ms because Leaflet Map initialises asynchronously
 *    via the `window.WPLeafletMapPlugin` push queue.
 *
 * 2. WMS / regular maps (no `data-bflm-image-zoom`):
 *    Pushes a callback onto `window.WPLeafletMapPlugin` that finds the map
 *    whose container is inside the wrapper and calls `map.invalidateSize()`
 *    after a 50 ms timeout (needed so the map repaints after the block's CSS
 *    percentage-width has been applied by the browser).
 *
 * @package
 */

( function () {
	/**
	 * Find the Leaflet map instance whose container is a descendant of `wrapper`.
	 *
	 * @param {HTMLElement} wrapper - The block wrapper element.
	 * @return {Object|null} The Leaflet map instance, or null if not found.
	 */
	function findMapInWrapper( wrapper ) {
		const plugin = window.WPLeafletMapPlugin;
		if ( ! plugin || ! plugin.maps ) {
			return null;
		}
		for ( let i = 0; i < plugin.maps.length; i++ ) {
			const map = plugin.maps[ i ];
			if (
				map &&
				map.getContainer &&
				wrapper.contains( map.getContainer() )
			) {
				return map;
			}
		}
		return null;
	}

	/**
	 * Run the image-fit logic for a single image-map wrapper.
	 *
	 * Reads the zoom offset from `wrapper.dataset.bflmImageZoom`, polls until
	 * the Leaflet Map plugin, its image overlay, and the overlay's natural image
	 * dimensions are all available, then sets the map view to fit the image.
	 *
	 * @param {HTMLElement} wrapper    - The block wrapper element.
	 * @param {number}      zoomOffset - The imageZoom attribute value (may be negative).
	 */
	function initImageMap( wrapper, zoomOffset ) {
		let attempts = 0;

		/**
		 * Attempt to fit the image map. Retries on a 100 ms interval for up to
		 * 50 attempts to account for Leaflet Map's async initialisation.
		 *
		 * @return {void}
		 */
		function fitImage() {
			const map = findMapInWrapper( wrapper );
			if ( ! map ) {
				if ( 50 > ++attempts ) {
					setTimeout( fitImage, 100 );
				}
				return;
			}

			if ( ! map.is_image_map ) {
				return;
			}

			// Find the ImageOverlay layer (has getBounds + getElement).
			let overlay = null;
			map.eachLayer( function ( l ) {
				if ( ! overlay && l.getBounds && l.getElement ) {
					overlay = l;
				}
			} );
			if ( ! overlay ) {
				if ( 50 > ++attempts ) {
					setTimeout( fitImage, 100 );
				}
				return;
			}

			// Wait until the image's natural dimensions are available.
			const img = overlay.getElement();
			if ( ! img || ! img.naturalWidth ) {
				if ( 50 > ++attempts ) {
					setTimeout( fitImage, 100 );
				}
				return;
			}

			const iw = img.naturalWidth;
			const ih = img.naturalHeight;
			const mw = map.getContainer().offsetWidth;
			const mh = map.getContainer().offsetHeight;

			// In L.CRS.Simple, bozdoz projects the image at projected_zoom = 1.
			// Fit: 2^Z = 2*mw/iw → Z = log2(2*mw/iw).
			const fitZoomX = Math.log( ( 2 * mw ) / iw ) / Math.LN2;
			const fitZoomY = Math.log( ( 2 * mh ) / ih ) / Math.LN2;
			const fitZoom = Math.min( fitZoomX, fitZoomY );

			map.options.zoomSnap = 0;
			map.setMinZoom( fitZoom + zoomOffset );
			map.setMaxBounds( null );
			map.setView( [ 0, 0 ], fitZoom + zoomOffset, { animate: false } );
		}

		fitImage();
	}

	/**
	 * Register an invalidateSize callback for a WMS or regular map wrapper.
	 *
	 * Pushes a function onto `window.WPLeafletMapPlugin` (creating the array if
	 * it does not yet exist, matching the pattern Leaflet Map itself uses). The
	 * callback finds the map whose container lives inside `wrapper` and calls
	 * `map.invalidateSize()` after 50 ms so the map repaints once the browser
	 * has applied the block's percentage-width CSS.
	 *
	 * @param {HTMLElement} wrapper - The block wrapper element.
	 * @return {void}
	 */
	function initStandardMap( wrapper ) {
		window.WPLeafletMapPlugin = window.WPLeafletMapPlugin || [];
		window.WPLeafletMapPlugin.push( function () {
			const map = findMapInWrapper( wrapper );
			if ( map && map.invalidateSize ) {
				setTimeout( function () {
					map.invalidateSize();
				}, 50 );
			}
		} );
	}

	/**
	 * Initialise all Leaflet Map Block wrapper elements on the current page.
	 *
	 * Iterates over every `.bflm-leaflet-map-block` element and dispatches to
	 * the appropriate init function based on the presence of `data-bflm-image-zoom`.
	 *
	 * @return {void}
	 */
	function initAll() {
		const wrappers = document.querySelectorAll( '.bflm-leaflet-map-block' );
		for ( let i = 0; i < wrappers.length; i++ ) {
			const wrapper = wrappers[ i ];
			if ( wrapper.hasAttribute( 'data-bflm-image-zoom' ) ) {
				const zoomOffset =
					parseFloat(
						wrapper.getAttribute( 'data-bflm-image-zoom' )
					) || 0;
				initImageMap( wrapper, zoomOffset );
			} else {
				initStandardMap( wrapper );
			}
		}
	}

	// Run after the DOM is ready. wp-scripts wraps viewScript modules in a
	// DOMContentLoaded listener automatically, but this IIFE pattern keeps the
	// code compatible with non-module bundling fallbacks as well.
	if ( 'loading' === document.readyState ) {
		document.addEventListener( 'DOMContentLoaded', initAll );
	} else {
		initAll();
	}
} )();
