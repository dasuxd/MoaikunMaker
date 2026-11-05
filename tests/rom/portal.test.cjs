const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const jsnes = require('../../js/lib/jsnes.min.js');

const { BirdFish, GraphicsCatalog, LevelCodec, Portal, Project, SpritePatterns } = require('../helpers/source.cjs').load('BirdFish GraphicsCatalog LevelCodec Portal Project SpritePatterns');

const original = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;
const realTest = (name, body) => test(name, {skip: !original}, body);
const fixed = cpu => cpu - 0xC000 + 0x1C010;
const cell = (nes, x, y) => [0, 1, 32, 33].map(offset =>
    nes.ppu.vramMem[0x2000 + (x >> 4) * 0x400 + y * 64 + (x & 15) * 2 + offset]);
const portalTile = tile => tile >= 0xBB && tile <= 0xFF && (tile & 1);
const portalOam = (nes, memory = nes.ppu.spriteMem) => Array.from({length: 64}, (_, i) => memory.slice(i * 4, i * 4 + 4))
    .filter(([y, tile]) => y < 240 && portalTile(tile));

function stage({scene = 0, wide = false, camera = false, stone = false,
    enemies = [{enemyId: 13, x: 8, y: 11}], playerX = 3} = {}) {
    const editor = new Project(); editor.loadROM(original);
    editor.gameConfig.disableTimer = true; editor.gameConfig.cameraFollow = camera;
    const map = Array.from({length: 14}, () => Array(wide ? 32 : 16).fill(0));
    map[12].fill(5); map[1][2] = 15;
    if (stone) for (const enemy of enemies) if ((enemy.enemyId & 15) === 13) {
        map[enemy.y][enemy.x] = 10;
        if (enemy.y < 11) map[enemy.y + 1][enemy.x] = 5;
    }
    const data = LevelCodec.fromLevelEditorToROMData({background: scene | (wide ? 0x10 : 0),
        map, player: {x: playerX, y: 11}, door: {x: 14, y: 10}, enemies}, wide);
    editor.levels[0].data = data.mapData; editor.levels[0].monsterData = data.monsterData;
    editor.levelCount = 1;
    return editor.getROMData();
}

function start(data) {
    const nes = new jsnes.NES({onFrame() {}, emulateSound: false});
    nes.loadROM(Buffer.from(data).toString('binary'));
    for (let i = 0; i < 160; i++) nes.frame();
    nes.buttonDown(1, jsnes.Controller.BUTTON_START); nes.frame();
    nes.buttonUp(1, jsnes.Controller.BUTTON_START);
    for (let i = 0; i < 700; i++) {
        nes.frame(); const m = nes.cpu.mem;
        if (m[0x30] === 12 && m[0x56] === 3 && !(m[0x2A] & 128)) {
            for (let f = 0; f < 4; f++) nes.frame(); // Drain initial OAM DMA latency.
            return nes;
        }
    }
    assert.fail('START did not reach active gameplay');
}

function call(nes, entry, slot = 0) {
    const c = nes.cpu;
    c.REG_SP = 0x1FF; c.REG_PC = 0x7FFF; c.REG_X = slot; c.irqRequested = false;
    c.mem[0x8000] = 0x20; c.mem[0x8001] = entry & 255; c.mem[0x8002] = entry >> 8;
    for (let steps = 0; steps < 20000; steps++) {
        c.emulate();
        if (c.REG_PC === 0x8002) { assert.equal(c.REG_SP, 0x1FF); return; }
    }
    assert.fail(`Routine ${entry.toString(16)} did not return`);
}

