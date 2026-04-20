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
import { useEffect, useRef, useState } from '@wordpress/element';
import { useBlockProps, BlockControls, InspectorControls, MediaUpload, MediaUploadCheck } from '@wordpress/block-editor';
import {
	PanelBody,
	Button,
	Notice,
	Popover,
	RadioControl,
	Spinner,
	ToolbarGroup,
	ToolbarButton,
	__experimentalNumberControl as NumberControl,
	__experimentalUnitControl as UnitControl,
	RangeControl,
	SelectControl,
	ToggleControl,
	TextControl,
	TextareaControl,
} from '@wordpress/components';
import { code as codeIcon } from '@wordpress/icons';

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
 * Options for three-state interaction controls.
 * Empty string = "Default" (omit from shortcode, use Leaflet Map global settings).
 */
const THREE_STATE_OPTIONS = [
	{ value: '',      label: 'Default' },
	{ value: 'true',  label: 'Enabled' },
	{ value: 'false', label: 'Disabled' },
];

// ── Shortcode builder ─────────────────────────────────────────────────────────
//
// Keep in sync with render.php → "Build the [leaflet-map] shortcode" section.
// Any attribute change there must be mirrored here (and vice versa) or the
// editor shortcode strip will drift from the frontend output.
//
// Uses a declarative descriptor table so that adding a new attribute requires
// a single new entry — no new control flow in the builder function itself.

/**
 * Normalise a raw height attribute value to a CSS string with unit.
 * Mirrors the height-normalisation logic in render.php.
 *
 * @param {*} h Raw height value from block attributes.
 * @return {string} Validated CSS string, e.g. "400px".
 */
function normalizeHeight( h ) {
	if ( typeof h === 'number' || ( typeof h === 'string' && /^\d+$/.test( h ) ) ) {
		return `${ h }px`;
	}
	if ( h && /^\d+(\.\d+)?(px|%|vh|vw|em|rem)$/.test( h ) ) {
		return h;
	}
	return '400px';
}

/**
 * Descriptor table for [leaflet-map] shortcode attributes.
 *
 * Each entry maps one block attribute to one shortcode attribute:
 *   key   — shortcode attribute name (e.g. 'scrollwheel')
 *   attr  — block attribute name    (e.g. 'scrollWheelZoom')
 *   quote — quote character around the value (default: '"'; attribution uses "'")
 *   serialize( value ) → string | null
 *       Return the string to emit, or null to omit the attribute entirely.
 *
 * Order matches render.php for readability when comparing the two.
 */
const LEAFLET_MAP_DESCRIPTORS = [
	// ── Base attributes (always emitted) ─────────────────────────────────
	{ key: 'lat',         attr: 'lat',            serialize: ( v ) => String( v ) },
	{ key: 'lng',         attr: 'lng',            serialize: ( v ) => String( v ) },
	{ key: 'zoom',        attr: 'zoom',           serialize: ( v ) => String( parseInt( v, 10 ) ) },
	{ key: 'height',      attr: 'height',         serialize: ( v ) => normalizeHeight( v ) },
	{ key: 'scrollwheel', attr: 'scrollWheelZoom', serialize: ( v ) => ( v ? 'true' : 'false' ) },
	{ key: 'zoomcontrol', attr: 'zoomControl',    serialize: ( v ) => ( v === false ? 'false' : 'true' ) },
	{ key: 'fitbounds',   attr: 'fitMarkers',     serialize: ( v ) => ( v ? 'true' : 'false' ) },
	{ key: 'show_scale',  attr: 'showScale',      serialize: ( v ) => ( v ? '1' : '0' ) },
	// ── Interaction attributes (omit when empty = "Default") ──────────────
	{ key: 'dragging',          attr: 'dragging',          serialize: ( v ) => v || null },
	{ key: 'keyboard',          attr: 'keyboard',          serialize: ( v ) => v || null },
	{ key: 'doubleclickzoom',   attr: 'doubleClickZoom',   serialize: ( v ) => v || null },
	{ key: 'boxzoom',           attr: 'boxZoom',           serialize: ( v ) => v || null },
	{ key: 'closepopuponclick', attr: 'closePopupOnClick', serialize: ( v ) => v || null },
	{ key: 'tap',               attr: 'tap',               serialize: ( v ) => v || null },
	{ key: 'inertia',           attr: 'inertia',           serialize: ( v ) => v || null },
	// ── Zoom & bounds attributes (omit when empty or non-numeric) ─────────
	{ key: 'min_zoom',  attr: 'minZoom',   serialize: ( v ) => ( v !== '' && ! isNaN( v ) ) ? v : null },
	{ key: 'max_zoom',  attr: 'maxZoom',   serialize: ( v ) => ( v !== '' && ! isNaN( v ) ) ? v : null },
	{ key: 'maxbounds', attr: 'maxBounds', serialize: ( v ) => v || null },
	// ── Tile layer attributes (omit when empty) ───────────────────────────
	{ key: 'tileurl',       attr: 'tileurl',      serialize: ( v ) => v || null },
	{ key: 'tilesize',      attr: 'tilesize',     serialize: ( v ) => ( v !== '' && ! isNaN( v ) && parseInt( v, 10 ) >= 1 ) ? String( parseInt( v, 10 ) ) : null },
	{ key: 'subdomains',    attr: 'subdomains',   serialize: ( v ) => v || null },
	{ key: 'mapid',         attr: 'mapid',        serialize: ( v ) => v || null },
	{ key: 'accesstoken',   attr: 'accesstoken',  serialize: ( v ) => v || null },
	{ key: 'zoomoffset',    attr: 'zoomoffset',   serialize: ( v ) => ( v !== '' && ! isNaN( v ) ) ? String( parseInt( v, 10 ) ) : null },
	{ key: 'nowrap',        attr: 'nowrap',       serialize: ( v ) => ( v === 'true' || v === 'false' ) ? v : null },
	// Note: block attribute 'detectretina' maps to shortcode key 'detect_retina' (underscore).
	{ key: 'detect_retina', attr: 'detectretina', serialize: ( v ) => ( v === 'true' || v === 'false' ) ? v : null },
	// ── Attribution (single-quoted so inner href="…" double quotes are safe) ──
	{ key: 'attribution', attr: 'attribution', quote: "'", serialize: ( v ) => v || null },
];

