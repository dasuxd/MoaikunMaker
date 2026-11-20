/** Full-screen background menu for the optional camera setting. */
class PauseSettings {
    static ENTER = 3;
    static OPEN = 4;

    static install(rom, {org, emit, label, absolute, branch}, hasCameraOption) {
        const jsr = target => absolute(0x20, target);
        const jump = target => absolute(0x4C, target);
        const ppuAddress = address => emit(0xA9, address >> 8, 0x8D, 6, 0x20,
            0xA9, address & 255, 0x8D, 6, 0x20);
        // The native pause-look routine here has been replaced by Pause's
        // controller. Its OAM entry occupies $FED9-$FEF7; reset starts at $FF60.
        // $FF51-$FF5F now belongs to Penguin's optional bank-0 call bridge.
        org(0xFF00, Penguin.ENABLED ? Penguin.NATIVE_CALL : 0xFF60);
        label('settingsOam');
        emit(0xA9, 0, 0x8D, 0, 0x20, 0xA9, 1, 0x8D, 0, 0x80);
        jsr('settingsFrame');
        emit(0xA9, 0, 0x8D, 0, 0x80, 0x2C, 2, 0x20,
            0xA5, 0xFF, 0x8D, 0, 0x20, 0x60);

        // Restore the first six sprite CHR pages from the scene's prepared art
        // (including compact TNT and relocated smoke). They match compiled CHR.
        label('restoreMenuChr');
        emit(0xA5, 0x3E, 0xC9, 5); branch(0x90, 'menuArt1');
        emit(0xA2, 3, 0xC9, 7); branch(0x90, 'menuArt2');
        emit(0xC9, 9); branch(0x90, 'menuArt3');
        label('menuArt2'); emit(0xA9, 0x80); branch(0xD0, 'menuArtBank');
        label('menuArt1'); emit(0xA2, 2);
        label('menuArt3'); emit(0xA9, 0xA0);
        label('menuArtBank');
        emit(0x8E, 0, 0x80, 0x85, 3, 0xA0, 0, 0x84, 2, 0xA2, 6);
        label('menuArtByte');
        emit(0xB1, 2, 0x8D, 7, 0x20, 0xC8); branch(0xD0, 'menuArtByte');
        emit(0xE6, 3, 0xCA); branch(0xD0, 'menuArtByte');
        emit(0xA9, 1, 0x8D, 0, 0x80, 0x60);

        // The bird/fish lane worker owns $BB00-$BFFF after this page.
        const bankStart = 0x7310, bankEnd = 0x4000 + BirdFish.LANES_BASE - 0x8000 + 0x10;
        if (rom.subarray(bankStart, bankEnd).some(Boolean))
            throw new Error('Bank 1 settings page area is occupied');
        org(0xB300, BirdFish.LANES_BASE, 1);
        const title = 'SETTINGS', camera = '> CENTER CAMERA', empty = 'NO OPTIONS';
        const back = 'B BACK', controls = 'A CHANGE    ' + back;
        const alphabet = [...new Set(' ' + title + camera + empty + controls)];
        if ((alphabet.length + 4) * 16 > 0x1F0) throw new Error('Settings font overlaps saved display registers');
        const tile = c => 0x40 + alphabet.indexOf(c);
        const statusTile = alphabet.length + 0x40;
        const statusAddress = 0x2000 + 14 * 32 + 22;
        const off = [statusTile, statusTile + 1, statusTile + 1];
        const on = [statusTile + 2, statusTile + 3, tile(' ')];

        label('settingsFrame');
        emit(0xA5, 0x2B, 0xC9, PauseSettings.ENTER); branch(0xF0, 'openSettings');
        emit(0xA5, 0xF4, 0x29, 0x40); branch(0xF0, 'changeSetting');
        jump('closeSettings');
        label('changeSetting');
        if (hasCameraOption) {
            emit(0xA5, 0xF4); branch(0x10, 'menuDone'); // newly pressed A
            emit(0xA5, 0x2A, 0x49, 1, 0x85, 0x2A);
            // The native vblank queue updates just the three background cells.
            emit(0xA6, 0x1E, 0xA0, 0, 0x29, 1); branch(0xF0, 'menuPacket');
            emit(0xA0, 8);
            label('menuPacket'); absolute(0xB9, 'statusPackets');
            emit(0x9D, 0, 3, 0xE8, 0xC8, 0x98, 0x29, 7); branch(0xD0, 'menuPacket');
            emit(0x86, 0x1E);
        }
        label('menuDone'); emit(0x60);
        if (hasCameraOption) {
            label('statusPackets');
            for (const state of [off, on]) emit(6, statusAddress >> 8, statusAddress & 255, 3, ...state, 0xFF);
        }

        // Forced blank for bulk transfers. Save nametable $2000 (attributes
        // included) in sprite CHR $0000-$03FF. $2400 is never touched.
        label('openSettings');
        jsr('menuBlank');
        emit(0xA9, 0x20, 0x85, 4, 0xA9, 0, 0x85, 5); jsr('copyMenuTable');
        ppuAddress(0x05F0);
        const display = [0xFC, 0xFD, 0xFE, 0xFF];
        for (const zp of display) emit(0xA5, zp, 0x8D, 7, 0x20);
        ppuAddress(0x0400);
        emit(0xA2, 0);
        label('copyMenuFont'); absolute(0xBD, 'menuFont'); emit(0x8D, 7, 0x20, 0xE8);
        branch(0xD0, 'copyMenuFont');
        label('copyMenuFontTail'); absolute(0xBD, 'menuFontTail'); emit(0x8D, 7, 0x20, 0xE8);
        emit(0xE0, (alphabet.length + 4) * 16 - 256); branch(0xD0, 'copyMenuFontTail');
        ppuAddress(0x2000);
        for (let page = 0; page < 4; page++) {
            emit(0xA2, 0); label('menuRowPage' + page);
            absolute(0xBD, 'menuTable' + page); emit(0x8D, 7, 0x20, 0xE8);
            branch(0xD0, 'menuRowPage' + page);
        }
        if (hasCameraOption) {
            emit(0xA5, 0x2A, 0x29, 1); branch(0xF0, 'menuPalette');
            ppuAddress(statusAddress);
            for (const t of on) emit(0xA9, t, 0x8D, 7, 0x20);
            label('menuPalette');
        }
        ppuAddress(0x3F00);
        for (const color of [0x0F, 0x30, 0x16, 0x21]) emit(0xA9, color, 0x8D, 7, 0x20);
        emit(0xA9, 0, 0x85, 0xFC, 0x85, 0xFD, 0xA9, 0x80, 0x85, 0xFF,
            0xA9, 0x0A, 0x85, 0xFE, 0xA9, PauseSettings.OPEN, 0x85, 0x2B);
        jump('hideMenuSprites');

        label('closeSettings');
        jsr('menuBlank');
        emit(0xA9, 0, 0x85, 4, 0xA9, 0x20, 0x85, 5); jsr('copyMenuTable');
        ppuAddress(0x05F0); emit(0xAD, 7, 0x20); // discard buffered read
        for (const zp of display) emit(0xAD, 7, 0x20, 0x85, zp);
        ppuAddress(0); jsr('restoreMenuChr');
        ppuAddress(0x3F00);
        emit(0xA2, 0); label('restoreMenuPalette');
        emit(0xBD, 0xE0, 3, 0x8D, 7, 0x20, 0xE8, 0xE0, 4); branch(0xD0, 'restoreMenuPalette');
        emit(0xA5, 0x2A, 0x29, 1, 0x85, 0x2A, 0xA9, 1, 0x85, 0x2B);
        label('hideMenuSprites');
        ppuAddress(0x2000);
        emit(0xA2, 0, 0xA9, 0xF8);
        label('hideMenuSprite'); emit(0x9D, 0, 2, 0xE8, 0xE8, 0xE8, 0xE8);
        branch(0xD0, 'hideMenuSprite'); emit(0x60);
        label('menuBlank'); emit(0xA9, 0, 0x8D, 1, 0x20, 0x2C, 2, 0x20, 0x60);
        label('copyMenuTable');
        emit(0xA2, 4);
        label('copyMenuPage');
        emit(0xA0, 0, 0xA5, 4, 0x8D, 6, 0x20, 0x8C, 6, 0x20, 0xAD, 7, 0x20);
        label('readMenuByte'); emit(0xAD, 7, 0x20, 0x99, 0, 2, 0xC8); branch(0xD0, 'readMenuByte');
        emit(0xA5, 5, 0x8D, 6, 0x20, 0x8C, 6, 0x20);
        label('writeMenuByte'); emit(0xB9, 0, 2, 0x8D, 7, 0x20, 0xC8); branch(0xD0, 'writeMenuByte');
        emit(0xE6, 4, 0xE6, 5, 0xCA); branch(0xD0, 'copyMenuPage'); emit(0x60);

        // Convert the visible eight rows of the native 8x16 alphabet to BG tiles.
        const font = [...alphabet, ...'OFON'];
        font.forEach((c, index) => {
            if (index === 0) label('menuFont');
            if (index === 16) label('menuFontTail');
            const addr = 0x8010 + (0x16 + (c.charCodeAt(0) - 65) * 2) * 16;
            const ink = Array.from({length: 8}, (_, y) => {
                if (c === ' ') return 0;
                if (c === '>') return [0x40,0x60,0x70,0x78,0x70,0x60,0x40,0][y];
                const row = addr + ((y + 4) >> 3) * 16 + ((y + 4) & 7);
                return rom[row + 8] & ~rom[row];
            });
            const color = index < alphabet.length ? 1 : index < alphabet.length + 2 ? 2 : 3;
            emit(...ink.map(v => color & 1 ? v : 0), ...ink.map(v => color & 2 ? v : 0));
        });
        const table = new Uint8Array(1024);
        table.fill(tile(' '), 0, 960);
        const text = (row, col, value) => table.set([...value].map(tile), row * 32 + col);
        text(8, 12, title);
        if (hasCameraOption) {
            text(14, 5, camera);
            table.set(off, statusAddress - 0x2000);
            text(22, 7, controls);
        } else {
            text(14, 11, empty);
            text(22, 13, back);
        }
        for (let page = 0; page < 4; page++) {
            label('menuTable' + page); emit(...table.subarray(page * 256, (page + 1) * 256));
        }
    }
}
