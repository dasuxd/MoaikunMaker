const assert = require('node:assert/strict');
const {Controller} = require('../../js/lib/jsnes.min.js');

// Both full-screen VRAM transfers span multiple frames under forced blank.
function press(nes, button) {
    nes.buttonDown(1, button); nes.frame();
    nes.buttonUp(1, button); nes.frame();
}
function openSettings(nes) {
    press(nes, Controller.BUTTON_UP);
    for (let i = 0; i < 12 && nes.cpu.mem[0x2B] !== 4; i++) nes.frame();
    assert.equal(nes.cpu.mem[0x2B], 4);
    nes.frame();
}
function backToMap(nes) {
    press(nes, Controller.BUTTON_B);
    for (let i = 0; i < 12 && nes.cpu.mem[0x2B] !== 1; i++) nes.frame();
    assert.equal(nes.cpu.mem[0x2B], 1);
    nes.frame();
}
function toggleCamera(nes) {
    openSettings(nes);
    press(nes, Controller.BUTTON_A);
    backToMap(nes);
}
module.exports = {openSettings, backToMap, toggleCamera};
