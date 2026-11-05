const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const jsnes = require('../../js/lib/jsnes.min.js');
const { Camera, LevelCodec, Pause, Project, ViewModes } = require('../helpers/source.cjs').load('Camera LevelCodec Pause Project ViewModes');


function machine(data) {
    const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, emulateSound: false });
    nes.loadROM(Buffer.from(data).toString('binary'));
    return nes;
}

function synthetic(enabled = true) {
    const data = new Uint8Array(0x20010);
    data.set([0x4E, 0x45, 0x53, 0x1A, 8, 0, 0x21]);
    data.set([0, 0x80, 0, 0x80, 0, 0x80], 0x2000A);
    Camera.fixWideScreenLoopingCamera(data);
    const view = enabled ? ViewModes.addViewModes(data) : null;
    const entries = Pause.addPauseControls(data, view);
    // The pause renderer switches banks, so these native stand-ins must live
    // in the ROM as well as the initially mapped CPU memory.
    data.set([0xE6, 0x05, 0x60], 0x8B54 - 0x8000 + 16);
    data.set([0xE6, 0x06, 0x60], 0x88D3 - 0x8000 + 16);
    const nes = machine(data), m = nes.cpu.mem;
    m.fill(0, 0, 0x800);
    m[0x56] = 3; m[0x6E] = 1; m[0xFE] = 0x1E;
    return { nes, m, ...entries };
}

function call(game, entry) {
    const c = game.nes.cpu, m = c.mem;
    c.REG_SP = 0x1FF; c.REG_PC = 0x7FFF; c.irqRequested = false;
    m.splice(0x8000, 3, 0x20, entry & 255, entry >> 8);
    for(let i = 0; i < 4000; i++) {
        c.emulate();
        if(c.REG_PC === 0x8002) { assert.equal(c.REG_SP, 0x1FF); return; }
    }
    assert.fail(`pause routine $${entry.toString(16)} did not return`);
}
const {openSettings, backToMap, toggleCamera} = require('../helpers/pause-settings.cjs');
const camera = m => m[0xFD] | m[0x9D] << 8;
const entityData = m => [...m.slice(0x400, 0x5C6), ...m.slice(0xC0, 0xE0)];
const visible = m => Array.from({length: 64}, (_, i) => i * 4).filter(i => m[0x200 + i] < 240);
const patternReady = 0x09, patternRestored = 0x89;
const hintTiles = new Set([...Pause.PAUSE_HINT_GLYPHS].map((_, index) => Pause.PAUSE_HINT_SPRITE_START + index * 2));
const hints = m => visible(m).filter(offset => hintTiles.has(m[0x201 + offset]));
const hintText = m => hints(m).map(offset => Pause.PAUSE_HINT_GLYPHS[(m[0x201 + offset] - Pause.PAUSE_HINT_SPRITE_START) / 2]).join('');
const playerSprites = m => visible(m).filter(offset => !hintTiles.has(m[0x201 + offset]))
    .map(offset => m.slice(0x200 + offset, 0x204 + offset));

function playerReference(m) {
    const projected = ((m[0xC2] | m[0xC1] << 8) - camera(m)) & (m[0x3D] ? 511 : 255);
    return playerSprites(m).map(([y, tile, attributes, x]) => ({y, tile, attributes, dx: (x - projected) & 255}));
}

function assertPlayerProjection(m, reference) {
    const projected = ((m[0xC2] | m[0xC1] << 8) - camera(m)) & (m[0x3D] ? 511 : 255);
    if(projected >= 256 || m[0x400] === 0 || m[0x7D]) {
        assert.deepEqual(playerSprites(m), [], 'a player outside this viewport or natively hidden stays hidden');
    } else if(projected >= 16 && projected <= 224) {
        assert.deepEqual(playerSprites(m), reference.map(({y, tile, attributes, dx}) =>
            [y, tile, attributes, (projected + dx) & 255]),
        'the retained player uses frozen native art projected against the paused camera');
    }
}

