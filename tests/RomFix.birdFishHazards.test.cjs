const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const jsnes = require('../js/lib/jsnes.min.js');

const source = ['Config', 'Level', 'RomFix', 'RomEditor', 'DataConverter']
    .map(name => fs.readFileSync(path.join(__dirname, '..', 'js', `${name}.js`), 'utf8')).join('\n');
const { Romfix, RomEditor, DataConverter } = new Function('i18n',
    `${source}\nreturn { Romfix, RomEditor, DataConverter };`)({ t: key => key });
const original = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;
const pages = Romfix.COORDINATE_RAM.enemySpawnPages;

function stage(scene, wide, birthPage) {
    const editor = new RomEditor(); editor.loadROM(original);
    editor.gameConfig.cameraFollow = true; editor.gameConfig.disableTimer = true;
    const map = Array.from({ length: 14 }, () => Array(wide ? 32 : 16).fill(0));
    map[12].fill(5); map[1][2] = 15;
    const converted = DataConverter.fromLevelEditorToROMData({
        background: scene | (wide ? 0x10 : 0), map,
        player: { x: 2, y: 11 }, door: { x: 14, y: 10 },
        enemies: [{ enemyId: 12, x: birthPage * 16 + 8, y: 6 }]
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
        nes.frame();
        const m = nes.cpu.mem;
        if(m[0x30] === 12 && m[0x56] === 3 && !(m[0x2A] & 128)) {
            for(let frame = 0; frame < 160; frame++) nes.frame();
            return nes;
        }
    }
    assert.fail('START did not reach active gameplay');
}

function clearHazards(m) {
    m[0x8B] = m[0x8E] = 0;
    m.fill(0, 0x4F2, 0x4F5); // Three falling tile slots.
    m.fill(0, 0x4A8, 0x4AC); // Bomb/explosion slots.
}

const hazards = [
    ['thrown stone', 11, (m, x, y, page) => {
        m[0x8B] = 2; m[0x8E] = 2; m[0x8C] = page; m[0x8D] = x; m[0x43B] = y;
    }],
    ['falling stone', 10, (m, x, y, page) => {
        m[0x8B] = 3; m[0x8E] = 2; m[0x8C] = page; m[0x8D] = x; m[0x43B] = y;
    }],
    ...[7, 10].map(type => [`falling tile ${type}`, 10, (m, x, y, page) => {
        m[0x4F2] = type; m[0x4F5] = page; m[0x4F8] = x; m[0x430] = y; m[0x4FB] = 3;
    }]),
    ['explosion', 11, (m, x, y, page) => {
        m[0x4A8] = 11; m[0x4AC] = page; m[0x4B0] = x; m[0x42B] = y + 8;
        m[0x4B8] = m[0x4BC] = 0;
    }],
    ['solid terrain', 10, (m, x, y, page) => {
        const worldX = page * 256 + x;
        const address = 0x700 + (y & 0xF0) + (worldX >> 5);
        if(worldX & 16) m[address] = (m[address] & 0xF0) | 5;
        else m[address] = (m[address] & 0x0F) | 0x50;
    }]
];

for(const [scene, wide, birthPage] of [[0, false, 0], [4, true, 1]]) {
    test(`native bird/fish hazards and full respawn: scene=${scene}, wide=${wide}, birth=${birthPage}`,
        { skip: !original }, () => {
        const data = stage(scene, wide, birthPage), initial = start(data).toJSON();
        for(const [name, expected, placeHazard] of hazards) {
            const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, emulateSound: false });
            nes.loadROM(Buffer.from(data).toString('binary'));
            nes.fromJSON(JSON.parse(JSON.stringify(initial)));
            const m = nes.cpu.mem, slot = m.slice(0x4FE, 0x506).indexOf(12);
            const context = `${name}, scene=${scene}, wide=${wide}`;
            assert.ok(slot >= 0, context);
            const spawn = m[0x576 + slot], birth = m[pages + slot], map = m.slice(0x700, 0x800);
            clearHazards(m);
            // A live checkpoint at half-grid height exercises all hazards
            // independently of the platform's original aligned birthplace.
            m[0x50E + slot] = birthPage; m[0x516 + slot] = m[0x526 + slot] = 136;
            m[0x433 + slot] = m[0x546 + slot] = 112;
            m[0x53E + slot] = m[0x56E + slot] = m[0x57E + slot] = 0;
            assert.equal(m[0x506 + slot], 1, `${context}: starts alive`);
            assert.equal(m[0x54E + slot] & 128, 0, context);
            placeHazard(m, 136, 112, birthPage);
            nes.frame(); // The real native per-frame collision starts death.
            assert.equal(m[0x506 + slot], expected, `${context}: native collision chooses defeat state`);
            assert.equal(m[0x54E + slot] & 128, 128, `${context}: native defeat immunity`);
            clearHazards(m);
            for(let i = 0; i < map.length; i++) m[0x700 + i] = map[i];

            const flips = new Set(), heights = new Set();
            let countdown = false;
            for(let i = 0; i < 180; i++) {
                assert.equal(m[0x56], 3, `${context}: harmless to player`);
                if(m[0x506 + slot] === 11) {
                    flips.add(m[0x46F + slot] & 0xC0); heights.add(m[0x433 + slot]);
                }
                if(m[0x506 + slot] === 13) { countdown = true; break; }
                nes.frame();
            }
            assert.ok(countdown, `${context}: native animation reaches respawn countdown`);
            if(expected === 11) {
                assert.ok(heights.size >= 8, `${context}: tumble moves visibly`);
                assert.deepEqual([...flips].sort((a, b) => a - b), [0, 64, 128, 192], `${context}: full tumble`);
            }
            assert.ok(m[0x57E + slot] >= 199, `${context}: full native delay begins`);
            // Keep the birthplace in view while the native camera catches
            // up; offscreen enemies deliberately have no projected sprite.
            m[0xC1] = birthPage; m[0xC2] = 64;
            const timers = new Set();
            let visibleAt = -1;
            for(let i = 0; i < 950; i++) {
                nes.frame(); timers.add(m[0x57E + slot]);
                assert.equal(m[0x56], 3, `${context}: respawn remains harmless`);
                assert.equal(m[0x4FE + slot], 12, `${context}: slot remains eligible to respawn`);
                assert.equal(m[0x576 + slot], spawn, `${context}: birth coordinate is retained`);
                assert.equal(m[pages + slot], birth, `${context}: birth page is retained`);
                if(m[0x506 + slot] === 1 && !(m[0x54E + slot] & 128) && m[0x415 + slot]) {
                    visibleAt = i; break;
                }
            }
            assert.ok(timers.has(100) && timers.has(1), `${context}: countdown runs completely`);
            assert.ok(visibleAt >= 790 && visibleAt < 950, `${context}: full delay ${visibleAt}`);
            assert.equal(m[0x50E + slot], birthPage, `${context}: returns to its birth page`);
            assert.ok(Math.abs(m[0x516 + slot] - ((spawn & 0xF0) | 6)) <= 1,
                `${context}: resumes its patrol at the birth column`);
            assert.equal(m[0x433 + slot], (spawn & 15) * 16 + 8, `${context}: returns to birth height`);
            assert.equal(m[0x546 + slot], m[0x433 + slot], `${context}: resets former target`);
            assert.equal(m[0x56E + slot], 0, `${context}: resets former half-step`);
            assert.equal(m[0x57E + slot], 0, `${context}: clears countdown on respawn`);
            assert.equal(nes.cpu.REG_SP, 0x1FF, `${context}: balanced native stack`);
        }
    });
}
