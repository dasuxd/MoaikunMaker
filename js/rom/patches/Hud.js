class Hud {
    static configureLevelTimer(romData, enabled = true){
        const bank0RomAddr = (cpuAddr) => 0x10 + (cpuAddr - 0x8000);
        const timerRenderCall = enabled
            ? [0x20, 0xA4, 0xB6]    // JSR $B6A4
            : [0xEA, 0xEA, 0xEA];   // hide timer HUD
        const timerUpdateCall = enabled
            ? [0x20, 0xF3, 0xB6]    // JSR $B6F3
            : [0xEA, 0xEA, 0xEA];   // stop countdown and timeout

        Asm6502.writeBytes(
            romData,
            bank0RomAddr(0x8918),
            timerRenderCall
        );
        Asm6502.writeBytes(
            romData,
            bank0RomAddr(0x8B75),
            timerUpdateCall
        );
    }

    static CLOCK = 0x5FD;
    static SWITCH_TICKS = 120;
    static ENTRY = 0x8940; // Bank 6, after penguin worker, before CHR manifest.
    static BRIDGE = 0xFFDA; // Native reset returns at $FFD9; vectors begin $FFFA.

    // Exact pixels from 3333.png / 44444.png, encoded in NES ink order:
    // transparent, main colour, white, outline. Upper 8 rows stay transparent
    // so the artwork aligns with the native HUD digits in the lower tile.
    static iconPatterns(kind) {
        const rows = kind === 'remote' ? [
            '00000030', '01111323', '11211131', '12111111',
            '33333333', '22323232', '13333331', '01111110'
        ] : [
            '03333330', '03111113', '31331333', '31211123',
            '31211123', '31333313', '31322313', '03111130'
        ];
        const bytes = new Uint8Array(32);
        rows.forEach((row, y) => [...row].forEach((ink, x) => {
            bytes[y + 16] |= (Number(ink) & 1) << (7 - x);
            bytes[y + 24] |= (Number(ink) >> 1) << (7 - x);
        }));
        return bytes;
    }

    // Sprite palette 3 is the native released-rescue palette. Keep it in
    // sync with Tile 15's selected background palette, including custom ROMs.
    static syncRescuePalette(rom) {
        const shift = rom.length > 0x10010 ? 0x18000 : 0;
        for (let scene = 0; scene < 12; scene++) {
            const pointer = RomLayout.PALETTES_ADDRESS_ORIGINAL + shift + scene * 2;
            const palette = (rom[pointer] | rom[pointer + 1] << 8) - 0x8000 + 16 + shift;
            const attributes = 0x3FF4 + scene * 4 + 3;
            const group = rom[attributes + (attributes >= 0x4010 ? shift : 0)] & 3;
            for (let ink = 1; ink < 4; ink++) rom[palette + 28 + ink] = rom[palette + group * 4 + ink];
        }
    }

    static install(rom, config, buildSmoke = null) {
        const file = RomLayout.programOffset;
        const layout = GraphicsCatalog.SCENE_GRAPHICS_LAYOUT;
        const guard = Portal.PORTAL_RAM.bankActive;
        // NMI must see the bank guard throughout the visit, including the
        // return to bank 0. All HUD drawing happens in bank 6 without calls
        // into bank 0; fixed-bank digit artwork indices remain accessible.
        const bridge = Asm6502.block(Hud.BRIDGE, 0xFFF0);
        bridge.emit(0xA9, 6, 0x8D, guard & 255, guard >> 8, 0x8D, 0, 0x80,
            0x20, Hud.ENTRY & 255, Hud.ENTRY >> 8,
            0xA9, 0, 0x8D, 0, 0x80, 0x8D, guard & 255, guard >> 8, 0x60);
        bridge.resolve(); rom.set(bridge.bytes, file(Hud.BRIDGE));
        rom.set([0x20, Hud.BRIDGE & 255, Hud.BRIDGE >> 8], file(0x891B));
        // Timer keeps its native renderer, coordinates and palette.
        rom[file(0xB6E1)] = layout.timerIcon;

        const b = Asm6502.block(Hud.ENTRY, 0x8A00);
        const {emit, label, absolute: abs, branch} = b;
        const jsr = target => abs(0x20, target);
        // Count held charges first, so an empty type never takes a turn.
        emit(0xA6, 4, 0xA9, 0, 0x85, 0x13, 0xA0, 7);
        label('inventory'); abs(0xB9, 0x4FE); emit(0xC9, 14); branch(0xD0, 'next');
        abs(0xB9, 0x506); emit(0xC9, 2); branch(0xD0, 'next');
        emit(0xE6, 0x13); // Carried, including an unfinished placement preview.
        label('next'); emit(0x88); branch(0x10, 'inventory');
        emit(0xA5, 0x13); branch(0xF0, 'timed');
        emit(0xA5, 0xCE); branch(0xF0, 'remote');
        abs(0xAD, Hud.CLOCK); emit(0xC9, Hud.SWITCH_TICKS); branch(0x90, 'timed');
        label('remote');
        emit(0xA9, layout.remoteBombIcon, 0x85, 0x12,
            0xA9, 2, 0x85, 0x14); abs(0x4C, 'bomb');
        label('timed');
        emit(0xA5, 0xCE); branch(0xF0, 'rescue');
        emit(0x85, 0x13, 0xA9, layout.bombIcon, 0x85, 0x12,
            0xA9, 1, 0x85, 0x14);
        label('bomb');
        emit(0xA9, 0xD0, 0x85, 0x10, 0xA9, 7, 0x85, 0x11,
            0xA5, 0x12, 0xA4, 0x14); jsr('sprite');
        emit(0xA9, 0xE0, 0x85, 0x10, 0xA5, 0x13); jsr('number');
        label('rescue');
        if (config.showRemainingRescueCount) {
            // Screen-space bottom right, with a 16px bottom/right margin.
            // OAM Y is one less than the first visible row of an 8x16 sprite.
            emit(0xA9, 0xD0, 0x85, 0x10,
                0xA9, 0xCF, 0x85, 0x11,
                0xA9, layout.rescueIcon, 0xA0, 3); jsr('sprite');
            emit(0xA9, 0xE0, 0x85, 0x10, 0xA5, 0x43);
            jsr('number');
        }
        if (buildSmoke !== null) abs(0x4C, buildSmoke);
        else emit(0x60);

        label('number');
        emit(0xC9, 100); branch(0x90, 'bounded'); emit(0xA9, 99);
        label('bounded'); emit(0xA0, 0, 0x84, 0x73);
        label('divide'); emit(0xC9, 10); branch(0x90, 'digits');
        emit(0xE9, 10, 0xE6, 0x73); abs(0x4C, 'divide');
        label('digits'); emit(0x85, 0x74, 0xA4, 0x73); abs(0xB9, 0xC3BD);
        emit(0xA0, 1); jsr('sprite');
        emit(0xA5, 0x10, 0x18, 0x69, 8, 0x85, 0x10, 0xA4, 0x74); abs(0xB9, 0xC3BD);
        emit(0xA0, 1); // Fall through to the units sprite.
        label('sprite');
        emit(0x9D, 1, 2, 0x98, 0x9D, 2, 2,
            0xA5, 0x10, 0x9D, 3, 2, 0xA5, 0x11, 0x9D, 0, 2,
            0xC6, 7, 0x18, 0x8A, 0x69, 0xC4, 0xAA, 0x86, 4, 0x60);
        b.resolve();
        const offset = 0x18010 + Hud.ENTRY - 0x8000;
        if (rom.subarray(offset, 0x18A10).some(Boolean)) throw new Error('HUD bank reservation occupied');
        rom.set(b.bytes, offset);
        return {start: b.base, end: b.base + b.bytes.length};
    }
}
