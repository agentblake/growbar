# PB12 direct-Bluetooth protocol reference

This document records the sanitized, hardware-derived controls implemented by
GrowBar for the Aputure INFINIBAR PB12. It is intended for interoperable local
software. It contains no Mesh keys, addresses, databases, account data, APKs,
or private captures.

The final study used Sidus Link Android 2.0.42 (152), JADX 1.5.6, and matching
Frida 16.7.19 client/server. Plaintext was observed at each protocol class's
`getSendData()` boundary and before
`MeshMessageClient.sendMessage(int, byte[])`. The completed checkpoint used 262
authorized physical transmissions. Flashing System effects were physically
activated with the owner's authorization and explicitly stopped after each test.

## Common Telink packet

The PB12 vendor access opcode is `0x26`. Most control parameters are 10-byte
Telink plaintext packets. Candle, TV, and Fire use captured 11-byte packets and
therefore require segmented Bluetooth Mesh lower transport:

- Byte 0 is the low eight bits of the sum of every remaining plaintext byte.
- Bytes 1–8 contain a 64-bit little-endian representation of the protocol's
  declared bit fields.
- Byte 9 contains `0x80 | command` for a write.
- Bluetooth Mesh encryption, MIC, sequence, source, destination, IV index, and
  Proxy framing are added after this boundary.

All numeric encoders must reject values outside their semantic range. Do not
copy older experimental vectors that overflowed a field: an over-wide value can
shift the remainder of the packet and turn it into a different command.

## Global color commands

| Mode | Command | Validated scaling |
| --- | ---: | --- |
| HSI | `0x01` | hue 0–360 whole degrees; saturation 0–100 whole percent; intensity 0–1000 |
| CCT / ±G | `0x02` | Kelvin ÷ 10; intensity 0–1000; neutral GM 100, encoded in tenths |
| Gel | `0x03` | intensity 10 bits; CCT÷10 10 bits; origin 1 bit; type 4 bits; color identity 10 bits |
| RGBW | `0x04` | R, G, B, warm-white, cool-white and intensity are each 0–1000 |
| CIE xy | `0x05` | normalized x and y × 10,000 into 14-bit fields; intensity 0–1000 |

The final operation bit is `1` for these static global writes. Sidus Link's
BT.709 and DCI-P3 choices appear to convert the chosen color to xy inside the
app; no separate gamut identifier was observed on the PB12 wire path. A.GAMUT
was not available for this fixture.

Validated golden packets:

```text
HSI green:       hue120 sat100 intensity50       360100000000198f0c81
CCT neutral:     4300K GM0 intensity50           4a0100000040e19a0c82
CCT +10% G:      4300K GM+10 intensity50         6a0100000060e19a0c82
Gel LEE 203:     4300K origin0 type0 color4 i50  8a0100008000e09a0c83
Gel Rosco 3208:  4300K origin1 type0 color4 i50  920100008000e89a0c83
RGBW red:        R1000 others0 intensity50       a221030000000000fa84
xy blue:         x0.1442 y0.0566 intensity50     99010000d808a2850c85
```

`±G` is exposed as −100% through +100% in 10% steps. The Sidus constructor
uses neutral `100`; therefore GrowBar maps user `−10`, `0`, `+10` to raw
`90`, `100`, `110`, then writes `9`, `10`, `11`. Neutral and conservative
positive/negative samples were physically validated.

The Gel identity fields are library identities, not a generic RGB replacement.
GrowBar bundles all 318 LEE/Rosco entries from nine Sidus series as a searchable
catalog. Eleven
identities were physically confirmed: LEE 203, 653, 778, 287, 195, and 775;
Rosco 3208, 4990, 91, 3420, and 2010. Each catalog entry retains its complete
1-bit brand, 4-bit series, and 10-bit index address.

## Static partition color

`PartitionColorProtocol` uses command `0x23` and a 10-byte packet:

- CCT branch: DUV 8 bits, CCT 8 bits.
- HSI branch: saturation 7 bits, hue 9 bits.
- Intensity: 10 bits.
- Light mode: 1 bit.
- FX state: 1 bit (`0` enables selected-zone FX; `1` disables it).
- Target mask: 36 bits. PB12 static control uses indexes 0–31.
- Index 0 is the most-significant bit of the first 32-section mask byte; index 31
  is the least-significant bit of the fourth.