function assertHint(m) {
    for(const offset of hints(m)) {
        assert.ok(hintTiles.has(m[0x201 + offset]), 'hints use temporary enemy sprite tiles');
        assert.equal(m[0x201 + offset] & 1, 0, 'hints select the enemy sprite pattern table');
    }
}

test('PAUSED blinks in the center while the top-right menu stays available and entities freeze', () => {
    for(const enabled of [false, true]) for(const wide of [0, 1]) {
        const game = synthetic(enabled), { m } = game;
        m[0x3D] = wide;
        for(let i = 0x400; i < 0x5C6; i++) m[i] = (i * 13) & 255;
        const before = entityData(m);
        m[0x32] = 1;
        call(game, game.entry);
        call(game, game.oam);
        assert.equal(hints(m).length, 0, 'unfinished pattern uploads keep hint sprites hidden');
        m[0x2C] = patternReady; // Synthetic calls do not consume the native PPU queue.
        call(game, game.oam);
        assert.equal(m[0x2B], 1);
        assert.deepEqual(entityData(m), before, 'metasprites and world state are preserved');
        assertHint(m);
        for (let frame = 0; frame < 64; frame++) {
            m[0x1B] = frame;
            call(game, game.oam);
            assert.equal(hintText(m), (frame < 32 ? 'PAUSED' + (wide ? '<<' : '') : '') + '^MENU');
        }
        assert.deepEqual(entityData(m), before);
        assert.equal(m[0x05], 0, 'paused frames never enter the active simulation');
    }
});

test('edge arrows mirror and the menu stays within the top-right safe area', () => {
    const game = synthetic(), {m} = game;
    m[0x3D] = 1; m[0x32] = 1;
    call(game, game.entry); m[0x2C] = patternReady; call(game, game.oam);
    const arrows = hints(m).filter(offset => m[0x201 + offset] === Pause.PAUSE_HINT_SPRITE_START + Pause.PAUSE_HINT_GLYPHS.indexOf('<') * 2);
    assert.equal(arrows.length, 2, 'left and right use one directional glyph');
    assert.equal(m[0x202 + arrows[0]] ^ m[0x202 + arrows[1]], 0x40,
        'right reverses the left sprite with the hardware flip');
    assert.deepEqual(arrows.map(offset => [m[0x200 + offset], m[0x203 + offset]]), [[112, 8], [112, 240]],
        'left and right controls appear at opposite screen edges');
    assert.equal(hintText(m), 'PAUSED<<^MENU');
    const menu = hints(m).filter(offset => m[0x200 + offset] === 15);
    assert.deepEqual(menu.map(offset => m[0x203 + offset]), [192, 204, 212, 220, 228]);
    assert.equal(hints(m).filter(offset => m[0x200 + offset] === 111).length, 6);
    for(let scanline = 0; scanline < 240; scanline++) {
        assert.ok(hints(m).filter(offset => scanline > m[0x200 + offset] && scanline <= m[0x200 + offset] + 16).length <= 8,
            `scanline ${scanline} respects the eight-sprite hardware limit`);
    }
});

test('restored enemy graphics stay hidden while the paused camera is still returning', () => {
    const game = synthetic(), {m} = game;
    m[0x32] = 1; call(game, game.entry);
    m[0x2B] = 2; m[0x2C] = patternRestored; m[0x2A] = 0x81;
    m[0x1B] = 0; m[0xFD] = 96; m[0xC2] = 60;
    const before = entityData(m);
    call(game, game.oam);
    assert.equal(hints(m).length, 0, 'enemy patterns cannot reappear as hint letters after restoration');
    assert.deepEqual(entityData(m), before, 'hiding the restored patterns preserves every live entity byte');
    assert.equal(m[0x32], 1, 'graphics completion alone does not end the camera return');
});

