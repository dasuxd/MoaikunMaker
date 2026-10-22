const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const jsnes = require('../js/lib/jsnes.min.js');

const source = ['Config', 'RomFix']
    .map(name => fs.readFileSync(path.join(__dirname, '..', 'js', `${name}.js`), 'utf8')).join('\n');
const { Romfix } = new Function(`${source}\nreturn {Romfix};`)();
const RAM = {
    y: 0x433, type: 0x4FE, state: 0x506, page: 0x50E, x: 0x516,
    previousX: 0x526, rider: 0x53E, committedY: 0x546,
    halfStep: 0x56E, spawn: 0x576, timer: 0x57E
};

function machine() {
    const data = new Uint8Array(0x20010);
    data.set([0x4E, 0x45, 0x53, 0x1A, 8, 0, 0x21]);
    data.set([0, 0x80, 0, 0x80, 0, 0x80], 0x2000A);
    const entries = Romfix.addBirdFishPlatform(data);
    const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, emulateSound: false });
    nes.loadROM(Buffer.from(data).toString('binary'));
    nes.cpu.mem.fill(0, 0, 0x800);
    nes.cpu.mem[0x56] = 3; // Native active-player phase.
    // Native body, ceiling and floor probes are unobstructed by default.
    for(const entry of [0x9BB9, 0x9BBD, 0x9BD5, 0x9BE3]) nes.cpu.mem.splice(entry, 2, 0x18, 0x60);
    return { nes, c: nes.cpu, m: nes.cpu.mem, ...entries };
}

function call(game, entry, slot = 0) {
    const { c, m } = game;
    c.REG_X = slot; c.REG_Y = 17;
    c.REG_SP = 0x1FF; c.REG_PC = 0x7FFF; c.irqRequested = false;
    m[0x8000] = 0x20; m[0x8001] = entry & 255; m[0x8002] = entry >> 8;
    for(let i = 0; i < 10000; i++) {
        c.emulate();
        if(c.REG_PC === 0x8002) {
            assert.equal(c.REG_SP, 0x1FF, 'balanced native stack');
            assert.equal(c.REG_X, slot, 'caller enemy index is preserved');
            assert.equal(c.REG_Y, 17, 'caller Y is preserved');
            return;
        }
    }
    assert.fail(`routine $${entry.toString(16)} did not return`);
}

function platform(game, slot = 0, { x = 80, packed = 0x56 } = {}) {
    const { m } = game;
    m[RAM.type + slot] = 12;
    m[RAM.spawn + slot] = packed;
    m[RAM.x + slot] = m[RAM.previousX + slot] = x & 255;
    m[RAM.page + slot] = x >> 8;
    call(game, game.init, slot);
    return m[RAM.y + slot];
}

function descend(game, slot = 0, { offset = 0, speed = 1 } = {}) {
    const { m } = game;
    m[0xC0] = 2; m[0xC7] = speed; m[0xC8] = 0x80;
    m[0xC4] = 0x80;
    m[0xC1] = m[RAM.page + slot]; m[0xC2] = m[RAM.x + slot];
    const playerY = m[RAM.y + slot] - 16 + offset;
    m[0x41E] = playerY & 255; m[0x7D] = (playerY >> 8) & 255;
    m[0xDA] = m[0x5B] = 1;
    call(game, game.update, slot);
}

function advance(game, frames, slot = 0) {
    for(let i = 0; i < frames; i++) call(game, game.update, slot);
}

test('bird/fish platform initializes from its spawn and preserves live height on later frames', () => {
    const game = machine(), { m } = game, slot = 6;
    m[RAM.rider + slot] = m[RAM.halfStep + slot] = m[RAM.timer + slot] = 99;
    const top = platform(game, slot);
    assert.equal(top, 104);
    assert.equal(m[RAM.committedY + slot], top);
    for(const address of [RAM.rider, RAM.halfStep, RAM.timer]) assert.equal(m[address + slot], 0);
    m[RAM.y + slot] += 5;
    m[RAM.rider + slot] = 1; m[RAM.halfStep + slot] = 8; m[RAM.timer + slot] = 43;
    call(game, game.init, slot);
    assert.equal(m[RAM.y + slot], top + 5);
    assert.equal(m[RAM.committedY + slot], top);
    assert.equal(m[RAM.rider + slot], 1);
    assert.equal(m[RAM.halfStep + slot], 8);
    assert.equal(m[RAM.timer + slot], 43);
});

