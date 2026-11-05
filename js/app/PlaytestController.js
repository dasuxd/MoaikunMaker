class PlaytestController {
    constructor(app) { this.app = app; }
    get active() { return this.app.testMode; }
    notify(type, text) { this.app.showMessage(type, text); }
    connectControls(emulator) {
        this.app.mobileController ||= new MobileGameController(emulator, this);
    }
    showControls() { this.app.mobileController.show(); }
    refreshControls() { this.app.mobileController?.updateActionState?.(); }
    started() {
        this.app.stopEmulatorBtn.disabled = false;
        this.refreshControls();
    }
    vibrate() { this.app.vibrate(20); }
    exitFromMenu() {
        this.stopEmulator();
        this.app.testLevelBtn.focus();
    }

    // Change mode, exit if in test mode
    changeMode(){
        this.app.levelEditor.testMode = !this.app.testMode
        if(this.app.testMode){
            this.app.testMode = false;
            this.app.emulator.stop();
            this.app.levelEditor.render();
            this.app.toggleInfoItems(false); // Switch to edit mode display

            // Remove test mode class, restore normal size
            // const canvasContainer = document.querySelector('.canvas-container');
            // if (canvasContainer) {
            //     canvasContainer.classList.remove('test-mode');
            // }

            const levelCanvas = document.getElementById('levelCanvas');
            if (levelCanvas) {
                levelCanvas.classList.remove('test-mode');
            }

            const editorLayout = document.querySelector('.editor-layout');
            if (editorLayout) {
                editorLayout.classList.remove('test-mode');
            }

            // Remove body's test-mode class
            document.body.classList.remove('test-mode');

            // Hide mobile control panel
            if (this.app.mobileController) {
                this.app.mobileController.hide();
            }

            // Restore button status
            if (this.app.currentLevel >= 0) {
                this.app.testLevelBtn.disabled = false;
                this.app.saveBtn.disabled = this.app.levelEditor.modified ? false : true;

                this.app.testBtn.disabled = false;
            }else{
                this.app.saveBtn.disabled = true;

                this.app.downloadBtn.disabled = false;
            }
            this.app.stopEmulatorBtn.disabled = true;
            return true;
        }else{
            //this.app.stopEmulatorBtn.disabled = false;
            this.app.toggleInfoItems(true); // Switch to test mode display
        }
        this.app.testMode = true;
        return false;
    }

    // Stop emulator
    stopEmulator() {
        if (!this.app.testMode) {
            this.app.showMessage('warning', i18n.t("emulatorNotRunningWarning"));
            return;
        }

        this.changeMode();
        this.app.showMessage('info', i18n.t("emulatorStopInfo"));
    }

    createTmpRomData(levelRomData, gameConfig = this.app.project.getGameConfig()){
        const tmpLevel = new Level(0, 0, 0);
        tmpLevel.saveMapData(levelRomData.mapData);
        tmpLevel.saveMonsterData(levelRomData.monsterData);
        return this.app.project.getROMData([tmpLevel], 1, gameConfig);
    }

    async startRom(build, quickStart, message) {
        if (this.app.testMode) {
            this.stopEmulator();
            return false;
        }
        try {
            const rom = build();
            this.app.emulator ||= new NesEmulator('levelCanvas', this);
            this.app.emulator.loadROM(rom);
            this.changeMode();
            this.app.testLevelBtn.disabled = true;
            this.app.testBtn.disabled = true;
            this.app.saveBtn.disabled = true;
            if (quickStart) await this.app.emulator.quickStart();
            else this.app.emulator.start();
            if (this.app.testMode) this.notify('success', i18n.t(message));
            return true;
        } catch (error) {
            if (this.app.testMode) this.changeMode();
            this.notify('error', error.message);
            return false;
        }
    }

    testLevel() {
        const editorData = this.app.getLevelEditorData();
        if (!editorData) return;
        const level = LevelCodec.fromLevelEditorToROMData(editorData, this.app.levelEditor.isWideScreen);
        return this.startRom(() => this.createTmpRomData(level), true, 'testingCurrentLevelSuccess');
    }

    testROM() {
        return this.startRom(() => this.app.project.getROMData(), false, 'emulatorStartSuccess');
    }

    downloadROM() {
        try {
            const bytes = this.app.project.getROMData();
            const blob = new Blob([bytes], {type: 'application/octet-stream'});
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = this.app.fileName.replace(/\.nes$/i, '') + ' - Modified.nes';
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            this.notify('success', i18n.t('romDownloadSuccess'));
        } catch (error) {
            this.notify('error', error.message);
        }
    }
}
