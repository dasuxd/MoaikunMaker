class LevelLibrary {
    constructor(app) { this.app = app; }
    switchLevelLibraryTab(tab) {
        const nextTab = tab === 'drafts' ? 'drafts' : 'formal';
        this.app.activeLevelLibraryTab = nextTab;

        const formalTab = document.getElementById('formalLevelsTab');
        const draftTab = document.getElementById('draftLevelsTab');
        const formalPanel = document.getElementById('formalLevelsPanel');
        const draftPanel = document.getElementById('draftLevelsPanel');
        const isFormal = nextTab === 'formal';

        formalTab?.classList.toggle('active', isFormal);
        draftTab?.classList.toggle('active', !isFormal);
        formalTab?.setAttribute('aria-selected', String(isFormal));
        draftTab?.setAttribute('aria-selected', String(!isFormal));

        if (formalPanel) {
            formalPanel.classList.toggle('active', isFormal);
            formalPanel.hidden = !isFormal;
        }
        if (draftPanel) {
            draftPanel.classList.toggle('active', !isFormal);
            draftPanel.hidden = isFormal;
        }
    }

    ensureLevelSlots(count) {
        while (this.app.project.levels.length < count) {
            this.app.project.levels.push(new Level(this.app.project.levels.length));
        }
    }

    applyLevelOrderEditingState() {
        this.updateResetLevelButton();
        const levelCountInput = document.getElementById('levelCountInput');
        if (levelCountInput) {
            levelCountInput.disabled = !this.app.isEditingLevels;
        }

        const activeCount = this.app.project.getLevelCount();
        for (let i = 0; i < this.app.project.levels.length; i++) {
            const item = this.app.levelItems.get(this.app.project.levels[i]);
            if (!item) continue;
            const isActive = i < activeCount;
            const dragHandle = item.querySelector('.drag-handle');
            if (dragHandle) {
                dragHandle.style.display = this.app.isEditingLevels && isActive ? 'flex' : 'none';
            }
            item.classList.toggle('no-drag', !this.app.isEditingLevels || !isActive);
        }
    }

    // Create level list
    createLevelList(){
        const listElement = document.getElementById('levelList');

        // Destroy old Sortable instance to avoid duplicate bindings that prevent mobile re-dragging
        if (this.app.sortable) {
            this.app.sortable.destroy();
            this.app.sortable = null;
        }

        // Clear list only after Sortable has released its DOM event bindings
        listElement.innerHTML = '';

        const levels = this.app.project.getAllLevels();

        // Show sidebar toggle button and main layout
        document.getElementById('mainLayout').style.display = 'flex';
        document.getElementById('sidebarToggle').style.display = 'flex';

        // Toolbar drawer button: only show in non-drag mode
        const toolbarToggleBtn = document.getElementById('toolbarToggle');
        const toolbarEl = document.getElementById('toolbar');
        if (toolbarToggleBtn && toolbarEl) {
            if (!toolbarEl.classList.contains('draggable-mode')) {
                toolbarToggleBtn.style.display = 'flex';
            }
        }

        // The count input is enabled only while editing the formal level group.
        const levelCountInput = document.getElementById('levelCountInput');
        if (levelCountInput) {
            levelCountInput.value = this.app.project.getLevelCount();
            levelCountInput.disabled = !this.app.isEditingLevels;
        }

        this.ensureLevelSlots(this.app.project.getLevelCount());

        for (let i = 0; i < levels.length; i++) {
            const level = levels[i];
            level.index = i;
            level.isDeleted = i >= this.app.project.getLevelCount();
            const item = this.createLevelItem(level, i);
            this.app.levelItems.set(level, item);
            item.classList.add('no-drag');
            listElement.append(item);
        }

        this.app.sortable = new Sortable(listElement, {
            // The list is a three-column grid laid out in row-major order
            direction: 'horizontal',
            swapThreshold: 1,
            animation: 150,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            filter: '.no-drag',
            handle: '.drag-handle',
            // Use one drag implementation for desktop, touch devices and scrollable sidebars
            forceFallback: true,
            fallbackOnBody: true,
            fallbackTolerance: 5,
            delay: 100,
            delayOnTouchOnly: true,
            touchStartThreshold: 5,
            // Prevent scroll conflict
            preventOnFilter: false,
            onMove: function(evt) {
                if (evt.related?.classList.contains('inactive-level')) {
                    return false;
                }
                return true;
            },
            onEnd: evt => {
                // If position unchanged, return directly
                if (evt.oldIndex === evt.newIndex) {
                    return;
                }

                // Update levels array order
                const [movedLevel] = this.app.project.levels.splice(evt.oldIndex, 1);
                this.app.project.levels.splice(evt.newIndex, 0, movedLevel);

                // Update all levels' index and dataset.index
                for (let i = 0; i < this.app.project.levels.length; i++) {
                    this.app.project.levels[i].index = i;
                    if (this.app.levelItems.get(this.app.project.levels[i])) {
                        this.app.levelItems.get(this.app.project.levels[i]).dataset.index = i;
                    }
                }

                // Mark order as changed
                this.app.levelsListChanged = true;

                // Update currently selected level index
                if (this.app.currentLevel === evt.oldIndex) {
                    this.app.currentLevel = evt.newIndex;
                } else if (evt.oldIndex < this.app.currentLevel && evt.newIndex >= this.app.currentLevel) {
                    this.app.currentLevel--;
                } else if (evt.oldIndex > this.app.currentLevel && evt.newIndex <= this.app.currentLevel) {
                    this.app.currentLevel++;
                }
            }
            });
        this.applyLevelOrderEditingState();
        this.renderBackupList();
    }

    createLevelItem(level, index){
        const item = document.createElement('div');
        item.className = 'level-item';
        const isInactive = index >= this.app.project.getLevelCount();
        if (isInactive) {
            item.classList.add('inactive-level');
            item.setAttribute('aria-disabled', 'true');
            item.title = i18n.t('inactiveLevelHint');
        }
        if (!isInactive && this.app.editorSource === 'formal' && this.app.currentLevel === index) {
            item.classList.add('active');
        }
        item.dataset.index =index;

        // Create drag handle
        const dragHandle = document.createElement('span');
        dragHandle.className = 'drag-handle';
        dragHandle.textContent = '⋮⋮';
        dragHandle.style.display = 'none'; // Hidden by default

        item.appendChild(dragHandle);

        // Create clickable content area
        const content = document.createElement('div');
        content.className = 'level-content';
        content.tabIndex = isInactive ? -1 : 0;

        // Track touch position to prevent accidental clicks during scrolling
        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartTime = 0;

        content.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchStartTime = Date.now();
        }, { passive: true });

        content.addEventListener('touchend', (e) => {
            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;
            const touchEndTime = Date.now();

            // Calculate swipe distance
            const deltaX = Math.abs(touchEndX - touchStartX);
            const deltaY = Math.abs(touchEndY - touchStartY);
            const deltaTime = touchEndTime - touchStartTime;

            // Only consider it a click if distance < 10px and time < 300ms
            if (!isInactive && deltaX < 10 && deltaY < 10 && deltaTime < 300) {
                e.preventDefault();
                e.stopPropagation();
                this.selectLevel(index);
            }
        }, { passive: false });

        // Keep click event for desktop
        content.onclick = (e) => {
            if (!isInactive && !('ontouchstart' in window)) {
                this.selectLevel(index);
            }
        };

        content.addEventListener('keydown', event => {
            if (!isInactive && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                this.selectLevel(index);
            }
        });

        let levelLabel = i18n.t('levelLabel', {level: level.getLevelNumber()});

        content.innerHTML = `
            <span class="level-wrapper ${level.isDragged() ? 'dragged' : ''}" style="position:relative;display:block;">
                <span class="level-num">${levelLabel}</span>
            </span>
            <span class="level-info">${level.getDataSize()} B${isInactive ? ` · ${i18n.t('inactiveLevelShort')}` : ''}</span>
        `;
        item.appendChild(content);
        return item;
        //listElement.appendChild(item);
    }

    /**
     * Select level for editing
     */
    selectLevel(index, options = {}) {
        if (index < 0 || index >= this.app.project.getLevelCount()) {
            this.app.showMessage('warning', i18n.t('inactiveLevelHint'));
            return false;
        }

        if (!options.skipUnsavedGuard &&
            this.app.currentLevel >= 0 &&
            (this.app.editorSource !== 'formal' || this.app.currentLevel !== index) &&
            this.hasUnsavedChanges()) {
            this.requestAfterUnsavedChanges(() => this.selectLevel(index, {
                skipUnsavedGuard: true
            }));
            return false;
        }

        return this.selectLevelNow(index, options);
    }

    /**
     * Select a level without prompting. Call through selectLevel() unless the
     * caller has already resolved unsaved edits.
     */
    selectLevelNow(index, options = {}) {
        const level = this.app.project.getLevel(index);
        if (!level) {
            this.app.showMessage('error', i18n.t('invalidLevelIndexError'));
            return false;
        }
        if (index >= this.app.project.getLevelCount()) {
            this.app.showMessage('warning', i18n.t('inactiveLevelHint'));
            return false;
        }
        const preserveEditorState = options.preserveEditorState === true &&
            this.app.editorSource === 'formal' &&
            this.app.currentLevel === index;
        this.app.editorSource = 'formal';
        this.app.currentDraftId = null;
        this.app.currentLevel = index;

        // Update selection state
        const items = document.querySelectorAll('.level-item');
        items.forEach(item => {
            item.classList.toggle('active', Number(item.dataset.index) === index);
        });
        document.querySelectorAll('.backup-level-item').forEach(item => {
            item.classList.remove('active');
        });
        this.updateDraftActionState();

        // Show editor
        // const editorSection = document.getElementById('editorSection');
        // editorSection.classList.add('active');
        //editorSection.scrollIntoView({ behavior: 'smooth' });

        // Update editor content
        // document.getElementById('editorTitle').textContent =
        //     `Edit Level ${level.getLevelNumber()}`;
        document.getElementById('romAddress').textContent = level.getRomAddressString();
        document.getElementById('cpuAddress').textContent = level.getCpuAddressString();
        document.getElementById('monsterRomAddress').textContent =  level.getMonsterRomAddressString();
        document.getElementById('monsterCpuAddress').textContent = level.getMonsterCpuAddressString();
        document.getElementById('hexData').value = level.getHexString();
        document.getElementById('monsterData').value = level.getMonsterHexString();

        //this.app.updateDataSize();
        this.app.validateMonsterData();

        // A normal level selection loads the saved ROM data into the visual
        // editor. After save, however, the editor already contains the source
        // map and its optimized result. Reloading that optimized ROM data would
        // optimize it a second time (notably shortening Tile 3 columns in
        // backgrounds 0 and 1), so the save refresh keeps the editor state.
        if (!preserveEditorState) {
            this.loadLevelToVisualEditor(level);
        }
        this.markEditorClean();

        this.app.testLevelBtn.disabled = false;;
        this.app.testBtn.disabled = false;;

        // Show/hide visual edit button
        //document.getElementById('visualEditBtn').style.display = 'inline-block';
        return true;
    }

    /**
     * Load level data to visual editor
     */
    loadLevelToVisualEditor(level) {
        try {
            // Get level data (Level class uses data and monsterData properties)
            const mapData = level.data;
            const monsterData = level.monsterData;

            // Convert to visual editor format
            const editorData = LevelCodec.fromROMtoEditor(mapData, monsterData);

            // Load to visual editor
            if (this.app.levelEditor) {
                this.app.levelEditor.loadFromData(editorData, this.app.currentLevel);
            }
        } catch (error) {
            console.error('Failed to load level to visual editor:', error);
        }
    }

    createEditorSnapshot() {
        if (!this.app.levelEditor || this.app.currentLevel < 0) {
            return null;
        }

        const editor = this.app.levelEditor;
        return JSON.stringify({
            background: String(editor.currentBgId),
            isWideScreen: Boolean(editor.isWideScreen),
            isBuggyScreen: Boolean(editor.isBuggyScreen),
            map: Array.isArray(editor.mapData)
                ? editor.mapData.map(row => Array.isArray(row) ? [...row] : [])
                : [],
            player: editor.playerPos
                ? { x: editor.playerPos.x, y: editor.playerPos.y }
                : null,
            door: editor.doorPos
                ? { x: editor.doorPos.x, y: editor.doorPos.y }
                : null,
            enemies: Array.isArray(editor.enemies)
                ? editor.enemies.map(enemy => ({
                    id: enemy.enemyId,
                    x: enemy.x,
                    y: enemy.y
                }))
                : []
        });
    }

    markEditorClean() {
        if (!this.app.levelEditor) return;
        this.app.levelEditor.modified = false;
        this.app.editorBaseline = this.createEditorSnapshot();
        if (this.app.saveBtn) {
            this.app.saveBtn.disabled = true;
        }
    }

    hasUnsavedChanges() {
        if (!this.app.levelEditor) {
            return false;
        }
        if (this.app.editorBaseline === null) {
            return Boolean(this.app.levelEditor.modified);
        }
        return this.createEditorSnapshot() !== this.app.editorBaseline;
    }

    requestAfterUnsavedChanges(action) {
        if (!this.hasUnsavedChanges()) {
            action();
            return true;
        }

        this.app.pendingUnsavedAction = action;
        const modal = document.getElementById('unsavedChangesModal');
        if (modal) {
            modal.hidden = false;
        }
        return false;
    }

    resolveUnsavedChanges(choice) {
        const modal = document.getElementById('unsavedChangesModal');
        const action = this.app.pendingUnsavedAction;

        if (choice === 'cancel') {
            this.app.pendingUnsavedAction = null;
            if (modal) modal.hidden = true;
            return;
        }

        if (choice === 'draft' && !this.backupCurrentLevel()) {
            return;
        }

        if (choice !== 'discard' && choice !== 'draft') {
            return;
        }

        this.app.pendingUnsavedAction = null;
        this.app.levelEditor.modified = false;
        if (modal) modal.hidden = true;
        if (typeof action === 'function') {
            action();
        }
    }

    normalizeDraftLevel(draft, index = 0) {
        try {
            const allowedSources = new Set([
                'unsaved', 'import', 'shared', 'recovered', 'file', 'editor', 'pack'
            ]);
            const levelNumber = Number.isInteger(draft.levelNumber)
                ? draft.levelNumber
                : (Number.isInteger(draft.levelIndex) ? draft.levelIndex + 1 : null);
            return LevelFile.validateLevel({
                ...draft,
                id: draft.id || LevelFile.createId('draft'),
                name: draft.name || (levelNumber
                    ? i18n.t('draftFromLevel', { level: levelNumber })
                    : i18n.t('draftDefaultName', { number: index + 1 })),
                source: allowedSources.has(draft.source) ? draft.source : 'unsaved',
                mapData: draft.mapData ?? draft.data,
                createdAt: draft.createdAt ?? draft.timestamp ?? Date.now()
            });
        } catch (error) {
            console.warn('Skipped invalid draft level:', error);
            return null;
        }
    }

    saveDraftLevels() {
        this.app.loader.updateRecoveryExportVisibility();
        this.app.projectCache.saveBackupLevels(this.app.backupLevels).catch((error) => {
            console.error('Failed to save draft levels:', error);
        });
    }

    getCurrentDraft() {
        if (this.app.editorSource !== 'draft' || !this.app.currentDraftId) {
            return null;
        }
        return this.app.backupLevels.find(draft => draft.id === this.app.currentDraftId) || null;
    }

    updateDraftActionState() {
        this.updateResetLevelButton();
        const hasDrafts = this.app.backupLevels.length > 0;
        const hasCurrentDraft = Boolean(this.getCurrentDraft());
        const currentButton = document.getElementById('exportCurrentDraftBtn');
        const allButton = document.getElementById('exportAllDraftsBtn');
        const badge = document.getElementById('draftCountBadge');
        if (currentButton) currentButton.disabled = !hasCurrentDraft;
        if (allButton) allButton.disabled = !hasDrafts;
        if (badge) badge.textContent = String(this.app.backupLevels.length);
    }

    canResetCurrentLevel() {
        const {project, currentLevel, editorSource, isEditingLevels} = this.app;
        return project.romData && editorSource === 'formal' && !isEditingLevels &&
            currentLevel >= 0 && currentLevel < project.getLevelCount();
    }

    updateResetLevelButton() {
        const button = document.getElementById('resetLevelBtn');
        if (!button) return;
        button.disabled = !this.canResetCurrentLevel();
        button.dataset.i18n = this.app.currentLevel >= RomLayout.MAX_LEVEL_COUNT_ORIGINAL
            ? 'clearMap' : 'resetLevel';
        button.textContent = i18n.t(button.dataset.i18n);
    }

    resetCurrentLevel() {
        if (!this.canResetCurrentLevel()) return;
        const {project, currentLevel: index, levelEditor: editor} = this.app;
        const params = {number: index + 1};
        const extended = index >= RomLayout.MAX_LEVEL_COUNT_ORIGINAL;
        const original = extended ? null : project.getOriginalLevel(index);
        if (!extended && !original) {
            this.app.showMessage('warning', i18n.t('originalLevelMissing', params));
            return;
        }
        if (!confirm(i18n.t(extended ? 'clearExtendedLevelConfirm' : 'resetLevelConfirm', params))) return;

        const level = project.getLevel(index);
        if (extended) {
            // A zero player byte means "absent"; an empty level still needs a spawn and exit.
            const player = editor.playerPos;
            const door = editor.doorPos || {x: 12, y: 8};
            level.data = [Number(editor.currentBgId) | (editor.isWideScreen ? 0x10 : 0),
                (player && (player.x * 16 + player.y)) || 0x48, door.x, door.y];
            level.monsterData = [1];
        } else {
            level.data = original.data;
            level.monsterData = original.monsterData;
        }
        level.modified = true;
        project.refreshLevelAddresses();
        this.selectLevel(index, {skipUnsavedGuard: true});
        this.app.updateMemoryOverview();
        this.app.loader.saveLevelDataToCache();
        this.app.showMessage('success', i18n.t(extended ? 'levelCleared' : 'levelRestored', params));
    }

    saveCurrentDraft({ showMessage = true } = {}) {
        const draft = this.getCurrentDraft();
        if (!draft) return false;

        try {
            const levelRomData = this.app.getCurrentLevelRomData();
            if (!levelRomData) return false;
            const updatedDraft = LevelFile.validateLevel({
                ...draft,
                mapData: levelRomData.mapData,
                monsterData: levelRomData.monsterData,
                checksum: null
            }, draft.name);
            const draftIndex = this.app.backupLevels.findIndex(item => item.id === draft.id);
            if (draftIndex < 0) return false;

            this.app.backupLevels[draftIndex] = updatedDraft;
            this.app.currentDraftId = updatedDraft.id;
            this.saveDraftLevels();
            this.markEditorClean();
            this.renderBackupList();
            if (showMessage) {
                this.app.showMessage('success', i18n.t('draftSavedSuccess', {
                    name: updatedDraft.name
                }));
            }
            return true;
        } catch (error) {
            this.app.showMessage('error', i18n.t('levelDraftFailed', { error: error.message }));
            return false;
        }
    }

    addDraftLevel(levelData, options = {}) {
        const draft = this.normalizeDraftLevel({
            ...levelData,
            id: levelData.id || LevelFile.createId('draft'),
            createdAt: levelData.createdAt || Date.now()
        }, this.app.backupLevels.length);
        if (!draft) return null;

        if (options.deduplicate) {
            const existing = this.app.backupLevels.find(item =>
                item.checksum === draft.checksum && item.source === draft.source);
            if (existing) {
                return existing;
            }
        }

        this.app.backupLevels.unshift(draft);
        this.saveDraftLevels();
        this.renderBackupList();
        return draft;
    }

    backupCurrentLevel() {
        try {
            if (!this.hasUnsavedChanges()) return true;
            if (this.app.editorSource === 'draft') {
                return this.saveCurrentDraft();
            }
            const levelRomData = this.app.getCurrentLevelRomData();
            if (!levelRomData) return false;

            const draft = this.addDraftLevel({
                name: i18n.t('draftFromLevel', { level: this.app.currentLevel + 1 }),
                source: 'unsaved',
                levelIndex: this.app.currentLevel,
                mapData: levelRomData.mapData,
                monsterData: levelRomData.monsterData,
                createdAt: Date.now()
            });
            if (!draft) return false;

            this.app.showMessage('warning', i18n.t('levelDraftCreated', {
                level: this.app.currentLevel + 1
            }));
            return true;
        } catch (error) {
            console.error('Failed to create draft level:', error);
            this.app.showMessage('error', i18n.t('levelDraftFailed', { error: error.message }));
            return false;
        }
    }

    loadDraftLevel(draftIndex) {
        const draft = this.app.backupLevels[draftIndex];
        if (!draft) return;
        if (!this.app.project.romData) {
            this.app.showMessage('error', i18n.t('romRequiredForDraft'));
            return;
        }

        this.requestAfterUnsavedChanges(() => {
            this.app.editorSource = 'draft';
            this.app.currentDraftId = draft.id;
            this.switchLevelLibraryTab('drafts');
            const editorData = LevelCodec.fromROMtoEditor(
                draft.mapData,
                draft.monsterData
            );
            this.app.levelEditor.loadFromData(editorData, null);
            document.getElementById('hexData').value = draft.mapData
                .map(byte => byte.toString(16).toUpperCase().padStart(2, '0'))
                .join(' ');
            document.getElementById('monsterData').value = draft.monsterData
                .map(byte => byte.toString(16).toUpperCase().padStart(2, '0'))
                .join(' ');
            document.getElementById('romAddress').textContent = '-';
            document.getElementById('cpuAddress').textContent = '-';
            document.getElementById('monsterRomAddress').textContent = '-';
            document.getElementById('monsterCpuAddress').textContent = '-';
            document.querySelectorAll('.level-item').forEach(item => {
                item.classList.remove('active');
            });
            this.markEditorClean();
            this.app.testLevelBtn.disabled = false;
            this.app.testBtn.disabled = false;
            this.renderBackupList();
            this.app.showMessage('success', i18n.t('draftLoadedSuccess', {
                name: draft.name
            }));
        });
    }

    restoreBackupLevel(backupIndex) {
        this.loadDraftLevel(backupIndex);
    }

    appendDraftToFormal(draftIndex) {
        const draft = this.app.backupLevels[draftIndex];
        if (!draft) return;
        if (!this.app.project.romData) {
            this.app.showMessage('error', i18n.t('romRequiredForDraft'));
            return;
        }

        const activeCount = this.app.project.getLevelCount();
        if (activeCount >= this.app.project.getMaxCountOfLevels()) {
            this.app.showMessage('error', i18n.t('invalidLevelCountMessageError', {
                maxLevelCount: this.app.project.getMaxCountOfLevels()
            }));
            return;
        }

        try {
            let mapData = draft.mapData;
            let monsterData = draft.monsterData;
            if (this.app.currentDraftId === draft.id && this.hasUnsavedChanges()) {
                const editorData = this.app.getCurrentLevelRomData();
                if (!editorData) return;
                mapData = editorData.mapData;
                monsterData = editorData.monsterData;
                this.app.backupLevels[draftIndex] = LevelFile.validateLevel({
                    ...draft,
                    mapData,
                    monsterData,
                    checksum: null
                }, draft.name);
                this.app.currentDraftId = this.app.backupLevels[draftIndex].id;
                this.saveDraftLevels();
                this.markEditorClean();
            }

            const activeRecords = this.app.project.levels
                .slice(0, activeCount)
                .map(level => ({
                    mapData: level.data,
                    monsterData: level.monsterData
                }));
            const nextRecords = [
                ...activeRecords,
                { mapData, monsterData }
            ];
            if (!this.app.exchange.validatePackCapacity(nextRecords)) {
                return;
            }

            const enemyCountResult = this.app.project.checkTotalEnemyCount(
                nextRecords.map((record, index) =>
                    new Level(index, 0, 0, record.mapData, record.monsterData)),
                nextRecords.length
            );
            if (!enemyCountResult.valid) {
                this.app.showMessage('error', enemyCountResult.error);
                return;
            }

            const addedLevel = new Level(
                activeCount,
                0,
                0,
                [...mapData],
                [...monsterData]
            );
            addedLevel.originalIndex = -1;
            addedLevel.modified = true;

            // Inactive/grey levels remain recoverable. The new formal level is
            // inserted immediately before them.
            this.app.project.levels.splice(activeCount, 0, addedLevel);
            this.app.project.setLevelCount(activeCount + 1);
            this.app.project.levels.forEach((level, index) => {
                level.index = index;
                level.isDeleted = index >= this.app.project.getLevelCount();
            });
            this.app.project.refreshLevelAddresses();
            this.app.project.modified = true;

            const levelCountInput = document.getElementById('levelCountInput');
            if (levelCountInput) {
                levelCountInput.value = this.app.project.getLevelCount();
            }
            this.app.loader.saveLevelDataToCache();
            this.createLevelList();
            this.app.updateMemoryOverview();
            this.switchLevelLibraryTab('formal');
            this.selectLevel(activeCount, { skipUnsavedGuard: true });
            this.app.showMessage('success', i18n.t('draftAddedToFormalSuccess', {
                name: draft.name,
                level: activeCount + 1
            }));
        } catch (error) {
            this.app.showMessage('error', i18n.t('draftAddToFormalFailed', {
                error: error.message
            }));
        }
    }

    deleteBackupLevel(backupIndex) {
        const draft = this.app.backupLevels[backupIndex];
        if (!draft || !confirm(i18n.t('deleteDraftConfirm', { name: draft.name }))) {
            return;
        }
        this.app.backupLevels.splice(backupIndex, 1);
        if (this.app.currentDraftId === draft.id) {
            this.app.currentDraftId = null;
            this.app.editorSource = 'formal';
            const nextFormalIndex = Math.min(
                this.app.currentLevel,
                this.app.project.getLevelCount() - 1
            );
            if (this.app.project.romData && nextFormalIndex >= 0) {
                this.selectLevel(nextFormalIndex, { skipUnsavedGuard: true });
            } else {
                this.app.editorBaseline = null;
            }
        }
        this.saveDraftLevels();
        this.renderBackupList();
    }

    closeBackupActionMenus(exceptMenu = null) {
        document.querySelectorAll('.backup-action-menu:not([hidden])').forEach(menu => {
            if (menu === exceptMenu) return;
            menu.hidden = true;
            const toggle = menu.parentElement?.querySelector('.backup-action-toggle');
            if (toggle) toggle.setAttribute('aria-expanded', 'false');
        });
    }

    renderBackupList() {
        const container = document.getElementById('backupLevelList');
        const section = document.getElementById('backupSection');
        if (!container || !section) return;

        container.innerHTML = '';
        const emptyState = document.getElementById('draftEmptyState');
        if (this.app.backupLevels.length === 0) {
            if (emptyState) emptyState.style.display = 'block';
            this.updateDraftActionState();
            return;
        }
        if (emptyState) emptyState.style.display = 'none';

        this.app.backupLevels.forEach((draft, index) => {
            const item = document.createElement('div');
            item.className = 'backup-level-item';
            item.dataset.draftId = draft.id;
            item.classList.toggle('active',
                this.app.editorSource === 'draft' && this.app.currentDraftId === draft.id);

            const content = document.createElement('div');
            content.className = 'backup-level-content';
            content.tabIndex = 0;
            content.setAttribute('role', 'button');
            content.addEventListener('click', () => this.loadDraftLevel(index));
            content.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    this.loadDraftLevel(index);
                }
            });

            const name = document.createElement('span');
            name.className = 'backup-level-num';
            name.textContent = draft.name;

            const source = document.createElement('span');
            source.className = 'backup-level-source';
            source.textContent = i18n.t(`draftSource_${draft.source}`);

            const time = document.createElement('span');
            time.className = 'backup-level-time';
            time.textContent = new Date(draft.createdAt).toLocaleString();

            const meta = document.createElement('span');
            meta.className = 'backup-level-meta';
            meta.append(source, time);
            content.append(name, meta);

            const actions = document.createElement('div');
            actions.className = 'backup-level-actions';

            const actionToggle = document.createElement('button');
            actionToggle.className = 'backup-action-toggle';
            actionToggle.type = 'button';
            actionToggle.id = `backupActionToggle_${index}`;
            actionToggle.setAttribute('aria-haspopup', 'menu');
            actionToggle.setAttribute('aria-expanded', 'false');

            const actionToggleLabel = document.createElement('span');
            actionToggleLabel.textContent = i18n.t('operations');
            const actionChevron = document.createElement('span');
            actionChevron.className = 'backup-action-chevron';
            actionChevron.setAttribute('aria-hidden', 'true');
            actionChevron.textContent = '▼';
            actionToggle.append(actionToggleLabel, actionChevron);

            const actionMenu = document.createElement('div');
            actionMenu.className = 'backup-action-menu';
            actionMenu.id = `backupActionMenu_${index}`;
            actionMenu.setAttribute('role', 'menu');
            actionMenu.setAttribute('aria-labelledby', actionToggle.id);
            actionMenu.hidden = true;
            actionToggle.setAttribute('aria-controls', actionMenu.id);

            actionToggle.addEventListener('click', event => {
                event.stopPropagation();
                const shouldOpen = actionMenu.hidden;
                this.closeBackupActionMenus();
                if (shouldOpen) {
                    actionMenu.hidden = false;
                    actionToggle.setAttribute('aria-expanded', 'true');
                }
            });
            actionMenu.addEventListener('click', event => event.stopPropagation());

            const createActionButton = (icon, label, handler, className = '') => {
                const button = document.createElement('button');
                button.className = `backup-action-menu-item ${className}`.trim();
                button.type = 'button';
                button.title = label;
                button.setAttribute('role', 'menuitem');

                const iconElement = document.createElement('span');
                iconElement.className = 'backup-action-icon';
                iconElement.setAttribute('aria-hidden', 'true');
                iconElement.textContent = icon;
                const labelElement = document.createElement('span');
                labelElement.textContent = label;
                button.append(iconElement, labelElement);
                button.addEventListener('click', event => {
                    event.stopPropagation();
                    this.closeBackupActionMenus();
                    handler();
                });
                return button;
            };

            const addButton = createActionButton(
                '➕',
                i18n.t('addDraftToFormal'),
                () => this.appendDraftToFormal(index)
            );
            addButton.disabled = !this.app.project.romData ||
                this.app.project.getLevelCount() >= this.app.project.getMaxCountOfLevels();

            const loadButton = createActionButton(
                '✏️',
                i18n.t('loadDraft'),
                () => this.loadDraftLevel(index)
            );
            const exportButton = createActionButton(
                '📤',
                i18n.t('exportDraft'),
                () => this.app.exchange.exportDraftLevel(index)
            );
            const deleteButton = createActionButton(
                '🗑️',
                i18n.t('deleteDraft'),
                () => this.deleteBackupLevel(index),
                'danger'
            );

            actionMenu.append(addButton, loadButton, exportButton, deleteButton);
            actions.append(actionToggle, actionMenu);
            item.append(content, actions);
            container.appendChild(item);
        });
        this.updateDraftActionState();
    }

    startEditLevels() {
        this.app.isEditingLevels = true;

        // Backup current order (shallow copy array, Level objects keep reference)
        this.app.originalLevelsOrder = this.app.project.levels.slice();
        this.app.originalLevelCount = this.app.project.getLevelCount();
        this.app.levelsListChanged = false;

        // Toggle button display
        document.getElementById('editLevelsBtn').style.display = 'none';
        document.getElementById('editLevelsActionButtons').style.display = 'flex';

        // Enable level count input
        const levelCountInput = document.getElementById('levelCountInput');
        if (levelCountInput) {
            levelCountInput.disabled = false;
        }

        this.applyLevelOrderEditingState();
    }

    hideDragHandle(){
        this.applyLevelOrderEditingState();
    }

    /**
     * Cancel editing level order
     */
    cancelEditLevels() {
        this.app.isEditingLevels = false;

        // Toggle button display
        document.getElementById('editLevelsBtn').style.display = 'block';
        document.getElementById('editLevelsActionButtons').style.display = 'none';

        // Disable level count input
        const levelCountInput = document.getElementById('levelCountInput');
        // If user made changes, restore original order
        if (this.app.levelsListChanged && this.app.originalLevelsOrder) {
            this.app.project.levels = this.app.originalLevelsOrder.slice();
            this.app.project.setLevelCount(this.app.originalLevelCount);

            // Reset all level indices to ensure correct level numbers
            for (let i = 0; i < this.app.project.levels.length; i++) {
                this.app.project.levels[i].index = i;
            }

            this.app.originalLevelsOrder = null;
            this.app.originalLevelCount = null;
            this.app.levelsListChanged = false;

            // Recreate list to reflect restored order
            this.createLevelList();

            // Restore current selected level (if any)
            if (this.app.editorSource === 'formal' &&
                this.app.currentLevel >= 0 &&
                this.app.currentLevel < this.app.project.getLevelCount()) {
                this.selectLevel(this.app.currentLevel);
            }

            this.app.showMessage('warning', i18n.t("changeLevelOrderCancelWarning"));
        } else {
            // No changes, just hide drag handles
            this.hideDragHandle();
            this.app.originalLevelsOrder = null;
            this.app.originalLevelCount = null;
        }

        if (levelCountInput) {
            levelCountInput.value = this.app.project.getLevelCount();
            levelCountInput.disabled = true;
        }
    }

    /**
     */
    saveLevels() {
        const levelCount = this.app.project.getLevelCount();
        if (levelCount > this.app.project.getMaxCountOfLevels()) {
            this.app.showMessage('error', i18n.t("invalidLevelCountMessageError",{
                maxLevelCount: this.app.project.getMaxCountOfLevels()
            }));
            return;
        }

        this.app.isEditingLevels = false;

        // Toggle button display
        document.getElementById('editLevelsBtn').style.display = 'block';
        document.getElementById('editLevelsActionButtons').style.display = 'none';
        this.hideDragHandle();

        // Disable level count input
        const levelCountInput = document.getElementById('levelCountInput');

        if (levelCountInput) {
            levelCountInput.disabled = true;
        }

        // If no changes, return directly
        if (!this.app.levelsListChanged) {
            this.app.originalLevelsOrder = null;
            this.app.originalLevelCount = null;
            return;
        }

        // Get current level count, mark excess levels as deleted

        for (let i = 0; i < this.app.project.levels.length; i++) {
            if (i >= levelCount) {
                this.app.project.levels[i].isDeleted = true;
            } else {
                this.app.project.levels[i].isDeleted = false;
            }
        }

        // Recalculate all level ROM addresses (expensive operation, only on save)
        this.app.project.refreshLevelAddresses();
        // Mark ROM as modified, needs writing
        this.app.project.modified = true;

        // Clear backup and flags
        this.app.originalLevelsOrder = null;
        this.app.originalLevelCount = null;
        this.app.levelsListChanged = false;
        this.app.loader.saveLevelDataToCache();

        // Recreate list to update all htmlItem references and level number display
        this.createLevelList();
        this.app.updateMemoryOverview();

        // Restore current selected level (if in valid range)
        if (this.app.editorSource !== 'formal') {
            this.renderBackupList();
        } else if (this.app.currentLevel >= 0 && this.app.currentLevel < levelCount) {
            this.selectLevel(this.app.currentLevel);
        } else if (this.app.currentLevel >= levelCount && levelCount > 0) {
            // If current level was deleted, select last valid level
            this.selectLevel(levelCount - 1);
        }else{
            this.selectLevel(0);
        }

        this.app.showMessage('success', i18n.t("changeLevelOrderSuccess"));
    }
    /**
     * Switch language
     * @param {string} lang - Language code ('zh-CN' or 'en-US')
     */

}
