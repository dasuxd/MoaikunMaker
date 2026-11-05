/**
 * Main application logic
 */
class App {
    constructor() {
        this.loader = new ProjectLoader(this);
        this.library = new LevelLibrary(this);
        this.exchange = new LevelExchange(this);
        this.playtest = new PlaytestController(this);
        this.project = new Project();
        this.levelEditor = new LevelEditor('levelCanvas', (type, text) => this.showMessage(type, text));
        //this.converter = new LevelCodec();
        this.currentLevel = 0;
        this.fileName = '';
        this.draggedIndex = -1;
        this.dropTargetIndex = -1;
        this.isEditingLevels = false;
        this.levelsListChanged = false;
        this.levelItems = new WeakMap();

        this.hasSharedLevelLoaded = false;

        this.testMode = false;
        this.projectCache = ProjectCache.getInstance();

        // Message box data
        this.messageSet = new Set();

        // Mobile game controller (lazy initialization)
        this.mobileController = null;

        // iOS specific optimizations
        this.applyIOSFixes();

        this.initEventListeners();

        // Six main buttons
        this.testLevelBtn = document.getElementById('testLevelBtn');
        this.testBtn = document.getElementById('testBtn');
        this.stopEmulatorBtn = document.getElementById('stopEmulatorBtn');
        this.saveBtn = document.getElementById('saveBtn');

        this.downloadBtn = document.getElementById('downloadBtn');

        this.sortable = null;
        //
        this.toggleInfoItems(false);

        // Backup levels list (unsaved levels)
        this.backupLevels = [];
        this.editorBaseline = null;
        this.editorSource = 'formal';
        this.currentDraftId = null;
        this.activeLevelLibraryTab = 'formal';
        this.levelFileImportTarget = 'formal';
        this.pendingUnsavedAction = null;
        this.pendingSharedLevel = null;
        this.recoveryLevelData = null;

        this.syncGameConfigControls();
        this.initTopBarLayout();
        this.loader.ready = this.loader.initCache();

    }

    /**
     * Apply iOS specific fixes
     */
    applyIOSFixes() {
        const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
        if (isIOS) {
            // Add iOS marker class to body
            document.body.classList.add('ios-device');

            // Force recalculate viewport
            setTimeout(() => {
                window.scrollTo(0, 0);
                // Trigger a resize event to ensure correct layout
                window.dispatchEvent(new Event('resize'));
            }, 100);
        }
    }

    initTopBarLayout() {
        const bar = document.querySelector('.top-bar');
        if(!bar || typeof ResizeObserver === 'undefined') return;
        this.topBarObserver = new ResizeObserver(() => {
            document.documentElement.style.setProperty('--top-bar-offset',
                `${Math.ceil(bar.getBoundingClientRect().height) + 10}px`);
        });
        this.topBarObserver.observe(bar);
    }

