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
const realTest = (name, body) => test(name, { skip: !original }, body);

function stage(scene = 0, wide = false, extraTiles = [], punchColumn = 3) {
    const editor = new RomEditor(); editor.loadROM(original);
    editor.gameConfig.cameraFollow = true; editor.gameConfig.disableTimer = true;
    const map = Array.from({ length: 14 }, () => Array(wide ? 32 : 16).fill(0));
    map[12].fill(5); map[1][2] = 15; map[11][punchColumn] = 13;
    for(const [x, y, tile] of extraTiles) map[y][x] = tile;
    const converted = DataConverter.fromLevelEditorToROMData({
        background: scene | (wide ? 0x10 : 0), map,
        player: { x: 2, y: 11 }, door: { x: 14, y: 10 },
        enemies: [{ enemyId: 1, x: 12, y: 11 },
            { enemyId: 12, x: 8, y: 6 },
            { enemyId: 12, x: wide ? 24 : 10, y: 8 }]
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
            for(let j = 0; j < 160; j++) nes.frame();
            return nes;
        }
    }
    assert.fail('START did not reach active gameplay');
}

function birds(m) {
    return Array.from({ length: 8 }, (_, slot) => slot).filter(slot => m[0x4FE + slot] === 12);
}

function punch(nes, worldX = 40, y = 184) {
    const m = nes.cpu.mem;
    // Place the player beside the real Tile 13, then let the native input,
    // headbutt, tile collision and global enemy update process the B press.
    m[0xC1] = worldX >> 8; m[0xC2] = worldX & 255; m[0x41E] = y; m[0x7D] = 0;
    m[0xCB] = 4; m[0xC0] = 1; m[0xC4] = m[0xC7] = m[0xC8] = 0;
    nes.buttonDown(1, jsnes.Controller.BUTTON_B); nes.frame();
    nes.buttonUp(1, jsnes.Controller.BUTTON_B);
}

function placeBird(m, slot, worldX, y, facing) {
    m[0x50E + slot] = worldX >> 8;
    m[0x516 + slot] = m[0x526 + slot] = worldX & 255;
    m[0x433 + slot] = m[0x546 + slot] = y;
    m[0x556 + slot] = facing;
    m[0x53E + slot] = m[0x56E + slot] = m[0x57E + slot] = 0;
    for(const address of Object.values(Romfix.BIRD_RAM)) m[address + slot] = 0;
}

for(const [scene, wide] of [[0, false], [4, true]]) {
    realTest(`real Tile 13 punches lift every bird/fish once and turn them away: scene=${scene}, wide=${wide}`, () => {
        const worldX = wide ? 264 : 40;
        const nes = start(stage(scene, wide, [], wide ? 17 : 3)), m = nes.cpu.mem;
        const slots = birds(m), ordinary = m.slice(0x4FE, 0x506).indexOf(1);
        assert.equal(slots.length, 2);
        // The wide fixture straddles world X=256, including the bird whose
        // coordinate page differs from the player at the instant of impact.
        const positions = wide ? [250, 296] : [20, 80];
        const heights = [136, 104];
        slots.forEach((slot, index) => placeBird(m, slot, positions[index], heights[index], index ? 3 : 4));
        assert.equal(m[0x506 + ordinary], 1, 'ordinary comparison enemy starts live');

        punch(nes, worldX);
        assert.equal(m[0x506 + ordinary], 12, 'the real tile impact retains ordinary enemy vulnerability');
        slots.forEach((slot, index) => {
            assert.equal(m[0x506 + slot], 1, 'bird/fish bypass native vulnerable state 12');
            assert.equal(m[0x546 + slot], heights[index] - 16, 'one event commits one tile upward');
            assert.ok(m[0x433 + slot] === heights[index] || m[0x433 + slot] === heights[index] - 1,
                'the triggering frame starts the rise without a 16-pixel teleport');
            assert.equal(m[0x556 + slot], index ? 4 : 3, 'a bird facing the player turns away');
            assert.equal(m[0x56E + slot], 0, 'event clears temporary descent');
            assert.equal(m[0x57E + slot], 0, 'event clears recovery timer');
        });
        let previous = slots.map(slot => m[0x433 + slot]);
        for(let frame = 0; frame < 120; frame++) {
            nes.frame();
            slots.forEach((slot, index) => {
                const height = m[0x433 + slot];
                assert.ok(height === previous[index] || height === previous[index] - 1,
                    'native patrol eases upward without jumping or falling');
                assert.equal(m[0x506 + slot], 1, 'live bird remains outside native stun AI');
                assert.equal(m[0x546 + slot], heights[index] - 16, 'the event cannot repeat on later frames');
                previous[index] = height;
            });
            assert.equal(m[0x56], 3, 'the tile impact remains harmless to the player');
        }
        slots.forEach((slot, index) => assert.equal(m[0x433 + slot], heights[index] - 16,
            'the elevated checkpoint persists after the old half-step recovery window'));

        punch(nes, worldX);
        slots.forEach((slot, index) => assert.equal(m[0x546 + slot], heights[index] - 32,
            'a second real B impact raises the same bird one more tile'));
        assert.equal(nes.cpu.REG_SP, 0x1FF, 'the event preserves the native stack');
    });
}

