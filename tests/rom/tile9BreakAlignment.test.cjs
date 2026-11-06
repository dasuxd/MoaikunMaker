const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const jsnes = require('../../js/lib/jsnes.min.js');
const { load } = require('../helpers/source.cjs');
const { Terrain, Project, LevelCodec } = load('Terrain Project LevelCodec');
const disabled = load('Terrain Project');
disabled.Terrain.fixTile9BreakAlignment = () => {};
const original = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;
const realTest = (name, fn) => test(name, { skip: !original }, fn);
const B = jsnes.Controller;

test('Tile 9 patch rejects occupied storage before writing anything', () => {
    const rom = new Uint8Array(0x20010);
    rom[0x1FED0] = 1;
    const before = rom.slice();
    assert.throws(() => Terrain.fixTile9BreakAlignment(rom), /occupied/);
    assert.deepEqual(rom, before);
});

function build({ tile = 9, wide = false, direction = 1, above = 0, nextTile = 0, enabled = true } = {}) {
    const project = new (enabled ? Project : disabled.Project)();
    project.loadROM(original);
    project.gameConfig.cameraFollow = wide;
    project.gameConfig.disableTimer = true;
    const map = Array.from({ length: 14 }, () => Array(wide ? 32 : 16).fill(0));
    map[12].fill(5); map[11][8] = tile; map[10][8] = above; map[1][2] = 15;
    map[11][9] = nextTile;
    const converted = LevelCodec.fromLevelEditorToROMData({ background: wide ? 0x10 : 0,
        player: { x: direction === 1 ? 6 : 10, y: 11 }, door: { x: 14, y: 10 }, map, enemies: [] }, wide);
    project.levels[0].data = converted.mapData;
    project.levels[0].monsterData = converted.monsterData;
    project.levelCount = 1;
    return project.getROMData();
}

function start(options) {
    const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, emulateSound: false });
    nes.loadROM(Buffer.from(build(options)).toString('binary'));
    for(let i = 0; i < 160; i++) nes.frame();
    nes.buttonDown(1, B.BUTTON_START); nes.frame(); nes.buttonUp(1, B.BUTTON_START);
    for(let i = 0; i < 600; i++) {
        nes.frame(); const m = nes.cpu.mem;
        if(m[0x30] === 12 && m[0x56] === 3 && !(m[0x2A] & 128)) return nes;
    }
    assert.fail('START did not reach gameplay');
}

function snapshot(nes) {
    const m = nes.cpu.mem;
    return { x: m[0xC1] * 256 + m[0xC2], y: m[0x41E], phase: m[0x30],
        map: m.slice(0x700, 0x800), debris: m.slice(0x478, 0x4A8),
        falling: m.slice(0x4C0, 0x4F2), punch: [m[0x50], m[0x55], m[0xD6], m[0xD7]] };
}

function punch(options) {
    const nes = start(options), direction = options.direction || 1;
    const button = direction === 1 ? B.BUTTON_RIGHT : B.BUTTON_LEFT;
    nes.buttonDown(1, button);
    for(let i = 0; i < options.steps; i++) nes.frame();
    nes.buttonUp(1, button); nes.frame(); nes.frame();
    const before = snapshot(nes), calls = [];
    const emulate = nes.cpu.emulate.bind(nes.cpu);
    nes.cpu.emulate = () => {
        const pc = (nes.cpu.REG_PC + 1) & 65535;
        if([0x9623, 0xA19E, 0xA5E5, 0x98FF].includes(pc)) calls.push(pc);
        if(pc === 0x80DA) calls.push(`sound:${nes.cpu.REG_ACC}`);
        return emulate();
    };
    nes.buttonDown(1, B.BUTTON_B); nes.frame(); nes.buttonUp(1, B.BUTTON_B);
    const after = snapshot(nes);
    nes.cpu.emulate = emulate;
    const trace = [];
    for(let i = 0; i < 30; i++) { nes.frame(); trace.push(snapshot(nes)); }
    assert.equal(nes.cpu.REG_SP, 0x1FF, 'native stack remains balanced');
    return { before, after, calls, trace };
}

realTest('commenting out only the Tile 9 call restores its complete original handler', () => {
    const enabled = build(), without = build({ enabled: false });
    const changes = Array.from(enabled.keys()).filter(i => enabled[i] !== without[i]);
    assert.ok(changes.length > 3);
    assert.ok(changes.every(i => (i >= 0x2503 && i < 0x2506) || (i >= 0x14B9 && i < 0x14BC)
        || (i >= 0x1FEC8 && i < 0x1FEE9)));
    assert.deepEqual(Array.from(without.slice(0x2503, 0x2506)), [0x20, 0x23, 0x96]);
    assert.deepEqual(Array.from(without.slice(0x14B9, 0x14BC)), [0x20, 0xFF, 0x98]);
    assert.ok(without.slice(0x1FEC8, 0x1FEE9).every(byte => byte === 0));
    assert.equal(without[0x1C0BE], 1, 'independent solid-crush patch remains enabled');
});

