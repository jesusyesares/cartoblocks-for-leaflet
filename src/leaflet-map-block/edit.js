/**
 * edit.js
 *
 * Editor component for the Leaflet Map Block.
 *
 * ARCHITECTURE: CLIENT-SIDE RENDERING
 * ────────────────────────────────────
 * Instead of ServerSideRender (which required script-cloning and MutationObserver
 * hacks to work inside the WP 6.3+ iframed editor), we initialize Leaflet directly
 * from React using the parent plugin's Leaflet global.
 *
 * FRAME CONTEXT
 * ─────────────
 * - This file (editorScript) runs in the OUTER admin frame.
 * - The block's DOM is portaled into the IFRAME by React.
 * - `mapContainerRef.current` is therefore a node in the IFRAME document.
 * - We reach the iframe's Leaflet via `container.ownerDocument.defaultView.L`.
 * - Tile configuration (bflmConfig) is injected into the iframe window by PHP
 *   via wp_add_inline_script on the `leaflet_js` handle.
 *
 * FEEDBACK LOOP PREVENTION
 * ─────────────────────────
 * Dragging the map fires moveend → setAttributes → Effect 2 wants to call
 * setView again. We guard with:
 *   1. `isMapDragRef` flag: skips Effect 2 for one cycle after a drag.
 *   2. Coordinate equality check: Effect 2 bails if position already matches.
 *
 * @package BlocksForLeafletMap
 */

import { __ } from '@wordpress/i18n';
import { useEffect, useRef } from '@wordpress/element';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import {
	PanelBody,
	__experimentalNumberControl as NumberControl,
	RangeControl,
	ToggleControl,
} from '@wordpress/components';

import './editor.scss';

/** Fallback tile URL if bflmConfig is not available in the iframe. */
const FALLBACK_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const FALLBACK_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

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

	/** Ref to the raw <div> that Leaflet will own as its map container. */
	const mapContainerRef = useRef( null );

	/** Ref to the live Leaflet map instance. */
	const mapInstanceRef = useRef( null );

	/**
	 * Flag set to true immediately after a map-drag triggers setAttributes.
	 * Effect 2 reads this flag and skips the redundant setView call, then
	 * resets the flag to false.
	 *
	 * @type {React.MutableRefObject<boolean>}
	 */
	const isMapDragRef = useRef( false );

	const blockProps = useBlockProps( {
		className: 'bflm-leaflet-map-block',
	} );

	// ── Effect 1: Mount — initialise the Leaflet map ─────────────────────────
	//
	// Runs once when the block mounts. Polls for the Leaflet global (L) in the
	// iframe window, then creates the map, tile layer, and event listeners.
	// Cleanup destroys the map instance on unmount.
	useEffect( () => {
		const container = mapContainerRef.current;
		if ( ! container ) {
			return;
		}

		// The container lives in the iframe; access globals from its window.
		const iframeWin = container.ownerDocument?.defaultView;
		if ( ! iframeWin ) {
			return;
		}

		let attempts = 0;
		const MAX_ATTEMPTS = 20;

		/**
		 * Poll for L and initialise once available.
		 */
		function tryInit() {
			// Guard: unmounted or already initialised.
			if ( ! mapContainerRef.current || mapInstanceRef.current ) {
				return;
			}

			const L = iframeWin.L;

			if ( ! L ) {
				if ( ++attempts < MAX_ATTEMPTS ) {
					setTimeout( tryInit, 300 );
				} else {
					// eslint-disable-next-line no-console
					console.warn( 'BFLM: Leaflet (L) not found in iframe after ' + MAX_ATTEMPTS + ' attempts.' );
				}
				return;
			}

			// Read tile settings injected by PHP into the iframe window.
			const config      = iframeWin.bflmConfig || {};
			const tileUrl     = config.tileUrl    || FALLBACK_TILE_URL;
			const subdomains  = config.tileSubdomains || '';
			const attribution = config.attribution || FALLBACK_ATTRIBUTION;

			// eslint-disable-next-line no-console
			console.log( 'BFLM: Initialising Leaflet map. Tile URL:', tileUrl );

			const map = L.map( container, {
				scrollWheelZoom,
				zoomControl,
				attributionControl: true,
			} ).setView( [ lat, lng ], zoom );

			L.tileLayer( tileUrl, {
				attribution,
				subdomains,
				maxZoom: 19,
			} ).addTo( map );

			// Bi-directional sync: propagate map position back to block attributes.
			map.on( 'moveend zoomend', () => {
				const center = map.getCenter();
				isMapDragRef.current = true;
				setAttributes( {
					lat:  parseFloat( center.lat.toFixed( 6 ) ),
					lng:  parseFloat( center.lng.toFixed( 6 ) ),
					zoom: map.getZoom(),
				} );
			} );

			mapInstanceRef.current = map;
			// eslint-disable-next-line no-console
			console.log( 'BFLM: Map initialised.' );
		}

		tryInit();

		return () => {
			if ( mapInstanceRef.current ) {
				mapInstanceRef.current.remove();
				mapInstanceRef.current = null;
			}
		};
	}, [] ); // eslint-disable-line react-hooks/exhaustive-deps
	// ^ Intentionally empty: we only want to init/destroy with mount/unmount.
	//   Attribute changes are handled by dedicated effects below.

	// ── Effect 2: Sync lat / lng / zoom from sidebar to existing map ─────────
	useEffect( () => {
		const map = mapInstanceRef.current;
		if ( ! map ) {
			return;
		}

		// Skip if this change was triggered by a map drag (not the user typing
		// in the sidebar) to avoid an immediate setView echo.
		if ( isMapDragRef.current ) {
			isMapDragRef.current = false;
			return;
		}

		const center  = map.getCenter();
		const epsilon = 0.000001;
		const same    =
			Math.abs( center.lat - lat ) < epsilon &&
			Math.abs( center.lng - lng ) < epsilon &&
			map.getZoom() === zoom;

		if ( ! same ) {
			map.setView( [ lat, lng ], zoom, { animate: false } );
		}
	}, [ lat, lng, zoom ] ); // eslint-disable-line react-hooks/exhaustive-deps

	// ── Effect 3: Respond to height changes ───────────────────────────────────
	useEffect( () => {
		if ( ! mapInstanceRef.current ) {
			return;
		}
		// Allow the CSS change to apply before asking Leaflet to recalculate.
		const id = setTimeout( () => mapInstanceRef.current?.invalidateSize(), 0 );
		return () => clearTimeout( id );
	}, [ height ] );

	// ── Effect 4: Toggle scroll-wheel zoom ────────────────────────────────────
	useEffect( () => {
		const map = mapInstanceRef.current;
		if ( ! map ) {
			return;
		}
		if ( scrollWheelZoom ) {
			map.scrollWheelZoom.enable();
		} else {
			map.scrollWheelZoom.disable();
		}
	}, [ scrollWheelZoom ] );

	// ── Effect 5: Toggle zoom control ─────────────────────────────────────────
	useEffect( () => {
		const map = mapInstanceRef.current;
		if ( ! map ) {
			return;
		}
		if ( zoomControl ) {
			// addTo is safe to call even if already added.
			map.zoomControl.addTo( map );
		} else {
			map.zoomControl.remove();
		}
	}, [ zoomControl ] );

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

			<div
				{ ...blockProps }
				onMouseDown={ ( e ) => e.stopPropagation() }
			>
				<div
					ref={ mapContainerRef }
					className="bflm-map-canvas"
					style={ { height: height + 'px' } }
				/>
			</div>
		</>
	);
}
