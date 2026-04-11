import { __ } from '@wordpress/i18n';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { ServerSideRender } from '@wordpress/server-side-render';
import { Disabled } from '@wordpress/components';
import {
	PanelBody,
	__experimentalNumberControl as NumberControl,
	RangeControl,
	ToggleControl,
} from '@wordpress/components';

import './editor.scss';

/**
 * @param {Object} props
 * @param {Object} props.attributes
 * @param {Function} props.setAttributes
 */
export default function Edit( { attributes, setAttributes } ) {
	const {
		lat,
		lng,
		zoom,
		height,
		scrollWheelZoom,
		zoomControl,
	} = attributes;

	const blockProps = useBlockProps();

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