test('portal patch preserves bird code and chains its renderer, with two 8x16 columns per frame', () => {
    const data = new Uint8Array(0x20010);
    const birdRenderer = BirdFish.addBirdFishAuxiliary(data);
    const before = data.slice(), oldRender = data[0x943] | data[0x944] << 8;
    const patch = Portal.addSpritePortalPreview(data, birdRenderer);
    assert.ok(patch.end <= 0xFC00);
    assert.deepEqual(data.slice(fixed(0xF0E2), fixed(0xF100)), before.slice(fixed(0xF0E2), fixed(0xF100)),
        'portal installation preserves the mapper NMI guard');
    assert.deepEqual(data.slice(fixed(0xF940), fixed(0xFB00)), before.slice(fixed(0xF940), fixed(0xFB00)));
    assert.deepEqual(data.slice(fixed(0xFD00), fixed(0xFDC2)), before.slice(fixed(0xFD00), fixed(0xFDC2)));
    assert.deepEqual(data.slice(fixed(patch.labels.previousRender), fixed(patch.labels.previousRender) + 3),
        Uint8Array.from([0x4C, oldRender & 255, oldRender >> 8]));
    assert.deepEqual(data.slice(0x8010, 0x10010), before.slice(0x8010, 0x10010));
    assert.deepEqual(GraphicsCatalog.RESOURCE_IMG_CONFIG.enemy_13.imgBlockIndex.map(row => row.map(t => t.index)),
        [[0xC0, 0xC2], [0xC1, 0xC3]]);
    assert.equal(GraphicsCatalog.RESOURCE_IMG_CONFIG.enemy_13.isSprite, true);
});

test('column packing keeps the moving rings, fills the interior and leaves the outside clear', () => {
    const src = Buffer.from(SpritePatterns.PORTAL_CHR_HEX, 'hex'), chr = SpritePatterns.getPortalBasePatterns();
    const pixel = (data, tile, x, y) => (data[tile * 16 + y] >> (7 - x) & 1)
        | (data[tile * 16 + y + 8] >> (7 - x) & 1) << 1;
    for (let frame = 0; frame < 4; frame++) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const sourceTile = frame * 4 + (y >> 3) * 2 + (x >> 3);
        const targetTile = SpritePatterns.PORTAL_FRAMES[frame][(y >> 3) * 2 + (x >> 3)] - 0xC0;
        const row = Array.from({length: 16}, (_, i) => pixel(src, frame * 4 + (y >> 3) * 2 + (i >> 3), i & 7, y & 7));
        const inside = x >= row.findIndex(Boolean) && x <= row.findLastIndex(Boolean);
        assert.equal(pixel(chr, targetTile, x & 7, y & 7), inside ? [3, 2, 1, 3][pixel(src, sourceTile, x & 7, y & 7)] : 0);
    }
});

realTest('occupied entrances show transparent numbered outlines and resume animation when cleared in every scene and camera mode', () => {
    for (let scene = 0; scene < 12; scene++) for (const camera of [false, true]) {
        const wide = scene % 2 === 1, x = 8, y = 11;
        const nes = start(stage({scene, wide, camera, stone: true,
            enemies: [{enemyId: 13 | 0x40, x, y}]}));
        const m = nes.cpu.mem, slot = m.slice(0x4FE, 0x506).indexOf(13);
        const context = `scene=${scene}, wide=${wide}, camera=${camera}`;
        const map = m.slice(0x700, 0x800), terrain = cell(nes, x, y), patterns = nes.ppu.vramMem.slice(0, 0x2000);
        const seen = new Set(), phases = new Set();
        for (let frame = 0; frame < 96; frame++) {
            nes.frame();
            const entries = portalOam(nes).sort((a, b) => a[3] - b[3]);
            assert.equal(entries.length, 2, context);
            const pair = entries.map(e => e[1]); seen.add(pair.join(','));
            assert.deepEqual(pair, SpritePatterns.getPortalFrameTiles(0, 6).slice(0, 2).map(t => t | 1), context);
            for (const [oamY, , attrs] of entries) {
                assert.equal(oamY, y * 16 + 7, `${context}: aligned with terrain`);
                assert.equal(attrs, 2, `${context}: exit sprite palette, foreground, no flips`);
            }
            phases.add(m[0x55E + slot]);
            assert.equal(m[Portal.PORTAL_RAM.visual + slot], 6, context);
            assert.equal(m[0x506 + slot], 1, context);
            assert.equal(m[0x56], 3, `${context}: harmless`);
            assert.equal(nes.cpu.REG_SP, 0x1FF, context);
            assert.deepEqual(cell(nes, x, y), terrain, `${context}: stone remains intact`);
        }
        assert.equal(seen.size, 1, `${context}: occupied outline remains steady`);
        assert.equal(phases.size, 4, `${context}: animation clock continues behind the outline`);
        assert.deepEqual(m.slice(0x700, 0x800), map, context);
        assert.deepEqual(nes.ppu.vramMem.slice(0, 0x2000), patterns, context);
        // Remove the occupied map nibble; the portal's own background queue
        // must repaint its cell and return to the original filled animation.
        m[0x700 + y * 16 + (x >> 1)] &= 15;
        const resumed = new Set();
        for (let frame = 0; frame < 40; frame++) {
            nes.frame();
            if (frame >= 8) {
                assert.equal(portalOam(nes).length, 0, context);
                const drawn = cell(nes, x, y);
                assert.ok(SpritePatterns.PORTAL_FRAMES.some(pose => pose.join() === drawn.join()), context);
                resumed.add(drawn.join());
            }
        }
        assert.ok(resumed.size >= 3, `${context}: empty entrance animates again`);
    }
});

