# browrec

`browrec` は、ブラウザ操作を **記録（Record）** し、**学習/変換（Compile）** して、**LLMなしで高速実行（Run）** するための npm CLI です。

- 記録時: Playwright + （必要に応じて）ローカルLLM
- 実行時: LLMを呼ばずに実行（HTTP優先、必要箇所のみPlaywright）

## コンセプト

ブラウザ自動化を毎回LLMに依存すると遅くなるため、以下を分離します。

1. Record（記憶）
2. Compile（学習/変換）
3. Run（高速実行）

この分離で、運用時は安定・低遅延を目指します。

## フェーズ詳細

### 1. Record

- ユーザーが通常どおりブラウザを操作
- Playwrightイベントを `raw.jsonl` に保存
- DOM特徴量（anchors）を保存
  - `role/name`, `label`, `placeholder`, `nearbyText`
  - `selectorVariants`（複数候補）
- navigation時にHTMLスナップショットを保存
- request/responseログも保存（CompileでHTTP化に使う）

### 2. Compile

- 記録ログからレシピ（`recipe.json`相当）を生成
- ローカルLLM（例: `claude -p`）で意図要約を生成可能
- request/response を解析し、API候補を `http fetch` step に自動昇格
  - 静的アセットを除外
  - ドキュメントダウンロードは保持
  - 重複request URLを除去
- 各stepに `mode: "http" | "pw"` を付与
- フォールバック情報（selector再探索・repair許可）を保存
- 同名recipeは `version` をインクリメント

### 3. Run

- レシピをLLMなしで実行
- `http` stepを先に実行、`pw` stepは最小限で実行
- selector候補を順番に試行
- stepごとの `guards/effects` を実行時検証
  - 例: `url_is`, `url_not`, `text_visible`, `url_changed`
- 失敗時は `repair` で差分更新

## CLI

```bash
# 記録開始（GUIブラウザ）
browrec record <name> --url https://example.com

# 記録ログをrecipe化（必要ならローカルLLM使用）
browrec compile <name> --llm-command claude

# recipeを高速実行（LLMなし）
browrec run <name> --json

# 失敗再現用デバッグ（GUI + video）
browrec debug <name>

# 部分修復（version更新）
browrec repair <name>

# レシピ管理UIを起動
browrec ui --port 4312
```

## ディレクトリ構成

```text
recordings/
  <name>/
    raw.jsonl
    snapshots/*.html
recipes/
  <name>.recipe.json
artifacts/
  <name>/
public/
  index.html
src/
  commands/
  core/
  ui/
```

## レシピモデル（要点）

- `steps[]`
  - `mode`: `http` or `pw`
  - `action`: `goto | click | fill | press | fetch | extract | ensure_login`
  - `selectorVariants[]`（複数候補）
  - `guards[]`, `effects[]`
- `fallback`
  - `selectorReSearch`
  - `selectorVariants`
  - `allowRepair`
- `version`

## 開発

### 前提

- Node.js 20+
- Playwright実行可能環境
- （任意）ローカルLLMコマンド: `claude`

### セットアップ

```bash
npm install
```

### 品質チェック

```bash
npm run lint
npm run test
npm run build
```

- Test: `vitest`
- Lint/Format: `biome`

## 現在のMVP範囲

- Record: click/input/navigation/request/response/console を記録
- Compile: API候補のHTTP昇格 + LLM要約（任意）
- Run: HTTP先行 + Playwright再生 + guard/effect検証
- Repair: selector候補整理とversion更新
- UI: recipe一覧/JSON編集/保存

## 今後の拡張候補

- storageState/cookie jar連携によるログイン再利用
- 失敗ステップ単位の差分パッチ生成（真の部分再学習）
- `guards/effects` の表現力拡張（URLパターン、構造化条件）
- API候補抽出の精度改善（レスポンス本文の構造推定）