    /**
     * Initialize event listeners
     */
    initEventListeners() {
        const actions = {
            switchLanguage: value => switchLanguage(value),
            exportLevelPack: () => this.exchange.exportLevelPack(),
            toggleMobileMenu: () => toggleMobileMenu(),
            clearCache: () => this.loader.clearCache(),
            switchLevelLibraryTab: value => this.library.switchLevelLibraryTab(value),
            startEditLevels: () => this.library.startEditLevels(),
            cancelEditLevels: () => this.library.cancelEditLevels(),
            saveLevels: () => this.library.saveLevels(),
            exportCurrentLevel: () => this.exchange.exportCurrentLevel(),
            openLevelFilePicker: value => this.exchange.openLevelFilePicker(value),
            exportCurrentDraft: () => this.exchange.exportCurrentDraft(),
            exportAllDrafts: () => this.exchange.exportAllDrafts(),
            toggleToolbarMode: () => toggleToolbarMode(),
            testLevel: () => this.playtest.testLevel(),
            testROM: () => this.playtest.testROM(),
            stopEmulator: () => this.playtest.stopEmulator(),
            saveLevel: () => this.saveLevel(),
            resetLevel: () => this.library.resetCurrentLevel(),
            downloadROM: () => this.playtest.downloadROM(),
            shareLevel: () => this.exchange.shareLevel(),
            resolveUnsavedChanges: value => this.library.resolveUnsavedChanges(value)
        };
        document.querySelectorAll('[data-action]').forEach(button => {
            button.addEventListener('click', () => {
                actions[button.dataset.action](button.dataset.value);
                if (button.hasAttribute('data-close-menu')) toggleMobileMenu();
            });
        });

        document.getElementById('fileInput').addEventListener('change',
            (e) => this.loader.handleFileSelect(e));

        const levelFileInput = document.getElementById('levelFileInput');
        if (levelFileInput) {
            levelFileInput.addEventListener('change', (e) => this.exchange.handleLevelFileSelect(e));
        }

        document.getElementById('quickSaveBtn').addEventListener('click', () => {
            this.emulator?.quickSave(1);
        });
        document.getElementById('quickLoadBtn').addEventListener('click', () => {
            this.emulator?.quickLoad(1);
        });

        window.addEventListener('beforeunload', (event) => {
            if (this.library.hasUnsavedChanges()) {
                event.preventDefault();
                event.returnValue = '';
            }
        });

        // Initialize toolbar drag functionality
        this.initToolbarDragging();

        document.querySelectorAll('.toolbar-section-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.switchToolbarSection(tab.dataset.toolbarTab);
            });
        });

        // Level list drawer toggle
        const sidebarToggle = document.getElementById('sidebarToggle');
        const sidebar = document.getElementById('sidebar');
        if (sidebarToggle && sidebar) {
            sidebarToggle.addEventListener('click', () => {
                sidebar.classList.toggle('open');
                sidebarToggle.classList.toggle('sidebar-open');
            });
        }

        // Toolbar drawer toggle
        const toolbarToggle = document.getElementById('toolbarToggle');
        const toolbar = document.querySelector('.toolbar');
        if (toolbarToggle && toolbar) {
            toolbarToggle.addEventListener('click', () => {
                toolbar.classList.toggle('open');
                toolbarToggle.classList.toggle('toolbar-open');
            });
        }

        document.addEventListener('click', event => {
            const actionArea = event.target instanceof Element
                ? event.target.closest('.backup-level-actions')
                : null;
            if (!actionArea) {
                this.library.closeBackupActionMenus();
            }
        });

        document.addEventListener('keydown', event => {
            this.handleKeyboardShortcut(event);
            if (event.key === 'Escape') {
                const openToggle = document.querySelector(
                    '.backup-action-toggle[aria-expanded="true"]'
                );
                this.library.closeBackupActionMenus();
                if (openToggle) openToggle.focus();
            }
        });

        // Level count input box
        const levelCountInput = document.getElementById('levelCountInput');
        if (levelCountInput) {
            // Use input event for real-time monitoring
            levelCountInput.addEventListener('input', (e) => {
                const count = parseInt(e.target.value);
                // Only update when a complete valid number is entered
                if (!isNaN(count) && count >= 1 && count <= this.project.getMaxCountOfLevels()) {
                    this.project.setLevelCount(count);
                    this.library.ensureLevelSlots(count);
                    this.levelsListChanged = true;
                    this.library.createLevelList();
                    this.library.applyLevelOrderEditingState();
                }else if (isNaN(count) || count < 1 || count > this.project.getMaxCountOfLevels()) {
                    this.showMessage('error', i18n.t('invalidLevelCountMessageError', { maxLevelCount: this.project.getMaxCountOfLevels() }));
                    e.target.value = this.project.getLevelCount();
                }
            });

            // Validate and correct invalid values on blur
            levelCountInput.addEventListener('blur', (e) => {
                const count = parseInt(e.target.value);
                if (isNaN(count) || count < 1 || count > this.project.getMaxCountOfLevels()) {
                    this.showMessage('error', i18n.t('invalidLevelCountMessageError', { maxLevelCount: this.project.getMaxCountOfLevels() }));
                    e.target.value = this.project.getLevelCount();
                }
            });

            // Prevent non-numeric character input
            levelCountInput.addEventListener('keypress', (e) => {
                if (e.key && !/[0-9]/.test(e.key)) {
                    e.preventDefault();
                }
            });
        }

        const disableTimerCheckbox = document.getElementById('disableTimerCheckbox');
        if (disableTimerCheckbox) {
            disableTimerCheckbox.addEventListener('change', (e) => {
                this.updateGameConfig('disableTimer', e.target.checked);
            });
        }

        const showNpcCountCheckbox = document.getElementById('showNpcCountCheckbox');
        if (showNpcCountCheckbox) {
            showNpcCountCheckbox.addEventListener('change', (e) => {
                this.updateGameConfig(
                    'showRemainingRescueCount',
                    e.target.checked
                );
            });
        }

        const cameraFollowCheckbox = document.getElementById('cameraFollowCheckbox');
        if (cameraFollowCheckbox) {
            cameraFollowCheckbox.addEventListener('change', (e) => {
                this.updateGameConfig('cameraFollow', e.target.checked);
            });
        }

        const customLevelAuthorInput = document.getElementById('customLevelAuthorInput');
        if (customLevelAuthorInput) {
            customLevelAuthorInput.maxLength = GameSettings.CUSTOM_LEVEL_AUTHOR_MAX_LENGTH;
            customLevelAuthorInput.addEventListener('input', (e) => {
                const input = e.target;
                const caret = input.selectionStart;
                const prefix = input.value.slice(0, caret ?? input.value.length);
                this.updateGameConfig('customLevelAuthor', input.value);
                if (caret !== null) {
                    const position = GameSettings.normalizeCustomLevelAuthor(prefix).length;
                    input.setSelectionRange(position, position);
                }
            });
        }

        // Clear cache button
        const clearCacheBtn = document.getElementById('clearCacheBtn');
        if (clearCacheBtn) {
            clearCacheBtn.addEventListener('click', async () => {
                await this.loader.clearCache();
            });
        }
    }

    handleKeyboardShortcut(event) {
        if (event.altKey || event.metaKey) return;

        let button = null;
        if (!event.ctrlKey && !event.shiftKey && event.key === 'F5') {
            button = this.testLevelBtn;
        } else if (!event.ctrlKey && !event.shiftKey && event.key === 'F6') {
            button = this.stopEmulatorBtn;
        } else if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 's') {
            button = this.saveBtn;
        }

        if (!button) return;
        event.preventDefault();
        if (!event.repeat && !button.disabled) button.click();
    }

    /**
     * Toggle ROM expansion mode
     * @param {boolean} expanded - Whether to enable expansion mode
     * @param {Object} options - Optional notification/cache behavior
     */
    switchToolbarSection(sectionName) {
        const nextSection = sectionName === 'gameConfig'
            ? 'gameConfig'
            : 'operations';

        document.querySelectorAll('.toolbar-section-tab').forEach(tab => {
            const isActive = tab.dataset.toolbarTab === nextSection;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', String(isActive));
        });

        document.querySelectorAll('.toolbar-section-panel').forEach(panel => {
            const isActive = panel.id === `${nextSection}Panel`;
            panel.classList.toggle('active', isActive);
            panel.hidden = !isActive;
        });
    }

    updateGameConfig(key, value) {
        this.project.setGameConfig({
            ...this.project.getGameConfig(),
            [key]: value
        });
        this.syncGameConfigControls();

        if (this.project.romData) {
            this.loader.saveLevelDataToCache();
        }
    }

    syncGameConfigControls() {
        const gameConfig = this.project.getGameConfig();
        const disableTimerCheckbox =
            document.getElementById('disableTimerCheckbox');
        const showNpcCountCheckbox =
            document.getElementById('showNpcCountCheckbox');
        const cameraFollowCheckbox =
            document.getElementById('cameraFollowCheckbox');

        if (disableTimerCheckbox) {
            disableTimerCheckbox.checked = gameConfig.disableTimer;
        }
        if (showNpcCountCheckbox) {
            showNpcCountCheckbox.checked =
                gameConfig.showRemainingRescueCount;
        }
        if (cameraFollowCheckbox) {
            cameraFollowCheckbox.checked = gameConfig.cameraFollow;
        }
        const customLevelAuthorInput = document.getElementById('customLevelAuthorInput');
        if (customLevelAuthorInput) {
            customLevelAuthorInput.maxLength = GameSettings.CUSTOM_LEVEL_AUTHOR_MAX_LENGTH;
            customLevelAuthorInput.value = gameConfig.customLevelAuthor;
        }
        const authorLength = document.getElementById('customLevelAuthorLength');
        if (authorLength) {
            authorLength.textContent = `${gameConfig.customLevelAuthor.length}/${GameSettings.CUSTOM_LEVEL_AUTHOR_MAX_LENGTH}`;
        }
    }

    /**
     * Initialize toolbar dragging functionality
     */
    initToolbarDragging() {
        const toolbar = document.getElementById('toolbar');
        if (!toolbar) return;

        let isDragging = false;
        let startMouseX, startMouseY;
        let startLeft, startTop;

        // Mouse events
        const header = document.getElementById('toolbarHeader');
        header.addEventListener('mousedown', dragStart);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', dragEnd);

        // Touch events
        header.addEventListener('touchstart', dragStart, { passive: true });
        window.addEventListener('blur', dragEnd);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) dragEnd();
        });

        function dragStart(e) {
            // Only enable dragging in drag mode
            if (!toolbar.classList.contains('draggable-mode')) {
                return;
            }

            // Don't start dragging if clicking on buttons or interactive elements
            if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) {
                return;
            }

            // Get current toolbar position
            const rect = toolbar.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;

            if (e.type === 'touchstart') {
                startMouseX = e.touches[0].clientX;
                startMouseY = e.touches[0].clientY;
            } else {
                startMouseX = e.clientX;
                startMouseY = e.clientY;
            }

            isDragging = true;
            if (e.type === 'touchstart') {
                // Only request synchronous touch handling during an actual drag.
                document.addEventListener('touchmove', drag, { passive: false });
                document.addEventListener('touchend', dragEnd);
                document.addEventListener('touchcancel', dragEnd);
            }
            toolbar.style.cursor = 'grabbing';
            // Transition controlled by CSS .draggable-mode class, not set here
        }

        function drag(e) {
            if (!isDragging) return;

            e.preventDefault();

            let currentMouseX, currentMouseY;
            if (e.type === 'touchmove') {
                currentMouseX = e.touches[0].clientX;
                currentMouseY = e.touches[0].clientY;
            } else {
                currentMouseX = e.clientX;
                currentMouseY = e.clientY;
            }

            // Calculate new position
            let newLeft = startLeft + (currentMouseX - startMouseX);
            let newTop = startTop + (currentMouseY - startMouseY);

            // Limit drag range to prevent toolbar from being dragged off screen
            const minX = 10;
            const minY = 10;
            const maxX = window.innerWidth - toolbar.offsetWidth - 10;
            const maxY = window.innerHeight - toolbar.offsetHeight - 10;

            newLeft = Math.max(minX, Math.min(maxX, newLeft));
            newTop = Math.max(minY, Math.min(maxY, newTop));

            toolbar.style.left = newLeft + 'px';
            toolbar.style.top = newTop + 'px';
        }

        function dragEnd() {
            if (!isDragging) return;
            isDragging = false;
            toolbar.style.cursor = '';
            document.removeEventListener('touchmove', drag);
            document.removeEventListener('touchend', dragEnd);
            document.removeEventListener('touchcancel', dragEnd);
        }
    }

    /**
     * Hide welcome overlay
     */
    hideWelcomeOverlay() {
        const welcomeOverlay = document.getElementById('welcomeOverlay');
        if (welcomeOverlay) {
            welcomeOverlay.classList.add('hidden');
        }
    }

    // Toggle info bar display state
    toggleInfoItems(showOperation) {
        const operationItem = document.getElementById('operationInfoItem');
        const toolItem = document.getElementById('currentToolInfoItem');
        const mouseItem = document.getElementById('mousePositionInfoItem');

        if (operationItem) {
            operationItem.inert = !showOperation;
            operationItem.setAttribute('aria-hidden', String(!showOperation));
        }

        if (showOperation) {
            // Test mode: show operation info, hide tool and mouse info
            operationItem?.classList.add('active');
            toolItem?.classList.remove('active');
            mouseItem?.classList.remove('active');
        } else {
            // Edit mode: hide operation info, show tool and mouse info
            operationItem?.classList.remove('active');
            toolItem?.classList.add('active');
            mouseItem?.classList.add('active');
        }
    }

    getLevelEditorData(){
        if (this.currentLevel === -1) return;

        // Get data from visual editor
        if (!this.levelEditor) {
            this.showMessage('error', i18n.t("editorNotInitError"));
            return;
        }

        return this.levelEditor.getData();
    }

    /**
     * Save current level
     */
    saveLevel() {
        if (this.editorSource === 'draft') {
            this.library.saveCurrentDraft();
            return;
        }

        const levelEditorData = this.getLevelEditorData();

        if (!levelEditorData) {
            return;
        }
        try {
            // Convert to ROM format
            const levelromData = LevelCodec.fromLevelEditorToROMData(levelEditorData, this.levelEditor.isWideScreen);

            // console.log('Converted ROM data:', {
            //     mapDataLength: levelromData.mapData.length,
            //     monsterDataLength: levelromData.monsterData.length,
            //     monsterData: levelromData.monsterData
            // });

            // Save to ROM
            const level = this.project.getLevel(this.currentLevel);
            const result = level.saveMapData(levelromData.mapData);
            if (!result) {
                this.showMessage('error', i18n.t("saveMapFailedError"));
                return;
            }

            // Save monster data
            const monsterResult = level.saveMonsterData(levelromData.monsterData);
            if (!monsterResult.success) {
                //this.showMessage('error', 'Monster data error: ' + monsterResult.error);
                this.showMessage('error', i18n.t("monsterDataError",{error:monsterResult.error}));
                return;
            }

            //document.getElementById('downloadBtn').disabled = false;

            this.project.refreshLevelAddresses();
            this.showMessage('success', i18n.t("saveMapSuccess", {currentLevel: this.currentLevel + 1}));

            // Save level data to cache (not the full ROM)
            this.loader.saveLevelDataToCache();

            // Refresh display
            this.library.selectLevel(this.currentLevel, {
                preserveEditorState: true,
                skipUnsavedGuard: true
            });
            this.updateMemoryOverview();

            this.downloadBtn.disabled = false;
            level.modified = true;
            // Mark level as unmodified after save
            this.levelEditor.modified = false;
            this.saveBtn.disabled = true;
        } catch (error) {
            //console.error('Failed to save level:', error);
            //this.showMessage('error', 'Save failed: ' + error.message);
            this.showMessage('error', i18n.t("saveLevelFailedError",{error: error.message}));
        }
    }

    /**
     * Show message
     */
    showMessage(type, text) {
        console.log(`${type.toUpperCase()}: ${text}`);
        if(this.messageSet.has(text)){
            return;
        }
        this.messageSet.add(text);
        // Get or create message container
        let container = document.getElementById('messageContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'messageContainer';
            container.className = 'message-container';
            document.body.appendChild(container);
        }

        // Create message element
        const message = document.createElement('div');
        message.className = `message-toast ${type}`;

        // Add icon
        const icon = document.createElement('div');
        icon.className = 'message-toast-icon';
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };
        icon.textContent = icons[type] || '🔔';

        // Add text
        const textElement = document.createElement('div');
        textElement.className = 'message-toast-text';
        textElement.textContent = text;

        message.appendChild(icon);
        message.appendChild(textElement);
        container.appendChild(message);

        // Decide display duration based on screen width: 2s for mobile, 5s for desktop
        const isMobile = window.matchMedia('(pointer: coarse)').matches;
        const displayTime = isMobile ? 2000 : 5000;

        // Auto-hide after display
        setTimeout(() => {
            message.classList.add('hiding');
            setTimeout(() => {
                this.messageSet.delete(text);
                message.remove();
                // Remove container if empty
                if (container.children.length === 0) {
                    container.remove();
                }
            }, 300); // Wait for exit animation to complete
        }, displayTime);
    }

    /**
     * Hide message
     */
    hideMessage(type) {
        // const msgElement = document.getElementById(type + 'Msg');
        // msgElement.classList.remove('show');
    }

    /**
     * Update memory usage overview
     */
    updateMemoryOverview() {
        const levels = this.project.getAllLevels()
            .slice(0, this.project.getLevelCount());
        if (levels.length === 0) return;

        const maxSize = this.project.getLevelUsageMaxSize();
        const usedSize = this.project.calculateTotalSize();
        //const freeSize = maxSize - usedSize;
        const percentage = ((usedSize / maxSize) * 100).toFixed(1);

        // Update progress bar
        document.getElementById('memoryBarFill').style.width = `${percentage}%`;
        document.getElementById('memoryBarText').textContent =
            `${usedSize} / ${maxSize} Byte (${percentage}%)`;

        // Generate segment display
        this.generateMemorySegments(levels, maxSize);

        // Update enemy count statistics
        this.updateEnemyCountOverview(levels);

        document.getElementById('memoryOverview').style.display = 'block';
    }

    /**
     * Update enemy count overview
     */
    updateEnemyCountOverview(levels) {

        const maxEnemies = this.project.getEnemyCountMax();

        let totalEnemies = 0;

        // Calculate total enemy count from all levels
        for (let level of levels) {
            const monsterData = level.monsterData;
            if (monsterData && monsterData.length > 0) {
                const firstByte = monsterData[0];
                // First byte format: enemy count * 2 + 1
                if (firstByte > 1) {
                    const enemyCount = (firstByte - 1) / 2;
                    totalEnemies += enemyCount;
                }
            }
        }

        // Update enemy count display
        const percentage = Math.min((totalEnemies / maxEnemies) * 100).toFixed(1);
        const barFill = document.getElementById('enemyCountBarFill');
        const barText = document.getElementById('enemyCountBarText');
        const warning = document.getElementById('enemyCountWarning');

        if (barFill && barText) {
            barFill.style.width = `${percentage}%`;
            barText.textContent = `${totalEnemies} / ${maxEnemies}`;

            // Change color based on count
            if (totalEnemies > maxEnemies) {
                barFill.style.backgroundColor = '#dc3545'; // Red
            } else if (totalEnemies > maxEnemies * 0.9) {
                barFill.style.backgroundColor = '#ffc107'; // Yellow
            } else {
                barFill.style.backgroundColor = '#4CAF50'; // Green
            }
        }

        // Show/hide warning
        if (warning) {
            if (totalEnemies > maxEnemies) {
                warning.style.display = 'block';
            } else {
                warning.style.display = 'none';
            }
        }
    }

    /**
     * Generate memory segment visualization
     */
    generateMemorySegments(levels, maxSize) {
        const container = document.getElementById('memorySegments');
        container.innerHTML = '';

        // Use different colors
        const colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
            '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B88B', '#AAB7B8'
        ];

        for (let i = 0; i < levels.length; i++) {
            const level = levels[i];
            const percentage = (level.getTotalSize() / maxSize * 100);
            const color = colors[i % colors.length];

            const segment = document.createElement('div');
            segment.className = 'memory-segment';
            segment.style.width = `${percentage}%`;
            segment.style.backgroundColor = color;
            segment.onclick = () => this.library.selectLevel(i);

            const tooltip = document.createElement('div');
            tooltip.className = 'memory-segment-tooltip';
            tooltip.textContent = `Level ${level.getLevelNumber()}: ${level.getTotalSize()} Byte`;
            segment.appendChild(tooltip);

            container.appendChild(segment);
        }
    }

    /**
     * Update placeholder
     */
    updatePlaceholder() {
        // Remove all placeholders
        document.querySelectorAll('.drop-placeholder').forEach(el => {
            el.classList.remove('drop-placeholder');
        });

        if (this.dropTargetIndex >= 0 && this.dropTargetIndex !== this.draggedIndex) {
            const items = document.querySelectorAll('.level-item');
            if (items[this.dropTargetIndex]) {
                items[this.dropTargetIndex].classList.add('drop-placeholder');
            }
        }
    }

    /**
     * Validate monster data format
     */
    validateMonsterData() {
        const monsterInput = document.getElementById('monsterData').value.trim();

        if (!monsterInput) {
            return;
        }

        const hexBytes = monsterInput.split(/\s+/).filter(s => s.length > 0);

        // Validate hex format
        for (let hex of hexBytes) {
            if (!/^[0-9A-Fa-f]{1,2}$/.test(hex)) {
                return;
            }
        }

        const bytes = hexBytes.map(h => parseInt(h, 16));
        const firstByte = bytes[0];

        // Simple validation
        if (firstByte === 0x01) {
            if (bytes.length !== 1) {
                // Warn but don't block
            }
        } else if (firstByte !== bytes.length) {
            // Warn but don't block
        }
    }

    vibrate(ms = 200){
        if (!("vibrate" in navigator)) return;
        try {
            navigator.vibrate(ms);
        } catch (err) {
            // Optional feedback may be unavailable without affecting input.
        }
    }

    /*
     * ROM-independent level files and draft library.
     */
    getCurrentLevelRomData() {
        if (!this.project.romData || this.currentLevel < 0 || this.editorBaseline === null) {
            this.showMessage('warning', i18n.t('pleaseSelectLevelFirstWarning'));
            return null;
        }

        const editorData = this.getLevelEditorData();
        if (!editorData) return null;
        return LevelCodec.fromLevelEditorToROMData(
            editorData,
            this.levelEditor.isWideScreen
        );
    }
}

