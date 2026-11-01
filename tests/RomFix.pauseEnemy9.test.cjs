const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const jsnes = require('../js/lib/jsnes.min.js');

const source = ['Config', 'Level', 'RomFix', 'RomEditor', 'DataConverter']
    .map(name => fs.readFileSync(path.join(__dirname, '../js', `${name}.js`), 'utf8')).join('\n');
const { Romfix, RomEditor, DataConverter } = new Function('i18n',
    `${source}\nreturn { Romfix, RomEditor, DataConverter };`)({ t: key => key });
const original = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;
const realTest = (name, body) => test(name, { skip: !original }, body);
const camera = m => m[0xFD] | m[0x9D] << 8;
const patterns = nes => nes.ppu.vramMem.slice(0, 0x2000);
const enemy9Patterns = nes => nes.ppu.vramMem.slice(0x16C0, 0x1960);
const hintTiles = new Set([...Romfix.PAUSE_HINT_GLYPHS].map((_, index) => Romfix.PAUSE_HINT_SPRITE_START + index * 2));
const entities = m => [...m.slice(0x400, 0x5C6), ...m.slice(0xC0, 0xE0), ...m.slice(0x70, 0x76)];
const visible = m => Array.from({ length: 64 }, (_, index) => index * 4)
    .filter(offset => m[0x200 + offset] < 240);
const hints = m => visible(m).filter(offset => hintTiles.has(m[0x201 + offset]));
const hintText = m => hints(m).map(offset => Romfix.PAUSE_HINT_GLYPHS[(m[0x201 + offset] - Romfix.PAUSE_HINT_SPRITE_START) / 2]).join('');

function assertUnborrowedGraphics(nes, originalPatterns) {
    assert.deepEqual(nes.ppu.vramMem.slice(0, 0x600), originalPatterns.slice(0, 0x600),
        'player and other graphics below the borrowed enemy font remain identical');
    assert.deepEqual(nes.ppu.vramMem.slice(0x840, 0x2000), originalPatterns.slice(0x840),
        'all background graphics, including Enemy 9, remain identical throughout pause');
}

function stage(enabled, wide, scene, playerX = 8) {
    const editor = new RomEditor(); editor.loadROM(original);
    editor.gameConfig.cameraFollow = enabled;
    editor.gameConfig.disableTimer = false;
    const map = Array.from({ length: 14 }, () => Array(wide ? 32 : 16).fill(0));
    map[12].fill(5); map[1][3] = 15;
    const converted = DataConverter.fromLevelEditorToROMData({
        background: scene | (wide ? 0x10 : 0), map,
        player: { x: playerX, y: 11 }, door: { x: 14, y: 10 },
        enemies: [{ enemyId: 9, x: 5, y: 5 }, { enemyId: 12, x: 11, y: 7 }]
    }, wide);
    editor.levels[0].data = converted.mapData;
    editor.levels[0].monsterData = converted.monsterData;
    editor.levelCount = 1;
    return editor.getROMData();
}

function start(data) {
    const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, emulateSound: false });
    nes.loadROM(Buffer.from(data).toString('binary'));
    for (let i = 0; i < 160; i++) nes.frame();
    nes.buttonDown(1, jsnes.Controller.BUTTON_START); nes.frame();
    nes.buttonUp(1, jsnes.Controller.BUTTON_START);
    for (let i = 0; i < 600; i++) {
        nes.frame();
        const m = nes.cpu.mem;
        if (m[0x30] === 12 && m[0x56] === 3 && !(m[0x2A] & 128)) {
            for (let settle = 0; settle < 30; settle++) nes.frame();
            assert.ok(m.slice(0x4FE, 0x506).includes(9), 'the native background enemy is initialized');
            return nes;
        }
    }
    assert.fail('START did not reach gameplay');
}

function press(nes, button) {
    nes.buttonDown(1, button); nes.frame();
    nes.buttonUp(1, button); nes.frame();
}

function watchPpu(nes) {
    const writes = [], write = nes.mmap.write.bind(nes.mmap);
    nes.mmap.write = (address, value) => {
        if (address === 0x2007) {
            assert.ok(nes.ppu.scanline < 20,
                `pattern upload exceeds vblank: line=${nes.ppu.scanline}, pc=${(nes.cpu.REG_PC + 1).toString(16)}`);
            writes.push(value);
        }
        return write(address, value);
    };
    return writes;
}

function assertHint(nes) {
    const m = nes.cpu.mem;
    for (const offset of visible(m)) {
        const tile = nes.cpu.mem[0x201 + offset];
        assert.ok((hintTiles.has(tile) && !(tile & 1)) || tile === 4 || tile === 6,
            'paused OAM contains only the retained native player and temporary hint sprites');
    }
    const projected = ((m[0xC2] | m[0xC1] << 8) - camera(m)) & (m[0x3D] ? 511 : 255);
    const count = visible(m).filter(offset => !hintTiles.has(m[0x201 + offset])).length;
    if(projected >= 16 && projected <= 224 && m[0x400] && !m[0x7D])
        assert.equal(count, 2, 'the frozen player is retained in the paused viewport');
}

