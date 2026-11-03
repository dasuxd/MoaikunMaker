const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const jsnes = require('../js/lib/jsnes.min.js');

const source = ['Config', 'Level', 'RomFix', 'RomEditor', 'DataConverter']
    .map(name => fs.readFileSync(path.join(__dirname, '../js', `${name}.js`), 'utf8')).join('\n');
const { Romfix, RomEditor } = new Function('i18n',
    `${source}\nreturn { Romfix, RomEditor };`)({ t: key => key });
const original = process.env.MOAIKUN_TEST_ROM
    ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;
const realTest = (name, body) => test(name, { skip: !original }, body);
const fixed = cpu => 0x1C010 + cpu - 0xC000;
const bank0 = cpu => 0x10 + cpu - 0x8000;
const graphicsPages = [1, 1, 1, 1, 1, 2, 2, 3, 3, 2, 2, 2];
const nativeForeground = [0x74, 0x6C, 0x7C, 0x84, 0x8C, 0x6C, 0x5A, 0x6C, 0x6C, 0x6C, 0x6C, 0x74];
const tile = (bytes, base, index) => bytes.slice(base + index * 16, base + (index + 1) * 16);
const signature = [0x53, 0x43, 0x45, 0x4E, 0x45, 0x43, 0x48, 0x52];

function expandedSource() {
    const data = new Uint8Array(0x20010);
    data.set(original.subarray(0, 0x4010));
    data.set(original.subarray(0x4010, 0x8010), 0x1C010);
    data.set(original.subarray(0x8010, 0x10010), 0x8010);
    data.set([8, 0, 0x21, 0], 4);
    // Exports relocate these levels before using the fixed-bank helper area.
    data.fill(0, fixed(0xEF8F), fixed(0xFF80));
    return data;
}

function machine(data) {
    const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, emulateSound: false });
    nes.loadROM(Buffer.from(data).toString('binary'));
    nes.cpu.irqRequested = false;
    return nes;
}

function call(nes, address, accumulator = 0) {
    const cpu = nes.cpu, memory = cpu.mem;
    cpu.irqRequested = false;
    cpu.REG_PC = address - 1;
    cpu.REG_ACC = accumulator;
    cpu.REG_SP = 0x1FD;
    memory[0x1FE] = 0xFF;
    memory[0x1FF] = 0x7F;
    for (let count = 0; count < 100000; count++) {
        cpu.emulate();
        if (cpu.REG_PC === 0x7FFF) return;
    }
    assert.fail(`CPU routine $${address.toString(16)} did not return`);
}

test('the unified layout allocates the portal inside the shared background reserve', () => {
    const layout = Romfix.SCENE_GRAPHICS_LAYOUT;
    assert.equal(layout.version, 2);
    assert.equal(layout.foregroundStart, 0x60);
    assert.equal(layout.enemy9Start, 0x6C);
    assert.equal(layout.scene8MetatileStart, 0x96);
    assert.equal(layout.scene8SingleStart, 0xA2);
    assert.equal(layout.reservedBackgroundStart, 0xBA);
    assert.equal(layout.reservedBackgroundEnd, 0x100);
    assert.ok(layout.reservedBackgroundStart >= layout.scene8SingleStart + 3);
    assert.ok(layout.reservedBackgroundEnd - layout.reservedBackgroundStart >= 64);
    assert.equal(layout.portalStart, 0xBA);
    assert.equal(layout.portalTileCount, 70);
    assert.equal(Romfix.SCENE_GRAPHICS_ENEMY9_TILES.length, 42);
    assert.equal(new Set(Romfix.SCENE_GRAPHICS_ENEMY9_TILES).size, 42);
});

test('v1 scene metadata still restores source decorations and native graphics selectors', () => {
    const data = new Uint8Array(0x20010);
    data.set([...signature, 1], 0x18020);
    for (let index = 0; index < 0x880; index++) data[0x18110 + index] = (index * 31 + 7) & 255;
    const snapshot = data.slice();
    const target = new Uint8Array(data.length);
    assert.equal(Romfix.restoreSceneGraphicsSource(target, data), true);
    assert.deepEqual(target.slice(fixed(0xCCF2), fixed(0xD572)), data.slice(0x18110, 0x18990));
    assert.deepEqual(Array.from(target.slice(fixed(0xD821), fixed(0xD821) + 12)), graphicsPages);
    assert.deepEqual(data, snapshot, 'restoring a source never changes the saved ROM');
});

