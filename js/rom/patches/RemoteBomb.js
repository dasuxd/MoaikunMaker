class RemoteBomb {
    // Type 14 owns its native eight-slot object records: state 1 = pickup,
    // 2 = carried (also used for the placement preview), 3 = installed.
    // $0526 is FIFO rank; $055E is hold time; $056E is preview direction.
    // Before pickup, $055E/$056E instead hold the native falling clock/phase.
    // Installed: $055E = host tile type, $056E = falling-pool slot + 1 (0 = map).
    // Retired sore-head bytes $D7/$D8 queue a UI cue/native sound until bank 0 is restored.
    // Action is worker-local scratch (no native calls before its last read).
    // $05FD now holds the HUD clock; page 5 is cleared by native stage reset.
    static RAM = Object.freeze({previous: 0x5FC, action: 0x0F, head: 0x5FE, inventory: 0x5FF});
    static ENTRY = 0xFAE0;
    static ATTACH_ENTRY = 0xDA15; // Retired animation-filter tail, through $DA2D.
    static RENDER = 0x9468;
    static META = 0x4B;
    static INSTALL_TICKS = 60; // Active gameplay updates: about one second at 60 Hz.
    static SOUND_DATA = 0xFCE0; // Portal painter ends here; bird dispatcher starts at $FD00.
    static SOUND_BRIDGE = 0x9484; // After our renderer, before the native player tick.
    static SOUND = Object.freeze({start: 1, success: 2});

    static installSounds(rom) {
        const file = RomLayout.programOffset, base = RemoteBomb.SOUND_DATA;
        if (rom.subarray(file(base), file(0xFD00)).some(Boolean)) throw new Error('Remote sound reservation occupied');
        // Native raw pulse-effect format: duration, duty/volume mode, sweep
        // disabled, then volume+timer-high/timer-low pairs, terminated by FF.
        // 50% pulse at modest volume: E5; E5 -> B5.
        const streams = [[6, 0xB0, 0x88, 0x80, 0xA9, 0xFF],
            [6, 0xB0, 0x88, 0x80, 0xA9, 0x80, 0x70, 0xFF]];
        let cursor = base + streams.length;
        const pointers = streams.map(stream => {const low = cursor & 255;cursor += stream.length;return low;});
        rom.set([...pointers, ...streams.flat()], file(base));
        // Initialize the native pickup-effect channel (logical slot 4,
        // pulse 1), then replace only its stream pointer for UI cues. Its
        // native termination restores the music channel automatically.
        const b = Asm6502.block(RemoteBomb.SOUND_BRIDGE, 0x949F);
        b.emit(0x20, 0xDA, 0x80, 0xA5, 0xD7); b.branch(0xF0, 'done');
        b.emit(0x8A, 0x48, 0xA6, 0xD7, 0xBD, (base - 1) & 255, base >> 8,
            0x8D, 0x2C, 1, 0xA9, base >> 8, 0x8D, 0x32, 1, 0x68, 0xAA);
        b.label('done'); b.emit(0x60); b.resolve(); rom.set(b.bytes, file(b.base));
    }

    // Palette 2 is shared with native timed bombs and the exit. The user
    // chose to recolour that entire group from collectible bomb Tile 11.
    // Run before portal colour selection, both in previews and ROM export.
    static syncPickupPalette(romData) {
        const shift = romData.length > 0x10010 ? 0x18000 : 0;
        for (let scene = 0; scene < 12; scene++) {
            const pointer = RomLayout.PALETTES_ADDRESS_ORIGINAL + shift + scene * 2;
            const palette = (romData[pointer] | romData[pointer + 1] << 8) - 0x8000 + 16 + shift;
            const attributes = 0x3FF4 + scene * 4 + 2;
            // This native table straddles $C000; scenes 8–11 move with the fixed bank.
            const group = romData[attributes + (attributes >= 0x4010 ? shift : 0)] & 3;
            // Leave universal/transparent entries alone; copy only opaque inks.
            for (let ink = 1; ink < 4; ink++) romData[palette + 24 + ink] = romData[palette + group * 4 + ink];
        }
    }

    // User-supplied 16x16 charge artwork (444444.png). Preserve the body;
    // only the four pixels of its 2x2 indicator light change colour.
    // Indices: transparent, bomb colour, highlight, outline. No RGB colours.
    // Both poses share the left 8x16 column at $48/$49. Their right columns
    // use $4A/$4B and $4C/$4D; $4E/$4F remains available for spawn smoke.
    static patterns() {
        const rows = [
            '0333333333333330',
            '3311111111111133',
            '3112212111133113',
            '3122111111322313',
            '3121111111322313',
            '3111111111133113',
            '3111111111111113',
            '3133333333333333',
            '3322222222222233',
            '3233323223233323',
            '3223223323223223',
            '3223223233223223',
            '3322222222222233',
            '3133333333333313',
            '3311111111111133',
            '0333333333333330'
        ];
        const result = new Uint8Array(96);
        [0, 1].forEach(frame => rows.forEach((row, y) => {
            for (let x = 0; x < 16; x++) {
                if (frame === 1 && x < 8) continue;
                const indicator = x >= 11 && x <= 12 && y >= 3 && y <= 4;
                const value = frame === 1 && indicator ? 1 : Number(row[x]);
                const at = (x < 8 ? 0 : 32 + frame * 32) + (y >> 3) * 16 + (y & 7);
                result[at] |= (value & 1) << (7 - (x & 7));
                result[at + 8] |= (value >> 1) << (7 - (x & 7));
            }
        }));
        return result;
    }

    static install(rom) {
        const file = RomLayout.programOffset, r = RemoteBomb.RAM;
        // Retire sore-head accumulation, moving the solid-crush lookup into
        // its old bank-0 handler. Its old fixed reservation becomes a bridge.
        rom.fill(0, file(0x95E4), file(0x95F9));
        if (rom[file(0x9877)] === 0x20 && rom[file(0x9878)] === 0xE0 && rom[file(0x9879)] === 0xFA) {
            rom.copyWithin(file(0x95E4), file(0xFAE0), file(0xFAE0) + 17);
            Asm6502.writeBytes(rom, file(0x9877), [0x20, 0xE4, 0x95]);
        }
        rom[file(0x95E3)] = 0x60;
        rom.fill(0, file(0xFAE0), file(0xFB00));
        const guard = Portal.PORTAL_RAM.bankActive;
        Asm6502.writeBytes(rom, file(RemoteBomb.ENTRY), [
            0xA9, 6, 0x8D, guard & 255, guard >> 8, 0x8D, 0, 0x80,
            0x20, 0, 0x81,
            0xA9, 0, 0x8D, 0, 0x80,
            0xA5, 0xD8, 0xF0, 3, 0x20, RemoteBomb.SOUND_BRIDGE & 255, RemoteBomb.SOUND_BRIDGE >> 8,
            // Keep the NMI guard until the native sound pointer is complete.
            0xA9, 0, 0x8D, guard & 255, guard >> 8,
            0x4C, 0x9F, 0x94
        ]);
        Asm6502.writeBytes(rom, file(0x941A), [0x20, RemoteBomb.ENTRY & 255, RemoteBomb.ENTRY >> 8]);
        // Called only for our two metasprite IDs. The native OAM writer
        // still performs clipping, priority and the scanline sprite limit.
        Asm6502.writeBytes(rom, file(RemoteBomb.RENDER), [
            0x38, 0xE9, RemoteBomb.META, 0x0A, 0x18, 0x69, 0x4A,
            0x85, 0x11, 0xA9, 0x48, 0x85, 0x10,
            0xA5, 0, 0x85, 0x12, 0x85, 0x13, 0xA9, 0, 0x85, 0x0F,
            0x4C, 0x51, 0x89
        ]);
        for (let page = 1; page <= 3; page++) {
            const base = 0x8010 + page * 0x2000;
            rom.set(RemoteBomb.patterns(), base + 0x480);
            // Pause settings restores $00-$5F from these prepared source
            // pages. Keep the relocated smoke identical to compiled CHR.
            rom.copyWithin(base + GraphicsCatalog.SCENE_GRAPHICS_LAYOUT.spawnSmoke * 16,
                base + 0xE40, base + 0xE60);
        }
        RemoteBomb.installSounds(rom);

        // Bank 6 $8100-$85FF; the optional penguin worker follows at $8600.
        const b = Asm6502.block(0x8100, Penguin.ENABLED ? Penguin.ENTRY : Hud.ENTRY);
        const {emit, label, absolute: abs, branch, resolve} = b;
        const jump = target => abs(0x4C, target), jsr = target => abs(0x20, target);
        const far = (op, target) => { emit(op ^ 0x20, 3); jump(target); };
        const lda = a => abs(0xAD, a), sta = a => abs(0x8D, a);
        const lx = a => abs(0xBD, a), sx = a => abs(0x9D, a);

        label('tick');
        if (Penguin.ENABLED) jsr(Penguin.ENTRY);
        // Only active gameplay updates reach this worker: pause freezes the
        // alternating HUD and the native stage reset restarts at timed bombs.
        abs(0xEE, Hud.CLOCK); lda(Hud.CLOCK); emit(0xC9, Hud.SWITCH_TICKS * 2);
        branch(0x90, 'hudClockReady'); emit(0xA9, 0); sta(Hud.CLOCK);
        label('hudClockReady');
        emit(0xA9, 0, 0x85, 0xD6, 0x85, 0xD7, 0x85, 0xD8);
        lda(r.head); branch(0x30, 'noAttachments'); jsr('attachments'); label('noAttachments');
        // Only detonation is edge-triggered. Placement uses held direction
        // and a per-inventory-slot timer; pause stops this worker entirely.
        emit(0xA9, 0, 0x85, 0x10, 0xA5, 0xF6, 0x29, 0x48, 0xC9, 0x48);
        branch(0xD0, 'combos'); emit(0xA9, 4, 0x85, 0x10);
        label('combos'); lda(r.previous); emit(0x49, 255, 0x25, 0x10); sta(r.action);
        emit(0xA5, 0x10); sta(r.previous);
        emit(0xA9, 255); sta(r.head); sta(r.inventory);
        emit(0xA9, 0, 0x85, 0x14, 0x85, 0x15, 0xA2, 7);
        label('scan'); lx(0x4FE); emit(0xC9, 14); far(0xD0, 'next');
        lx(0x506); branch(0xD0, 'initialized');
        emit(0xA9, 1); sx(0x506); emit(0xA9, 0x80); sx(0x54E);
        lx(0x516); emit(0x29, 0xF0, 0x09, 8); sx(0x516);
        label('initialized'); lx(0x506); emit(0xC9, 2); branch(0xD0, 'notHeld');
        emit(0xE6, 0x15, 0x8A); sta(r.inventory); jump('hide');
        label('notHeld'); emit(0xC9, 3); branch(0xD0, 'pickup');
        emit(0xE6, 0x15, 0xE6, 0x14); lx(0x526); emit(0xC9, 1); branch(0xD0, 'next');
        emit(0x8A); sta(r.head); jump('next');
        label('pickup');
        jsr('fall'); lx(0x4FE); branch(0xF0, 'next');
        emit(0xA5, 0x56, 0xC9, 3); branch(0xD0, 'next');
        emit(0xA5, 0x7D); branch(0xD0, 'next');
        emit(0xA5, 0xC0); branch(0xF0, 'next'); emit(0xC9, 3); branch(0xB0, 'next');
        // Signed 16-bit horizontal distance, including wide-map page edges.
        emit(0x38, 0xA5, 0xC2); abs(0xFD, 0x516); emit(0x85, 0x11,
            0xA5, 0xC1); abs(0xFD, 0x50E); emit(0x85, 0x12,
            0x18, 0xA5, 0x11, 0x69, 11, 0x85, 0x11, 0xA5, 0x12, 0x69, 0);
        branch(0xD0, 'next'); emit(0xA5, 0x11, 0xC9, 23); branch(0xB0, 'next');
        emit(0x38); lda(0x41E); abs(0xFD, 0x433); emit(0x18, 0x69, 12, 0xC9, 25); branch(0xB0, 'next');
        emit(0xA9, 2); sx(0x506); emit(0xE6, 0x15, 0x8A); sta(r.inventory);
        emit(0xA9, 0); sx(0x55E); sx(0x56E);
        emit(0xA9, 0x17, 0x85, 0xD8); // Same sound as native bomb pickup ($988C).
        label('hide'); emit(0xA9, 0); sx(0x415);
        label('next'); emit(0xCA); far(0x10, 'scan');
        emit(0xA5, 0x15); far(0xF0, 'draw');
        // Up + attack takes priority over placement, including while held.
        label('maskAttack'); emit(0xA5, 0x10, 0x29, 4); branch(0xF0, 'active');
        emit(0xA5, 0xF4, 0x29, 0xBF, 0x85, 0xF4, 0xA5, 0xF6, 0x29, 0xBF, 0x85, 0xF6);
        label('active'); emit(0xA5, 0x56, 0xC9, 3); far(0xD0, 'draw');
        emit(0xA5, 0xC0); far(0xF0, 'draw'); emit(0xC9, 3); far(0xB0, 'draw');
        lda(r.action); emit(0x29, 4); branch(0xF0, 'place');
        abs(0xAE, r.head); far(0x30, 'draw');
        emit(0xA0, 1); label('freeExplosion'); abs(0xB9, 0x4A8); branch(0xF0, 'explode');
        emit(0x88); branch(0x10, 'freeExplosion'); jump('draw');
        label('explode');
        lx(0x516); abs(0x99, 0x4B0); lx(0x50E); abs(0x99, 0x4AC);
        lx(0x433); emit(0x38, 0xE9, 8); abs(0x99, 0x42B);
        emit(0xA9, 0); abs(0x99, 0x467); abs(0x99, 0x4B8); abs(0x99, 0x4BC);
        sx(0x4FE); sx(0x415); sx(0x506);
        emit(0xA9, 10); abs(0x99, 0x4A8);
        emit(0xA2, 7); label('advance'); lx(0x4FE); emit(0xC9, 14); branch(0xD0, 'advanceNext');
        lx(0x506); emit(0xC9, 3); branch(0xD0, 'advanceNext'); abs(0xDE, 0x526);
        label('advanceNext'); emit(0xCA); branch(0x10, 'advance'); jump('draw');

        label('place');
        lda(r.previous); emit(0x29, 4); far(0xD0, 'draw');
        abs(0xAE, r.inventory); far(0x30, 'draw');
        emit(0xA5, 0x7D); far(0xD0, 'draw');
        emit(0xA5, 0xC0, 0xC9, 1); far(0xD0, 'draw'); // Standing only.
        emit(0xA5, 0xF6, 0x29, 0xC0); far(0xD0, 'draw'); // Jump/attack cancel preview.
        emit(0xA5, 0xF6, 0x29, 0x0C, 0x85, 0x10, 0xC9, 4); branch(0xF0, 'floor');
        emit(0xC9, 8); far(0xD0, 'draw'); // Reject neutral or opposite directions together.
        // Probe the standing body's top/bottom at +/-9 pixels.
        lda(0x41E); emit(0x38, 0xE9, 9); far(0x90, 'draw'); jump('probeY');
        label('floor'); lda(0x41E); emit(0x18, 0x69, 9); far(0xB0, 'draw');
        label('probeY'); emit(0xC9, 0xE0); far(0xB0, 'draw');
        emit(0x4A, 0x4A, 0x4A, 0x4A, 0x85, 1,
            0xA5, 0xC1, 0x4A, 0xA5, 0xC2, 0x6A, 0x4A, 0x4A, 0x4A, 0x85, 0);
        jsr('tile'); emit(0xC9, 5); far(0x90, 'draw'); emit(0xC9, 10); far(0xB0, 'draw');
        // One installed charge per map cell.
        emit(0xA0, 7); label('occupied'); abs(0xB9, 0x4FE); emit(0xC9, 14); branch(0xD0, 'occupiedNext');
        abs(0xB9, 0x506); emit(0xC9, 3); branch(0xD0, 'occupiedNext');
        abs(0xB9, 0x536); emit(0xC5, 0); branch(0xD0, 'occupiedNext');
        abs(0xB9, 0x546); emit(0xC5, 1); far(0xF0, 'draw');
        label('occupiedNext'); emit(0x88); branch(0x10, 'occupied');
        // Continuous time applies to one direction and one target cell.
        // Moving to another cell, releasing, jumping or losing the target
        // starts a fresh hold; the preview never joins the explosion queue.
        lx(0x55E); branch(0xF0, 'restartPreview');
        lx(0x536); emit(0xC5, 0); branch(0xD0, 'restartPreview');
        lx(0x546); emit(0xC5, 1); branch(0xD0, 'restartPreview');
        lx(0x56E); emit(0xC5, 0x10); branch(0xF0, 'continuePreview');
        label('restartPreview'); emit(0xA9, RemoteBomb.SOUND.start); jsr('cue');
        emit(0xA9, 0); sx(0x55E);
        label('continuePreview'); abs(0xFE, 0x55E); emit(0xA5, 0x10); sx(0x56E);
        emit(0xA5, 0); sx(0x536); emit(0x4A, 0x4A, 0x4A, 0x4A); sx(0x50E);
        emit(0xA5, 0, 0x0A, 0x0A, 0x0A, 0x0A, 0x09, 8); sx(0x516);
        emit(0xA5, 1); sx(0x546); emit(0x0A, 0x0A, 0x0A, 0x0A, 0x09, 8); sx(0x433);
        emit(0xA9, RemoteBomb.META); sx(0x415);
        lx(0x55E); emit(0xC9, RemoteBomb.INSTALL_TICKS); branch(0x90, 'draw');
        emit(0xA5, 0x14, 0x18, 0x69, 1); sx(0x526);
        emit(0xA9, 3); sx(0x506);
        lda(r.head); branch(0x10, 'hasHead'); emit(0x8A); sta(r.head); label('hasHead');
        jsr('tile'); sx(0x55E); emit(0xA9, 0); sx(0x56E);
        emit(0xA9, RemoteBomb.SOUND.success); jsr('cue');

        label('draw'); emit(0xA2, 7);
        label('drawSlot'); lx(0x4FE); emit(0xC9, 14); branch(0xD0, 'drawNext');
        lx(0x506); emit(0xC9, 2); branch(0xD0, 'visible');
        lx(0x415); branch(0xD0, 'visible');
        // Scan hid every carried slot; only a validated preview was shown.
        // Cancelling is silent, including rapid press/release cycles.
        emit(0xA9, 0); sx(0x55E); sx(0x56E); jump('drawNext');
        label('visible');
        emit(0xA9, 2); sx(0x46F); emit(0xA9, RemoteBomb.META); sx(0x415);
        lx(0x506); emit(0xC9, 3); branch(0xD0, 'drawNext');
        emit(0xA9, 1); sx(0x46F); lx(0x526); emit(0xC9, 1); branch(0xD0, 'drawNext');
        // Indicator light alternates highlight/main ink every 16 ticks; queue head only.
        emit(0xA5, 0x1B, 0x4A, 0x4A, 0x4A, 0x4A, 0x29, 1,
            0x18, 0x69, RemoteBomb.META); sx(0x415);
        label('drawNext'); emit(0xCA); branch(0x10, 'drawSlot');
        label('done'); emit(0xA5, 0xD8, 0x60);

        label('cue');
        // Preserve X/Y and map-probe scratch. Pickups/landings queued this
        // tick and higher-priority native effects take precedence over UI.
        emit(0x48, 0xA5, 0xD8); branch(0xD0, 'cueBusy');
        lda(0x10E); emit(0xC9, 0x18); branch(0xB0, 'cueBusy');
        emit(0x68, 0x85, 0xD7, 0xA9, 0x17, 0x85, 0xD8, 0x60);
        label('cueBusy'); emit(0x68, 0x60);

        // Run again after native player/explosion/falling physics, before
        // camera projection. Follow actual 8px fall steps, including VRAM
        // queue stalls; an empty map cell alone does not mean destruction.
        label('afterPhysics'); lda(r.head); branch(0x30, 'noAttachmentDraw');
        jsr('attachments'); jump('draw'); label('noAttachmentDraw'); emit(0x60);
        label('attachments'); emit(0xA2, 7);
        label('attachSlot'); lx(0x4FE); emit(0xC9, 14); far(0xD0, 'attachNext');
        lx(0x506); emit(0xC9, 3); far(0xD0, 'attachNext');
        lx(0x536); emit(0x0A, 0x85, 3);
        lx(0x433); emit(0x38, 0xE9, 8, 0x4A, 0x4A, 0x4A, 0x85, 4);
        lx(0x56E); branch(0xF0, 'findHostFall');
        emit(0xA8, 0x88); jump('followHost');
        label('findHostFall'); emit(0xA0, 9);
        label('findHostSlot'); abs(0xB9, 0x4C0); emit(0xC9, 1); branch(0xD0, 'findHostNext');
        abs(0xB9, 0x4D4); emit(0xC5, 3); branch(0xD0, 'findHostNext');
        abs(0xB9, 0x4DE); emit(0xC5, 4); branch(0xD0, 'findHostNext');
        abs(0xB9, 0x4CA); abs(0xDD, 0x55E); branch(0xF0, 'bindHost');
        label('findHostNext'); emit(0x88); branch(0x10, 'findHostSlot'); jump('hostMap');
        label('bindHost'); emit(0x98, 0x18, 0x69, 1); sx(0x56E);
        label('followHost');
        abs(0xB9, 0x4CA); abs(0xDD, 0x55E); branch(0xD0, 'removeHostBomb');
        abs(0xB9, 0x4D4); emit(0xC5, 3); branch(0xD0, 'removeHostBomb');
        // Reject a recycled pool record; a live host advances at most one half-row.
        abs(0xB9, 0x4DE); emit(0x38, 0xE5, 4, 0xC9, 2); branch(0xB0, 'removeHostBomb');
        abs(0xB9, 0x4DE); emit(0xC9, 25); branch(0xB0, 'removeHostBomb');
        emit(0x4A); sx(0x546);
        abs(0xB9, 0x4DE); emit(0x0A, 0x0A, 0x0A, 0x18, 0x69, 8); sx(0x433);
        abs(0xB9, 0x4C0); emit(0xC9, 1); branch(0xF0, 'attachNext');
        emit(0xA9, 0); sx(0x56E); // Landed: ownership returns to the map cell.
        label('hostMap'); lx(0x536); emit(0x85, 0); lx(0x546); emit(0x85, 1);
        jsr('tile'); abs(0xDD, 0x55E); branch(0xF0, 'attachNext');
        label('removeHostBomb');
        lx(0x526); emit(0x85, 3); jsr('fallRemove');
        // Close the FIFO gap, also when several hosts disappear this frame.
        emit(0xA0, 7); label('closeQueue'); abs(0xB9, 0x4FE); emit(0xC9, 14); branch(0xD0, 'closeNext');
        abs(0xB9, 0x506); emit(0xC9, 3); branch(0xD0, 'closeNext');
        abs(0xB9, 0x526); emit(0xC5, 3); branch(0x90, 'closeNext');
        emit(0x38, 0xE9, 1); abs(0x99, 0x526);
        label('closeNext'); emit(0x88); branch(0x10, 'closeQueue');
        label('attachNext'); emit(0xCA); far(0x10, 'attachSlot'); emit(0x60);

        // Native collectible-bomb falling ($A522): a six-count start phase,
        // then 8 pixels per five updates. Use the native support/landing
        // tables, but keep this sprite collectible out of the background map.
        label('fall'); lx(0x56E); branch(0xF0, 'fallRest');
        emit(0xC9, 1); branch(0xF0, 'fallMoving');
        abs(0xDE, 0x56E); emit(0x60);
        label('fallRest'); jsr('below'); abs(0xB9, 'support'); branch(0xD0, 'fallDone');
        emit(0xA9, 6); sx(0x56E); emit(0x60);
        label('fallMoving'); abs(0xFE, 0x55E); lx(0x55E); emit(0xC9, 5); branch(0x90, 'fallDone');
        emit(0xA9, 0); sx(0x55E);
        lx(0x433); emit(0x18, 0x69, 8); sx(0x433);
        emit(0xC9, 0xD0); branch(0xB0, 'fallRemove');
        emit(0x29, 8); branch(0xF0, 'fallDone'); // Land only on full map rows.
        jsr('below'); abs(0xB9, 'landing'); branch(0xF0, 'fallDone');
        emit(0xA9, 0); sx(0x56E);
        emit(0xA5, 0xD8); branch(0xD0, 'fallDone'); // Pickup sound has priority.
        emit(0xA9, 0x0F, 0x85, 0xD8);
        label('fallDone'); emit(0x60);
        label('fallRemove'); emit(0xA9, 0); sx(0x4FE); sx(0x506); sx(0x415); emit(0x60);
        label('below');
        lx(0x50E); emit(0x4A); lx(0x516); emit(0x6A, 0x4A, 0x4A, 0x4A, 0x85, 0);
        lx(0x433); emit(0x4A, 0x4A, 0x4A, 0x4A, 0x18, 0x69, 1, 0x85, 1);
        jsr('tile'); emit(0xA8, 0x60);
        label('support'); emit(...rom.subarray(file(0xBF9A), file(0xBF9A) + 16));
        label('landing'); emit(...rom.subarray(file(0xBFAA), file(0xBFAA) + 16));

        label('tile'); // Read-only native map-nibble lookup; preserve X.
        emit(0x8A, 0x48, 0xA5, 0x3D, 0x4A, 0xA5, 0, 0x29, 31); branch(0xB0, 'wide');
        emit(0x29, 15); label('wide'); emit(0x85, 0, 0x4A, 0x85, 2,
            0xA5, 1, 0x0A, 0x0A, 0x0A, 0x0A, 0x18, 0x65, 2, 0xAA,
            0xA5, 0, 0x4A, 0xBD, 0, 7); branch(0xB0, 'nibble');
        emit(0x4A, 0x4A, 0x4A, 0x4A); label('nibble'); emit(0x29, 15, 0x85, 2, 0x68, 0xAA, 0xA5, 2, 0x60);
        resolve();
        const follow = b.labels.get('afterPhysics');
        Asm6502.writeBytes(rom, file(RemoteBomb.ATTACH_ENTRY), [
            0xA9, 6, 0x8D, guard & 255, guard >> 8, 0x8D, 0, 0x80,
            0x20, follow & 255, follow >> 8,
            0xA9, 0, 0x8D, 0, 0x80, 0x8D, guard & 255, guard >> 8,
            0x4C, 0x71, 0xA9
        ]);
        Asm6502.writeBytes(rom, file(0x8B6C), [0x20, RemoteBomb.ATTACH_ENTRY & 255, RemoteBomb.ATTACH_ENTRY >> 8]);
        if (rom.subarray(0x18110, 0x18A10).some(Boolean)) throw new Error('Remote bomb bank reservation occupied');
        rom.set(b.bytes, 0x18110);
        return {start: b.base, end: b.base + b.bytes.length, labels: Object.fromEntries(b.labels)};
    }
}
