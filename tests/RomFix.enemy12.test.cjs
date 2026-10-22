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
const realTest = (name, body) => test(name, { skip: !original }, body);

test('bird/fish restore native artwork and share PPU slots without replacing the castle boss', () => {
    const data = new Uint8Array(0x20010);
    for (let i = 0; i < 0x3A0; i++) data[0xAA70 + i] = (i % 251) + 1;
    data.fill(0x63, 0xEA70, 0xEE10);
    const bird = data.slice(0xAB90, 0xAC10);
    const fish = data.slice(0xAB10, 0xAB90);
    const native = data.slice(0xAA70, 0xAE10);
    Romfix.backupUnusedImages(data, true);
    assert.deepEqual(data.slice(0x8C50, 0x8FF0), native);
    assert.deepEqual(data.slice(0xAAB0, 0xAB30), bird);
    assert.deepEqual(data.slice(0xCAB0, 0xCB30), bird);
    assert.ok(data.slice(0xEA70, 0xEE10).every(byte => byte === 0x63));
    const snapshot = data.slice();
    Romfix.backupUnusedImages(data, true);
    assert.deepEqual(data, snapshot, 'reapplying never reads already rearranged artwork');

    // The old editor copied the boss over both ordinary sprite pages.
    data.fill(0x63, 0xAA70, 0xAE10);
    data.fill(0x63, 0xCA70, 0xCE10);
    assert.deepEqual(Romfix.getFlightSpriteFrames(data), bird);
    assert.deepEqual(Romfix.getFlightSpriteFrames(data, true), fish);
    Romfix.backupUnusedImages(data, true);
    assert.deepEqual(data, snapshot);
});

function stage(scene, wide = false, camera = false, facing = 0) {
    const editor = new RomEditor(); editor.loadROM(original);
    editor.gameConfig.cameraFollow = camera;
    editor.gameConfig.disableTimer = true;
    const width = wide ? 32 : 16;
    const map = Array.from({ length: 14 }, () => Array(width).fill(0));
    map[12].fill(5); map[1][2] = 15;
    for (let y = 3; y <= 9; y++) { map[y][4] = 5; map[y][12] = 5; }
    const data = DataConverter.fromLevelEditorToROMData({
        background: scene | (wide ? 0x10 : 0),
        player: { x: 8, y: 11 }, door: { x: 14, y: 10 }, map,
        enemies: [{ enemyId: 12 | facing, x: 8, y: 6 }]
    }, wide);
    editor.levels[0].data = data.mapData;
    editor.levels[0].monsterData = data.monsterData;
    editor.levelCount = 1;
    return editor.getROMData();
}

function start(data) {
    const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, emulateSound: false });
    nes.loadROM(Buffer.from(data).toString('binary'));
    for (let i = 0; i < 160; i++) nes.frame();
    nes.buttonDown(1, jsnes.Controller.BUTTON_START); nes.frame();
    nes.buttonUp(1, jsnes.Controller.BUTTON_START);
    for (let i = 0; i < 600; i++) {
        nes.frame();
        if (nes.cpu.mem[0x30] === 12 && nes.cpu.mem[0x56] === 3 && !(nes.cpu.mem[0x2A] & 128)) return nes;
    }
    assert.fail('START did not reach gameplay');
}

realTest('native graphics selection loads bird or underwater fish into the same sprite slots', () => {
    for (const scene of [0, 4, 5]) {
        const nes = start(stage(scene));
        assert.equal(nes.cpu.mem[0x3E], scene);
        assert.equal(nes.cpu.mem[0x2F], 0x80 + scene);
        assert.deepEqual(Uint8Array.from(nes.ppu.vramMem.slice(0xAA0, 0xB20)),
            Uint8Array.from(Romfix.getFlightSpriteFrames(original, scene === 4)), `scene ${scene}`);
    }
});

realTest('Enemy 12 reverses at both walls, animates, and keeps its height in either map width', () => {
    for (const wide of [false, true]) for (const camera of [false, true]) {
        const nes = start(stage(0, wide, camera, wide ? 0x40 : 0));
        const m = nes.cpu.mem;
        const slot = m.slice(0x4FE, 0x506).indexOf(12);
        assert.ok(slot >= 0);
        const height = m[0x433 + slot];
        const directions = new Set(), frames = new Set();
        let left = 0, right = 0;
        for (let i = 0; i < 600; i++) {
            const x = m[0x516 + slot] + m[0x50E + slot] * 256;
            nes.frame();
            const next = m[0x516 + slot] + m[0x50E + slot] * 256;
            if (next < x) left++; if (next > x) right++;
            assert.ok(next >= 80 && next < 192, `wall penetration: ${next}`);
            assert.equal(m[0x433 + slot], height);
            assert.equal(m[0x4FE + slot], 12);
            directions.add(m[0x556 + slot]); frames.add(m[0x55E + slot]);
        }
        assert.ok(left > 30 && right > 30);
        assert.deepEqual([...directions].sort(), [3, 4]);
        assert.deepEqual([...frames].sort(), [0, 1]);

        // Contact with this scene helper must not enter the enemy damage path.
        m[0xC1] = m[0x50E + slot]; m[0xC2] = m[0x516 + slot];
        m[0x41E] = height; m[0xC7] = 0; m[0xC8] = 0;
        nes.frame();
        assert.equal(m[0x56], 3);
        assert.equal(m[0x4FE + slot], 12);

        m[0x516 + slot] = 0; m[0x50E + slot] = 0;
        m[0x51E + slot] = 0; m[0x556 + slot] = 3;
        nes.frame(); nes.frame();
        assert.equal(m[0x516 + slot] + m[0x50E + slot] * 256, wide ? 511 : 255);
        assert.equal(m[0x556 + slot], 3, 'empty map seams do not count as walls');
    }
});

realTest('bird/fish exports remain byte-stable after reloading and preserve native boss graphics', () => {
    const data = stage(4);
    const editor = new RomEditor(); editor.loadROM(data);
    editor.gameConfig.disableTimer = true;
    assert.deepEqual(editor.getROMData(), data);
    assert.deepEqual(data.slice(0xEA70, 0xEE10), Uint8Array.from(original.slice(0xEA70, 0xEE10)));
});
