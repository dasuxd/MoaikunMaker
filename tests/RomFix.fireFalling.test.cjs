const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const jsnes = require('../js/lib/jsnes.min.js');

const source = ['Config', 'Level', 'RomFix', 'RomEditor', 'DataConverter']
    .map(name => fs.readFileSync(path.join(__dirname, '../js', `${name}.js`), 'utf8'))
    .join('\n');
const { Config, Romfix, RomEditor, DataConverter } = new Function('i18n',
    `${source}\nreturn { Config, Romfix, RomEditor, DataConverter };`)({ t: key => key });

// The ROM is supplied locally; its copyrighted bytes never become a fixture.
// An already-exported ROM is used directly, without another getROMData pass.
const supplied = process.env.MOAIKUN_TEST_ROM
    ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;
const realTest = (name, body) => test(name, { skip: !supplied }, body);
const fixedAddress = cpu => 0x1C010 + cpu - 0xC000;

function fixture(wide, count = 1, { scene = 11, pushRock = false, includeFace = true } = {}) {
    let data = new Uint8Array(supplied);
    if (!RomEditor.inspectROM(data).expanded) {
        const originalEditor = new RomEditor();
        originalEditor.loadROM(data);
        originalEditor.gameConfig.cameraFollow = true;
        data = originalEditor.getROMData();
    }
    const editor = new RomEditor();
    editor.loadROM(data);
    // Reinstall only the patch under test. Do not rebuild graphics or treat an
    // exported ROM as an original source for unrelated existing patches.
    data.fill(0, fixedAddress(0xF100), fixedAddress(0xF410));
    Romfix.addViewModes(data, true);
    const map = Array.from({ length: 14 }, () => Array(wide ? 32 : 16).fill(0));
    map[12].fill(pushRock ? 5 : 4);
    map[13].fill(pushRock ? 5 : 4);
    map[1][pushRock ? 2 : 14] = 15;
    // Falls occur below the breath strip. Leaving these cells in place in the
    // control machine therefore cannot change the face's collision probes.
    for (let index = 0; index < count; index++) map[8][6 + index] = 8;
    if (pushRock) map[11][5] = 10;
    const converted = DataConverter.fromLevelEditorToROMData({
        background: scene | (wide ? 0x10 : 0), map,
        player: { x: pushRock ? 4 : 0, y: 11 }, door: { x: 14, y: 10 },
        enemies: includeFace ? [{ enemyId: 9, x: 10, y: pushRock ? 5 : 4 }] : []
    }, wide);
    const level = editor.levels[0];
    // Only level 1 runs. Its synthetic records may replace following records;
    // the source buffer and the on-disk ROM remain untouched.
    data.set([...converted.mapData, 0xFF], level.romAddress);
    data.set(converted.monsterData, level.monsterRomAddress);
    return data;
}

function start(data, view, { settleFrames = 31, waitForCamera = false } = {}) {
    const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, emulateSound: false });
    nes.loadROM(Buffer.from(data).toString('binary'));
    for (let frame = 0; frame < 160; frame++) nes.frame();
    nes.buttonDown(1, jsnes.Controller.BUTTON_START);
    nes.frame();
    nes.buttonUp(1, jsnes.Controller.BUTTON_START);
    for (let frame = 0; frame < 600; frame++) {
        nes.frame();
        const memory = nes.cpu.mem;
        if (memory[0x30] !== 12 || memory[0x56] !== 3 ||
            (waitForCamera && (memory[0x2A] & 0x80))) continue;
        // This phase alignment makes the old patch combine a 38-byte fall
        // with a 34-byte flame packet, then mirror all 72 bytes at once.
        for (let settle = 0; settle < settleFrames; settle++) nes.frame();
        if (view) {
            nes.buttonDown(1, jsnes.Controller.BUTTON_UP);
            nes.frame();
            nes.buttonUp(1, jsnes.Controller.BUTTON_UP);
            for (let settle = 0; settle < 80; settle++) nes.frame();
        }
        assert.equal(memory[0x2A], view);
        return nes;
    }
    assert.fail('native START did not reach active gameplay');
}

