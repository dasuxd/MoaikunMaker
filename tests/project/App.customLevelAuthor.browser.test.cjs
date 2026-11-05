const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const test = require('node:test');

test('author input filters typing/paste, enforces width and persists after reload in the actual app', {
    skip: !process.env.PLAYWRIGHT_MODULE || !process.env.MOAIKUN_TEST_ROM,
    timeout: 60000
}, async () => {
    const {chromium} = require(process.env.PLAYWRIGHT_MODULE);
    const root = path.resolve(__dirname, '../..');
    const server = http.createServer((req, res) => {
        let target = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
        if (target === root) target = path.join(root, 'index.html');
        if (!target.startsWith(root + path.sep)) {res.writeHead(403); res.end(); return;}
        try {
            const mime = {'.js':'application/javascript', '.css':'text/css', '.html':'text/html'};
            res.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
            res.end(fs.readFileSync(target));
        } catch {res.writeHead(404); res.end();}
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({headless:true,
            ...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {})});
        const context = await browser.newContext({viewport:{width:1280, height:900}});
        await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
            ? route.continue() : route.fulfill({contentType:'application/javascript', body:'window.LA={init(){}};'}));
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.waitForFunction(() => typeof app !== 'undefined' && app.projectCache.db);
        await page.locator('#fileInput').setInputFiles(process.env.MOAIKUN_TEST_ROM);
        await page.waitForFunction(() => app.project.romData && app.project.levels.length > 0);
        await page.locator('[data-toolbar-tab="gameConfig"]').click();
        const input = page.locator('#customLevelAuthorInput');
        assert.equal(await input.getAttribute('maxlength'), '28');
        assert.equal(await page.locator('#customLevelAuthorLength').textContent(), '0/28');
        await input.fill('Jane 中文123-Doe!');
        assert.equal(await input.inputValue(), 'Jane Doe');
        assert.equal(await page.locator('#customLevelAuthorLength').textContent(), '8/28');
        await input.evaluate(element => element.setSelectionRange(4,4));
        await input.press('7');
        assert.equal(await input.inputValue(), 'Jane Doe');
        assert.equal(await input.evaluate(element => element.selectionStart), 4);
        await input.fill('A'.repeat(100));
        assert.equal(await input.inputValue(), 'A'.repeat(28));
        assert.equal(await page.locator('#customLevelAuthorLength').textContent(), '28/28');
        await input.fill('Jane Doe');
        await page.waitForFunction(async () =>
            (await app.projectCache.loadLevelData())?.gameConfig.customLevelAuthor === 'Jane Doe');
        await page.reload();
        await page.waitForFunction(() => typeof app !== 'undefined' &&
            app.project.getGameConfig().customLevelAuthor === 'Jane Doe');
        await page.locator('[data-toolbar-tab="gameConfig"]').click();
        assert.equal(await input.inputValue(), 'Jane Doe');
        await input.fill('');
        await page.waitForFunction(async () =>
            (await app.projectCache.loadLevelData())?.gameConfig.customLevelAuthor === '');
        assert.equal(await page.locator('#customLevelAuthorLength').textContent(), '0/28');
        const download = page.waitForEvent('download');
        await page.locator('#downloadBtn').click();
        const output = fs.readFileSync(await (await download).path());
        assert.equal(output.length, 0x20010);
        assert.equal(output[6] >> 4, 2);
        await page.locator('#testLevelBtn').click();
        await page.waitForFunction(() => app.emulator?.isRunning);
        await page.locator('#stopEmulatorBtn').click();
        await page.waitForFunction(() => !app.testMode && !app.emulator.isRunning);
        const shared = await page.evaluate(() => {
            const level = app.project.levels[0];
            const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_');
            return '?mapData=' + encode(level.data) + '&enemyData=' + encode(level.monsterData);
        });
        await page.goto('http://127.0.0.1:' + server.address().port + '/' + shared);
        await page.waitForFunction(() => app?.hasSharedLevelLoaded && app.emulator.isRunning);
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
});
