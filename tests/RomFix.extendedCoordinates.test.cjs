const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const jsnes = require('../js/lib/jsnes.min.js');
const source = ['Config', 'Level', 'RomFix', 'RomEditor', 'DataConverter']
    .map(name => fs.readFileSync(path.join(__dirname, '..', 'js', `${name}.js`), 'utf8')).join('\n');
const { Config, Romfix, RomEditor, DataConverter } = new Function('i18n',
    `${source}\nreturn {Config, Romfix, RomEditor, DataConverter};`)({ t: key => key });
const original = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;
const realTest = (name, fn) => test(name, { skip: !original }, fn);
const high = Romfix.COORDINATE_RAM.playerYHigh;
const pages = Romfix.COORDINATE_RAM.enemySpawnPages;
function machine(data) {
    const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, emulateSound: false });
    nes.loadROM(Buffer.from(data).toString('binary')); return nes;
}
function synthetic() {
    const data = new Uint8Array(0x20010);
    data.set([0x4E, 0x45, 0x53, 0x1A, 8, 0, 0x21]);
    data.set([0, 0x80, 0, 0x80, 0, 0x80], 0x2000A);
    Romfix.fixExtendedCoordinates(data, true); return machine(data);
}
function call(nes, entry, limit = 10000) {
    const c = nes.cpu;
    c.REG_SP = 0x1FF; c.REG_PC = 0x7FFF; c.irqRequested = false;
    c.mem[0x8000] = 0x20; c.mem[0x8001] = entry & 255; c.mem[0x8002] = entry >> 8;
    for(let i = 0; i < limit; i++) {
        c.emulate();
        if(c.REG_PC === 0x8002) { assert.equal(c.REG_SP, 0x1FF); return; }
    }
    assert.fail(`routine $${entry.toString(16)} did not return`);
}
const target = (m, addr) => m[addr + 1] | (m[addr + 2] << 8);
function stage({ wide = false, camera = true, spring = false, roof = false, enemies = [] } = {}) {
    const editor = new RomEditor(); editor.loadROM(original);
    editor.romType = Config.ROM_TYPE_EXPANDED;
    editor.gameConfig.cameraFollow = camera; editor.gameConfig.disableTimer = true;
    const map = Array.from({ length: 14 }, () => Array(wide ? 32 : 16).fill(0));
    map[spring ? 2 : 1].fill(5); map[12].fill(5); map[8][3] = 15;
    if(spring) map[2][8] = 12;
    if(roof) {
        map[0][6] = map[0][7] = 5;
        if(wide) map[0][22] = map[0][23] = 5;
    }
    const converted = DataConverter.fromLevelEditorToROMData({ background: wide ? 0x10 : 0,
        player: { x: 8, y: spring ? 1 : 0 }, door: { x: 12, y: 10 }, map, enemies }, wide);
    editor.levels[0].data = converted.mapData; editor.levels[0].monsterData = converted.monsterData;
    editor.levelCount = 1; return editor.getROMData();
}
function start(data) {
    const nes = machine(data);
    for(let i = 0; i < 160; i++) nes.frame();
    nes.buttonDown(1, jsnes.Controller.BUTTON_START); nes.frame();
    nes.buttonUp(1, jsnes.Controller.BUTTON_START);
    for(let i = 0; i < 600; i++) {
        nes.frame();
        if(nes.cpu.mem[0x30] === 12 && nes.cpu.mem[0x56] === 3 && !(nes.cpu.mem[0x2A] & 128)) return nes;
    }
    assert.fail('START did not reach gameplay');
}
const signedY = m => (m[high] >= 128 ? m[high] - 256 : m[high]) * 256 + m[0x41E];

test('coordinate reservation rejects occupied code before changing any hooks', () => {
    const data = new Uint8Array(0x20010); data[0x1F420] = 1;
    const before = data.slice();
    assert.throws(() => Romfix.fixExtendedCoordinates(data, true), /occupied/);
    assert.deepEqual(data, before);
    assert.throws(() => Romfix.fixExtendedCoordinates(data, false), /expanded ROM/);
});

