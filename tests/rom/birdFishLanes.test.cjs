const assert = require('node:assert/strict');
const test = require('node:test');
const jsnes = require('../../js/lib/jsnes.min.js');
const {BirdFish, RomLayout, expandMapper, Portal, Pause, ViewModes, Penguin} =
    require('../helpers/source.cjs').load('BirdFish RomLayout expandMapper Portal Pause ViewModes Penguin');

function machine({nmi = false} = {}) {
    const data = new Uint8Array(0x20010), entries = {};
    data.set([0x4E, 0x45, 0x53, 0x1A, 8, 0, 0x21]);
    data.set([0, 0x80, 0, 0x80, 0, 0x80], 0x2000A);
    if(nmi) expandMapper(data);
    const write = (at, bytes) => data.set(bytes, RomLayout.programOffset(at));
    write(0xBF20, [0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 0, 0]);
    BirdFish.addBirdFishAuxiliary(data, entries);
    for(const at of [0x9BB9, 0x9BBD, 0x9BD5, 0x9BE3]) write(at, [0x18, 0x60]);
    write(0x9330, [0xA9, 0, 0x85, 0xAC, 0x85, 0xAD, 0x85, 0xAE, 0x60]);
    write(0xAAF4, [0xA9, 0, 0x9D, 0x5E, 5, 0x9D, 0x66, 5, 0x9D, 0x6E, 5,
        0x9D, 0x7E, 5, 0x9D, 0x4E, 5, 0x60]);
    if(nmi) write(0x807F, [0xE6, 0x71, 0x68, 0xAA, 0x68, 0x40]);
    const nes = new jsnes.NES({onFrame() {}, emulateSound: false});
    nes.loadROM(Buffer.from(data).toString('binary'));
    const c = nes.cpu, m = c.mem;
    m.fill(0, 0, 0x800); m[0x56] = 3; m[0xC0] = 2; m[0xC7] = 0xFC;
    return {nes, c, m, data, ...entries};
}

function call(g, entry = g.update, slot = 0, {interrupt = false, command} = {}) {
    const {c, m, nes} = g;
    c.REG_X = slot; c.REG_Y = 17; c.REG_SP = 0x1FF; c.REG_PC = 0x5FFF; c.irqRequested = false;
    if(command !== undefined) c.REG_ACC = command;
    m.splice(0x6000, 3, 0x20, entry & 255, entry >> 8);
    let bank = 0, switches = 0;
    const write = nes.mmap.write.bind(nes.mmap);
    nes.mmap.write = (at, value) => {
        if(at === 0x8000) {
            assert.equal(m[Portal.PORTAL_RAM.bankActive], 1, 'guard precedes both mapper writes');
            bank = value; switches++;
        }
        return write(at, value);
    };
    try {
        if(interrupt) nes.mmap.write(0x2000, 0x80);
        for(let step = 0; step < 10000; step++) {
            if(interrupt) {
                const pc = c.REG_PC, sp = c.REG_SP;
                c.requestIrq(c.IRQ_NMI);
                let returned = false;
                for(let tick = 0; tick < 40; tick++) {
                    c.emulate();
                    if(c.REG_PC === 0x807E && c.REG_SP !== sp) assert.equal(bank, 0);
                    if(c.REG_PC === pc && c.REG_SP === sp) { returned = true; break; }
                }
                assert.ok(returned, 'NMI returns to the exact interrupted instruction');
            }
            c.emulate();
            if(c.REG_PC === 0x6002) {
                assert.equal(c.REG_X, slot); assert.equal(c.REG_Y, 17); assert.equal(c.REG_SP, 0x1FF);
                assert.equal(bank, 0); assert.equal(m[Portal.PORTAL_RAM.bankActive], 0);
                return switches;
            }
        }
        assert.fail('bird routine did not return');
    } finally { nes.mmap.write = write; }
}

