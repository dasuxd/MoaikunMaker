const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const jsnes = require('../js/lib/jsnes.min.js');

const messages = [];
const app = {
    testMode: true,
    mobileController: {},
    showMessage(type, message) { messages.push({ type, message }); }
};
const i18n = { t: (key, { slot } = {}) => `${key}:${slot}` };
const document = {
    listeners: {},
    addEventListener(name, listener) { this.listeners[name] = listener; }
};

const source = fs.readFileSync(path.join(__dirname, '../js/NesEmulator.js'), 'utf8');
const NesEmulator = new Function(
    'jsnes', 'app', 'i18n', 'document',
    `${source}\nreturn NesEmulator;`
)(jsnes, app, i18n, document);

function makeRom(mapper = 0) {
    // Minimal synthetic program: JMP $8000, with all vectors at $8000.
    const prgBanks = mapper === 0 ? 1 : 2;
    const rom = new Uint8Array(16 + prgBanks * 16384 + 8192);
    rom.set([0x4e, 0x45, 0x53, 0x1a, prgBanks, 1, mapper << 4]);
    rom.set([0x4c, 0x00, 0x80], 16);
    rom.set([0x00, 0x80, 0x00, 0x80, 0x00, 0x80], 16 + prgBanks * 16384 - 6);
    return rom;
}

function makeEmulator(mapper = 0) {
    const emulator = Object.create(NesEmulator.prototype);
    emulator.quickSaveSlots = Array(NesEmulator.QUICK_SAVE_SLOT_COUNT).fill(null);
    emulator.runGeneration = 0;
    emulator.isRunning = true;
    emulator.audioBuffer = [[1, 1]];
    emulator.nes = new jsnes.NES({ onFrame() {}, onAudioSample() {} });
    emulator.loadROM(makeRom(mapper));
    emulator.nes.frame();
    return emulator;
}

test('four slots retain independent snapshots across repeated loads', () => {
    const emulator = makeEmulator();
    emulator.nes.cpu.mem[0x10] = 12;
    emulator.quickSave(1);
    emulator.nes.cpu.mem[0x10] = 23;
    emulator.quickSave(2);
    emulator.quickLoad(1);
    assert.equal(emulator.nes.cpu.mem[0x10], 12);
    emulator.nes.cpu.mem[0x10] = 44;
    emulator.quickLoad(1);
    assert.equal(emulator.nes.cpu.mem[0x10], 12);
    emulator.quickLoad(2);
    assert.equal(emulator.nes.cpu.mem[0x10], 23);
    assert.deepEqual(emulator.audioBuffer, []);
    assert.ok(emulator.nes.controllers[1].state.every(value => value === 64));
});

test('quick load restores the original and expanded ROM mapper states', () => {
    for (const mapper of [2, 3]) {
        const emulator = makeEmulator(mapper);
        emulator.nes.cpu.mem[0x10] = 31;
        emulator.quickSave(1);
        emulator.nes.cpu.mem[0x10] = 99;
        emulator.quickLoad(1);
        assert.equal(emulator.nes.cpu.mem[0x10], 31, `mapper ${mapper}`);
        emulator.nes.frame();
        emulator.quickLoad(1);
        assert.equal(emulator.nes.cpu.mem[0x10], 31, `repeated mapper ${mapper} load`);
    }
});

test('shortcut handling is limited to running test mode', () => {
    const emulator = makeEmulator();
    emulator.setupKeyboard();
    const press = (key, shiftKey = false, extra = {}) => {
        let prevented = false;
        document.listeners.keydown({
            key, shiftKey, repeat: false, ctrlKey: false, altKey: false,
            metaKey: false, target: {},
            preventDefault() { prevented = true; }, ...extra
        });
        return prevented;
    };
    assert.equal(press('F3'), true);
    assert.equal(messages.at(-1).message, 'quickSaveEmpty:3');
    emulator.nes.cpu.mem[0x10] = 77;
    assert.equal(press('F3', true), true);
    emulator.nes.cpu.mem[0x10] = 88;
    assert.equal(press('F3'), true);
    assert.equal(emulator.nes.cpu.mem[0x10], 77);
    assert.equal(press('F3', true, { repeat: true }), true);
    assert.equal(press('F3', false, { target: { tagName: 'INPUT' } }), true);
    assert.equal(press('F3', false, { ctrlKey: true }), false);
    assert.equal(press('F3', false, { altKey: true }), false);
    assert.equal(press('Alt'), true);
    assert.equal(emulator.nes.controllers[1].state[jsnes.Controller.BUTTON_SELECT], 65);
    let altKeyUpPrevented = false;
    document.listeners.keyup({
        key: 'Alt',
        preventDefault() { altKeyUpPrevented = true; }
    });
    assert.equal(altKeyUpPrevented, true);
    assert.equal(emulator.nes.controllers[1].state[jsnes.Controller.BUTTON_SELECT], 64);
    assert.equal(press('Shift'), false);
    assert.equal(emulator.nes.controllers[1].state[jsnes.Controller.BUTTON_SELECT], 64);
    app.testMode = false;
    assert.equal(press('F3'), false);
    app.testMode = true;
    emulator.stop();
    assert.equal(press('F3'), false);
});

test('slots clear on stop and ROM replacement', () => {
    const emulator = makeEmulator();
    emulator.quickSave(4);
    emulator.stop();
    assert.ok(emulator.quickSaveSlots.every(slot => slot === null));
    emulator.isRunning = true;
    emulator.quickSave(4);
    emulator.loadROM(makeRom());
    assert.ok(emulator.quickSaveSlots.every(slot => slot === null));
});

test('stopping during asynchronous quick start cannot restart the emulator', async () => {
    const emulator = makeEmulator();
    emulator.adjustUIForMobile = () => {};
    emulator.ctx = { getImageData: () => ({}) };
    emulator.canvas = { width: 1024, height: 448 };
    let started = false;
    emulator.start = () => { started = true; };
    const pending = emulator.quickStart();
    emulator.stop();
    await pending;
    assert.equal(started, false);
});
