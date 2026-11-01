const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const jsnes = require('../js/lib/jsnes.min.js');
const source = fs.readFileSync(path.join(__dirname, '../js/RomFix.js'), 'utf8');
const Romfix = new Function(`${source}\nreturn Romfix;`)();

test('scene uploader and bird/fish lift coexist before the pause helper in either installation order', () => {
    const fixed = cpu => 0x1C010 + cpu - 0xC000;
    const exported = [];
    for(const liftFirst of [false, true]) {
        const data = new Uint8Array(0x20010);
        data.fill(0xA7, fixed(0xFED9), fixed(0xFF60));
        let lift, loader;
        if(liftFirst) {
            lift = Romfix.addBirdFishLift(data);
            loader = Romfix.installSceneGraphicsLoader(data);
        }else{
            loader = Romfix.installSceneGraphicsLoader(data);
            lift = Romfix.addBirdFishLift(data);
        }
        assert.ok(loader.end <= lift, 'graphics upload cannot overlap the global bird event');
        assert.equal(data[fixed(lift)], 0xBD, 'bird event entry remains intact');
        assert.ok(data.slice(fixed(0xFED9), fixed(0xFF60)).every(value => value === 0xA7),
            'both helpers preserve the neighboring pause code');
        exported.push(data);
    }
    assert.deepEqual(exported[0], exported[1], 'installation order cannot overwrite either helper');
});

function call(nes, entry) {
    const c = nes.cpu;
    c.REG_SP = 0x1FF; c.REG_PC = 0xFF; c.irqRequested = false;
    c.mem.splice(0x100, 3, 0x20, entry & 255, entry >> 8);
    for (let i = 0; i < 100000; i++) {
        c.emulate();
        if (c.REG_PC === 0x102) {
            assert.equal(c.REG_SP, 0x1FF);
            return;
        }
    }
    assert.fail('scene uploader did not return');
}

test('native scene uploader replaces every PPU byte, preserves state, and restores bank 0 before NMI', () => {
    const data = new Uint8Array(0x20010);
    data.set([0x4E, 0x45, 0x53, 0x1A, 8, 0, 0x21]);
    data.set([0, 0x80, 0, 0x80, 0, 0x80], 0x2000A);
    const patterns = new Uint8Array(0x2000);
    for (let page = 0; page < 32; page++) {
        const chunk = page % 2 ? 64 + page : page;
        data[0x18A10 + 11 * 32 + page] = chunk;
        const address = chunk < 64 ? 0x14010 + chunk * 256 : 0x18C10 + (chunk - 64) * 256;
        for (let offset = 0; offset < 256; offset++) {
            patterns[page * 256 + offset] = (page * 19 + offset * 3) & 255;
            data[address + offset] = patterns[page * 256 + offset];
        }
    }
    const { start } = Romfix.installSceneGraphicsLoader(data);
    const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, emulateSound: false });
    nes.loadROM(Buffer.from(data).toString('binary'));
    const c = nes.cpu, m = c.mem;
    m[0x2F] = 0x8B; m[0x30] = 12; m[0x31] = 63;
    c.REG_ACC = 0x53; c.REG_X = 0x26; c.REG_Y = 0xC1;
    nes.ppu.vramMem.fill(0xFF, 0, 0x2000);
    let bank = 0, uploads = 0;
    const write = nes.mmap.write.bind(nes.mmap);
    nes.mmap.write = (address, value) => {
        if (address === 0x8000) bank = value;
        if (address === 0x2007) uploads++;
        if (address === 0x2000 && (value & 0x80)) assert.equal(bank, 0);
        return write(address, value);
    };
    call(nes, start);
    assert.equal(uploads, 8192);
    assert.deepEqual(Uint8Array.from(nes.ppu.vramMem.slice(0, 0x2000)), patterns);
    assert.deepEqual([c.REG_ACC, c.REG_X, c.REG_Y, m[0x30], m[0x31]], [0x53, 0x26, 0xC1, 12, 63]);
    assert.equal(m[0x2E], 0x8B);
    assert.equal(bank, 0);
});

test('title graphics use their existing uploader and occupied scene code is rejected', () => {
    const data = new Uint8Array(0x20010);
    data.set([0x4E, 0x45, 0x53, 0x1A, 8, 0, 0x21]);
    data.set([0, 0x80, 0, 0x80, 0, 0x80], 0x2000A);
    const { start } = Romfix.installSceneGraphicsLoader(data);
    // Stand in for the original title routine, observing its input register.
    data.set([0x85, 0x10, 0xE6, 0x11, 0x60], 0x1EF90);
    const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, emulateSound: false });
    nes.loadROM(Buffer.from(data).toString('binary'));
    nes.cpu.mem[0x2F] = 0; nes.cpu.mem[0x11] = 0;
    nes.cpu.REG_ACC = 0x73;
    call(nes, start);
    assert.equal(nes.cpu.mem[0x10], 0x73);
    assert.equal(nes.cpu.mem[0x11], 1);
    const before = data.slice();
    assert.throws(() => Romfix.installSceneGraphicsLoader(data), /occupied/);
    assert.deepEqual(data, before);
});
