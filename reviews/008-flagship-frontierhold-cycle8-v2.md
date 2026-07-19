# レビュー: 008-flagship-frontierhold サイクル8・2回目（FIX+REVIEW）

- 実施日: 2026-07-19
- 対象: games/008-flagship-frontierhold v0.5.0（cycle8-v1指摘の詰め）
- 対応する仕様書: [specs/008-flagship-frontierhold/spec.md](../specs/008-flagship-frontierhold/spec.md)
  （「サイクル8・2回目（FIX+REVIEW）で実施した修正内容」節）
- 前回レビュー: [008-flagship-frontierhold-cycle8-v1.md](008-flagship-frontierhold-cycle8-v1.md)

## 本レビューの位置づけ

routine-state.mdの指示どおり、cycle8-v1のバグ・問題リストのうち以下2点の**要否判断**を行った回。
新要素の追加は行わず、`headless/simulate.ts`（適応型ボットの判断ロジック）のみを変更した。

1. combat-first-adaptiveの介入機会不足（v1指摘#2、軽微）
2. mining-first-adaptiveの安全側への振れすぎ懸念（v1指摘#1、想定内トレードオフとされていたが再検討）

## 調査プロセスと判断

### 指摘#2（combat-first-adaptiveの介入機会不足）→ 対応不要と判断

combat-first(-adaptive)は元の優先度自体がatk/hpを高順位に置くため、combatRiskLevelがほぼ常に
safe/caution圏内に留まり適応ロジックが介入する場面が少ない。これは「安全なビルドには何も起きない」
という設計上の期待通りの挙動であり、無理に介入機会を増やす（より危険なビルドを追加する等）ことは
CLAUDE.mdの「コンテンツの水増しはしない」方針・本サイクルの「新要素を追加しない」方針の双方と
矛盾するため、対応不要と判断した。

### 指摘#1/#3（mining-first-adaptiveの安全側への振れすぎ）→ 診断の上、大部分は意図した代償と判断

`priorityFor`（購入優先度の動的変更ロジック）を強制的にbaseへ固定する診断実行を行ったところ、
mining-first-adaptiveのavgMoneyEarned-44%・avgMaxDepth-12%等の低下は、`adaptiveRiskRetreat`
（危険域での自主撤退）ではなく`'caution'`状態（maxHp/recommendedHp比0.7〜1.0、`'danger'`より
はるかに頻繁に発生する）でのhp優先繰り上げがdrill投資を長期間後回しにすることが主因と特定した。

`'caution'`側の繰り上げ自体を外す変更も試したところ、20シート集計は大幅に改善した
（mining-first-adaptive avgScore446.6→515.9、avgMoneyEarned128.6→230.0、ほぼmining-first(固定)
水準に回復）が、**cycle8-v1で確認済みの中核シナリオ（P01 seed301: 適応型戦略が固定戦略のtick4524
死亡を回避しfinalHp41/140で完走）がtick4414死亡へ回帰する**ことをブラウザAIP・headless両方で
確認した。この回帰は008finalの最優先課題（UIヒントが実際に行動を変える効果を持つか）への
唯一の肯定的な実証を無効化するものであり、aggregate指標の改善と引き換えにすべきではないと判断し、
**`'caution'`/`'danger'`とも繰り上げは維持することにした**。aggregate指標の低下はP01のシナリオを
救う安全機構が働くための意図した代償であり、「振れすぎ」ではなく必要なコストと結論づけた。

一方、副作用が無いと確認できた2点は反映した:

1. **`'danger'`側の繰り上げからatkを除外**: `game.ts`の`combatRiskLevel()`はmaxHpと
   recommendedHpForBandの比だけで決まりatkを一切考慮しないため、atkの繰り上げはcombatRiskLevel
   自体を改善しない無駄なdrill投資の後回しにしかならない