- CCT `255` and DUV `255` preserve the existing color for intensity/FX-only
  updates on the tested PB12.

Masked static color writes accumulate. Software can build an arbitrary
multicolor frame by grouping equal colors, sending one mask per color, and
leaving unselected sections untouched. The PB12 exposes 32 independently controlled
sections through this path; each section corresponds to a group within its 96
physical light elements.

## Partition configuration and legacy partition FX

The captured configuration codes are 4→0, 8→2, 12→3, 16→4, 24→5, and 32→1.
Every mode was written, queried through command-38 response handling, and read
back successfully on the PB12. The exact write packets are:

```text
4 sections   a60000000000000000a6
8 sections   c60000000000000020a6
12 sections  d60000000000000030a6
16 sections  e60000000000000040a6
24 sections  f60000000000000050a6
32 sections  b60000000000000010a6
```

Legacy `PartitionEffectProtocol` is command `0x24`:

- Minimum intensity: 7 bits.
- Trigger: 1 bit; encoder polarity is inverted on wire.
- Frequency min/max: 5 bits each.
- Interval min/max and lasting min/max: 7 bits each.
- FX mode: 0 Flash, 1 Pulsing, 2 Breath.
- Raw time 1–9 means 0.1–0.9 seconds; raw ≥10 means `raw − 9` seconds.
- Frequency uses the same tenths then integer-Hz convention.

Validated Breath ordering is: parameter packet, wait 200 ms, then selected-zone
`PartitionColorProtocol` with `fxState=0`. To recover, restore static CCT/color
first and send an all-zone `fxState=1` packet last. GrowBar keeps this capability
available for all validated partition layouts. The golden parameter vector with
a 2.5% minimum and 0.1-second period is `9c000019210000ffbfa4`.

Partition Pulsing and Flash use the same packet with FX mode 1 and 0. Trigger
wire bit 0 is unified; bit 1 is sequential. Neither engine honors the command-35
selection mask on this PB12: unified affects the whole bar and sequential walks
every logical zone. Pulsing was physically confirmed in all six layouts. The
12-section layout is accepted but visually uneven. Flash is reliable in four
and eight sections. Eight-section Flash is order-sensitive: set the layout,
send an explicit all-32-section stop, enable all eight selected-layout sections,
wait 200 ms, then send the effect parameters last. GrowBar does not expose
untested 12/16/24/32-section Flash.

```text
Pulsing unified 0.1 Hz    43000000210000ff7fa4
Pulsing sequential 0.1   c3000080210000ff7fa4
Pulsing unified 20 Hz    e2000000bd0300ff7fa4
Flash unified 0.1 Hz     03000000210000ff3fa4
Flash sequential 0.1     83000080210000ff3fa4
Flash unified 20 Hz      a2000000bd0300ff3fa4
all-32-section stop      68642b3208ffffffffa3
```

The explicit stop packet carries 4300K, neutral DUV 100, 5% intensity, and
`fxState=1` across all 32 physical sections. Preserve-color 255/255 sentinels can stop
motion while leaving stale colors behind, so GrowBar does not use them for
partition recovery.

## System Pulsing III

`PulsingProtocol3` uses command `0x22`, effect ID 16. The PB12 accepted a
20–200 pulses/minute range. The packet carries state, 10-bit intensity, rate,
CCT in 50K units, neutral GM, and the effect ID. A 4300K, 5%, 20/min start is
`ac0000005640214310a2`; its stop is `6c0000005640210310a2`. Stop the effect,
wait 500 ms, then restore the requested static mode.

## Full-bar System effects

The following command-7 families were physically validated. GrowBar exposes the
captured 5% intensity path. Frequency 1 and 10 endpoints were confirmed where
shown; intermediate integer values occupy the same field. Lightning uses its
single validated autonomous trigger setting.

