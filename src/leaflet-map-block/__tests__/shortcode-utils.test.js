/**
 * Unit tests for shortcode utility functions extracted from edit.js.
 *
 * These functions are pure (no DOM, no WP deps) so they can be tested
 * directly via Jest without a full WP environment.
 */

// ── normalizeHeight ───────────────────────────────────────────────────────────

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

describe( 'normalizeHeight', () => {
	test( 'bare number → appends px', () => {
		expect( normalizeHeight( 300 ) ).toBe( '300px' );
	} );
	test( 'numeric string → appends px', () => {
		expect( normalizeHeight( '500' ) ).toBe( '500px' );
	} );
	test( 'valid CSS string → unchanged', () => {
		expect( normalizeHeight( '50vh' ) ).toBe( '50vh' );
		expect( normalizeHeight( '100%' ) ).toBe( '100%' );
		expect( normalizeHeight( '2.5em' ) ).toBe( '2.5em' );
	} );
	test( 'invalid value → default 400px', () => {
		expect( normalizeHeight( 'abc' ) ).toBe( '400px' );
		expect( normalizeHeight( '' ) ).toBe( '400px' );
		expect( normalizeHeight( null ) ).toBe( '400px' );
		expect( normalizeHeight( undefined ) ).toBe( '400px' );
	} );
} );

// ── buildLineShortcodes ───────────────────────────────────────────────────────

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

describe( 'buildLineShortcodes', () => {
	test( 'empty / null → empty string', () => {
		expect( buildLineShortcodes( [] ) ).toBe( '' );
		expect( buildLineShortcodes( null ) ).toBe( '' );
	} );

	test( 'line with < 2 points → skipped', () => {
		const lines = [ { type: 'line', points: [ { lat: 1, lng: 2 } ] } ];
		expect( buildLineShortcodes( lines ) ).toBe( '' );
	} );

	test( 'line with 2 points → self-closing leaflet-line', () => {
		const lines = [
			{
				type: 'line',
				points: [
					{ lat: 51.5, lng: -0.1 },
					{ lat: 52.0, lng: 0.0 },
				],
			},
		];
		const result = buildLineShortcodes( lines );
		expect( result ).toContain( '[leaflet-line' );
		expect( result ).toContain( 'latlngs="51.5,-0.1; 52,0"' );
		expect( result ).toContain( '/]' );
	} );

	test( 'polygon type → leaflet-polygon tag', () => {
		const lines = [
			{
				type: 'polygon',
				points: [
					{ lat: 1, lng: 1 },
					{ lat: 2, lng: 2 },
				],
			},
		];
		expect( buildLineShortcodes( lines ) ).toContain( '[leaflet-polygon' );
	} );

	test( 'line with popup → wrapping shortcode', () => {
		const lines = [
			{
				type: 'line',
				points: [
					{ lat: 0, lng: 0 },
					{ lat: 1, lng: 1 },
				],
				popup: 'Hello',
			},
		];
		const result = buildLineShortcodes( lines );
		expect( result ).toContain( ']Hello[/leaflet-line]' );
	} );

	test( 'color / weight / opacity attrs emitted', () => {
		const lines = [
			{
				type: 'line',
				points: [
					{ lat: 0, lng: 0 },
					{ lat: 1, lng: 1 },
				],
				color: '#f00',
				weight: 3,
				opacity: 0.8,
			},
		];
		const result = buildLineShortcodes( lines );
		expect( result ).toContain( 'color="#f00"' );
		expect( result ).toContain( 'weight="3"' );
		expect( result ).toContain( 'opacity="0.8"' );
	} );
} );

// ── buildCircleShortcodes ─────────────────────────────────────────────────────

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

