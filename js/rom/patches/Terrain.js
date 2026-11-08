class Terrain {
    /**
     * CPU $BF91: Tile 7's entry in the support-removal registration table
     * at $BF8A. Bank 0 has the same file offset in original and expanded ROMs.
     * Exclude it from generic falling; the separate stepped-on delay/fall
     * path and Tile 11's pass-through/overwrite rules remain unchanged.
     */
    static fixTile7SupportFall(romData){
        romData[0x3FA1] = 0x00;
    }

    /**
     * CPU $BF97: Tile 13's entry in the support-removal registration table.
     * Bank 0 has the same file offset in original and expanded ROMs.
     * Allow generic falling when support is removed; this does not add
     * Tile 7's stepped-on delay or an initial unsupported-tile scan.
     */
    static enableTile13SupportFall(romData){
        romData[0x3FA7] = 0x01;
    }

    /**
     * CPU $C0B6: Tile 13's entry in the player-occupied-cell action table
     * at $C0A9, read by $9870. Action 1 kills the player, as for Tiles 7,
     * 8 and 10. Solid collision remains unchanged; this is not restricted
     * to the falling state. The table lives in the fixed PRG bank.
     */
    static enableTile13Crush(romData){
        const fixedBankShift = 0x18000;
        romData[0x40C6 + fixedBankShift] = 0x01;
    }

    /**
     * Extend the native occupied-cell death action to Tiles 1-6 and 12.
     * Turning in midair can leave horizontal inertia pointing behind the
     * player, past the facing-based wall probe. Kill once the player's
     * anchor enters these solids, just as for Tiles 7, 8, 10 and 13.
     * Tile 12's native spring animation (player state 4) legitimately moves
     * the anchor into the spring while compressing. A lookup wrapper at
     * $FAE0-$FAFF exempts only that tile/state pair; other solids still kill.
     * RemoteBomb.install subsequently relocates this 17-byte lookup to the
     * retired sore-head handler at $95E4, reusing the fixed area as a bridge.
     * Movement and collision code stay native. To disable the table changes
     * AND wrapper, comment out this call in applyPatches.js and rebuild from
     * the original ROM. Tile 13's patch is independent.
     */
    static enableSolidTileCrush(romData){
        const file = RomLayout.programOffset;
        // Relocated level storage, immediately after the bird motion worker.
        const base = 0xFAE0, limit = 0xFB00;
        if(romData.subarray(file(base), file(limit)).some(byte => byte !== 0))
            throw new Error('Reserved solid-crush area in bank 7 is occupied');
        const {bytes, emit, label, branch, resolve} = Asm6502.block(base, limit);
        emit(0xC0, 12); branch(0xD0, 'native'); // CPY #Tile12
        emit(0xA5, 0xC0, 0xC9, 4); branch(0xD0, 'native');
        emit(0xA9, 0, 0x60); // Normal spring compression: no occupied-cell action.
        label('native'); emit(0xB9, 0xA9, 0xC0, 0x60); // LDA $C0A9,Y; RTS
        resolve();
        Asm6502.writeBytes(romData, file(base), bytes);
        // Replace only the action lookup; preserve X/Y and the native dispatch.
        Asm6502.writeBytes(romData, file(0x9877), [0x20, base & 255, base >> 8]);
        const actions = file(0xC0A9);
        for(const tile of [1, 2, 3, 4, 5, 6, 12]) romData[actions + tile] = 0x01;
    }

    /**
     * Tiles 5-9 share the break handler at $A4F3. Its unconditional $98FF
     * snap is appropriate beside solids, but teleports a player overlapping
     * passable Tile 9. The dispatch at $8326 preserves Y = target tile ID.
     * Give only Tile 9 the same erase/debris/support-removal/sound sequence
     * without the snap; all other IDs resume the original handler at $A4F6.
     * The animation also snaps on its next tick at $94A9. Mark this hit in
     * $55's unused sign bit so that call skips only the Tile 9 hit. Native
     * consumers otherwise test $55 for zero; the next hit/miss overwrites it.
     * $FEB8-$FED8 is relocated level storage after the bird lift worker.
     * Disable by commenting out this call in applyPatches.js and rebuilding.
     */
    static fixTile9BreakAlignment(romData){
        const file = RomLayout.programOffset;
        const base = 0xFEB8, limit = 0xFED9;
        if(romData.subarray(file(base), file(limit)).some(byte => byte !== 0))
            throw new Error('Reserved Tile 9 break area in bank 7 is occupied');
        const {bytes, labels, emit, label, absolute, branch, resolve} = Asm6502.block(base, limit);
        emit(0xC0, 9); branch(0xD0, 'solid');
        // CPY #9 left carry set; rotate native action 2 into nonzero marker $81.
        emit(0x66, 0x55);
        absolute(0x20, 0x9623); // Erase the target tile and update the background.
        absolute(0x20, 0xA19E); // Native debris.
        absolute(0x20, 0xA5E5); // Register unsupported tiles above the target.
        absolute(0x4C, 0xA4FF); // Native sound/return, skipping only JSR $98FF.
        label('solid'); absolute(0x20, 0x9623); absolute(0x4C, 0xA4F6);
        label('animationAlign'); emit(0x24, 0x55); branch(0x30, 'done');
        absolute(0x4C, 0x98FF); label('done'); emit(0x60);
        resolve();
        Asm6502.writeBytes(romData, file(base), bytes);
        Asm6502.writeBytes(romData, file(0xA4F3), [0x4C, base & 255, base >> 8]);
        const align = labels.get('animationAlign');
        Asm6502.writeBytes(romData, file(0x94A9), [0x20, align & 255, align >> 8]);
    }

    /**
     * Fix round-rock pushes that cross a horizontal map boundary.
     *
     * The original rock-specific code normalizes X with 0x0F in one place and
     * skips normalization entirely in two others. That is correct for the
     * released 16-column maps, but breaks the dormant 32-column mode:
     *
     * - pushing left from column 0 checks column 15 instead of column 31;
     * - after a valid edge push, the background rock is not removed from its
     *   source column, so the moving rock sprite collides with the player;
     * - the same stale-source problem happens when pushing right from column 31.
     *
     * fixSpecialLevelAnimations() replaces the original animation scanner and
     * reserves CPU $D8E7-$D9EB for its handler, initializer, live-map check,
     * and lookup tables. The bytes immediately after that region hold two
     * small rock helpers:
     *
     * - select 0x0F or 0x1F from the wide-screen flag ($3D bit 0);
     * - hide a moving rock that has left the 256-pixel viewport in wide mode,
     *   instead of drawing its wrapped low byte at the opposite screen edge.
    */
    static fixWideScreenRockPushBug(romData){
        const normalizeRockXCpuAddr = 0xD9EC;
        const normalizeRockXRomAddr = 0x1D9FC;

        const normalizeRockXCode = [
            0x48,                   // PHA
            0xA5, 0x3D,             // LDA $3D
            0x4A,                   // LSR A (carry = wide-screen flag)
            0x68,                   // PLA
            0x29, 0x1F,             // AND #$1F
            0xB0, 0x02,             // BCS done
            0x29, 0x0F,             // AND #$0F
            0x60,                   // RTS
        ];
        Asm6502.writeBytes(romData, normalizeRockXRomAddr, normalizeRockXCode);

        const updateRockSpriteCpuAddr = normalizeRockXCpuAddr + normalizeRockXCode.length;
        const updateRockSpriteRomAddr = normalizeRockXRomAddr + normalizeRockXCode.length;
        const updateRockSpriteCode = [
            0x38,                   // SEC
            0xA5, 0xDE,             // LDA movingRockXLow
            0xE5, 0xFD,             // SBC cameraX
            0x8D, 0x4E, 0x04,       // STA movingRockScreenX
            0xA5, 0xDD,             // LDA movingRockXHigh
            0xE9, 0x00,             // SBC #$00
            0x48,                   // PHA
            0xA5, 0x3D,             // LDA $3D
            0x4A,                   // LSR A (carry = wide-screen flag)
            0x90, 0x09,             // BCC singleScreen
            0x68,                   // PLA
            0xF0, 0x07,             // BEQ done (inside the viewport)
            0xA9, 0x00,             // LDA #$00
            0x8D, 0x12, 0x04,       // STA movingRockSprite (hide it)
            0x60,                   // RTS
            0x68,                   // singleScreen: PLA
            0x60,                   // done: RTS
        ];
        Asm6502.writeBytes(romData, updateRockSpriteRomAddr, updateRockSpriteCode);

        const normalizeRockXLowByte = normalizeRockXCpuAddr & 0xFF;
        const normalizeRockXHighByte = (normalizeRockXCpuAddr >> 8) & 0xFF;
        const updateRockSpriteLowByte = updateRockSpriteCpuAddr & 0xFF;
        const updateRockSpriteHighByte = (updateRockSpriteCpuAddr >> 8) & 0xFF;

        // CPU $9E37: replace the low-byte-only sprite coordinate calculation.
        const updateRockSpriteCallerCode = [
            0xA5, 0xC0,             // LDA $C0
            0xC9, 0x03,             // CMP #$03
            0xD0, 0x03,             // BNE done
            0x20, updateRockSpriteLowByte, updateRockSpriteHighByte,
            0x60,                   // done: RTS
            0xEA, 0xEA, 0xEA, 0xEA, 0xEA,
        ];
        Asm6502.writeBytes(romData, 0x1E47, updateRockSpriteCallerCode);

        // CPU $9E6C: normalize the destination checked by a left-edge push.
        const leftDestinationCheckCode = [
            0xC6, 0x00,             // DEC $00
            0xC6, 0x00,             // DEC $00
            0xA5, 0x00,             // LDA $00
            0xC9, 0xF0,             // CMP #$F0
            0x90, 0x03,             // BCC storeDestinationX
            0x20, normalizeRockXLowByte, normalizeRockXHighByte,
            0x85, 0x00,             // storeDestinationX: STA $00
            0xEA,                   // NOP (keep following code aligned)
        ];
        Asm6502.writeBytes(romData, 0x1E7C, leftDestinationCheckCode);

        // Normalize the source tile after the map lookup has wrapped $00.
        // CPU $9E82 handles left pushes; CPU $9EB1 handles right pushes.
        const normalizeRockSourceCode = [
            0xA5, 0x00,             // LDA $00
            0x20, normalizeRockXLowByte, normalizeRockXHighByte,
            0x85, 0x00,             // STA $00
            0xEA, 0xEA, 0xEA,       // NOP padding
        ];
        Asm6502.writeBytes(romData, 0x1E92, normalizeRockSourceCode);
        Asm6502.writeBytes(romData, 0x1EC1, normalizeRockSourceCode);
    }
}
