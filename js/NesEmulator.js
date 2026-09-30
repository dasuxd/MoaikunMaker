class NesEmulator {
    static LOADING_WAIT_ROM_FRAME = 40;
    static LOADING_WAIT_START_FRAME = 306;
    static QUICK_SAVE_SLOT_COUNT = 4;
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.nes = null;
        this.frameBuffer = null;
        this.isRunning = false;
        this.isPaused = false;
        this.quickSaveSlots = Array(NesEmulator.QUICK_SAVE_SLOT_COUNT).fill(null);
        this.runGeneration = 0;

        // 帧率控制
        this.fps = 60; // NES 标准帧率
        this.frameTime = 1000 / this.fps; // 每帧时间 (ms)
        this.lastFrameTime = 0;
        this.animationId = null;

        // 音频设置
        this.audioContext = null;
        this.audioBuffer = [];
        this.audioBufferSize = 4096; // 每次处理的音频样本数
        
        this.initNES();
        this.initAudio();
        this.setupKeyboard(); // 初始化键盘控制

        this.loadingScreenImage = null;
        this.loadingProgress = 0;
    }
    
    initNES() {
        // 创建 Mesen 调色板
        this.customPalette = this.createPaletteFromConfig();
        
        // 引入 JSNES 后初始化
        this.nes = new jsnes.NES({
            onFrame: (frameBuffer) => {
                this.renderFrame(frameBuffer);
            },
            onAudioSample: (left, right) => {
                this.handleAudioSample(left, right);
            }
        });
        
        // 替换 JSNES 的默认调色板
        if (this.nes.ppu && this.nes.ppu.palette) {
            for (let i = 0; i < 64; i++) {
                this.nes.ppu.palette[i] = this.customPalette[i];
            }
        }
        
        // 🔧 禁用边缘裁剪 (overscan)
        if (this.nes.ppu) {
            // clipToTvSize 控制上下左右的裁剪
            this.nes.ppu.clipToTvSize = false;
            
            // f_bgClipping = 1: 显示左边 8 像素的背景
            // f_spClipping = 1: 显示左边 8 像素的精灵
            this.nes.ppu.f_bgClipping = 1;
            this.nes.ppu.f_spClipping = 1;
        }

    }
    
    /**
     * 初始化音频系统
     */
    initAudio() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
            
            // 创建脚本处理器节点
            this.scriptProcessor = this.audioContext.createScriptProcessor(this.audioBufferSize, 0, 2);
            this.scriptProcessor.onaudioprocess = (e) => {
                const left = e.outputBuffer.getChannelData(0);
                const right = e.outputBuffer.getChannelData(1);
                
                // 从缓冲区读取音频数据
                for (let i = 0; i < this.audioBufferSize; i++) {
                    if (this.audioBuffer.length > 0) {
                        const sample = this.audioBuffer.shift();
                        left[i] = sample[0];
                        right[i] = sample[1];
                    } else {
                        left[i] = 0;
                        right[i] = 0;
                    }
                }
            };

            // 额外：页面获得焦点时也试一次
            window.addEventListener('visibilitychange', () => {
            if (this.audioContext?.state !== 'running') {
                this.audioContext.resume();
            }
            });
            
            console.log('音频系统初始化成功');
        } catch (error) {
            console.error('音频初始化失败:', error);
        }
    }

    /**
     * 处理音频采样
     */
    handleAudioSample(left, right) {
        if (!this.audioContext || !this.isRunning) return;
        
        // 将音频样本添加到缓冲区
        this.audioBuffer.push([left, right]);
        
        // 防止缓冲区过大
        if (this.audioBuffer.length > this.audioBufferSize * 2) {
            this.audioBuffer = this.audioBuffer.slice(-this.audioBufferSize);
        }
    }
    
    /**
     * 从 Config 创建 JSNES 格式的调色板
     */
    createPaletteFromConfig() {
        const palette = new Uint32Array(64);
        
        for (let i = 0; i < 64; i++) {
            const rgb = Config.NES_PALETTE[i];
            // JSNES 使用 0xRRGGBB 格式
            palette[i] = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
        }
        
        return palette;
    }

    /**
     * 设置键盘控制
     */
    setupKeyboard() {
        // 键盘映射：键名 -> JSNES 按钮常量
        this.keyMap = {
            'w': jsnes.Controller.BUTTON_UP,
            's': jsnes.Controller.BUTTON_DOWN,
            'a': jsnes.Controller.BUTTON_LEFT,
            'd': jsnes.Controller.BUTTON_RIGHT,
            'h': jsnes.Controller.BUTTON_A,        // Z = A 按钮
            'k': jsnes.Controller.BUTTON_A,
            'l': jsnes.Controller.BUTTON_B,        // X = B 按钮
            'j': jsnes.Controller.BUTTON_B,
            'Enter': jsnes.Controller.BUTTON_START,   // Enter = Start
            'Alt': jsnes.Controller.BUTTON_SELECT     // Alt = Select
        };
        
        // 按下按键
        this.onKeyDown = (e) => {
            if (!this.isRunning) return;

            if (app.testMode && /^F[1-4]$/.test(e.key) &&
                !e.ctrlKey && !e.altKey && !e.metaKey) {
                e.preventDefault();
                if (e.repeat) return;
                const slot = Number(e.key.slice(1));
                if (e.shiftKey) {
                    this.quickSave(slot);
                } else {
                    this.quickLoad(slot);
                }
                return;
            }

            // Editor shortcuts must not also press a game button.
            if (e.ctrlKey || e.metaKey) return;
            
            const button = this.keyMap[e.key];
            if (button !== undefined) {
                e.preventDefault(); // 阻止默认行为
                this.buttonDown(1, button); // 玩家1
            }
        };
        
        // 释放按键
        this.onKeyUp = (e) => {
            if (!this.isRunning) return;
            
            const button = this.keyMap[e.key];
            if (button !== undefined) {
                e.preventDefault();
                this.buttonUp(1, button);
            }
        };

        
        //绑定屏幕按键
        if (!app.mobileController) {
            app.mobileController = new MobileGameController(this);
        }
        
        // 绑定事件
        document.addEventListener('keydown', this.onKeyDown);
        document.addEventListener('keyup', this.onKeyUp);
    }
    
    loadROM(romData) {
        this.clearQuickSaves();
        this.runGeneration++;
        // romData 是 Uint8Array 或 ArrayBuffer
        let uint8Array;
        
        if (romData instanceof ArrayBuffer) {
            uint8Array = new Uint8Array(romData);
        } else {
            uint8Array = romData;
        }
        
        // 将字节数组转换为字符串
        let romString = '';
        try {
            // 优化：分块构建字符串，避免 apply 参数过多
            
            const chunkSize = 8192; // 8KB 分块
            for (let i = 0; i < uint8Array.length; i += chunkSize) {
                const chunk = uint8Array.subarray(i, i + chunkSize);
                romString += String.fromCharCode.apply(null, chunk);
            }
        } catch (error) {
            console.error('ROM 转换失败:', error);
            alert('ROM 加载失败：文件过大或格式错误。');
        }
        
        // JSNES 需要字符串格式
        this.nes.loadROM(romString);
    }

    renderLoadingProgress() {
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;

        if(this.loadingScreenImage){
            this.ctx.putImageData(this.loadingScreenImage, 0, 0);
        }
        
        // 1. 获取当前进度百分比
        const totalFrames = NesEmulator.LOADING_WAIT_ROM_FRAME + NesEmulator.LOADING_WAIT_START_FRAME;
        const progress = Math.min(this.loadingProgress / totalFrames, 1);
        
        // 2. 这里的宽高是 Canvas 的绘图分辨率（通常 NES 是 256x240）
        // const W = canvas.width;
        // const H = canvas.height;

        // 3. 绘制背景遮罩（让游戏画面稍微变暗）
        this.ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        this.ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        // 4. 加载条尺寸设计
        const barWidth = canvasWidth * 0.4;  // 宽度占屏幕 70%
        const barHeight = 8;       // 高度
        const x = (canvasWidth - barWidth) / 2;
        const y = canvasHeight * 0.8;         // 位置在屏幕 80% 处（偏下）

        // 5. 绘制加载条底槽
        this.ctx.fillStyle = "#333";
        this.ctx.beginPath();
        this.ctx.roundRect(x, y, barWidth, barHeight, 4); // 圆角矩形
        this.ctx.fill();

        // 6. 绘制进度条（亮色）
        this.ctx.fillStyle = "#00ffcc"; // 经典的科技青色
        this.ctx.beginPath();
        this.ctx.roundRect(x, y, barWidth * progress, barHeight, 4);
        this.ctx.fill();

        // 7. 绘制文字提示
        this.ctx.fillStyle = "#ffffff";
        this.ctx.font = "12px Arial";
        this.ctx.textAlign = "center";
        this.ctx.fillText(`LOADING: ${Math.round(progress * 100)}%`, canvasWidth / 2, y - 10);
    }
    
    renderFrame(frameBuffer) {
        if(this.loadingProgress < NesEmulator.LOADING_WAIT_ROM_FRAME + NesEmulator.LOADING_WAIT_START_FRAME){
            this.renderLoadingProgress();
            return;
        }
        // NES 原始分辨率
        const nesWidth = 256;
        const nesHeight = 240;
        
        // 🔍 检查 frameBuffer 的实际大小
        //console.log('frameBuffer length:', frameBuffer.length, '应该是:', nesWidth * nesHeight);
        
        // ❌ 移除所有裁剪逻辑
        // const cropTop = 8;
        // const cropBottom = 8;
        // const cropLeft = 0;
        // const cropRight = 0;
        
        // Canvas 尺寸
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;
        
        // 计算缩放比例（保持宽高比，高度填满）
        const scale = canvasHeight / nesHeight;
        const scaledWidth = nesWidth * scale;
        const scaledHeight = canvasHeight;
        
        // 计算居中位置
        const offsetX = (canvasWidth - scaledWidth) / 2;
        const offsetY = 0;
        
        // 创建临时 canvas 用于绘制原始帧
        if (!this.tempCanvas) {
            this.tempCanvas = document.createElement('canvas');
            this.tempCanvas.width = nesWidth;
            this.tempCanvas.height = nesHeight;
            this.tempCtx = this.tempCanvas.getContext('2d');
        }
        
        // 将帧数据绘制到临时 canvas（完整的 256x240）
        const imageData = this.tempCtx.createImageData(nesWidth, nesHeight);
        for (let i = 0; i < frameBuffer.length; i++) {
            const pixel = frameBuffer[i];
            imageData.data[i * 4 + 0] = pixel & 0xFF;         // R
            imageData.data[i * 4 + 1] = (pixel >> 8) & 0xFF;  // G
            imageData.data[i * 4 + 2] = (pixel >> 16) & 0xFF; // B
            imageData.data[i * 4 + 3] = 0xFF;                 // A
        }
        //this.tempCtx.putImageData(imageData, 0, 0, 0, -8, nesWidth, nesHeight + 8);
        this.tempCtx.putImageData(imageData, 0, 0);
        
        // 清空主 canvas
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        
        // 关闭图像平滑（保持像素风格）
        this.ctx.imageSmoothingEnabled = false;
        
        // 将完整的 256x240 缩放绘制到主 canvas 中心
        this.ctx.drawImage(
            this.tempCanvas,
            0, 0, nesWidth, nesHeight,           // 源矩形（完整画面）
            offsetX, offsetY, scaledWidth, scaledHeight  // 目标矩形
        );
    }

    /**
     * 滚动 canvas 容器到中心位置，确保 NES 模拟器可见
     */
    scrollCanvasToCenter() {
        const canvasContainer = this.canvas.parentElement;
        if (!canvasContainer) return;
        
        // 计算需要滚动的位置，让 canvas 的中心区域显示在容器中央
        const canvasWidth = this.canvas.offsetWidth;
        const containerWidth = canvasContainer.offsetWidth;
        
        // 如果 canvas 宽度小于等于容器宽度，不需要滚动
        if (canvasWidth <= containerWidth) {
            canvasContainer.scrollLeft = 0;
            return;
        }
        
        // 计算滚动位置：canvas 中心对齐到容器中心
        // NES 模拟器在 canvas 的中心位置（因为它的大小是 canvas 的一半）
        const scrollPosition = (canvasWidth - containerWidth) / 2;
        
        // 平滑滚动到计算的位置
        canvasContainer.scrollTo({
            left: scrollPosition,
            behavior: 'smooth'
        });
    }

    adjustUIForMobile() {
        //app.stopEmulatorBtn.disabled = false;
        //判断是不是触摸屏设备
        if (!window.matchMedia('(pointer: coarse)').matches) {
            return;
        }
        // 添加测试模式类，在移动端缩小显示
        // 延迟滚动到中心位置，等待 CSS 动画完成
        setTimeout(() => {
            this.scrollCanvasToCenter();
        }, 400); // 等待 CSS transition 完成（0.3s + 缓冲）

        const levelCanvas = document.getElementById('levelCanvas');
        if (levelCanvas) {
            levelCanvas.classList.add('test-mode');
            levelCanvas.scrollIntoView({
                behavior: 'smooth',    // 平滑滚动（推荐）  也可写 'auto'（瞬间跳过去）
                block: 'start',        // 垂直方向：顶部对齐
                inline: 'nearest'      // 水平方向：就近（一般用不到特别指定）
            });
        }

        const editorLayout = document.querySelector('.editor-layout');
        if (editorLayout) {
            editorLayout.classList.add('test-mode');
        }
        
        // 添加body的test-mode类，用于隐藏其他UI元素
        document.body.classList.add('test-mode');
        
        // 显示移动控制面板
        app.mobileController.show();


    }

    async quickStart(){
        const runGeneration = this.runGeneration;
        this.adjustUIForMobile()
        this.loadingScreenImage = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        this.loadingProgress = 0;
        const CHUNK_SIZE = 2;
        for(let i = 0; i <  NesEmulator.LOADING_WAIT_ROM_FRAME; i++){
            if (runGeneration !== this.runGeneration) return;
            this.nes.frame();
            this.loadingProgress++;

            if (i % CHUNK_SIZE === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        this.nes.buttonDown(1, 3);
        this.nes.frame();
        this.nes.frame();
        this.nes.frame();
        this.nes.buttonUp(1, 3);

        for(let i = 0; i <  NesEmulator.LOADING_WAIT_START_FRAME; i++){
            if (runGeneration !== this.runGeneration) return;
            this.nes.frame();
            this.loadingProgress++;
            if (i % CHUNK_SIZE === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        if (runGeneration === this.runGeneration) this.start();
    }
    
    start() {
        if (this.isRunning) return;
        if(this.loadingProgress === 0){
            this.adjustUIForMobile()
        }
        const loadingTotal= NesEmulator.LOADING_WAIT_ROM_FRAME + NesEmulator.LOADING_WAIT_START_FRAME;
        this.loadingProgress = loadingTotal;
        
        this.isRunning = true;
        this.lastFrameTime = performance.now();
        
        // 🔧 重新初始化音频（修复iOS黑屏后音频失效）  fuck webkit
        if (!this.audioContext || this.audioContext.state === 'closed') {
            this.initAudio();
        }
        
        // 启动音频
        if (this.audioContext && this.scriptProcessor) {
            this.scriptProcessor.connect(this.audioContext.destination);
            
            // 恢复音频上下文（某些浏览器需要用户交互后才能播放）
            if (this.audioContext.state === 'suspended' || this.audioContext.state !== 'interrupted') {
                this.audioContext.resume();
            }
        }

        app.stopEmulatorBtn.disabled = false;
        
        this.loop(this.lastFrameTime);
    }
    
    stop() {
        this.isRunning = false;
        this.runGeneration++;
        this.clearQuickSaves();
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        // 停止音频
        if (this.scriptProcessor) {
            this.scriptProcessor.disconnect();
        }
        this.loadingProgress = 0;
        this.audioBuffer = [];
    }

    clearQuickSaves() {
        this.quickSaveSlots.fill(null);
    }

    quickSave(slot) {
        if (!this.isRunning || !app.testMode || slot < 1 || slot > NesEmulator.QUICK_SAVE_SLOT_COUNT) return;
        try {
            // jsnes returns references to its live state; every slot needs its own copy.
            this.quickSaveSlots[slot - 1] = JSON.parse(JSON.stringify(this.nes.toJSON()));
            app.showMessage('success', i18n.t('quickSaveSuccess', { slot }));
        } catch (error) {
            console.error('Quick save failed:', error);
            app.showMessage('error', i18n.t('quickSaveFailed', { slot }));
        }
    }

    quickLoad(slot) {
        if (!this.isRunning || !app.testMode || slot < 1 || slot > NesEmulator.QUICK_SAVE_SLOT_COUNT) return;
        const state = this.quickSaveSlots[slot - 1];
        if (!state) {
            app.showMessage('warning', i18n.t('quickSaveEmpty', { slot }));
            return;
        }
        try {
            // fromJSON also retains array references, so do not pass it the stored copy.
            this.nes.fromJSON(JSON.parse(JSON.stringify(state)));
            for (const controller of Object.values(this.nes.controllers)) {
                controller.state.fill(64); // release keys held at the moment of loading
            }
            this.audioBuffer = [];
            this.lastFrameTime = performance.now();
            app.showMessage('success', i18n.t('quickLoadSuccess', { slot }));
        } catch (error) {
            console.error('Quick load failed:', error);
            app.showMessage('error', i18n.t('quickLoadFailed', { slot }));
        }
    }
    
    loop(currentTime) {
        if (!this.isRunning) return;

        if (this.isPaused) {
            this.animationId = requestAnimationFrame((time) => this.loop(time));
            return;
        }
        
        // 计算距离上一帧的时间
        const deltaTime = currentTime - this.lastFrameTime;
        
        // 只有当达到帧时间间隔时才执行
        if (deltaTime >= this.frameTime) {
            this.nes.frame();
            this.lastFrameTime = currentTime - (deltaTime % this.frameTime);
        }
        
        this.animationId = requestAnimationFrame((time) => this.loop(time));
    }

    /**
     * 设置帧率
     * @param {number} fps - 目标帧率（默认 60）
     */
    setFPS(fps) {
        this.fps = fps;
        this.frameTime = 1000 / fps;
    }
    
    // 控制器输入
    buttonDown(player, button) {
        this.nes.buttonDown(player, button);
    }
    
    buttonUp(player, button) {
        this.nes.buttonUp(player, button);
    }
}
