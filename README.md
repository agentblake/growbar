# GrowBar

GrowBar is a local-first macOS controller for the Aputure INFINIBAR PB12. It
maintains an editable money-tree lighting schedule, offers four-hour color and
animation overrides, and talks directly to the fixture over Bluetooth Mesh.

GrowBar 0.19.2 keeps the plant schedule as the primary experience and combines
five independently validated control paths:

- calibrated full-bar HSI, CCT with native green/magenta correction, native Gel
  library addressing, RGBW-emitter mixing, and CIE xy;
- the PB12's onboard Pixel FX engine for Fade, Cycle, one/two/three-color Chase,
  Rainbow, and Pixel Fire;
- custom software animation over 4, 8, 12, 16, 24, or 32 independently
  selectable sections;
- selected-zone Breath, full-layout Partition Pulsing/Flash, and full-bar
  Pulsing III in the PB12's onboard engines;
- captured full-bar Candle, TV, Fire, Strobe, Lightning, Paparazzi, and Faulty
  Bulb System effects.

The packet layouts come from sanitized Sidus Link analysis and low-brightness
physical PB12 trials—not guessed Bluetooth fields. The detailed interoperable
reference is in [docs/pb12-bluetooth-protocol.md](docs/pb12-bluetooth-protocol.md).

## Connection model

GrowBar uses **amaran Desktop once** to establish the PB12's Sidus Mesh pairing:

1. amaran provisions the fixture.
2. GrowBar finds the newest usable `amaran.db` under
   `~/Library/Application Support/amaran Desktop/`.
3. It reads the network/application keys and fixture node data locally.
4. It encrypts the imported material with Electron `safeStorage`, backed by the
   macOS Keychain, and stores the file with owner-only permissions.
5. It closes amaran, connects to Bluetooth Mesh Proxy service `0x1828`, performs
   the proxy-filter handshake, and sends Telink vendor opcode `0x26` commands.

