# AI Play Interface (AIP) 規約 v1

AIゲーマーがゲームを確実に操作・観測できるようにするための共通インターフェース。
**全ゲームはこの規約を実装すること。** スクリーンショットや座標クリックに頼らず、
JSONの状態と離散アクションでプレイできるのが本リポジトリの核。

## 2つの実行モード

| モード | 用途 | 実行方法 |
|---|---|---|
| ヘッドレス | 定量評価・バランス計測 | `npm run simulate`（Node で core を直接実行） |
| ブラウザ | 定性評価・実プレイ | `npm run dev` → `window.__AIP__` を操作 |

どちらも同じ `src/core/` のロジックを使う。描画はブラウザ側だけ。

## window.__AIP__ の契約

```ts
interface AIP {
  version: 1;
  /** リアルタイム進行を止め、AIが step() でティックを進める制御モードに入る */
  takeControl(): void;
  /** 制御モードを解除し、リアルタイム（人間プレイ）に戻す */
  release(): void;
  /** シードを指定してゲームをリセット（決定論的） */
  reset(seed: number): GameState;
  /** 現在の完全な状態をJSONシリアライズ可能な形で返す */
  getState(): GameState;
  /** 1ティック進める。action省略時は wait。返り値は新しい状態 */
  step(action?: Action): GameState;
  /** 複数アクションを連続実行して最終状態を返す（高速化用） */
  run(actions: Action[]): GameState;
  /** 取りうるアクションの仕様（型・パラメータ・説明）を返す */
  getActionSpec(): ActionSpecEntry[];
}
```

## GameState の要件

- JSON.stringify 可能であること（Map/Set/クラスインスタンス禁止）
- AIが**それだけ見れば意思決定できる**完全情報を含むこと
  （マップ、プレイヤー、敵、インベントリ、時間、ゲームオーバーフラグ）
- `metrics` を必ず含める: レビューで使う定量指標（スコア、生存日数、撃破数など）

## Action の要件

- 判別可能なユニオン型（`{ type: 'move', dir: 'up' }` 形式）
- 1アクション = 1ティック。「押しっぱなし」のような連続量は禁止

## 決定論

- `new Game(seed)` から同じアクション列を流せば必ず同じ状態になること
- `Date.now()` / `Math.random()` を core で使うのは禁止（rng.ts のシード付きPRNGのみ）

## AI（Claude）のブラウザプレイ手順

1. `npm run dev` でサーバ起動（.claude/launch.json 経由の preview_start 推奨）
2. `preview_eval` で `__AIP__.takeControl()` → `__AIP__.reset(seed)`
3. ループ: `getState()` → 意思決定 → `step(action)` または `run(actions)`
4. 適宜 `preview_screenshot` で見た目も確認（描画バグの検出）
5. 終了後 `release()` して人間が触れる状態に戻す
