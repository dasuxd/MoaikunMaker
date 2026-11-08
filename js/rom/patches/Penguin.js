/** Experimental type 15: a visual walk/idle study, with no gameplay role yet. */
class Penguin {
    // One switch controls the toolbar, CHR allocation and all ROM hooks.
    static ENABLED = true;
    static META = 0x4D;
    static TILE = 0xB2;
    static ENTRY = 0x8600; // Bank 6, after RemoteBomb and before scene manifests.
    static WALK_TICKS = 96;
    static REST_TICKS = 64;

    static install(rom) {
        if (!Penguin.ENABLED) return;
        const b = Asm6502.block(Penguin.ENTRY, Hud.ENTRY);
        const {emit, label, absolute: abs, branch} = b;
        const jump = target => abs(0x4C, target), jsr = target => abs(0x20, target);
        const lx = address => abs(0xBD, address), sx = address => abs(0x9D, address);
        const far = (op, target) => {emit(op ^ 0x20, 3); jump(target);};

        // Called inside RemoteBomb's guarded bank-6 visit. Only per-slot
        // native object bytes and volatile scratch $00-$04 are used here.
        emit(0xA2, 7);
        label('scan'); lx(0x4FE); emit(0xC9, 15); far(0xD0, 'next');
        emit(0xA5, 0x3E, 0xC9, 7); far(0xF0, 'hide');
        emit(0xC9, 8); far(0xF0, 'hide');
        lx(0x506); branch(0xD0, 'live');
        emit(0xA9, 1); sx(0x506);
        emit(0xA9, Penguin.WALK_TICKS); sx(0x566); // Start with a full standing pause.
        emit(0xA9, 0); sx(0x51E);
        label('live');
        emit(0xA9, 0x80); sx(0x54E); // Tile 13 cannot dispatch an undefined type-15 stun.
        emit(0xA9, Penguin.META); sx(0x415);
        lx(0x556); emit(0xC9, 4, 0xA9, 0); branch(0x90, 'facing');
        emit(0x09, 0x40); label('facing'); sx(0x46F);

        // Settle onto a floor, but do not walk off a ledge. Y is the native
        // centre anchor; no change to the standing image or collision size.
        lx(0x433); emit(0xC9, 0xE8); far(0xB0, 'hide');
        jsr('below'); branch(0xD0, 'ground');
        abs(0xFE, 0x433); jump('next');
        label('ground'); lx(0x433); emit(0x29, 15, 0xC9, 8); branch(0xF0, 'clock');
        abs(0xDE, 0x433); jump('next');
        label('clock'); lx(0x566); emit(0x18, 0x69, 1, 0xC9, Penguin.WALK_TICKS + Penguin.REST_TICKS);
        branch(0x90, 'saveClock'); emit(0xA9, 0);
        label('saveClock'); sx(0x566); emit(0xC9, Penguin.WALK_TICKS); far(0xB0, 'next');

        // Probe eight pixels ahead at body and foot height. This handles
        // page boundaries and wrapping by the actual 16/32-column map width.
        lx(0x556); emit(0xC9, 4, 0xA9, 8); branch(0xB0, 'ahead'); emit(0xA9, 0xF8);
        label('ahead'); jsr('column');
        lx(0x433); emit(0x4A, 0x4A, 0x4A, 0x4A, 0x85, 1);
        jsr('solid'); branch(0xD0, 'reverse');
        emit(0xE6, 1); jsr('solid'); branch(0xF0, 'reverse');

        // Half a pixel/update, with exactly 48 pixels per uninterrupted walk.
        lx(0x51E); emit(0x49, 0x80); sx(0x51E); branch(0x30, 'pose');
        lx(0x556); emit(0xC9, 4); branch(0xB0, 'right');
        lx(0x516); branch(0xD0, 'leftLow'); abs(0xDE, 0x50E);
        label('leftLow'); abs(0xDE, 0x516); jump('wrap');
        label('right'); abs(0xFE, 0x516); branch(0xD0, 'wrap'); abs(0xFE, 0x50E);
        label('wrap'); lx(0x50E); emit(0x25, 0x3D); sx(0x50E);
        label('pose'); lx(0x566); emit(0x4A, 0x4A, 0x4A, 0x29, 3, 0xA8);
        abs(0xB9, 'poses'); sx(0x415); jump('next');
        label('reverse'); lx(0x556); emit(0x49, 7); sx(0x556);
        emit(0xA9, Penguin.WALK_TICKS); sx(0x566); jump('next');
        label('hide'); emit(0xA9, 0); sx(0x415); sx(0x4FE);
        label('next'); emit(0xCA); far(0x10, 'scan'); emit(0x60);
        label('poses'); emit(Penguin.META + 1, Penguin.META + 2, Penguin.META + 1, Penguin.META + 2);

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
        label('lowNibble'); emit(0x29, 15, 0xA8); abs(0xB9, 'solidity'); emit(0x60);
        label('air'); emit(0xA9, 0, 0x60);
        // Same solidity classification as the native enemy map probes.
        label('solidity'); emit(...rom.subarray(RomLayout.programOffset(0xBF20), RomLayout.programOffset(0xBF30)));
        b.resolve();
        const offset = 0x18010 + Penguin.ENTRY - 0x8000;
        if (rom.subarray(offset, 0x18010 + Hud.ENTRY - 0x8000).some(Boolean)) throw new Error('Penguin bank reservation occupied');
        rom.set(b.bytes, offset);
        return {start: b.base, end: b.base + b.bytes.length};
    }
}