This setup follows the MIT-licensed
[`amaran-BLE-control`](https://github.com/wesbos/amaran-BLE-control) project.
There is no reset-pairing flow, Sidus UID field, device chooser, or manual scan
screen. GrowBar silently finds the imported mesh proxy in the background.

### One-time setup

1. Add the PB12 in amaran Desktop and confirm that amaran can change its color.
2. Do **not** reset Sidus BT or remove the fixture afterward.
3. Open GrowBar while amaran is still open.
4. Click **Import amaran database** at the top of GrowBar.
5. GrowBar encrypts the imported mesh data, closes amaran, connects directly,
   and applies the current Daily Rhythm step.

The connection panel collapses after setup. Later launches, Mac wake events, and
temporary link failures trigger automatic reconnection with bounded backoff.
**Reconnect PB12** is only a manual fallback. Re-import is necessary only after
the fixture has been reset or re-paired into a different mesh.

## Controls

### Daily Rhythm

Daily Rhythm is the first main panel in the app. Its default **Smooth sunlight**
mode treats schedule rows as anchors and continuously interpolates the PB12's
brightness and white temperature between them. Hardware values are rounded to
visible/meaningful increments, so the room changes gently without unnecessary
Bluetooth Mesh traffic. Turn Smooth sunlight off to use the same anchors as
ordinary discrete schedule steps.

The old row-card overview has been replaced by a live 24-hour brightness/CCT
graph. During a Mood Color or Light Animation it becomes an artwork-backed mode
display; during plant night it becomes a dedicated darkness scene. The complete
schedule-anchor editor remains directly underneath.

The editable default is aligned to a 02:15–09:15 sleep window:

| Time | PB12 setting | Purpose |
| --- | --- | --- |
| 09:15 | 2200K, 0% | Dawn begins after ten complete dark hours |
| 09:30 | 3200K, 25% | Warm sunrise |
| 10:00 | 4500K, 70% | Morning lift |
| 10:30 | 6500K, 100% | Blue-balanced morning |
| 11:00 | 5600K, 100% | Broad-spectrum growth |
| 18:45 | 3200K, 100% | Red-rich broad-spectrum growth |
| 22:45 | 2700K, 50% | Warm wind-down |
| 23:00 | 2200K, 25% | Gentle sunset |
| 23:15 | Off | Ten-hour uninterrupted dark period |

With Smooth sunlight enabled, the rows above are destinations on one continuous
curve, not sudden changes. In particular, output rises from 0% to 25% between
09:15 and 09:30 and falls from 25% to 0% between 23:00 and 23:15. From 23:15
through 09:15 GrowBar sends no interpolated light and keeps the PB12 Off.

Start around **2–4 mol·m⁻²·day⁻¹ total DLI** at the canopy, including window
light. A PAR meter is the reliable way to tune fixture distance and intensity.
See [docs/money-tree-light-research.md](docs/money-tree-light-research.md).

### Mood Colors

The 32 one-click moods use a PB12-specific perceptual calibration rather than a
mechanically even screen-HSV wheel:

- saturated and deep hues use the verified global HSI encoder;
- soft peach, mint, amethyst, and rose recipes mix the RGBW emitters;
- near-neutral warmth uses native CCT;
- Silver Moon uses a small validated native ±G correction;
- Honeyed Gold, Electric Tide, Violet Hour, and Fuchsia Bloom use physically
  checked native Gel identities as gold, cobalt, lavender, and magenta anchors;
- Arctic Glass uses the verified LEE 203 native Gel packet;
- the blue-violet HSI band is deliberately compressed below the PB12's early
  magenta crossover, so Violet Hour no longer appears hot pink.

Every mood card has an original generated background, a descriptive name, and
its exact PB12 recipe. A click starts a four-hour override at any time; the
correct Daily Rhythm step returns automatically. The complete 32-preset review
is recorded in [docs/mood-color-audit.md](docs/mood-color-audit.md).

### Light Animations

Twenty-four audited one-click animation cards are divided between three proven engines:

- **Native Pixel FX**: Fade, Cycle, one/two/three-color Chase, Rainbow, and
  layered Pixel Fire.
- **32-Section Studio**: authored flags, interference tides, mirrored stained
  glass, radial blooms, asynchronous constellations, comets, spectral motion,
  and other layouts the native families cannot express.
- **Smooth Pulse**: the new Moonbreath card uses the validated Pulsing III
  engine at 4300K and 20 pulses per minute.

Hearthside Whisper, Analog Dream, Cinder Cathedral, Moonlit Sakura, Aurora
River, Prism Parade, and Neon Procession use explicit 32-section recipes. This
keeps their palettes deterministic and avoids native System/Fade/Cycle behavior
that proved inconsistent on the real PB12 over GrowBar's direct transport.

Every card has original generated artwork, a human-readable description, and
the actual engine/recipe summary. Version 0.19.0 replaced the old Chromatic
Wander, Rave Roulette, and Photon Sprint streams with **Velvet Kaleidoscope**,
**Celestial Orchard**, and **Meteor Garden**. It also deepens Star-Spangled
Sparkle, Tidal Cathedral, Firefly Grove, and Cosmic Bloom.

The frame-rate selector is a maximum, not a tempo override. Each streamed scene
now keeps its authored dramatic pace and can only be slowed by the UI, Bluetooth
throughput, or the remaining Mesh sequence budget. Native Fade and Cycle cards
use at most four palette colors, matching Aputure's documented Pixel FX controls.
Abrupt Strobe, Lightning, Paparazzi, and Faulty Bulb remain available only in
the clearly warned Advanced Studio; they are deliberately absent from the
four-hour curated gallery. See [the animation audit](docs/light-animation-audit.md).

Each animation runs for four hours and then returns to the schedule.

The full effect builders remain available inside the collapsed **Advanced
Animation Studio**.

### Advanced Full-Bar Studio

Every manual selection lasts four hours and then restores the currently correct
Daily Rhythm step. Available models are:

- HSI: hue in degrees, saturation in percent, intensity on the PB12's 0–1000 wire scale.
- White / CCT ±G: 2000–10000K plus native green/magenta correction from −100% to +100%.
- Native Gel: a searchable, complete 318-entry LEE/Rosco catalog with exact
  native brand/series/index addressing.
- RGBW: independent red, green, blue, warm-white, and cool-white emitter channels.
- CIE xy: normalized chromaticity coordinates sent directly to the fixture.

`±G` is intentionally stepped in 10% increments because neutral and conservative
positive/negative values were physically validated. The searchable Gel chooser
bundles all 318 Sidus LEE/Rosco entries across nine series. Eleven identities
spanning all nine series were physically checked, including LEE 203 and Rosco
3208 Quarter CTB.

The advanced animation controls support the following additional paths:

- **Native PB12 FX** run autonomously on the fixture's onboard effects engine. GrowBar
  uses hardware-derived state machines for Fade, Cycle, one/two/three-color
  Chase, Rainbow, and layered Pixel Fire. The app also includes a custom native
  FX designer for palette, background, brightness, speed, direction, grouping,
  pixel length, and Fire intensity floor.
- **Section Studio** streams complete custom frames for flags, sparkles, waves,
  comets, spectral motion, and other layouts that the native families cannot
  express. Choose 4, 8, 12, 16, 24, or 32 sections. One accumulating mask command
  is sent per distinct color in a frame.
- **Partition Breath** applies an onboard Breath to all, alternating, end, or
  center sections, with color, intensity floor, ceiling, and period controls.
- **Partition Pulsing / Flash** offers unified whole-bar or sequential movement.
  Pulsing is available in every validated 4–32-section layout. Flash is exposed
  only for its validated 4- and 8-section paths. The corrected 8-section path
  uses layout, explicit stop, all-section enable, then effect parameters.
- **Pulsing III** runs the physically validated full-bar CCT pulse at 20–200
  pulses per minute.
- **System FX** exposes Candle, TV, Fire, Strobe, Lightning, Paparazzi, and
  Faulty Bulb from captured Sidus command sequences. These presets use the
  physically confirmed 5% intensity and 1–10 frequency field; Lightning uses
  its single validated frequency.

Native effects are efficient and keep moving inside the fixture without constant
Bluetooth traffic. Studio effects provide exact section-level composition. The
selected Studio FPS is a requested maximum: GrowBar caps it using Bluetooth
packet cadence and the remaining 24-bit Mesh sequence budget. It never wraps or
reuses a sequence number.

Flashing-effect controls carry an explicit photosensitivity warning. Switching
engines sends the appropriate family-specific stop packet before the replacement
command, preventing a hidden onboard effect from continuing under a Mood or
Studio animation. Explosion, Cop Car, other uncaptured System variants, and all
Manual families remain excluded rather than guessed.

Mood and animation overrides can start at any hour. They last four hours, then
restore the Daily Rhythm step that is current at that moment—including Off.
Native effects can be recovered after restart; streamed Studio effects stop after
relaunch or Bluetooth loss and GrowBar safely restores the schedule instead of
resuming a high-rate stream unattended.

## PB12 Bluetooth protocol summary

Most fixture application commands are ten plaintext bytes before Bluetooth Mesh
encryption. Candle, TV, and Fire use an 11-byte System payload and therefore
exercise segmented lower transport. Byte 0 is the unsigned sum of all following
plaintext bytes modulo 256; the final byte identifies the command family. The
following golden vectors were physically checked:

| Feature | Plaintext hex |
| --- | --- |
| HSI green, 50% | `360100000000198f0c81` |
| 4300K neutral CCT, 5% | `4a0100000040e19a0c82` |
| 4300K +10% G, 5% | `6a0100000060e19a0c82` |
| LEE 203 Quarter CTB, 4300K, 5% | `8a0100008000e09a0c83` |
| Rosco 3208 Quarter CTB, 4300K, 5% | `920100008000e89a0c83` |
| 4/8/12/16/24/32-section layout | command `0x26`, suffix `a6` |
| 32-section static command family | command `0x23`, suffix `a3` |
| Partition Breath, 0.1 s, 2.5% floor | `9c000019210000ffbfa4` |
| Partition Pulsing, sequential, 0.1 Hz | `c3000080210000ff7fa4` |
| Partition Flash, unified, 20 Hz | `a2000000bd0300ff3fa4` |
| Explicit all-32-section CCT/FX stop | `68642b3208ffffffffa3` |
| Pulsing III start, 4300K, 5%, 20/min | `ac0000005640214310a2` |
| Pulsing III stop | `6c0000005640210310a2` |
| Color Fade start | `c40000000090118200a1` |
| Color Cycle start | `c50000000090118201a1` |
| One-color Chase start | `470000000020038102a1` |
| Two-color Chase start | `480000000020038103a1` |
| Three-color Chase start | `490000000020038104a1` |
| Rainbow, slow/low | `7f0000000032228307a1` |
| Strobe, 5%, frequency 10 | `6f010050e19a0c0a0687` |
| Lightning, 5%, captured trigger | `0601002815ae850c0287` |
| Shared System FX stop | `96000000000000000f87` |

For partition color, mask index 0 is the most-significant bit of the first mask
byte and index 31 is the least-significant bit of the fourth. Separate masked
colors accumulate, enabling simultaneous multicolor section patterns. The
partition-resolution command was physically written and read back for every
supported layout: 4, 8, 12, 16, 24, and 32 sections. GrowBar exposes this selector
and resamples Studio frames to the chosen layout.

Pixel FX packet order matters. Fade/Cycle/Chase load palette and base packages
before the final motion package. Pixel Fire loads fire color, waits 150 ms, loads
base color, waits 150 ms, and then starts motion. GrowBar sends family-specific
STOP packets before leaving the native engine.

The complete field widths, state values, packet ordering, stop sequences, zone
masks, safety rules, provenance, and additional golden vectors are maintained in
[the PB12 protocol reference](docs/pb12-bluetooth-protocol.md). That file is
intended to let other developers reuse the findings without any
private database, Mesh key, MAC address, APK, or raw capture.

## Install

- Download `arm64` for Apple silicon or `x64` for an Intel Mac.
- Unzip and move **GrowBar.app** to Applications.
- Control-click GrowBar, choose **Open**, and confirm. The release is unsigned
  and not notarized, so macOS requires this once.
- Approve Bluetooth access when macOS asks.

Existing schedules, imported credentials, and active mood settings migrate when
an older GrowBar build is replaced.

## Privacy and current limits

- No cloud service, analytics, remote API, or secret logging.
- Mesh keys never appear in the UI or leave the Mac.
- The encrypted credential file remains in GrowBar's application data.
- The Mac and PB12 must be powered, awake, and within Bluetooth range.
- amaran is needed again only after a reset or re-pair.
- GrowBar is unsigned and not notarized.
- The complete searchable 318-entry LEE/Rosco Gel catalog is bundled. Eleven
  representative native identities were physically checked across all series.
- The verified custom path controls up to 32 sections, not 96 arbitrary streamed emitter values.
- The fixture's onboard Pixel FX internals are fixture-managed; only the seven
  captured native families and validated parameters are exposed.
- Partition Breath/Pulsing and reliable 4/8-section Flash are exposed. Seven captured
  System families are exposed. Partition V2, native Pixel FX IDs 6/8, Explosion,
  Manual-effect families, and additional System variants remain unavailable or
  research-only.

## Development

Requires Node.js 22 or newer.

```sh
npm install
npm test
npm start
```

Build both unsigned macOS ZIP archives:

```sh
npm run dist:mac
```

Tests cover database import, credential storage, Mesh cryptography, replay-safe
sequence handling, global color encoders, exact hardware-derived Gel/±G/Pixel FX
vectors, effect state transitions, every partition layout, zone masks and frames,
Breath and Pulsing III recovery, scheduling, UI
contracts, segmented 11-byte System-effect transport, and both
architecture-specific native CoreBluetooth helpers.

## Acknowledgments

Direct database extraction, Bluetooth Mesh packet construction, proxy setup, and
Telink control commands are adapted from the MIT-licensed
[`amaran-BLE-control`](https://github.com/wesbos/amaran-BLE-control) project by
Wes Bos. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

GrowBar implements Bluetooth Mesh AES-CCM locally because Electron's
BoringSSL-backed `node:crypto` does not expose `aes-128-ccm`. Known-output tests
cover the implementation so importing a valid amaran database does not fail with
`Unknown cipher`.