for (const wide of [false, true]) for (const view of [0, 1]) {
    realTest(`castle decoration, fire and a pushed rock share the PPU budget: wide=${wide}, view=${view}`, () => {
        const data = fixture(wide, 0, { scene: 8, pushRock: true });
        const options = { settleFrames: 1, waitForCamera: true };
        const pushing = start(data, view, options), control = start(data, view, options);
        const memory = pushing.cpu.mem;
        const face = memory.slice(0x4FE, 0x506).indexOf(9);
        assert.ok(face >= 0);
        const fireTicks = observeFireTicks(pushing, face);
        const controlTicks = observeFireTicks(control, face);
        const decorationFrames = new Set(), rockPositions = new Set();
        let frame = 0, scrollRestores = 0;
        const write = pushing.mmap.write.bind(pushing.mmap);
        pushing.mmap.write = (address, value) => {
            if (address === 0x2005 || address === 0x2007) {
                assert.ok(pushing.ppu.scanline < 20,
                    `castle push: wide=${wide}, view=${view}, frame=${frame}, ` +
                    `address=${address.toString(16)}, line=${pushing.ppu.scanline}, ` +
                    `pc=${(pushing.cpu.REG_PC + 1).toString(16)}, queue=${memory[0x1E]}`);
                if (address === 0x2005) scrollRestores++;
            }
            return write(address, value);
        };
        pushing.buttonDown(1, jsnes.Controller.BUTTON_RIGHT);
        for (frame = 0; frame < 180; frame++) {
            pushing.frame();
            control.frame();
            assert.equal(memory[0x30], 12);
            assert.equal(memory[0x56], 3);
            decorationFrames.add(memory[0x5B6 + 2]);
            if (memory[0x412]) rockPositions.add((memory[0xDD] << 8) | memory[0xDE]);
            if (!wide) {
                assert.deepEqual(pushing.ppu.vramMem.slice(0x2000, 0x23F8),
                    pushing.ppu.vramMem.slice(0x2400, 0x27F8),
                    `the pushed rock and decorations remain synchronized, frame=${frame}`);
            }
        }
        pushing.buttonUp(1, jsnes.Controller.BUTTON_RIGHT);
        assert.ok(rockPositions.size >= 8, 'the native rock push progresses');
        assert.ok(decorationFrames.size >= 3, 'deferred castle decorations continue animating');
        assert.ok(fireTicks.length >= 170 && controlTicks.length >= 170);
        const commonTicks = Math.min(fireTicks.length, controlTicks.length);
        assert.deepEqual(fireTicks.slice(0, commonTicks).map(tick => tick.fire),
            controlTicks.slice(0, commonTicks).map(tick => tick.fire),
            'the decorative-animation quota leaves fire timing and collision unchanged');
        assert.ok(scrollRestores > 0);
    });
}

function beginFalling(nes, count) {
    const memory = nes.cpu.mem;
    // A support-removal checkpoint initializes only the native falling slots.
    // Movement, map mutation, drawing and scan continuation run unmodified.
    for (let index = 0; index < count; index++) {
        memory[0x4C0 + index] = 1;
        memory[0x4CA + index] = 8;
        memory[0x4D4 + index] = (6 + index) * 2;
        memory[0x4DE + index] = 16;
        memory[0x4E8 + index] = 0;
    }
}

function observeFireTicks(nes, face) {
    const ticks = [], memory = nes.cpu.mem;
    const state = () => [0x506, 0x55E, 0x566, 0x56E, 0x576, 0x57E]
        .map(base => memory[base + face]);
    let fireEntry;
    const emulate = nes.cpu.emulate.bind(nes.cpu);
    nes.cpu.emulate = () => {
        // The guard replaces this native fire call. Record its inputs before
        // either the complete native update or its deliberate hold runs.
        if (nes.cpu.REG_PC + 1 === 0xA97C && nes.cpu.REG_X === face) {
            const before = state();
            fireEntry = {
                before, queue: memory[0x1E],
                hold: !memory[0x3D] && memory[0x1E] >= 17 && before[0] !== 0 &&
                    ((before[2] + 1) & 255) >= 3 && before[5] < 15
            };
        }
        // Observe the completed native update, rather than an arbitrary CPU
        // instruction where jsnes.frame() stops. The existing fixed-bank NMI
        // guard can also skip a vblank while a banked map read is in progress.
        if (nes.cpu.REG_PC + 1 === 0x80C5 && memory[0x30] === 12) {
            ticks.push({
                fire: state(), entry: fireEntry,
                fall: [memory[0x53], ...memory.slice(0x4C0, 0x4F2)]
            });
            fireEntry = undefined;
        }
        return emulate();
    };
    return ticks;
}

