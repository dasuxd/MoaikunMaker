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
    let frame;
    const nes = new jsnes.NES({onFrame(pixels){frame = pixels.slice();}, onAudioSample(){}, emulateSound:false});
    nes.creditFrame = () => frame;
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

const tile = (letter, font = 0x0B) => letter === ' ' ? 0 : font + letter.charCodeAt(0) - 0x41;
function ppuLine(nes, row, text, font = 0x0B) {
    const column = Math.floor((32 - text.length) / 2);
    assert.deepEqual(nes.ppu.vramMem.slice(0x2000 + row * 32 + column,
        0x2000 + row * 32 + column + text.length), Array.from(text, letter=>tile(letter, font)));
}

realTest('empty and whitespace author produce the original ending without a credit hook', () => {
    const blank = exportRom('');
    for (const value of ['   ', '123中文!']) assert.deepEqual(exportRom(value), blank);
    assert.deepEqual(Array.from(blank.slice(fixed(0xC905), fixed(0xC90A))), [0xA5,0xBC,0x20,0x0D,0x83]);
    assert.ok(blank.slice(fixed(0xF800), fixed(0xFD00)).every(v=>v===0));
    const nes = ending(blank);
    until(nes, m=>m[0xB5]===4 && m[0xBC]===1);
    assert.equal(nes.cpu.mem[0xBB], 6, 'all six original staff entries precede the logo');
    until(nes, m=>m[0xB5]===5);
});

realTest('native bold name/tool font fits 28 letters, lasts fifteen seconds and restores graphics for KONAMI', () => {
    for (const cameraFollow of [false, true]) {
        const name = 'Abcdefghijklmnopqrstuvwxyz A';
        assert.equal(name.length, Config.CUSTOM_LEVEL_AUTHOR_MAX_LENGTH);
        const data = exportRom(name, cameraFollow);
        const blank = exportRom('', cameraFollow);
        assert.equal(data.length, 0x20010);
        assert.deepEqual(data.slice(fixed(0xC5E8), fixed(0xC905)), blank.slice(fixed(0xC5E8), fixed(0xC905)),
            'native congratulations, animation and staff credits are unchanged');
        assert.deepEqual(data.slice(0x8010, 0x10010), blank.slice(0x8010, 0x10010),
            'font customization never edits the original graphics banks');
        const nes = ending(data), m = nes.cpu.mem;
        let fontWrites = 0;
        const write = nes.mmap.write.bind(nes.mmap);
        nes.mmap.write = (address, value) => {
            const ppuAddress = nes.ppu.vramAddress & 0x3FFF;
            if (address===0x2007 && m[0xB5]===4 && ppuAddress>=0x1800 && ppuAddress<0x19A0) {
                fontWrites++;
                assert.equal(nes.ppu.f_bgVisibility, 0, 'font uploads suspend rendering');
            }
            return write(address, value);
        };
        until(nes, ram=>ram[0xB5]===4 && ram[0xBC]===5);
        assert.equal(m[0xBB], 6);
        // Give the NMI time to consume all six lines.
        nes.frame(); nes.frame();
        ppuLine(nes, 7, 'THANKS TO KONAMI');
        ppuLine(nes, 9, 'FOR CREATING MOAI KUN');
        ppuLine(nes, 14, 'CUSTOM LEVELS DESIGNED BY');
        ppuLine(nes, 16, name.toUpperCase(), 0x80);
        ppuLine(nes, 21, 'CREATED WITH');
        ppuLine(nes, 23, 'MOAI KUN MAKER', 0x80);
        // The native clear keeps rendering disabled for three NMIs. Check
        // the actual rendered frame as well as the text in nametable memory.
        until(nes, ram=>ram[0x1D]===0 && nes.ppu.f_bgVisibility===1, 10);
        nes.frame();
        const pixels = nes.creditFrame();
        for (const row of [7, 9, 14, 16, 21, 23]) {
            assert.ok(pixels.slice(row*8*256, (row*8+8)*256).some(color=>color!==pixels[0]),
                `credit row ${row} is visible on screen`);
        }
        assert.equal(m[0x2F], 0, 'original ending graphics bank');
        assert.equal(m[0x2E], 0);
        const fontOffset = 0x9010 + 0x0B * 16;
        assert.deepEqual(nes.ppu.vramMem.slice(0x1000+0x0B*16, 0x1000+0x0B*16+26*16),
            Array.from(data.slice(fontOffset, fontOffset+26*16)), 'complete font really reached CHR RAM');
        for (let letter = 0; letter < 26; letter++) {
            const glyph = nes.ppu.vramMem.slice(0x1800+letter*16, 0x1810+letter*16);
            const source = 0x8010 + (0x16+letter*2)*16;
            assert.deepEqual(glyph.slice(0,8), Array(8).fill(0), 'bold letters use white palette ink');
            const nativeRows = Array.from({length:8}, (_, y) => {
                const nativeY = y+4, offset=source+(nativeY>>3)*16+(nativeY&7);
                return data[offset+8] & ~data[offset];
            });
            assert.deepEqual(glyph.slice(8), nativeRows,
                `letter ${String.fromCharCode(65+letter)} preserves the native staff-name glyph`);
        }
        assert.equal(fontWrites, 26*16, 'all highlighted glyphs were uploaded');
        assert.equal(m[0xFD], 0);
        assert.equal(m[0x9D], 0);
        assert.equal(m[0xFC], 0);
        assert.equal(m[0xFF] & 0x13, 0x10, 'page 0 and the complete background font');
        const duration = until(nes, ram=>ram[0xB5]===4 && ram[0xBC]===1);
        assert.ok(duration >= 890 && duration <= 900, `credit lasts fifteen seconds: ${duration} frames`);
        until(nes, ram=>ram[0xB5]===4 && ram[0xBC]===2);
        nes.frame(); nes.frame();
        assert.equal(m[0x2F], 0, 'original ending graphics restored');
        assert.equal(m[0x2E], 0);
        assert.equal(m[0xFF] & 0x18, 0x08, 'native logo pattern table restored');
        assert.deepEqual(nes.ppu.vramMem.slice(0x1800,0x19A0), Array.from(data.slice(0x9810,0x99B0)),
            'temporary name font is restored before the native ending');
        assert.equal(fontWrites, 2*26*16, 'exactly one install and one restoration');
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
    ppuLine(nes, 16, 'MIXED CASE', 0x80);
});
