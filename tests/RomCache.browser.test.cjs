const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const test = require('node:test');

const playwrightPath = process.env.PLAYWRIGHT_MODULE;
const romPath = process.env.MOAIKUN_TEST_ROM;
const root = path.resolve(__dirname,'..');

// Real IndexedDB transactions and the actual app, using an isolated browser
// profile/origin. This never reads or changes the user's browser database.
for(const marked of [false,true]) {
test(`${marked ? 'versioned' : 'legacy'} cache migration, override and base replacement preserve the complete project`,
    {skip:!playwrightPath || !romPath,timeout:60000}, async()=>{
    const {chromium}=require(playwrightPath);
    const source=['Config','Level','RomFix','RomEditor','DataConverter','LevelFile']
        .map(name=>fs.readFileSync(path.join(root,'js',name+'.js'),'utf8')).join('\n');
    const {RomEditor,LevelFile}=new Function('i18n',source+'\nreturn {RomEditor,LevelFile};')({t:key=>key});
    const original=fs.readFileSync(romPath), editor=new RomEditor();editor.loadROM(original);
    const legacy=Buffer.from(editor.getROMData());
    if(!marked)legacy.fill(0,0x18010,0x1801A);
    const levels=editor.exportLevelsData().slice(0,2).reverse();levels.forEach((l,i)=>l.index=i);
    levels[0].data[0]=2;
    const project={levels,levelCount:2,romType:0,gameConfig:{cameraFollow:true,disableTimer:true,showRemainingRescueCount:false,customLevelAuthor:'QA AUTHOR'}};
    const drafts=[LevelFile.createLevelRecord(levels[1].data,levels[1].monsterData,{id:'qa-draft',name:'Retained draft'})];
    const server=http.createServer((req,res)=>{
        let target=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
        if(req.url==='/seed'){res.end('<!doctype html><title>Cache fixture</title>');return;}
        if(target===root)target=path.join(root,'index.html');
        if(!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
        try {
            const ext=path.extname(target),mime={'.js':'application/javascript','.css':'text/css','.html':'text/html'}[ext]||'application/octet-stream';
            res.setHeader('Content-Type',mime);res.end(fs.readFileSync(target));
        }catch{res.writeHead(404);res.end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
    const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
    // QA is offline and must not send analytics from fixture sessions.
    await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'
        ? route.continue() : route.fulfill({contentType:'application/javascript',body:'window.LA={init(){}};'}));
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const origin=`http://127.0.0.1:${server.address().port}`;
    try {
        await page.goto(origin+'/seed');
        await page.evaluate(async({rom,project,drafts})=>{
            const db=await new Promise((resolve,reject)=>{
                const r=indexedDB.open('MoaikunRomCache',2);
                r.onupgradeneeded=()=>r.result.createObjectStore('roms');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
            });
            await new Promise((resolve,reject)=>{
                const tx=db.transaction('roms','readwrite'),store=tx.objectStore('roms');
                store.put({data:Uint8Array.from(rom).buffer,fileName:'legacy.nes',timestamp:123},'lastRom');
                store.put(project,'levelData');store.put({backups:drafts},'backupLevels');
                tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
            });db.close();localStorage.setItem('moaikunTestLevelCameraFollow','true');
        },{rom:[...legacy],project,drafts});
        await page.goto(origin);
        await page.waitForFunction(()=>app?.romEditor?.levelCount===2&&app.needsRomMigration&&app.backupLevels.length===1);
        assert.equal(await page.evaluate(()=>app.romEditor.romIdentity.kind),marked?'current':'legacy');
        await page.waitForFunction(()=>!document.getElementById('testLevelBtn').disabled);
        const assertProject=async()=>{
            const actual=await page.evaluate(()=>({levels:app.romEditor.exportLevelsData(),count:app.romEditor.levelCount,
                settings:app.romEditor.getGameConfig(),drafts:app.backupLevels}));
            assert.equal(actual.count,2);assert.deepEqual(actual.levels.map(l=>l.data),levels.map(l=>l.data));
            assert.deepEqual(actual.settings,project.gameConfig);assert.equal(actual.drafts[0].id,'qa-draft');
        };
        await assertProject();
        assert.equal(await page.locator('#modifiedRomWarning').isVisible(),true);
        assert.equal(await page.locator('#testLevelOptionsBtn').count(),0);
        assert.equal(await page.locator('#romExpansionCheckbox').count(),0);
        assert.equal(await page.locator('#continueLegacyRomBtn').isVisible(),true);
        await page.locator('#continueLegacyRomBtn').click();
        await page.waitForFunction(()=>app.romPolicy?.forcedLegacy===true&&document.getElementById('continueLegacyRomBtn').hidden);
        assert.equal(await page.locator('#modifiedRomWarning').isVisible(),true);
        await page.reload();
        await page.waitForFunction(()=>app?.romEditor?.levelCount===2&&app.romPolicy?.forcedLegacy);
        await assertProject();
        assert.equal(await page.locator('#continueLegacyRomBtn').isVisible(),false);
        // The migration banner must remain readable with actions at phone width.
        await page.setViewportSize({width:375,height:812});
        const bounds=await page.locator('#modifiedRomWarning').evaluate(el=>({width:el.getBoundingClientRect().width,scroll:el.scrollWidth,
            color:getComputedStyle(el).color}));
        assert.ok(bounds.scroll<=bounds.width+1,'mobile banner must not overflow its container');
        assert.ok(await page.locator('#modifiedRomWarning').evaluate(el=>el.getBoundingClientRect().top>=0),
            'multiline warning must remain fully visible');
        const [red,green,blue]=bounds.color.match(/\d+/g).map(Number);
        assert.ok(red>green*2&&red>blue*2,'legacy warning is visibly red');
        if(process.env.QA_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.QA_SCREENSHOT_DIR,'moaikun-up-view-mobile.png')});
        await page.setViewportSize({width:1280,height:900});
        await page.evaluate(()=>{
            window.qaMessages=[];const show=app.showMessage.bind(app);
            app.showMessage=(...args)=>{qaMessages.push(args);show(...args);};
        });
        const upload=async buffer=>{
            const count=await page.evaluate(()=>qaMessages.length);
            await page.locator('#fileInput').setInputFiles({name:'replacement.nes',mimeType:'application/octet-stream',buffer});
            await page.waitForFunction(count=>qaMessages.length>count&&document.getElementById('fileInput').value==='',count);
        };
        await page.evaluate(()=>{app.replacingLegacyBase=true;});
        await upload(legacy);
        assert.equal(await page.evaluate(()=>qaMessages.at(-1)[0]),'error');await assertProject();
        // Abort a real multi-record IndexedDB write before completion.
        await page.evaluate(()=>{
            const db=app.romCache.db,transaction=db.transaction.bind(db);
            db.transaction=(...args)=>{
                const tx=transaction(...args);if(args[1]==='readwrite')queueMicrotask(()=>tx.abort());return tx;
            };window.restoreTransaction=()=>{db.transaction=transaction;};
        });
        await upload(original);
        assert.equal(await page.evaluate(()=>qaMessages.at(-1)[0]),'error');await assertProject();
        assert.equal(await page.evaluate(async()=>(await app.romCache.loadRom()).fileName),'legacy.nes');
        await page.evaluate(()=>restoreTransaction());
        // Capture a current unsaved change during replacement, not merely the
        // last saved cache snapshot. Exercise an artwork-only source variant.
        await page.evaluate(()=>{
            app.selectLevel(0,{skipUnsavedGuard:true});
            const current={mapData:[...app.romEditor.levels[0].data],monsterData:[1]};current.mapData[0]=3;
            app.hasUnsavedChanges=()=>true;app.getCurrentLevelRomData=()=>current;
        });
        const skin=Buffer.from(original);skin[0xAA70]^=0x55;
        await upload(skin);
        await page.waitForFunction(()=>!app.needsRomMigration&&app.fileName==='replacement.nes');
        await page.waitForFunction(()=>!document.getElementById('testLevelBtn').disabled);
        const result=await page.evaluate(async()=>({levels:app.romEditor.exportLevelsData(),count:app.romEditor.levelCount,
            settings:app.romEditor.getGameConfig(),drafts:app.backupLevels,cache:Array.from(new Uint8Array((await app.romCache.loadRom()).data)),
            outputSize:app.romEditor.getROMData().length,policy:await app.romCache.loadPolicy()}));
        assert.equal(result.count,2);assert.equal(result.levels[0].data[0],3);assert.deepEqual(result.levels[0].monsterData,[1]);
        assert.deepEqual(result.levels[1].data,levels[1].data);assert.deepEqual(result.settings,project.gameConfig);
        assert.equal(result.drafts[0].id,'qa-draft');assert.deepEqual(Buffer.from(result.cache),skin);
        assert.equal(result.outputSize,0x20010);assert.equal(result.policy.forcedLegacy,false);
        assert.equal(await page.locator('#modifiedRomWarning').isVisible(),false);
        const old=await page.evaluate(async()=>{
            const db=await new Promise(resolve=>{const r=indexedDB.open('MoaikunRomCache');r.onsuccess=()=>resolve(r.result);});
            const read=key=>new Promise(resolve=>{const r=db.transaction('roms').objectStore('roms').get(key);r.onsuccess=()=>resolve(r.result);});
            const rom=await read('lastRom'),levels=await read('levelData'),drafts=await read('backupLevels');db.close();
            return {data:Array.from(new Uint8Array(rom.data)),levels,drafts};
        });
        assert.deepEqual(Buffer.from(old.data),legacy);assert.deepEqual(old.levels,project);assert.deepEqual(old.drafts.backups,drafts);
        if(process.env.QA_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.QA_SCREENSHOT_DIR,'moaikun-up-view-desktop.png')});
        await page.reload();
        await page.waitForFunction(()=>app?.romEditor?.levelCount===2&&!app.needsRomMigration);
        assert.equal(await page.evaluate(()=>app.romEditor.levels[0].data[0]),3);
        assert.deepEqual(errors,[]);
        // Clearing V3 must not resurrect untouched old records on reload.
        await page.evaluate(async()=>{await app.romCache.clearCache();});await page.reload();
        await page.waitForFunction(()=>app?.romCache?.db);
        assert.equal(await page.evaluate(async()=>(await app.romCache.loadRom())) ,null);
        // A damaged cached source must not make independent levels disappear
        // or prevent uploading a replacement original.
        await page.evaluate(async({project,drafts})=>{
            await app.romCache.saveProject(new Uint8Array(100).buffer,'damaged.nes',project,drafts,{forcedLegacy:false});
        },{project,drafts});
        await page.reload();
        await page.waitForFunction(()=>app?.recoveryLevelData?.levelCount===2&&app.backupLevels.length===1);
        assert.equal(await page.evaluate(()=>app.romEditor.romData),null);
        await page.evaluate(()=>{
            window.qaMessages=[];const show=app.showMessage.bind(app);
            app.showMessage=(...args)=>{qaMessages.push(args);show(...args);};
        });
        await upload(original);
        await page.waitForFunction(()=>app.romEditor.levelCount===2&&app.romEditor.romData);
        await assertProject();
        assert.deepEqual(errors,[]);
    }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
}
