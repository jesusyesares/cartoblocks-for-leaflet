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
 * The observer calls wp.hooks.doAction('blocks-for-leaflet-map.reinitMaps')
 * which delegates to view-editor.js's bflmScheduleReinit/bflmReinitLeafletMaps.
 * Those functions use root.ownerDocument.defaultView (the iframe's window) for
 * all Leaflet globals, so they work regardless of which frame calls them.
 *
 * @package BlocksForLeafletMap
 */

import { __ } from '@wordpress/i18n';
import { useEffect, useRef } from '@wordpress/element';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { ServerSideRender } from '@wordpress/server-side-render';
import {
	Disabled,
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
	 * fires, finds the .WPLeafletMap node, then delegates to view-editor.js's
	 * reinit logic via wp.hooks so there is a single reinit code path.
	 */
	useEffect( () => {
		const container = previewRef.current;

		if ( ! container || typeof MutationObserver === 'undefined' ) {
			return;
		}

		/**
		 * Trigger the map reinit for a given root element.
		 *
		 * Calls window.bflmReinitLeafletMaps directly (exposed by view-editor.js)
		 * as the primary path. This avoids any cross-frame hook timing issues.
		 * Also fires the wp.hooks action for any other listeners.
		 *
		 * @param {Element} root
		 */
		function triggerReinit( root ) {
			// Primary: direct call — view-editor.js exposes this on window.
			if ( typeof window.bflmReinitLeafletMaps === 'function' ) {
				window.bflmReinitLeafletMaps( root );
			} else if ( window.wp?.hooks ) {
				// Fallback: hooks action (requires view-editor.js to have registered).
				window.wp.hooks.doAction(
					'blocks-for-leaflet-map.reinitMaps',
					root
				);
			}
		}

		// Initial scan: if a .WPLeafletMap already exists when the component
		// mounts (e.g. block is in the post on page load), reinit immediately.
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
				<Disabled>
					<ServerSideRender
						block="blocks-for-leaflet-map/leaflet-map-block"
						attributes={ attributes }
					/>
				</Disabled>
			</div>
		</>
	);
}