realTest('real Tile 13 impacts lift a settled half-step and remove birds at the top screen edge', () => {
    const nes = start(stage()), m = nes.cpu.mem, slots = birds(m);
    placeBird(m, slots[0], 120, 112, 4);
    m[0x546 + slots[0]] = 104; m[0x56E + slots[0]] = 8; m[0x57E + slots[0]] = 60;
    placeBird(m, slots[1], 160, 16, 4);
    punch(nes);
    assert.equal(m[0x546 + slots[0]], 96, 'the actual half-step checkpoint rises exactly one tile');
    assert.equal(m[0x56E + slots[0]], 0);
    assert.equal(m[0x57E + slots[0]], 0);
    assert.equal(m[0x546 + slots[1]], 0, 'the first impact targets the top screen edge');
    assert.equal(m[Romfix.BIRD_RAM.targetHigh + slots[1]], 0);
    for(let frame = 0; frame < 120; frame++) nes.frame();
    assert.equal(m[0x433 + slots[0]], 96, 'cleared recovery state cannot pull the bird back down');
    assert.equal(m[0x433 + slots[1]], 0);
    assert.equal(m[0x506 + slots[1]], 13, 'the invisible top-edge bird enters the ordinary respawn wait');
    assert.equal(m[0x415 + slots[1]], 0, 'the departed bird has no live metasprite or invisible platform');
    const deadTarget = m[0x546 + slots[1]];
    punch(nes);
    assert.equal(m[0x546 + slots[1]], deadTarget, 'further impacts cannot move the dead bird target');
    assert.equal(m[Romfix.BIRD_RAM.targetHigh + slots[1]], 0, 'the departed bird keeps its private state reset');
    assert.equal(m[0x506 + slots[1]], 13, 'further impacts preserve the ordinary respawn wait');
});

realTest('real Tile 13 impact leaves bird/fish spawn smoke and defeated respawn states alone', () => {
    const nes = start(stage()), m = nes.cpu.mem, slots = birds(m);
    const [smoke, dead] = slots;
    placeBird(m, smoke, 120, 104, 3);
    m[0x506 + smoke] = 0; m[0x55E + smoke] = 0; m[0x566 + smoke] = 1;
    placeBird(m, dead, 160, 136, 4);
    m[0x506 + dead] = 13; m[0x57E + dead] = 100; m[0x546 + dead] = 0x55;
    punch(nes);
    assert.equal(m[0x506 + smoke], 0, 'smoke keeps its ordinary appearance clock');
    assert.equal(m[0x546 + smoke], 104, 'smoke has no live flight target to raise');
    assert.equal(m[0x556 + smoke], 3, 'smoke does not react to the player direction');
    assert.equal(m[0x506 + dead], 13, 'defeated bird stays in the native respawn countdown');
    assert.equal(m[0x546 + dead], 0x55, 'native defeat RAM is not overwritten by a lift');
    assert.ok(m[0x57E + dead] >= 99 && m[0x57E + dead] <= 100);
});

