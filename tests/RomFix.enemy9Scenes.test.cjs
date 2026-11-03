const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const jsnes = require('../js/lib/jsnes.min.js');

const source = ['Config', 'Level', 'RomFix', 'RomEditor', 'DataConverter']
    .map(name => fs.readFileSync(path.join(__dirname, '../js', `${name}.js`), 'utf8')).join('\n');
const { Romfix, RomEditor, DataConverter } = new Function('i18n',
    `${source}\nreturn { Romfix, RomEditor, DataConverter };`)({ t: key => key });
const original = process.env.MOAIKUN_TEST_ROM
    ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;
const readOriginal = address => original[address - 0x8000 + 16];
const originalWord = address => readOriginal(address) | readOriginal(address + 1) << 8;
const graphicsPages = [1, 1, 1, 1, 1, 2, 2, 3, 3, 2, 2, 2];
const enemyTiles = Array.from(Romfix.SCENE_GRAPHICS_ENEMY9_TILES);
const mapEnemyTile = tile => {
    const index = enemyTiles.indexOf(tile);
    assert.ok(index >= 0, `Unknown native Enemy 9 tile ${tile.toString(16)}`);
    return Romfix.SCENE_GRAPHICS_LAYOUT.enemy9Start + index;
};
const flameTiles = new Set(enemyTiles.filter(tile =>
    !(tile >= 0xD2 && tile <= 0xD9) && !(tile >= 0xE0 && tile <= 0xE7)).map(mapEnemyTile));

function stage(scene, facing = 0) {
    const editor = new RomEditor();
    editor.loadROM(original);
    editor.gameConfig.disableTimer = true;
    const map = Array.from({ length: 14 }, () => Array(16).fill(0));
    map[12].fill(5);
    map[1][2] = 15;
    const data = DataConverter.fromLevelEditorToROMData({
        background: scene, map, player: { x: facing ? 13 : 3, y: 11 },
        door: { x: 14, y: 10 }, enemies: [{ enemyId: 9 | facing, x: 8, y: 11 }]
    }, false);
    editor.levels[0].data = data.mapData;
    editor.levels[0].monsterData = data.monsterData;
    editor.levelCount = 1;
    return editor.getROMData();
}

function start(data, onFrame = () => {}) {
    const nes = new jsnes.NES({ onFrame, onAudioSample() {}, emulateSound: false });
    nes.loadROM(Buffer.from(data).toString('binary'));
    for (let frame = 0; frame < 160; frame++) nes.frame();
    nes.buttonDown(1, jsnes.Controller.BUTTON_START);
    nes.frame();
    nes.buttonUp(1, jsnes.Controller.BUTTON_START);
    for (let frame = 0; frame < 600; frame++) {
        nes.frame();
        const memory = nes.cpu.mem;
        if (memory[0x30] === 12 && memory[0x56] === 3 && !(memory[0x2A] & 0x80)) return nes;
    }
    assert.fail('Native START did not reach active gameplay');
}

function assertEnemyPatterns(nes, label) {
    for (const tile of enemyTiles) {
        const mapped = mapEnemyTile(tile);
        assert.deepEqual(
            Uint8Array.from(nes.ppu.vramMem.slice(0x1000 + mapped * 16, 0x1010 + mapped * 16)),
            Uint8Array.from(original.subarray(0xF010 + tile * 16, 0xF020 + tile * 16)),
            `${label}: enemy background tile ${tile.toString(16)}`);
    }
}

function assertReservedBackgroundUntouched(nes, label) {
    const first = Romfix.SCENE_GRAPHICS_LAYOUT.reservedBackgroundStart;
    assert.ok(Number.isInteger(first) && first > 0 && first <= 0xFF);
    const {portalStart, portalTileCount} = Romfix.SCENE_GRAPHICS_LAYOUT;
    for (let index = first; index < 0x100; index++) {
        if (index >= portalStart && index < portalStart + portalTileCount) continue;
        assert.ok(nes.ppu.vramMem.slice(0x1000 + index * 16, 0x1010 + index * 16)
            .every(value => value === 0), `${label}: unused reserved background CHR was written`);
    }
    assert.deepEqual(Uint8Array.from(nes.ppu.vramMem.slice(0x1000 + portalStart * 16,
        0x1000 + (portalStart + portalTileCount) * 16)), Romfix.getPortalPatterns(Romfix.getPortalColorSchemes(original, nes.cpu.mem[0x3E])),
        `${label}: Enemy 9 preserves the portal artwork`);
    const unexpectedTile = nes.ppu.vramMem.slice(0x2000, 0x2000 + 28 * 32)
        .findIndex(tile => tile >= first);
    assert.equal(unexpectedTile, -1,
        `${label}: nametable uses reserved background at (${unexpectedTile & 31}, ${unexpectedTile >> 5})`);
    assert.equal(nes.ppu.f_spriteSize, 1, `${label}: expected native 8x16 sprites`);
    for (let offset = 0; offset < 256; offset += 4) {
        const y = nes.ppu.spriteMem[offset];
        const tile = nes.ppu.spriteMem[offset + 1];
        // Off-screen OAM entries do not fetch a visible pattern. An odd tile
        // in a visible 8x16 sprite selects the background pattern table.
        if (y < 239 && (tile & 1)) {
            assert.ok((tile & 0xFE) + 1 < first,
                `${label}: OAM slot ${offset / 4} reads reserved background tile ${tile.toString(16)}`);
        }
    }
}

