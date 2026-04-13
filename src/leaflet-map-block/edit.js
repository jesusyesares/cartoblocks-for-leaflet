/**
 * edit.js
 *
 * Editor component for the Leaflet Map Block.
 *
 * ARCHITECTURE: IFRAME PREVIEW
 * ─────────────────────────────
 * The editor renders an <iframe> whose src points to a WordPress AJAX endpoint
 * (wp_ajax_bflm_preview). That endpoint outputs a complete HTML page that
 * processes [leaflet-map] / [leaflet-marker] shortcodes through the Leaflet Map
 * plugin — identical to the frontend render. This means tiles are requested
 * from a real WordPress page context (not a blob: / about:srcdoc iframe), so
 * the browser sends a proper Referer header and OSM 403 errors are eliminated.
 *
 * When attributes change, the iframe src is rebuilt with updated query params.
 * A 500 ms debounce prevents excessive reloads on rapid sidebar input.
 *
 * The InspectorControls panels (Map Settings, Markers) are kept exactly as
 * they were in the client-side-rendering architecture.
 *
 * @package BlocksForLeafletMap
 */

import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useRef, useCallback } from '@wordpress/element';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import {
	PanelBody,
	Button,
	__experimentalNumberControl as NumberControl,
	RangeControl,
	ToggleControl,
	TextControl,
	TextareaControl,
} from '@wordpress/components';

import './editor.scss';

/**
 * Build the preview iframe src URL from block attributes.
 *
 * @param {Object} attributes Block attributes.
 * @return {string} Full URL with query parameters.
 */
function buildPreviewUrl( attributes ) {
	const { lat, lng, zoom, height, scrollWheelZoom, zoomControl, markers } =
		attributes;

	const { previewUrl, previewNonce } = window.bflmEditor || {};
	if ( ! previewUrl || ! previewNonce ) {
		return '';
	}

	const params = new URLSearchParams( {
		action:          'bflm_preview',
		bflm_nonce:      previewNonce,
		lat:             lat,
		lng:             lng,
		zoom:            zoom,
		height:          height,
		scrollWheelZoom: scrollWheelZoom ? 'true' : 'false',
		zoomControl:     zoomControl     ? 'true' : 'false',
		markers:         JSON.stringify( markers ),
	} );

	return previewUrl + '?' + params.toString();
}

/**
 * Edit component for the Leaflet Map Block.
 *
 * @param {Object}   props               Component props.
 * @param {Object}   props.attributes    Block attributes.
 * @param {Function} props.setAttributes Attribute setter.
 * @return {Element} Element to render.
 */
