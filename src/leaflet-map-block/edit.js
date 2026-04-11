/**
 * edit.js
 *
 * Editor component for the Leaflet Map Block.
 * Renders InspectorControls for map settings and a live server-side preview.
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

	const previewRef = useRef( null );
	const blockProps = useBlockProps( { ref: previewRef } );

	/**
	 * Attach a MutationObserver scoped to this block's container.
	 * When ServerSideRender inserts new content, the observer triggers
	 * bflmReinitLeafletMaps (defined in view-editor.js and exposed via
	 * wp.hooks) so Leaflet initialises the map inside the editor iframe.
	 */
	useEffect( () => {
		const container = previewRef.current;
		if ( ! container || typeof MutationObserver === 'undefined' ) {
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

					// Delegate to the reinit function exposed by view-editor.js.
					if ( window.wp?.hooks ) {
						window.wp.hooks.doAction(
							'blocks-for-leaflet-map.reinitMaps',
							mapNodes[ 0 ].parentElement || node
						);
					}
				}
			}
		} );

		observer.observe( container, { childList: true, subtree: true } );

		// Disconnect when the block unmounts to avoid memory leaks.
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