test('all six animation poses retain a readable group numeral and share the original right column', () => {
    const schemes = SpritePatterns.getPortalColorSchemes(original || new Uint8Array(0x10010), 0);
    const patterns = SpritePatterns.getPortalPatterns(schemes), base = SpritePatterns.getPortalBasePatterns();
    const badges = [];
    for (let group = 0; group < 4; group++) {
        let badge;
        for (let frame = 0; frame < 6; frame++) {
            const [left, right] = SpritePatterns.getPortalFrameTiles(group, frame).map(tile => tile - GraphicsCatalog.SCENE_GRAPHICS_LAYOUT.portalStart);
            const pixels = [];
            for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) pixels.push(
                (patterns[left * 16 + y] >> (7 - x) & 1)
                | (patterns[left * 16 + y + 8] >> (7 - x) & 1) << 1);
            if (!badge) badge = pixels;
            assert.deepEqual(pixels, badge, `group ${group + 1}, frame ${frame}`);
            assert.deepEqual(patterns.slice(right * 16, right * 16 + 32), base.slice(frame * 64 + 32, frame * 64 + 64));
        }
        assert.deepEqual(new Set(badge), new Set([schemes[group].badgeInk, schemes[group].badgePaper]));
        assert.ok(!badge.includes(0));
        badges.push(badge.map(ink => Number(ink === schemes[group].badgeInk)).join());
    }
    assert.equal(new Set(badges).size, 4);
});

test('occupied outlines have transparent interiors, visible rims and opaque group badges in all scenes', () => {
    for (let scene = 0; scene < 12; scene++) {
        const patterns = SpritePatterns.getPortalPatterns(SpritePatterns.getPortalColorSchemes(
            original || new Uint8Array(0x10010), scene));
        for (let group = 0; group < 4; group++) {
            const tiles = SpritePatterns.getPortalFrameTiles(group, 6);
            const pixel = (x, y) => {
                const at = (tiles[(y >> 3) * 2 + (x >> 3)] - GraphicsCatalog.SCENE_GRAPHICS_LAYOUT.portalStart) * 16 + (y & 7);
                return (patterns[at] >> (7 - (x & 7)) & 1) | (patterns[at + 8] >> (7 - (x & 7)) & 1) << 1;
            };
            for (let y = 7; y < 13; y++) for (let x = 3; x < 13; x++) assert.equal(pixel(x, y), 0);
            for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) assert.notEqual(pixel(x, y), 0);
            assert.notEqual(pixel(15, 8), 0); assert.notEqual(pixel(8, 15), 0);
        }
    }
});

