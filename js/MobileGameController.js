/**
 * 移动端游戏控制器
 */
class MobileGameController {
    constructor(emulator) {
        this.emulator = emulator;
        this.controlPanel = document.getElementById('mobileGameControls');
        this.activeButtons = new Set(); // 跟踪当前按下的按钮
        
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
        
        // 为所有游戏按钮添加触摸事件
        const buttons = this.controlPanel.querySelectorAll('[data-key]');
        
        buttons.forEach(button => {
            const key = button.getAttribute('data-key');
            
            // 触摸开始
            button.addEventListener('touchstart', (e) => {
                e.preventDefault();
                app.vibrate(200)  
                this.handleButtonDown(key, button);
            });
            
            // 触摸结束
            button.addEventListener('touchend', (e) => {
                e.preventDefault();
                this.handleButtonUp(key, button);
            });
            
            // 触摸离开按钮区域
            button.addEventListener('touchcancel', (e) => {
                e.preventDefault();
                this.handleButtonUp(key, button);
            });
            
            // 鼠标事件（用于桌面测试）
            button.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.handleButtonDown(key, button);
            });
            
            button.addEventListener('mouseup', (e) => {
                e.preventDefault();
                this.handleButtonUp(key, button);
            });
            
            button.addEventListener('mouseleave', (e) => {
                if (this.activeButtons.has(key)) {
                    this.handleButtonUp(key, button);
                }
            });
        });
    }
    
    /**
     * 处理按钮按下
     */
    handleButtonDown(key, buttonElement) {
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
        }
    }
    
    /**
     * 隐藏控制面板
     */
    hide() {
        if (this.controlPanel) {
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
        
        // 恢复所有按钮的视觉状态
        const buttons = this.controlPanel.querySelectorAll('[data-key]');
        buttons.forEach(button => {
            button.style.opacity = '1';
        });
    }
}