function assertBackgroundAppearance(nes, scene) {
    const layout = originalWord(0xCAD2 + scene * 2);
    const definitions = originalWord(0xCCB2 + scene * 2);
    const animated = new Set();
    if (scene === 8) {
        for (let slot = 0; slot < 8; slot++) {
            if (!nes.cpu.mem[0x59E + slot]) continue;
            const address = 0x2000 + nes.cpu.mem[0x5A6 + slot];
            for (const offset of [0, 1, 32, 33]) animated.add(address + offset);
        }
    }
    let checked = 0, relocated = 0;
    for (let y = 0; y < 28; y++) for (let x = 0; x < 32; x++) {
        const mapX = x >> 1, mapY = y >> 1;
        // Foreground, the statue, door and its five-cell breath strip replace
        // the scenery. Player and HUD sprites do not alter the nametable.
        if (mapY === 12 || mapY === 11 || (mapX === 2 && mapY === 1) ||
            (mapX === 8 && mapY === 10) || (mapX >= 14 && mapY === 10)) continue;
        const address = 0x2000 + y * 32 + x;
        if (animated.has(address)) continue;
        const blockX = x >> 2, blockY = y >> 2;
        let block;
        if (scene === 7 || scene === 8) {
            block = readOriginal(layout + blockY * 8 + blockX);
        } else {
            const packed = readOriginal(layout + blockY * 4 + (blockX >> 1));
            block = blockX & 1 ? packed & 15 : packed >> 4;
        }
        const originalTile = readOriginal(definitions + block * 16 + (y & 3) * 4 + (x & 3));
        const actualTile = nes.ppu.vramMem[address];
        const nativeOffset = 0x9010 + graphicsPages[scene] * 0x2000 + originalTile * 16;
        assert.deepEqual(
            Uint8Array.from(nes.ppu.vramMem.slice(0x1000 + actualTile * 16, 0x1010 + actualTile * 16)),
            Uint8Array.from(original.subarray(nativeOffset, nativeOffset + 16)),
            `scene ${scene}: scenery pixels at tile (${x}, ${y})`);
        checked++;
        if (originalTile >= 0xD2 && originalTile <= 0xFD) relocated++;
    }
    assert.ok(checked >= 500, `scene ${scene}: too few scenery tiles checked`);
    return relocated;
}

test('native Enemy 9 draws and completes its breath cycle in every scene and facing',
    { skip: !original }, () => {
        let relocatedScenery = 0;
        for (let scene = 0; scene < 12; scene++) for (const facing of [0, 0x40]) {
            const label = `scene ${scene}, facing ${facing ? 'right' : 'left'}`;
            const nes = start(stage(scene, facing));
            const memory = nes.cpu.mem;
            const slot = memory.slice(0x4FE, 0x506).indexOf(9);
            assert.ok(slot >= 0, `${label}: enemy was initialized`);
            assert.equal(memory[0x3E], scene, label);
            assert.equal(memory[0x556 + slot], facing ? 4 : 3, label);
            assertEnemyPatterns(nes, label);
            assertReservedBackgroundUntouched(nes, label);
            // The native direction-3 statue uses E0-E3; direction 4 uses D2-D5.
            const firstTile = facing ? 0xD2 : 0xE0;
            assert.deepEqual([0, 1, 32, 33].map(offset => nes.ppu.vramMem[0x2290 + offset]),
                [firstTile, firstTile + 1, firstTile + 2, firstTile + 3].map(mapEnemyTile), `${label}: head`);
            relocatedScenery += assertBackgroundAppearance(nes, scene);
            let previousStep = memory[0x57E + slot], cycles = 0, sawFlame = false;
            const stackPointers = [];
            for (let frame = 0; frame < 90; frame++) {
                nes.frame();
                assertReservedBackgroundUntouched(nes, label);
                const step = memory[0x57E + slot];
                if (step < previousStep) cycles++;
                previousStep = step;
                stackPointers.push(nes.cpu.REG_SP);
                const left = facing ? 16 : 8;
                for (let y = 22; y <= 23; y++) for (let x = left; x < left + 10; x++) {
                    if (flameTiles.has(nes.ppu.vramMem[0x2000 + y * 32 + x])) sawFlame = true;
                }
                assert.equal(memory[0x30], 12, `${label}: gameplay state`);
                assert.equal(memory[0x56], 3, `${label}: player remains alive`);
                assert.equal(memory[0x4FE + slot], 9, `${label}: enemy remains present`);
                assert.equal(nes.cpu.crash, false, `${label}: CPU crash`);
            }
            assert.ok(cycles >= 1, `${label}: full native breath cycle`);
            assert.ok(sawFlame, `${label}: flame patterns reached the nametable`);
            assert.ok(Math.min(...stackPointers) >= 0x1D0 && Math.max(...stackPointers) <= 0x1FF,
                `${label}: stack leaked during repeated native updates`);
            assertEnemyPatterns(nes, label);
            relocatedScenery += assertBackgroundAppearance(nes, scene);
        }
        assert.ok(relocatedScenery > 0, 'Native rendering exercised relocated decorative tiles');
    });