test('looking dismisses side arrows and keeps the settings entry available', () => {
    for(const enabled of [false, true]) for(const wide of [0, 1]) for(const view of [0, 1]) {
        const game = synthetic(enabled), {m} = game;
        m[0x3D] = wide; m[0x2A] = enabled ? view : 0; m[0x32] = 1;
        call(game, game.entry); m[0x2C] = patternReady;
        m[0xF6] = 3; call(game, game.entry); call(game, game.oam);
        assert.equal(m[0x2A] & 0x40, 0, 'opposite directions together are not a camera look');
        m[0xF6] = 1; call(game, game.entry); call(game, game.oam);
        const canLook = Boolean(wide || (enabled && view));
        assert.equal(Boolean(m[0x2A] & 0x40), canLook);
        for(const frame of [0, 31, 32, 63, 64, 128]) {
            m[0xF6] = 0; m[0x1B] = frame; call(game, game.entry); call(game, game.oam);
            if(canLook) assert.equal(hintText(m), (frame & 32 ? '' : 'PAUSED') + '^MENU');
        }
        m[0x2C] = patternRestored; m[0x32] = 0;
        call(game, game.entry); m[0x2C] = patternRestored;
        for(let i = 0; i < 140 && (m[0x32] || m[0x2B]); i++) call(game, game.entry);
        assert.equal(m[0x32], 0);
        m[0x32] = 1; m[0x1B] = 0; call(game, game.entry);
        m[0x2C] = patternReady; call(game, game.oam);
        assert.equal(m[0x2A] & 0x40, 0, 'a new pause clears dismissal');
        assert.ok(hints(m).length > 0, 'a new pause presents the hints again');
    }
});

test('Up opens settings only while paused and a resume restores OAM after the frozen camera return', () => {
    const game = synthetic(), { m } = game;
    m[0xC2] = 60; m[0xF4] = 8;
    call(game, game.entry);
    assert.equal(m[0x2A], 0, 'active Up does not change views');
    m[0x32] = 1; m[0xF4] = 0;
    call(game, game.entry);
    m[0xF4] = 8; call(game, game.entry);
    assert.equal(m[0x2B], 3, 'Up requests the settings page');
    assert.equal(m[0x2A], 0);
    m[0x2B] = 1; m[0x2A] = 1; // back on the map with centered camera selected
    m[0xF4] = 0; m[0xF6] = 8;
    for(let i = 0; i < 20; i++) call(game, game.entry);
    assert.equal(m[0x2A], 1, 'held Up cannot repeatedly toggle');
    m[0xF6] = 1;
    for(let i = 0; i < 6; i++) call(game, game.entry);
    assert.equal(camera(m), 24);
    const before = entityData(m), ticks = m[0x05];
    m[0x32] = 0;
    let previous = camera(m), returnFrames = 0;
    for(let i = 0; i < 140; i++) {
        call(game, game.entry);
        if(m[0x2B] === 2) m[0x2C] = patternRestored;
        const delta = ((camera(m) - previous + 128) & 255) - 128;
        assert.ok(Math.abs(delta) <= 4, 'camera return moves at most four pixels per frame');
        previous = camera(m);
        if(!m[0x32]) break;
        returnFrames++;
        assert.equal(m[0x05], ticks, 'simulation remains frozen through camera arrival');
        assert.deepEqual(entityData(m), before);
    }
    assert.ok(returnFrames > 5);
    assert.equal(camera(m), 188);
    assert.equal(m[0x32], 0); assert.equal(m[0x2B], 0);
    assert.equal(m[0xFE] & 16, 0, 'first native rebuild stays hidden');
    call(game, game.oam);
    assert.equal(m[0x06], 1, 'complete native OAM reconstruction resumes');
    call(game, game.entry);
    assert.equal(m[0xFE] & 16, 16, 'sprites appear after the native reconstruction');
});

test('feature-off wide pause returns to its exact original camera, including page one', () => {
    for(const origin of [0, 255, 300, 511]) {
        const game = synthetic(false), { m } = game;
        m[0x3D] = 1; m[0xFD] = origin & 255; m[0x9D] = origin >> 8;
        m[0x32] = 1; m[0xF4] = 0; m[0xF6] = 1;
        for(let i = 0; i < 13; i++) call(game, game.entry);
        m[0x2C] = patternRestored;
        assert.equal(m[0x2A] & 1, 0, 'disabled view switching ignores Up');
        m[0x32] = 0;
        call(game, game.entry); m[0x2C] = patternRestored;
        for(let i = 0; i < 140 && (m[0x32] || m[0x2B]); i++) call(game, game.entry);
        assert.equal(camera(m), origin);
        assert.equal(m[0x32], 0);
    }
});