2. **adaptiveRiskRetreatにHP閾値（`maxHp*0.85`）を追加**: 従来は`combatRiskLevel==='danger'`に
   なった瞬間、被弾ゼロ・満タンHPのままでも即座に撤退していた。実際に被弾してHPがこの閾値を
   下回るまでは通常戦略と同じく行動を続けるよう変更し、「危険を感知しても実害が出るまでは様子を見る」
   という現実的な判断に近づけた

## 定量評価（ヘッドレスシミュレーション、20シード×8戦略）

`npm run simulate -- --seeds 1,2,...,20 --maxTicks 20000`:

| 戦略 | avgScore | avgMoneyEarned | avgMaxDepth | 死亡 |
|---|---|---|---|---|
| mining-first-adaptive | 446.6（v1と完全一致） | 128.6（v1と完全一致） | 69.0（v1と完全一致） | 6/20（v1と同じ） |
| combat-first-adaptive | 539.9（v1: 539.5） | 121.0 | 81.6（v1: 81.5） | 0/20 |
| balanced-adaptive | 553.0（v1: 552.5） | 142.0（v1: 143.2） | 72.7（v1: 72.5） | **0/20（v1: 1/20）** |

- **mining-first-adaptiveは`'caution'`側の繰り上げを維持したためv1と完全に一致（判断どおり）**
- combat-first-adaptive・balanced-adaptiveはatk除外・HP閾値追加の効果でわずかに改善した
  （balanced-adaptiveは死亡1/20→0/20）
- combat-first・bridge-reliant・balanced-no-outpost・mining-first・balanced・combat-first
  （最深部演出等の影響を受ける固定戦略群含む）はv1・final時点と完全にゼロ差分であることを再確認し、
  今回の修正が既存の固定戦略へ一切副作用を与えていないことを裏付けた

## 定性評価（AIブラウザ実プレイ、window.__AIP__経由）

`npm run dev`（port 5180）を起動し、v2ボットロジック（今回の2修正込み）をJS移植して
`window.__AIP__`経由でP01(seed301)/P02(seed302)を6000tickフル実行した。

| シナリオ | 結果 | headlessとの一致 |
|---|---|---|
| seed301, mining-first-adaptive | finalHp41/140・maxDepth85・score501・6000tick完走 | 完全一致 |
| seed301, mining-first（固定） | finalHp0・maxDepth85・score447・tick4524死亡 | 完全一致 |
| seed302, mining-first-adaptive | finalHp0・maxDepth114・score667・tick5334死亡 | 完全一致 |

**P01(seed301)の死亡回避シナリオ（008finalの最優先課題への肯定的実証）は本回の修正後も維持されている
ことを確認した。** コンソールエラー0件、`npm run build`（tsc --noEmit + vite build）も正常終了。

### 新規発見: seed302でmining-first-adaptiveがmining-first（固定）より早く死ぬ逆転現象

seed302をmining-first-adaptiveで実行するとtick5334でHP0まで削られて死亡する一方、同じseedを
mining-first（固定）で実行すると死亡せずmaxDepth133まで到達し6000tick完走する（固定の方が
適応型より深く・安全に進む逆転現象）。`git stash`で本回の変更前のコード（cycle8-v1がマージした
時点のコード）に戻して同一条件で再実行したところ、変更前後で完全に同一のtick5334死亡を再現した
ため、**本回の修正が持ち込んだ回帰ではなく、cycle8-v1の時点から存在していた既存の挙動**と確認した。
cycle8-v1ではP02は`combat-first(-adaptive)`でのみ検証されており、`mining-first-adaptive`での
P02相当シードは今回初めて検証した組み合わせである。適応型戦略は「期待値としてのリスク低減」で
あり全シードでの安全を保証するものではないことを示す新規の知見として記録する（対応は次回以降で
判断、直ちに修正が必要な致命的バグとは判断しない。理由: 20シード集計で見た死亡率自体はmining-first
固定9/20よりmining-first-adaptive6/20の方が低く、個別シードでの逆転は許容範囲内の分散と考えられる）。

