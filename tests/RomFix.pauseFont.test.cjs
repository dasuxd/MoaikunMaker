const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Romfix = new Function(fs.readFileSync(path.join(__dirname, '../js/RomFix.js'), 'utf8') +
    '\nreturn Romfix;')();

const pixels = (patterns, character, color) => {
    const start = Romfix.PAUSE_HINT_GLYPHS.indexOf(character) * 32;
    return Array.from({length: 16}, (_, y) => Array.from({length: 8}, (_, x) => {
        const at = start + (y >> 3) * 16 + (y & 7), bit = 0x80 >> x;
        const pixel = Number(Boolean(patterns[at] & bit)) | Number(Boolean(patterns[at + 8] & bit)) << 1;
        return pixel === color;
    }));
};

test('pause letters retain every original font byte including native shadow and transparent margins', () => {
    const source = new Uint8Array(0x10010);
    for(let letter = 0; letter < 26; letter++) {
        const at = 0x8010 + (0x16 + letter * 2) * 16;
        for(let byte = 0; byte < 32; byte++) source[at + byte] = (letter * 71 + byte * 19) & 255;
    }
    const snapshot = source.slice(), patterns = Romfix.getPauseHintPatterns(source);
    assert.equal(patterns.length, 18 * 32);
    assert.equal(new Set(Romfix.PAUSE_HINT_GLYPHS).size, 17);
    assert.ok(patterns.slice(Romfix.PAUSE_HINT_GLYPHS.length * 32).every(value => value === 0),
        'the ninth upload chunk ends with a cleared padding glyph');
    for(const character of 'PAUSED LOOK CAMERA LOOP ON OFF'.replaceAll(' ', '')) {
        const index = Romfix.PAUSE_HINT_GLYPHS.indexOf(character);
        assert.ok(index >= 0, `missing letter ${character}`);
        const at = 0x8010 + (0x16 + character.charCodeAt(0) * 2 - 130) * 16;
        assert.deepEqual(patterns.slice(index * 32, index * 32 + 32), source.slice(at, at + 32));
    }
    assert.deepEqual(source, snapshot);
});

test('pause direction graphics share one arrow design and symbols use native white and black pixels', () => {
    const patterns = Romfix.getPauseHintPatterns(new Uint8Array(0x10010));
    const left = pixels(patterns, '<', 2).slice(4, 12), up = pixels(patterns, '^', 2).slice(4, 12);
    for(let y = 0; y < 7; y++) for(let x = 0; x < 8; x++) assert.equal(up[x][6 - y], left[y][x]);
    for(const character of '<^/') {
        assert.equal(pixels(patterns, character, 1).flat().some(Boolean), false, 'palette color one remains unused');
        assert.ok(pixels(patterns, character, 2).flat().some(Boolean), 'symbol has white ink');
        assert.ok(pixels(patterns, character, 3).flat().some(Boolean), 'symbol has native-style black shadow');
    }
});

test('Up arrow matches the reference alignment and filled drop-shadow corners', () => {
    const patterns = Romfix.getPauseHintPatterns(new Uint8Array(0x10010));
    const white = pixels(patterns, '^', 2).slice(4, 12), black = pixels(patterns, '^', 3).slice(4, 12);
    const bitmap = white.map((row, y) => row.map((ink, x) => ink ? 'W' : black[y][x] ? '#' : '.').join(''));
    assert.deepEqual(bitmap, [
        '...W#...',
        '..WWW#..',
        '.WWWWW#.',
        'WWWWWWW#',
        '##WWW###',
        '..WWW#..',
        '..WWW#..',
        '..####..'
    ]);
});
