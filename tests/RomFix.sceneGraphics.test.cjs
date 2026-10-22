const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Romfix = new Function(fs.readFileSync(path.join(__dirname, '../js/RomFix.js'), 'utf8') +
    '\nreturn Romfix;')();
const fixed = cpu => 0x1C010 + cpu - 0xC000;
const pages = [1, 1, 1, 1, 1, 2, 2, 3, 3, 2, 2, 2];
const tile = (data, offset, index) => data.slice(offset + index * 16, offset + (index + 1) * 16);

function fixture() {
    const data = new Uint8Array(0x20010);
    for (let page = 1; page <= 3; page++) {
        for (let index = 0; index < 512; index++) {
            data.fill((page * 17 + index) & 255,
                0x8010 + page * 0x2000 + index * 16,
                0x8010 + page * 0x2000 + (index + 1) * 16);
            data[0x8011 + page * 0x2000 + index * 16] = page * 3 + (index >> 8);
        }
    }
    const word = (cpu, value) => data.set([value & 255, value >> 8], fixed(cpu));
    for (let scene = 0; scene < 12; scene++) {
        word(0xCAD2 + scene * 2, 0xDA00 + scene * 0x40);
        word(0xCCB2 + scene * 2, 0xCCF2);
        const wide = scene === 7 || scene === 8;
        data.fill(wide ? 31 : scene === 1 ? 0x11 : 0,
            fixed(0xDA00 + scene * 0x40), fixed(0xDA00 + scene * 0x40) + (wide ? 56 : 28));
    }
    data.fill(0xD2, fixed(0xCCF2), fixed(0xCCF2) + 16);
    data[fixed(0xCCF2) + 1] = 0x98;
    data.fill(0xD3, fixed(0xCCF2) + 16, fixed(0xCCF2) + 32);
    data[fixed(0xCCF2) + 17] = 0x99;
    data.fill(0xD4, fixed(0xCCF2) + 31 * 16, fixed(0xCCF2) + 32 * 16);
    data.set(pages, fixed(0xD821));
    data.set([0x4D, 0x4F, 0x41, 0x49, 0x4B, 0x4D, 0x32, 0, 1, 0], 0x18010);
    return data;
}

function compiledPatterns(data, scene) {
    const result = new Uint8Array(0x2000);
    for (let page = 0; page < 32; page++) {
        const index = data[0x18A10 + scene * 32 + page];
        assert.ok(index < 116);
        const offset = index < 64 ? 0x14010 + index * 256 : 0x18C10 + (index - 64) * 256;
        result.set(data.subarray(offset, offset + 256), page * 256);
    }
    return result;
}

test('scene builds preserve source data, share definition relocations, and clear every free tile', () => {
    const data = fixture(), snapshot = data.slice();
    const built = Romfix.buildSceneGraphics(data);
    assert.deepEqual(data, snapshot);
    assert.equal(built.scenes.length, 12);
    const decoration = offset => built.patches.find(patch => patch.fileAddr === fixed(0xCCF2) + offset).value;
    const first = decoration(0), second = decoration(16), castle = decoration(31 * 16);
    assert.equal(first, second, 'decorations in mutually exclusive scenes share a slot');
    assert.ok(castle < Romfix.SCENE_GRAPHICS_LAYOUT.reservedBackgroundStart,
        'castle layouts can select definitions 16 through 31');
    assert.equal(new Set(built.patches.map(patch => patch.fileAddr)).size, built.patches.length);
    for (const scene of built.scenes) {
        assert.equal(scene.patterns.length, 0x2000);
        assert.equal(scene.usedSpriteTiles.length + scene.freeSpriteTiles.length, 256);
        assert.equal(scene.usedBackgroundTiles.length + scene.freeBackgroundTiles.length, 256);
        for (const index of scene.freeSpriteTiles) assert.ok(tile(scene.patterns, 0, index).every(value => value === 0));
        for (const index of scene.freeBackgroundTiles) assert.ok(tile(scene.patterns, 0x1000, index).every(value => value === 0));
        for (const [index, originalTile] of Romfix.SCENE_GRAPHICS_ENEMY9_TILES.entries()) {
            assert.deepEqual(tile(scene.patterns, 0x1000, Romfix.SCENE_GRAPHICS_LAYOUT.enemy9Start + index),
                tile(data, 0xF010, originalTile), 'Enemy 9 background patterns are always available');
        }
        const source = 0x8010 + pages[scene.scene] * 0x2000;
        if (scene.scene === 7 || scene.scene === 8) {
            assert.deepEqual(scene.patterns.slice(0, 0x1000), data.slice(source, source + 0x1000));
            assert.deepEqual(tile(scene.patterns, 0x1000, castle), tile(data, source + 0x1000, 0xD4));
        } else {
            assert.equal(scene.freeSpriteTiles.length, 46);
            assert.deepEqual(scene.patterns.slice(0xAA0, 0xB20), Romfix.getFlightSpriteFrames(data, scene.scene === 4));
        }
        if (scene.scene === 8) for (let index = 0; index < 3; index++) {
            const target = Romfix.SCENE_GRAPHICS_LAYOUT.scene8SingleStart + index;
            assert.ok(scene.usedBackgroundTiles.includes(target));
            assert.deepEqual(tile(scene.patterns, 0x1000, target), tile(data, source + 0x1000, 0xCD + index));
        }
    }
    assert.deepEqual(tile(built.scenes[0].patterns, 0x1000, first), tile(data, 0xB010, 0xD2));
    assert.deepEqual(tile(built.scenes[1].patterns, 0x1000, second), tile(data, 0xB010, 0xD3));
    assert.deepEqual(tile(built.scenes[5].patterns, 0x1000, first), tile(data, 0xD010, 0xD2),
        'one shared relocation preserves the scene-specific original artwork');
});

