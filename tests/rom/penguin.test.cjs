const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const jsnes = require('../../js/lib/jsnes.min.js');
const {Project, Penguin, SpritePatterns, LevelCodec, EditorToolbar, ResourceManager} =
    require('../helpers/source.cjs').load('Project Penguin SpritePatterns LevelCodec EditorToolbar ResourceManager',
        {document: {addEventListener() {}, getElementById() {return {};}}});
const original = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;
const realTest = (name, body) => test(name, {skip: !original}, body);

function stage({scene = 0, wide = false, camera = false, facing = 0, wall = false, ledge = false} = {}) {
    const p = new Project(); p.loadROM(original); p.gameConfig.disableTimer = true; p.gameConfig.cameraFollow = camera;
    const map = Array.from({length: 14}, () => Array(wide ? 32 : 16).fill(0));
    map[12].fill(5); map[1][2] = 15;
    if (wall) for (const row of [10, 11]) {map[row][3] = 5; map[row][12] = 5;}
    if (ledge) {map[12].fill(0);map[12].fill(5, 4, 12);}
    const data = LevelCodec.fromLevelEditorToROMData({background: scene | (wide ? 16 : 0),
        map, player: {x: 6, y: 11}, door: {x: 14, y: 10}, enemies: [{enemyId: 15 | facing, x: 8, y: 11}]}, wide);
    p.levels[0].data = data.mapData; p.levels[0].monsterData = data.monsterData; p.levelCount = 1;
    return p.getROMData();
}
function start(options) {
    const n = new jsnes.NES({onFrame() {}, emulateSound: false});
    n.loadROM(Buffer.from(stage(options)).toString('binary'));
    for (let i = 0; i < 160; i++) n.frame();
    n.buttonDown(1, jsnes.Controller.BUTTON_START); n.frame(); n.buttonUp(1, jsnes.Controller.BUTTON_START);
    for (let i = 0; i < 700; i++) {
        n.frame(); const m = n.cpu.mem;
        if (m[0x30] === 12 && m[0x56] === 3 && !(m[0x2A] & 128)) return n;
    }
    assert.fail('gameplay not reached');
}
const slot = m => m.slice(0x4FE, 0x506).indexOf(15);
const pos = (m, s) => m[0x516 + s] + 256 * m[0x50E + s];

realTest('native foot tiles form standing and alternate steps, with a fixed left-facing head and player palette', async () => {
    const frames = SpritePatterns.getPenguinFrames(original);
    const tile = (frame, columnTile) => Buffer.from(frames.slice(frame * 64 + columnTile * 16, frame * 64 + columnTile * 16 + 16));
    const native = index => original.subarray(0xA010 + index * 16, 0xA020 + index * 16);
    const flip = bytes => Buffer.from([...bytes].map(byte => parseInt(byte.toString(2).padStart(8, '0').split('').reverse().join(''), 2)));
    for (let frame = 0; frame < 3; frame++) {
        assert.deepEqual(tile(frame, 0), flip(native(0xAE)), 'native right-facing head is mirrored left');
        assert.deepEqual(tile(frame, 2), flip(native(0xAC)), 'upper body stays fixed across all poses');
    }
    assert.deepEqual(tile(0, 1), native(0xAD));
    assert.deepEqual(tile(0, 3), flip(native(0xAD)), 'standing uses the same foot on both sides');
    assert.deepEqual(tile(1, 1), flip(native(0xAF)));
    assert.deepEqual(tile(1, 3), flip(native(0xAD)));
    assert.deepEqual(tile(2, 1), native(0xAD));
    assert.deepEqual(tile(2, 3), native(0xAF));
    assert.notDeepEqual(frames.slice(64, 128), frames.slice(128));
    const resources = new ResourceManager();
    resources.palettes = Array.from({length: 12}, () => Array.from({length:32}, (_, i) => i));
    resources.createImage = async (pixels, width, height) => ({pixels, width, height});
    await resources.loadBgResources(original);
    assert.equal(resources.getResource(0, 'enemy_15').width, 16);
    assert.equal(resources.getResource(0, 'enemy_15').height, 16);
    const colors = new Set(resources.getResource(0, 'enemy_15').pixels.flat().map(pixel => pixel.color));
    assert.deepEqual([...colors].sort((a,b) => a-b), [16, 17, 18, 19], 'preview uses player palette');
    for (const scene of [0, 4, 5, 6, 9, 10, 11]) {
        const n = start({scene});
        assert.ok(slot(n.cpu.mem) >= 0);
        assert.deepEqual(Uint8Array.from(n.ppu.vramMem.slice(0xB20, 0xBE0)), frames);
        n.frame(); n.frame();
        const attrs = [];
        for (let o = 0; o < 256; o += 4) if (n.ppu.spriteMem[o + 1] >= 0xB2 && n.ppu.spriteMem[o + 1] < 0xBE)
            attrs.push(n.ppu.spriteMem[o + 2] & 3);
        assert.ok(attrs.length >= 2, 'penguin is visible in native OAM');
        assert.ok(attrs.every(attr => attr === 0), 'both columns use the player palette');
    }
});

