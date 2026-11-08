class SceneCompiler {
    static SCENE_GRAPHICS_ENEMY9_TILES = Object.freeze(
        Array.from({length: 44}, (_, index) => 0xD2 + index)
            .filter(tile => tile !== 0xED && tile !== 0xF0)
    );

    /**
     * Build twelve independent CHR-RAM images without changing the source.
     * Original CHR pages stay at $8010-$1000F. Shared background-definition
     * tables share one relocation map, so their tile references remain valid.
     */
    static buildSceneGraphics(romData, frames) {
        if (romData.length < 0x20010) throw new Error('Scene graphics require an expanded ROM');
        const source = romData.slice();
        const layout = GraphicsCatalog.SCENE_GRAPHICS_LAYOUT;
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
            const spriteTiles = new Set([...range(0, 0xA7), ...range(0xDE, 0xFF)]);
            for (const tile of spriteTiles) patterns.set(original.subarray(tile * 16, tile * 16 + 16), tile * 16);
            // Metasprite 8 still uses the old floating-head pattern for
            // spawn smoke. Use the column freed by TNT's shared left half,
            // in every scene; keep the native player poses at $50 onward intact.
            patterns.set(original.subarray(0xE40, 0xE60), layout.spawnSmoke * 16);
            if (scene === 7 || scene === 8) {
                // $A8/$A9 are unused by native metasprites. Move the four
                // boss poses forward one 8x16 column, preserving every pixel.
                patterns.set(original.subarray(0xAA0, 0xE00), layout.bossStart * 16);
                for (let tile = layout.bossStart; tile < layout.bossStart + layout.bossTileCount; tile++) spriteTiles.add(tile);
            }
            patterns.set(original.subarray(0xE60, 0xE80), layout.timerIcon * 16);
            patterns.set(original.subarray(0xE80, 0xEA0), layout.bombIcon * 16);
            patterns.set(Hud.iconPatterns('remote'), layout.remoteBombIcon * 16);
            patterns.set(Hud.iconPatterns('rescue'), layout.rescueIcon * 16);
            if (scene !== 7 && scene !== 8) {
                patterns.set(frames ? (scene === 4 ? frames.fish : frames.bird) : SpritePatterns.getFlightSpriteFrames(source, scene === 4), 0xAA0);
                for (let tile = 0xAA; tile <= 0xB1; tile++) spriteTiles.add(tile);
                if (Penguin.ENABLED) {
                    patterns.set(frames?.penguin || SpritePatterns.getPenguinFrames(source), Penguin.TILE * 16);
                    for (let tile = Penguin.TILE; tile < Penguin.TILE + 12; tile++) spriteTiles.add(tile);
                }
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
            SceneCompiler.SCENE_GRAPHICS_ENEMY9_TILES.forEach((tile, index) => {
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
            const portal = SpritePatterns.getPortalPatterns(SpritePatterns.getPortalColorSchemes(source, scene));
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
                    !(tile >= layout.enemy9Start && tile < layout.enemy9Start + SceneCompiler.SCENE_GRAPHICS_ENEMY9_TILES.length) &&
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
        patchValues.set(fixed(0xC0CB), layout.spawnSmoke);
        // Tile bytes only: leave boss positions, palettes and flip bits intact.
        for (const [cpu, count] of [[0xC1E5, 8], [0xC206, 8], [0xC227, 8], [0xC248, 9]]) {
            for (let index = 0; index < count; index++) {
                const at = fixed(cpu + 2 + index * 4);
                patchValues.set(at, source[at] - 0xAA + layout.bossStart);
            }
        }
        const enemy9 = new Map(SceneCompiler.SCENE_GRAPHICS_ENEMY9_TILES.map((tile, index) => [tile, layout.enemy9Start + index]));
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
            sharedSpikes, layout
        };
    }

    /** Store deduplicated 256-byte CHR pages and a 32-page list per scene. */
    static compileSceneGraphics(romData, frames) {
        const built = SceneCompiler.buildSceneGraphics(romData, frames);
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
            GraphicsCatalog.SCENE_GRAPHICS_LAYOUT.version], 0x18020);
        romData.set(manifest, 0x18A10);
        for (const { fileAddr, value } of built.patches) romData[fileAddr] = value;
        romData.set(Array.from({ length: 12 }, (_, scene) => 0x80 + scene), 0x1D831);
        return {
            uniquePages: pages.length,
            layout: GraphicsCatalog.SCENE_GRAPHICS_LAYOUT,
            scenes: built.scenes.map(({ scene, usedSpriteTiles, usedBackgroundTiles, freeSpriteTiles, freeBackgroundTiles }) => ({
                scene, usedSpriteTiles: usedSpriteTiles.length, usedBackgroundTiles: usedBackgroundTiles.length,
                freeSpriteTiles: freeSpriteTiles.length, freeBackgroundTiles: freeBackgroundTiles.length
            }))
        };
    }
}
