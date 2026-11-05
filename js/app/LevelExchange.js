class LevelExchange {
    constructor(app) { this.app = app; }
    initParams(){
        if (this.app.pendingSharedLevel || this.app.hasSharedLevelLoaded) {
            return;
        }

        // Binary decode function: Base64 URL-Safe -> Uint8Array -> Array
        function decodeBase64UrlSafe(str) {
            if (!str) return null;

            // 1. Restore standard Base64
            let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
            const padLength = (4 - base64.length % 4) % 4;
            base64 += '='.repeat(padLength);

            // 2. Decode Base64 to binary string
            const binaryString = atob(base64);

            // 3. Convert to Uint8Array
            const uint8Array = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                uint8Array[i] = binaryString.charCodeAt(i);
            }

            // 4. Convert to plain array
            return Array.from(uint8Array);
        }

        const urlParams = new URLSearchParams(window.location.search);
        const mapDataParam = urlParams.get("mapData");
        const enemyDataParam = urlParams.get("enemyData");

        // Check if parameters exist
        if (!mapDataParam || !enemyDataParam) {
            console.log("No level data parameters in URL");
            return;
        }

        try {
            const mapData = decodeBase64UrlSafe(mapDataParam);
            const enemyData = decodeBase64UrlSafe(enemyDataParam);

            // Validate data
            if (!Array.isArray(mapData) || !Array.isArray(enemyData)) {
                console.error("Parsed data format is incorrect");
                return;
            }

            console.log('✅ Parsed map data:', mapData);
            console.log('✅ Parsed enemy data:', enemyData);

            const data = {
                mapData: mapData,
                monsterData: enemyData,
            };

            this.app.library.addDraftLevel({
                name: i18n.t('sharedLevelDraftName'),
                source: 'shared',
                mapData,
                monsterData: enemyData,
                createdAt: Date.now()
            }, { deduplicate: true });

            // Check if ROM is loaded
            if (this.app.project.romData == null) {
                this.app.pendingSharedLevel = data;
                this.app.showMessage('warning', i18n.t('romNotFoundWarning'));
                return;
            }

            // ROM already loaded, load level directly
            this.loadSharedLevel(data);

        } catch (error) {
            console.error('❌ Failed to parse URL parameters:', error);
            this.app.showMessage('error', i18n.t('loadShareLevelError'));
        }
    }

    /**
     * Load shared level
     */
    async loadSharedLevel(data) {
        this.app.hasSharedLevelLoaded = await this.app.playtest.startRom(
            () => this.app.playtest.createTmpRomData(data), false, 'loadSharedLevelSuccess');
    }

    // Share current level
    shareLevel(){
        if(this.app.currentLevel === -1){
            this.app.showMessage('warning', i18n.t("pleaseSelectLevelFirstWarning"));
            return;
        }

        // Binary encode function: Array -> Uint8Array -> Base64 URL-Safe
        function encodeDataBinary(dataArray) {
            // Convert number array to Uint8Array
            const uint8Array = new Uint8Array(dataArray);

            // Convert to binary string
            let binaryString = '';
            for (let i = 0; i < uint8Array.length; i++) {
                binaryString += String.fromCharCode(uint8Array[i]);
            }

            // Base64 encode (URL safe)
            return btoa(binaryString)
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
        }

        try {
            const tmpEditorData = this.app.getLevelEditorData();
            if(!tmpEditorData){
                return;
            }
            const levelRomData = LevelCodec.fromLevelEditorToROMData(tmpEditorData, this.app.levelEditor.isWideScreen);

            // Get current page full URL
            const url = new URL(window.location.href);

            // Clear other possible parameters to avoid conflicts
            url.searchParams.delete('level');

            // Set parameters (use binary encoding, shorter and more efficient)
            url.searchParams.set("mapData", encodeDataBinary(levelRomData.mapData));
            url.searchParams.set("enemyData", encodeDataBinary(levelRomData.monsterData));

            const shareUrl = url.toString();

            // Copy to clipboard
            navigator.clipboard.writeText(shareUrl)
                .then(() => {
                    this.app.showMessage('success', i18n.t("copyShareLevelLinkSuccess"));
                    console.log('Share URL:', shareUrl);
                    console.log('URL length:', shareUrl.length);
                })
                .catch(err => {
                    console.error("Copy failed:", err);
                    prompt("Copy failed, please copy manually:", shareUrl);
                });
        } catch (error) {
           // console.error('Failed to generate share link:', error);
            this.app.showMessage('error', i18n.t("copyShareLevelLinkError",{error: error}));
        }
    }

    exportCurrentLevel() {
        if (this.app.editorSource === 'draft') {
            this.exportCurrentDraft();
            return;
        }
        try {
            const levelRomData = this.app.getCurrentLevelRomData();
            if (!levelRomData) return;

            const name = i18n.t('levelLabel', { level: this.app.currentLevel + 1 });
            const level = LevelFile.createLevelRecord(
                levelRomData.mapData,
                levelRomData.monsterData,
                {
                    name,
                    source: 'editor',
                    levelIndex: this.app.currentLevel,
                    createdAt: Date.now()
                }
            );
            LevelExchange.download(
                LevelFile.createSingle(level),
                `${LevelExchange.safeFileName(name, 'level')}.moailevel`
            );
            this.app.showMessage('success', i18n.t('levelExportSuccess', { name }));
        } catch (error) {
            this.app.showMessage('error', i18n.t('levelExportFailed', { error: error.message }));
        }
    }

    exportLevelPack() {
        if (!this.app.project.romData || this.app.project.levels.length === 0) {
            if (this.app.recoveryLevelData?.levels?.length) {
                this.exportRecoveryLevelPack();
            } else if (this.app.backupLevels.length) {
                this.exportAllDrafts();
            } else {
                this.app.showMessage('error', i18n.t('romNotLoadedError'));
            }
            return;
        }

        try {
            let unsavedCurrent = null;
            if (this.app.editorSource === 'formal' && this.app.library.hasUnsavedChanges()) {
                unsavedCurrent = this.app.getCurrentLevelRomData();
                if (!unsavedCurrent) return;
            }

            const levels = this.app.project.levels
                .slice(0, this.app.project.getLevelCount())
                .map((level, index) => {
                    const useEditor = index === this.app.currentLevel && unsavedCurrent;
                    return LevelFile.createLevelRecord(
                        useEditor ? unsavedCurrent.mapData : level.data,
                        useEditor ? unsavedCurrent.monsterData : level.monsterData,
                        {
                            name: i18n.t('levelLabel', { level: index + 1 }),
                            source: 'pack',
                            levelIndex: index,
                            createdAt: Date.now()
                        }
                    );
                });

            let drafts = this.app.backupLevels;
            const currentDraft = this.app.library.getCurrentDraft();
            if (currentDraft && this.app.library.hasUnsavedChanges()) {
                const currentDraftData = this.app.getCurrentLevelRomData();
                if (!currentDraftData) return;
                drafts = this.app.backupLevels.map(draft =>
                    draft.id === currentDraft.id
                        ? {
                            ...draft,
                            mapData: currentDraftData.mapData,
                            monsterData: currentDraftData.monsterData,
                            checksum: null
                        }
                        : draft
                );
            }

            const pack = LevelFile.createPack(levels, drafts);
            const baseName = this.app.fileName
                ? this.app.fileName.replace(/\.nes$/i, '')
                : 'Moaikun';
            LevelExchange.download(
                pack,
                `${LevelExchange.safeFileName(baseName, 'Moaikun')}-levels.moaipack`
            );
            this.app.showMessage('success', i18n.t('levelPackExportSuccess', {
                count: levels.length,
                drafts: drafts.length
            }));
        } catch (error) {
            this.app.showMessage('error', i18n.t('levelExportFailed', { error: error.message }));
        }
    }

    exportRecoveryLevelPack() {
        try {
            const cachedLevels = this.app.recoveryLevelData.levels
                .slice(0, this.app.recoveryLevelData.levelCount ?? this.app.recoveryLevelData.levels.length)
                .map((level, index) => LevelFile.createLevelRecord(
                    level.data,
                    level.monsterData,
                    {
                        name: i18n.t('levelLabel', { level: index + 1 }),
                        source: 'recovered',
                        levelIndex: index,
                        createdAt: this.app.recoveryLevelData.timestamp || Date.now()
                    }
                ));
            const pack = LevelFile.createPack(cachedLevels, this.app.backupLevels);
            LevelExchange.download(pack, 'Moaikun-recovery-levels.moaipack');
            this.app.showMessage('success', i18n.t('recoveryPackExportSuccess', {
                count: cachedLevels.length,
                drafts: this.app.backupLevels.length
            }));
        } catch (error) {
            this.app.showMessage('error', i18n.t('levelExportFailed', { error: error.message }));
        }
    }

    openLevelFilePicker(target = 'formal') {
        const input = document.getElementById('levelFileInput');
        if (!input) return;
        this.app.levelFileImportTarget = target === 'drafts' ? 'drafts' : 'formal';
        input.accept = this.app.levelFileImportTarget === 'drafts'
            ? '.moailevel,.moaidrafts,.moaipack,.json,application/json'
            : '.moailevel,.moaipack,.json,application/json';
        input.click();
    }

    async handleLevelFileSelect(event) {
        const input = event.target;
        const file = input.files && input.files[0];
        if (!file) return;

        try {
            const parsed = LevelFile.parse(await file.text());
            if (parsed.type === 'level') {
                const fileBaseName = file.name.replace(/\.(moailevel|json)$/i, '');
                const draft = this.app.library.addDraftLevel({
                    ...parsed.level,
                    id: LevelFile.createId('draft'),
                    name: parsed.level.name || fileBaseName || i18n.t('importedLevelDefaultName'),
                    source: 'import',
                    createdAt: Date.now()
                });
                if (!draft) {
                    throw new Error(i18n.t('levelFileInvalidLevel'));
                }
                this.app.showMessage('success', i18n.t('levelImportToDraftSuccess', {
                    name: draft.name
                }));
                this.app.library.switchLevelLibraryTab('drafts');
                return;
            }

            if (parsed.type === 'draft-pack') {
                let added = 0;
                for (const draft of parsed.drafts) {
                    const beforeCount = this.app.backupLevels.length;
                    this.app.library.addDraftLevel({
                        ...draft,
                        id: LevelFile.createId('draft'),
                        source: draft.source || 'import'
                    }, { deduplicate: true });
                    if (this.app.backupLevels.length > beforeCount) added++;
                }
                this.app.library.switchLevelLibraryTab('drafts');
                this.app.showMessage('success', i18n.t('draftPackImportSuccess', {
                    count: added
                }));
                return;
            }

            if (this.app.levelFileImportTarget === 'drafts') {
                let added = 0;
                for (const draft of [...parsed.levels, ...(parsed.drafts || [])]) {
                    const beforeCount = this.app.backupLevels.length;
                    this.app.library.addDraftLevel({
                        ...draft,
                        id: LevelFile.createId('draft'),
                        source: draft.source || 'import'
                    }, { deduplicate: true });
                    if (this.app.backupLevels.length > beforeCount) added++;
                }
                this.app.library.switchLevelLibraryTab('drafts');
                this.app.showMessage('success', i18n.t('draftPackImportSuccess', {
                    count: added
                }));
                return;
            }

            if (!this.app.project.romData) {
                throw new Error(i18n.t('romRequiredForPackImport'));
            }
            if (!this.validatePackCapacity(parsed.levels)) {
                return;
            }
            if (!confirm(i18n.t('levelPackImportConfirm', {
                count: parsed.levels.length
            }))) {
                return;
            }
            this.app.library.requestAfterUnsavedChanges(() => this.applyLevelPack(parsed));
        } catch (error) {
            console.error('Failed to import level file:', error);
            this.app.showMessage('error', i18n.t('levelImportFailed', { error: error.message }));
        } finally {
            input.value = '';
        }
    }

    validatePackCapacity(levels) {
        const mapBytes = levels.reduce((sum, level) => sum + level.mapData.length + 1, 0);
        const enemyBytes = levels.reduce((sum, level) => sum + level.monsterData.length, 0);
        const error = LevelLayout.validate(levels.length, mapBytes, enemyBytes);
        if (error) this.app.showMessage('error', error);
        return !error;
    }

    applyLevelPack(pack) {
        const levelsData = pack.levels.map((level, index) => ({
            index,
            originalIndex: index,
            data: [...level.mapData],
            monsterData: [...level.monsterData],
            isDeleted: false,
            modified: true
        }));

        if (!this.app.project.importLevelsData(levelsData, levelsData.length)) {
            this.app.showMessage('error', i18n.t('levelImportFailed', {
                error: i18n.t('levelFileInvalidLevel')
            }));
            return;
        }

        for (const draft of pack.drafts || []) {
            this.app.library.addDraftLevel({
                ...draft,
                id: LevelFile.createId('draft'),
                source: draft.source || 'recovered'
            }, { deduplicate: true });
        }

        const levelCountInput = document.getElementById('levelCountInput');
        if (levelCountInput) {
            levelCountInput.value = levelsData.length;
        }
        this.app.library.createLevelList();
        this.app.updateMemoryOverview();
        this.app.loader.saveLevelDataToCache();
        this.app.library.selectLevel(0, { skipUnsavedGuard: true });
        this.app.showMessage('success', i18n.t('levelPackImportSuccess', {
            count: levelsData.length
        }));
    }

    exportDraftLevel(draftIndex) {
        const draft = this.app.backupLevels[draftIndex];
        if (!draft) return;
        try {
            let exportDraft = draft;
            if (this.app.currentDraftId === draft.id && this.app.library.hasUnsavedChanges()) {
                const editorData = this.app.getCurrentLevelRomData();
                if (!editorData) return;
                exportDraft = {
                    ...draft,
                    mapData: editorData.mapData,
                    monsterData: editorData.monsterData,
                    checksum: null
                };
            }
            LevelExchange.download(
                LevelFile.createSingle(exportDraft),
                `${LevelExchange.safeFileName(draft.name, 'draft')}.moailevel`
            );
            this.app.showMessage('success', i18n.t('levelExportSuccess', {
                name: draft.name
            }));
        } catch (error) {
            this.app.showMessage('error', i18n.t('levelExportFailed', { error: error.message }));
        }
    }

    exportCurrentDraft() {
        const draftIndex = this.app.backupLevels.findIndex(
            draft => draft.id === this.app.currentDraftId
        );
        if (draftIndex < 0) {
            this.app.showMessage('warning', i18n.t('selectDraftFirst'));
            return;
        }
        this.exportDraftLevel(draftIndex);
    }

    exportAllDrafts() {
        if (this.app.backupLevels.length === 0) {
            this.app.showMessage('warning', i18n.t('draftPackEmpty'));
            return;
        }

        try {
            const currentDraft = this.app.library.getCurrentDraft();
            let unsavedData = null;
            if (currentDraft && this.app.library.hasUnsavedChanges()) {
                unsavedData = this.app.getCurrentLevelRomData();
                if (!unsavedData) return;
            }
            const drafts = this.app.backupLevels.map(draft => {
                if (!currentDraft || draft.id !== currentDraft.id || !unsavedData) {
                    return draft;
                }
                return {
                    ...draft,
                    mapData: unsavedData.mapData,
                    monsterData: unsavedData.monsterData,
                    checksum: null
                };
            });
            LevelExchange.download(
                LevelFile.createDraftPack(drafts),
                'Moaikun-drafts.moaidrafts'
            );
            this.app.showMessage('success', i18n.t('draftPackExportSuccess', {
                count: drafts.length
            }));
        } catch (error) {
            this.app.showMessage('error', i18n.t('levelExportFailed', { error: error.message }));
        }
    }

    static download(data, fileName) {
        const blob = new Blob([JSON.stringify(data, null, 2)], {
            type: 'application/json;charset=utf-8'
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    static safeFileName(value, fallback) {
        const result = String(value || '')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, ' ')
            .trim();
        return result || fallback;
    }
}