export default function Edit( { attributes, setAttributes } ) {
	const {
		lat,
		lng,
		zoom,
		height,
		scrollWheelZoom,
		zoomControl,
		markers,
	} = attributes;

	/** Reference to the <iframe> DOM element. */
	const iframeRef = useRef( null );

	/** setTimeout handle for the 500 ms src-update debounce. */
	const debounceRef = useRef( null );

	const blockProps = useBlockProps( {
		className: 'bflm-leaflet-map-block',
	} );

	// Update iframe src whenever any map attribute changes, debounced 500 ms.
	useEffect( () => {
		clearTimeout( debounceRef.current );
		debounceRef.current = setTimeout( () => {
			const iframe = iframeRef.current;
			if ( ! iframe ) {
				return;
			}
			const url = buildPreviewUrl( attributes );
			if ( url && iframe.src !== url ) {
				iframe.src = url;
			}
		}, 500 );

		return () => clearTimeout( debounceRef.current );
	}, [ lat, lng, zoom, height, scrollWheelZoom, zoomControl, markers ] ); // eslint-disable-line react-hooks/exhaustive-deps

	// ── Marker attribute helpers ──────────────────────────────────────────────

	/**
	 * Append a new marker at the current lat/lng attribute values.
	 */
	const handleAddMarker = useCallback( () => {
		setAttributes( {
			markers: [
				...markers,
				{
					lat:     parseFloat( lat.toFixed( 6 ) ),
					lng:     parseFloat( lng.toFixed( 6 ) ),
					title:   '',
					content: '',
				},
			],
		} );
	}, [ markers, lat, lng, setAttributes ] );

	/**
	 * Merge an update object into a single marker by index.
	 *
	 * @param {number} index   Marker index.
	 * @param {Object} updates Key/value pairs to merge.
	 */
	function handleUpdateMarker( index, updates ) {
		setAttributes( {
			markers: markers.map( ( m, i ) =>
				i === index ? { ...m, ...updates } : m
			),
		} );
	}

	/**
	 * Remove a marker by index.
	 *
	 * @param {number} index Marker index.
	 */
	function handleRemoveMarker( index ) {
		setAttributes( {
			markers: markers.filter( ( _, i ) => i !== index ),
		} );
	}

	// ── Render ────────────────────────────────────────────────────────────────

	return (
		<>
			<InspectorControls>

				{ /* ── Map Settings panel ─────────────────────────────────── */ }
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
						onChange={ ( value ) => setAttributes( { zoom: value } ) }
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

				{ /* ── Markers panel ────────────────────────────────────────── */ }
				<PanelBody
					title={ sprintf(
						/* translators: %d: number of markers on the map. */
						__( 'Markers (%d)', 'blocks-for-leaflet-map' ),
						markers.length
					) }
					initialOpen={ false }
				>
					<Button
						variant="secondary"
						onClick={ handleAddMarker }
						style={ { width: '100%', marginBottom: '12px', justifyContent: 'center' } }
					>
						{ __( '+ Add Marker at Center', 'blocks-for-leaflet-map' ) }
					</Button>

					{ markers.map( ( marker, index ) => (
						<PanelBody
							key={ index }
							title={ sprintf(
								/* translators: %d: 1-based marker number. */
								__( 'Marker %d', 'blocks-for-leaflet-map' ),
								index + 1
							) }
							initialOpen={ false }
						>
							<NumberControl
								label={ __( 'Latitude', 'blocks-for-leaflet-map' ) }
								value={ marker.lat }
								onChange={ ( value ) =>
									handleUpdateMarker( index, {
										lat: parseFloat( value ) || 0,
									} )
								}
								step={ 0.0001 }
								__next40pxDefaultSize
							/>
							<NumberControl
								label={ __( 'Longitude', 'blocks-for-leaflet-map' ) }
								value={ marker.lng }
								onChange={ ( value ) =>
									handleUpdateMarker( index, {
										lng: parseFloat( value ) || 0,
									} )
								}
								step={ 0.0001 }
								__next40pxDefaultSize
							/>
							<TextControl
								label={ __( 'Title', 'blocks-for-leaflet-map' ) }
								value={ marker.title || '' }
								onChange={ ( value ) =>
									handleUpdateMarker( index, { title: value } )
								}
								__next40pxDefaultSize
							/>
							<TextareaControl
								label={ __(
									'Popup Content',
									'blocks-for-leaflet-map'
								) }
								help={ __(
									'HTML is supported.',
									'blocks-for-leaflet-map'
								) }
								value={ marker.content || '' }
								onChange={ ( value ) =>
									handleUpdateMarker( index, { content: value } )
								}
								rows={ 3 }
							/>
							<Button
								variant="link"
								isDestructive
								onClick={ () => handleRemoveMarker( index ) }
								style={ { marginTop: '4px' } }
							>
								{ __( 'Remove Marker', 'blocks-for-leaflet-map' ) }
							</Button>
						</PanelBody>
					) ) }
				</PanelBody>

			</InspectorControls>

			<div { ...blockProps }>
				<iframe
					ref={ iframeRef }
					src={ buildPreviewUrl( attributes ) }
					width="100%"
					height={ height }
					style={ { border: 'none', display: 'block' } }
					sandbox="allow-scripts allow-same-origin"
					title={ __( 'Map preview', 'blocks-for-leaflet-map' ) }
				/>
			</div>
		</>
	);
}
