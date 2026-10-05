const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const jsnes = require('../js/lib/jsnes.min.js');
const source = ['Config', 'Level', 'RomFix', 'RomEditor', 'DataConverter']
    .map(name => fs.readFileSync(path.join(__dirname, '../js', `${name}.js`), 'utf8')).join('\n');
const { RomEditor, Config } = new Function('i18n', `${source}\nreturn {RomEditor, Config};`)({t:key=>key});
const original = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;
const realTest = (name, fn) => test(name, {skip:!original}, fn);
const fixed = cpu => cpu - 0x8000 + 16 + 6 * 0x4000;

function exportRom(name, cameraFollow = false, input = original) {
    const editor = new RomEditor();
    editor.loadROM(input);
    editor.setLevelCount(1);
    editor.setGameConfig({customLevelAuthor:name, cameraFollow});
    return editor.getROMData();
}

function ending(data) {
    const nes = new jsnes.NES({onFrame(){}, onAudioSample(){}, emulateSound:false});
    nes.loadROM(Buffer.from(data).toString('binary'));
    for (let i = 0; i < 160; i++) nes.frame();
    // Enter at the native state dispatch boundary. A frame can end inside
    // title initialization, which would overwrite RAM injected between frames.
    const emulate = nes.cpu.emulate.bind(nes.cpu);
    nes.cpu.emulate = function() {
        if (this.REG_PC === 0x8A11) {
            this.mem[0x30] = 0x0F;
            for (const address of [0x31, 0xB5, 0xBC, 0xBB, 0xBD]) this.mem[address] = 0;
            this.emulate = emulate;
        }
        return emulate();
    };
    return nes;
}

function until(nes, predicate, limit = 12000) {
    for (let i = 0; i < limit; i++) {
        if (predicate(nes.cpu.mem)) return i;
        nes.frame();
    }
    assert.fail(`Ending did not reach expected state: ${[0x30,0xB5,0xBC,0xBB,0xBD].map(a=>nes.cpu.mem[a])}`);
}

const tile = letter => letter === ' ' ? 0 : letter.charCodeAt(0) - 0x36;
function ppuLine(nes, row, text) {
    const column = Math.floor((32 - text.length) / 2);
    assert.deepEqual(nes.ppu.vramMem.slice(0x2000 + row * 32 + column,
        0x2000 + row * 32 + column + text.length), Array.from(text, tile));
}

realTest('empty and whitespace author produce the original ending without a credit hook', () => {
    const blank = exportRom('');
    for (const value of ['   ', '123中文!']) assert.deepEqual(exportRom(value), blank);
    assert.deepEqual(Array.from(blank.slice(fixed(0xC905), fixed(0xC90A))), [0xA5,0xBC,0x20,0x0D,0x83]);
    assert.ok(blank.slice(fixed(0xF800), fixed(0xFA00)).every(v=>v===0));
    const nes = ending(blank);
    until(nes, m=>m[0xB5]===4 && m[0xBC]===1);
    assert.equal(nes.cpu.mem[0xBB], 6, 'all six original staff entries precede the logo');
    until(nes, m=>m[0xB5]===5);
});

realTest('custom author page follows native staff, is readable at maximum width, then displays KONAMI', () => {
    for (const cameraFollow of [false, true]) {
        const name = 'Abcdefghijklmnopqrstuvwxyz A';
        assert.equal(name.length, Config.CUSTOM_LEVEL_AUTHOR_MAX_LENGTH);
        const data = exportRom(name, cameraFollow);
        const blank = exportRom('', cameraFollow);
        assert.equal(data.length, 0x20010);
        assert.deepEqual(data.slice(fixed(0xC5E8), fixed(0xC905)), blank.slice(fixed(0xC5E8), fixed(0xC905)),
            'native congratulations, animation and staff credits are unchanged');
        const nes = ending(data), m = nes.cpu.mem;
        until(nes, ram=>ram[0xB5]===4 && ram[0xBC]===5);
        assert.equal(m[0xBB], 6);
        // Give the NMI time to consume both text commands.
        nes.frame(); nes.frame();
        ppuLine(nes, 12, 'CUSTOM LEVEL DESIGN');
        ppuLine(nes, 16, name.toUpperCase());
        assert.equal(m[0x2F], 0, 'original ending graphics bank');
        assert.equal(m[0x2E], 0);
        const fontOffset = 0x9010 + 0x0B * 16;
        assert.deepEqual(nes.ppu.vramMem.slice(0x1000+0x0B*16, 0x1000+0x0B*16+26*16),
            Array.from(data.slice(fontOffset, fontOffset+26*16)), 'complete font really reached CHR RAM');
        assert.equal(m[0xFD], 0);
        assert.equal(m[0x9D], 0);
        assert.equal(m[0xFC], 0);
        assert.equal(m[0xFF] & 0x13, 0x10, 'page 0 and the complete background font');
        const duration = until(nes, ram=>ram[0xB5]===4 && ram[0xBC]===1);
        assert.ok(duration >= 230 && duration <= 240, `credit lasts four seconds: ${duration} frames`);
        until(nes, ram=>ram[0xB5]===4 && ram[0xBC]===2);
        nes.frame(); nes.frame();
        assert.equal(m[0x2F], 0, 'original ending graphics restored');
        assert.equal(m[0x2E], 0);
        assert.equal(m[0xFF] & 0x18, 0x08, 'native logo pattern table restored');
        assert.deepEqual(nes.ppu.vramMem.slice(0x218A,0x2196), Array.from(blank.slice(fixed(0xC9FC),fixed(0xCA08))),
            'native KONAMI logo renders after our page');
        until(nes, ram=>ram[0xB5]===5);
    }
});

realTest('re-export can change or remove an earlier credit without leaving its hook or name', () => {
    const first = exportRom('FIRST AUTHOR');
    assert.deepEqual(exportRom('SECOND AUTHOR', false, first), exportRom('SECOND AUTHOR'));
    assert.deepEqual(exportRom('', false, first), exportRom(''));
    const trimmed = exportRom('  Mixed Case  ');
    const nes = ending(trimmed);
    until(nes, m=>m[0xB5]===4 && m[0xBC]===5);
    nes.frame(); nes.frame();
    ppuLine(nes, 16, 'MIXED CASE');
});