test('ordinary 8.8 Y integration preserves signed motion and fractional carry at both seams', () => {
    const nes = synthetic(), c = nes.cpu, m = c.mem;
    for(const y of [-257, -256, -255, -8, -1, 0, 1, 8, 127, 254, 255, 256])
    for(const fraction of [0, 1, 127, 255]) for(const speed of [-2048, -1793, -1024, -1, 0, 1, 63, 255, 256, 1023]) {
        m[high] = (y >> 8) & 255; m[0x41E] = y & 255; m[0xC4] = fraction;
        m[0xC7] = (speed >> 8) & 255; m[0xC8] = speed & 255;
        c.REG_X = 37; c.REG_Y = 19;
        call(nes, 0x9995);
        const expected = y * 256 + fraction + speed;
        assert.equal(signedY(m), Math.floor(expected / 256));
        assert.equal(m[0xC4], expected & 255);
        assert.equal(c.REG_X, 37); assert.equal(c.REG_Y, 19);
    }
});

test('spring steps, one-pixel stair adjustment and spawn reset maintain Y high byte', () => {
    const nes = synthetic(), c = nes.cpu, m = c.mem;
    for(const y of [-256, -3, -1, 0, 1, 3, 253, 255]) for(const delta of [-7, -3, 0, 3, 5]) {
        m[high] = (y >> 8) & 255; m[0x41E] = y & 255; m[0xC4] = 99;
        c.REG_ACC = delta & 255; c.REG_X = 5; c.REG_Y = 10;
        call(nes, target(m, 0x9CA2));
        assert.equal(signedY(m), y + delta); assert.equal(m[0xC4], 99);
        assert.equal(c.REG_X, 5); assert.equal(c.REG_Y, 10);
    }
    m[high] = 0; m[0x41E] = 0; call(nes, target(m, 0x97DF));
    assert.equal(signedY(m), -1);
    c.REG_ACC = 24; call(nes, target(m, 0x9B20));
    assert.equal(signedY(m), 24);
});

test('above-map probes never interpret bottom-row RAM as tiles or enemies', () => {
    const nes = synthetic(), c = nes.cpu, m = c.mem;
    m[high] = 255; m[0x41E] = 192;
    for(const direction of [1, 2, 3, 4]) {
        m[0x42] = direction; m[0x41] = m[0x44] = 13;
        c.REG_X = 7; c.REG_Y = 8; call(nes, 0x8F5D);
        assert.equal(c.F_CARRY, 0); assert.equal(m[0x41], 0); assert.equal(m[0x44], 0);
        assert.equal(c.REG_X, 7); assert.equal(c.REG_Y, 8);
    }
    for(const entry of [0x9870, 0x9C3C, 0x9F78, 0x9D0A, 0x95FA, 0xB033,
        target(m, 0x94E2), target(m, 0x95BF), target(m, 0x8B6F), 0xB802]) call(nes, entry);
    m[high] = 0; m[0x42] = 1; m[0x02] = 7;
    call(nes, 0x8F5D); assert.equal(c.F_CARRY, 0);
    m[0x41E] = 0; m[0x02] = 255;
    call(nes, 0x8F5D); assert.equal(c.F_CARRY, 0);
    // A partially visible horizontal body clips the top probe to map row 0.
    m[0x02] = 3; m[0x05] = 2; c.REG_X = 4; c.F_CARRY = 0;
    m[0xBF67] = 248; call(nes, target(m, 0x8FA7));
    assert.equal(m[0x02], 0); assert.equal(m[0x05], 1);
});

test('bottom death remains native, and OAM excludes wrapped player and fist sprites', () => {
    const nes = synthetic(), m = nes.cpu.mem;
    m.splice(0xB9A1, 5, 0xA9, 14, 0x85, 0x30, 0x60); m[0x945A] = 0x60;
    for(const [y, dies] of [[-256, false], [-1, false], [0, false], [212, false], [213, true], [256, true]]) {
        m[high] = (y >> 8) & 255; m[0x41E] = y & 255; m[0x30] = 12;
        call(nes, 0x9863); assert.equal(m[0x30], dies ? 14 : 12);
    }
    m[0x88D6] = 0x60;
    for(const value of [0, 255, 1]) {
        m[high] = value; m[0x400] = 2; m[0x411] = 7;
        call(nes, 0x88D3);
        assert.equal(m[0x400], value ? 0 : 2); assert.equal(m[0x411], value ? 0 : 7);
    }
});