for (const wide of [false, true]) for (const view of [0, 1]) for (const count of [1, 3]) {
    realTest(`fire plus ${count} falling objects finishes PPU writes in vblank: wide=${wide}, view=${view}`, () => {
        const data = fixture(wide, count);
        const falling = start(data, view), control = start(data, view);
        const noFace = start(fixture(wide, count, { includeFace: false }), view);
        const memory = falling.cpu.mem;
        const face = memory.slice(0x4FE, 0x506).indexOf(9);
        assert.ok(face >= 0, 'the real native fire face is initialized');
        assert.equal(memory[0x3D], Number(wide));
        const fireTicks = observeFireTicks(falling, face);
        const controlTicks = observeFireTicks(control, face);
        const noFaceTicks = observeFireTicks(noFace, face);
        const verticalScroll = memory[0xFC], positions = new Set(), phases = new Set();
        let frame = 0, scrollRestores = 0;
        const write = falling.mmap.write.bind(falling.mmap);
        falling.mmap.write = (address, value) => {
            if (address === 0x2005 || address === 0x2007) {
                assert.ok(falling.ppu.scanline < 20,
                    `late PPU write: wide=${wide}, view=${view}, count=${count}, frame=${frame}, ` +
                    `address=${address.toString(16)}, line=${falling.ppu.scanline}, ` +
                    `pc=${(falling.cpu.REG_PC + 1).toString(16)}, queue=${memory[0x1E]}`);
                if (address === 0x2005) scrollRestores++;
            }
            return write(address, value);
        };
        beginFalling(falling, count);
        beginFalling(noFace, count);
        for (frame = 0; frame < 240; frame++) {
            falling.frame();
            control.frame();
            noFace.frame();
            assert.equal(memory[0x30], 12, 'checkpoint remains in gameplay');
            assert.equal(memory[0x56], 3, 'the player remains alive');
            assert.equal(memory[0xFC], verticalScroll, 'vertical camera shadow is unchanged');
            phases.add(memory[0x57E + face]);
            for (let index = 0; index < count; index++) positions.add(`${index}:${memory[0x4DE + index]}`);
            if (!wide) {
                assert.deepEqual(falling.ppu.vramMem.slice(0x2000, 0x23F8),
                    falling.ppu.vramMem.slice(0x2400, 0x27F8),
                    `both pages receive every complete update, frame=${frame}`);
            }
        }
        assert.ok(fireTicks.length >= 230 && controlTicks.length >= 230 && noFaceTicks.length >= 230);
        const commonFallTicks = Math.min(fireTicks.length, noFaceTicks.length);
        assert.deepEqual(fireTicks.slice(0, commonFallTicks).map(tick => tick.fall),
            noFaceTicks.slice(0, commonFallTicks).map(tick => tick.fall),
            'fire must not defer the native falling cursor, timer or movement');
        // A busy fire draw holds its complete animation/collision state. Every
        // allowed tick must then match exactly one native no-falling tick: no
        // phase, collision-length update or final disappearance can be lost.
        let nativeTick = 0, heldTicks = 0;
        for (const tick of fireTicks) {
            assert.ok(tick.entry, 'the native face update is observed');
            if (tick.entry.hold) {
                heldTicks++;
                assert.deepEqual(tick.fire, tick.entry.before,
                    'a deferred fire draw holds timer, phase, pose and collision length together');
            } else {
                assert.deepEqual(tick.fire, controlTicks[nativeTick++].fire,
                    'every allowed fire update follows the complete original animation/collision sequence');
            }
        }
        assert.equal(heldTicks > 0, !wide, 'only the narrow busy queue defers fire');
        assert.ok(nativeTick >= 200, 'fire resumes and completes its native cycle after the fall');
        assert.ok(phases.size >= 16, 'a complete native breath cycle runs');
        assert.ok(positions.size > count * 4, 'all falling slots make progress');
        for (let index = 0; index < count; index++) {
            assert.ok(memory[0x4DE + index] >= 22, 'later falling slots also reach the ground');
        }
        assert.ok(scrollRestores > 0, 'actual PPU scroll restoration is observed');
    });
}
