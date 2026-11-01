const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const jsnes = require('../js/lib/jsnes.min.js');

const source = ['Config', 'RomFix']
    .map(name => fs.readFileSync(path.join(__dirname, '..', 'js', `${name}.js`), 'utf8')).join('\n');
const { Romfix } = new Function(`${source}\nreturn { Romfix };`)();
const RAM = {
    y: 0x433, type: 0x4FE, state: 0x506, page: 0x50E, x: 0x516,
    rider: 0x53E, committedY: 0x546, facing: 0x556, halfStep: 0x56E, timer: 0x57E,
    ...Romfix.BIRD_RAM
};
const file = address => address - 0x8000 + 16 + (address >= 0xC000 ? 6 * 0x4000 : 0);

function machine(auxiliary = false) {
    const data = new Uint8Array(0x20010);
    data.set([0x4E, 0x45, 0x53, 0x1A, 8, 0, 0x21]);
    data.set([0, 0x80, 0, 0x80, 0, 0x80], 0x2000A);
    let entry;
    if(auxiliary) {
        Romfix.addBirdFishAuxiliary(data, true);
        entry = data[file(0xB388) + 1] | (data[file(0xB388) + 2] << 8);
    } else entry = Romfix.addBirdFishLift(data);
    const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, emulateSound: false });
    nes.loadROM(Buffer.from(data).toString('binary'));
    const c = nes.cpu, m = c.mem;
    for(let address = 0; address < 0x800; address++) m[address] = (address * 37 + 91) & 255;
    m[0x3D] = m[0xC1] = 0; m[0xC2] = 24;
    return { data, entry, c, m };
}

// The hook jumps into this helper; stop before either native continuation.
// This also checks that no extra JSR return address remains on its stack.
function invoke(game, slot) {
    const { c, entry } = game;
    c.REG_X = slot; c.REG_Y = 0x29; c.REG_SP = 0x1D3;
    c.REG_PC = entry - 1; c.irqRequested = false;
    for(let step = 0; step < 200; step++) {
        c.emulate();
        const next = (c.REG_PC + 1) & 65535;
        if(next === 0xB38B || next === 0xB3B6) {
            assert.equal(c.REG_X, slot, 'native enemy index survives the helper');
            assert.equal(c.REG_Y, 0x29, 'native caller Y survives the helper');
            assert.equal(c.REG_SP, 0x1D3, 'scratch pushes leave a balanced stack');
            return next;
        }
    }
    assert.fail('Tile 13 helper did not reach its native continuation');
}

function bird(game, slot, { y = 104, half = 0, timer = 47, state = 1, facing = 3, x = 80 } = {}) {
    const { m } = game;
    m[RAM.type + slot] = 12; m[RAM.state + slot] = state;
    m[RAM.y + slot] = m[RAM.committedY + slot] = y;
    m[RAM.halfStep + slot] = half; m[RAM.timer + slot] = timer;
    m[RAM.facing + slot] = facing; m[RAM.rider + slot] = 1;
    m[RAM.x + slot] = x & 255; m[RAM.page + slot] = x >> 8;
    for(const address of [RAM.fright, RAM.speed, RAM.yHigh, RAM.targetHigh]) m[address + slot] = 0;
}

function assertUnchanged(m, before, permitted = []) {
    const allowed = new Set(permitted);
    for(let address = 0; address < 0x800; address++) {
        if(!allowed.has(address)) assert.equal(m[address], before[address], `RAM $${address.toString(16)} is preserved`);
    }
}

test('Tile 13 lift installs at the native global event and is included in auxiliary exports', () => {
    for(const auxiliary of [false, true]) {
        const game = machine(auxiliary);
        assert.deepEqual(Array.from(game.data.slice(file(0xB388), file(0xB388) + 3)),
            [0x4C, game.entry & 255, game.entry >> 8]);
        bird(game, 7);
        assert.equal(invoke(game, 7), 0xB3B6);
        assert.equal(game.m[RAM.committedY + 7], 88);
    }
});

test('each live bird slot moves its destination one tile up without changing its position or rider', () => {
    const game = machine(), { m } = game;
    for(let slot = 0; slot < 8; slot++) bird(game, slot, { y: 104 + slot * 16, half: 8, x: 48 + slot * 8 });
    for(let slot = 0; slot < 8; slot++) {
        const before = m.slice(0, 0x800), oldTarget = m[RAM.committedY + slot] + m[RAM.halfStep + slot];
        assert.equal(invoke(game, slot), 0xB3B6);
        assert.equal(m[RAM.committedY + slot], oldTarget - 16);
        assert.equal(m[RAM.halfStep + slot], 0);
        assert.equal(m[RAM.timer + slot], 0);
        assert.equal(m[RAM.fright + slot], 1, 'every bird activates fright for its ascent');
        assert.equal(m[RAM.facing + slot], 4, 'birds right of the player face away to the right');
        assertUnchanged(m, before, [RAM.committedY + slot, RAM.halfStep + slot, RAM.timer + slot,
            RAM.facing + slot, RAM.fright + slot, RAM.speed + slot, RAM.targetHigh + slot,
            0x1D3, 0x1D2, 0x1D1, 0x1D0]);
    }
});

