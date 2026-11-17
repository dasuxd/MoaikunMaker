const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const jsnes = require('../../js/lib/jsnes.min.js');
const {Project,LevelCodec,Penguin} = require('../helpers/source.cjs').load('Project LevelCodec Penguin');
const original = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;

function start() {
    const p = new Project(); p.loadROM(original);
    p.gameConfig.disableTimer = true;
    const map = Array.from({length:14},() => Array(16).fill(0)), enemies = [];
    map[0][2] = 15;
    for (const row of [5,8,11,13]) {
        map[row].fill(5,4,12);
        enemies.push({enemyId:15,x:4,y:row-1},{enemyId:15|64,x:11,y:row-1});
    }
    const level = LevelCodec.fromLevelEditorToROMData({background:0,map,
        player:{x:8,y:12},door:{x:14,y:0},enemies},false);
    p.levels[0].data = level.mapData; p.levels[0].monsterData = level.monsterData; p.levelCount = 1;
    const n = new jsnes.NES({onFrame(){},emulateSound:true});
    n.loadROM(Buffer.from(p.getROMData()).toString('binary'));
    for (let i = 0; i < 160; i++) n.frame();
    n.buttonDown(1,jsnes.Controller.BUTTON_START); n.frame(); n.buttonUp(1,jsnes.Controller.BUTTON_START);
    for (let i = 0; i < 750; i++) {
        n.frame(); const m = n.cpu.mem;
        if (m[0x30] === 12 && m[0x56] === 3 && m.slice(0x506,0x50E).every(s => s === 1)) return n;
    }
    assert.fail('eight penguins did not reach active gameplay');
}

for (const forced of [true,false]) test(`eight penguins keep running with smoke NMIs: forced=${forced}`,{skip:!original},() => {
    const n = start(), c = n.cpu, m = c.mem;
    let injections = 0, renderVisits = 0, maxBuilding = 0, nativeNmis = 0, inNmi = false;
    const emulate = c.emulate;
    c.emulate = function() {
        const pc = this.REG_PC + 1;
        if (pc >= 0xF0E2 && pc < 0xF0F1) inNmi = true;
        if (inNmi && pc === 0x807F) {
            assert.equal(m[0x5EE],0,'native NMI must never enter bank-6 smoke bytes');
            nativeNmis++; inNmi = false;
        }
        if (inNmi && m[pc] === 0x40) inNmi = false;
        if (forced && pc === Penguin.BUILD_SMOKE_ENTRY && m[0x5EE] === 6 && ++renderVisits % 7 === 0) {
            this.requestIrq(this.IRQ_NMI); injections++;
        }
        return emulate.call(this);
    };
    let previousTick = m[0x1B];
    for (let frame = 1; frame <= (forced ? 1800 : 6000); frame++) {
        n.frame();
        maxBuilding = Math.max(maxBuilding,m.slice(Penguin.BUILD_SMOKE_CLOCK,Penguin.BUILD_SMOKE_CLOCK+8)
            .filter(clock => clock & 128).length);
        if (frame % 30 === 0) {
            assert.notEqual(m[0x1B],previousTick,`game clock froze at frame ${frame}, PC $${(c.REG_PC+1).toString(16)}`);
            previousTick = m[0x1B];
        }
    }
    assert.ok(maxBuilding >= 6,'several penguins build concurrently');
    assert.ok(nativeNmis >= 1500,'regular NMI updates keep running');
    if (forced) assert.ok(injections >= 100,'interrupt smoke repeatedly over a long run');
    assert.equal(m[0x30],12); assert.equal(m[0x56],3);
});
