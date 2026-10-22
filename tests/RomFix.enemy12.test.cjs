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

function stage(scene, wide = false, camera = false, facing = 0, ledgeWallRow = null) {
    const editor = new RomEditor(); editor.loadROM(original);
    editor.gameConfig.cameraFollow = camera;
    editor.gameConfig.disableTimer = true;
    const width = wide ? 32 : 16;
    const map = Array.from({ length: 14 }, () => Array(width).fill(0));
    map[12].fill(5); map[1][2] = 15;
    if (ledgeWallRow !== null) {
        // At Y=112 the bird's center is in empty row 7, but its upper
        // half still overlaps these row 6 platform edges.
        map[ledgeWallRow].fill(5, 0, 5); map[ledgeWallRow].fill(5, 12, 16);
    } else {
        for (let y = 3; y <= 9; y++) { map[y][4] = 5; map[y][12] = 5; }
    }
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

realTest('half-tile bird/fish height still collides with the upper platform edges in either direction', () => {
    for (const scene of [0, 4]) for (const wide of [false, true]) for (const facing of [0, 0x40]) {
        const data = stage(scene, wide, true, facing, 6);
        assert.deepEqual(data.slice(0x1340, 0x142A), Uint8Array.from(original.slice(0x1340, 0x142A)),
            'the shared native collision probe and its coordinate tables remain unchanged');
        const nes = start(data), m = nes.cpu.mem;
        const slot = m.slice(0x4FE, 0x506).indexOf(12);
        const context = `scene=${scene}, wide=${wide}, facing=${facing}`;
        assert.ok(slot >= 0, context);
        // Hold the half-tile checkpoint in place while native map probing,
        // horizontal movement, reversal and rendering continue each frame.
        m[0x433 + slot] = m[0x546 + slot] = 112;
        m[0x56E + slot] = m[0x57E + slot] = m[0x53E + slot] = 0;
        m[0x516 + slot] = 128; m[0x50E + slot] = m[0x51E + slot] = 0;
        m[0x556 + slot] = facing ? 3 : 4;
        let left = 0, right = 0;
        for (let i = 0; i < 500; i++) {
            const before = m[0x516 + slot] + m[0x50E + slot] * 256;
            nes.frame();
            const after = m[0x516 + slot] + m[0x50E + slot] * 256;
            if (after < before) left++; if (after > before) right++;
            assert.ok(after >= 80 && after < 192, `${context}: upper edge penetration at X=${after}`);
            assert.equal(m[0x433 + slot], 112, context);
            assert.equal(m[0x4FE + slot], 12, context);
        }
        assert.ok(left > 30 && right > 30, `${context}: traverses and reverses both ways`);
    }
});

realTest('bird/fish private wall probes cover partial rows without blocking adjacent aligned rows', () => {
    const { walls } = Romfix.addBirdFishPlatform(new Uint8Array(0x20010));
    for (const row of [5, 6, 7]) {
        const nes = start(stage(0, false, false, 0, row)), c = nes.cpu, m = c.mem;
        for (const x of [85, 186]) for (let y = 104; y <= 120; y++) {
            m[0x00] = x; m[0x01] = 0; m[0x02] = y;
            c.REG_X = 6; c.REG_SP = 0x1FF; c.REG_PC = 0x5FFF; c.irqRequested = false;
            // Invoke the installed helper against the real native tile map.
            m[0x6000] = 0x20; m[0x6001] = walls & 255; m[0x6002] = walls >> 8;
            let returned = false;
            for (let i = 0; i < 1000; i++) {
                c.emulate();
                if (c.REG_PC === 0x6002) { returned = true; break; }
            }
            assert.ok(returned, 'private wall probe returns');
            assert.equal(c.REG_SP, 0x1FF, 'private wall probe balances the native stack');
            assert.equal(c.REG_X, 6, 'private wall probe preserves the caller enemy slot');
            const expected = y === 104 ? row === 6 : y === 120 ? row === 7 : row === 6 || row === 7;
            const context = `solid row=${row}, X=${x}, Y=${y}`;
            assert.equal(Boolean(m[x === 85 ? 0xAD : 0xAE]), expected, context);
            assert.equal(m[x === 85 ? 0xAE : 0xAD], 0, `${context}: opposite side stays clear`);
        }
    }
});

realTest('native bird/fish riding recovers once, pauses, and commits a tile on a real second jump', () => {
    for (const scene of [0, 4]) for (const wide of [false, true]) {
        const nes = start(stage(scene, wide, true)), m = nes.cpu.mem;
        const slot = m.slice(0x4FE, 0x506).indexOf(12);
        const height = m[0x433 + slot];
        const signedY = () => (m[0x7D] >= 128 ? m[0x7D] - 256 : m[0x7D]) * 256 + m[0x41E];
        const step = count => { for (let i = 0; i < count; i++) nes.frame(); };
        const descend = () => {
            // A checkpoint just above the moving surface; the native player
            // integrator, platform collision and remaining frames run normally.
            m[0xC1] = m[0x50E + slot]; m[0xC2] = m[0x516 + slot];
            m[0x41E] = m[0x433 + slot] - 18; m[0x7D] = 0;
            m[0xC0] = 2; m[0x52] = 16; m[0xC7] = 1; m[0xC8] = 0;
            for (let i = 0; i < 10 && !m[0x53E + slot]; i++) nes.frame();
            assert.equal(m[0x53E + slot], 1, `scene=${scene}, wide=${wide}: descending landing`);
        };
        descend(); step(12);
        assert.equal(m[0x433 + slot], height + 8);
        assert.equal(signedY(), height - 8);
        assert.equal(m[0xC0], 1);
        // A standing rider does not repeatedly count as a new landing.
        const timer = m[0x57E + slot];
        nes.buttonDown(1, jsnes.Controller.BUTTON_START); step(2);
        nes.buttonUp(1, jsnes.Controller.BUTTON_START); step(5);
        const paused = [m[0x433 + slot], m[0x57E + slot], signedY()];
        step(30);
        assert.deepEqual([m[0x433 + slot], m[0x57E + slot], signedY()], paused);
        assert.ok(paused[1] <= timer && paused[1] > 0);
        nes.buttonDown(1, jsnes.Controller.BUTTON_START); step(2);
        nes.buttonUp(1, jsnes.Controller.BUTTON_START); step(110);
        assert.equal(m[0x433 + slot], height, 'one landing recovers to committed height');
        assert.equal(signedY(), height - 16, 'recovery carries the rider');
        assert.equal(m[0x56], 3);
        assert.equal(m[0x53E + slot], 1);

        // Begin another first landing, then use actual A input to detach and
        // descend again before recovery. No mid-jump RAM edits are involved.
        m[0x53E + slot] = 0;
        descend(); step(10);
        nes.buttonDown(1, jsnes.Controller.BUTTON_A); step(1);
        assert.equal(m[0xC0], 2);
        assert.equal(m[0x53E + slot], 0);
        assert.ok(m[0xC7] & 128, 'native upward jump stays airborne');
        step(7); nes.buttonUp(1, jsnes.Controller.BUTTON_A);
        for (let i = 0; i < 50 && m[0x546 + slot] !== height + 16; i++) nes.frame();
        assert.equal(m[0x546 + slot], height + 16, 'second landing commits exactly one tile');
        step(120);
        assert.equal(m[0x433 + slot], height + 16, 'committed height does not recover');
        assert.equal(m[0x57E + slot], 0);
        assert.equal(m[0x56], 3);

        const attributes = [];
        for (let offset = 0; offset < 256; offset += 4) {
            if ([0xAA, 0xAC, 0xAE, 0xB0].includes(m[0x201 + offset]))
                attributes.push(m[0x202 + offset] & 3);
        }
        assert.ok(attributes.length > 0, 'bird/fish hardware sprites are drawn');
        assert.ok(attributes.every(value => value === 0), 'runtime uses protagonist palette 0');
    }
});
