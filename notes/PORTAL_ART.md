# Sprite 13 portal artwork

The visual prototype uses the black-hole animation from the user-supplied
**Clu Clu Land (World)** NES ROM. It replaces the earlier animation assembled
from Moai-kun's exit door. Pairing and automatic player/stone transport are
implemented as described below.

## Source and extraction

- Source ROM SHA-256: `eb80e69de0194bb1523ceb2f1aa6b0c8b97c09a683cc22e23fed41546ce18dff`.
- iNES header: one 16 KiB PRG bank, one 8 KiB CHR bank, no trainer.
- CHR starts at file offset `$4010`. The sixteen tiles are CHR `$150–$15F`,
  file offsets `$5510–$560F` inclusive: 256 bytes total.
- Each consecutive four tiles form one 16×16 frame, in top-left, top-right,
  bottom-left, bottom-right order.
- Running this ROM in JSNES confirmed background frames `$50–$53`, `$54–$57`,
  `$58–$5B`, `$5C–$5F`, changing every eight game frames during active play.
- `Romfix.PORTAL_CHR_HEX` contains those exact source bytes. No source
  ROM is bundled, modified, or required when using the editor.

## Integration

`getPortalBasePatterns()` maps source inks 1 and 2 to ring inks 2 and 1.
Inside the original rounded outline, the gaps and center use opaque ink 3.
Outside the outline the corners use ink 0.
No shared palette is modified. Each source frame is reordered from TL/TR/BL/BR
to TL/BL/TR/BR to supply two consecutive 8x16 columns.

The scene compiler allocates 60 background tiles `$C0–$FB` (PPU `$1C00–$1FBF`)
in every scene, within the `$BA–$FF` reserve. Four animation frames
and two versions contracted to 10×10 and 6×6 pixels form the base poses.
`getPortalPatterns()` adds a fixed 3×5 group numeral (1–4) in the upper-left
corner of every pose on an opaque 5×7 plate. Ink and plate use the pair
with the best minimum luminance contrast across background, overlay and
native palette cycling. Group 1 occupies the original 24 tiles; groups 2–4
add 12 left-column tiles each and share group 1's right columns. The ten remaining tiles hold four numbered left columns and a shared right column for the hollow exit. On stock art the compiler aliases the two identical spike columns, freeing two slots for scenery. Original source CHR and native exits are preserved.

`getPortalColorSchemes()` assigns four existing background palettes per scene,
starting with the exit colors and then choosing contrasting palettes. It
matches these to the four existing sprite palettes, keeping group 1 on sprite
palette 2. Groups 2 and 4 exchange their background and overlay colors,
so group 4 carries the former group 2 scheme. Some scenes
have little contrast among their three opaque inks. The numeral keeps its
plate during occlusion and changeover. Native palette cycling still runs.
The worker contains two 48-byte tables (12 scenes × 4 groups) for background
and sprite palette choices. Editor previews use both sets of choices too.

Sprite 13 normally renders into the background with its metasprite set to
zero. Covering map tiles and falling metatiles enable two overlay sprites.
Odd tile IDs select the background CHR table in 8x16 mode, from `$C1/$C3`
through the group-specific left columns and shared right columns. Metasprites
`$2F–$4A` extend the existing bird renderer, which
still owns `$2D–$2E`. Fixed-bank rendering/dispatch uses `$FB00–$FBFF`;
native stone repaint calls use `$FC00–$FC46`. Two 28-byte column lookup tables
occupy `$FC48–$FC7F` and remain accessible from both bank 0 and bank 1.

