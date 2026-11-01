const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const jsnes = require('../js/lib/jsnes.min.js');

const source = ['Config', 'Level', 'RomFix', 'RomEditor', 'DataConverter']
    .map(name => fs.readFileSync(path.join(__dirname, '..', 'js', `${name}.js`), 'utf8')).join('\n');
const { RomEditor, DataConverter } = new Function('i18n',
    `${source}\nreturn { RomEditor, DataConverter };`)({ t: key => key });
const original = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;

function stage(scene, wide, row) {
    const editor = new RomEditor(); editor.loadROM(original);
    editor.gameConfig.cameraFollow = true; editor.gameConfig.disableTimer = true;
    const map = Array.from({ length: 14 }, () => Array(wide ? 32 : 16).fill(0));
    // The player starts on separate safe land. The bird's bottom two rows
    // stay empty, so a failed descent cannot be hidden by terrain collision.
    map[12].fill(5, 0, 5); map[1][2] = 15;
    const converted = DataConverter.fromLevelEditorToROMData({
        background: scene | (wide ? 0x10 : 0), map,
        player: { x: 2, y: 11 }, door: { x: 3, y: 10 },
        enemies: [{ enemyId: 12, x: 8, y: row }]
    }, wide);
    editor.levels[0].data = converted.mapData;
    editor.levels[0].monsterData = converted.monsterData;
    editor.levelCount = 1;
    return editor.getROMData();
}

function start(data) {
    const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, emulateSound: false });
    nes.loadROM(Buffer.from(data).toString('binary'));
    for(let i = 0; i < 160; i++) nes.frame();
    nes.buttonDown(1, jsnes.Controller.BUTTON_START); nes.frame();
    nes.buttonUp(1, jsnes.Controller.BUTTON_START);
    for(let i = 0; i < 800; i++) {
        nes.frame();
        const m = nes.cpu.mem, slot = m.slice(0x4FE, 0x506).indexOf(12);
        if(m[0x30] === 12 && m[0x56] === 3 && !(m[0x2A] & 128) &&
            slot >= 0 && m[0x506 + slot] === 1) {
            m[0x556 + slot] = 4; // Patrol away from the separate starting land.
            return { nes, m, slot };
        }
    }
    assert.fail('START did not reach active gameplay with a live bird');
}

function land(game) {
    const { nes, m, slot } = game;
    // Only set a descending contact checkpoint. Native player integration,
    // platform collision, the carry path and bottom death all run normally.
    m[0x53E + slot] = 0;
    m[0xC1] = m[0x50E + slot]; m[0xC2] = m[0x516 + slot];
    m[0x41E] = m[0x433 + slot] - 18; m[0x7D] = 0;
    m[0xC0] = 2; m[0x52] = 16; m[0xC7] = 1; m[0xC8] = 0;
    let frames = 0;
    for(; frames < 10 && !m[0x53E + slot]; frames++) nes.frame();
    assert.equal(m[0x53E + slot], 1, 'descending contact lands on the moving bird');
    return frames;
}

function alive(game, context) {
    const { m, slot } = game;
    assert.equal(m[0x30], 12, `${context}: native gameplay stays active`);
    assert.equal(m[0x56], 3, `${context}: the player does not enter death`);
    assert.equal(m[0x506 + slot], 1, `${context}: the bird stays alive`);
    assert.ok(m[0x433 + slot] <= 224, `${context}: bird Y=${m[0x433 + slot]} stays above the bottom limit`);
    if(m[0x53E + slot]) {
        assert.equal(m[0x7D], 0, `${context}: rider remains within the visible Y page`);
        assert.ok(m[0x41E] < 213, `${context}: rider Y=${m[0x41E]} stays below the native death threshold`);
    }
}