function bird(g, {slot = 0, x = 136, row = 6} = {}) {
    const m = g.m;
    m[0x4FE + slot] = 12; m[0x576 + slot] = 0x80 | row;
    m[0x516 + slot] = m[0x526 + slot] = x & 255; m[0x50E + slot] = x >> 8;
    m[0x556 + slot] = 4;
    call(g, g.init, slot);
    return m[0x433 + slot];
}
function land(g, slot = 0) {
    const m = g.m;
    m[0xC0] = 2; m[0xC7] = 1; m[0xC2] = m[0x516 + slot]; m[0xC1] = m[0x50E + slot];
    const y = m[0x433 + slot] - 16;
    m[0x41E] = y & 255; m[0x7D] = y < 0 ? 255 : 0;
    call(g, g.update, slot);
}
function advance(g, count, slot = 0) { for(let i = 0; i < count; i++) call(g, g.update, slot); }
function tile(g, x, y, id = 5) {
    const at = 0x700 + y * 16 + (x >> 1);
    g.m[at] = x & 1 ? (g.m[at] & 0xF0) | id : (g.m[at] & 15) | (id << 4);
}

test('every in-flight landing and Tile 13 interruption keeps goals on whole and half rows', () => {
    for(const slot of [0, 7]) for(const phase of [0, 8, 16]) for(let pixel = 1; pixel < 8; pixel++) {
        for(const lift of [false, true]) {
            const g = machine(), m = g.m, base = bird(g, {slot});
            m[0x56E + slot] = phase; m[0x57E + slot] = phase ? 90 : 0;
            m[0x433 + slot] = base + (phase === 16 ? 8 : 0) + pixel;
            const before = m[0x433 + slot];
            if(lift) {
                call(g, g.motion.liftTarget, slot);
                assert.equal(m[0x433 + slot], before, 'events cannot teleport visible Y');
                assert.equal(m[0x546 + slot], base - 16);
                assert.equal(m[0x56E + slot], 0);
            }
            land(g, slot);
            assert.equal(m[0x53E + slot], 1, 'an in-flight landing can still attach');
            assert.equal(m[0x546 + slot] & 15, 8);
            assert.equal(m[0x56E + slot], lift ? 0 : phase, 'contact does not replace the in-flight action');
            advance(g, 140, slot);
            assert.equal(m[0x433 + slot], lift ? base - 16 : phase === 16 ? base + 16 : base);
            assert.equal(m[0x433 + slot], m[0x546 + slot]);
            assert.equal(m[0x56E + slot], 0);
        }
    }
});

test('full-height preflight cancels blocked landings, including the opposite side of a map seam', () => {
    for(const wide of [0, 1]) for(const x of [0, 136, wide ? 511 : 255]) {
        const g = machine(), m = g.m;
        m[0x3D] = wide;
        const base = bird(g, {x}), column = ((x - 8) >> 4) & (wide ? 31 : 15);
        tile(g, column, 7);
        land(g);
        assert.equal(m[0x433], base, 'no partial descent begins');
        assert.equal(m[0x56E], 0); assert.equal(m[0x57E], 0);
        tile(g, column, 7, 0); advance(g, 120);
        assert.equal(m[0x433], base, 'leaving the floor does not spend a cancelled landing');
    }
});

test('legacy pixel goals recover smoothly and bottom-row sweeps ignore RAM outside the map', () => {
    for(const y of [101, 106, 112, 117]) {
        const g = machine(), m = g.m;
        bird(g); m[0x433] = m[0x546] = y;
        call(g);
        assert.ok(Math.abs(m[0x433] - y) <= 1, 'repair never teleports the visible position');
        assert.equal(m[0x546], (y & 0xF0) | 8);
        advance(g, 24);
        assert.equal(m[0x433], m[0x546], 'old pixel checkpoints settle on a whole row');
    }
    const g = machine(), m = g.m, base = bird(g, {row: 13});
    m.fill(0x55, 0x7E0, 0x800); // Unrelated RAM below the 14 editable map rows.
    land(g); advance(g, 7);
    assert.equal(m[0x433], base + 8, 'the final supported half row remains reachable');
    advance(g, 98);
    assert.equal(m[0x433], base);
});