// Global app instance
let app;

// Initialize app after page load
document.addEventListener('DOMContentLoaded', () => {
    app = new App();
});

function switchLanguage(lang) {
    i18n.setLanguage(lang);
    if (app) {
        app.library.renderBackupList();
        if (app.project.romData) {
            app.library.createLevelList();
        }
    }

    // Update language button active state
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    const activeBtn = document.querySelector(`.lang-btn[data-value="${lang}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
}

/**
 * Toggle toolbar mode (drag/drawer)
 */
function toggleToolbarMode() {
    const toolbar = document.getElementById('toolbar');
    const toggleBtn = document.getElementById('toolbarModeToggle');
    const toolbarToggle = document.getElementById('toolbarToggle');

    if (!toolbar || !toggleBtn) return;

    const isDraggableMode = toolbar.classList.contains('draggable-mode');

    if (isDraggableMode) {
        // From drag mode → drawer mode
        toolbar.classList.remove('draggable-mode');
        toolbar.classList.remove('open');

        // Clear inline styles from dragging, let CSS take over
        toolbar.style.left = '';
        toolbar.style.top = '';
        toolbar.style.cursor = '';

        // Update toggle button
        toggleBtn.textContent = '🔓';
        toggleBtn.title = 'Switch to drag mode';

        // Show drawer button and reset its state
        if (toolbarToggle) {
            toolbarToggle.style.display = 'flex';
            toolbarToggle.classList.remove('toolbar-open');
        }
    } else {
        // From drawer mode → drag mode
        toolbar.classList.add('draggable-mode');
        toolbar.classList.add('open');

        // Set initial position (top right)
        toolbar.style.left = (window.innerWidth - toolbar.offsetWidth - 20) + 'px';
        toolbar.style.top = '100px';

        // Update toggle button
        toggleBtn.textContent = '📌';
        toggleBtn.title = 'Switch to drawer mode';

        // Hide drawer button
        if (toolbarToggle) {
            toolbarToggle.style.display = 'none';
        }
    }
}

// Initialize language system on page load
document.addEventListener('DOMContentLoaded', () => {
    // Initialize i18n
    const savedLang = i18n.init();

    // Set initial active button
    const activeBtn = document.querySelector(`.lang-btn[data-value="${savedLang}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }

    // PC default to drag mode
    initToolbarModeForPC();
});

/**
 * Initialize toolbar to drag mode for PC
 */
function initToolbarModeForPC() {
    const toolbar = document.getElementById('toolbar');
    const toggleBtn = document.getElementById('toolbarModeToggle');
    const toolbarToggle = document.getElementById('toolbarToggle');

    if (!toolbar) return;

    // Mobile mode: ensure drawer mode, clear all possible residual states
    if (window.innerWidth <= 768) {
        toolbar.classList.remove('draggable-mode');
        toolbar.classList.remove('open');
        toolbar.style.left = '';
        toolbar.style.top = '';
        toolbar.style.cursor = '';

        if (toggleBtn) {
            toggleBtn.textContent = '🔓';
            toggleBtn.title = 'Switch to drag mode';
        }

        if (toolbarToggle) {
            toolbarToggle.classList.remove('toolbar-open');
        }
        return;
    }

    // PC mode: set to drag mode
    toolbar.classList.add('draggable-mode');
    toolbar.classList.add('open');

    // Set initial position, delay to ensure toolbar is rendered
    setTimeout(() => {
        toolbar.style.left = (window.innerWidth - toolbar.offsetWidth - 20) + 'px';
        toolbar.style.top = '100px';
    }, 0);

    if (toggleBtn) {
        toggleBtn.textContent = '📌';
        toggleBtn.title = 'Switch to drawer mode';
    }

    // Hide drawer button
    if (toolbarToggle) {
        toolbarToggle.style.display = 'none';
    }
}

/**
 * Toggle mobile menu
 */
function toggleMobileMenu() {
    const menu = document.getElementById('mobileDropdownMenu');
    if (menu) {
        menu.classList.toggle('active');
    }
}

/**
 * Click elsewhere on page to close menu
 */
document.addEventListener('click', (e) => {
    const menu = document.getElementById('mobileDropdownMenu');
    const menuBtn = document.getElementById('mobileMenuBtn');

    if (menu && menuBtn) {
        // If click is not on menu button or menu content, close menu
        if (!menuBtn.contains(e.target) && !menu.contains(e.target)) {
            menu.classList.remove('active');
        }
    }
});

// Keep page scrolling native on iOS. Only game buttons cancel gestures.
