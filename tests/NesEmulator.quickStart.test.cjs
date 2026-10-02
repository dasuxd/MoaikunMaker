const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const jsnes = require('../js/lib/jsnes.min.js');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/NesEmulator.js'), 'utf8');
const NesEmulator = new Function(
    'jsnes', 'app', 'setTimeout', `${source}\nreturn NesEmulator;`
)(jsnes, { mobileController: {} }, callback => callback());

function makeEmulator(nes) {
    const emulator = Object.create(NesEmulator.prototype);
    emulator.runGeneration = 0;
    emulator.nes = nes;
    emulator.canvas = { width: 1024, height: 448 };
    emulator.ctx = { getImageData: () => ({}) };
    emulator.adjustUIForMobile = () => {};
    emulator.quickSaveSlots = Array(4).fill(null);
    emulator.clearAudioBuffer = () => {};
    emulator.start = () => { emulator.started = true; };
    return emulator;
}

function inputRecorder(onFrame = () => {}) {
    const events = [];
    const held = new Set();
    let frames = 0;
    const nes = {
        buttonDown(player, button) {
            assert.equal(player, 1);
            events.push({ type: 'down', button, frame: frames });
            held.add(button);
        },
        buttonUp(player, button) {
            assert.equal(player, 1);
            events.push({ type: 'up', button, frame: frames });
            held.delete(button);
        },
        frame() { frames++; onFrame(held, frames); }
    };
    return { nes, events, held, frameCount: () => frames };
}

test('default quick start retains the original START sequence and loading progress', async () => {
    const input = inputRecorder();
    const emulator = makeEmulator(input.nes);
    await emulator.quickStart();
    assert.deepEqual(input.events, [
        { type: 'down', button: jsnes.Controller.BUTTON_START, frame: 40 },
        { type: 'up', button: jsnes.Controller.BUTTON_START, frame: 43 }
    ]);
    assert.equal(input.frameCount(), 349);
    assert.equal(emulator.loadingProgress, 346);
    assert.equal(emulator.started, true);
    assert.equal(input.held.size, 0);
});

test('stale preview preferences cannot select the password menu', async () => {
    const input = inputRecorder();
    const emulator = makeEmulator(input.nes);
    await emulator.quickStart({loopView:true});
    assert.deepEqual(input.events.map(e => e.button),[jsnes.Controller.BUTTON_START,jsnes.Controller.BUTTON_START]);
});
test('cancelled quick start releases START and cannot start a replacement run', async () => {
    let emulator;
    const input = inputRecorder(held => { if(held.has(jsnes.Controller.BUTTON_START)) emulator.stop(); });
    emulator = makeEmulator(input.nes);
    await emulator.quickStart();
    assert.equal(emulator.started,undefined);
    assert.equal(input.held.size,0);
});

// Optional cartridge regressions use a supplied original ROM without embedding
// copyrighted bytes in fixtures or changing the user's ROM on disk.
const romPath = process.env.MOAIKUN_TEST_ROM;
const original = romPath ? fs.readFileSync(romPath) : null;
test('quick start always chooses native START with either feature setting',
    { skip: !original }, async () => {
        const romSource = ['Config', 'Level', 'RomFix', 'RomEditor', 'DataConverter']
            .map(name => fs.readFileSync(path.join(root, 'js', `${name}.js`), 'utf8'))
            .join('\n');
        const { Config, RomEditor, DataConverter } = new Function(
            'i18n', `${romSource}\nreturn {Config, RomEditor, DataConverter};`
        )({ t: key => key });
        for (const expanded of [false, true]) for (const [cameraFollow, loopView] of [
            [false, false], [true, false], [true, true]
        ]) {
            const editor = new RomEditor();
            editor.loadROM(original);
            editor.gameConfig.cameraFollow = cameraFollow;
            editor.gameConfig.disableTimer = true;
            if (expanded) editor.romType = Config.ROM_TYPE_EXPANDED;
            const map = Array.from({ length: 14 }, () => Array(16).fill(0));
            map[12].fill(5);
            map[1][3] = 15;
            const converted = DataConverter.fromLevelEditorToROMData({
                background: 0,
                player: { x: 2, y: 11 },
                door: { x: 11, y: 10 },
                map, enemies: []
            }, false);
            editor.levels[0].data = converted.mapData;
            editor.levels[0].monsterData = converted.monsterData;
            editor.levelCount = 1;
            const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, emulateSound: false });
            const emulator = makeEmulator(nes);
            emulator.loadROM(editor.getROMData());
            await emulator.quickStart({ loopView });
            const m = nes.cpu.mem;
            const description = `expanded=${expanded}, cameraFollow=${cameraFollow}, loopView=${loopView}`;
            assert.equal(emulator.started, true, description);
            assert.equal(m[0x21], 0, `title selection: ${description}`);
            // Existing quick-start timing hands off during the stage-title
            // transition. Continue the short transition as the normal loop does.
            for (let frame = 0; frame < 120 && (m[0x30] !== 12 || m[0x56] !== 3); frame++) nes.frame();
            nes.frame();
            assert.equal(m[0x30], 12, `live game state: ${description}`);
            assert.equal(m[0x56], 3, `stage initialized: ${description}`);
            assert.equal(m[0x3D], 0, `narrow stage: ${description}`);
            const x = m[0xC2] | (m[0xC1] << 8);
            const camera = m[0xFD] | (m[0x9D] << 8);
            assert.equal(camera, 0, `camera: ${description}`);
            assert.ok(nes.controllers[1].state.every(value => value === 64), `released inputs: ${description}`);
        }
    });