realTest('four groups preserve native palettes and their identity through background/overlay handoffs in every scene', () => {
    const enemies = Array.from({length: 8}, (_, i) => ({enemyId: 13 | ((i % 4) << 4),
        x: 2 + (i % 4) * 3, y: i < 4 ? 7 : 11}));
    for (let scene = 0; scene < 12; scene++) {
        const editor = new Project(); editor.loadROM(original); editor.gameConfig.disableTimer = true;
        const map = Array.from({length: 14}, () => Array(16).fill(0));
        map[12].fill(5); map[1][2] = 15;
        for (const p of enemies) if (p.y === 7) map[8][p.x] = 5; else map[11][p.x] = 10;
        const data = LevelCodec.fromLevelEditorToROMData({background: scene, map,
            player: {x: 14, y: 11}, door: {x: 14, y: 10}, enemies}, false);
        editor.levels[0].data = data.mapData; editor.levels[0].monsterData = data.monsterData;
        editor.levelCount = 1;
        const rom = editor.getROMData(), schemes = SpritePatterns.getPortalColorSchemes(original, scene);
        assert.deepEqual(SpritePatterns.getPortalColorSchemes(rom, scene), schemes);
        assert.equal(new Set(schemes.map(s => s.background)).size, 4);
        assert.equal(new Set(schemes.map(s => s.sprite)).size, 4);
        const ptr = original[0x564D + scene * 2] | original[0x564E + scene * 2] << 8;
        const at = ptr - 0x8000 + 16;
        if (scene === 3) {
            const nativeInks = [schemes[1], schemes[3]].map(s => [
                original[at + s.background * 4 + 1], original[at + 16 + s.sprite * 4 + 1]]);
            assert.deepEqual(nativeInks, [[0x25, 0x23], [0x19, 0x27]], '2 and 4 exchange both render palettes');
        }
        assert.deepEqual(Array.from(rom.slice(at + 0x18000, at + 0x18000 + 32)), Array.from(original.slice(at, at + 32)));
        const nes = start(rom), m = nes.cpu.mem;
        for (const count of [40, 320]) {
            for (let f = 0; f < count; f++) nes.frame();
            // Native water/fire animation rotates background palette 3.
            for (let i = 0; i < 32; i++) if (i % 4 && (i < 13 || i > 15)) assert.equal(nes.ppu.vramMem[0x3F00 + i], original[at + i],
                `scene ${scene}: native palette ink ${i}`);
            assert.deepEqual(Array.from(nes.ppu.vramMem.slice(0x3F0D, 0x3F10)).sort(),
                Array.from(original.slice(at + 13, at + 16)).sort(), `scene ${scene}: native animated palette`);
            for (let i = 0; i < enemies.length; i++) {
                const {x, y} = enemies[i], group = i % 4, slot = 7 - i, context = `scene ${scene}, door ${i}`;
                assert.equal(m[Portal.PORTAL_RAM.partner + slot], 7 - ((i + 4) % 8), context);
                const covered = m[Portal.PORTAL_RAM.overlay + slot];
                assert.equal(covered, Number(count === 40 ? i >= 4 : i < 4), context);
                if (covered) {
                    const oam = portalOam(nes).filter(e => e[0] === y * 16 + 7 && (e[3] === x * 16 || e[3] === x * 16 + 8))
                        .sort((a, b) => a[3] - b[3]);
                    assert.equal(oam.length, 2, context);
                    assert.ok([6]
                        .map(f => SpritePatterns.getPortalFrameTiles(group, f))
                        .some(t => oam[0][1] === t[0] + 1 && oam[1][1] === t[1] + 1), context);
                    for (const entry of oam) assert.equal(entry[2], schemes[group].sprite, context);
                } else {
                    assert.equal(m[0x415 + slot], 0, context);
                    assert.ok((m[Portal.PORTAL_RAM.role + slot] ? [6] : [0, 1, 2, 3, 4, 5])
                        .map(f => SpritePatterns.getPortalFrameTiles(group, f))
                        .some(t => t.join() === cell(nes, x, y).join()), context);
                    const attribute = nes.ppu.vramMem[0x23C0 + (y >> 1) * 8 + (x >> 1)];
                    assert.equal(attribute >> (((y & 1) * 2 + (x & 1)) * 2) & 3, schemes[group].background, context);
                }
            }
        }
    }
});

realTest('uncovered background portals match the overlay colors in all twelve scenes and both camera modes', () => {
    for (let scene = 0; scene < 12; scene++) for (const camera of [false, true]) {
        const nes = start(stage({scene, camera}));
        for (let f = 0; f < 32; f++) nes.frame();
        assert.equal(portalOam(nes).length, 0);
        assert.ok(SpritePatterns.PORTAL_FRAMES.some(frame => frame.join() === cell(nes, 8, 11).join()));
        const attribute = nes.ppu.vramMem[0x23C0 + (11 >> 1) * 8 + (8 >> 1)];
        const palette = (attribute >> 4) & 3;
        for (const ink of [1, 2]) assert.equal(nes.ppu.vramMem[0x3F00 + palette * 4 + ink],
            nes.ppu.vramMem[0x3F18 + ink], `scene ${scene}, ink ${ink}`);
        if (camera) assert.deepEqual(nes.ppu.vramMem.slice(0x2000, 0x23F8), nes.ppu.vramMem.slice(0x2400, 0x27F8));
    }
});