realTest('native enemy loader remembers all eight original pages and clears unused slots', () => {
    const enemies = Array.from({ length: 8 }, (_, i) => ({ enemyId: i % 2 ? 0x41 : 1, x: i * 4, y: 10 }));
    for(const camera of [false, true]) {
        const nes = start(stage({ wide: true, camera, enemies })), m = nes.cpu.mem;
        for(let i = 0; i < 8; i++) {
            const slot = 7 - i;
            assert.equal(m[pages + slot], i >= 4 ? 1 : 0);
            assert.equal(m[0x50E + slot], m[pages + slot]);
        }
        m.fill(1, pages, pages + 8); call(nes, 0xAE32);
        assert.deepEqual(m.slice(pages, pages + 8), Array(8).fill(0));
    }
});

realTest('ordinary enemies respawn at their original page after dying on the opposite page', () => {
    for(const camera of [false, true]) {
        const nes = machine(stage({ wide: true, camera })), c = nes.cpu, m = c.mem;
        m[0x3D] = 1; m.fill(0, 0x700, 0x800);
        for(const birth of [0, 1]) for(const type of [1, 2, 3, 4, 6, 7, 8, 9, 10]) {
            const slot = type % 8; c.REG_X = slot;
            m[pages + slot] = birth; m[0x4FE + slot] = type;
            m[0x50E + slot] = 1 - birth; m[0x516 + slot] = 200; m[0x433 + slot] = 96;
            m[0x576 + slot] = 0x5A; m[0xAC] = 0;
            call(nes, 0xAC22);
            assert.equal(m[0x4FE + slot], type); assert.equal(m[0x506 + slot], 13);
            m[0x1B] = 0;
            for(let i = 0; i < 200; i++) call(nes, 0xAD6D);
            assert.equal(m[0x50E + slot], birth);
            assert.equal(m[0x516 + slot], 0x56); assert.equal(m[0x433 + slot], 0xA8);
            assert.equal(m[0x506 + slot], 0); assert.equal(m[pages + slot], birth);
        }
        for(const type of [5, 11]) { c.REG_X = 0; m[0x4FE] = type; call(nes, 0xAC22); assert.equal(m[0x4FE], 0); }
    }
});

realTest('respawn checks the live birthplace instead of the old death position', () => {
    const nes = machine(stage({ wide: true })), c = nes.cpu, m = c.mem;
    m[0x3D] = 1; m[0x1B] = 0;
    for(const birth of [0, 1]) for(const blocked of [false, true]) {
        m.fill(0, 0x700, 0x800);
        c.REG_X = 3; m[pages + 3] = birth;
        m[0x501] = 1; m[0x509] = 13; m[0x581] = 1; m[0x579] = 0x5A;
        m[0x511] = 1 - birth; m[0x519] = 200; m[0x436] = 100;
        // Wide map packs two columns in each byte; birth is column 5/21.
        m[0x7A2 + birth * 8] = blocked ? 0x05 : 0;
        m[0xAC] = blocked ? 0 : 5; call(nes, 0xAD6D);
        assert.equal(m[0x511], birth);
        assert.equal(m[0x509], blocked ? 13 : 0);
        if(blocked) assert.equal(m[0x581], 200);
    }
});

realTest('full enemy update frames restore eight birth pages and retry clears extended Y', () => {
    const enemies = Array.from({ length: 8 }, (_, i) => ({ enemyId: 1, x: i * 4, y: 11 }));
    const nes = start(stage({ wide: true, enemies })), m = nes.cpu.mem;
    const expected = m.slice(pages, pages + 8), restored = new Set();
    for(let slot = 0; slot < 8; slot++) {
        m[0x50E + slot] = 1 - expected[slot]; m[0x516 + slot] = 64;
        m[0x506 + slot] = 13; m[0x57E + slot] = 1; m[0x54E + slot] = 128;
    }
    const emulate = nes.cpu.emulate.bind(nes.cpu);
    nes.cpu.emulate = () => {
        if(nes.cpu.REG_PC === 0xAD99) {
            const slot = nes.cpu.REG_X;
            assert.equal(m[0x50E + slot], expected[slot]);
            assert.equal(m[0x516 + slot], (m[0x576 + slot] & 240) | 6);
            restored.add(slot);
        }
        return emulate();
    };
    for(let i = 0; i < 30; i++) nes.frame();
    assert.equal(restored.size, 8); assert.deepEqual(m.slice(pages, pages + 8), expected);
    nes.cpu.emulate = emulate;
    m[high] = 255; m[0x30] = 14;
    let reloaded = false;
    for(let i = 0; i < 600; i++) {
        nes.frame();
        if(m[0x30] === 12 && m[0x56] === 3) { reloaded = true; break; }
    }
    assert.ok(reloaded); assert.equal(m[high], 0);
    assert.deepEqual(m.slice(pages, pages + 8), expected);
});