## バグ・問題リスト

| # | 深刻度 | 内容 | 状態 |
|---|---|---|---|
| 1 | 対応不要と判断 | combat-first-adaptiveの介入機会不足（cycle8-v1指摘#2） | 「安全なビルドには何も起きない」という設計通りの挙動と再確認。対応不要 |
| 2 | 対応不要と判断（診断済み） | mining-first-adaptiveの安全側への振れすぎ（cycle8-v1指摘#1/#3） | 診断の結果、P01死亡回避シナリオを維持するための必要なコストと判明。'danger'のatk除外・撤退HP閾値の2点のみ反映し、'caution'側のhp繰り上げは維持 |
| 3 | 軽微・新規 | seed302でmining-first-adaptiveがmining-first（固定）より早く死ぬ逆転現象 | cycle8-v1時点から存在する既存挙動と確認（本回の回帰ではない）。適応型戦略の限界（期待値のリスク低減であり個別シードの安全は保証しない）として記録、直ちの対応は不要と判断 |
| 4 | 軽微・継続 | `computer.screenshot`タイムアウトで目視未確認（リポジトリ共通の環境制約） | 未解消（15サイクル連続） |

## 判定

**FIX**（要否判断の結果、一部は「対応不要」、一部は副作用のない範囲で反映した。3回目（FIX only）へ
持ち越す新規課題は無し）

理由:

- routine-state.mdが指示した2つの要否判断（combat-first-adaptiveの介入機会不足、
  mining-first-adaptiveの安全側への振れすぎ）はいずれも診断・実測に基づいて判断を下した
- mining-first-adaptiveについては、安易に「aggregate指標を改善する」方向の変更を適用すると
  008finalの最優先課題への唯一の肯定的実証（P01の死亡回避）が失われることをブラウザAIP・headless
  両方で確認し、その変更を採用しなかった判断過程自体が本サイクルの重要な検証成果である
- 一方で副作用がないと確認できた2点の改善（atk除外・撤退HP閾値）は反映し、combat-first-adaptive・
  balanced-adaptiveでわずかな改善（balanced-adaptiveの死亡1/20→0/20）を得た
- 新規発見（seed302の逆転現象）は致命的ではなく、適応型戦略の性質（期待値のリスク低減）を示す
  知見として記録した

## Learnings（次のFIX・次サイクルに持ち越す学び）

- **「aggregateの数値を改善する変更」と「個別の検証済みシナリオを守る変更」が対立する場合がある。**
  今回、'caution'側の優先度繰り上げを外せばaggregate指標（avgScore・avgMoneyEarned等）は
  大幅に改善したが、008finalが最も重視していた具体的な検証シナリオ（P01 seed301の死亡回避）が
  壊れた。数値の平均だけでなく、過去に確立した具体的な検証結果（特定シードでの生死）が変更後も
  維持されるかを必ず個別に確認すべきである
- **原因の切り分けには、機能を丸ごと無効化する診断実行が効果的。** `priorityFor`を強制的にbaseへ
  固定する一時的な変更で「優先度繰り上げが主因か、撤退判断が主因か」を素早く特定できた。今後も
  複数のメカニズムが絡む挙動変化を調査する際は、各メカニズムを個別にON/OFFする診断実行を先に行う
  ことを標準手順にすべき
- **適応型戦略は「期待値としてのリスク低減」であり、個別シードでの安全を保証しない。** 20シード
  集計での死亡率は改善しても、特定のシードでは固定戦略の方が良い結果になることがある
  （seed302のmining-first-adaptive vs mining-first）。これは適応ロジックの欠陥ではなく、
  「危険信号に反応して行動を変える」という設計そのものの確率的な性質であり、実プレイヤー向けの
  UIヒントを評価する際も「平均は改善するが、特定の場面では効果が裏目に出ることもある」という
  前提で評価すべき
