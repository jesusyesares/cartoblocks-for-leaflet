/**
 * edit.js
 *
 * Editor component for the Leaflet Map Block.
 *
 * ARCHITECTURE: IFRAME PREVIEW + postMessage BIDIRECTIONAL SYNC
 * ──────────────────────────────────────────────────────────────
 * The editor renders an <iframe> whose src points to wp_ajax_bflm_preview,
 * a WordPress AJAX endpoint that outputs a full HTML page with the map
 * rendered via Leaflet Map shortcodes — identical to the frontend.
 *
 * FRAME HIERARCHY (WP 6.3+ iframed editor)
 * ─────────────────────────────────────────
 *   outer admin frame  ← edit.js runs here (this file)
 *     └─ WP canvas iframe  (srcdoc, same-origin)
 *          └─ our preview iframe  (admin-ajax.php, same-origin)
 *
 * COMMUNICATION CHANNELS
 * ──────────────────────
 *   Outer → Preview  (iframeRef.current.contentWindow.postMessage)
 *     type: 'bflm_set_view'  — sidebar lat/lng/zoom change → map.setView()
 *
 *   Preview → Outer  (window.top.postMessage, received on window here)
 *     type: 'bflm_map_update'    — user pan/zoom → update lat/lng/zoom attrs
 *     type: 'bflm_marker_update' — marker drag  → update marker lat/lng attr
 *
 * SRC REBUILD vs. postMessage
 * ───────────────────────────
 *   Structural changes (height, scrollWheelZoom, zoomControl, markers):
 *     Rebuild iframe.src → full reload (500 ms debounce).
 *
 *   View changes (lat, lng, zoom) from the sidebar:
 *     Send bflm_set_view postMessage → no tile reload (100 ms debounce).
 *
 * ECHO LOOP PREVENTION
 * ─────────────────────
 *   isIframeUpdateRef is set true before setAttributes() calls that originate
 *   from incoming iframe messages. The lat/lng/zoom view-change effect reads
 *   this flag, skips the echo postMessage, then clears the flag.
 *
 * @package BlocksForLeafletMap
 */

import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useRef } from '@wordpress/element';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import {
	PanelBody,
	Button,
	__experimentalNumberControl as NumberControl,
	__experimentalUnitControl as UnitControl,
	RangeControl,
	ToggleControl,
	TextControl,
	TextareaControl,
} from '@wordpress/components';

import './editor.scss';

/**
 * Allowed CSS units for map dimension controls.
 */
const DIMENSION_UNITS = [
	{ value: 'px', label: 'px', default: 400 },
	{ value: '%',  label: '%',  default: 100 },
	{ value: 'vh', label: 'vh', default: 50 },
];

/**
 * Build the full preview iframe src URL from block attributes.
 * All attributes are included so the map initialises at the correct position
 * on every full reload (mount or structural change).
 *
 * @param {Object} attributes Block attributes.
 * @param {string} clientId   Block client ID — passed to the iframe as blockId
 *                            so the preview script can scope postMessages.
 * @return {string} URL string, or empty string if bflmEditor is unavailable.
 */