realTest('real frames jump freely above the top and land again in both widths and camera settings', () => {
    for(const wide of [false, true]) for(const camera of [false, true]) {
        const nes = start(stage({ wide, camera })), m = nes.cpu.mem;
        for(let i = 0; i < 80; i++) nes.frame();
        const floorY = signedY(m); assert.ok(floorY < 32);
        nes.buttonDown(1, jsnes.Controller.BUTTON_A);
        let minimum = 0, above = 0, returned = false;
        for(let i = 0; i < 180; i++) {
            if(i === 12) nes.buttonUp(1, jsnes.Controller.BUTTON_A);
            nes.frame(); const y = signedY(m); minimum = Math.min(minimum, y);
            assert.equal(m[0x30], 12, `width=${wide} camera=${camera} frame=${i} y=${y}`);
            if(y < 0) { above++; assert.equal(m[0x400], 0); }
            if(above && y === floorY && m[high] === 0) returned = true;
        }
        assert.ok(minimum < -5); assert.ok(above > 2); assert.ok(returned);
        assert.equal(nes.cpu.REG_SP, 0x1FF);
    }
});

realTest('real spring sequence crosses the top smoothly and returns without a false death', () => {
    for(const camera of [false, true]) {
        const nes = start(stage({ wide: true, camera, spring: true })), m = nes.cpu.mem;
        let above = false, returned = false, spring = false, minimum = 0;
        for(let i = 0; i < 500; i++) {
            // Native spring compression/boost uses A, its own timer and path.
            if(i === 30) nes.buttonDown(1, jsnes.Controller.BUTTON_A);
            if(i === 50) nes.buttonUp(1, jsnes.Controller.BUTTON_A);
            nes.frame(); const y = signedY(m); minimum = Math.min(minimum, y);
            spring ||= m[0xC0] === 4;
            assert.equal(m[0x30], 12, `spring frame=${i} y=${y}`);
            if(y < 0) above = true;
            if(above && y >= 0 && m[high] === 0) returned = true;
        }
        assert.ok(spring); assert.ok(above && returned); assert.ok(minimum < -5);
        assert.equal(nes.cpu.REG_SP, 0x1FF);
    }
});

realTest('head, body and foot probes clip the signed top boundary to real map rows', () => {
    const nes = machine(stage({ wide: true })), c = nes.cpu, m = c.mem;
    m[0x3D] = 1; m.fill(0, 0x700, 0x800); m.fill(0x55, 0x700, 0x710);
    for(const y of [-256, -9, -8, -7, -1, 0, 1, 7, 8]) for(const entry of [0x9BD5, 0x9BE3, 0x9B95]) {
        m[high] = (y >> 8) & 255; m[0x41E] = y & 255;
        m[0xC1] = 1; m[0xC2] = 72; m[0xCB] = 3;
        c.REG_X = 7; c.REG_Y = 11; call(nes, entry);
        const expected = entry === 0x9BD5 ? false : entry === 0x9BE3 ? y >= -8 && y < 8 : y >= -7;
        assert.equal(c.F_CARRY, Number(expected), `entry=${entry.toString(16)} y=${y}`);
        assert.equal(c.REG_X, 7); assert.equal(c.REG_Y, 11);
        if(expected) assert.equal(m[0x44], 5);
    }
});

