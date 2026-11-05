class Coordinates {
    // Audited against the native ROM and the optional RAM observer. Native
    // $82EF clears these bytes on stage/death reset; no native live reads.
    static COORDINATE_RAM = Object.freeze({ enemySpawnPages: 0x75, enemySlots: 8, playerYHigh: 0x7D });

    /**
     * Eight immutable enemy birth pages and a signed player Y high byte.
     * The high byte extends native 8.8 Y physics; negative Y is air above the
     * map, not a second vertical map. Keep native bottom death and velocities.
     * Fixed bank 7 $F410–$F5BB is relocated level storage, cleared on export.
     */
    static fixExtendedCoordinates(romData){
        const file = RomLayout.programOffset;
        const base = 0xF410, limit = 0xF5BC;
        if(romData.subarray(file(base), file(limit)).some(byte => byte !== 0))
            throw new Error('Reserved coordinate-patch area in bank 7 is occupied');
        const { enemySpawnPages: pages, playerYHigh: high } = Coordinates.COORDINATE_RAM;
        const {bytes, labels, emit, label, absolute, branch, resolve} = Asm6502.block(base, limit);
        const hooks = [];
        const hook = (address, name, size = 3, opcode = 0x4C) => hooks.push({ address, name, size, opcode });

        // Capture bit 7 of the loaded enemy type AFTER native decoding of its
        // page, but BEFORE ASL extracts facing. PHA/PLA preserve that operand.
        label('birth');
        emit(0x48, 0xBD, 0x0E, 0x05, 0x29, 0x01, 0x95, pages, 0x68, 0x0A, 0xA9, 0x03, 0x60);
        hook(0xADED, 'birth', 3, 0x20);
        label('clearBirth');
        emit(0xA2, 0x07, 0xA9, 0x00);
        label('clearBirthLoop'); emit(0x95, pages, 0xCA); branch(0x10, 'clearBirthLoop');
        emit(0xA2, 0x07); absolute(0x4C, 0xAE36);
        hook(0xAE32, 'clearBirth', 4);
        // Native respawn rebuilds the local birth X/Y then forces X page 0.
        label('respawn');
        emit(0xB5, pages, 0x9D, 0x0E, 0x05, 0x85, 0x01,
            0xBD, 0x16, 0x05, 0x85, 0x00, 0xBD, 0x33, 0x04, 0x85, 0x02);
        // $AC was sampled at the death position earlier in this frame.
        // Resample at birth so a blocked birthplace waits on the right page.
        absolute(0x20, 0x9330); absolute(0x4C, 0xAD98);
        hook(0xAD93, 'respawn', 5);

        label('integrateY');
        emit(0xA5, 0xC7, 0x85, 0x00, 0x18, 0xA5, 0xC4, 0x65, 0xC8, 0x85, 0xC4,
            0xAD, 0x1E, 0x04, 0x65, 0x00, 0x8D, 0x1E, 0x04);
        absolute(0x4C, 'extendY');
        hook(0x9995, 'integrateY');
        // The spring uses a separate signed integer addition, not $9995.
        label('springY');
        emit(0x85, 0x00, 0x18, 0x6D, 0x1E, 0x04, 0x8D, 0x1E, 0x04);
        label('extendY');
        emit(0xA5, 0x00); branch(0x30, 'negativeY');
        emit(0xA5, high, 0x69, 0x00); absolute(0x4C, 'storeYHigh');
        label('negativeY'); emit(0xA5, high, 0x69, 0xFF);
        label('storeYHigh'); emit(0x85, high, 0xAD, 0x1E, 0x04, 0x60);
        hook(0x9CA2, 'springY', 7, 0x20);
        label('stepY');
        emit(0xAD, 0x1E, 0x04); branch(0xD0, 'stepYLow'); emit(0xC6, high);
        label('stepYLow'); emit(0xCE, 0x1E, 0x04, 0x60);
        hook(0x97DF, 'stepY', 3, 0x20);
        label('initY'); emit(0x8D, 0x1E, 0x04, 0xA9, 0x00, 0x85, high, 0x60);
        hook(0x9B20, 'initY', 3, 0x20);
        label('boundsY');
        emit(0xA5, high); branch(0x30, 'aboveBounds'); branch(0xD0, 'belowBounds');
        emit(0xAD, 0x1E, 0x04, 0xC9, 0xD5); branch(0x90, 'aboveBounds');
        label('belowBounds'); absolute(0x4C, 0xB9A1);
        label('aboveBounds'); absolute(0x4C, 0x945A);
        hook(0x9863, 'boundsY');

        // Player-only probes use the body, not just the anchor. Above-map
        // feet can reach row 0 and support a player at signed Y=-8.
        label('collision');
        emit(0xA5, high); branch(0xF0, 'onscreenCollision');
        emit(0xC9, 0xFF); branch(0xD0, 'noCollision');
        emit(0xAD, 0x1E, 0x04, 0xC9, 0xF8); branch(0x90, 'noCollision');
        emit(0xA5, 0x42, 0xC9, 0x02); branch(0x90, 'noCollision');
        branch(0xF0, 'topFeet');
        // Horizontal body probes touch row 0 only at anchors -7..-1.
        emit(0xAD, 0x1E, 0x04, 0xC9, 0xF9); branch(0xB0, 'normalCollision');
        absolute(0x4C, 'noCollision');
        label('topFeet');
        // $9BE3 adds one to its probe. Account for that input wrapping
        // from $FF to $00 before the native +7 foot offset is applied.
        emit(0xA5, 0x02, 0xCD, 0x1E, 0x04); branch(0x90, 'normalCollision');
        emit(0x18, 0x69, 0x07); branch(0xB0, 'normalCollision');
        absolute(0x4C, 'noCollision');
        label('onscreenCollision');
        emit(0xA5, 0x42, 0xC9, 0x01); branch(0xD0, 'normalCollision');
        // $9BD5 subtracts one from Y before calling us: at Y=0 its
        // probe is already $FF, even though the player's high byte is zero.
        emit(0xAD, 0x1E, 0x04); branch(0xF0, 'noCollision');
        emit(0xA5, 0x02, 0xC9, 0x08); branch(0x90, 'noCollision');
        label('normalCollision'); emit(0x86, 0x3F, 0x84, 0x40); absolute(0x4C, 0x8F61);
        label('noCollision'); emit(0xA9, 0x00, 0x85, 0x41, 0x85, 0x44, 0x18, 0x60);
        hook(0x8F5D, 'collision', 4);
        // Horizontal probes near the top still touch visible row 0. Clip
        // their -8 start and test one row, instead of wrapping to row 15.
        label('probeY');
        emit(0xA5, high); branch(0xF0, 'nativeProbeY');
        emit(0xA5, 0x42, 0xC9, 0x03); branch(0x90, 'nativeProbeY');
        emit(0xA9, 0x01, 0x85, 0x05, 0xA9, 0x00, 0x85, 0x02, 0x60);
        label('nativeProbeY');
        emit(0x18); // The high-byte guard changed C; native ADC starts clear.
        emit(0xBD, 0x63, 0xBF); branch(0x30, 'negativeProbe');
        emit(0x65, 0x02, 0x85, 0x02, 0x60);
        label('negativeProbe'); emit(0x65, 0x02); branch(0xB0, 'storeProbe');
        emit(0xA9, 0x01, 0x85, 0x05, 0xA9, 0x00);
        label('storeProbe'); emit(0x85, 0x02, 0x60);
        hook(0x8FA7, 'probeY', 7, 0x20);

        // Raw tile lookups outside the common player collision routine.
        label('tileAction'); emit(0xA5, high); branch(0xD0, 'return');
        absolute(0x20, 0x98AE); absolute(0x4C, 0x9873);
        hook(0x9870, 'tileAction');
        label('ledge'); emit(0xA5, high); branch(0xD0, 'noLedge');
        emit(0xAD, 0x1E, 0x04, 0xC9, 0x0A); branch(0x90, 'noLedge');
        emit(0x38, 0xA5, 0xC2); absolute(0x4C, 0x9C3F);
        label('noLedge'); emit(0xA9, 0x00, 0x85, 0xA7);
        label('return'); emit(0x60);
        hook(0x9C3C, 'ledge');
        label('ladder'); absolute(0x20, 'feetInMap'); branch(0x90, 'noLadder');
        emit(0x38, 0xA5, 0xC2); absolute(0x4C, 0x9F7B);
        label('noLadder'); emit(0x18, 0x60);
        hook(0x9F78, 'ladder');
        label('spring'); absolute(0x20, 'feetInMap'); branch(0x90, 'noSpring');
        emit(0xA9, 0xFA, 0x85, 0x06); absolute(0x4C, 0x9D0E);
        label('noSpring'); emit(0x18, 0x60);
        hook(0x9D0A, 'spring', 4);
        label('punch'); emit(0xA5, high); branch(0xD0, 'noPunch');
        absolute(0x20, 0xA2C2); absolute(0x4C, 0x95FD);
        label('noPunch'); emit(0xA9, 0x00, 0x85, 0x55, 0x60);
        hook(0x95FA, 'punch');
        // Guard these call sites to retain the native routines' prologues.
        label('platform'); absolute(0x20, 'feetInMap'); branch(0x90, 'skipPlatform');
        absolute(0x20, 0xA68B); label('skipPlatform'); emit(0x60);
        hook(0x94E2, 'platform', 3, 0x20);
        label('bomb'); emit(0xA5, high); branch(0xD0, 'skipBomb');
        absolute(0x20, 0xA318); label('skipBomb'); emit(0x60);
        hook(0x95BF, 'bomb', 3, 0x20);
        label('specialContact'); emit(0xA5, high); branch(0xD0, 'skipContact');
        absolute(0x20, 0xB2AA); label('skipContact'); emit(0x60);
        hook(0x8B6F, 'specialContact', 3, 0x20);
        label('enemyContact'); emit(0xA5, high); branch(0xD0, 'noEnemyContact');
        emit(0xA5, 0xC2, 0x85, 0x00); absolute(0x4C, 0xB037);
        label('noEnemyContact'); emit(0x18, 0x60);
        hook(0xB033, 'enemyContact', 4);
        label('door'); emit(0x48, 0xA5, high); branch(0xD0, 'noDoor');
        emit(0x68, 0x48, 0xA5, 0x43); absolute(0x4C, 0xB805);
        label('noDoor'); emit(0x68, 0x60);
        hook(0xB802, 'door');

        // The crumbling-floor routine probes Y+8 and Y+24: at Y=-8 both
        // points are valid first/second map rows even with an offscreen body.
        label('feetInMap'); emit(0xA5, high); branch(0xF0, 'validFeet');
        emit(0xC9, 0xFF); branch(0xD0, 'invalidFeet');
        emit(0xAD, 0x1E, 0x04, 0xC9, 0xF8, 0x60);
        label('validFeet'); emit(0x38, 0x60);
        label('invalidFeet'); emit(0x18, 0x60);

        // Guard at OAM construction, after every view/pause sprite update.
        // X projection and the selected horizontal camera stay native.
        label('oam'); emit(0xA5, high); branch(0xF0, 'normalOam');
        emit(0xA9, 0x00, 0x8D, 0x00, 0x04, 0x8D, 0x11, 0x04);
        label('normalOam'); emit(0xA5, 0x23, 0x18); absolute(0x4C, 0x88D6);
        hook(0x88D3, 'oam');

        resolve();
        Asm6502.writeBytes(romData, file(base), bytes);
        for(const entry of hooks){
            const destination = labels.get(entry.name);
            Asm6502.writeBytes(romData, file(entry.address),
                [entry.opcode, destination & 0xFF, destination >> 8, ...Array(entry.size - 3).fill(0xEA)]);
        }
        Coordinates.fixWideScreenEnemyRespawn(romData);
    }

    /**
     * Allow ordinary enemies to finish their death/respawn countdown in a
     * wide level.
     *
     * CPU $AC22 assigns state $0D and timer $C8 in $057E,X. The original
     * unfinished wide-mode branch at $AC37 then clears $04FE,X, the enemy type.
     * Since the main enemy loop skips type-zero slots, state $0D never runs
     * again and the timer remains frozen at $C8.
     *
     * Always skip that wide-only clear for ordinary enemies. Enemy types 5 and
     * 11 branch directly to $AC3B before this hook and therefore retain their
     * original permanent-removal behavior.
     */
    static fixWideScreenEnemyRespawn(romData){
        const bank0RomAddr = (cpuAddr) => 0x10 + (cpuAddr - 0x8000);

        Asm6502.writeBytes(romData, bank0RomAddr(0xAC37), [
            0x4C, 0x40, 0xAC,       // JMP $AC40 (keep ordinary enemy type)
            0xEA,                   // padding
        ]);
    }
}
