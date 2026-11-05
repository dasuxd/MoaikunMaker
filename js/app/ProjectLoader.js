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
                    this.openProject(candidate, resources, cachedRom.fileName, true);
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
    openProject(project, resources, fileName, fromCache) {
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

        this.app.library.selectLevel(0, { skipUnsavedGuard: true });
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
        } catch (error) {
            console.error('Failed to export level data:', error);
        }
    }
}
