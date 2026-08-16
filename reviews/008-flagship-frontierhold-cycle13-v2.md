# レビュー: 008-flagship-frontierhold cycle13-v2

- 実施日: 2026-08-16
- 対象: games/008-flagship-frontierhold（サイクル13・2回目、FIX+REVIEW相当）
- 対応する仕様書: [specs/008-flagship-frontierhold/spec.md](../specs/008-flagship-frontierhold/spec.md)
  「サイクル13・2回目（FIX+REVIEW相当）: Android設定ファイルの静的妥当性チェックと実機ビルド手順書」節

## 今回の変更範囲

routine-state.mdの指示（cycle13-v1のLearningsが提案した2方向）に従い、以下を実施した。

- (a) `android/app/src/main/AndroidManifest.xml`のパーミッション最小性、`android/app/build.gradle`の
  `applicationId`/`versionCode`/`versionName`と`capacitor.config.ts`/`package.json`との整合を確認
- (b) 人手による実機ビルド手順書（前提ツール・コマンド・確認チェックリスト）をspec.mdに追記

変更ファイル:

- `games/008-flagship-frontierhold/android/app/build.gradle`（`versionName "1.0"` → `"0.11.0"`、
  下記バグ#1参照）
- `specs/008-flagship-frontierhold/spec.md`（新節追加）
- **`src/core/game.ts`・`src/render/`・`headless/simulate.ts`はいずれも無変更**

前回（cycle13-v1）と同様、ゲームロジック・UIコードの変更を伴わない設定確認・ドキュメント整備が
主軸のため、通常の両ペルソナ定性評価は適用対象外（画面や操作方法に変化がない）。本回も定量評価
（ビルド整合性の確認）を主軸としたレビューとする。

## 定量評価

### ビルド・ヘッドレスシミュレーション

- `npm run build`: 成功（型チェック含む）。`versionName`の変更はWebビルド成果物に影響しない
- `npm run simulate`: 成功。5戦略×5シードの再実行結果がcycle13-v1時点の記録値と完全一致
  （代表例、hp-all-in戦略）: `avgScore=389.6 avgMaxDepth=60.0 avgUpgradesBought=2.4 deaths=0/5`

### 静的妥当性チェック結果

| # | 確認項目 | 結果 |
|---|---|---|
| 1 | AndroidManifest.xmlのパーミッションが最小限か | `INTERNET`権限1件のみ（Capacitor既定テンプレート）。ゲームが必要としない権限（カメラ・位置情報・ストレージ等）の付与なし |
| 2 | `applicationId`と`capacitor.config.ts`の`appId`の整合 | 一致（`com.gametestscrapbuild.frontierhold008`） |
| 3 | アプリ名と`capacitor.config.ts`の`appName`の整合 | 一致（`Frontierhold`） |
| 4 | `versionCode`/`versionName`と`package.json`の`version`の整合 | **不一致を検出・修正**（下記バグ#1） |

## 定性評価（AIブラウザ実プレイ）

該当なし（cycle13-v1と同一理由。設定ファイル・ドキュメントの変更のみでプレイ体験に差分なし）。

## バグ・問題リスト

| # | 深刻度 | 内容 | 再現方法 |
|---|---|---|---|
| 1 | 軽微（対応済み） | `npx cap add android`が生成する`android/app/build.gradle`の`versionName`（既定値`"1.0"`）が`package.json`の`version`（`"0.11.0"`）と無関係のまま放置されていた。Capacitorは`package.json`のversionを`build.gradle`へ自動同期しない仕様のため、`npx cap add android`直後は常にこの不一致が生じる | `android/app/build.gradle`の`versionName`と`package.json`の`version`を目視比較すれば即座に検出可能。本回`versionName`を`"0.11.0"`へ修正 |

致命・重大なバグは発見しなかった。`src/core/game.ts`は無変更であり、既存の13サイクル分の
バランス検証（cycle1〜13の全レビュー）はすべて有効なまま持ち越される。

## 判定

**FIX**

理由: 静的妥当性チェックで軽微な不一致（versionName未同期）を1件発見・修正し、それ以外の
3項目（パーミッション最小性・appId整合・appName整合）は問題なしと確認した。実機ビルド手順書も
整備し、人手作業への引き継ぎ内容を具体化した。ただし実際のGradleビルド成否（依存解決・
コンパイル成功）自体は、cycle13-v1と同様この環境にAndroid SDK/JDKが無いため検証できておらず、
「完了」ではなく人手作業（Android Studio環境での実ビルド確認、本レビューで整備した手順書に従う）
に引き継ぐ項目が残るためFIXとする。

## Learnings（次の仕様書に持ち越す学び）

- Capacitorは`npm.config.ts`の`appId`/`appName`をネイティブプロジェクトへ反映するが、
  `package.json`の`version`は`android/app/build.gradle`の`versionCode`/`versionName`へ
  自動反映しない。今後`package.json`のバージョンを上げるサイクルでは、`versionName`
  （および必要なら`versionCode`）を手動で追従させる運用ルールが必要（spec.mdに明記済み）
- `npx cap add android`が生成する既定の`AndroidManifest.xml`は、Capacitorコアが必要とする
  `INTERNET`権限のみを含む最小構成である。プラグイン（カメラ・位置情報等）を追加しない限り
  権限は増えないため、「最小限か」の確認は今後もプラグイン追加の都度これと同じ手順で行える
- 実際のGradleビルド可否検証はこの自動実行環境では構造的に不可能（cycle13-v1で確認済みの制約が
  継続）。今回のように「静的な設定ファイルの整合性チェック」「人手向け手順書の整備」という
  形でのみ前進させられる範囲は限られており、この方向でのさらなる前進は限界に近い。次回
  （サイクル13・3回目 or 4回目）は、この限界を踏まえてCapacitor関連の作業を一区切りとし、
  サイクル14以降は本命ゲーム本体（`src/core/game.ts`側）の磨き上げへ回帰することを検討するとよい