test('scene compilation writes a lossless manifest, preserves original CHR and marker, and is repeatable', () => {
    const data = fixture(), original = data.slice(), built = Romfix.buildSceneGraphics(data);
    const stats = Romfix.compileSceneGraphics(data);
    assert.ok(stats.uniquePages > 64 && stats.uniquePages <= 116, 'exercise both page-pool banks');
    assert.deepEqual(data.slice(0x8010, 0x10010), original.slice(0x8010, 0x10010));
    assert.deepEqual(data.slice(0x18010, 0x1801A), original.slice(0x18010, 0x1801A));
    assert.equal(Buffer.from(data.slice(0x18020, 0x18028)).toString('ascii'), 'SCENECHR');
    assert.equal(data[0x18028], Romfix.SCENE_GRAPHICS_LAYOUT.version);
    assert.deepEqual(Array.from(data.slice(fixed(0xD821), fixed(0xD821) + 12)), pages.map((_, scene) => 0x80 + scene));
    assert.deepEqual(data.slice(0x18110, 0x18990), original.slice(fixed(0xCCF2), fixed(0xD572)));
    for (const scene of built.scenes) assert.deepEqual(compiledPatterns(data, scene.scene), scene.patterns);
    const snapshot = data.slice();
    assert.deepEqual(Romfix.compileSceneGraphics(data), stats);
    assert.deepEqual(data, snapshot);
    assert.deepEqual(Romfix.buildSceneGraphics(data).scenes.map(scene => scene.patterns), built.scenes.map(scene => scene.patterns));
});

test('reloading a compiled ROM restores native definitions and graphics selectors', () => {
    const source = fixture(), original = source.slice(), target = new Uint8Array(source.length);
    assert.equal(Romfix.restoreSceneGraphicsSource(target, source), false);
    assert.ok(target.every(value => value === 0));
    Romfix.compileSceneGraphics(source);
    assert.equal(Romfix.restoreSceneGraphicsSource(target, source), true);
    assert.deepEqual(target.slice(fixed(0xCCF2), fixed(0xD572)), original.slice(fixed(0xCCF2), fixed(0xD572)));
    assert.deepEqual(Array.from(target.slice(fixed(0xD821), fixed(0xD821) + 12)), pages);
});

test('an overflowing scene page pool fails before changing the ROM', () => {
    const data = fixture(), snapshot = data.slice(), build = Romfix.buildSceneGraphics;
    try {
        Romfix.buildSceneGraphics = () => ({ scenes: Array.from({ length: 4 }, (_, scene) => {
            const patterns = new Uint8Array(0x2000);
            for (let page = 0; page < 32; page++) patterns[page * 256] = scene * 32 + page;
            return { scene, patterns };
        }) });
        assert.throws(() => Romfix.compileSceneGraphics(data), /116-page pool/);
        assert.deepEqual(data, snapshot);
    } finally { Romfix.buildSceneGraphics = build; }
});

const original = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;
test('native scene artwork remains identical after relocating background decorations', { skip: !original }, () => {
    const data = new Uint8Array(0x20010);
    data.set(original.subarray(0, 0x10010));
    data.set(original.subarray(0x4010, 0x8010), 0x1C010);
    const native = data.slice(), built = Romfix.buildSceneGraphics(data);
    const stats = Romfix.compileSceneGraphics(data);
    assert.ok(stats.uniquePages <= 116);
    const word = cpu => native[fixed(cpu)] | native[fixed(cpu) + 1] << 8;
    for (let scene = 0; scene < 12; scene++) {
        const layout = fixed(word(0xCAD2 + scene * 2)), definitions = fixed(word(0xCCB2 + scene * 2));
        const wide = scene === 7 || scene === 8;
        const patterns = compiledPatterns(data, scene);
        assert.deepEqual(patterns, built.scenes[scene].patterns);
        for (let index = 0; index < (wide ? 56 : 28); index++) {
            const value = native[layout + index], entries = wide ? [value] : [value >> 4, value & 15];
            for (const entry of entries) for (let offset = 0; offset < 16; offset++) {
                const address = definitions + entry * 16 + offset;
                assert.deepEqual(tile(patterns, 0x1000, data[address]),
                    tile(native, 0x9010 + pages[scene] * 0x2000, native[address]), `scene ${scene}, definition byte ${address}`);
            }
        }
    }
});
