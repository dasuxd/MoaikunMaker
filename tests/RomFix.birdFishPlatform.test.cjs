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

function machine({ auxiliary = false } = {}) {
    const data = new Uint8Array(0x20010);
    data.set([0x4E, 0x45, 0x53, 0x1A, 8, 0, 0x21]);
    data.set([0, 0x80, 0, 0x80, 0, 0x80], 0x2000A);
    const entries = auxiliary ? (Romfix.addBirdFishAuxiliary(data, true), {}) : Romfix.addBirdFishPlatform(data);
    const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, emulateSound: false });
    nes.loadROM(Buffer.from(data).toString('binary'));
    nes.cpu.mem.fill(0, 0, 0x800);
    nes.cpu.mem[0x56] = 3; // Native active-player phase.
    // Native body, ceiling and floor probes are unobstructed by default.
    for(const entry of [0x9BB9, 0x9BBD, 0x9BD5, 0x9BE3]) nes.cpu.mem.splice(entry, 2, 0x18, 0x60);
    nes.cpu.mem.splice(0x9330, 9, 0xA9, 0, 0x85, 0xAC, 0x85, 0xAD, 0x85, 0xAE, 0x60);
    // Native $AAF4 clears animation/action bytes and returns A=0.
    nes.cpu.mem.splice(0xAAF4, 18, 0xA9, 0,
        0x9D, 0x5E, 0x05, 0x9D, 0x66, 0x05, 0x9D, 0x6E, 0x05,
        0x9D, 0x7E, 0x05, 0x9D, 0x4E, 0x05, 0x60);
    // Native $AFEF negates the already prepared 8.8 horizontal velocity.
    nes.cpu.mem.splice(0xAFEF, 18, 0x38, 0xA9, 0, 0xFD, 0x36, 0x05, 0x9D, 0x36, 0x05,
        0xA9, 0, 0xFD, 0x2E, 0x05, 0x9D, 0x2E, 0x05, 0x60);
    return { nes, c: nes.cpu, m: nes.cpu.mem, ...entries };
}

