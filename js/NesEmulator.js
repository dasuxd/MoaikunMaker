class NesEmulator {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.nes = null;
        this.frameBuffer = null;
        this.isRunning = false;

        // 帧率控制
        this.fps = 60; // NES 标准帧率
        this.frameTime = 1000 / this.fps; // 每帧时间 (ms)
        this.lastFrameTime = 0;
        this.animationId = null;

        // 音频设置
        this.audioContext = null;
        this.audioBuffer = [];
        this.audioBufferSize = 4096;
        
        this.initNES();
        this.initAudio();
        this.setupKeyboard(); // 初始化键盘控制
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
            'Shift': jsnes.Controller.BUTTON_SELECT   // Shift = Select
        };
        
        // 按下按键
        this.onKeyDown = (e) => {
            if (!this.isRunning) return;
            
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
        
        // 绑定事件
        document.addEventListener('keydown', this.onKeyDown);
        document.addEventListener('keyup', this.onKeyUp);
    }
    
    loadROM(romData) {
        // romData 是 Uint8Array 或 ArrayBuffer
        let uint8Array;
        
        if (romData instanceof ArrayBuffer) {
            uint8Array = new Uint8Array(romData);
        } else {
            uint8Array = romData;
        }
        
        // 将字节数组转换为字符串
        const romString = String.fromCharCode.apply(null, uint8Array);
        
        // JSNES 需要字符串格式
        this.nes.loadROM(romString);
    }
    
    renderFrame(frameBuffer) {
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
    
    start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        this.lastFrameTime = performance.now();
        
        // 启动音频
        if (this.audioContext && this.scriptProcessor) {
            this.scriptProcessor.connect(this.audioContext.destination);
            
            // 恢复音频上下文（某些浏览器需要用户交互后才能播放）
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
        }
        
        this.loop(this.lastFrameTime);
    }
    
    stop() {
        this.isRunning = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        // 停止音频
        if (this.scriptProcessor) {
            this.scriptProcessor.disconnect();
        }
    }
    
    loop(currentTime) {
        if (!this.isRunning) return;
        
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