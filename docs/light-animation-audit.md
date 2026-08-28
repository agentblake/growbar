# Light Animation audit — GrowBar 0.19.1

This audit reconciles every friendly Light Animation with the official PB12
feature set, the sanitized hardware-derived protocol, four-hour Bluetooth Mesh
cost, safe cancellation, and what the linear fixture can honestly render.

## Primary sources and hardware baseline

- Aputure documents seven INFINIBAR Pixel FX: Color Fade, Color Cycle, one-,
  two-, and three-pixel Chase, Rainbow, and Pixel Fire:
  <https://help.aputure.com/en/infinibar/pixel-effects>
- Aputure specifies 96 programmable PB12 pixels under Sidus Link and an RGBWW
  engine: <https://aputure.com/en-US/products/infinibar-pb12>
- GrowBar's captured direct Sidus path has physically proven 32 independently
  addressable sections, each representing three physical emitters. It also
  proves all seven onboard Pixel FX state machines, three calm System FX used
  by the gallery, Pulsing III, effect stops, and explicit static recovery. See
  [the protocol reference](pb12-bluetooth-protocol.md).

The app therefore says **32-section** for software-authored patterns. It does
not falsely claim direct 96-emitter frame streaming.

## Problems found and corrected

1. The old frame-rate selector accelerated every streamed scene to the chosen
   value and ignored the recipe's `durationMs`. Slow flags, fireflies, and waves
   could become frantic and consume needless Mesh sequence numbers. Version
   0.19.0 treats the UI value as a ceiling and always honors the slower authored
   tempo.
2. Several native Fade/Cycle cards staged five or seven colors. Aputure's
   documented controls expose up to four palette colors. Every shipped Fade and
   Cycle now uses two to four deliberate colors.
3. Chromatic Wander continuously streamed one full-bar color even though a
   static/global or onboard effect can express that look more efficiently.
4. Rave Roulette's repeated blackout masks were visually shallow and too close
   to a flashing vocabulary for a four-hour bedroom preset.
5. Photon Sprint spent continuous sequence capacity on a single fast runner
   while the PB12 already has excellent native chase effects.
6. Tidal Cathedral and Cosmic Bloom were simple repeating color blocks despite
   descriptions that promised layered motion. Their frame generators now match
   the names.
7. Star-Spangled Sparkle's stripe phase advanced too quickly when the global FPS
   was high. Its field now rolls slowly while two stars hold and travel through
   the blue canton.

## Curated 0.19.0 designs

- **Velvet Kaleidoscope** replaces Chromatic Wander with a five-color,
  bilaterally mirrored stained-glass pattern that folds inward and opens again.
- **Celestial Orchard** replaces Rave Roulette with a seeded constellation of
  three independently timed stars and soft halos. Bright points hold for
  multiple authored frames; there are no one-frame full-bar blackouts.
- **Meteor Garden** replaces Photon Sprint with three travelers moving at
  different rates and directions over a shared pearl trail.
- **Tidal Cathedral** combines two quantized wave fields to create moving
  interference bands in four oceanic layers.
- **Cosmic Bloom** expands mirrored color rings from the fixture's center.
- **Firefly Grove** gives each point a separate easing path rather than three
  synchronized straight-line chases.

The gallery retains reliable native Chase, Rainbow, and Pixel Fire families
because they run autonomously in the fixture and cost only a few Mesh commands
per four-hour activation. Pulsing III remains as a quiet full-bar alternative.
Candle, TV, Fire, native Fade, and native Cycle remain available in Advanced
Studio, but friendly cards no longer depend on them after real-world direct-
transport testing exposed dark/no-change states and palette drift. Abrupt
Strobe, Lightning, Paparazzi, and Faulty Bulb remain intentionally confined to
the warned Advanced Studio.

## 0.19.1 hardware-feedback corrections

- **Moonlit Sakura** now uses explicit indigo, blush, neutral pearl, and
  lavender section colors. Its former low-saturation native Pixel FX palette
  could resolve through the PB12's CCT reference as red/orange; that was not the
  intended look.
- **Aurora River**, **Prism Parade**, and **Neon Procession** now use authored
  32-section motion so their simultaneous colors and movement are deterministic.
- **Hearthside Whisper**, **Analog Dream**, and **Cinder Cathedral** replace the
  System Candle/TV/Fire start path with bounded five-to-seven-write section
  scenes. No frame is fully dark, and all three have explicit visual motion.

## Guardrails and verification

- Every custom frame is deterministic, contains exactly 32 sections, and has a
  minimum authored duration of 300 ms.
- Every custom scene except the intentionally exact 32-hue Prism Continuum is
  capped at ten grouped mask writes per frame; most need three to five.
- GrowBar estimates the most expensive sampled frame, budgets the entire
  four-hour run against the remaining 24-bit sequence space, and also caps for
  serialized packet throughput.
- Native effects are stopped before another engine starts. Partition, Pulsing
  III, and System effects use their captured stop commands and delays before a
  known static state is restored.
- Golden vectors remain byte-for-byte regression tested, and every shipped
  animation is encoded through a validated command family.