test('first landing sinks eight pixels smoothly, stays latched, then recovers with its rider', () => {
    const game = machine(), { m } = game, top = platform(game);
    descend(game);
    assert.equal(m[RAM.rider], 1);
    assert.equal(m[0xC0], 1);
    assert.equal(m[RAM.halfStep], 8);
    assert.equal(m[RAM.committedY], top);
    assert.equal(m[RAM.timer], 90);
    assert.equal(m[RAM.y], top + 1);
    for(const address of [0xC4, 0xC7, 0xC8, 0xDA, 0x5B]) assert.equal(m[address], 0);
    for(let step = 2; step <= 8; step++) {
        advance(game, 1);
        assert.equal(m[RAM.y], top + step);
        assert.equal(m[0x41E], top + step - 16);
        assert.equal(m[RAM.timer], 90, 'recovery starts once the half-step is reached');
    }
    advance(game, 89);
    assert.equal(m[RAM.y], top + 8);
    assert.equal(m[RAM.timer], 1);
    assert.equal(m[RAM.committedY], top, 'standing still cannot commit the next half-step');
    advance(game, 1);
    assert.equal(m[RAM.timer], 0);
    assert.equal(m[RAM.halfStep], 0);
    for(let step = 7; step >= 0; step--) {
        advance(game, 1);
        assert.equal(m[RAM.y], top + step);
        assert.equal(m[0x41E], top + step - 16, 'recovery carries the player upward');
        assert.equal(m[RAM.rider], 1);
    }
    advance(game, 120);
    assert.equal(m[RAM.y], top);
    assert.equal(m[RAM.halfStep], 0, 'idle support never counts as another landing');
});

test('a second distinct landing commits one tile permanently and two more landings repeat it', () => {
    const game = machine(), { m } = game, top = platform(game);
    for(let cycle = 0; cycle < 2; cycle++) {
        const base = top + cycle * 16;
        descend(game);
        advance(game, 7);
        assert.equal(m[RAM.y], base + 8);
        // The native jump path puts the player in rising state and releases the latch.
        m[0xC0] = 2; m[0xC7] = 0xFC;
        advance(game, 1);
        assert.equal(m[RAM.rider], 0);
        descend(game);
        assert.equal(m[RAM.committedY], base + 16);
        assert.equal(m[RAM.halfStep], 0);
        assert.equal(m[RAM.timer], 0);
        assert.equal(m[RAM.y], base + 9);
        advance(game, 7);
        assert.equal(m[RAM.y], base + 16);
        advance(game, 180);
        assert.equal(m[RAM.y], base + 16, 'the completed tile does not recover');
        assert.equal(m[0x41E], base);
        m[0xC0] = 2; m[0xC7] = 0xFC;
        advance(game, 1);
    }
});

test('one-way top support rejects rising, side, below and offscreen player contacts', () => {
    const cases = [
        ['rising through top', m => { m[0xC7] = 0xFC; }],
        ['outside horizontal span', m => { m[0xC2] += 32; }],
        ['below top', m => { m[0x41E] += 10; }],
        ['feet above top', m => { m[0x41E] -= 1; }],
        ['extended Y page', m => { m[0x7D] = 255; }],
        ['inactive player', m => { m[0x56] = 2; }],
        ['incompatible action', m => { m[0xC0] = 3; }]
    ];
    for(const [name, prepare] of cases) {
        const game = machine(), { m } = game, top = platform(game);
        m[0xC0] = 2; m[0xC7] = 1; m[0xC2] = m[RAM.x];
        m[0x41E] = top - 16;
        prepare(m);
        call(game, game.update);
        assert.equal(m[RAM.rider], 0, name);
        assert.equal(m[RAM.y], top, name);
        assert.equal(m[RAM.halfStep], 0, name);
    }
});

test('a landing can cross the platform top by the current downward velocity', () => {
    for(const [offset, speed, catches] of [[0, 0, true], [2, 1, true], [5, 4, true], [6, 4, false]]) {
        const game = machine(), { m } = game;
        platform(game); descend(game, 0, { offset, speed });
        assert.equal(m[RAM.rider], Number(catches), `offset=${offset} speed=${speed}`);
    }
});

test('different bird/fish slots retain independent half-steps and recovery timers', () => {
    const game = machine(), { m } = game;
    const first = platform(game, 0), second = platform(game, 7, { x: 160, packed: 0x78 });
    descend(game, 0); advance(game, 7, 0);
    m[0xC0] = 2; m[0xC7] = 0xFC; advance(game, 1, 0);
    descend(game, 7); advance(game, 7, 7);
    assert.equal(m[RAM.y], first + 8);
    assert.equal(m[RAM.y + 7], second + 8);
    assert.equal(m[RAM.timer], 89);
    assert.equal(m[RAM.timer + 7], 90);
    advance(game, 20, 7);
    assert.equal(m[RAM.timer], 89, 'updating another slot cannot consume this timer');
    assert.equal(m[RAM.timer + 7], 70);
    assert.equal(m[RAM.committedY], first);
    assert.equal(m[RAM.committedY + 7], second);
});