realTest('all scene images add the portal in the reserve while preserving original artwork', () => {
    const data = expandedSource(), snapshot = data.slice();
    const built = Romfix.buildSceneGraphics(data);
    const layout = Romfix.SCENE_GRAPHICS_LAYOUT;
    assert.deepEqual(data, snapshot);
    assert.equal(built.scenes.length, 12);
    assert.deepEqual(built.layout, layout);
    assert.ok(built.sourceTables, 'native lookup tables must be preserved for subsequent exports');
    assert.ok(built.patches.every(patch => patch.value < layout.reservedBackgroundStart),
        'relocated native artwork never selects reserved background tiles');
    for (const scene of built.scenes) {
        const sourceBackground = 0x9010 + graphicsPages[scene.scene] * 0x2000;
        assert.deepEqual(scene.patterns.slice(0x1000 + layout.portalStart * 16,
            0x1000 + (layout.portalStart + layout.portalTileCount) * 16), Romfix.getPortalPatterns(Romfix.getPortalColorSchemes(data, scene.scene)));
        for (let index = layout.reservedBackgroundStart; index < layout.reservedBackgroundEnd; index++) {
            const portal = index >= layout.portalStart && index < layout.portalStart + layout.portalTileCount;
            if (!portal) assert.ok(tile(scene.patterns, 0x1000, index).every(value => value === 0));
            assert.equal(scene.freeBackgroundTiles.includes(index), !portal,
                `scene ${scene.scene}, tile ${index} free status`);
            assert.equal(scene.usedBackgroundTiles.includes(index), portal,
                `scene ${scene.scene}, tile ${index} used status`);
        }
        const sourceSprites = 0x8010 + graphicsPages[scene.scene] * 0x2000;
        assert.deepEqual(scene.patterns.slice(0x600, 0x840), data.slice(sourceSprites + 0x600, sourceSprites + 0x840),
            `scene ${scene.scene}, enemy sprite space retains native pixels during gameplay`);
        for (let offset = 0; offset < 12; offset++) {
            assert.deepEqual(tile(scene.patterns, 0x1000, layout.foregroundStart + offset),
                tile(data, sourceBackground, nativeForeground[scene.scene] + offset),
                `scene ${scene.scene}, foreground tile ${offset}`);
        }
        for (const index of [0x0E, 0x0F, 0x10, 0x11, 0x1A, 0x1B, 0x1C, 0x1D]) {
            assert.deepEqual(tile(scene.patterns, 0x1000, index), tile(data, sourceBackground, index),
                `scene ${scene.scene}, background-backed moving sprite tile ${index}`);
        }
        for (let index = 0; index < Romfix.SCENE_GRAPHICS_ENEMY9_TILES.length; index++) {
            assert.deepEqual(tile(scene.patterns, 0x1000, layout.enemy9Start + index),
                tile(data, 0xF010, Romfix.SCENE_GRAPHICS_ENEMY9_TILES[index]),
                `scene ${scene.scene}, Enemy 9 pattern ${index}`);
        }
    }
});

realTest('compilation rewrites every native lookup for the unified foreground, statue, and castle animations', () => {
    const data = expandedSource(), native = data.slice();
    Romfix.compileSceneGraphics(data);
    const layout = Romfix.SCENE_GRAPHICS_LAYOUT;
    assert.equal(data[0x18028], 2);
    assert.deepEqual(Array.from(data.slice(bank0(0xBFD4), bank0(0xBFD4) + 12)), Array(12).fill(layout.foregroundStart));
    const statue = new Map(Romfix.SCENE_GRAPHICS_ENEMY9_TILES.map((index, offset) => [index, layout.enemy9Start + offset]));
    for (const [start, length, address] of [[0xC07B, 16, fixed], [0xBDA1, 80, bank0]]) {
        for (let offset = 0; offset < length; offset++) {
            const oldTile = native[address(start + offset)];
            assert.ok(statue.has(oldTile), `unmapped statue tile ${oldTile}`);
            assert.equal(data[address(start + offset)], statue.get(oldTile),
                `statue lookup $${(start + offset).toString(16)}`);
        }
    }
    for (let offset = 0; offset < 12; offset++) {
        assert.equal(data[fixed(0xC06B) + offset],
            layout.scene8MetatileStart + native[fixed(0xC06B) + offset] - 0x7B);
    }
    assert.deepEqual(Array.from(data.slice(fixed(0xC08E), fixed(0xC08E) + 3)),
        [0, 1, 2].map(offset => layout.scene8SingleStart + offset));
    assert.deepEqual(data.slice(fixed(0xC024), fixed(0xC029)), native.slice(fixed(0xC024), fixed(0xC029)),
        'relocating patterns must preserve the native statue/fire palettes');
});

