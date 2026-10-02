const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function setup() {
    const controls = new Map(['modifiedRomWarning', 'continueLegacyRomBtn', 'fileInput']
        .map(id => [id, {hidden:false,classList:{remove(){}},click(){this.clicked=true;}}]));
    const document = { getElementById:id => controls.get(id), addEventListener(){} };
    const readerState = {};
    class FileReader {
        readAsArrayBuffer(file) {
            readerState.done = Promise.resolve().then(() => this.onload({target:{result:file.data}}));
        }
    }
    const source = ['Config','Level','RomFix','RomEditor','DataConverter','LevelFile','app']
        .map(name => fs.readFileSync(path.join(__dirname,'../js',`${name}.js`),'utf8')).join('\n');
    const classes = new Function('document','navigator','i18n','FileReader','requestAnimationFrame',
        `${source}\nreturn {App,RomEditor,Config,LevelFile};`)(document,{userAgent:''},
        {t:key=>key},FileReader,fn=>fn());
    const app = Object.create(classes.App.prototype);
    app.romEditor = new classes.RomEditor();
    app.backupLevels = [];
    app.currentLevel = 0;
    app.editorSource = 'formal';
    app.hasUnsavedChanges = () => false;
    app.messages = [];
    app.showMessage = (...args) => app.messages.push(args);
    app.renderBackupList = app.updateRecoveryExportVisibility = () => {};
    app.loadRomData = (_,name,__,editor) => {
        app.romEditor=editor; app.fileName=name;
        app.needsRomMigration=classes.RomEditor.needsBaseMigration(editor.romIdentity);
    };
    const writes = [];
    app.romCache = { async saveProject(...args) {writes.push(args);}, async savePolicy(){} };
    async function upload(data) {
        const target={files:[{name:'replacement.nes',data}],value:'selected'};
        app.handleFileSelect({target});
        await readerState.done;
        assert.equal(target.value,'');
    }
    return {...classes,app,controls,writes,upload};
}

const original = process.env.MOAIKUN_TEST_ROM ? fs.readFileSync(process.env.MOAIKUN_TEST_ROM) : null;
function projectFrom(editor) {
    return {levels:editor.exportLevelsData(),levelCount:editor.levelCount,gameConfig:editor.getGameConfig()};
}
function prepare() {
    const state=setup(), {app,LevelFile}=state;
    app.romEditor.loadROM(original);
    app.romEditor.setLevelCount(2);
    app.romEditor.setGameConfig({cameraFollow:true,disableTimer:true});
    app.backupLevels=[LevelFile.createLevelRecord(app.romEditor.levels[1].data,
        app.romEditor.levels[1].monsterData,{id:'draft-1',name:'saved draft'})];
    app.needsRomMigration=true;
    return state;
}

test('continuing a legacy ROM leaves a persistent warning without disabling the editor', async()=>{
    const {app,controls}=setup();
    app.needsRomMigration=true;
    app.replacingLegacyBase=true;
    await app.continueLegacyRom();
    assert.equal(app.replacingLegacyBase,false);
    assert.equal(controls.get('modifiedRomWarning').hidden,false);
    assert.equal(controls.get('continueLegacyRomBtn').hidden,true);
    app.requestOriginalRom();
    assert.equal(controls.get('fileInput').clicked,true);
    assert.equal(app.replacingLegacyBase,true);
});

test('replacement captures unsaved formal and draft edits without mutating the old project',
    {skip:!original},()=>{
    const {app}=prepare(), before=projectFrom(app.romEditor), savedDrafts=structuredClone(app.backupLevels);
    const map=[...app.romEditor.levels[0].data]; map[0]=2;
    app.hasUnsavedChanges=()=>true;
    app.getCurrentLevelRomData=()=>({mapData:map,monsterData:[1]});
    let captured=app.captureProjectForReplacement();
    assert.deepEqual(captured.project.levels[0].data,map);
    assert.deepEqual(projectFrom(app.romEditor),before);
    app.editorSource='draft'; app.currentDraftId='draft-1';
    captured=app.captureProjectForReplacement();
    assert.deepEqual(captured.drafts[0].mapData,map);
    assert.equal(captured.drafts[0].checksum,null);
    assert.deepEqual(app.backupLevels,savedDrafts);
});