realTest('walking advances 48 pixels, resting is motionless, and the cycle repeats in both directions and camera modes', () => {
    for (const wide of [false, true]) for (const camera of [false, true]) for (const facing of [0, 64]) {
        const n = start({wide, camera, facing}), m = n.cpu.mem, s = slot(m);
        assert.ok(s >= 0);
        const sign = m[0x556 + s] === 4 ? 1 : -1, width = wide ? 512 : 256;
        const seen = new Set(); let moved = 0, rested = 0, cycles = 0;
        for (let i = 0; i < 400; i++) {
            const before = pos(m, s), clock = m[0x566 + s]; n.frame();
            const delta = ((pos(m, s) - before) * sign + width) % width;
            assert.ok(delta === 0 || delta === 1);
            const phase = m[0x566 + s];
            if (phase >= 96) {assert.equal(delta, 0);assert.ok([0, Penguin.META].includes(m[0x415 + s]));rested++;}
            else {
                moved += delta;
                if (m[0x415 + s]) {
                    seen.add(m[0x415 + s]);
                    assert.equal(m[0x415 + s], Penguin.META + 1 + ((phase >> 3) & 1), 'alternate the two foot arrangements');
                }
            }
            assert.equal(m[0x46F + s] & 0x43, sign === 1 ? 0x40 : 0, 'left-facing artwork flips only when moving right, using palette zero');
            if (phase === 96 && clock === 95) {if (cycles) assert.equal(moved, 48);moved = 0;cycles++;}
            assert.equal(m[0x433 + s], 184);
            assert.equal(m[0x4FE + s], 15);
        }
        assert.ok(rested >= 128); assert.ok(cycles >= 2);
        assert.deepEqual([...seen].sort(), [0x4E, 0x4F]);
        assert.equal(m[0xC0], 1, 'walking past the player is harmless');
    }
});

realTest('walls and ledges turn the penguin around without penetrating or walking into empty air', () => {
    for (const options of [{wall: true}, {ledge: true}]) {
        const n = start(options), m = n.cpu.mem, s = slot(m), directions = new Set();
        for (let i = 0; i < 1000; i++) {
            n.frame(); directions.add(m[0x556 + s]);
            assert.ok(pos(m, s) >= 64 && pos(m, s) <= 184, `x=${pos(m,s)}`);
            assert.equal(m[0x433 + s], 184);
        }
        assert.equal(directions.size, 2);
    }
});

realTest('pause freezes pose, position and clock, then resumes the same walk', () => {
    const n = start(), m = n.cpu.mem, s = slot(m);
    for (let i = 0; i < 90; i++) n.frame();
    n.buttonDown(1, jsnes.Controller.BUTTON_START);n.frame();n.buttonUp(1, jsnes.Controller.BUTTON_START);
    const snapshot = () => [pos(m,s),m[0x433+s],m[0x566+s],m[0x415+s]];
    const paused = snapshot(); for (let i = 0; i < 40; i++) n.frame();assert.deepEqual(snapshot(), paused);
    n.buttonDown(1, jsnes.Controller.BUTTON_START);n.frame();n.buttonUp(1, jsnes.Controller.BUTTON_START);
    for (let i = 0; i < 90; i++) n.frame();assert.notDeepEqual(snapshot(), paused);
});

realTest('one switch removes the toolbar entry, ROM worker and previously placed type-15 objects', () => {
    try {
        Penguin.ENABLED = false;
        const editor = {enemyBtns: [], createButton: (type, container, name, id) => id};
        EditorToolbar.createEnemyButtons(editor);assert.equal(editor.enemyBtns.length, 14);
        const rom = stage();assert.ok(rom.slice(0x18610, 0x18810).every(v => v === 0));
        const n = start();assert.equal(slot(n.cpu.mem), -1);
    } finally {Penguin.ENABLED = true;}
});

