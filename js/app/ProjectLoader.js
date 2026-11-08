class ProjectLoader {
    constructor(app) { this.app = app; }
    /**
     * Initialize cache and try to auto-load
     */
    async initCache() {
        try {
            await this.app.projectCache.init();

            // Drafts are ROM-independent and must remain accessible even when
            // the cached ROM is missing or no longer parses.
            const cachedBackups = await this.app.projectCache.loadBackupLevels();
            if (cachedBackups && cachedBackups.length > 0) {
                const loadedDrafts = cachedBackups
                    .map((draft, index) => this.app.library.normalizeDraftLevel(draft, index))
                    .filter(Boolean);
                const mergedDrafts = [...this.app.backupLevels, ...loadedDrafts];
                this.app.backupLevels = mergedDrafts.filter((draft, index) =>
                    mergedDrafts.findIndex(candidate =>
                        candidate.id === draft.id ||
                        (candidate.checksum === draft.checksum &&
                         candidate.source === draft.source)
                    ) === index
                );
                this.app.library.renderBackupList();
            }

            // Load the ROM-independent formal level cache first. It can be
            // exported even if the cached ROM later fails to parse.
            const cachedLevelData = await this.app.projectCache.loadLevelData();
            if (cachedLevelData && cachedLevelData.levels) {
                this.app.recoveryLevelData = cachedLevelData;
            }
            this.updateRecoveryExportVisibility();

            const cachedRom = await this.app.projectCache.loadRom();

            if (cachedRom) {
                // Validate the source and independent level cache before
                // changing visible state. Cached edits take priority over
                // the older level bytes embedded in the ROM.
                try {
                    const candidate = new Project();
                    candidate.loadROM(cachedRom.data);
                    if(cachedLevelData?.levels) this.restoreProject(candidate,cachedLevelData);
                    const resources = new ResourceManager();
                    await resources.initResources(candidate.romData);
                    const editorState = await this.app.projectCache.loadEditorState();
                    this.openProject(candidate, resources, cachedRom.fileName, true, editorState);
                } catch (error) {
                    console.error('Failed to parse cached ROM:', error);
                    this.updateRecoveryExportVisibility();
                    this.app.showMessage('error', error.message || i18n.t('cachedRomParseFailed'));
                    this.app.exchange.initParams();
                    return;
                }

                this.app.showMessage('info', i18n.t('loadedFromCacheMessage', {fileName: cachedRom.fileName}));
            }else{
                // Parse and preserve a shared level even before a ROM is loaded.
                this.app.exchange.initParams();
            }
        } catch (error) {
            console.error('Failed to initialize cache:', error);
        }
    }

    /**
     * Handle file selection
     */
    restoreProject(editor,project) {
        if(!Array.isArray(project.levels) || !Number.isInteger(project.levelCount) ||
            project.levelCount < 1 || project.levelCount > project.levels.length ||
            project.levels.length > editor.getMaxCountOfLevels())
            throw new Error(i18n.t('romMigrationFailed'));
        for(const level of project.levels) {
            LevelFile.validateLevel({mapData:level.data,monsterData:level.monsterData});
            if(level.monsterData.length > RomLayout.MAX_ENEMIES_PER_LEVEL * 2 + 1)
                throw new Error(i18n.t('romMigrationFailed'));
        }
        editor.setGameConfig(project.gameConfig || {});
        if(!editor.importLevelsData(project.levels,project.levelCount))
            throw new Error(i18n.t('romMigrationFailed'));
        const checked = editor.checkRomData();
        if(!checked.success) throw new Error(checked.error);
    }

    handleFileSelect(event) {
        const file = event.target.files[0];
        if(!file) return;
        this.ready = this.ready.then(async () => {
            try {
                const bytes = await file.arrayBuffer();
                const candidate = new Project();
                candidate.loadROM(bytes);
                const recovery = !this.app.project.romData && this.app.recoveryLevelData;
                if (recovery) this.restoreProject(candidate, recovery);
                const drafts = this.app.backupLevels;
                const project = {levels:candidate.exportLevelsData(),levelCount:candidate.levelCount,
                    gameConfig:candidate.getGameConfig()};
                // Commit the base and recovered levels together before changing
                // the visible project. Failed uploads leave the old project intact.
                const resources = new ResourceManager();
                await resources.initResources(candidate.romData);
                await this.app.projectCache.saveProject(bytes,file.name,project,drafts);
                this.app.recoveryLevelData = project;
                this.app.backupLevels = drafts;
                this.openProject(candidate, resources, file.name, false);
                this.app.library.renderBackupList();
                if(recovery) this.app.showMessage('success',i18n.t('romMigrationSuccess',{count:project.levelCount}));
            } catch(error) {
                this.app.showMessage('error',error.message || i18n.t('romMigrationFailed'));
                this.updateRecoveryExportVisibility();
            } finally { event.target.value = ''; }
        });
    }

    /** Publish the prepared resources and project together, then select the initial level. */
    openProject(project, resources, fileName, fromCache, editorState = null) {
        this.editorCacheEnabled = false;
        this.app.fileName = fileName;
        this.app.project = project;
        ResourceManager.instance = resources;
        this.app.hideWelcomeOverlay();
        const levelCountInput = document.getElementById('levelCountInput');
        this.app.levelEditor.createButtons();
        levelCountInput.value = this.app.project.getLevelCount();

        this.app.syncGameConfigControls();
        const maxLevels = this.app.project.getMaxCountOfLevels();
        levelCountInput.max = maxLevels;

        this.app.library.createLevelList();
        this.app.updateMemoryOverview();
        // const editorSection = document.getElementById('editorSection');
        // editorSection.classList.remove('active');
        if (!fromCache) {
            //this.app.showMessage('success', `File loaded successfully: ${fileName} (${this.app.project.romData.length} bytes)`);
            this.app.showMessage('success', i18n.t("loadFileSuccess",{fileNameStr: fileName, length: project.romData.length}));
        }

        // Update button to display filename
        const romSelectBtn = document.getElementById('romSelectBtn');
        if (romSelectBtn) {
            romSelectBtn.textContent = `📁 ${fileName}`;
            romSelectBtn.classList.add('loaded');
            romSelectBtn.title = `${fileName} (${this.app.project.romData.length} Byte)`;
        }

        this.app.testLevelBtn.disabled = true;
        this.app.saveBtn.disabled = true;

        this.app.testBtn.disabled = true;
        this.app.downloadBtn.disabled = false;

        const index = Number.isInteger(editorState?.currentLevel) && editorState.currentLevel >= 0 &&
            editorState.currentLevel < project.getLevelCount() ? editorState.currentLevel : 0;
        this.app.library.selectLevel(index, { skipUnsavedGuard: true });
        this.restoreEditorState(editorState);
        this.editorCacheEnabled = true;
        this.saveEditorState();
        if (this.app.pendingSharedLevel && !this.app.hasSharedLevelLoaded) {
            const sharedLevel = this.app.pendingSharedLevel;
            this.app.pendingSharedLevel = null;
            this.app.exchange.loadSharedLevel(sharedLevel);
        } else if(!this.app.hasSharedLevelLoaded){
            this.app.exchange.initParams();
        }
    }

    updateRecoveryExportVisibility() {
        const recoveryButton = document.getElementById('recoveryExportBtn');
        if (!recoveryButton) return;
        const hasRecoveryData = Boolean(
            this.app.recoveryLevelData &&
            Array.isArray(this.app.recoveryLevelData.levels) &&
            this.app.recoveryLevelData.levels.length > 0
        );
        recoveryButton.style.display = hasRecoveryData || this.app.backupLevels.length ? 'inline-block' : 'none';
    }

    async clearCache() {
        if (confirm(i18n.t('clearRomCacheConfirm'))) {
            const wasEnabled = this.editorCacheEnabled;
            this.editorCacheEnabled = false;
            try {
                // "Clear cache" removes the ROM/project cache, not the user's
                // ROM-independent draft library.
                const drafts = this.app.backupLevels.map(draft => ({ ...draft }));
                await this.app.projectCache.clearCache(drafts);
                this.app.recoveryLevelData = null;
                this.updateRecoveryExportVisibility();
                this.app.showMessage('success', i18n.t('cacheCleanSuccess'));

                // Update button state
                const romSelectBtn = document.getElementById('romSelectBtn');
                if (romSelectBtn) {
                    romSelectBtn.textContent = i18n.t('selectNesRomFile');
                    romSelectBtn.classList.remove('loaded');
                    romSelectBtn.title = '';
                }
            } catch (error) {
                this.editorCacheEnabled = wasEnabled;
                this.app.showMessage('error', i18n.t('cacheCleanError'));
                console.error(error);
            }
        }
    }

    /**
     * Save level data to cache (separate from ROM)
     */
    saveLevelDataToCache() {
        try {
            const levelsData = this.app.project.exportLevelsData();
            const levelCount = this.app.project.getLevelCount();
            const gameConfig = this.app.project.getGameConfig();
            this.app.recoveryLevelData = {
                levels: levelsData,
                levelCount,
                gameConfig,
                timestamp: Date.now()
            };
            this.updateRecoveryExportVisibility();
            this.app.projectCache.saveLevelData(
                levelsData,
                levelCount,
                gameConfig
            ).catch((error) => {
                console.error('Failed to save level data to cache:', error);
            });
            this.saveEditorState();
        } catch (error) {
            console.error('Failed to export level data:', error);
        }
    }

    // Keep the working canvas separate from saved ROM levels/drafts. Raw
    // source and optimized maps must both survive, without another codec pass.
    saveEditorState() {
        const app = this.app;
        if (!this.editorCacheEnabled || app.isEditingLevels || !app.project.romData || app.editorBaseline === null) return;
        try {
            const content = app.library.createEditorSnapshot();
            const owner = app.editorSource === 'draft' ? app.library.getCurrentDraft() : app.project.getLevel(app.currentLevel);
            if (!content || !owner) return;
            const state = {
                version: 1, currentLevel: app.currentLevel, source: app.editorSource, draftId: app.currentDraftId,
                owner: JSON.stringify([owner.data || owner.mapData, owner.monsterData]),
                content: JSON.parse(content), baseline: app.editorBaseline,
                optimizedMap: app.levelEditor.optimizedMapData.map(row => [...row])
            };
            this.editorSave = app.projectCache.saveEditorState(state).catch(error => {
                console.error('Failed to cache the current editor:', error);
            });
            return this.editorSave;
        } catch (error) {
            console.error('Failed to snapshot the current editor:', error);
        }
    }

    restoreEditorState(state) {
        if (!state || state.version !== 1) return;
        const app = this.app, editor = app.levelEditor, data = state.content;
        // Bad/stale workspace metadata must never prevent opening the ROM.
        const validMap = map => Array.isArray(map) && map.length === EditorGrid.GRID_HEIGHT &&
            map.every(row => Array.isArray(row) && row.length >= 16 && row.length <= 32 &&
                row.every(tile => tile == null || (Number.isInteger(tile) && tile >= 0 && tile <= 15)));
        const validPoint = p => p === null || (p && Number.isInteger(p.x) && Number.isInteger(p.y) &&
            p.x >= 0 && p.x < 32 && p.y >= 0 && p.y < 16);
        if (!data || !validMap(data.map) || !validMap(state.optimizedMap) ||
            !Number.isInteger(Number(data.background)) || Number(data.background) < 0 || Number(data.background) >= 12 ||
            typeof data.isWideScreen !== 'boolean' || typeof data.isBuggyScreen !== 'boolean' ||
            !validPoint(data.player) || !validPoint(data.door) || !Array.isArray(data.enemies) ||
            data.enemies.length > RomLayout.MAX_ENEMIES_PER_LEVEL || data.enemies.some(e => !e || !validPoint(e) ||
                !Number.isInteger(e.id) || e.id < 0 || e.id > 255) || typeof state.baseline !== 'string') return;
        let owner;
        if (state.source === 'draft') {
            owner = app.backupLevels.find(draft => draft.id === state.draftId);
        } else if (state.source === 'formal' && state.currentLevel === app.currentLevel) {
            owner = app.project.getLevel(state.currentLevel);
        }
        if (!owner || JSON.stringify([owner.data || owner.mapData, owner.monsterData]) !== state.owner) return;
        if (state.source === 'draft') app.library.loadDraftLevel(app.backupLevels.indexOf(owner));
        editor.isWideScreen = data.isWideScreen;
        editor.isBuggyScreen = data.isBuggyScreen;
        editor.currentBgId = data.background;
        editor.mapData = data.map.map(row => [...row]);
        editor.optimizedMapData = state.optimizedMap.map(row => [...row]);
        editor.playerPos = data.player && {...data.player};
        editor.doorPos = data.door && {...data.door};
        // Snapshot coordinates are already world coordinates, including page 2.
        editor.enemies = data.enemies.map(e => new Enemy(e.id, e.x, e.y));
        app.editorBaseline = state.baseline;
        editor.modified = app.library.hasUnsavedChanges();
        app.saveBtn.disabled = !editor.modified;
        editor.resetImages();
        editor.updateButtonImages();
        editor.updateDataDisplays();
    }
}
