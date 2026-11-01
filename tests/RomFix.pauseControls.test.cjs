const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const jsnes = require('../js/lib/jsnes.min.js');
const source = ['Config', 'Level', 'RomFix', 'RomEditor', 'DataConverter']
    .map(name => fs.readFileSync(path.join(__dirname, '../js', `${name}.js`), 'utf8')).join('\n');
const { Romfix, RomEditor, DataConverter } = new Function('i18n',
    `${source}\nreturn { Romfix, RomEditor, DataConverter };`)({ t: key => key });

function machine(data) {
    const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, emulateSound: false });
    nes.loadROM(Buffer.from(data).toString('binary'));
    return nes;
}

function synthetic(enabled = true) {
    const data = new Uint8Array(0x20010);
    data.set([0x4E, 0x45, 0x53, 0x1A, 8, 0, 0x21]);
    data.set([0, 0x80, 0, 0x80, 0, 0x80], 0x2000A);
    Romfix.fixWideScreenLoopingCamera(data, true);
    const view = enabled ? Romfix.addViewModes(data, true) : null;
    const entries = Romfix.addPauseControls(data, true, view);
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
const camera = m => m[0xFD] | m[0x9D] << 8;
const entityData = m => [...m.slice(0x400, 0x5C6), ...m.slice(0xC0, 0xE0)];
const visible = m => Array.from({length: 64}, (_, i) => i * 4).filter(i => m[0x200 + i] < 240);
const patternReady = 0x09, patternRestored = 0x89;
const hintTiles = new Set([...Romfix.PAUSE_HINT_GLYPHS].map((_, index) => Romfix.PAUSE_HINT_SPRITE_START + index * 2));
const hints = m => visible(m).filter(offset => hintTiles.has(m[0x201 + offset]));
const hintText = m => hints(m).map(offset => Romfix.PAUSE_HINT_GLYPHS[(m[0x201 + offset] - Romfix.PAUSE_HINT_SPRITE_START) / 2]).join('');
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

test('only direction icons blink while PAUSED and LOOP text stay steady and every entity stays frozen', () => {
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
        const icons = (wide ? 2 : 0) + (enabled ? 1 : 0);
        const steady = 6 + (enabled ? 7 : 0);
        assert.equal(hints(m).length, steady + icons);
        assertHint(m);
        for(let frame = 0; frame < 64; frame++) {
            m[0x1B] = frame;
            call(game, game.oam);
            assert.equal(hints(m).length, steady + (frame < 32 ? icons : 0),
                'only direction icons use the slow 32-frame on, 32-frame off cycle');
            assert.equal(hintText(m).includes('PAUSED'), true);
            assert.equal(hintText(m).replace(/[<^]/g, ''), 'PAUSED' + (enabled ? 'LOOPOFF' : ''),
                'PAUSED and operation text stay visible throughout both blink phases');
            assert.equal(hintText(m).includes('^'), Boolean(enabled && frame < 32));
            assert.equal(hintText(m).includes('<'), Boolean(wide && frame < 32));
        }
        assert.deepEqual(entityData(m), before);
        assert.equal(m[0x05], 0, 'paused frames never enter the active simulation');
    }
});