function call(game, entry, slot = 0, preserveY = true) {
    const { c, m } = game;
    c.REG_X = slot; c.REG_Y = 17;
    c.REG_SP = 0x1FF; c.REG_PC = 0x7FFF; c.irqRequested = false;
    m[0x8000] = 0x20; m[0x8001] = entry & 255; m[0x8002] = entry >> 8;
    for(let i = 0; i < 10000; i++) {
        c.emulate();
        if(c.REG_PC === 0x8002) {
            assert.equal(c.REG_SP, 0x1FF, 'balanced native stack');
            assert.equal(c.REG_X, slot, 'caller enemy index is preserved');
            if(preserveY) assert.equal(c.REG_Y, 17, 'caller Y is preserved');
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

function press(game, direction, slot = 0) {
    game.m[0xF4] = direction;
    call(game, game.update, slot);
    game.m[0xF4] = 0;
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

test('a landing after recovery has started begins a new half-step instead of committing a tile', () => {
    const game = machine(), { m } = game, top = platform(game);
    descend(game); advance(game, 7 + 90 + 1);
    assert.equal(m[RAM.y], top + 7, 'recovery has started');
    assert.equal(m[RAM.halfStep], 0);
    m[0xC0] = 2; m[0xC7] = 0xFC;
    advance(game, 1);
    descend(game);
    assert.equal(m[RAM.committedY], top, 'an expired first landing cannot commit');
    assert.equal(m[RAM.halfStep], 8);
    assert.equal(m[RAM.timer], 90);
    advance(game, 90 + 16);
    assert.equal(m[RAM.y], top);
});

test('bottom-row landings never wrap the bird position or create an unreachable recovery target', () => {
    const game = machine(), { m } = game, top = platform(game, 0, { packed: 0x0E });
    assert.equal(top, 232);
    for(let landing = 0; landing < 3; landing++) {
        descend(game);
        assert.equal(m[RAM.y], top);
        assert.equal(m[RAM.committedY], top);
        assert.equal(m[RAM.halfStep], 0);
        assert.equal(m[RAM.timer], 0);
        m[0xC0] = 2; m[0xC7] = 0xFC;
        advance(game, 1);
    }
});

test('the last editable row allows a half-step but rejects an unsafe full step without postponing recovery', () => {
    const game = machine(), { m } = game, top = platform(game, 0, { packed: 0x0D });
    assert.equal(top, 216);
    descend(game); advance(game, 7);
    assert.equal(m[RAM.y], 224);
    assert.equal(m[0x41E], 208, 'the rider remains above native bottom death at Y=213');
    for(let landing = 0; landing < 6; landing++) {
        descend(game);
        assert.equal(m[RAM.y], 224);
        assert.equal(m[RAM.committedY], top, 'the next full-row destination is never committed');
        assert.equal(m[RAM.halfStep], 8);
        assert.equal(m[RAM.timer], 89 - landing, 'rejected landings do not postpone the original recovery');
    }
    advance(game, m[RAM.timer] + 8);
    assert.equal(m[RAM.y], top);
    assert.equal(m[RAM.halfStep], 0);
    assert.equal(m[RAM.timer], 0);
    descend(game); advance(game, 7);
    assert.equal(m[RAM.y], 224, 'a later landing can use the safe half-step again');
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

test('Up/Down cannot steer a standing bird or create additional landings', () => {
    const game = machine(), { m } = game, top = platform(game);
    descend(game); advance(game, 7);
    for(const direction of [4, 8, 12]) {
        press(game, direction);
        assert.equal(m[RAM.y], top + 8);
        assert.equal(m[RAM.committedY], top);
        assert.equal(m[RAM.halfStep], 8);
    }
    advance(game, 95);
    assert.equal(m[RAM.y], top);
    assert.equal(m[RAM.halfStep], 0);
    for(const direction of [4, 8, 12]) {
        press(game, direction);
        assert.equal(m[RAM.y], top);
        assert.equal(m[RAM.committedY], top);
        assert.equal(m[RAM.timer], 0);
    }
});

test('a landing that turns a frightened ascent into a drop immediately restores ordinary speed', () => {
    const game = machine(), { m } = game, top = platform(game);
    // A new landing completes a half-step while the carrier is still rising.
    // Its new goal is below the current height, so acceleration must stop now.
    m[RAM.y] = top - 2; m[RAM.committedY] = top - 16; m[RAM.halfStep] = 8;
    m[Romfix.BIRD_RAM.fright] = 1; m[Romfix.BIRD_RAM.speed] = 3;
    m[0x556] = 4; m[0x52E] = 2; m[0x536] = 0;
    descend(game);
    assert.equal(m[RAM.committedY], top, 'the landing replaces the upward goal with a lower checkpoint');
    assert.equal(m[RAM.y], top - 1, 'normal downward easing still runs');
    assert.equal(m[Romfix.BIRD_RAM.fright], 0, 'the interrupted ascent cannot retain fright');
    assert.equal(m[Romfix.BIRD_RAM.speed], 0);
    assert.equal(m[0x52E], 0);
    assert.equal(m[0x536], 0x80, 'the new velocity is the ordinary half-pixel patrol');
});

test('rider controls retain the native player entry and every controller button', () => {
    const game = machine(), { m } = game;
    platform(game); descend(game);
    assert.equal(game.playerControl, 0x941A);
    assert.deepEqual(m.slice(0x8B57, 0x8B5A), [0x20, 0x1A, 0x94]);
    // Observe the buttons delivered to native player AI; it may use X itself.
    m.splice(0x941A, 11, 0xA5, 0xF6, 0x85, 0x03, 0xA5, 0xF4, 0x85, 0x04, 0xA2, 0x00, 0x60);
    m[0xCB] = 3; m[0x556] = 4;
    for(const held of [1, 2, 0x0E, 3, 0]) {
        m[0xF6] = held; m[0xF4] = 0x80;
        call(game, game.playerControl);
        assert.equal(m[0x03], held, 'Up/Down retain their normal player meaning aboard');
        assert.equal(m[0x04], 0x80, 'fresh native jump remains available');
        assert.equal(m[0xF6], held, 'controller state is unchanged');
        assert.equal(m[0xCB], 3, 'the platform never changes native player facing');
        call(game, game.init);
        assert.equal(m[0x556], 4, 'the carrier keeps its own direction');
    }
    for(const prepare of [
        () => { m[RAM.rider] = 0; },
        () => { m[RAM.rider] = 1; m[0xC0] = 2; },
        () => { m[0xC0] = 1; m[0xC2] += 40; },
        () => { m[0xC2] = m[RAM.x]; m[RAM.type] = 1; }
    ]) {
        prepare(); m[0xF6] = 0x0F;
        call(game, game.playerControl);
        assert.equal(m[0x03], 0x0F, 'unsupported players and other enemies retain native controls');
        assert.equal(m[0xF6], 0x0F);
    }
});

test('patrolling birds reverse at walls whether or not they carry a rider', () => {
    const game = machine(), { c, m } = game;
    platform(game);
    m.splice(0xB013, 3, 0xE6, 0x03, 0x60);
    call(game, game.reverse);
    assert.equal(m[0x03], 1);
    assert.equal(c.F_CARRY, 0);
    m[RAM.rider] = 1;
    m[0x52E] = 2; m[0x536] = 0;
    call(game, game.reverse);
    assert.equal(m[0x03], 2);
    assert.equal(m[0x52E], 0xFE, 'a two-pixel frightened velocity turns away in the wall-contact frame');
    assert.equal(m[0x536], 0);
    assert.equal(c.F_CARRY, 0, 'ridden wall contact retains ordinary patrol movement');
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
            m[0xFD] = 149; m[0x43C] = (before - m[0xFD]) & 255;
            m[0xD3] = 37; m[0x400] = 2;
            m[RAM.x] = after & 255; m[RAM.page] = after >> 8;
            call(game, game.update);
            assert.equal(m[RAM.rider], 1, `width=${width}: ${before}->${after}`);
            assert.equal(m[0xC1] * 256 + m[0xC2], after, `width=${width}: ${before}->${after}`);
            assert.equal(m[0x43C], (after - m[0xFD]) & 255, 'OAM projection uses the carried position this frame');
            assert.equal(m[0xD3], 37, 'carrying cannot advance the native blink timer');
            assert.equal(m[0x400], 2, 'carrying cannot change native sprite visibility or animation');
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
            m[0xFD] = 17; m[0x43C] = (before - m[0xFD]) & 255;
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
            assert.equal(m[0x43C], (before - m[0xFD]) & 255, 'OAM projection uses the wall-corrected position');
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

test('bird body terrain probes cancel blocked drops but wait for recovery under ceilings', () => {
    const game = machine(), { m } = game, top = platform(game);
    // The sampler records the leading edge and reports an occupied center.
    m.splice(0x9330, 12, 0xA5, 0x02, 0x85, 0x03,
        0xA9, 1, 0x85, 0xAC, 0xA9, 0, 0x85, 0xAD);
    m.splice(0x933C, 3, 0x85, 0xAE, 0x60);
    descend(game); advance(game, 20);
    assert.equal(m[RAM.y], top);
    assert.equal(m[0x03], top + 8, 'downward probe samples the lower body edge');
    assert.equal(m[RAM.committedY], top, 'blocked descent keeps the actual supported height');
    assert.equal(m[RAM.halfStep], 0, 'blocked descent leaves no pending half-step');
    assert.equal(m[RAM.timer], 0, 'blocked descent leaves no pending recovery');
    assert.equal(m[0x41E], top - 16);
    // Leaving the floor cannot replay a blocked landing.
    m.splice(0x9330, 9, 0xA9, 0, 0x85, 0xAC, 0x85, 0xAD, 0x85, 0xAE, 0x60);
    advance(game, 120);
    assert.equal(m[RAM.y], top);
    // A fresh landing in free air still reaches the half-step normally.
    descend(game);
    advance(game, 7 + 90);
    assert.equal(m[RAM.y], top + 8);
    assert.equal(m[RAM.halfStep], 0);
    // A side sample alone must also stop the full-width leading edge.
    m.splice(0x9330, 15, 0xA5, 0x02, 0x85, 0x03,
        0xA9, 0, 0x85, 0xAC, 0x85, 0xAD, 0xA9, 1, 0x85, 0xAE, 0x60);
    advance(game, 20);
    assert.equal(m[RAM.y], top + 8);
    assert.equal(m[0x03], top - 1, 'upward probe samples the next upper body edge');
    assert.equal(m[0x41E], top - 8);
    m.splice(0x9330, 9, 0xA9, 0, 0x85, 0xAC, 0x85, 0xAD, 0x85, 0xAE, 0x60);
    advance(game, 8);
    assert.equal(m[RAM.y], top);
    assert.equal(m[0x41E], top - 16);
});

test('repeated landings against a floor cannot bank descent for the next ledge', () => {
    for(const slot of [0, 7]) {
        const game = machine(), { m } = game, top = platform(game, slot);
        // A solid leading edge remains under the bird for every landing.
        m.splice(0x9330, 11, 0xA9, 1, 0x85, 0xAC,
            0xA9, 0, 0x85, 0xAD, 0x85, 0xAE, 0x60);
        for(let landing = 0; landing < 8; landing++) {
            m[0xC0] = 2; m[0xC7] = 0xFC;
            advance(game, 1, slot);
            descend(game, slot);
            advance(game, 100, slot);
            assert.equal(m[RAM.y + slot], top);
            assert.equal(m[RAM.committedY + slot], top);
            assert.equal(m[RAM.halfStep + slot], 0);
            assert.equal(m[RAM.timer + slot], 0);
            assert.equal(m[RAM.rider + slot], 1);
        }
        m.splice(0x9330, 9, 0xA9, 0, 0x85, 0xAC, 0x85, 0xAD, 0x85, 0xAE, 0x60);
        advance(game, 180, slot);
        assert.equal(m[RAM.y + slot], top, 'leaving terrain cannot spend cancelled landings');
        descend(game, slot); advance(game, 7, slot);
        assert.equal(m[RAM.y + slot], top + 8, 'a new airborne landing starts a single half-step');
        assert.equal(m[RAM.committedY + slot], top);
    }
});

test('a floor reached during a committed descent cancels its uncompleted remainder', () => {
    const game = machine(), { m } = game, top = platform(game);
    descend(game); advance(game, 7);
    descend(game);
    assert.equal(m[RAM.committedY], top + 16);
    advance(game, 2);
    const stoppedY = m[RAM.y];
    assert.equal(stoppedY, top + 11);
    // A newly encountered obstruction cancels a target set on an earlier frame.
    m.splice(0x9330, 11, 0xA9, 0, 0x85, 0xAC, 0x85, 0xAD,
        0xA9, 1, 0x85, 0xAE, 0x60);
    advance(game, 1);
    assert.equal(m[RAM.y], stoppedY, 'cancellation never teleports the bird or rider');
    assert.equal(m[RAM.committedY], stoppedY);
    assert.equal(m[RAM.halfStep], 0);
    assert.equal(m[RAM.timer], 0);
    assert.equal(m[0x41E], stoppedY - 16);
    m.splice(0x9330, 9, 0xA9, 0, 0x85, 0xAC, 0x85, 0xAD, 0x85, 0xAE, 0x60);
    advance(game, 180);
    assert.equal(m[RAM.y], stoppedY, 'a partial committed drop cannot resume beyond a ledge');
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

function defeatMachine() {
    const game = machine({ auxiliary: true }), { m } = game;
    // Hazard bodies are exercised against the real ROM in enemy12 tests.
    // This synthetic cartridge has no native terrain/object implementation.
    for(const entry of [0xB0D6, 0xB25D, 0xB20C, 0xB19B]) m[entry] = 0x60;
    // State 0's native clock: nine smoke frames, ten updates apiece.
    const smokeClock = [0xFE, 0x66, 0x05, 0xBD, 0x66, 0x05, 0xC9, 10, 0x90, 20,
        0xA9, 0, 0x9D, 0x66, 0x05, 0xFE, 0x5E, 0x05,
        0xBD, 0x5E, 0x05, 0xC9, 9, 0x90, 5, 0xA9, 0, 0x9D, 0x5E, 0x05, 0x60];
    m.splice(0xAE9C, smokeClock.length, ...smokeClock);
    m.splice(0xB530, 9, 0, 8, 9, 8, 9, 8, 9, 8, 9);
    // Observable stand-ins for shared native tumble/countdown routines. These
    // isolate our dispatch; optional full-ROM tests exercise their real code.
    m.splice(0xA9CF, 21, 0xBD, 0x06, 0x05, 0xC9, 13, 0xD0, 3,
        0x4C, 0x6D, 0xAD, 0xE6, 0x03,
        0xBD, 0x6F, 0x04, 0x49, 0xC0, 0x9D, 0x6F, 0x04, 0x60);
    m.splice(0xAD6D, 13, 0xE6, 0x04, 0xDE, 0x7E, 0x05, 0xD0, 5,
        0xA9, 0, 0x9D, 0x06, 0x05, 0x60);
    m.splice(0xA982, 3, 0xE6, 0x05, 0x60);
    m.splice(0xA97C, 3, 0xE6, 0x05, 0x60);
    m.splice(0xAFB0, 3, 0xE6, 0x06, 0x60);
    // The live-facing routine clears tumble flips: death must bypass it.
    m.splice(0xAF68, 6, 0xA9, 0, 0x9D, 0x6F, 0x04, 0x60);
    for(const entry of [0xA9B3, 0xAE54]) m[entry] = 0x60;
    return game;
}

function dispatch(game, slot = 0) {
    game.c.REG_ACC = game.m[RAM.type + slot];
    // Native enemy animation and rendering may use Y.
    call(game, 0xA978, slot, false);
}

test('live bird/fish animation alternates both scene frames every eight updates', () => {
    const game = defeatMachine(), { m } = game;
    m[RAM.type] = 12; m[RAM.spawn] = 0x56; m[RAM.x] = 80;
    for(let tick = 0; tick < 90; tick++) dispatch(game);
    for(let tick = 1; tick <= 32; tick++) {
        dispatch(game);
        const frame = Math.floor(tick / 8) & 1;
        assert.equal(m[0x55E], frame, `animation tick ${tick}`);
        assert.equal(m[0x566], tick % 8, `animation counter tick ${tick}`);
        assert.equal(m[0x415], 0x2D + frame, `visible frame tick ${tick}`);
        assert.equal(m[RAM.state], 1);
    }
});

test('bird/fish renderer maps frames to both sprite pairs with native render fallbacks', () => {
    const game = defeatMachine(), { m, c } = game;
    for(const [entry, trace] of [[0x8951, 0x03], [0x8935, 0x04], [0x8991, 0x05]])
        m.splice(entry, 3, 0xE6, trace, 0x60);
    for(const frame of [0x2D, 0x2E]) {
        m[0x10] = m[0x11] = m[0x12] = m[0x13] = 255;
        c.REG_ACC = frame;
        call(game, 0x8932, 5);
        assert.deepEqual(m.slice(0x10, 0x14),
            [0xAA + (frame - 0x2D) * 4, 0xAC + (frame - 0x2D) * 4, 0, 0]);
    }
    assert.equal(m[0x03], 2, 'both bird frames use the native sprite builder');
    for(const frame of [0x2C, 0x2F, 0x80]) {
        c.REG_ACC = frame;
        call(game, 0x8932, 5);
    }
    assert.equal(m[0x04], 2, 'ordinary frames retain the native short renderer');
    assert.equal(m[0x05], 1, 'large frames retain the native long renderer');
});

test('bird/fish death preserves native animation states, velocities, visible frames and tumble flips', () => {
    for(const wide of [0, 1]) for(const slot of [0, 7]) for(const state of [10, 11]) {
        const game = defeatMachine(), { m } = game;
        m[0x3D] = wide;
        m[RAM.type + slot] = 12; m[RAM.state + slot] = state;
        m[RAM.y + slot] = 112; m[RAM.committedY + slot] = 0x40;
        m[RAM.rider + slot] = 0xFC; m[0x415 + slot] = 0x2D;
        m[0x54E + slot] = 0x80;
        m[0x41E] = 96; m[0xC7] = 0xFC;
        dispatch(game, slot);
        assert.equal(m[RAM.state + slot], state, 'the wrapper cannot skip native animation');
        assert.equal(m[RAM.type + slot], 12, 'keep the slot for native respawn');
        assert.equal(m[0x415 + slot], 0x2D, 'the wrapper cannot hide the tumbling bird');
        assert.equal(m[RAM.rider + slot], 0xFC, 'preserve the aliased native Y velocity');
        assert.equal(m[RAM.committedY + slot], 0x40, 'preserve the aliased fractional Y velocity');
        assert.equal(m[0x46F + slot], 0xC0, 'live facing cannot erase native tumble flips');
        assert.equal(m[0x54E + slot], 0x80, 'native death remains immune to collisions');
        assert.equal(m[RAM.y + slot], 112, 'the wrapper cannot run platform height steering');
        assert.equal(m[0x41E], 96, 'defeat does not carry the player');
        assert.equal(m[0x56], 3, 'the player stays active');
        assert.equal(m[0x03], 1, 'shared native animation runs once per update');
        for(const address of [0x04, 0x05, 0x06]) assert.equal(m[address], 0);
    }
});

test('dead birds finish the native countdown and initialize cleanly on respawn', () => {
    const game = defeatMachine(), { m } = game, slot = 6;
    m[RAM.type + slot] = 12; m[RAM.state + slot] = 13;
    m[RAM.spawn + slot] = 0x56;
    m[RAM.y + slot] = 112; m[RAM.committedY + slot] = 120;
    m[RAM.rider + slot] = 4; m[RAM.timer + slot] = 200;
    for(let remaining = 199; remaining >= 0; remaining--) {
        dispatch(game, slot);
        assert.equal(m[RAM.timer + slot], remaining, 'patrol cannot reset the native timer');
        assert.equal(m[RAM.state + slot], remaining ? 13 : 0);
        assert.equal(m[RAM.rider + slot], 4, 'the wrapper does not overwrite native death physics');
        assert.equal(m[0x415 + slot], 0);
    }
    assert.equal(m[0x03], 0, 'death animation is never restarted during the countdown');
    assert.equal(m[0x04], 200, 'every dead update reaches the countdown');
    for(let tick = 1; tick <= 90; tick++) {
        dispatch(game, slot);
        assert.equal(m[RAM.state + slot], tick === 90 ? 1 : 0, 'respawn completes its smoke before patrol');
        assert.equal(m[0x06], 0, 'spawn smoke cannot move horizontally');
    }
    assert.equal(m[RAM.state + slot], 1);
    assert.equal(m[RAM.y + slot], 104);
    assert.equal(m[RAM.committedY + slot], 104, 'respawn clears the previous flight target');
    assert.equal(m[RAM.rider + slot], 0, 'respawn clears the former death velocity');
    assert.equal(m[0x415 + slot], 0x2D);
    assert.equal(m[0x05], 0, 'no out-of-range native per-type dispatch');
    assert.equal(m[0x56], 3);
});

test('tumbling birds cannot supply support even when native Y velocity resembles a rider latch', () => {
    const game = machine(), { m, c } = game, slot = 4;
    platform(game, slot);
    const support = m[0x9585] | (m[0x9586] << 8);
    m.splice(0x9BE3, 4, 0xE6, 0x03, 0x18, 0x60);
    m[0xC2] = 80; m[0xC0] = 1;
    for(const state of [10, 11, 13]) for(const velocity of [1, 4, 0xFC]) {
        m[RAM.state + slot] = state; m[RAM.rider + slot] = velocity;
        call(game, support, 3);
        assert.equal(c.F_CARRY, 0);
        assert.equal(m[RAM.rider + slot], velocity, 'support checks preserve native death velocity');
    }
    assert.equal(m[0x03], 9, 'every unsupported player uses the real floor probe');
    m[RAM.state + slot] = m[RAM.rider + slot] = 1;
    call(game, support, 3);
    assert.equal(c.F_CARRY, 1, 'live birds still support their rider');
    assert.equal(m[0x03], 9);
});

test('bird defeat hooks leave other enemy dispatches intact and live birds harmless', () => {
    const game = defeatMachine(), { m } = game;
    for(let type = 1; type <= 11; type++) {
        m[RAM.type] = type; m[RAM.state] = 4;
        dispatch(game);
        assert.equal(m[RAM.state], 4);
        assert.equal(m[0x05], type, 'other types still use their native dispatch');
    }
    m[RAM.type] = 12; m[RAM.state] = 0; m[RAM.spawn] = 0x56;
    m[RAM.x] = m[0xC2] = 80; m[0x41E] = 104;
    for(let tick = 0; tick < 90; tick++) dispatch(game);
    assert.equal(m[RAM.state], 1);
    assert.equal(m[RAM.y], 104);
    assert.equal(m[0x03], 0);
    assert.equal(m[0x04], 0);
    assert.equal(m[0x05], 11);
    assert.equal(m[0x56], 3);
});