test('whole-row bodies only touch adjacent rows; ascent preflight includes the offset rider head', () => {
    const g = machine(), m = g.m, base = bird(g);
    tile(g, 8, 5); tile(g, 8, 7);
    advance(g, 10);
    assert.equal(m[0x433], base, 'a whole-row body fits exactly between adjacent rows');
    tile(g, 8, 7, 0); tile(g, 8, 5, 0);
    m[0x433] = base + 16; m[0x53E] = 1;
    m[0xC0] = 1; m[0xC7] = 0; m[0xC2] = 146; m[0x41E] = base;
    // Only the rider's right edge meets this ceiling; the bird column is clear.
    tile(g, 9, 5);
    advance(g, 30);
    assert.equal(m[0x433], base + 16, 'preflight waits at a lane, not at a partial pixel');
    tile(g, 9, 5, 0); advance(g, 16);
    assert.equal(m[0x433], base);
});

test('horizontal travel cannot carry an active rise into a blocked vertical corridor at either seam', () => {
    for(const wide of [0, 1]) for(const [before, after] of [[136, 137], [136, 135],
        [248, 249], [8, 7],
        [wide ? 511 : 255, 0], [0, wide ? 511 : 255]]) {
        const g = machine(), m = g.m;
        m[0x3D] = wide;
        const base = bird(g, {x: before});
        m[0x546] = base - 16;
        m[0x516] = after & 255; m[0x50E] = after >> 8;
        const sign = ((after - before) & 255) < 128 ? 1 : -1;
        const column = ((after + (sign > 0 ? 7 : -8)) >> 4) & (wide ? 31 : 15);
        tile(g, column, 5);
        call(g);
        const mask = wide ? 31 : 15;
        const alreadyBlocked = [((before - 8) >> 4) & mask, ((before + 7) >> 4) & mask].includes(column);
        assert.equal(m[0x516] + 256 * m[0x50E], alreadyBlocked ? after : before,
            'reject a newly blocked corridor, but retain patrol under an existing ceiling');
        assert.equal(m[0x546], base - 16, 'collision cannot save an arbitrary permanent row');
    }
});

test('a dynamic ceiling during ascent rolls back to an 8px boundary without changing Y instantly', () => {
    for(let pixel = 1; pixel < 8; pixel++) {
        const g = machine(), m = g.m, base = bird(g);
        m[0x546] = base - 16; m[0x433] = base - pixel;
        // Exercise the native-ceiling fallback without making the return corridor solid.
        call(g, g.lanes, 0, {command: 3});
        assert.equal(m[0x433], base - pixel);
        assert.equal(m[0x546], base);
        advance(g, pixel);
        assert.equal(m[0x433], base);
        assert.equal(m[0x56E], 0);
    }
});

test('lane bridge survives NMI at every instruction and coexists with both settings layouts', () => {
    const snapshots = [];
    for(const interrupt of [false, true]) {
        const g = machine({nmi: true}), m = g.m;
        bird(g); m[0xC0] = 2; m[0xC7] = 1; m[0xC2] = 136; m[0x41E] = 88;
        const switches = call(g, g.update, 0, {interrupt});
        assert.equal(switches, 4, 'landing and tick each use a guarded round trip');
        snapshots.push([m.slice(0, 0x71), m.slice(0x72, 0x100), m.slice(0x400, 0x800)]);
    }
    assert.deepEqual(snapshots[1], snapshots[0]);
    for(const camera of [false, true]) for(const penguin of [false, true]) {
        const enabled = Penguin.ENABLED;
        try {
            Penguin.ENABLED = penguin;
            const data = new Uint8Array(0x20010);
            const views = camera ? ViewModes.addViewModes(data) : null;
            BirdFish.addBirdFishAuxiliary(data);
            const start = 0x4010 + BirdFish.LANES_BASE - 0x8000;
            const worker = data.slice(start, 0x8010);
            Pause.addPauseControls(data, views);
            assert.deepEqual(data.slice(start, 0x8010), worker, 'settings cannot overwrite the lane worker');
        } finally { Penguin.ENABLED = enabled; }
    }
});