function buildPreviewUrl( attributes, clientId ) {
	const { lat, lng, zoom, height, width, scrollWheelZoom, zoomControl, fitMarkers, markers } =
		attributes;

	const { previewUrl, previewNonce } = window.bflmEditor || {};
	if ( ! previewUrl || ! previewNonce ) {
		return '';
	}

	// Normalize dimensions for backwards compatibility with pre-0.4.0 blocks
	// that stored height as a bare number.
	const h = typeof height === 'number' || ( typeof height === 'string' && /^\d+$/.test( height ) )
		? `${ height }px`
		: height || '400px';
	const w = width || '100%';

	const params = new URLSearchParams( {
		action:          'bflm_preview',
		bflm_nonce:      previewNonce,
		blockId:         clientId,
		lat,
		lng,
		zoom,
		height:          h,
		width:           w,
		scrollWheelZoom: scrollWheelZoom ? 'true' : 'false',
		zoomControl:     zoomControl     ? 'true' : 'false',
		fitMarkers:      fitMarkers      ? 'true' : 'false',
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
export default function Edit( { attributes, setAttributes, isSelected, clientId } ) {
	const {
		lat,
		lng,
		zoom,
		height,
		width,
		scrollWheelZoom,
		zoomControl,
		fitMarkers,
		markers,
	} = attributes;

	// Backwards compatibility: if height is a bare number (from pre-0.4.0 blocks),
	// convert it to a string with 'px' unit.
	const normalizedHeight = typeof height === 'number' || ( typeof height === 'string' && /^\d+$/.test( height ) )
		? `${ height }px`
		: height || '400px';

	const normalizedWidth = width || '100%';

	/** Reference to the <iframe> DOM element. */
	const iframeRef = useRef( null );

	/**
	 * Always-current snapshot of all block attributes. Debounced callbacks in
	 * structural and view effects capture this ref to avoid stale closures.
	 *
	 * @type {React.MutableRefObject<Object>}
	 */
	const attributesRef = useRef( attributes );

	/**
	 * Always-current copy of clientId. Used in the message handler to filter
	 * out postMessages that belong to other block instances on the same page.
	 *
	 * @type {React.MutableRefObject<string>}
	 */
	const clientIdRef = useRef( clientId );

	/**
	 * Set true before setAttributes() calls triggered by incoming iframe
	 * postMessages so the view-change effect does not echo back to the iframe.
	 *
	 * @type {React.MutableRefObject<boolean>}
	 */
	const isIframeUpdateRef = useRef( false );

	/** setTimeout handle for the 500 ms structural-change src-rebuild debounce. */
	const srcDebounceRef = useRef( null );

	/** setTimeout handle for the 100 ms view postMessage debounce. */
	const viewDebounceRef = useRef( null );

	const blockProps = useBlockProps( {
		className: 'bflm-leaflet-map-block',
	} );

	// Keep attributesRef and clientIdRef current after every render.
	useEffect( () => {
		attributesRef.current = attributes;
		clientIdRef.current   = clientId;
	} );

	// ── Mount: set initial iframe src immediately ─────────────────────────────
	useEffect( () => {
		const iframe = iframeRef.current;
		if ( ! iframe ) {
			return;
		}
		const url = buildPreviewUrl( attributesRef.current, clientIdRef.current );
		if ( url ) {
			iframe.src = url;
		}
	}, [] ); // eslint-disable-line react-hooks/exhaustive-deps

	// ── Structural changes → rebuild iframe src (500 ms debounce) ─────────────
	//
	// Fired by height, scrollWheelZoom, zoomControl, or markers changes.
	// Uses attributesRef so the rebuilt URL reflects the current lat/lng/zoom
	// (which may have drifted via postMessage since the last full load).
	useEffect( () => {
		clearTimeout( srcDebounceRef.current );
		srcDebounceRef.current = setTimeout( () => {
			const iframe = iframeRef.current;
			if ( ! iframe ) {
				return;
			}
			const url = buildPreviewUrl( attributesRef.current, clientIdRef.current );
			// Guard against a spurious reload on first mount (mount effect
			// already set the same URL synchronously).
			if ( url && iframe.src !== url ) {
				iframe.src = url;
			}
		}, 500 );

		return () => clearTimeout( srcDebounceRef.current );
	}, [ height, width, scrollWheelZoom, zoomControl, fitMarkers, markers ] ); // eslint-disable-line react-hooks/exhaustive-deps

	// ── View changes (sidebar) → postMessage to iframe (100 ms debounce) ──────
	//
	// When lat/lng/zoom change from the sidebar send bflm_set_view so the
	// iframe calls map.setView() without reloading. Skip when the change
	// originated from the iframe itself (isIframeUpdateRef echo prevention).
	useEffect( () => {
		if ( isIframeUpdateRef.current ) {
			isIframeUpdateRef.current = false;
			return;
		}

		clearTimeout( viewDebounceRef.current );
		viewDebounceRef.current = setTimeout( () => {
			const iframe = iframeRef.current;
			if ( ! iframe?.contentWindow ) {
				return;
			}
			const { lat: currentLat, lng: currentLng, zoom: currentZoom } =
				attributesRef.current;
			iframe.contentWindow.postMessage(
				{ type: 'bflm_set_view', blockId: clientIdRef.current, lat: currentLat, lng: currentLng, zoom: currentZoom },
				'*'
			);
		}, 100 );

		return () => clearTimeout( viewDebounceRef.current );
	}, [ lat, lng, zoom ] ); // eslint-disable-line react-hooks/exhaustive-deps

	// ── Incoming postMessages from the preview iframe ─────────────────────────
	useEffect( () => {
		/**
		 * Handle postMessages sent by the preview iframe via window.top.
		 *
		 * @param {MessageEvent} event Browser message event.
		 */
		function handleMessage( event ) {
			const msg = event.data;
			if ( ! msg || typeof msg.type !== 'string' ) {
				return;
			}

			// Ignore messages that belong to a different block instance.
			if ( msg.blockId !== clientIdRef.current ) {
				return;
			}

			if ( msg.type === 'bflm_map_update' ) {
				// Flag the update so the lat/lng/zoom effect skips the echo.
				isIframeUpdateRef.current = true;
				setAttributes( {
					lat:  parseFloat( msg.lat.toFixed( 6 ) ),
					lng:  parseFloat( msg.lng.toFixed( 6 ) ),
					zoom: msg.zoom,
				} );
				return;
			}

			if ( msg.type === 'bflm_marker_update' ) {
				const currentMarkers = attributesRef.current.markers;
				setAttributes( {
					markers: currentMarkers.map( ( m, i ) =>
						i === msg.index
							? {
								...m,
								lat: parseFloat( msg.lat.toFixed( 6 ) ),
								lng: parseFloat( msg.lng.toFixed( 6 ) ),
							}
							: m
					),
				} );
			}
		}

		window.addEventListener( 'message', handleMessage );
		return () => window.removeEventListener( 'message', handleMessage );
	}, [ setAttributes ] );

	// ── Marker attribute helpers ──────────────────────────────────────────────

	/**
	 * Append a new marker at the current lat/lng attribute values.
	 */
	function handleAddMarker() {
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
	}

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

				{ /* ── Location panel ────────────────────────────────────── */ }
				<PanelBody
					title={ __( 'Location', 'blocks-for-leaflet-map' ) }
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
					<ToggleControl
						label={ __( 'Fit to Markers', 'blocks-for-leaflet-map' ) }
						help={ __(
							'Automatically adjust the map view to contain all markers.',
							'blocks-for-leaflet-map'
						) }
						checked={ fitMarkers }
						onChange={ ( value ) =>
							setAttributes( { fitMarkers: value } )
						}
						__nextHasNoMarginBottom
					/>
				</PanelBody>

				{ /* ── Dimensions panel ───────────────────────────────────── */ }
				<PanelBody
					title={ __( 'Dimensions', 'blocks-for-leaflet-map' ) }
					initialOpen={ false }
				>
					<UnitControl
						label={ __( 'Height', 'blocks-for-leaflet-map' ) }
						value={ normalizedHeight }
						units={ DIMENSION_UNITS }
						onChange={ ( value ) =>
							setAttributes( { height: value } )
						}
						__next40pxDefaultSize
					/>
					<UnitControl
						label={ __( 'Width', 'blocks-for-leaflet-map' ) }
						value={ normalizedWidth }
						units={ DIMENSION_UNITS }
						onChange={ ( value ) =>
							setAttributes( { width: value } )
						}
						__next40pxDefaultSize
					/>
				</PanelBody>

				{ /* ── Interaction panel ───────────────────────────────────── */ }
				<PanelBody
					title={ __( 'Interaction', 'blocks-for-leaflet-map' ) }
					initialOpen={ false }
				>
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
				</PanelBody>

				{ /* ── Map Controls panel ──────────────────────────────────── */ }
				<PanelBody
					title={ __( 'Map Controls', 'blocks-for-leaflet-map' ) }
					initialOpen={ false }
				>
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

			<div
				{ ...blockProps }
				style={ {
					...( blockProps.style || {} ),
					width: normalizedWidth,
				} }
			>
				<div style={ { position: 'relative' } }>
					<iframe
						ref={ iframeRef }
						width="100%"
						height={ normalizedHeight }
						style={ { border: 'none', display: 'block' } }
						sandbox="allow-scripts allow-same-origin"
						title={ __( 'Map preview', 'blocks-for-leaflet-map' ) }
					/>
					{ ! isSelected && (
						<div
							style={ {
								position: 'absolute',
								top:      0,
								left:     0,
								width:    '100%',
								height:   '100%',
								zIndex:   1,
								cursor:   'pointer',
							} }
						/>
					) }
				</div>
			</div>
		</>
	);
}
