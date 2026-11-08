class SceneRuntime {
    /**
     * Make the castle-background animation follow scene type 8, animate both
     * nametables in a wide level, and keep dynamic foreground tiles in front.
     *
     * The game has eight animation slots stored as five parallel eight-byte
     * arrays. Expanding those arrays would overwrite adjacent RAM, so one slot
     * instead owns a page mask in $05AE,X:
     *
     * - bit 0: draw the animation at $20xx (screen 1);
     * - bit 1: draw the animation at $24xx (screen 2).
     *
     * Scene 8 always registers all eight logical slots: single-screen levels
     * use mask $01 and wide levels use mask $03. Before drawing either page,
     * the runtime helper converts the 8x8 PPU position to its containing 16x16
     * map cell and calls $8DFF. A nonzero live-map tile suppresses only that
     * page's current draw; the timer and frame continue, so animation resumes
     * in sync after a rock or another interactive tile moves away.
     */
    static fixSpecialLevelAnimations(romData){
        const animationUpdateCpuAddr = 0xD8E7;
        const animationInitCpuAddr = 0xD980;
        const runtimeMapFilterCpuAddr = 0xD9B8;
        const animationPpuLowTableCpuAddr = 0xD9DA;
        const animationMapPositionTableCpuAddr = 0xD9E2;
        const animationMapFilterTailCpuAddr = 0xDA15;
        const animationMapFilterCpuAddr = 0xFFC0;
        const fixedBankShift = 0x18000;
        const fixedBankRomAddr = (cpuAddr) =>
            0x4010 + (cpuAddr - 0xC000) + fixedBankShift;

        /**
         * CPU $D8E7-$D97F: update one logical animation slot.
         *
         * Advance the slot once, then process each set bit in its page mask.
         * $D91F checks the live map before dispatching to the type-1 flag or
         * type-2 fire renderer. A blocked page returns without creating a PPU
         * command; the other page remains independent.
         */
        const pairedAnimationUpdateCode = [
            0xFE, 0xBE, 0x05, 0xBD, 0xBE, 0x05, 0xC9, 0x0A, 0x90, 0x2D, 0xA9, 0x00,
            0x9D, 0xBE, 0x05, 0xFE, 0xB6, 0x05, 0xBD, 0xB6, 0x05, 0xC9, 0x03, 0x90,
            0x05, 0xA9, 0x00, 0x9D, 0xB6, 0x05, 0xA9, 0x20, 0x85, 0x0F, 0xBD, 0xAE,
            0x05, 0x4A, 0x48, 0x90, 0x03, 0x20, 0x1F, 0xD9, 0x68, 0x4A, 0x90, 0x07,
            0xA9, 0x24, 0x85, 0x0F, 0x20, 0x1F, 0xD9, 0x60, 0x20, 0xB8, 0xD9, 0xF0,
            0x01, 0x60, 0xBD, 0x9E, 0x05, 0x4A, 0xB0, 0x1A, 0xBD, 0xB6, 0x05, 0xA8,
            0xB9, 0x8B, 0xC0, 0x20, 0x62, 0x91, 0x20, 0xC0, 0x91, 0xBD, 0xA6, 0x05,
            0x85, 0x0E, 0x86, 0x3F, 0x20, 0x3D, 0x90, 0xA6, 0x3F, 0x60, 0xBD, 0xB6,
            0x05, 0xA8, 0xB9, 0x8E, 0xC0, 0x48, 0xA4, 0x1E, 0xA9, 0x06, 0x99, 0x00,
            0x03, 0xA5, 0x0F, 0x99, 0x01, 0x03, 0xBD, 0xA6, 0x05, 0x99, 0x02, 0x03,
            0x85, 0x0E, 0xA9, 0x01, 0x99, 0x03, 0x03, 0x68, 0x99, 0x04, 0x03, 0xA9,
            0xFF, 0x99, 0x05, 0x03, 0x18, 0x98, 0x69, 0x06, 0x85, 0x1E, 0xA9, 0x03,
            0x85, 0x90, 0x4C, 0xF5, 0x92, 0xEA, 0xEA, 0xEA, 0xEA,
        ];
        Asm6502.writeBytes(
            romData,
            fixedBankRomAddr(animationUpdateCpuAddr),
            pairedAnimationUpdateCode
        );

        /**
         * CPU $D980-$D9B7: initialize the eight fixed scene-8 positions.
         *
         * Slots 0-1 are type-2 fire animations; slots 2-7 are type-1 flag
         * animations. Every slot is registered regardless of initial map
         * occupancy; the runtime check alone controls per-page visibility.
         */
        const animationInitCode = [
            0xA2, 0x07, 0xA9, 0x00, 0x9D, 0x9E, 0x05, 0x9D, 0xB6, 0x05, 0x8A, 0x9D,
            0xBE, 0x05, 0xCA, 0x10, 0xF1, 0xA5, 0x3E, 0xC9, 0x08, 0xD0, 0x20, 0xA2,
            0x07, 0xA9, 0x01, 0xE0, 0x02, 0xB0, 0x02, 0xA9, 0x02, 0x9D, 0x9E, 0x05,
            0xBD, 0xDA, 0xD9, 0x9D, 0xA6, 0x05, 0xA5, 0x3D, 0x29, 0x01, 0x0A, 0x09,
            0x01, 0x9D, 0xAE, 0x05, 0xCA, 0x10, 0xE2, 0x60,
        ];
        Asm6502.writeBytes(
            romData,
            fixedBankRomAddr(animationInitCpuAddr),
            animationInitCode
        );

        /**
         * CPU $D9B8-$D9D9: runtime foreground test.
         *
         * PPU low bits 0-4 contain the 8x8 X coordinate and bits 5-7 contain
         * its row. Dividing both by two produces the containing 16x16 map cell.
         * $0F is $20 or $24; its bit 2 becomes a +16 map-X offset for screen 2.
         */
        const runtimeAnimationMapFilterCode = [
            0xBD, 0xA6, 0x05, 0x48, 0x29, 0x1F, 0x4A, 0x85, 0x00, 0x68, 0x4A, 0x4A,
            0x4A, 0x4A, 0x4A, 0x4A, 0x85, 0x01, 0xA5, 0x0F, 0x29, 0x04, 0x0A, 0x0A,
            0x05, 0x00, 0x85, 0x00, 0x20, 0xFF, 0x8D, 0xC9, 0x00, 0x60,
        ];
        Asm6502.writeBytes(
            romData,
            fixedBankRomAddr(runtimeMapFilterCpuAddr),
            runtimeAnimationMapFilterCode
        );

        // Index 0-1: fire; index 2-7: flag.
        const animationPpuLowTable = [
            0xD2, 0xCC, 0x7B, 0x77, 0x31, 0x2F, 0x69, 0x65,
        ];
        Asm6502.writeBytes(
            romData,
            fixedBankRomAddr(animationPpuLowTableCpuAddr),
            animationPpuLowTable
        );

        // Packed map position: high nibble X, low nibble Y.
        const animationMapPositionTable = [
            0x93, 0x63, 0xD1, 0xB1, 0x80, 0x70, 0x41, 0x21,
            0xEA, 0xEA,
        ];
        Asm6502.writeBytes(
            romData,
            fixedBankRomAddr(animationMapPositionTableCpuAddr),
            animationMapPositionTable
        );

        /**
         * CPU $FFC0-$FFEF and $DA15-$DA2D: retired initialization filter.
         *
         * The fixed initializer above no longer calls these bytes. They are
         * still overwritten so exporting over any earlier patch version has a
         * deterministic result and cannot leave unrelated stale machine code.
         * fixWideScreenEnemy9Background() subsequently reuses $FFC0-$FFCF.
         * RemoteBomb.install() reuses $DA15-$DA2D for its post-physics bridge.
         */
        const animationMapFilterCode = [
            0xBD, 0xE2, 0xD9, 0x48, 0x29, 0x0F, 0x85, 0x01, 0x68, 0x4A, 0x4A, 0x4A,
            0x4A, 0x85, 0x00, 0xA9, 0x00, 0x85, 0x04, 0x20, 0xFF, 0x8D, 0xC9, 0x00,
            0xD0, 0x02, 0xE6, 0x04, 0xA5, 0x3D, 0x4A, 0x90, 0x09, 0xA5, 0x00, 0x09,
            0x10, 0x85, 0x00, 0x4C, 0x15, 0xDA, 0x4C, 0x20, 0xDA, 0xEA, 0xEA, 0xEA,
        ];
        Asm6502.writeBytes(
            romData,
            fixedBankRomAddr(animationMapFilterCpuAddr),
            animationMapFilterCode
        );

        const animationMapFilterTailCode = [
            0x20, 0xFF, 0x8D, 0xC9, 0x00, 0xD0, 0x04, 0xE6, 0x04, 0xE6, 0x04, 0xA5,
            0x04, 0xF0, 0x02, 0x38, 0x60, 0x18, 0x60, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA,
            0xEA,
        ];
        Asm6502.writeBytes(
            romData,
            fixedBankRomAddr(animationMapFilterTailCpuAddr),
            animationMapFilterTailCode
        );
    }

    /**
     * Keep enemy 9's blocking cells and background face on its actual screen.
     *
     * Enemy data stores the second-screen flag separately at $050E,X while
     * $0516,X contains only the local 8-bit pixel X. The original initializer
     * at $BD10 divides the local X by 16 and sends it to both the map writer
     * and background renderer, so a second-screen face is built on screen 1.
     *
     * The helper folds the screen flag into bit 4 while converting pixels to
     * the 0-31 world-map X coordinate:
     *
     *     worldX = (localPixelX >> 4) | (screenIndex << 4)
     *
     * $FFC0-$FFCF belongs to a retired animation-initialization filter and is
     * overwritten here after fixSpecialLevelAnimations().
     */
    static fixWideScreenEnemy9Background(romData){
        const enemy9WorldXHookRomAddr = 0x3D20; // CPU $BD10 in bank 0
        const enemy9WorldXHelperCpuAddr = 0xFFC0;
        const fixedBankShift = 0x18000;
        const enemy9WorldXHelperRomAddr =
            0x4010 + (enemy9WorldXHelperCpuAddr - 0xC000) + fixedBankShift;

        // Replace the original 11-byte local-X conversion with JSR + padding.
        Asm6502.writeBytes(romData, enemy9WorldXHookRomAddr, [
            0x20, 0xC0, 0xFF,       // JSR $FFC0
            0xEA, 0xEA, 0xEA, 0xEA,
            0xEA, 0xEA, 0xEA, 0xEA,
        ]);

        const enemy9WorldXCode = [
            0xBD, 0x0E, 0x05,       // LDA $050E,X (screen index)
            0x4A,                   // LSR A (screen index -> carry)
            0xBD, 0x16, 0x05,       // LDA $0516,X (local pixel X)
            0x6A,                   // ROR A (screen index -> bit 7)
            0x4A, 0x4A, 0x4A,       // divide by 16
            0x85, 0x63,             // STA $63 (background face X)
            0x85, 0x00,             // STA $00 (blocking-cell X)
            0x60,                   // RTS
        ];
        Asm6502.writeBytes(
            romData,
            enemy9WorldXHelperRomAddr,
            enemy9WorldXCode
        );
    }

    /**
     * Graphics IDs $80-$8B select the twelve compiled scene images. Each
     * 32-byte manifest at bank 6 $8A00 identifies 256-byte source chunks:
     * 0-63 are bank 5 $8000-$BFFF, 64-115 are bank 6 $8C00-$BFFF.
     * Keep title/ending graphics ID 0 on the existing $EF80 uploader.
     * Fixed-bank $FDC2-$FE5F leaves $FE60-$FED8 for the bird/fish lift.
     */
    static installSceneGraphicsLoader(romData) {
        const base = 0xFDC2, limit = 0xFE60;
        const file = RomLayout.programOffset;
        if(romData.subarray(file(base), file(limit)).some(byte => byte !== 0))
            throw new Error('Reserved scene-graphics loader area in bank 7 is occupied');
        const {bytes, labels, emit, label, absolute, branch, resolve} = Asm6502.block(base, limit);
        emit(0x48, 0xA5, 0x2F); branch(0x30, 'scene');
        emit(0x68);
        absolute(0x4C, 0xEF80);
        label('scene');
        // The uploader runs inside NMI. Preserve the two game-state bytes
        // reused as a source pointer, as well as the caller's A/X/Y.
        emit(0x8A, 0x48, 0x98, 0x48,
            0xA5, 0x30, 0x48, 0xA5, 0x31, 0x48,
            0xA9, 0x00, 0x8D, 0x00, 0x20, 0x8D, 0x01, 0x20,
            0xAD, 0x02, 0x20,
            0xA9, 0x00, 0x8D, 0x06, 0x20, 0x8D, 0x06, 0x20,
            0xA2, 0x00);
        label('chunk');
        emit(0xA9, 0x06, 0x8D, 0x00, 0x80,
            0xA5, 0x2F, 0x29, 0x0F, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A,
            0x85, 0x30,
            // Carry from scene * 32 selects manifest page $8A or $8B.
            0xA9, 0x8A, 0x69, 0x00, 0x85, 0x31,
            0x8A, 0xA8, 0xB1, 0x30,
            0xC9, 0x40);
        branch(0x90, 'bank5');
        emit(0x38, 0xE9, 0x40, 0x18, 0x69, 0x8C, 0x85, 0x31,
            0xA9, 0x06);
        absolute(0x4C, 'copy');
        label('bank5');
        emit(0x18, 0x69, 0x80, 0x85, 0x31, 0xA9, 0x05);
        label('copy');
        emit(0x8D, 0x00, 0x80, 0xA9, 0x00, 0x85, 0x30, 0xA8);
        label('page');
        emit(0xB1, 0x30, 0x8D, 0x07, 0x20, 0xC8);
        branch(0xD0, 'page');
        emit(0xE8, 0xE0, 0x20); branch(0x90, 'chunk');
        // Restore executable bank 0 before re-enabling NMI. Otherwise an
        // immediate vblank edge could enter bank-0 code in an asset bank.
        emit(0xA9, 0x00, 0x8D, 0x00, 0x80,
            0xA5, 0x2F, 0x85, 0x2E,
            0xA9, 0x1E, 0x8D, 0x01, 0x20,
            0xA9, 0x00, 0x8D, 0x05, 0x20, 0x8D, 0x05, 0x20,
            0xA9, 0x80, 0x8D, 0x00, 0x20,
            0x68, 0x85, 0x31, 0x68, 0x85, 0x30,
            0x68, 0xA8, 0x68, 0xAA, 0x68, 0x60);

        resolve();
        Asm6502.writeBytes(romData, file(base), bytes);
        // $80B2 is BEQ over this JSR; its operand at $80B3 stays intact.
        Asm6502.writeBytes(romData, file(0x80B4), [0x20, base & 0xFF, base >> 8]);
        return { start: base, end: base + bytes.length };
    }
}
