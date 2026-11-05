const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const jsnes = require('../../js/lib/jsnes.min.js');
const { load } = require('../helpers/source.cjs');
const { Terrain, RomLayout, LevelCodec, Project } = load('Terrain RomLayout LevelCodec Project');
// A separate runtime models commenting out only the new patch call.
const disabled = load('Terrain Project');
disabled.Terrain.enableSolidTileCrush = () => {};
const original = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;
const realTest = (name, fn) => test(name, { skip: !original }, fn);
const tiles = [1, 2, 3, 4, 5, 6, 12];
const B = jsnes.Controller;

const patchByte = i => [0x1C0BA, 0x1C0BB, 0x1C0BC, 0x1C0BD, 0x1C0BE, 0x1C0BF, 0x1C0C5].includes(i)
    || (i >= 0x1887 && i < 0x188A) || (i >= 0x1FAF0 && i < 0x1FB10);

test('solid crush changes only its action bytes, lookup hook and reserved wrapper', () => {
    const rom = Uint8Array.from({ length: 0x20010 }, (_, i) => i % 251);
    rom.fill(0, 0x1FAF0, 0x1FB10);
    Terrain.enableTile13Crush(rom);
    const before = rom.slice();
    Terrain.enableSolidTileCrush(rom);
    const changed = Array.from(rom.keys()).filter(i => rom[i] !== before[i]);
    assert.ok(changed.every(patchByte));
    for(const tile of tiles) assert.equal(rom[RomLayout.programOffset(0xC0A9 + tile)], 1);
    assert.deepEqual(Array.from(rom.slice(0x1887, 0x188A)), [0x20, 0xE0, 0xFA]);
    assert.equal(rom[0x1C0C6], 1);
});

test('an occupied helper reservation rejects the patch before changing the ROM', () => {
    const rom = new Uint8Array(0x20010);
    rom[0x1FAF0] = 0x60;
    const before = rom.slice();
    assert.throws(() => Terrain.enableSolidTileCrush(rom), /occupied/);
    assert.deepEqual(rom, before);
});

test('the lookup exempts only Tile 12 in spring state and preserves caller registers and stack', () => {
    const rom = new Uint8Array(0x20010);
    rom.set([0x4E, 0x45, 0x53, 0x1A, 8, 0, 0x21]);
    rom.set([0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 2, 0, 1, 1, 3], 0x1C0B9);
    Terrain.enableSolidTileCrush(rom);
    const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, emulateSound: false });
    nes.loadROM(Buffer.from(rom).toString('binary'));
    const c = nes.cpu, m = c.mem;
    m[0x6000] = 0x20; m[0x6001] = 0xE0; m[0x6002] = 0xFA;
    for(const state of [1, 2, 3, 4, 5]) for(let tile = 0; tile < 16; tile++) {
        c.REG_PC = 0x5FFF; c.REG_SP = 0x1FF; c.irqRequested = false;
        c.REG_X = 0xA5; c.REG_Y = tile; m[0xC0] = state;
        for(let i = 0; i < 30 && c.REG_PC !== 0x6002; i++) c.emulate();
        assert.equal(c.REG_PC, 0x6002);
        assert.equal(c.REG_SP, 0x1FF);
        assert.equal(c.REG_X, 0xA5);
        assert.equal(c.REG_Y, tile);
        assert.equal(c.REG_ACC, tile === 12 && state === 4 ? 0 : m[0xC0A9 + tile],
            `tile=${tile}, state=${state}`);
    }
});

function stage({ tile = 5, enabled = true, playerX = 6, playerY = 11,
    floorTile = 5, wallTop = 8, wallBottom = 12 } = {}) {
    const project = new (enabled ? Project : disabled.Project)();
    project.loadROM(original);
    project.gameConfig.cameraFollow = false;
    project.gameConfig.disableTimer = true;
    const map = Array.from({ length: 14 }, () => Array(16).fill(0));
    map[12].fill(floorTile);
    map[1][2] = 15; // Keep a rescue target so the exit does not end the test.
    for(let y = wallTop; y < wallBottom; y++) map[y][8] = tile;
    const converted = LevelCodec.fromLevelEditorToROMData({ background: 0,
        player: { x: playerX, y: playerY }, door: { x: 14, y: 11 }, map, enemies: [] }, false);
    project.levels[0].data = converted.mapData;
    project.levels[0].monsterData = converted.monsterData;
    project.levelCount = 1;
    return project.getROMData();
}

function start(options) {
    const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, emulateSound: false });
    nes.loadROM(Buffer.from(stage(options)).toString('binary'));
    for(let i = 0; i < 160; i++) nes.frame();
    nes.buttonDown(1, B.BUTTON_START); nes.frame(); nes.buttonUp(1, B.BUTTON_START);
    for(let i = 0; i < 600; i++) {
        nes.frame();
        const m = nes.cpu.mem;
        if(m[0x30] === 12 && m[0x56] === 3 && !(m[0x2A] & 128)) return nes;
    }
    assert.fail('START did not reach gameplay');
}

function buttons(nes, keys) {
    for(const key of [B.BUTTON_LEFT, B.BUTTON_RIGHT, B.BUTTON_A]) nes.buttonUp(1, key);
    for(const key of keys) nes.buttonDown(1, key);
}

function position(nes) {
    const m = nes.cpu.mem;
    return { x: m[0xC1] * 256 + m[0xC2], y: m[0x41E], yHigh: m[0x7D],
        facing: m[0xCB], motion: m[0xC0], phase: m[0x30],
        vx: m[0xC5], vy: m[0xC7], xFraction: m[0xC3], yFraction: m[0xC4] };
}