for(const scene of [0, 4]) for(const wide of [false, true]) {
    const context = `scene=${scene}, wide=${wide}`;
    test(`native bird/fish bottom-row half-step stays safe while landing and walking: ${context}`,
        { skip: !original }, () => {
        const game = start(stage(scene, wide, 13)), { nes, m, slot } = game;
        assert.equal(m[0x433 + slot], 216, 'row 13 starts at its native center');
        land(game);
        for(let i = 0; i < 8; i++) { nes.frame(); alive(game, context); }
        assert.equal(m[0x433 + slot], 224, 'the bottom row still allows one temporary half-tile descent');
        assert.equal(m[0x546 + slot], 216);
        assert.equal(m[0x56E + slot], 8);
        const recoveryTimer = m[0x57E + slot];
        assert.ok(recoveryTimer > 80 && recoveryTimer <= 90, 'the normal half-step recovery countdown starts');
        let elapsed = 0;

        for(let landing = 0; landing < 6; landing++) {
            const before = m[0x57E + slot];
            elapsed += land(game); alive(game, `${context}, landing=${landing + 1}`);
            assert.equal(m[0x546 + slot], 216, 'repeated bottom-row landings never commit the next row');
            assert.equal(m[0x56E + slot], 8, 'a rejected whole-tile drop retains its recoverable half-step');
            assert.ok(m[0x57E + slot] < before, 'a rejected drop cannot reset or extend the recovery timer');
        }

        let movedLeft = false, movedRight = false;
        for(let pair = 0; pair < 6; pair++) {
            for(const button of [jsnes.Controller.BUTTON_LEFT, jsnes.Controller.BUTTON_RIGHT]) {
                const before = m[0xC1] * 256 + m[0xC2] - m[0x50E + slot] * 256 - m[0x516 + slot];
                nes.buttonDown(1, button);
                for(let i = 0; i < 2; i++) { nes.frame(); elapsed++; alive(game, context); }
                nes.buttonUp(1, button);
                const after = m[0xC1] * 256 + m[0xC2] - m[0x50E + slot] * 256 - m[0x516 + slot];
                movedLeft ||= after < before; movedRight ||= after > before;
                assert.equal(m[0x53E + slot], 1, 'ordinary left/right walking stays on the carrier');
            }
        }
        assert.ok(movedLeft && movedRight, 'native movement walks across the bird in both directions');
        for(; elapsed < recoveryTimer + 8; elapsed++) {
            assert.ok(m[0x433 + slot] > 216, 'a rejected drop cannot prematurely discard the recovery delay');
            nes.frame(); alive(game, context);
        }
        assert.equal(m[0x433 + slot], 216, 'the safe half-step recovers to the bottom-row center');
        assert.equal(m[0x546 + slot], 216);
        assert.equal(m[0x56E + slot], 0);
        assert.equal(m[0x57E + slot], 0);
        assert.equal(m[0x41E], 200, 'the rider recovers along with the bird');

        // Finally repeat actual A-button jumps from the recovered bottom row.
        // Recenter this long fixture so both jumps stay clear of its map seam.
        m[0x516 + slot] = m[0x526 + slot] = m[0xC2] = 136;
        m[0x50E + slot] = m[0x51E + slot] = m[0xC1] = 0;
        for(let jump = 0; jump < 2; jump++) {
            nes.buttonDown(1, jsnes.Controller.BUTTON_A); nes.frame();
            nes.buttonUp(1, jsnes.Controller.BUTTON_A);
            assert.equal(m[0xC0], 2, 'native A input jumps from the bottom-row carrier');
            assert.equal(m[0x53E + slot], 0);
            assert.ok(m[0xC7] & 128, 'native jump starts upward');
            for(let i = 0; i < 70 && !m[0x53E + slot]; i++) {
                const separation = m[0xC1] * 256 + m[0xC2] - m[0x50E + slot] * 256 - m[0x516 + slot];
                nes.buttonUp(1, jsnes.Controller.BUTTON_LEFT);
                nes.buttonUp(1, jsnes.Controller.BUTTON_RIGHT);
                if(separation > 2) nes.buttonDown(1, jsnes.Controller.BUTTON_LEFT);
                if(separation < -2) nes.buttonDown(1, jsnes.Controller.BUTTON_RIGHT);
                nes.frame(); alive(game, `${context}, jump=${jump + 1}`);
            }
            nes.buttonUp(1, jsnes.Controller.BUTTON_LEFT);
            nes.buttonUp(1, jsnes.Controller.BUTTON_RIGHT);
            assert.equal(m[0x53E + slot], 1, 'the native jump lands back on the moving bird');
            for(let i = 0; i < 8; i++) { nes.frame(); alive(game, context); }
            assert.equal(m[0x546 + slot], 216, 'actual jumps cannot commit the unsafe next row');
            assert.equal(m[0x433 + slot], 224, 'actual jumps retain the safe half-step');
        }
    });

    test(`native bird/fish can still commit one full tile down to the last row: ${context}`,
        { skip: !original }, () => {
        const game = start(stage(scene, wide, 12)), { nes, m, slot } = game;
        assert.equal(m[0x433 + slot], 200);
        land(game);
        for(let i = 0; i < 8; i++) { nes.frame(); alive(game, context); }
        assert.equal(m[0x433 + slot], 208);
        land(game);
        for(let i = 0; i < 16; i++) { nes.frame(); alive(game, context); }
        assert.equal(m[0x433 + slot], 216, 'two landings still descend one complete valid row');
        assert.equal(m[0x546 + slot], 216);
        assert.equal(m[0x56E + slot], 0);
        assert.equal(m[0x57E + slot], 0);
        for(let i = 0; i < 110; i++) { nes.frame(); alive(game, context); }
        assert.equal(m[0x433 + slot], 216, 'a valid committed last-row descent stays at the new height');
    });
}
