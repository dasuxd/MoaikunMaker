const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const jsnes = require('../../js/lib/jsnes.min.js');

const { Coordinates, LevelCodec, Project } = require('../helpers/source.cjs').load('Coordinates LevelCodec Project');

const original = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;
const pages = Coordinates.COORDINATE_RAM.enemySpawnPages;

function stage(scene, wide, birthPage) {
    const editor = new Project(); editor.loadROM(original);
    editor.gameConfig.cameraFollow = true; editor.gameConfig.disableTimer = true;
    const map = Array.from({ length: 14 }, () => Array(wide ? 32 : 16).fill(0));
    map[12].fill(5); map[1][2] = 15; map[11][birthPage * 16 + 3] = 13;
    const converted = LevelCodec.fromLevelEditorToROMData({
        background: scene | (wide ? 0x10 : 0), map,
        player: { x: birthPage * 16 + 2, y: 11 }, door: { x: 14, y: 10 },
        enemies: [{ enemyId: 12, x: birthPage * 16 + 8, y: 0 }]
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
    for(let i = 0; i < 600; i++) {
        nes.frame(); const m = nes.cpu.mem;
        if(m[0x30] === 12 && m[0x56] === 3 && !(m[0x2A] & 128)) {
            const slot = m.slice(0x4FE, 0x506).indexOf(12);
            assert.ok(slot >= 0, 'top-row bird/fish is present in the native loader');
            const smoke = new Set();
            let appearanceFrames = 0;
            for(let frame = 0; frame < 100; frame++) {
                if(m[0x506 + slot] === 1) {
                    assert.ok(appearanceFrames > 0, 'top-row placement retains spawn smoke');
                    assert.ok(smoke.has(1) && smoke.has(2), `native smoke clock runs at the top row (${[...smoke]})`);
                    assert.equal(m[0x433 + slot], 8, 'row zero begins at its real Y=8 checkpoint');
                    return { nes, slot };
                }
                assert.equal(m[0x506 + slot], 0, 'appearance does not enter native type-specific AI');
                smoke.add(m[0x55E + slot]); appearanceFrames++;
                nes.frame();
            }
            assert.fail('top-row smoke did not finish');
        }
    }
    assert.fail('START did not reach active gameplay');
}

function punch(nes, birthPage) {
    const m = nes.cpu.mem;
    m[0xC1] = birthPage; m[0xC2] = 40; m[0x41E] = 184; m[0x7D] = 0;
    m[0xCB] = 4; m[0xC0] = 1; m[0xC4] = m[0xC7] = m[0xC8] = 0;
    nes.buttonDown(1, jsnes.Controller.BUTTON_B); nes.frame();
    nes.buttonUp(1, jsnes.Controller.BUTTON_B);
}

function noWrappedBird(m, context) {
    for(let offset = 0; offset < 256; offset += 4) {
        if(m[0x201 + offset] >= 0xAA && m[0x201 + offset] <= 0xB1)
            assert.ok(m[0x200 + offset] < 208 || m[0x200 + offset] >= 240,
                `${context}: a top-exiting sprite never wraps into the bottom playfield`);
    }
}

for(const [scene, wide, birthPage] of [[0, false, 0], [4, true, 1]]) {
    test(`real Tile 13 lets top-row bird/fish leave upward and completely respawn: scene=${scene}, wide=${wide}`,
        { skip: !original }, () => {
        const { nes, slot } = start(stage(scene, wide, birthPage)), m = nes.cpu.mem;
        const context = `scene=${scene}, wide=${wide}`;
        const spawn = m[0x576 + slot], birth = m[pages + slot];
        assert.equal(m[0x50E + slot], birthPage, `${context}: original top-row birth page`);
        punch(nes, birthPage);
        const heights = [8], states = new Set();
        let removedAt = -1, lastVisibleTop = false;
        for(let frame = 0; frame < 40; frame++) {
            states.add(m[0x506 + slot]);
            noWrappedBird(m, context);
            assert.equal(m[0x56], 3, `${context}: upward removal stays harmless`);
            if(m[0x506 + slot] === 13) { removedAt = frame; break; }
            assert.equal(m[0x506 + slot], 1, `${context}: top edge is ordinary live flight until removal`);
            heights.push(m[0x433 + slot]);
            if(m[0x433 + slot] === 1) {
                for(let offset = 0; offset < 256; offset += 4)
                    if(m[0x200 + offset] === 0 && m[0x201 + offset] >= 0xAA && m[0x201 + offset] <= 0xB1)
                        lastVisibleTop = true;
            }
            nes.frame();
        }
        assert.ok(removedAt >= 7 && removedAt <= 10, `${context}: top-row flight reaches the invisible boundary in ${removedAt} frames`);
        assert.ok(heights.includes(1) && lastVisibleTop, `${context}: Y=1 still has visible native OAM at screen Y=0`);
        assert.equal(m[0x433 + slot], 0, `${context}: Y=0 removes the now-invisible bird immediately`);
        assert.ok(!states.has(10) && !states.has(11), `${context}: no bottom-edge burst or falling death at the top`);
        assert.equal(m[0x415 + slot], 0, `${context}: the removed bird has no projected sprite`);
        assert.ok(m[0x54E + slot] & 128, `${context}: the removed bird is collision immune`);
        assert.equal(m[0x53E + slot], 0, `${context}: removal releases any rider`);
        assert.equal(m[0x4FE + slot], 12, `${context}: the native slot remains eligible to respawn`);
        assert.ok(m[0x57E + slot] >= 199, `${context}: full native 200-tick respawn delay starts`);

        let countdownFrames = 0, smokeFrames = 0, visibleAt = -1;
        const smoke = new Set(), timers = new Set();
        for(let frame = 0; frame < 950; frame++) {
            const state = m[0x506 + slot];
            assert.equal(m[0x56], 3, `${context}: waiting and respawning remain harmless`);
            assert.equal(m[0x4FE + slot], 12, `${context}: respawn retains the bird/fish type`);
            assert.equal(m[0x576 + slot], spawn, `${context}: respawn retains its packed birth coordinate`);
            assert.equal(m[pages + slot], birth, `${context}: respawn retains its original birth page`);
            noWrappedBird(m, context);
            if(state === 13) {
                countdownFrames++; timers.add(m[0x57E + slot]);
                assert.equal(m[0x415 + slot], 0, `${context}: countdown cannot draw the old exit height`);
            } else if(state === 0) {
                smokeFrames++; smoke.add(m[0x415 + slot]);
            } else if(state === 1) { visibleAt = frame; break; }
            else assert.fail(`${context}: unexpected upward-respawn state ${state}`);
            nes.frame();
        }
        assert.ok(countdownFrames >= 795 && countdownFrames <= 802, `${context}: native delay lasted ${countdownFrames} frames`);
        assert.ok(timers.has(100) && timers.has(1), `${context}: native timer runs all the way down`);
        assert.ok(smokeFrames >= 89 && smokeFrames <= 91, `${context}: respawn smoke lasted ${smokeFrames} frames`);
        assert.ok(smoke.has(8) && smoke.has(9), `${context}: ordinary smoke precedes the new bird`);
        assert.ok(visibleAt >= 884 && visibleAt < 900, `${context}: full respawn completed after ${visibleAt} frames`);
        assert.equal(m[0x433 + slot], 8, `${context}: original top-row height is restored`);
        assert.equal(m[0x546 + slot], 8, `${context}: the upward exit target is reset`);
        assert.equal(m[0x50E + slot], birthPage, `${context}: original birth page is restored`);
        assert.equal(m[0x56E + slot], 0, `${context}: no prior half-step survives respawn`);
        assert.equal(m[0x57E + slot], 0, `${context}: the live bird has no death countdown`);
        assert.equal(nes.cpu.REG_SP, 0x1FF, `${context}: native stack remains balanced`);
    });
}

test('a top-row Tile 13 ascent removes the bird at Y zero instead of leaving an invisible platform',
    { skip: !original }, () => {
    const { nes, slot } = start(stage(0, false, 0)), m = nes.cpu.mem;
    m[0x433 + slot] = m[0x546 + slot] = 8;
    punch(nes, 0);
    let removed = false, sawLastVisibleHeight = false;
    for(let frame = 0; frame < 24; frame++) {
        noWrappedBird(m, 'zero-height destination');
        if(m[0x506 + slot] === 13) { removed = true; break; }
        assert.equal(m[0x506 + slot], 1, 'positive-height flight remains a live bird');
        if(m[0x433 + slot] === 1) sawLastVisibleHeight = true;
        nes.frame();
    }
    assert.ok(removed && sawLastVisibleHeight, 'one actual impact reaches Y=0 and removes the invisible bird');
    assert.equal(m[0x433 + slot], 0, 'the zero-height checkpoint becomes removal instead of permanent support');
    assert.equal(m[0x415 + slot], 0, 'the fully departed bird enters hidden respawn delay');
    assert.ok(m[0x57E + slot] >= 196, 'top removal starts the full ordinary enemy delay');
});

test('a rider keeps a signed height above the screen and falls after the top bird disappears',
    { skip: !original }, () => {
    const { nes, slot } = start(stage(0, false, 0)), m = nes.cpu.mem;
    punch(nes, 0);
    // After the real impact, put a standing player on the rising bird. The
    // native carrier and player update still own the actual ascent and fall.
    m[0xC1] = m[0x50E + slot]; m[0xC2] = m[0x516 + slot];
    const initialPlayerY = m[0x433 + slot] - 16;
    m[0x41E] = initialPlayerY & 255; m[0x7D] = initialPlayerY < 0 ? 255 : 0;
    m[0xC0] = 1; m[0xC4] = m[0xC7] = m[0xC8] = 0;
    m[0x53E + slot] = 1;
    let playerAboveScreen = false, removed = false;
    for(let frame = 0; frame < 40; frame++) {
        nes.frame();
        assert.equal(m[0x56], 3, 'the rider cannot be wrapped into native bottom death');
        noWrappedBird(m, 'rider');
        if(m[0x506 + slot] === 13) { removed = true; break; }
        const signedY = (m[0x7D] === 255 ? -256 : 0) + m[0x41E];
        if(m[0x7D] === 255) playerAboveScreen = true;
        if(m[0x53E + slot])
            assert.ok(signedY < 0, 'a player still riding above the top keeps a negative signed height');
        else assert.ok(signedY < 213, 'a released rider falls naturally instead of wrapping to the bottom');
    }
    assert.ok(playerAboveScreen && removed, 'the rider remains safely above the top before normal removal');
    assert.equal(m[0x53E + slot], 0, 'the removed platform releases support');
    let falling = false, reentered = false, landed = false;
    const landingTimers = new Set();
    // Native falls this high include a 200-frame hard-landing recovery:
    // state 5 starts DB=100 and decrements it every other frame ($94C4).
    for(let frame = 0; frame < 400; frame++) {
        nes.frame();
        assert.equal(m[0x56], 3, 'natural fall from the top stays playable');
        if(m[0xC0] === 2 && m[0xC7] > 0 && m[0xC7] < 128) falling = true;
        if(m[0x7D] === 0 && m[0x41E] < 192) reentered = true;
        if(m[0xC0] === 5) landingTimers.add(m[0xDB]);
        if(reentered && m[0xC0] === 1) { landed = true; break; }
    }
    assert.ok(falling && reentered && landed,
        `player naturally falls back into view and lands on the floor: falling=${falling}, reentered=${reentered}, landed=${landed}, state=${m[0xC0]}, Y=${m[0x7D]}:${m[0x41E]}, speed=${m[0xC7]}`);
    assert.ok(landingTimers.has(100) && landingTimers.has(1), 'the ordinary hard-landing recovery runs completely');
    nes.buttonDown(1, jsnes.Controller.BUTTON_A); nes.frame();
    nes.buttonUp(1, jsnes.Controller.BUTTON_A);
    assert.equal(m[0xC0], 2, 'native jumping still works after the released rider lands');
    assert.ok(m[0xC7] & 128, 'the jump has a real upward velocity');
    assert.equal(nes.cpu.REG_SP, 0x1FF, 'carrier removal balances the native stack');
});