test('upward targets pass row zero, include half-steps, and saturate at a fully offscreen height', () => {
    const game = machine(), { m } = game, slot = 5;
    for(const [y, half, expected] of [[8, 0, -8], [16, 0, 0], [24, 0, 8], [32, 0, 16],
        [8, 8, 0], [16, 8, 8], [24, 8, 16], [104, 8, 96], [216, 8, 208]]) {
        bird(game, slot, { y, half });
        invoke(game, slot);
        assert.equal(m[RAM.committedY + slot], expected & 255, `target ${y}+${half}`);
        assert.equal(m[RAM.targetHigh + slot], expected < 0 ? 255 : 0, 'signed target high byte');
        assert.equal(m[RAM.y + slot], y, 'the event changes a target without teleporting the platform');
        assert.equal(m[RAM.halfStep + slot], 0);
        assert.equal(m[RAM.timer + slot], 0);
    }
    bird(game, slot, { y: 104, half: 8 });
    for(const expected of [96, 80, 64, 48, 32, 16, 0, -8, -8]) {
        invoke(game, slot);
        assert.equal(m[RAM.committedY + slot], expected & 255);
        assert.equal(m[RAM.targetHigh + slot], expected < 0 ? 255 : 0);
        assert.equal(m[RAM.y + slot], 104, 'successive impacts do not wrap or teleport current Y');
    }
});

test('smoke, defeated and stunned birds retain every RAM byte during a global impact', () => {
    const game = machine(), { m } = game;
    for(let slot = 0; slot < 8; slot++) for(const state of [0, 2, 3, 10, 11, 12, 13, 255]) {
        bird(game, slot, { state, half: 8 });
        const before = m.slice(0, 0x800);
        assert.equal(invoke(game, slot), 0xB3B6);
        assertUnchanged(m, before);
    }
});

test('other enemy types replay the native state load and resume the native stun selection', () => {
    const game = machine(), { c, m } = game;
    for(let slot = 0; slot < 8; slot++) for(const type of [0, 1, 4, 5, 9, 11, 13]) for(const state of [0, 1, 12, 128, 255]) {
        bird(game, slot, { state }); m[RAM.type + slot] = type;
        const before = m.slice(0, 0x800);
        assert.equal(invoke(game, slot), 0xB38B);
        assert.equal(c.REG_ACC, state, 'the replaced LDA supplies the native state');
        assert.equal(c.F_ZERO, state, 'the replaced LDA supplies its native zero result');
        assert.equal(c.F_SIGN, state >> 7, 'the replaced LDA supplies its native negative flag');
        assertUnchanged(m, before);
    }
});

test('away direction uses the shortest wrapped world distance for every narrow and wide-map delta', () => {
    const game = machine(), { m } = game, slot = 3;
    for(const width of [256, 512]) {
        const mask = width - 1, half = width / 2;
        m[0x3D] = width === 512 ? 1 : 0;
        const players = width === 512 ? [0, 1, 127, 255, 256, 257, 383, 511] : [0, 1, 127, 128, 255];
        for(const player of players) for(const initial of [3, 4]) for(let delta = -half; delta < half; delta++) {
            const x = (player + delta + width) & mask;
            m[0xC1] = player >> 8; m[0xC2] = player & 255;
            m[0] = 0x76; m[1] = 0x24;
            bird(game, slot, { x, facing: initial });
            invoke(game, slot);
            const expected = delta === 0 || delta === -half ? initial : delta > 0 ? 4 : 3;
            assert.equal(m[RAM.facing + slot], expected, `width=${width}, player=${player}, bird=${x}, delta=${delta}`);
            assert.equal(m[RAM.fright + slot], 1, 'all distances activate fright for the upward motion');
            assert.equal(m[RAM.speed + slot], 3 - Math.min(3, Math.floor(Math.abs(delta) / 32)),
                `shortest wrapped distance controls speed: width=${width}, delta=${delta}`);
            assert.equal(m[0], 0x76); assert.equal(m[1], 0x24);
            assert.equal(m[0xC1] * 256 + m[0xC2], player, 'the event cannot move its direction reference');
        }
    }
});