realTest('real Tile 13 impacts choose the shortest wrapped escape and preserve tied directions', () => {
    for(const wide of [false, true]) {
        const data = stage(wide ? 4 : 0, wide), initial = start(data).toJSON();
        const cases = wide ? [
            [500, 4, 3, 'across the world boundary on the left'],
            [300, 4, 3, 'across both coordinate pages by the shorter route'],
            [280, 4, 4, 'far away on the right'],
            [40, 3, 3, 'same X retains left'],
            [40, 4, 4, 'same X retains right'],
            [296, 3, 3, 'half-map tie retains left'],
            [296, 4, 4, 'half-map tie retains right']
        ] : [
            [240, 4, 3, 'across the world boundary on the left'],
            [100, 4, 4, 'already flying away on the right'],
            [20, 3, 3, 'already flying away on the left'],
            [40, 3, 3, 'same X retains left'],
            [40, 4, 4, 'same X retains right'],
            [168, 3, 3, 'half-map tie retains left'],
            [168, 4, 4, 'half-map tie retains right']
        ];
        for(const [x, facing, expected, description] of cases) {
            const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, emulateSound: false });
            nes.loadROM(Buffer.from(data).toString('binary'));
            nes.fromJSON(JSON.parse(JSON.stringify(initial)));
            const m = nes.cpu.mem, slot = birds(m)[0];
            placeBird(m, slot, x, 104, facing);
            punch(nes);
            assert.equal(m[0x506 + slot], 1, `wide=${wide}: live patrol after impact`);
            assert.equal(m[0x546 + slot], 88, `wide=${wide}: global event reaches ${description}`);
            assert.equal(m[0x556 + slot], expected, `wide=${wide}: ${description}`);
            // Move only the grounded player's checkpoint to the other side.
            // Escape direction is chosen on impact, then ordinary patrol owns it.
            const opposite = (x + (expected === 3 ? -32 : 32) + (wide ? 512 : 256)) % (wide ? 512 : 256);
            m[0xC1] = opposite >> 8; m[0xC2] = opposite & 255;
            for(let frame = 0; frame < 3; frame++) nes.frame();
            assert.equal(m[0x556 + slot], expected, `wide=${wide}: the bird does not continuously flee or follow`);
        }
    }
});

realTest('real Tile 13 lift waits beneath solid ceilings without sending the bird through them', () => {
    const roof = Array.from({ length: 16 }, (_, x) => [x, 5, 5]);
    const nes = start(stage(0, false, roof)), m = nes.cpu.mem, slot = birds(m)[0];
    placeBird(m, slot, 136, 104, 4);
    punch(nes);
    assert.equal(m[0x546 + slot], 88, 'the event records the one-tile upward destination');
    for(let frame = 0; frame < 60; frame++) {
        nes.frame();
        assert.equal(m[0x506 + slot], 1, 'the protected bird remains alive');
        assert.equal(m[0x433 + slot], 104, 'its leading edge stays below the solid ceiling');
        assert.equal(m[0x546 + slot], 88, 'the obstruction cannot multiply the upward command');
    }
    // Clear only this real map row: the existing flight update should resume
    // the same recorded step when native terrain probing sees open space.
    m.fill(0, 0x750, 0x758);
    for(let frame = 0; frame < 20; frame++) nes.frame();
    assert.equal(m[0x433 + slot], 88, 'clearing the ceiling resumes the original one-tile rise');
});

realTest('a real Tile 13 punch while riding lifts the player and respects the player ceiling probe', () => {
    for(const ceiling of [false, true]) {
        const tiles = [[3, 7, 13]];
        if(ceiling) for(let x = 0; x < 16; x++) tiles.push([x, 6, 5]);
        const nes = start(stage(0, false, tiles)), m = nes.cpu.mem, slot = birds(m)[0];
        placeBird(m, slot, 40, 136, 3);
        m[0x53E + slot] = 1;
        // The tile sits beside the standing player's head, so actual B can
        // trigger the global event while the player remains on the bird.
        punch(nes, 40, 120);
        assert.equal(m[0x546 + slot], 120, `ceiling=${ceiling}: one upward destination`);
        assert.equal(m[0x506 + slot], 1, 'the rider cannot knock the supporting bird into weakness');
        for(let frame = 0; frame < 22; frame++) {
            nes.frame();
            assert.equal(m[0x56], 3, 'lifting remains safe for the rider');
            assert.equal(m[0x53E + slot], 1, 'the standing rider follows the ascending carrier');
            assert.equal(m[0x41E], m[0x433 + slot] - 16, 'player and bird retain the same support offset');
            if(ceiling) assert.equal(m[0x433 + slot], 136, 'the rider head blocks ascent before any penetration');
        }
        assert.equal(m[0x433 + slot], ceiling ? 136 : 120, 'the open lift finishes and the covered lift waits');
        if(ceiling) {
            m.fill(0, 0x760, 0x768);
            for(let frame = 0; frame < 20; frame++) nes.frame();
            assert.equal(m[0x433 + slot], 120, 'clearing the player ceiling resumes the same upward step');
            assert.equal(m[0x41E], 104);
        }
    }
});