The object keeps one of the eight enemy records for its fixed position and
animation state. It advances every eight gameplay updates. A round-robin
cursor queues one 16-byte background packet when the native queue is empty;
one tick in eight is reserved for transport/native effects. Busy updates wait.
The packet changes only the portal's own palette quadrant, choosing the
scene/group background palette from the precomputed table. Collision
map RAM stays unchanged. A covered portal invalidates its background cache
and keeps an overlay until the vacated cell has been queued for repaint.
Moving sprite objects retain native OAM priorities. Pause freezes all portal
state, retaining background portals and hiding overlays with native enemies.
Native camera projection and clipping
remain in use. Editor previews use the same converted artwork before the
first export and after loading earlier exports; earlier exports are rebuilt.

Each covered portal consumes two of the NES's eight sprites per scanline.
Uncovered portals consume none after the background handoff. Four covered
portals sharing a row fill that budget before other actors. Native
OAM priority rotation distributes visibility when overloaded, but cannot
eliminate flicker. JSNES's renderer iterates all 64 entries without enforcing
the scanline selection limit, so the runtime tests also evaluate the first
eight OAM entries on a deliberately crowded row instead of relying on its
rendered image alone.

## Transport prototype

Enemy-record bits 4–5 hold a group (editor numbers 1–4); bits 7/6 keep their
screen/facing meanings. Exactly two Sprite 13 records in a group form a pair.
Records load into descending native slots, so the higher slot starts as entry.
The editor labels the first placed endpoint A and the second B; invalid groups
show a red question mark and remain animated but do not transport anything.

Roles swap every 300 active updates, freezing during pause. Entry animation
cycles forward. The exit stays on frame 6, a transparent numbered outline. The final
60 updates form a neutral changeover for the entry: contracted frame 4 for 16 updates,
small frame 5 for 28, then frame 4 for 16. Both ends disable transport during
this interval, then exchange roles and resume normal animation. A player
within four pixels of an active entry's center transfers automatically,
without directional input. Remaining on an exit permits return on the next
changeover; the cooldown still prevents an immediate repeat.
Successful transfers play native defeat poses $10, $0F and $0E at the entry for 4, 8 and 4 live updates. The entry reuses its own projected enemy slot. Player travel resets movement and bird attachment, then scrolls toward the active camera target over those 16 updates. The pan freezes during pause. Both endpoints receive a 30-tick cooldown. Tile transfers carry
the original 4-bit ID, including rescue NPCs. Live enemies, bombs, missiles
and loose tile sprites move in their native slots. The statue and its two
collision tiles stay fixed. The editor reserves a one-cell margin around
the 2×2 exit. For legacy overlaps the native exit cell writer ($B663) calls
a fixed-bank guard at $F7C8 before producing a metatile packet.

The worker lives in unused bank 1 at CPU `$A900` (file `$6910`), after the
pause/credit font data. The fixed-bank wrapper maps bank 1 only for RAM work,
then restores bank 0 before invoking native rendering/falling routines.
The wrapper briefly disables NMI through PPUCTRL during the bank switch,
clears a missed vblank via PPUSTATUS, then restores PPUCTRL in bank 0. This
avoids late drawing and leaves the original NMI handler and its cycle budget
intact, including the existing `$F0xx` loader guard.

New RAM `$05E6–$05ED` stores groups; `$05EE–$05F7` stores bank-switch and
transport scratch state, and `$05F8` stores the background scheduling cursor,
after the bird arrays ending at `$05E5`. The player pan uses `$05F9–$05FB` for the remaining updates and previous scroll position. Per-portal
native fields `$0526/$0536/$0546/$056E/$057E` hold role, partner, clock low,
clock high, and cooldown. `$052E/$053E/$0556` hold the overlay flag, displayed
frame, and cached background frame. All reset during portal initialization.

Destinations must be empty map cells without overlapping actors/falling
objects. Map transfers wait
for an empty native background queue and commits both map nibbles together,
then queues source restoration and destination painting. Native `$FF`
fall records are stationary support watchers: remove the source watcher
before moving its stone, then register the destination and check anything
above the vacated cell. Falling map records can hand off at an aligned cell,
after the native fall routine has removed the original map nibble.
Original ROM files and original CHR data remain untouched.
