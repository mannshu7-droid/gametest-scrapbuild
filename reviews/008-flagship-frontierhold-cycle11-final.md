# レビュー: 008-flagship-frontierhold サイクル11・4回目（FINAL REVIEW）

- 実施日: 2026-07-24
- 対象: games/008-flagship-frontierhold v0.8.4（`src/core/game.ts`はサイクル9・2回目以降無変更、
  `headless/simulate.ts`のボット決定ロジックはサイクル10・1回目以降無変更。サイクル11・1回目で
  `headless/simulate.ts`へsingle-stat all-in戦略9種を追加、2回目で`index.html`の`<title>`表記を
  修正、3回目で`@capacitor/core`・`@capacitor/cli`のdevDependency追加と`capacitor.config.ts`生成
  のみ実施）
- 対応する仕様書: [specs/008-flagship-frontierhold/spec.md](../specs/008-flagship-frontierhold/spec.md)
- 前回レビュー: [008-flagship-frontierhold-cycle11-v2.md](008-flagship-frontierhold-cycle11-v2.md)
  （3回目FIX onlyの内容はspec.md「サイクル11・3回目」節、修正内容はPRのみでレビューなし）

## 本レビューの位置づけ

サイクル11は3回にわたり以下を実施した:

1. **1回目（BUILD+REVIEW相当）**: cycle10-finalが提案した「ビルド差が結果に与える影響の
   さらなる検証」に着手し、9種の「single-stat all-in」戦略を`headless/simulate.ts`へ追加。
   「drillだけが深さと引き換えの死亡リスクを持つ独立した進行手段（avgMaxDepth105.5・死亡率55%）」
   「drill以外は迂回橋依存でavgMaxDepth50〜63に収束する」ことを定量的に切り分けた
2. **2回目（FIX+REVIEW相当）**: `index.html`の`<title>`表記ミスを修正し、Capacitor移植
   （タッチ入力レイヤー追加とネイティブビルドの2段階）の最小スコープを仕様書で定義
3. **3回目（FIX only）**: Capacitor移植の低リスクな下準備として`@capacitor/core`・
   `@capacitor/cli`のdevDependency追加と`capacitor.config.ts`生成のみを実施

本回（4回目）は、(1) 20シード×17戦略のヘッドレス再現性確認、(2) 両ペルソナのブラウザAIP
セッション再検証（v2のtitle修正・v3のCapacitor依存追加後もゲームエンジンの実行結果が
一切変わっていないことの確認）、(3) サイクル11全体の総括と次サイクル12への提案を行う。

## 定量評価（ヘッドレスシミュレーション）

`npm run build`（`tsc --noEmit`含む。devDependencyに追加された`@capacitor/core`・
`@capacitor/cli`、生成された`capacitor.config.ts`を含めても型チェック・バンドルへの影響が
無いことを確認）が正常終了した。

### 再現性確認: 20シード（1〜20）×17戦略

cycle11-v1が報告した数値と完全に一致することを確認した（`src/core/game.ts`・
`headless/simulate.ts`のボットロジックとも無変更のため回帰は原理的に発生しない）。

| 戦略 | avgScore | avgMaxDepth | deaths | bottomReached |
|---|---|---|---|---|
| mining-first | 510.0 | 90.1 | 10/20 | 2/20 |
| combat-first | 476.1 | 75.8 | 0/20 | 0/20 |
| balanced | 509.3 | 79.3 | 5/20 | 0/20 |
| bridge-reliant | 362.9 | 62.6 | 0/20 | 0/20 |
| balanced-no-outpost（対照群） | 531.6 | 42.0 | 1/20 | 0/20 |
| mining-first-adaptive | 661.9 | 129.8 | 3/20 | 10/20 |
| combat-first-adaptive | 478.8 | 89.3 | 0/20 | 0/20 |
| balanced-adaptive | 780.9 | 141.2 | 0/20 | 14/20 |
| drill-all-in | 659.6 | **105.5** | **11/20 (55%)** | 6/20 |
| capacity-all-in | 738.5 | 50.5 | 0/20 | 0/20 |
| fuel-all-in | 749.8 | 62.8 | 0/20 | 0/20 |
| atk-all-in | 358.1 | 56.9 | 0/20 | 0/20 |
| hp-all-in | 564.0 | 56.8 | 0/20 | 0/20 |
| atkspeed-all-in | 652.4 | 56.9 | 0/20 | 0/20 |
| skill-all-in | 456.1 | 58.1 | 1/20 | 0/20 |
| muffler-all-in | 699.9 | 55.0 | 1/20 | 0/20 |
| engineering-all-in | 763.9 | 54.5 | 1/20 | 0/20 |

固定8戦略・単一カテゴリ9戦略とも全指標がcycle10-final・cycle11-v1と完全に一致し、
サイクル11の3回を通じて`src/core/game.ts`・`headless/simulate.ts`のボット決定ロジックが
一切変更されていないことを裏付けた。

## 定性評価（AIブラウザ実プレイ）

### 検証方法

