# レビュー: 008-flagship-frontierhold cycle13-v1

- 実施日: 2026-08-12
- 対象: games/008-flagship-frontierhold（サイクル13・1回目、BUILD+REVIEW）
- 対応する仕様書: [specs/008-flagship-frontierhold/spec.md](../specs/008-flagship-frontierhold/spec.md)
  「サイクル13・1回目（BUILD+REVIEW）: `npx cap add android`によるプラットフォーム雛形生成」節

## 今回の変更範囲

routine-state.mdの指示（cycle11-v2が定義した2段階計画の後段、Androidプラットフォーム雛形生成）
に従い、`@capacitor/android`を追加し`npx cap add android`でGradleプロジェクト雛形を生成した。

- 追加: `games/008-flagship-frontierhold/android/`（Capacitor CLI生成、66ファイル・456KB）
- 変更: `package.json`・`package-lock.json`（`@capacitor/android`をdevDependencyへ追加）
- **`src/core/game.ts`・`src/render/`・`headless/simulate.ts`はいずれも無変更**

今回はゲームロジック・UIコードの変更を伴わない純粋なネイティブビルド基盤の追加であり、
通常の「新要素の実装→両ペルソナでプレイ評価」という定性評価の形式は適用対象外（画面や
操作方法に変化がないため、ペルソナがプレイしても体験上の差分は存在しない）。そのため本回は
定量評価（ビルド整合性の確認）を主軸としたレビューとする。

## 定量評価

### ビルド・ヘッドレスシミュレーション

- `npm run build`: 成功（型チェック含む）。`dist/`が生成され、`capacitor.config.ts`の
  `webDir: 'dist'`設定と実際の出力先が一致することを確認した
- `npx cap add android`: エラーなく成功。Android SDKを要求せず、この自動実行環境
  （Node/npm限定）でコマンド自体が完結することを確認した
- `npx cap sync android`: エラーなく成功。`dist/`の内容が
  `android/app/src/main/assets/public`へコピーされ、`capacitor.config.json`が
  `android/app/src/main/assets`に生成されることを確認した（`webDir`設定と`dist/`成果物の
  整合性の裏付け）
- `npm run simulate`: 成功。`src/core/game.ts`・`headless/simulate.ts`とも無変更のため、
  5戦略×5シードの再実行結果は既存のcycle12時点の数値と完全一致（コアロジック無傷）。
  代表例（hp-all-in戦略）: `avgScore=389.6 avgMaxDepth=60.0 avgUpgradesBought=2.4 deaths=0/5`

### 生成物の妥当性チェック

| # | 確認項目 | 結果 |
|---|---|---|
| 1 | `android/.gitignore`がビルド成果物（`build/`, `*.apk`, `local.properties`等）を除外する標準テンプレートか | Capacitor CLI既定の`Android.gitignore`テンプレートが生成されており妥当 |
| 2 | `android/app/.gitignore`が`build/`ディレクトリのみ除外し雛形自体は追跡対象か | `/build/*` と `!/build/.npmkeep` のみで、雛形コード一式は追跡対象になっている |
| 3 | 生成物のサイズがリポジトリに commit するのに妥当な範囲か | 456KB・66ファイル（`gradle-wrapper.jar`含む）で、Android/Capacitorプロジェクトとして標準的なサイズ |
| 4 | `capacitor.config.ts`の`appId`/`appName`が`android/app/build.gradle`・`AndroidManifest.xml`へ正しく反映されているか | `appId: com.gametestscrapbuild.frontierhold008`が`applicationId`として反映されていることを確認 |

## 定性評価（AIブラウザ実プレイ）

該当なし。生成されたのはGradleプロジェクトの雛形（ネイティブビルド設定ファイル一式）のみで、
起動可能なアプリやWebページとして実行できる成果物ではない（Android Studio/実機/エミュレータ
でのビルドが必要）ため、Browser paneでのプレイ検証は原理的に対象外。既存のキーボード/タッチ
操作によるゲームプレイ体験は`src/`が無変更のためcycle12時点から一切変化していない。

## バグ・問題リスト

| # | 深刻度 | 内容 | 再現方法 |
|---|---|---|---|
| 1 | 軽微（対応済み・記録目的） | `npx cap add android`実行前は`@capacitor/android`パッケージが未インストールで「Could not find the android platform」エラーになった | cycle11・3回目時点では`@capacitor/core`・`@capacitor/cli`のみ追加しており`@capacitor/android`は未追加だったため。本回`npm install @capacitor/android --save-dev`で解消 |

致命・重大なバグは発見しなかった。`src/core/game.ts`は無変更であり、既存の12サイクル分の
バランス検証（cycle1〜12の全レビュー）はすべて有効なまま持ち越される。

## 判定

**FIX**

理由: `npx cap add android`・`npx cap sync android`とも本自動実行環境でエラーなく完了し、
`dist/`と`webDir`設定の整合性も確認できた。ゲームロジック・操作体験には一切変化がなく、
既存のバランス検証・タッチ入力検証（cycle1〜12）はすべて無傷で持ち越される。ただし、
生成された`android/`が実際にGradleでビルド可能か（依存解決・コンパイル成功）はこの環境に
Android SDK/JDKが無いため検証できておらず、「完了」ではなく人手作業（Android Studio環境での
実ビルド確認）に引き継ぐ項目が残るためFIXとする。

## Learnings（次の仕様書に持ち越す学び）

- `npx cap add <platform>`コマンド自体はプラットフォーム固有のSDK（Android SDK等）を要求せず、
  Node/npm環境のみでGradleプロジェクトの雛形生成が完結する。ただし対応する`@capacitor/<platform>`
  パッケージ（例: `@capacitor/android`）の事前インストールが必要で、`@capacitor/core`・
  `@capacitor/cli`だけでは不足する（cycle11・3回目はこの2つのみ追加していたため、今回追加で
  必要になった）
- `npx cap sync`はビルドを実行するわけではなく、`webDir`の成果物とネイティブプロジェクトの
  設定ファイルをコピー・同期するだけの軽量な操作であり、この自動実行環境でも
  「ビルド設定の整合性チェック」の代替として有効に使える
- 一方、生成された`android/`フォルダが実際にコンパイル・ビルド可能かどうかは、この環境には
  Android SDK/JDK/Gradleの実行環境が無いため原理的に検証不能。cycle11-v2が事前に見積もった
  「雛形生成はできるがビルド確認はできない」という切り分けが実測でも正確だったことを確認した
- 次回（サイクル13・2回目以降）は、ビルド自体の検証ができない以上、代わりに(a) Android向けの
  設定ファイル（`AndroidManifest.xml`のパーミッション最小化、アプリアイコン/スプラッシュの
  プレースホルダー確認等）の静的な妥当性チェック、(b) 人手が実機ビルドを行う際の手順書
  （チェックリスト）をspec.mdに整備する、のいずれかで前進させることを検討するとよい