for(const wide of [false, true]) for(const direction of [1, -1]) {
    realTest(`overlapping Tile 9 breaks without moving the player: wide=${wide}, direction=${direction}`, () => {
        // Native punch probes are X+10 / X-11: stay inside this target cell.
        for(const steps of direction === 1 ? [26, 28, 30] : [23, 24, 26]) {
            const options = { wide, direction, steps };
            const beforePatch = punch({ ...options, enabled: false }), afterPatch = punch(options);
            assert.deepEqual(afterPatch.before, beforePatch.before);
            assert.ok(afterPatch.before.x >= 128 && afterPatch.before.x < 144, 'natural walking overlaps Tile 9');
            assert.equal(afterPatch.before.map[0xB4] >> 4, 9);
            assert.equal(beforePatch.after.map[0xB4] >> 4, 0, 'original input hits this target');
            assert.equal(afterPatch.after.map[0xB4] >> 4, 0, 'target is destroyed');
            assert.notEqual(beforePatch.after.x, beforePatch.before.x, 'old handler reproduces the snap');
            assert.equal(afterPatch.after.x, afterPatch.before.x, 'no break-time displacement');
            assert.equal(afterPatch.after.y, afterPatch.before.y);
            assert.deepEqual(afterPatch.calls, beforePatch.calls.filter(pc => pc !== 0x98FF));
            assert.ok(afterPatch.calls.includes('sound:16'), 'native break sound');
            assert.equal(afterPatch.after.punch[1], 0x81, 'Tile 9 marks only the delayed alignment exception');
            assert.deepEqual(afterPatch.after.punch.map((v, i) => i === 1 ? 2 : v), beforePatch.after.punch);
            for(const key of ['map', 'debris', 'falling'])
                assert.deepEqual(afterPatch.after[key], beforePatch.after[key], key);
            assert.ok(afterPatch.trace.every(p => p.x === afterPatch.before.x && p.phase === 12),
                'no delayed snap or death after the punch');
        }
    });
}

realTest('Tile 9 still registers the same unsupported falling tile and debris', () => {
    for(const direction of [1, -1]) {
        const options = { direction, steps: direction === 1 ? 28 : 26, above: 10 };
        const before = punch({ ...options, enabled: false }), after = punch(options);
        assert.ok(after.after.falling.some(Boolean), 'support removal registers a falling object');
        assert.ok(after.calls.includes(0xA5E5));
        for(const key of ['map', 'debris', 'falling'])
            assert.deepEqual(after.after[key], before.after[key], key);
    }
});

realTest('Tiles 5-8 retain their original alignment, effects and subsequent movement', () => {
    for(const tile of [5, 6, 7, 8]) for(const direction of [1, -1]) {
        const options = { tile, direction, steps: direction === 1 ? 28 : 26 };
        const before = punch({ ...options, enabled: false }), after = punch(options);
        assert.ok(after.calls.includes(0x98FF), 'solid block still uses native alignment');
        assert.deepEqual(after, before, `tile=${tile}, direction=${direction}`);
    }
});

realTest('a subsequent miss or solid-block hit replaces the Tile 9 marker', () => {
    for(const nextTile of [0, 5]) {
        const nes = start({ nextTile }), m = nes.cpu.mem;
        nes.buttonDown(1, B.BUTTON_RIGHT);
        for(let i = 0; i < 28; i++) nes.frame();
        nes.buttonUp(1, B.BUTTON_RIGHT); nes.frame(); nes.frame();
        nes.buttonDown(1, B.BUTTON_B); nes.frame(); nes.buttonUp(1, B.BUTTON_B);
        assert.equal(m[0x55], 0x81);
        for(let i = 0; i < 30; i++) nes.frame();
        assert.equal(m[0xC2], 130);
        nes.buttonDown(1, B.BUTTON_RIGHT);
        for(let i = 0; i < 8; i++) nes.frame();
        nes.buttonUp(1, B.BUTTON_RIGHT); nes.frame(); nes.frame();
        let alignments = 0;
        const emulate = nes.cpu.emulate.bind(nes.cpu);
        nes.cpu.emulate = () => {
            if(nes.cpu.REG_PC + 1 === 0x98FF) alignments++;
            return emulate();
        };
        nes.buttonDown(1, B.BUTTON_B); nes.frame(); nes.buttonUp(1, B.BUTTON_B);
        nes.frame(); nes.frame();
        assert.equal(m[0x55], nextTile ? 2 : 0, 'normal action replaces the exception marker');
        assert.equal(alignments, nextTile ? 2 : 0, 'solid hit retains both immediate and next-tick alignment');
        assert.equal(m[0x7B4] & 15, 0, 'next tile is empty after the follow-up');
        assert.equal(m[0x30], 12);
        assert.equal(nes.cpu.REG_SP, 0x1FF);
    }
});
