# 🗿 Moai-kun Maker

[English](README.en.md) | [中文](README.md) | 日本語

NESゲーム「モアイくん」のウェブベースレベルエディター。

## 🔍 クイックプレビュー

### インターフェース: 
![インターフェース](https://dasuxd.github.io/Pages/MoaikunMaker/docs/info.png)

#### モバイル 縦画面
![モバイルデモ1](https://dasuxd.github.io/Pages/MoaikunMaker/docs/phone1.gif)

#### モバイル 横画面
![モバイルデモ2](https://dasuxd.github.io/Pages/MoaikunMaker/docs/phone2.gif)


### ゲームプレイ：
![プレイ](https://dasuxd.github.io/Pages/MoaikunMaker/docs/play.gif)


## ✨ 機能

- 🎨 **ビジュアル編集** - 直感的なグラフィカルインターフェースでレベルをデザイン
- 🎮 **即座にテスト** - 内蔵NESエミュレータでリアルタイムにレベルをテスト
- 🔗 **レベル共有** - ワンクリックで共有リンクを生成
- 💾 **ROM編集** - ROMファイルを直接変更してエクスポート
- 🌐 **多言語対応** - 中国語/英語/日本語インターフェースをシームレスに切り替え
- 📋 **レベル管理** - ドラッグ＆ドロップでの並べ替え、一括編集
- 🛟 **独立バックアップ** - ROMアドレスに依存せず、単一ステージまたは全ステージを入出力
- 📦 **下書き・共有タブ** - 下書き、読み込み、共有ステージを独立編集し、正式一覧の末尾へ追加可能
- 📴 **無効ステージ保護** - ステージ数を減らしても末尾データを削除せず、灰色の無効状態で保持

## 🚀 クイックスタート

### オンライン使用

直接アクセス：[デモリンク](https://dasuxd.github.io/MoaikunMaker/)

### ローカルセットアップ

```bash
# リポジトリをクローン
git clone https://github.com/dasuxd/MoaikunMaker.git

# ディレクトリに移動
cd moaikun-maker

# 任意のウェブサーバーで実行
# Pythonを使用
python -m http.server 8000

# またはNode.jsを使用
npx serve

# ブラウザでhttp://localhost:8000を開く
```

## 📖 使用ガイド

### 1. ROMをアップロード

- 「📁 ROMファイル選択」ボタンをクリック
- 合法的に所有しているモアイくんROMファイル（.nes）を選択
- 読み込みが完了するまで待つ

### 2. レベルを編集

- 左側のサイドバーからレベルを選択
- 右側のツールバーでタイル/敵/特殊アイテムを選択
- 左クリックで配置、右クリックで削除
- シーン、ワイドスクリーン、その他のプロパティを調整

### 3. レベルをテスト

- 「🎮 ステージテスト」をクリックして、エミュレータで現在のレベルを実行
- 「🎮 ROMテスト」をクリックして、完全なゲームをテスト
- 「⏹️ エミュレータ停止」をクリックして、編集に戻る

### 4. 保存と共有

- **💾 ステージ保存** - 変更をメモリに保存
- **📝 ROMに書き込み** - すべての変更をROMデータに書き込む
- **⬇️ ROMダウンロード** - 変更されたROMファイルをダウンロード
- **🔗 ステージ共有** - 共有リンクを生成し、友達にコピーして送信
- **📤 現在のステージを書き出す** - 未保存の変更を含む現在の編集を `.moailevel` で保存
- **🧰 全ステージを書き出す** - 正式ステージと下書きを `.moaipack` 復旧ファイルで保存
- **📥 ステージを読み込む** - 単一ステージは下書きへ、全ステージパックは正式ステージを復元
- **🧰 全下書きを書き出す** - 下書き・共有ステージを `.moaidrafts` で個別に保存
- **➕ 正式ステージに追加** - 有効ステージの末尾、灰色の無効ステージより前に下書きを挿入

## 🎮 重要な注意事項

**このツールは合法的なゲームROMファイルが必要です**

1. ✅ 自分の実物カートリッジからROMをダンプ
2. ✅ または公式/合法的なソースから購入
3. ❌ 違法なウェブサイトから海賊版ROMをダウンロードしないでください

## 🛠️ 技術スタック

- **フロントエンド**: バニラJavaScript (ES6+)
- **NESエミュレータ**: [JSNES](https://github.com/bfirsh/jsnes)
- **グラフィックス**: HTML5 Canvas
- **スタイリング**: CSS3
- **ビルドツール**: 不要、直接実行

## 📁 プロジェクト構造

```
moaikun-maker/
├── index.html              # メインページ
├── css/
│   ├── style.css          # メインスタイル
│   ├── level_editor.css   # エディタスタイル
│   └── sortable.css       # ソート可能コンポーネントスタイル
├── js/
│   ├── app.js             # メインアプリケーションロジック
│   ├── Config.js          # 設定
│   ├── DataConverter.js   # データ変換
│   ├── Enemy.js           # 敵の設定
│   ├── i18n.js            # 国際化メインファイル
│   ├── Level.js           # レベルデータ構造
│   ├── LevelEditor.js     # レベルエディタ
│   ├── MobileGameController.js # モバイルゲームコントローラー
│   ├── NesEmulator.js     # エミュレータラッパー
│   ├── ResourceManager.js # リソース管理
│   ├── RomCache.js        # ROMキャッシング
│   ├── RomEditor.js       # ROM編集
│   ├── lang/              # 言語ファイルディレクトリ
│   │   ├── zh-CN.js       # 簡体字中国語
│   │   ├── en-US.js       # 英語
│   │   └── ja-JP.js       # 日本語
│   └── lib/               # サードパーティライブラリ
│       └── jsnes.min.js   # NESエミュレータコア
└── README.md              # プロジェクトドキュメント
```

## ⚖️ 法的通知

このツールは教育および研究目的のみを対象としています。

- ✅ このソフトウェアは**レベルエディタツール**であり、ゲームROMや著作権で保護されたリソースは含まれていません
- ⚠️ ユーザーは合法的に所有しているゲームROMファイルを自分で提供する必要があります
- 🚫 海賊行為はサポートされておらず、推奨されていません
- 📜 ユーザーは自分の管轄区域の著作権法を遵守する必要があります
- 🛡️ 作者はこのツールの使用から生じるいかなる法的結果についても責任を負いません

**モアイくん (Moai-kun)** はコナミの商標です。このプロジェクトはコナミと提携、承認、または関連していません。

## 🤝 貢献

IssueとPull Requestは歓迎します！

1. リポジトリをフォーク
2. 機能ブランチを作成 (`git checkout -b feature/AmazingFeature`)
3. 変更をコミット (`git commit -m 'Add some AmazingFeature'`)
4. ブランチにプッシュ (`git push origin feature/AmazingFeature`)
5. Pull Requestを開く

## 📝 ロードマップ

- [ ] レベルデータのバックグラウンド処理（将来実装する価値がある場合）

## 📄 ライセンス

このプロジェクトは[MITライセンス](LICENSE)の下でライセンスされています。

## 🙏 謝辞

- [JSNES](https://github.com/bfirsh/jsnes) - NESエミュレータコア
- [Sortable](https://github.com/SortableJS/Sortable) - Sortableフレームワーク
- Konami - オリジナルゲーム開発者
- すべての貢献者とテスター

## 📧 連絡先

質問や提案がある場合は、以下を通じて連絡してください：

- GitHub Issues: [Issueを提出](https://github.com/dasuxd/MoaikunMaker/issues)
- Email: aihidao@126.com

---

⭐ このプロジェクトが役に立った場合は、Starをください！