test('horizontal carrying preserves world position through both map seams and directions', () => {
    for(const wide of [false, true]) {
        const width = wide ? 512 : 256;
        const seams = wide ? [[255, 256], [256, 255], [511, 0], [0, 511]] : [[255, 0], [0, 255]];
        for(const [before, after] of seams) {
            const game = machine(), { m } = game;
            m[0x3D] = Number(wide);
            const top = platform(game, 0, { x: before });
            m[RAM.rider] = 1;
            m[0xC0] = 1; m[0x41E] = top - 16;
            m[0xC1] = before >> 8; m[0xC2] = before & 255;
            m[RAM.x] = after & 255; m[RAM.page] = after >> 8;
            call(game, game.update);
            assert.equal(m[RAM.rider], 1, `width=${width}: ${before}->${after}`);
            assert.equal(m[0xC1] * 256 + m[0xC2], after, `width=${width}: ${before}->${after}`);
            assert.equal(m[0x41E], top - 16);
        }
    }
});

test('horizontal wall probes roll back only carried movement in both directions and at seams', () => {
    for(const wide of [false, true]) {
        const motions = wide ? [[80, 81], [80, 79], [255, 256], [256, 255], [511, 0], [0, 511]] :
            [[80, 81], [80, 79], [255, 0], [0, 255]];
        for(const [before, after] of motions) {
            const game = machine(), { m } = game;
            m[0x3D] = Number(wide);
            const top = platform(game, 0, { x: before });
            m[RAM.rider] = 1; m[0xC0] = 1; m[0x41E] = top - 16;
            m[0xC1] = before >> 8; m[0xC2] = before & 255;
            m[RAM.x] = after & 255; m[RAM.page] = after >> 8;
            // Each direction leaves an independent trace, reports an obstacle,
            // and preserves the enemy index just as the native probes do.
            m.splice(0x9BB9, 4, 0xE6, 0x03, 0x38, 0x60);
            m.splice(0x9BBD, 4, 0xE6, 0x04, 0x38, 0x60);
            call(game, game.update);
            const left = ((after - before) & 255) >= 128;
            assert.equal(m[0x03], Number(left));
            assert.equal(m[0x04], Number(!left));
            assert.equal(m[0xC1] * 256 + m[0xC2], before, `${before}->${after}`);
            assert.equal(m[RAM.page] * 256 + m[RAM.x], after, 'the platform keeps moving');
            assert.equal(m[0x41E], top - 16);
        }
    }
});

test('a recovering platform waits beneath a ceiling while carrying a rider', () => {
    const game = machine(), { m } = game, top = platform(game);
    m[RAM.y] = top + 8; m[RAM.rider] = 1;
    m[0xC0] = 1; m[0xC2] = m[RAM.x]; m[0x41E] = top - 8;
    m.splice(0x9BD5, 2, 0x38, 0x60); // Ceiling blocked.
    advance(game, 20);
    assert.equal(m[RAM.y], top + 8);
    assert.equal(m[0x41E], top - 8, 'the rider is not pushed into solid tiles');
    assert.equal(m[RAM.rider], 1);
    m.splice(0x9BD5, 2, 0x18, 0x60);
    advance(game, 8);
    assert.equal(m[RAM.y], top);
    assert.equal(m[0x41E], top - 16);
    // Without a rider there is no player ceiling constraint.
    m[RAM.y] = top + 8; m[0xC0] = 2; m[0xC7] = 0xFC;
    m.splice(0x9BD5, 2, 0x38, 0x60);
    advance(game, 8);
    assert.equal(m[RAM.y], top);
    assert.equal(m[RAM.rider], 0);
});

