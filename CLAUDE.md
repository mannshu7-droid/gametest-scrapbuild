# Gamestest — スクラップ＆ビルド式ゲームプロトタイピング

複数のゲームプロトタイプを高速に作っては壊し、AIゲーマーによるプレイとレビューを通じて
「最も面白いゲーム」の仕様に収束させるためのリポジトリ。

## ディレクトリ構成

```
docs/            仕組みのドキュメント（workflow.md, ai-interface.md, routine.md）
templates/       仕様書・レビューのテンプレート
personas/        AIゲーマーのペルソナ定義（pNN-name.md）。実在プレイヤーの分析から作る
specs/NNN-*/     ゲームごとの仕様書（連番）
games/NNN-*/     ゲーム実装（specs と同じ連番・名前）。索引は games/README.md
reviews/         AIプレイのレビュー結果（NNN-name-vX.md）
routine-state.md 自動ルーチンの現在位置と実行履歴
```

## 自動ルーチン（重要）

6時間おきのスケジュールタスクが docs/routine.md に従って開発を進める。
**4回で1サイクル＝1ゲーム**（BUILD+REVIEW → FIX+REVIEW → FIX → FINAL REVIEW）。
ゲームは要素を1つに絞る（戦闘だけ/採掘だけ/建築だけ）: `games/NNN-<要素>-<名前>/`。
実行時は必ず `routine-state.md` で現在位置を確認し、終了時に更新する。
毎回 PR 作成 → main へマージ（リポジトリ: https://github.com/mannshu7-droid/gametest-scrapbuild ）。

## 開発サイクル（詳細は docs/workflow.md）

1. **SPEC**: `templates/spec-template.md` を元に `specs/NNN-name/spec.md` を書く
2. **BUILD**: `games/NNN-name/` に実装する
3. **AI PLAY**: ヘッドレスシミュレーション（`npm run simulate`）＋ ブラウザで AIP 経由の実プレイ
4. **REVIEW**: `templates/review-template.md` を元に `reviews/` に結果を書く。判定は FIX / PIVOT / SCRAP
5. FIX なら同じゲームを修正、SCRAP なら学びを反映した新しい仕様書（NNN+1）を作る

## 技術規約

- **TypeScript + Vite + Canvas 2D**。ゲームロジックは `src/core/` に純TSで書き、描画・入力（`src/render/`）から完全分離する
  - 理由: ロジックが Node で直接動く → AIが描画なしで数千ティックを一瞬で回して評価できる
- **決定論**: 乱数はシード付きPRNG（`src/core/rng.ts`）のみ。同じシード＋同じ操作列 → 同じ結果
- **AI Play Interface (AIP)**: 全ゲームは `window.__AIP__` を公開する。契約は docs/ai-interface.md 参照
- 将来のiPad/Android移植は Capacitor 前提。タッチ入力は移植時に `src/render/` へ追加する（core は触らない）

## よく使うコマンド（各 games/NNN-*/ 内で）

- `npm run dev` — 開発サーバ起動（人間・ブラウザAIプレイ用）
- `npm run build` — 型チェック＋ビルド
- `npm run simulate` — ヘッドレスでボットが自動プレイし、バランス指標をJSON出力
