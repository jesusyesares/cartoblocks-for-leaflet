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
 * LOOP PREVENTION
 * ───────────────
 * Without a guard, dragging the map causes a feedback loop:
 *   drag → bflm-map-updated → setAttributes → SSR re-render → reinit → repeat.
 *
 * `isInternalUpdateRef` acts as a lock: it is set to true when a map-drag
 * triggers setAttributes, and automatically cleared after 1500 ms (long enough
 * for the SSR request + DOM mutation to complete). While the lock is held the
 * MutationObserver skips reinit, breaking the loop.
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
	 * ref to the block's outermost DOM node (inside the iframe via React portal).
	 */
	const previewRef = useRef( null );

	/**
	 * Lock flag: true while a map-drag-originated setAttributes call is in flight.
	 * Prevents the resulting SSR re-render from triggering an unnecessary reinit.
	 *
	 * @type {React.MutableRefObject<boolean>}
	 */
	const isInternalUpdateRef = useRef( false );

	/**
	 * Handle for the setTimeout that clears isInternalUpdateRef.
	 *
	 * @type {React.MutableRefObject<ReturnType<typeof setTimeout>|null>}
	 */
	const clearFlagTimerRef = useRef( null );

	const blockProps = useBlockProps( {
		ref:       previewRef,
		className: 'bflm-leaflet-map-block',
	} );

	/**
	 * MutationObserver scoped to this block's container (iframe DOM).
	 * Runs once on mount; cleaned up on unmount.
	 *
	 * Skips reinit while isInternalUpdateRef is true so that SSR re-renders
	 * caused by map drags do not trigger redundant re-initialization.
	 */
	useEffect( () => {
		const container = previewRef.current;

		if ( ! container || typeof MutationObserver === 'undefined' ) {
			return;
		}

		/**
		 * Schedule a map reinit via the debounced scheduler in view-editor.js.
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

		// Initial scan: reinit immediately if a map is already in the DOM.
		const existing = container.querySelector( '.WPLeafletMap' );
		if ( existing ) {
			triggerReinit( existing.parentElement || container );
		}

		const observer = new MutationObserver( ( mutations ) => {
			// Skip mutations triggered by internal map-drag attribute updates.
			// The lock is set in the bflm-map-updated handler below.
			if ( isInternalUpdateRef.current ) {
				return;
			}

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
	}, [] );

	/**
	 * Bi-directional sync: receive bflm-map-updated events from view-editor.js.
	 *
	 * The event is dispatched from .WPLeafletMap (inside the iframe) with
	 * bubbles:true. It propagates up to previewRef.current (also in the iframe),
	 * where this listener catches it and syncs the sidebar attributes.
	 *
	 * Sets isInternalUpdateRef before calling setAttributes so the resulting
	 * SSR re-render is ignored by the MutationObserver above.
	 */
	useEffect( () => {
		const container = previewRef.current;
		if ( ! container ) {
			return;
		}

		/**
		 * @param {CustomEvent} event
		 */
		function handleMapUpdated( event ) {
			const { lat: newLat, lng: newLng, zoom: newZoom } = event.detail;

			// Engage the lock so the upcoming SSR re-render does not trigger reinit.
			isInternalUpdateRef.current = true;
			clearTimeout( clearFlagTimerRef.current );
			clearFlagTimerRef.current = setTimeout( () => {
				isInternalUpdateRef.current = false;
			}, 1500 );

			setAttributes( {
				lat:  parseFloat( newLat.toFixed( 6 ) ),
				lng:  parseFloat( newLng.toFixed( 6 ) ),
				zoom: newZoom,
			} );
		}

		container.addEventListener( 'bflm-map-updated', handleMapUpdated );
		return () => {
			container.removeEventListener( 'bflm-map-updated', handleMapUpdated );
			clearTimeout( clearFlagTimerRef.current );
		};
	}, [] );

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