describe( 'buildCircleShortcodes', () => {
	test( 'empty array returns empty string', () => {
		expect( buildCircleShortcodes( [] ) ).toBe( '' );
	} );

	test( 'null/undefined lat skipped', () => {
		expect(
			buildCircleShortcodes( [ { lat: null, lng: 1, radius: 500 } ] )
		).toBe( '' );
		expect(
			buildCircleShortcodes( [ { lat: 1, lng: undefined, radius: 500 } ] )
		).toBe( '' );
	} );

	test( 'zero or negative radius skipped', () => {
		expect(
			buildCircleShortcodes( [ { lat: 1, lng: 1, radius: 0 } ] )
		).toBe( '' );
		expect(
			buildCircleShortcodes( [ { lat: 1, lng: 1, radius: -100 } ] )
		).toBe( '' );
	} );

	test( 'basic circle emits self-closing shortcode', () => {
		const result = buildCircleShortcodes( [
			{ lat: 48.8566, lng: 2.3522, radius: 1000 },
		] );
		expect( result ).toContain( '[leaflet-circle lat="48.8566"' );
		expect( result ).toContain( 'lng="2.3522"' );
		expect( result ).toContain( 'radius="1000"' );
		expect( result ).toContain( ' /]' );
	} );

	test( 'popup emits open/close tags', () => {
		const result = buildCircleShortcodes( [
			{ lat: 1, lng: 2, radius: 500, popup: 'Hi there' },
		] );
		expect( result ).toContain( ']Hi there[/leaflet-circle]' );
	} );

	test( 'attributes are lowercase (fillcolor, fillopacity, dasharray)', () => {
		const result = buildCircleShortcodes( [
			{
				lat: 1,
				lng: 2,
				radius: 500,
				fillColor: '#abc',
				fillOpacity: 0.3,
				dashArray: '5,10',
			},
		] );
		expect( result ).toContain( 'fillcolor="#abc"' );
		expect( result ).toContain( 'fillopacity="0.3"' );
		expect( result ).toContain( 'dasharray="5,10"' );
	} );

	test( 'fill + fitbounds flags emitted', () => {
		const result = buildCircleShortcodes( [
			{ lat: 1, lng: 2, radius: 500, fill: true, fitbounds: true },
		] );
		expect( result ).toContain( 'fill="true"' );
		expect( result ).toContain( 'fitbounds="true"' );
	} );

	test( 'visible only emitted when popup present', () => {
		const withPopup = buildCircleShortcodes( [
			{ lat: 1, lng: 2, radius: 500, visible: true, popup: 'x' },
		] );
		const noPopup = buildCircleShortcodes( [
			{ lat: 1, lng: 2, radius: 500, visible: true },
		] );
		expect( withPopup ).toContain( 'visible="1"' );
		expect( noPopup ).not.toContain( 'visible' );
	} );

	test( 'multiple circles concatenated', () => {
		const circles = [
			{ lat: 0, lng: 0, radius: 100 },
			{ lat: 1, lng: 1, radius: 200 },
		];
		const result = buildCircleShortcodes( circles );
		expect( result.match( /\[leaflet-circle/g ) ).toHaveLength( 2 );
	} );

	test( 'default radius 1000 when radius property absent', () => {
		const result = buildCircleShortcodes( [ { lat: 1, lng: 2 } ] );
		expect( result ).toContain( 'radius="1000"' );
	} );
} );

// ── buildLayerShortcodes ──────────────────────────────────────────────────────

const LAYER_TYPE_TAGS = {
	geojson: 'leaflet-geojson',
	gpx: 'leaflet-gpx',
	kml: 'leaflet-kml',
};

function buildLayerShortcodes( layers ) {
	if ( ! layers || layers.length === 0 ) return '';
	let out = '';
	for ( const layer of layers ) {
		const src = ( layer.src || '' ).trim();
		if ( ! src ) continue;
		const tag = LAYER_TYPE_TAGS[ layer.type ] || LAYER_TYPE_TAGS.geojson;

		let attrs = ` src="${ src }"`;
		if ( layer.fitbounds ) attrs += ` fitbounds="true"`;

		const sanitize = ( s ) =>
			s.replace( /"/g, '&quot;' ).replace( /\]/g, '&#93;' );
		if ( layer.popupText && layer.popupText.trim() )
			attrs += ` popup_text="${ sanitize( layer.popupText.trim() ) }"`;
		if ( layer.popupProperty && layer.popupProperty.trim() )
			attrs += ` popup_property="${ sanitize(
				layer.popupProperty.trim()
			) }"`;
		if ( layer.tableView ) attrs += ` table_view="1"`;

		if ( layer.color && layer.color.trim() )
			attrs += ` color="${ layer.color.trim() }"`;
		if ( layer.weight != null ) attrs += ` weight="${ layer.weight }"`;
		if ( layer.opacity != null ) attrs += ` opacity="${ layer.opacity }"`;
		if ( layer.dashArray && layer.dashArray.trim() )
			attrs += ` dasharray="${ layer.dashArray.trim() }"`;
		if ( layer.classname && layer.classname.trim() )
			attrs += ` classname="${ layer.classname.trim() }"`;
		if ( layer.fill ) attrs += ` fill="true"`;
		if ( layer.fillColor && layer.fillColor.trim() )
			attrs += ` fillcolor="${ layer.fillColor.trim() }"`;
		if ( layer.fillOpacity != null )
			attrs += ` fillopacity="${ layer.fillOpacity }"`;

		if ( layer.useCustomIcon ) {
			if ( layer.iconUrl ) attrs += ` iconurl="${ layer.iconUrl }"`;
			if (
				layer.iconWidth != null &&
				layer.iconHeight != null &&
				layer.iconWidth >= 1 &&
				layer.iconHeight >= 1
			) {
				attrs += ` iconsize="${ layer.iconWidth },${ layer.iconHeight }"`;
			}
			if ( layer.iconAnchorX != null && layer.iconAnchorY != null )
				attrs += ` iconanchor="${ layer.iconAnchorX },${ layer.iconAnchorY }"`;
			if ( layer.popupAnchorX != null && layer.popupAnchorY != null )
				attrs += ` popupanchor="${ layer.popupAnchorX },${ layer.popupAnchorY }"`;
		}

		out += `\n[${ tag }${ attrs } /]`;
	}
	return out;
}

describe( 'buildLayerShortcodes', () => {
	test( 'empty / null → empty string', () => {
		expect( buildLayerShortcodes( [] ) ).toBe( '' );
		expect( buildLayerShortcodes( null ) ).toBe( '' );
	} );

	test( 'layer with no src → skipped', () => {
		expect( buildLayerShortcodes( [ { type: 'geojson', src: '' } ] ) ).toBe(
			''
		);
		expect( buildLayerShortcodes( [ { type: 'geojson' } ] ) ).toBe( '' );
	} );

	test( 'type geojson → leaflet-geojson tag', () => {
		const result = buildLayerShortcodes( [
			{ type: 'geojson', src: 'https://example.com/a.geojson' },
		] );
		expect( result ).toContain( '[leaflet-geojson' );
	} );

	test( 'type gpx → leaflet-gpx tag', () => {
		const result = buildLayerShortcodes( [
			{ type: 'gpx', src: 'https://example.com/a.gpx' },
		] );
		expect( result ).toContain( '[leaflet-gpx' );
	} );

	test( 'type kml → leaflet-kml tag', () => {
		const result = buildLayerShortcodes( [
			{ type: 'kml', src: 'https://example.com/a.kml' },
		] );
		expect( result ).toContain( '[leaflet-kml' );
	} );

	test( 'unknown type falls back to leaflet-geojson', () => {
		const result = buildLayerShortcodes( [
			{ type: 'csv', src: 'https://example.com/a.csv' },
		] );
		expect( result ).toContain( '[leaflet-geojson' );
	} );

	test( 'popup_text emitted', () => {
		const result = buildLayerShortcodes( [
			{
				type: 'geojson',
				src: 'https://x.com/a.geojson',
				popupText: 'Name: {name}',
			},
		] );
		expect( result ).toContain( 'popup_text="Name: {name}"' );
	} );

	test( 'popup_property emitted', () => {
		const result = buildLayerShortcodes( [
			{
				type: 'geojson',
				src: 'https://x.com/a.geojson',
				popupProperty: 'name',
			},
		] );
		expect( result ).toContain( 'popup_property="name"' );
	} );

	test( 'tableView: true → table_view="1"', () => {
		const result = buildLayerShortcodes( [
			{
				type: 'geojson',
				src: 'https://x.com/a.geojson',
				tableView: true,
			},
		] );
		expect( result ).toContain( 'table_view="1"' );
	} );

	test( 'style attrs are lowercased (dasharray, fillcolor, fillopacity)', () => {
		const result = buildLayerShortcodes( [
			{
				type: 'geojson',
				src: 'https://x.com/a.geojson',
				dashArray: '5,5',
				fillColor: '#abc',
				fillOpacity: 0.4,
			},
		] );
		expect( result ).toContain( 'dasharray="5,5"' );
		expect( result ).toContain( 'fillcolor="#abc"' );
		expect( result ).toContain( 'fillopacity="0.4"' );
	} );

	test( 'custom icon attrs emitted when useCustomIcon true', () => {
		const result = buildLayerShortcodes( [
			{
				type: 'geojson',
				src: 'https://x.com/a.geojson',
				useCustomIcon: true,
				iconUrl: 'https://x.com/pin.png',
				iconWidth: 32,
				iconHeight: 48,
				iconAnchorX: 16,
				iconAnchorY: 48,
				popupAnchorX: 0,
				popupAnchorY: -48,
			},
		] );
		expect( result ).toContain( 'iconurl="https://x.com/pin.png"' );
		expect( result ).toContain( 'iconsize="32,48"' );
		expect( result ).toContain( 'iconanchor="16,48"' );
		expect( result ).toContain( 'popupanchor="0,-48"' );
	} );

	test( 'iconsize not emitted when only width set', () => {
		const result = buildLayerShortcodes( [
			{
				type: 'geojson',
				src: 'https://x.com/a.geojson',
				useCustomIcon: true,
				iconUrl: 'https://x.com/pin.png',
				iconWidth: 32,
				iconHeight: null,
			},
		] );
		expect( result ).not.toContain( 'iconsize' );
	} );

	test( 'popup_text with double-quote escaped to &quot;', () => {
		const result = buildLayerShortcodes( [
			{
				type: 'geojson',
				src: 'https://x.com/a.geojson',
				popupText: 'Say "hello"',
			},
		] );
		expect( result ).toContain( 'popup_text="Say &quot;hello&quot;"' );
		expect( result ).not.toContain( '"hello"' );
	} );

	test( 'popup_text with ] escaped to &#93;', () => {
		const result = buildLayerShortcodes( [
			{
				type: 'geojson',
				src: 'https://x.com/a.geojson',
				popupText: 'Close]bracket',
			},
		] );
		expect( result ).toContain( 'popup_text="Close&#93;bracket"' );
	} );

	test( 'all emissions are self-closing', () => {
		const result = buildLayerShortcodes( [
			{ type: 'geojson', src: 'https://x.com/a.geojson' },
		] );
		expect( result ).toMatch( / \/\]$/ );
		expect( result ).not.toContain( '[/leaflet-' );
	} );
} );
