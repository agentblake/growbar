# PB12 Mood Color Audit

GrowBar 0.19.2 reviews all 32 Mood Color recipes against the PB12 rather than
assuming that a computer-screen HSV wheel maps evenly onto the fixture's RGBWW
emitters. It does not: red becomes perceptually dominant early in the nominal
violet range, while low-saturation HSI colors are less convincing than the
fixture's white, RGBW, or Gel engines.

## Calibration rules

- Deep saturated colors remain HSI where the intended appearance is unambiguous.
- Warm and cool neutrals use the dedicated CCT emitters.
- Peach, mint, amethyst, and rose use RGBW so white is added deliberately rather
  than obtained by merely reducing HSI saturation.
- Four visually important anchors use native Gel identities that were physically
  exercised on the PB12: LEE 778 Millennium Gold, LEE 195 Zenith Blue, Rosco
  4990 90 Lavender, and Rosco 2010 VS Magenta.
- PB12 HSI blue-violet stops at 252 degrees. Higher HSI values are reserved for
  presets that are intentionally plum, orchid, magenta, pink, or rose.

## Audited gallery

| Range | Presets | Result |
| --- | --- | --- |
| Red–orange | Scarlet Noir, Crimson Canopy, Coral Dawn, Emberlight, Peach Glow, Tangerine Dream | Scarlet and coral move slightly toward orange; Peach Glow gains more green and warm-white output. |
| Gold–yellow | Sunlit Linen, Honeyed Gold, Candlelight Grove, Firefly | CCT handles ivory and candlelight; Millennium Gold provides a stable amber anchor; Firefly is less harshly green. |
| Yellow-green–jade | Lime Pulse, Moss Temple, Forest Bath, Emerald Cavern, Jade Rain | Moss shifts toward olive, Forest remains natural green, and emerald/jade advance distinctly toward teal. |
| Mint–cyan | Mint Mirage, Lagoon, Glacier, Arctic Glass | Mint gains white and blue, Lagoon remains turquoise, Glacier is a paler cyan, and Arctic Glass retains native quarter-CTB. |
| White–blue | Silver Moon, Electric Tide, Sapphire Depths, Midnight Blue | Silver Moon stays on the white emitters, Zenith Blue anchors cobalt, and sapphire/midnight remain progressively deeper blue. |
| Indigo–violet | Indigo Eclipse, Ultraviolet, Violet Hour, Amethyst Smoke | The entire band moves blueward; Violet Hour now uses native 90 Lavender instead of the magenta-looking 270-degree HSI recipe. |
| Plum–rose | Plum Nocturne, Orchid Dream, Fuchsia Bloom, Pink Haze, Rose Quartz | These are intentionally red-purple through rose; VS Magenta anchors Fuchsia and RGBW softens Rose Quartz. |

The artwork and preset IDs are unchanged, so saved settings and active named
overrides continue to migrate normally.
