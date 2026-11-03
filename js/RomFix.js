class Romfix{
    static PAUSE_HINT_GLYPHS = 'PAUSEDLOKCMRFN<^/';
    static PAUSE_HINT_SPRITE_START = 0x60;
    static PAUSE_PATTERN_READY = 0x09;
    static PAUSE_PATTERN_RESTORED = 0x89;

    /** Keep the native alphabet's complete white ink and selective black shadow. */
    static getPauseHintPatterns(source) {
        // Pause swaps nine 64-byte chunks of enemy CHR; clear the final padding.
        const patterns = new Uint8Array(0x240);
        for(const [index, character] of [...Romfix.PAUSE_HINT_GLYPHS].entries()) {
            if(character !== '<' && character !== '^' && character !== '/') {
                const at = 0x8010 + (0x16 + (character.charCodeAt(0) - 65) * 2) * 16;
                patterns.set(source.subarray(at, at + 32), index * 32);
                continue;
            }

            // One authored arrow, rotated once for the vertical orientation.
            // NES sprite flips supply the opposite directions without more tiles.
            const left = [0x10, 0x30, 0x7E, 0xFE, 0x7E, 0x30, 0x10, 0];
            // The native font has no slash; match the staircase of its Z stroke.
            const slash = [0x06, 0x0E, 0x1C, 0x38, 0x70, 0xE0, 0xC0, 0];
            const ink = character === '/' ? slash : character === '<' ? left : new Uint8Array(8);
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
    // Gameplay background pattern-table ABI. The final interval is reserved
    // in every scene for additions. Sprite 13 owns $BA-$FF in that interval.
    static SCENE_GRAPHICS_LAYOUT = Object.freeze({
        version: 2, foregroundStart: 0x60, enemy9Start: 0x6C,
        scene8MetatileStart: 0x96, scene8SingleStart: 0xA2,
        reservedBackgroundStart: 0xBA, reservedBackgroundEnd: 0x100,
        portalStart: 0xBA, portalTileCount: 70, portalEntryStart: 0xC0
    });
    static SCENE_GRAPHICS_ENEMY9_TILES = Object.freeze(
        Array.from({length: 44}, (_, index) => 0xD2 + index)
            .filter(tile => tile !== 0xED && tile !== 0xF0)
    );
    static SCENE_GRAPHICS_SOURCE_TABLES = Object.freeze([
        Object.freeze({cpu: 0xBFD4, length: 12}),
        Object.freeze({cpu: 0xC03B, length: 0x56}),
        Object.freeze({cpu: 0xBDA1, length: 0x50})
    ]);

    static getSceneGraphicsVersion(data) {
        const signature = [0x53, 0x43, 0x45, 0x4E, 0x45, 0x43, 0x48, 0x52]; // SCENECHR
        if (!signature.every((value, index) => data[0x18020 + index] === value)) return 0;
        const version = data[0x18028];
        if (version !== 1 && version !== 2) throw new Error('Unsupported scene graphics version');
        return version;
    }

    static getSceneGraphicsSourceTables(source) {
        const tables = [];
        for (const {cpu, length} of Romfix.SCENE_GRAPHICS_SOURCE_TABLES) {
            const address = cpu - 0x8000 + 0x10 + (cpu >= 0xC000 ? 6 * 0x4000 : 0);
            tables.push(...source.subarray(address, address + length));
        }
        return Uint8Array.from(tables);
    }

    /** Restore editable definitions before rebuilding a previously compiled ROM. */
    static restoreSceneGraphicsSource(target, source) {
        const version = Romfix.getSceneGraphicsVersion(source);
        if (!version) return false;
        const fixed = cpu => 0x1C010 + cpu - 0xC000;
        target.set(source.slice(0x18110, 0x18990), fixed(0xCCF2));
        target.set([1, 1, 1, 1, 1, 2, 2, 3, 3, 2, 2, 2], fixed(0xD821));
        if (version >= 2) {
            let backup = 0x18030;
            for (const {cpu, length} of Romfix.SCENE_GRAPHICS_SOURCE_TABLES) {
                const address = cpu - 0x8000 + 0x10 + (cpu >= 0xC000 ? 6 * 0x4000 : 0);
                target.set(source.slice(backup, backup + length), address);
                backup += length;
            }
        }
        return true;
    }

    /**
     * Build twelve independent CHR-RAM images without changing the source.
     * Original CHR pages stay at $8010-$1000F. Shared background-definition
     * tables share one relocation map, so their tile references remain valid.
     */
    static buildSceneGraphics(romData) {
        if (romData.length < 0x20010) throw new Error('Scene graphics require an expanded ROM');
        const source = romData.slice();
        Romfix.restoreSceneGraphicsSource(source, romData);
        const layout = Romfix.SCENE_GRAPHICS_LAYOUT;
        const fixed = cpu => 0x1C010 + cpu - 0xC000;
        const address = cpu => cpu < 0xC000 ? cpu - 0x8000 + 0x10 : fixed(cpu);
        const word = cpu => source[fixed(cpu)] | source[fixed(cpu) + 1] << 8;
        const range = (start, end) => Array.from({ length: end - start + 1 }, (_, i) => start + i);
        const patternKey = bytes => Array.from(bytes).join(',');
        const graphicsPages = [1, 1, 1, 1, 1, 2, 2, 3, 3, 2, 2, 2];
        // The native spikes repeat their left column on the right. The tile
        // preparation hook aliases those columns only on matching source art.
        const sharedSpikes = [0xB010, 0xD010, 0xF010].every(page =>
            source.subarray(page + 0x2A0, page + 0x2C0).every((v, i) => v === source[page + 0x2C0 + i]));
        const groups = new Map();
        const patchValues = new Map();
        const scenes = graphicsPages.map((page, scene) => {
            const definitions = word(0xCCB2 + scene * 2);
            const backgroundLayout = fixed(word(0xCAD2 + scene * 2));
            const definitionAddresses = new Set();
            const staticTiles = new Set();
            const wide = scene === 7 || scene === 8;
            for (let index = 0; index < (wide ? 56 : 28); index++) {
                const value = source[backgroundLayout + index];
                const entries = wide ? [value] : [value >> 4, value & 15];
                for (const entry of entries) {
                    const start = fixed(definitions) + entry * 16;
                    for (let offset = 0; offset < 16; offset++) {
                        definitionAddresses.add(start + offset);
                        staticTiles.add(source[start + offset]);
                    }
                }
            }
            const patterns = new Uint8Array(0x2000);
            const sourceStart = 0x8010 + page * 0x2000;
            const original = source.slice(sourceStart, sourceStart + 0x2000);
            const spriteTiles = new Set(scene === 7 || scene === 8
                ? range(0, 0xFF) : [...range(0, 0xA9), ...range(0xE0, 0xFF)]);
            for (const tile of spriteTiles) patterns.set(original.subarray(tile * 16, tile * 16 + 16), tile * 16);
            if (scene !== 7 && scene !== 8) {
                patterns.set(Romfix.getFlightSpriteFrames(source, scene === 4), 0xAA0);
                for (let tile = 0xAA; tile <= 0xB1; tile++) spriteTiles.add(tile);
            }

            const backgroundTiles = new Set(), fixedKeys = new Map();
            const copyBackground = (bytes, to) => {
                patterns.set(bytes, 0x1000 + to * 16);
                backgroundTiles.add(to);
                fixedKeys.set(to, patternKey(bytes));
            };
            const originalBackground = tile => original.subarray(0x1000 + tile * 16, 0x1010 + tile * 16);
            // Native metatiles and odd 8x16 sprite tiles also reference this region.
            for (const tile of [0, ...range(2, 0x59), 0x5F]) {
                if (!sharedSpikes || (tile !== 0x2C && tile !== 0x2D)) copyBackground(originalBackground(tile), tile);
            }
            const foreground = source[address(0xBFD4) + scene];
            for (let index = 0; index < 12; index++) {
                copyBackground(originalBackground(foreground + index), layout.foregroundStart + index);
            }
            Romfix.SCENE_GRAPHICS_ENEMY9_TILES.forEach((tile, index) => {
                const start = 0xF010 + tile * 16;
                copyBackground(source.subarray(start, start + 16), layout.enemy9Start + index);
            });
            if (scene === 8) {
                for (let index = 0; index < 12; index++) {
                    copyBackground(originalBackground(0x7B + index), layout.scene8MetatileStart + index);
                }
                for (let index = 0; index < 3; index++) {
                    copyBackground(originalBackground(0xCD + index), layout.scene8SingleStart + index);
                }
            }
            const portal = Romfix.getPortalPatterns(Romfix.getPortalColorSchemes(source, scene));
            for (let index = 0; index < layout.portalTileCount; index++) {
                copyBackground(portal.subarray(index * 16, index * 16 + 16), layout.portalStart + index);
            }
            const result = { scene, patterns, spriteTiles, backgroundTiles, fixedKeys,
                originalBackground, staticTiles, definitionAddresses };
            if (!groups.has(definitions)) groups.set(definitions, []);
            groups.get(definitions).push(result);
            return result;
        });

        for (const group of groups.values()) {
            const tiles = [...new Set(group.flatMap(scene => [...scene.staticTiles]))].sort((a, b) => a - b);
            const nodes = new Map(), tileNodes = new Map();
            for (const tile of tiles) {
                // A shared definition can still be used with different source CHR pages.
                const key = group.map(scene => patternKey(scene.originalBackground(tile))).join('|');
                if (!nodes.has(key)) nodes.set(key, { tile, scenes: new Set(), mask: 0 });
                const node = nodes.get(key);
                tileNodes.set(tile, node);
                for (const scene of group) if (scene.staticTiles.has(tile)) {
                    node.scenes.add(scene);
                    node.mask |= 1 << scene.scene;
                }
            }
            const candidates = range(0, layout.reservedBackgroundStart - 1);
            const available = candidates.filter(tile => group.every(scene => !scene.fixedKeys.has(tile)));
            const extra = [];
            for (const node of nodes.values()) {
                // Keep static scenery out of the enemy's dedicated slots,
                // even when the two happen to contain identical pixels.
                node.target = candidates.find(tile =>
                    !(tile >= layout.enemy9Start && tile < layout.enemy9Start + Romfix.SCENE_GRAPHICS_ENEMY9_TILES.length) &&
                    [...node.scenes].every(scene =>
                    scene.fixedKeys.get(tile) === patternKey(scene.originalBackground(node.tile))));
                if (node.target === undefined) extra.push(node);
            }
            // Different decorations may share a slot when their scenes never coexist.
            // The deterministic first-fit coloring needs no backtracking or scene exceptions.
            extra.sort((a, b) => b.scenes.size - a.scenes.size || a.tile - b.tile);
            const occupancy = [];
            for (const node of extra) {
                let color = occupancy.findIndex(mask => !(mask & node.mask));
                if (color < 0) { color = occupancy.length; occupancy.push(0); }
                if (color >= available.length) throw new Error('Not enough free background tiles for scene graphics');
                occupancy[color] |= node.mask;
                node.target = available[color];
            }
            for (const scene of group) {
                for (const tile of scene.staticTiles) {
                    const target = tileNodes.get(tile).target;
                    scene.patterns.set(scene.originalBackground(tile), 0x1000 + target * 16);
                    scene.backgroundTiles.add(target);
                }
                for (const fileAddr of scene.definitionAddresses) {
                    const target = tileNodes.get(source[fileAddr]).target;
                    if (target !== source[fileAddr]) patchValues.set(fileAddr, target);
                }
            }
        }

        for (let scene = 0; scene < 12; scene++) patchValues.set(address(0xBFD4) + scene, layout.foregroundStart);
        const enemy9 = new Map(Romfix.SCENE_GRAPHICS_ENEMY9_TILES.map((tile, index) => [tile, layout.enemy9Start + index]));
        for (const [cpu, length] of [[0xC07B, 16], [0xBDA1, 0x50]]) {
            for (let index = 0; index < length; index++) {
                const fileAddr = address(cpu) + index, value = enemy9.get(source[fileAddr]);
                if (value !== undefined) patchValues.set(fileAddr, value);
            }
        }
        for (const [cpu, count, oldStart, newStart] of [
            [0xC06B, 12, 0x7B, layout.scene8MetatileStart],
            [0xC08E, 3, 0xCD, layout.scene8SingleStart]
        ]) for (let index = 0; index < count; index++) {
            const fileAddr = address(cpu) + index, oldTile = source[fileAddr];
            if (oldTile >= oldStart && oldTile < oldStart + count) patchValues.set(fileAddr, newStart + oldTile - oldStart);
        }
        const builtScenes = scenes.map(({ scene, patterns, spriteTiles, backgroundTiles }) => ({
            scene, patterns,
            usedSpriteTiles: [...spriteTiles].sort((a, b) => a - b),
            usedBackgroundTiles: [...backgroundTiles].sort((a, b) => a - b),
            freeSpriteTiles: range(0, 0xFF).filter(tile => !spriteTiles.has(tile)),
            freeBackgroundTiles: range(0, 0xFF).filter(tile => !backgroundTiles.has(tile))
        }));
        return {
            scenes: builtScenes, patches: [...patchValues].map(([fileAddr, value]) => ({ fileAddr, value })),
            sourceDefinitions: source.slice(fixed(0xCCF2), fixed(0xD572)),
            sourceTables: Romfix.getSceneGraphicsSourceTables(source), sharedSpikes, layout
        };
    }

    /** Store deduplicated 256-byte CHR pages and a 32-page list per scene. */
    static compileSceneGraphics(romData) {
        const built = Romfix.buildSceneGraphics(romData);
        const pages = [], pageIndexes = new Map(), manifest = new Uint8Array(12 * 32);
        for (const { scene, patterns } of built.scenes) {
            for (let page = 0; page < 32; page++) {
                const pixels = patterns.slice(page * 256, (page + 1) * 256);
                const key = Array.from(pixels).join(',');
                if (!pageIndexes.has(key)) {
                    pageIndexes.set(key, pages.length);
                    pages.push(pixels);
                }
                manifest[scene * 32 + page] = pageIndexes.get(key);
            }
        }
        if (pages.length > 116) throw new Error(`Scene graphics exceed the 116-page pool (${pages.length})`);
        // After native metatile preparation, Y identifies its last tile.
        // For spikes, reuse the left column if the source pixels match.
        // Preserve Y and the native flags on the way back to $9198.
        if (built.sharedSpikes) {
            romData.set([0x08, 0xC0, 0x2D, 0xD0, 8, 0xA5, 0x83, 0x85, 0x84,
                0xA5, 0x85, 0x85, 0x86, 0x28, 0x4C, 0x98, 0x91], 0x1FBFF); // $FBEF–$FBFF
        }
        romData.set(built.sharedSpikes ? [0x4C, 0xEF, 0xFB] : [0x4C, 0x98, 0x91], 0x119B);
        romData.fill(0, 0x14010, 0x18010);
        romData.fill(0, 0x18C10, 0x1C010);
        pages.forEach((page, index) => romData.set(page,
            index < 64 ? 0x14010 + index * 256 : 0x18C10 + (index - 64) * 256));
        romData.set([0x53, 0x43, 0x45, 0x4E, 0x45, 0x43, 0x48, 0x52,
            Romfix.SCENE_GRAPHICS_LAYOUT.version], 0x18020);
        romData.set(built.sourceTables, 0x18030);
        romData.set(built.sourceDefinitions, 0x18110);
        romData.set(manifest, 0x18A10);
        for (const { fileAddr, value } of built.patches) romData[fileAddr] = value;
        romData.set(Array.from({ length: 12 }, (_, scene) => 0x80 + scene), 0x1D831);
        return {
            uniquePages: pages.length,
            layout: Romfix.SCENE_GRAPHICS_LAYOUT,
            scenes: built.scenes.map(({ scene, usedSpriteTiles, usedBackgroundTiles, freeSpriteTiles, freeBackgroundTiles }) => ({
                scene, usedSpriteTiles: usedSpriteTiles.length, usedBackgroundTiles: usedBackgroundTiles.length,
                freeSpriteTiles: freeSpriteTiles.length, freeBackgroundTiles: freeBackgroundTiles.length
            }))
        };
    }

    // Audited against the native ROM and the optional RAM observer. Native
    // $82EF clears these bytes on stage/death reset; no native live reads.
    static COORDINATE_RAM = Object.freeze({ enemySpawnPages: 0x75, enemySlots: 8, playerYHigh: 0x7D });
    // Native object arrays end at $05C5. These private eight-slot arrays are
    // also cleared by the original whole-page stage reset.
    static BIRD_RAM = Object.freeze({ fright: 0x5C6, speed: 0x5CE, yHigh: 0x5D6, targetHigh: 0x5DE });
    // Fix original version rom
    static fixOriginalRom(romData, isExpanded = false, gameConfig = {}){
        const disableTimer = Boolean(gameConfig.disableTimer);
        const showRemainingRescueCount =
            gameConfig.showRemainingRescueCount !== false;
        const cameraFollow = Boolean(gameConfig.cameraFollow);

        Romfix.backupUnusedImages(romData, isExpanded);
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
        const viewModes = cameraFollow ? Romfix.addViewModes(romData, isExpanded) : null;
        Romfix.fixExtendedCoordinates(romData, isExpanded);
        Romfix.addBirdFishAuxiliary(romData, isExpanded);
        Romfix.addSpritePortalPreview(romData, isExpanded);
        Romfix.addPauseControls(romData, isExpanded, viewModes);
        Romfix.configureCustomLevelCredit(romData, isExpanded, gameConfig.customLevelAuthor);
        Romfix.addMoaikunMakerLabel(romData);
        if (isExpanded) {
            Romfix.compileSceneGraphics(romData);
            Romfix.installSceneGraphicsLoader(romData);
        }
    }

    /**
     * Enemy 12 is a harmless horizontal auxiliary. Its two scene-specific
     * 16x16 frames occupy sprite tiles $AA-$B1. Native enemy-type tables end
     * at 11, so this object bypasses their AI, collision-damage and animation
     * dispatch while retaining map probes, movement, facing and projection.
     * Rideable-platform physics live at $F5BC-$F7FF; native per-enemy Y
     * velocity/action bytes are private to this type and reset with the level.
     * Fixed bank 7 $FD00-$FDC1 is cleared former level storage. The scene CHR
     * uploader follows at $FDC2, the Tile 13 lift lives at $FE60, and pause
     * code begins at $FED9.
     */
    static addBirdFishAuxiliary(romData, isExpanded = false){
        if(!isExpanded) throw new Error('Bird/fish auxiliary requires an expanded ROM');
        const file = cpu => cpu - 0x8000 + 0x10 + (cpu >= 0xC000 ? 6 * 0x4000 : 0);
        const base = 0xFD00, limit = 0xFDC2;
        if(romData.subarray(file(base), file(limit)).some(byte => byte !== 0))
            throw new Error('Reserved bird/fish area in bank 7 is occupied');
        const platform = Romfix.addBirdFishPlatform(romData);
        const bytes = [], labels = new Map(), references = [];
        const emit = (...values) => bytes.push(...values);
        const label = name => labels.set(name, base + bytes.length);
        const absolute = (opcode, destination) => {
            emit(opcode); references.push({at: bytes.length, destination}); emit(0, 0);
        };
        const branch = (opcode, destination) => {
            emit(opcode); references.push({at: bytes.length, destination, relative: true}); emit(0);
        };

        label('dispatch');
        emit(0xC9, 0x0C); branch(0xF0, 'update');
        emit(0xC9, 0x09); branch(0xF0, 'nativeFace');
        absolute(0x4C, 0xA982);
        label('nativeFace'); absolute(0x4C, 0xA97C);

        label('update');
        // Reuse the ordinary enemy hazard checks without contact damage or
        // per-type AI: terrain, thrown stones, pushed rocks, falling objects
        // and explosions. A hit must enter death before platform init can
        // touch the RAM bytes shared with native knockback physics.
        absolute(0x20, platform.motion.hazards);
        // States 10+ use the native shared defeat table, including the
        // headbutt tumble, bottom-edge burst and respawn countdown.
        emit(0xBD, 0x06, 0x05); branch(0xD0, 'activeState');
        absolute(0x4C, platform.spawn);
        label('activeState');
        emit(0xC9, 0x0A); branch(0x90, 'patrol');
        absolute(0x4C, platform.defeat);
        label('patrol');
        // Initialize once, then keep live height and the previous world X.
        absolute(0x20, platform.init);
        absolute(0x20, platform.motion.velocity);
        emit(0xBD, 0x16, 0x05, 0x9D, 0x26, 0x05,
            0xBD, 0x33, 0x04, 0x85, 0x02,
            0xBD, 0x16, 0x05, 0x85, 0x00,
            0xBD, 0x0E, 0x05, 0x85, 0x01);
        absolute(0x20, platform.walls);
        emit(0xBD, 0x56, 0x05, 0xC9, 0x04); branch(0xF0, 'right');
        emit(0xA5, 0xAD); branch(0xF0, 'move');
        emit(0xA5, 0xAE); branch(0xD0, 'animate');
        branch(0xF0, 'reverse'); // The clear right probe left Z set.
        label('right');
        emit(0xA5, 0xAE); branch(0xF0, 'move');
        emit(0xA5, 0xAD); branch(0xD0, 'animate');
        label('reverse'); absolute(0x20, platform.reverse);
        label('move');
        // The native 8.8 X integrator wraps by the actual map width.
        absolute(0x20, 0xAFB0);

        label('animate');
        absolute(0x20, platform.update);
        emit(0xBD, 0x06, 0x05, 0xC9, 0x01); branch(0xF0, 'liveAnimation');
        absolute(0x4C, platform.project); // Top exit already cleared the metasprite.
        label('liveAnimation');
        emit(0xFE, 0x66, 0x05, 0xBD, 0x66, 0x05, 0x29, 0x07, 0x9D, 0x66, 0x05);
        branch(0xD0, 'draw');
        emit(0xBD, 0x5E, 0x05, 0x49, 0x01, 0x9D, 0x5E, 0x05);
        label('draw');
        emit(0xBD, 0x5E, 0x05, 0x18, 0x69, 0x2D, 0x9D, 0x15, 0x04);
        absolute(0x4C, platform.draw);

        // Add simple metasprites $2D-$2E without consuming existing entries.
        // Each frame is two adjacent 8x16 hardware sprites; the native OAM
        // builder still handles horizontal flipping, clipping and palettes.
        label('render');
        emit(0xC9, 0x2D); branch(0x90, 'nativeRender');
        emit(0xC9, 0x2F); branch(0xB0, 'nativeRender');
        // CMP #$2F left carry clear. SBC #$2C supplies frames 0/1; both
        // shifts and additions below stay below $100 and leave carry clear.
        emit(0xE9, 0x2C, 0x0A, 0x0A, 0x69, 0xAA, 0x85, 0x10,
            0x69, 0x02, 0x85, 0x11,
            0xA9, 0x00, 0x85, 0x12, 0x85, 0x13); // Player sprite palette.
        absolute(0x4C, 0x8951);
        label('nativeRender');
        emit(0x0A); branch(0xB0, 'largeRender');
        absolute(0x4C, 0x8935);
        label('largeRender'); absolute(0x4C, 0x8991);

        if(base + bytes.length > limit) throw new Error('Bird/fish patch exceeds reserved bank 7 space');
        for(const ref of references){
            const target = typeof ref.destination === 'string' ? labels.get(ref.destination) : ref.destination;
            if(target === undefined) throw new Error(`Unknown bird/fish label: ${ref.destination}`);
            if(ref.relative){
                const delta = target - (base + ref.at + 1);
                if(delta < -128 || delta > 127) throw new Error('Bird/fish branch is out of range');
                bytes[ref.at] = delta & 0xFF;
            }else{ bytes[ref.at] = target & 0xFF; bytes[ref.at + 1] = target >> 8; }
        }
        Romfix.fixCodeInsert(romData, file(base), bytes);
        Romfix.fixCodeInsert(romData, file(0xA978), [0x4C, base & 0xFF, base >> 8, 0xEA]);
        const render = labels.get('render');
        Romfix.fixCodeInsert(romData, file(0x8932), [0x4C, render & 0xFF, render >> 8]);
        Romfix.addBirdFishLift(romData, platform.motion);
    }

    /** Tile 13 scatters live birds/fish upward instead of stunning them. */
    static addBirdFishLift(romData, motion = Romfix.addBirdFishMotion(romData)){
        // Scene graphics end before $FE60; the pause-frame wrapper starts at
        // $FED9. This region is relocated level storage, cleared on export.
        const base = 0xFE60, limit = 0xFED9;
        const file = cpu => cpu - 0x8000 + 0x10 + (cpu >= 0xC000 ? 6 * 0x4000 : 0);
        if(romData.subarray(file(base), file(limit)).some(byte => byte !== 0))
            throw new Error('Reserved bird/fish lift area in bank 7 is occupied');
        const bytes = [], labels = new Map(), references = [];
        const emit = (...values) => bytes.push(...values);
        const label = name => labels.set(name, base + bytes.length);
        const absolute = (opcode, destination) => {
            emit(opcode); references.push({at: bytes.length, destination}); emit(0, 0);
        };
        const branch = (opcode, destination) => {
            emit(opcode); references.push({at: bytes.length, destination, relative: true}); emit(0);
        };

        // $B374 runs once per actual Tile 13 impact. Before $B388 it has
        // already skipped empty slots and native collision-immune enemies.
        emit(0xBD, 0xFE, 0x04, 0xC9, 0x0C); branch(0xF0, 'bird');
        emit(0xBD, 0x06, 0x05); absolute(0x4C, 0xB38B); // Original instruction/continuation.
        label('bird');
        emit(0xBD, 0x06, 0x05, 0xC9, 0x01); branch(0xD0, 'next');
        // Preserve the caller's scratch coordinates while computing both
        // the new height and shortest horizontal distance on a looping map.
        emit(0xA5, 0x00, 0x48, 0xA5, 0x01, 0x48);
        // A signed target can reach -8. The actual top-edge renderer exit
        // starts the ordinary respawn delay rather than wrapping to the bottom.
        absolute(0x20, motion.liftTarget);
        emit(0x38, 0xBD, 0x16, 0x05, 0xE5, 0xC2, 0x85, 0x00,
            0xBD, 0x0E, 0x05, 0xE5, 0xC1, 0x25, 0x3D, 0x85, 0x01);
        absolute(0x20, motion.startFright);
        emit(0xA5, 0x3D);
        branch(0xD0, 'wide');
        // Narrow maps use the low byte's sign; equal X and half a loop
        // have no unique away direction, so retain the current facing.
        emit(0xA5, 0x00, 0x0A); branch(0xF0, 'restore');
        branch(0xB0, 'left'); branch(0x90, 'right');
        label('wide');
        emit(0xA5, 0x00); branch(0xF0, 'restore');
        emit(0xA5, 0x01); branch(0xD0, 'left');
        label('right'); emit(0xA9, 0x04); branch(0xD0, 'facing');
        label('left'); emit(0xA9, 0x03);
        label('facing'); emit(0x9D, 0x56, 0x05);
        label('restore'); emit(0x68, 0x85, 0x01, 0x68, 0x85, 0x00);
        label('next'); absolute(0x4C, 0xB3B6);

        if(base + bytes.length > limit) throw new Error('Bird/fish lift exceeds reserved space');
        for(const ref of references){
            const target = typeof ref.destination === 'string' ? labels.get(ref.destination) : ref.destination;
            if(target === undefined) throw new Error(`Unknown bird/fish lift label: ${ref.destination}`);
            if(ref.relative){
                const distance = target - (base + ref.at + 1);
                if(distance < -128 || distance > 127) throw new Error('Bird/fish lift branch out of range');
                bytes[ref.at] = distance & 255;
            }else{ bytes[ref.at] = target & 255; bytes[ref.at + 1] = target >> 8; }
        }
        Romfix.fixCodeInsert(romData, file(base), bytes);
        Romfix.fixCodeInsert(romData, file(0xB388), [0x4C, base & 255, base >> 8]);
        return base;
    }

    /**
     * Enemy 13: paired automatic portals with background/overlay rendering.
     * Clu Clu Land's four black-hole frames use reserved background-table
     * CHR plus two contracted changeover poses. Background cells and the
     * two-sprite occlusion overlay use native palettes and group numerals.
     * No solid tile.
     * $FB00-$FC7F is split off from the unused end of the bird motion area.
     */
    // Clu Clu Land (World), CHR $150-$15F / file $5510-$560F.
    // Four 16x16 frames, in row-major tile order; see notes/PORTAL_ART.md.
    static PORTAL_CHR_HEX =
        '1f306fd8b3a4a9aa00000f1f3c383133f80cf61bcd2595550000f0f83c1c8cccaaa9a4b3d86f301f3331383c1f0f0000559525cd1bf60cf8cc8c1c3cf8f00000' +
        '1f3f70e7ccdbd6d5000000070f1c1819f8fc0ee733db6bab000000e0f0381898d5d6dbcce7703f1f19181c0f07000000ab6bdb33e70efcf8981838f0e0000000' +
        '1f306fd8b3a4a9aa000f102043474e4cf80cf61bcd25955500f00804c2e27232aaa9a4b3d86f301f4c4e474320100f00559525cd1bf60cf83272e2c20408f000' +
        '1f3f70e7ccdbd6d5000f1f3870636766f8fc1ecf27d36bab00f0f83c1ecee666d5d6dbcce7703f1f66676370381f0f00ab6bdb33e70efcf866e6c60e1cf8f000';
    static PORTAL_FRAMES = Object.freeze(Array.from({length: 6}, (_, frame) =>
        Object.freeze([0, 2, 1, 3].map(tile =>
            Romfix.SCENE_GRAPHICS_LAYOUT.portalEntryStart + frame * 4 + tile))));
    static PORTAL_RAM = Object.freeze({group: 0x5E6, bankActive: 0x5EE, mode: 0x5EF,
        command: 0x5F0, owner: 0x5F1, destination: 0x5F2,
        sourceX: 0x5F3, sourceY: 0x5F4, targetX: 0x5F5, targetY: 0x5F6,
        count: 0x5F7, role: 0x526, partner: 0x536, clockLow: 0x546,
        clockHigh: 0x56E, cooldown: 0x57E, overlay: 0x52E,
        visual: 0x53E, backgroundFrame: 0x556, drawCursor: 0x5F8, panTicks: 0x5F9,
        panLow: 0x5FA, panHigh: 0x5FB});

    static getPortalFrameTiles(group, frame) {
        if (frame === 6) {
            const left = [0xBA, 0xBC, 0xBE, 0xFC][group];
            return [left, 0xFE, left + 1, 0xFF];
        }
        const base = Romfix.SCENE_GRAPHICS_LAYOUT.portalEntryStart;
        const left = base + (group === 0 ? frame * 4 : 24 + (group - 1) * 12 + frame * 2);
        const right = base + frame * 4 + 2;
        return [left, right, left + 1, right + 1];
    }

    /** Use native palettes only; group 1 retains the original portal color. */
    static getPortalColorSchemes(romData, scene) {
        const shift = romData.length > 0x10010 ? 0x18000 : 0;
        const pointer = 0x564D + shift + scene * 2;
        const start = (romData[pointer] | romData[pointer + 1] << 8) - 0x8000 + 16 + shift;
        const palette = Array.from({length: 32}, (_, i) => romData[start + i] ?? 0x0F);
        const rgb = i => Config.NES_PALETTE[palette[i] & 63];
        const distance = (a, b) => rgb(a).reduce((sum, value, channel) => sum + (value - rgb(b)[channel]) ** 2, 0);
        let first = 0, best = Infinity;
        for (let bg = 0; bg < 4; bg++) {
            const score = distance(bg * 4 + 1, 25) + distance(bg * 4 + 2, 26);
            if (score < best) { first = bg; best = score; }
        }
        const backgrounds = [first];
        while (backgrounds.length < 4) {
            let next = -1, contrast = -1;
            for (let bg = 0; bg < 4; bg++) if (!backgrounds.includes(bg)) {
                const score = Math.min(...backgrounds.map(previous =>
                    distance(bg * 4 + 1, previous * 4 + 1) + distance(bg * 4 + 2, previous * 4 + 2)));
                if (score > contrast) { next = bg; contrast = score; }
            }
            backgrounds.push(next);
        }
        // Select the closest assignment of the remaining sprite palettes.
        // Some scenes duplicate colors; the baked group numeral stays unique.
        let sprites = [2, 0, 1, 3]; best = Infinity;
        for (const a of [0, 1, 3]) for (const b of [0, 1, 3]) if (a !== b) {
            const candidate = [2, a, b, [0, 1, 3].find(c => c !== a && c !== b)];
            const score = candidate.reduce((sum, sprite, group) => sum
                + distance(backgrounds[group] * 4 + 1, 16 + sprite * 4 + 1)
                + distance(backgrounds[group] * 4 + 2, 16 + sprite * 4 + 2), 0);
            if (score < best) { best = score; sprites = candidate; }
        }
        // The same CHR is used for the background and for the overlay. Pick
        // two opaque inks whose worst contrast is best across both paths.
        const luminance = palette.map(color => {
            const linear = Config.NES_PALETTE[color & 63].map(value => {
                const s = value / 255;
                return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            });
            return 0.05 + linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        });
        const contrast = (a, b) => Math.max(luminance[a], luminance[b]) / Math.min(luminance[a], luminance[b]);
        const schemes = backgrounds.map((background, group) => {
            const sprite = sprites[group], bg = background * 4, sp = 16 + sprite * 4;
            // Native palette 3 cycles three inks in scene 0 and swaps two in scene 4.
            const phases = [[0, 1, 2, 3]];
            if (background === 3 && scene === 0) phases.push([0, 2, 3, 1], [0, 3, 1, 2]);
            if (background === 3 && scene === 4) phases.push([0, 2, 1, 3]);
            let bestContrast = 0, badgeInk, badgePaper;
            for (const [ink, paper] of [[2, 3], [1, 3], [2, 1]]) {
                const score = Math.min(contrast(sp + ink, sp + paper),
                    ...phases.map(phase => contrast(bg + phase[ink], bg + phase[paper])));
                if (score > bestContrast) { bestContrast = score; badgeInk = ink; badgePaper = paper; }
            }
            return {background, sprite, badgeInk, badgePaper};
        });
        // Move the second color scheme (which can cycle) to portal 4.
        return [schemes[0], schemes[3], schemes[2], schemes[1]];
    }

    static getPortalBasePatterns() {
        const source = Uint8Array.from(Romfix.PORTAL_CHR_HEX.match(/../g), byte => parseInt(byte, 16));
        const patterns = new Uint8Array(24 * 16);
        // Native white is index 1; the exit sprite palette highlights index 2.
        // Keep the two moving rings (1 <-> 2). Both kinds of gap in the
        // source (0 and 3) take opaque ink 3 inside the rounded silhouette.
        // Reorder each row-major frame into two top/bottom 8x16 columns.
        for (let tile = 0; tile < source.length; tile += 16) {
            const columnTile = (tile & ~63) + [0, 2, 1, 3][(tile >> 4) & 3] * 16;
            for (let row = 0; row < 8; row++) {
                const low = source[tile + row], high = source[tile + 8 + row];
                const y = (tile & 32 ? 8 : 0) + row;
                const inset = Math.max(0, 3 - Math.min(y, 15 - y));
                const mask = tile & 16 ? (0xFF << inset) : (0xFF >> inset);
                patterns[columnTile + row] = (high | ~low) & mask;
                patterns[columnTile + 8 + row] = (low | ~high) & mask;
            }
        }
        // Two contracted versions of the original ring, for the neutral
        // changeover. Sample whole pixels to keep the ring and fill opaque.
        for (const [frame, size] of [[4, 10], [5, 6]]) {
            const inset = (16 - size) / 2;
            for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
                const sx = Math.floor((x + 0.5) * 16 / size), sy = Math.floor((y + 0.5) * 16 / size);
                const src = ((sx >> 3) * 2 + (sy >> 3)) * 16 + (sy & 7);
                const dx = x + inset, dy = y + inset;
                const dst = frame * 64 + ((dx >> 3) * 2 + (dy >> 3)) * 16 + (dy & 7);
                for (const plane of [0, 8]) if (patterns[src + plane] & (0x80 >> (sx & 7)))
                    patterns[dst + plane] |= 0x80 >> (dx & 7);
            }
        }
        return patterns;
    }

    static getPortalPatterns(schemes) {
        const base = Romfix.getPortalBasePatterns();
        const patterns = new Uint8Array(Romfix.SCENE_GRAPHICS_LAYOUT.portalTileCount * 16);
        patterns.set(base, (Romfix.SCENE_GRAPHICS_LAYOUT.portalEntryStart - Romfix.SCENE_GRAPHICS_LAYOUT.portalStart) * 16);
        const digits = [[2, 6, 2, 2, 7], [7, 1, 7, 4, 7], [7, 1, 7, 1, 7], [5, 5, 7, 1, 1]];
        for (let group = 0; group < 4; group++) for (let frame = 0; frame < 6; frame++) {
            const left = Romfix.getPortalFrameTiles(group, frame)[0] - Romfix.SCENE_GRAPHICS_LAYOUT.portalStart;
            patterns.set(base.subarray(frame * 64, frame * 64 + 32), left * 16);
            // Both the 3x5 glyph and its 1px margin are opaque, even on a
            // stone. The badge stays the same size during the contracted poses.
            const {badgeInk, badgePaper} = schemes[group];
            for (let y = 0; y < 7; y++) {
                const glyph = y >= 1 && y <= 5 ? digits[group][y - 1] << 4 : 0;
                for (let plane = 0; plane < 2; plane++) {
                    const at = left * 16 + y + plane * 8;
                    const ink = badgeInk & (1 << plane) ? glyph : 0;
                    const paper = badgePaper & (1 << plane) ? 0xF8 ^ glyph : 0;
                    patterns[at] = (patterns[at] & 7) | ink | paper;
                }
            }
        }
        // Copy each group's badge onto the upper-left rim; the interior
        // remains ink zero in both the background and the 8x16 overlay.
        const start = Romfix.SCENE_GRAPHICS_LAYOUT.portalStart;
        for (let group = 0; group < 4; group++) {
            const tiles = Romfix.getPortalFrameTiles(group, 6);
            const badge = (Romfix.getPortalFrameTiles(group, 0)[0] - start) * 16;
            for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
                const side = Math.min(x, 15 - x), end = Math.min(y, 15 - y);
                const bit = 0x80 >> (x & 7);
                const pos = (tiles[(y >> 3) * 2 + (x >> 3)] - start) * 16 + (y & 7);
                if (x < 5 && y < 7) {
                    patterns[pos] |= patterns[badge + y] & bit;
                    patterns[pos + 8] |= patterns[badge + y + 8] & bit;
                } else if (side + end === 3 || (side + end > 3 && (side === 0 || end === 0))) {
                    patterns[pos] |= bit;
                }
            }
        }
        return patterns;
    }

    static addSpritePortalPreview(romData, isExpanded = false) {
        if (!isExpanded) throw new Error('Sprite portal requires an expanded ROM');
        const transport = Romfix.addPortalTransport(romData);
        const ram = Romfix.PORTAL_RAM;
        const base = 0xFB00, limit = 0xFBEF; // $FBEF–$FBFF belongs to the scene compiler.
        const file = cpu => cpu - 0x8000 + 16 + (cpu >= 0xC000 ? 6 * 0x4000 : 0);
        if (romData.subarray(file(base), file(limit)).some(byte => byte !== 0))
            throw new Error('Reserved portal area is occupied');
        // Chain the existing bird/fish metasprite extension, without taking
        // over its frames or any native metasprite definitions.
        const priorRenderer = romData[file(0x8932)] === 0x4C
            ? romData[file(0x8933)] | romData[file(0x8934)] << 8 : null;
        const bytes = [], labels = new Map(), refs = [];
        const emit = (...values) => bytes.push(...values);
        const label = name => labels.set(name, base + bytes.length);
        const absolute = (op, target) => { emit(op); refs.push({at: bytes.length, target}); emit(0, 0); };
        const branch = (op, target) => { emit(op); refs.push({at: bytes.length, target, relative: true}); emit(0); };

        label('dispatch');
        emit(0xC9, 0x0D); branch(0xF0, 'portalTick');
        absolute(0x4C, 0xFD00);
        label('portalTick'); absolute(0x20, 'tick'); absolute(0x4C, 0xA9B3);

        label('initialize');
        emit(0xBD, 0xFE, 0x04, 0xC9, 0x0D); branch(0xF0, 'initializePortal');
        absolute(0x4C, 0xBCFE);
        label('initializePortal');
        emit(0xA9, 0x00); absolute(0x20, 'transport');
        absolute(0x20, 'draw'); absolute(0x4C, 0xBD39);

        // Pair state, reverse animation, and validated transport live in bank 1.
        label('tick');
        emit(0xA9, 0x01); absolute(0x20, 'transport');
        label('draw');
        // Only a successful departure starts the 30-tick pair lock. Use
        // its first 16 ticks to show three closing poses from native defeat.
        absolute(0xBD, ram.role); branch(0xD0, 'ordinaryDraw');
        absolute(0xBD, ram.cooldown); emit(0xC9, 15); branch(0x90, 'ordinaryDraw');
        emit(0xA0, 13, 0xC9, 19); branch(0x90, 'departurePose'); emit(0x88, 0xC9, 27);
        branch(0x90, 'departurePose'); emit(0x88);
        label('departurePose'); absolute(0xB9, 0xC379); absolute(0x4C, 'projectMeta');
        label('ordinaryDraw'); absolute(0xBD, ram.overlay); branch(0xD0, 'drawOverlay');
        emit(0x9D, 0x15, 0x04, 0x60);
        label('drawOverlay');
        absolute(0xBD, ram.group); emit(0x85, 0, 0x0A, 0x0A, 0x0A, 0x38, 0xE5, 0, 0x18);
        absolute(0x7D, ram.visual);
        emit(0x18, 0x69, 0x2F); label('projectMeta'); emit(0x9D, 0x15, 0x04);
        absolute(0x4C, 0xAE54); // Native camera projection and off-screen clipping.

        label('render');
        emit(0xC9, 0x2F); branch(0x90, 'previousRender');
        emit(0xC9, 0x4B); branch(0xB0, 'previousRender');
        // Odd tile IDs select $1000 CHR in 8x16 mode. Each pair is now
        // top/bottom of a column: $C1/$C3, $C5/$C7, $C9/$CB, $CD/$CF.
        emit(0x38, 0xE9, 0x2F, 0xA8);
        absolute(0xB9, transport.leftTiles); emit(0x85, 0x10);
        absolute(0xB9, transport.rightTiles); emit(0x85, 0x11,
            0xA9, 0x00, 0x85, 0x12, 0x85, 0x13, 0x85, 0x0F);
        absolute(0x4C, 0x8951); // Native two-column OAM writer (incl. edge clipping).
        label('previousRender');
        if (priorRenderer !== null) absolute(0x4C, priorRenderer);
        else {
            emit(0x0A); branch(0xB0, 'largeRender');
            absolute(0x4C, 0x8935);
            label('largeRender'); absolute(0x4C, 0x8991);
        }

        label('camera');
        absolute(0xAD, ram.panTicks); branch(0xD0, 'panCamera');
        absolute(0x4C, 0x9B38);
        label('panCamera');
        // Get the target from the installed camera (NORMAL/LOOP, narrow/wide).
        // Keep NMI from displaying the target before the worker blends it.
        emit(0xA5, 0xFF, 0x29, 0x7F, 0x8D, 0, 0x20);
        absolute(0x20, 0x9B38); emit(0xA9, 2); // fall through to bank 1

        label('transport');
        absolute(0x8D, ram.mode); absolute(0x8E, ram.owner);
        // Hold NMI only during the bank-1 RAM worker. Clear a missed vblank
        // before restoring PPUCTRL, so its drawing cannot start late. Normal
        // NMIs keep their original budget (native exit rendering is tight).
        emit(0xA5, 0xFF, 0x29, 0x7F, 0x8D, 0x00, 0x20);
        emit(0xA9, 0x01); absolute(0x8D, ram.bankActive); emit(0x8D, 0x00, 0x80);
        absolute(0x20, transport.start);
        emit(0xA9, 0x00, 0x8D, 0x00, 0x80); absolute(0x8D, ram.bankActive);
        emit(0x2C, 0x02, 0x20, 0xA5, 0xFF, 0x8D, 0x00, 0x20);
        absolute(0xAD, ram.command); branch(0xF0, 'transportDone');
        absolute(0x20, transport.paint);
        absolute(0xAE, ram.destination); absolute(0x20, 'draw');
        label('transportDone'); absolute(0xAE, ram.owner); emit(0x60);

        // Capture bits 4/5 before the native loader masks the type to 0..15.
        label('loadGroup'); emit(0x48, 0x29, 0x30, 0x4A, 0x4A, 0x4A, 0x4A);
        absolute(0x9D, ram.group); emit(0x68, 0x29, 0x0F, 0x9D, 0xFE, 0x04, 0x60);

        if (base + bytes.length > limit) throw new Error('Portal exceeds its code reservation');
        for (const ref of refs) {
            const target = typeof ref.target === 'number' ? ref.target : labels.get(ref.target);
            if (target === undefined) throw new Error(`Unknown portal label: ${ref.target}`);
            if (ref.relative) {
                const distance = target - base - ref.at - 1;
                if (distance < -128 || distance > 127) throw new Error(`Portal branch too far: ${ref.target}`);
                bytes[ref.at] = distance & 255;
            } else { bytes[ref.at] = target & 255; bytes[ref.at + 1] = target >> 8; }
        }
        Romfix.fixCodeInsert(romData, file(base), bytes);
        for (const [hook, name] of [[0xA978, 'dispatch'], [0xBCFB, 'initialize'], [0x8932, 'render']]) {
            const target = labels.get(name);
            Romfix.fixCodeInsert(romData, file(hook), [0x4C, target & 255, target >> 8]);
        }
        Romfix.fixCodeInsert(romData, file(0xADDB), [0x20, labels.get('loadGroup') & 255, labels.get('loadGroup') >> 8, 0xEA, 0xEA]);
        Romfix.fixCodeInsert(romData, file(0x9420), [0x20, labels.get('camera') & 255, labels.get('camera') >> 8]);
        return {start: base, end: base + bytes.length, labels: Object.fromEntries(labels), transport};
    }

    /** Bank-1 portal worker: no bank-0 calls and no direct PPU access. */
    static addPortalTransport(romData) {
        const r = Romfix.PORTAL_RAM;
        const parts = [], labels = new Map(), refs = []; let part;
        const org = (base, limit, file) => { part = {base, limit, file, bytes: []}; parts.push(part); };
        const emit = (...values) => part.bytes.push(...values);
        const label = name => labels.set(name, part.base + part.bytes.length);
        const abs = (op, target) => { emit(op); refs.push({part, at: part.bytes.length, target}); emit(0, 0); };
        const branch = (op, target) => { emit(op); refs.push({part, at: part.bytes.length, target, relative: true}); emit(0); };
        // Long conditional jumps keep the validation exits readable.
        const jumpIf = (op, target) => { emit(op ^ 0x20, 3); abs(0x4C, target); };
        const lda = address => abs(0xAD, address), sta = address => abs(0x8D, address);
        const lx = address => abs(0xBD, address), sx = address => abs(0x9D, address);
        const ly = address => abs(0xB9, address);
        const jsr = target => abs(0x20, target);

        // File $6910-$800F is unused bank 1, after pause and credit fonts.
        org(0xA900, 0xC000, 0x6910);
        label('entry');
        emit(0xA9, 0); sta(r.command); lda(r.mode); branch(0xF0, 'initialize');
        emit(0xC9, 2); jumpIf(0xF0, 'panStep');
        jsr('tick'); abs(0x4C, 'appearance');
        label('initialize');
        emit(0xA9, 0x00, 0x9D, 0x5E, 0x05, 0x9D, 0x66, 0x05,
            0xA9, 0x80, 0x9D, 0x4E, 0x05, // No contact damage, rescue, or native AI.
            0xA9, 0x01, 0x9D, 0x06, 0x05,
            // Native grid anchors include the scene's eight-pixel Y offset.
            0xBD, 0x76, 0x05, 0x29, 0xF0, 0x09, 0x08, 0x9D, 0x16, 0x05,
            0xBD, 0x76, 0x05, 0x29, 0x0F, 0x0A, 0x0A, 0x0A, 0x0A, 0x09, 0x08, 0x9D, 0x33, 0x04);
        emit(0xA9, 0xFF); sx(r.partner); emit(0xA9, 0); sta(r.count);
        lx(r.group); emit(0x85, 0x00, 0xA0, 0);
        label('findPartner');
        emit(0x98); abs(0xCD, r.owner); branch(0xF0, 'nextPartner');
        ly(0x4FE); emit(0xC9, 13); branch(0xD0, 'nextPartner');
        ly(r.group); emit(0xC5, 0); branch(0xD0, 'nextPartner');
        emit(0x98); sx(r.partner); abs(0xEE, r.count);
        label('nextPartner'); emit(0xC8, 0xC0, 8); branch(0xD0, 'findPartner');
        lda(r.count); emit(0xC9, 1); branch(0xF0, 'validPair');
        emit(0xA9, 0xFF); sx(r.partner);
        label('validPair');
        // Records load from slot 7 downward; the first placed portal starts
        // as entry, regardless of its legacy facing bit.
        emit(0x8A); abs(0xDD, r.partner); emit(0xA9, 0); branch(0xB0, 'initialRole'); emit(0xA9, 1);
        label('initialRole'); sx(r.role);
        emit(0xA9, 44); sx(r.clockLow); emit(0xA9, 1); sx(r.clockHigh);
        emit(0xA9, 0); sx(r.cooldown);
        emit(0xA5, 0x3E, 0x0A, 0x0A, 0x85, 0); lx(r.group); emit(0x05, 0, 0xA8);
        ly('spritePalettes'); sx(0x46F);
        emit(0xA9, 1); sx(r.overlay); emit(0xA9, 0xFF); sx(r.backgroundFrame);
        emit(0x8A); sta(r.drawCursor); abs(0x4C, 'appearance');

        label('tick');
        lx(r.clockLow); branch(0xD0, 'clockLow'); abs(0xDE, r.clockHigh);
        label('clockLow'); abs(0xDE, r.clockLow); lx(r.clockLow); abs(0x1D, r.clockHigh);
        branch(0xD0, 'animate');
        emit(0xA9, 44); sx(r.clockLow); emit(0xA9, 1); sx(r.clockHigh);
        lx(r.role); emit(0x49, 1); sx(r.role);
        emit(0xA9, 0); sx(0x55E);
        label('animate');
        emit(0xFE, 0x66, 0x05, 0xBD, 0x66, 0x05, 0x29, 7, 0x9D, 0x66, 0x05);
        branch(0xD0, 'cooldown'); lx(r.role); branch(0xF0, 'forward');
        emit(0xBD, 0x5E, 0x05, 0x38, 0xE9, 1); abs(0x4C, 'phase');
        label('forward'); emit(0xBD, 0x5E, 0x05, 0x18, 0x69, 1);
        label('phase'); emit(0x29, 3, 0x9D, 0x5E, 0x05);
        label('cooldown'); lx(r.cooldown); branch(0xF0, 'ready'); abs(0xDE, r.cooldown); emit(0x60);
        label('ready');
        lx(r.clockHigh); branch(0xD0, 'active');
        lx(r.clockLow); emit(0xC9, 61); jumpIf(0x90, 'done');
        label('active');
        lx(r.partner); emit(0xC9, 8); jumpIf(0xB0, 'done'); sta(r.destination);
        lx(r.role); jumpIf(0xD0, 'done');
        emit(0xA5, 0x56, 0xC9, 3); jumpIf(0xD0, 'done');
        // Scratch $04/$0A hold a candidate's kind/slot only during this scan.
        emit(0xA9, 0, 0x85, 4);
        jsr('coordinates'); emit(0xA5, 0); sta(r.sourceX); emit(0xA5, 1); sta(r.sourceY);
        emit(0xC9, 14); jumpIf(0xB0, 'done');
        abs(0xAE, r.destination); jsr('coordinates'); emit(0xA5, 0); sta(r.targetX); emit(0xA5, 1); sta(r.targetY);
        emit(0xC9, 14); jumpIf(0xB0, 'done');
        jsr('getTile'); jumpIf(0xD0, 'done');
        // Tile objects in flight have left map RAM. Defer when their cached
        // grid cell overlaps either endpoint. $FF is a stationary support
        // watcher, not a falling object; it is retired when its stone moves.
        emit(0xA0, 9);
        label('fallingCheck'); ly(0x4C0); branch(0xF0, 'nextFalling');
        emit(0xC9, 0xFF); branch(0xF0, 'nextFalling');
        ly(0x4D4); emit(0x4A); abs(0xCD, r.targetX); branch(0xD0, 'checkSourceFall');
        lda(r.targetY); emit(0x0A, 0x38); abs(0xF9, 0x4DE);
        emit(0x18, 0x69, 1, 0xC9, 3); jumpIf(0x90, 'done');
        label('checkSourceFall'); ly(0x4D4); emit(0x4A); abs(0xCD, r.sourceX); branch(0xD0, 'nextFalling');
        lda(r.sourceY); emit(0x0A); abs(0xD9, 0x4DE); branch(0xD0, 'nextFalling');
        // At a full-cell boundary a falling background object has exactly
        // one cell to erase. Its countdown owns the tile until state 1.
        ly(0x4C0); emit(0xC9, 1); jumpIf(0xD0, 'done');
        emit(0xA9, 1, 0x85, 4, 0x84, 0x0A);
        label('nextFalling'); emit(0x88); branch(0x10, 'fallingCheck');
        // Scan all independent object pools before committing any transfer.
        const point = (x, page, y) => {
            ly(x); emit(0x85, 0); ly(page); emit(0x85, 1); ly(y); emit(0x85, 2);
        };
        const candidate = kind => {
            jsr('atSource'); emit(0xF0, 6, 0xA9, kind, 0x85, 4, 0x84, 0x0A);
            jsr('overlap'); jumpIf(0xD0, 'done');
        };
        emit(0xA0, 7);
        label('creatureCheck'); ly(0x4FE); branch(0xF0, 'nextCreature'); emit(0xC9, 13); branch(0xF0, 'nextCreature');
        emit(0xC9, 9); branch(0xD0, 'mobileEnemy');
        // The statue installs two solid map nibbles. Never detach its
        // collision tiles from the fixed background emitter.
        point(0x516, 0x50E, 0x433); jsr('atSource'); jumpIf(0xD0, 'done');
        emit(0xA5, 2, 0x38, 0xE9, 16, 0x85, 2); jsr('atSource'); jumpIf(0xD0, 'done');
        abs(0x4C, 'nextCreature');
        label('mobileEnemy'); ly(0x506); branch(0xF0, 'nextCreature'); emit(0xC9, 10); branch(0xB0, 'nextCreature');
        point(0x516, 0x50E, 0x433); candidate(2);
        label('nextCreature'); emit(0x88); branch(0x10, 'creatureCheck');
        const pools = [
            {name:'loose', kind:3, last:2, active:0x4F2, x:0x4F8, page:0x4F5, y:0x430, screenX:0x44E},
            {name:'missile', kind:4, last:0, active:0x8B, x:0x8D, page:0x8C, y:0x43B, screenX:0x459},
            {name:'bomb', kind:5, last:1, active:0x4A8, x:0x4B0, page:0x4AC, y:0x42B, screenX:0x449},
        ];
        for (const pool of pools) {
            emit(0xA0, pool.last); label(pool.name + 'Scan');
            ly(pool.active); branch(0xF0, pool.name + 'Next');
            point(pool.x, pool.page, pool.y);
            if (pool.kind === 5) {
                ly(pool.active); emit(0xC9, 11); branch(0x90, 'bombPoint');
                ly(0x4B4); emit(0x38, 0xE9, 8, 0x85, 2); label('bombPoint');
            }
            if (pool.kind === 3) {
                // Armed falling traps still own their original map cell.
                ly(0x4FB); emit(0xC9, 0xFF); branch(0xD0, 'loosePoint');
                jsr('atSource'); jumpIf(0xD0, 'done'); label('loosePoint');
            }
            candidate(pool.kind);
            label(pool.name + 'Next'); emit(0x88); branch(0x10, pool.name + 'Scan');
        }
        emit(0xA5, 0xC0, 0xC9, 3); branch(0xD0, 'sourceCell');
        emit(0xA0, 0); point(0xDE, 0xDD, 0x430); candidate(6);
        label('sourceCell');
        lda(r.sourceX); emit(0x85, 0); lda(r.sourceY); emit(0x85, 1); jsr('getTile');
        branch(0xF0, 'emptySource'); sta(r.count); emit(0xA9, 0, 0x85, 4); abs(0x4C, 'tileCargo');
        label('emptySource'); emit(0xA5, 4); jumpIf(0xD0, 'objectCargo');
        // Players enter automatically once centered in an active entry.
        emit(0xA5, 0x7D); jumpIf(0xD0, 'done');
        emit(0xA5, 0xC0); jumpIf(0xF0, 'done'); // Respawn has not initialized the player yet.
        emit(0xC9, 3); jumpIf(0xB0, 'done');
        abs(0xAE, r.owner);
        // Player center must be within four pixels of the entry's anchor.
        emit(0x38, 0xA5, 0xC2, 0xFD, 0x16, 0x05, 0x85, 0,
            0xA5, 0xC1, 0xFD, 0x0E, 0x05, 0x85, 1,
            0x18, 0xA5, 0, 0x69, 4, 0x85, 0, 0xA5, 1, 0x69, 0, 0x25, 0x3D);
        jumpIf(0xD0, 'done'); emit(0xA5, 0, 0xC9, 9); jumpIf(0xB0, 'done');
        emit(0x38, 0xAD, 0x1E, 0x04, 0xFD, 0x33, 0x04, 0x18, 0x69, 4, 0xC9, 9); jumpIf(0xB0, 'done');
        abs(0xAE, r.destination);
        emit(0xBD, 0x16, 0x05, 0x85, 0xC2, 0xBD, 0x0E, 0x05, 0x85, 0xC1,
            0xBD, 0x33, 0x04, 0x8D, 0x1E, 0x04, 0xA9, 0);
        for (const address of [0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xDC, 0x7D, 0x5B, 0x52, 0xDA, 0xA6, 0xD4]) emit(0x85, address);
        // Native action 0 respawns at the level start; action 1 resumes
        // standing/walking and checks support at the new location.
        emit(0xA9, 1, 0x85, 0xC0);
        // Detach a carrier immediately; other birds keep their own motion.
        emit(0xA0, 7);
        label('detach'); ly(0x4FE); emit(0xC9, 12); branch(0xD0, 'nextDetach');
        emit(0xA9, 0, 0x99, 0x3E, 0x05);
        label('nextDetach'); emit(0x88); branch(0x10, 'detach');
        emit(0xA5, 0xFD); sta(r.panLow); emit(0xA5, 0x9D); sta(r.panHigh);
        // The portal takes over any stage-entry camera transition.
        emit(0xA5, 0x2A, 0x29, 0x7F, 0x85, 0x2A, 0xA9, 16); sta(r.panTicks);
        // Projection for this tick was already built at the entrance. The
        // next native player update projects the arrival against the pan.
        emit(0xA9, 0); sta(0x400); abs(0x4C, 'lock');

        label('objectCargo');
        jsr('playerBlocks'); jumpIf(0xD0, 'done');
        emit(0xA4, 0x0A, 0xA5, 4, 0xC9, 1); branch(0xD0, 'movingCargo');
        ly(0x4CA); sta(r.count); abs(0x4C, 'tileCargo');
        label('movingCargo'); emit(0xC9, 6); branch(0xD0, 'liveCargo');
        emit(0xA9, 10); sta(r.count); abs(0x4C, 'tileCargo');
        label('liveCargo');
        abs(0xAE, r.destination);
        for (const pool of pools) {
            emit(0xC9, pool.kind); branch(0xD0, pool.name + 'Other');
            lx(0x516); abs(0x99, pool.x); emit(0x38, 0xE5, 0xFD); abs(0x99, pool.screenX);
            lx(0x50E); abs(0x99, pool.page); lx(0x433); abs(0x99, pool.y);
            if (pool.kind === 5) { emit(0x18, 0x69, 8); abs(0x99, 0x4B4); }
            abs(0x4C, 'lock'); label(pool.name + 'Other');
        }
        // Keep the enemy's live slot, velocity, AI state and respawn record.
        ly(0x4FE);
        for (const type of [3, 7, 8, 10]) { emit(0xC9, type); branch(0xF0, 'tallCargo'); }
        abs(0x4C, 'enemyHeightReady');
        label('tallCargo');
        lda(r.targetX); emit(0x85, 0); lda(r.targetY); jumpIf(0xF0, 'done');
        emit(0x85, 1, 0xC6, 1); jsr('getTile'); jumpIf(0xD0, 'done');
        ly(0x4FE); emit(0xC9, 7); branch(0xD0, 'enemyHeightReady');
        // A 32px boss also needs clearance on either side of its anchor.
        for (const delta of [1, -1]) {
            emit(0xA5, 0x3D, 0x0A, 0x0A, 0x0A, 0x0A, 0x09, 15, 0x85, 3);
            lda(r.targetX); emit(0x18, 0x69, delta & 255, 0x25, 3, 0x85, 0);
            lda(r.targetY); emit(0x85, 1); jsr('getTile'); jumpIf(0xD0, 'done');
            emit(0xC6, 1); jsr('getTile'); jumpIf(0xD0, 'done');
        }
        label('enemyHeightReady'); abs(0xAE, r.destination);
        ly(0x4FE); emit(0xC9, 12); branch(0xD0, 'enemyPosition');
        lx(0x433); abs(0x99, 0x546);
        emit(0xA9, 0);
        for (const address of [0x53E, 0x56E, 0x57E, ...Object.values(Romfix.BIRD_RAM)]) abs(0x99, address);
        label('enemyPosition');
        lx(0x516); abs(0x99, 0x516); emit(0x38, 0xE5, 0xFD); abs(0x99, 0x451);
        lx(0x50E); abs(0x99, 0x50E); lx(0x433); abs(0x99, 0x433);
        abs(0x4C, 'lock');

        label('tileCargo');
        // Both redraw packets must fit together. At most one pair transfers
        // a stone per empty queue; nothing is removed while the queue is busy.
        emit(0xA5, 0x1E); jumpIf(0xD0, 'done');
        jsr('playerBlocks'); jumpIf(0xD0, 'done');
        emit(0xA4, 0x0A, 0xA5, 4, 0xC9, 1); branch(0xD0, 'checkPush');
        emit(0xA9, 0, 0x99, 0xC0, 4);
        label('checkPush'); emit(0xA5, 4, 0xC9, 6); branch(0xD0, 'watchers');
        emit(0xA9, 1, 0x85, 0xC0, 0xA9, 0, 0x85, 0xDF); sta(0x412);
        label('watchers');
        emit(0xA0, 9);
        label('retireWatcher'); ly(0x4C0); emit(0xC9, 0xFF); branch(0xD0, 'nextWatcher');
        ly(0x4D4); emit(0x4A); abs(0xCD, r.sourceX); branch(0xD0, 'nextWatcher');
        ly(0x4DE); emit(0x4A); abs(0xCD, r.sourceY); branch(0xD0, 'nextWatcher');
        emit(0xA9, 0, 0x99, 0xC0, 4);
        label('nextWatcher'); emit(0x88); branch(0x10, 'retireWatcher');
        lda(r.sourceX); emit(0x85, 0); lda(r.sourceY); emit(0x85, 1, 0xA9, 0); jsr('setTile');
        lda(r.targetX); emit(0x85, 0); lda(r.targetY); emit(0x85, 1); lda(r.count); jsr('setTile');
        // Native stone painting replaces both background cells. Retain an
        // overlay until the vacated portal has been painted again.
        for (const slot of [r.owner, r.destination]) {
            abs(0xAE, slot); emit(0xA9, 0xFF); sx(r.backgroundFrame);
            emit(0xA9, 1); sx(r.overlay);
        }
        emit(0xA9, 1); sta(r.command);
        label('lock');
        abs(0xAE, r.owner); emit(0xA9, 30); sx(r.cooldown);
        abs(0xAE, r.destination); sx(r.cooldown);
        label('done'); abs(0xAE, r.owner); emit(0x60);

        label('appearance'); abs(0xAE, r.owner);
        lx(r.partner); emit(0xC9, 8); branch(0xB0, 'animatedPose');
        lx(r.role); branch(0xF0, 'animatedPose');
        emit(0xA9, 6); sx(r.visual); abs(0x4C, 'probeCover');
        label('animatedPose'); lx(0x55E); sx(r.visual);
        // Last second: the entry contracts, holds, then expands. Both ends are neutral and
        // transport is disabled until the next direction becomes active.
        lx(r.clockHigh); branch(0xD0, 'probeCover');
        lx(r.clockLow); emit(0xC9, 61); branch(0xB0, 'probeCover');
        emit(0xA0, 4, 0xC9, 17); branch(0x90, 'transitionFrame');
        emit(0xC9, 45); branch(0xB0, 'transitionFrame'); emit(0xC8);
        label('transitionFrame'); emit(0x98); sx(r.visual);
        label('probeCover');
        jsr('coordinates'); emit(0xA5, 0, 0x85, 8, 0xA5, 1, 0x85, 9, 0xC9, 14);
        jumpIf(0xB0, 'done');
        // Paint legacy overlaps into the background even when occupied: the
        // exit cutscene hides sprites. Its cell writer preserves these cells.
        emit(0xA5, 0x8A, 0xC9, 14); branch(0xB0, 'checkTerrain');
        emit(0xA5, 9, 0x38, 0xE5, 0x8A, 0x18, 0x69, 1, 0xC9, 2); branch(0xB0, 'checkTerrain');
        emit(0xA5, 8, 0x38, 0xE5, 0x89, 0x18, 0x69, 1, 0xC9, 2); jumpIf(0x90, 'paintPortal');
        label('checkTerrain');
        jsr('getTile'); jumpIf(0xD0, 'covered');
        // Falling metatiles are drawn in the background even while absent
        // from map RAM; a half-step can overlap two portal rows.
        emit(0xA0, 9);
        label('coverFall'); ly(0x4C0); branch(0xF0, 'nextCoverFall'); emit(0xC9, 0xFF); branch(0xF0, 'nextCoverFall');
        ly(0x4D4); emit(0x4A, 0xC5, 8); branch(0xD0, 'nextCoverFall');
        ly(0x4DE); emit(0x4A, 0xC5, 9); jumpIf(0xF0, 'covered');
        ly(0x4DE); emit(0x29, 1); branch(0xF0, 'nextCoverFall');
        ly(0x4DE); emit(0x4A, 0x18, 0x69, 1, 0xC5, 9); jumpIf(0xF0, 'covered');
        label('nextCoverFall'); emit(0x88); branch(0x10, 'coverFall');
        label('paintPortal'); abs(0xAE, r.owner);
        // Retain the overlay until a replacement background packet is
        // queued. Busy native effects must never make an uncovered door vanish.
        emit(0x8A); abs(0xCD, r.drawCursor); jumpIf(0xD0, 'done');
        lx(r.backgroundFrame); abs(0xDD, r.visual); jumpIf(0xF0, 'advanceDraw');
        lda(r.command); emit(0xC9, 1); jumpIf(0xF0, 'done');
        emit(0xA5, 0x1E); jumpIf(0xD0, 'done');
        // Leave one tick in eight free of decorative portal packets. With
        // four pairs, lower slots must still get an empty queue to move rocks.
        emit(0xA5, 0x1B, 0x29, 7); jumpIf(0xF0, 'done');
        lx(r.visual); sx(r.backgroundFrame); emit(0xA9, 0); sx(r.overlay);
        emit(0xA5, 0x3E, 0x0A, 0x0A, 0x85, 0x0C); lx(r.group); emit(0x05, 0x0C, 0x85, 0x0C);

        // Emit one native 16-byte metatile packet, including its own 16x16
        // palette quadrant. The existing LOOP queue mirrors the whole packet.
        emit(0xA5, 8, 0x29, 15, 0x4A, 0x85, 2,
            0xA5, 9, 0x29, 0xFE, 0x0A, 0x0A, 0x05, 2, 0x85, 2,
            0xA5, 8, 0x29, 16, 0x0A, 0x0A, 0x05, 2, 0xAA, 0x86, 3,
            0xA5, 8, 0x29, 1, 0x85, 2, 0xA5, 9, 0x29, 1, 0x0A, 0x05, 2, 0x85, 5,
            0xA4, 0x0C); abs(0xB9, 'backgroundPalettes'); emit(0xA4, 5, 0xC0, 0);
        branch(0xF0, 'shiftedPalette');
        label('shiftPalette'); emit(0x0A, 0x0A, 0x88); branch(0xD0, 'shiftPalette');
        label('shiftedPalette'); emit(0x85, 0x0D, 0xA4, 5, 0xBD, 0x80, 6);
        abs(0x39, 'attributeMasks'); emit(0x05, 0x0D, 0x9D, 0x80, 6); sta(0x304);
        emit(0xA9, 6); sta(0x300); emit(0xA9, 1); sta(0x303);
        emit(0xA5, 3, 0x29, 0x3F, 0x09, 0xC0); sta(0x302);
        emit(0xA5, 8, 0x29, 16, 0x4A, 0x4A, 0x09, 0x20, 0x85, 0x0F, 0x09, 3); sta(0x301);
        emit(0xA5, 9, 0x4A, 0x4A, 0x05, 0x0F); sta(0x305); sta(0x30A);
        emit(0xA5, 8, 0x29, 15, 0x0A, 0x85, 0x0E,
            0xA5, 9, 0x29, 3, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x0A, 0x05, 0x0E);
        sta(0x306); emit(0x09, 32); sta(0x30B);
        emit(0xA9, 2); sta(0x307); sta(0x30C);
        abs(0xAE, r.owner); lx(r.group); emit(0x85, 0, 0x0A, 0x0A, 0x0A, 0x38, 0xE5, 0, 0x18);
        abs(0x7D, r.visual); emit(0xA8);
        ly('leftTiles'); emit(0x29, 0xFE); sta(0x308); emit(0x09, 1); sta(0x30D);
        ly('rightTiles'); emit(0x29, 0xFE); sta(0x309); emit(0x09, 1); sta(0x30E);
        emit(0xA9, 0xFF); sta(0x30F); emit(0xA9, 16, 0x85, 0x1E);
        abs(0x4C, 'advanceDraw');

        label('covered'); abs(0xAE, r.owner);
        emit(0xA9, 1); sx(r.overlay); emit(0xA9, 0xFF); sx(r.backgroundFrame);
        emit(0x8A); abs(0xCD, r.drawCursor); jumpIf(0xD0, 'done');
        // A blocked/busy portal cannot permanently starve a later slot.
        label('advanceDraw'); abs(0xAE, r.owner);
        label('nextDrawSlot'); emit(0x8A, 0x38, 0xE9, 1, 0x29, 7, 0xAA);
        lx(0x4FE); emit(0xC9, 13); branch(0xD0, 'nextDrawSlot');
        emit(0x8A); sta(r.drawCursor); abs(0x4C, 'done');

        label('coordinates');
        emit(0xBD, 0x0E, 0x05, 0x25, 0x3D, 0x0A, 0x0A, 0x0A, 0x0A, 0x85, 0,
            0xBD, 0x76, 0x05, 0x4A, 0x4A, 0x4A, 0x4A, 0x05, 0, 0x85, 0,
            0xBD, 0x76, 0x05, 0x29, 15, 0x85, 1, 0x60);
        // X is scratch inside these helpers; owner is restored at return.
        label('getTile');
        emit(0xA5, 0, 0x4A, 0x85, 2, 0xA5, 1, 0x0A, 0x0A, 0x0A, 0x0A, 0x18, 0x65, 2, 0xAA,
            0xA5, 0, 0x4A, 0xBD, 0x00, 0x07); branch(0xB0, 'lowNibble');
        emit(0x4A, 0x4A, 0x4A, 0x4A);
        label('lowNibble'); emit(0x29, 15, 0x60);
        label('setTile');
        emit(0x85, 3, 0xA5, 0, 0x4A, 0x85, 2, 0xA5, 1, 0x0A, 0x0A, 0x0A, 0x0A, 0x18, 0x65, 2, 0xAA,
            0xA5, 0, 0x4A, 0xA9, 0xF0); branch(0xB0, 'mergeTile');
        emit(0x06, 3, 0x06, 3, 0x06, 3, 0x06, 3, 0xA9, 15);
        label('mergeTile'); emit(0x3D, 0x00, 0x07, 0x05, 3, 0x9D, 0x00, 0x07, 0x60);

        // Move one remaining share of the shortest distance on the 256/512
        // pixel map. Re-read the native target so walking at the exit and
        // clamped viewport edges are handled by the installed camera.
        label('panStep'); lda(r.panTicks); emit(0xC9, 1); branch(0xF0, 'panDone');
        emit(0x38, 0xA5, 0xFD); abs(0xED, r.panLow); emit(0x85, 0, 0xA5, 0x3D);
        branch(0xF0, 'narrowDelta');
        emit(0xA5, 0x9D); abs(0xED, r.panHigh); emit(0x4A); abs(0x4C, 'deltaSign');
        label('narrowDelta'); emit(0xA5, 0, 0x0A);
        label('deltaSign'); emit(0xA0, 0, 0x84, 1, 0x84, 2); branch(0x90, 'dividePan');
        emit(0xE6, 2, 0xA9, 0, 0x38, 0xE5, 0, 0x85, 0);
        branch(0x90, 'dividePan'); emit(0xE6, 1); // Magnitude 256 on a wide map.
        label('dividePan'); emit(0xA5, 0, 0x38); abs(0xED, r.panTicks);
        branch(0xB0, 'countStep'); emit(0xC6, 1); branch(0x30, 'applyStep');
        label('countStep'); emit(0x85, 0, 0xC8); abs(0x4C, 'dividePan');
        label('applyStep'); emit(0x84, 0, 0xA5, 2); branch(0xD0, 'panLeft');
        lda(r.panLow); emit(0x18, 0x65, 0, 0x85, 0xFD); lda(r.panHigh); emit(0x69, 0);
        abs(0x4C, 'panPage');
        label('panLeft'); lda(r.panLow); emit(0x38, 0xE5, 0, 0x85, 0xFD); lda(r.panHigh); emit(0xE9, 0);
        label('panPage'); emit(0x25, 0x3D, 0x85, 0x9D); sta(r.panHigh);
        emit(0xA5, 0xFD); sta(r.panLow);
        emit(0xA5, 0xFF, 0x29, 0xFE, 0x05, 0x9D, 0x85, 0xFF);
        label('panDone'); abs(0xCE, r.panTicks); emit(0x60);

        label('atSource');
        emit(0xA5, 2, 0x4A, 0x4A, 0x4A, 0x4A); abs(0xCD, r.sourceY); branch(0xD0, 'noOverlap');
        emit(0xA5, 1, 0x4A, 0xA5, 0, 0x6A, 0x4A, 0x4A, 0x4A);
        abs(0xCD, r.sourceX); branch(0xD0, 'noOverlap'); emit(0xA9, 1, 0x60);
        label('playerBlocks'); emit(0xA5, 0x7D); branch(0xD0, 'noOverlap');
        emit(0xA5, 0xC2, 0x85, 0, 0xA5, 0xC1, 0x85, 1, 0xAD, 0x1E, 0x04, 0x85, 2);
        label('overlap');
        // 16x16 body intersection against the destination, modulo map width.
        abs(0xAE, r.destination);
        emit(0x38, 0xA5, 0, 0xFD, 0x16, 0x05, 0x85, 0,
            0xA5, 1, 0xFD, 0x0E, 0x05, 0x85, 1,
            0x18, 0xA5, 0, 0x69, 15, 0x85, 0, 0xA5, 1, 0x69, 0, 0x25, 0x3D);
        branch(0xD0, 'noOverlap'); emit(0xA5, 0, 0xC9, 31); branch(0xB0, 'noOverlap');
        emit(0x38, 0xA5, 2, 0xFD, 0x33, 0x04, 0x18, 0x69, 15, 0xC9, 31); branch(0xB0, 'noOverlap');
        emit(0xA9, 1, 0x60); label('noOverlap'); emit(0xA9, 0, 0x60);

        label('attributeMasks'); emit(0xFC, 0xF3, 0xCF, 0x3F);
        const schemes = Array.from({length: 12}, (_, scene) => Romfix.getPortalColorSchemes(romData, scene)).flat();
        label('backgroundPalettes');
        emit(...schemes.map(scheme => scheme.background));
        label('spritePalettes'); emit(...schemes.map(scheme => scheme.sprite));

        // Two background packets, plus native falling checks after removing
        // support and placing a stone. This executes only with bank 0 mapped.
        org(0xFC00, 0xFC48, 0x1FC10); label('paint'); emit(0x8A, 0x48);
        const coord = (x, y) => { lda(x); emit(0x85, 0); lda(y); emit(0x85, 1); };
        coord(r.sourceX, r.sourceY); jsr(0x9628);
        coord(r.sourceX, r.sourceY); jsr(0xA5E8);
        lda(r.targetX); emit(0x85, 8); lda(r.targetY); emit(0x85, 9);
        jsr(0x90F5); lda(r.count); jsr(0x9162); jsr(0x91C0); jsr(0x903D);
        coord(r.targetX, r.targetY); emit(0xE6, 1); jsr(0xA5E8); emit(0x68, 0xAA, 0x60);

        // Fixed-bank tables are readable by both the bank-1 background
        // producer and the bank-0 OAM renderer. Numbers need no extra sprites.
        org(0xFC48, 0xFC80, 0x1FC58);
        for (const [name, column] of [['leftTiles', 0], ['rightTiles', 1]]) {
            label(name);
            for (let group = 0; group < 4; group++) for (let frame = 0; frame < 7; frame++)
                emit(Romfix.getPortalFrameTiles(group, frame)[column] | 1);
        }

        // Bank 7, following the bird platform worker. Skip only the exit's
        // own overlapping cells, including their attribute writes. Adjacent
        // quadrants and the native queue/fade run normally.
        org(0xF7C8, 0xF800, 0x1F7D8); label('exitCell');
        emit(0x48, 0xA5, 0x30, 0xC9, 13); branch(0xD0, 'nativeCell');
        emit(0xA0, 7); label('exitScan'); ly(0x4FE); emit(0xC9, 13); branch(0xD0, 'nextExitSlot');
        ly(0x576); emit(0x29, 15, 0xC5, 0x64); branch(0xD0, 'nextExitSlot');
        ly(0x50E); emit(0x4A); ly(0x516); emit(0x6A, 0x4A, 0x4A, 0x4A, 0xC5, 0x63);
        branch(0xF0, 'keepPortalCell');
        label('nextExitSlot'); emit(0x88); branch(0x10, 'exitScan');
        label('nativeCell'); emit(0x68); jsr(0x9162); jsr(0x91C0); abs(0x4C, 0x903D);
        label('keepPortalCell'); emit(0x68, 0x60);

        for (const ref of refs) {
            const target = typeof ref.target === 'number' ? ref.target : labels.get(ref.target);
            if (target === undefined) throw new Error(`Unknown portal transport label: ${ref.target}`);
            if (ref.relative) {
                const delta = target - ref.part.base - ref.at - 1;
                if (delta < -128 || delta > 127) throw new Error(`Portal transport branch too far: ${ref.target}`);
                ref.part.bytes[ref.at] = delta & 255;
            } else { ref.part.bytes[ref.at] = target & 255; ref.part.bytes[ref.at + 1] = target >> 8; }
        }
        for (const block of parts) {
            if (block.base + block.bytes.length > block.limit) throw new Error('Portal transport code exceeds reservation');
            const occupied = romData.subarray(block.file, block.file + block.limit - block.base).findIndex(byte => byte !== 0);
            if (occupied >= 0) throw new Error(`Portal transport reservation is occupied at file $${(block.file + occupied).toString(16)}`);
        }
        for (const block of parts) Romfix.fixCodeInsert(romData, block.file, block.bytes);
        Romfix.fixCodeInsert(romData, 0x3673, [0x20, 0xC8, 0xF7, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA]);
        return {start: labels.get('entry'), paint: labels.get('paint'), leftTiles: labels.get('leftTiles'),
            rightTiles: labels.get('rightTiles'), labels: Object.fromEntries(labels),
            blocks: parts.map(block => ({start: block.base, end: block.base + block.bytes.length, file: block.file}))};
    }

    /** Signed top-edge motion and distance-dependent fright during ascent. */
    static addBirdFishMotion(romData){
        // The ending fonts live in bank 1; its fixed-bank text/code ends at
        // $F940. Keep this worker below the sprite portal preview at $FB00.
        const base = 0xF940, limit = 0xFB00;
        const file = cpu => cpu - 0x8000 + 0x10 + (cpu >= 0xC000 ? 6 * 0x4000 : 0);
        if(romData.subarray(file(base), file(limit)).some(byte => byte !== 0))
            throw new Error('Reserved bird/fish motion area in bank 7 is occupied');
        const { fright, speed, yHigh, targetHigh } = Romfix.BIRD_RAM;
        const bytes = [], labels = new Map(), references = [];
        const emit = (...values) => bytes.push(...values);
        const label = name => labels.set(name, base + bytes.length);
        const absolute = (opcode, destination) => {
            emit(opcode); references.push({at: bytes.length, destination}); emit(0, 0);
        };
        const branch = (opcode, destination) => {
            emit(opcode); references.push({at: bytes.length, destination, relative: true}); emit(0);
        };
        const slot = (opcode, address) => emit(opcode, address & 255, address >> 8);

        label('reset'); emit(0xA9, 0x00);
        for(const address of [fright, speed, yHigh, targetHigh]) slot(0x9D, address);
        emit(0x60);

        // All four original hazard routines interpret Y as unsigned. Skip
        // them above the map rather than sampling the bottom row's RAM.
        label('hazards'); slot(0xBD, yHigh); branch(0x30, 'hazardsDone');
        for(const entry of [0xB0D6, 0xB25D, 0xB20C, 0xB19B]) absolute(0x20, entry);
        label('hazardsDone'); emit(0x60);

        label('liftTarget');
        slot(0xBD, targetHigh); branch(0xD0, 'exitTarget');
        emit(0x18, 0xBD, 0x46, 0x05, 0x7D, 0x6E, 0x05, 0x38, 0xE9, 0x10);
        branch(0xB0, 'positiveTarget'); emit(0xC9, 0xF8); branch(0xB0, 'negativeTarget');
        label('exitTarget'); emit(0xA9, 0xF8);
        label('negativeTarget'); emit(0x9D, 0x46, 0x05, 0xA9, 0xFF); slot(0x9D, targetHigh);
        emit(0xA9, 0x00); absolute(0x4C, 'clearStep');
        label('positiveTarget'); emit(0x9D, 0x46, 0x05, 0xA9, 0x00); slot(0x9D, targetHigh);
        label('clearStep'); emit(0x9D, 0x6E, 0x05, 0x9D, 0x7E, 0x05, 0x60);

        // $00:$01 is the wrapped bird-minus-player X calculated at impact.
        // Convert it to an absolute shortest distance without changing it;
        // the caller still needs those bytes to choose the escape direction.
        label('startFright');
        emit(0xA5, 0x3D); branch(0xF0, 'narrowDistance');
        emit(0xA5, 0x01); branch(0xF0, 'positiveDistance');
        emit(0xA5, 0x00); branch(0xF0, 'farDistance'); branch(0xD0, 'negativeDistance');
        label('narrowDistance'); emit(0xA5, 0x00); branch(0x10, 'positiveDistance');
        label('negativeDistance'); emit(0xA5, 0x00, 0x49, 0xFF, 0x18, 0x69, 0x01);
        absolute(0x4C, 'distance');
        label('positiveDistance'); emit(0xA5, 0x00);
        label('distance'); emit(0x4A, 0x4A, 0x4A, 0x4A, 0x4A, 0xC9, 0x03);
        branch(0x90, 'distanceTier');
        label('farDistance'); emit(0xA9, 0x03);
        label('distanceTier'); emit(0x49, 0x03); slot(0x9D, speed);
        emit(0xA9, 0x01); slot(0x9D, fright); emit(0x60);

        // Only cancel the temporary horizontal boost. Keep the height goal
        // and signed coordinates so a blocked ascent can resume normally.
        label('finishFright'); slot(0xBD, fright); branch(0xF0, 'frightDone');
        emit(0xA9, 0x00); slot(0x9D, fright); slot(0x9D, speed);
        absolute(0x4C, 'velocity');
        label('frightDone'); emit(0x60);

        // Four exact 8.8 speeds: 0.5, 1, 1.5, 2 pixels per active update.
        // Acceleration only belongs to the upward leg, including when a
        // landing changes its destination before the next patrol update.
        label('velocity'); slot(0xBD, fright); branch(0xF0, 'normalSpeed');
        absolute(0x20, 'compareHeight'); branch(0xB0, 'normalSpeed');
        slot(0xBD, speed); absolute(0x4C, 'speedMagnitude');
        label('normalSpeed'); emit(0xA9, 0x00); slot(0x9D, fright); slot(0x9D, speed);
        label('speedMagnitude'); emit(0x18, 0x69, 0x01, 0x4A, 0x9D, 0x2E, 0x05,
            0xA9, 0x00, 0x6A, 0x9D, 0x36, 0x05,
            0xBD, 0x56, 0x05, 0xC9, 0x04); branch(0xB0, 'velocityDone');
        emit(0x38, 0xA9, 0x00, 0xFD, 0x36, 0x05, 0x9D, 0x36, 0x05,
            0xA9, 0x00, 0xFD, 0x2E, 0x05, 0x9D, 0x2E, 0x05);
        label('velocityDone'); emit(0x60);

        label('compareHeight'); slot(0xBD, targetHigh); slot(0xDD, yHigh);
        branch(0xF0, 'compareLow');
        slot(0xBD, targetHigh); emit(0x49, 0xFF, 0xC9, 0x80, 0x60);
        label('compareLow');
        emit(0x18, 0xBD, 0x46, 0x05, 0x7D, 0x6E, 0x05, 0xDD, 0x33, 0x04, 0x60);

        label('rise');
        slot(0xBD, yHigh); branch(0x30, 'riderCeiling');
        emit(0xBD, 0x33, 0x04, 0xC9, 0x09); branch(0x90, 'riderCeiling');
        emit(0x38, 0xE9, 0x09); absolute(0x20, 'bodyProbe'); branch(0xD0, 'stopFright');
        label('riderCeiling');
        emit(0xBD, 0x3E, 0x05); branch(0xF0, 'riseFree');
        absolute(0x20, 0x9BD5); branch(0xB0, 'stopFright');
        label('riseFree'); emit(0xBD, 0x33, 0x04); branch(0xD0, 'decrementY');
        slot(0xDE, yHigh);
        label('decrementY'); emit(0xDE, 0x33, 0x04);
        // Native 8x16 OAM uses Y-1: at anchor zero its Y=$FF is completely
        // hidden, so remove it now rather than leave an invisible platform.
        emit(0xBD, 0x33, 0x04); branch(0xF0, 'departed');
        slot(0xBD, yHigh); branch(0x10, 'riseDone');
        emit(0xBD, 0x33, 0x04, 0xC9, 0xF9); branch(0xB0, 'riseDone');
        // Keep the type/birthplace, clear support, and enter the existing
        // 200-tick respawn countdown. Also accept older negative-Y saves.
        label('departed');
        absolute(0x20, 'reset');
        emit(0xA9, 0x00, 0x9D, 0x3E, 0x05, 0x9D, 0x6E, 0x05,
            0xA9, 0x80, 0x9D, 0x4E, 0x05, 0x98, 0x48);
        absolute(0x20, 0xAC22); emit(0x68, 0xA8, 0x60);
        label('riseDone'); absolute(0x20, 'compareHeight'); branch(0xF0, 'stopFright'); emit(0x60);
        label('stopFright'); absolute(0x4C, 'finishFright');

        // The body may straddle two rows. Above row zero, never include
        // row 15 samples caused by the original unsigned tile sampler.
        label('walls'); slot(0xBD, yHigh); branch(0x30, 'noWalls');
        absolute(0x20, 0x9330);
        emit(0xA5, 0x02, 0xC9, 0x08); branch(0xB0, 'wallRows');
        emit(0xA9, 0x00, 0x85, 0xAF, 0x85, 0xB0);
        label('wallRows'); emit(0xA5, 0x02, 0x29, 0x0F, 0xC9, 0x08); branch(0xF0, 'wallsDone');
        emit(0xA5, 0xAD, 0x05, 0xAF, 0x05, 0xB1, 0x85, 0xAD,
            0xA5, 0xAE, 0x05, 0xB0, 0x05, 0xB2, 0x85, 0xAE);
        label('wallsDone'); emit(0x60);
        label('noWalls'); emit(0xA9, 0x00, 0x85, 0xAD, 0x85, 0xAE, 0x60);

        label('bodyProbe');
        emit(0x85, 0x02, 0x98, 0x48,
            0xBD, 0x16, 0x05, 0x85, 0x00, 0xBD, 0x0E, 0x05, 0x85, 0x01,
            0x20, 0x30, 0x93, 0x68, 0xA8, 0xA5, 0xAC, 0x05, 0xAD, 0x05, 0xAE, 0x60);

        if(base + bytes.length > limit) throw new Error('Bird/fish motion exceeds reserved space');
        for(const ref of references){
            const target = typeof ref.destination === 'string' ? labels.get(ref.destination) : ref.destination;
            if(target === undefined) throw new Error(`Unknown bird/fish motion label: ${ref.destination}`);
            if(ref.relative){
                const distance = target - (base + ref.at + 1);
                if(distance < -128 || distance > 127) throw new Error(`Bird/fish motion branch out of range: ${ref.destination}`);
                bytes[ref.at] = distance & 255;
            }else{ bytes[ref.at] = target & 255; bytes[ref.at + 1] = target >> 8; }
        }
        Romfix.fixCodeInsert(romData, file(base), bytes);
        return Object.fromEntries(['reset', 'hazards', 'liftTarget', 'startFright', 'finishFright', 'velocity',
            'compareHeight', 'rise', 'walls', 'bodyProbe'].map(name => [name, labels.get(name)]));
    }

    /** One-way birds/fish: two distinct landings commit one 16px step. */
    static addBirdFishPlatform(romData){
        const base = 0xF5BC, limit = 0xF7C8;
        const file = cpu => cpu - 0x8000 + 0x10 + (cpu >= 0xC000 ? 6 * 0x4000 : 0);
        if(romData.subarray(file(base), file(limit)).some(byte => byte !== 0))
            throw new Error('Reserved bird/fish platform area in bank 7 is occupied');
        const motion = Romfix.addBirdFishMotion(romData);
        const bytes = [], labels = new Map(), references = [];
        const emit = (...values) => bytes.push(...values);
        const label = name => labels.set(name, base + bytes.length);
        const absolute = (opcode, destination) => {
            emit(opcode); references.push({at: bytes.length, destination}); emit(0, 0);
        };
        const branch = (opcode, destination) => {
            emit(opcode); references.push({at: bytes.length, destination, relative: true}); emit(0);
        };
        // $053E rider latch; $0546 committed Y; $056E temporary 8px step;
        // $057E recovery timer; $0526 previous X for horizontal carrying.
        label('init');
        emit(0xBD, 0x06, 0x05); branch(0xD0, 'initialized');
        emit(0xBD, 0x76, 0x05, 0x0A, 0x0A, 0x0A, 0x0A, 0x09, 0x08,
            0x9D, 0x33, 0x04, 0x9D, 0x46, 0x05);
        absolute(0x20, 0xAAF4); // Native frame, animation, action and flag reset; A=0.
        emit(0x9D, 0x3E, 0x05);
        absolute(0x20, motion.reset);
        emit(0xFE, 0x06, 0x05); // State 0 becomes live state 1 only on spawn.
        label('initialized');
        emit(0xA9, 0x00, 0x9D, 0x4E, 0x05, 0x9D, 0x6F, 0x04);
        emit(0x60);

        label('detach'); emit(0xA9, 0x00, 0x9D, 0x3E, 0x05);
        absolute(0x4C, 'vertical');
        label('update');
        emit(0xA5, 0x56, 0xC9, 0x03); branch(0xD0, 'detach');
        emit(0xA5, 0xC0, 0xC9, 0x03); branch(0xB0, 'detach');
        emit(0xA5, 0xC7); branch(0x30, 'detach');
        absolute(0x20, 'overlap'); branch(0x90, 'detach');
        emit(0xBD, 0x3E, 0x05); branch(0xF0, 'landing');
        // A rider stays latched until an actual jump or a walk off the edge.
        emit(0xA5, 0xC0, 0xC9, 0x01); branch(0xF0, 'vertical');
        label('landing');
        emit(0xA5, 0xC0, 0xC9, 0x02); branch(0xD0, 'detach');
        // Descending feet must cross the top this frame, not the sides/bottom.
        emit(0x18, 0xAD, 0x1E, 0x04, 0x69, 0x10, 0x85, 0x02,
            0xA5, 0x7D, 0x69, 0x00);
        absolute(0xDD, Romfix.BIRD_RAM.yHigh); branch(0xD0, 'detach');
        emit(0xA5, 0x02, 0x38, 0xFD, 0x33, 0x04); branch(0x90, 'detach');
        emit(0x85, 0x00, 0xA5, 0xC7, 0x18, 0x69, 0x01, 0xC5, 0x00);
        branch(0x90, 'detach');
        emit(0xA9, 0x01, 0x9D, 0x3E, 0x05, 0x85, 0xC0,
            0xA9, 0x00, 0x85, 0xC4, 0x85, 0xC7, 0x85, 0xC8,
            0x85, 0xDA, 0x85, 0x5B);
        // One landing temporarily lowers the bird half a tile; a second
        // landing before recovery commits the next complete tile instead.
        emit(0xBD, 0x46, 0x05, 0xC9, 0xD9); branch(0xB0, 'vertical');
        emit(0xBD, 0x6E, 0x05); branch(0xD0, 'commit');
        emit(0xA9, 0x08, 0x9D, 0x6E, 0x05,
            0xA9, 0x5A, 0x9D, 0x7E, 0x05);
        absolute(0x4C, 'vertical');
        // A floor cancels the unfinished drop at the actual supported height.
        // Never bank blocked landings for a later fall after leaving a ledge.
        label('blockedDescent');
        emit(0xBD, 0x33, 0x04, 0x9D, 0x46, 0x05);
        absolute(0x4C, 'clearDrop');
        label('commit');
        // Bottom row 13 is Y=$D8. Its half-step $E0 leaves the rider at
        // $D0, safely above native death Y=$D5; a full step $E8 would not.
        emit(0xBD, 0x46, 0x05, 0xC9, 0xD8); branch(0xB0, 'vertical');
        emit(0x69, 0x10, 0x9D, 0x46, 0x05); // CMP left carry clear.
        label('clearDrop');
        emit(0xA9, 0x00, 0x9D, 0x6E, 0x05, 0x9D, 0x7E, 0x05);
        label('vertical');
        // Ease one pixel/frame, counting the recovery delay only once the
        // lower half-step is reached so short and full jumps can both commit.
        absolute(0x20, motion.compareHeight);
        branch(0xF0, 'atTarget'); branch(0x90, 'rise');
        absolute(0x20, motion.finishFright); // A stomp can replace the rising goal with a drop.
        // Sample the leading body edge, including either horizontal tile.
        // This private probe remains valid between native 16px grid rows.
        emit(0xBD, 0x33, 0x04, 0x18, 0x69, 0x08);
        absolute(0x20, motion.bodyProbe); branch(0xD0, 'blockedDescent');
        // A floor takes over support when the carrier sinks below it.
        emit(0xBD, 0x3E, 0x05); branch(0xF0, 'sink');
        absolute(0x20, 0x9BE3); branch(0x90, 'sink');
        emit(0xA9, 0x00, 0x9D, 0x3E, 0x05);
        label('sink');
        emit(0xFE, 0x33, 0x04); absolute(0x4C, 'carry');
        label('rise');
        absolute(0x20, motion.rise);
        emit(0xBD, 0x06, 0x05, 0xC9, 0x01); branch(0xF0, 'carry'); emit(0x60);
        label('atTarget');
        absolute(0x20, motion.finishFright);
        emit(0xBD, 0x7E, 0x05); branch(0xF0, 'carry');
        emit(0xDE, 0x7E, 0x05); branch(0xD0, 'carry');
        emit(0xA9, 0x00, 0x9D, 0x6E, 0x05);
        label('carry');
        emit(0xBD, 0x3E, 0x05); branch(0xD0, 'carryRider'); emit(0x60);
        label('carryRider');
        emit(0x38, 0xBD, 0x33, 0x04, 0xE9, 0x10, 0x8D, 0x1E, 0x04);
        absolute(0xBD, Romfix.BIRD_RAM.yHigh);
        emit(0xE9, 0x00, 0x85, 0x7D,
            0xA9, 0x00, 0x85, 0xC4, 0x85, 0xC7, 0x85, 0xC8,
            0x38, 0xBD, 0x16, 0x05, 0xFD, 0x26, 0x05);
        branch(0xF0, 'return');
        absolute(0x20, 'shiftPlayerX');
        // Native body probes prevent a moving platform from carrying a
        // standing player through walls. Roll back only the carried pixel.
        // The movement delta, rather than an unsigned comparison, handles seams.
        emit(0xBD, 0x16, 0x05, 0x38, 0xFD, 0x26, 0x05); branch(0x30, 'probeLeft');
        absolute(0x20, 0x9BBD); absolute(0x4C, 'probeResult');
        label('probeLeft'); absolute(0x20, 0x9BB9);
        label('probeResult'); branch(0x90, 'return');
        emit(0x38, 0xBD, 0x26, 0x05, 0xFD, 0x16, 0x05);
        absolute(0x20, 'shiftPlayerX');
        // Native player projection ran before this carrier moved. Refresh its
        // screen X from the final carried (or wall-rolled-back) position so
        // player and bird OAM use the same frame. Do not call $943C again:
        // that entry would also decrement the player's blink timer twice.
        label('return');
        emit(0x38, 0xA5, 0xC2, 0xE5, 0xFD, 0x8D, 0x3C, 0x04, 0x60);

        // Shared signed carry/rollback addition keeps both map seams exact.
        // ASL captures the delta sign; the high byte is 0 or $FF on the stack
        // while the low-byte addition supplies its own carry.
        label('shiftPlayerX');
        emit(0x85, 0x00, 0x0A, 0xA9, 0x00, 0xE9, 0x00, 0x49, 0xFF, 0x48,
            0x18, 0xA5, 0xC2, 0x65, 0x00, 0x85, 0xC2, 0x68,
            0x65, 0xC1, 0x25, 0x3D, 0x85, 0xC1, 0x60);

        // Match world X modulo the actual map width, including either seam.
        label('overlap');
        emit(0x38, 0xA5, 0xC2, 0xFD, 0x16, 0x05, 0x85, 0x00,
            0xA5, 0xC1, 0xFD, 0x0E, 0x05, 0x85, 0x01,
            0x18, 0xA5, 0x00, 0x69, 0x0D, 0x85, 0x00,
            0xA5, 0x01, 0x69, 0x00, 0x25, 0x3D);
        branch(0xD0, 'miss');
        emit(0xA5, 0x00, 0xC9, 0x1B); branch(0xB0, 'miss');
        emit(0x38, 0x60); label('miss'); emit(0x18, 0x60);

        // Native ground handling still owns jumping and walking. Supply its
        // support probe while aboard, preserving X for the original caller.
        label('support'); absolute(0x20, 'findRider');
        branch(0xB0, 'supportDone'); absolute(0x4C, 0x9BE3);
        label('supportDone'); emit(0x60);
        label('findRider'); emit(0x8A, 0x48, 0xA2, 0x07);
        label('supportLoop');
        emit(0xBD, 0xFE, 0x04, 0xC9, 0x0C); branch(0xD0, 'nextSupport');
        // Native tumble physics reuse the rider byte as signed Y velocity.
        // Only a live, standing carrier can supply platform support.
        emit(0xBD, 0x06, 0x05, 0xC9, 0x01); branch(0xD0, 'nextSupport');
        emit(0xBD, 0x3E, 0x05); branch(0xF0, 'nextSupport');
        absolute(0x20, 'overlap'); branch(0xB0, 'supported');
        label('nextSupport'); emit(0xCA); branch(0x10, 'supportLoop');
        // A match leaves X=0..7; an exhausted search leaves X=$FF.
        label('supported'); emit(0xE8, 0xE0, 0x01, 0x68, 0xAA, 0x60);

        // Riders never choose horizontal direction: patrol reverses normally.
        label('reverse');
        absolute(0x20, 0xB013);
        absolute(0x20, 0xAFEF); // Velocity was prepared before wall probes; reverse it this frame too.
        emit(0x18, 0x60);

        // $A9CF maps states 10+ to type-independent routines. Preserve the
        // native knockback velocities, current bird/fish frame and tumble
        // flips; $AF68 would erase those flips and $AE6A needs a type table.
        label('defeat'); absolute(0x20, 0xA9CF); absolute(0x4C, 'project');

        // State 0 uses the ordinary 90-frame smoke clock and its shared
        // frames. Avoid native type-indexed completion/animation tables,
        // which end at type 11. Spawn and respawn follow the same path.
        label('spawn'); absolute(0x20, motion.reset); absolute(0x20, 0xAE9C);
        emit(0xBD, 0x66, 0x05, 0x1D, 0x5E, 0x05); branch(0xF0, 'spawned');
        emit(0xA9, 0x80, 0x9D, 0x4E, 0x05,
            0xBC, 0x5E, 0x05, 0xB9, 0x30, 0xB5, 0x9D, 0x15, 0x04);
        absolute(0x4C, 'draw');
        label('spawned'); absolute(0x20, 'init');
        emit(0xA9, 0x2D, 0x9D, 0x15, 0x04);
        // Smoke clears death tumble flips and uses native horizontal facing.
        // Defeat skips this live-facing entry so its tumble stays visible.
        label('draw'); absolute(0x20, 0xAF68);
        label('project');
        absolute(0x20, 0xAE54); absolute(0x4C, 0xA9B3);

        if(base + bytes.length > limit) throw new Error('Bird/fish platform exceeds reserved space');
        for(const ref of references){
            const target = typeof ref.destination === 'string' ? labels.get(ref.destination) : ref.destination;
            if(target === undefined) throw new Error(`Unknown bird/fish platform label: ${ref.destination}`);
            if(ref.relative){
                const distance = target - (base + ref.at + 1);
                if(distance < -128 || distance > 127) throw new Error(`Bird/fish platform branch out of range: ${ref.destination}`);
                bytes[ref.at] = distance & 255;
            }else{ bytes[ref.at] = target & 255; bytes[ref.at + 1] = target >> 8; }
        }
        Romfix.fixCodeInsert(romData, file(base), bytes);
        const support = labels.get('support');
        Romfix.fixCodeInsert(romData, file(0x9584), [0x20, support & 255, support >> 8]);
        // Keep all controls native; Up/Down no longer command bird movement.
        Romfix.fixCodeInsert(romData, file(0x8B57), [0x20, 0x1A, 0x94]);
        return {init: labels.get('init'), update: labels.get('update'), walls: motion.walls, motion,
            reverse: labels.get('reverse'), defeat: labels.get('defeat'),
            spawn: labels.get('spawn'), draw: labels.get('draw'), project: labels.get('project'),
            findRider: labels.get('findRider'), playerControl: 0x941A};
    }

    /**
     * Append a text page after all six native staff entries, before KONAMI.
     * $B5=4 is the native logo phase. Its $BC=0 entry shows our page first;
     * $BC=5 waits on the existing $BD timer, then enters native $C914.
     * Native logo substates 1–4, staff data, music and ending animation stay
     * untouched. Fixed bank 7 $F800–$F93F holds the credit code/text;
     * bank 1 $A500–$A83F holds both fonts after the pause-pattern assets.
     * Bird motion follows at $F940; the pause-pattern worker starts at $FC80.
     * coordinate/flight helpers end at $F800; pause helpers start at $FED9.
     */
    static configureCustomLevelCredit(romData, isExpanded, value) {
        const file = cpu => cpu - 0x8000 + 0x10 + (isExpanded ? 6 * 0x4000 : 0);
        const fontFile = 0x6510, fontLimit = 0x6850;
        // Clear on every export, including removal of an earlier author.
        // These bank-1 bytes follow the pause font and its original patterns.
        if (isExpanded) romData.fill(0, fontFile, fontLimit);
        // Remove an earlier export's hook even when the new name is blank.
        Romfix.fixCodeInsert(romData, file(0xC905), [0xA5, 0xBC, 0x20, 0x0D, 0x83]);
        const author = Config.normalizeCustomLevelAuthor(value).trim().toUpperCase();
        if (!author) return;
        if (!isExpanded) throw new Error('Custom level credits require an expanded ROM');
        const base = 0xF800, limit = 0xF940;
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
        // Code stays fixed while bank 1 supplies the font; restore executable
        // bank 0 before the native routine enables rendering and NMI again.
        emit(0x20, 0x2D, 0x81,
             0xA9, 0x01, 0x8D, 0x00, 0x80,
             0xA9, 0x18, 0x8D, 0x06, 0x20, 0xA9, 0x00, 0x8D, 0x06, 0x20,
             0xA0, 0x00);
        label('fontPage');
        emit(0xB1, 0x00, 0x8D, 0x07, 0x20, 0xC8);
        branch(0xD0, 'fontPage');
        emit(0xE6, 0x01);
        label('fontTail');
        emit(0xB1, 0x00, 0x8D, 0x07, 0x20, 0xC8, 0xC0, 0xA0);
        branch(0xD0, 'fontTail');
        emit(0xA9, 0x00, 0x8D, 0x00, 0x80, 0x4C, 0x0C, 0x81);
        label('text');
        emit(...text);
        labels.set('nameFont', 0xA500);
        labels.set('originalFont', 0xA500 + font.length);

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
        romData.set(font, fontFile);
        romData.set(originalFont, fontFile + font.length);
        Romfix.fixCodeInsert(romData, file(base), bytes);
        Romfix.fixCodeInsert(romData, file(0xC905), [0x4C, base & 0xFF, base >> 8, 0xEA, 0xEA]);
    }

    /**
     * Eight immutable enemy birth pages and a signed player Y high byte.
     * The high byte extends native 8.8 Y physics; negative Y is air above the
     * map, not a second vertical map. Keep native bottom death and velocities.
     * Fixed bank 7 $F410–$F5BB is relocated level storage, cleared on export.
     */
    static fixExtendedCoordinates(romData, isExpanded = false){
        if(!isExpanded) throw new Error('Extended coordinates require an expanded ROM');
        const file = cpu => cpu - 0x8000 + 0x10 + (cpu >= 0xC000 ? 6 * 0x4000 : 0);
        const base = 0xF410, limit = 0xF5BC;
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

    /** Read the two original 16x16 poses, including from older editor exports. */
    static getFlightSpriteFrames(romData, isFish = false) {
        const tile = isFish ? 0xB0 : 0xB8;
        const hasBackup = romData.subarray(0x8C50, 0x8FF0).some(byte => byte !== 0);
        const source = hasBackup
            ? 0x8C50 + (tile - 0xA6) * 16
            : 0xA010 + tile * 16;
        return romData.slice(source, source + 8 * 16);
    }

    /** Decode the exact gameplay CHR image used by an exported scene. */
    static getScenePatternData(romData, scene) {
        if (!Romfix.getSceneGraphicsVersion(romData)) return null;
        if (!Number.isInteger(scene) || scene < 0 || scene >= 12) return null;
        const patterns = new Uint8Array(0x2000);
        for (let page = 0; page < 32; page++) {
            const chunk = romData[0x18A10 + scene * 32 + page];
            if (chunk >= 116) throw new Error('Invalid scene graphics page');
            const address = chunk < 64 ? 0x14010 + chunk * 256
                : 0x18C10 + (chunk - 64) * 256;
            patterns.set(romData.subarray(address, address + 256), page * 256);
        }
        return patterns;
    }

    static backupUnusedImages(romData, isExpanded = false) {
        const backup = 0x8C50, length = 0x3A0;
        if (!romData.subarray(backup, backup + length).some(byte => byte !== 0)) {
            romData.set(romData.slice(0xAA70, 0xAA70 + length), backup);
        }

        // Stop spreading the castle boss over the unused small characters.
        // Enemy 7 keeps its native castle graphics at $EA70-$EE0F.
        const original = romData.slice(backup, backup + length);
        romData.set(original, 0xAA70);
        romData.set(original, 0xCA70);
        const bird = Romfix.getFlightSpriteFrames(romData);
        romData.set(bird, 0xAAB0); // Both poses use PPU tiles $AA-$B1.
        romData.set(bird, 0xCAB0);

        // Scene-specific copies are compiled into the shared page pool later.
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
            [0x8B81, '20D9D8'],
            [0x8B8E, 'A51EC950B0032020CA'],
            [0x8ECE, '6500AA'],
            [0x90B0, '998006'],
            [0xA507, 'A51EC920'],
            [0xA868, 'A51EC920'],
            [0xA97C, '20C7B9'],
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
     * Pause controls select fixed/bounded or centered looping views.
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
        org(0xF100, 0xF2B0);
        label('camera');
        emit(0xA5, 0x56, 0xC9, 0x03); // LDA stageState; CMP #live
        branch(0xF0, 'liveCamera');
        absolute(0x4C, 'reset');
        label('liveCamera');
        emit(0xA5, 0x1F);             // Attract demos do not read player input.
        branch(0xD0, 'normalCamera');
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
        emit(0x4C, 0xCB, 0xB3); // Unified pause controller, installed below.

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

        // Enemies run AFTER rescues. Reserve an imminent 34-byte fire packet
        // before admitting rescue animation. Falling objects use their own
        // quota and run first; a busy falling frame defers fire instead.
        // Predict the native B9C7/B9EA tick without advancing fire state or
        // collision length. Phase 15 hands off to a face whose timer is reset,
        // so even a later slot cannot draw again during that handoff frame.
        label('reserveFireQueue');
        emit(0x8A, 0x48, 0xA2, 0x07); // Save X; inspect all eight enemy slots.
        label('checkFireSlot');
        emit(0xBD, 0xFE, 0x04, 0xC9, 0x09);
        branch(0xD0, 'nextFireSlot');
        emit(0xBD, 0x06, 0x05);
        branch(0xF0, 'nextFireSlot');
        emit(0xBD, 0x7E, 0x05, 0xC9, 0x0F);
        branch(0xB0, 'nextFireSlot');
        emit(0xBD, 0x66, 0x05, 0x18, 0x69, 0x01, 0xC9, 0x03);
        branch(0x90, 'nextFireSlot');
        emit(0x68, 0xAA, 0xA5, 0x1E, 0x38, 0x60); // Defer, preserve A/X/Y.
        label('nextFireSlot');
        emit(0xCA);
        branch(0x10, 'checkFireSlot');
        emit(0x68, 0xAA, 0xA5, 0x1E, 0xC9, 0x10, 0x60);

        // Scene-8 decorations run after enemies. Keep their staggered timers
        // together by postponing the whole decoration tick on busy narrow
        // frames; a rock push plus fire otherwise leaves no room for a flag.
        label('sceneAnimationQueue');
        emit(0xA5, 0x3D);
        branch(0xD0, 'drawSceneAnimations');
        emit(0xA5, 0x1E, 0xC9, 0x20);
        branch(0xB0, 'sceneAnimationDone');
        label('drawSceneAnimations');
        emit(0x4C, 0xD9, 0xD8);
        label('sceneAnimationDone');
        emit(0x60);

        // Freeze only a fire tick that would draw into a busy queue. The
        // native off-tick path still checks damage against the unchanged,
        // visible flame length. Idle ticks and phase-15 handoff run normally.
        label('fireTickQueue');
        emit(0xBD, 0x06, 0x05);
        branch(0xF0, 'nativeFireTick');
        emit(0xBD, 0x7E, 0x05, 0xC9, 0x0F);
        branch(0xB0, 'nativeFireTick');
        emit(0xBD, 0x66, 0x05, 0x18, 0x69, 0x01, 0xC9, 0x03);
        branch(0x90, 'nativeFireTick');
        emit(0x4C, 0xE1, 0xB9); // Native collision check, then original C/RTS.
        label('nativeFireTick');
        emit(0x4C, 0xC7, 0xB9);
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

        label('fireQueueCheck');
        emit(0xA5, 0x3D);
        branch(0xD0, 'fireQueueAvailable');
        // One existing metatile plus fire fits; a 38/48-byte fall does not.
        emit(0xA5, 0x1E, 0xC9, 0x11);
        branch(0x90, 'fireQueueAvailable');
        absolute(0x4C, 'fireTickQueue');
        label('fireQueueAvailable');
        emit(0x4C, 0xC7, 0xB9);
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
        label('rescueQueueCheck');
        // Original A868 defers a rescue draw when queue length reaches $20.
        // A816 retains $68/$69 at the unprocessed map cell, and advances $6A
        // only after finishing the scan. Reuse that scheduler, allowing one
        // 16-byte metatile packet instead of two when both pages are queued.
        // Reserve fire before rescues, without changing native scan cursors.
        // Both checks return A=queue length and carry without touching X/Y.
        emit(0xA5, 0x3D);
        branch(0xD0, 'originalBackgroundQueue');
        emit(0xA5, 0x1E, 0xC9, 0x10);
        branch(0xB0, 'backgroundQueueDone');
        absolute(0x4C, 'reserveFireQueue');
        label('backgroundQueueDone');
        emit(0x60);
        label('originalBackgroundQueue');
        emit(0xA5, 0x1E, 0xC9, 0x20, 0x60);
        label('fallingQueueCheck');
        emit(0xA5, 0x3D);
        branch(0xD0, 'originalBackgroundQueue');
        emit(0xA5, 0x1E, 0xC9, 0x10, 0x60);
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
        for(const [cpu, name] of [[0xA507, 'fallingQueueCheck'], [0xA868, 'rescueQueueCheck']]){
            hook(cpu, 0x20, name);
            patch(cpu + 3, [0xEA]); // Replace the fourth byte of LDA/CMP.
        }
        hook(0xA97C, 0x20, 'fireQueueCheck');
        hook(0x8B81, 0x20, 'sceneAnimationQueue');
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
        return {selectCamera: labels.get('selectCamera'), pauseMaskBase: 0xF2B0};
    }

    /** Pause owns camera input and OAM, while all live entity data stays intact. */
    static addPauseControls(romData, isExpanded = false, viewModes = null) {
        if(!isExpanded) throw new Error('Pause controls require an expanded ROM');
        const file = cpu => cpu - 0x8000 + 16 + (cpu >= 0xC000 ? 6 * 0x4000 : 0);
        const blocks = [], labels = new Map(), refs = [];
        let part;
        const org = (base, limit, bank = 0) => { part = {base, limit, bank, bytes: []}; blocks.push(part); };
        const emit = (...bytes) => part.bytes.push(...bytes);
        const label = name => labels.set(name, part.base + part.bytes.length);
        const absolute = (opcode, name) => { emit(opcode); refs.push({part, at: part.bytes.length, name}); emit(0, 0); };
        const branch = (opcode, name) => { emit(opcode); refs.push({part, at: part.bytes.length, name, relative: true}); emit(0); };
        // $2B is the pause phase; $7E/$7F remember the pre-pause camera.
        // These bytes have no native live references. The phase clears on
        // resume, and each pause refreshes the saved camera origin.
        org(0xB3CB, 0xB49F);
        label('entry');
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
        if(viewModes) {
            emit(0xA5, 0xF4, 0x29, 0x08); branch(0xF0, 'look');
            emit(0xA5, 0x2A, 0x49, 0x01, 0x29, 0xBF, 0x85, 0x2A);
        }
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
        emit(0xA5, 0x2C, 0xC9, Romfix.PAUSE_PATTERN_RESTORED); branch(0x90, 'done');
        // The native global OAM pass runs after this first active tick. Keep
        // sprites hidden until it has rebuilt every offscreen ID/projection.
        emit(0xA9, 0x00, 0x85, 0x2B, 0x85, 0x32,
            0xA5, 0x2A, 0x29, 0x01, 0x85, 0x2A,
            0xA5, 0xFE, 0x29, 0xEF, 0x85, 0xFE, 0x4C, 0x54, 0x8B);

        org(0xD831, 0xD8A1);
        label('cameraStep');
        if(viewModes) {
            absolute(0xAD, Romfix.PORTAL_RAM.panTicks); branch(0xD0, 'returnToPan');
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
        org(0xFED9, 0xFF60);
        label('oam');
        emit(0xA5, 0x2B); branch(0xD0, 'pauseOam');
        emit(0x4C, 0xD3, 0x88);
        label('pauseOam');
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
        emit(0xA5, 0x2C, 0xC9, Romfix.PAUSE_PATTERN_READY); branch(0xD0, 'hintDone');
        emit(0xA0, 0x00);
        emit(0xA9, 0x18, 0x85, 0x00); absolute(0x20, 'copyHint');
        emit(0xA5, 0x2A, 0x29, 0x40); branch(0xD0, 'hintDone');
        emit(0xA5, 0x1B, 0x29, 0x20); branch(0xD0, 'skipLook');
        emit(0xA0, 0x18, 0xA5, 0x3D);
        if(viewModes) { branch(0xD0, 'copyLook'); emit(0xA5, 0x2A, 0x29, 0x01); }
        branch(0xF0, 'skipLook');
        label('copyLook'); emit(0xA9, 0x20, 0x85, 0x00); absolute(0x20, 'copyHint');
        label('skipLook');
        if(viewModes) {
            emit(0xA0, 0x20, 0xA5, 0x1B, 0x29, 0x20); branch(0xF0, 'copyMode');
            emit(0xA0, 0x24);
            label('copyMode'); emit(0xA9, 0x34, 0x85, 0x00); absolute(0x20, 'copyHint');
            emit(0xA5, 0x2A, 0x29, 0x01); branch(0xF0, 'statusOff');
            emit(0xA0, 0x40, 0xA9, 0x48); absolute(0x4C, 'copyStatus');
            label('statusOff'); emit(0xA0, 0x34, 0xA9, 0x40);
            label('copyStatus'); emit(0x85, 0x00); absolute(0x20, 'copyHint');
        }
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

        const glyphTile = letter => Romfix.PAUSE_HINT_SPRITE_START + Romfix.PAUSE_HINT_GLYPHS.indexOf(letter) * 2;
        const hint = [];
        const text = (text, x, y) => {
            [...text].forEach((letter, index) => {
                if(letter !== ' ') hint.push(y, glyphTile(letter), 0, x + index * 8);
            });
        };
        text('PAUSED', 104, 72);
        hint.push(112, glyphTile('<'), 0, 8, 112, glyphTile('<'), 0x40, 240);
        if(viewModes) {
            // A concise single line fits exactly eight sprites with OFF.
            hint.push(144, glyphTile('^'), 0, 88);
            text('LOOP', 104, 144);
            text('OFF', 144, 144); text('ON', 144, 144);
        }
        label('hint'); emit(...hint);

        // Borrow enemy-only sprite tiles $60-$83 while paused. Keep the font
        // and all three original sprite-page variants after bank-1 enemy data;
        // the normal scene images and their reserved background tail stay clean.
        // Nine sprite font packets are restored before releasing pause, at no
        // more than 64 CHR bytes per vblank. Background fireheads stay intact.
        romData.set(Romfix.getPauseHintPatterns(romData), 0x5910);
        for(let page = 0; page < 3; page++)
            romData.set(romData.subarray(0xA610 + page * 0x2000, 0xA850 + page * 0x2000), 0x5C10 + page * 0x300);
        org(0xFC80, 0xFD00);
        label('maskTick');
        emit(0xA5, 0x2C, 0x29, 0x7F, 0xC9, Romfix.PAUSE_PATTERN_READY); branch(0xB0, 'maskDone');
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

        for(const ref of refs) {
            const address = typeof ref.name === 'number' ? ref.name : labels.get(ref.name);
            if(address === undefined) throw new Error(`Unknown pause label: ${ref.name}`);
            if(ref.relative) {
                const distance = address - ref.part.base - ref.at - 1;
                if(distance < -128 || distance > 127) throw new Error(`Pause branch out of range: ${ref.name}`);
                ref.part.bytes[ref.at] = distance & 255;
            } else { ref.part.bytes[ref.at] = address & 255; ref.part.bytes[ref.at + 1] = address >> 8; }
        }
        for(const block of blocks) {
            if(block.base + block.bytes.length > block.limit)
                throw new Error(`Pause helper exceeds reservation at $${block.base.toString(16)} (${block.bytes.length} bytes)`);
        }
        for(const block of blocks) Romfix.fixCodeInsert(romData, file(block.base) + block.bank * 0x4000, block.bytes);
        const entry = labels.get('entry'), oam = labels.get('oam');
        Romfix.fixCodeInsert(romData, file(0x8B4F), [0x4C, entry & 255, entry >> 8]);
        Romfix.fixCodeInsert(romData, file(0x80C0), [0x20, oam & 255, oam >> 8]);
        return {entry, oam, cameraStep: labels.get('cameraStep')};
    }

    // moaikun maker label
    static addMoaikunMakerLabel(romData){
        const labelCode = [0xE3, 0xE2, 0x17, 0x0B, 0x0E, 0x0F, 0xE3, 0x21, 0x13, 0x1E, 0x12, 0xE2, 0xE3, 0xE2, 0xE3, 0xE2, 0xE3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0xD3, 0xD2, 0x17, 0x19, 0x0B, 0x13, 0x15, 0x1F, 0x18, 0xD2, 0x17, 0x0B, 0x15, 0x0F, 0x1C];
        const labelAddr = 0x05D9;
        for(let i = labelAddr; i< labelAddr + labelCode.length; i++){
            romData[i] = labelCode[i - labelAddr];
        }
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
        const file = cpu => cpu - 0x8000 + 0x10 + (cpu >= 0xC000 ? 6 * 0x4000 : 0);
        if(romData.subarray(file(base), file(limit)).some(byte => byte !== 0))
            throw new Error('Reserved scene-graphics loader area in bank 7 is occupied');
        const bytes = [], labels = new Map(), references = [];
        const emit = (...values) => bytes.push(...values);
        const label = name => labels.set(name, base + bytes.length);
        const absolute = (opcode, target) => {
            emit(opcode); references.push({ at: bytes.length, target }); emit(0, 0);
        };
        const branch = (opcode, target) => {
            emit(opcode); references.push({ at: bytes.length, target, relative: true }); emit(0);
        };

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

        if(base + bytes.length > limit) throw new Error('Scene-graphics loader exceeds reserved bank 7 space');
        for(const ref of references) {
            const target = typeof ref.target === 'string' ? labels.get(ref.target) : ref.target;
            if(target === undefined) throw new Error(`Unknown scene-graphics label: ${ref.target}`);
            if(ref.relative) {
                const delta = target - (base + ref.at + 1);
                if(delta < -128 || delta > 127) throw new Error('Scene-graphics branch is out of range');
                bytes[ref.at] = delta & 0xFF;
            } else { bytes[ref.at] = target & 0xFF; bytes[ref.at + 1] = target >> 8; }
        }
        Romfix.fixCodeInsert(romData, file(base), bytes);
        // $80B2 is BEQ over this JSR; its operand at $80B3 stays intact.
        Romfix.fixCodeInsert(romData, file(0x80B4), [0x20, base & 0xFF, base >> 8]);
        return { start: base, end: base + bytes.length };
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
            0x8D, 0x01, 0x20, 0xA9, 0x00, 0x8D, 0x05, 0x20, 0x8D, 0x05, 0x20, 0xA9, 0x00, 0x8D, 0x00, 0x80,
            0xA9, 0x80, 0x8D, 0x00, 0x20, 0x68, 0x85, 0x31, 0x68, 0x85, 0x30, 0x68, 0xA8, 0x68, 0xAA, 0x68,
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
