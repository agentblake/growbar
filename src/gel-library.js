'use strict';

// GrowBar's complete human-readable Sidus Gel catalog. The brand, series and
// zero-based index are the native values carried by GELProtocol command 3.
// Names and numbers follow Aputure's published GEL tables; the nine-series,
// 318-entry shape was independently recovered from Sidus Link 2.0.42.
const SERIES = [
  {
    brand: 'Rosco', origin: 1, type: 0, series: 'Color Correction', entries: [
      ['3202', 'Full CTB'], ['3203', '3/4 CTB'], ['3204', '1/2 CTB'], ['3206', '1/3 CTB'],
      ['3208', '1/4 CTB'], ['3216', '1/8 CTB'], ['3220', 'Double CTB'], ['3407', 'Full CTO'],
      ['3411', '3/4 CTO'], ['3408', '1/2 CTO'], ['3409', '1/4 CTO'], ['3410', '1/8 CTO'],
      ['3420', 'Double CTO'], ['3441', 'Full CTS'], ['3442', '1/2 CTS'], ['3443', '1/4 CTS'],
      ['3444', '1/8 CTS'], ['3304', 'Full Plusgreen'], ['3315', '1/2 Plusgreen'],
      ['3316', '1/4 Plusgreen'], ['3317', '1/8 Plusgreen'], ['3308', 'Full Minusgreen'],
      ['3309', '3/4 Minusgreen'], ['3313', '1/2 Minusgreen'], ['3314', '1/4 Minusgreen'],
      ['3318', '1/8 Minusgreen'], ['3310', 'Fluorofilter'], ['3150', 'Industrial Vapor'],
      ['3152', 'Urban Vapor'], ['3107', 'Tough Y1'], ['3134', 'Tough MT 54'],
      ['3106', 'Tough MTY'], ['3102', 'Tough MT2']
    ]
  },
  {
    brand: 'Rosco', origin: 1, type: 1, series: 'CalColor', entries: [
      ['4215', '15 Blue'], ['4230', '30 Blue'], ['4260', '60 Blue'], ['4290', '90 Blue'],
      ['4307', '7 Cyan'], ['4315', '15 Cyan'], ['4330', '30 Cyan'], ['4360', '60 Cyan'],
      ['4390', '90 Cyan'], ['4415', '15 Green'], ['4430', '30 Green'], ['4460', '60 Green'],
      ['4490', '90 Green'], ['4515', '15 Yellow'], ['4530', '30 Yellow'], ['4560', '60 Yellow'],
      ['4590', '90 Yellow'], ['4615', '15 Red'], ['4630', '30 Red'], ['4660', '60 Red'],
      ['4690', '90 Red'], ['4715', '15 Magenta'], ['4730', '30 Magenta'], ['4760', '60 Magenta'],
      ['4790', '90 Magenta'], ['4815', '15 Pink'], ['4830', '30 Pink'], ['4860', '60 Pink'],
      ['4890', '90 Pink'], ['4915', '15 Lavender'], ['4930', '30 Lavender'],
      ['4960', '60 Lavender'], ['4990', '90 Lavender']
    ]
  },
  {
    brand: 'Rosco', origin: 1, type: 2, series: 'Storaro Selection', entries: [
      ['2001', 'VS Red'], ['2002', 'VS Orange'], ['2003', 'VS Yellow'], ['2004', 'VS Green'],
      ['2005', 'VS Cyan'], ['2006', 'VS Azure'], ['2007', 'VS Blue'], ['2008', 'VS Indigo'],
      ['2009', 'VS Violet'], ['2010', 'VS Magenta']
    ]
  },
  {
    brand: 'Rosco', origin: 1, type: 3, series: 'Cinelux', entries: [
      ['02', 'Bastard Amber'], ['302', 'Pale Bastard Amber'], ['06', 'No Color Straw'],
      ['08', 'Pale Gold'], ['310', 'Daffodil'], ['12', 'Straw'], ['16', 'Light Amber'],
      ['316', 'Gallo Gold'], ['17', 'Light Flame'], ['18', 'Flame'], ['318', 'Mayan Sun'],
      ['21', 'Golden Amber'], ['321', 'Soft Golden Amber'], ['23', 'Orange'], ['325', 'Henna'],
      ['26', 'Sky Light Red'], ['33', 'No Color Pink'], ['333', 'Blush Pink'], ['34', 'Flesh Pink'],
      ['37', 'Pale Rose Pink'], ['41', 'Salmon'], ['42', 'Deep Salmon'], ['44', 'Middle Rose'],
      ['47', 'Light Rose'], ['51', 'Purple'], ['60', 'Surprise Pink'], ['360', 'No Color Blue'],
      ['62', 'Clearwater Booster Blue'], ['362', 'Tipton Blue'], ['364', 'Blue Bell'],
      ['65', 'Daylight Blue'], ['365', 'Tharon Delft Blue'], ['375', 'Cerulean Blue'],
      ['376', 'Bermuda Blue'], ['77', 'Green Blue'], ['378', 'Alice Blue'], ['80', 'Primary Blue'],
      ['381', 'Baldassari Blue'], ['83', 'Medium Blue'], ['87', 'Pale Yellow Green'],
      ['88', 'Light Green'], ['89', 'Moss Green'], ['91', 'Primary Green'], ['92', 'Turquoise'],
      ['93', 'Blue Green'], ['99', 'Chocolate']
    ]
  },
  {
    brand: 'LEE', origin: 0, type: 0, series: 'Color Correction', entries: [
      ['200', 'Double CTB'], ['201', 'Full CTB'], ['281', '3/4 CTB'], ['202', '1/2 CTB'],
      ['203', '1/4 CTB'], ['218', '1/8 CTB'], ['287', 'Double CTO'], ['204', 'Full CTO'],
      ['285', '3/4 CTO'], ['205', '1/2 CTO'], ['206', '1/4 CTO'], ['223', '1/8 CTO'],
      ['283', '1 1/2 CTB'], ['286', '1 1/2 CTO'], ['441', 'Full CTS'], ['442', '1/2 CTS'],
      ['443', '1/4 CTS'], ['444', '1/8 CTS'], ['207', 'Full CTO + .3 ND'],
      ['208', 'Full CTO + .6 ND'], ['212', 'L.C.T. Yellow (Y1)'], ['213', 'White Flame Green'],
      ['219', 'LEE Fluorescent Green'], ['230', 'Super Correction L.C.T. Yellow'],
      ['232', 'Super Correction W.F. Green'], ['236', 'H.M.I. (to Tungsten)'],
      ['237', 'C.I.D. (to Tungsten)'], ['238', 'C.S.I. (to Tungsten)'],
      ['241', 'LEE Fluorescent 5700 Kelvin'], ['242', 'LEE Fluorescent 4300 Kelvin'],
      ['243', 'LEE Fluorescent 3600 Kelvin'], ['244', 'LEE Plus Green'], ['245', '1/2 Plus Green'],
      ['246', '1/4 Plus Green'], ['278', '1/8 Plus Green'], ['247', 'LEE Minus Green'],
      ['248', '1/2 Minus Green'], ['249', '1/4 Minus Green'], ['279', '1/8 Minus Green']
    ]
  },
  {
    brand: 'LEE', origin: 0, type: 1, series: 'Color Filters', entries: [
      ['002', 'Rose Pink'], ['003', 'Lavender'], ['004', 'Medium Bastard Amber'], ['007', 'Pale Yellow'],
      ['008', 'Dark Salmon'], ['009', 'Pale Amber Gold'], ['010', 'Medium Yellow'], ['013', 'Straw Tint'],
      ['017', 'Surprise Peach'], ['019', 'Fire'], ['020', 'Medium Amber'], ['021', 'Gold Amber'],
      ['022', 'Dark Amber'], ['024', 'Scarlet'], ['025', 'Sunset Red'], ['026', 'Bright Red'],
      ['035', 'Light Pink'], ['036', 'Medium Pink'], ['046', 'Dark Magenta'], ['048', 'Rose Purple'],
      ['052', 'Light Lavender'], ['053', 'Paler Lavender'], ['058', 'Lavender'], ['061', 'Mist Blue'],
      ['063', 'Pale Blue'], ['068', 'Sky Blue'], ['075', 'Evening'], ['079', 'Just Blue'],
      ['085', 'Deeper Blue'], ['088', 'Lime Green'], ['089', 'Moss Green'], ['090', 'Dark Yellow Green'],
      ['100', 'Spring Yellow'], ['101', 'Yellow'], ['102', 'Light Amber'], ['103', 'Straw'],
      ['104', 'Deep Amber'], ['106', 'Primary Red'], ['107', 'Light Rose'], ['108', 'English Rose'],
      ['109', 'Light Salmon'], ['110', 'Middle Rose'], ['111', 'Dark Pink'], ['113', 'Magenta'],
      ['115', 'Peacock Blue'], ['117', 'Steel Blue'], ['118', 'Light Blue'], ['120', 'Deep Blue'],
      ['121', 'LEE Green'], ['122', 'Fern Green'], ['124', 'Dark Green'], ['127', 'Smokey Pink'],
      ['128', 'Bright Pink'], ['131', 'Marine Blue'], ['134', 'Golden Amber'], ['135', 'Deep Golden Amber'],
      ['136', 'Pale Lavender'], ['137', 'Special Lavender'], ['138', 'Pale Green'], ['140', 'Summer Blue'],
      ['142', 'Pale Violet'], ['143', 'Pale Navy Blue'], ['144', 'No Color Blue'], ['147', 'Apricot'],
      ['148', 'Bright Rose'], ['151', 'Gold Tint'], ['152', 'Pale Gold'], ['153', 'Pale Salmon'],
      ['154', 'Pale Rose'], ['156', 'Chocolate'], ['157', 'Pink'], ['159', 'No Color Straw'],
      ['161', 'Slate Blue'], ['162', 'Bastard Amber'], ['164', 'Flame Red'], ['165', 'Daylight Blue'],
      ['169', 'Lilac Tint'], ['170', 'Deep Lavender'], ['174', 'Dark Steel Blue'], ['176', 'Loving Amber'],
      ['180', 'Dark Lavender'], ['182', 'Light Red'], ['192', 'Flesh Pink'], ['194', 'Surprise Pink'],
      ['195', 'Zenith Blue'], ['196', 'True Blue'], ['197', 'Alice Blue'], ['198', 'Palace Blue'],
      ['199', 'Regal Blue']
    ]
  },
  {
    brand: 'LEE', origin: 0, type: 2, series: '600 Series', entries: [
      ['600', 'Arctic White'], ['601', 'Silver'], ['602', 'Platinum'], ['603', 'Moonlight White'],
      ['604', 'Full CT 85'], ['650', 'Industry Sodium'], ['651', 'HI Sodium'],
      ['652', 'Urban Sodium'], ['653', 'LO Sodium']
    ]
  },
  {
    brand: 'LEE', origin: 0, type: 3, series: 'Cosmetic', entries: [
      ['184', 'Cosmetic Peach'], ['186', 'Cosmetic Silver Rose'], ['187', 'Cosmetic Rouge'],
      ['188', 'Cosmetic Highlight'], ['189', 'Cosmetic Silver Moss'], ['191', 'Cosmetic Aqua Blue'],
      ['705', 'Lily Frost'], ['717', 'Shanklin Frost'], ['718', 'Half Shanklin Frost'],
      ['720', 'Durham Daylight Frost'], ['749', 'Hampshire Rose'], ['750', 'Durham Frost'],
      ['774', 'Soft Amber Key 1'], ['775', 'Soft Amber Key 2'], ['791', 'Moroccan Frost'],
      ['217', 'Blue Diffusion'], ['221', 'Blue Frost'], ['224', 'Daylight Blue Frost']
    ]
  },
  {
    brand: 'LEE', origin: 0, type: 4, series: '700 Series', entries: [
      ['700', 'Perfect Lavender'], ['701', 'Provence'], ['702', 'Special Pale Lavender'],
      ['703', 'Cold Lavender'], ['704', 'Lily'], ['706', 'King Fals Lavender'],
      ['708', 'Cool Lavender'], ['709', 'Electric Lilac'], ['710', 'Spir Special Blue'],
      ['711', 'Cold Blue'], ['712', 'Bedford Blue'], ['714', 'Elysian Blue'], ['715', 'Cabana Blue'],
      ['716', 'Mikkel Blue'], ['719', 'Colour Wash'], ['721', 'Berry Blue'], ['723', 'Virgin Blue'],
      ['724', 'Ocean Blue'], ['725', 'Old Steel'], ['728', 'Steel Green'], ['730', 'Liberty Green'],
      ['731', 'Dirty Ice'], ['733', 'Damp Squib'], ['738', 'JAS Green'], ['742', 'Bram Brown'],
      ['744', 'Dirty White'], ['746', 'Brown'], ['747', 'Easy White'], ['748', 'Seedy Pink'],
      ['763', 'Wheat'], ['764', 'Sun Colour Straw'], ['765', 'LEE Yellow'], ['773', 'Cardbox Amber'],
      ['776', 'Nectarine'], ['778', 'Millennium Gold'], ['779', 'Bastard Pink'], ['781', 'Terry Red'],
      ['789', 'Blood Red'], ['790', 'Moroccan Pink'], ['794', 'Pretty n\' Pink'],
      ['795', 'Magical Magenta']
    ]
  }
];

const GEL_LIBRARY = Object.freeze(SERIES.flatMap(({ brand, origin, type, series, entries }) =>
  entries.map(([number, name], index) => Object.freeze({
    id: `${brand.toLowerCase()}-${number.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    brand, origin, type, series, index, number, name
  }))
));

module.exports = { GEL_LIBRARY, GEL_SERIES: Object.freeze(SERIES) };
