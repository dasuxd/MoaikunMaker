const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const jsnes = require('../../js/lib/jsnes.min.js');
const {Project, LevelCodec, Hud, GraphicsCatalog, RomLayout} = require('../helpers/source.cjs')
    .load('Project LevelCodec Hud GraphicsCatalog RomLayout');
const patterns = require('../helpers/compiled-scene.cjs');
const source = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;
const realTest = (name, fn) => test(name, {skip: !source}, fn);
const layout = GraphicsCatalog.SCENE_GRAPHICS_LAYOUT;

function build(options = {}, original = source) {
    const project = new Project(); project.loadROM(original);
    Object.assign(project.gameConfig, {disableTimer: true, ...options});
    const map = Array.from({length: 14}, () => Array(16).fill(0));
    map[12].fill(5); map[10][3] = 5; map[1][2] = 15;
    const level = LevelCodec.fromLevelEditorToROMData({background: options.scene || 0, map,
        player: {x:3,y:11}, door: {x:14,y:10},
        enemies: Array.from({length:3}, () => ({enemyId:14,x:3,y:11}))}, false);
    project.levels[0].data = level.mapData; project.levels[0].monsterData = level.monsterData;
    project.levelCount = 1;
    return project.getROMData();
}

function machine(rom) {
    const nes = new jsnes.NES({onFrame(){}, emulateSound:false});
    nes.loadROM(Buffer.from(rom).toString('binary'));
    return nes;
}

function call(nes, address) {
    const c = nes.cpu; c.irqRequested = false; c.REG_PC = address - 1; c.REG_SP = 0x1FD;
    c.mem[0x1FE] = 0xFF; c.mem[0x1FF] = 0x7F;
    for (let i = 0; i < 20000; i++) {c.emulate(); if (c.REG_PC === 0x7FFF) return;}
    assert.fail('HUD routine did not return');
}

function draw(nes) {
    const m = nes.cpu.mem; m.fill(0xF8, 0x200, 0x300); m[4] = 0; m[7] = 63;
    call(nes, Hud.BRIDGE);
    return Array.from({length:64}, (_,i) => m.slice(0x200+i*4,0x204+i*4)).filter(s => s[0] !== 0xF8);
}
const sprite = (oam, x, y = 7) => oam.find(s => s[3] === x && s[0] === y);
const digit = n => 0xEA + n * 2;

realTest('all twelve scenes share HUD positions and preserve every boss tile and metasprite field', () => {
    const rom = build(), pages = [1,1,1,1,1,2,2,3,3,2,2,2];
    for (let scene = 0; scene < 12; scene++) {
        const art = patterns(rom, scene), base = 0x8010 + pages[scene] * 0x2000;
        const pair = tile => art.slice(tile*16,(tile+2)*16);
        assert.deepEqual(pair(layout.timerIcon), Uint8Array.from(source.slice(base+0xE60,base+0xE80)));
        assert.deepEqual(pair(layout.bombIcon), Uint8Array.from(source.slice(base+0xE80,base+0xEA0)));
        assert.deepEqual(pair(layout.remoteBombIcon), Hud.iconPatterns('remote'));
        assert.deepEqual(pair(layout.rescueIcon), Hud.iconPatterns('rescue'));
        assert.deepEqual(pair(layout.spawnSmoke), Uint8Array.from(source.slice(base+0xE40,base+0xE60)), 'native spawn smoke survives');
        assert.deepEqual(art.slice(0x500,0x600), Uint8Array.from(source.slice(base+0x500,base+0x600)),
            `scene ${scene}: smoke must not overwrite either half of the native player poses`);
        assert.deepEqual(art.slice(0xE00,0xE40), Uint8Array.from(source.slice(base+0xE00,base+0xE40)), 'both bat frames survive');
        if (scene === 7 || scene === 8)
            assert.deepEqual(art.slice(0xA80,0xDE0), Uint8Array.from(source.slice(base+0xAA0,base+0xE00)));
    }
    assert.equal(rom[RomLayout.programOffset(0xC0CB)],layout.spawnSmoke);
    for (const [cpu, count] of [[0xC1E5,8],[0xC206,8],[0xC227,8],[0xC248,9]]) {
        const old = source.slice(cpu-0x8000+16,cpu-0x8000+17+count*4);
        const current = rom.slice(RomLayout.programOffset(cpu),RomLayout.programOffset(cpu)+old.length);
        assert.equal(old[0], count);
        for (let i = 0; i < old.length; i++) assert.equal(current[i], i%4 === 2 ? old[i]-2 : old[i]);
    }
});