`headless/simulate.ts`の`Bot`クラス・`Strategy`型を一時的に`export`し（検証後に
`git checkout`で元に戻し済み、最終的に無変更）、P01(seed301, mining-first-adaptive)・
P02(seed302, balanced-adaptive)それぞれ6000tick分の行動列を`headless/record-actions.ts`
（検証用一時ファイル、検証後に削除済み）でJSONへ書き出した。これを`public/`へ一時配置し、
`npm --prefix games/008-flagship-frontierhold run dev`をBrowser paneで起動して
`window.__AIP__.reset(seed)` → `window.__AIP__.run(actions)`として再生した。

本回の狙いは、cycle11・2回目（`index.html`の`<title>`修正）・3回目（`@capacitor/core`・
`@capacitor/cli`のdevDependency追加、`capacitor.config.ts`生成）という**ビルド構成に
影響しうる変更**を経た後も、Viteのdevサーバー経由でのブラウザ実行パスがヘッドレス実行パスと
一致し続けているかを確認することにある（依存関係の追加はバンドラの解決順序・型チェック範囲に
影響しうるため、コード上「ゲームロジック無変更」であってもビルド成果物が変わらないことは
別途確認する価値がある）。

### 結果

| 指標 | ヘッドレス | ブラウザ再生（v0.8.4、Capacitor依存込み） | cycle10-final時点（参考） |
|---|---|---|---|
| P01(seed301, mining-first-adaptive) finalHp/maxDepth/score/bridgesBuilt/milestonesReached/outpostsBuilt | 140/91/443/3/4/2 | 140/91/443/3/4/2 | 140/91/443/3/4/2 |
| P02(seed302, balanced-adaptive) finalHp/maxDepth/score/bridgesBuilt/milestonesReached/outpostsBuilt | 180/133/656/4/6/4 | 180/133/656/4/6/4 | 180/133/656/4/6/4 |

全指標が完全一致した。特にcycle10-final時点（Capacitor依存追加前・title修正前のv0.8.1）の
記録値とも完全に一致することから、サイクル11の3回にわたる変更（single-stat all-in戦略追加・
title表記修正・Capacitor devDependency追加＋config生成）が本命ゲームのプレイ内容・ビルド成果物
のいずれにも一切影響していないことを二重に裏付けられた。`read_console_messages`でエラー0件も
確認した。ブラウザタブの`document.title`が"Frontierhold (008)"であることも確認し、cycle11-v2の
表記修正が現在のmain上でも維持されていることを確認した。検証用の一時ファイル・`public/`配下の
JSONはすべて削除済みで、`git status`もクリーンな状態に復元した。

`computer.screenshot`は本回も未実施（行動列再生による数値検証で目的を達成できたため）。

## バグ・問題リスト

| # | 深刻度 | 内容 | 状態 |
|---|---|---|---|
| 1 | 軽微・継続 | `computer.screenshot`による目視確認は本回も未実施（数値検証で代替） | 対応不要 |

本回で新規の致命・重大な問題は発見されなかった。

## 判定

**FIX完了・本命ゲーム採用を維持**

理由:

- 20シード×17戦略のヘッドレス再検証で、cycle11-v1が報告した全数値（drill-all-inの
  avgMaxDepth105.5・死亡率55%を含む）が完全に再現され、サイクル11の3回を通じて
  `src/core/game.ts`・`headless/simulate.ts`のボット決定ロジックが無変更であることを裏付けた
- ブラウザAIPでのP01/P02行動列再生が、ヘッドレスの結果およびcycle10-final時点（Capacitor依存
  追加前）の記録値と完全に一致し、cycle11・2回目（title修正）・3回目（Capacitor devDependency
  追加＋config生成）というビルド構成に影響しうる変更が実際のゲームプレイ・ビルド成果物に
  一切影響していないことを実測で確認した
- サイクル11で得た知見（drillが独立した進行手段で他カテゴリは迂回橋依存に収束する）は、
  既存の中核仮説（drill非投資でも迂回橋で壁を越えられる）を裏付ける追加証拠であり、
  新たな致命的バランス崩壊には繋がらなかった

## ペルソナ別の最終評価

サイクル11は本命ゲームのプレイ内容（`src/core/game.ts`）を一切変更していないため、
両ペルソナの評価軸自体はcycle10-finalから変化していない。P01(seed301, mining-first-adaptive)
finalHp140/140・maxDepth91、P02(seed302, balanced-adaptive)finalHp180/180・maxDepth133という
同一の結果が本回も再現しており、cycle10-finalで確認した以下の判定を維持する。

### P01（野望型）: 「クリア後も自主的に遊びたくなるか」→ **Yes（cycle10-finalを維持）**

停滞解消後のfinalHp140/140（満タン）・maxDepth91という結果が本回も再現し、A2（成長実感）・
A6（目標構造）が最後まで機能し続けることを再確認した。加えて、サイクル11・1回目の
single-stat all-in検証（drill-all-inの死亡率55%・avgMaxDepth105.5）は、P01が好む
「大胆な賭けに見合うリスク・リターン」（A7・A8）が、優先度リスト全体の傾向比較だけでなく
単一カテゴリの隔離実験でも一貫して成立することを裏付ける追加証拠になった。

