# Gamestest

複数のゲームプロトタイプをスクラップ＆ビルドで作り、AIゲーマーのプレイとレビューを通じて
最良のゲームプロトタイプに収束させるためのリポジトリ。

- 仕組みの全体像: [CLAUDE.md](CLAUDE.md)
- 開発サイクル: [docs/workflow.md](docs/workflow.md)
- AIゲーマー用インターフェース規約: [docs/ai-interface.md](docs/ai-interface.md)
- AIゲーマーのペルソナ:
  [P01 野望型（積み上げ効率マニア）](personas/p01-yabou.md) /
  [P02 あき型（没入ロールプレイ・サバイバー）](personas/p02-aki.md)

## 現在のプロトタイプ

| # | 名前 | 状態 | 仕様書 | 最新レビュー |
|---|---|---|---|---|
| 001 | MineForge（2Dトップダウン採掘・建築・ゾンビ防衛） | PLAYABLE | [spec](specs/001-mineforge/spec.md) | [v1: FIX](reviews/001-mineforge-v1.md) |

## 遊び方（人間）

```
cd games/001-mineforge
npm install
npm run dev
```

WASD/矢印: 移動, Space: 攻撃, E: 採掘, Q: 壁設置, C: 剣クラフト, R: リスタート
