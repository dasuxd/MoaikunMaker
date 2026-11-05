class Pause {
    static PAUSE_HINT_GLYPHS = 'PAUSEDMN<^';
    static PAUSE_HINT_SPRITE_START = 0x60;
    static PAUSE_PATTERN_READY = 0x09;
    static PAUSE_PATTERN_RESTORED = 0x89;

    /** Keep the native alphabet's complete white ink and selective black shadow. */
    static getPauseHintPatterns(source) {
        // Pause swaps nine 64-byte chunks of enemy CHR; clear the final padding.
        const patterns = new Uint8Array(0x240);
        for(const [index, character] of [...Pause.PAUSE_HINT_GLYPHS].entries()) {
            if(character !== '<' && character !== '^') {
                const at = 0x8010 + (0x16 + (character.charCodeAt(0) - 65) * 2) * 16;
                patterns.set(source.subarray(at, at + 32), index * 32);
                continue;
            }

            // One authored arrow, rotated once for the vertical orientation.
            // NES sprite flips supply the opposite directions without more tiles.
            const left = [0x10, 0x30, 0x7E, 0xFE, 0x7E, 0x30, 0x10, 0];
            const ink = character === '<' ? left : new Uint8Array(8);
            if(character === '^') for(let y = 0; y < 8; y++) for(let x = 0; x < 8; x++) {
                if(left[y] & (0x80 >> x)) ink[x] |= 1 << y;
            }
            if(character === '^') for(let y = 0; y < 8; y++) ink[y] <<= 1;
            for(let y = 0; y < 8; y++) {
                const row = y + 4, at = index * 32 + (row >> 3) * 16 + (row & 7);
                // Fill the Up arrow's lower-right corners as a solid drop shadow.
                const corner = character === '^' ? (ink[y - 1] || 0) >> 1 : 0;
                const shadow = ((ink[y] >> 1) | (ink[y - 1] || 0) | corner) & ~ink[y];
                patterns[at] = shadow;
                patterns[at + 8] = ink[y] | shadow;
            }
        }
        return patterns;
    }

    /** Pause owns camera input and OAM, while all live entity data stays intact. */
    static addPauseControls(romData, viewModes = null) {
        const file = RomLayout.programOffset;
        const {labels, blocks, section, emit, label, absolute, branch, resolve} = Asm6502.program();
        const org = (base, limit, bank = 0) => { section(base, limit).bank = bank; };

        // These bytes have no native live references. The phase clears on
        // resume, and each pause refreshes the saved camera origin.
        org(0xB3CB, 0xB49F);
        label('entry');
        emit(0xA5, 0x2B, 0xC9, PauseSettings.OPEN);
        branch(0xD0, 'mapInput');
        emit(0xA9, 1, 0x85, 0x32, 0x60); // Keep START from releasing gameplay inside settings.
        label('mapInput');
        emit(0xA5, 0x2B, 0xC9, 0x02); branch(0xD0, 'checkPause');
        absolute(0x4C, 'returnTick');
        label('checkPause');
        emit(0xA5, 0x32); branch(0xD0, 'paused');
        emit(0xA5, 0x2B); branch(0xD0, 'beginReturn');
        label('active');
        emit(0xA5, 0xFE, 0x09, 0x10, 0x85, 0xFE, 0x4C, 0x54, 0x8B);
        label('paused');
        emit(0xA5, 0x2B); branch(0xD0, 'input');
        emit(0xA5, 0xFD, 0x85, 0x7E, 0xA5, 0x9D, 0x85, 0x7F,
            0xA5, 0x2A, 0x29, viewModes ? 1 : 0, 0x85, 0x2A,
            0xA9, 0x01, 0x85, 0x2B);
        absolute(0x20, 'maskInit');
        label('input');
        emit(0xA5, 0xF4, 0x29, 0x08); branch(0xF0, 'look');
        emit(0xA9, PauseSettings.ENTER, 0x85, 0x2B, 0x60);
        label('look');
        emit(0xA5, 0x3D);
        if(viewModes) { branch(0xD0, 'lookInput'); emit(0xA5, 0x2A, 0x29, 0x01); }
        branch(0xF0, 'done');
        label('lookInput');
        emit(0xA5, 0xF6, 0x29, 0x03); branch(0xF0, 'done');
        emit(0xC9, 0x03); branch(0xF0, 'done');
        emit(0x48, 0xA5, 0x2A, 0x09, 0x40, 0x85, 0x2A, 0x68);
        emit(0x4A); branch(0xB0, 'lookRight');
        emit(0x38, 0xA5, 0xFD, 0xE9, 0x04, 0x85, 0xFD,
            0xA5, 0x9D, 0xE9, 0x00); absolute(0x4C, 'lookPage');
        label('lookRight');
        emit(0x18, 0xA5, 0xFD, 0x69, 0x04, 0x85, 0xFD,
            0xA5, 0x9D, 0x69, 0x00);
        label('lookPage');
        emit(0x25, 0x3D, 0x85, 0x9D,
            0xA5, 0xFF, 0x29, 0xFE, 0x05, 0x9D, 0x85, 0xFF);
        label('done'); emit(0x60);
        label('beginReturn');
        emit(0xA9, 0x80, 0x85, 0x2C,
            0xA9, 0x02, 0x85, 0x2B, 0xA5, 0x2A, 0x09, 0x80, 0x85, 0x2A);
        label('returnTick');
        emit(0xA9, 0x01, 0x85, 0x32, 0xA5, 0x2A, 0x29, 0x80);
        branch(0xF0, 'restore');
        absolute(0x20, 'cameraStep'); emit(0x60);
        label('restore');
        // Pattern restoration also finishes before the pause flag is released.
        emit(0xA5, 0x2C, 0xC9, Pause.PAUSE_PATTERN_RESTORED); branch(0x90, 'done');
        // The native global OAM pass runs after this first active tick. Keep
        // sprites hidden until it has rebuilt every offscreen ID/projection.
        emit(0xA9, 0x00, 0x85, 0x2B, 0x85, 0x32,
            0xA5, 0x2A, 0x29, 0x01, 0x85, 0x2A,
            0xA5, 0xFE, 0x29, 0xEF, 0x85, 0xFE, 0x4C, 0x54, 0x8B);

        org(0xD831, 0xD8A1);
        label('cameraStep');
        if(viewModes) {
            absolute(0xAD, Portal.PORTAL_RAM.panTicks); branch(0xD0, 'returnToPan');
            absolute(0x4C, viewModes.selectCamera);
        }
        label('returnToPan');
        // A paused portal pan resumes at its saved scroll position. Travel the
        // shortest ring path, using the same four-pixel transition speed.
        emit(0x38, 0xA5, 0x7E, 0xE5, 0xFD, 0x85, 0x00,
            0xA5, 0x7F, 0xE5, 0x9D, 0x25, 0x3D, 0x85, 0x01,
            0xA5, 0x3D); branch(0xF0, 'narrowReturn');
        emit(0xA5, 0x01); branch(0xD0, 'cameraLeft');
        absolute(0x4C, 'cameraRight');
        label('narrowReturn'); emit(0xA5, 0x00); branch(0x30, 'cameraLeft');
        label('cameraRight');
        emit(0xA5, 0x00, 0xC9, 0x05); branch(0x90, 'cameraArrived');
        emit(0x18, 0xA5, 0xFD, 0x69, 0x04, 0x85, 0xFD,
            0xA5, 0x9D, 0x69, 0x00); absolute(0x4C, 'cameraPage');
        label('cameraLeft');
        emit(0xA5, 0x00, 0xC9, 0xFC); branch(0xB0, 'cameraArrived');
        emit(0x38, 0xA5, 0xFD, 0xE9, 0x04, 0x85, 0xFD,
            0xA5, 0x9D, 0xE9, 0x00); absolute(0x4C, 'cameraPage');
        label('cameraArrived');
        emit(0xA5, 0x7E, 0x85, 0xFD, 0xA5, 0x7F, 0x85, 0x9D,
            0xA5, 0x2A, 0x29, 0x01, 0x85, 0x2A, 0xA5, 0x9D);
        label('cameraPage');
        emit(0x25, 0x3D, 0x85, 0x9D,
            0xA5, 0xFF, 0x29, 0xFE, 0x05, 0x9D, 0x85, 0xFF, 0x60);
        // The fixed-bank wrapper keeps normal gameplay in bank zero. Pause
        // rendering borrows bank one's former background-mask backup space.
        org(0xFED9, 0xFF00);
        label('oam');
        emit(0xA5, 0x2B); branch(0xD0, 'pauseOam');
        emit(0x4C, 0xD3, 0x88);
        label('pauseOam');
        emit(0xC9, PauseSettings.ENTER); branch(0x90, 'mapOam');
        absolute(0x4C, 'settingsOam');
        label('mapOam');
        absolute(0x20, 'maskTick');
        emit(0xA9, 0x01, 0x8D, 0x00, 0x80);
        absolute(0x20, 'renderPause');
        emit(0xA9, 0x00, 0x8D, 0x00, 0x80, 0x60);

        org(0x9600, 0x9900, 1);
        label('renderPause');
        emit(0xA2, 0x00, 0xA9, 0xF8);
        label('hideSprites');
        emit(0x9D, 0x00, 0x02, 0xE8, 0xE8, 0xE8, 0xE8); branch(0xD0, 'hideSprites');
        emit(0xA5, 0xFE, 0x09, 0x10, 0x85, 0xFE);
        // Give the pause overlay OAM priority when the frozen player overlaps
        // a hint row, so the NES scanline limit cannot remove a control letter.
        emit(0xA5, 0x2C, 0xC9, Pause.PAUSE_PATTERN_READY); branch(0xD0, 'hintDone');
        emit(0xA5, 0x1B, 0x29, 0x20); branch(0xD0, 'menuHint');
        emit(0xA0, 0x00, 0xA9, 0x18, 0x85, 0x00); absolute(0x20, 'copyHint');
        emit(0xA5, 0x2A, 0x29, 0x40); branch(0xD0, 'menuHint');
        emit(0xA0, 0x18, 0xA5, 0x3D);
        if(viewModes) { branch(0xD0, 'copyLook'); emit(0xA5, 0x2A, 0x29, 0x01); }
        branch(0xF0, 'menuHint');
        label('copyLook'); emit(0xA9, 0x20, 0x85, 0x00); absolute(0x20, 'copyHint');
        label('menuHint');
        emit(0xA0, 0x20, 0xA9, 0x34, 0x85, 0x00); absolute(0x20, 'copyHint');
        label('hintDone'); absolute(0x4C, 'playerOam');
        label('copyHint');
        absolute(0xB9, 'hint'); emit(0x9D, 0x00, 0x02, 0xE8, 0xC8, 0xC4, 0x00);
        branch(0xD0, 'copyHint'); emit(0x60);
        label('playerOam');
        // Re-project the frozen native pose into scratch RAM. Never advance
        // player animation/blink timers or overwrite its cached world state.
        emit(0xA5, 0x7D); branch(0xD0, 'playerDone');
        emit(0xAD, 0x00, 0x04); branch(0xF0, 'playerDone');
        emit(0x38, 0xA5, 0xC2, 0xE5, 0xFD, 0x85, 0x02,
            0xA5, 0xC1, 0xE5, 0x9D, 0x25, 0x3D); branch(0xD0, 'playerDone');
        emit(0xAD, 0x5A, 0x04, 0x29, 0xE0, 0x85, 0x0F,
            0xAD, 0x5A, 0x04, 0x29, 0x03, 0x85, 0x00,
            0x18, 0xAD, 0x1E, 0x04, 0x69, 0x07, 0x85, 0x01,
            0xA9, 0x3F, 0x85, 0x07, 0xAD, 0x00, 0x04);
        absolute(0x20, 'playerMetasprite');
        label('playerDone'); emit(0x60);
        label('playerMetasprite');
        const playerMetasprite = romData.slice(file(0x8932), file(0x89ED));
        // Reconstruct the native entry replaced by the bird's clipping hook.
        playerMetasprite.set([0x0A, 0xB0, 0x5C]);
        playerMetasprite[0x54] = 0x04; playerMetasprite[0xAE] = 0x04;
        emit(...playerMetasprite);

        const glyphTile = letter => Pause.PAUSE_HINT_SPRITE_START + Pause.PAUSE_HINT_GLYPHS.indexOf(letter) * 2;
        const hint = [];
        const text = (text, x, y) => {
            [...text].forEach((letter, index) => {
                if(letter !== ' ') hint.push(y, glyphTile(letter), 0, x + index * 8);
            });
        };
        text('PAUSED', 104, 111);
        hint.push(112, glyphTile('<'), 0, 8, 112, glyphTile('<'), 0x40, 240);
        hint.push(15, glyphTile('^'), 0, 192);
        text('MENU', 204, 15);
        label('hint'); emit(...hint);

        // Borrow enemy-only sprite tiles $60-$83 while paused. Keep the font
        // and all three original sprite-page variants after bank-1 enemy data;
        // the normal scene images and their reserved background tail stay clean.
        // Nine sprite font packets are restored before releasing pause, at no
        // more than 64 CHR bytes per vblank. Background fireheads stay intact.
        romData.set(Pause.getPauseHintPatterns(romData), 0x5910);
        for(let page = 0; page < 3; page++)
            romData.set(romData.subarray(0xA610 + page * 0x2000, 0xA850 + page * 0x2000), 0x5C10 + page * 0x300);
        org(0xFC80, 0xFD00);
        label('maskTick');
        emit(0xA5, 0x2C, 0x29, 0x7F, 0xC9, Pause.PAUSE_PATTERN_READY); branch(0xB0, 'maskDone');
        emit(0xA6, 0x1E, 0xE0, 0x9A); branch(0xB0, 'maskDone');
        emit(0x85, 0x04, 0xA5, 0x2C); branch(0x10, 'fontSource');
        absolute(0x20, 'spriteSource'); absolute(0x4C, 'packetSource');
        label('fontSource'); emit(0xA9, 0x99);
        label('packetSource'); emit(0x85, 0x03);
        emit(0xA5, 0x04, 0x4A, 0x4A, 0x85, 0x07, 0x18, 0x65, 0x03, 0x85, 0x03,
            0xA5, 0x04, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x85, 0x02,
            0x9D, 0x02, 0x03, 0x18, 0xA5, 0x07, 0x69, 0x06, 0x9D, 0x01, 0x03,
            0xA9, 0x40, 0x9D, 0x03, 0x03, 0x85, 0x00);
        absolute(0x4C, 'restorePatterns');
        label('maskDone'); emit(0x60);
        label('spriteSource');
        emit(0xA5, 0x3E, 0xC9, 0x05); branch(0x90, 'spritePage1');
        emit(0xC9, 0x07); branch(0x90, 'spritePage2');
        emit(0xC9, 0x09); branch(0x90, 'spritePage3');
        label('spritePage2'); emit(0xA9, 0x9F, 0x60);
        label('spritePage3'); emit(0xA9, 0xA2, 0x60);
        label('spritePage1'); emit(0xA9, 0x9C, 0x60);

        org(viewModes ? viewModes.pauseMaskBase : 0xF100, viewModes ? 0xF300 : 0xF150);
        label('restorePatterns');
        emit(0xA9, 0x06, 0x9D, 0x00, 0x03,
            0xA9, 0x01, 0x8D, 0x00, 0x80, 0xA0, 0x00);
        label('restorePatternByte');
        emit(0xB1, 0x02, 0x9D, 0x04, 0x03, 0xE8, 0xC8, 0xC4, 0x00);
        branch(0xD0, 'restorePatternByte');
        emit(0xA9, 0x00, 0x8D, 0x00, 0x80,
            0xA9, 0xFF, 0x9D, 0x04, 0x03, 0x8A, 0x18, 0x69, 0x05, 0xAA);
        label('maskCommit'); emit(0x86, 0x1E, 0xE6, 0x2C, 0x60);
        label('maskInit');
        emit(0xA9, 0x00, 0x85, 0x2C, 0x60);

        PauseSettings.install(romData, {org, emit, label, absolute, branch}, Boolean(viewModes));
        resolve();
        for(const block of blocks) Asm6502.writeBytes(romData, file(block.base) + block.bank * 0x4000, block.bytes);
        const entry = labels.get('entry'), oam = labels.get('oam');
        Asm6502.writeBytes(romData, file(0x8B4F), [0x4C, entry & 255, entry >> 8]);
        Asm6502.writeBytes(romData, file(0x80C0), [0x20, oam & 255, oam >> 8]);
        return {entry, oam, cameraStep: labels.get('cameraStep')};
    }
}
