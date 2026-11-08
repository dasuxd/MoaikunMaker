const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

test('reopening resumes the selected level and unsaved canvas independently of saved levels and drafts', {
    skip: !process.env.PLAYWRIGHT_MODULE || !process.env.MOAIKUN_TEST_ROM, timeout: 60000
}, async () => {
    const {chromium} = require(process.env.PLAYWRIGHT_MODULE);
    const browser = await chromium.launch({channel: process.env.PLAYWRIGHT_CHANNEL});
    try {
        const context = await browser.newContext(), root = path.resolve(__dirname, '../..');
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            return url.hostname === 'editor-session.test'
                ? route.fulfill({path: path.join(root, url.pathname === '/' ? 'index.html' : url.pathname.slice(1))})
                : route.fulfill({contentType: 'application/javascript', body: 'window.LA={init(){}};'});
        });
        let page = await context.newPage();
        const errors = [], listen = p => p.on('pageerror', error => errors.push(error.message));
        listen(page);
        const open = async () => {
            await page.goto('http://editor-session.test/');
            await page.evaluate(() => app.loader.ready);
        };
        const reopen = async () => {
            await page.evaluate(() => app.loader.editorSave);
            await page.close();page = await context.newPage();listen(page);await open();
        };
        await open();
        await page.locator('#fileInput').setInputFiles(process.env.MOAIKUN_TEST_ROM);
        await page.evaluate(() => app.loader.ready);
        await page.waitForFunction(() => app.loader.editorCacheEnabled);
        await page.evaluate(() => app.library.selectLevel(7));
        await reopen();
        assert.equal(await page.evaluate(() => app.currentLevel), 7);
        assert.equal(await page.evaluate(() => app.library.hasUnsavedChanges()), false);

        const before = await page.evaluate(() => {
            const saved = JSON.stringify(app.project.getLevel(7).data);
            const e = app.levelEditor;e.isWideScreen = true;e.changeBgId('1');
            e.mapData[4][3] = 3;e.mapData[5][3] = 3;e.mapData[6][3] = 3;
            e.mapData[5][23] = 8; // A newly expanded row may still be sparse.
            e.playerPos = null;e.doorPos = {x: 25, y: 8};
            e.enemies = [new Enemy(0x8E, 23, 9)];e.performEnd();
            return {saved, content: app.library.createEditorSnapshot(), optimized: e.optimizedMapData};
        });
        await reopen();
        assert.deepEqual(await page.evaluate(() => ({saved: JSON.stringify(app.project.getLevel(7).data),
            content: app.library.createEditorSnapshot(), optimized: app.levelEditor.optimizedMapData})), before);
        assert.equal(await page.evaluate(() => app.library.hasUnsavedChanges()), true);
        assert.equal(await page.locator('#saveBtn').isEnabled(), true);
        // Discarding on navigation must not resurrect the discarded working canvas.
        await page.evaluate(() => {app.library.selectLevel(8);app.library.resolveUnsavedChanges('discard');});
        await reopen();
        assert.equal(await page.evaluate(() => app.currentLevel), 8);
        assert.equal(await page.evaluate(() => app.library.hasUnsavedChanges()), false);

        // A normal save keeps the exact editable source map, without optimizing it twice.
        const clean = await page.evaluate(async () => {
            app.levelEditor.mapData[4][3] = 5;app.levelEditor.performEnd();app.saveLevel();
            await app.loader.editorSave;await app.projectCache.loadLevelData();
            return app.library.createEditorSnapshot();
        });
        await reopen();
        assert.equal(await page.evaluate(() => app.library.createEditorSnapshot()), clean);
        assert.equal(await page.evaluate(() => app.library.hasUnsavedChanges()), false);

        const draft = await page.evaluate(async () => {
            const level = app.project.getLevel(8);
            const record = LevelFile.createLevelRecord(level.data, level.monsterData, {id: 'session-draft', name: 'Session draft'});
            app.backupLevels.push(record);await app.projectCache.saveBackupLevels(app.backupLevels);
            app.library.loadDraftLevel(app.backupLevels.length - 1);
            app.levelEditor.mapData[3][5] = 8;app.levelEditor.performEnd();
            return {content: app.library.createEditorSnapshot(), saved: JSON.stringify(record.mapData)};
        });
        await reopen();
        assert.deepEqual(await page.evaluate(() => ({content: app.library.createEditorSnapshot(),
            saved: JSON.stringify(app.library.getCurrentDraft().mapData)})), draft);
        assert.equal(await page.evaluate(() => app.currentDraftId), 'session-draft');
        assert.equal(await page.evaluate(() => app.editorSource), 'draft');
        assert.equal(await page.evaluate(() => app.library.hasUnsavedChanges()), true);

        // Replacing the ROM starts a new session, while keeping the draft library.
        await page.locator('#fileInput').setInputFiles(process.env.MOAIKUN_TEST_ROM);
        await page.evaluate(() => app.loader.ready);await reopen();
        assert.equal(await page.evaluate(() => app.currentLevel), 0);
        assert.equal(await page.evaluate(() => app.editorSource), 'formal');
        assert.equal(await page.evaluate(() => app.library.hasUnsavedChanges()), false);
        assert.equal(await page.evaluate(() => app.backupLevels.length), 1);

        await page.evaluate(async () => {
            await app.loader.editorSave;
            await app.projectCache.saveEditorState({version:1,currentLevel:999,content:{map:'broken'}});
        });
        await reopen();assert.equal(await page.evaluate(() => app.currentLevel), 0);
        assert.equal(await page.evaluate(() => app.library.hasUnsavedChanges()), false);
        await page.evaluate(async () => {
            window.confirm = () => true;await app.loader.clearCache();
            app.levelEditor.mapData[3][3] = 8;app.levelEditor.performEnd();
        });
        await reopen();
        assert.equal(await page.evaluate(() => app.project.romData), null);
        assert.equal(await page.evaluate(() => app.projectCache.loadEditorState()), null);
        assert.deepEqual(errors, []);
    } finally {await browser.close();}
});
