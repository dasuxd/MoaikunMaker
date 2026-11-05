const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const {Project, PlaytestController, Level, LevelLayout} = require('../helpers/source.cjs')
    .load(['Project','PlaytestController','Level','LevelLayout']);
const original = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;
function setup() {
    const app = {project: new Project(), showMessage() {}};
    app.playtest = new PlaytestController(app);
    return {app};
}
test('rejected files leave the current base and edited project untouched', {skip: !original}, () => {
    const p = new Project();
    p.loadROM(original);
    p.setLevelCount(2);
    p.setGameConfig({cameraFollow:true});
    const bytes = p.romData.slice(), before = p.getROMData();
    for (const input of [before, new Uint8Array(10)]) {
        assert.throws(() => p.loadROM(input));
        assert.deepEqual(p.getROMData(), before);
        assert.deepEqual(p.romData, bytes);
    }
    const patched = Uint8Array.from(original);
    patched.set([0xA5,0x56,0xC9,0x03], 0x1B48);
    patched.set([0x4C,0xD9,0xFE], 0xB5F);
    assert.throws(() => p.loadROM(patched), /romRequiresOriginal/);
    assert.deepEqual(p.romData, Uint8Array.from(original));
    p.loadROM(Buffer.concat([original, Buffer.from('dump metadata')]));
    assert.deepEqual(p.romData, bytes);
});
test('map capacity includes exactly one delimiter per active level', () => {
    const first = new Level(0), second = new Level(1);
    const {entries, mapBytes} = LevelLayout.calculate([first,second], 2);
    assert.equal(entries[1].romAddress - entries[0].romAddress, first.data.length + 1);
    assert.equal(mapBytes, first.data.length + second.data.length + 2);
    assert.equal(LevelLayout.validate(2, LevelLayout.mapCapacity, 2), null);
    assert.ok(LevelLayout.validate(2, LevelLayout.mapCapacity + 1, 2));
});
test('level preview uses project settings and native START without changing downloaded bytes',
    {skip:!original},async()=>{
    for(const enabled of [false,true]) for(const wide of [false,true]) {
        const {app}=setup(); app.project.loadROM(original);
        app.project.setGameConfig({cameraFollow:enabled,disableTimer:true});
        const before=app.project.getROMData(), settings=app.project.getGameConfig();
        app.levelEditor={isWideScreen:wide};
        const map=Array.from({length:14},()=>Array(wide?32:16).fill(0)); map[12].fill(5); map[1][3]=15;
        app.getLevelEditorData=()=>({background:wide?16:0,player:{x:8,y:11},door:{x:11,y:10},map,enemies:[]});
        app.playtest.changeMode=()=>false;
        app.testLevelBtn={};app.saveBtn={};app.testBtn={};
        const calls=[];
        app.emulator={loadROM:data=>calls.push(data),quickStart:(...args)=>calls.push(args)};
        await app.playtest.testLevel();
        assert.equal(calls[0].length,0x20010);
        assert.deepEqual(calls[1],[],'no SELECT/loop menu override');
        assert.deepEqual(app.project.getGameConfig(),settings);
        assert.deepEqual(app.project.getROMData(),before);
    }
});
