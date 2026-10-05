const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const test = require('node:test');

const playwrightPath = process.env.PLAYWRIGHT_MODULE;
const root = path.resolve(__dirname, '..');

test('real browser remembers settings and records across reload, restart, failed commit, imports and two tabs',
    { skip: !playwrightPath, timeout: 60000 }, async () => {
    const { chromium } = require(playwrightPath);
    const fixture = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
        <title>RAM recorder QA</title><link rel="stylesheet" href="/css/style.css"></head><body>
        <main style="max-width:1000px;margin:20px auto"><section id="gameConfigPanel" style="padding:20px;background:white"></section></main>
        <script src="/js/lib/jsnes.min.js"></script><script src="/js/RamRecorder.js"></script>
        <script src="/js/NesEmulator.js"></script><script src="/js/RomCache.js"></script>
        <script>const i18n={currentLang:'zh-CN',t:key=>key};
        const app={testMode:true,mobileController:{},showMessage(){},romEditor:{getGameConfig(){return {cameraFollow:true}}}};
        function makeTestEmulator() {
            const bytes=new Uint8Array(16+2*0x4000);
            bytes.set([0x4e,0x45,0x53,0x1a,2,0,0x21]);
            bytes.set([0xa9,7,0x85,0x60,0x4c,0,0x80],16);
            bytes.set([0,0x80,0,0x80,0,0x80],bytes.length-6);
            const emulator=Object.create(NesEmulator.prototype);
            emulator.nes=new jsnes.NES({onFrame(){},emulateSound:false});
            emulator.quickSaveSlots=Array(4).fill(null);emulator.runGeneration=0;
            emulator.isRunning=true;emulator.isPaused=false;
            emulator.loadROM(bytes);emulator.nes.cpu.irqRequested=false;emulator.nes.cpu.REG_PC=0x7fff;
            window.testEmulator=emulator; return emulator;
        }
        function runInstructions(count) {for(let i=0;i<count;i++)testEmulator.nes.cpu.emulate()}
        </script></body></html>`;
    const server=http.createServer((req,res)=>{
        if(req.url==='/fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);return;}
        const target=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
        if(!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
        try {res.setHeader('Content-Type',target.endsWith('.js')?'application/javascript':target.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(target));}
        catch {res.writeHead(404);res.end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const tempRoot=path.resolve(os.tmpdir());
    const profile=fs.mkdtempSync(path.join(tempRoot,'moaikun-ram-qa-'));
    const launch=()=>chromium.launchPersistentContext(profile,{headless:true,viewport:{width:1200,height:850},
        ...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
    let context;
    const errors=[];
    const url=`http://127.0.0.1:${server.address().port}/fixture`;
    try {
        context=await launch();
        let page=context.pages()[0];
        page.on('pageerror',error=>errors.push(error.message));
        await page.goto(url);
        const appPage=await context.newPage();
        appPage.on('pageerror',error=>errors.push(error.message));
        await appPage.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'
            ? route.continue() : route.fulfill({contentType:'application/javascript',body:'window.LA={init(){}};'}));
        await appPage.goto(url.replace('/fixture','/index.html'));
        await appPage.waitForSelector('#ramRecorderControls',{state:'attached'});
        assert.equal(await appPage.locator('#ramRecordingEnabled').isChecked(),false);
        await appPage.close();
        assert.equal(await page.locator('#ramRecordingEnabled').isChecked(),false);
        await page.evaluate(()=>makeTestEmulator());
        assert.equal(await page.evaluate(()=>RamRecorder.instance.tracker),null);
        await page.selectOption('#ramRecordingMode','boot');
        await page.check('#ramRecordingEnabled');
        await page.evaluate(async()=>{runInstructions(2);await RamRecorder.instance.tracker.ready;await RamRecorder.instance.flush()});
        const first=await page.evaluate(async()=>({id:RamRecorder.instance.tracker.metadata.id,
            counts:RamRecorder.aggregate(await RamRecorder.instance.records()).writes[0x60]}));
        assert.equal(first.counts,1);
        assert.equal(await page.evaluate(()=>RamRecorder.instance.tracker.lastValues[0x60]),7);
        // Actual emulator save/load hooks must suppress copying and reattach to
        // the fresh cpu.mem array without rolling counters back.
        await page.evaluate(()=>{testEmulator.quickSave(1);runInstructions(3);testEmulator.quickLoad(1);runInstructions(3)});
        assert.equal(await page.evaluate(()=>RamRecorder.instance.tracker.counts.writes[0x60]),3);
        await page.evaluate(()=>RamRecorder.instance.flush());
        await page.reload();
        assert.equal(await page.locator('#ramRecordingEnabled').isChecked(),true);
        assert.equal(await page.inputValue('#ramRecordingMode'),'boot');
        assert.equal(await page.evaluate(async()=>RamRecorder.aggregate(await RamRecorder.instance.records()).writes[0x60]),3);
        assert.equal(await page.evaluate(async()=>RamRecorder.latestValues(await RamRecorder.instance.records()).values[0x60]),7);
        await page.evaluate(()=>makeTestEmulator());
        await page.evaluate(async()=>{runInstructions(2);await RamRecorder.instance.tracker.ready;await RamRecorder.instance.flush()});
        assert.equal(await page.evaluate(async()=>RamRecorder.aggregate(await RamRecorder.instance.records()).writes[0x60]),4);
        // A project-cache clear is unrelated to the recorder's independent DB.
        await page.evaluate(()=>RomCache.getInstance().clearCache());
        assert.equal(await page.evaluate(async()=>RamRecorder.aggregate(await RamRecorder.instance.records()).writes[0x60]),4);
        // Force IDB failure while a synchronous localStorage checkpoint remains.
        await page.evaluate(async()=>{
            RamRecorder.instance.store.put=async()=>{throw new Error('injected commit failure')};
            runInstructions(3);await RamRecorder.instance.flush();
        });
        assert.match(await page.locator('#ramRecordingStatus').textContent(),/injected commit failure/);
        assert.ok(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith(RamRecordingStore.JOURNAL_PREFIX))));
        await page.reload();
        assert.equal(await page.evaluate(async()=>RamRecorder.aggregate(await RamRecorder.instance.records()).writes[0x60]),5);
        assert.equal(await page.evaluate(async()=>RamRecorder.latestValues(await RamRecorder.instance.records()).values[0x60]),7);
        assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith(RamRecordingStore.JOURNAL_PREFIX)).length),0);
        // Shut down and relaunch an isolated real browser profile, not just a tab.
        await context.close();
        context=await launch();page=context.pages()[0];
        page.on('pageerror',error=>errors.push(error.message));
        await page.goto(url);
        assert.equal(await page.locator('#ramRecordingEnabled').isChecked(),true);
        assert.equal(await page.evaluate(async()=>RamRecorder.aggregate(await RamRecorder.instance.records()).writes[0x60]),5);
        assert.equal(await page.evaluate(async()=>RamRecorder.latestValues(await RamRecorder.instance.records()).values[0x60]),7);
        // Independent session keys preserve concurrent observations from two tabs.
        const second=await context.newPage();second.on('pageerror',error=>errors.push(error.message));
        await second.goto(url);
        await Promise.all([page,second].map(p=>p.evaluate(async()=>{
            makeTestEmulator();runInstructions(2);await RamRecorder.instance.tracker.ready;await RamRecorder.instance.flush();
        })));
        assert.equal(await page.evaluate(async()=>RamRecorder.aggregate(await RamRecorder.instance.records()).writes[0x60]),7);
        await page.click('#ramRecordingView');
        await page.waitForFunction(()=>Boolean(RamRecorder.instance.ui.counts));
        const cell=address=>page.locator(`#ramRecordingMap .ram-byte[data-address="${address}"]`);
        assert.equal(await page.locator('#ramRecordingMap .ram-byte').count(),2048);
        assert.equal(await page.locator('#ramRecorderDialog table').count(),0);
        assert.equal(await page.locator('#ramRecordingMap .ram-map-address').count(),128);
        const positions=await page.evaluate(()=>[0,15,16,31].map(address=>{
            const rect=document.querySelector(`.ram-byte[data-address="${address}"]`).getBoundingClientRect();
            return {x:rect.x,y:rect.y};
        }));
        assert.equal(positions[0].y,positions[1].y);
        assert.equal(positions[2].y,positions[3].y);
        assert.ok(positions[2].y>positions[0].y);
        assert.equal(positions[0].x,positions[2].x);
        assert.equal(await cell(0x60).textContent(),'07');
        assert.equal(await cell(0x62).textContent(),'--');
        assert.equal(await page.evaluate(()=>testEmulator.isPaused),true);
        // Add a startup-only write to the detached display fixture, not the
        // saved recordings. Gray and yellow must both be counted and visible.
        await page.evaluate(()=>{
            RamRecorder.instance.ui.records[0].counts.loadingWrites[0x61]=1;
            RamRecorder.instance.ui.records[0].lastValues[0x61]=255;
            RamRecorder.instance.ui.records[0].lastValueTimes[0x61]=Date.now();
            RamRecorder.instance.renderView();
        });
        assert.match(await page.locator('#ramRecordingSummary').textContent(),/浅灰 \d+ \+ 黄色 1/);
        const color=address=>cell(address).evaluate(element=>getComputedStyle(element).backgroundColor);
        assert.equal(await color(0x61),'rgb(251, 191, 36)');
        assert.equal(await color(0x62),'rgb(226, 232, 240)');
        assert.equal(await cell(0x61).textContent(),'FF');
        const summary=await page.locator('#ramRecordingSummary').textContent();
        await page.click('#ramMapCandidatesOnly');
        assert.equal(await color(0x60),'rgb(0, 0, 0)');
        assert.equal(await color(0x100),'rgb(0, 0, 0)');
        assert.equal(await color(0x61),'rgb(251, 191, 36)');
        assert.equal(await color(0x62),'rgb(226, 232, 240)');
        await page.uncheck('#ramMapFilter-loading');
        assert.equal(await color(0x61),'rgb(0, 0, 0)');
        await page.check('#ramMapFilter-loading');
        assert.equal(await page.locator('#ramRecordingSummary').textContent(),summary);
        assert.equal(await page.locator('#ramRecordingMap .ram-byte').count(),2048);
        assert.equal(await page.evaluate(async()=>RamRecorder.aggregate(await RamRecorder.instance.records()).writes[0x60]),7);
        await page.click('#ramRecordingMeaningTitle');
        assert.match(await page.locator('#ramRecordingMeanings').textContent(),/黄色与浅灰一起计入待核查候选/);
        await cell(0x100).click();
        assert.match(await page.locator('#ramRecordingDetail').textContent(),/CPU 固定栈地址范围/);
        await page.click('#ramRecordingMeaningTitle');
        await cell(0x61).click();
        assert.match(await page.locator('#ramRecordingDetail').textContent(),/最后观察数值: \$FF \(255\)/);
        await cell(0x60).click();
        assert.match(await page.locator('#ramRecordingDetail').textContent(),/B0 \$8002/);
        assert.match(await page.locator('#ramRecordingDetail').textContent(),/最后观察数值: \$07 \(7\)/);
        await cell(0x60).press('ArrowDown');
        assert.equal(await cell(0x70).getAttribute('aria-pressed'),'true');
        assert.match(await page.locator('#ramRecordingDetail').textContent(),/\$0070/);
        await cell(0x70).press('ArrowUp');
        assert.equal(await cell(0x60).getAttribute('aria-pressed'),'true');
        const downloadPromise=page.waitForEvent('download');
        await page.click('#ramRecordingExport');
        const download=await downloadPromise;
        const backup=fs.readFileSync(await download.path());
        assert.equal(JSON.parse(backup).format,'moaikun-ram-recording');
        await page.setInputFiles('#ramRecordingImportFile',{name:'ram-backup.json',mimeType:'application/json',buffer:backup});
        await page.waitForFunction(()=>document.getElementById('ramRecordingImportFile').value==='');
        assert.equal(await page.evaluate(async()=>RamRecorder.aggregate(await RamRecorder.instance.records()).writes[0x60]),7);
        assert.equal(await page.evaluate(async()=>RamRecorder.latestValues(await RamRecorder.instance.records()).values[0x60]),7);
        // UI translations remain self-contained in the removable component.
        await page.evaluate(()=>{i18n.currentLang='en-US';document.documentElement.lang='en-US'});
        await page.waitForFunction(()=>document.getElementById('ramRecorderTitle').textContent==='RAM access records');
        if(process.env.RAM_QA_SCREENSHOT_DIR) {
            await page.screenshot({path:path.join(process.env.RAM_QA_SCREENSHOT_DIR,'ram-recorder-desktop.png')});
            await page.setViewportSize({width:390,height:844});
            await cell(0x60).scrollIntoViewIfNeeded();
            await page.screenshot({path:path.join(process.env.RAM_QA_SCREENSHOT_DIR,'ram-recorder-mobile.png')});
        }
        // Both ends remain reachable in a scrolling 16-column map; native
        // keyboard selection updates the details and keeps one Tab stop.
        await cell(0x7FF).click();
        assert.match(await page.locator('#ramRecordingDetail').textContent(),/\$07FF/);
        await cell(0x7FF).press('Control+Home');
        assert.equal(await cell(0).getAttribute('aria-pressed'),'true');
        assert.equal(await page.locator('#ramRecordingMap .ram-byte[tabindex="0"]').count(),1);
        await cell(0).press('End');
        assert.equal(await cell(15).getAttribute('aria-pressed'),'true');
        await cell(15).press('PageDown');
        assert.equal(await cell(271).getAttribute('aria-pressed'),'true');
        await page.click('#ramRecordingClose');
        await page.waitForFunction(()=>testEmulator.isPaused===false);
        assert.equal(await page.evaluate(()=>testEmulator.isPaused),false);
        await page.uncheck('#ramRecordingEnabled');
        await second.waitForFunction(()=>RamRecorder.instance.settings.enabled===false);
        assert.equal(await second.evaluate(()=>RamRecorder.instance.tracker),null);
        // Changing the mode while the other tab was still enabled must not
        // broadcast an intermediate enable state back into an event loop.
        await page.selectOption('#ramRecordingMode','gameplay');
        await second.waitForFunction(()=>RamRecorder.instance.settings.startMode==='gameplay');
        assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem(RamRecorder.SETTINGS_KEY)).enabled),false);
        await page.reload();
        assert.equal(await page.locator('#ramRecordingEnabled').isChecked(),false);
        assert.equal(await page.evaluate(async()=>RamRecorder.aggregate(await RamRecorder.instance.records()).writes[0x60]),7);
        await page.click('#ramRecordingView');
        await page.waitForFunction(()=>Boolean(RamRecorder.instance.ui.counts));
        assert.equal(await page.locator('#ramMapFilter-unseen').isChecked(),true);
        assert.equal(await page.locator('#ramMapFilter-loading').isChecked(),true);
        assert.equal(await page.locator('#ramMapFilter-read').isChecked(),false);
        assert.equal(await color(0x100),'rgb(0, 0, 0)');
        await page.click('#ramMapShowAll');
        assert.equal(await color(0x100),'rgb(71, 85, 105)');
        await page.click('#ramRecordingClose');
        assert.deepEqual(errors,[]);
    } finally {
        await context?.close();
        await new Promise(resolve=>server.close(resolve));
        // This is only the temporary profile created above, never a user profile.
        const resolved=path.resolve(profile);
        if(path.dirname(resolved)===tempRoot && path.basename(resolved).startsWith('moaikun-ram-qa-')) fs.rmSync(resolved,{recursive:true,force:true});
    }
});
