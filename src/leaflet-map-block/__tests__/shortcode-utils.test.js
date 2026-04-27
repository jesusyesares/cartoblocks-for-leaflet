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
