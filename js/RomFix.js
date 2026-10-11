class Romfix{
    // Audited against the native ROM and the optional RAM observer. Native
    // $82EF clears these bytes on stage/death reset; no native live reads.
    static COORDINATE_RAM = Object.freeze({ enemySpawnPages: 0x75, enemySlots: 8, playerYHigh: 0x7D });
    // Fix original version rom
    static fixOriginalRom(romData, isExpanded = false, gameConfig = {}){
        const disableTimer = Boolean(gameConfig.disableTimer);
        const showRemainingRescueCount =
            gameConfig.showRemainingRescueCount !== false;
        const cameraFollow = Boolean(gameConfig.cameraFollow);

        Romfix.backupUnusedImages(romData);
        // Always remove the optional bundle first, including on old exports.
        Romfix.resetViewModesPatch(romData, isExpanded);
        // Keep the reset so commenting out the next call also restores ROMs
        // that were exported with this patch enabled.
        Romfix.resetTile7SupportFallPatch(romData);
        // Optional: keep Tile 7 floating until stepped on.
        Romfix.fixTile7SupportFall(romData);
        // 保留重置调用，注释补丁调用后，重新导出可恢复原值。
        Romfix.resetTile13SupportFallPatch(romData);
        // 允许这个元素下落会有更多趣味性。
        Romfix.enableTile13SupportFall(romData);
        // 保留重置调用，注释补丁调用后，重新导出可恢复原值。
        Romfix.resetTile13CrushPatch(romData, isExpanded);
        // 允许 Tile 13 下落后像 Tile 7、8、10 一样压死玩家。
        Romfix.enableTile13Crush(romData, isExpanded);
        Romfix.fixSpecialLevelAnimations(romData, isExpanded);
        Romfix.fixWideScreenEnemy9Background(romData, isExpanded);
        // Restore legacy exports before applying the optional bat behavior.
        Romfix.fixCodeInsert(romData, 0xAC72 - 0x8000 + 0x10, [0x48]);
        if(cameraFollow) Romfix.fixBatHorizontalWrap(romData);
        Romfix.fixWideScreenRockPushBug(romData, isExpanded);
        // Rebuild shared camera support before applying runtime view hooks.
        Romfix.resetWideScreenLoopingCameraPatch(romData, isExpanded);
        // Established wide-level follow and pause free-look are always enabled.
        Romfix.fixWideScreenLoopingCamera(romData, isExpanded);
        Romfix.configureLevelTimer(romData, !disableTimer);
        if(showRemainingRescueCount){
            Romfix.addRemainingRescueCountHud(
                romData,
                isExpanded,
                disableTimer
            );
        }
        if(cameraFollow) Romfix.addViewModes(romData, isExpanded);
        Romfix.fixExtendedCoordinates(romData, isExpanded);
        Romfix.configureCustomLevelCredit(romData, isExpanded, gameConfig.customLevelAuthor);
        Romfix.addMoaikunMakerLabel(romData);
    }

    /**
     * Append a text page after all six native staff entries, before KONAMI.
     * $B5=4 is the native logo phase. Its $BC=0 entry shows our page first;
     * $BC=5 waits on the existing $BD timer, then enters native $C914.
     * Native logo substates 1–4, staff data, music and ending animation stay
     * untouched. Fixed bank 7 $F800–$FCFF is relocated, cleared level storage;
     * coordinate helpers end at $F800 and pause helpers start at $FED9.
     */
    static configureCustomLevelCredit(romData, isExpanded, value) {
        const file = cpu => cpu - 0x8000 + 0x10 + (isExpanded ? 6 * 0x4000 : 0);
        // Remove an earlier export's hook even when the new name is blank.
        Romfix.fixCodeInsert(romData, file(0xC905), [0xA5, 0xBC, 0x20, 0x0D, 0x83]);
        const author = Config.normalizeCustomLevelAuthor(value).trim().toUpperCase();
        if (!author) return;
        if (!isExpanded) throw new Error('Custom level credits require an expanded ROM');
        const base = 0xF800, limit = 0xFD00;
        if (romData.subarray(file(base), file(limit)).some(byte => byte !== 0))
            throw new Error('Reserved ending-credit area in bank 7 is occupied');

        const text = [];
        const columns = Config.CREDIT_SCREEN_WIDTH / Config.CREDIT_GLYPH_WIDTH;
        const row = (line, value, font = 0x0B) => {
            const address = 0x2000 + line * columns + Math.floor((columns - value.length) / 2);
            text.push(0x06, address >> 8, address & 0xFF, value.length,
                ...Array.from(value, letter => letter === ' ' ? 0 : font + letter.charCodeAt(0) - 0x41), 0xFF);
        };
        row(7, 'THANKS TO KONAMI');
        row(9, 'FOR CREATING MOAI KUN');
        row(14, 'CUSTOM LEVELS DESIGNED BY');
        row(16, author, 0x80);
        row(21, 'CREATED WITH');
        row(23, 'MOAI KUN MAKER', 0x80);

        // The original staff names use centered 8px glyphs in 8x16 sprite
        // tiles ($16/$17 = A, $18/$19 = B, ...). Move their eight visible
        // rows into background tiles $80–$99, so even a 28-letter name is
        // complete without the NES's eight-sprites-per-scanline limit.
        const font = [];
        for (let letter = 0; letter < 26; letter++) {
            const source = 0x8010 + (0x16 + letter * 2) * 16;
            const ink = Array.from({length:8}, (_, y) => {
                const nativeY = y + 4;
                const at = source + (nativeY >> 3) * 16 + (nativeY & 7);
                // Native sprite palette 2 draws index 2 white and index 3
                // black. Preserve the visible white strokes, not the black
                // cutouts inside them, when remapping to background ink.
                return romData[at + 8] & ~romData[at];
            });
            // Palette index 2 is the native ending's white foreground.
            font.push(...Array(8).fill(0), ...ink);
        }
        const originalFont = romData.slice(0x9810, 0x9810 + font.length);

        const bytes = [], labels = new Map(), references = [];
        const emit = (...values) => bytes.push(...values);
        const label = name => labels.set(name, base + bytes.length);
        const branch = (op, name) => { emit(op, 0); references.push({at: bytes.length - 1, name, relative: true}); };
        const address = (op, name) => { emit(op, 0, 0); references.push({at: bytes.length - 2, name}); };
        const loadFont = name => {
            emit(0xA9, 0, 0x85, 0x00, 0xA9, 0, 0x85, 0x01);
            references.push({at:bytes.length - 7, name, byte:'low'},
                {at:bytes.length - 3, name, byte:'high'});
            address(0x20, 'uploadFont');
        };

        emit(0xA5, 0xBC);                // LDA logo substate
        branch(0xF0, 'show');             // BEQ show our page
        emit(0xC9, 0x05);
        branch(0xF0, 'resume');           // BEQ resume original logo setup
        emit(0x20, 0x0D, 0x83);          // Native indexed dispatch
        emit(0x14, 0xC9, 0x26, 0xC9, 0xC0, 0xC9, 0xC8, 0xC9, 0xD0, 0xC9);

        label('show');
        emit(0x20, 0xB9, 0x83,          // Clear background (native)
             0x20, 0xED, 0x89,          // Hide ending entities (native)
             0xA9, 0x00, 0x85, 0x2F,   // Keep native ending graphics bank 0
             0xA9, 0x00, 0x85, 0xFC,   // No vertical scroll on our text page
             0x20, 0x60, 0xFF,          // Shared camera reset, also for wide maps
             // Bank 0's $1000 pattern table contains the complete A–Z font.
             // Its $0000 ending font omits several letters. Entities are hidden.
             0xA5, 0xFF, 0x29, 0xE0, 0x09, 0x10, 0x85, 0xFF,
             0xA0, 0x22, 0x20, 0x26, 0xD6); // Native ending palette
        loadFont('nameFont');
        emit(0xA6, 0x1E, 0xA0, 0x00);  // Append to native VRAM queue
        label('copy');
        address(0xB9, 'text');           // LDA text,Y
        emit(0x9D, 0x00, 0x03, 0xE8, 0xC8, 0xC0, text.length);
        branch(0xD0, 'copy');
        emit(0x86, 0x1E,
             0xA9, 0xE1, 0x85, 0xBD,   // 225 ticks × 4 frames = fifteen seconds
             0xA9, 0x05, 0x85, 0xBC, 0x60);
        label('resume');
        loadFont('originalFont');       // Restore CHR RAM before native logo/title
        emit(0xA5, 0xFF, 0x29, 0xE0, 0x09, 0x08, 0x85, 0xFF, // Native pattern tables
             0xA9, 0x00, 0x85, 0xBC, 0x4C, 0x14, 0xC9);

        label('uploadFont');
        // Use native rendering/NMI suspension for a bounded 416-byte upload.
        // Code and both font copies stay in the fixed bank throughout.
        emit(0x20, 0x2D, 0x81,
             0xA9, 0x18, 0x8D, 0x06, 0x20, 0xA9, 0x00, 0x8D, 0x06, 0x20,
             0xA0, 0x00);
        label('fontPage');
        emit(0xB1, 0x00, 0x8D, 0x07, 0x20, 0xC8);
        branch(0xD0, 'fontPage');
        emit(0xE6, 0x01);
        label('fontTail');
        emit(0xB1, 0x00, 0x8D, 0x07, 0x20, 0xC8, 0xC0, 0xA0);
        branch(0xD0, 'fontTail');
        emit(0x4C, 0x0C, 0x81);
        label('text');
        emit(...text);
        label('nameFont');
        emit(...font);
        label('originalFont');
        emit(...originalFont);

        for (const ref of references) {
            const target = labels.get(ref.name);
            if (ref.relative) {
                const distance = target - (base + ref.at + 1);
                if (distance < -128 || distance > 127) throw new Error('Ending-credit branch out of range');
                bytes[ref.at] = distance & 0xFF;
            } else if (ref.byte) {
                bytes[ref.at] = ref.byte === 'low' ? target & 0xFF : target >> 8;
            } else {
                bytes[ref.at] = target & 0xFF;
                bytes[ref.at + 1] = target >> 8;
            }
        }
        if (base + bytes.length > limit) throw new Error('Ending-credit patch exceeds reserved space');
        Romfix.fixCodeInsert(romData, file(base), bytes);
        Romfix.fixCodeInsert(romData, file(0xC905), [0x4C, base & 0xFF, base >> 8, 0xEA, 0xEA]);
    }

    /**
     * Eight immutable enemy birth pages and a signed player Y high byte.
     * The high byte extends native 8.8 Y physics; negative Y is air above the
     * map, not a second vertical map. Keep native bottom death and velocities.
     * Fixed bank 7 $F410–$F7FF is relocated level storage, cleared on export.
     */
    static fixExtendedCoordinates(romData, isExpanded = false){
        if(!isExpanded) throw new Error('Extended coordinates require an expanded ROM');
        const file = cpu => cpu - 0x8000 + 0x10 + (cpu >= 0xC000 ? 6 * 0x4000 : 0);
        const base = 0xF410, limit = 0xF800;
        if(romData.subarray(file(base), file(limit)).some(byte => byte !== 0))
            throw new Error('Reserved coordinate-patch area in bank 7 is occupied');
        const { enemySpawnPages: pages, playerYHigh: high } = Romfix.COORDINATE_RAM;
        const bytes = [], labels = new Map(), references = [], hooks = [];
        const emit = (...values) => bytes.push(...values);
        const label = name => labels.set(name, base + bytes.length);
        const absolute = (opcode, destination) => {
            emit(opcode); references.push({ offset: bytes.length, destination }); emit(0, 0);
        };
        const branch = (opcode, destination) => {
            emit(opcode); references.push({ offset: bytes.length, destination, relative: true }); emit(0);
        };
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

        if(base + bytes.length > limit) throw new Error('Coordinate patch exceeds reserved bank 7 space');
        for(const ref of references){
            const destination = typeof ref.destination === 'string' ? labels.get(ref.destination) : ref.destination;
            if(destination === undefined) throw new Error(`Unknown coordinate label: ${ref.destination}`);
            if(ref.relative){
                const delta = destination - (base + ref.offset + 1);
                if(delta < -128 || delta > 127) throw new Error('Coordinate branch is out of range');
                bytes[ref.offset] = delta & 0xFF;
            }else{ bytes[ref.offset] = destination & 0xFF; bytes[ref.offset + 1] = destination >> 8; }
        }
        Romfix.fixCodeInsert(romData, file(base), bytes);
        for(const entry of hooks){
            const destination = labels.get(entry.name);
            Romfix.fixCodeInsert(romData, file(entry.address),
                [entry.opcode, destination & 0xFF, destination >> 8, ...Array(entry.size - 3).fill(0xEA)]);
        }
        Romfix.fixWideScreenEnemyRespawn(romData);
    }
    static resetTile7SupportFallPatch(romData){
        romData[0x3FA1] = 0x01;
    }

    /**
     * CPU $BF91: Tile 7's entry in the support-removal registration table
     * at $BF8A. Bank 0 has the same file offset in original and expanded ROMs.
     * Exclude it from generic falling; the separate stepped-on delay/fall
     * path and Tile 11's pass-through/overwrite rules remain unchanged.
     */
    static fixTile7SupportFall(romData){
        romData[0x3FA1] = 0x00;
    }

    static resetTile13SupportFallPatch(romData){
        romData[0x3FA7] = 0x00;
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

    static resetTile13CrushPatch(romData, isExpanded = false){
        const fixedBankShift = isExpanded ? 0x4000 * 6 : 0;
        romData[0x40C6 + fixedBankShift] = 0x00;
    }

    /**
     * CPU $C0B6: Tile 13's entry in the player-occupied-cell action table
     * at $C0A9, read by $9870. Action 1 kills the player, as for Tiles 7,
     * 8 and 10. Solid collision remains unchanged; this is not restricted
     * to the falling state. The table lives in the fixed PRG bank.
     */
    static enableTile13Crush(romData, isExpanded = false){
        const fixedBankShift = isExpanded ? 0x4000 * 6 : 0;
        romData[0x40C6 + fixedBankShift] = 0x01;
    }

    // Backup unused images.
    static backupUnusedImages(romData){
        let index = 0xEA70;
        let indexEnd = 0xEE10;
        const backupAddr = 0x8C50;
        // If 0x8C50 is all zeros, means no backup has been made
        let needBackup = true;
        for(let i = backupAddr; i < backupAddr + (indexEnd - index); i++){
            if(romData[i] !== 0x00){
                needBackup = false;
                break;
            }
        }

        if(needBackup){
            const page1Addr = 0xAA70;
            const page2Addr = 0xCA70;
            for(;index < indexEnd; index++){
                let offset = index - 0xEA70;
                // Backup address
                romData[backupAddr + offset] = romData[page1Addr + offset];
                // Write new data
                romData[page1Addr + offset] = romData[index];
                romData[page2Addr + offset] = romData[index];
            }
        }
    }

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
    static fixSpecialLevelAnimations(romData, isExpanded = false){
        const animationUpdateCpuAddr = 0xD8E7;
        const animationInitCpuAddr = 0xD980;
        const runtimeMapFilterCpuAddr = 0xD9B8;
        const animationPpuLowTableCpuAddr = 0xD9DA;
        const animationMapPositionTableCpuAddr = 0xD9E2;
        const animationMapFilterTailCpuAddr = 0xDA15;
        const animationMapFilterCpuAddr = 0xFFC0;
        const fixedBankShift = isExpanded ? 0x4000 * 6 : 0;
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
        Romfix.fixCodeInsert(
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
        Romfix.fixCodeInsert(
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
        Romfix.fixCodeInsert(
            romData,
            fixedBankRomAddr(runtimeMapFilterCpuAddr),
            runtimeAnimationMapFilterCode
        );

        // Index 0-1: fire; index 2-7: flag.
        const animationPpuLowTable = [
            0xD2, 0xCC, 0x7B, 0x77, 0x31, 0x2F, 0x69, 0x65,
        ];
        Romfix.fixCodeInsert(
            romData,
            fixedBankRomAddr(animationPpuLowTableCpuAddr),
            animationPpuLowTable
        );

        // Packed map position: high nibble X, low nibble Y.
        const animationMapPositionTable = [
            0x93, 0x63, 0xD1, 0xB1, 0x80, 0x70, 0x41, 0x21,
            0xEA, 0xEA,
        ];
        Romfix.fixCodeInsert(
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
         */
        const animationMapFilterCode = [
            0xBD, 0xE2, 0xD9, 0x48, 0x29, 0x0F, 0x85, 0x01, 0x68, 0x4A, 0x4A, 0x4A,
            0x4A, 0x85, 0x00, 0xA9, 0x00, 0x85, 0x04, 0x20, 0xFF, 0x8D, 0xC9, 0x00,
            0xD0, 0x02, 0xE6, 0x04, 0xA5, 0x3D, 0x4A, 0x90, 0x09, 0xA5, 0x00, 0x09,
            0x10, 0x85, 0x00, 0x4C, 0x15, 0xDA, 0x4C, 0x20, 0xDA, 0xEA, 0xEA, 0xEA,
        ];
        Romfix.fixCodeInsert(
            romData,
            fixedBankRomAddr(animationMapFilterCpuAddr),
            animationMapFilterCode
        );

        const animationMapFilterTailCode = [
            0x20, 0xFF, 0x8D, 0xC9, 0x00, 0xD0, 0x04, 0xE6, 0x04, 0xE6, 0x04, 0xA5,
            0x04, 0xF0, 0x02, 0x38, 0x60, 0x18, 0x60, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA,
            0xEA,
        ];
        Romfix.fixCodeInsert(
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
    static fixWideScreenEnemy9Background(romData, isExpanded = false){
        const enemy9WorldXHookRomAddr = 0x3D20; // CPU $BD10 in bank 0
        const enemy9WorldXHelperCpuAddr = 0xFFC0;
        const fixedBankShift = isExpanded ? 0x4000 * 6 : 0;
        const enemy9WorldXHelperRomAddr =
            0x4010 + (enemy9WorldXHelperCpuAddr - 0xC000) + fixedBankShift;

        // Replace the original 11-byte local-X conversion with JSR + padding.
        Romfix.fixCodeInsert(romData, enemy9WorldXHookRomAddr, [
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
        Romfix.fixCodeInsert(
            romData,
            enemy9WorldXHelperRomAddr,
            enemy9WorldXCode
        );
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

        Romfix.fixCodeInsert(romData, bank0RomAddr(0xAC37), [
            0x4C, 0x40, 0xAC,       // JMP $AC40 (keep ordinary enemy type)
            0xEA,                   // padding
        ]);
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
    static fixWideScreenRockPushBug(romData, isExpanded = false){
        const normalizeRockXCpuAddr = 0xD9EC;
        let normalizeRockXRomAddr = 0x59FC;
        if(isExpanded){
            normalizeRockXRomAddr += 0x4000 * 6;
        }

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
        Romfix.fixCodeInsert(romData, normalizeRockXRomAddr, normalizeRockXCode);

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
        Romfix.fixCodeInsert(romData, updateRockSpriteRomAddr, updateRockSpriteCode);

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
        Romfix.fixCodeInsert(romData, 0x1E47, updateRockSpriteCallerCode);

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
        Romfix.fixCodeInsert(romData, 0x1E7C, leftDestinationCheckCode);

        // Normalize the source tile after the map lookup has wrapped $00.
        // CPU $9E82 handles left pushes; CPU $9EB1 handles right pushes.
        const normalizeRockSourceCode = [
            0xA5, 0x00,             // LDA $00
            0x20, normalizeRockXLowByte, normalizeRockXHighByte,
            0x85, 0x00,             // STA $00
            0xEA, 0xEA, 0xEA,       // NOP padding
        ];
        Romfix.fixCodeInsert(romData, 0x1E92, normalizeRockSourceCode);
        Romfix.fixCodeInsert(romData, 0x1EC1, normalizeRockSourceCode);
    }

    /**
     * Show the number of unreleased Moai as a two-digit HUD value.
     *
     * The original game already maintains the exact live count in $43:
     * initialization counts map tile $0F and rescuing one decrements it. Its
     * two-digit item renderer also has an unused layout mode. Move that mode's
     * coordinates four character cells right to $E0/$E8.
     *
     * The original $96F5-$9704 table is equivalent to:
     *
     *     y < 11 ? 0 : y + $76
     *
     * Replace its lookup with that exact calculation, then reuse the freed
     * sixteen bytes for the second half of the icon renderer. Its seven-byte
     * entry fits in verified fixed-bank padding at $FF79-$FF7F. This preserves
     * both movement lookup results instead of overwriting them as the previous
     * $96EB helper did.
     */
    static configureLevelTimer(romData, enabled = true){
        const bank0RomAddr = (cpuAddr) => 0x10 + (cpuAddr - 0x8000);
        const timerRenderCall = enabled
            ? [0x20, 0xA4, 0xB6]    // JSR $B6A4
            : [0xEA, 0xEA, 0xEA];   // hide timer HUD
        const timerUpdateCall = enabled
            ? [0x20, 0xF3, 0xB6]    // JSR $B6F3
            : [0xEA, 0xEA, 0xEA];   // stop countdown and timeout

        Romfix.fixCodeInsert(
            romData,
            bank0RomAddr(0x8918),
            timerRenderCall
        );
        Romfix.fixCodeInsert(
            romData,
            bank0RomAddr(0x8B75),
            timerUpdateCall
        );
    }

    /**
     * CPU $AC71: enemy 5's active flight calls the shared boundary checker
     * at $AC48, which removes it near either horizontal map edge. Enter the
     * existing vertical-only check at $AC5C instead. The following native
     * $AFB0 movement already wraps X by $3D (256/512 pixels), as for enemy 11.
     * Preserve the upper/lower limits, damage states and other enemies' calls
     * to the complete boundary checker. Bank 0 is shared by both ROM formats.
     */
    static fixBatHorizontalWrap(romData){
        Romfix.fixCodeInsert(romData, 0xAC72 - 0x8000 + 0x10, [0x5C]);
    }

    static addRemainingRescueCountHud(
        romData,
        isExpanded = false,
        useTimerPosition = false
    ){
        const bank0RomAddr = (cpuAddr) => 0x10 + (cpuAddr - 0x8000);
        const fixedBankShift = isExpanded ? 0x4000 * 6 : 0;
        const fixedBankRomAddr = (cpuAddr) =>
            0x4010 + (cpuAddr - 0xC000) + fixedBankShift;
        const hudIconRendererEntryCpuAddr = 0xFF79;
        const hudIconRendererBodyCpuAddr = 0x96F5;
        const timerPositionIconRendererCpuAddr = 0xB6A4;
        const remainingCountWrapperCpuAddr = 0xB760;
        const remainingCountTailCpuAddr = 0xFFE1;
        const remainingCountY = useTimerPosition ? 0x07 : 0x18;
        const remainingIconRendererCpuAddr = useTimerPosition
            ? timerPositionIconRendererCpuAddr
            : hudIconRendererEntryCpuAddr;
        const remainingDigitX = useTimerPosition
            ? [0xA8, 0xB0]
            : [0xE0, 0xE8];

        /**
         * CPU $96A3-$96AC: preserve the original $96F5,Y table exactly while
         * freeing its sixteen data bytes for executable code.
         *
         * CMP leaves carry set for Y >= 11, so ADC #$75 produces Y + $76.
         * Values below 11 take the original early-return path at $96E4.
         */
        Romfix.fixCodeInsert(romData, bank0RomAddr(0x96A3), [
            0xA5, 0xC2,             // LDA playerYLow
            0x29, 0x0F,             // AND #$0F
            0xC9, 0x0B,             // CMP #11
            0x90, 0x39,             // BCC $96E4
            0x69, 0x75,             // ADC #$75 => Y + $76
        ]);

        Romfix.fixCodeInsert(romData, bank0RomAddr(0x891B), [
            0x20,
            remainingCountWrapperCpuAddr & 0xFF,
            (remainingCountWrapperCpuAddr >> 8) & 0xFF,
        ]);

        /**
         * CPU $B758-$B76E: original item icon plus remaining-count wrapper.
         */
        Romfix.fixCodeInsert(romData, bank0RomAddr(0xB758), [
            0xA9, 0x07,             // originalIcon: LDA #$07
            0xA0, 0x01,             // LDY #itemPalette
            0x20,
            hudIconRendererEntryCpuAddr & 0xFF,
            (hudIconRendererEntryCpuAddr >> 8) & 0xFF,
            0x60,                   // RTS

            0x20, 0x2A, 0xB7,       // wrapper: JSR $B72A (original item HUD)
            0xA9, remainingCountY,  // LDA #remainingCountY
            0xA0, 0x00,             // LDY #playerPalette
            0x20,
            remainingIconRendererCpuAddr & 0xFF,
            (remainingIconRendererCpuAddr >> 8) & 0xFF,
            0x4C, 0xE1, 0xFF,       // JMP prepareRemainingCount
            0xEA, 0xEA,             // padding before $B76F
        ]);

        Romfix.fixCodeInsert(
            romData,
            fixedBankRomAddr(hudIconRendererEntryCpuAddr),
            [
                0x9D, 0x00, 0x02,       // STA OAM Y
                0x98,                   // TYA
                0x4C,
                hudIconRendererBodyCpuAddr & 0xFF,
                (hudIconRendererBodyCpuAddr >> 8) & 0xFF,
            ]
        );
        Romfix.fixCodeInsert(
            romData,
            bank0RomAddr(hudIconRendererBodyCpuAddr),
            [
                0x9D, 0x02, 0x02,       // STA OAM attributes/palette
                0xA9, 0xE8,             // LDA #round icon tile
                0x9D, 0x01, 0x02,       // STA OAM tile
                0xA9, 0xD0,             // LDA #item-area icon X
                0x9D, 0x03, 0x02,       // STA OAM X
                0x4C, 0x9B, 0xB7,       // JMP $B79B (consume OAM slot)
            ]
        );

        if(useTimerPosition){
            /**
             * With the timer disabled, its renderer at $B6A4 is unreachable.
             * Reuse its first 20 bytes for a dedicated X=$98 icon renderer so
             * the original item icon can remain at X=$D0.
             */
            Romfix.fixCodeInsert(
                romData,
                bank0RomAddr(timerPositionIconRendererCpuAddr),
                [
                    0x9D, 0x00, 0x02,       // STA OAM Y
                    0xA9, 0xE8,             // LDA #round icon tile
                    0x9D, 0x01, 0x02,       // STA OAM tile
                    0x98,                   // TYA
                    0x9D, 0x02, 0x02,       // STA OAM attributes/palette
                    0xA9, 0x98,             // LDA #timer-area icon X
                    0x9D, 0x03, 0x02,       // STA OAM X
                    0x4C, 0x9B, 0xB7,       // JMP $B79B
                ]
            );
        }

        Romfix.fixCodeInsert(
            romData,
            fixedBankRomAddr(remainingCountTailCpuAddr),
            [
                0xA9, 0x03,             // LDA #$03 (aligned $E0/$E8 layout)
                0x85, 0x10,             // STA HUD number layout
                0xA5, 0x43,             // LDA remaining rescue count
                0xC9, 0x64,             // CMP #100
                0x90, 0x02,             // BCC draw
                0xA9, 0x63,             // LDA #99 (display saturation)
                0x4C, 0x33, 0xB7,       // JMP $B733 (shared 2-digit renderer)
            ]
        );

        Romfix.fixCodeInsert(romData, fixedBankRomAddr(0xC3CD), [
            ...remainingDigitX,
        ]);

        Romfix.fixCodeInsert(
            romData,
            bank0RomAddr(0xB793),
            [remainingCountY]
        );
    }

    /**
     * Restore the original title/password UI and all addViewModes() hooks.
     * These bytes live in bank 0 or the fixed bank, never in level storage.
     * Shared camera/projection hooks are restored by the existing reset below;
     * the rock, scene, timer and NPC patches rebuild their own shared helpers.
     * Restoring the retired password bodies also makes legacy camera ROMs
     * safe to export with the option off, without needing an original ROM.
     */
    static resetViewModesPatch(romData, isExpanded = false){
        const fixedShift = isExpanded ? 6 * 0x4000 : 0;
        const originalBytes = [
            [0x80C5, '20B286'],
            [0x81D0, 'A98CBC2582'],
            [0x8225, '348C'],
            [0x8247, 'A900851FA619D02320E782A001A521D007C8A5FAC924D00D841920B983A02220' +
                '26D64C20CA20DB824C8582CAD0034C1FC44CCFC3'],
            [0x86BB, 'FF861287'],
            [0x86FF, '22281D1E0B1C1EFE'],
            [0x8712, '22330D19181E13181F0FFE'],
            [0x886C, 'E006B035'],
            [0x8A3A, '202EDA'],
            [0x8B0F, '20F9BC'],
            [0x8B8E, 'A51EC950B0032020CA'],
            [0x8ECE, '6500AA'],
            [0x90B0, '998006'],
            [0xA507, 'A51EC920'],
            [0xA868, 'A51EC920'],
            [0xB867, '20A5B7'],
            [0xBBEA, '998006'],
            [0xBD39, 'CA10BF60'],
            [0xC3CF, 'A550200D83DAC3E1C311C4A90185524C57C4A903205D86A200A552C90A9005E9' +
                '0AE8D0F7A41E20DAC4888A20DAC4A039A2012096C4A9FF20C8C4A90020C8C44C' +
                '51C4A5524820E7826820DD824C858260A550200D832AC432C45AC4A907205D86' +
                '4C57C420E1C4A006206FC4A0102094C4A9FB20C8C4A5F42920F007A900851985' +
                '1860A5F42910F002E650602078C5B00DA91220DA80A0008451C88450604C13C4' +
                '840088A5F42903F01B48A90520DA80684AA900B002A9FF65513006C5009003A0' +
                '0098855160A2008601CA8602840088A651A5F4290CF02148A90520DA80684A4A' +
                '4AA9019002A9FE7552300AC502F006C5009003A40198955260'],
            [0xC578, 'A9028508A9008509A904850AA608A9009500A409B9DCC5290348B9DCC54A4AAA' +
                '68A8B5524A8810FCA6083600E609C60AD0E0C60810D2A500C501D026C502D022' +
                'A9008508A205B5524A290318650829038508CA10F1A508D009A5000A0A186901' +
                '386018600004080C0B0F131714100307'],
        ];
        for(const [cpu, hex] of originalBytes){
            const address = cpu - 0x8000 + 0x10 + (cpu >= 0xC000 ? fixedShift : 0);
            const bytes = hex.match(/../g).map(byte => parseInt(byte, 16));
            Romfix.fixCodeInsert(romData, address, bytes);
        }
    }

    /**
     * Restore every bank-0 byte owned by fixWideScreenLoopingCamera().
     *
     * This runs before shared looping-camera support so reload/export remains
     * deterministic. addViewModes() subsequently applies its runtime input,
     * background, and camera hooks; it requires the shared support below.
     *
     * fixWideScreenRockPushBug() runs immediately before this method and
     * restores its own $D9F8-$DA14 moving-rock helper.
     */
    static resetWideScreenLoopingCameraPatch(romData, isExpanded = false){
        const bank0RomAddr = (cpuAddr) => 0x10 + (cpuAddr - 0x8000);
        const fixedBankShift = isExpanded ? 0x4000 * 6 : 0;
        const fixedBankRomAddr = (cpuAddr) =>
            0x4010 + (cpuAddr - 0xC000) + fixedBankShift;
        const restore = (cpuAddr, bytes) =>
            Romfix.fixCodeInsert(romData, bank0RomAddr(cpuAddr), bytes);

        // Restore the original stage-title setup.
        restore(0x8A60, [0xA9, 0x00, 0x85, 0x2F]);

        // Restore the main-title initializer and the ending-state jump target.
        restore(0x838E, [0x20, 0x2E, 0xDA]);
        restore(0x8A35, [0xE8, 0xC5]);
        restore(0x8C10, [0x20, 0xB9, 0x83]);
        restore(0x8C7E, [0x20, 0xB9, 0x83]);

        // Restore the original pause early-return test.
        restore(0x8B4F, [0xA5, 0x32, 0xF0]);

        // Restore the unused fixed-bank padding used by pause free-look.
        Romfix.fixCodeInsert(
            romData,
            fixedBankRomAddr(0xFED9),
            new Array(0xA7).fill(0xFF)
        );

        /**
         * Restore the retired animation-filter bytes beneath the optional
         * stage-camera reset wrapper at $FFD0-$FFE0. They are unreachable, but
         * restoring them keeps exports deterministic when the camera feature
         * is disabled on an already-patched Mapper 2 ROM.
         */
        Romfix.fixCodeInsert(romData, fixedBankRomAddr(0xFFD0), [
            0x00, 0x85, 0x04, 0x20, 0xFF, 0x8D, 0xC9, 0x00,
            0xD0, 0x02, 0xE6, 0x04, 0xA5, 0x3D, 0x4A, 0x90, 0x09,
        ]);

        restore(0x9B38, [
            0xA5, 0x3D, 0xF0, 0x0A, 0xA5, 0xC1, 0xD0, 0x0B, 0xA5, 0xC2, 0xC9, 0x81,
            0xB0, 0x10, 0xA9, 0x00, 0x4C, 0x5B, 0x9B, 0xA5, 0xC2, 0xC9, 0x7F, 0x90,
            0x05, 0xA9, 0xFF, 0x4C, 0x5B, 0x9B, 0x38, 0xA5, 0xC2, 0xE9, 0x80, 0x85,
            0xFD, 0xA9, 0x00, 0x85, 0x9D, 0x60,
        ]);
        restore(0x9B62, [
            0xA5, 0x3D, 0xF0, 0x2E, 0xA5, 0xC5, 0x10, 0x10, 0xA5, 0xFD, 0xC9, 0x02,
            0x90, 0x24, 0xAD, 0x3C, 0x04, 0xC9, 0x68, 0xB0, 0x1D, 0x4C, 0x87, 0x9B,
            0xA5, 0xFD, 0xC9, 0xFE, 0xB0, 0x14, 0xAD, 0x3C, 0x04, 0xC9, 0x99, 0x90,
            0x0D, 0x18, 0xA5, 0xC6, 0x65, 0x9D, 0x85, 0x9D, 0xA5, 0xC5, 0x65, 0xFD,
            0x85, 0xFD,
        ]);
        restore(0x943C, [
            0xA5, 0xD3, 0xF0, 0x06, 0xC6, 0xD3, 0x29, 0x04, 0xD0, 0x0E, 0x38, 0xA5,
            0xC2, 0xE5, 0xFD, 0x8D, 0x3C, 0x04, 0xA5, 0xC1, 0xE9, 0x00, 0xF0, 0x05,
            0xA9, 0x00, 0x8D, 0x00, 0x04, 0x60, 0xA5, 0x3D, 0x4A, 0xA5, 0xC1, 0x29,
            0x01, 0xB0, 0x02, 0xA9, 0x00, 0x85, 0xC1, 0x60,
        ]);
        restore(0xA15B, [
            0xA5, 0x8D, 0xE5, 0xFD, 0x8D, 0x59, 0x04, 0xA5, 0x8C, 0xE9, 0x00, 0xF0,
            0x06, 0xA9, 0x00, 0x8D, 0x1D, 0x04, 0x60, 0xA9, 0x16, 0x8D, 0x1D, 0x04,
            0x60,
        ]);
        restore(0xA2A3, [
            0x38, 0xBD, 0x90, 0x04, 0xE5, 0xFD, 0x9D, 0x3D, 0x04, 0xBD, 0x84, 0x04,
            0xE9, 0x00, 0xD0, 0x08, 0xAD, 0x90, 0xC3, 0x9D, 0x01, 0x04, 0x18, 0x60,
            0xA9, 0x00, 0x9D, 0x01, 0x04, 0x38, 0x60,
        ]);
        restore(0xA405, [0xA5, 0x01, 0xE9, 0x00, 0xF0, 0x05]);
        restore(0xA442, [0xA5, 0x01, 0xE9, 0x00, 0xF0, 0x05]);
        restore(0xA44E, [
            0x38, 0xBD, 0xB0, 0x04, 0xE5, 0xFD, 0x9D, 0x49, 0x04, 0xBD, 0xAC, 0x04,
            0xE9, 0x00, 0xD0, 0x0F, 0xBC, 0xB8, 0x04, 0xB9, 0x77, 0xC3, 0x9D, 0x0D,
            0x04, 0x60, 0xA9, 0x00, 0x9D, 0xA8, 0x04, 0xA9, 0x00, 0x9D, 0x0D, 0x04,
            0x60,
        ]);
        restore(0xA780, [
            0x38, 0xBD, 0xF8, 0x04, 0xE5, 0xFD, 0x9D, 0x4E, 0x04, 0xBD, 0xB4, 0xC3,
            0x9D, 0x12, 0x04, 0xBD, 0xB7, 0xC3, 0x9D, 0x6C, 0x04, 0x60,
        ]);
        restore(0xAE54, [
            0x38, 0xBD, 0x16, 0x05, 0xE5, 0xFD, 0x9D, 0x51, 0x04, 0xBD, 0x0E, 0x05,
            0xE9, 0x00, 0xF0, 0x05, 0xA9, 0x00, 0x9D, 0x15, 0x04, 0x60,
        ]);

        // Restore the five original calls/jump to the player-X normalizer.
        for(const callerCpuAddr of [0x941D, 0x9857, 0x986D, 0x98AE, 0x9991]){
            restore(callerCpuAddr + 1, [0x5A, 0x94]);
        }
    }

    /**
     * Turn a 32-column level into a seamless 512-pixel horizontal ring.
     *
     * The background already occupies the two physical horizontal nametables,
     * and the player/enemy world coordinates already wrap at 0/$1FF. The
     * missing piece is a ninth camera bit. In wide mode this patch computes:
     *
     *     cameraX = (playerWorldX - $80) & $1FF
     *
     * $FD remains the low camera byte. The otherwise-unused $9D becomes its
     * page bit and is copied to PPUCTRL/$FF bit 0. Single-screen levels keep
     * camera $000 and retain their original 256-pixel wrapping behavior.
     *
     * Sprite visibility uses the low bit of the complete high-byte subtraction:
     *
     *     ((objectWorldX - cameraX) >> 8) & 1
     *
     * Zero is inside the current 256-pixel viewport. This parity test is
     * required at the $1FF/$000 seam, where a normal 16-bit subtraction can
     * produce $FE even though the object is visibly just to the right.
     * addViewModes() subsequently selects the camera and visibility mask from
     * the title choice and map width.
     */
    static fixWideScreenLoopingCamera(romData, isExpanded = false){
        const bank0RomAddr = (cpuAddr) => 0x10 + (cpuAddr - 0x8000);
        const fixedBankShift = isExpanded ? 0x4000 * 6 : 0;
        const fixedBankRomAddr = (cpuAddr) =>
            0x4010 + (cpuAddr - 0xC000) + fixedBankShift;
        const patchBank0 = (cpuAddr, bytes) =>
            Romfix.fixCodeInsert(romData, bank0RomAddr(cpuAddr), bytes);

        const resetCameraCpuAddr = 0xFF60;
        const mainTitleResetCpuAddr = 0xFF6D;
        const endingResetCpuAddr = 0xFF73;
        // Expansion loaders end at $F0D1; the bank-safe NMI starts at $F0E2.
        // $FF79-$FF7F belongs to the rescue HUD and must remain untouched.
        const gameOverResetCpuAddr = 0xF0D2;

        /**
         * CPU $FF60-$FF78: shared non-gameplay camera reset and two wrappers.
         *
         * The original global RAM clear reaches $9D but stops before $FD/$FF.
         * Consequently, interrupting an attract-mode demo can enter the main
         * title with PPUCTRL still selecting nametable $24. The ending state
         * has the same problem when the last wide level finishes on page 1.
         *
         * Keep the camera-only helper independent from $2F: the stage-title
         * wrapper owns that original graphics-bank write, while the ending
         * must preserve its own $2F value.
         */
        Romfix.fixCodeInsert(romData, fixedBankRomAddr(resetCameraCpuAddr), [
            0xA9, 0x00,             // resetCamera: LDA #$00
            0x85, 0xFD,             // STA cameraXLow
            0x85, 0x9D,             // STA cameraXHigh
            0xA5, 0xFF,             // LDA PPUCTRL shadow
            0x29, 0xFE,             // AND #$FE
            0x85, 0xFF,             // STA PPUCTRL shadow
            0x60,                   // RTS

            0x20, 0x60, 0xFF,       // mainTitleReset: JSR resetCamera
            0x4C, 0x2E, 0xDA,       // JMP original main-title initializer

            0x20, 0x60, 0xFF,       // endingReset: JSR resetCamera
            0x4C, 0xE8, 0xC5,       // JMP original ending-state handler
        ]);

        Romfix.fixCodeInsert(romData, fixedBankRomAddr(gameOverResetCpuAddr), [
            0x20, 0x60, 0xFF,       // JSR resetCamera
            0x4C, 0xB9, 0x83,       // JMP original game-over setup
        ]);

        // $8C10 is death substate 3: clear the stage before consuming a life
        // and eventually drawing CONTINUE/PASSWORD. $8C7E is the later password
        // display, not the menu entry. Reset BEFORE either native screen setup,
        // regardless of whether runtime UP switching is enabled.
        for(const cpu of [0x8C10, 0x8C7E]){
            patchBank0(cpu, [0x20, gameOverResetCpuAddr & 0xFF, gameOverResetCpuAddr >> 8]);
        }

        // Main title: reset before its first background/graphics setup call.
        patchBank0(0x838E, [
            0x20,
            mainTitleResetCpuAddr & 0xFF,
            (mainTitleResetCpuAddr >> 8) & 0xFF,
        ]);

        // Main state $0F: keep page 0 selected throughout the ending sequence.
        patchBank0(0x8A35, [
            endingResetCpuAddr & 0xFF,
            (endingResetCpuAddr >> 8) & 0xFF,
        ]);

        /**
         * A retry can enter the stage-title screen while the previous life
         * still has camera page 1 selected. The title is written only to
         * nametable $20, so reset both camera bytes and PPUCTRL's page bit at
         * the title's common main-state/substate-0 entry.
         *
         * The wrapper also performs the original `LDA #$00 / STA $2F` setup
         * replaced by its JSR. It returns to $8A64, immediately before the
         * title's original drawing code.
         */
        patchBank0(0x8A60, [0x20, 0xD0, 0xFF, 0xEA]);
        Romfix.fixCodeInsert(romData, fixedBankRomAddr(0xFFD0), [
            0xA9, 0x00,             // LDA #$00
            0x85, 0x2F,             // STA original title-state field
            0x20, 0x60, 0xFF,       // JSR resetCamera
            0xA9, 0x00,             // restore original accumulator result
            0x60,                   // RTS
            0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA,
        ]);

        /**
         * CPU $8B4F and $FED9-$FF5F: paused wide-map free-look.
         *
         * The original active-game loop returns at $8B53 whenever $32 is
         * nonzero. Tail-jump through the helper instead:
         *
         * - a paused wide-map frame with Left/Right held changes the existing
         *   9-bit camera by four pixels modulo $200;
         * - metasprite slots $0401-$041D are cleared, leaving only player slot
         *   $0400, whose X and visibility are projected against the free camera;
         * - $6E is cleared so the OAM builder omits its extra HUD sprites;
         * - calling $88D3 immediately rebuilds OAM before the next NMI applies
         *   the new scroll, preventing one frame of stale non-player sprites;
         * - a paused frame without a direction preserves the selected view;
         * - resuming restores $6E and uses one sprite-hidden transition frame
         *   while normal gameplay rebuilds every metasprite and recenters.
         */
        patchBank0(0x8B4F, [0x4C, 0xD9, 0xFE]);
        Romfix.fixCodeInsert(romData, fixedBankRomAddr(0xFED9), [
            0xA5, 0x32,             // LDA pauseFlag
            0xD0, 0x1A,             // BNE paused
            0xA5, 0x6E,             // unpaused: LDA extraSpriteEnable
            0xD0, 0x0D,             // BNE normalFrame
            0xA9, 0x01,             // first frame after free-look
            0x85, 0x6E,             // restore extra Sprite groups
            0xA5, 0xFE,             // LDA PPUMASK shadow
            0x29, 0xEF,             // keep Sprites hidden for one rebuild frame
            0x85, 0xFE,             // STA PPUMASK shadow
            0x4C, 0x54, 0x8B,       // JMP original active update
            0xA5, 0xFE,             // normalFrame: LDA PPUMASK shadow
            0x09, 0x10,             // ORA #showSprites
            0x85, 0xFE,             // STA PPUMASK shadow
            0x4C, 0x54, 0x8B,       // JMP original active update

            0xA5, 0x3D,             // paused: LDA levelMode
            0x4A,                   // LSR A (carry = wide flag)
            0x90, 0x63,             // BCC done
            0xA5, 0xF6,             // LDA held controller buttons
            0x29, 0x03,             // AND #(Left | Right)
            0xF0, 0x5D,             // BEQ done
            0xC9, 0x03,             // CMP #(Left | Right)
            0xF0, 0x59,             // BEQ done
            0x4A,                   // LSR A (carry set = Right)
            0xB0, 0x12,             // BCS moveRight

            0x38,                   // moveLeft: SEC
            0xA5, 0xFD,             // LDA cameraXLow
            0xE9, 0x04,             // SBC #$04
            0x85, 0xFD,             // STA cameraXLow
            0xA5, 0x9D,             // LDA cameraXHigh
            0xE9, 0x00,             // SBC #$00
            0x29, 0x01,             // AND #$01
            0x85, 0x9D,             // STA cameraXHigh
            0x4C, 0x2A, 0xFF,       // JMP updatePpuPage

            0x18,                   // moveRight: CLC
            0xA5, 0xFD,             // LDA cameraXLow
            0x69, 0x04,             // ADC #$04
            0x85, 0xFD,             // STA cameraXLow
            0xA5, 0x9D,             // LDA cameraXHigh
            0x69, 0x00,             // ADC #$00
            0x29, 0x01,             // AND #$01
            0x85, 0x9D,             // STA cameraXHigh

            0xA5, 0xFF,             // updatePpuPage: LDA PPUCTRL shadow
            0x29, 0xFE,             // AND #$FE
            0x05, 0x9D,             // ORA cameraXHigh
            0x85, 0xFF,             // STA PPUCTRL shadow

            0xA9, 0x00,             // LDA #$00
            0x85, 0x6E,             // suppress extra OAM Sprite groups
            0xA2, 0x1D,             // LDX #last non-player metasprite slot
            0x9D, 0x00, 0x04,       // clearSlots: STA metaspriteId,X
            0xCA,                   // DEX
            0xD0, 0xFA,             // BNE clearSlots (preserve slot 0)

            0x38,                   // SEC
            0xA5, 0xC2,             // LDA playerXLow
            0xE5, 0xFD,             // SBC cameraXLow
            0x8D, 0x3C, 0x04,       // STA playerScreenX
            0xA5, 0xC1,             // LDA playerXHigh
            0xE5, 0x9D,             // SBC cameraXHigh
            0x29, 0x01,             // AND #$01
            0xD0, 0x08,             // BNE hidePlayer
            0xA9, 0x02,             // fixed standing-player metasprite
            0x8D, 0x00, 0x04,       // STA playerMetasprite
            0x4C, 0x5B, 0xFF,       // JMP rebuildOam
            0xA9, 0x00,             // hidePlayer: LDA #$00
            0x8D, 0x00, 0x04,       // STA playerMetasprite
            0x20, 0xD3, 0x88,       // rebuildOam: JSR OAM builder
            0x60,                   // RTS
            0x60,                   // done: RTS
        ]);

        /**
         * CPU $9B38-$9B61: centered 9-bit camera.
         *
         * Stage states 0-2 include the title/loading interval and always use
         * nametable $20. State 3 is live gameplay and may use the centered
         * wide-map camera. Updating $FF here is enough because the NMI already
         * writes it to $2000 after writing $FD to horizontal PPUSCROLL.
         */
        patchBank0(0x9B38, [
            0xA5, 0x56,             // LDA stageState
            0xC9, 0x03,             // CMP #liveGameplay
            0xD0, 0x15,             // BNE resetCamera
            0xA5, 0x3D,             // LDA levelMode
            0x4A,                   // LSR A (carry = wide flag)
            0x90, 0x10,             // BCC resetCamera
            0xA5, 0xC2,             // wide: LDA playerXLow (carry is already set)
            0xE9, 0x80,             // SBC #$80
            0x85, 0xFD,             // STA cameraXLow
            0xA5, 0xC1,             // LDA playerXHigh
            0xE9, 0x00,             // SBC #$00
            0x29, 0x01,             // AND #$01
            0x85, 0x9D,             // STA cameraXHigh
            0x10, 0x06,             // BPL updatePpuPage (always)
            0xA9, 0x00,             // resetCamera: LDA #$00
            0x85, 0xFD,             // STA cameraXLow
            0x85, 0x9D,             // STA cameraXHigh
            0xA5, 0xFF,             // updatePpuPage: LDA PPUCTRL shadow
            0x29, 0xFE,             // AND #$FE
            0x05, 0x9D,             // ORA cameraXHigh
            0x85, 0xFF,             // STA PPUCTRL shadow
            0x60,                   // RTS
        ]);

        /**
         * CPU $9B62-$9B93 was an unreferenced alternate camera routine.
         * No JSR/JMP/table pointer in the original ROM targets it.
         *
         * $9B62: high-byte parity helper for a world high byte in scratch $01.
         * $9B64: shared high-byte parity helper for a world high byte in A.
         * $9B69: project the three temporary falling/special objects.
         * $9B78: project a normal enemy.
         * $9B87: hide a temporary object's metasprite.
         * $9B8D: normalize the player's 9-bit world X using level mode.
         */
        patchBank0(0x9B62, [
            0xA5, 0x01,             // scratchHigh: LDA $01
            0xE5, 0x9D,             // finishHigh: SBC cameraXHigh
            0x29, 0x01,             // AND #$01
            0x60,                   // RTS

            0x38,                   // projectTemporary: SEC
            0xBD, 0xF8, 0x04,       // LDA temporaryXLow,X
            0xE5, 0xFD,             // SBC cameraXLow
            0x9D, 0x4E, 0x04,       // STA temporaryScreenX,X
            0xBD, 0xF5, 0x04,       // LDA temporaryXHigh,X
            0x4C, 0x64, 0x9B,       // JMP finishHigh

            0x38,                   // projectEnemy: SEC
            0xBD, 0x16, 0x05,       // LDA enemyXLow,X
            0xE5, 0xFD,             // SBC cameraXLow
            0x9D, 0x51, 0x04,       // STA enemyScreenX,X
            0xBD, 0x0E, 0x05,       // LDA enemyXHigh,X
            0x4C, 0x64, 0x9B,       // JMP finishHigh

            0xA9, 0x00,             // hideTemporary: LDA #$00
            0x9D, 0x12, 0x04,       // STA temporaryMetasprite,X
            0x60,                   // RTS

            0xA5, 0xC1,             // normalizePlayerX: LDA playerXHigh
            0x25, 0x3D,             // AND levelMode (valid values are 0/1)
            0x85, 0xC1,             // STA playerXHigh
            0x60,                   // RTS
        ]);

        // CPU $943C: player projection and damage-blink visibility.
        patchBank0(0x943C, [
            0xA5, 0xD3,             // LDA blinkTimer
            0xF0, 0x06,             // BEQ project
            0xC6, 0xD3,             // DEC blinkTimer
            0x29, 0x04,             // AND #$04
            0xD0, 0x0F,             // BNE hide
            0x38,                   // project: SEC
            0xA5, 0xC2,             // LDA playerXLow
            0xE5, 0xFD,             // SBC cameraXLow
            0x8D, 0x3C, 0x04,       // STA playerScreenX
            0xA5, 0xC1,             // LDA playerXHigh
            0x20, 0x64, 0x9B,       // JSR finishHigh
            0xF0, 0x05,             // BEQ done
            0xA9, 0x00,             // hide: LDA #$00
            0x8D, 0x00, 0x04,       // STA playerMetasprite
            0x60,                   // done: RTS
            0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA,
            0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA,
        ]);

        // Redirect every original $945A player-X normalizer call/jump.
        for(const callerCpuAddr of [0x941D, 0x9857, 0x986D, 0x98AE, 0x9991]){
            patchBank0(callerCpuAddr + 1, [0x8D, 0x9B]);
        }

        // CPU $A15B: door/spring-like singleton projection.
        patchBank0(0xA15B, [
            0xA5, 0x8D, 0xE5, 0xFD, 0x8D, 0x59, 0x04,
            0xA5, 0x8C, 0xE5, 0x9D, 0x29, 0x01,
            0xD0, 0x04, 0xA9, 0x16, 0xD0, 0x02, 0xA9, 0x00,
            0x8D, 0x1D, 0x04, 0x60,
        ]);

        // CPU $A2A3: object projection; preserve carry as its return status.
        patchBank0(0xA2A3, [
            0x38, 0xBD, 0x90, 0x04, 0xE5, 0xFD, 0x9D, 0x3D, 0x04,
            0xBD, 0x84, 0x04, 0xE5, 0x9D, 0x29, 0x01, 0xD0, 0x06,
            0xAD, 0x90, 0xC3, 0x18, 0x90, 0x03,
            0xA9, 0x00, 0x38, 0x9D, 0x01, 0x04, 0x60,
        ]);

        // CPU $A405/$A442: two sub-sprites use the high byte in scratch $01.
        patchBank0(0xA405, [0x20, 0x62, 0x9B, 0xF0, 0x06, 0xEA]);
        patchBank0(0xA442, [0x20, 0x62, 0x9B, 0xF0, 0x06, 0xEA]);

        // CPU $A44E: paired/special object projection.
        patchBank0(0xA44E, [
            0x38, 0xBD, 0xB0, 0x04, 0xE5, 0xFD, 0x9D, 0x49, 0x04,
            0xBD, 0xAC, 0x04, 0xE5, 0x9D, 0x29, 0x01, 0xD0, 0x0A,
            0xBC, 0xB8, 0x04, 0xB9, 0x77, 0xC3, 0x9D, 0x0D, 0x04, 0x60,
            0xA9, 0x00, 0x9D, 0x0D, 0x04, 0x60, 0xEA, 0xEA, 0xEA,
        ]);

        // CPU $A780: temporary/falling objects previously ignored X high.
        patchBank0(0xA780, [
            0x20, 0x69, 0x9B,       // JSR projectTemporary
            0xD0, 0x0D,             // BNE hide
            0xBD, 0xB4, 0xC3,
            0x9D, 0x12, 0x04,
            0xBD, 0xB7, 0xC3,
            0x9D, 0x6C, 0x04,
            0x60,
            0x4C, 0x87, 0x9B,       // hide: JMP hideTemporary
            0xEA,
        ]);

        // CPU $AE54: normal-enemy projection.
        patchBank0(0xAE54, [
            0x20, 0x78, 0x9B,       // JSR projectEnemy
            0xF0, 0x05,             // BEQ done
            0xA9, 0x00,
            0x9D, 0x15, 0x04,
            0x60,                   // done: RTS
            0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA,
            0xEA, 0xEA, 0xEA, 0xEA, 0xEA,
        ]);

        /**
         * Replace the moving-rock projection installed by
         * fixWideScreenRockPushBug(). Single-screen rock high bytes are already
         * normalized to zero, so this unified parity test preserves their
         * original opposite-edge wrapping.
         */
        patchBank0(0x9E3D, [0x20, 0xF8, 0xD9]);
        Romfix.fixCodeInsert(romData, fixedBankRomAddr(0xD9F8), [
            0x38, 0xA5, 0xDE, 0xE5, 0xFD, 0x8D, 0x4E, 0x04,
            0xA5, 0xDD, 0xE5, 0x9D, 0x29, 0x01, 0xF0, 0x05,
            0xA9, 0x00, 0x8D, 0x12, 0x04, 0x60,
            0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA,
        ]);
    }

    /**
     * Newly pressed UP toggles fixed/bounded and centered looping views.
     * $2A holds the runtime choice and transition flag, independent of the
     * native title/password selection in $21. Helpers live in fixed bank 7,
     * CPU $F100-$F40F, cleared after level storage is relocated to bank 4.
     * The original password code, title strings and ending remain intact.
     */
    static addViewModes(romData, isExpanded = false){
        if(!isExpanded) throw new Error('Runtime view switching requires an expanded ROM');
        const fixedShift = isExpanded ? 6 * 0x4000 : 0;
        const fileAddress = (cpu) => cpu - 0x8000 + 0x10 +
            (cpu >= 0xC000 ? fixedShift : 0);
        const patch = (cpu, bytes) =>
            Romfix.fixCodeInsert(romData, fileAddress(cpu), bytes);
        // getROMData() clears relocated native level storage before any code
        // insertion. Fail visibly if a future patch starts using our reservation.
        if(romData.subarray(fileAddress(0xF100),fileAddress(0xF410)).some(byte => byte !== 0))
            throw new Error('Reserved view-patch area in bank 7 is occupied');

        // Resolve local 6502 labels and enforce each reserved block boundary.
        const labels = new Map();
        const references = [];
        const blocks = [];
        let block;
        const org = (base, limit) => {
            if(base < 0xF100 || limit > 0xF410 || limit <= base ||
                (blocks.length && base < blocks[blocks.length - 1].limit))
                throw new Error('View-patch blocks overlap or exceed their reservation');
            block = { base, limit, bytes: [] };
            blocks.push(block);
        };
        const emit = (...bytes) => block.bytes.push(...bytes);
        const label = (name) => labels.set(name, block.base + block.bytes.length);
        const absolute = (opcode, target) => {
            emit(opcode);
            references.push({ block, offset: block.bytes.length, target });
            emit(0, 0);
        };
        const branch = (opcode, target) => {
            emit(opcode);
            references.push({ block, offset: block.bytes.length, target, relative: true });
            emit(0);
        };

        // Fixed bank 7: relocated level storage, cleared by getROMData().
        // $2A: bit 0 = loop, bit 6 = paused return, bit 7 = transition.
        // Native gameplay has no direct reference to this byte. Title entry
        // initializes it; death/next-stage camera resets preserve the choice.
        org(0xF100, 0xF300);
        label('camera');
        emit(0xA5, 0x56, 0xC9, 0x03); // LDA stageState; CMP #live
        branch(0xF0, 'liveCamera');
        absolute(0x4C, 'reset');
        label('liveCamera');
        emit(0xA5, 0x1F);             // Attract demos do not read player input.
        branch(0xD0, 'normalCamera');
        emit(0xA5, 0xF4, 0x29, 0x08); // Native newly-pressed UP, not held UP.
        branch(0xF0, 'selectCamera');
        emit(0xA5, 0x2A, 0x49, 0x01, 0x09, 0x80, 0x85, 0x2A);
        label('selectCamera');
        emit(0xA5, 0x2A, 0x29, 0x01);
        branch(0xD0, 'loopCamera');
        label('normalCamera');
        emit(0xA9, 0x00, 0x85, 0x00, 0x85, 0x01, 0xA5, 0x3D);
        branch(0xF0, 'targetReady');
        // Native wide camera: clamp playerX - 128 to 0..255.
        emit(0xA5, 0xC1);
        branch(0xD0, 'normalRightPage');
        emit(0xA5, 0xC2, 0xC9, 0x80);
        branch(0x90, 'targetReady');
        emit(0xE9, 0x80, 0x85, 0x00);
        absolute(0x4C, 'targetReady');
        label('normalRightPage');
        emit(0xA5, 0xC2, 0xC9, 0x7F);
        branch(0xB0, 'normalRightEdge');
        emit(0x38, 0xE9, 0x80, 0x85, 0x00);
        absolute(0x4C, 'targetReady');
        label('normalRightEdge');
        emit(0xA9, 0xFF, 0x85, 0x00);
        absolute(0x4C, 'targetReady');
        label('loopCamera');
        emit(0x38, 0xA5, 0xC2, 0xE9, 0x80, 0x85, 0x00,
             0xA5, 0xC1, 0xE9, 0x00, 0x25, 0x3D, 0x85, 0x01);
        label('targetReady');
        emit(0xA5, 0x2A);
        branch(0x10, 'assignTarget');
        // Shortest signed displacement on the 256/512-pixel ring.
        emit(0x38, 0xA5, 0x00, 0xE5, 0xFD, 0x85, 0x02,
             0xA5, 0x01, 0xE5, 0x9D, 0x25, 0x3D, 0x85, 0x03,
             0xA5, 0x3D);
        branch(0xD0, 'wideDirection');
        emit(0xA5, 0x02);
        branch(0x30, 'moveLeft');
        absolute(0x4C, 'moveRight');
        label('wideDirection');
        emit(0xA5, 0x03);
        branch(0xD0, 'moveLeft');
        label('moveRight');
        emit(0xA5, 0x02, 0xC9, 0x05);
        branch(0x90, 'assignTarget');
        emit(0x18, 0xA5, 0xFD, 0x69, 0x04, 0x85, 0xFD,
             0xA5, 0x9D, 0x69, 0x00, 0x25, 0x3D, 0x85, 0x9D);
        absolute(0x4C, 'page');
        label('moveLeft');
        emit(0xA5, 0x02, 0xC9, 0xFC);
        branch(0xB0, 'assignTarget');
        emit(0x38, 0xA5, 0xFD, 0xE9, 0x04, 0x85, 0xFD,
             0xA5, 0x9D, 0xE9, 0x00, 0x25, 0x3D, 0x85, 0x9D);
        absolute(0x4C, 'page');
        label('assignTarget');
        emit(0xA5, 0x00, 0x85, 0xFD, 0xA5, 0x01, 0x85, 0x9D,
             0xA5, 0x2A, 0x29, 0x41, 0x85, 0x2A);
        absolute(0x4C, 'page');
        label('reset');
        emit(0xA9, 0x00, 0x85, 0xFD, 0x85, 0x9D);
        label('page');
        emit(0xA5, 0xFF, 0x29, 0xFE, 0x05, 0x9D, 0x85, 0xFF, 0x60);

        label('pause');
        emit(0xA5, 0x2A, 0x29, 0x40);
        branch(0xD0, 'returnCamera');
        emit(0xA5, 0x3D);             // Wide free-look is available in either view.
        branch(0xD0, 'loopPause');
        emit(0xA5, 0x2A, 0x29, 0x01);
        branch(0xD0, 'loopPause');
        emit(0xA5, 0x32);
        branch(0xF0, 'active');
        emit(0x60);
        label('active');
        emit(0x4C, 0x54, 0x8B);
        label('loopPause');
        // Free-look sets $6E=0. A resume request enters a paused camera return
        // before any native player, enemy, falling-object or timer update.
        emit(0xA5, 0x32);
        branch(0xD0, 'dispatchFreeLook');
        emit(0xA5, 0x6E);
        branch(0xD0, 'dispatchFreeLook');
        emit(0xA5, 0x2A, 0x09, 0xC0, 0x85, 0x2A);
        label('returnCamera');
        emit(0xA5, 0x2A);
        branch(0x30, 'returnCameraTick');
        // Arrival was displayed while still paused on the preceding frame.
        // Restore the chosen view and let the existing helper rebuild sprites.
        emit(0x29, 0x01, 0x85, 0x2A, 0xA9, 0x00, 0x85, 0x32);
        label('dispatchFreeLook');
        emit(0x4C, 0xD9, 0xFE);
        label('returnCameraTick');
        emit(0xA9, 0x01, 0x85, 0x32);
        // Skip UP handling and free-look directions while returning. Only
        // camera/projection/OAM run; the complete native gameplay path waits.
        absolute(0x20, 'selectCamera');
        emit(0x4C, 0x32, 0xFF); // Existing paused player projection/OAM builder.

        // Attribute initialization bypasses map lookup: normalize the byte
        // column before indexing $0700 so the repeated page has matching
        // foreground palettes too. This applies to both single-screen views.
        label('attributeIndex');
        emit(0x65, 0x00, 0x48, 0xA5, 0x3D);
        branch(0xD0, 'wideAttribute');
        emit(0x68, 0x29, 0xF7, 0xAA, 0x60);
        label('wideAttribute');
        emit(0x68, 0xAA, 0x60);

        // Keep the two attribute-cache halves coherent after each mutation,
        // including multiple changes within the same frame. Preserve A/X/Y
        // and flags because $BBA5 and $903D have different callers.
        label('attributeStore');
        emit(0x99, 0x80, 0x06, 0x08, 0x48, 0xA5, 0x3D);
        branch(0xD0, 'attributeDone');
        emit(0x8A, 0x48, 0xBA); // Save X, then use X=SP for stack lookup.
        // Recover the original attribute value without allocating scratch RAM.
        emit(0x98, 0x49, 0x40, 0xA8, 0xBD, 0x02, 0x01,
             0x99, 0x80, 0x06, 0x98, 0x49, 0x40, 0xA8, 0x68, 0xAA);
        label('attributeDone');
        emit(0x68, 0x28, 0x60);

        label('titleReset');
        emit(0xA9, 0x00, 0x85, 0x2A, 0x20, 0x60, 0xFF, 0x4C, 0x2E, 0xDA);

        label('stageReset');
        // Stage text/loading must keep page 0; the first live frame then
        // approaches the selected view instead of assigning it immediately.
        emit(0x20, 0x60, 0xFF, 0xA5, 0x2A, 0x09, 0x80, 0x85, 0x2A, 0x60);

        // Prepare the opposite page AFTER the current frame's producers,
        // outside the next NMI's VRAM-transfer window. The original PPU
        // interpreter then consumes both pages without validation/replay work.
        label('queueScan');
        emit(0xC4, 0x01);
        branch(0xF0, 'queueDone');
        emit(0x98, 0x85, 0x03, 0xB9, 0x00, 0x03, 0xC9, 0x09);
        branch(0xB0, 'queueSkipReset'); // 9 is the last defined command code.
        emit(0xC9, 0x03);
        branch(0xF0, 'queueSkipFill');
        emit(0xC9, 0x06);
        branch(0x90, 'queueDone');
        absolute(0x20, 'queueNametableCommand');
        branch(0xB0, 'queueSkipCommand');
        // Y is the terminator index. Reserve the complete copied command AND
        // its final zero before writing anything; $03E0 begins palette RAM.
        emit(0x98, 0x38, 0xE5, 0x03, 0x85, 0x02,
             0x8A, 0x38, 0x65, 0x02);
        branch(0xB0, 'queueSkipCommand');
        emit(0xC9, 0xE0);
        branch(0xB0, 'queueSkipCommand');
        emit(0xA4, 0x03, 0xC8, 0xA9, 0x06, 0x9D, 0x00, 0x03, 0xE8);
        absolute(0x4C, 'queueMirrorAddress');
        label('queueSkipReset');
        emit(0xC8);
        absolute(0x4C, 'queueScan');
        label('queueSkipFill');
        emit(0x98, 0x69, 0x04, 0xA8); // Matching CMP #3 left carry set.
        absolute(0x4C, 'queueScan');
        label('queueDone');
        absolute(0x4C, 'queueCommit');
        label('queueSkipCommand');
        emit(0xC8);
        absolute(0x4C, 'queueScan');
        while(block.base + block.bytes.length < block.limit) emit(0xEA);

        org(0xF300, 0xF380);
        label('queueMirrorAddress');
        emit(0xB9, 0x00, 0x03, 0x49, 0x04, 0x9D, 0x00, 0x03, 0xE8, 0xC8,
             0xB9, 0x00, 0x03, 0x9D, 0x00, 0x03, 0xE8, 0xC8,
             0xB9, 0x00, 0x03, 0x85, 0x00, 0x9D, 0x00, 0x03, 0xE8, 0xC8);
        label('queueMirrorBytes');
        emit(0xB9, 0x00, 0x03, 0x9D, 0x00, 0x03, 0xE8, 0xC8, 0xC6, 0x00);
        branch(0xD0, 'queueMirrorBytes');
        emit(0xB9, 0x00, 0x03);
        branch(0x10, 'queueMirrorAddress');
        emit(0x9D, 0x00, 0x03, 0xE8, 0xC8);
        absolute(0x4C, 'queueScan');

        // Walk every counted segment once, including rejected commands. $00
        // records a non-6 command or an address outside $2000-$2FFF. Return
        // Y=end marker and carry set for rejection, so skipping needs no
        // second parser. Commands 7/8 and mixed palette packets remain intact.
        label('queueNametableCommand');
        emit(0xB9, 0x00, 0x03, 0x49, 0x06, 0x85, 0x00, 0xC8);
        label('queueCheckAddress');
        emit(0xB9, 0x00, 0x03, 0x29, 0xF0, 0xC9, 0x20);
        branch(0xF0, 'queueNextSegment');
        emit(0xE6, 0x00);
        label('queueNextSegment');
        emit(0xC8, 0xC8, 0x98, 0x38, 0x79, 0x00, 0x03, 0xA8,
             0xB9, 0x00, 0x03);
        branch(0x10, 'queueCheckAddress');
        emit(0xA5, 0x00, 0xC9, 0x01, 0x60);

        // State 13 opens and closes the exit using the same four-metatile
        // renderer as stage initialization. Produce that queue first, then
        // reuse the live palette quota: both door pages fit in vblank only
        // when the full palette is deferred to a non-drawing animation frame.
        label('doorAnimation');
        emit(0x20, 0xA5, 0xB7, 0x20, 0x6D, 0xB8);
        absolute(0x20, 'paletteQueueCheck');
        branch(0xB0, 'doorAnimationDone');
        emit(0x4C, 0x20, 0xCA);
        label('doorAnimationDone');
        emit(0x60);
        while(block.base + block.bytes.length < block.limit) emit(0xEA);

        // Finalize the producer queue outside the PPU transfer window.
        org(0xF380, 0xF3B0);
        label('queueFinalize');
        emit(0x20, 0xB2, 0x86);
        emit(0xA5, 0x3D);
        branch(0xD0, 'queueFinalizeDone');
        emit(0xA5, 0x18, 0xC9, 0x04);
        branch(0xD0, 'queueFinalizeDone');
        emit(0xA5, 0x30, 0xE9, 0x08, 0xC9, 0x06); // Include exit animation (13).
        branch(0xB0, 'queueFinalizeDone');
        absolute(0x20, 'queuePrepare');
        label('queueFinalizeDone');
        emit(0xA9, 0x00, 0x60);
        label('queueCommit');
        emit(0x86, 0x1E, 0xA9, 0x00, 0x4C, 0xB2, 0x86);

        // Spread initialization across frames to leave room for both pages.
        org(0xF3B0, 0xF3C0);
        label('initializeEnemySlot');
        // Stage substate $31 is zero on entry to stage state 10. Retain the
        // next native enemy slot there, and finish initialization before
        // advancing to the original fade-in handler. An enemy-9 body draws
        // four metatiles; initializing all eight slots at once can exceed
        // the physical queue when a second page must also be prepared.
        emit(0xA6, 0x31);
        branch(0xD0, 'initializeNextEnemy');
        emit(0xA2, 0x08);
        label('initializeNextEnemy');
        emit(0xCA, 0x20, 0xFB, 0xBC);
        absolute(0x4C, 'initializeEnemyDone');

        // Finish the native enemy initialization before advancing stage state.
        org(0xF3C0, 0xF3D0);
        label('initializeEnemyDone');
        emit(0xA5, 0x31);
        branch(0xD0, 'initializeEnemyWait');
        emit(0x4C, 0x12, 0x8B); // Original INC $30 / RTS.
        label('initializeEnemyWait');
        emit(0x60);
        org(0xF3D0, 0xF3E0);
        label('queuePrepare');
        // $00-$03 are the original producers' temporary scratch bytes. No
        // producer runs after this final queue terminator, before the RTI.
        emit(0xA6, 0x1E, 0xCA, 0x86, 0x01, 0xA0, 0x00);
        absolute(0x4C, 'queueScan');

        org(0xF3E0, 0xF410);
        label('backgroundQueueCheck');
        // Original A868 defers a rescue draw when queue length reaches $20.
        // A816 retains $68/$69 at the unprocessed map cell, and advances $6A
        // only after finishing the scan. Reuse that scheduler, allowing one
        // 16-byte metatile packet instead of two when both pages are queued.
        // Falling slots at A507 use the same check and retain their cursor $53.
        // Both hooks return A=queue length and CMP carry without touching X/Y.
        emit(0xA5, 0x3D);
        branch(0xD0, 'originalBackgroundQueue');
        emit(0xA5, 0x1E, 0xC9, 0x10, 0x60);
        label('originalBackgroundQueue');
        emit(0xA5, 0x1E, 0xC9, 0x20, 0x60);
        label('paletteQueueCheck');
        // One metatile plus its second page and 32 colors fits in vblank.
        // A fall can enqueue 38/48 bytes on its own: defer CA20 on those
        // frames and upload the complete current shadow on a quieter frame.
        // CA20's palette-inhibit check and loading/death/ending fades stay intact.
        emit(0xA5, 0x3D);
        branch(0xD0, 'originalPaletteQueue');
        emit(0xA5, 0x1E, 0xC9, 0x11, 0x60);
        label('originalPaletteQueue');
        emit(0xA5, 0x1E, 0xC9, 0x50, 0x60);
        // Erase the retired short-palette helper on load/export too.
        while(block.base + block.bytes.length < block.limit) emit(0xEA);

        for(const ref of references){
            const address = labels.get(ref.target);
            if(address === undefined) throw new Error(`Unknown view-patch label: ${ref.target}`);
            if(ref.relative){
                const delta = address - (ref.block.base + ref.offset + 1);
                if(delta < -128 || delta > 127) throw new Error(`View-patch branch too far: ${ref.target}`);
                ref.block.bytes[ref.offset] = delta & 0xFF;
            }else{
                ref.block.bytes[ref.offset] = address & 0xFF;
                ref.block.bytes[ref.offset + 1] = address >> 8;
            }
        }
        for(const part of blocks){
            if(part.base + part.bytes.length > part.limit) throw new Error('View patch exceeds reserved bank 7 space');
            patch(part.base, part.bytes);
        }
        const hook = (cpu, opcode, name) => {
            const address = labels.get(name);
            patch(cpu, [opcode, address & 0xFF, address >> 8]);
        };
        hook(0x9B38, 0x4C, 'camera');
        hook(0x838E, 0x20, 'titleReset');
        hook(0x8B4F, 0x4C, 'pause');
        hook(0x8ECE, 0x20, 'attributeIndex');
        hook(0x90B0, 0x20, 'attributeStore');
        hook(0xBBEA, 0x20, 'attributeStore');
        patch(0x886C, [0xE0, 0x06, 0xB0, 0x35]); // Original PPU interpreter.
        hook(0x80C5, 0x20, 'queueFinalize');
        hook(0xB867, 0x4C, 'doorAnimation');
        hook(0x8B0F, 0x4C, 'initializeEnemySlot');
        patch(0xBD39, [0x86, 0x31, 0xCA, 0x60]); // Save native slot, return.
        for(const cpu of [0xA507, 0xA868]){
            hook(cpu, 0x20, 'backgroundQueueCheck');
            patch(cpu + 3, [0xEA]); // Replace the fourth byte of LDA/CMP.
        }
        patch(0x8B94, [0x20, 0x20, 0xCA]); // Restore original full palette upload.
        hook(0x8B8E, 0x20, 'paletteQueueCheck');
        patch(0x8B91, [0xEA]);
        // Reset before clearing/drawing the next stage's transition screen,
        // rather than waiting for the later STAGE/REST text entry.
        patch(0x8A3A, [0x20, 0x6D, 0xFF]);
        // Both native stage-entry paths still reset scroll before drawing.
        hook(0xFF6D, 0x20, 'stageReset');
        hook(0xFFD4, 0x20, 'stageReset');

        // START/CONTINUE, password entry/validator and their data stay native.

        // Visibility is modulo the MAP width, independently of the view.
        // In single-screen maps high-byte parity must never hide a sprite.
        for(const cpu of [0x9B66, 0xA166, 0xA2B1, 0xA45C, 0xDA04]){
            patch(cpu, [0x25, 0x3D]); // AND levelMode instead of AND #1
        }
        // LOOP VIEW permits pause free-look in either width. The dispatch
        // above retains the original pause for narrow NORMAL VIEW levels.
        patch(0xFEF7, [0xEA, 0xEA, 0xEA, 0xEA, 0xEA]);
        for(const cpu of [0xFF14, 0xFF26, 0xFF4A]) patch(cpu, [0x25, 0x3D]);
    }

    // moaikun maker label
    static addMoaikunMakerLabel(romData){
        const labelCode = [0xE3, 0xE2, 0x17, 0x0B, 0x0E, 0x0F, 0xE3, 0x21, 0x13, 0x1E, 0x12, 0xE2, 0xE3, 0xE2, 0xE3, 0xE2, 0xE3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0x17, 0x19, 0x0B, 0x13, 0x15, 0x1F, 0x18, 0xD2, 0x17, 0x0B, 0x15, 0x0F, 0x1C];
        const labelAddr = 0x05D9;
        for(let i = labelAddr; i< labelAddr + labelCode.length; i++){
            romData[i] = labelCode[i - labelAddr];
        }
    }


    static expandRomCode(newRomData){
        //修改头
        newRomData[0x4] = 0x08;
        newRomData[0x5] = 0x00;
        newRomData[0x6] = 0x21;
        newRomData[0x7] = 0x00;

        const numBytes = 0x10000;

        let ppuMoveCodeAddr = 0x1EF90;
        let ppuMoveCodeCpuAddr = ppuMoveCodeAddr - numBytes - 0x10;
        let ppuMoveCodeCpuAddrPart = new Array(2);
        ppuMoveCodeCpuAddrPart[0] = ppuMoveCodeCpuAddr & 0xFF;
        ppuMoveCodeCpuAddrPart[1] = (ppuMoveCodeCpuAddr >> 8) & 0xFF;

        //
        const updatePPUCodeAddr = 0x00BE;
        const updatePPUCode = [0xA5, 0x2F, 0xC5, 0x2E, 0xF0, 0x03, 0x20, ppuMoveCodeCpuAddrPart[0], ppuMoveCodeCpuAddrPart[1]];
        Romfix.fixCodeInsert(newRomData, updatePPUCodeAddr, updatePPUCode);

        //写入切换 拷贝 图形代码代码
        const loadGraphicsFromPRG = [
            0x48, 0x8A, 0x48, 0x98, 0x48, 0xA5, 0x30, 0x48, 0xA5, 0x31, 0x48, 0xA5, 0x2F, 0x85, 0x2E, 0xA9,
            0x00, 0x8D, 0x00, 0x20, 0x8D, 0x01, 0x20, 0xA5, 0x2F, 0x4A, 0x18, 0x69, 0x02, 0x8D, 0x00, 0x80,
            0xA5, 0x2F, 0x29, 0x01, 0xF0, 0x04, 0xA9, 0xA0, 0xD0, 0x02, 0xA9, 0x80, 0x85, 0x31, 0xA9, 0x00,
            0x85, 0x30, 0xAD, 0x02, 0x20, 0xA9, 0x00, 0x8D, 0x06, 0x20, 0x8D, 0x06, 0x20, 0xA2, 0x20, 0xA0,
            0x00, 0xB1, 0x30, 0x8D, 0x07, 0x20, 0xC8, 0xD0, 0xF8, 0xE6, 0x31, 0xCA, 0xD0, 0xF3, 0xA9, 0x1E,
            0x8D, 0x01, 0x20, 0xA9, 0x00, 0x8D, 0x05, 0x20, 0x8D, 0x05, 0x20, 0xA9, 0x80, 0x8D, 0x00, 0x20,
            0xA9, 0x00, 0x8D, 0x00, 0x80, 0x68, 0x85, 0x31, 0x68, 0x85, 0x30, 0x68, 0xA8, 0x68, 0xAA, 0x68,
            0x60,
        ];
        const fixedTitleAddr  = Romfix.fixCodeInsert(newRomData, ppuMoveCodeAddr, loadGraphicsFromPRG);
        const fixTitleScreenCode = [
            0xA9, 0xB0, 
            0x85, 0xFF, 
            0x8D, 0x00, 0x20, 
            0xA9, 0x1E, 
            0x85, 0xFE, 
            0xA9, 0x05, 
            0x85, 0x1D, 
            0x20, 
            ppuMoveCodeCpuAddrPart[0], ppuMoveCodeCpuAddrPart[1], 
            0x60 
        ]
        const fixedTitleCpuAddr = fixedTitleAddr - numBytes - 0x10;
        newRomData[0x007E] = fixedTitleCpuAddr & 0xFF;
        newRomData[0x007F] = (fixedTitleCpuAddr >> 8) & 0xFF;

        const loadAddressTablecCodeAddr = Romfix.fixCodeInsert(newRomData, fixedTitleAddr, fixTitleScreenCode);
        //JSR 加载关卡地址表代码
        const loadAddressTablecCodeCPUAddr = Romfix.getCpuAddressOffset(loadAddressTablecCodeAddr);
        const jsrLoadAddressTableAddr = 0x0D32;
        const jsrLoadAddressTableCode = [
            0x20, loadAddressTablecCodeCPUAddr & 0xFF, (loadAddressTablecCodeCPUAddr >> 8) & 0xFF,
            0xEA, 0xEA, 
            0xEA, 0xEA, 0xEA, 
            0xEA, 0xEA 
        ]
        Romfix.fixCodeInsert(newRomData, jsrLoadAddressTableAddr, jsrLoadAddressTableCode);
        
        const loadAddressTablecCode = [
            0x48, 
            0xA9, 0x01, 
            0x8D, 0x00, 0x80, 
            0xB9, 0xFE, 0x7F, 
            0x85, 0x00, 
            0xB9, 0xFF, 0x7F,
            0x85, 0x01, 
            0xA9, 0x00, 
            0x8D, 0x00, 0x80, 
            0x68, 
            0x60 
        ]
        const loadFirstLevelDataAddr = Romfix.fixCodeInsert(newRomData, loadAddressTablecCodeAddr, loadAddressTablecCode);
        const cpuLoadFirstLevelDataAddr = Romfix.getCpuAddressOffset(loadFirstLevelDataAddr);
        //JSR 加载关卡第一个数据
        const jsrLoadFirstLevelDataAddr = 0x0D19;
        const jsrLoadFirstLevelDataCode = [
            0x20, cpuLoadFirstLevelDataAddr & 0xFF, (cpuLoadFirstLevelDataAddr >> 8) & 0xFF,
            0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA
        ];
        Romfix.fixCodeInsert(newRomData, jsrLoadFirstLevelDataAddr, jsrLoadFirstLevelDataCode);

        //
        const loadFirstLevelDataCode = [
            0xA9, 0x04, 
            0x8D, 0x00, 0x80, 
            0xB1, 0x00, 
            0x48, 
            0x4A, 
            0x4A, 
            0x4A, 
            0x4A, 
            0x85, 0x3D, 
            0xA9, 0x00, 
            0x8D, 0x00, 0x80, 
            0x68,
            0x60 
        ]
        const loadLevelCodeAddr = Romfix.fixCodeInsert(newRomData, loadFirstLevelDataAddr, loadFirstLevelDataCode);
        const loadLevelCodeCPUAddr = Romfix.getCpuAddressOffset(loadLevelCodeAddr);
        //loadLevel
        const jsrLoadLevelAddr = 0x2929;
        const jsrLoadLevelCode = [
            0x20, loadLevelCodeCPUAddr & 0xFF, (loadLevelCodeCPUAddr >> 8) & 0xFF,
            0xEA
        ]
        Romfix.fixCodeInsert(newRomData, jsrLoadLevelAddr, jsrLoadLevelCode);
        const loadLevelCode = [
            0xA9, 0x04, 
            0x8D, 0x00, 0x80, 
            0xB1, 0x00, 
            0x48, 
            0xA9, 0x00, 
            0x8D, 0x00, 0x80, 
            0x68, 
            0xC9, 0xFF, 
            0x60 
        ]
        const loadPlayerInfo = Romfix.fixCodeInsert(newRomData, loadLevelCodeAddr, loadLevelCode);

        const jsrLoadPlayerInfo = 0x1B1C;
        const jsrLoadPlayerInfoCode = [
            0x20, Romfix.getCpuAddressOffset(loadPlayerInfo) & 0xFF, (Romfix.getCpuAddressOffset(loadPlayerInfo) >> 8) & 0xFF, 
            0xEA
        ]
        Romfix.fixCodeInsert(newRomData, jsrLoadPlayerInfo, jsrLoadPlayerInfoCode);

        const loadPlayerInfoCode = [
            0xA9, 0x04, 
            0x8D, 0x00, 0x80, 
            0xB1, 0x00, 
            0x48, 
            0xA9, 0x00, 
            0x8D, 0x00, 0x80, 
            0x68, 
            0x85, 0x00, 
            0x60 
        ]
        const loadDoorInfoAddr = Romfix.fixCodeInsert(newRomData, loadPlayerInfo, loadPlayerInfoCode);
        const jsrLoadDoorInfo = 0x35F9;
        const jsrLoadDoorInfoCode = [
            0x20, Romfix.getCpuAddressOffset(loadDoorInfoAddr) & 0xFF, (Romfix.getCpuAddressOffset(loadDoorInfoAddr) >> 8) & 0xFF,
            0xEA,
            0xEA,
            0xEA, 0xEA,
            0xEA, 0xEA,
        ]
        Romfix.fixCodeInsert(newRomData, jsrLoadDoorInfo, jsrLoadDoorInfoCode);

        const loadDoorInfoCode = [
            0xA9, 0x04, 
            0x8D, 0x00, 0x80, 
            0xB1, 0x00, 
            0x85, 0x63, 
            0xC8, 
            0xB1, 0x00, 
            0x85, 0x64, 
            0xA9, 0x00, 
            0x8D, 0x00, 0x80, 
            0x60 
        ]
        const loadEnemyCountAddr = Romfix.fixCodeInsert(newRomData, loadDoorInfoAddr, loadDoorInfoCode);

        //load enemy info
        newRomData[0x33D9] = 0x00;
        newRomData[0x33DA] = 0x83;

        const jsrLoadenemyCountAddr = 0x2DD9;
        const jsrLoadenemyCountCode = [
            0x20, Romfix.getCpuAddressOffset(loadEnemyCountAddr) & 0xFF, (Romfix.getCpuAddressOffset(loadEnemyCountAddr) >> 8) & 0xFF,  
        ]
        Romfix.fixCodeInsert(newRomData, jsrLoadenemyCountAddr, jsrLoadenemyCountCode);

        const loadLoadEnemyCountCode = [
            0xA9, 0x01, 
            0x8D, 0x00, 0x80, 
            0xB1, 0x06, 
            0x48, 
            0xA9, 0x00, 
            0x8D, 0x00, 0x80, 
            0x68, 
            0x4A, 
            0x60 
        ]
        const loadEnemyInfoCodeAddr = Romfix.fixCodeInsert(newRomData, loadEnemyCountAddr, loadLoadEnemyCountCode);

        const jsrLoadEnemyInfoAddr = 0x2DE6;
        const jsrLoadEnemyInfoCode = [
            0x20, Romfix.getCpuAddressOffset(loadEnemyInfoCodeAddr) & 0xFF, (Romfix.getCpuAddressOffset(loadEnemyInfoCodeAddr) >> 8) & 0xFF,  
            0xEA, 
        ]
        Romfix.fixCodeInsert(newRomData, jsrLoadEnemyInfoAddr, jsrLoadEnemyInfoCode);

        const loadEnemyInfoCode = [
            0xA9, 0x01, 
            0x8D, 0x00, 0x80, 
            0xB1, 0x06, 
            0x48, 
            0xA9, 0x00, 
            0x8D, 0x00, 0x80, 
            0x68, 
            0x85, 0x00, 
            0x60 
        ]

        const loadEnemyPositionAddr = Romfix.fixCodeInsert(newRomData, loadEnemyInfoCodeAddr, loadEnemyInfoCode);
        const jsrLoadEnemyPositionAddr = 0x2E11;
        const jsrLoadEnemyPositionCode = [
            0x20, Romfix.getCpuAddressOffset(loadEnemyPositionAddr) & 0xFF, (Romfix.getCpuAddressOffset(loadEnemyPositionAddr) >> 8) & 0xFF,
            0xEA, 0xEA
        ]

        Romfix.fixCodeInsert(newRomData, jsrLoadEnemyPositionAddr, jsrLoadEnemyPositionCode);

        const loadenemyPositionCode = [
            0xA9, 0x01, 
            0x8D, 0x00, 0x80, 

            0xB1, 0x06, 
            0x48,

            0xA9, 0x00, 
            0x8D, 0x00, 0x80, 

            0x68, 
            0x9D, 0x76, 0x05, 

            0x60 
        ]
        const skipLevelEnemyInfoAddr = Romfix.fixCodeInsert(newRomData, loadEnemyPositionAddr, loadenemyPositionCode);


        // const jsrSkipLevelEnemyInfoAddr = 0x2DC9;
        // const jsrSkipLevelEnemyInfoCode = [
        //     0x20, Romfix.getCpuAddressOffset(skipLevelEnemyInfoAddr) & 0xFF, (Romfix.getCpuAddressOffset(skipLevelEnemyInfoAddr) >> 8) & 0xFF,
        // ]
        // Romfix.fixCodeInsert(newRomData, jsrSkipLevelEnemyInfoAddr, jsrSkipLevelEnemyInfoCode);
        // const skipLevelEnemyInfoCode = [
        //     0xA9, 0x01, 
        //     0x8D, 0x00, 0x80, 
        //     0xB1, 0x06, 
        //     0x48, 
        //     0xA9, 0x00, 
        //     0x8D, 0x00, 0x80, 
        //     0x68, 
        //     0x18, 
        //     0x60 
        // ]

        // add enemy address table
        const jsrSkipLevelEnemyInfoAddr = 0x2DC7;
        const jsrSkipLevelEnemyInfoCode = [
            0x8A, 
            0x0A, 
            0x20, Romfix.getCpuAddressOffset(skipLevelEnemyInfoAddr) & 0xFF, (Romfix.getCpuAddressOffset(skipLevelEnemyInfoAddr) >> 8) & 0xFF,
            0xA0, 0x00, 
            0xA2, 0x00, 
            0xA9, 0x00, 
            0xEA, 0xEA,
            0xEA, 0xEA,
            0xEA, 0xEA, 0xEA,
        ]
        Romfix.fixCodeInsert(newRomData, jsrSkipLevelEnemyInfoAddr, jsrSkipLevelEnemyInfoCode);
        const skipLevelEnemyInfoCode = [
            0xA8, 
            0x90, 0x02, 
            0xE6, 0x07, 
            0xA9, 0x01, 
            0x8D, 0x00, 0x80, 
            0xB1, 0x06, 
            0x48, 
            0xC8, 
            0xD0, 0x02, 
            0xE6, 0x07, 
            0xB1, 0x06, 
            0x48, 
            0xA9, 0x00, 
            0x8D, 0x00, 0x80, 
            0x68, 
            0x85, 0x07, 
            0x68, 
            0x85, 0x06, 
            0x60 
        ]

        const timerDataRomfixCodeAddr = Romfix.fixCodeInsert(newRomData, skipLevelEnemyInfoAddr, skipLevelEnemyInfoCode);
        const jsrTimerDataRomfixCodeAddr = 0x0AE5;
        const jsrTimerDataRomfixCode = [
            0x20, Romfix.getCpuAddressOffset(timerDataRomfixCodeAddr) & 0xFF, (Romfix.getCpuAddressOffset(timerDataRomfixCodeAddr) >> 8) & 0xFF,
            0xEA, 0xEA,
            0xEA,
            0xEA, 0xEA, 0xEA, 0xEA,
            0xEA,
        ]
        Romfix.fixCodeInsert(newRomData, jsrTimerDataRomfixCodeAddr, jsrTimerDataRomfixCode);
        const timmerDataCpuAddr = (Config.LEVEL_TIMER_EXPANDED - 0x10) % 0x4000 + 0x8000
        const timerDataRomfixCode = [
            0xA9, 0x01, 
            0x8D, 0x00, 0x80, 
            0xB9, timmerDataCpuAddr & 0xFF, (timmerDataCpuAddr >> 8) & 0xFF, 
            0x48, 
            0x48, 
            0xA9, 0x00, 
            0x8D, 0x00, 0x80, 
            0x68, 
            0x4A, 
            0x4A, 
            0x4A, 
            0x4A, 
            0x85, 0x71, 
            0x68, 
            0x60 
        ]
        Romfix.fixCodeInsert(newRomData, timerDataRomfixCodeAddr, timerDataRomfixCode);

        /*
         * Keep NMI execution out of a switchable PRG bank.
         *
         * The expanded-ROM data helpers at $F004-$F0D1 temporarily map bank 1
         * or bank 4 at $8000-$BFFF. If NMI starts before a helper restores
         * bank 0, the original vector at $807C points into data instead of
         * executable code.
         *
         * This fixed-bank entry reproduces the original A/X/Y prologue and
         * inspects the interrupted program-counter high byte on the stack.
         * An interrupted $F0xx helper skips only that NMI and returns to finish
         * the bank read. Every other NMI continues at $8081, immediately after
         * the original prologue. No RAM flag is required.
         */
        const bankSafeNmiCpuAddr = 0xF0E2;
        const fixedBankRomAddr =
            Config.PGR_PART_2_BANK_INDEX * 0x4000 + 0x10;
        const bankSafeNmiRomAddr =
            fixedBankRomAddr + (bankSafeNmiCpuAddr - 0xC000);
        const nmiVectorRomAddr =
            fixedBankRomAddr + (0xFFFA - 0xC000);
        const bankSafeNmiCode = [
            0x48,                   // PHA
            0x8A, 0x48,             // TXA; PHA
            0x98, 0x48,             // TYA; PHA
            0xBA,                   // TSX
            0xBD, 0x06, 0x01,       // LDA $0106,X (interrupted PC high)
            0xC9, 0xF0,             // CMP #$F0
            0xF0, 0x03,             // BEQ skipNmi
            0x4C, 0x81, 0x80,       // JMP $8081 (original NMI body)
            0x68, 0xA8,             // skipNmi: PLA; TAY
            0x68, 0xAA,             // PLA; TAX
            0x68, 0x40,             // PLA; RTI
        ];
        Romfix.fixCodeInsert(
            newRomData,
            bankSafeNmiRomAddr,
            bankSafeNmiCode
        );
        newRomData[nmiVectorRomAddr] = bankSafeNmiCpuAddr & 0xFF;
        newRomData[nmiVectorRomAddr + 1] =
            (bankSafeNmiCpuAddr >> 8) & 0xFF;

        return newRomData;
    }

    static fixCodeInsert(data, insertAddr, codeArray){
        data.set(codeArray, insertAddr);
        return insertAddr + codeArray.length;
    }

    static getCpuAddressOffset(romAddr){
        if(romAddr < 0x4010){
            return 0x8000 + romAddr - 0x10;
        }
        return 0x8000 + romAddr - 0x10 - (Config.PGR_PART_2_BANK_INDEX - 1) * 0x4000;
    }


}