test('edge direction icons share flipped graphics and LOOP status fits on one scanline', () => {
    const game = synthetic(), {m} = game;
    m[0x3D] = 1; m[0x32] = 1;
    call(game, game.entry); m[0x2C] = patternReady; call(game, game.oam);
    const arrows = hints(m).filter(offset => m[0x201 + offset] === Romfix.PAUSE_HINT_SPRITE_START + Romfix.PAUSE_HINT_GLYPHS.indexOf('<') * 2);
    assert.equal(arrows.length, 2, 'left and right use one directional glyph');
    assert.equal(m[0x202 + arrows[0]] ^ m[0x202 + arrows[1]], 0x40,
        'right reverses the left sprite with the hardware flip');
    assert.deepEqual(arrows.map(offset => [m[0x200 + offset], m[0x203 + offset]]), [[112, 8], [112, 240]],
        'left and right controls appear at opposite screen edges');
    assert.equal(hintText(m), 'PAUSED<<^LOOPOFF');
    const mode = hints(m).filter(offset => m[0x200 + offset] === 144);
    assert.equal(mode.length, 8, 'Up and LOOP OFF fit together in one hardware sprite row');
    assert.equal(mode.map(offset => Romfix.PAUSE_HINT_GLYPHS[(m[0x201 + offset] - Romfix.PAUSE_HINT_SPRITE_START) / 2]).join(''), '^LOOPOFF');
    assert.deepEqual(mode.map(offset => m[0x203 + offset]), [88, 104, 112, 120, 128, 144, 152, 160],
        'the single mode row is centered with clear gaps around the arrow and status');
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

test('only a valid left/right camera look dismisses controls, PAUSED stays steady, and a new pause resets controls', () => {
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
            if(canLook) assert.equal(hintText(m), 'PAUSED',
                'dismissed operation hints stay hidden while PAUSED remains visible');
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

test('Up updates LOOP ON/OFF immediately and redisplays dismissed operation hints', () => {
    const game = synthetic(), {m} = game;
    m[0x3D] = 1; m[0x32] = 1; m[0x1B] = 32;
    call(game, game.entry); m[0x2C] = patternReady; call(game, game.oam);
    assert.equal(hintText(m), 'PAUSEDLOOPOFF');
    for(const expected of ['ON', 'OFF']) {
        m[0x1B] = 32;
        m[0xF6] = 1; call(game, game.entry); call(game, game.oam);
        assert.equal(hintText(m), 'PAUSED', 'looking hides operation text but PAUSED stays visible');
        m[0xF6] = 0; m[0xF4] = 8; call(game, game.entry); call(game, game.oam);
        assert.equal(m[0x2A] & 0x40, 0, 'a mode change presents the changed setting again');
        assert.equal(hintText(m), `PAUSEDLOOP${expected}`, 'the updated mode text is visible even while its Up icon is off');
        m[0x1B] = 0; call(game, game.oam);
        assert.equal(hintText(m), `PAUSED<<^LOOP${expected}`, 'the icons reappear together in the on phase');
        m[0xF4] = 0;
    }
});

test('Up selects a view only while paused and a resume restores OAM after the frozen camera return', () => {
    const game = synthetic(), { m } = game;
    m[0xC2] = 60; m[0xF4] = 8;
    call(game, game.entry);
    assert.equal(m[0x2A], 0, 'active Up does not change views');
    m[0x32] = 1; m[0xF4] = 0;
    call(game, game.entry);
    m[0x2C] = patternRestored;
    m[0xF4] = 8; call(game, game.entry);
    assert.equal(m[0x2A], 1);
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
        m[0x32] = 1; m[0xF4] = 8; m[0xF6] = 1;
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
    const editor = new RomEditor(); editor.loadROM(supplied);
    editor.gameConfig.cameraFollow = enabled; editor.gameConfig.disableTimer = false;
    const map = Array.from({length: 14}, () => Array(wide ? 32 : 16).fill(0));
    map[12].fill(5); map[1][3] = 15;
    const data = DataConverter.fromLevelEditorToROMData({
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
                phases.add(/[<^]/.test(hintText(m)));
                assert.equal(hintText(m).replace(/[<^]/g, ''), 'PAUSED' + (enabled ? 'LOOPOFF' : ''),
                    'native PAUSED and mode text remain steady throughout the direction-icon blink');
            }
            assertHint(m);
        }
        assert.ok(phases.has(false), 'the icons are hidden during their off phase');
        if(wide || enabled) assert.ok(phases.has(true), 'native frame counter slowly blinks direction icons only');
        nes.buttonDown(1, jsnes.Controller.BUTTON_RIGHT);
        for(let i = 0; i < 40; i++) {
            nes.frame();
            assert.deepEqual(entityData(m), before, 'native paused frames preserve every entity byte');
            assertPlayerProjection(m, retainedPlayer);
            assertHint(m);
            if(wide) assert.equal(hintText(m), 'PAUSED', 'looking dismisses operation hints while PAUSED stays visible');
        }
        nes.buttonUp(1, jsnes.Controller.BUTTON_RIGHT);
        assert.equal(camera(m) !== origin, wide);
        press(nes, jsnes.Controller.BUTTON_UP);
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

realTest('the one-line LOOP setting takes sprite priority when the frozen player overlaps its scanlines', () => {
    const nes = start(stage(true, true)), m = nes.cpu.mem;
    press(nes, jsnes.Controller.BUTTON_START);
    for(let i = 0; i < 20; i++) nes.frame();
    assert.equal(m[0x2C], patternReady);
    // Put the paused native standing pose on the LOOP setting row. No simulation
    // tick may alter this fixture while OAM is reconstructed for the UI.
    m[0x400] = 2; m[0x7D] = 0; m[0x41E] = 144; m[0x1B] = 0;
    const before = entityData(m);
    nes.frame();
    assert.deepEqual(entityData(m), before, 'UI priority never modifies frozen player or enemy metadata');
    const controls = hints(m).filter(offset => m[0x200 + offset] === 144);
    const player = visible(m).filter(offset => !hintTiles.has(m[0x201 + offset]));
    assert.equal(controls.length, 8, 'Up and LOOP OFF occupy one control row during the icon on phase');
    assert.equal(player.length, 2, 'both native standing-player sprites remain present in OAM');
    let pressuredScanlines = 0;
    for(let scanline = 0; scanline < 240; scanline++) {
        const active = visible(m).filter(offset => scanline > m[0x200 + offset] && scanline <= m[0x200 + offset] + 16);
        const activeControls = controls.filter(offset => active.includes(offset));
        if(active.length > 8 && activeControls.length && player.some(offset => active.includes(offset))) {
            pressuredScanlines++;
            for(const offset of activeControls) assert.ok(active.slice(0, 8).includes(offset),
                `the hardware's first eight sprites retain every control letter on scanline ${scanline}`);
        }
    }
    assert.ok(pressuredScanlines > 0, 'the test exercises actual scanlines beyond the NES eight-sprite limit');
});
