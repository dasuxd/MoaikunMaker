const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('bird/fish previews decode preserved frames in the selected scene palette', async () => {
    const rom = new Uint8Array(0x20010);
    const requests = [];
    const source = ['Config', 'ResourceManager']
        .map(name => fs.readFileSync(path.join(__dirname, '../js', `${name}.js`), 'utf8'))
        .join('\n');
    const { Config, ResourceManager } = new Function('app', 'Romfix',
        `${source}\nreturn { Config, ResourceManager };`)(
        { romEditor: { getRomAddrByOriginalRomAddr: address => address } },
        {
            getFlightSpriteFrames(data, isFish) {
                assert.equal(data, rom);
                requests.push(isFish);
                const frames = new Uint8Array(128);
                // Distinct solid colors make source offsets and palette use
                // observable in the decoded image, without a private ROM file.
                for (let tile = 0; tile < 8; tile++) {
                    frames.fill(0xFF, tile * 16 + (isFish ? 0 : 8),
                        tile * 16 + (isFish ? 8 : 16));
                }
                return frames;
            }
        });
    const resources = new ResourceManager();
    resources.palettes = Array.from({ length: Config.LEVEL_TYPE_COUNT }, (_, scene) =>
        Array.from({ length: 32 }, (_, color) => `scene-${scene}-color-${color}`));
    resources.createImage = async (pixels, width, height) => ({ pixels, width, height });
    await resources.loadBgResources(rom);
    assert.equal(requests.length, Config.LEVEL_TYPE_COUNT);
    for (let scene = 0; scene < Config.LEVEL_TYPE_COUNT; scene++) {
        const image = resources.getResource(scene, 'enemy_12');
        assert.equal(image.width, 16);
        assert.equal(image.height, 16);
        assert.equal(requests[scene], scene === 4);
        for (const row of image.pixels) {
            for (const pixel of row) {
                assert.equal(pixel.color, `scene-${scene}-color-${scene === 4 ? 21 : 22}`);
            }
        }
    }
});
