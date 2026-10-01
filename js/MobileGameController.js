/**
 * 移动端游戏控制器
 */
class MobileGameController {
    constructor(emulator) {
        this.emulator = emulator;
        this.controlPanel = document.getElementById('mobileGameControls');
        this.activeButtons = new Set(); // 跟踪当前按下的按钮
        this.pressedPointers = new Map();
        this.menuToggle = document.getElementById('mobileMenuToggle');
        this.menuList = document.getElementById('mobileEmulatorMenu');
        this.menuActions = document.getElementById('mobileMenuActions');
        this.menuStatus = document.getElementById('mobileMenuStatus');
        this.confirmation = document.getElementById('mobileMenuConfirmation');
        this.confirmMessage = document.getElementById('mobileConfirmMessage');
        this.confirmAccept = document.getElementById('mobileConfirmAccept');
        this.quickLoadButton = document.getElementById('mobileQuickLoadBtn');
        this.menuOpen = false;
        this.pendingAction = null;
        this.resumeAfterMenu = false;
        
        // 按键映射
        this.keyMap = {
            'up': jsnes.Controller.BUTTON_UP,
            'down': jsnes.Controller.BUTTON_DOWN,
            'left': jsnes.Controller.BUTTON_LEFT,
            'right': jsnes.Controller.BUTTON_RIGHT,
            'a': jsnes.Controller.BUTTON_A,
            'b': jsnes.Controller.BUTTON_B,
            'start': jsnes.Controller.BUTTON_START,
            'select': jsnes.Controller.BUTTON_SELECT
        };
        
        this.setupEventListeners();
    }
    
    /**
     * 设置事件监听
     */
    setupEventListeners() {
        if (!this.controlPanel) return;
        
        // WebKit can recognize multi-touch zoom even when pointerdown is
        // cancelled. Guard native touches across both panels, including gaps,
        // independently of the input API; these listeners never press keys.
        const preventGameGesture = event => {
            if (event.cancelable) event.preventDefault();
        };
        this.controlPanel.querySelectorAll('.controls-left, .controls-right').forEach(panel => {
            for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
                panel.addEventListener(type, preventGameGesture, { passive: false, capture: true });
            }
        });