realTest('a player can jump onto the highest brick, stand offscreen, jump again and walk off', () => {
    for(const wide of [false, true]) for(const camera of [false, true]) for(const page of wide ? [0, 1] : [0]) {
        const nes = start(stage({ wide, camera, roof: true })), m = nes.cpu.mem;
        for(let i = 0; i < 60; i++) nes.frame();
        m[0xC1] = page;
        nes.buttonDown(1, jsnes.Controller.BUTTON_LEFT); nes.buttonDown(1, jsnes.Controller.BUTTON_A);
        let landed = false;
        for(let i = 0; i < 60; i++) {
            if(i === 12) nes.buttonUp(1, jsnes.Controller.BUTTON_A);
            nes.frame();
            assert.equal(m[0x30], 12);
            if(signedY(m) === -8 && m[0xC0] === 1) { landed = true; break; }
        }
        nes.buttonUp(1, jsnes.Controller.BUTTON_LEFT); nes.buttonUp(1, jsnes.Controller.BUTTON_A);
        assert.ok(landed, `width=${wide} camera=${camera} page=${page}`);
        for(let i = 0; i < 90; i++) { nes.frame(); assert.equal(signedY(m), -8); assert.equal(m[0xC0], 1); }
        nes.buttonDown(1, jsnes.Controller.BUTTON_A);
        let minimum = -8;
        for(let i = 0; i < 90; i++) {
            if(i === 12) nes.buttonUp(1, jsnes.Controller.BUTTON_A);
            nes.frame(); minimum = Math.min(minimum, signedY(m)); assert.equal(m[0x30], 12);
        }
        assert.ok(minimum < -16); assert.equal(signedY(m), -8);
        nes.buttonDown(1, jsnes.Controller.BUTTON_RIGHT);
        for(let i = 0; i < 25; i++) nes.frame();
        nes.buttonUp(1, jsnes.Controller.BUTTON_RIGHT);
        for(let i = 0; i < 45; i++) nes.frame();
        assert.equal(signedY(m), 8); assert.equal(m[high], 0); assert.equal(m[0x30], 12);
    }
});

realTest('a real punch runs the entire wide respawn delay and makes the enemy visible on its birth page', () => {
    for(const camera of [false, true]) for(const birth of [0, 1]) {
        const nes = start(stage({ wide: true, camera, enemies: [{ enemyId: 1, x: birth * 16 + 9, y: 0 }] }));
        const m = nes.cpu.mem, slot = 7, deathPage = 1 - birth;
        assert.equal(m[pages + slot], birth);
        m[0xC2] = 16;
        for(let i = 0; i < 160; i++) nes.frame(); // Let native player/enemy entry animations finish.
        assert.equal(m[0x54E + slot] & 128, 0);
        // A gameplay checkpoint after crossing the seam; retain the loaded
        // birth data. Only the native B-button attack may start the death.
        m[0xC1] = deathPage; m[0xC2] = 136; m[0xCB] = 4;
        m[0x50E + slot] = deathPage; m[0x516 + slot] = 150;
        nes.buttonDown(1, jsnes.Controller.BUTTON_B); nes.frame();
        nes.buttonUp(1, jsnes.Controller.BUTTON_B);
        let dead = false;
        for(let i = 0; i < 100; i++) {
            nes.frame(); assert.equal(m[0x30], 12);
            if(m[0x506 + slot] === 13) { dead = true; break; }
        }
        assert.ok(dead, 'native punch reaches the normal death state');
        assert.equal(m[0x4FE + slot], 1, 'wide-only type clear is bypassed');
        assert.ok(m[0x57E + slot] >= 199, 'native 200-tick delay has not been shortened');
        m[0xC1] = birth; m[0xC2] = 80;
        let visibleAt = -1;
        const observedTimers = new Set();
        for(let i = 0; i < 950; i++) {
            nes.frame(); assert.equal(m[0x30], 12);
            observedTimers.add(m[0x57E + slot]);
            assert.equal(m[pages + slot], birth);
            assert.equal(m[0x4FE + slot], 1);
            if(m[0x506 + slot] !== 13 && !(m[0x54E + slot] & 128) && m[0x415 + slot]) { visibleAt = i; break; }
        }
        assert.ok(observedTimers.has(100) && observedTimers.has(1), 'full countdown runs through the enemy update loop');
        assert.ok(visibleAt >= 790 && visibleAt < 950, `visibleAt=${visibleAt}`);
        assert.equal(m[0x50E + slot], birth);
        assert.equal(m[0x576 + slot], 0x90, 'original local birth coordinate is retained');
        assert.equal(nes.cpu.REG_SP, 0x1FF);
    }
});
