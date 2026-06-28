# VaultAI — AI資産メモ

> AIとの会話を、あなたの知識資産へ。

スマートフォンのホーム画面にインストールできるPWA（Progressive Web App）です。  
ChatGPT・Claude・Geminiとの会話を保存・管理・再利用するためのメモアプリです。

---

## 📦 ファイル構成

```
vaultai/
├── index.html          # メインHTML
├── manifest.json       # PWAマニフェスト
├── sw.js               # Service Worker（オフライン対応 + キャッシュ管理）
├── css/
│   └── style.css       # スタイルシート
├── js/
│   └── app.js          # アプリロジック
└── icons/
    ├── icon-192.png    # PWAアイコン (192×192)
    ├── icon-512.png    # PWAアイコン (512×512)
    └── apple-touch-icon.png  # iOS用アイコン (180×180)
```

---

## 🚀 GitHub Pagesへのデプロイ手順

### 1. リポジトリを作成

GitHub で新しいリポジトリを作成します（例: `vaultai`）。

### 2. ファイルをプッシュ

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<あなたのユーザー名>/vaultai.git
git push -u origin main
```

### 3. GitHub Pages を有効化

1. リポジトリの **Settings** → **Pages** を開く
2. **Source** を `Deploy from a branch` に設定
3. **Branch** を `main` / `/ (root)` に設定して **Save**
4. 数分後に `https://<ユーザー名>.github.io/vaultai/` でアクセス可能になります

---

## 📱 スマホのホーム画面にインストール

### iOS（Safari）
1. Safari でアプリURLを開く
2. 画面下の **共有ボタン（□↑）** をタップ
3. **「ホーム画面に追加」** を選択

### Android（Chrome）
1. Chrome でアプリURLを開く
2. アドレスバー右のメニュー（⋮）をタップ
3. **「ホーム画面に追加」** を選択

---

## 🔄 アップデート時のキャッシュ削除について

`sw.js` の冒頭にある `CACHE_VERSION` を変更するだけで、古いキャッシュが自動的に削除され、新しいバージョンが即座に適用されます。

```js
// sw.js
const CACHE_VERSION = 'v1.0.1'; // ← バージョンを上げる
```

アップデートの流れ：
1. `CACHE_VERSION` を更新してプッシュ
2. ユーザーがアプリを開くと新しい Service Worker が検出される
3. 古いキャッシュが自動削除され、新しいキャッシュに差し替わる
4. ページが自動リロードされて新バージョンが適用される

---

## 🛡️ データについて

- すべてのデータは **端末内のIndexedDB** にのみ保存されます
- 外部サーバーへの送信は一切ありません
- エクスポート機能でJSONファイルとしてバックアップできます

---

## 📄 ライセンス

MIT
