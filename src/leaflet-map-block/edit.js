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
 *   Inside WordPress Playground (wp.org "Live Preview") the whole hierarchy
 *   above is itself nested in Playground's iframes, so the preview iframe
 *   cannot assume the editor is window.top. On every iframe load the editor
 *   sends a bflm_editor_hello handshake; the bridge replies to that message's
 *   event.source from then on (window.top is only its pre-handshake fallback).
 *
 * COMMUNICATION CHANNELS
 * ──────────────────────
 *   Outer → Preview  (iframeRef.current.contentWindow.postMessage)
 *     type: 'bflm_editor_hello' — onLoad handshake → bridge captures reply target
 *     type: 'bflm_set_view'     — sidebar lat/lng/zoom change → map.setView()
 *     type: 'bflm_set_overlays' — overlays attribute change → live rebuild of
 *                                 image/video overlay layers, no iframe reload
 *
 *   Preview → Outer  (postToEditor() in the bridge, received on window here)
 *     type: 'bflm_map_update'       — user pan/zoom → update lat/lng/zoom attrs
 *     type: 'bflm_marker_update'    — marker drag   → update marker lat/lng attr
 *     type: 'bflm_linepoint_update' — line-point drag → update line point lat/lng
 *     type: 'bflm_overlay_update'   — overlay corner-handle drag → update overlay bounds
 *     type: 'bflm_map_drag_start'   — user starts dragging map → suppress overlay
 *     type: 'bflm_map_drag_end'     — user releases map drag   → restore overlay
 *
 * SRC REBUILD vs. postMessage
 * ───────────────────────────
 *   Structural changes (height, scrollWheelZoom, zoomControl, markers):
 *     Rebuild iframe.src → full reload (500 ms debounce).
 *
 *   View changes (lat, lng, zoom) from the sidebar:
 *     Send bflm_set_view postMessage → no tile reload (100 ms debounce).
 *
 *   Overlay edits (src/bounds/opacity/etc. on an existing overlay):
 *     Send bflm_set_overlays postMessage → no tile reload (150 ms debounce).
 *     Adding/removing an overlay still triggers a full reload (see
 *     previewUrlKey below) to keep layer order/indices in sync with the
 *     handle-setup code in includes/preview/template.php.
 *
 * ECHO LOOP PREVENTION
 * ─────────────────────
 *   isIframeUpdateRef is set true before setAttributes() calls that originate
 *   from incoming iframe messages. The lat/lng/zoom view-change effect reads
 *   this flag, skips the echo postMessage, then clears the flag.
 *
 * @package
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
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalNumberControl as NumberControl,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
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
	{ value: 'px', label: __( 'px', 'cartoblocks-for-leaflet' ), default: 400 },
	{ value: '%', label: __( '%', 'cartoblocks-for-leaflet' ), default: 100 },
	{ value: 'vh', label: __( 'vh', 'cartoblocks-for-leaflet' ), default: 50 },
];

/**
 * Options for three-state interaction controls.
 * Empty string = "Default" (omit from shortcode, use Leaflet Map global settings).
 */
const THREE_STATE_OPTIONS = [
	{ value: '', label: __( 'Default', 'cartoblocks-for-leaflet' ) },
	{ value: 'true', label: __( 'Enabled', 'cartoblocks-for-leaflet' ) },
	{ value: 'false', label: __( 'Disabled', 'cartoblocks-for-leaflet' ) },
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
		key: 'width',
		attr: 'width',
		serialize: ( v ) => {
			const w = v || '100%';
			return w;
		},
	},
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
 * @return {string} Concatenated shortcode markup.
 */
