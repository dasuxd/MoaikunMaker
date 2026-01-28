/**
 * 中文（简体）翻译
 */
const translations_zhCN = {
    // Top Bar
    'title': 'Moai-kun Maker',
    'selectRom': '📁 选择 ROM 文件',
    'clearCache': '🗑️ 清除缓存',
    'clearCacheTitle': '清除缓存的 ROM',
    
    // Sidebar
    'levelList': '📋 关卡列表',
    'totalLevels': '🎮 关卡总数:',
    'editLevels': '✏️ 编辑关卡组',
    'address': '(地址: 0x0BD3)',
    'cancel': '❌ 取消',
    'saveLevelsEdit': '✔️ 保存',
    'dragTip': '💡 拖动关卡可调整顺序',
    
    // Memory
    'memoryUsage': '💾 内存使用情况',
    
    // Toolbar
    'config': '🛠️',
    'dragToMove': '拖动移动',
    'operations': '操作',
    'selectScene': '选择场景',
    'scene': '场景',
    'wideScene': '📺 宽场景',
    'clearMap': '清空地图',
    'exportData': '导出数据',
    'applyToRom': '应用到 ROM 编辑器',
    'tools': '工具',
    'tiles': '图块',
    'enemies': '敌人',
    'special': '特殊',
    
    // Canvas Info
    'gridSize': '网格大小:',
    'currentTool': '当前工具:',
    'notSelected': '未选择',
    'mousePosition': '鼠标位置:',
    
    // Buttons
    'testLevel': '🎮 测试关卡',
    'testRom': '🎮 测试 ROM',
    'stopEmulator': '⏹️ 结束模拟',
    'saveLevel': '💾 保存关卡',
    'writeToRom': '📝 写入 ROM',
    'downloadRom': '⬇️ 下载 ROM',
    'shareLevel': '🔗 分享关卡',
    
    // Info Panel
    'mapRomAddress': '地图 ROM 地址',
    'mapCpuAddress': '地图 CPU 地址',
    'monsterRomAddress': '怪物ROM地址',
    'monsterCpuAddress': '怪物CPU地址',
    'currentSize': '当前大小',
    'bytes': '字节',
    
    // Hex Editor
    'mapDataLabel': '🗺️ 地图数据 (不包含结束符 FF)',
    'readOnly': '[只读参考]',
    'hexDataPlaceholder': '输入十六进制数据，如: A1 B2 C3 D4...',
    'monsterDataLabel': '👾 怪物数据',
    'monsterDataFormat': '(格式: 第1字节=怪物数*2+1, 后续为 [类型 位置] 对)',
    'monsterDataPlaceholder': '输入怪物数据，如: 01 (无怪物) 或 03 01 DD (一个01类型怪物在DD位置)',
    
    // Welcome Screen
    'welcomeTitle': '🎮 欢迎使用 Moai-kun Maker',
    'welcomeTip1': '游戏需要您亲自上传 ROM，如果您上传了正确的游戏 ROM 却加载失败可以给我提交 Issue。',
    'welcomeTip2': '本游戏可以进行关卡分享，直接给朋友发送链接即可。',
    'welcomeTip3': '如果通过链接进入但未加载 ROM，只需上传 ROM 后，分享的关卡会自动开始。',
    'welcomeTip4': '这是初级版本，可能存在一些小 BUG，欢迎提交 Issue 反馈。',
    'welcomeUpload': '📤 上传 ROM 开始使用',
    
    // Operation Info
    'operationSummaryLabel': '操作简介:',
    'operationSummary': '移动(WASD)  |  攻击(J)  | 跳跃(K) | 开始(Enter) | 选择(Shift)',

    // others
    'levelCount' : '关卡总数',
    'levelLabel': '关卡 {level}',
    'selectNesRomFile':'📁 选择 NES ROM 文件',

    //messages
    'levelDataExceedBoundaryError': '关卡数据总大小超出边界！第 {level} 关的结束地址为 {endAddr}，超过最大地址 {maxAddr}。无法保存！',
    'loadedFromCacheMessage': '已从缓存加载: {fileName}',
    'romNotFoundWarning':'没有找到游戏 ROM，分享关卡将在加载 ROM 文件后自动运行。',
    'loadShareLevelError': '加载分享关卡失败',
    'loadSharedLevelSuccess':'🎮 已加载分享的关卡！',
    'invalidLevelCountMessageError':'关卡总数必须在1-255之间',
    'levelCountUpdateSuccess':'关卡总数已更新为 {levelCount}',
    'levelCountUpdateFailedError':'关卡总数更新失败：{error}',
    'cacheCleanSuccess':'缓存已清除',
    'cacheCleanError':'清除缓存失败',
    'loadFileSuccess':'文件加载成功: {fileNameStr}, 共 {length} 字节)',
    'emulatorNotRunningWarning':'模拟器未运行',
    'emulatorStopInfo':'✋ 模拟器已停止',
    'pleaseSelectLevelFirstWarning':'请先选择一个关卡',
    'copyShareLevelLinkSuccess':'🔗 分享链接已复制到剪贴板！',
    'copyShareLevelLinkError':'生成分享链接失败:{error}',
    'testingCurrentLevelSuccess':'🎮 正在测试当前关卡...',
    'romNotLoadedError': '请先加载 ROM 文件',
    'emulatorStartSuccess': '🎮 模拟器已启动！',
    'editorNotInitError': '可视化编辑器未初始化',
    'saveMapFailedError': '保存地图数据失败！',
    'monsterDataError': '怪物数据错误 {error}',
    'saveMapSuccess': '关卡 {currentLevel} 保存成功！地图和怪物数据已更新。',
    'saveLevelFailedError': '保存失败: {error}' ,
    'write2RomSuccess': '所有数据已写入ROM！' ,
    'write2RomFiledError': '写入ROM失败: {error}' ,
    'cancelModifyWarning': '已取消修改' ,
    'romDownloadSuccess': 'ROM 文件下载成功!' ,
    'levelReorderSuccess': '关卡已移动：{draggedIndex} → {targetIndex}' ,
    'levelReorderError': '关卡移动失败：{error}' ,
    'changeLevelOrderInfo': '📝 拖拽关卡来调整关卡顺序' ,
    'changeLevelOrderCancelWarning': '✖️ 已取消修改' ,
    'changeLevelOrderSuccess': '关卡顺序已保存（仅在内存中，请点击"写入ROM"按钮保存到文件）' ,
    'forbiddenPlaceEnemyWarning': '敌人数量已达上限，无法放置更多敌人' ,
    'emptyEnemyDataError': '怪物数据不能为空' ,
    'invalidHexValue': '无效的十六进制值: {hexValue}' ,
    "setLevelCountError":'关卡总数必须在1-255之间',
    "invalidLevelIndexError":'无效的关卡索引',   
    'clearRomCacheConfirm': '确定要清除缓存的 ROM 吗？',
    'forbiddenPlaceConsecutiveMoaiWarning': '由于系统限制，无法连续放置 14 个以上的摩艾 NPC，否则压缩后的数据意味着地图结束符号。',
    'prohibitedTileAreaWarning': '第一行为非法放置区域，无法放置图块',
    'prohibitedPlayerAreaWarning': '由于系统限制，玩家起始点只能放在左半边区域',
    'prohibitedDoorAreaWarning': '由于系统限制，该位置将导致玩家无法通关。',
    'consecutiveMoaiError': "由于系统限制，无法防止连续14个摩艾 NPC，否则压缩后的数据意味着地图结束符号。",
};