realTest('native tile preparation and the runtime uploader agree on all twelve foreground layouts', () => {
    const data = expandedSource(), native = data.slice();
    Romfix.compileSceneGraphics(data);
    const loader = Romfix.installSceneGraphicsLoader(data);
    const layout = Romfix.SCENE_GRAPHICS_LAYOUT;
    for (let scene = 0; scene < 12; scene++) {
        const nes = machine(data), memory = nes.cpu.mem;
        // The actual native scene-header decoder sets $45 via the patched table.
        call(nes, 0x8D0B, scene);
        assert.equal(memory[0x3E], scene);
        assert.equal(memory[0x45], layout.foregroundStart);
        for (let id = 1; id <= 3; id++) {
            call(nes, 0x9162, id);
            const start = layout.foregroundStart + (id - 1) * 4;
            assert.deepEqual([memory[0x83], memory[0x85], memory[0x84], memory[0x86]],
                [start, start + 1, start + 2, start + 3], `scene ${scene}, Tile ${id}`);
        }
        call(nes, 0x9162, 14);
        assert.deepEqual([memory[0x83], memory[0x85], memory[0x84], memory[0x86]], [0x2A, 0x2B, 0x2A, 0x2B]);
        memory[0x2F] = 0x80 + scene;
        call(nes, loader.start);
        assert.equal(memory[0x2E], memory[0x2F]);
        const sourceBackground = 0x9010 + graphicsPages[scene] * 0x2000;
        assert.deepEqual(Uint8Array.from(nes.ppu.vramMem.slice(0x1000 + layout.foregroundStart * 16,
            0x1000 + (layout.foregroundStart + 12) * 16)),
        native.slice(sourceBackground + nativeForeground[scene] * 16,
            sourceBackground + (nativeForeground[scene] + 12) * 16), `scene ${scene}, actual PPU foreground`);
        for (let index = layout.reservedBackgroundStart; index < layout.reservedBackgroundEnd; index++) {
            if (index >= layout.portalStart && index < layout.portalStart + layout.portalTileCount) continue;
            assert.ok(nes.ppu.vramMem.slice(0x1000 + index * 16, 0x1010 + index * 16)
                .every(value => value === 0), `scene ${scene}, actual PPU unused reserved tile ${index}`);
        }
        assert.deepEqual(Uint8Array.from(nes.ppu.vramMem.slice(0x1000 + layout.portalStart * 16,
            0x1000 + (layout.portalStart + layout.portalTileCount) * 16)), Romfix.getPortalPatterns(Romfix.getPortalColorSchemes(data, scene)));
    }
});

realTest('v2 source-table restoration and recompilation retain the original source exactly', () => {
    const data = expandedSource(), native = data.slice();
    const firstStats = Romfix.compileSceneGraphics(data);
    const compiled = data.slice(), restored = data.slice();
    assert.equal(Romfix.restoreSceneGraphicsSource(restored, compiled), true);
    for (const [start, length, address] of [[0xBFD4, 12, bank0], [0xBDA1, 80, bank0],
        [0xC06B, 12, fixed], [0xC07B, 16, fixed], [0xC08E, 3, fixed]]) {
        assert.deepEqual(restored.slice(address(start), address(start) + length),
            native.slice(address(start), address(start) + length), `source table $${start.toString(16)}`);
    }
    assert.deepEqual(restored.slice(fixed(0xCCF2), fixed(0xD572)), native.slice(fixed(0xCCF2), fixed(0xD572)));
    assert.deepEqual(Romfix.compileSceneGraphics(data), firstStats);
    assert.deepEqual(data, compiled);
});

realTest('a v1 compiled source migrates to the same unified image as its preserved native source', () => {
    const native = expandedSource(), legacy = native.slice(), expected = native.slice();
    legacy.set([...signature, 1], 0x18020);
    legacy.set(native.slice(fixed(0xCCF2), fixed(0xD572)), 0x18110);
    legacy[fixed(0xCCF2)] = 0x98; // A previous compiler relocated this decoration.
    legacy.set(Array.from({ length: 12 }, (_, scene) => 0x80 + scene), fixed(0xD821));
    assert.deepEqual(Romfix.compileSceneGraphics(legacy), Romfix.compileSceneGraphics(expected));
    assert.deepEqual(legacy, expected);
});

realTest('a unified-layout ROM is byte-stable after editor reload and re-export', () => {
    const editor = new RomEditor();
    editor.loadROM(original);
    const first = editor.getROMData();
    const reloaded = new RomEditor();
    reloaded.loadROM(first);
    assert.deepEqual(reloaded.getROMData(), first);
});