test('a native floor takes over support without a sinking platform pulling its rider through it', () => {
    const game = machine(), { c, m } = game, top = platform(game);
    descend(game); advance(game, 2);
    assert.equal(m[RAM.y], top + 3);
    assert.equal(m[0x41E], top - 13);
    const floorY = m[0x41E];
    // An actual tile now supports the rider. Record the floor probe and
    // return carry set, while leaving its native standing position intact.
    m.splice(0x9BE3, 4, 0xE6, 0x03, 0x38, 0x60);
    advance(game, 1);
    assert.equal(m[0x03], 1);
    assert.equal(m[RAM.y], top + 4, 'the platform can continue sinking');
    assert.equal(m[RAM.rider], 0, 'the floor releases the platform latch');
    assert.equal(m[0x41E], floorY, 'the player remains standing on the native floor');
    assert.equal(m[0xC0], 1);
    advance(game, 4);
    assert.equal(m[RAM.y], top + 8);
    assert.equal(m[0x41E], floorY);
    assert.equal(m[0x03], 1, 'a detached carrier does not repeat player floor probes');
    const support = m[0x9585] | (m[0x9586] << 8);
    call(game, support, 3);
    assert.equal(c.F_CARRY, 1, 'native support remains available after the handoff');
    assert.equal(m[0x03], 2);
});

test('top-row support sinks across signed Y zero and recovers to standing at minus eight', () => {
    const game = machine(), { m } = game, top = platform(game, 0, { packed: 0x00 });
    const playerY = () => (m[0x7D] >= 128 ? m[0x7D] - 256 : m[0x7D]) * 256 + m[0x41E];
    assert.equal(top, 8);
    descend(game);
    assert.equal(m[RAM.rider], 1, 'descending feet can reach row zero from negative Y');
    assert.equal(playerY(), -7);
    assert.equal(m[0x7D], 255);
    advance(game, 7);
    assert.equal(m[RAM.y], 16);
    assert.equal(playerY(), 0);
    assert.equal(m[0x7D], 0);
    advance(game, 90);
    for(let y = -1; y >= -8; y--) {
        advance(game, 1);
        assert.equal(playerY(), y);
        assert.equal(m[0x7D], 255);
        assert.equal(m[RAM.rider], 1);
    }
    assert.equal(m[RAM.y], 8);
    advance(game, 20);
    assert.equal(playerY(), -8);
    assert.equal(m[RAM.halfStep], 0);
});

test('native support hook preserves X and delegates to the original floor probe when unsupported', () => {
    const game = machine(), { c, m } = game;
    platform(game, 4);
    const support = m[0x9585] | (m[0x9586] << 8);
    // Observable stand-in for the native tile probe: INC $02; CLC; RTS.
    m.splice(0x9BE3, 4, 0xE6, 0x02, 0x18, 0x60);
    m[0xC1] = 0; m[0xC2] = 80; m[RAM.rider + 4] = 1;
    call(game, support, 3);
    assert.equal(c.F_CARRY, 1);
    assert.equal(m[0x02], 0);
    m[0xC2] = 112;
    call(game, support, 3);
    assert.equal(c.F_CARRY, 0);
    assert.equal(m[0x02], 1);
    m[0xC2] = 80; m[RAM.type + 4] = 1;
    call(game, support, 3);
    assert.equal(c.F_CARRY, 0);
    assert.equal(m[0x02], 2, 'ordinary enemies do not supply platform support');
});

test('bird-only wall checks catch either overlapping row without blocking aligned neighbors', () => {
    const probes = [0xAD, 0xAE, 0xAF, 0xB0, 0xB1, 0xB2];
    const cases = [
        ['half-tile upper left edge', 112, 0xAF, 1, 0],
        ['half-tile upper right edge', 112, 0xB0, 0, 1],
        ['sinking lower left edge', 105, 0xB1, 1, 0],
        ['sinking lower right edge', 105, 0xB2, 0, 1],
        ['aligned upper neighbor', 104, 0xAF, 0, 0],
        ['aligned lower neighbor', 104, 0xB2, 0, 0],
        ['aligned left wall', 104, 0xAD, 1, 0],
        ['aligned right wall', 104, 0xAE, 0, 1]
    ];
    for(const [name, y, blocked, left, right] of cases) {
        const game = machine(), { m } = game;
        m[0x02] = y;
        // Recorded-style native outputs isolate the extra bird check from
        // the shared map sampler, whose own bytes must remain untouched.
        const native = [0xE6, 0x03];
        probes.forEach(address => native.push(0xA9, Number(address === blocked), 0x85, address));
        native.push(0x60);
        m.splice(0x9330, native.length, ...native);
        call(game, game.walls, 5);
        assert.equal(m[0xAD], left, name);
        assert.equal(m[0xAE], right, name);
        assert.equal(m[0x03], 1, 'one original probe call per bird update');
        assert.deepEqual(m.slice(0x9330, 0x9330 + native.length), native,
            'the shared sampler is never overwritten');
    }
});