realTest('HUD switches icon and inventory together, counts held previews, and preserves timer/rescue options', () => {
    for (const disableTimer of [false,true]) for (const showRemainingRescueCount of [false,true]) {
        const nes = machine(build({disableTimer,showRemainingRescueCount,customLevelAuthor:'HUD TEST',cameraFollow:true}));
        const m = nes.cpu.mem; m[0xCE] = 27; m[0x43] = 142;
        m.fill(14,0x4FE,0x506); [1,2,3,2,0,3,1,2].forEach((s,i) => m[0x506+i] = s);
        m[0x55F] = 30; // Carried slot 1 is midway through a placement preview.
        for (const [clock, icon, count, palette] of [[0,layout.bombIcon,27,1],[119,layout.bombIcon,27,1],
            [120,layout.remoteBombIcon,3,2],[239,layout.remoteBombIcon,3,2]]) {
            m[Hud.CLOCK] = clock; const oam = draw(nes);
            assert.deepEqual(sprite(oam,0xD0), [7,icon,palette,0xD0]);
            assert.equal(sprite(oam,0xE0)[1],digit(Math.floor(count/10)));
            assert.equal(sprite(oam,0xE8)[1],digit(count%10));
            assert.equal(oam.length, showRemainingRescueCount ? 6 : 3);
            if (showRemainingRescueCount) {
                const x = disableTimer ? 0x98 : 0xD0, y = disableTimer ? 7 : 0x18;
                assert.deepEqual(sprite(oam,x,y),[y,layout.rescueIcon,3,x]);
                assert.equal(sprite(oam,x+16,y)[1],digit(9));
                assert.equal(sprite(oam,x+24,y)[1],digit(9));
            }
            assert.equal(m[0x5EE],0,'NMI guard restored');
            assert.equal(m[0x8000],nes.rom.rom[0][0],'bank 0 restored');
        }
        m[Hud.CLOCK] = 120; m.fill(0,0x4FE,0x506);
        const empty = draw(nes);
        assert.equal(sprite(empty,0xE0)[1],digit(0)); assert.equal(sprite(empty,0xE8)[1],digit(0));
        if (!disableTimer) {
            m[4] = 0; m[7] = 63; m[0x6F] = 3; m[0x70] = 2; m[0x71] = 1;
            call(nes,0xB6A4);
            assert.ok(Array.from({length:64},(_,i) => m.slice(0x200+i*4,0x204+i*4))
                .some(s => s[1] === layout.timerIcon && s[3] === 0x98));
        }
    }
});

realTest('rescue icon palette follows editable Tile 15 palette selection in every scene', () => {
    const edited = Uint8Array.from(source);
    for (let scene = 0; scene < 12; scene++) {
        const at = 0x3FF4 + scene*4 + 3;
        edited[at] = (edited[at]&0xFC) | (scene%4);
    }
    const snapshot = edited.slice(), rom = build({},edited);
    assert.deepEqual(edited,snapshot);
    for (let scene = 0; scene < 12; scene++) {
        const pointer = RomLayout.PALETTES_ADDRESS_ORIGINAL + 0x18000 + scene*2;
        const palette = RomLayout.programOffset(rom[pointer] | rom[pointer+1]<<8);
        assert.deepEqual(rom.slice(palette+29,palette+32),rom.slice(palette+(scene%4)*4+1,palette+(scene%4)*4+4));
    }
});

realTest('real gameplay alternates at 120 updates, pauses the clock, and resets on stage reload', () => {
    for (const scene of [0,7,8]) {
        const nes = machine(build({scene,cameraFollow:true})), m = nes.cpu.mem;
        for (let i = 0; i < 160; i++) nes.frame();
        nes.buttonDown(1,jsnes.Controller.BUTTON_START); nes.frame(); nes.buttonUp(1,jsnes.Controller.BUTTON_START);
        for (let i = 0; i < 700 && !(m[0x30]===12 && m[0x56]===3 && !(m[0x2A]&128)); i++) nes.frame();
        assert.equal(m[0x56],3);
        for (let i = 0; i < 10; i++) nes.frame();
        m[Hud.CLOCK] = 0;
        for (let i = 1; i <= 240; i++) {nes.frame(); assert.equal(m[Hud.CLOCK],i%240,`scene ${scene}, update ${i}`);}
        nes.buttonDown(1,jsnes.Controller.BUTTON_START); nes.frame(); nes.buttonUp(1,jsnes.Controller.BUTTON_START);
        for (let i = 0; i < 15; i++) nes.frame();
        assert.ok(m[0x2B]); const clock = m[Hud.CLOCK];
        for (let i = 0; i < 150; i++) nes.frame();
        assert.equal(m[Hud.CLOCK],clock);
        nes.buttonDown(1,jsnes.Controller.BUTTON_START); nes.frame(); nes.buttonUp(1,jsnes.Controller.BUTTON_START);
        for (let i = 0; i < 40 && m[Hud.CLOCK]===clock; i++) nes.frame();
        assert.notEqual(m[Hud.CLOCK],clock);
        // Native level initialization clears page 5, including our new byte.
        m[Hud.CLOCK] = 239; m[0x30] = 0; m[0x31] = 0;
        for (let i = 0; i < 500 && m[Hud.CLOCK]===239; i++) nes.frame();
        assert.ok(m[Hud.CLOCK] < 120);
    }
});