realTest('eight uncovered portals use background cells and no OAM, and freeze visibly during pause', () => {
    for (const camera of [false, true]) {
        const enemies = Array.from({length: 8}, (_, i) => ({enemyId: 13, x: 2 + (i % 4) * 3, y: i < 4 ? 6 : 9}));
        const nes = start(stage({scene: 8, camera, enemies})), m = nes.cpu.mem;
        for (let f = 0; f < 32; f++) nes.frame();
        for (let f = 0; f < 96; f++) {
            nes.frame(); assert.equal(portalOam(nes).length, 0);
            for (const enemy of enemies) assert.ok(SpritePatterns.PORTAL_FRAMES.some(frame =>
                frame.join() === cell(nes, enemy.x, enemy.y).join()));
        }
        nes.buttonDown(1, jsnes.Controller.BUTTON_START); nes.frame(); nes.buttonUp(1, jsnes.Controller.BUTTON_START);
        for (let f = 0; f < 30; f++) nes.frame();
        const timers = m.slice(0x55E, 0x56E);
        const background = enemies.map(enemy => cell(nes, enemy.x, enemy.y));
        for (let f = 0; f < 30; f++) nes.frame();
        assert.deepEqual(m.slice(0x55E, 0x56E), timers);
        assert.deepEqual(enemies.map(enemy => cell(nes, enemy.x, enemy.y)), background);
        assert.equal(portalOam(nes).length, 0, 'pause uses native player-only sprite display');
        nes.buttonDown(1, jsnes.Controller.BUTTON_START); nes.frame(); nes.buttonUp(1, jsnes.Controller.BUTTON_START);
        for (let f = 0; f < 120; f++) nes.frame();
        assert.equal(portalOam(nes).length, 0);
    }
});

realTest('camera projection hides the other screen and clips the left column at the viewport edge', () => {
    const nes = start(stage({wide: true, stone: true, enemies: [{enemyId: 13, x: 24, y: 11}]})), m = nes.cpu.mem;
    const slot = m.slice(0x4FE, 0x506).indexOf(13);
    const {labels} = Portal.addSpritePortalPreview(new Uint8Array(0x20010));
    for (const [camera, count, positions] of [[0, 0, []], [384, 2, [0, 8]], [392, 1, [0]], [400, 0, []]]) {
        m[0xFD] = camera & 255; m[0x9D] = camera >> 8;
        call(nes, labels.draw, slot); call(nes, 0x88D3);
        const entries = portalOam(nes, m.slice(0x200, 0x300)).sort((a, b) => a[3] - b[3]);
        assert.equal(entries.length, count, `camera ${camera}`);
        assert.deepEqual(entries.map(e => e[3]), positions, `camera ${camera}`);
    }
});

realTest('a crowded row retains native OAM rotation instead of permanently starving one portal', () => {
    const positions = [1, 3, 5, 7, 9, 11, 13, 15];
    const nes = start(stage({stone: true, enemies: positions.map(x => ({enemyId: 13, x, y: 7}))}));
    const seen = new Set();
    for (let frame = 0; frame < 64; frame++) {
        nes.frame();
        const entries = portalOam(nes);
        assert.equal(entries.length, 16);
        // JSNES renders all 64 entries; evaluate the actual NES eight-entry
        // scanline budget separately. This layout necessarily flickers.
        for (const entry of entries.slice(0, 8)) seen.add(entry[3]);
    }
    assert.deepEqual(seen, new Set(positions.flatMap(x => [x * 16, x * 16 + 8])));
});

realTest('bird and portal rendering coexist and saved ROMs re-export without byte drift', () => {
    const data = stage({enemies: [{enemyId: 12, x: 5, y: 7}, {enemyId: 13, x: 10, y: 11}], stone: true});
    const nes = start(data); for (let f = 0; f < 120; f++) nes.frame();
    const bird = nes.cpu.mem.slice(0x4FE, 0x506).indexOf(12);
    for (let f = 0; f < 64; f++) {
        nes.frame(); assert.equal(portalOam(nes).length, 2);
        assert.ok([0x2D, 0x2E].includes(nes.cpu.mem[0x415 + bird]));
        assert.ok(nes.ppu.spriteMem.some((v, i) => i % 4 === 1 && [0xAA, 0xAC, 0xAE, 0xB0].includes(v)));
    }
});