        // Utility buttons and the rest of the page retain native gestures.
        const buttons = this.controlPanel.querySelectorAll('[data-key]');
        const usePointerEvents = Boolean(window.PointerEvent);
        let lastTouchTime = -Infinity;
        buttons.forEach(button => {
            const key = button.getAttribute('data-key');
            if (usePointerEvents) {
                button.addEventListener('pointerdown', event => {
                    if (event.pointerType === 'mouse' && event.button !== 0) return;
                    if (event.cancelable) event.preventDefault();
                    this.pressPointer(event.pointerId, key, button, event.pointerType === 'touch');
                    if (this.pressedPointers.has(event.pointerId)) {
                        button.setPointerCapture?.(event.pointerId);
                    }
                });
                for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
                    button.addEventListener(type, event => this.releasePointer(event.pointerId));
                }
            } else {
                button.addEventListener('touchstart', event => {
                    if (event.cancelable) event.preventDefault();
                    lastTouchTime = Date.now();
                    for (const touch of event.changedTouches) {
                        this.pressPointer(touch.identifier, key, button, true);
                    }
                }, { passive: false });
                for (const type of ['touchend', 'touchcancel']) {
                    button.addEventListener(type, event => {
                        if (event.cancelable) event.preventDefault();
                        for (const touch of event.changedTouches) this.releasePointer(touch.identifier);
                    }, { passive: false });
                }
                button.addEventListener('mousedown', event => {
                    if (event.button !== 0 || Date.now() - lastTouchTime < 800) return;
                    event.preventDefault();
                    this.pressPointer('mouse', key, button);
                });
                button.addEventListener('mouseleave', () => this.releasePointer('mouse'));
            }
        });
        if (usePointerEvents) {
            for (const type of ['pointerup', 'pointercancel']) {
                window.addEventListener(type, event => this.releasePointer(event.pointerId));
            }
        } else {
            window.addEventListener('mouseup', () => this.releasePointer('mouse'));
        }
        window.addEventListener('blur', () => this.releaseAllButtons());
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.releaseAllButtons();
        });

        this.menuToggle.addEventListener('click', () => this.menuOpen ? this.closeMenu() : this.openMenu());
        document.getElementById('mobileMenuClose').addEventListener('click', () => this.closeMenu());
        document.getElementById('mobileRecenterBtn').addEventListener('click', () => {
            this.closeMenu({ restoreFocus: false });
            this.emulator.recenterGameView();
        });
        document.getElementById('mobileQuickSaveBtn').addEventListener('click', () => this.requestAction('save'));
        this.quickLoadButton.addEventListener('click', () => this.requestAction('load'));
        document.getElementById('mobileStopBtn').addEventListener('click', () => this.requestAction('stop'));
        document.getElementById('mobileConfirmCancel').addEventListener('click', () => this.cancelConfirmation());
        this.confirmAccept.addEventListener('click', () => this.executeAction(this.pendingAction));
        const dismissOutside = event => {
            if (this.menuOpen && !this.menuList.contains(event.target) &&
                !this.menuToggle.contains(event.target)) {
                this.closeMenu({ restoreFocus: false });
            }
        };
        document.addEventListener(usePointerEvents ? 'pointerdown' : 'touchstart', dismissOutside, { passive: true });
        document.addEventListener('click', dismissOutside);
        document.addEventListener('focusin', dismissOutside);
        document.addEventListener('keydown', event => this.handleMenuKey(event));
        window.addEventListener('resize', () => {
            if (this.controlPanel.classList.contains('active') &&
                !window.matchMedia('(pointer: coarse)').matches) {
                this.hide();
            }
        });
    }

    pressPointer(id, key, button, vibrate = false) {
        if (this.menuOpen || !this.emulator.isRunning || this.emulator.isPaused) return;
        if (this.pressedPointers.has(id)) return;
        this.pressedPointers.set(id, { key, button });
        this.handleButtonDown(key, button);
        if (vibrate) app.vibrate(20);
    }

    releasePointer(id) {
        const pressed = this.pressedPointers.get(id);
        if (!pressed) return;
        this.pressedPointers.delete(id);
        if (![...this.pressedPointers.values()].some(other => other.key === pressed.key)) {
            this.handleButtonUp(pressed.key, pressed.button);
        }
    }

    updateActionState() {
        this.menuToggle.disabled = !this.emulator.isRunning;
        const hasSave = Boolean(this.emulator.quickSaveSlots[0]);
        this.quickLoadButton.disabled = !this.emulator.isRunning || !hasSave;
        this.menuStatus.textContent = i18n.t(hasSave ? 'mobileSlotSaved' : 'mobileSlotEmpty');
    }

    openMenu() {
        if (this.menuOpen || !this.emulator.isRunning) return;
        this.releaseAllButtons();
        this.resumeAfterMenu = !this.emulator.isPaused;
        this.emulator.pause();
        this.menuOpen = true;
        this.pendingAction = null;
        this.updateActionState();
        this.menuActions.hidden = false;
        this.confirmation.hidden = true;
        this.menuList.hidden = false;
        this.menuToggle.setAttribute('aria-expanded', 'true');
        this.setGameControlsInert(true);
        document.getElementById('mobileQuickSaveBtn').focus({ preventScroll: true });
    }

    closeMenu({ resume = true, restoreFocus = true } = {}) {
        if (!this.menuOpen) return;
        this.menuOpen = false;
        this.pendingAction = null;
        this.menuList.hidden = true;
        this.confirmation.hidden = true;
        this.menuActions.hidden = false;
        this.menuToggle.setAttribute('aria-expanded', 'false');
        this.setGameControlsInert(false);
        if (resume && this.resumeAfterMenu) this.emulator.resume();
        this.resumeAfterMenu = false;
        if (restoreFocus) this.menuToggle.focus({ preventScroll: true });
    }

    setGameControlsInert(inert) {
        this.controlPanel.querySelectorAll('.controls-left, .controls-right')
            .forEach(element => { element.inert = inert; });
    }

    requestAction(action) {
        if (!this.menuOpen || !this.emulator.isRunning) return;
        if (action === 'load' && !this.emulator.quickSaveSlots[0]) return;
        if (action === 'save' && !this.emulator.quickSaveSlots[0]) {
            this.executeAction(action);
            return;
        }
        const messages = {
            save: 'mobileOverwriteConfirm',
            load: 'mobileLoadConfirm',
            stop: 'mobileStopConfirm'
        };
        if (!messages[action]) return;
        this.pendingAction = action;
        this.confirmMessage.textContent = i18n.t(messages[action]);
        this.confirmAccept.classList.toggle('mobile-menu-danger', action === 'stop');
        this.menuActions.hidden = true;
        this.confirmation.hidden = false;
        // Focus the safe choice so opening confirmation cannot immediately accept it.
        document.getElementById('mobileConfirmCancel').focus({ preventScroll: true });
    }

    cancelConfirmation() {
        const action = this.pendingAction;
        this.pendingAction = null;
        this.confirmation.hidden = true;
        this.menuActions.hidden = false;
        const buttons = { save: 'mobileQuickSaveBtn', load: 'mobileQuickLoadBtn', stop: 'mobileStopBtn' };
        if (buttons[action]) document.getElementById(buttons[action]).focus({ preventScroll: true });
    }

    executeAction(action) {
        if (!this.menuOpen || !this.emulator.isRunning) return;
        if (action === 'stop') {
            this.closeMenu({ resume: false, restoreFocus: false });
            app.stopEmulator();
            app.testLevelBtn.focus();
            return;
        }
        const success = action === 'save' ? this.emulator.quickSave(1)
            : action === 'load' ? this.emulator.quickLoad(1) : false;
        if (success) {
            this.closeMenu();
        } else {
            this.cancelConfirmation();
            this.updateActionState();
        }
    }

    handleMenuKey(event) {
        if (!this.menuOpen) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            if (this.pendingAction) this.cancelConfirmation();
            else this.closeMenu();
        }
    }
    
    /**
     * 处理按钮按下
     */
    handleButtonDown(key, buttonElement) {
        if (this.menuOpen || !this.emulator.isRunning || this.emulator.isPaused) return;
        if (this.activeButtons.has(key)) return; // 防止重复触发
        
        this.activeButtons.add(key);
        const nesButton = this.keyMap[key];
        
        if (nesButton !== undefined && this.emulator && this.emulator.nes) {
            this.emulator.buttonDown(1, nesButton);
            // 添加视觉反馈
            buttonElement.style.opacity = '0.7';
        }
    }
    
    /**
     * 处理按钮释放
     */
    handleButtonUp(key, buttonElement) {
        if (!this.activeButtons.has(key)) return;
        
        this.activeButtons.delete(key);
        const nesButton = this.keyMap[key];
        
        if (nesButton !== undefined && this.emulator && this.emulator.nes) {
            this.emulator.buttonUp(1, nesButton);
            // 恢复视觉
            buttonElement.style.opacity = '1';
        }
    }
    
    /**
     * 显示控制面板
     */
    show() {
        if (this.controlPanel) {
            this.controlPanel.classList.add('active');
            this.updateActionState();
        }
    }
    
    /**
     * 隐藏控制面板
     */
    hide() {
        if (this.controlPanel) {
            this.closeMenu({ restoreFocus: false });
            this.controlPanel.classList.remove('active');
            // 释放所有按键
            this.releaseAllButtons();
        }
    }
    
    /**
     * 释放所有按钮
     */
    releaseAllButtons() {
        this.activeButtons.forEach(key => {
            const nesButton = this.keyMap[key];
            if (nesButton !== undefined && this.emulator && this.emulator.nes) {
                this.emulator.buttonUp(1, nesButton);
            }
        });
        this.activeButtons.clear();
        this.pressedPointers.clear();
        
        // 恢复所有按钮的视觉状态
        const buttons = this.controlPanel.querySelectorAll('[data-key]');
        buttons.forEach(button => {
            button.style.opacity = '1';
        });
    }
}