const supplied = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;
const realTest = (name, body) => test(name, {skip: !supplied}, body);
function stage(enabled, wide) {
    const editor = new Project(); editor.loadROM(supplied);
    editor.gameConfig.cameraFollow = enabled; editor.gameConfig.disableTimer = false;
    const map = Array.from({length: 14}, () => Array(wide ? 32 : 16).fill(0));
    map[12].fill(5); map[1][3] = 15;
    const data = LevelCodec.fromLevelEditorToROMData({
        background: wide ? 0x10 : 0, map, player: {x: 8, y: 11}, door: {x: 14, y: 10},
        enemies: [{enemyId: 1, x: 3, y: 11}, {enemyId: 12, x: 10, y: 7}]
    }, wide);
    editor.levels[0].data = data.mapData; editor.levels[0].monsterData = data.monsterData;
    editor.levelCount = 1;
    return editor.getROMData();
}
function start(data) {
    const nes = machine(data);
    for(let i = 0; i < 160; i++) nes.frame();
    // These pause transitions exercise switching from the normal view.
    nes.cpu.mem[0x2A] = 0;
    nes.buttonDown(1, jsnes.Controller.BUTTON_START); nes.frame();
    nes.buttonUp(1, jsnes.Controller.BUTTON_START);
    for(let i = 0; i < 600; i++) {
        nes.frame();
        if(nes.cpu.mem[0x30] === 12 && nes.cpu.mem[0x56] === 3 && !(nes.cpu.mem[0x2A] & 128)) return nes;
    }
    assert.fail('native START did not reach gameplay');
}
function press(nes, button) { nes.buttonDown(1, button); nes.frame(); nes.buttonUp(1, button); nes.frame(); }

realTest('real pause retains the player, hides sprite enemies, freezes their data, and resumes after camera arrival', () => {
    for(const enabled of [false, true]) for(const wide of [false, true]) {
        const nes = start(stage(enabled, wide)), m = nes.cpu.mem;
        for(let i = 0; i < 30; i++) nes.frame();
        for(let i = 0; i < 160 && (!m[0x400] || m[0x7D]); i++) nes.frame();
        assert.ok(m[0x400] && !m[0x7D], 'pause fixture waits for a natively visible player');
        press(nes, jsnes.Controller.BUTTON_START);
        assert.equal(m[0x32], 1); assert.equal(m[0x2B], 1);
        assert.equal(playerSprites(m).length, 2,
            `the idle player remains visible while sprite enemies are hidden: ${JSON.stringify({enabled, wide, id: m[0x400], hidden: m[0x7D], world: m[0xC2] | m[0xC1] << 8, camera: camera(m), oam: m.slice(0x200, 0x220)})}`);
        assert.deepEqual(playerSprites(m).map(sprite => sprite[1]), [4, 6], 'only native standing-player art remains');
        const retainedPlayer = playerReference(m);
        const before = entityData(m), origin = camera(m), phases = new Set();
        for(let i = 0; i < 90; i++) {
            nes.frame();
            assert.deepEqual(entityData(m), before, 'native paused frames preserve every entity byte');
            assertPlayerProjection(m, retainedPlayer);
            if(m[0x2C] === patternReady) {
                const blinking = hintText(m).includes('PAUSED');
                phases.add(blinking);
                assert.equal(hintText(m), (blinking ? 'PAUSED' + (wide ? '<<' : '') : '') + '^MENU');
            }
            assertHint(m);
        }
        assert.ok(phases.has(false), 'the icons are hidden during their off phase');
        assert.ok(phases.has(true), 'the title appears in the other blink phase');
        nes.buttonDown(1, jsnes.Controller.BUTTON_RIGHT);
        for(let i = 0; i < 40; i++) {
            nes.frame();
            assert.deepEqual(entityData(m), before, 'native paused frames preserve every entity byte');
            assertPlayerProjection(m, retainedPlayer);
            assertHint(m);
            if(wide) assert.match(hintText(m), /^(PAUSED)?\^MENU$/, 'only the side arrows disappear when looking');
        }
        nes.buttonUp(1, jsnes.Controller.BUTTON_RIGHT);
        assert.equal(camera(m) !== origin, wide);
        toggleCamera(nes);
        assert.equal(m[0x2A] & 1, Number(enabled));
        assert.deepEqual(entityData(m), before);
        assertPlayerProjection(m, retainedPlayer);
        press(nes, jsnes.Controller.BUTTON_START);
        let returnFrames = 0;
        for(let i = 0; i < 150 && m[0x32]; i++) {
            assert.deepEqual(entityData(m), before);
            nes.frame(); returnFrames++;
        }
        if(wide || enabled) assert.ok(returnFrames > 0);
        assert.equal(m[0x32], 0); assert.equal(m[0x2B], 0);
        for(let i = 0; i < 4; i++) nes.frame();
        assert.equal(m[0xFE] & 16, 16);
        assert.ok(visible(m).length > 0, 'native player/enemy OAM is reconstructed');
        assert.equal(m[0x4FE + m.slice(0x4FE, 0x506).indexOf(12)], 12, 'the bird survives pausing');
    }
});

