/** Type 15: a rideable walker that builds ice across gaps. */
class Penguin {
    // One switch controls the toolbar, CHR allocation and all ROM hooks.
    static ENABLED = true;
    static META = 0x4D;
    static TILE = 0xB2;
    static ENTRY = 0x8600; // Bank 6, after RemoteBomb and before scene manifests.
    static BUILD_TICKS = 120;
    static ICE_TILE = 6;
    static BLOCK_TILE = 5;
    static ICE_SCENE = 6;
    // Fixed-bank tails of the retired pause-look code and ending credits.
    // The return stub keeps the bank-6 NMI guard intact throughout native calls.
    static NATIVE_CALL = 0xFF51;
    static NATIVE_RETURN = 0xF936;
    // The 384-byte scene manifest ends at $8B80; CHR pages start at $8C00.
    static LIFE_ENTRY = 0x8B80;
    // The bank-6 scene marker occupies $8010-$8018. Effects and contact
    // handling share the remaining header space before the bomb worker.
    static BUILD_SMOKE_ENTRY = 0x8019;
    // Type 15 borrows the bird-only fright byte in its own slot. Bit 7
    // means this update is building ice; low bits animate while waiting.
    static BUILD_SMOKE_CLOCK = 0x5C6;

    static install(rom, passenger) {
        if (!Penguin.ENABLED) return;
        const file = RomLayout.programOffset;
        const restore = Penguin.NATIVE_RETURN, dispatch = restore + 6;
        // $16:$17 selects a bank-0/fixed routine. Preserve its input A and
        // returned carry; other flags and A are scratch on return to bank 6.
        rom.set([0x48, 0xA9, 0, 0x8D, 0, 0x80, 0x68,
            0x20, dispatch & 255, dispatch >> 8, 0x4C, restore & 255, restore >> 8], file(Penguin.NATIVE_CALL));
        if (rom.subarray(file(Penguin.NATIVE_RETURN), file(0xF940)).some(Boolean))
            throw new Error('Penguin native return reservation occupied');
        rom.set([0xA9, 6, 0x8D, 0, 0x80, 0x60, 0x6C, 0x16, 0], file(Penguin.NATIVE_RETURN));
        const program = Asm6502.program();
        const b = program.section(Penguin.ENTRY, Hud.ENTRY);
        const {emit, label, absolute: abs, branch} = program;
        const jump = target => abs(0x4C, target), jsr = target => abs(0x20, target);
        const lx = address => abs(0xBD, address), sx = address => abs(0x9D, address);
        const far = (op, target) => {emit(op ^ 0x20, 3); jump(target);};
        const native = (target, value) => {
            emit(0xA0, target & 255, 0x84, 0x16, 0xA0, target >> 8, 0x84, 0x17);
            if (typeof value === 'string') jsr(value);
            else if (value !== undefined) emit(0xA9, value);
            jsr(Penguin.NATIVE_CALL);
        };

        // Called inside RemoteBomb's guarded bank-6 visit. Only per-slot
        // native object bytes and volatile scratch are used here. Run after
        // player physics so landings see this frame's descending feet.
        emit(0xA2, 7);
        label('scan'); lx(0x4FE); emit(0xC9, 15); far(0xD0, 'next');
        lx(Penguin.BUILD_SMOKE_CLOCK); emit(0x29, 0x7F); sx(Penguin.BUILD_SMOKE_CLOCK);
        emit(0xA5, 0x3E, 0xC9, 7); far(0xF0, 'hide');
        emit(0xC9, 8); far(0xF0, 'hide');
        jsr('lifecycle'); far(0xB0, 'next');
        label('live');
        jsr('playerTurn');
        lx(0x516); sx(0x526);
        emit(0xA9, 0); sx(0x54E);
        emit(0xA9, Penguin.META); sx(0x415);
        lx(0x556); emit(0xC9, 4, 0xA9, 0); branch(0x90, 'facing');
        emit(0x09, 0x40); label('facing'); sx(0x46F);

        // Settle onto a floor, but do not walk off a ledge. Y is the native
        // centre anchor; no change to the standing image or collision size.
        lx(0x433); emit(0xC9, 0xE8); far(0xB0, 'bottom');
        jsr('below'); branch(0xD0, 'ground');
        abs(0xFE, 0x433); emit(0xA9, 0); sx(0x57E); jump('ride');
        label('ground'); lx(0x433); emit(0x29, 15, 0xC9, 8); branch(0xF0, 'probe');
        abs(0xDE, 0x433); jump('ride');
        label('probe');

        // Probe eight pixels ahead at body and foot height. This handles
        // page boundaries and wrapping by the actual 16/32-column map width.
        lx(0x556); emit(0xC9, 4, 0xA9, 8); branch(0xB0, 'ahead'); emit(0xA9, 0xF8);
        label('ahead'); jsr('column');
        lx(0x433); emit(0x4A, 0x4A, 0x4A, 0x4A, 0x85, 1);
        jsr('solid'); far(0xD0, 'reverse');
        emit(0xE6, 1); jsr('solid'); branch(0xD0, 'walk');
        // Only empty, in-bounds cells can become ice. Do not erase items.
        emit(0xA5, 1, 0xC9, 14); far(0xB0, 'reverse');
        emit(0xA5, 4); far(0xD0, 'reverse');
        lx(0x546); emit(0xC5, 0); branch(0xD0, 'newTarget');
        lx(0x56E); emit(0xC5, 1); branch(0xF0, 'sameTarget');
        label('newTarget'); emit(0xA9, 0); sx(0x57E); sx(Penguin.BUILD_SMOKE_CLOCK);
        label('sameTarget');
        emit(0xA5, 0); sx(0x546); emit(0xA5, 1); sx(0x56E);
        lx(Penguin.BUILD_SMOKE_CLOCK); emit(0x18, 0x69, 1, 0xC9, 20);
        branch(0x90, 'buildSmokePhase'); emit(0xA9, 0);
        label('buildSmokePhase'); emit(0x09, 0x80); sx(Penguin.BUILD_SMOKE_CLOCK);
        lx(0x57E); emit(0xC9, Penguin.BUILD_TICKS); branch(0xB0, 'build');
        abs(0xFE, 0x57E); lx(0x57E); emit(0xC9, Penguin.BUILD_TICKS); far(0x90, 'ride');
        label('build'); jsr('ice'); jump('ride');

        // Half a pixel/update, continuously until a wall or a gap.
        label('walk'); emit(0xA9, 0); sx(0x57E); abs(0xFE, 0x566);
        lx(0x51E); emit(0x49, 0x80); sx(0x51E); branch(0x30, 'pose');
        lx(0x556); emit(0xC9, 4); branch(0xB0, 'right');
        lx(0x516); branch(0xD0, 'leftLow'); abs(0xDE, 0x50E);
        label('leftLow'); abs(0xDE, 0x516); jump('wrap');
        label('right'); abs(0xFE, 0x516); branch(0xD0, 'wrap'); abs(0xFE, 0x50E);
        label('wrap'); lx(0x50E); emit(0x25, 0x3D); sx(0x50E);
        label('pose'); lx(0x566); emit(0x4A, 0x4A, 0x4A, 0x29, 1, 0xA8);
        abs(0xB9, 'poses'); sx(0x415); jump('ride');
        label('reverse'); lx(0x556); emit(0x49, 7); sx(0x556);
        emit(0xA9, 0); sx(0x57E);
        label('ride'); jsr('passenger'); jump('next');
        label('bottom'); native(0xB127); jump('next');
        label('hide'); emit(0xA9, 0); sx(0x415); sx(0x4FE); sx(0x53E);
        label('next'); emit(0xCA); far(0x10, 'scan'); emit(0x60);
        label('poses'); emit(Penguin.META + 1, Penguin.META + 2);

        label('below'); emit(0xA9, 0); jsr('column');
        lx(0x433); emit(0x18, 0x69, 8, 0x4A, 0x4A, 0x4A, 0x4A, 0x85, 1);
        jump('solid');
        // A = signed horizontal pixel offset; result $00 = wrapped column.
        label('column'); emit(0x85, 2, 0x0A, 0xA9, 0, 0xE9, 0, 0x49, 255, 0x85, 3,
            0x18); lx(0x516); emit(0x65, 2, 0x85, 2); lx(0x50E);
        emit(0x65, 3, 0x25, 0x3D, 0x4A, 0xA5, 2, 0x6A, 0x4A, 0x4A, 0x4A, 0x85, 0, 0x60);
        label('solid'); // Row/column to the native packed map, preserving X.
        emit(0xA5, 1, 0xC9, 14); branch(0xB0, 'air');
        emit(0xA5, 0, 0x4A, 0x85, 2, 0xA5, 1, 0x0A, 0x0A, 0x0A, 0x0A,
            0x18, 0x65, 2, 0xA8, 0xB9, 0, 7, 0x85, 2, 0xA5, 0, 0x4A, 0xA5, 2);
        branch(0xB0, 'lowNibble'); emit(0x4A, 0x4A, 0x4A, 0x4A);
        label('lowNibble'); emit(0x29, 15, 0x85, 4, 0xA8); abs(0xB9, 'solidity'); emit(0x60);
        label('air'); emit(0xA9, 0, 0x60);
        // Same solidity classification as the native enemy map probes.
        label('solidity'); emit(...rom.subarray(RomLayout.programOffset(0xBF20), RomLayout.programOffset(0xBF30)));

        label('passenger');
        emit(0xA5, 0x56, 0xC9, 3); branch(0xD0, 'detach');
        emit(0xA5, 0xC0, 0xC9, 3); branch(0xB0, 'detach');
        emit(0xA5, 0xC7); branch(0x30, 'detach');
        native(passenger.overlap); branch(0x90, 'detach');
        lx(0x53E); branch(0xF0, 'landing');
        emit(0xA5, 0xC0, 0xC9, 1); branch(0xF0, 'carry');
        label('landing'); emit(0xA5, 0xC0, 0xC9, 2); branch(0xD0, 'detach');
        emit(0x18, 0xAD, 0x1E, 4, 0x69, 16, 0x85, 2, 0xA5, 0x7D, 0x69, 0);
        branch(0xD0, 'detach');
        emit(0xA5, 2, 0x38); abs(0xFD, 0x433); branch(0x90, 'detach');
        emit(0x85, 0, 0xA5, 0xC7, 0x18, 0x69, 1, 0xC5, 0); branch(0x90, 'detach');
        emit(0xA9, 1); sx(0x53E); emit(0x85, 0xC0, 0xA9, 0, 0x85, 0xDA, 0x85, 0x5B);
        label('carry'); native(passenger.carry); emit(0x60);
        label('detach'); emit(0xA9, 0); sx(0x53E); emit(0x60);

        label('ice');
        // Leave a full background packet's budget for native producers and
        // the narrow-map mirror. Saturated timers retry without wrapping.
        emit(0xA5, 0x1E, 0xC9, 0x10); far(0xB0, 'iceDone');
        // Falling tiles temporarily leave map RAM; do not build through one.
        emit(0xA0, 9);
        label('falling'); abs(0xB9, 0x4C0); branch(0xF0, 'nextFall');
        emit(0xC9, 0xFF); branch(0xF0, 'nextFall');
        abs(0xB9, 0x4D4); emit(0x4A); abs(0xDD, 0x546); branch(0xD0, 'nextFall');
        lx(0x56E); emit(0x0A, 0x38); abs(0xF9, 0x4DE);
        emit(0x18, 0x69, 1, 0xC9, 3); far(0x90, 'iceDone');
        label('nextFall'); emit(0x88); branch(0x10, 'falling');
        // Do not create a solid inside the player's 16px body.
        emit(0xA5, 0x7D); branch(0xD0, 'paint');
        lx(0x546); emit(0x4A, 0x4A, 0x4A, 0x4A, 0x85, 3);
        lx(0x546); emit(0x0A, 0x0A, 0x0A, 0x0A, 0x09, 8, 0x38, 0xE5, 0xC2, 0x85, 2,
            0xA5, 3, 0xE5, 0xC1, 0x85, 3, 0x18, 0xA5, 2, 0x69, 15, 0x85, 2,
            0xA5, 3, 0x69, 0, 0x25, 0x3D); branch(0xD0, 'paint');
        emit(0xA5, 2, 0xC9, 31); branch(0xB0, 'paint');
        lx(0x56E); emit(0x0A, 0x0A, 0x0A, 0x0A, 0x09, 8, 0x38, 0xED, 0x1E, 4,
            0x18, 0x69, 15, 0xC9, 31); branch(0x90, 'iceDone');
        label('paint');
        lx(0x546); emit(0x85, 0, 0x85, 8); lx(0x56E); emit(0x85, 1, 0x85, 9);
        emit(0x8A, 0x48);
        native(0x8E2C, 'buildTile');
        native(0x90F5);
        native(0x9162, 'buildTile');
        native(0x91C0, 'buildTile');
        native(0x903D);
        emit(0x68, 0xAA);
        lx(Penguin.BUILD_SMOKE_CLOCK); emit(0x29, 0x7F); sx(Penguin.BUILD_SMOKE_CLOCK);
        label('iceDone'); emit(0x60);
        // Select the same terrain for collision RAM, artwork and palette.
        label('buildTile'); emit(0xA5, 0x3E, 0xC9, Penguin.ICE_SCENE); branch(0xD0, 'plainTile');
        emit(0xA9, Penguin.ICE_TILE, 0x60);
        label('plainTile'); emit(0xA9, Penguin.BLOCK_TILE, 0x60);
        // Keep native death velocity/flip/timer bytes untouched by walking,
        // carrying and ice-building. Only active state 1 reaches the worker.
        program.section(Penguin.LIFE_ENTRY, 0x8C00);
        label('lifecycle');
        lx(0x506); emit(0xC9, 12); branch(0xD0, 'lifeState');
        // Tile 13's native stun dispatch indexes tables that end at type 11.
        // Its impact defeats the grounded penguin instead of entering that AI.
        native(0xB127);
        label('lifeState'); lx(0x506); branch(0xF0, 'spawn');
        emit(0xC9, 10); branch(0xB0, 'defeat');
        native(passenger.motion.hazards);
        lx(0x506); emit(0xC9, 10); branch(0xB0, 'defeat');
        emit(0x18, 0x60);
        label('defeat'); native(0xA9CF); emit(0x38, 0x60);
        label('spawn'); native(0xAE9C);
        lx(0x566); abs(0x1D, 0x55E); branch(0xD0, 'smoke');
        native(passenger.init);
        emit(0xA9, 0); sx(0x51E); emit(0x18, 0x60);
        label('smoke'); emit(0xA9, 0x80); sx(0x54E);
        abs(0xBC, 0x55E); abs(0xB9, 'smokeFrames'); sx(0x415);
        emit(0x38, 0x60);
        label('smokeFrames'); emit(...rom.subarray(file(0xB530), file(0xB539)));

        // Tail-called by the HUD's guarded bank-6 OAM pass. Draw directly
        // with native smoke metasprites, without allocating an enemy slot.
        // Pausing freezes the worker clock but still projects the effect
        // through the current camera. Never change native death timers.
        const effect = program.section(Penguin.BUILD_SMOKE_ENTRY, 0x8100);
        emit(0xA2, 7);
        label('buildSmokeSlot');
        lx(0x4FE); emit(0xC9, 15); far(0xD0, 'buildSmokeNext');
        lx(0x506); emit(0xC9, 1); far(0xD0, 'buildSmokeNext');
        lx(Penguin.BUILD_SMOKE_CLOCK); far(0x10, 'buildSmokeNext');
        lx(0x57E); far(0xF0, 'buildSmokeNext');
        // A second penguin may have completed this same cell later in the
        // update. Recheck the map, preserving the OAM cursor used by solid.
        emit(0xA5, 4, 0x48);
        lx(0x546); emit(0x85, 0); lx(0x56E); emit(0x85, 1); jsr('solid');
        emit(0xA5, 4, 0x85, 3, 0x68, 0x85, 4, 0xA5, 3); branch(0xD0, 'buildSmokeNext');
        // Native anchors use column/row * 16 + 8. The OAM pass adds 7
        // to Y before its two-column writer subtracts 8 (hardware Y-1).
        // Apply the full camera subtraction before clipping wide-map pages.
        lx(0x546); emit(0x4A, 0x4A, 0x4A, 0x4A, 0x85, 3);
        lx(0x546); emit(0x0A, 0x0A, 0x0A, 0x0A, 0x09, 8,
            0x38, 0xE5, 0xFD, 0x85, 2, 0xA5, 3, 0xE5, 0x9D, 0x25, 0x3D);
        branch(0xD0, 'buildSmokeNext');
        emit(0xA5, 7, 0xC9, 1); branch(0x30, 'buildSmokeNext');
        lx(0x56E); emit(0x0A, 0x0A, 0x0A, 0x0A, 0x09, 15, 0x85, 1,
            0xA9, 0, 0x85, 0, 0x85, 0x0F, 0x8A, 0x48);
        lx(Penguin.BUILD_SMOKE_CLOCK); emit(0x29, 0x7F, 0xC9, 10, 0xA9, 8, 0x69, 0, 0xA6, 4);
        native(0x8932);
        emit(0x86, 4, 0x68, 0xAA);
        label('buildSmokeNext'); emit(0xCA); far(0x10, 'buildSmokeSlot'); emit(0x60);

        // Side contact faces away from the player, rather than toggling
        // every overlapping tick. Shared overlap handles both map seams;
        // its $00 is player-minus-penguin X + 13. Riders stay unaffected.
        label('playerTurn');
        emit(0xA5, 0x56, 0xC9, 3); branch(0xD0, 'turnDone');
        emit(0xA5, 0x7D); branch(0xD0, 'turnDone');
        emit(0xA5, 0xC0, 0xC9, 3); branch(0xB0, 'turnDone');
        lx(0x53E); branch(0xD0, 'turnDone');
        emit(0xAD, 0x1E, 4, 0x38); abs(0xFD, 0x433);
        emit(0x18, 0x69, 11, 0xC9, 23); branch(0xB0, 'turnDone');
        native(passenger.overlap); branch(0x90, 'turnDone');
        emit(0xA5, 0, 0xC9, 13, 0xA9, 4); branch(0x90, 'turnDirection'); emit(0xA9, 3);
        label('turnDirection'); abs(0xDD, 0x556); branch(0xF0, 'turnDone'); sx(0x556);
        emit(0xA9, 0); sx(0x57E); sx(Penguin.BUILD_SMOKE_CLOCK);
        label('turnDone'); emit(0x60);
        program.resolve();
        for (const block of program.blocks) {
            const at = 0x18010 + block.base - 0x8000;
            if (rom.subarray(at, at + block.limit - block.base).some(Boolean))
                throw new Error('Penguin bank reservation occupied');
            rom.set(block.bytes, at);
        }
        return {start: b.base, end: b.base + b.bytes.length, labels: Object.fromEntries(program.labels),
            lifeEnd: Penguin.LIFE_ENTRY + program.blocks[1].bytes.length,
            buildSmoke: effect.base, buildSmokeEnd: effect.base + effect.bytes.length};
    }
}
