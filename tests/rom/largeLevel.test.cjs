const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const jsnes = require('../../js/lib/jsnes.min.js');
const {Project, LevelCodec, expandMapper} = require('../helpers/source.cjs').load('Project LevelCodec expandMapper');

// User-reported share link: 346 bytes, including a four-byte header.
const sharedMap = 'G_EPBgAFEAQQBRAEEFUQBBAFEAQQBRAFAAQQBRAEEAVQBRAEEAUQBAAFEAUABAAFEAQQBRA0EAUQBBAFAAQABRAFAAQABQAEEAUQBAAFEAQQBRAEAAUABAAFEAUABAAFAAQABRAEDxUABQ8EEAUABAAFAAQABRAFAAQABQAEAAUABAAFABUABQAEAAUABAAFAAQABRAFAAQABQAEAAUABBAFECUEAAUABAAFAAQABRAFAAQABQAEAAUABCUQBRAEAAUABAAFAAQABRAFAAQABQAEAAUABAAFABUABQAEAAUABAAFAAQABRAFAAQABQAEAAUQBA8FABUPBBAFAAQABQAEAAUQBQAEAAUABBAFEAQQBQAEEAUQBAAFAAQABRAFAAQABRAEEAUQNBAFEAQQBQAEAAUQBQAEEAUQBBAFUAUQBBAFEAQABRAFEAQQBRAEEFUQBBAFEAQQBQ';
const mapData = Array.from(Buffer.from(sharedMap, 'base64url'));
const monsterData = Array.from(Buffer.from('BQa0hkQ', 'base64url'));
const original = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;

test('banked map reader carries its index at 256 bytes and preserves byte/terminator flags', () => {
    const rom = new Uint8Array(0x20010);
    rom.set([0x4E, 0x45, 0x53, 0x1A]);
    expandMapper(rom);
    assert.equal(rom[0x292F], 0xEA, 'native INY must not advance a second time');
    const reader = rom[0x292A] | (rom[0x292B] << 8);
    rom.set([0x20, reader & 255, reader >> 8], 0x2010);
    for (const offset of [0, 1, 253, 255]) for (const size of [255, 256, 257, 452]) {
        const bytes = Array.from({length: size}, (_, i) => (i * 17 + 3) % 255);
        bytes.push(255);
        rom.set(bytes, 0x10010 + offset);
        const nes = new jsnes.NES({onFrame() {}, onAudioSample() {}, emulateSound: false});
        nes.loadROM(Buffer.from(rom).toString('binary'));
        const c = nes.cpu, m = c.mem;
        c.irqRequested = false;
        c.REG_SP = 0x1FF;
        c.REG_Y = 4;
        c.REG_X = 73;
        m[0] = offset; m[1] = 0x80;
        for (let i = 4; i < bytes.length; i++) {
            c.REG_PC = 0x9FFF;
            let steps = 0;
            do {
                c.emulate();
                assert.ok(++steps < 30, 'reader must return to bank 0');
            } while (c.REG_PC !== 0xA002);
            assert.equal(c.REG_ACC, bytes[i], `offset=${offset}, size=${size}, index=${i}`);
            assert.equal(c.F_ZERO === 0, bytes[i] === 255, 'CMP #$FF must follow index updates');
            assert.equal(c.REG_X, 73);
            assert.equal(c.REG_SP, 0x1FF);
        }
        assert.equal(c.REG_Y, bytes.length & 255);
        assert.equal(m[1], 0x80 + (bytes.length >> 8));
    }
});

test('shared 346-byte stage reaches gameplay and decodes every terrain cell', {skip: !original}, () => {
    const project = new Project();
    project.loadROM(original);
    project.levelCount = 1;
    project.levels[0].data = mapData;
    project.levels[0].monsterData = monsterData;
    const nes = new jsnes.NES({onFrame() {}, onAudioSample() {}, emulateSound: false});
    nes.loadROM(Buffer.from(project.getROMData()).toString('binary'));
    for (let frame = 0; frame < 160; frame++) nes.frame();
    nes.buttonDown(1, jsnes.Controller.BUTTON_START);
    nes.frame();
    nes.buttonUp(1, jsnes.Controller.BUTTON_START);
    const m = nes.cpu.mem;
    for (let frame = 0; frame < 600 && !(m[0x30] === 12 && m[0x56] === 3); frame++) nes.frame();
    assert.equal(m[0x30], 12, 'gameplay state');
    assert.equal(m[0x56], 3, 'stage initialized');
    const expected = LevelCodec.fromROMtoEditor(mapData, monsterData).map;
    for (let y = 0; y < 14; y++) for (let x = 0; x < 32; x++) {
        const packed = m[0x700 + y * 16 + (x >> 1)];
        assert.equal(x & 1 ? packed & 15 : packed >> 4, expected[y][x], `tile (${x}, ${y})`);
    }
});