/**
 * Build the [leaflet-map] and [leaflet-marker] shortcode string from block
 * attributes, exactly mirroring what render.php emits on the frontend.
 *
 * Keep in sync with render.php → "Build the [leaflet-map] shortcode" section.
 *
 * @param {Object} attributes Block attributes.
 * @return {string} Full shortcode string (map + zero or more markers).
 */
function buildShortcode( attributes ) {
	const parts = [];

	for ( const { key, attr, quote = '"', serialize } of LEAFLET_MAP_DESCRIPTORS ) {
		const serialized = serialize( attributes[ attr ] );
		if ( serialized !== null ) {
			parts.push( `${ key }=${ quote }${ serialized }${ quote }` );
		}
	}

	let shortcode = '[leaflet-map ' + parts.join( ' ' ) + ']';

	const markers = attributes.markers || [];
	for ( const marker of markers ) {
		if ( marker.lat == null || marker.lng == null ) {
			continue;
		}
		const mLat     = marker.lat;
		const mLng     = marker.lng;
		const mTitle   = marker.title   || '';
		const mContent = marker.content || '';
		const mAlt     = marker.alt     || '';

		// Build open tag incrementally, mirroring render.php conditional emission.
		let mTag = `[leaflet-marker lat="${ mLat }" lng="${ mLng }"`;
		if ( mTitle )                                                   mTag += ` title="${ mTitle }"`;
		if ( mAlt )                                                     mTag += ` alt="${ mAlt }"`;
		if ( marker.visible )                                           mTag += ` visible="1"`;
		if ( marker.draggable )                                         mTag += ` draggable="1"`;
		if ( marker.opacity != null && Math.abs( marker.opacity - 1 ) > 0.001 ) mTag += ` opacity="${ marker.opacity }"`;
		if ( marker.zIndexOffset != null && marker.zIndexOffset !== 0 ) mTag += ` zindexoffset="${ marker.zIndexOffset }"`;

		// Custom icon: only emit when useCustomIcon is true.
		if ( marker.useCustomIcon ) {
			if ( marker.iconUrl ) mTag += ` iconurl="${ marker.iconUrl }"`;
			if ( marker.iconWidth != null && marker.iconHeight != null && marker.iconWidth >= 1 && marker.iconHeight >= 1 ) {
				mTag += ` iconsize="${ marker.iconWidth },${ marker.iconHeight }"`;
			}
			if ( marker.iconAnchorX != null && marker.iconAnchorY != null ) {
				mTag += ` iconanchor="${ marker.iconAnchorX },${ marker.iconAnchorY }"`;
			}
			if ( marker.popupAnchorX != null && marker.popupAnchorY != null ) {
				mTag += ` popupanchor="${ marker.popupAnchorX },${ marker.popupAnchorY }"`;
			}
			// Shadow: only when useShadow is also true.
			if ( marker.useShadow ) {
				if ( marker.shadowUrl ) mTag += ` shadowurl="${ marker.shadowUrl }"`;
				if ( marker.shadowWidth != null && marker.shadowHeight != null && marker.shadowWidth >= 1 && marker.shadowHeight >= 1 ) {
					mTag += ` shadowsize="${ marker.shadowWidth },${ marker.shadowHeight }"`;
				}
				if ( marker.shadowAnchorX != null && marker.shadowAnchorY != null ) {
					mTag += ` shadowanchor="${ marker.shadowAnchorX },${ marker.shadowAnchorY }"`;
				}
			}
		}

		if ( mContent ) {
			shortcode += `\n${ mTag }]${ mContent }[/leaflet-marker]`;
		} else {
			shortcode += `\n${ mTag }]`;
		}
	}

	return shortcode;
}

/**
 * Clipboard fallback for insecure contexts (plain HTTP, custom .test domains).
 *
 * `navigator.clipboard.writeText` requires a secure context (HTTPS / localhost).
 * This fallback uses the deprecated but universally supported `document.execCommand('copy')`
 * via a temporary off-screen textarea, which works in any browsing context.
 *
 * @param {string}   text      Text to copy.
 * @param {Function} onSuccess Called if the copy succeeds.
 */