function resume(nes, data, beforePatterns, beforeEntities, expectedView, expectedCamera, spamStart = false) {
    const m = nes.cpu.mem, originalBank = Array.from(data.slice(0x10, 0x20));
    const beforeMap = nes.ppu.vramMem.slice(0x2000, 0x3000);
    const beforePalette = nes.ppu.vramMem.slice(0x3F00, 0x3F20);
    let restorationFrames = 0, resumed = false;
    nes.buttonDown(1, jsnes.Controller.BUTTON_START);
    nes.buttonDown(1, jsnes.Controller.BUTTON_UP);
    nes.buttonDown(1, jsnes.Controller.BUTTON_RIGHT);
    for (let i = 0; i < 160; i++) {
        if (i === 1) nes.buttonUp(1, jsnes.Controller.BUTTON_START);
        if (spamStart && i === 3) nes.buttonDown(1, jsnes.Controller.BUTTON_START);
        if (i === 4) {
            nes.buttonUp(1, jsnes.Controller.BUTTON_START);
            nes.buttonUp(1, jsnes.Controller.BUTTON_UP);
            nes.buttonUp(1, jsnes.Controller.BUTTON_RIGHT);
        }
        nes.frame();
        assert.deepEqual(m.slice(0x8000, 0x8010), originalBank, 'pattern copies restore executable bank zero');
        assert.equal(m[0x2A] & 1, expectedView, 'directions cannot change the selected view during return');
        if (!m[0x32]) {
            assert.deepEqual(patterns(nes), beforePatterns, 'every original pattern is restored before pause ends');
            assert.equal(camera(m), expectedCamera, 'the selected camera is reached before pause ends');
            resumed = true;
            break;
        }
        restorationFrames++;
        assert.deepEqual(entities(m), beforeEntities, 'restoration and camera return keep all entities frozen');
        assertUnborrowedGraphics(nes, beforePatterns);
        assert.deepEqual(nes.ppu.vramMem.slice(0x2000, 0x3000), beforeMap,
            'restoration leaves every nametable cell unchanged');
        assert.deepEqual(nes.ppu.vramMem.slice(0x3F00, 0x3F20), beforePalette,
            'restoration leaves every palette unchanged');
        assert.equal(hints(m).length, 0, 'operation glyphs stay hidden throughout graphics restoration and camera return');
        assertHint(nes);
    }
    nes.buttonUp(1, jsnes.Controller.BUTTON_START);
    nes.buttonUp(1, jsnes.Controller.BUTTON_UP);
    nes.buttonUp(1, jsnes.Controller.BUTTON_RIGHT);
    assert.ok(resumed, 'restoration resumes gameplay without another START press');
    assert.ok(restorationFrames >= 8, 'pause includes the complete nine-packet sprite font restoration');
    for (let i = 0; i < 3; i++) nes.frame();
    assert.equal(m[0x2B], 0);
    assert.equal(m[0xFE] & 16, 16, 'the rebuilt gameplay sprites become visible');
    assert.ok(visible(m).length > 0, 'native sprites replace the hint');
    assert.deepEqual(patterns(nes), beforePatterns);
}

