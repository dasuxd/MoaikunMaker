const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const test = require('node:test');

// Minimal Mapper 3 fixture with distinct map and enemy bytes in slot 56.
function makeRom() {
    const rom = Buffer.alloc(0x10010);
    rom.set([0x4e, 0x45, 0x53, 0x1a, 2, 4, 0x30]);
    rom[0xbd3] = 57;
    for (let i = 0; i < 56; i++) {
        const map = 0x6f8f + 6 * i;
        rom.writeUInt16LE(map - 16 + 0x8000, 0x5841 + 2 * i);
        rom.set([i === 55 ? 0x14 : 0, 0x45, 9, 8, 0x23, 0xff], map);
        rom[0x33db + i] = 1;
    }
    rom.set([3, 1, 0x55], 0x33db + 55);
    return rom;
}

test('restore uses the numbered ROM slot; extra levels retain only spawn and exit', {
    skip: !process.env.PLAYWRIGHT_MODULE
}, async () => {
    const {chromium} = require(process.env.PLAYWRIGHT_MODULE);
    const browser = await chromium.launch({channel: process.env.PLAYWRIGHT_CHANNEL});
    try {
        const page = await browser.newPage({viewport: {width: 1000, height: 640}});
        await page.route(/^https?:/, route => route.fulfill({body: 'window.LA={init(){}};'}));
        await page.goto(pathToFileURL(path.resolve(__dirname, '../../index.html')).href);
        await page.locator('#fileInput').setInputFiles({name: 'fixture.nes',
            mimeType: 'application/octet-stream', buffer: makeRom()});
        const reset = page.locator('#resetLevelBtn');
        await page.waitForFunction(() => !document.querySelector('#resetLevelBtn').disabled);
        await page.evaluate(() => {
            const levels = app.project.levels;
            [levels[0], levels[55]] = [levels[55], levels[0]];
            app.project.setLevelCount(57);
            app.library.createLevelList();
            app.library.selectLevel(55);
            app.levelEditor.doorPos = null;
        });
        const click = async (accept, number) => {
            const dialog = page.waitForEvent('dialog');
            const clicked = reset.click();
            const prompt = await dialog;
            assert.ok(prompt.message().includes(String(number)));
            await (accept ? prompt.accept() : prompt.dismiss());
            await clicked;
        };
        await click(false, 56);
        assert.equal(await page.evaluate(() => app.levelEditor.doorPos), null);
        assert.equal(await page.evaluate(() => app.project.levels[55].data[0]), 0);
        await click(true, 56);
        assert.deepEqual(await page.evaluate(() => [
            app.project.levels[55].data, app.project.levels[55].monsterData, app.levelEditor.doorPos
        ]), [[0x14, 0x45, 9, 8, 0x23], [3, 1, 0x55], {x: 9, y: 8}]);
        await page.evaluate(() => {
            app.library.selectLevel(56);
            app.levelEditor.playerPos = {x: 7, y: 5};
            app.levelEditor.doorPos = null;
            app.levelEditor.mapData[1][1] = 5;
        });
        await click(true, 57);
        assert.deepEqual(await page.evaluate(() => [
            app.levelEditor.playerPos, Boolean(app.levelEditor.doorPos), app.levelEditor.enemies,
            app.levelEditor.mapData.flat().some(Boolean), app.project.levels[56].data.length
        ]), [{x: 7, y: 5}, true, [], false, 4]);
        await page.waitForFunction(async () =>
            (await app.projectCache.loadLevelData())?.levels[56]?.data[1] === 0x75);

        for (const draggable of [true, false]) {
            await page.evaluate(mode => {
                const toolbar = document.querySelector('#toolbar');
                toolbar.classList.toggle('draggable-mode', mode);
                toolbar.classList.add('open');
            }, draggable);
            const scroll = await page.locator('.toolbar-content').evaluate(el => {
                const header = document.querySelector('#toolbarHeader');
                el.scrollTop = 0;
                const before = header.getBoundingClientRect().top;
                el.scrollTop = el.scrollHeight;
                return el.scrollTop > 0 && before === header.getBoundingClientRect().top;
            });
            assert.equal(scroll, true);
        }
    } finally {
        await browser.close();
    }
});