function clip(tile, direction, enabled) {
    const spring = tile === 12;
    const nes = start({ tile, enabled, playerX: direction === 1 ? 6 : spring ? 11 : 10 });
    for(let i = 0; i < 20; i++) nes.frame();
    const forward = direction === 1 ? B.BUTTON_RIGHT : B.BUTTON_LEFT;
    const backward = direction === 1 ? B.BUTTON_LEFT : B.BUTTON_RIGHT;
    const approach = spring ? (direction === 1 ? 2 : 14) : 10;
    const turn = spring ? 1 : 10;
    buttons(nes, [forward]);
    for(let i = 0; i < approach; i++) nes.frame();
    const trace = [];
    // Tap the reverse direction once, then coast on the original inertia.
    // After entering the wall, press forward again to demonstrate a full exit.
    for(let i = 0; i < 80; i++) {
        buttons(nes, [...(i < turn || i >= 35 ? [forward] : i === turn ? [backward] : []),
            ...(i < 32 ? [B.BUTTON_A] : [])]);
        nes.frame(); trace.push(position(nes));
        if(nes.cpu.mem[0x30] !== 12) break;
    }
    return trace;
}

realTest('disabling just the new call restores the previous export, including Tile 13 crush', () => {
    const enabled = stage(), without = stage({ enabled: false });
    const changed = Array.from(enabled.keys()).filter(i => enabled[i] !== without[i]);
    assert.ok(changed.every(patchByte), 'disabling removes the entire patch and nothing else');
    for(const tile of tiles) {
        assert.equal(enabled[RomLayout.programOffset(0xC0A9 + tile)], 1);
        assert.equal(without[RomLayout.programOffset(0xC0A9 + tile)], 0);
    }
    assert.deepEqual(Array.from(without.slice(0x1887, 0x188A)), [0xB9, 0xA9, 0xC0]);
    assert.ok(without.slice(0x1FAF0, 0x1FB10).every(byte => byte === 0));
    for(const tile of [7, 8, 10, 13, 14]) {
        assert.equal(without[RomLayout.programOffset(0xC0A9 + tile)], 1);
    }
});

for(const tile of tiles) realTest(`Tile ${tile} stops inertial wall clips from both sides at the native death threshold`, () => {
    for(const direction of [1, -1]) {
        const before = clip(tile, direction, false), after = clip(tile, direction, true);
        const inside = p => p.x >= 128 && p.x < 144 && p.y >= 128 && p.y < 192;
        const firstInside = before.findIndex(inside);
        assert.ok(firstInside >= 0, 'unpatched input actually enters the solid');
        assert.ok(before.some(p => direction === 1 ? p.x >= 150 : p.x <= 122),
            'unpatched player exits through the opposite side');
        assert.ok(before.every(p => p.phase === 12), 'unpatched player survives');
        assert.equal(after.length, firstInside + 1, 'death occurs on the first occupied-cell frame');
        assert.deepEqual(after.slice(0, firstInside), before.slice(0, firstInside),
            'ordinary contact and shallow overlap remain unchanged');
        assert.equal(after.at(-1).phase, 14, 'native death phase');
        assert.ok(inside(after.at(-1)), 'death happens inside the wall');
    }
});

realTest('existing Tiles 7, 8, 10 and 13 still kill at the same point when the new call is disabled', () => {
    for(const tile of [7, 8, 10, 13]) {
        const before = clip(tile, 1, false), after = clip(tile, 1, true);
        assert.deepEqual(after, before);
        assert.equal(after.at(-1).phase, 14);
    }
});

for(const tile of tiles) realTest(`Tile ${tile} preserves normal floor, wall, ceiling and landing behavior`, () => {
    const cases = [
        { name: 'floor walk and jump', options: { floorTile: tile, wallTop: 12 },
            keys: i => [...(i < 55 ? [B.BUTTON_RIGHT] : []), ...(i % 24 === 0 ? [B.BUTTON_A] : [])] },
        { name: 'walk into wall', options: { tile }, keys: () => [B.BUTTON_RIGHT] },
        { name: 'jump into wall', options: { tile },
            keys: i => [B.BUTTON_RIGHT, ...(i % 24 === 0 ? [B.BUTTON_A] : [])] },
        { name: 'jump under ceiling', options: { tile, playerX: 8, wallBottom: 11 },
            keys: i => i % 24 === 0 ? [B.BUTTON_A] : [] },
        { name: 'land and jump on top', options: { tile, playerX: 8, playerY: 6 },
            keys: i => i === 30 || i === 60 ? [B.BUTTON_A] : [] },
        { name: 'walk off top', options: { tile, playerX: 8, playerY: 6 },
            keys: i => i >= 30 ? [B.BUTTON_RIGHT] : [] }
    ];
    if(tile === 12) cases.push({ name: 'charged spring compression and rebound',
        options: { floorTile: 12, wallTop: 12 }, frames: 500,
        keys: i => i >= 30 && i < 50 ? [B.BUTTON_A] : [] });
    for(const scenario of cases) {
        const traces = [false, true].map(enabled => {
            const nes = start({ ...scenario.options, enabled }), trace = [];
            for(let i = 0; i < (scenario.frames || 90); i++) {
                buttons(nes, scenario.keys(i)); nes.frame(); trace.push(position(nes));
                if(nes.cpu.mem[0x30] !== 12) break;
            }
            return trace;
        });
        assert.deepEqual(traces[1], traces[0], scenario.name);
        assert.equal(traces[1].length, scenario.frames || 90, scenario.name);
        assert.ok(traces[1].every(p => p.phase === 12), `${scenario.name}: no extra death`);
    }
});