function buildLineShortcodes( lines ) {
	if ( ! lines || lines.length === 0 ) {
		return '';
	}
	let out = '';
	for ( const line of lines ) {
		const points = line.points || [];
		if ( points.length < 2 ) {
			continue;
		}
		const tag =
			line.type === 'polygon' ? 'leaflet-polygon' : 'leaflet-line';
		const latlngs = points
			.map( ( p ) => `${ p.lat },${ p.lng }` )
			.join( '; ' );
		let attrs = ` latlngs="${ latlngs }"`;
		if ( line.fitbounds ) {
			attrs += ` fitbounds="true"`;
		}
		if ( line.color && line.color.trim() ) {
			attrs += ` color="${ line.color.trim() }"`;
		}
		if ( line.weight != null ) {
			attrs += ` weight="${ line.weight }"`;
		}
		if ( line.opacity != null ) {
			attrs += ` opacity="${ line.opacity }"`;
		}
		if ( line.dashArray && line.dashArray.trim() ) {
			attrs += ` dasharray="${ line.dashArray.trim() }"`;
		}
		if ( line.classname && line.classname.trim() ) {
			attrs += ` classname="${ line.classname.trim() }"`;
		}
		if ( line.fill ) {
			attrs += ` fill="true"`;
		}
		if ( line.fillColor && line.fillColor.trim() ) {
			attrs += ` fillcolor="${ line.fillColor.trim() }"`;
		}
		if ( line.fillOpacity != null ) {
			attrs += ` fillopacity="${ line.fillOpacity }"`;
		}
		const popup = line.popup || '';
		if ( line.visible && popup ) {
			attrs += ` visible="1"`;
		}
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
 * Keep in sync with render.php and bflm_preview_map() in cartoblocks-for-leaflet.php.
 *
 * @param {Array} circles
 * @return {string} Concatenated shortcode markup.
 */
function buildCircleShortcodes( circles ) {
	if ( ! circles || circles.length === 0 ) {
		return '';
	}
	let out = '';
	for ( const circle of circles ) {
		if ( circle.lat == null || circle.lng == null ) {
			continue;
		}
		const r = circle.radius != null ? Number( circle.radius ) : 1000;
		if ( r <= 0 ) {
			continue;
		}
		let attrs = ` lat="${ circle.lat }" lng="${ circle.lng }" radius="${ r }"`;
		if ( circle.fitbounds ) {
			attrs += ` fitbounds="true"`;
		}
		if ( circle.color && circle.color.trim() ) {
			attrs += ` color="${ circle.color.trim() }"`;
		}
		if ( circle.weight != null ) {
			attrs += ` weight="${ circle.weight }"`;
		}
		if ( circle.opacity != null ) {
			attrs += ` opacity="${ circle.opacity }"`;
		}
		if ( circle.dashArray && circle.dashArray.trim() ) {
			attrs += ` dasharray="${ circle.dashArray.trim() }"`;
		}
		if ( circle.classname && circle.classname.trim() ) {
			attrs += ` classname="${ circle.classname.trim() }"`;
		}
		if ( circle.fill ) {
			attrs += ` fill="true"`;
		}
		if ( circle.fillColor && circle.fillColor.trim() ) {
			attrs += ` fillcolor="${ circle.fillColor.trim() }"`;
		}
		if ( circle.fillOpacity != null ) {
			attrs += ` fillopacity="${ circle.fillOpacity }"`;
		}
		const popup = circle.popup || '';
		if ( circle.visible && popup ) {
			attrs += ` visible="1"`;
		}
		if ( popup ) {
			out += `\n[leaflet-circle${ attrs }]${ popup }[/leaflet-circle]`;
		} else {
			out += `\n[leaflet-circle${ attrs } /]`;
		}
	}
	return out;
}

/** @type {Record<string,string>} Maps layer type to its shortcode tag. */
const LAYER_TYPE_TAGS = {
	geojson: 'leaflet-geojson',
	gpx: 'leaflet-gpx',
	kml: 'leaflet-kml',
};

/**
 * Build [leaflet-geojson] / [leaflet-gpx] / [leaflet-kml] shortcode strings.
 * Skips layers with empty src. Always self-closing — popup config goes via attrs.
 * Keep in sync with render.php and bflm_preview_map() in cartoblocks-for-leaflet.php.
 *
 * @param {Array} layers
 * @return {string} Concatenated shortcode markup.
 */
function buildLayerShortcodes( layers ) {
	if ( ! layers || layers.length === 0 ) {
		return '';
	}
	let out = '';
	for ( const layer of layers ) {
		const src = ( layer.src || '' ).trim();
		if ( ! src ) {
			continue;
		}
		const tag = LAYER_TYPE_TAGS[ layer.type ] || LAYER_TYPE_TAGS.geojson;

		let attrs = ` src="${ src }"`;
		if ( layer.fitbounds ) {
			attrs += ` fitbounds="true"`;
		}

		const sanitize = ( s ) =>
			s.replace( /"/g, '&quot;' ).replace( /\]/g, '&#93;' );
		if ( layer.popupText && layer.popupText.trim() ) {
			attrs += ` popup_text="${ sanitize( layer.popupText.trim() ) }"`;
		}
		if ( layer.popupProperty && layer.popupProperty.trim() ) {
			attrs += ` popup_property="${ sanitize(
				layer.popupProperty.trim()
			) }"`;
		}
		if ( layer.tableView ) {
			attrs += ` table_view="1"`;
		}

		if ( layer.color && layer.color.trim() ) {
			attrs += ` color="${ layer.color.trim() }"`;
		}
		if ( layer.weight != null ) {
			attrs += ` weight="${ layer.weight }"`;
		}
		if ( layer.opacity != null ) {
			attrs += ` opacity="${ layer.opacity }"`;
		}
		if ( layer.dashArray && layer.dashArray.trim() ) {
			attrs += ` dasharray="${ layer.dashArray.trim() }"`;
		}
		if ( layer.classname && layer.classname.trim() ) {
			attrs += ` classname="${ layer.classname.trim() }"`;
		}
		if ( layer.fill ) {
			attrs += ` fill="true"`;
		}
		if ( layer.fillColor && layer.fillColor.trim() ) {
			attrs += ` fillcolor="${ layer.fillColor.trim() }"`;
		}
		if ( layer.fillOpacity != null ) {
			attrs += ` fillopacity="${ layer.fillOpacity }"`;
		}

		if ( layer.useCustomIcon ) {
			if ( layer.iconUrl ) {
				attrs += ` iconurl="${ layer.iconUrl }"`;
			}
			if (
				layer.iconWidth != null &&
				layer.iconHeight != null &&
				layer.iconWidth >= 1 &&
				layer.iconHeight >= 1
			) {
				attrs += ` iconsize="${ layer.iconWidth },${ layer.iconHeight }"`;
			}
			if ( layer.iconAnchorX != null && layer.iconAnchorY != null ) {
				attrs += ` iconanchor="${ layer.iconAnchorX },${ layer.iconAnchorY }"`;
			}
			if ( layer.popupAnchorX != null && layer.popupAnchorY != null ) {
				attrs += ` popupanchor="${ layer.popupAnchorX },${ layer.popupAnchorY }"`;
			}
		}

		out += `\n[${ tag }${ attrs } /]`;
	}
	return out;
}

/**
 * Build [leaflet-image-overlay] / [leaflet-video-overlay] shortcode strings.
 * Skips overlays with empty src or bounds. Always self-closing.
 * Keep in sync with render.php and bflm_preview_map() in cartoblocks-for-leaflet.php.
 *
 * @param {Array} overlays
 * @return {string} Concatenated shortcode markup.
 */
function buildOverlayShortcodes( overlays ) {
	if ( ! overlays || overlays.length === 0 ) {
		return '';
	}
	let out = '';
	for ( const overlay of overlays ) {
		const src = ( overlay.src || '' ).trim();
		const bounds = ( overlay.bounds || '' ).trim();
		if ( ! src || ! bounds ) {
			continue;
		}
		const tag =
			overlay.type === 'video'
				? 'leaflet-video-overlay'
				: 'leaflet-image-overlay';
		let attrs = ` src="${ src }" bounds="${ bounds }"`;
		if ( overlay.opacity != null ) {
			attrs += ` opacity="${ overlay.opacity }"`;
		}
		if ( overlay.interactive ) {
			attrs += ` interactive="true"`;
		}
		if ( overlay.alt && overlay.alt.trim() ) {
			attrs += ` alt="${ overlay.alt.trim() }"`;
		}
		if ( overlay.zIndex != null ) {
			attrs += ` zindex="${ overlay.zIndex }"`;
		}
		if ( overlay.classname && overlay.classname.trim() ) {
			attrs += ` classname="${ overlay.classname.trim() }"`;
		}
		if ( overlay.type !== 'video' && overlay.keepAspectRatio === false ) {
			attrs += ` keepaspectratio="false"`;
		}
		out += `\n[${ tag }${ attrs } /]`;
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
 * @return {string} Full shortcode string (map + zero or more markers + zero or more lines + circles + layers).
 */
function buildShortcode( attributes ) {
	const {
		imageMap,
		imageSrc,
		imageX,
		imageY,
		wmsEnabled,
		wmsSource,
		wmsLayer,
		wmsCrs,
		height,
	} = attributes;

	let shortcode;

	if ( imageMap ) {
		const src = ( imageSrc || '' ).trim();
		const h =
			typeof height === 'number' ||
			( typeof height === 'string' && /^\d+$/.test( height ) )
				? `${ height }px`
				: height || '400px';
		shortcode = `[leaflet-image src="${ src }" x="${ imageX ?? 0 }" y="${
			imageY ?? 0
		}" zoom="0" height="${ h }"]`;
	} else if ( wmsEnabled ) {
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
		const src = ( wmsSource || '' ).trim();
		let wmsAttrs = src ? ` src="${ src }"` : '';
		const layer = ( wmsLayer || '' ).trim();
		if ( layer ) {
			wmsAttrs += ` layer="${ layer }"`;
		}
		const crs = ( wmsCrs || '' ).trim();
		if ( crs ) {
			wmsAttrs += ` crs="${ crs }"`;
		}
		shortcode = '[leaflet-wms ' + parts.join( ' ' ) + wmsAttrs + ']';
	} else {
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

		shortcode = '[leaflet-map ' + parts.join( ' ' ) + ']';
	}

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
		if ( mTitle ) {
			mTag += ` title="${ mTitle }"`;
		}
		if ( mAlt ) {
			mTag += ` alt="${ mAlt }"`;
		}
		if ( marker.visible ) {
			mTag += ` visible="1"`;
		}
		if ( marker.draggable ) {
			mTag += ` draggable="1"`;
		}
		if (
			marker.opacity != null &&
			Math.abs( marker.opacity - 1 ) > 0.001
		) {
			mTag += ` opacity="${ marker.opacity }"`;
		}
		if ( marker.zIndexOffset != null && marker.zIndexOffset !== 0 ) {
			mTag += ` zindexoffset="${ marker.zIndexOffset }"`;
		}

		// SVG marker and custom image icon are mutually exclusive: SVG wins when both flags are set.
		if ( marker.useSvgMarker ) {
			mTag += ` svg="true"`;
			if ( marker.svgBackground && marker.svgBackground.trim() ) {
				mTag += ` background="${ marker.svgBackground.trim() }"`;
			}
			if ( marker.svgIconClass && marker.svgIconClass.trim() ) {
				mTag += ` iconclass="${ marker.svgIconClass.trim() }"`;
			}
			if ( marker.svgColor && marker.svgColor.trim() ) {
				mTag += ` color="${ marker.svgColor.trim() }"`;
			}
		} else if ( marker.useCustomIcon ) {
			// Custom icon: only emit when useCustomIcon is true.
			if ( marker.iconUrl ) {
				mTag += ` iconurl="${ marker.iconUrl }"`;
			}
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
				if ( marker.shadowUrl ) {
					mTag += ` shadowurl="${ marker.shadowUrl }"`;
				}
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
	if ( ! imageMap ) {
		shortcode += buildLayerShortcodes( attributes.layers );
		shortcode += buildOverlayShortcodes( attributes.overlays );
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
 * Compute proportional-resize updates for a size + anchor subsystem.
 *
 * Used by the icon and shadow NumberControl onChange handlers when
 * "Lock aspect ratio" is active. Returns a partial updates object
 * ready to be passed to handleUpdateMarker, or null if the aspect
 * ratio cannot be determined (caller should fall back to a plain
 * single-value update).
 *
 * @param {Object}                                      p
 * @param {'w'|'h'}                                     p.axis    Which dimension the user directly changed.
 * @param {number}                                      p.newVal  New integer value for that dimension (>= 1).
 * @param {string}                                      p.wKey    Attribute key for width  (e.g. 'iconWidth').
 * @param {string}                                      p.hKey    Attribute key for height (e.g. 'iconHeight').
 * @param {number|null}                                 p.origW   Stored original width  (preferred ratio source).
 * @param {number|null}                                 p.origH   Stored original height.
 * @param {number|null}                                 p.curW    Current width  (ratio fallback + anchor base).
 * @param {number|null}                                 p.curH    Current height.
 * @param {Array<{key: string, val: *, axis: 'w'|'h'}>} p.anchors
 *                                                                Anchors to rescale. Each entry: key to write, current value, which new
 *                                                                dimension to scale against ('w' for X-axis anchors, 'h' for Y-axis anchors).
 *
 * @return {Object|null} New attribute values for the resize, or null when the input is invalid.
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
	{ id: 'top-left', xFn: () => 0, yFn: () => 0 },
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
 * @return {{ x: number, y: number }|null} Anchor coordinates, or null for the custom preset or an invalid size.
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
 * Visual 3×3 anchor preset picker.
 *
 * @param {Object}   props
 * @param {*}        props.anchorX      Current anchor X (may be null).
 * @param {*}        props.anchorY      Current anchor Y (may be null).
 * @param {*}        props.width        Icon width (must be ≥1 to enable).
 * @param {*}        props.height       Icon height (must be ≥1 to enable).
 * @param {boolean}  props.disabled     Force-disable all cells.
 * @param {string}   props.label        Field label text.
 * @param {string}   props.disabledHelp Help text shown when disabled.
 * @param {Function} props.onChange     Called with preset id string on click.
 */
function AnchorGrid( {
	anchorX,
	anchorY,
	width,
	height,
	disabled = false,
	label,
	disabledHelp,
	onChange,
} ) {
	const dimValid =
		width >= 1 && isFinite( width ) && height >= 1 && isFinite( height );
	const isDisabled = disabled || ! dimValid;
	const activePreset = dimValid
		? getAnchorPreset( anchorX, anchorY, width, height )
		: null;

	// keyboard navigation: arrow keys move focus within the 3×3 grid
	function handleKeyDown( e, idx ) {
		const moves = {
			ArrowRight: 1,
			ArrowLeft: -1,
			ArrowDown: 3,
			ArrowUp: -3,
		};
		const delta = moves[ e.key ];
		if ( delta == null ) {
			return;
		}
		e.preventDefault();
		const next = idx + delta;
		if ( next < 0 || next > 8 ) {
			return;
		}
		const grid = e.currentTarget.parentElement;
		const cells = grid.querySelectorAll( 'button' );
		if ( cells[ next ] ) {
			cells[ next ].focus();
		}
	}

	return (
		<div className="bflm-anchor-grid">
			{ label && (
				<span className="bflm-anchor-grid__label">{ label }</span>
			) }
			<div
				className="bflm-anchor-grid__grid"
				role="radiogroup"
				aria-label={ label }
			>
				{ ANCHOR_PRESETS.map( ( preset, idx ) => {
					const isActive = activePreset === preset.id;
					return (
						<button
							key={ preset.id }
							type="button"
							role="radio"
							aria-checked={ isActive }
							aria-label={ preset.id.replace( /-/g, ' ' ) }
							disabled={ isDisabled }
							className={
								'bflm-anchor-grid__cell' +
								( isActive
									? ' bflm-anchor-grid__cell--active'
									: '' )
							}
							onClick={ () => {
								if ( ! isDisabled ) {
									onChange( preset.id );
								}
							} }
							onKeyDown={ ( e ) => handleKeyDown( e, idx ) }
							tabIndex={ isActive ? 0 : -1 }
						>
							<span className="bflm-anchor-grid__dot" />
						</button>
					);
				} ) }
			</div>
			{ isDisabled && disabledHelp && (
				<span className="bflm-anchor-grid__help">{ disabledHelp }</span>
			) }
		</div>
	);
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
		layers,
		imageMap,
		imageSrc,
		imageX,
		imageY,
		imageZoom,
		wmsEnabled,
		wmsSource,
		wmsLayer,
		wmsCrs,
		overlays,
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
		attribution,
		showScale: showScale ? 'true' : 'false',
		markers: JSON.stringify( markers ),
		lines: JSON.stringify( lines || [] ),
		circles: JSON.stringify( circles || [] ),
		layers: JSON.stringify( layers || [] ),
		imageMap: imageMap ? 'true' : 'false',
		imageSrc: imageSrc || '',
		imageX: imageX ?? 0,
		imageY: imageY ?? 0,
		imageZoom: imageZoom ?? 0,
		wmsEnabled: wmsEnabled ? 'true' : 'false',
		wmsSource: wmsSource || '',
		wmsLayer: wmsLayer || '',
		wmsCrs: wmsCrs || '',
		overlays: JSON.stringify( overlays || [] ),
	} );

	// Only include interaction params when explicitly set (not "Default").
	if ( dragging ) {
		params.set( 'dragging', dragging );
	}
	if ( keyboard ) {
		params.set( 'keyboard', keyboard );
	}
	if ( doubleClickZoom ) {
		params.set( 'doubleClickZoom', doubleClickZoom );
	}
	if ( boxZoom ) {
		params.set( 'boxZoom', boxZoom );
	}
	if ( closePopupOnClick ) {
		params.set( 'closePopupOnClick', closePopupOnClick );
	}
	if ( tap ) {
		params.set( 'tap', tap );
	}
	if ( inertia ) {
		params.set( 'inertia', inertia );
	}
	if ( minZoom ) {
		params.set( 'minZoom', minZoom );
	}
	if ( maxZoom ) {
		params.set( 'maxZoom', maxZoom );
	}
	if ( maxBounds ) {
		params.set( 'maxBounds', maxBounds );
	}
	if ( tileurl ) {
		params.set( 'tileurl', tileurl );
	}
	if ( tilesize ) {
		params.set( 'tilesize', tilesize );
	}
	if ( subdomains ) {
		params.set( 'subdomains', subdomains );
	}
	if ( mapid ) {
		params.set( 'mapid', mapid );
	}
	if ( accesstoken ) {
		params.set( 'accesstoken', accesstoken );
	}
	if ( zoomoffset ) {
		params.set( 'zoomoffset', zoomoffset );
	}
	if ( nowrap ) {
		params.set( 'nowrap', nowrap );
	}
	if ( detectretina ) {
		params.set( 'detectretina', detectretina );
	}

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
				'cartoblocks-for-leaflet'
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
						'cartoblocks-for-leaflet'
					),
			};
		}
		return { candidates: data.data.candidates, error: '' };
	} catch ( e ) {
		return {
			candidates: [],
			error: __(
				'Geocoding request failed. Please check your connection and try again.',
				'cartoblocks-for-leaflet'
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
 * @param {boolean}  props.isSelected    Whether the block is currently selected.
 * @param {string}   props.clientId      Unique block client ID.
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
		imageMap,
		imageSrc,
		imageX,
		imageY,
		imageZoom,
		wmsEnabled,
		wmsSource,
		wmsLayer,
		wmsCrs,
		overlays,
	} = attributes;

	// Local state for NumberControls that commit only on blur (Tile Size, Zoom Offset).
	// This prevents iframe rebuilds on every keystroke/arrow-click with intermediate values.
	const [ localTilesize, setLocalTilesize ] = useState( tilesize );
	const [ localZoomoffset, setLocalZoomoffset ] = useState( zoomoffset );
	// Key incremented to force UnitControl re-mount when % value is clamped to 100.
	const [ widthControlKey, setWidthControlKey ] = useState( 0 );

	// On first insert, apply Leaflet Map plugin defaults (from Settings page) if
	// the block attributes still equal the block.json placeholder values. Existing
	// saved blocks will have already-persisted values and are never touched.
	useEffect( () => {
		const ld = window.bflmEditor?.leafletDefaults;
		if ( ! ld ) {
			return;
		}

		const BLOCK_JSON_LAT = 37.1773;
		const BLOCK_JSON_LNG = -3.5986;
		const BLOCK_JSON_ZOOM = 13;

		if (
			lat === BLOCK_JSON_LAT &&
			lng === BLOCK_JSON_LNG &&
			zoom === BLOCK_JSON_ZOOM
		) {
			const updates = {};
			if ( ld.lat !== BLOCK_JSON_LAT ) {
				updates.lat = ld.lat;
			}
			if ( ld.lng !== BLOCK_JSON_LNG ) {
				updates.lng = ld.lng;
			}
			if ( ld.zoom !== BLOCK_JSON_ZOOM ) {
				updates.zoom = ld.zoom;
			}
			if ( ld.height ) {
				const h = String( ld.height );
				updates.height =
					h.includes( 'px' ) ||
					h.includes( '%' ) ||
					h.includes( 'vh' )
						? h
						: h + 'px';
			}
			if ( ld.width ) {
				const w = String( ld.width );
				updates.width =
					w.includes( 'px' ) ||
					w.includes( '%' ) ||
					w.includes( 'vh' )
						? w
						: w + 'px';
			}
			if ( ld.fitMarkers ) {
				updates.fitMarkers = true;
			}
			if ( ld.zoomControl !== undefined ) {
				updates.zoomControl = ld.zoomControl;
			}
			if ( ld.scrollWheelZoom !== undefined ) {
				updates.scrollWheelZoom = ld.scrollWheelZoom;
			}
			// doubleClickZoom is a three-state string: '' / 'true' / 'false'
			if ( ld.doubleClickZoom ) {
				updates.doubleClickZoom = 'true';
			}
			if ( ld.minZoom ) {
				updates.minZoom = String( ld.minZoom );
			}
			if ( ld.maxZoom ) {
				updates.maxZoom = String( ld.maxZoom );
			}
			if ( Object.keys( updates ).length ) {
				setAttributes( updates );
			}
		}
	}, [] ); // eslint-disable-line react-hooks/exhaustive-deps

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

	/** Index of the per-layer PanelBody that is currently expanded (controlled). */
	const [ expandedLayerIndex, setExpandedLayerIndex ] = useState( null );

	/** Index of the per-overlay PanelBody that is currently expanded (controlled). */
	const [ expandedOverlayIndex, setExpandedOverlayIndex ] = useState( null );

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

		if (
			window.navigator.clipboard &&
			window.navigator.clipboard.writeText
		) {
			window.navigator.clipboard
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
	 * Whether the user is mid-drag/mid-interaction inside the iframe overlay.
	 * Gutenberg's `isSelected` flips to false as soon as focus crosses into
	 * the iframe's separate browsing context, which would otherwise remount
	 * the focus-restoring overlay on top of the iframe mid-drag and cut the
	 * gesture short. This flag keeps the overlay hidden until mouseup.
	 */
	const [ isOverlayInteracting, setIsOverlayInteracting ] = useState( false );

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

	/**
	 * Set true before setAttributes() calls triggered by incoming iframe
	 * postMessages (e.g. drag-driven lat/lng/zoom updates) so the structural
	 * src-rebuild effect skips reloading the iframe. Without this, dragging
	 * the map fires moveend → bflm_map_update → setAttributes(lat/lng/zoom) →
	 * shortcode changes → the 500ms debounced rebuild reassigns iframe.src,
	 * reloading the iframe mid/post-drag and resetting Leaflet's grab cursor.
	 * Separate from isIframeUpdateRef because both effects run on the same
	 * render and would otherwise race to consume a single shared flag.
	 *
	 * @type {React.MutableRefObject<boolean>}
	 */
	const skipNextSrcRebuildRef = useRef( false );

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

	/** setTimeout handle for the 100 ms image-map view postMessage debounce. */
	const imageViewDebounceRef = useRef( null );

	/** setTimeout handle for the 150 ms overlays postMessage debounce. */
	const overlaysDebounceRef = useRef( null );

	/**
	 * Set true before setAttributes() calls triggered by incoming
	 * bflm_image_update postMessages so the image-view effect does not echo
	 * back to the iframe. Separate from isIframeUpdateRef/skipNextSrcRebuildRef
	 * because all three effects run on the same render and would otherwise
	 * race to consume shared flags.
	 *
	 * @type {React.MutableRefObject<boolean>}
	 */
	const isIframeImageUpdateRef = useRef( false );

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
			lastLoadedShortcodeRef.current = buildShortcode(
				attributesRef.current
			);
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
	// imageZoom changes the fitImage() view but not the shortcode (zoom="0" is hardcoded),
	// so append it explicitly when in image mode so the iframe reloads on slider change.
	// Width changes resize the iframe container; Leaflet won't auto-recalculate tile
	// positions, so include normalizedWidth in the key to force a full iframe reload.
	//
	// Overlay edits (src/bounds/opacity/etc. on an EXISTING overlay) now sync live via
	// the bflm_set_overlays postMessage effect below, so they must not appear in this
	// key — otherwise every keystroke in the overlay panel would also trigger a full
	// reload, fighting the live update. The [leaflet-image-overlay]/[leaflet-video-overlay]
	// tags are stripped out of the shortcode used for the key; only the overlay COUNT is
	// kept (`|ov=`) so adding/removing an overlay still forces a reload — needed to keep
	// Leaflet Map's `window.WPLeafletMapPlugin.overlays` array indices (and therefore the
	// resize/move handle wiring in includes/preview/template.php) in sync with the
	// `overlays` attribute array.
	const shortcodeNoOverlays = shortcode.replace(
		/\n?\[leaflet-(?:image|video)-overlay[^\]]*\/\]/g,
		''
	);
	const previewUrlKey =
		( imageMap
			? shortcodeNoOverlays + '|iz=' + ( imageZoom ?? 0 )
			: shortcodeNoOverlays ) +
		'|w=' +
		normalizedWidth +
		'|ov=' +
		( overlays ? overlays.length : 0 );

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
		// Skip rebuild when lat/lng/zoom changed because of a drag/pan/zoom
		// that already happened live inside the iframe — reloading would
		// kill the in-progress interaction and reset Leaflet's cursor state.
		if ( skipNextSrcRebuildRef.current ) {
			skipNextSrcRebuildRef.current = false;
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

	// ── Interaction toggles (sidebar) → postMessage to iframe (no debounce) ───
	//
	// dragging/keyboard/doubleClickZoom/boxZoom/tap are part of previewUrlKey
	// (via shortcode) and would otherwise only take effect after the 500 ms
	// src-rebuild — during which the stale iframe still responds with its old
	// settings (e.g. double-click still zooms after switching to "Disabled").
	// Sending bflm_set_interaction immediately calls the matching Leaflet
	// handler's enable()/disable() on the live map, closing that gap. The
	// later src-rebuild still happens (keeps the iframe's HTML in sync) but no
	// longer matters for perceived responsiveness.
	useEffect( () => {
		const iframe = iframeRef.current;
		if ( ! iframe?.contentWindow ) {
			return;
		}
		iframe.contentWindow.postMessage(
			{
				type: 'bflm_set_interaction',
				blockId: clientIdRef.current,
				dragging: dragging || '',
				keyboard: keyboard || '',
				doubleClickZoom: doubleClickZoom || '',
				boxZoom: boxZoom || '',
				tap: tap || '',
			},
			'*'
		);
	}, [ dragging, keyboard, doubleClickZoom, boxZoom, tap ] ); // eslint-disable-line react-hooks/exhaustive-deps

	// ── Image map view changes (sidebar) → postMessage to iframe (100 ms) ────
	//
	// Mirrors the lat/lng/zoom effect above, but for image maps: imageX/
	// imageY/imageZoom changes from the sidebar send bflm_set_image_view so
	// the iframe calls map.setView() without a full reload. Skip when the
	// change originated from the iframe itself (echo prevention).
	useEffect( () => {
		if ( isIframeImageUpdateRef.current ) {
			isIframeImageUpdateRef.current = false;
			return;
		}

		clearTimeout( imageViewDebounceRef.current );
		imageViewDebounceRef.current = setTimeout( () => {
			const iframe = iframeRef.current;
			if ( ! iframe?.contentWindow ) {
				return;
			}
			const {
				imageX: currentImageX,
				imageY: currentImageY,
				imageZoom: currentImageZoom,
			} = attributesRef.current;
			iframe.contentWindow.postMessage(
				{
					type: 'bflm_set_image_view',
					blockId: clientIdRef.current,
					imageX: currentImageX ?? 0,
					imageY: currentImageY ?? 0,
					imageZoom: currentImageZoom ?? 0,
				},
				'*'
			);
		}, 100 );

		return () => clearTimeout( imageViewDebounceRef.current );
	}, [ imageX, imageY, imageZoom ] ); // eslint-disable-line react-hooks/exhaustive-deps

	// ── Overlay edits → postMessage to iframe (150 ms debounce) ──────────────
	//
	// Editing an existing overlay (src/bounds/opacity/interactive/alt/zIndex/
	// classname/keepAspectRatio) sends bflm_set_overlays so the iframe rebuilds
	// its L.imageOverlay/L.videoOverlay layers in place — no full reload. The
	// iframe always receives the FULL current overlays array (cheap to clone
	// via postMessage) and recreates every overlay layer for this block.
	// Adding/removing an overlay is handled separately by previewUrlKey (the
	// overlay count is part of that key) so layer indices stay in sync with
	// the resize/move handle wiring in includes/preview/template.php.
	useEffect( () => {
		clearTimeout( overlaysDebounceRef.current );
		overlaysDebounceRef.current = setTimeout( () => {
			const iframe = iframeRef.current;
			if ( ! iframe?.contentWindow ) {
				return;
			}
			iframe.contentWindow.postMessage(
				{
					type: 'bflm_set_overlays',
					blockId: clientIdRef.current,
					overlays: attributesRef.current.overlays || [],
				},
				'*'
			);
		}, 150 );

		return () => clearTimeout( overlaysDebounceRef.current );
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ JSON.stringify( overlays ) ] );

	// ── Incoming postMessages from the preview iframe ─────────────────────────
	useEffect( () => {
		/**
		 * Handle postMessages sent by the preview iframe (via postToEditor()
		 * in the bridge script — this window, discovered through the
		 * bflm_editor_hello handshake, or window.top as its fallback).
		 *
		 * @param {MessageEvent} event Browser message event.
		 */
		function handleMessage( event ) {
			// Reject messages from any origin other than this site — the
			// preview iframe is always same-origin (admin-ajax.php on this
			// WordPress site).
			if ( event.origin !== window.location.origin ) {
				return;
			}

			const msg = event.data;
			if ( ! msg || typeof msg.type !== 'string' ) {
				return;
			}

			// Ignore messages that belong to a different block instance.
			if ( msg.blockId !== clientIdRef.current ) {
				return;
			}

			// User starts/ends dragging the map inside the iframe. Suppress
			// the focus-restoring overlay for the duration of the drag so it
			// doesn't remount on top of the iframe mid-gesture when
			// Gutenberg's isSelected flips false (focus moved into the
			// iframe's separate browsing context) and cut the drag short.
			if ( msg.type === 'bflm_map_drag_start' ) {
				setIsOverlayInteracting( true );
				return;
			}

			if ( msg.type === 'bflm_map_drag_end' ) {
				setIsOverlayInteracting( false );
				return;
			}

			if ( msg.type === 'bflm_map_update' ) {
				// Image maps always keep zoom="0" in the shortcode — imageZoom
				// is the only user-facing zoom control for them. The preview
				// iframe already skips posting this message for image maps,
				// but guard here too in case of stale iframes or future call sites.
				if ( attributesRef.current.imageMap ) {
					return;
				}
				// Flag the update so the lat/lng/zoom effect skips the echo,
				// and so the structural rebuild effect skips reloading the
				// iframe (the change already happened live inside it).
				isIframeUpdateRef.current = true;
				skipNextSrcRebuildRef.current = true;
				setAttributes( {
					lat: parseFloat( msg.lat.toFixed( 6 ) ),
					lng: parseFloat( msg.lng.toFixed( 6 ) ),
					zoom: msg.zoom,
				} );
				return;
			}

			if ( msg.type === 'bflm_image_update' ) {
				// Flag the update so the image-view effect skips the echo,
				// and so the structural rebuild effect skips reloading the
				// iframe (the change already happened live inside it).
				isIframeImageUpdateRef.current = true;
				skipNextSrcRebuildRef.current = true;
				setAttributes( {
					imageX: parseFloat( msg.imageX.toFixed( 6 ) ),
					imageY: parseFloat( msg.imageY.toFixed( 6 ) ),
					imageZoom: parseFloat( msg.imageZoom.toFixed( 6 ) ),
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

			if ( msg.type === 'bflm_overlay_update' ) {
				const currentOverlays = attributesRef.current.overlays || [];
				setAttributes( {
					overlays: currentOverlays.map( ( o, i ) =>
						i === msg.overlayIndex
							? { ...o, bounds: `${ msg.sw };${ msg.ne }` }
							: o
					),
				} );
				return;
			}

			if ( msg.type === 'bflm_linepoint_update' ) {
				const currentLines = attributesRef.current.lines || [];
				const li = msg.lineIndex;
				const pi = msg.pointIndex;
				const updatedLines = currentLines.map( ( l, i ) => {
					if ( i !== li ) {
						return l;
					}
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
				if ( ! line ) {
					return;
				}
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
				if ( ! iframe || ! iframe.contentWindow ) {
					return;
				}
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
				if ( ! currentCircles[ ci ] ) {
					return;
				}
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
				if ( ! currentCircles[ ci ] ) {
					return;
				}
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

		const { candidates: results, error } =
			await bflmGeocodeAddress( addressInput );

		if ( error ) {
			setGeocodeStatus( 'error' );
			setGeocodeError( error );
			return;
		}

		if ( results.length === 1 ) {
			applyCandidate( results[ 0 ] );
		} else {
			setCandidates( results );
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
		/**
		 * Shift keyed-by-index state: drop deleted entry, decrement keys above it.
		 * @param {Object} prev Previous keyed-by-index state object.
		 */
		function shiftDown( prev ) {
			const next = {};
			for ( const [ k, v ] of Object.entries( prev ) ) {
				const n = Number( k );
				if ( n === index ) {
					continue;
				}
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
	 * @param {number}                       index     Marker index.
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

		const { candidates: results, error } =
			await bflmGeocodeAddress( query );

		if ( error ) {
			updateMarkerSearch( index, { status: 'error', error } );
			return;
		}

		if ( results.length === 1 ) {
			applyMarkerCandidate( index, results[ 0 ] );
		} else {
			updateMarkerSearch( index, {
				status: 'candidates',
				candidates: results,
			} );
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
				if ( li === index ) {
					continue;
				}
				next[ `${ li > index ? li - 1 : li }_${ pi }` ] = v;
			}
			return next;
		} );
		setExpandedLineIndex( ( prev ) => {
			if ( prev === null ) {
				return null;
			}
			if ( prev === index ) {
				return null;
			}
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
		if ( ! line ) {
			return;
		}
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
		if ( ! line ) {
			return;
		}
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
				if ( pi === pointIndex ) {
					continue;
				}
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
		if ( ! line ) {
			return;
		}
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
		if ( ! iframe || ! iframe.contentWindow ) {
			return;
		}
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
		if ( ! iframe || ! iframe.contentWindow ) {
			return;
		}
		const line = ( attributesRef.current.lines || [] )[ lineIndex ];
		if ( ! line ) {
			return;
		}
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
		if ( ! iframe ) {
			return;
		}
		if ( iframe.contentWindow ) {
			iframe.contentWindow.postMessage(
				{ type: 'bflm_draw_end', blockId: clientId },
				'*'
			);
		}
	}

	/**
	 * Apply a geocode candidate to a specific line point and pan to it.
	 * @param {number}                       lineIndex
	 * @param {number}                       pointIndex
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
		if ( ! query ) {
			return;
		}
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

	/** Append a new circle with default values. lat/lng left null until user clicks on map. */
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
					lat: null,
					lng: null,
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
			circles: ( attributes.circles || [] ).filter(
				( _, i ) => i !== index
			),
		} );
		setCircleSearch( ( prev ) => {
			const next = {};
			for ( const [ k, v ] of Object.entries( prev ) ) {
				const ki = Number( k );
				if ( ki === index ) {
					continue;
				}
				next[ String( ki > index ? ki - 1 : ki ) ] = v;
			}
			return next;
		} );
		setCircleRadiusUnit( ( prev ) => {
			const next = {};
			for ( const [ k, v ] of Object.entries( prev ) ) {
				const ki = Number( k );
				if ( ki === index ) {
					continue;
				}
				next[ String( ki > index ? ki - 1 : ki ) ] = v;
			}
			return next;
		} );
		setExpandedCircleIndex( ( prev ) => {
			if ( prev === null ) {
				return null;
			}
			if ( prev === index ) {
				return null;
			}
			return prev > index ? prev - 1 : prev;
		} );
		setDrawingCircleIndex( ( prev ) => {
			if ( prev === null ) {
				return null;
			}
			if ( prev === index ) {
				return null;
			}
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
	 * Add a new data layer of the given type and expand it.
	 * @param {string} type Layer type: geojson, gpx or kml.
	 */
	function handleAddLayer( type ) {
		const next = [
			...( attributes.layers || [] ),
			{
				type,
				src: '',
				fitbounds: false,
				popupText: '',
				popupProperty: '',
				tableView: false,
				color: '',
				weight: null,
				opacity: null,
				dashArray: '',
				classname: '',
				fill: false,
				fillColor: '',
				fillOpacity: null,
				useCustomIcon: false,
				iconUrl: '',
				iconWidth: null,
				iconHeight: null,
				iconAnchorX: null,
				iconAnchorY: null,
				popupAnchorX: null,
				popupAnchorY: null,
				iconOriginalWidth: null,
				iconOriginalHeight: null,
				lockIconAspectRatio: true,
			},
		];
		setAttributes( { layers: next } );
		setExpandedLayerIndex( next.length - 1 );
	}

	/**
	 * Remove a layer by index.
	 * @param {number} index Layer index to remove.
	 */
	function handleRemoveLayer( index ) {
		setAttributes( {
			layers: ( attributes.layers || [] ).filter(
				( _, i ) => i !== index
			),
		} );
		if ( expandedLayerIndex === index ) {
			setExpandedLayerIndex( null );
		} else if ( expandedLayerIndex > index ) {
			setExpandedLayerIndex( expandedLayerIndex - 1 );
		}
	}

	/**
	 * Shallow-merge updates into a layer at the given index.
	 * @param {number} index   Layer index.
	 * @param {Object} updates Attribute updates to merge.
	 */
	function handleUpdateLayer( index, updates ) {
		setAttributes( {
			layers: ( attributes.layers || [] ).map( ( l, i ) =>
				i === index ? { ...l, ...updates } : l
			),
		} );
	}

	/**
	 * Compute a "SW;NE" bounds string centred on the current map view, sized to
	 * roughly half the visible viewport (Web Mercator metres-per-pixel formula)
	 * so a freshly added overlay lands in view instead of needing manual bounds
	 * first (an empty bounds value makes bflm_build_overlay_shortcodes() skip
	 * the overlay entirely — see includes/shortcodes/overlay.php).
	 *
	 * @param {number} centerLat Current map latitude.
	 * @param {number} centerLng Current map longitude.
	 * @param {number} mapZoom   Current map zoom level.
	 * @return {string} Bounds string, e.g. "40.71,-74.22;40.77,-74.12".
	 */
	function computeDefaultOverlayBounds( centerLat, centerLng, mapZoom ) {
		const metersPerPixel =
			( 156543.03392 * Math.cos( ( centerLat * Math.PI ) / 180 ) ) /
			Math.pow( 2, mapZoom );
		// Half the size of a typical map container, in pixels, used as the
		// overlay's half-width/height so it covers a sensible chunk of the
		// current view with margin on every side.
		const halfSizePx = 200;
		const metersOffset = metersPerPixel * halfSizePx;

		const latOffset = metersOffset / 111320;
		const lngOffset =
			metersOffset /
			( 111320 * Math.cos( ( centerLat * Math.PI ) / 180 ) );

		const sw = `${ ( centerLat - latOffset ).toFixed( 6 ) },${ (
			centerLng - lngOffset
		).toFixed( 6 ) }`;
		const ne = `${ ( centerLat + latOffset ).toFixed( 6 ) },${ (
			centerLng + lngOffset
		).toFixed( 6 ) }`;
		return `${ sw };${ ne }`;
	}

	/**
	 * Add a new overlay of the given type and expand it.
	 * @param {string} type Overlay type: image or video.
	 */
	function handleAddOverlay( type ) {
		const next = [
			...( attributes.overlays || [] ),
			{
				type,
				src: '',
				bounds: computeDefaultOverlayBounds( lat, lng, zoom ),
				opacity: null,
				interactive: false,
				alt: '',
				zIndex: null,
				classname: '',
				keepAspectRatio: true,
			},
		];
		setAttributes( { overlays: next } );
		setExpandedOverlayIndex( next.length - 1 );
	}

	/**
	 * Remove an overlay by index.
	 * @param {number} index Overlay index to remove.
	 */
	function handleRemoveOverlay( index ) {
		setAttributes( {
			overlays: ( attributes.overlays || [] ).filter(
				( _, i ) => i !== index
			),
		} );
		if ( expandedOverlayIndex === index ) {
			setExpandedOverlayIndex( null );
		} else if ( expandedOverlayIndex > index ) {
			setExpandedOverlayIndex( expandedOverlayIndex - 1 );
		}
	}

	/**
	 * Shallow-merge updates into an overlay at the given index.
	 * @param {number} index   Overlay index.
	 * @param {Object} updates Attribute updates to merge.
	 */
	function handleUpdateOverlay( index, updates ) {
		setAttributes( {
			overlays: ( attributes.overlays || [] ).map( ( o, i ) =>
				i === index ? { ...o, ...updates } : o
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
		if ( ! iframe || ! iframe.contentWindow ) {
			return;
		}
		const circle = ( attributesRef.current.circles || [] )[ circleIndex ];
		if ( ! circle ) {
			return;
		}
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
		if ( ! iframe ) {
			return;
		}
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
	 * @param {number}                       index
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
		if ( ! query ) {
			return;
		}
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
			updateCircleSearch( index, {
				status: 'candidates',
				candidates: found,
			} );
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
							'cartoblocks-for-leaflet'
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
								{ __( 'Shortcode', 'cartoblocks-for-leaflet' ) }
							</span>
							<button
								type="button"
								className="bflm-shortcode-popover__copy"
								onClick={ handleCopy }
								onMouseDown={ ( e ) => e.stopPropagation() }
							>
								{ isCopied
									? __( 'Copied!', 'cartoblocks-for-leaflet' )
									: __( 'Copy', 'cartoblocks-for-leaflet' ) }
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
					title={ __( 'Location', 'cartoblocks-for-leaflet' ) }
					initialOpen={ true }
				>
					<ToggleControl
						label={ __(
							'Image map mode',
							'cartoblocks-for-leaflet'
						) }
						help={ __(
							'Replace tile layer with a flat image. Coordinates become pixel positions.',
							'cartoblocks-for-leaflet'
						) }
						checked={ imageMap }
						onChange={ ( value ) =>
							setAttributes( { imageMap: value } )
						}
						__nextHasNoMarginBottom
					/>

					{ imageMap && (
						<>
							<MediaUploadCheck>
								<MediaUpload
									onSelect={ ( media ) =>
										setAttributes( {
											imageSrc: media.url,
										} )
									}
									allowedTypes={ [ 'image' ] }
									value={ imageSrc }
									render={ ( { open } ) => (
										<>
											{ imageSrc && (
												<img
													src={ imageSrc }
													alt=""
													style={ {
														width: '100%',
														height: 'auto',
														display: 'block',
														marginBottom: '8px',
														borderRadius: '2px',
													} }
												/>
											) }
											<Button
												variant="secondary"
												onClick={ open }
												style={ {
													width: '100%',
													justifyContent: 'center',
													marginBottom: '8px',
												} }
											>
												{ imageSrc
													? __(
															'Replace image',
															'cartoblocks-for-leaflet'
													  )
													: __(
															'Select image',
															'cartoblocks-for-leaflet'
													  ) }
											</Button>
										</>
									) }
								/>
							</MediaUploadCheck>
							<TextControl
								label={ __(
									'Image URL',
									'cartoblocks-for-leaflet'
								) }
								help={ __(
									'Paste an external image URL, or use the picker above.',
									'cartoblocks-for-leaflet'
								) }
								value={ imageSrc }
								onChange={ ( value ) =>
									setAttributes( { imageSrc: value } )
								}
								type="url"
								__next40pxDefaultSize
								__nextHasNoMarginBottom
							/>
							<NumberControl
								label={ __(
									'Center X (pixels)',
									'cartoblocks-for-leaflet'
								) }
								value={ imageX }
								onChange={ ( value ) =>
									setAttributes( {
										imageX: parseFloat( value ) || 0,
									} )
								}
								step={ 1 }
								__next40pxDefaultSize
							/>
							<NumberControl
								label={ __(
									'Center Y (pixels)',
									'cartoblocks-for-leaflet'
								) }
								value={ imageY }
								onChange={ ( value ) =>
									setAttributes( {
										imageY: parseFloat( value ) || 0,
									} )
								}
								step={ 1 }
								__next40pxDefaultSize
							/>
							<RangeControl
								label={ __(
									'Zoom Level',
									'cartoblocks-for-leaflet'
								) }
								help={ __(
									'0 = fit image to block. Positive = zoom in, negative = zoom out.',
									'cartoblocks-for-leaflet'
								) }
								value={ imageZoom ?? 0 }
								onChange={ ( value ) =>
									setAttributes( { imageZoom: value } )
								}
								min={ -3 }
								max={ 3 }
								step={ 0.1 }
								__next40pxDefaultSize
								__nextHasNoMarginBottom
							/>
						</>
					) }

					{ ! imageMap && (
						<RadioControl
							label={ __(
								'Input mode',
								'cartoblocks-for-leaflet'
							) }
							selected={ locationMode }
							options={ [
								{
									label: __(
										'Coordinates',
										'cartoblocks-for-leaflet'
									),
									value: 'coordinates',
								},
								{
									label: __(
										'Address',
										'cartoblocks-for-leaflet'
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
					) }

					{ ! imageMap && locationMode === 'coordinates' && (
						<>
							<NumberControl
								label={ __(
									'Latitude',
									'cartoblocks-for-leaflet'
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
									'cartoblocks-for-leaflet'
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

					{ ! imageMap && locationMode === 'address' && (
						<>
							<TextControl
								label={ __(
									'Address',
									'cartoblocks-for-leaflet'
								) }
								value={ addressInput }
								placeholder={ __(
									'Enter an address…',
									'cartoblocks-for-leaflet'
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
								{ __( 'Search', 'cartoblocks-for-leaflet' ) }
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
												'cartoblocks-for-leaflet'
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

					{ ! imageMap && (
						<RangeControl
							label={ __(
								'Zoom Level',
								'cartoblocks-for-leaflet'
							) }
							value={ zoom }
							onChange={ ( value ) =>
								setAttributes( { zoom: value } )
							}
							min={ minZoom ? parseInt( minZoom, 10 ) : 1 }
							max={ maxZoom ? parseInt( maxZoom, 10 ) : 20 }
							__next40pxDefaultSize
							__nextHasNoMarginBottom
						/>
					) }
					{ ! imageMap && (
						<ToggleControl
							label={ __(
								'Fit to Markers',
								'cartoblocks-for-leaflet'
							) }
							help={ __(
								'Automatically adjust the map view to contain all markers.',
								'cartoblocks-for-leaflet'
							) }
							checked={ fitMarkers }
							onChange={ ( value ) =>
								setAttributes( { fitMarkers: value } )
							}
							__nextHasNoMarginBottom
						/>
					) }
				</PanelBody>

				{ /* ── Dimensions panel ───────────────────────────────────── */ }
				<PanelBody
					title={ __( 'Dimensions', 'cartoblocks-for-leaflet' ) }
					initialOpen={ false }
				>
					<UnitControl
						label={ __( 'Height', 'cartoblocks-for-leaflet' ) }
						value={ normalizedHeight }
						units={ DIMENSION_UNITS }
						min={ 0 }
						onChange={ ( value ) =>
							setAttributes( { height: value } )
						}
						__next40pxDefaultSize
					/>
					<UnitControl
						key={ widthControlKey }
						label={ __( 'Width', 'cartoblocks-for-leaflet' ) }
						value={ normalizedWidth }
						units={ DIMENSION_UNITS }
						min={ 0 }
						onChange={ ( value ) => {
							// Clamp % values to 100 and force re-mount so the
							// input resets to the clamped value.
							if ( value && value.endsWith( '%' ) ) {
								const n = parseFloat( value );
								if ( ! isNaN( n ) && n > 100 ) {
									setAttributes( { width: '100%' } );
									setWidthControlKey( ( k ) => k + 1 );
									return;
								}
							}
							setAttributes( { width: value } );
						} }
						__next40pxDefaultSize
					/>
				</PanelBody>

				{ /* ── Interaction panel ───────────────────────────────────── */ }
				{ ! imageMap && (
					<PanelBody
						title={ __( 'Interaction', 'cartoblocks-for-leaflet' ) }
						initialOpen={ false }
					>
						<ToggleControl
							label={ __(
								'Scroll Wheel Zoom',
								'cartoblocks-for-leaflet'
							) }
							checked={ scrollWheelZoom }
							onChange={ ( value ) =>
								setAttributes( { scrollWheelZoom: value } )
							}
							__nextHasNoMarginBottom
						/>
						<SelectControl
							label={ __(
								'Dragging',
								'cartoblocks-for-leaflet'
							) }
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
								'cartoblocks-for-leaflet'
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
								'cartoblocks-for-leaflet'
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
							label={ __(
								'Box Zoom',
								'cartoblocks-for-leaflet'
							) }
							help={ __(
								'Shift + drag to zoom to area.',
								'cartoblocks-for-leaflet'
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
								'cartoblocks-for-leaflet'
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
							label={ __( 'Tap', 'cartoblocks-for-leaflet' ) }
							help={ __(
								'Mobile tap interaction.',
								'cartoblocks-for-leaflet'
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
							label={ __( 'Inertia', 'cartoblocks-for-leaflet' ) }
							help={ __(
								'Pan inertia after dragging.',
								'cartoblocks-for-leaflet'
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
				) }

				{ /* ── Zoom & Bounds panel ────────────────────────────────── */ }
				{ ! imageMap && (
					<PanelBody
						title={ __(
							'Zoom & Bounds',
							'cartoblocks-for-leaflet'
						) }
						initialOpen={ false }
					>
						<TextControl
							label={ __(
								'Min Zoom',
								'cartoblocks-for-leaflet'
							) }
							help={ __(
								'Minimum zoom level allowed. Leave empty for global default.',
								'cartoblocks-for-leaflet'
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
							label={ __(
								'Max Zoom',
								'cartoblocks-for-leaflet'
							) }
							help={ __(
								'Maximum zoom level allowed. Leave empty for global default.',
								'cartoblocks-for-leaflet'
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
							label={ __(
								'Max Bounds',
								'cartoblocks-for-leaflet'
							) }
							help={ __(
								'Restrict the map view to a bounding box. Format: lat,lng;lat,lng (southwest;northeast). Example: 40.0,-4.0;38.0,-3.0',
								'cartoblocks-for-leaflet'
							) }
							value={ maxBounds }
							onChange={ ( value ) =>
								setAttributes( { maxBounds: value } )
							}
							__next40pxDefaultSize
							__nextHasNoMarginBottom
						/>
					</PanelBody>
				) }

				{ /* ── Tile Layer panel ──────────────────────────────────── */ }
				{ ! imageMap && (
					<PanelBody
						title={ __( 'Tile Layer', 'cartoblocks-for-leaflet' ) }
						initialOpen={ false }
					>
						<p>
							{ __(
								'Override the global Leaflet Map tile settings for this specific map.',
								'cartoblocks-for-leaflet'
							) }
						</p>
						<ToggleControl
							label={ __(
								'Use WMS tile source',
								'cartoblocks-for-leaflet'
							) }
							help={ __(
								'Replaces the standard tile layer with a WMS (Web Map Service) source. Emits [leaflet-wms] instead of [leaflet-map].',
								'cartoblocks-for-leaflet'
							) }
							checked={ wmsEnabled }
							onChange={ ( value ) =>
								setAttributes( { wmsEnabled: value } )
							}
							__nextHasNoMarginBottom
						/>
						{ wmsEnabled && (
							<>
								<TextControl
									label={ __(
										'WMS URL',
										'cartoblocks-for-leaflet'
									) }
									placeholder="https://ows.mundialis.de/services/service?"
									help={ __(
										'The WMS service endpoint URL. Must end with ? or &.',
										'cartoblocks-for-leaflet'
									) }
									value={ wmsSource }
									onChange={ ( value ) =>
										setAttributes( { wmsSource: value } )
									}
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>
								<TextControl
									label={ __(
										'Layer',
										'cartoblocks-for-leaflet'
									) }
									placeholder="TOPO-OSM-WMS"
									help={ __(
										'WMS layer name. Leave empty to use the bozdoz default (TOPO-OSM-WMS).',
										'cartoblocks-for-leaflet'
									) }
									value={ wmsLayer }
									onChange={ ( value ) =>
										setAttributes( { wmsLayer: value } )
									}
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>
								<TextControl
									label={ __(
										'CRS',
										'cartoblocks-for-leaflet'
									) }
									placeholder="EPSG:3857"
									help={ __(
										'Coordinate Reference System (e.g. EPSG:3857, EPSG:4326). Leave empty to use the bozdoz default.',
										'cartoblocks-for-leaflet'
									) }
									value={ wmsCrs }
									onChange={ ( value ) =>
										setAttributes( { wmsCrs: value } )
									}
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>
							</>
						) }
						{ ! wmsEnabled && (
							<>
								<TextControl
									label={ __(
										'Tile URL',
										'cartoblocks-for-leaflet'
									) }
									placeholder="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
									help={
										<>
											{ __(
												'Browse providers:',
												'cartoblocks-for-leaflet'
											) }
											<a
												href="https://alexurquhart.github.io/free-tiles/"
												target="_blank"
												rel="noopener noreferrer"
												aria-label={ sprintf(
													// translators: %s is the name of the external link's destination.
													__(
														'%s (opens in new tab)',
														'cartoblocks-for-leaflet'
													),
													__(
														'Free Tile Services',
														'cartoblocks-for-leaflet'
													)
												) }
											>
												{ __(
													'Free Tile Services',
													'cartoblocks-for-leaflet'
												) }
												↗
											</a>
											{ ' · ' }
											<a
												href="https://leaflet-extras.github.io/leaflet-providers/preview/"
												target="_blank"
												rel="noopener noreferrer"
												aria-label={ sprintf(
													// translators: %s is the name of the external link's destination.
													__(
														'%s (opens in new tab)',
														'cartoblocks-for-leaflet'
													),
													__(
														'Leaflet Providers Preview',
														'cartoblocks-for-leaflet'
													)
												) }
											>
												{ __(
													'Leaflet Providers Preview',
													'cartoblocks-for-leaflet'
												) }
												↗
											</a>
											{ ' · ' }
											<a
												href="https://wiki.openstreetmap.org/wiki/Raster_tile_providers"
												target="_blank"
												rel="noopener noreferrer"
												aria-label={ sprintf(
													// translators: %s is the name of the external link's destination.
													__(
														'%s (opens in new tab)',
														'cartoblocks-for-leaflet'
													),
													__(
														'OSM Wiki',
														'cartoblocks-for-leaflet'
													)
												) }
											>
												{ __(
													'OSM Wiki',
													'cartoblocks-for-leaflet'
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
									label={ __(
										'Tile Size',
										'cartoblocks-for-leaflet'
									) }
									help={ __(
										"Default: 256. Most providers (OpenStreetMap, ArcGIS, CartoDB) use 256 — leave empty unless your provider's documentation explicitly requires a different value (e.g., Mapbox: 512). Changing this incorrectly will distort the map.",
										'cartoblocks-for-leaflet'
									) }
									value={ localTilesize }
									min={ 64 }
									onChange={ ( value ) =>
										setLocalTilesize( value ?? '' )
									}
									onBlur={ () =>
										setAttributes( {
											tilesize: localTilesize,
										} )
									}
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>
								<TextControl
									label={ __(
										'Subdomains',
										'cartoblocks-for-leaflet'
									) }
									help={ __(
										'Comma-separated list (e.g., a,b,c) matching the {s} placeholder in the Tile URL. Leave empty if not used.',
										'cartoblocks-for-leaflet'
									) }
									value={ subdomains }
									onChange={ ( value ) =>
										setAttributes( { subdomains: value } )
									}
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>
								<TextControl
									label={ __(
										'Map ID',
										'cartoblocks-for-leaflet'
									) }
									help={ __(
										'Required only for Mapbox tiles. Leave empty for other providers.',
										'cartoblocks-for-leaflet'
									) }
									value={ mapid }
									onChange={ ( value ) =>
										setAttributes( { mapid: value } )
									}
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>
								<TextControl
									label={ __(
										'Access Token',
										'cartoblocks-for-leaflet'
									) }
									help={ __(
										"Required only for providers that need authentication (e.g., Mapbox, Stadia, Thunderforest). This token will be visible in the page's HTML source — restrict it to your domain in the provider's dashboard.",
										'cartoblocks-for-leaflet'
									) }
									value={ accesstoken }
									onChange={ ( value ) =>
										setAttributes( { accesstoken: value } )
									}
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>
								<NumberControl
									label={ __(
										'Zoom Offset',
										'cartoblocks-for-leaflet'
									) }
									help={ __(
										'Default: 0. Only change for specific providers (Mapbox typically requires -1 when Tile Size is 512).',
										'cartoblocks-for-leaflet'
									) }
									value={ localZoomoffset }
									onChange={ ( value ) =>
										setLocalZoomoffset( value ?? '' )
									}
									onBlur={ () =>
										setAttributes( {
											zoomoffset: localZoomoffset,
										} )
									}
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>
								<SelectControl
									label={ __(
										'No Wrap',
										'cartoblocks-for-leaflet'
									) }
									help={ __(
										'Prevents the map from repeating horizontally when scrolled past the edges. Default: off.',
										'cartoblocks-for-leaflet'
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
										'cartoblocks-for-leaflet'
									) }
									help={ __(
										'Loads higher-resolution tiles on Retina/HiDPI screens. Only enable if the provider serves @2x tiles, otherwise the map will fail on those screens.',
										'cartoblocks-for-leaflet'
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
									label={ __(
										'Attribution',
										'cartoblocks-for-leaflet'
									) }
									help={ __(
										'Custom attribution HTML. Leave empty to use the default from Leaflet Map settings.',
										'cartoblocks-for-leaflet'
									) }
									value={ attribution }
									onChange={ ( value ) =>
										setAttributes( { attribution: value } )
									}
									rows={ 2 }
								/>
							</>
						) }
					</PanelBody>
				) }

				{ /* ── Map Controls panel ──────────────────────────────────── */ }
				{ ! imageMap && (
					<PanelBody
						title={ __(
							'Map Controls',
							'cartoblocks-for-leaflet'
						) }
						initialOpen={ false }
					>
						<ToggleControl
							label={ __(
								'Zoom Control',
								'cartoblocks-for-leaflet'
							) }
							checked={ zoomControl }
							onChange={ ( value ) =>
								setAttributes( { zoomControl: value } )
							}
							__nextHasNoMarginBottom
						/>
						<ToggleControl
							label={ __(
								'Show Scale',
								'cartoblocks-for-leaflet'
							) }
							help={ __(
								'Display a scale indicator on the map.',
								'cartoblocks-for-leaflet'
							) }
							checked={ showScale }
							onChange={ ( value ) =>
								setAttributes( { showScale: value } )
							}
							__nextHasNoMarginBottom
						/>
					</PanelBody>
				) }

				{ /* ── Markers panel ────────────────────────────────────────── */ }
				<PanelBody
					title={ sprintf(
						/* translators: %d: number of markers on the map. */
						__( 'Markers (%d)', 'cartoblocks-for-leaflet' ),
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
							'cartoblocks-for-leaflet'
						) }
					</Button>

					{ markers.map( ( marker, index ) => (
						<PanelBody
							key={ index }
							title={ sprintf(
								/* translators: %d: 1-based marker number. */
								__( 'Marker %d', 'cartoblocks-for-leaflet' ),
								index + 1
							) }
							initialOpen={ false }
						>
							{ /* ── Per-marker address search ─────────────────── */ }
							{ ! imageMap &&
								( () => {
									const ms = markerSearch[ index ] || {};
									const msInput = ms.input || '';
									const msStatus = ms.status || 'idle';
									const msCandidates = ms.candidates || [];
									return (
										<>
											<TextControl
												label={ __(
													'Search by address',
													'cartoblocks-for-leaflet'
												) }
												value={ msInput }
												placeholder={ __(
													'Enter an address…',
													'cartoblocks-for-leaflet'
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
												isBusy={
													msStatus === 'loading'
												}
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
													'cartoblocks-for-leaflet'
												) }
											</Button>

											{ msStatus === 'loading' && (
												<div
													style={ {
														display: 'flex',
														justifyContent:
															'center',
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
													style={ {
														marginTop: '8px',
													} }
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
																fontSize:
																	'11px',
																textTransform:
																	'uppercase',
																color: '#1e1e1e',
															} }
														>
															{ __(
																'Select a location:',
																'cartoblocks-for-leaflet'
															) }
														</p>
														{ msCandidates.map(
															(
																candidate,
																ci
															) => (
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
								label={
									imageMap
										? __(
												'Y (pixels)',
												'cartoblocks-for-leaflet'
										  )
										: __(
												'Latitude',
												'cartoblocks-for-leaflet'
										  )
								}
								value={ marker.lat }
								onChange={ ( value ) =>
									handleUpdateMarker( index, {
										lat: parseFloat( value ) || 0,
									} )
								}
								step={ imageMap ? 1 : 0.0001 }
								__next40pxDefaultSize
							/>
							<NumberControl
								label={
									imageMap
										? __(
												'X (pixels)',
												'cartoblocks-for-leaflet'
										  )
										: __(
												'Longitude',
												'cartoblocks-for-leaflet'
										  )
								}
								value={ marker.lng }
								onChange={ ( value ) =>
									handleUpdateMarker( index, {
										lng: parseFloat( value ) || 0,
									} )
								}
								step={ imageMap ? 1 : 0.0001 }
								__next40pxDefaultSize
							/>
							<TextControl
								label={ __(
									'Title',
									'cartoblocks-for-leaflet'
								) }
								help={ __(
									"Browser tooltip shown on hover. Also used as the marker's accessible name.",
									'cartoblocks-for-leaflet'
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
									'cartoblocks-for-leaflet'
								) }
								help={ __(
									'HTML is supported.',
									'cartoblocks-for-leaflet'
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
									'cartoblocks-for-leaflet'
								) }
								initialOpen={ false }
							>
								<TextControl
									label={ __(
										'Alt Text',
										'cartoblocks-for-leaflet'
									) }
									help={ __(
										'Alternative text for the marker image. Improves accessibility for screen reader users.',
										'cartoblocks-for-leaflet'
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
										'cartoblocks-for-leaflet'
									) }
									help={ __(
										'Open the popup automatically when the page loads.',
										'cartoblocks-for-leaflet'
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
										'cartoblocks-for-leaflet'
									) }
									help={ __(
										'Allow visitors to drag the marker. The new position is logged to the browser console.',
										'cartoblocks-for-leaflet'
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
										'cartoblocks-for-leaflet'
									) }
									help={ __(
										'Marker icon opacity. Default: 1 (fully opaque).',
										'cartoblocks-for-leaflet'
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
										'cartoblocks-for-leaflet'
									) }
									help={ __(
										'Raise or lower this marker relative to others. Leaflet already offsets markers by latitude, so you may need values of 10+ (or higher when markers are close together) to visibly change the stacking order.',
										'cartoblocks-for-leaflet'
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
									'cartoblocks-for-leaflet'
								) }
								initialOpen={ false }
							>
								<ToggleControl
									label={ __(
										'Use custom icon',
										'cartoblocks-for-leaflet'
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
												'cartoblocks-for-leaflet'
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
												'cartoblocks-for-leaflet'
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
																		'cartoblocks-for-leaflet'
																  )
																: __(
																		'Select image',
																		'cartoblocks-for-leaflet'
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
																		'cartoblocks-for-leaflet'
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
												'cartoblocks-for-leaflet'
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
													'cartoblocks-for-leaflet'
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
													'cartoblocks-for-leaflet'
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
												'cartoblocks-for-leaflet'
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
										<AnchorGrid
											label={ __(
												'Anchor position',
												'cartoblocks-for-leaflet'
											) }
											anchorX={ marker.iconAnchorX }
											anchorY={ marker.iconAnchorY }
											width={ marker.iconWidth }
											height={ marker.iconHeight }
											disabledHelp={ __(
												'Set icon size first',
												'cartoblocks-for-leaflet'
											) }
											onChange={ ( presetId ) => {
												const coords =
													computeAnchorFromPreset(
														presetId,
														marker.iconWidth,
														marker.iconHeight
													);
												if ( coords ) {
													handleUpdateMarker( index, {
														iconAnchorX: coords.x,
														iconAnchorY: coords.y,
													} );
												}
											} }
										/>
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
												'cartoblocks-for-leaflet'
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
													'cartoblocks-for-leaflet'
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
													'cartoblocks-for-leaflet'
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
												'cartoblocks-for-leaflet'
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
													'cartoblocks-for-leaflet'
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
													'cartoblocks-for-leaflet'
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
												'cartoblocks-for-leaflet'
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
														'cartoblocks-for-leaflet'
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
																				'cartoblocks-for-leaflet'
																		  )
																		: __(
																				'Select image',
																				'cartoblocks-for-leaflet'
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
																				'cartoblocks-for-leaflet'
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
														'cartoblocks-for-leaflet'
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
															'cartoblocks-for-leaflet'
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
															'cartoblocks-for-leaflet'
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
														'cartoblocks-for-leaflet'
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
												<AnchorGrid
													label={ __(
														'Anchor position',
														'cartoblocks-for-leaflet'
													) }
													anchorX={
														marker.shadowAnchorX
													}
													anchorY={
														marker.shadowAnchorY
													}
													width={ marker.shadowWidth }
													height={
														marker.shadowHeight
													}
													disabledHelp={ __(
														'Set shadow size first',
														'cartoblocks-for-leaflet'
													) }
													onChange={ ( presetId ) => {
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
												/>
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
														'cartoblocks-for-leaflet'
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
															'cartoblocks-for-leaflet'
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
															'cartoblocks-for-leaflet'
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
									'cartoblocks-for-leaflet'
								) }
								initialOpen={ false }
							>
								<ToggleControl
									label={ __(
										'Use SVG marker',
										'cartoblocks-for-leaflet'
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
												'cartoblocks-for-leaflet'
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
												'cartoblocks-for-leaflet'
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
												'cartoblocks-for-leaflet'
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
												'cartoblocks-for-leaflet'
											) }
											value={ marker.svgIconClass || '' }
											onChange={ ( value ) =>
												handleUpdateMarker( index, {
													svgIconClass: value,
												} )
											}
											help={ __(
												"CSS class for an icon font glyph (e.g. 'fas fa-star' for Font Awesome). Requires the icon font to be enqueued by your theme or another plugin — Leaflet Map does not load any icon font.",
												'cartoblocks-for-leaflet'
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
												'cartoblocks-for-leaflet'
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
												'cartoblocks-for-leaflet'
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
									'cartoblocks-for-leaflet'
								) }
							</Button>
						</PanelBody>
					) ) }
				</PanelBody>

				{ /* ── Lines & Polygons panel ────────────────────────────────────── */ }
				<PanelBody
					title={ sprintf(
						/* translators: %d: number of shapes */
						__(
							'Lines & Polygons (%d)',
							'cartoblocks-for-leaflet'
						),
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
							{ __( '+ Line', 'cartoblocks-for-leaflet' ) }
						</Button>
						<Button
							variant="secondary"
							onClick={ () => handleAddLine( 'polygon' ) }
							style={ { flex: 1, justifyContent: 'center' } }
						>
							{ __( '+ Polygon', 'cartoblocks-for-leaflet' ) }
						</Button>
					</div>

					{ ( lines || [] ).map( ( line, lineIdx ) => (
						<PanelBody
							key={ lineIdx }
							title={
								line.type === 'polygon'
									? sprintf(
											/* translators: 1: index, 2: point count */ __(
												'Polygon %1$d (%2$d pts)',
												'cartoblocks-for-leaflet'
											),
											lineIdx + 1,
											( line.points || [] ).length
									  )
									: sprintf(
											/* translators: 1: index, 2: point count */ __(
												'Line %1$d (%2$d pts)',
												'cartoblocks-for-leaflet'
											),
											lineIdx + 1,
											( line.points || [] ).length
									  )
							}
							opened={ expandedLineIndex === lineIdx }
							onToggle={ () =>
								setExpandedLineIndex( ( prev ) =>
									prev === lineIdx ? null : lineIdx
								)
							}
						>
							<SelectControl
								label={ __(
									'Type',
									'cartoblocks-for-leaflet'
								) }
								value={ line.type || 'line' }
								options={ [
									{
										value: 'line',
										label: __(
											'Line (polyline)',
											'cartoblocks-for-leaflet'
										),
									},
									{
										value: 'polygon',
										label: __(
											'Polygon',
											'cartoblocks-for-leaflet'
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
								{ __( 'Points', 'cartoblocks-for-leaflet' ) }
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
										'cartoblocks-for-leaflet'
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
												) {
													setOpenPoints(
														( prev ) => ( {
															...prev,
															[ lpKey ]:
																! prev[ lpKey ],
														} )
													);
												}
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
													// translators: %d is the point's position number in the list.
													__(
														'Point %d',
														'cartoblocks-for-leaflet'
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
													label={
														imageMap
															? __(
																	'Y (pixels)',
																	'cartoblocks-for-leaflet'
															  )
															: __(
																	'Latitude',
																	'cartoblocks-for-leaflet'
															  )
													}
													value={ point.lat }
													step={
														imageMap ? 1 : 0.000001
													}
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
													label={
														imageMap
															? __(
																	'X (pixels)',
																	'cartoblocks-for-leaflet'
															  )
															: __(
																	'Longitude',
																	'cartoblocks-for-leaflet'
															  )
													}
													value={ point.lng }
													step={
														imageMap ? 1 : 0.000001
													}
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
														'cartoblocks-for-leaflet'
													) }
												</Button>
												{ ! imageMap && (
													<div
														style={ {
															marginTop: '6px',
														} }
													>
														<TextControl
															label={ __(
																'Search by address',
																'cartoblocks-for-leaflet'
															) }
															placeholder={ __(
																'e.g. Paris, France',
																'cartoblocks-for-leaflet'
															) }
															value={ lpsInput }
															onChange={ ( v ) =>
																updateLinePointSearch(
																	lineIdx,
																	pi,
																	{ input: v }
																)
															}
															onKeyDown={ (
																e
															) => {
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
																marginTop:
																	'4px',
																width: '100%',
																justifyContent:
																	'center',
															} }
														>
															{ lpsStatus ===
															'loading'
																? __(
																		'Searching…',
																		'cartoblocks-for-leaflet'
																  )
																: __(
																		'Search',
																		'cartoblocks-for-leaflet'
																  ) }
														</Button>
														{ lpsStatus ===
															'error' &&
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
																	{
																		lps.error
																	}
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
																			'cartoblocks-for-leaflet'
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
												) }
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
												'cartoblocks-for-leaflet'
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
									'cartoblocks-for-leaflet'
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
										'cartoblocks-for-leaflet'
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
											'cartoblocks-for-leaflet'
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
											'cartoblocks-for-leaflet'
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
										'cartoblocks-for-leaflet'
									) }
								</p>
							) }

							<ToggleControl
								label={ __(
									'Fit map to this shape',
									'cartoblocks-for-leaflet'
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
									'cartoblocks-for-leaflet'
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
										'cartoblocks-for-leaflet'
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
										'cartoblocks-for-leaflet'
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
										'cartoblocks-for-leaflet'
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
										'cartoblocks-for-leaflet'
									) }
									value={ line.dashArray || '' }
									placeholder={ __(
										'e.g. 5,10',
										'cartoblocks-for-leaflet'
									) }
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
										'cartoblocks-for-leaflet'
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
								title={ __(
									'Fill',
									'cartoblocks-for-leaflet'
								) }
								initialOpen={ false }
							>
								<ToggleControl
									label={ __(
										'Fill shape',
										'cartoblocks-for-leaflet'
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
												'cartoblocks-for-leaflet'
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
												'cartoblocks-for-leaflet'
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
									'cartoblocks-for-leaflet'
								) }
								initialOpen={ false }
							>
								<TextareaControl
									label={ __(
										'Popup content (HTML allowed)',
										'cartoblocks-for-leaflet'
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
											'cartoblocks-for-leaflet'
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
											'cartoblocks-for-leaflet'
									  )
									: __(
											'Remove Line',
											'cartoblocks-for-leaflet'
									  ) }
							</Button>
						</PanelBody>
					) ) }
				</PanelBody>

				{ /* ── Circles panel ──────────────────────────────────── */ }
				<PanelBody
					title={ __( 'Circles', 'cartoblocks-for-leaflet' ) }
					initialOpen={ false }
				>
					<Button
						variant="secondary"
						onClick={ handleAddCircle }
						style={ {
							width: '100%',
							justifyContent: 'center',
							marginBottom: '8px',
						} }
					>
						{ __( '+ Circle', 'cartoblocks-for-leaflet' ) }
					</Button>

					{ ( attributes.circles || [] ).map(
						( circle, circleIdx ) => {
							const csKey = String( circleIdx );
							const cs = circleSearch[ csKey ] || {};
							const csStatus = cs.status || 'idle';
							const csInput = cs.input || '';
							const csCandidates = cs.candidates || [];
							const radiusUnit = circleRadiusUnit[ csKey ] || 'm';
							const displayRadius =
								radiusUnit === 'km'
									? parseFloat(
											(
												( circle.radius ?? 1000 ) / 1000
											).toFixed( 3 )
									  )
									: circle.radius ?? 1000;

							return (
								<PanelBody
									key={ circleIdx }
									title={ `${ __(
										'Circle',
										'cartoblocks-for-leaflet'
									) } ${ circleIdx + 1 }` }
									opened={ expandedCircleIndex === circleIdx }
									onToggle={ () =>
										setExpandedCircleIndex( ( prev ) =>
											prev === circleIdx
												? null
												: circleIdx
										)
									}
								>
									<p
										style={ {
											margin: '0 0 8px',
											fontSize: '11px',
											color: '#757575',
										} }
									>
										{ __(
											'Click "Draw on map" to set center + radius by clicking on the map, or enter coordinates manually.',
											'cartoblocks-for-leaflet'
										) }
									</p>

									<NumberControl
										label={
											imageMap
												? __(
														'Y (pixels)',
														'cartoblocks-for-leaflet'
												  )
												: __(
														'Latitude',
														'cartoblocks-for-leaflet'
												  )
										}
										value={ circle.lat ?? '' }
										step={ imageMap ? 1 : 0.000001 }
										onChange={ ( v ) =>
											handleUpdateCircle( circleIdx, {
												lat:
													v === '' || v == null
														? null
														: parseFloat( v ),
											} )
										}
										__next40pxDefaultSize={ true }
									/>
									<NumberControl
										label={
											imageMap
												? __(
														'X (pixels)',
														'cartoblocks-for-leaflet'
												  )
												: __(
														'Longitude',
														'cartoblocks-for-leaflet'
												  )
										}
										value={ circle.lng ?? '' }
										step={ imageMap ? 1 : 0.000001 }
										onChange={ ( v ) =>
											handleUpdateCircle( circleIdx, {
												lng:
													v === '' || v == null
														? null
														: parseFloat( v ),
											} )
										}
										__next40pxDefaultSize={ true }
									/>
									<Button
										variant="tertiary"
										onClick={ () =>
											handleLocatePoint(
												circle.lat ?? lat,
												circle.lng ?? lng
											)
										}
										style={ {
											marginTop: '4px',
											width: '100%',
											justifyContent: 'center',
										} }
									>
										{ __(
											'📍 Locate on map',
											'cartoblocks-for-leaflet'
										) }
									</Button>

									{ /* Geocoder */ }
									{ ! imageMap && (
										<div style={ { marginTop: '6px' } }>
											<TextControl
												label={ __(
													'Search by address',
													'cartoblocks-for-leaflet'
												) }
												placeholder={ __(
													'e.g. Paris, France',
													'cartoblocks-for-leaflet'
												) }
												value={ csInput }
												onChange={ ( v ) =>
													updateCircleSearch(
														circleIdx,
														{
															input: v,
														}
													)
												}
												onKeyDown={ ( e ) => {
													if ( e.key === 'Enter' ) {
														e.preventDefault();
														handleCircleGeocode(
															circleIdx
														);
													}
												} }
												__nextHasNoMarginBottom={ true }
											/>
											<Button
												variant="secondary"
												onClick={ () =>
													handleCircleGeocode(
														circleIdx
													)
												}
												isBusy={
													csStatus === 'loading'
												}
												disabled={
													csStatus === 'loading' ||
													! csInput.trim()
												}
												style={ {
													marginTop: '4px',
													width: '100%',
													justifyContent: 'center',
												} }
											>
												{ csStatus === 'loading'
													? __(
															'Searching…',
															'cartoblocks-for-leaflet'
													  )
													: __(
															'Search',
															'cartoblocks-for-leaflet'
													  ) }
											</Button>
											{ csStatus === 'error' &&
												cs.error && (
													<Notice
														status="warning"
														isDismissible={ false }
														style={ {
															marginTop: '6px',
														} }
													>
														{ cs.error }
													</Notice>
												) }
											{ csStatus === 'candidates' &&
												csCandidates.length > 0 && (
													<div
														style={ {
															marginTop: '6px',
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
																'cartoblocks-for-leaflet'
															) }
														</p>
														{ csCandidates.map(
															(
																candidate,
																cIdx
															) => (
																<Button
																	key={ cIdx }
																	variant="tertiary"
																	onClick={ () =>
																		applyCircleCandidate(
																			circleIdx,
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
									) }

									{ /* Radius + unit toggle */ }
									<div
										style={ {
											marginTop: '12px',
											display: 'flex',
											gap: '6px',
											alignItems: 'flex-end',
										} }
									>
										<div style={ { flex: 1 } }>
											<NumberControl
												label={ __(
													'Radius',
													'cartoblocks-for-leaflet'
												) }
												value={ displayRadius }
												step={
													radiusUnit === 'km'
														? 0.001
														: 1
												}
												min={ 0 }
												onChange={ ( v ) => {
													const meters =
														radiusUnit === 'km'
															? Math.round(
																	( parseFloat(
																		v
																	) || 0 ) *
																		1000
															  )
															: Math.round(
																	parseFloat(
																		v
																	) || 0
															  );
													handleUpdateCircle(
														circleIdx,
														{ radius: meters }
													);
												} }
												__next40pxDefaultSize={ true }
											/>
										</div>
										<div>
											<p
												style={ {
													margin: '0 0 2px',
													fontSize: '11px',
													color: '#1e1e1e',
												} }
											>
												{ __(
													'Unit',
													'cartoblocks-for-leaflet'
												) }
											</p>
											<SelectControl
												value={ radiusUnit }
												options={ [
													{
														label: __(
															'm',
															'cartoblocks-for-leaflet'
														),
														value: 'm',
													},
													{
														label: __(
															'km',
															'cartoblocks-for-leaflet'
														),
														value: 'km',
													},
												] }
												onChange={ ( v ) =>
													setCircleRadiusUnit(
														( prev ) => ( {
															...prev,
															[ csKey ]: v,
														} )
													)
												}
												__nextHasNoMarginBottom={ true }
											/>
										</div>
									</div>

									{ /* Draw on map / Stop drawing */ }
									<div
										style={ {
											display: 'flex',
											gap: '6px',
											marginTop: '10px',
											marginBottom: '12px',
										} }
									>
										{ drawingCircleIndex === circleIdx ? (
											<Button
												variant="primary"
												onClick={
													handleStopDrawingCircle
												}
												style={ {
													flex: 1,
													justifyContent: 'center',
												} }
											>
												{ __(
													'⏹ Stop drawing',
													'cartoblocks-for-leaflet'
												) }
											</Button>
										) : (
											<Button
												variant="secondary"
												onClick={ () =>
													handleStartDrawingCircle(
														circleIdx
													)
												}
												style={ {
													flex: 1,
													justifyContent: 'center',
												} }
											>
												{ __(
													'✏ Draw on map',
													'cartoblocks-for-leaflet'
												) }
											</Button>
										) }
									</div>
									{ drawingCircleIndex === circleIdx && (
										<p
											style={ {
												margin: '-4px 0 12px',
												fontSize: '11px',
												color: '#1d4ed8',
												fontWeight: 600,
											} }
										>
											{ __(
												'🖱 Click map to set center, then click again to set radius.',
												'cartoblocks-for-leaflet'
											) }
										</p>
									) }

									<ToggleControl
										label={ __(
											'Fit map to this circle',
											'cartoblocks-for-leaflet'
										) }
										checked={ !! circle.fitbounds }
										onChange={ ( v ) =>
											handleUpdateCircle( circleIdx, {
												fitbounds: v,
											} )
										}
										__nextHasNoMarginBottom={ true }
									/>

									<PanelBody
										title={ __(
											'Style',
											'cartoblocks-for-leaflet'
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
												'cartoblocks-for-leaflet'
											) }
										</p>
										<ColorPalette
											value={ circle.color || undefined }
											onChange={ ( v ) =>
												handleUpdateCircle( circleIdx, {
													color: v || '',
												} )
											}
											enableAlpha={ false }
										/>
										<RangeControl
											label={ __(
												'Weight (px)',
												'cartoblocks-for-leaflet'
											) }
											value={ circle.weight ?? 3 }
											min={ 0 }
											max={ 20 }
											step={ 1 }
											onChange={ ( v ) =>
												handleUpdateCircle( circleIdx, {
													weight: v,
												} )
											}
											allowReset={ true }
											resetFallbackValue={ 3 }
											__next40pxDefaultSize={ true }
											__nextHasNoMarginBottom={ true }
										/>
										<RangeControl
											label={ __(
												'Opacity',
												'cartoblocks-for-leaflet'
											) }
											value={ circle.opacity ?? 1 }
											min={ 0 }
											max={ 1 }
											step={ 0.05 }
											onChange={ ( v ) =>
												handleUpdateCircle( circleIdx, {
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
												'cartoblocks-for-leaflet'
											) }
											value={ circle.dashArray || '' }
											placeholder={ __(
												'e.g. 5,10',
												'cartoblocks-for-leaflet'
											) }
											onChange={ ( v ) =>
												handleUpdateCircle( circleIdx, {
													dashArray: v,
												} )
											}
											__nextHasNoMarginBottom={ true }
										/>
										<TextControl
											label={ __(
												'CSS class',
												'cartoblocks-for-leaflet'
											) }
											value={ circle.classname || '' }
											onChange={ ( v ) =>
												handleUpdateCircle( circleIdx, {
													classname: v,
												} )
											}
											__nextHasNoMarginBottom={ true }
										/>
									</PanelBody>

									<PanelBody
										title={ __(
											'Fill',
											'cartoblocks-for-leaflet'
										) }
										initialOpen={ false }
									>
										<ToggleControl
											label={ __(
												'Fill circle',
												'cartoblocks-for-leaflet'
											) }
											checked={ !! circle.fill }
											onChange={ ( v ) =>
												handleUpdateCircle( circleIdx, {
													fill: v,
												} )
											}
											__nextHasNoMarginBottom={ true }
										/>
										{ circle.fill && (
											<>
												<p
													style={ {
														margin: '8px 0 4px',
														fontSize: '12px',
													} }
												>
													{ __(
														'Fill color',
														'cartoblocks-for-leaflet'
													) }
												</p>
												<ColorPalette
													value={
														circle.fillColor ||
														undefined
													}
													onChange={ ( v ) =>
														handleUpdateCircle(
															circleIdx,
															{
																fillColor:
																	v || '',
															}
														)
													}
													enableAlpha={ false }
												/>
												<RangeControl
													label={ __(
														'Fill opacity',
														'cartoblocks-for-leaflet'
													) }
													value={
														circle.fillOpacity ??
														0.2
													}
													min={ 0 }
													max={ 1 }
													step={ 0.05 }
													onChange={ ( v ) =>
														handleUpdateCircle(
															circleIdx,
															{ fillOpacity: v }
														)
													}
													allowReset={ true }
													resetFallbackValue={ 0.2 }
													__next40pxDefaultSize={
														true
													}
													__nextHasNoMarginBottom={
														true
													}
												/>
											</>
										) }
									</PanelBody>

									<PanelBody
										title={ __(
											'Popup',
											'cartoblocks-for-leaflet'
										) }
										initialOpen={ false }
									>
										<TextareaControl
											label={ __(
												'Popup content (HTML allowed)',
												'cartoblocks-for-leaflet'
											) }
											value={ circle.popup || '' }
											onChange={ ( v ) =>
												handleUpdateCircle( circleIdx, {
													popup: v,
												} )
											}
											rows={ 3 }
											__nextHasNoMarginBottom={ true }
										/>
										{ ( circle.popup || '' ).trim() && (
											<ToggleControl
												label={ __(
													'Open popup on load',
													'cartoblocks-for-leaflet'
												) }
												checked={ !! circle.visible }
												onChange={ ( v ) =>
													handleUpdateCircle(
														circleIdx,
														{ visible: v }
													)
												}
												__nextHasNoMarginBottom={ true }
											/>
										) }
									</PanelBody>

									<Button
										variant="link"
										isDestructive
										onClick={ () =>
											handleRemoveCircle( circleIdx )
										}
										style={ { marginTop: '8px' } }
									>
										{ __(
											'Remove Circle',
											'cartoblocks-for-leaflet'
										) }
									</Button>
								</PanelBody>
							);
						}
					) }
				</PanelBody>
				{ /* ── Data Layers panel ────────────────────────────────── */ }
				{ ! imageMap && (
					<PanelBody
						title={ __( 'Data Layers', 'cartoblocks-for-leaflet' ) }
						initialOpen={ false }
					>
						<p
							style={ {
								margin: '0 0 8px',
								fontSize: '11px',
								color: '#757575',
							} }
						>
							{ __(
								'Load GeoJSON, GPX, or KML data from a URL. Each layer renders on the map as vector features.',
								'cartoblocks-for-leaflet'
							) }
						</p>
						<div
							style={ {
								display: 'flex',
								gap: '4px',
								marginBottom: '8px',
							} }
						>
							<Button
								variant="secondary"
								onClick={ () => handleAddLayer( 'geojson' ) }
								style={ { flex: 1, justifyContent: 'center' } }
							>
								{ __( '+ GeoJSON', 'cartoblocks-for-leaflet' ) }
							</Button>
							<Button
								variant="secondary"
								onClick={ () => handleAddLayer( 'gpx' ) }
								style={ { flex: 1, justifyContent: 'center' } }
							>
								{ __( '+ GPX', 'cartoblocks-for-leaflet' ) }
							</Button>
							<Button
								variant="secondary"
								onClick={ () => handleAddLayer( 'kml' ) }
								style={ { flex: 1, justifyContent: 'center' } }
							>
								{ __( '+ KML', 'cartoblocks-for-leaflet' ) }
							</Button>
						</div>

						{ ( attributes.layers || [] ).map(
							( layer, layerIdx ) => (
								<PanelBody
									key={ layerIdx }
									title={ `${ layer.type.toUpperCase() } ${
										layerIdx + 1
									}${
										layer.src
											? ' — ' +
											  layer.src
													.split( '/' )
													.pop()
													.substring( 0, 30 )
											: ''
									}` }
									opened={ expandedLayerIndex === layerIdx }
									onToggle={ () =>
										setExpandedLayerIndex( ( prev ) =>
											prev === layerIdx ? null : layerIdx
										)
									}
								>
									<SelectControl
										label={ __(
											'Type',
											'cartoblocks-for-leaflet'
										) }
										value={ layer.type || 'geojson' }
										options={ [
											{
												label: __(
													'GeoJSON',
													'cartoblocks-for-leaflet'
												),
												value: 'geojson',
											},
											{
												label: __(
													'GPX',
													'cartoblocks-for-leaflet'
												),
												value: 'gpx',
											},
											{
												label: __(
													'KML',
													'cartoblocks-for-leaflet'
												),
												value: 'kml',
											},
										] }
										onChange={ ( v ) =>
											handleUpdateLayer( layerIdx, {
												type: v,
											} )
										}
										__next40pxDefaultSize
										__nextHasNoMarginBottom
									/>
									<TextControl
										label={ __(
											'Source URL',
											'cartoblocks-for-leaflet'
										) }
										value={ layer.src || '' }
										type="url"
										help={ __(
											'Full URL to a .geojson, .gpx, or .kml file. Must be publicly accessible (CORS-enabled).',
											'cartoblocks-for-leaflet'
										) }
										onChange={ ( v ) =>
											handleUpdateLayer( layerIdx, {
												src: v,
											} )
										}
										__next40pxDefaultSize
										__nextHasNoMarginBottom
									/>
									<ToggleControl
										label={ __(
											'Fit map to layer bounds',
											'cartoblocks-for-leaflet'
										) }
										checked={ layer.fitbounds || false }
										onChange={ ( v ) =>
											handleUpdateLayer( layerIdx, {
												fitbounds: v,
											} )
										}
										__nextHasNoMarginBottom
									/>
									{ /* Popup configuration */ }
									<PanelBody
										title={ __(
											'Popup configuration',
											'cartoblocks-for-leaflet'
										) }
										initialOpen={ false }
									>
										<p
											style={ {
												margin: '0 0 8px',
												fontSize: '11px',
												color: '#757575',
											} }
										>
											{ __(
												'Precedence (highest first): Show all properties as table → Single property → Popup template. GPX/KML files rarely expose feature properties — popup config is most useful for GeoJSON.',
												'cartoblocks-for-leaflet'
											) }
										</p>
										<TextareaControl
											label={ __(
												'Popup template',
												'cartoblocks-for-leaflet'
											) }
											value={ layer.popupText || '' }
											help={ __(
												'Use {property_name} placeholders to interpolate feature properties. E.g. "Name: {name}".',
												'cartoblocks-for-leaflet'
											) }
											onChange={ ( v ) =>
												handleUpdateLayer( layerIdx, {
													popupText: v,
												} )
											}
											__nextHasNoMarginBottom
										/>
										<TextControl
											label={ __(
												'Single property to display',
												'cartoblocks-for-leaflet'
											) }
											value={ layer.popupProperty || '' }
											help={ __(
												'Bare property name (e.g. "ciudad", not "{ciudad}"). When set, overrides the popup template above.',
												'cartoblocks-for-leaflet'
											) }
											onChange={ ( v ) =>
												handleUpdateLayer( layerIdx, {
													popupProperty: v,
												} )
											}
											__next40pxDefaultSize
											__nextHasNoMarginBottom
										/>
										<ToggleControl
											label={ __(
												'Show all properties as table',
												'cartoblocks-for-leaflet'
											) }
											help={ __(
												'Displays every feature property as an HTML table in the popup. Overrides the two fields above.',
												'cartoblocks-for-leaflet'
											) }
											checked={ layer.tableView || false }
											onChange={ ( v ) =>
												handleUpdateLayer( layerIdx, {
													tableView: v,
												} )
											}
											__nextHasNoMarginBottom
										/>
									</PanelBody>

									{ /* Default feature style */ }
									<PanelBody
										title={ __(
											'Default feature style',
											'cartoblocks-for-leaflet'
										) }
										initialOpen={ false }
									>
										<p
											style={ {
												margin: '0 0 8px',
												fontSize: '11px',
												color: '#757575',
											} }
										>
											{ __(
												'Applied as the default layer style. Feature properties (e.g. geojson.io stroke/fill) override these defaults per-feature.',
												'cartoblocks-for-leaflet'
											) }
										</p>
										<p
											style={ {
												margin: '0 0 8px',
												fontSize: '11px',
												color: '#b45309',
											} }
										>
											{ __(
												'Style applies to line and polygon features only. Point markers are not affected — use Custom point icon to customise them.',
												'cartoblocks-for-leaflet'
											) }
										</p>
										<p
											style={ {
												margin: '8px 0 4px',
												fontSize: '11px',
												fontWeight: 600,
											} }
										>
											{ __(
												'Stroke color',
												'cartoblocks-for-leaflet'
											) }
										</p>
										<ColorPalette
											value={ layer.color || '' }
											onChange={ ( v ) =>
												handleUpdateLayer( layerIdx, {
													color: v || '',
												} )
											}
										/>
										<RangeControl
											label={ __(
												'Weight',
												'cartoblocks-for-leaflet'
											) }
											value={ layer.weight ?? undefined }
											min={ 0 }
											max={ 20 }
											step={ 1 }
											allowReset
											onChange={ ( v ) =>
												handleUpdateLayer( layerIdx, {
													weight: v ?? null,
												} )
											}
											__nextHasNoMarginBottom
											__next40pxDefaultSize
										/>
										<RangeControl
											label={ __(
												'Stroke opacity',
												'cartoblocks-for-leaflet'
											) }
											value={ layer.opacity ?? undefined }
											min={ 0 }
											max={ 1 }
											step={ 0.05 }
											allowReset
											onChange={ ( v ) =>
												handleUpdateLayer( layerIdx, {
													opacity: v ?? null,
												} )
											}
											__nextHasNoMarginBottom
											__next40pxDefaultSize
										/>
										<TextControl
											label={ __(
												'Dash array',
												'cartoblocks-for-leaflet'
											) }
											value={ layer.dashArray || '' }
											placeholder="5,5"
											onChange={ ( v ) =>
												handleUpdateLayer( layerIdx, {
													dashArray: v,
												} )
											}
											__next40pxDefaultSize
											__nextHasNoMarginBottom
										/>
										<TextControl
											label={ __(
												'CSS class',
												'cartoblocks-for-leaflet'
											) }
											value={ layer.classname || '' }
											onChange={ ( v ) =>
												handleUpdateLayer( layerIdx, {
													classname: v,
												} )
											}
											__next40pxDefaultSize
											__nextHasNoMarginBottom
										/>
										<ToggleControl
											label={ __(
												'Fill',
												'cartoblocks-for-leaflet'
											) }
											checked={ layer.fill || false }
											onChange={ ( v ) =>
												handleUpdateLayer( layerIdx, {
													fill: v,
												} )
											}
											__nextHasNoMarginBottom
										/>
										{ layer.fill && (
											<>
												<p
													style={ {
														margin: '8px 0 4px',
														fontSize: '11px',
														fontWeight: 600,
													} }
												>
													{ __(
														'Fill color',
														'cartoblocks-for-leaflet'
													) }
												</p>
												<ColorPalette
													value={
														layer.fillColor || ''
													}
													onChange={ ( v ) =>
														handleUpdateLayer(
															layerIdx,
															{
																fillColor:
																	v || '',
															}
														)
													}
												/>
												<RangeControl
													label={ __(
														'Fill opacity',
														'cartoblocks-for-leaflet'
													) }
													value={
														layer.fillOpacity ??
														undefined
													}
													min={ 0 }
													max={ 1 }
													step={ 0.05 }
													allowReset
													onChange={ ( v ) =>
														handleUpdateLayer(
															layerIdx,
															{
																fillOpacity:
																	v ?? null,
															}
														)
													}
													__nextHasNoMarginBottom
													__next40pxDefaultSize
												/>
											</>
										) }
									</PanelBody>

									{ /* Custom point icon */ }
									<PanelBody
										title={ __(
											'Custom point icon',
											'cartoblocks-for-leaflet'
										) }
										initialOpen={ false }
									>
										<ToggleControl
											label={ __(
												'Use custom icon',
												'cartoblocks-for-leaflet'
											) }
											checked={
												layer.useCustomIcon || false
											}
											onChange={ ( v ) =>
												handleUpdateLayer( layerIdx, {
													useCustomIcon: v,
												} )
											}
											__nextHasNoMarginBottom
										/>
										{ layer.useCustomIcon && (
											<>
												<MediaUploadCheck>
													<MediaUpload
														onSelect={ (
															media
														) => {
															const updates = {
																iconUrl:
																	media.url,
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
																		media.width /
																			2
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
															handleUpdateLayer(
																layerIdx,
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
																		marginTop:
																			'8px',
																	} }
																>
																	{ layer.iconUrl
																		? __(
																				'Replace image',
																				'cartoblocks-for-leaflet'
																		  )
																		: __(
																				'Select image',
																				'cartoblocks-for-leaflet'
																		  ) }
																</Button>
																{ layer.iconUrl && (
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
																				layer.iconUrl
																			}
																		</p>
																		<Button
																			variant="link"
																			isDestructive
																			onClick={ () =>
																				handleUpdateLayer(
																					layerIdx,
																					{
																						iconUrl:
																							'',
																					}
																				)
																			}
																		>
																			{ __(
																				'Remove',
																				'cartoblocks-for-leaflet'
																			) }
																		</Button>
																	</>
																) }
															</>
														) }
													/>
												</MediaUploadCheck>
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
														'Icon Size (px)',
														'cartoblocks-for-leaflet'
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
															'cartoblocks-for-leaflet'
														) }
														value={
															layer.iconWidth ??
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
																handleUpdateLayer(
																	layerIdx,
																	{
																		iconWidth:
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
																layer.lockIconAspectRatio !==
																	false &&
																layer.iconHeight >=
																	1
															) {
																const result =
																	computeProportionalResize(
																		{
																			axis: 'w',
																			newVal: val,
																			wKey: 'iconWidth',
																			hKey: 'iconHeight',
																			origW: layer.iconOriginalWidth,
																			origH: layer.iconOriginalHeight,
																			curW: layer.iconWidth,
																			curH: layer.iconHeight,
																			anchors:
																				[
																					{
																						key: 'iconAnchorX',
																						val: layer.iconAnchorX,
																						axis: 'w',
																					},
																					{
																						key: 'iconAnchorY',
																						val: layer.iconAnchorY,
																						axis: 'h',
																					},
																					{
																						key: 'popupAnchorX',
																						val: layer.popupAnchorX,
																						axis: 'w',
																					},
																					{
																						key: 'popupAnchorY',
																						val: layer.popupAnchorY,
																						axis: 'h',
																					},
																				],
																		}
																	);
																if ( result ) {
																	handleUpdateLayer(
																		layerIdx,
																		result
																	);
																	return;
																}
															}
															handleUpdateLayer(
																layerIdx,
																{
																	iconWidth:
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
															'cartoblocks-for-leaflet'
														) }
														value={
															layer.iconHeight ??
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
																handleUpdateLayer(
																	layerIdx,
																	{
																		iconHeight:
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
																layer.lockIconAspectRatio !==
																	false &&
																layer.iconWidth >=
																	1
															) {
																const result =
																	computeProportionalResize(
																		{
																			axis: 'h',
																			newVal: val,
																			wKey: 'iconWidth',
																			hKey: 'iconHeight',
																			origW: layer.iconOriginalWidth,
																			origH: layer.iconOriginalHeight,
																			curW: layer.iconWidth,
																			curH: layer.iconHeight,
																			anchors:
																				[
																					{
																						key: 'iconAnchorX',
																						val: layer.iconAnchorX,
																						axis: 'w',
																					},
																					{
																						key: 'iconAnchorY',
																						val: layer.iconAnchorY,
																						axis: 'h',
																					},
																					{
																						key: 'popupAnchorX',
																						val: layer.popupAnchorX,
																						axis: 'w',
																					},
																					{
																						key: 'popupAnchorY',
																						val: layer.popupAnchorY,
																						axis: 'h',
																					},
																				],
																		}
																	);
																if ( result ) {
																	handleUpdateLayer(
																		layerIdx,
																		result
																	);
																	return;
																}
															}
															handleUpdateLayer(
																layerIdx,
																{
																	iconHeight:
																		val,
																}
															);
														} }
														style={ { flex: 1 } }
														__next40pxDefaultSize
													/>
												</div>
												<ToggleControl
													label={ __(
														'Lock aspect ratio',
														'cartoblocks-for-leaflet'
													) }
													checked={
														layer.lockIconAspectRatio !==
														false
													}
													onChange={ ( v ) =>
														handleUpdateLayer(
															layerIdx,
															{
																lockIconAspectRatio:
																	v,
															}
														)
													}
													style={ {
														marginTop: '8px',
													} }
													__nextHasNoMarginBottom
												/>
												{ /* Icon Anchor */ }
												<AnchorGrid
													label={ __(
														'Anchor position',
														'cartoblocks-for-leaflet'
													) }
													anchorX={
														layer.iconAnchorX
													}
													anchorY={
														layer.iconAnchorY
													}
													width={ layer.iconWidth }
													height={ layer.iconHeight }
													disabledHelp={ __(
														'Set icon size first',
														'cartoblocks-for-leaflet'
													) }
													onChange={ ( presetId ) => {
														const coords =
															computeAnchorFromPreset(
																presetId,
																layer.iconWidth,
																layer.iconHeight
															);
														if ( coords ) {
															handleUpdateLayer(
																layerIdx,
																{
																	iconAnchorX:
																		coords.x,
																	iconAnchorY:
																		coords.y,
																}
															);
														}
													} }
												/>
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
														'Icon Anchor (px)',
														'cartoblocks-for-leaflet'
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
															'cartoblocks-for-leaflet'
														) }
														value={
															layer.iconAnchorX ??
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
															handleUpdateLayer(
																layerIdx,
																{
																	iconAnchorX:
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
															'cartoblocks-for-leaflet'
														) }
														value={
															layer.iconAnchorY ??
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
															handleUpdateLayer(
																layerIdx,
																{
																	iconAnchorY:
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
														'Popup Anchor (px)',
														'cartoblocks-for-leaflet'
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
															'cartoblocks-for-leaflet'
														) }
														value={
															layer.popupAnchorX ??
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
															handleUpdateLayer(
																layerIdx,
																{
																	popupAnchorX:
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
															'cartoblocks-for-leaflet'
														) }
														value={
															layer.popupAnchorY ??
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
															handleUpdateLayer(
																layerIdx,
																{
																	popupAnchorY:
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
									</PanelBody>

									<Button
										variant="link"
										isDestructive
										onClick={ () =>
											handleRemoveLayer( layerIdx )
										}
										style={ { marginTop: '8px' } }
									>
										{ __(
											'Remove this layer',
											'cartoblocks-for-leaflet'
										) }
									</Button>
								</PanelBody>
							)
						) }
					</PanelBody>
				) }

				{ /* ── Overlays panel ──────────────────────────────────── */ }
				{ ! imageMap && (
					<PanelBody
						title={ sprintf(
							/* translators: %d: number of overlays. */
							__( 'Overlays (%d)', 'cartoblocks-for-leaflet' ),
							( overlays || [] ).length
						) }
						initialOpen={ false }
					>
						<p>
							{ __(
								'Add image or video layers pinned to map coordinates.',
								'cartoblocks-for-leaflet'
							) }
						</p>
						<div
							style={ {
								display: 'flex',
								gap: '8px',
								marginBottom: '12px',
							} }
						>
							<Button
								variant="secondary"
								onClick={ () => handleAddOverlay( 'image' ) }
							>
								{ __( '+ Image', 'cartoblocks-for-leaflet' ) }
							</Button>
							<Button
								variant="secondary"
								onClick={ () => handleAddOverlay( 'video' ) }
							>
								{ __( '+ Video', 'cartoblocks-for-leaflet' ) }
							</Button>
						</div>
						{ ( overlays || [] ).map( ( overlay, overlayIdx ) => (
							<PanelBody
								key={ overlayIdx }
								title={ sprintf(
									/* translators: 1: overlay type, 2: index number. */
									__(
										'%1$s overlay %2$d',
										'cartoblocks-for-leaflet'
									),
									overlay.type === 'video'
										? __(
												'Video',
												'cartoblocks-for-leaflet'
										  )
										: __(
												'Image',
												'cartoblocks-for-leaflet'
										  ),
									overlayIdx + 1
								) }
								initialOpen={
									expandedOverlayIndex === overlayIdx
								}
								onToggle={ ( isOpen ) =>
									setExpandedOverlayIndex(
										isOpen ? overlayIdx : null
									)
								}
							>
								<SelectControl
									label={ __(
										'Type',
										'cartoblocks-for-leaflet'
									) }
									value={ overlay.type }
									options={ [
										{
											value: 'image',
											label: __(
												'Image overlay',
												'cartoblocks-for-leaflet'
											),
										},
										{
											value: 'video',
											label: __(
												'Video overlay',
												'cartoblocks-for-leaflet'
											),
										},
									] }
									onChange={ ( value ) =>
										handleUpdateOverlay( overlayIdx, {
											type: value,
										} )
									}
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>
								<TextControl
									label={ __(
										'Source URL',
										'cartoblocks-for-leaflet'
									) }
									placeholder={
										overlay.type === 'video'
											? 'https://example.com/video.mp4'
											: 'https://example.com/image.jpg'
									}
									value={ overlay.src }
									onChange={ ( value ) =>
										handleUpdateOverlay( overlayIdx, {
											src: value,
										} )
									}
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>
								<TextControl
									label={ __(
										'Bounds',
										'cartoblocks-for-leaflet'
									) }
									placeholder="40.712,-74.226;40.773,-74.125"
									help={ __(
										'SW corner ; NE corner: lat1,lng1;lat2,lng2',
										'cartoblocks-for-leaflet'
									) }
									value={ overlay.bounds }
									onChange={ ( value ) =>
										handleUpdateOverlay( overlayIdx, {
											bounds: value,
										} )
									}
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>
								<RangeControl
									label={ __(
										'Opacity',
										'cartoblocks-for-leaflet'
									) }
									value={ overlay.opacity ?? 1 }
									min={ 0 }
									max={ 1 }
									step={ 0.05 }
									onChange={ ( value ) =>
										handleUpdateOverlay( overlayIdx, {
											opacity: value,
										} )
									}
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>
								<ToggleControl
									label={ __(
										'Interactive',
										'cartoblocks-for-leaflet'
									) }
									help={ __(
										'Allow mouse/touch events on this overlay.',
										'cartoblocks-for-leaflet'
									) }
									checked={ overlay.interactive }
									onChange={ ( value ) =>
										handleUpdateOverlay( overlayIdx, {
											interactive: value,
										} )
									}
									__nextHasNoMarginBottom
								/>
								{ overlay.type === 'image' && (
									<>
										<TextControl
											label={ __(
												'Alt text',
												'cartoblocks-for-leaflet'
											) }
											value={ overlay.alt }
											onChange={ ( value ) =>
												handleUpdateOverlay(
													overlayIdx,
													{ alt: value }
												)
											}
											__next40pxDefaultSize
											__nextHasNoMarginBottom
										/>
										<ToggleControl
											label={ __(
												'Keep aspect ratio',
												'cartoblocks-for-leaflet'
											) }
											checked={ overlay.keepAspectRatio }
											onChange={ ( value ) =>
												handleUpdateOverlay(
													overlayIdx,
													{ keepAspectRatio: value }
												)
											}
											__nextHasNoMarginBottom
										/>
									</>
								) }
								<NumberControl
									label={ __(
										'Z-Index',
										'cartoblocks-for-leaflet'
									) }
									value={ overlay.zIndex ?? '' }
									onChange={ ( value ) =>
										handleUpdateOverlay( overlayIdx, {
											zIndex:
												value !== '' && ! isNaN( value )
													? parseInt( value, 10 )
													: null,
										} )
									}
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>
								<TextControl
									label={ __(
										'CSS class',
										'cartoblocks-for-leaflet'
									) }
									value={ overlay.classname }
									onChange={ ( value ) =>
										handleUpdateOverlay( overlayIdx, {
											classname: value,
										} )
									}
									__next40pxDefaultSize
									__nextHasNoMarginBottom
								/>
								<Button
									isDestructive
									variant="secondary"
									onClick={ () =>
										handleRemoveOverlay( overlayIdx )
									}
								>
									{ __(
										'Remove this overlay',
										'cartoblocks-for-leaflet'
									) }
								</Button>
							</PanelBody>
						) ) }
					</PanelBody>
				) }
			</InspectorControls>

			<div
				{ ...blockProps }
				style={ {
					...( blockProps.style || {} ),
					width: normalizedWidth,
					marginLeft: 'auto',
					marginRight: 'auto',
				} }
			>
				<div style={ { position: 'relative' } }>
					{ imageMap && ! imageSrc && (
						<div
							style={ {
								width: '100%',
								height: normalizedHeight,
								display: 'block',
								backgroundImage:
									'linear-gradient(45deg,#ccc 25%,transparent 25%),' +
									'linear-gradient(-45deg,#ccc 25%,transparent 25%),' +
									'linear-gradient(45deg,transparent 75%,#ccc 75%),' +
									'linear-gradient(-45deg,transparent 75%,#ccc 75%)',
								backgroundSize: '16px 16px',
								backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
								backgroundColor: '#fff',
							} }
						/>
					) }
					<iframe
						ref={ iframeRef }
						width="100%"
						height={ normalizedHeight }
						style={ {
							border: 'none',
							display: imageMap && ! imageSrc ? 'none' : 'block',
						} }
						sandbox="allow-scripts allow-same-origin"
						title={ __( 'Map preview', 'cartoblocks-for-leaflet' ) }
						onLoad={ () => {
							// Handshake: tells the preview bridge which window
							// to reply to. Inside WordPress Playground the
							// editor is NOT window.top (the whole site runs in
							// nested iframes), so the bridge answers to this
							// message's event.source instead of assuming an
							// ancestor (see bflm_preview_bridge_js).
							iframeRef.current?.contentWindow?.postMessage(
								{
									type: 'bflm_editor_hello',
									blockId: clientIdRef.current,
								},
								'*'
							);
						} }
					/>
					{ ! isSelected && ! isOverlayInteracting && (
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