test('replacing the base retains level order, inactive levels, drafts, settings and unsaved edits',
    {skip:!original},async()=>{
    const {app,upload,writes}=prepare(), before=projectFrom(app.romEditor);
    app.romEditor.levels.reverse();
    const map=[...app.romEditor.levels[0].data]; map[0]=2;
    app.hasUnsavedChanges=()=>true;
    app.getCurrentLevelRomData=()=>({mapData:map,monsterData:[1]});
    app.replacingLegacyBase=true;
    const source=Uint8Array.from(original).buffer, untouched=Buffer.from(source);
    await upload(source);
    assert.equal(writes.length,1);
    assert.deepEqual(Buffer.from(writes[0][0]),untouched,'cache source is pristine, not a modified header');
    assert.deepEqual(app.romEditor.levels[0].data,map);
    assert.deepEqual(app.romEditor.levels[1].data,before.levels.at(-2).data);
    assert.equal(app.romEditor.levelCount,2);
    assert.equal(app.romEditor.levels.length,56,'inactive levels survive');
    assert.equal(app.backupLevels[0].id,'draft-1');
    assert.equal(app.romEditor.gameConfig.cameraFollow,true);
    assert.equal(app.needsRomMigration,false);
    assert.equal(app.replacingLegacyBase,false);
    assert.equal(app.romEditor.getROMData().length,0x20010);
});

test('invalid replacement and failed cache commit retain the old visible project and drafts',
    {skip:!original},async()=>{
    for(const failure of ['truncated','patched','invalid-level','write']) {
        const {app,upload,writes}=prepare(), old=app.romEditor, drafts=app.backupLevels;
        const before=projectFrom(old);
        app.replacingLegacyBase=true;
        let data=Uint8Array.from(original).buffer;
        if(failure==='truncated') data=data.slice(0,100);
        if(failure==='patched') data=old.getROMData();
        if(failure==='invalid-level') app.captureProjectForReplacement=()=>({project:{...before,levelCount:127},drafts});
        if(failure==='write') app.romCache.saveProject=async()=>{throw new Error('quota');};
        await upload(data);
        assert.equal(app.romEditor,old,failure);
        assert.equal(app.backupLevels,drafts);
        assert.deepEqual(projectFrom(old),before);
        assert.equal(writes.length,0);
        assert.equal(app.messages.at(-1)[0],'error');
    }
});

test('recovery cache can be merged even when the old ROM cannot be parsed', {skip:!original},async()=>{
    const {app,upload,writes,RomEditor}=prepare();
    const cached=projectFrom(app.romEditor); cached.levels=cached.levels.slice(0,2);
    app.recoveryLevelData=cached; app.romEditor=new RomEditor(); app.needsRomMigration=false;
    await upload(original);
    assert.equal(writes.length,1);
    assert.equal(app.romEditor.levelCount,2);
    assert.deepEqual(app.romEditor.levels[1].data,cached.levels[1].data);
});

test('level preview uses project settings and native START without changing downloaded bytes',
    {skip:!original},async()=>{
    for(const enabled of [false,true]) for(const wide of [false,true]) {
        const {app}=setup(); app.romEditor.loadROM(original);
        app.romEditor.setGameConfig({cameraFollow:enabled,disableTimer:true});
        const before=app.romEditor.getROMData(), settings=app.romEditor.getGameConfig();
        app.levelEditor={isWideScreen:wide};
        const map=Array.from({length:14},()=>Array(wide?32:16).fill(0)); map[12].fill(5); map[1][3]=15;
        app.getLevelEditorData=()=>({background:wide?16:0,player:{x:8,y:11},door:{x:11,y:10},map,enemies:[]});
        app.changeMode=()=>false;
        app.testLevelBtn={};app.saveBtn={};app.testBtn={};
        const calls=[];
        app.emulator={loadROM:data=>calls.push(data),quickStart:(...args)=>calls.push(args)};
        await app.testLevel();
        assert.equal(calls[0].length,0x20010);
        assert.deepEqual(calls[1],[],'no SELECT/loop menu override');
        assert.deepEqual(app.romEditor.getGameConfig(),settings);
        assert.deepEqual(app.romEditor.getROMData(),before);
    }
});