realTest('pausing during the native spawn blink preserves the hidden player pose', () => {
    const nes = start(stage(false, false)), m = nes.cpu.mem;
    for(let i = 0; i < 80 && m[0x400] !== 0; i++) nes.frame();
    assert.equal(m[0x400], 0, 'the fixture pauses on a native hidden blink frame');
    press(nes, jsnes.Controller.BUTTON_START);
    const before = entityData(m);
    for(let i = 0; i < 80; i++) {
        nes.frame();
        assert.deepEqual(entityData(m), before);
        assert.equal(playerSprites(m).length, 0,
            'pause keeps the native hidden pose instead of inventing a standing player');
    }
});

realTest('background settings hold gameplay, switch colors once per press, and restore the paused map', () => {
    for (const wide of [false, true]) for (const enabled of [false, true]) {
        const nes = start(stage(enabled, wide)), m = nes.cpu.mem;
        for (let i = 0; i < 30; i++) nes.frame();
        press(nes, jsnes.Controller.BUTTON_START);
        assert.equal(m[0x32], 1);
        for (let i = 0; i < 30; i++) nes.frame();
        const vram = () => Buffer.from(nes.ppu.vramMem.slice(0, 0x4000));
        const before = vram(), frozen = entityData(m), scroll = camera(m);
        openSettings(nes);
        assert.equal(m[0xFE] & 0x18, 8, 'settings render entirely on the background');
        const status = () => nes.ppu.vramMem.slice(0x21D6, 0x21D9);
        const off = status();
        nes.buttonDown(1, jsnes.Controller.BUTTON_A);
        for (let i = 0; i < 20; i++) nes.frame();
        nes.buttonUp(1, jsnes.Controller.BUTTON_A); nes.frame();
        assert.equal(m[0x2A] & 1, Number(enabled));
        assert.deepEqual(entityData(m), frozen);
        if (enabled) {
            assert.notDeepEqual(status(), off);
            const readInk = t => {
                const chr = nes.ppu.vramMem.slice(t * 16, t * 16 + 16);
                const lo = chr.slice(0, 8).some(Boolean), hi = chr.slice(8).some(Boolean);
                return nes.ppu.vramMem[0x3F00 + Number(lo) + 2 * Number(hi)];
            };
            assert.equal(readInk(off[0]), 0x16, 'OFF uses red');
            assert.equal(readInk(status()[0]), 0x21, 'ON uses blue');
        }
        press(nes, jsnes.Controller.BUTTON_START);
        assert.equal(m[0x32], 1);
        backToMap(nes);
        assert.deepEqual(vram(), before);
        assert.deepEqual(entityData(m), frozen);
        assert.equal(camera(m), scroll);
    }
});
