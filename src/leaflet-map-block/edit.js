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
 *     type: 'bflm_map_update'       — user pan/zoom → update lat/lng/zoom attrs
 *     type: 'bflm_marker_update'    — marker drag   → update marker lat/lng attr
 *     type: 'bflm_linepoint_update' — line-point drag → update line point lat/lng
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
import {
	useBlockProps,
	BlockControls,
	InspectorControls,
	MediaUpload,
	MediaUploadCheck,
} from '@wordpress/block-editor';
import {
	PanelBody,
	Button,
	ColorPalette,
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
	{ value: '%', label: '%', default: 100 },
	{ value: 'vh', label: 'vh', default: 50 },
];

/**
 * Options for three-state interaction controls.
 * Empty string = "Default" (omit from shortcode, use Leaflet Map global settings).
 */
const THREE_STATE_OPTIONS = [
	{ value: '', label: 'Default' },
	{ value: 'true', label: 'Enabled' },
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
	if (
		typeof h === 'number' ||
		( typeof h === 'string' && /^\d+$/.test( h ) )
	) {
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
	{ key: 'lat', attr: 'lat', serialize: ( v ) => String( v ) },
	{ key: 'lng', attr: 'lng', serialize: ( v ) => String( v ) },
	{
		key: 'zoom',
		attr: 'zoom',
		serialize: ( v ) => String( parseInt( v, 10 ) ),
	},
	{ key: 'height', attr: 'height', serialize: ( v ) => normalizeHeight( v ) },
	{
		key: 'scrollwheel',
		attr: 'scrollWheelZoom',
		serialize: ( v ) => ( v ? 'true' : 'false' ),
	},
	{
		key: 'zoomcontrol',
		attr: 'zoomControl',
		serialize: ( v ) => ( v === false ? 'false' : 'true' ),
	},
	{
		key: 'fitbounds',
		attr: 'fitMarkers',
		serialize: ( v ) => ( v ? 'true' : 'false' ),
	},
	{
		key: 'show_scale',
		attr: 'showScale',
		serialize: ( v ) => ( v ? '1' : '0' ),
	},
	// ── Interaction attributes (omit when empty = "Default") ──────────────
	{ key: 'dragging', attr: 'dragging', serialize: ( v ) => v || null },
	{ key: 'keyboard', attr: 'keyboard', serialize: ( v ) => v || null },
	{
		key: 'doubleclickzoom',
		attr: 'doubleClickZoom',
		serialize: ( v ) => v || null,
	},
	{ key: 'boxzoom', attr: 'boxZoom', serialize: ( v ) => v || null },
	{
		key: 'closepopuponclick',
		attr: 'closePopupOnClick',
		serialize: ( v ) => v || null,
	},
	{ key: 'tap', attr: 'tap', serialize: ( v ) => v || null },
	{ key: 'inertia', attr: 'inertia', serialize: ( v ) => v || null },
	// ── Zoom & bounds attributes (omit when empty or non-numeric) ─────────
	{
		key: 'min_zoom',
		attr: 'minZoom',
		serialize: ( v ) => ( v !== '' && ! isNaN( v ) ? v : null ),
	},
	{
		key: 'max_zoom',
		attr: 'maxZoom',
		serialize: ( v ) => ( v !== '' && ! isNaN( v ) ? v : null ),
	},
	{ key: 'maxbounds', attr: 'maxBounds', serialize: ( v ) => v || null },
	// ── Tile layer attributes (omit when empty) ───────────────────────────
	{ key: 'tileurl', attr: 'tileurl', serialize: ( v ) => v || null },
	{
		key: 'tilesize',
		attr: 'tilesize',
		serialize: ( v ) =>
			v !== '' && ! isNaN( v ) && parseInt( v, 10 ) >= 1
				? String( parseInt( v, 10 ) )
				: null,
	},
	{ key: 'subdomains', attr: 'subdomains', serialize: ( v ) => v || null },
	{ key: 'mapid', attr: 'mapid', serialize: ( v ) => v || null },
	{ key: 'accesstoken', attr: 'accesstoken', serialize: ( v ) => v || null },
	{
		key: 'zoomoffset',
		attr: 'zoomoffset',
		serialize: ( v ) =>
			v !== '' && ! isNaN( v ) ? String( parseInt( v, 10 ) ) : null,
	},
	{
		key: 'nowrap',
		attr: 'nowrap',
		serialize: ( v ) => ( v === 'true' || v === 'false' ? v : null ),
	},
	// Note: block attribute 'detectretina' maps to shortcode key 'detect_retina' (underscore).
	{
		key: 'detect_retina',
		attr: 'detectretina',
		serialize: ( v ) => ( v === 'true' || v === 'false' ? v : null ),
	},
	// ── Attribution (single-quoted so inner href="…" double quotes are safe) ──
	{
		key: 'attribution',
		attr: 'attribution',
		quote: "'",
		serialize: ( v ) => v || null,
	},
];

/**
 * Build [leaflet-line] / [leaflet-polygon] shortcode strings from a lines array.
 * Keep in sync with the lines section in render.php and bflm_preview_map().
 *
 * @param {Array} lines Block lines attribute.
 * @return {string}
 */
function buildLineShortcodes( lines ) {
	if ( ! lines || lines.length === 0 ) return '';
	let out = '';
	for ( const line of lines ) {
		const points = line.points || [];
		if ( points.length < 2 ) continue;
		const tag =
			line.type === 'polygon' ? 'leaflet-polygon' : 'leaflet-line';
		const latlngs = points
			.map( ( p ) => `${ p.lat },${ p.lng }` )
			.join( '; ' );
		let attrs = ` latlngs="${ latlngs }"`;
		if ( line.fitbounds ) attrs += ` fitbounds="true"`;
		if ( line.color && line.color.trim() )
			attrs += ` color="${ line.color.trim() }"`;
		if ( line.weight != null ) attrs += ` weight="${ line.weight }"`;
		if ( line.opacity != null ) attrs += ` opacity="${ line.opacity }"`;
		if ( line.dashArray && line.dashArray.trim() )
			attrs += ` dasharray="${ line.dashArray.trim() }"`;
		if ( line.classname && line.classname.trim() )
			attrs += ` classname="${ line.classname.trim() }"`;
		if ( line.fill ) attrs += ` fill="true"`;
		if ( line.fillColor && line.fillColor.trim() )
			attrs += ` fillcolor="${ line.fillColor.trim() }"`;
		if ( line.fillOpacity != null )
			attrs += ` fillopacity="${ line.fillOpacity }"`;
		const popup = line.popup || '';
		if ( line.visible && popup ) attrs += ` visible="1"`;
		if ( popup ) {
			out += `\n[${ tag }${ attrs }]${ popup }[/${ tag }]`;
		} else {
			out += `\n[${ tag }${ attrs } /]`;
		}
	}
	return out;
}

/**
 * Build [leaflet-circle] shortcode strings from the circles attribute.
 * Skips circles where lat/lng is null or radius is ≤ 0.
 * Keep in sync with render.php and bflm_preview_map() in blocks-for-leaflet-map.php.
 *
 * @param {Array} circles
 * @return {string}
 */
function buildCircleShortcodes( circles ) {
	if ( ! circles || circles.length === 0 ) return '';
	let out = '';
	for ( const circle of circles ) {
		if ( circle.lat == null || circle.lng == null ) continue;
		const r = circle.radius != null ? Number( circle.radius ) : 1000;
		if ( r <= 0 ) continue;
		let attrs = ` lat="${ circle.lat }" lng="${ circle.lng }" radius="${ r }"`;
		if ( circle.fitbounds ) attrs += ` fitbounds="true"`;
		if ( circle.color && circle.color.trim() )
			attrs += ` color="${ circle.color.trim() }"`;
		if ( circle.weight != null ) attrs += ` weight="${ circle.weight }"`;
		if ( circle.opacity != null ) attrs += ` opacity="${ circle.opacity }"`;
		if ( circle.dashArray && circle.dashArray.trim() )
			attrs += ` dasharray="${ circle.dashArray.trim() }"`;
		if ( circle.classname && circle.classname.trim() )
			attrs += ` classname="${ circle.classname.trim() }"`;
		if ( circle.fill ) attrs += ` fill="true"`;
		if ( circle.fillColor && circle.fillColor.trim() )
			attrs += ` fillcolor="${ circle.fillColor.trim() }"`;
		if ( circle.fillOpacity != null )
			attrs += ` fillopacity="${ circle.fillOpacity }"`;
		const popup = circle.popup || '';
		if ( circle.visible && popup ) attrs += ` visible="1"`;
		if ( popup ) {
			out += `\n[leaflet-circle${ attrs }]${ popup }[/leaflet-circle]`;
		} else {
			out += `\n[leaflet-circle${ attrs } /]`;
		}
	}
	return out;
}

/**
 * Build the [leaflet-map] and [leaflet-marker] shortcode string from block
 * attributes, exactly mirroring what render.php emits on the frontend.
 *
 * Keep in sync with render.php → "Build the [leaflet-map] shortcode" section.
 *
 * @param {Object} attributes Block attributes.
 * @return {string} Full shortcode string (map + zero or more markers + zero or more lines + circles).
 */
function buildShortcode( attributes ) {
	const parts = [];

	for ( const {
		key,
		attr,
		quote = '"',
		serialize,
	} of LEAFLET_MAP_DESCRIPTORS ) {
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
		const mLat = marker.lat;
		const mLng = marker.lng;
		const mTitle = marker.title || '';
		const mContent = marker.content || '';
		const mAlt = marker.alt || '';

		// Build open tag incrementally, mirroring render.php conditional emission.
		let mTag = `[leaflet-marker lat="${ mLat }" lng="${ mLng }"`;
		if ( mTitle ) mTag += ` title="${ mTitle }"`;
		if ( mAlt ) mTag += ` alt="${ mAlt }"`;
		if ( marker.visible ) mTag += ` visible="1"`;
		if ( marker.draggable ) mTag += ` draggable="1"`;
		if ( marker.opacity != null && Math.abs( marker.opacity - 1 ) > 0.001 )
			mTag += ` opacity="${ marker.opacity }"`;
		if ( marker.zIndexOffset != null && marker.zIndexOffset !== 0 )
			mTag += ` zindexoffset="${ marker.zIndexOffset }"`;

		// SVG marker and custom image icon are mutually exclusive: SVG wins when both flags are set.
		if ( marker.useSvgMarker ) {
			mTag += ` svg="true"`;
			if ( marker.svgBackground && marker.svgBackground.trim() )
				mTag += ` background="${ marker.svgBackground.trim() }"`;
			if ( marker.svgIconClass && marker.svgIconClass.trim() )
				mTag += ` iconclass="${ marker.svgIconClass.trim() }"`;
			if ( marker.svgColor && marker.svgColor.trim() )
				mTag += ` color="${ marker.svgColor.trim() }"`;
		} else if ( marker.useCustomIcon ) {
			// Custom icon: only emit when useCustomIcon is true.
			if ( marker.iconUrl ) mTag += ` iconurl="${ marker.iconUrl }"`;
			if (
				marker.iconWidth != null &&
				marker.iconHeight != null &&
				marker.iconWidth >= 1 &&
				marker.iconHeight >= 1
			) {
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
				if ( marker.shadowUrl )
					mTag += ` shadowurl="${ marker.shadowUrl }"`;
				if (
					marker.shadowWidth != null &&
					marker.shadowHeight != null &&
					marker.shadowWidth >= 1 &&
					marker.shadowHeight >= 1
				) {
					mTag += ` shadowsize="${ marker.shadowWidth },${ marker.shadowHeight }"`;
				}
				if (
					marker.shadowAnchorX != null &&
					marker.shadowAnchorY != null
				) {
					mTag += ` shadowanchor="${ marker.shadowAnchorX },${ marker.shadowAnchorY }"`;
				}
			}
		}

		if ( mContent ) {
			shortcode += `\n${ mTag }]${ mContent }[/leaflet-marker]`;
		} else {
			shortcode += `\n${ mTag } /]`;
		}
	}

	shortcode += buildLineShortcodes( attributes.lines );
	shortcode += buildCircleShortcodes( attributes.circles );

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
 * Compute proportional-resize updates for a size + anchor subsystem.
 *
 * Used by the icon and shadow NumberControl onChange handlers when
 * "Lock aspect ratio" is active. Returns a partial updates object
 * ready to be passed to handleUpdateMarker, or null if the aspect
 * ratio cannot be determined (caller should fall back to a plain
 * single-value update).
 *
 * @param {Object}           p
 * @param {'w'|'h'}          p.axis    Which dimension the user directly changed.
 * @param {number}           p.newVal  New integer value for that dimension (>= 1).
 * @param {string}           p.wKey    Attribute key for width  (e.g. 'iconWidth').
 * @param {string}           p.hKey    Attribute key for height (e.g. 'iconHeight').
 * @param {number|null}      p.origW   Stored original width  (preferred ratio source).
 * @param {number|null}      p.origH   Stored original height.
 * @param {number|null}      p.curW    Current width  (ratio fallback + anchor base).
 * @param {number|null}      p.curH    Current height.
 * @param {Array<{key: string, val: *, axis: 'w'|'h'}>} p.anchors
 *   Anchors to rescale. Each entry: key to write, current value, which new
 *   dimension to scale against ('w' for X-axis anchors, 'h' for Y-axis anchors).
 *
 * @return {Object|null}
 */
function computeProportionalResize( {
	axis,
	newVal,
	wKey,
	hKey,
	origW,
	origH,
	curW,
	curH,
	anchors,
} ) {
	// Prefer stored originals; fall back to current dimensions.
	const rW = origW != null && origW >= 1 ? origW : curW;
	const rH = origH != null && origH >= 1 ? origH : curH;

	if ( ! ( rW >= 1 ) || ! ( rH >= 1 ) ) {
		return null;
	}

	const ratio = rW / rH;
	if ( ! isFinite( ratio ) || ratio <= 0 ) {
		return null;
	}

	let newW, newH;
	if ( axis === 'w' ) {
		newW = newVal;
		newH = Math.max( 1, Math.round( newVal / ratio ) );
	} else {
		newH = newVal;
		newW = Math.max( 1, Math.round( newVal * ratio ) );
	}

	const updates = { [ wKey ]: newW, [ hKey ]: newH };

	for ( const anchor of anchors ) {
		// Skip anchors that have no current value.
		if ( anchor.val == null || ! isFinite( anchor.val ) ) {
			continue;
		}
		const base = anchor.axis === 'w' ? curW : curH;
		const newDim = anchor.axis === 'w' ? newW : newH;
		// Guard against division by zero (should not happen given min={1}, but be safe).
		if ( ! ( base >= 1 ) ) {
			continue;
		}
		const anchorRatio = anchor.val / base;
		if ( ! isFinite( anchorRatio ) ) {
			continue;
		}
		updates[ anchor.key ] = Math.round( newDim * anchorRatio );
	}

	return updates;
}

/**
 * The 9 canonical anchor preset positions, in SelectControl display order.
 * xFn/yFn receive (width, height) and return the integer coordinate.
 */
const ANCHOR_PRESETS = [
	{ id: 'top-left', xFn: ( w ) => 0, yFn: () => 0 },
	{ id: 'top-center', xFn: ( w ) => Math.round( w / 2 ), yFn: () => 0 },
	{ id: 'top-right', xFn: ( w ) => w, yFn: () => 0 },
	{ id: 'middle-left', xFn: () => 0, yFn: ( w, h ) => Math.round( h / 2 ) },
	{
		id: 'middle-center',
		xFn: ( w ) => Math.round( w / 2 ),
		yFn: ( w, h ) => Math.round( h / 2 ),
	},
	{
		id: 'middle-right',
		xFn: ( w ) => w,
		yFn: ( w, h ) => Math.round( h / 2 ),
	},
	{ id: 'bottom-left', xFn: () => 0, yFn: ( w, h ) => h },
	{
		id: 'bottom-center',
		xFn: ( w ) => Math.round( w / 2 ),
		yFn: ( w, h ) => h,
	},
	{ id: 'bottom-right', xFn: ( w ) => w, yFn: ( w, h ) => h },
];

/**
 * Return the preset id that matches (anchorX, anchorY) for the given dimensions,
 * or "custom" if no preset matches or the inputs are invalid.
 *
 * Matching uses ±1 px tolerance to absorb rounding differences.
 * Presets are checked in ANCHOR_PRESETS order; first match wins.
 *
 * @param {*} anchorX
 * @param {*} anchorY
 * @param {*} width
 * @param {*} height
 * @return {string} Preset id or "custom".
 */
function getAnchorPreset( anchorX, anchorY, width, height ) {
	if (
		anchorX == null ||
		! isFinite( anchorX ) ||
		anchorY == null ||
		! isFinite( anchorY ) ||
		! ( width >= 1 ) ||
		! isFinite( width ) ||
		! ( height >= 1 ) ||
		! isFinite( height )
	) {
		return 'custom';
	}
	for ( const preset of ANCHOR_PRESETS ) {
		const expectedX = preset.xFn( width, height );
		const expectedY = preset.yFn( width, height );
		if (
			Math.abs( anchorX - expectedX ) <= 1 &&
			Math.abs( anchorY - expectedY ) <= 1
		) {
			return preset.id;
		}
	}
	return 'custom';
}

/**
 * Return { x, y } for the given preset id and dimensions, or null if the
 * preset is "custom", unknown, or the dimensions are invalid.
 *
 * @param {string} presetId
 * @param {*}      width
 * @param {*}      height
 * @return {{ x: number, y: number }|null}
 */
function computeAnchorFromPreset( presetId, width, height ) {
	if (
		presetId === 'custom' ||
		! ( width >= 1 ) ||
		! isFinite( width ) ||
		! ( height >= 1 ) ||
		! isFinite( height )
	) {
		return null;
	}
	const preset = ANCHOR_PRESETS.find( ( p ) => p.id === presetId );
	if ( ! preset ) {
		return null;
	}
	return { x: preset.xFn( width, height ), y: preset.yFn( width, height ) };
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
		lat,
		lng,
		zoom,
		height,
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
		markers,
		lines,
		circles,
	} = attributes;

	const { previewUrl, previewNonce } = window.bflmEditor || {};
	if ( ! previewUrl || ! previewNonce ) {
		return '';
	}

	// Normalize height for backwards compatibility with pre-0.4.0 blocks
	// that stored height as a bare number.
	const h =
		typeof height === 'number' ||
		( typeof height === 'string' && /^\d+$/.test( height ) )
			? `${ height }px`
			: height || '400px';

	const params = new URLSearchParams( {
		action: 'bflm_preview',
		bflm_nonce: previewNonce,
		blockId: clientId,
		lat,
		lng,
		zoom,
		height: h,
		scrollWheelZoom: scrollWheelZoom ? 'true' : 'false',
		zoomControl: zoomControl ? 'true' : 'false',
		fitMarkers: fitMarkers ? 'true' : 'false',
		attribution: attribution,
		showScale: showScale ? 'true' : 'false',
		markers: JSON.stringify( markers ),
		lines: JSON.stringify( lines || [] ),
		circles: JSON.stringify( circles || [] ),
	} );

	// Only include interaction params when explicitly set (not "Default").
	if ( dragging ) params.set( 'dragging', dragging );
	if ( keyboard ) params.set( 'keyboard', keyboard );
	if ( doubleClickZoom ) params.set( 'doubleClickZoom', doubleClickZoom );
	if ( boxZoom ) params.set( 'boxZoom', boxZoom );
	if ( closePopupOnClick )
		params.set( 'closePopupOnClick', closePopupOnClick );
	if ( tap ) params.set( 'tap', tap );
	if ( inertia ) params.set( 'inertia', inertia );
	if ( minZoom ) params.set( 'minZoom', minZoom );
	if ( maxZoom ) params.set( 'maxZoom', maxZoom );
	if ( maxBounds ) params.set( 'maxBounds', maxBounds );
	if ( tileurl ) params.set( 'tileurl', tileurl );
	if ( tilesize ) params.set( 'tilesize', tilesize );
	if ( subdomains ) params.set( 'subdomains', subdomains );
	if ( mapid ) params.set( 'mapid', mapid );
	if ( accesstoken ) params.set( 'accesstoken', accesstoken );
	if ( zoomoffset ) params.set( 'zoomoffset', zoomoffset );
	if ( nowrap ) params.set( 'nowrap', nowrap );
	if ( detectretina ) params.set( 'detectretina', detectretina );

	return previewUrl + '?' + params.toString();
}

/**
 * POST an address string to the bflm_geocode AJAX endpoint and return
 * the parsed candidate list.
 *
 * @param {string} address Search query.
 * @return {Promise<{ candidates: Array, error: string }>}
 *   Resolves with candidates on success, or an error message on failure.
 *   Never rejects — all network/parse errors are caught and returned as { candidates: [], error }.
 */
async function bflmGeocodeAddress( address ) {
	const { previewUrl, geocodeNonce } = window.bflmEditor || {};
	if ( ! previewUrl || ! geocodeNonce ) {
		return {
			candidates: [],
			error: __(
				'Geocoding is not available. Please reload the editor.',
				'blocks-for-leaflet-map'
			),
		};
	}
	try {
		const response = await fetch( previewUrl, {
			method: 'POST',
			body: new URLSearchParams( {
				action: 'bflm_geocode',
				_ajax_nonce: geocodeNonce,
				address,
			} ),
		} );
		const data = await response.json();
		if ( ! data.success ) {
			return {
				candidates: [],
				error:
					data.data?.message ||
					__(
						'An unexpected error occurred. Please try again.',
						'blocks-for-leaflet-map'
					),
			};
		}
		return { candidates: data.data.candidates, error: '' };
	} catch ( e ) {
		return {
			candidates: [],
			error: __(
				'Geocoding request failed. Please check your connection and try again.',
				'blocks-for-leaflet-map'
			),
		};
	}
}

/**
 * Edit component for the Leaflet Map Block.
 *
 * @param {Object}   props               Component props.
 * @param {Object}   props.attributes    Block attributes.
 * @param {Function} props.setAttributes Attribute setter.
 * @return {Element} Element to render.
 */
export default function Edit( {
	attributes,
	setAttributes,
	isSelected,
	clientId,
} ) {
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
		lines,
	} = attributes;

	// Local state for NumberControls that commit only on blur (Tile Size, Zoom Offset).
	// This prevents iframe rebuilds on every keystroke/arrow-click with intermediate values.
	const [ localTilesize, setLocalTilesize ] = useState( tilesize );
	const [ localZoomoffset, setLocalZoomoffset ] = useState( zoomoffset );

	// Sync local state when the block attribute changes externally (undo/redo, block switch).
	useEffect( () => {
		setLocalTilesize( tilesize );
	}, [ tilesize ] );
	useEffect( () => {
		setLocalZoomoffset( zoomoffset );
	}, [ zoomoffset ] );

	// ── Geocoding local state ─────────────────────────────────────────────────

	/**
	 * Location input mode: 'coordinates' shows lat/lng fields; 'address' shows
	 * the address search input. Defaults to 'address' when a saved address exists.
	 */
	const [ locationMode, setLocationMode ] = useState(
		address ? 'address' : 'coordinates'
	);

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
	useEffect( () => {
		setAddressInput( address );
	}, [ address ] );

	// ── Shortcode strip state ─────────────────────────────────────────────────

	/**
	 * Whether the shortcode strip is currently visible below the block preview.
	 * Local UI state only — not persisted; strip always starts hidden on load.
	 */
	const [ showShortcode, setShowShortcode ] = useState( false );

	/** True for ~2 s after the user copies the shortcode, to show "Copied!" feedback. */
	const [ isCopied, setIsCopied ] = useState( false );

	/**
	 * Tracks mutual-exclusion conflict notices per marker index.
	 * 'customIconDisabled' — SVG mode was just enabled, custom icon auto-disabled.
	 * 'svgDisabled'        — Custom icon mode was just enabled, SVG auto-disabled.
	 * null / undefined     — no active conflict notice for that marker.
	 */
	const [ conflictNotices, setConflictNotices ] = useState( {} );

	/**
	 * Per-marker geocode UI state keyed by marker index.
	 * Each entry: { input: string, status: 'idle'|'loading'|'candidates'|'error', candidates: Array, error: string }
	 */
	const [ markerSearch, setMarkerSearch ] = useState( {} );

	/**
	 * Per-point geocode UI state for lines, keyed by "${lineIndex}_${pointIndex}".
	 * Each entry: { input, status, candidates, error }
	 */
	const [ linePointSearch, setLinePointSearch ] = useState( {} );

	/**
	 * Tracks which point rows are expanded in the Lines panel.
	 * Keyed by "${lineIndex}_${pointIndex}". Default collapsed.
	 */
	const [ openPoints, setOpenPoints ] = useState( {} );

	/**
	 * Index of the line/polygon currently in draw mode, or null.
	 * Only one shape can be drawn at a time.
	 */
	const [ drawingLineIndex, setDrawingLineIndex ] = useState( null );

	/**
	 * Ref mirror of drawingLineIndex — read inside postMessage handlers and the
	 * iframe-ready callback without stale closure issues.
	 */
	const drawingLineIndexRef = useRef( null );

	/**
	 * Index of the per-line PanelBody that is currently expanded (controlled).
	 * Defaults to the last line when a new line is added; null = all collapsed.
	 */
	const [ expandedLineIndex, setExpandedLineIndex ] = useState( null );

	/** Index of the circle currently in draw mode, or null. Mutually exclusive with drawingLineIndex. */
	const [ drawingCircleIndex, setDrawingCircleIndex ] = useState( null );

	/** Ref mirror of drawingCircleIndex — read inside postMessage handlers without stale closure issues. */
	const drawingCircleIndexRef = useRef( null );

	/** Index of the per-circle PanelBody that is currently expanded (controlled). */
	const [ expandedCircleIndex, setExpandedCircleIndex ] = useState( null );

	/** Per-circle geocode UI state keyed by circle index. { input, status, candidates, error } */
	const [ circleSearch, setCircleSearch ] = useState( {} );

	/** Per-circle radius unit UI state ('m' | 'km'), keyed by circle index. NOT a block attribute. */
	const [ circleRadiusUnit, setCircleRadiusUnit ] = useState( {} );

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
			navigator.clipboard
				.writeText( shortcode )
				.then( fire, () => fallbackCopy( shortcode, fire ) );
			return;
		}

		fallbackCopy( shortcode, fire );
	}

	// Backwards compatibility: if height is a bare number (from pre-0.4.0 blocks),
	// convert it to a string with 'px' unit.
	const normalizedHeight =
		typeof height === 'number' ||
		( typeof height === 'string' && /^\d+$/.test( height ) )
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

	// Keep drawingLineIndexRef in sync with state so postMessage callbacks can
	// read the current value without stale closures.
	useEffect( () => {
		drawingLineIndexRef.current = drawingLineIndex;
	}, [ drawingLineIndex ] );

	// Keep drawingCircleIndexRef in sync with state.
	useEffect( () => {
		drawingCircleIndexRef.current = drawingCircleIndex;
	}, [ drawingCircleIndex ] );

	/** setTimeout handle for the 500 ms structural-change src-rebuild debounce. */
	const srcDebounceRef = useRef( null );

	/** setTimeout handle for the 100 ms view postMessage debounce. */
	const viewDebounceRef = useRef( null );

	/**
	 * True after the component has mounted. Used to skip the previewUrlKey
	 * effect on the very first render (mount effect already set iframe.src).
	 */
	const hasMountedRef = useRef( false );

	/** Shortcode used for the last iframe src load — set by mount and structural effects. */
	const lastLoadedShortcodeRef = useRef( '' );

	/** Ref attached to the toolbar shortcode toggle button for Popover anchoring. */
	const toggleButtonRef = useRef( null );

	const blockProps = useBlockProps( {
		className: 'bflm-leaflet-map-block',
	} );

	// Keep attributesRef and clientIdRef current after every render.
	useEffect( () => {
		attributesRef.current = attributes;
		clientIdRef.current = clientId;
	} );

	// ── Mount: set initial iframe src immediately ─────────────────────────────
	useEffect( () => {
		const iframe = iframeRef.current;
		if ( ! iframe ) {
			return;
		}
		const url = buildPreviewUrl(
			attributesRef.current,
			clientIdRef.current
		);
		if ( url ) {
			iframe.src = url;
			lastLoadedShortcodeRef.current = buildShortcode( attributesRef.current );
		}
		hasMountedRef.current = true;
	}, [] ); // eslint-disable-line react-hooks/exhaustive-deps

	// ── Structural changes → rebuild iframe src (500 ms debounce) ─────────────
	//
	// Keyed on `previewUrlKey` — a serialisation of everything that affects the
	// rendered preview URL. Using the full shortcode string (already computed
	// each render) means:
	//   • Adding an empty line or single-point line → shortcode unchanged → no rebuild.
	//   • Changing style props (color, weight) → shortcode unchanged → no rebuild.
	//   • A line reaching ≥2 points, marker added, height changed → rebuild fires.
	// Suppressed while draw mode is active: the iframe paints its own live
	// overlay, so reloading on every click causes flicker. When draw mode ends,
	// NO explicit reload is triggered — the shape stays on the map via Leaflet
	// API. This effect fires only if a truly renderable change happened (e.g. a
	// line reached ≥2 points) after draw mode is cleared.
	// Uses attributesRef so the rebuilt URL reflects the current lat/lng/zoom
	// (which may have drifted via postMessage since the last full load).
	// shortcode encodes every attribute that affects the preview URL, including
	// tile params, markers, lines (only those with ≥2 points), height, etc.
	// UI-only state (expandedLineIndex, drawingLineIndex, openPoints) is excluded
	// because it doesn't affect the rendered map.
	const previewUrlKey = shortcode;

	useEffect( () => {
		// Skip on first render — mount effect already set iframe.src.
		if ( ! hasMountedRef.current ) {
			return;
		}
		// Skip rebuild mid-draw — iframe overlay handles live preview.
		if ( drawingLineIndexRef.current !== null ) {
			return;
		}
		if ( drawingCircleIndexRef.current !== null ) {
			return;
		}
		clearTimeout( srcDebounceRef.current );
		srcDebounceRef.current = setTimeout( () => {
			const iframe = iframeRef.current;
			if ( ! iframe ) {
				return;
			}
			const url = buildPreviewUrl(
				attributesRef.current,
				clientIdRef.current
			);
			if ( url && iframe.src !== url ) {
				iframe.src = url;
				lastLoadedShortcodeRef.current = buildShortcode(
					attributesRef.current
				);
			}
		}, 500 );

		return () => clearTimeout( srcDebounceRef.current );
	}, [ previewUrlKey ] ); // eslint-disable-line react-hooks/exhaustive-deps

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
			const {
				lat: currentLat,
				lng: currentLng,
				zoom: currentZoom,
			} = attributesRef.current;
			iframe.contentWindow.postMessage(
				{
					type: 'bflm_set_view',
					blockId: clientIdRef.current,
					lat: currentLat,
					lng: currentLng,
					zoom: currentZoom,
				},
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
					lat: parseFloat( msg.lat.toFixed( 6 ) ),
					lng: parseFloat( msg.lng.toFixed( 6 ) ),
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
				return;
			}

			if ( msg.type === 'bflm_linepoint_update' ) {
				const currentLines = attributesRef.current.lines || [];
				const li = msg.lineIndex;
				const pi = msg.pointIndex;
				const updatedLines = currentLines.map( ( l, i ) => {
					if ( i !== li ) return l;
					return {
						...l,
						points: ( l.points || [] ).map( ( p, j ) =>
							j === pi
								? {
										...p,
										lat: parseFloat( msg.lat.toFixed( 6 ) ),
										lng: parseFloat( msg.lng.toFixed( 6 ) ),
								  }
								: p
						),
					};
				} );
				setAttributes( { lines: updatedLines } );
				return;
			}

			// A click on the map while draw mode is active — add the point.
			if ( msg.type === 'bflm_draw_point' ) {
				const li = msg.lineIndex;
				const currentLines = attributesRef.current.lines || [];
				const line = currentLines[ li ];
				if ( ! line ) return;
				setAttributes( {
					lines: currentLines.map( ( l, i ) =>
						i !== li
							? l
							: {
									...l,
									points: [
										...( l.points || [] ),
										{
											lat: parseFloat(
												msg.lat.toFixed( 6 )
											),
											lng: parseFloat(
												msg.lng.toFixed( 6 )
											),
										},
									],
							  }
					),
				} );
				return;
			}

			// Double-click on the map requested draw mode end.
			if ( msg.type === 'bflm_draw_end_request' ) {
				if ( drawingLineIndexRef.current === msg.lineIndex ) {
					// stopDraw() already ran in the iframe (dblclick handler);
					// shape is kept on map, pins removed. No iframe reload needed.
					drawingLineIndexRef.current = null;
					setDrawingLineIndex( null );
				}
				return;
			}

			// Iframe finished initialising (or re-initialising after a rebuild).
			// Re-send bflm_draw_start / bflm_draw_circle_start if still in draw mode.
			if ( msg.type === 'bflm_iframe_ready' ) {
				const iframe = iframeRef.current;
				if ( ! iframe || ! iframe.contentWindow ) return;
				const activeLineIdx = drawingLineIndexRef.current;
				if ( activeLineIdx !== null ) {
					const currentLines = attributesRef.current.lines || [];
					const activeLine = currentLines[ activeLineIdx ];
					if ( activeLine ) {
						iframe.contentWindow.postMessage(
							{
								type: 'bflm_draw_start',
								blockId: clientIdRef.current,
								lineIndex: activeLineIdx,
								lineType: activeLine.type || 'line',
								existingPoints: activeLine.points || [],
								color: activeLine.color || '#3388ff',
								fillColor: activeLine.fillColor || '#3388ff',
								fillOpacity: activeLine.fillOpacity ?? 0.2,
							},
							'*'
						);
					}
				}
				const activeCircleIdx = drawingCircleIndexRef.current;
				if ( activeCircleIdx !== null ) {
					const currentCircles = attributesRef.current.circles || [];
					const activeCircle = currentCircles[ activeCircleIdx ];
					if ( activeCircle ) {
						iframe.contentWindow.postMessage(
							{
								type: 'bflm_draw_circle_start',
								blockId: clientIdRef.current,
								circleIndex: activeCircleIdx,
								lat: activeCircle.lat,
								lng: activeCircle.lng,
								radius: activeCircle.radius ?? 1000,
								color: activeCircle.color || '#3388ff',
								fillColor: activeCircle.fillColor || '#3388ff',
								fillOpacity: activeCircle.fillOpacity ?? 0.2,
							},
							'*'
						);
					}
				}
				return;
			}

			// Circle draw: editor receives center from iframe (phase 'center' done).
			if ( msg.type === 'bflm_draw_circle_center' ) {
				const ci = msg.circleIndex;
				const currentCircles = attributesRef.current.circles || [];
				if ( ! currentCircles[ ci ] ) return;
				isIframeUpdateRef.current = true;
				setAttributes( {
					circles: currentCircles.map( ( c, i ) =>
						i !== ci
							? c
							: {
									...c,
									lat: parseFloat( msg.lat.toFixed( 6 ) ),
									lng: parseFloat( msg.lng.toFixed( 6 ) ),
							  }
					),
				} );
				return;
			}

			// Circle draw: editor receives radius from iframe (phase 'edge' done).
			if ( msg.type === 'bflm_draw_circle_radius' ) {
				const ci = msg.circleIndex;
				const currentCircles = attributesRef.current.circles || [];
				if ( ! currentCircles[ ci ] ) return;
				isIframeUpdateRef.current = true;
				setAttributes( {
					circles: currentCircles.map( ( c, i ) =>
						i !== ci
							? c
							: { ...c, radius: Math.round( msg.radius ) }
					),
				} );
				return;
			}

			// Circle draw complete (2nd click in iframe) — no iframe.src reload.
			if ( msg.type === 'bflm_draw_circle_end_request' ) {
				if ( drawingCircleIndexRef.current === msg.circleIndex ) {
					drawingCircleIndexRef.current = null;
					setDrawingCircleIndex( null );
				}
				return;
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
			lat: newLat,
			lng: newLng,
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

		const { candidates, error } = await bflmGeocodeAddress( addressInput );

		if ( error ) {
			setGeocodeStatus( 'error' );
			setGeocodeError( error );
			return;
		}

		if ( candidates.length === 1 ) {
			applyCandidate( candidates[ 0 ] );
		} else {
			setCandidates( candidates );
			setGeocodeStatus( 'candidates' );
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
					lat: parseFloat( lat.toFixed( 6 ) ),
					lng: parseFloat( lng.toFixed( 6 ) ),
					title: '',
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
	 * Remove a marker by index. Also cleans up markerSearch state:
	 * drops the deleted index and decrements keys > index so they
	 * stay aligned with the new markers array.
	 *
	 * @param {number} index Marker index.
	 */
	function handleRemoveMarker( index ) {
		setAttributes( {
			markers: markers.filter( ( _, i ) => i !== index ),
		} );
		/** Shift keyed-by-index state: drop deleted entry, decrement keys above it. */
		function shiftDown( prev ) {
			const next = {};
			for ( const [ k, v ] of Object.entries( prev ) ) {
				const n = Number( k );
				if ( n === index ) continue;
				next[ n > index ? n - 1 : n ] = v;
			}
			return next;
		}
		setMarkerSearch( shiftDown );
		setConflictNotices( shiftDown );
	}

	/**
	 * Update one field of the markerSearch entry for a given marker index.
	 *
	 * @param {number} index   Marker index.
	 * @param {Object} updates Partial state to merge.
	 */
	function updateMarkerSearch( index, updates ) {
		setMarkerSearch( ( prev ) => ( {
			...prev,
			[ index ]: {
				input: '',
				status: 'idle',
				candidates: [],
				error: '',
				...prev[ index ],
				...updates,
			},
		} ) );
	}

	/**
	 * Apply a geocode candidate to a specific marker: update its lat/lng and
	 * collapse the candidate list. The search input text is kept as-is.
	 *
	 * @param {number} index     Marker index.
	 * @param {{ lat: number, lng: number }} candidate
	 */
	function applyMarkerCandidate( index, candidate ) {
		const newLat = parseFloat( candidate.lat.toFixed( 6 ) );
		const newLng = parseFloat( candidate.lng.toFixed( 6 ) );

		handleUpdateMarker( index, { lat: newLat, lng: newLng } );
		updateMarkerSearch( index, { status: 'idle', candidates: [] } );
	}

	/**
	 * Run a Nominatim geocode search for the address currently in a marker's
	 * search input. On a single result, applies it immediately. On multiple
	 * results, shows the candidate list. On failure, shows an error message.
	 *
	 * @param {number} index Marker index.
	 */
	async function handleMarkerGeocode( index ) {
		const entry = markerSearch[ index ] || {};
		const query = ( entry.input || '' ).trim();

		if ( ! query ) {
			return;
		}

		updateMarkerSearch( index, {
			status: 'loading',
			candidates: [],
			error: '',
		} );

		const { candidates, error } = await bflmGeocodeAddress( query );

		if ( error ) {
			updateMarkerSearch( index, { status: 'error', error } );
			return;
		}

		if ( candidates.length === 1 ) {
			applyMarkerCandidate( index, candidates[ 0 ] );
		} else {
			updateMarkerSearch( index, { status: 'candidates', candidates } );
		}
	}

	// ── Line / polygon attribute helpers ─────────────────────────────────────

	/**
	 * Append a new empty line or polygon shape.
	 * @param {'line'|'polygon'} type
	 */
	function handleAddLine( type = 'line' ) {
		const newIndex = ( lines || [] ).length;
		setAttributes( {
			lines: [
				...( lines || [] ),
				{
					type,
					points: [],
					fitbounds: false,
					color: '',
					weight: null,
					opacity: null,
					dashArray: '',
					classname: '',
					fill: false,
					fillColor: '',
					fillOpacity: null,
					popup: '',
					visible: false,
				},
			],
		} );
		// Collapse all previous panels, open the new one.
		setExpandedLineIndex( newIndex );
		// Stop any active draw mode for a previous line.
		if ( drawingLineIndexRef.current !== null ) {
			handleStopDrawing();
		}
	}

	/**
	 * Remove a line by index and clean up linePointSearch state.
	 * @param {number} index
	 */
	function handleRemoveLine( index ) {
		if ( drawingLineIndexRef.current === index ) {
			handleStopDrawing();
		}
		setAttributes( {
			lines: ( lines || [] ).filter( ( _, i ) => i !== index ),
		} );
		setLinePointSearch( ( prev ) => {
			const next = {};
			for ( const [ k, v ] of Object.entries( prev ) ) {
				const [ li, pi ] = k.split( '_' ).map( Number );
				if ( li === index ) continue;
				next[ `${ li > index ? li - 1 : li }_${ pi }` ] = v;
			}
			return next;
		} );
		setExpandedLineIndex( ( prev ) => {
			if ( prev === null ) return null;
			if ( prev === index ) return null;
			return prev > index ? prev - 1 : prev;
		} );
	}

	/**
	 * Merge an update object into a single line by index.
	 * @param {number} index
	 * @param {Object} updates
	 */
	function handleUpdateLine( index, updates ) {
		setAttributes( {
			lines: ( lines || [] ).map( ( l, i ) =>
				i === index ? { ...l, ...updates } : l
			),
		} );
	}

	/**
	 * Append a new point to a line, seeded with the current map lat/lng.
	 * @param {number} lineIndex
	 */
	function handleAddPoint( lineIndex ) {
		const line = ( lines || [] )[ lineIndex ];
		if ( ! line ) return;
		handleUpdateLine( lineIndex, {
			points: [
				...( line.points || [] ),
				{
					lat: parseFloat( lat.toFixed( 6 ) ),
					lng: parseFloat( lng.toFixed( 6 ) ),
				},
			],
		} );
	}

	/**
	 * Remove a point from a line and shift linePointSearch keys accordingly.
	 * @param {number} lineIndex
	 * @param {number} pointIndex
	 */
	function handleRemovePoint( lineIndex, pointIndex ) {
		const line = ( lines || [] )[ lineIndex ];
		if ( ! line ) return;
		handleUpdateLine( lineIndex, {
			points: ( line.points || [] ).filter(
				( _, i ) => i !== pointIndex
			),
		} );
		setLinePointSearch( ( prev ) => {
			const next = {};
			for ( const [ k, v ] of Object.entries( prev ) ) {
				const [ li, pi ] = k.split( '_' ).map( Number );
				if ( li !== lineIndex ) {
					next[ k ] = v;
					continue;
				}
				if ( pi === pointIndex ) continue;
				next[ `${ li }_${ pi > pointIndex ? pi - 1 : pi }` ] = v;
			}
			return next;
		} );
	}

	/**
	 * Merge updates into a single point.
	 * @param {number} lineIndex
	 * @param {number} pointIndex
	 * @param {Object} updates
	 */
	function handleUpdatePoint( lineIndex, pointIndex, updates ) {
		const line = ( lines || [] )[ lineIndex ];
		if ( ! line ) return;
		handleUpdateLine( lineIndex, {
			points: ( line.points || [] ).map( ( p, i ) =>
				i === pointIndex ? { ...p, ...updates } : p
			),
		} );
	}

	/**
	 * Merge updates into the linePointSearch entry for a given line/point.
	 * @param {number} lineIndex
	 * @param {number} pointIndex
	 * @param {Object} updates
	 */
	function updateLinePointSearch( lineIndex, pointIndex, updates ) {
		const key = `${ lineIndex }_${ pointIndex }`;
		setLinePointSearch( ( prev ) => ( {
			...prev,
			[ key ]: {
				input: '',
				status: 'idle',
				candidates: [],
				error: '',
				...prev[ key ],
				...updates,
			},
		} ) );
	}

	/**
	 * Pan the preview iframe to show a specific lat/lng without rebuilding it.
	 * @param {number} pointLat
	 * @param {number} pointLng
	 */
	function handleLocatePoint( pointLat, pointLng ) {
		const iframe = iframeRef.current;
		if ( ! iframe || ! iframe.contentWindow ) return;
		iframe.contentWindow.postMessage(
			{
				type: 'bflm_set_view',
				blockId: clientId,
				lat: pointLat,
				lng: pointLng,
				zoom: attributes.zoom,
			},
			'*'
		);
	}

	/**
	 * Enter draw mode for a specific line.
	 * Sends bflm_draw_start to the iframe so it activates click-to-draw.
	 * @param {number} lineIndex
	 */
	function handleStartDrawing( lineIndex ) {
		// Mutual exclusion: stop circle draw if active.
		if ( drawingCircleIndexRef.current !== null ) {
			handleStopDrawingCircle();
		}
		setDrawingLineIndex( lineIndex );
		drawingLineIndexRef.current = lineIndex;
		const iframe = iframeRef.current;
		if ( ! iframe || ! iframe.contentWindow ) return;
		const line = ( attributesRef.current.lines || [] )[ lineIndex ];
		if ( ! line ) return;
		iframe.contentWindow.postMessage(
			{
				type: 'bflm_draw_start',
				blockId: clientId,
				lineIndex,
				lineType: line.type || 'line',
				existingPoints: line.points || [],
				color: line.color || '#3388ff',
				fillColor: line.fillColor || '#3388ff',
				fillOpacity: line.fillOpacity ?? 0.2,
			},
			'*'
		);
	}

	/**
	 * Exit draw mode. Sends bflm_draw_end to the iframe to remove draw pins
	 * only — the shape (polyline/polygon) stays on the map without any reload.
	 * The debounced structural effect will fire a reload only when a truly
	 * renderable change happened (e.g. line reaches ≥2 points for the first
	 * time), but that is handled by previewUrlKey, not here.
	 */
	function handleStopDrawing() {
		setDrawingLineIndex( null );
		drawingLineIndexRef.current = null;
		const iframe = iframeRef.current;
		if ( ! iframe ) return;
		if ( iframe.contentWindow ) {
			iframe.contentWindow.postMessage(
				{ type: 'bflm_draw_end', blockId: clientId },
				'*'
			);
		}
	}

	/**
	 * Apply a geocode candidate to a specific line point and pan to it.
	 * @param {number} lineIndex
	 * @param {number} pointIndex
	 * @param {{ lat: number, lng: number }} candidate
	 */
	function applyLinePointCandidate( lineIndex, pointIndex, candidate ) {
		const newLat = parseFloat( candidate.lat.toFixed( 6 ) );
		const newLng = parseFloat( candidate.lng.toFixed( 6 ) );
		handleUpdatePoint( lineIndex, pointIndex, {
			lat: newLat,
			lng: newLng,
		} );
		updateLinePointSearch( lineIndex, pointIndex, {
			status: 'idle',
			candidates: [],
		} );
		handleLocatePoint( newLat, newLng );
	}

	/**
	 * Run a Nominatim geocode search for a specific line point.
	 * @param {number} lineIndex
	 * @param {number} pointIndex
	 */
	async function handleLinePointGeocode( lineIndex, pointIndex ) {
		const key = `${ lineIndex }_${ pointIndex }`;
		const entry = linePointSearch[ key ] || {};
		const query = ( entry.input || '' ).trim();
		if ( ! query ) return;
		updateLinePointSearch( lineIndex, pointIndex, {
			status: 'loading',
			candidates: [],
			error: '',
		} );
		const { candidates: found, error } = await bflmGeocodeAddress( query );
		if ( error ) {
			updateLinePointSearch( lineIndex, pointIndex, {
				status: 'error',
				error,
			} );
			return;
		}
		if ( found.length === 1 ) {
			applyLinePointCandidate( lineIndex, pointIndex, found[ 0 ] );
		} else {
			updateLinePointSearch( lineIndex, pointIndex, {
				status: 'candidates',
				candidates: found,
			} );
		}
	}

	// ── Circle handlers ──────────────────────────────────────────────────────

	/** Append a new circle with default values. Seeds lat/lng from current map center. */
	function handleAddCircle() {
		// Stop any active draw mode first (mutual exclusion).
		if ( drawingLineIndexRef.current !== null ) {
			handleStopDrawing();
		}
		if ( drawingCircleIndexRef.current !== null ) {
			handleStopDrawingCircle();
		}
		const newIndex = ( attributes.circles || [] ).length;
		setAttributes( {
			circles: [
				...( attributes.circles || [] ),
				{
					lat: parseFloat( lat.toFixed( 6 ) ),
					lng: parseFloat( lng.toFixed( 6 ) ),
					radius: 1000,
					fitbounds: false,
					color: '',
					weight: null,
					opacity: null,
					dashArray: '',
					classname: '',
					fill: false,
					fillColor: '',
					fillOpacity: null,
					popup: '',
					visible: false,
				},
			],
		} );
		setExpandedCircleIndex( newIndex );
	}

	/**
	 * Remove a circle by index and clean up state.
	 * @param {number} index
	 */
	function handleRemoveCircle( index ) {
		if ( drawingCircleIndexRef.current === index ) {
			handleStopDrawingCircle();
		}
		setAttributes( {
			circles: ( attributes.circles || [] ).filter( ( _, i ) => i !== index ),
		} );
		setCircleSearch( ( prev ) => {
			const next = {};
			for ( const [ k, v ] of Object.entries( prev ) ) {
				const ki = Number( k );
				if ( ki === index ) continue;
				next[ String( ki > index ? ki - 1 : ki ) ] = v;
			}
			return next;
		} );
		setCircleRadiusUnit( ( prev ) => {
			const next = {};
			for ( const [ k, v ] of Object.entries( prev ) ) {
				const ki = Number( k );
				if ( ki === index ) continue;
				next[ String( ki > index ? ki - 1 : ki ) ] = v;
			}
			return next;
		} );
		setExpandedCircleIndex( ( prev ) => {
			if ( prev === null ) return null;
			if ( prev === index ) return null;
			return prev > index ? prev - 1 : prev;
		} );
		setDrawingCircleIndex( ( prev ) => {
			if ( prev === null ) return null;
			if ( prev === index ) return null;
			return prev > index ? prev - 1 : prev;
		} );
	}

	/**
	 * Shallow-merge updates into a single circle by index.
	 * @param {number} index
	 * @param {Object} updates
	 */
	function handleUpdateCircle( index, updates ) {
		setAttributes( {
			circles: ( attributes.circles || [] ).map( ( c, i ) =>
				i === index ? { ...c, ...updates } : c
			),
		} );
	}

	/**
	 * Enter circle draw mode (2-click: center then edge).
	 * Stops any active line draw first (mutual exclusion).
	 * @param {number} circleIndex
	 */
	function handleStartDrawingCircle( circleIndex ) {
		if ( drawingLineIndexRef.current !== null ) {
			handleStopDrawing();
		}
		setDrawingCircleIndex( circleIndex );
		drawingCircleIndexRef.current = circleIndex;
		const iframe = iframeRef.current;
		if ( ! iframe || ! iframe.contentWindow ) return;
		const circle = ( attributesRef.current.circles || [] )[ circleIndex ];
		if ( ! circle ) return;
		iframe.contentWindow.postMessage(
			{
				type: 'bflm_draw_circle_start',
				blockId: clientId,
				circleIndex,
				lat: circle.lat,
				lng: circle.lng,
				radius: circle.radius ?? 1000,
				color: circle.color || '#3388ff',
				fillColor: circle.fillColor || '#3388ff',
				fillOpacity: circle.fillOpacity ?? 0.2,
			},
			'*'
		);
	}

	/**
	 * Exit circle draw mode. Sends bflm_draw_circle_end — iframe removes the
	 * preview center pin but keeps the L.circle shape on the map (no reload).
	 */
	function handleStopDrawingCircle() {
		setDrawingCircleIndex( null );
		drawingCircleIndexRef.current = null;
		const iframe = iframeRef.current;
		if ( ! iframe ) return;
		if ( iframe.contentWindow ) {
			iframe.contentWindow.postMessage(
				{ type: 'bflm_draw_circle_end', blockId: clientId },
				'*'
			);
		}
	}

	/**
	 * Update circleSearch state for a given circle index.
	 * @param {number} index
	 * @param {Object} updates
	 */
	function updateCircleSearch( index, updates ) {
		const key = String( index );
		setCircleSearch( ( prev ) => ( {
			...prev,
			[ key ]: {
				input: '',
				status: 'idle',
				candidates: [],
				error: '',
				...prev[ key ],
				...updates,
			},
		} ) );
	}

	/**
	 * Apply a geocode candidate to a specific circle (sets lat/lng, pans map).
	 * @param {number} index
	 * @param {{ lat: number, lng: number }} candidate
	 */
	function applyCircleCandidate( index, candidate ) {
		const newLat = parseFloat( candidate.lat.toFixed( 6 ) );
		const newLng = parseFloat( candidate.lng.toFixed( 6 ) );
		handleUpdateCircle( index, { lat: newLat, lng: newLng } );
		updateCircleSearch( index, { status: 'idle', candidates: [] } );
		handleLocatePoint( newLat, newLng );
	}

	/**
	 * Run a Nominatim geocode search for a circle center.
	 * @param {number} index
	 */
	async function handleCircleGeocode( index ) {
		const key = String( index );
		const entry = circleSearch[ key ] || {};
		const query = ( entry.input || '' ).trim();
		if ( ! query ) return;
		updateCircleSearch( index, {
			status: 'loading',
			candidates: [],
			error: '',
		} );
		const { candidates: found, error } = await bflmGeocodeAddress( query );
		if ( error ) {
			updateCircleSearch( index, { status: 'error', error } );
			return;
		}
		if ( found.length === 1 ) {
			applyCircleCandidate( index, found[ 0 ] );
		} else {
			updateCircleSearch( index, { status: 'candidates', candidates: found } );
		}
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
						label={ __(
							'View shortcode',
							'blocks-for-leaflet-map'
						) }
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
									: __( 'Copy', 'blocks-for-leaflet-map' ) }
							</button>
						</div>
						<pre className="bflm-shortcode-popover__code">
							{ shortcode }
						</pre>
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
							{
								label: __(
									'Coordinates',
									'blocks-for-leaflet-map'
								),
								value: 'coordinates',
							},
							{
								label: __(
									'Address',
									'blocks-for-leaflet-map'
								),
								value: 'address',
							},
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
								label={ __(
									'Latitude',
									'blocks-for-leaflet-map'
								) }
								value={ lat }
								onChange={ ( value ) =>
									setAttributes( {
										lat: parseFloat( value ) || 0,
									} )
								}
								step={ 0.0001 }
								__next40pxDefaultSize
							/>
							<NumberControl
								label={ __(
									'Longitude',
									'blocks-for-leaflet-map'
								) }
								value={ lng }
								onChange={ ( value ) =>
									setAttributes( {
										lng: parseFloat( value ) || 0,
									} )
								}
								step={ 0.0001 }
								__next40pxDefaultSize
							/>
						</>
					) }

					{ locationMode === 'address' && (
						<>
							<TextControl
								label={ __(
									'Address',
									'blocks-for-leaflet-map'
								) }
								value={ addressInput }
								placeholder={ __(
									'Enter an address…',
									'blocks-for-leaflet-map'
								) }
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
								disabled={
									geocodeStatus === 'loading' ||
									! addressInput.trim()
								}
								style={ {
									width: '100%',
									justifyContent: 'center',
									marginTop: '8px',
								} }
							>
								{ __( 'Search', 'blocks-for-leaflet-map' ) }
							</Button>

							{ geocodeStatus === 'loading' && (
								<div
									style={ {
										display: 'flex',
										justifyContent: 'center',
										marginTop: '8px',
									} }
								>
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

							{ geocodeStatus === 'candidates' &&
								candidates.length > 0 && (
									<div style={ { marginTop: '8px' } }>
										<p
											style={ {
												margin: '0 0 4px',
												fontWeight: 600,
												fontSize: '11px',
												textTransform: 'uppercase',
												color: '#1e1e1e',
											} }
										>
											{ __(
												'Select a location:',
												'blocks-for-leaflet-map'
											) }
										</p>
										{ candidates.map(
											( candidate, index ) => (
												<Button
													key={ index }
													variant="tertiary"
													onClick={ () =>
														applyCandidate(
															candidate
														)
													}
													style={ {
														display: 'block',
														width: '100%',
														textAlign: 'left',
														marginBottom: '4px',
														whiteSpace: 'normal',
														height: 'auto',
														padding: '6px 8px',
														wordBreak: 'break-word',
													} }
												>
													{ candidate.display_name }
												</Button>
											)
										) }
									</div>
								) }
						</>
					) }

					<RangeControl
						label={ __( 'Zoom Level', 'blocks-for-leaflet-map' ) }
						value={ zoom }
						onChange={ ( value ) =>
							setAttributes( { zoom: value } )
						}
						min={ 1 }
						max={ 20 }
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<ToggleControl
						label={ __(
							'Fit to Markers',
							'blocks-for-leaflet-map'
						) }
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
						label={ __(
							'Keyboard Navigation',
							'blocks-for-leaflet-map'
						) }
						value={ keyboard }
						options={ THREE_STATE_OPTIONS }
						onChange={ ( value ) =>
							setAttributes( { keyboard: value } )
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<SelectControl
						label={ __(
							'Double Click Zoom',
							'blocks-for-leaflet-map'
						) }
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
						help={ __(
							'Shift + drag to zoom to area.',
							'blocks-for-leaflet-map'
						) }
						value={ boxZoom }
						options={ THREE_STATE_OPTIONS }
						onChange={ ( value ) =>
							setAttributes( { boxZoom: value } )
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<SelectControl
						label={ __(
							'Close Popup on Click',
							'blocks-for-leaflet-map'
						) }
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
						help={ __(
							'Mobile tap interaction.',
							'blocks-for-leaflet-map'
						) }
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
						help={ __(
							'Pan inertia after dragging.',
							'blocks-for-leaflet-map'
						) }
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
					<p>
						{ __(
							'Override the global Leaflet Map tile settings for this specific map.',
							'blocks-for-leaflet-map'
						) }
					</p>
					<TextControl
						label={ __( 'Tile URL', 'blocks-for-leaflet-map' ) }
						placeholder="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
						help={
							<>
								{ __(
									'Browse providers: ',
									'blocks-for-leaflet-map'
								) }
								<a
									href="https://alexurquhart.github.io/free-tiles/"
									target="_blank"
									rel="noopener noreferrer"
									aria-label={ sprintf(
										__(
											'%s (opens in new tab)',
											'blocks-for-leaflet-map'
										),
										__(
											'Free Tile Services',
											'blocks-for-leaflet-map'
										)
									) }
								>
									{ __(
										'Free Tile Services',
										'blocks-for-leaflet-map'
									) }
									↗
								</a>
								{ ' · ' }
								<a
									href="https://leaflet-extras.github.io/leaflet-providers/preview/"
									target="_blank"
									rel="noopener noreferrer"
									aria-label={ sprintf(
										__(
											'%s (opens in new tab)',
											'blocks-for-leaflet-map'
										),
										__(
											'Leaflet Providers Preview',
											'blocks-for-leaflet-map'
										)
									) }
								>
									{ __(
										'Leaflet Providers Preview',
										'blocks-for-leaflet-map'
									) }
									↗
								</a>
								{ ' · ' }
								<a
									href="https://wiki.openstreetmap.org/wiki/Raster_tile_providers"
									target="_blank"
									rel="noopener noreferrer"
									aria-label={ sprintf(
										__(
											'%s (opens in new tab)',
											'blocks-for-leaflet-map'
										),
										__(
											'OSM Wiki',
											'blocks-for-leaflet-map'
										)
									) }
								>
									{ __(
										'OSM Wiki',
										'blocks-for-leaflet-map'
									) }
									↗
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
						help={ __(
							"Default: 256. Most providers (OpenStreetMap, ArcGIS, CartoDB) use 256 — leave empty unless your provider's documentation explicitly requires a different value (e.g., Mapbox: 512). Changing this incorrectly will distort the map.",
							'blocks-for-leaflet-map'
						) }
						value={ localTilesize }
						min={ 64 }
						onChange={ ( value ) =>
							setLocalTilesize( value ?? '' )
						}
						onBlur={ () =>
							setAttributes( { tilesize: localTilesize } )
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<TextControl
						label={ __( 'Subdomains', 'blocks-for-leaflet-map' ) }
						help={ __(
							'Comma-separated list (e.g., a,b,c) matching the {s} placeholder in the Tile URL. Leave empty if not used.',
							'blocks-for-leaflet-map'
						) }
						value={ subdomains }
						onChange={ ( value ) =>
							setAttributes( { subdomains: value } )
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<TextControl
						label={ __( 'Map ID', 'blocks-for-leaflet-map' ) }
						help={ __(
							'Required only for Mapbox tiles. Leave empty for other providers.',
							'blocks-for-leaflet-map'
						) }
						value={ mapid }
						onChange={ ( value ) =>
							setAttributes( { mapid: value } )
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<TextControl
						label={ __( 'Access Token', 'blocks-for-leaflet-map' ) }
						help={ __(
							"Required only for providers that need authentication (e.g., Mapbox, Stadia, Thunderforest). This token will be visible in the page's HTML source — restrict it to your domain in the provider's dashboard.",
							'blocks-for-leaflet-map'
						) }
						value={ accesstoken }
						onChange={ ( value ) =>
							setAttributes( { accesstoken: value } )
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<NumberControl
						label={ __( 'Zoom Offset', 'blocks-for-leaflet-map' ) }
						help={ __(
							'Default: 0. Only change for specific providers (Mapbox typically requires -1 when Tile Size is 512).',
							'blocks-for-leaflet-map'
						) }
						value={ localZoomoffset }
						onChange={ ( value ) =>
							setLocalZoomoffset( value ?? '' )
						}
						onBlur={ () =>
							setAttributes( { zoomoffset: localZoomoffset } )
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<SelectControl
						label={ __( 'No Wrap', 'blocks-for-leaflet-map' ) }
						help={ __(
							'Prevents the map from repeating horizontally when scrolled past the edges. Default: off.',
							'blocks-for-leaflet-map'
						) }
						value={ nowrap }
						options={ THREE_STATE_OPTIONS }
						onChange={ ( value ) =>
							setAttributes( { nowrap: value } )
						}
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<SelectControl
						label={ __(
							'Detect Retina',
							'blocks-for-leaflet-map'
						) }
						help={ __(
							'Loads higher-resolution tiles on Retina/HiDPI screens. Only enable if the provider serves @2x tiles, otherwise the map will fail on those screens.',
							'blocks-for-leaflet-map'
						) }
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
						style={ {
							width: '100%',
							marginBottom: '12px',
							justifyContent: 'center',
						} }
					>
						{ __(
							'+ Add Marker at Center',
							'blocks-for-leaflet-map'
						) }
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
							{ /* ── Per-marker address search ─────────────────── */ }
							{ ( () => {
								const ms = markerSearch[ index ] || {};
								const msInput = ms.input || '';
								const msStatus = ms.status || 'idle';
								const msCandidates = ms.candidates || [];
								return (
									<>
										<TextControl
											label={ __(
												'Search by address',
												'blocks-for-leaflet-map'
											) }
											value={ msInput }
											placeholder={ __(
												'Enter an address…',
												'blocks-for-leaflet-map'
											) }
											onChange={ ( value ) => {
												updateMarkerSearch( index, {
													input: value,
													status: 'idle',
													candidates: [],
													error: '',
												} );
											} }
											onKeyDown={ ( e ) => {
												if ( e.key === 'Enter' ) {
													e.preventDefault();
													handleMarkerGeocode(
														index
													);
												}
											} }
											__next40pxDefaultSize
											__nextHasNoMarginBottom
										/>
										<Button
											variant="secondary"
											onClick={ () =>
												handleMarkerGeocode( index )
											}
											isBusy={ msStatus === 'loading' }
											disabled={
												msStatus === 'loading' ||
												! msInput.trim()
											}
											style={ {
												width: '100%',
												justifyContent: 'center',
												marginTop: '8px',
											} }
										>
											{ __(
												'Search',
												'blocks-for-leaflet-map'
											) }
										</Button>

										{ msStatus === 'loading' && (
											<div
												style={ {
													display: 'flex',
													justifyContent: 'center',
													marginTop: '8px',
												} }
											>
												<Spinner />
											</div>
										) }

										{ msStatus === 'error' && (
											<Notice
												status="error"
												isDismissible={ false }
												style={ { marginTop: '8px' } }
											>
												{ ms.error }
											</Notice>
										) }

										{ msStatus === 'candidates' &&
											msCandidates.length > 0 && (
												<div
													style={ {
														marginTop: '8px',
													} }
												>
													<p
														style={ {
															margin: '0 0 4px',
															fontWeight: 600,
															fontSize: '11px',
															textTransform:
																'uppercase',
															color: '#1e1e1e',
														} }
													>
														{ __(
															'Select a location:',
															'blocks-for-leaflet-map'
														) }
													</p>
													{ msCandidates.map(
														( candidate, ci ) => (
															<Button
																key={ ci }
																variant="tertiary"
																onClick={ () =>
																	applyMarkerCandidate(
																		index,
																		candidate
																	)
																}
																style={ {
																	display:
																		'block',
																	width: '100%',
																	textAlign:
																		'left',
																	marginBottom:
																		'4px',
																	whiteSpace:
																		'normal',
																	height: 'auto',
																	padding:
																		'6px 8px',
																	wordBreak:
																		'break-word',
																} }
															>
																{
																	candidate.display_name
																}
															</Button>
														)
													) }
												</div>
											) }
									</>
								);
							} )() }

							<NumberControl
								label={ __(
									'Latitude',
									'blocks-for-leaflet-map'
								) }
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
								label={ __(
									'Longitude',
									'blocks-for-leaflet-map'
								) }
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
								label={ __(
									'Title',
									'blocks-for-leaflet-map'
								) }
								help={ __(
									"Browser tooltip shown on hover. Also used as the marker's accessible name.",
									'blocks-for-leaflet-map'
								) }
								value={ marker.title || '' }
								onChange={ ( value ) =>
									handleUpdateMarker( index, {
										title: value,
									} )
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
									handleUpdateMarker( index, {
										content: value,
									} )
								}
								rows={ 3 }
							/>
							{ /* Advanced marker options — collapsed by default to keep the
							     common case (lat/lng + title + popup) compact. */ }
							<PanelBody
								title={ __(
									'Advanced',
									'blocks-for-leaflet-map'
								) }
								initialOpen={ false }
							>
								<TextControl
									label={ __(
										'Alt Text',
										'blocks-for-leaflet-map'
									) }
									help={ __(
										'Alternative text for the marker image. Improves accessibility for screen reader users.',
										'blocks-for-leaflet-map'
									) }
									value={ marker.alt || '' }
									onChange={ ( value ) =>
										handleUpdateMarker( index, {
											alt: value,
										} )
									}
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>
								<ToggleControl
									label={ __(
										'Auto-open Popup',
										'blocks-for-leaflet-map'
									) }
									help={ __(
										'Open the popup automatically when the page loads.',
										'blocks-for-leaflet-map'
									) }
									checked={ marker.visible || false }
									onChange={ ( value ) =>
										handleUpdateMarker( index, {
											visible: value,
										} )
									}
									__nextHasNoMarginBottom
								/>
								<ToggleControl
									label={ __(
										'Draggable',
										'blocks-for-leaflet-map'
									) }
									help={ __(
										'Allow visitors to drag the marker. The new position is logged to the browser console.',
										'blocks-for-leaflet-map'
									) }
									checked={ marker.draggable || false }
									onChange={ ( value ) =>
										handleUpdateMarker( index, {
											draggable: value,
										} )
									}
									__nextHasNoMarginBottom
								/>
								<RangeControl
									label={ __(
										'Opacity',
										'blocks-for-leaflet-map'
									) }
									help={ __(
										'Marker icon opacity. Default: 1 (fully opaque).',
										'blocks-for-leaflet-map'
									) }
									value={
										marker.opacity != null
											? marker.opacity
											: 1
									}
									onChange={ ( value ) =>
										handleUpdateMarker( index, {
											opacity: value,
										} )
									}
									min={ 0 }
									max={ 1 }
									step={ 0.05 }
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>
								<NumberControl
									label={ __(
										'Z-Index Offset',
										'blocks-for-leaflet-map'
									) }
									help={ __(
										'Raise or lower this marker relative to others. Leaflet already offsets markers by latitude, so you may need values of 10+ (or higher when markers are close together) to visibly change the stacking order.',
										'blocks-for-leaflet-map'
									) }
									value={ marker.zIndexOffset ?? 0 }
									onChange={ ( value ) => {
										const val = parseInt( value, 10 );
										handleUpdateMarker( index, {
											zIndexOffset: isNaN( val )
												? 0
												: val,
										} );
									} }
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>
							</PanelBody>
							{ /* Custom Icon options — collapsed by default. */ }
							<PanelBody
								title={ __(
									'Custom Icon',
									'blocks-for-leaflet-map'
								) }
								initialOpen={ false }
							>
								<ToggleControl
									label={ __(
										'Use custom icon',
										'blocks-for-leaflet-map'
									) }
									checked={ marker.useCustomIcon || false }
									onChange={ ( value ) => {
										const updates = {
											useCustomIcon: value,
										};
										if ( value && marker.useSvgMarker ) {
											updates.useSvgMarker = false;
											setConflictNotices( ( prev ) => ( {
												...prev,
												[ index ]: 'svgDisabled',
											} ) );
										} else if ( ! value ) {
											setConflictNotices( ( prev ) => ( {
												...prev,
												[ index ]: null,
											} ) );
										}
										handleUpdateMarker( index, updates );
									} }
									__nextHasNoMarginBottom
								/>
								{ marker.useCustomIcon &&
									conflictNotices[ index ] ===
										'svgDisabled' && (
										<Notice
											status="info"
											isDismissible={ false }
										>
											{ __(
												'SVG marker mode was automatically disabled — SVG and custom-image markers cannot be combined. Your SVG settings have been preserved and will resume when you disable custom icon mode.',
												'blocks-for-leaflet-map'
											) }
										</Notice>
									) }
								{ marker.useCustomIcon && (
									<>
										{ /* Icon URL */ }
										<p
											style={ {
												margin: '12px 0 4px',
												fontWeight: 600,
												fontSize: '11px',
												textTransform: 'uppercase',
												color: '#1e1e1e',
											} }
										>
											{ __(
												'Icon',
												'blocks-for-leaflet-map'
											) }
										</p>
										<MediaUploadCheck>
											<MediaUpload
												onSelect={ ( media ) => {
													const updates = {
														iconUrl: media.url,
													};
													if (
														media.width &&
														media.height
													) {
														updates.iconWidth =
															media.width;
														updates.iconHeight =
															media.height;
														updates.iconAnchorX =
															Math.round(
																media.width / 2
															);
														updates.iconAnchorY =
															media.height;
														updates.popupAnchorX = 0;
														updates.popupAnchorY =
															-media.height;
														updates.iconOriginalWidth =
															media.width;
														updates.iconOriginalHeight =
															media.height;
													}
													handleUpdateMarker(
														index,
														updates
													);
												} }
												allowedTypes={ [ 'image' ] }
												render={ ( { open } ) => (
													<>
														<Button
															variant="secondary"
															onClick={ open }
															style={ {
																width: '100%',
																justifyContent:
																	'center',
															} }
														>
															{ marker.iconUrl
																? __(
																		'Replace image',
																		'blocks-for-leaflet-map'
																  )
																: __(
																		'Select image',
																		'blocks-for-leaflet-map'
																  ) }
														</Button>
														{ marker.iconUrl && (
															<>
																<p
																	style={ {
																		fontSize:
																			'11px',
																		wordBreak:
																			'break-all',
																		margin: '4px 0',
																	} }
																>
																	{
																		marker.iconUrl
																	}
																</p>
																<Button
																	variant="link"
																	isDestructive
																	onClick={ () =>
																		handleUpdateMarker(
																			index,
																			{
																				iconUrl:
																					'',
																			}
																		)
																	}
																>
																	{ __(
																		'Remove',
																		'blocks-for-leaflet-map'
																	) }
																</Button>
															</>
														) }
													</>
												) }
											/>
										</MediaUploadCheck>
										{ /* Icon Size */ }
										<p
											style={ {
												margin: '12px 0 4px',
												fontSize: '11px',
												fontWeight: 600,
												textTransform: 'uppercase',
												color: '#1e1e1e',
											} }
										>
											{ __(
												'Icon Size (px)',
												'blocks-for-leaflet-map'
											) }
										</p>
										<div
											style={ {
												display: 'flex',
												gap: '8px',
											} }
										>
											<NumberControl
												label={ __(
													'Width',
													'blocks-for-leaflet-map'
												) }
												value={ marker.iconWidth ?? '' }
												min={ 1 }
												onChange={ ( value ) => {
													const val = parseInt(
														value,
														10
													);
													if (
														isNaN( val ) ||
														val < 1
													) {
														handleUpdateMarker(
															index,
															{
																iconWidth:
																	isNaN( val )
																		? null
																		: val,
															}
														);
														return;
													}
													if (
														marker.lockIconAspectRatio !==
															false &&
														marker.iconHeight >= 1
													) {
														const result =
															computeProportionalResize(
																{
																	axis: 'w',
																	newVal: val,
																	wKey: 'iconWidth',
																	hKey: 'iconHeight',
																	origW: marker.iconOriginalWidth,
																	origH: marker.iconOriginalHeight,
																	curW: marker.iconWidth,
																	curH: marker.iconHeight,
																	anchors: [
																		{
																			key: 'iconAnchorX',
																			val: marker.iconAnchorX,
																			axis: 'w',
																		},
																		{
																			key: 'iconAnchorY',
																			val: marker.iconAnchorY,
																			axis: 'h',
																		},
																		{
																			key: 'popupAnchorX',
																			val: marker.popupAnchorX,
																			axis: 'w',
																		},
																		{
																			key: 'popupAnchorY',
																			val: marker.popupAnchorY,
																			axis: 'h',
																		},
																	],
																}
															);
														if ( result ) {
															handleUpdateMarker(
																index,
																result
															);
															return;
														}
													}
													handleUpdateMarker( index, {
														iconWidth: val,
													} );
												} }
												style={ { flex: 1 } }
												__next40pxDefaultSize
											/>
											<NumberControl
												label={ __(
													'Height',
													'blocks-for-leaflet-map'
												) }
												value={
													marker.iconHeight ?? ''
												}
												min={ 1 }
												onChange={ ( value ) => {
													const val = parseInt(
														value,
														10
													);
													if (
														isNaN( val ) ||
														val < 1
													) {
														handleUpdateMarker(
															index,
															{
																iconHeight:
																	isNaN( val )
																		? null
																		: val,
															}
														);
														return;
													}
													if (
														marker.lockIconAspectRatio !==
															false &&
														marker.iconWidth >= 1
													) {
														const result =
															computeProportionalResize(
																{
																	axis: 'h',
																	newVal: val,
																	wKey: 'iconWidth',
																	hKey: 'iconHeight',
																	origW: marker.iconOriginalWidth,
																	origH: marker.iconOriginalHeight,
																	curW: marker.iconWidth,
																	curH: marker.iconHeight,
																	anchors: [
																		{
																			key: 'iconAnchorX',
																			val: marker.iconAnchorX,
																			axis: 'w',
																		},
																		{
																			key: 'iconAnchorY',
																			val: marker.iconAnchorY,
																			axis: 'h',
																		},
																		{
																			key: 'popupAnchorX',
																			val: marker.popupAnchorX,
																			axis: 'w',
																		},
																		{
																			key: 'popupAnchorY',
																			val: marker.popupAnchorY,
																			axis: 'h',
																		},
																	],
																}
															);
														if ( result ) {
															handleUpdateMarker(
																index,
																result
															);
															return;
														}
													}
													handleUpdateMarker( index, {
														iconHeight: val,
													} );
												} }
												style={ { flex: 1 } }
												__next40pxDefaultSize
											/>
										</div>
										{ /* Icon aspect-ratio lock */ }
										<ToggleControl
											label={ __(
												'Lock aspect ratio',
												'blocks-for-leaflet-map'
											) }
											checked={
												marker.lockIconAspectRatio !==
												false
											}
											onChange={ ( value ) =>
												handleUpdateMarker( index, {
													lockIconAspectRatio: value,
												} )
											}
											style={ { marginTop: '8px' } }
											__nextHasNoMarginBottom
										/>
										{ /* Icon Anchor */ }
										{ ( () => {
											const iconDimValid =
												marker.iconWidth >= 1 &&
												isFinite( marker.iconWidth ) &&
												marker.iconHeight >= 1 &&
												isFinite( marker.iconHeight );
											return (
												<SelectControl
													label={ __(
														'Anchor position',
														'blocks-for-leaflet-map'
													) }
													value={
														iconDimValid
															? getAnchorPreset(
																	marker.iconAnchorX,
																	marker.iconAnchorY,
																	marker.iconWidth,
																	marker.iconHeight
															  )
															: ''
													}
													disabled={ ! iconDimValid }
													help={
														iconDimValid
															? __(
																	'Quick-set common anchor positions',
																	'blocks-for-leaflet-map'
															  )
															: __(
																	'Set icon size first',
																	'blocks-for-leaflet-map'
															  )
													}
													options={ [
														{
															label: __(
																'— Select —',
																'blocks-for-leaflet-map'
															),
															value: '',
														},
														{
															label: __(
																'Top left',
																'blocks-for-leaflet-map'
															),
															value: 'top-left',
														},
														{
															label: __(
																'Top center',
																'blocks-for-leaflet-map'
															),
															value: 'top-center',
														},
														{
															label: __(
																'Top right',
																'blocks-for-leaflet-map'
															),
															value: 'top-right',
														},
														{
															label: __(
																'Middle left',
																'blocks-for-leaflet-map'
															),
															value: 'middle-left',
														},
														{
															label: __(
																'Middle center',
																'blocks-for-leaflet-map'
															),
															value: 'middle-center',
														},
														{
															label: __(
																'Middle right',
																'blocks-for-leaflet-map'
															),
															value: 'middle-right',
														},
														{
															label: __(
																'Bottom left',
																'blocks-for-leaflet-map'
															),
															value: 'bottom-left',
														},
														{
															label: __(
																'Bottom center',
																'blocks-for-leaflet-map'
															),
															value: 'bottom-center',
														},
														{
															label: __(
																'Bottom right',
																'blocks-for-leaflet-map'
															),
															value: 'bottom-right',
														},
														{
															label: __(
																'Custom',
																'blocks-for-leaflet-map'
															),
															value: 'custom',
															disabled: true,
														},
													] }
													onChange={ ( presetId ) => {
														const coords =
															computeAnchorFromPreset(
																presetId,
																marker.iconWidth,
																marker.iconHeight
															);
														if ( coords ) {
															handleUpdateMarker(
																index,
																{
																	iconAnchorX:
																		coords.x,
																	iconAnchorY:
																		coords.y,
																}
															);
														}
													} }
													style={ {
														marginTop: '12px',
													} }
													__next40pxDefaultSize
													__nextHasNoMarginBottom
												/>
											);
										} )() }
										<p
											style={ {
												margin: '8px 0 4px',
												fontSize: '11px',
												fontWeight: 600,
												textTransform: 'uppercase',
												color: '#1e1e1e',
											} }
										>
											{ __(
												'Icon Anchor (px)',
												'blocks-for-leaflet-map'
											) }
										</p>
										<div
											style={ {
												display: 'flex',
												gap: '8px',
											} }
										>
											<NumberControl
												label={ __(
													'X',
													'blocks-for-leaflet-map'
												) }
												value={
													marker.iconAnchorX ?? ''
												}
												onChange={ ( value ) => {
													const val = parseInt(
														value,
														10
													);
													handleUpdateMarker( index, {
														iconAnchorX: isNaN(
															val
														)
															? null
															: val,
													} );
												} }
												style={ { flex: 1 } }
												__next40pxDefaultSize
											/>
											<NumberControl
												label={ __(
													'Y',
													'blocks-for-leaflet-map'
												) }
												value={
													marker.iconAnchorY ?? ''
												}
												onChange={ ( value ) => {
													const val = parseInt(
														value,
														10
													);
													handleUpdateMarker( index, {
														iconAnchorY: isNaN(
															val
														)
															? null
															: val,
													} );
												} }
												style={ { flex: 1 } }
												__next40pxDefaultSize
											/>
										</div>
										{ /* Popup Anchor */ }
										<p
											style={ {
												margin: '12px 0 4px',
												fontSize: '11px',
												fontWeight: 600,
												textTransform: 'uppercase',
												color: '#1e1e1e',
											} }
										>
											{ __(
												'Popup Anchor (px)',
												'blocks-for-leaflet-map'
											) }
										</p>
										<div
											style={ {
												display: 'flex',
												gap: '8px',
											} }
										>
											<NumberControl
												label={ __(
													'X',
													'blocks-for-leaflet-map'
												) }
												value={
													marker.popupAnchorX ?? ''
												}
												onChange={ ( value ) => {
													const val = parseInt(
														value,
														10
													);
													handleUpdateMarker( index, {
														popupAnchorX: isNaN(
															val
														)
															? null
															: val,
													} );
												} }
												style={ { flex: 1 } }
												__next40pxDefaultSize
											/>
											<NumberControl
												label={ __(
													'Y',
													'blocks-for-leaflet-map'
												) }
												value={
													marker.popupAnchorY ?? ''
												}
												onChange={ ( value ) => {
													const val = parseInt(
														value,
														10
													);
													handleUpdateMarker( index, {
														popupAnchorY: isNaN(
															val
														)
															? null
															: val,
													} );
												} }
												style={ { flex: 1 } }
												__next40pxDefaultSize
											/>
										</div>
										{ /* Shadow toggle */ }
										<ToggleControl
											label={ __(
												'Add shadow',
												'blocks-for-leaflet-map'
											) }
											checked={
												marker.useShadow || false
											}
											onChange={ ( value ) =>
												handleUpdateMarker( index, {
													useShadow: value,
												} )
											}
											style={ { marginTop: '12px' } }
											__nextHasNoMarginBottom
										/>
										{ marker.useShadow && (
											<>
												{ /* Shadow URL */ }
												<p
													style={ {
														margin: '12px 0 4px',
														fontWeight: 600,
														fontSize: '11px',
														textTransform:
															'uppercase',
														color: '#1e1e1e',
													} }
												>
													{ __(
														'Shadow',
														'blocks-for-leaflet-map'
													) }
												</p>
												<MediaUploadCheck>
													<MediaUpload
														onSelect={ (
															media
														) => {
															const updates = {
																shadowUrl:
																	media.url,
															};
															if (
																media.width &&
																media.height
															) {
																updates.shadowWidth =
																	media.width;
																updates.shadowHeight =
																	media.height;
																updates.shadowAnchorX = 0;
																updates.shadowAnchorY =
																	media.height;
																updates.shadowOriginalWidth =
																	media.width;
																updates.shadowOriginalHeight =
																	media.height;
															}
															handleUpdateMarker(
																index,
																updates
															);
														} }
														allowedTypes={ [
															'image',
														] }
														render={ ( {
															open,
														} ) => (
															<>
																<Button
																	variant="secondary"
																	onClick={
																		open
																	}
																	style={ {
																		width: '100%',
																		justifyContent:
																			'center',
																	} }
																>
																	{ marker.shadowUrl
																		? __(
																				'Replace image',
																				'blocks-for-leaflet-map'
																		  )
																		: __(
																				'Select image',
																				'blocks-for-leaflet-map'
																		  ) }
																</Button>
																{ marker.shadowUrl && (
																	<>
																		<p
																			style={ {
																				fontSize:
																					'11px',
																				wordBreak:
																					'break-all',
																				margin: '4px 0',
																			} }
																		>
																			{
																				marker.shadowUrl
																			}
																		</p>
																		<Button
																			variant="link"
																			isDestructive
																			onClick={ () =>
																				handleUpdateMarker(
																					index,
																					{
																						shadowUrl:
																							'',
																					}
																				)
																			}
																		>
																			{ __(
																				'Remove',
																				'blocks-for-leaflet-map'
																			) }
																		</Button>
																	</>
																) }
															</>
														) }
													/>
												</MediaUploadCheck>
												{ /* Shadow Size */ }
												<p
													style={ {
														margin: '12px 0 4px',
														fontSize: '11px',
														fontWeight: 600,
														textTransform:
															'uppercase',
														color: '#1e1e1e',
													} }
												>
													{ __(
														'Shadow Size (px)',
														'blocks-for-leaflet-map'
													) }
												</p>
												<div
													style={ {
														display: 'flex',
														gap: '8px',
													} }
												>
													<NumberControl
														label={ __(
															'Width',
															'blocks-for-leaflet-map'
														) }
														value={
															marker.shadowWidth ??
															''
														}
														min={ 1 }
														onChange={ (
															value
														) => {
															const val =
																parseInt(
																	value,
																	10
																);
															if (
																isNaN( val ) ||
																val < 1
															) {
																handleUpdateMarker(
																	index,
																	{
																		shadowWidth:
																			isNaN(
																				val
																			)
																				? null
																				: val,
																	}
																);
																return;
															}
															if (
																marker.lockShadowAspectRatio !==
																	false &&
																marker.shadowHeight >=
																	1
															) {
																const result =
																	computeProportionalResize(
																		{
																			axis: 'w',
																			newVal: val,
																			wKey: 'shadowWidth',
																			hKey: 'shadowHeight',
																			origW: marker.shadowOriginalWidth,
																			origH: marker.shadowOriginalHeight,
																			curW: marker.shadowWidth,
																			curH: marker.shadowHeight,
																			anchors:
																				[
																					{
																						key: 'shadowAnchorX',
																						val: marker.shadowAnchorX,
																						axis: 'w',
																					},
																					{
																						key: 'shadowAnchorY',
																						val: marker.shadowAnchorY,
																						axis: 'h',
																					},
																				],
																		}
																	);
																if ( result ) {
																	handleUpdateMarker(
																		index,
																		result
																	);
																	return;
																}
															}
															handleUpdateMarker(
																index,
																{
																	shadowWidth:
																		val,
																}
															);
														} }
														style={ { flex: 1 } }
														__next40pxDefaultSize
													/>
													<NumberControl
														label={ __(
															'Height',
															'blocks-for-leaflet-map'
														) }
														value={
															marker.shadowHeight ??
															''
														}
														min={ 1 }
														onChange={ (
															value
														) => {
															const val =
																parseInt(
																	value,
																	10
																);
															if (
																isNaN( val ) ||
																val < 1
															) {
																handleUpdateMarker(
																	index,
																	{
																		shadowHeight:
																			isNaN(
																				val
																			)
																				? null
																				: val,
																	}
																);
																return;
															}
															if (
																marker.lockShadowAspectRatio !==
																	false &&
																marker.shadowWidth >=
																	1
															) {
																const result =
																	computeProportionalResize(
																		{
																			axis: 'h',
																			newVal: val,
																			wKey: 'shadowWidth',
																			hKey: 'shadowHeight',
																			origW: marker.shadowOriginalWidth,
																			origH: marker.shadowOriginalHeight,
																			curW: marker.shadowWidth,
																			curH: marker.shadowHeight,
																			anchors:
																				[
																					{
																						key: 'shadowAnchorX',
																						val: marker.shadowAnchorX,
																						axis: 'w',
																					},
																					{
																						key: 'shadowAnchorY',
																						val: marker.shadowAnchorY,
																						axis: 'h',
																					},
																				],
																		}
																	);
																if ( result ) {
																	handleUpdateMarker(
																		index,
																		result
																	);
																	return;
																}
															}
															handleUpdateMarker(
																index,
																{
																	shadowHeight:
																		val,
																}
															);
														} }
														style={ { flex: 1 } }
														__next40pxDefaultSize
													/>
												</div>
												{ /* Shadow aspect-ratio lock */ }
												<ToggleControl
													label={ __(
														'Lock aspect ratio',
														'blocks-for-leaflet-map'
													) }
													checked={
														marker.lockShadowAspectRatio !==
														false
													}
													onChange={ ( value ) =>
														handleUpdateMarker(
															index,
															{
																lockShadowAspectRatio:
																	value,
															}
														)
													}
													style={ {
														marginTop: '8px',
													} }
													__nextHasNoMarginBottom
												/>
												{ /* Shadow Anchor */ }
												{ ( () => {
													const shadowDimValid =
														marker.shadowWidth >=
															1 &&
														isFinite(
															marker.shadowWidth
														) &&
														marker.shadowHeight >=
															1 &&
														isFinite(
															marker.shadowHeight
														);
													return (
														<SelectControl
															label={ __(
																'Anchor position',
																'blocks-for-leaflet-map'
															) }
															value={
																shadowDimValid
																	? getAnchorPreset(
																			marker.shadowAnchorX,
																			marker.shadowAnchorY,
																			marker.shadowWidth,
																			marker.shadowHeight
																	  )
																	: ''
															}
															disabled={
																! shadowDimValid
															}
															help={
																shadowDimValid
																	? __(
																			'Quick-set common anchor positions',
																			'blocks-for-leaflet-map'
																	  )
																	: __(
																			'Set shadow size first',
																			'blocks-for-leaflet-map'
																	  )
															}
															options={ [
																{
																	label: __(
																		'— Select —',
																		'blocks-for-leaflet-map'
																	),
																	value: '',
																},
																{
																	label: __(
																		'Top left',
																		'blocks-for-leaflet-map'
																	),
																	value: 'top-left',
																},
																{
																	label: __(
																		'Top center',
																		'blocks-for-leaflet-map'
																	),
																	value: 'top-center',
																},
																{
																	label: __(
																		'Top right',
																		'blocks-for-leaflet-map'
																	),
																	value: 'top-right',
																},
																{
																	label: __(
																		'Middle left',
																		'blocks-for-leaflet-map'
																	),
																	value: 'middle-left',
																},
																{
																	label: __(
																		'Middle center',
																		'blocks-for-leaflet-map'
																	),
																	value: 'middle-center',
																},
																{
																	label: __(
																		'Middle right',
																		'blocks-for-leaflet-map'
																	),
																	value: 'middle-right',
																},
																{
																	label: __(
																		'Bottom left',
																		'blocks-for-leaflet-map'
																	),
																	value: 'bottom-left',
																},
																{
																	label: __(
																		'Bottom center',
																		'blocks-for-leaflet-map'
																	),
																	value: 'bottom-center',
																},
																{
																	label: __(
																		'Bottom right',
																		'blocks-for-leaflet-map'
																	),
																	value: 'bottom-right',
																},
																{
																	label: __(
																		'Custom',
																		'blocks-for-leaflet-map'
																	),
																	value: 'custom',
																	disabled: true,
																},
															] }
															onChange={ (
																presetId
															) => {
																const coords =
																	computeAnchorFromPreset(
																		presetId,
																		marker.shadowWidth,
																		marker.shadowHeight
																	);
																if ( coords ) {
																	handleUpdateMarker(
																		index,
																		{
																			shadowAnchorX:
																				coords.x,
																			shadowAnchorY:
																				coords.y,
																		}
																	);
																}
															} }
															style={ {
																marginTop:
																	'12px',
															} }
															__next40pxDefaultSize
															__nextHasNoMarginBottom
														/>
													);
												} )() }
												<p
													style={ {
														margin: '8px 0 4px',
														fontSize: '11px',
														fontWeight: 600,
														textTransform:
															'uppercase',
														color: '#1e1e1e',
													} }
												>
													{ __(
														'Shadow Anchor (px)',
														'blocks-for-leaflet-map'
													) }
												</p>
												<div
													style={ {
														display: 'flex',
														gap: '8px',
													} }
												>
													<NumberControl
														label={ __(
															'X',
															'blocks-for-leaflet-map'
														) }
														value={
															marker.shadowAnchorX ??
															''
														}
														onChange={ (
															value
														) => {
															const val =
																parseInt(
																	value,
																	10
																);
															handleUpdateMarker(
																index,
																{
																	shadowAnchorX:
																		isNaN(
																			val
																		)
																			? null
																			: val,
																}
															);
														} }
														style={ { flex: 1 } }
														__next40pxDefaultSize
													/>
													<NumberControl
														label={ __(
															'Y',
															'blocks-for-leaflet-map'
														) }
														value={
															marker.shadowAnchorY ??
															''
														}
														onChange={ (
															value
														) => {
															const val =
																parseInt(
																	value,
																	10
																);
															handleUpdateMarker(
																index,
																{
																	shadowAnchorY:
																		isNaN(
																			val
																		)
																			? null
																			: val,
																}
															);
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
							{ /* SVG Marker options — collapsed by default. */ }
							<PanelBody
								title={ __(
									'SVG Marker',
									'blocks-for-leaflet-map'
								) }
								initialOpen={ false }
							>
								<ToggleControl
									label={ __(
										'Use SVG marker',
										'blocks-for-leaflet-map'
									) }
									checked={ marker.useSvgMarker || false }
									onChange={ ( value ) => {
										const updates = { useSvgMarker: value };
										if ( value && marker.useCustomIcon ) {
											updates.useCustomIcon = false;
											setConflictNotices( ( prev ) => ( {
												...prev,
												[ index ]: 'customIconDisabled',
											} ) );
										} else if ( ! value ) {
											setConflictNotices( ( prev ) => ( {
												...prev,
												[ index ]: null,
											} ) );
										}
										handleUpdateMarker( index, updates );
									} }
									__nextHasNoMarginBottom
								/>
								{ marker.useSvgMarker &&
									conflictNotices[ index ] ===
										'customIconDisabled' && (
										<Notice
											status="info"
											isDismissible={ false }
										>
											{ __(
												'Custom icon mode was automatically disabled — SVG and custom-image markers cannot be combined. Your custom icon settings have been preserved and will resume when you disable SVG marker mode.',
												'blocks-for-leaflet-map'
											) }
										</Notice>
									) }
								{ marker.useSvgMarker && (
									<>
										{ /* Background color */ }
										<p
											style={ {
												margin: '12px 0 4px',
												fontWeight: 600,
												fontSize: '11px',
												textTransform: 'uppercase',
												color: '#1e1e1e',
											} }
										>
											{ __(
												'Background Color',
												'blocks-for-leaflet-map'
											) }
										</p>
										<p
											style={ {
												margin: '0 0 8px',
												fontSize: '11px',
												color: '#757575',
											} }
										>
											{ __(
												'Default: #2b82cb',
												'blocks-for-leaflet-map'
											) }
										</p>
										<ColorPalette
											value={
												marker.svgBackground ||
												undefined
											}
											onChange={ ( value ) =>
												handleUpdateMarker( index, {
													svgBackground: value || '',
												} )
											}
											enableAlpha={ false }
										/>
										{ /* Icon CSS class */ }
										<TextControl
											label={ __(
												'Icon CSS Class',
												'blocks-for-leaflet-map'
											) }
											value={ marker.svgIconClass || '' }
											onChange={ ( value ) =>
												handleUpdateMarker( index, {
													svgIconClass: value,
												} )
											}
											help={ __(
												"CSS class for an icon font glyph (e.g. 'fas fa-star' for Font Awesome). Requires the icon font to be enqueued by your theme or another plugin — Leaflet Map does not load any icon font.",
												'blocks-for-leaflet-map'
											) }
											__nextHasNoMarginBottom
										/>
										{ /* Foreground color */ }
										<p
											style={ {
												margin: '12px 0 4px',
												fontWeight: 600,
												fontSize: '11px',
												textTransform: 'uppercase',
												color: '#1e1e1e',
											} }
										>
											{ __(
												'Icon Color',
												'blocks-for-leaflet-map'
											) }
										</p>
										<p
											style={ {
												margin: '0 0 8px',
												fontSize: '11px',
												color: '#757575',
											} }
										>
											{ __(
												'Default: white',
												'blocks-for-leaflet-map'
											) }
										</p>
										<ColorPalette
											value={
												marker.svgColor || undefined
											}
											onChange={ ( value ) =>
												handleUpdateMarker( index, {
													svgColor: value || '',
												} )
											}
											enableAlpha={ false }
										/>
									</>
								) }
							</PanelBody>
							<Button
								variant="link"
								isDestructive
								onClick={ () => handleRemoveMarker( index ) }
								style={ { marginTop: '4px' } }
							>
								{ __(
									'Remove Marker',
									'blocks-for-leaflet-map'
								) }
							</Button>
						</PanelBody>
					) ) }
				</PanelBody>

				{ /* ── Lines & Polygons panel ────────────────────────────────────── */ }
				<PanelBody
					title={ sprintf(
						/* translators: %d: number of shapes */
						__( 'Lines & Polygons (%d)', 'blocks-for-leaflet-map' ),
						( lines || [] ).length
					) }
					initialOpen={ false }
				>
					<div
						style={ {
							display: 'flex',
							gap: '8px',
							marginBottom: '12px',
						} }
					>
						<Button
							variant="secondary"
							onClick={ () => handleAddLine( 'line' ) }
							style={ { flex: 1, justifyContent: 'center' } }
						>
							{ __( '+ Line', 'blocks-for-leaflet-map' ) }
						</Button>
						<Button
							variant="secondary"
							onClick={ () => handleAddLine( 'polygon' ) }
							style={ { flex: 1, justifyContent: 'center' } }
						>
							{ __( '+ Polygon', 'blocks-for-leaflet-map' ) }
						</Button>
					</div>

					{ ( lines || [] ).map( ( line, lineIdx ) => (
						<PanelBody
							key={ lineIdx }
							title={ sprintf(
								line.type === 'polygon'
									? /* translators: 1: index, 2: point count */ __(
											'Polygon %1$d (%2$d pts)',
											'blocks-for-leaflet-map'
									  )
									: /* translators: 1: index, 2: point count */ __(
											'Line %1$d (%2$d pts)',
											'blocks-for-leaflet-map'
									  ),
								lineIdx + 1,
								( line.points || [] ).length
							) }
							opened={ expandedLineIndex === lineIdx }
							onToggle={ () =>
								setExpandedLineIndex( ( prev ) =>
									prev === lineIdx ? null : lineIdx
								)
							}
						>
							<SelectControl
								label={ __( 'Type', 'blocks-for-leaflet-map' ) }
								value={ line.type || 'line' }
								options={ [
									{
										value: 'line',
										label: __(
											'Line (polyline)',
											'blocks-for-leaflet-map'
										),
									},
									{
										value: 'polygon',
										label: __(
											'Polygon',
											'blocks-for-leaflet-map'
										),
									},
								] }
								onChange={ ( v ) =>
									handleUpdateLine( lineIdx, { type: v } )
								}
								__nextHasNoMarginBottom={ true }
								__next40pxDefaultSize={ true }
							/>

							{ /* Points list */ }
							<p
								style={ {
									margin: '12px 0 4px',
									fontWeight: 600,
									fontSize: '12px',
								} }
							>
								{ __( 'Points', 'blocks-for-leaflet-map' ) }
							</p>
							{ ( line.points || [] ).length === 0 && (
								<p
									style={ {
										margin: '0 0 8px',
										fontSize: '12px',
										color: '#757575',
									} }
								>
									{ __(
										'No points. Add at least 2 to draw the shape.',
										'blocks-for-leaflet-map'
									) }
								</p>
							) }
							{ ( line.points || [] ).map( ( point, pi ) => {
								const lpKey = `${ lineIdx }_${ pi }`;
								const lps = linePointSearch[ lpKey ] || {};
								const lpsInput = lps.input || '';
								const lpsStatus = lps.status || 'idle';
								const lpsCandidates = lps.candidates || [];
								const isOpen = !! openPoints[ lpKey ];
								const isOrphan =
									( line.points || [] ).length < 2;
								return (
									<div
										key={ pi }
										style={ {
											borderLeft: '2px solid #ddd',
											paddingLeft: '8px',
											marginBottom: '8px',
										} }
									>
										<div
											role="button"
											tabIndex={ 0 }
											style={ {
												display: 'flex',
												alignItems: 'center',
												justifyContent: 'space-between',
												cursor: 'pointer',
												padding: '2px 0 4px',
											} }
											onClick={ () =>
												setOpenPoints( ( prev ) => ( {
													...prev,
													[ lpKey ]: ! prev[ lpKey ],
												} ) )
											}
											onKeyDown={ ( e ) => {
												if (
													e.key === 'Enter' ||
													e.key === ' '
												)
													setOpenPoints(
														( prev ) => ( {
															...prev,
															[ lpKey ]:
																! prev[ lpKey ],
														} )
													);
											} }
										>
											<span
												style={ {
													fontWeight: 600,
													fontSize: '11px',
													color: '#757575',
												} }
											>
												{ isOrphan && '📍 ' }
												{ sprintf(
													__(
														'Point %d',
														'blocks-for-leaflet-map'
													),
													pi + 1
												) }
												{ ! isOpen && (
													<span
														style={ {
															fontWeight: 400,
															marginLeft: '4px',
														} }
													>
														{ `(${ point.lat }, ${ point.lng })` }
													</span>
												) }
											</span>
											<span
												style={ {
													fontSize: '10px',
													color: '#757575',
												} }
											>
												{ isOpen ? '▲' : '▼' }
											</span>
										</div>
										{ isOpen && (
											<>
												<NumberControl
													label={ __(
														'Latitude',
														'blocks-for-leaflet-map'
													) }
													value={ point.lat }
													step={ 0.000001 }
													onChange={ ( v ) =>
														handleUpdatePoint(
															lineIdx,
															pi,
															{
																lat:
																	parseFloat(
																		v
																	) || 0,
															}
														)
													}
													__next40pxDefaultSize={
														true
													}
												/>
												<NumberControl
													label={ __(
														'Longitude',
														'blocks-for-leaflet-map'
													) }
													value={ point.lng }
													step={ 0.000001 }
													onChange={ ( v ) =>
														handleUpdatePoint(
															lineIdx,
															pi,
															{
																lng:
																	parseFloat(
																		v
																	) || 0,
															}
														)
													}
													__next40pxDefaultSize={
														true
													}
												/>
												<Button
													variant="tertiary"
													onClick={ () =>
														handleLocatePoint(
															point.lat,
															point.lng
														)
													}
													style={ {
														marginTop: '4px',
														width: '100%',
														justifyContent:
															'center',
													} }
												>
													{ __(
														'📍 Locate on map',
														'blocks-for-leaflet-map'
													) }
												</Button>
												<div
													style={ {
														marginTop: '6px',
													} }
												>
													<TextControl
														label={ __(
															'Search by address',
															'blocks-for-leaflet-map'
														) }
														placeholder={ __(
															'e.g. Paris, France',
															'blocks-for-leaflet-map'
														) }
														value={ lpsInput }
														onChange={ ( v ) =>
															updateLinePointSearch(
																lineIdx,
																pi,
																{ input: v }
															)
														}
														onKeyDown={ ( e ) => {
															if (
																e.key ===
																'Enter'
															) {
																e.preventDefault();
																handleLinePointGeocode(
																	lineIdx,
																	pi
																);
															}
														} }
														__nextHasNoMarginBottom={
															true
														}
													/>
													<Button
														variant="secondary"
														onClick={ () =>
															handleLinePointGeocode(
																lineIdx,
																pi
															)
														}
														isBusy={
															lpsStatus ===
															'loading'
														}
														disabled={
															lpsStatus ===
																'loading' ||
															! lpsInput.trim()
														}
														style={ {
															marginTop: '4px',
															width: '100%',
															justifyContent:
																'center',
														} }
													>
														{ lpsStatus ===
														'loading'
															? __(
																	'Searching…',
																	'blocks-for-leaflet-map'
															  )
															: __(
																	'Search',
																	'blocks-for-leaflet-map'
															  ) }
													</Button>
													{ lpsStatus === 'error' &&
														lps.error && (
															<Notice
																status="warning"
																isDismissible={
																	false
																}
																style={ {
																	marginTop:
																		'6px',
																} }
															>
																{ lps.error }
															</Notice>
														) }
													{ lpsStatus ===
														'candidates' &&
														lpsCandidates.length >
															0 && (
															<div
																style={ {
																	marginTop:
																		'6px',
																} }
															>
																<p
																	style={ {
																		margin: '0 0 4px',
																		fontSize:
																			'11px',
																		color: '#757575',
																	} }
																>
																	{ __(
																		'Select a result:',
																		'blocks-for-leaflet-map'
																	) }
																</p>
																{ lpsCandidates.map(
																	(
																		candidate,
																		ci
																	) => (
																		<Button
																			key={
																				ci
																			}
																			variant="tertiary"
																			onClick={ () =>
																				applyLinePointCandidate(
																					lineIdx,
																					pi,
																					candidate
																				)
																			}
																			style={ {
																				display:
																					'block',
																				width: '100%',
																				textAlign:
																					'left',
																				marginBottom:
																					'4px',
																				whiteSpace:
																					'normal',
																				height: 'auto',
																				minHeight:
																					'32px',
																			} }
																		>
																			{
																				candidate.display_name
																			}
																		</Button>
																	)
																) }
															</div>
														) }
												</div>
											</>
										) }
										<Button
											variant="link"
											isDestructive
											onClick={ () =>
												handleRemovePoint( lineIdx, pi )
											}
											style={ { marginTop: '4px' } }
										>
											{ __(
												'Remove Point',
												'blocks-for-leaflet-map'
											) }
										</Button>
									</div>
								);
							} ) }
							<p
								style={ {
									margin: '0 0 8px',
									fontSize: '11px',
									color: '#757575',
								} }
							>
								{ __(
									'Click "Draw on map" to add points by clicking on the map, or use "+ Add Point" to enter coordinates manually.',
									'blocks-for-leaflet-map'
								) }
							</p>
							<div
								style={ {
									display: 'flex',
									gap: '6px',
									marginBottom: '12px',
								} }
							>
								<Button
									variant="secondary"
									onClick={ () => handleAddPoint( lineIdx ) }
									style={ {
										flex: 1,
										justifyContent: 'center',
									} }
								>
									{ __(
										'+ Add Point',
										'blocks-for-leaflet-map'
									) }
								</Button>
								{ drawingLineIndex === lineIdx ? (
									<Button
										variant="primary"
										onClick={ () => handleStopDrawing() }
										style={ {
											flex: 1,
											justifyContent: 'center',
										} }
									>
										{ __(
											'⏹ Stop drawing',
											'blocks-for-leaflet-map'
										) }
									</Button>
								) : (
									<Button
										variant="secondary"
										onClick={ () =>
											handleStartDrawing( lineIdx )
										}
										style={ {
											flex: 1,
											justifyContent: 'center',
										} }
									>
										{ __(
											'✏ Draw on map',
											'blocks-for-leaflet-map'
										) }
									</Button>
								) }
							</div>
							{ drawingLineIndex === lineIdx && (
								<p
									style={ {
										margin: '-4px 0 12px',
										fontSize: '11px',
										color: '#1d4ed8',
										fontWeight: 600,
									} }
								>
									{ __(
										'🖱 Click on the map to add points. Double-click to finish.',
										'blocks-for-leaflet-map'
									) }
								</p>
							) }

							<ToggleControl
								label={ __(
									'Fit map to this shape',
									'blocks-for-leaflet-map'
								) }
								checked={ !! line.fitbounds }
								onChange={ ( v ) =>
									handleUpdateLine( lineIdx, {
										fitbounds: v,
									} )
								}
								__nextHasNoMarginBottom={ true }
							/>

							{ /* Style subsection */ }
							<PanelBody
								title={ __(
									'Style',
									'blocks-for-leaflet-map'
								) }
								initialOpen={ false }
							>
								<p
									style={ {
										margin: '0 0 4px',
										fontSize: '12px',
									} }
								>
									{ __(
										'Stroke color',
										'blocks-for-leaflet-map'
									) }
								</p>
								<ColorPalette
									value={ line.color || undefined }
									onChange={ ( v ) =>
										handleUpdateLine( lineIdx, {
											color: v || '',
										} )
									}
									enableAlpha={ false }
								/>
								<NumberControl
									label={ __(
										'Weight (px)',
										'blocks-for-leaflet-map'
									) }
									value={ line.weight ?? '' }
									min={ 0 }
									step={ 1 }
									placeholder="3"
									onChange={ ( v ) =>
										handleUpdateLine( lineIdx, {
											weight:
												v !== '' && v != null
													? Number( v )
													: null,
										} )
									}
									__next40pxDefaultSize={ true }
								/>
								<RangeControl
									label={ __(
										'Opacity',
										'blocks-for-leaflet-map'
									) }
									value={ line.opacity ?? 1 }
									min={ 0 }
									max={ 1 }
									step={ 0.05 }
									onChange={ ( v ) =>
										handleUpdateLine( lineIdx, {
											opacity: v,
										} )
									}
									allowReset={ true }
									resetFallbackValue={ 1 }
									__next40pxDefaultSize={ true }
									__nextHasNoMarginBottom={ true }
								/>
								<TextControl
									label={ __(
										'Dash array',
										'blocks-for-leaflet-map'
									) }
									value={ line.dashArray || '' }
									placeholder="e.g. 5,10"
									onChange={ ( v ) =>
										handleUpdateLine( lineIdx, {
											dashArray: v,
										} )
									}
									__nextHasNoMarginBottom={ true }
								/>
								<TextControl
									label={ __(
										'CSS class',
										'blocks-for-leaflet-map'
									) }
									value={ line.classname || '' }
									onChange={ ( v ) =>
										handleUpdateLine( lineIdx, {
											classname: v,
										} )
									}
									__nextHasNoMarginBottom={ true }
								/>
							</PanelBody>

							{ /* Fill subsection */ }
							<PanelBody
								title={ __( 'Fill', 'blocks-for-leaflet-map' ) }
								initialOpen={ false }
							>
								<ToggleControl
									label={ __(
										'Fill shape',
										'blocks-for-leaflet-map'
									) }
									checked={ !! line.fill }
									onChange={ ( v ) =>
										handleUpdateLine( lineIdx, { fill: v } )
									}
									__nextHasNoMarginBottom={ true }
								/>
								{ line.fill && (
									<>
										<p
											style={ {
												margin: '8px 0 4px',
												fontSize: '12px',
											} }
										>
											{ __(
												'Fill color',
												'blocks-for-leaflet-map'
											) }
										</p>
										<ColorPalette
											value={
												line.fillColor || undefined
											}
											onChange={ ( v ) =>
												handleUpdateLine( lineIdx, {
													fillColor: v || '',
												} )
											}
											enableAlpha={ false }
										/>
										<RangeControl
											label={ __(
												'Fill opacity',
												'blocks-for-leaflet-map'
											) }
											value={ line.fillOpacity ?? 0.2 }
											min={ 0 }
											max={ 1 }
											step={ 0.05 }
											onChange={ ( v ) =>
												handleUpdateLine( lineIdx, {
													fillOpacity: v,
												} )
											}
											allowReset={ true }
											resetFallbackValue={ 0.2 }
											__next40pxDefaultSize={ true }
											__nextHasNoMarginBottom={ true }
										/>
									</>
								) }
							</PanelBody>

							{ /* Popup subsection */ }
							<PanelBody
								title={ __(
									'Popup',
									'blocks-for-leaflet-map'
								) }
								initialOpen={ false }
							>
								<TextareaControl
									label={ __(
										'Popup content (HTML allowed)',
										'blocks-for-leaflet-map'
									) }
									value={ line.popup || '' }
									onChange={ ( v ) =>
										handleUpdateLine( lineIdx, {
											popup: v,
										} )
									}
									rows={ 3 }
									__nextHasNoMarginBottom={ true }
								/>
								{ ( line.popup || '' ).trim() && (
									<ToggleControl
										label={ __(
											'Open popup on load',
											'blocks-for-leaflet-map'
										) }
										checked={ !! line.visible }
										onChange={ ( v ) =>
											handleUpdateLine( lineIdx, {
												visible: v,
											} )
										}
										__nextHasNoMarginBottom={ true }
									/>
								) }
							</PanelBody>

							<Button
								variant="link"
								isDestructive
								onClick={ () => handleRemoveLine( lineIdx ) }
								style={ { marginTop: '8px' } }
							>
								{ line.type === 'polygon'
									? __(
											'Remove Polygon',
											'blocks-for-leaflet-map'
									  )
									: __(
											'Remove Line',
											'blocks-for-leaflet-map'
									  ) }
							</Button>
						</PanelBody>
					) ) }
				</PanelBody>

				{ /* ── Circles panel ──────────────────────────────────── */ }
				<PanelBody
					title={ __( 'Circles', 'blocks-for-leaflet-map' ) }
					initialOpen={ false }
				>
					<Button
						variant="secondary"
						onClick={ handleAddCircle }
						style={ { width: '100%', justifyContent: 'center', marginBottom: '8px' } }
					>
						{ __( '+ Circle', 'blocks-for-leaflet-map' ) }
					</Button>

					{ ( attributes.circles || [] ).map( ( circle, circleIdx ) => {
						const csKey = String( circleIdx );
						const cs = circleSearch[ csKey ] || {};
						const csStatus = cs.status || 'idle';
						const csInput = cs.input || '';
						const csCandidates = cs.candidates || [];
						const radiusUnit = circleRadiusUnit[ csKey ] || 'm';
						const displayRadius = radiusUnit === 'km'
							? parseFloat( ( ( circle.radius ?? 1000 ) / 1000 ).toFixed( 3 ) )
							: ( circle.radius ?? 1000 );

						return (
							<PanelBody
								key={ circleIdx }
								title={ `${ __( 'Circle', 'blocks-for-leaflet-map' ) } ${ circleIdx + 1 }` }
								opened={ expandedCircleIndex === circleIdx }
								onToggle={ () =>
									setExpandedCircleIndex( ( prev ) =>
										prev === circleIdx ? null : circleIdx
									)
								}
							>
								<p style={ { margin: '0 0 8px', fontSize: '11px', color: '#757575' } }>
									{ __(
										'Click "Draw on map" to set center + radius by clicking on the map, or enter coordinates manually.',
										'blocks-for-leaflet-map'
									) }
								</p>

								<NumberControl
									label={ __( 'Latitude', 'blocks-for-leaflet-map' ) }
									value={ circle.lat ?? '' }
									step={ 0.000001 }
									onChange={ ( v ) =>
										handleUpdateCircle( circleIdx, { lat: parseFloat( v ) || 0 } )
									}
									__next40pxDefaultSize={ true }
								/>
								<NumberControl
									label={ __( 'Longitude', 'blocks-for-leaflet-map' ) }
									value={ circle.lng ?? '' }
									step={ 0.000001 }
									onChange={ ( v ) =>
										handleUpdateCircle( circleIdx, { lng: parseFloat( v ) || 0 } )
									}
									__next40pxDefaultSize={ true }
								/>
								<Button
									variant="tertiary"
									onClick={ () =>
										handleLocatePoint( circle.lat ?? lat, circle.lng ?? lng )
									}
									style={ { marginTop: '4px', width: '100%', justifyContent: 'center' } }
								>
									{ __( '📍 Locate on map', 'blocks-for-leaflet-map' ) }
								</Button>

								{ /* Geocoder */ }
								<div style={ { marginTop: '6px' } }>
									<TextControl
										label={ __( 'Search by address', 'blocks-for-leaflet-map' ) }
										placeholder={ __( 'e.g. Paris, France', 'blocks-for-leaflet-map' ) }
										value={ csInput }
										onChange={ ( v ) => updateCircleSearch( circleIdx, { input: v } ) }
										onKeyDown={ ( e ) => {
											if ( e.key === 'Enter' ) {
												e.preventDefault();
												handleCircleGeocode( circleIdx );
											}
										} }
										__nextHasNoMarginBottom={ true }
									/>
									<Button
										variant="secondary"
										onClick={ () => handleCircleGeocode( circleIdx ) }
										isBusy={ csStatus === 'loading' }
										disabled={ csStatus === 'loading' || ! csInput.trim() }
										style={ { marginTop: '4px', width: '100%', justifyContent: 'center' } }
									>
										{ csStatus === 'loading'
											? __( 'Searching…', 'blocks-for-leaflet-map' )
											: __( 'Search', 'blocks-for-leaflet-map' ) }
									</Button>
									{ csStatus === 'error' && cs.error && (
										<Notice
											status="warning"
											isDismissible={ false }
											style={ { marginTop: '6px' } }
										>
											{ cs.error }
										</Notice>
									) }
									{ csStatus === 'candidates' && csCandidates.length > 0 && (
										<div style={ { marginTop: '6px' } }>
											<p style={ { margin: '0 0 4px', fontSize: '11px', color: '#757575' } }>
												{ __( 'Select a result:', 'blocks-for-leaflet-map' ) }
											</p>
											{ csCandidates.map( ( candidate, cIdx ) => (
												<Button
													key={ cIdx }
													variant="tertiary"
													onClick={ () => applyCircleCandidate( circleIdx, candidate ) }
													style={ {
														display: 'block',
														width: '100%',
														textAlign: 'left',
														marginBottom: '4px',
														whiteSpace: 'normal',
														height: 'auto',
														minHeight: '32px',
													} }
												>
													{ candidate.display_name }
												</Button>
											) ) }
										</div>
									) }
								</div>

								{ /* Radius + unit toggle */ }
								<div style={ { marginTop: '12px', display: 'flex', gap: '6px', alignItems: 'flex-end' } }>
									<div style={ { flex: 1 } }>
										<NumberControl
											label={ __( 'Radius', 'blocks-for-leaflet-map' ) }
											value={ displayRadius }
											step={ radiusUnit === 'km' ? 0.001 : 1 }
											min={ 0 }
											onChange={ ( v ) => {
												const meters = radiusUnit === 'km'
													? Math.round( ( parseFloat( v ) || 0 ) * 1000 )
													: Math.round( parseFloat( v ) || 0 );
												handleUpdateCircle( circleIdx, { radius: meters } );
											} }
											__next40pxDefaultSize={ true }
										/>
									</div>
									<div>
										<p style={ { margin: '0 0 2px', fontSize: '11px', color: '#1e1e1e' } }>
											{ __( 'Unit', 'blocks-for-leaflet-map' ) }
										</p>
										<SelectControl
											value={ radiusUnit }
											options={ [
												{ label: 'm', value: 'm' },
												{ label: 'km', value: 'km' },
											] }
											onChange={ ( v ) =>
												setCircleRadiusUnit( ( prev ) => ( { ...prev, [ csKey ]: v } ) )
											}
											__nextHasNoMarginBottom={ true }
										/>
									</div>
								</div>

								{ /* Draw on map / Stop drawing */ }
								<div style={ { display: 'flex', gap: '6px', marginTop: '10px', marginBottom: '12px' } }>
									{ drawingCircleIndex === circleIdx ? (
										<Button
											variant="primary"
											onClick={ handleStopDrawingCircle }
											style={ { flex: 1, justifyContent: 'center' } }
										>
											{ __( '⏹ Stop drawing', 'blocks-for-leaflet-map' ) }
										</Button>
									) : (
										<Button
											variant="secondary"
											onClick={ () => handleStartDrawingCircle( circleIdx ) }
											style={ { flex: 1, justifyContent: 'center' } }
										>
											{ __( '✏ Draw on map', 'blocks-for-leaflet-map' ) }
										</Button>
									) }
								</div>
								{ drawingCircleIndex === circleIdx && (
									<p style={ { margin: '-4px 0 12px', fontSize: '11px', color: '#1d4ed8', fontWeight: 600 } }>
										{ __( '🖱 Click map to set center, then click again to set radius.', 'blocks-for-leaflet-map' ) }
									</p>
								) }

								<ToggleControl
									label={ __( 'Fit map to this circle', 'blocks-for-leaflet-map' ) }
									checked={ !! circle.fitbounds }
									onChange={ ( v ) => handleUpdateCircle( circleIdx, { fitbounds: v } ) }
									__nextHasNoMarginBottom={ true }
								/>

								<PanelBody
									title={ __( 'Style', 'blocks-for-leaflet-map' ) }
									initialOpen={ false }
								>
									<p style={ { margin: '0 0 4px', fontSize: '12px' } }>
										{ __( 'Stroke color', 'blocks-for-leaflet-map' ) }
									</p>
									<ColorPalette
										value={ circle.color || undefined }
										onChange={ ( v ) => handleUpdateCircle( circleIdx, { color: v || '' } ) }
										enableAlpha={ false }
									/>
									<RangeControl
										label={ __( 'Weight (px)', 'blocks-for-leaflet-map' ) }
										value={ circle.weight ?? 3 }
										min={ 0 }
										max={ 20 }
										step={ 1 }
										onChange={ ( v ) => handleUpdateCircle( circleIdx, { weight: v } ) }
										allowReset={ true }
										resetFallbackValue={ 3 }
										__next40pxDefaultSize={ true }
										__nextHasNoMarginBottom={ true }
									/>
									<RangeControl
										label={ __( 'Opacity', 'blocks-for-leaflet-map' ) }
										value={ circle.opacity ?? 1 }
										min={ 0 }
										max={ 1 }
										step={ 0.05 }
										onChange={ ( v ) => handleUpdateCircle( circleIdx, { opacity: v } ) }
										allowReset={ true }
										resetFallbackValue={ 1 }
										__next40pxDefaultSize={ true }
										__nextHasNoMarginBottom={ true }
									/>
									<TextControl
										label={ __( 'Dash array', 'blocks-for-leaflet-map' ) }
										value={ circle.dashArray || '' }
										placeholder="e.g. 5,10"
										onChange={ ( v ) => handleUpdateCircle( circleIdx, { dashArray: v } ) }
										__nextHasNoMarginBottom={ true }
									/>
									<TextControl
										label={ __( 'CSS class', 'blocks-for-leaflet-map' ) }
										value={ circle.classname || '' }
										onChange={ ( v ) => handleUpdateCircle( circleIdx, { classname: v } ) }
										__nextHasNoMarginBottom={ true }
									/>
								</PanelBody>

								<PanelBody
									title={ __( 'Fill', 'blocks-for-leaflet-map' ) }
									initialOpen={ false }
								>
									<ToggleControl
										label={ __( 'Fill circle', 'blocks-for-leaflet-map' ) }
										checked={ !! circle.fill }
										onChange={ ( v ) => handleUpdateCircle( circleIdx, { fill: v } ) }
										__nextHasNoMarginBottom={ true }
									/>
									{ circle.fill && (
										<>
											<p style={ { margin: '8px 0 4px', fontSize: '12px' } }>
												{ __( 'Fill color', 'blocks-for-leaflet-map' ) }
											</p>
											<ColorPalette
												value={ circle.fillColor || undefined }
												onChange={ ( v ) =>
													handleUpdateCircle( circleIdx, { fillColor: v || '' } )
												}
												enableAlpha={ false }
											/>
											<RangeControl
												label={ __( 'Fill opacity', 'blocks-for-leaflet-map' ) }
												value={ circle.fillOpacity ?? 0.2 }
												min={ 0 }
												max={ 1 }
												step={ 0.05 }
												onChange={ ( v ) =>
													handleUpdateCircle( circleIdx, { fillOpacity: v } )
												}
												allowReset={ true }
												resetFallbackValue={ 0.2 }
												__next40pxDefaultSize={ true }
												__nextHasNoMarginBottom={ true }
											/>
										</>
									) }
								</PanelBody>

								<PanelBody
									title={ __( 'Popup', 'blocks-for-leaflet-map' ) }
									initialOpen={ false }
								>
									<TextareaControl
										label={ __( 'Popup content (HTML allowed)', 'blocks-for-leaflet-map' ) }
										value={ circle.popup || '' }
										onChange={ ( v ) => handleUpdateCircle( circleIdx, { popup: v } ) }
										rows={ 3 }
										__nextHasNoMarginBottom={ true }
									/>
									{ ( circle.popup || '' ).trim() && (
										<ToggleControl
											label={ __( 'Open popup on load', 'blocks-for-leaflet-map' ) }
											checked={ !! circle.visible }
											onChange={ ( v ) =>
												handleUpdateCircle( circleIdx, { visible: v } )
											}
											__nextHasNoMarginBottom={ true }
										/>
									) }
								</PanelBody>

								<Button
									variant="link"
									isDestructive
									onClick={ () => handleRemoveCircle( circleIdx ) }
									style={ { marginTop: '8px' } }
								>
									{ __( 'Remove Circle', 'blocks-for-leaflet-map' ) }
								</Button>
							</PanelBody>
						);
					} ) }
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
								top: 0,
								left: 0,
								width: '100%',
								height: '100%',
								zIndex: 1,
								cursor: 'pointer',
							} }
						/>
					) }
					{ ( lines || [] ).length > 0 && (
						<div
							style={ {
								position: 'absolute',
								top: '50%',
								left: '50%',
								transform: 'translate(-50%, -50%)',
								pointerEvents: 'none',
								zIndex: 3,
							} }
						>
							<svg
								width="40"
								height="40"
								viewBox="0 0 40 40"
								style={ {
									filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.6))',
								} }
								aria-hidden="true"
							>
								{ /* Outer ring */ }
								<circle
									cx="20"
									cy="20"
									r="9"
									fill="none"
									stroke="#fff"
									strokeWidth="3"
								/>
								<circle
									cx="20"
									cy="20"
									r="9"
									fill="none"
									stroke="#c0392b"
									strokeWidth="1.5"
								/>
								{ /* Crosshair lines */ }
								<line
									x1="20"
									y1="2"
									x2="20"
									y2="11"
									stroke="#fff"
									strokeWidth="3"
									strokeLinecap="round"
								/>
								<line
									x1="20"
									y1="2"
									x2="20"
									y2="11"
									stroke="#c0392b"
									strokeWidth="1.5"
									strokeLinecap="round"
								/>
								<line
									x1="20"
									y1="29"
									x2="20"
									y2="38"
									stroke="#fff"
									strokeWidth="3"
									strokeLinecap="round"
								/>
								<line
									x1="20"
									y1="29"
									x2="20"
									y2="38"
									stroke="#c0392b"
									strokeWidth="1.5"
									strokeLinecap="round"
								/>
								<line
									x1="2"
									y1="20"
									x2="11"
									y2="20"
									stroke="#fff"
									strokeWidth="3"
									strokeLinecap="round"
								/>
								<line
									x1="2"
									y1="20"
									x2="11"
									y2="20"
									stroke="#c0392b"
									strokeWidth="1.5"
									strokeLinecap="round"
								/>
								<line
									x1="29"
									y1="20"
									x2="38"
									y2="20"
									stroke="#fff"
									strokeWidth="3"
									strokeLinecap="round"
								/>
								<line
									x1="29"
									y1="20"
									x2="38"
									y2="20"
									stroke="#c0392b"
									strokeWidth="1.5"
									strokeLinecap="round"
								/>
								{ /* Center dot */ }
								<circle cx="20" cy="20" r="2" fill="#c0392b" />
							</svg>
						</div>
					) }
				</div>
			</div>
		</>
	);
}