### P02（あき型）: 「人に話したくなる自分の物語ができたか」→ **Yes（cycle10-finalを維持）**

finalHp180/180（満タン）・maxDepth133という結果が本回も再現し、A6・E3が最後まで機能し
続けることを再確認した。サイクル11・1回目のhp-all-in検証（6000tick全編で死亡せずHP満タンの
まま完走、maxDepth57）は、P02が好む「無理なく最後まで到達できる」体験を、単一カテゴリの
極端な形でも裏付ける一方、「単一要素への全振りだけでは目標更新が早期に頭打ちになる」ことも
明確になり、P02が実際に好む`balanced-adaptive`（安全性と進行性の両立）の優位性を相対的に
再確認する結果になった。

## 本命ゲームに採用すべき部分・捨てる部分

- **採用を維持**: 002〜008で確立してきた10の共通パターン（常設・複数カテゴリショップ／安全
  マージンの数値公開／固定範囲の保護装置／詰みからの脱出手段／常時使用可能な緊急離脱／建築を
  第三の選択肢にする／目標を生む建築／危険度UIヒント／区切り・報酬演出／危険度ヒントを状況
  適応的に使う）は本サイクルでも変更なく維持された
- **新たな知見（採用判断に直結する修正はなし）**: サイクル11・1回目の検証で「drillだけが
  迂回橋と競合しない独立した進行手段」であることが定量的に確立された。これは既存のバランス
  数値（drillのrequiredDrillPowerゲート・迂回橋コスト）の設計意図を裏付けるものであり、
  本命ゲームの数値自体を変更する必要はないと判断した
- **技術基盤の前進**: サイクル11・3回目でCapacitor devDependency・設定ファイルを追加し、
  `src/core/game.ts`・`src/render/`を一切変更せずに移植の下準備を完了した。これにより
  次サイクルはコード実装（タッチ入力レイヤー）から即座に着手できる状態になった

## Learnings（次に持ち越す学び）

- **「単一カテゴリの隔離実験」と「ビルド構成変更後の実行パス一致性確認」は、どちらも
  『ゲームロジックは変更していない』という主張を検証可能な形で裏付ける手法として有効。**
  サイクル11・1回目はボットの振る舞いを変えることでゲーム本体の設計意図を検証し、本回
  （4回目）は依存関係・ビルド設定を変えた後でも実行結果が数値として完全一致することを
  確認した。「コードを変えていないので影響がないはず」という推測ではなく、実際に記録した
  過去の数値（cycle10-final時点）と本回の再生結果を1対1で突き合わせることで、推測を検証済みの
  事実に変えられた
- **依存関係の追加（today: Capacitor）は、たとえ`import`されていなくても、ビルドパイプライン
  自体（`tsc --noEmit`の型チェック範囲、Viteのモジュール解決）に影響しうるため、コードを
  変更していない場合でも一度はビルド成果物の実行結果を再検証する価値がある。** 本回でこの
  検証を実施し、影響が無いことを確認できたため、次サイクルはこの前提の上で安心して実装に
  進める
- **次サイクル（サイクル12）への提案**: `src/core/game.ts`はcycle9-v2以降9回の検証回
  （cycle9-v3〜cycle11-final）を通じて無変更のまま安定しており、本命ゲームのバランス検証は
  一区切りついている。cycle11-v2で定義した最小スコープに従い、**`src/render/`へのタッチ
  入力レイヤー実装（BUILD+REVIEW）から着手する**ことを提案する。具体的な4回構成案
  （cycle11-v2で既に定義済み・本回で再確認し依然として有効と判断）:
  1. **1回目（BUILD+REVIEW）**: `src/render/`に仮想D-pad・アクションボタン5つ・ショップ
     タップUIを新規追加する（`Input`と同じ`Action`型を返すクラスを追加し、キーボード入力と
     並存させる）。cycle10・3回目で具体化済みの仕様（画面レイアウト・マルチタッチ・
     セーフエリア）に従う。検証はBrowser paneのモバイル解像度（`resize_window`）で
     P01/P02相当の操作列をタップ再現し、キーボード操作と同一のAction列・同一の決定論的
     結果になることを確認する
  2. **2回目（FIX+REVIEW）**: 1回目で見つかったタッチUXの問題（デッドゾーン・誤タップ・
     マルチタッチの競合等）を修正する
  3. **3回目（FIX only）**: 残課題を修正する。余裕があれば`npx cap add android`
     （Gradleプロジェクトの雛形生成のみ、ビルド・実機確認はスコープ外と明記した上で）を
     試すかどうかをこの時点の状況で判断する
  4. **4回目（FINAL REVIEW）**: タッチ操作がキーボード操作と体験として同等かを総括する。
     ネイティブパッケージング（実機ビルド・ストア申請等）はこの自動ルーチンの実行環境では
     検証不能なため、引き続き人手作業への引き継ぎタスクとして明記する
  - 新規ゲーム番号は引き続き切らず、games/008-flagship-frontierholdをそのまま対象にする
