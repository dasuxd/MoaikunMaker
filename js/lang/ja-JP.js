/**
 * 日本語翻訳
 */
const translations_jaJP = {
    // Top Bar
    'title': 'Moai-kun Maker',
    'selectRom': '📁 ROMファイル選択',
    'clearCache': '🗑️ キャッシュクリア',
    'clearCacheTitle': 'キャッシュされたROMをクリア',
    
    // Sidebar
    'levelList': '📋 ステージリスト',
    'totalLevels': '🎮 合計ステージ数:',
    'editLevels': '✏️ ステージグループ編集',
    'address': '(アドレス: 0x0BD3)',
    'cancel': '❌ キャンセル',
    'saveLevelsEdit': '✔️ 保存',
    'dragTip': '💡 ステージをドラッグして並べ替え',
    
    // Memory
    'memoryUsage': '💾 メモリ使用状況',
    
    // Toolbar
    'config': '🛠️',
    'dragToMove': 'ドラッグで移動',
    'operations': '操作',
    'selectScene': 'シーン選択',
    'scene': 'シーン',
    'wideScene': '📺 ワイドスクリーン',
    'clearMap': 'マップクリア',
    'exportData': 'データエクスポート',
    'applyToRom': 'ROMエディタに適用',
    'tools': 'ツール',
    'tiles': 'タイル',
    'enemies': '敵',
    'special': '特殊',
    
    // Canvas Info
    'gridSize': 'グリッドサイズ:',
    'currentTool': '現在のツール:',
    'notSelected': '未選択',
    'mousePosition': 'マウス位置:',
    
    // Buttons
    'testLevel': '🎮 ステージテスト',
    'testRom': '🎮 ROMテスト',
    'stopEmulator': '⏹️ エミュレータ停止',
    'saveLevel': '💾 ステージ保存',
    'writeToRom': '📝 ROMに書き込み',
    'downloadRom': '⬇️ ROMダウンロード',
    'shareLevel': '🔗 ステージ共有',
    
    // Info Panel
    'mapRomAddress': 'マップROMアドレス',
    'mapCpuAddress': 'マップCPUアドレス',
    'monsterRomAddress': 'モンスターROMアドレス',
    'monsterCpuAddress': 'モンスターCPUアドレス',
    'currentSize': '現在のサイズ',
    'bytes': 'バイト',
    
    // Hex Editor
    'mapDataLabel': '🗺️ マップデータ（終端FFを除く）',
    'readOnly': '[読み取り専用]',
    'hexDataPlaceholder': '16進数データを入力、例: A1 B2 C3 D4...',
    'monsterDataLabel': '👾 モンスターデータ',
    'monsterDataFormat': '(フォーマット: 1バイト目=モンスター数*2+1、その後[タイプ 位置]のペア)',
    'monsterDataPlaceholder': 'モンスターデータを入力、例: 01 (モンスターなし) または 03 01 DD (01タイプのモンスターがDD位置)',
    
    // Welcome Screen
    'welcomeTitle': '🎮 Moai-kun Makerへようこそ',
    'welcomeTip1': 'ROMはご自身でアップロードする必要があります。正しいROMをアップロードしても読み込めない場合は、Issueを提出してください。',
    'welcomeTip2': 'リンクを送るだけで友達とステージを共有できます。',
    'welcomeTip3': '共有リンクからアクセスしてもROMが読み込まれていない場合は、ROMをアップロードすれば共有ステージが自動的に開始されます。',
    'welcomeTip4': 'これは初期バージョンで、バグがあるかもしれません。フィードバックのためにIssueを提出してください。',
    'welcomeUpload': '📤 ROMをアップロードして開始',
    
    // Operation Info
    'operationSummaryLabel': '操作方法:',
    'operationSummary': '移動(WASD)  |  攻撃(J)  |  ジャンプ(K) | スタート(Enter) | セレクト(Shift)',

    // others
    'levelCount' : '合計ステージ数',
    'levelLabel': 'ステージ {level}',
    'selectNesRomFile': '📁 NES ROMファイル選択',

    //messages
    'levelDataExceedBoundaryError': 'ステージデータの合計サイズが境界を超えています！ステージ{level}の終了アドレスは{endAddr}で、最大アドレス{maxAddr}を超えています。保存できません！',
    'loadedFromCacheMessage': 'キャッシュから読み込みました: {fileName}',
    'romNotFoundWarning': 'ゲームROMが見つかりません。ROMファイルを読み込むと共有ステージが自動的に実行されます。',
    'loadShareLevelError': '共有ステージの読み込みに失敗しました',
    'loadSharedLevelSuccess': '🎮 共有ステージが正常に読み込まれました！',
    'invalidLevelCountMessageError': 'ステージ総数は1から255の間でなければなりません',
    'levelCountUpdateSuccess': 'ステージ総数を{levelCount}に更新しました',
    'levelCountUpdateFailedError': 'ステージ総数の更新に失敗しました: {error}',
    'cacheCleanSuccess': 'キャッシュが正常にクリアされました',
    'cacheCleanError': 'キャッシュのクリアに失敗しました',
    'loadFileSuccess': 'ファイルが正常に読み込まれました: {fileNameStr}、{length}バイト)',
    'emulatorNotRunningWarning': 'エミュレータが実行されていません',
    'emulatorStopInfo': '✋ エミュレータが停止しました',
    'pleaseSelectLevelFirstWarning': '最初にステージを選択してください',
    'copyShareLevelLinkSuccess': '🔗 共有リンクをクリップボードにコピーしました！',
    'copyShareLevelLinkError': '共有リンクの生成に失敗しました: {error}',
    'testingCurrentLevelSuccess': '🎮 現在のステージをテスト中...',
    'romNotLoadedError': '最初にROMファイルを読み込んでください',
    'emulatorStartSuccess': '🎮 エミュレータが起動しました！',
    'editorNotInitError': 'ビジュアルエディタが初期化されていません',
    'saveMapFailedError': 'マップデータの保存に失敗しました！',
    'monsterDataError': 'モンスターデータエラー {error}',
    'saveMapSuccess': 'ステージ{currentLevel}が正常に保存されました！マップとモンスターデータが更新されました。',
    'saveLevelFailedError': '保存に失敗しました: {error}',
    'write2RomSuccess': 'すべてのデータがROMに書き込まれました！',
    'write2RomFiledError': 'ROMへの書き込みに失敗しました: {error}',
    'cancelModifyWarning': '変更がキャンセルされました',
    'romDownloadSuccess': 'ROMファイルが正常にダウンロードされました！',
    'levelReorderSuccess': 'ステージが移動しました: {draggedIndex} → {targetIndex}',
    'levelReorderError': 'ステージの並べ替えに失敗しました: {error}',
    'changeLevelOrderInfo': '📝 ステージをドラッグして並べ替えます',
    'changeLevelOrderCancelWarning': '✖️ 変更がキャンセルされました',
    'changeLevelOrderSuccess': 'ステージの順序が保存されました（メモリ内のみ、ファイルに保存するには「ROMに書き込み」ボタンをクリックしてください）',
    'forbiddenPlaceEnemyWarning': '敵の上限に達しました。これ以上敵を配置できません',
    'emptyEnemyDataError': 'モンスターデータを空にすることはできません',
    'invalidHexValue': '無効な16進数値: {hexValue}',
    "setLevelCountError": 'ステージ総数は1から255の間でなければなりません',
    "invalidLevelIndexError": '無効なステージインデックス',
    'clearRomCacheConfirm': 'キャッシュされたROMをクリアしてもよろしいですか？',
    'forbiddenPlaceConsecutiveMoaiWarning': 'システムの制限により、14個以上の連続したモアイNPCを配置することはできません。そうしないと、圧縮されたデータがマップの終わりを示すことになります。',
    'prohibitedTileAreaWarning': '最初の行はタイルを配置できない禁止エリアです',
    'prohibitedPlayerAreaWarning': 'システムの制限により、プレイヤーの開始位置は左半分のエリアにのみ配置できます',
    'prohibitedDoorAreaWarning': 'システムの制限により、この位置ではプレイヤーがステージをクリアできなくなります。',
    'consecutiveMoaiError': "システムの制限により、14個の連続したモアイNPCを防ぐことはできません。そうしないと、圧縮されたデータがマップの終わりを示すことになります。",
};