function fallbackCopy( text, onSuccess ) {
	const ta = document.createElement( 'textarea' );
	ta.value = text;
	ta.setAttribute( 'readonly', '' );
	ta.style.position = 'absolute';
	ta.style.left = '-9999px';
	document.body.appendChild( ta );
	ta.select();
	try {
		if ( document.execCommand( 'copy' ) ) {
			onSuccess();
		}
	} catch ( e ) {
		// Swallow — user can still select the shortcode text manually.
	}
	document.body.removeChild( ta );
}

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
	const {
		lat, lng, zoom, height, scrollWheelZoom, zoomControl, fitMarkers,
		attribution, showScale,
		dragging, keyboard, doubleClickZoom, boxZoom,
		closePopupOnClick, tap, inertia,
		minZoom, maxZoom, maxBounds,
		tileurl, tilesize, subdomains, mapid, accesstoken, zoomoffset, nowrap, detectretina,
		markers,
	} = attributes;

	const { previewUrl, previewNonce } = window.bflmEditor || {};
	if ( ! previewUrl || ! previewNonce ) {
		return '';
	}

	// Normalize height for backwards compatibility with pre-0.4.0 blocks
	// that stored height as a bare number.
	const h = typeof height === 'number' || ( typeof height === 'string' && /^\d+$/.test( height ) )
		? `${ height }px`
		: height || '400px';

	const params = new URLSearchParams( {
		action:          'bflm_preview',
		bflm_nonce:      previewNonce,
		blockId:         clientId,
		lat,
		lng,
		zoom,
		height:          h,
		scrollWheelZoom: scrollWheelZoom ? 'true' : 'false',
		zoomControl:     zoomControl     ? 'true' : 'false',
		fitMarkers:      fitMarkers      ? 'true' : 'false',
		attribution:     attribution,
		showScale:       showScale       ? 'true' : 'false',
		markers:         JSON.stringify( markers ),
	} );

	// Only include interaction params when explicitly set (not "Default").
	if ( dragging )          params.set( 'dragging', dragging );
	if ( keyboard )          params.set( 'keyboard', keyboard );
	if ( doubleClickZoom )   params.set( 'doubleClickZoom', doubleClickZoom );
	if ( boxZoom )           params.set( 'boxZoom', boxZoom );
	if ( closePopupOnClick ) params.set( 'closePopupOnClick', closePopupOnClick );
	if ( tap )               params.set( 'tap', tap );
	if ( inertia )           params.set( 'inertia', inertia );
	if ( minZoom )           params.set( 'minZoom', minZoom );
	if ( maxZoom )           params.set( 'maxZoom', maxZoom );
	if ( maxBounds )         params.set( 'maxBounds', maxBounds );
	if ( tileurl )           params.set( 'tileurl', tileurl );
	if ( tilesize )          params.set( 'tilesize', tilesize );
	if ( subdomains )        params.set( 'subdomains', subdomains );
	if ( mapid )             params.set( 'mapid', mapid );
	if ( accesstoken )       params.set( 'accesstoken', accesstoken );
	if ( zoomoffset )        params.set( 'zoomoffset', zoomoffset );
	if ( nowrap )            params.set( 'nowrap', nowrap );
	if ( detectretina )      params.set( 'detectretina', detectretina );

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
		attribution,
		showScale,
		dragging,
		keyboard,
		doubleClickZoom,
		boxZoom,
		closePopupOnClick,
		tap,
		inertia,
		minZoom,
		maxZoom,
		maxBounds,
		tileurl,
		tilesize,
		subdomains,
		mapid,
		accesstoken,
		zoomoffset,
		nowrap,
		detectretina,
		address,
		markers,
	} = attributes;

	// Local state for NumberControls that commit only on blur (Tile Size, Zoom Offset).
	// This prevents iframe rebuilds on every keystroke/arrow-click with intermediate values.
	const [ localTilesize, setLocalTilesize ] = useState( tilesize );
	const [ localZoomoffset, setLocalZoomoffset ] = useState( zoomoffset );

	// Sync local state when the block attribute changes externally (undo/redo, block switch).
	useEffect( () => { setLocalTilesize( tilesize ); }, [ tilesize ] );
	useEffect( () => { setLocalZoomoffset( zoomoffset ); }, [ zoomoffset ] );


	// ── Geocoding local state ─────────────────────────────────────────────────

	/**
	 * Location input mode: 'coordinates' shows lat/lng fields; 'address' shows
	 * the address search input. Defaults to 'address' when a saved address exists.
	 */
	const [ locationMode, setLocationMode ] = useState( address ? 'address' : 'coordinates' );

	/** The text currently in the address input field. Initialised from the saved attribute. */
	const [ addressInput, setAddressInput ] = useState( address );

	/**
	 * Geocode operation status:
	 *   'idle'       — no pending operation.
	 *   'loading'    — Nominatim request in flight.
	 *   'candidates' — multiple results returned, waiting for user to pick one.
	 *   'error'      — request failed or returned no results.
	 */
	const [ geocodeStatus, setGeocodeStatus ] = useState( 'idle' );

	/** Candidate list returned by the last successful geocode search. */
	const [ candidates, setCandidates ] = useState( [] );

	/** Human-readable error message shown when geocodeStatus === 'error'. */
	const [ geocodeError, setGeocodeError ] = useState( '' );

	// Sync addressInput if the address attribute changes externally (undo/redo).
	useEffect( () => { setAddressInput( address ); }, [ address ] );

	// ── Shortcode strip state ─────────────────────────────────────────────────

	/**
	 * Whether the shortcode strip is currently visible below the block preview.
	 * Local UI state only — not persisted; strip always starts hidden on load.
	 */
	const [ showShortcode, setShowShortcode ] = useState( false );

	/** True for ~2 s after the user copies the shortcode, to show "Copied!" feedback. */
	const [ isCopied, setIsCopied ] = useState( false );

	/**
	 * The shortcode string shown in the strip, recomputed on every render so
	 * it always reflects the current block attributes.
	 */
	const shortcode = buildShortcode( attributes );

	/**
	 * Copy the shortcode to the clipboard.
	 *
	 * Primary path: navigator.clipboard.writeText (requires secure context —
	 * HTTPS or localhost). Fallback: document.execCommand('copy') via a hidden
	 * textarea, which works in non-secure contexts such as plain-HTTP .test
	 * development domains.
	 *
	 * Note: useCopyToClipboard from @wordpress/compose was removed because the
	 * runtime version bundled with WordPress uses an older clipboard.js-backed
	 * API that throws during first render when its ref target is not yet in the
	 * DOM (see v0.3.9 / v0.3.10 changelogs).
	 */
	function handleCopy() {
		const fire = () => {
			setIsCopied( true );
			setTimeout( () => setIsCopied( false ), 2000 );
		};

		if ( navigator.clipboard && navigator.clipboard.writeText ) {
			navigator.clipboard.writeText( shortcode ).then(
				fire,
				() => fallbackCopy( shortcode, fire )
			);
			return;
		}

		fallbackCopy( shortcode, fire );
	}

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

	/** Ref attached to the toolbar shortcode toggle button for Popover anchoring. */
	const toggleButtonRef = useRef( null );

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
	}, [ height, scrollWheelZoom, zoomControl, fitMarkers, attribution, showScale,
		dragging, keyboard, doubleClickZoom, boxZoom,
		closePopupOnClick, tap, inertia,
		minZoom, maxZoom, maxBounds,
		tileurl, tilesize, subdomains, mapid, accesstoken, zoomoffset, nowrap, detectretina,
		markers ] ); // eslint-disable-line react-hooks/exhaustive-deps

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

	// ── Geocoding helpers ─────────────────────────────────────────────────────

	/**
	 * Apply a geocode candidate: update lat, lng, and address attributes and
	 * rebuild the iframe src so the preview jumps to the new location immediately.
	 *
	 * isIframeUpdateRef is set true to suppress the view postMessage that would
	 * otherwise fire from the lat/lng change effect — a full src rebuild is done
	 * instead, making the postMessage redundant.
	 *
	 * @param {{ display_name: string, lat: number, lng: number }} candidate
	 */
	function applyCandidate( candidate ) {
		const newLat = parseFloat( candidate.lat.toFixed( 6 ) );
		const newLng = parseFloat( candidate.lng.toFixed( 6 ) );

		// Suppress the view postMessage echo — we're doing a full iframe src rebuild.
		isIframeUpdateRef.current = true;

		setAttributes( {
			lat:     newLat,
			lng:     newLng,
			address: addressInput,
		} );

		// Rebuild iframe src immediately with the resolved coordinates.
		// setAttributes is asynchronous, so we merge manually rather than waiting.
		const iframe = iframeRef.current;
		if ( iframe ) {
			const url = buildPreviewUrl(
				{ ...attributesRef.current, lat: newLat, lng: newLng },
				clientIdRef.current
			);
			if ( url ) {
				iframe.src = url;
			}
		}

		setGeocodeStatus( 'idle' );
		setCandidates( [] );
	}

	/**
	 * Send the address in the input field to the wp_ajax_bflm_geocode endpoint.
	 * Applies the result directly when only one candidate is returned; otherwise
	 * populates the candidates list for the user to choose from.
	 */
	async function handleGeocode() {
		if ( ! addressInput.trim() ) {
			return;
		}

		setGeocodeStatus( 'loading' );
		setCandidates( [] );
		setGeocodeError( '' );

		const { previewUrl, geocodeNonce } = window.bflmEditor || {};
		if ( ! previewUrl || ! geocodeNonce ) {
			setGeocodeStatus( 'error' );
			setGeocodeError( __( 'Geocoding is not available. Please reload the editor.', 'blocks-for-leaflet-map' ) );
			return;
		}

		try {
			const response = await fetch( previewUrl, {
				method: 'POST',
				body: new URLSearchParams( {
					action:       'bflm_geocode',
					_ajax_nonce:  geocodeNonce,
					address:      addressInput,
				} ),
			} );

			const data = await response.json();

			if ( ! data.success ) {
				setGeocodeStatus( 'error' );
				setGeocodeError(
					data.data?.message ||
					__( 'An unexpected error occurred. Please try again.', 'blocks-for-leaflet-map' )
				);
				return;
			}

			const results = data.data.candidates;

			if ( results.length === 1 ) {
				applyCandidate( results[ 0 ] );
			} else {
				setCandidates( results );
				setGeocodeStatus( 'candidates' );
			}
		} catch ( e ) {
			setGeocodeStatus( 'error' );
			setGeocodeError( __( 'Geocoding request failed. Please check your connection and try again.', 'blocks-for-leaflet-map' ) );
		}
	}

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
			{ /* ── Block toolbar: shortcode toggle ─────────────────────────────── */ }
			<BlockControls>
				<ToolbarGroup>
					<ToolbarButton
						ref={ toggleButtonRef }
						icon={ codeIcon }
						label={ __( 'View shortcode', 'blocks-for-leaflet-map' ) }
						onClick={ () => setShowShortcode( ( prev ) => ! prev ) }
						isPressed={ showShortcode }
					/>
				</ToolbarGroup>
			</BlockControls>

			{ /* ── Shortcode popover ───────────────────────────────────────────── */ }
			{ showShortcode && toggleButtonRef.current && (
				<Popover
					anchor={ toggleButtonRef.current }
					onClose={ () => setShowShortcode( false ) }
					placement="bottom-start"
					className="bflm-shortcode-popover"
				>
					<div className="bflm-shortcode-popover__inner">
						<div className="bflm-shortcode-popover__header">
							<span className="bflm-shortcode-popover__label">
								{ __( 'Shortcode', 'blocks-for-leaflet-map' ) }
							</span>
							<button
								type="button"
								className="bflm-shortcode-popover__copy"
								onClick={ handleCopy }
								onMouseDown={ ( e ) => e.stopPropagation() }
							>
								{ isCopied
									? __( 'Copied!', 'blocks-for-leaflet-map' )
									: __( 'Copy', 'blocks-for-leaflet-map' )
								}
							</button>
						</div>
						<pre className="bflm-shortcode-popover__code">{ shortcode }</pre>
					</div>
				</Popover>
			) }

			<InspectorControls>

				{ /* ── Location panel ────────────────────────────────────── */ }
				<PanelBody
					title={ __( 'Location', 'blocks-for-leaflet-map' ) }
					initialOpen={ true }
				>
					<RadioControl
						label={ __( 'Input mode', 'blocks-for-leaflet-map' ) }
						selected={ locationMode }
						options={ [
							{ label: __( 'Coordinates', 'blocks-for-leaflet-map' ), value: 'coordinates' },
							{ label: __( 'Address', 'blocks-for-leaflet-map' ),     value: 'address' },
						] }
						onChange={ ( value ) => {
							setLocationMode( value );
							setGeocodeStatus( 'idle' );
							setCandidates( [] );
							setGeocodeError( '' );
						} }
					/>

					{ locationMode === 'coordinates' && (
						<>
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
						</>
					) }

					{ locationMode === 'address' && (
						<>
							<TextControl
								label={ __( 'Address', 'blocks-for-leaflet-map' ) }
								value={ addressInput }
								placeholder={ __( 'Enter an address…', 'blocks-for-leaflet-map' ) }
								onChange={ ( value ) => {
									setAddressInput( value );
									// Clear stale results when the user edits the query.
									if ( geocodeStatus !== 'idle' ) {
										setGeocodeStatus( 'idle' );
										setCandidates( [] );
										setGeocodeError( '' );
									}
								} }
								onKeyDown={ ( e ) => {
									if ( e.key === 'Enter' ) {
										e.preventDefault();
										handleGeocode();
									}
								} }
								__next40pxDefaultSize
								__nextHasNoMarginBottom
							/>
							<Button
								variant="secondary"
								onClick={ handleGeocode }
								isBusy={ geocodeStatus === 'loading' }
								disabled={ geocodeStatus === 'loading' || ! addressInput.trim() }
								style={ { width: '100%', justifyContent: 'center', marginTop: '8px' } }
							>
								{ __( 'Search', 'blocks-for-leaflet-map' ) }
							</Button>

							{ geocodeStatus === 'loading' && (
								<div style={ { display: 'flex', justifyContent: 'center', marginTop: '8px' } }>
									<Spinner />
								</div>
							) }

							{ geocodeStatus === 'error' && (
								<Notice
									status="error"
									isDismissible={ false }
									style={ { marginTop: '8px' } }
								>
									{ geocodeError }
								</Notice>
							) }

							{ geocodeStatus === 'candidates' && candidates.length > 0 && (
								<div style={ { marginTop: '8px' } }>
									<p style={ { margin: '0 0 4px', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', color: '#1e1e1e' } }>
										{ __( 'Select a location:', 'blocks-for-leaflet-map' ) }
									</p>
									{ candidates.map( ( candidate, index ) => (
										<Button
											key={ index }
											variant="tertiary"
											onClick={ () => applyCandidate( candidate ) }
											style={ {
												display:       'block',
												width:         '100%',
												textAlign:     'left',
												marginBottom:  '4px',
												whiteSpace:    'normal',
												height:        'auto',
												padding:       '6px 8px',
												wordBreak:     'break-word',
											} }
										>
											{ candidate.display_name }
										</Button>
									) ) }
								</div>
							) }
						</>
					) }

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
						min={ 0 }
						onChange={ ( value ) =>
							setAttributes( { height: value } )
						}
						__next40pxDefaultSize
					/>
					<UnitControl
						label={ __( 'Width', 'blocks-for-leaflet-map' ) }
						value={ normalizedWidth }
						units={ DIMENSION_UNITS }
						min={ 0 }
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
					<SelectControl
						label={ __( 'Dragging', 'blocks-for-leaflet-map' ) }
						value={ dragging }
						options={ THREE_STATE_OPTIONS }
						onChange={ ( value ) =>
							setAttributes( { dragging: value } )
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<SelectControl
						label={ __( 'Keyboard Navigation', 'blocks-for-leaflet-map' ) }
						value={ keyboard }
						options={ THREE_STATE_OPTIONS }
						onChange={ ( value ) =>
							setAttributes( { keyboard: value } )
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<SelectControl
						label={ __( 'Double Click Zoom', 'blocks-for-leaflet-map' ) }
						value={ doubleClickZoom }
						options={ THREE_STATE_OPTIONS }
						onChange={ ( value ) =>
							setAttributes( { doubleClickZoom: value } )
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<SelectControl
						label={ __( 'Box Zoom', 'blocks-for-leaflet-map' ) }
						help={ __( 'Shift + drag to zoom to area.', 'blocks-for-leaflet-map' ) }
						value={ boxZoom }
						options={ THREE_STATE_OPTIONS }
						onChange={ ( value ) =>
							setAttributes( { boxZoom: value } )
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<SelectControl
						label={ __( 'Close Popup on Click', 'blocks-for-leaflet-map' ) }
						value={ closePopupOnClick }
						options={ THREE_STATE_OPTIONS }
						onChange={ ( value ) =>
							setAttributes( { closePopupOnClick: value } )
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<SelectControl
						label={ __( 'Tap', 'blocks-for-leaflet-map' ) }
						help={ __( 'Mobile tap interaction.', 'blocks-for-leaflet-map' ) }
						value={ tap }
						options={ THREE_STATE_OPTIONS }
						onChange={ ( value ) =>
							setAttributes( { tap: value } )
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<SelectControl
						label={ __( 'Inertia', 'blocks-for-leaflet-map' ) }
						help={ __( 'Pan inertia after dragging.', 'blocks-for-leaflet-map' ) }
						value={ inertia }
						options={ THREE_STATE_OPTIONS }
						onChange={ ( value ) =>
							setAttributes( { inertia: value } )
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
				</PanelBody>

				{ /* ── Zoom & Bounds panel ────────────────────────────────── */ }
				<PanelBody
					title={ __( 'Zoom & Bounds', 'blocks-for-leaflet-map' ) }
					initialOpen={ false }
				>
					<TextControl
						label={ __( 'Min Zoom', 'blocks-for-leaflet-map' ) }
						help={ __(
							'Minimum zoom level allowed. Leave empty for global default.',
							'blocks-for-leaflet-map'
						) }
						type="number"
						min={ 0 }
						max={ 25 }
						step={ 1 }
						value={ minZoom }
						onChange={ ( value ) =>
							setAttributes( { minZoom: value } )
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<TextControl
						label={ __( 'Max Zoom', 'blocks-for-leaflet-map' ) }
						help={ __(
							'Maximum zoom level allowed. Leave empty for global default.',
							'blocks-for-leaflet-map'
						) }
						type="number"
						min={ 0 }
						max={ 25 }
						step={ 1 }
						value={ maxZoom }
						onChange={ ( value ) =>
							setAttributes( { maxZoom: value } )
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<TextControl
						label={ __( 'Max Bounds', 'blocks-for-leaflet-map' ) }
						help={ __(
							'Restrict the map view to a bounding box. Format: lat,lng;lat,lng (southwest;northeast). Example: 40.0,-4.0;38.0,-3.0',
							'blocks-for-leaflet-map'
						) }
						value={ maxBounds }
						onChange={ ( value ) =>
							setAttributes( { maxBounds: value } )
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
				</PanelBody>

				{ /* ── Tile Layer panel ──────────────────────────────────── */ }
				<PanelBody
					title={ __( 'Tile Layer', 'blocks-for-leaflet-map' ) }
					initialOpen={ false }
				>
					<p>{ __( 'Override the global Leaflet Map tile settings for this specific map.', 'blocks-for-leaflet-map' ) }</p>
					<TextControl
						label={ __( 'Tile URL', 'blocks-for-leaflet-map' ) }
						placeholder="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
						help={
							<>
								{ __( 'Browse providers: ', 'blocks-for-leaflet-map' ) }
								<a
									href="https://alexurquhart.github.io/free-tiles/"
									target="_blank"
									rel="noopener noreferrer"
									aria-label={ sprintf( __( '%s (opens in new tab)', 'blocks-for-leaflet-map' ), __( 'Free Tile Services', 'blocks-for-leaflet-map' ) ) }
								>
									{ __( 'Free Tile Services', 'blocks-for-leaflet-map' ) }↗
								</a>
								{ ' · ' }
								<a
									href="https://leaflet-extras.github.io/leaflet-providers/preview/"
									target="_blank"
									rel="noopener noreferrer"
									aria-label={ sprintf( __( '%s (opens in new tab)', 'blocks-for-leaflet-map' ), __( 'Leaflet Providers Preview', 'blocks-for-leaflet-map' ) ) }
								>
									{ __( 'Leaflet Providers Preview', 'blocks-for-leaflet-map' ) }↗
								</a>
								{ ' · ' }
								<a
									href="https://wiki.openstreetmap.org/wiki/Raster_tile_providers"
									target="_blank"
									rel="noopener noreferrer"
									aria-label={ sprintf( __( '%s (opens in new tab)', 'blocks-for-leaflet-map' ), __( 'OSM Wiki', 'blocks-for-leaflet-map' ) ) }
								>
									{ __( 'OSM Wiki', 'blocks-for-leaflet-map' ) }↗
								</a>
							</>
						}
						value={ tileurl }
						onChange={ ( value ) =>
							setAttributes( { tileurl: value } )
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<NumberControl
						label={ __( 'Tile Size', 'blocks-for-leaflet-map' ) }
						help={ __( 'Default: 256. Most providers (OpenStreetMap, ArcGIS, CartoDB) use 256 — leave empty unless your provider\'s documentation explicitly requires a different value (e.g., Mapbox: 512). Changing this incorrectly will distort the map.', 'blocks-for-leaflet-map' ) }
						value={ localTilesize }
						min={ 64 }
						onChange={ ( value ) => setLocalTilesize( value ?? '' ) }
						onBlur={ () => setAttributes( { tilesize: localTilesize } ) }
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<TextControl
						label={ __( 'Subdomains', 'blocks-for-leaflet-map' ) }
						help={ __( 'Comma-separated list (e.g., a,b,c) matching the {s} placeholder in the Tile URL. Leave empty if not used.', 'blocks-for-leaflet-map' ) }
						value={ subdomains }
						onChange={ ( value ) =>
							setAttributes( { subdomains: value } )
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<TextControl
						label={ __( 'Map ID', 'blocks-for-leaflet-map' ) }
						help={ __( 'Required only for Mapbox tiles. Leave empty for other providers.', 'blocks-for-leaflet-map' ) }
						value={ mapid }
						onChange={ ( value ) =>
							setAttributes( { mapid: value } )
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<TextControl
						label={ __( 'Access Token', 'blocks-for-leaflet-map' ) }
						help={ __( 'Required only for providers that need authentication (e.g., Mapbox, Stadia, Thunderforest). This token will be visible in the page\'s HTML source — restrict it to your domain in the provider\'s dashboard.', 'blocks-for-leaflet-map' ) }
						value={ accesstoken }
						onChange={ ( value ) =>
							setAttributes( { accesstoken: value } )
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<NumberControl
						label={ __( 'Zoom Offset', 'blocks-for-leaflet-map' ) }
						help={ __( 'Default: 0. Only change for specific providers (Mapbox typically requires -1 when Tile Size is 512).', 'blocks-for-leaflet-map' ) }
						value={ localZoomoffset }
						onChange={ ( value ) => setLocalZoomoffset( value ?? '' ) }
						onBlur={ () => setAttributes( { zoomoffset: localZoomoffset } ) }
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<SelectControl
						label={ __( 'No Wrap', 'blocks-for-leaflet-map' ) }
						help={ __( 'Prevents the map from repeating horizontally when scrolled past the edges. Default: off.', 'blocks-for-leaflet-map' ) }
						value={ nowrap }
						options={ THREE_STATE_OPTIONS }
						onChange={ ( value ) =>
							setAttributes( { nowrap: value } )
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<SelectControl
						label={ __( 'Detect Retina', 'blocks-for-leaflet-map' ) }
						help={ __( 'Loads higher-resolution tiles on Retina/HiDPI screens. Only enable if the provider serves @2x tiles, otherwise the map will fail on those screens.', 'blocks-for-leaflet-map' ) }
						value={ detectretina }
						options={ THREE_STATE_OPTIONS }
						onChange={ ( value ) =>
							setAttributes( { detectretina: value } )
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<TextareaControl
						label={ __( 'Attribution', 'blocks-for-leaflet-map' ) }
						help={ __(
							'Custom attribution HTML. Leave empty to use the default from Leaflet Map settings.',
							'blocks-for-leaflet-map'
						) }
						value={ attribution }
						onChange={ ( value ) =>
							setAttributes( { attribution: value } )
						}
						rows={ 2 }
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
					<ToggleControl
						label={ __( 'Show Scale', 'blocks-for-leaflet-map' ) }
						help={ __(
							'Display a scale indicator on the map.',
							'blocks-for-leaflet-map'
						) }
						checked={ showScale }
						onChange={ ( value ) =>
							setAttributes( { showScale: value } )
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
								help={ __(
									'Browser tooltip shown on hover. Also used as the marker\'s accessible name.',
									'blocks-for-leaflet-map'
								) }
								value={ marker.title || '' }
								onChange={ ( value ) =>
									handleUpdateMarker( index, { title: value } )
								}
								__next40pxDefaultSize
								__nextHasNoMarginBottom
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
							{ /* Advanced marker options — collapsed by default to keep the
							     common case (lat/lng + title + popup) compact. */ }
							<PanelBody
								title={ __( 'Advanced', 'blocks-for-leaflet-map' ) }
								initialOpen={ false }
							>
								<TextControl
									label={ __( 'Alt Text', 'blocks-for-leaflet-map' ) }
									help={ __(
										'Alternative text for the marker image. Improves accessibility for screen reader users.',
										'blocks-for-leaflet-map'
									) }
									value={ marker.alt || '' }
									onChange={ ( value ) =>
										handleUpdateMarker( index, { alt: value } )
									}
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>
								<ToggleControl
									label={ __( 'Auto-open Popup', 'blocks-for-leaflet-map' ) }
									help={ __(
										'Open the popup automatically when the page loads.',
										'blocks-for-leaflet-map'
									) }
									checked={ marker.visible || false }
									onChange={ ( value ) =>
										handleUpdateMarker( index, { visible: value } )
									}
									__nextHasNoMarginBottom
								/>
								<ToggleControl
									label={ __( 'Draggable', 'blocks-for-leaflet-map' ) }
									help={ __(
										'Allow visitors to drag the marker. The new position is logged to the browser console.',
										'blocks-for-leaflet-map'
									) }
									checked={ marker.draggable || false }
									onChange={ ( value ) =>
										handleUpdateMarker( index, { draggable: value } )
									}
									__nextHasNoMarginBottom
								/>
								<RangeControl
									label={ __( 'Opacity', 'blocks-for-leaflet-map' ) }
									help={ __(
										'Marker icon opacity. Default: 1 (fully opaque).',
										'blocks-for-leaflet-map'
									) }
									value={ marker.opacity != null ? marker.opacity : 1 }
									onChange={ ( value ) =>
										handleUpdateMarker( index, { opacity: value } )
									}
									min={ 0 }
									max={ 1 }
									step={ 0.05 }
									__nextHasNoMarginBottom
								/>
								<NumberControl
									label={ __( 'Z-Index Offset', 'blocks-for-leaflet-map' ) }
									help={ __(
										'Raise or lower this marker relative to others. Leaflet already offsets markers by latitude, so you may need values of 10+ (or higher when markers are close together) to visibly change the stacking order.',
										'blocks-for-leaflet-map'
									) }
									value={ marker.zIndexOffset ?? 0 }
									onChange={ ( value ) => {
										const val = parseInt( value, 10 );
										handleUpdateMarker( index, { zIndexOffset: isNaN( val ) ? 0 : val } );
									} }
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>
							</PanelBody>
							{ /* Custom Icon options — collapsed by default. */ }
							<PanelBody
								title={ __( 'Custom Icon', 'blocks-for-leaflet-map' ) }
								initialOpen={ false }
							>
								<ToggleControl
									label={ __( 'Use custom icon', 'blocks-for-leaflet-map' ) }
									checked={ marker.useCustomIcon || false }
									onChange={ ( value ) =>
										handleUpdateMarker( index, { useCustomIcon: value } )
									}
									__nextHasNoMarginBottom
								/>
								{ marker.useCustomIcon && (
									<>
										{ /* Icon URL */ }
										<p style={ { margin: '12px 0 4px', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', color: '#1e1e1e' } }>
											{ __( 'Icon', 'blocks-for-leaflet-map' ) }
										</p>
										<MediaUploadCheck>
											<MediaUpload
												onSelect={ ( media ) =>
													handleUpdateMarker( index, { iconUrl: media.url } )
												}
												allowedTypes={ [ 'image' ] }
												render={ ( { open } ) => (
													<>
														<Button
															variant="secondary"
															onClick={ open }
															style={ { width: '100%', justifyContent: 'center' } }
														>
															{ marker.iconUrl
																? __( 'Replace image', 'blocks-for-leaflet-map' )
																: __( 'Select image', 'blocks-for-leaflet-map' )
															}
														</Button>
														{ marker.iconUrl && (
															<>
																<p style={ { fontSize: '11px', wordBreak: 'break-all', margin: '4px 0' } }>
																	{ marker.iconUrl }
																</p>
																<Button
																	variant="link"
																	isDestructive
																	onClick={ () =>
																		handleUpdateMarker( index, { iconUrl: '' } )
																	}
																>
																	{ __( 'Remove', 'blocks-for-leaflet-map' ) }
																</Button>
															</>
														) }
													</>
												) }
											/>
										</MediaUploadCheck>
										{ /* Icon Size */ }
										<p style={ { margin: '12px 0 4px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: '#1e1e1e' } }>
											{ __( 'Icon Size (px)', 'blocks-for-leaflet-map' ) }
										</p>
										<div style={ { display: 'flex', gap: '8px' } }>
											<NumberControl
												label={ __( 'Width', 'blocks-for-leaflet-map' ) }
												value={ marker.iconWidth ?? '' }
												min={ 1 }
												onChange={ ( value ) => {
													const val = parseInt( value, 10 );
													handleUpdateMarker( index, { iconWidth: isNaN( val ) ? null : val } );
												} }
												style={ { flex: 1 } }
												__next40pxDefaultSize
											/>
											<NumberControl
												label={ __( 'Height', 'blocks-for-leaflet-map' ) }
												value={ marker.iconHeight ?? '' }
												min={ 1 }
												onChange={ ( value ) => {
													const val = parseInt( value, 10 );
													handleUpdateMarker( index, { iconHeight: isNaN( val ) ? null : val } );
												} }
												style={ { flex: 1 } }
												__next40pxDefaultSize
											/>
										</div>
										{ /* Icon Anchor */ }
										<p style={ { margin: '12px 0 4px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: '#1e1e1e' } }>
											{ __( 'Icon Anchor (px)', 'blocks-for-leaflet-map' ) }
										</p>
										<div style={ { display: 'flex', gap: '8px' } }>
											<NumberControl
												label={ __( 'X', 'blocks-for-leaflet-map' ) }
												value={ marker.iconAnchorX ?? '' }
												onChange={ ( value ) => {
													const val = parseInt( value, 10 );
													handleUpdateMarker( index, { iconAnchorX: isNaN( val ) ? null : val } );
												} }
												style={ { flex: 1 } }
												__next40pxDefaultSize
											/>
											<NumberControl
												label={ __( 'Y', 'blocks-for-leaflet-map' ) }
												value={ marker.iconAnchorY ?? '' }
												onChange={ ( value ) => {
													const val = parseInt( value, 10 );
													handleUpdateMarker( index, { iconAnchorY: isNaN( val ) ? null : val } );
												} }
												style={ { flex: 1 } }
												__next40pxDefaultSize
											/>
										</div>
										{ /* Popup Anchor */ }
										<p style={ { margin: '12px 0 4px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: '#1e1e1e' } }>
											{ __( 'Popup Anchor (px)', 'blocks-for-leaflet-map' ) }
										</p>
										<div style={ { display: 'flex', gap: '8px' } }>
											<NumberControl
												label={ __( 'X', 'blocks-for-leaflet-map' ) }
												value={ marker.popupAnchorX ?? '' }
												onChange={ ( value ) => {
													const val = parseInt( value, 10 );
													handleUpdateMarker( index, { popupAnchorX: isNaN( val ) ? null : val } );
												} }
												style={ { flex: 1 } }
												__next40pxDefaultSize
											/>
											<NumberControl
												label={ __( 'Y', 'blocks-for-leaflet-map' ) }
												value={ marker.popupAnchorY ?? '' }
												onChange={ ( value ) => {
													const val = parseInt( value, 10 );
													handleUpdateMarker( index, { popupAnchorY: isNaN( val ) ? null : val } );
												} }
												style={ { flex: 1 } }
												__next40pxDefaultSize
											/>
										</div>
										{ /* Shadow toggle */ }
										<ToggleControl
											label={ __( 'Add shadow', 'blocks-for-leaflet-map' ) }
											checked={ marker.useShadow || false }
											onChange={ ( value ) =>
												handleUpdateMarker( index, { useShadow: value } )
											}
											style={ { marginTop: '12px' } }
											__nextHasNoMarginBottom
										/>
										{ marker.useShadow && (
											<>
												{ /* Shadow URL */ }
												<p style={ { margin: '12px 0 4px', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', color: '#1e1e1e' } }>
													{ __( 'Shadow', 'blocks-for-leaflet-map' ) }
												</p>
												<MediaUploadCheck>
													<MediaUpload
														onSelect={ ( media ) =>
															handleUpdateMarker( index, { shadowUrl: media.url } )
														}
														allowedTypes={ [ 'image' ] }
														render={ ( { open } ) => (
															<>
																<Button
																	variant="secondary"
																	onClick={ open }
																	style={ { width: '100%', justifyContent: 'center' } }
																>
																	{ marker.shadowUrl
																		? __( 'Replace image', 'blocks-for-leaflet-map' )
																		: __( 'Select image', 'blocks-for-leaflet-map' )
																	}
																</Button>
																{ marker.shadowUrl && (
																	<>
																		<p style={ { fontSize: '11px', wordBreak: 'break-all', margin: '4px 0' } }>
																			{ marker.shadowUrl }
																		</p>
																		<Button
																			variant="link"
																			isDestructive
																			onClick={ () =>
																				handleUpdateMarker( index, { shadowUrl: '' } )
																			}
																		>
																			{ __( 'Remove', 'blocks-for-leaflet-map' ) }
																		</Button>
																	</>
																) }
															</>
														) }
													/>
												</MediaUploadCheck>
												{ /* Shadow Size */ }
												<p style={ { margin: '12px 0 4px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: '#1e1e1e' } }>
													{ __( 'Shadow Size (px)', 'blocks-for-leaflet-map' ) }
												</p>
												<div style={ { display: 'flex', gap: '8px' } }>
													<NumberControl
														label={ __( 'Width', 'blocks-for-leaflet-map' ) }
														value={ marker.shadowWidth ?? '' }
														min={ 1 }
														onChange={ ( value ) => {
															const val = parseInt( value, 10 );
															handleUpdateMarker( index, { shadowWidth: isNaN( val ) ? null : val } );
														} }
														style={ { flex: 1 } }
														__next40pxDefaultSize
													/>
													<NumberControl
														label={ __( 'Height', 'blocks-for-leaflet-map' ) }
														value={ marker.shadowHeight ?? '' }
														min={ 1 }
														onChange={ ( value ) => {
															const val = parseInt( value, 10 );
															handleUpdateMarker( index, { shadowHeight: isNaN( val ) ? null : val } );
														} }
														style={ { flex: 1 } }
														__next40pxDefaultSize
													/>
												</div>
												{ /* Shadow Anchor */ }
												<p style={ { margin: '12px 0 4px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: '#1e1e1e' } }>
													{ __( 'Shadow Anchor (px)', 'blocks-for-leaflet-map' ) }
												</p>
												<div style={ { display: 'flex', gap: '8px' } }>
													<NumberControl
														label={ __( 'X', 'blocks-for-leaflet-map' ) }
														value={ marker.shadowAnchorX ?? '' }
														onChange={ ( value ) => {
															const val = parseInt( value, 10 );
															handleUpdateMarker( index, { shadowAnchorX: isNaN( val ) ? null : val } );
														} }
														style={ { flex: 1 } }
														__next40pxDefaultSize
													/>
													<NumberControl
														label={ __( 'Y', 'blocks-for-leaflet-map' ) }
														value={ marker.shadowAnchorY ?? '' }
														onChange={ ( value ) => {
															const val = parseInt( value, 10 );
															handleUpdateMarker( index, { shadowAnchorY: isNaN( val ) ? null : val } );
														} }
														style={ { flex: 1 } }
														__next40pxDefaultSize
													/>
												</div>
											</>
										) }
									</>
								) }
							</PanelBody>
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