| Effect | ID | Slow / base vector | Fast / alternate vector |
| --- | ---: | --- | --- |
| Candle | 4 | `1c010000000000840c0487` | `40010000000000a80c0487` |
| TV | 3 | `1b010000000000840c0387` | alternate palette `41010000000200a80c0387` |
| Fire | 5 | `1d010000000000840c0587` | alternate palette `43010000000200a80c0587` |
| Strobe | 6 | `66010050e19a0c010687` | `6f010050e19a0c0a0687` |
| Lightning | 2 | `0601002815ae850c0287` | fixed validated setting |
| Paparazzi | 1 | `dc01000014ae850c0187` | `0001000014aea90c0187` |
| Faulty Bulb | 8 | `ea018052e19a0c010887` | `f3018052e19a0c0a0887` |

The shared System stop is `96000000000000000f87`. Send it once, wait 500 ms,
then restore a static mode. Candle, TV, and Fire carry one extra byte and must be
segmented at lower transport rather than emitted as an oversized unsegmented
Access PDU.

Explosion remained dark in physical trials and is unresolved. Manual-effect
families were encoder-mapped, but the tested Continuous Fade invocation also
remained dark. Neither is exposed. Additional System variants require physical
captures rather than guessed packets.

## Native Pixel FX

Native Pixel FX use command `0x21` (`byte9 = 0xA1`) and the fixture's onboard
engine. State values are Stop=0, Run=1, Run/Start=2, and palette/layer staging=3.
Stateful packets must be sent once, in order; duplicating them with new Mesh
sequence numbers can overwrite or restart the onboard state machine.

| Effect | ID | Validated ordering |
| --- | ---: | --- |
| Color Fade | 0 | palette packets state3, then package0 state2 |
| Color Cycle | 1 | palette packets state3, then package0 state2 with Gradient/Transient field |
| One-color Chase | 2 | base serial0, moving serial1, then motion state2 |
| Two-color Chase | 3 | base serial0, moving serial1–2, then motion state2 |
| Three-color Chase | 4 | base serial0, moving serial1–3, then motion state2 |
| Pixel Fire | 5 | fire layer state3, 150 ms, base layer state3, 150 ms, motion state2 |
| Rainbow | 7 | one state/brightness/direction/speed packet |

Fade, Cycle, and Chase staging packets were validated with 200 ms spacing.
Their final motion packet carries speed; Chase also carries direction, grouping,
and pixel length. Color Cycle's change-style field selects Gradient or Transient.

Pixel Fire package 1 carries fire color and min/max brightness; package 2 carries
base color and brightness; package 0 carries state, frequency, and orientation.
Frequency 1 (0.1 Hz in the Sidus UI) looked nearly static, while frequency 10
(1.0 Hz) produced visible motion. Equal min/max brightness removes intensity
flicker. Stop repeats the two layer packets and finishes with package0 state0.

Validated start/control vectors:

```text
Color Fade start       c40000000090118200a1
Color Cycle start      c50000000090118201a1
One-color Chase start  470000000020038102a1
Two-color Chase start  480000000020038103a1
Three-color Chase      490000000020038104a1
Rainbow                7f0000000032228307a1
Rainbow stop           a80000000000000007a1
Pixel Fire layer       47c08ac7431964d005a1
Pixel Fire base        3400002b140a65e005a1
Pixel Fire motion      4e0000000000288005a1
```

Native Pixel FX ID 6 (On-Off) and `ColorMoveProtocolM`/effect ID 8 did not
produce an active effect during guarded physical trials. They are unavailable
on this PB12 path and remain excluded.

## Bluetooth Mesh safety

- Persist the monotonic 24-bit Mesh sequence counter.
- Never wrap or reuse a sequence value.
- Serialize stateful writes and preserve packet ordering/delays.
- Segment Access payloads whose encrypted upper transport exceeds 15 bytes.
- Stop an onboard effect before restoring static output.
- Budget streamed 4–32-section animations for their entire requested duration.
- On connection loss, discard queued streamed frames and restore a known static
  state after reconnection; do not replay a partial effect blindly.
- Never reset or re-pair automatically.

The implementation and golden packet tests live in
[`src/direct-protocol.js`](../src/direct-protocol.js) and
[`test/direct-protocol.test.js`](../test/direct-protocol.test.js).
