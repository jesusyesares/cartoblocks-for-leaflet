/**
 * edit.js
 *
 * Editor component for the Leaflet Map Block.
 *
 * FRAME ARCHITECTURE NOTE
 * ───────────────────────
 * In WordPress 6.3+ the block canvas renders inside an iframe. React portals
 * the block's DOM into that iframe, so `previewRef.current` points to a node
 * in the IFRAME's document even though the JS closure runs in the outer frame.
 *
 * This is the ONLY place in the plugin that can reliably observe the iframe DOM:
 * - view-editor.js runs in the outer frame → its document.body observer would
 *   never see mutations inside the iframe.
 * - useRef here gives us a live reference to a portal node inside the iframe.
 *
 * The observer calls window.bflmScheduleReinit(root), the debounced entry point
 * exposed by view-editor.js. Routing all calls through the scheduler ensures the
 * debounce always applies and prevents double execution on each SSR cycle.
 *
 * BI-DIRECTIONAL SYNC
 * ───────────────────
 * After Leaflet re-initialises, view-editor.js attaches moveend/zoomend listeners
 * that dispatch a `bflm-map-updated` CustomEvent from the .WPLeafletMap node.
 * The event bubbles up through the iframe DOM to previewRef.current, where a
 * second useEffect catches it and calls setAttributes to sync the sidebar.
 *
 * @package BlocksForLeafletMap
 */

import { __ } from '@wordpress/i18n';
import { useEffect, useRef } from '@wordpress/element';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { ServerSideRender } from '@wordpress/server-side-render';
import {
	PanelBody,
	__experimentalNumberControl as NumberControl,
	RangeControl,
	ToggleControl,
} from '@wordpress/components';

import './editor.scss';

/**
 * Edit component for the Leaflet Map Block.
 *
 * @param {Object}   props               Component props.
 * @param {Object}   props.attributes    Block attributes.
 * @param {Function} props.setAttributes Attribute setter.
 * @return {Element} Element to render.
 */
export default function Edit( { attributes, setAttributes } ) {
	const { lat, lng, zoom, height, scrollWheelZoom, zoomControl } = attributes;

	/**
	 * ref to the block's outermost DOM node.
	 * Because React portals this into the iframe, previewRef.current is an
	 * IFRAME DOM element — this is what makes same-origin cross-frame
	 * observation work correctly.
	 */
	const previewRef = useRef( null );
	const blockProps = useBlockProps( { ref: previewRef } );

	/**
	 * Set up a MutationObserver scoped to this block's container (iframe DOM).
	 * Runs once on mount; cleaned up on unmount to avoid memory leaks.
	 *
	 * When ServerSideRender finishes loading and inserts new HTML, the observer
	 * fires, finds the .WPLeafletMap node, then calls window.bflmScheduleReinit
	 * so all callers route through the debounce in view-editor.js.
	 */
	useEffect( () => {
		const container = previewRef.current;

		if ( ! container || typeof MutationObserver === 'undefined' ) {
			return;
		}

		/**
		 * Schedule a map reinit for a given root element via the debounced
		 * scheduler exposed by view-editor.js. Falls back to the wp.hooks
		 * action if the window function is not yet available.
		 *
		 * @param {Element} root
		 */
		function triggerReinit( root ) {
			if ( typeof window.bflmScheduleReinit === 'function' ) {
				window.bflmScheduleReinit( root );
			} else if ( window.wp?.hooks ) {
				window.wp.hooks.doAction(
					'blocks-for-leaflet-map.reinitMaps',
					root
				);
			}
		}

		// Initial scan: if a .WPLeafletMap already exists when the component
		// mounts (e.g. block already in the post on page load), reinit immediately.
		const existing = container.querySelector( '.WPLeafletMap' );
		if ( existing ) {
			triggerReinit( existing.parentElement || container );
		}

		// Ongoing observation: fires whenever SSR replaces the block preview.
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

					triggerReinit( mapNodes[ 0 ].parentElement || node );
				}
			}
		} );

		observer.observe( container, { childList: true, subtree: true } );

		return () => observer.disconnect();
	}, [] ); // Empty deps: set up once on mount, torn down on unmount.

	/**
	 * Bi-directional sync: listen for bflm-map-updated events dispatched by
	 * view-editor.js when the user moves or zooms the Leaflet map.
	 *
	 * The event is dispatched from .WPLeafletMap (inside the iframe) with
	 * bubbles:true and propagates up to previewRef.current (also inside the
	 * iframe), so this listener fires correctly via same-origin cross-frame access.
	 */
	useEffect( () => {
		const container = previewRef.current;
		if ( ! container ) {
			return;
		}

		/**
		 * Sync Leaflet map position and zoom back to block attributes.
		 *
		 * @param {CustomEvent} event
		 */
		function handleMapUpdated( event ) {
			const { lat: newLat, lng: newLng, zoom: newZoom } = event.detail;
			setAttributes( {
				lat:  parseFloat( newLat.toFixed( 6 ) ),
				lng:  parseFloat( newLng.toFixed( 6 ) ),
				zoom: newZoom,
			} );
		}

		container.addEventListener( 'bflm-map-updated', handleMapUpdated );
		return () => container.removeEventListener( 'bflm-map-updated', handleMapUpdated );
	}, [] ); // Empty deps: ref and setAttributes are both stable across renders.

	return (
		<>
			<InspectorControls>
				<PanelBody
					title={ __( 'Map Settings', 'blocks-for-leaflet-map' ) }
					initialOpen={ true }
				>
					<NumberControl
						label={ __( 'Latitude', 'blocks-for-leaflet-map' ) }
						value={ lat }
						onChange={ ( value ) =>
							setAttributes( { lat: parseFloat( value ) || 0 } )
						}
						step={ 0.0001 }
						__next40pxDefaultSize
					/>
					<NumberControl
						label={ __( 'Longitude', 'blocks-for-leaflet-map' ) }
						value={ lng }
						onChange={ ( value ) =>
							setAttributes( { lng: parseFloat( value ) || 0 } )
						}
						step={ 0.0001 }
						__next40pxDefaultSize
					/>
					<RangeControl
						label={ __( 'Zoom Level', 'blocks-for-leaflet-map' ) }
						value={ zoom }
						onChange={ ( value ) =>
							setAttributes( { zoom: value } )
						}
						min={ 1 }
						max={ 20 }
						__nextHasNoMarginBottom
					/>
					<NumberControl
						label={ __( 'Height (px)', 'blocks-for-leaflet-map' ) }
						value={ height }
						onChange={ ( value ) =>
							setAttributes( {
								height: parseInt( value, 10 ) || 400,
							} )
						}
						min={ 100 }
						step={ 10 }
						__next40pxDefaultSize
					/>
					<ToggleControl
						label={ __(
							'Scroll Wheel Zoom',
							'blocks-for-leaflet-map'
						) }
						checked={ scrollWheelZoom }
						onChange={ ( value ) =>
							setAttributes( { scrollWheelZoom: value } )
						}
						__nextHasNoMarginBottom
					/>
					<ToggleControl
						label={ __( 'Zoom Control', 'blocks-for-leaflet-map' ) }
						checked={ zoomControl }
						onChange={ ( value ) =>
							setAttributes( { zoomControl: value } )
						}
						__nextHasNoMarginBottom
					/>
				</PanelBody>
			</InspectorControls>

			<div { ...blockProps }>
				<ServerSideRender
					block="blocks-for-leaflet-map/leaflet-map-block"
					attributes={ attributes }
				/>
			</div>
		</>
	);
}