for (const enabled of [false, true]) for (const wide of [false, true]) for (const scene of [0, 8]) {
    realTest(`pause retains background enemies while borrowing and restoring sprite fonts: views=${enabled}, wide=${wide}, scene=${scene}`, () => {
        const data = stage(enabled, wide, scene), nes = start(data), m = nes.cpu.mem;
        const originalPatterns = patterns(nes);
        assert.ok(enemy9Patterns(nes).some(Boolean), 'the dedicated enemy graphics contain visible pixels');
        const writes = watchPpu(nes);
        press(nes, jsnes.Controller.BUTTON_START);
        assert.equal(m[0x32], 1);
        const beforeEntities = entities(m), beforeMap = nes.ppu.vramMem.slice(0x2000, 0x3000);
        const beforePalette = nes.ppu.vramMem.slice(0x3F00, 0x3F20), origin = camera(m);
        const blink = new Set();
        for (let i = 0; i < 90; i++) {
            nes.frame();
            assert.deepEqual(entities(m), beforeEntities);
            assertUnborrowedGraphics(nes, originalPatterns);
            assert.deepEqual(nes.ppu.vramMem.slice(0x2000, 0x3000), beforeMap, 'font installation never edits nametable cells');
            assert.deepEqual(nes.ppu.vramMem.slice(0x3F00, 0x3F20), beforePalette, 'font installation preserves every palette');
            assertHint(nes);
            if (m[0x2C] === 0x09 && i >= 12) {
                blink.add(/[<^]/.test(hintText(m)));
                assert.equal(hintText(m).replace(/[<^]/g, ''), 'PAUSED' + (enabled ? 'LOOPOFF' : ''),
                    'PAUSED and LOOP text remain steady during icon blinking');
                assert.deepEqual(enemy9Patterns(nes), originalPatterns.slice(0x16C0, 0x1960),
                    'all 42 background-enemy tiles stay visible and unchanged');
                const font = Romfix.getPauseHintPatterns(original);
                assert.deepEqual(nes.ppu.vramMem.slice(0x600, 0x600 + font.length),
                    Array.from(font), 'font upload preserves every native font byte');
            }
        }
        assert.ok(blink.has(false), 'direction icons have an off phase while the background enemies remain visible');
        if(wide || enabled) assert.ok(blink.has(true), 'direction icons also have an on phase');
        nes.buttonDown(1, jsnes.Controller.BUTTON_RIGHT);
        for (let i = 0; i < 70; i++) {
            nes.frame();
            assert.deepEqual(entities(m), beforeEntities);
            assertUnborrowedGraphics(nes, originalPatterns);
            assertHint(nes);
            if (wide) assert.equal(hintText(m), 'PAUSED',
                'viewing the level dismisses operation hints while PAUSED stays visible');
        }
        nes.buttonUp(1, jsnes.Controller.BUTTON_RIGHT);
        press(nes, jsnes.Controller.BUTTON_UP);
        const selected = Number(enabled), world = m[0xC2] | m[0xC1] << 8;
        const target = enabled ? (world - 128) & (wide ? 511 : 255) : origin;
        resume(nes, data, originalPatterns, beforeEntities, selected, target, true);
        assert.ok(writes.length >= 0x240 * 2,
            'font installation and restoration both upload all nine sprite packets');
    });
}

for (const enabled of [false, true]) for (const wide of [false, true]) {
    realTest(`immediate resume safely reverses a partial sprite-font upload: views=${enabled}, wide=${wide}`, () => {
        const data = stage(enabled, wide, 0), nes = start(data), m = nes.cpu.mem;
        const originalPatterns = patterns(nes), origin = camera(m);
        watchPpu(nes);
        press(nes, jsnes.Controller.BUTTON_START);
        assert.ok(m[0x2C] > 0 && m[0x2C] < 0x09, 'resume is requested before sprite-font installation finishes');
        assertUnborrowedGraphics(nes, originalPatterns);
        resume(nes, data, originalPatterns, entities(m), 0, origin, true);
    });
}

realTest('an undiscarded hint stays hidden after graphics restoration during a long view-change return', () => {
    const data = stage(true, false, 0, 14), nes = start(data), m = nes.cpu.mem;
    const originalPatterns = patterns(nes);
    watchPpu(nes);
    press(nes, jsnes.Controller.BUTTON_START);
    for(let i = 0; i < 32; i++) nes.frame();
    const beforeEntities = entities(m), origin = camera(m);
    press(nes, jsnes.Controller.BUTTON_UP);
    for(let i = 0; i < 64 && (m[0x1B] & 63); i++) nes.frame();
    assert.equal(m[0x1B] & 63, 0, 'restoration and camera return begin in the visible blink phase');
    assert.equal(m[0x2A] & 0x41, 1, 'view switching leaves the unacknowledged hint eligible');
    const world = m[0xC2] | m[0xC1] << 8, target = (world - 128) & 255;
    assert.ok(((target - origin + 128) & 255) - 128 > 80,
        'the camera return lasts longer than all nine graphics restoration packets');
    let sawRestoredDuringReturn = false, resumed = false;
    nes.buttonDown(1, jsnes.Controller.BUTTON_START);
    for(let i = 0; i < 160; i++) {
        nes.frame();
        if(i === 0) nes.buttonUp(1, jsnes.Controller.BUTTON_START);
        if(!m[0x32]) {
            assert.equal(camera(m), target);
            assert.deepEqual(patterns(nes), originalPatterns);
            resumed = true;
            break;
        }
        assert.deepEqual(entities(m), beforeEntities);
        assertUnborrowedGraphics(nes, originalPatterns);
        assert.equal(hints(m).length, 0, 'returning camera never draws restored enemy art as prompt glyphs');
        if(m[0x2C] === 0x89 && camera(m) !== target && i >= 12) {
            assert.deepEqual(patterns(nes), originalPatterns, 'the complete restored graphics stay hidden');
            sawRestoredDuringReturn = true;
        }
    }
    assert.ok(sawRestoredDuringReturn, 'the hidden OAM is checked after restoration and before camera arrival');
    assert.ok(resumed);
});
