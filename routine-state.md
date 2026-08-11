# ルーチン状態管理

自動ルーチン（docs/routine.md）が毎回読み書きするファイル。**実行開始時に必ず読むこと。**

## 現在位置

- サイクル: 13
- 要素: Capacitor移植の後段（`npx cap add android`によるネイティブプラットフォーム雛形生成）。
  サイクル12（4回）でタッチ入力レイヤーの実装・検証が完了し（cycle12-final参照）、
  cycle11-v2が定義した2段階計画（タッチ入力レイヤー追加→ネイティブビルド）の前段が完了した
  ため、次は後段に着手する。新規ゲーム番号は切らず、games/008-flagship-frontierholdを
  そのまま対象にする
- 次に行う回: **1回目（BUILD+REVIEW）。`npx cap add android`でAndroidプラットフォーム
  フォルダの雛形のみを生成する（実機ビルド・Gradleビルドの実行・ストア申請は本自動ルーチンの
  実行環境では検証不能なため引き続きスコープ外と明記する）。`npm run build`の成果物
  （`dist/`）が`capacitor.config.ts`の`webDir`設定と整合し、`npx cap sync`がエラーなく
  完了することを確認する。もしこの自動実行環境（Node/npm限定、Android SDK等の重量級
  ツールチェーン不在）で失敗する場合は、無理に進めず「雛形生成コマンド自体がローカル環境の
  前提を必要とする」ことを記録した上で、代わりにspec.mdへ実機ビルド手順書（人間が後で実行する
  チェックリスト）を書く方向へ切り替えること**
- 対象ゲーム番号: 008-flagship-frontierhold（継続）

## 過去のサイクル12（完了・アーカイブ）

- サイクル: 12
- 要素: 本命ゲームの磨き上げ継続（新規ゲーム番号は切らず、games/008-flagship-frontierholdを
  そのまま対象にする）。サイクル12・2回目（FIX+REVIEW、reviews/008-flagship-frontierhold-
  cycle12-v2.md参照）では、cycle12-v1の残課題（実機・可視ブラウザでの見た目確認）に対応するため
  `screenshot`取得を再度試みたが、本自動ルーチンはユーザー不在で実行されるためBrowser paneが
  表示されず今回も失敗した。加えて`computer`ツールの`ref`指定クリックも、エラーは返らないが
  実際にはDOMへイベントが届かない（グローバルpointerdown/click/pointerupリスナーのカウントが
  実行後も0のまま、かつ購入可能な状態でのクリックでも所持金・maxCapacityが変化しないことで
  実測確認）ことを新たに発見した。この制約はユーザー不在の自動実行では構造的に回避不可能と
  判断し、代わりにDOM実測（`getBoundingClientRect`でのジオメトリ解析）を「見た目」検証の
  代替手段として採用した。この手法で2件の実害あるバグを発見・修正: (1) `index.html`のcanvasが
  固定384×600px表示で画面幅375px以下の端末ではD-pad/ボタンの一部がはみ出しうる問題を、
  `max-width`/`max-height`＋`width:auto`/`height:auto`によるアスペクト比維持のレスポンシブ
  CSSで解消（内部解像度は不変）。(2) 上記の縮小により極端な横向き画面（スマホの横持ち等）では
  D-padとアクションボタンが算術的に重なることを発見し、重なりを毎tick検出して警告する
  オーバーレイを`src/render/touchInput.ts`に追加。あわせてspec.mdの見出し誤記
  （「ランドスケープ固定」は実際のcanvas縦横比（384×600、縦長）と矛盾しており「ポートレート固定」
  が正しい）も訂正し、「横向きは正式サポートしない」旨をスコープ外として明記した。
  `src/core/game.ts`は無変更。npm run build / npm run simulateとも成功、17戦略×5シードの
  全指標がcycle12-v1と完全一致（コアロジック無傷）を確認。修正版のショップ購入をsynthetic
  PointerEvent（javascript_toolでの直接dispatch）で再検証し、money25→10・maxCapacity20→25で
  正常動作を確認。両ペルソナの再評価はコアゲームプレイ部分は無変更のため差分なし、タッチ層の
  新規変更点（レスポンシブ化・重なり警告）についてP01=A2「見えないコストの解消」・
  P02=A9「ちゃんとしてる一貫性」の観点で肯定的に評価した。判定はFIX。games/README.mdの状態列を
  更新し、package.jsonのversionを0.9.1へ更新した。残課題: 実機の指ドラッグの触感
  （レイテンシ・誤タップ率）はユーザー不在の自動実行という構造的制約により引き続き未検証
  （次回以降も同じ制約に直面する可能性が高い。ユーザーが対話的にセッションを開いている場合の
  み解消できる）
- サイクル12・3回目（FIX only）では、cycle12-v2のバグ・問題リスト#3（実機の指ドラッグの触感）は
  引き続き構造的制約（ユーザー不在の自動実行ではBrowser paneが不可視でscreenshot/computerツールの
  実入力が機能しない）により対応不可と記録した。それ以外は`src/render/touchInput.ts`のコード
  レビューで新規の軽微バグを1件発見・修正: `TouchInput.update()`が横向き重なり警告オーバーレイ
  （`rotateOverlay`）の表示可否を`state.over`（ゲームオーバー中か）を考慮せず毎tick判定していた
  ため、狭い横向き画面でゲームオーバーになった場合「タップでリスタート」がDOM順で手前に描画される
  重なり警告オーバーレイに阻まれて反応しなくなる詰みが起こり得た。`!state.over && this.
  dpadOverlapsButtons()`に修正し、ゲームオーバー時はリスタート操作を優先するようにした。重なり
  検出自体は狭い横向きビューポート（812×375）でのDOM実測（`rotateDisplay`が`flex`）で動作を
  再確認したが、`state.over`側のゲーティングは`__AIP__.getState()`がライブ参照ではなくコピーを
  返す実装のためAIP経由でゲームオーバーを人為的に発生させてのDOM実証はできず、コードレビューでの
  正当性確認にとどめた（単純な論理積の追加のため妥当と判断）。`src/core/game.ts`は無変更、
  `npm run build`/`npm run simulate`とも成功し17戦略×5シードの全指標がcycle12-v2と完全一致
  （コアロジック無傷）。3回目FIX onlyの規約通りレビューは書かず、spec.mdに追記した
- 次に行う回: **4回目（FINAL REVIEW）。games/008-flagship-frontierhold/reviews/
  008-flagship-frontierhold-cycle12-final.mdを作成し、サイクル12全体（タッチ入力レイヤーの
  新規実装・レスポンシブ化と重なり警告・リスタート競合の解消）を総括すること。実機の指ドラッグの
  触感確認はユーザー不在の自動実行という構造的制約により、サイクル12を通じて未解決のまま残った
  旨を明記し、次サイクル（サイクル13）の方向性を提案すること**
- 対象ゲーム番号: 008-flagship-frontierhold（継続）

## 実行履歴

| 日時 | サイクル | 回 | 作業内容 | PR |
|---|---|---|---|---|
| 2026-07-11 | 1 | 1（BUILD+REVIEW） | 002-combat-ironring（ウェーブ制アリーナ戦闘＋強化ドラフト）を新規実装。開発中に敵AIの循環ループ softlock を検出しBFS経路探索へ修正。simulate/ブラウザAIP両方でP01/P02評価しv1レビュー作成。判定FIX（同時湧き上限がプレイヤー防御に対し過大で全シード死亡、スキル発動条件が狭すぎる等） | (このコミットのPR) |
| 2026-07-11 | 1 | 2（FIX+REVIEW） | v1指摘（致命・重大）を修正: 同時湧き上限を全ウェーブ-1体、プレイヤーHP/攻撃力/攻撃速度を強化、旋風斬りCD短縮＋スキル使用回数の計測を追加。simulate/ブラウザAIPで再評価しv2レビュー作成。判定FIX（生存ウェーブ・スキル発動とも改善したが、棒立ちがactiveより成績が良い新規の逆転現象を発見、v3で対応） | (本PR) |
| 2026-07-11 | 1 | 3（FIX only） | v2指摘（重大・新規）の棒立ち>active逆転現象を修正: 敵の移動先をプレイヤー隣接4マスの「囲みスロット」へ分散割り当てし、同一経路への渋滞（実質1体ずつしか同時接敵できない状態）を解消。あわせてプレイヤーに「移動直後2tickの被ダメージ-15%」を付与し能動的な位置取りへ誘因を付与。この2つの修正で1シードが被ダメージほぼ無しの無限スノーボール（wave19到達もゲーム終了せず）を起こしたため、ウェーブ6以降の敵HP/攻撃力に線形倍率（wave-5を超えた分に0.35/wave）を追加し対処。結果、20シード比較でavgWaves passive3.4/active3.2・avgScore passive809/active768と、v2のpassive3.0>active2.3（大差）からほぼ互角に改善。npm run build / npm run simulate とも正常終了、全シード death=100%維持（無限化なし） | (本PR) |
| 2026-07-12 | 1 | 4（FINAL REVIEW） | 002-combat-ironringの総括レビュー（reviews/002-combat-ironring-final.md）を作成。20シードのヘッドレス比較でv2の逆転現象（passive>active）解消を再確認（passive avgScore809 / active768とほぼ互角）。ブラウザAIPでP01/P02各5シード評価（v1/v2は1シードのみだったが、今回はシード依存のブレを見るため分布も確認）。判定はFIX相当で完成、ただし「強化選択が2〜3回で終わりビルド差を検証できない」点は積み残し。本命ゲームへの採用案（移動インセンティブ・敵後半スケーリング・AoE発動条件の広さ）と次サイクル（採掘）への提案を明記。games/README.mdの状態列を更新し、サイクル2（採掘）run1へ進めた | (本PR) |
| 2026-07-12 | 2 | 1（BUILD+REVIEW） | 003-mining-deepvein（縦シャフト採掘×常設ショップの経済ループ）を新規実装。002finalの提案（経済ループを主役に・移動インセンティブ・強化5〜6回の下限保証・深さスケーリングの明記）を仕様に反映。shallow/diver比較（002final推奨手法）で10シードのヘッドレスシミュレーションとP01/P02のブラウザAIPプレイを実施。判定FIX、ただし致命バグ2件を発見: (1)ドリル威力ゲート内側のtier0タイルを掘り尽くすと収入源が尽きて詰みに近い停滞に陥る、(2)残燃料25%での帰還閾値が実際の帰還距離を考慮せず燃料切れ時のHPドレインでほぼ確実に死亡する（fuelEmptyTicksがほぼ一律34=102ダメージ）。両方ともv2で最優先修正予定 | (本PR) |
| 2026-07-12 | 2 | 2（FIX+REVIEW） | v1指摘の致命バグ2件を修正: (1)岩・ガス溜まりの要求ドリル威力をTIER0（土・銅鉱石）と同値の`1+floor(band/2)`に緩和し掘り尽くし詰みを構造的に解消、(2)GameStateに`player.estFuelToReturn`（既に掘った床経由のBFS帰還距離×燃料消費率）を追加してAIP/simulateから帰還判断に使えるようにし、燃料0時のHPダメージも3→1.5/tickへ緩和。simulate.tsのbotとHUDを新フィールドに対応。10シードのshallow/diver比較で死亡0/20・停滞0/20（v1は死亡13/20・停滞7/20）を確認し、diverがshallowよりavgScore+19%・avgMoneyEarned+32%と明確に優位（バグの影響を受けない測定に初めて成功）。ブラウザAIPのP01/P02プレイでも両者ともmaxDepth40・購入3回まで到達し、v1で機能停止していたコアファン仮説を体感できることを確認。npm run build / npm run simulateとも正常終了。残課題（購入回数が目標5〜6回に未達、平均2.7〜3.4回）はv2レビューに記載しv3(3回目FIX only)へ持ち越し | (本PR) |
| 2026-07-12 | 2 | 3（FIX only） | v2指摘#3（ショップ購入回数が目標5〜6回に対しshallow2.7回・diver3.4回と未達）を修正: ドリル威力ゲートは変更せず経済側パラメータ（鉱石基礎価値）を引き上げて1トリップあたりの稼ぎを底上げした。約1.45倍・約1.33倍を試したところdiver戦略の一部シードで「稼ぎ加速→急速な深部到達→危険耐性強化を買う前に危険タイル多数被弾で死亡」という新規のスノーボール型死亡（v2までは死亡0/20だった）を検出したため、20シード（shallow10+diver10）で死亡0を維持できる範囲として約1.2倍（銅6→7/鉄18→22/金45→54）を採用。同一10シード（1〜10）での再検証でshallow購入回数2.7→3.1回・diver3.4→4.9回に改善しつつ死亡0/20・停滞0/20を維持したことを確認（`src/core/game.ts`の`BASE_VALUE`、`specs/003-mining-deepvein/spec.md`の鉱石価値表を更新、`package.json`のversionを0.3.0へ）。npm run build / npm run simulateとも正常終了。レビューは書かず、残課題（購入回数はまだ目標未達、経済パラメータのさらなる調整とbot戦略側のhazardresist優先度見直しが候補）はv4（FINAL REVIEW）へ持ち越し | (本PR) |
| 2026-07-13 | 2 | 4（FINAL REVIEW） | 003-mining-deepveinの総括レビュー（reviews/003-mining-deepvein-final.md）を作成。ヘッドレスは20シード（shallow/diver各20）に拡大し死亡0/20・停滞0/20を再確認、diverがshallow比avgScore+40%・avgMoneyEarned+62%と明確に優位。ブラウザAIPでは従来の「既に掘った床を無条件優先」する検証botの欠陥（隣の未採掘鉱石を素通りして既知のトンネルを往復する）を発見して修正し、P01（ドリル威力優先、seed301）は1181tickで購入20回・稼得金1725に達したが危険耐性を後回しにしたため8回被弾の蓄積で死亡、P02（HP/危険耐性優先、seed302）は同程度の9回被弾を受けながらもHP94/125を保ち8000tick生存——同じ被弾数でもビルド次第で生死が分かれることを確認し、002最終レビューで積み残しだった「強化選択の分岐が結果に大差を生まない」課題をこのゲームでは解決できたと判定。ショップ購入回数の目標未達（v2/v3の指摘）は経済パラメータの問題というより検証bot側の探索精度の問題だったと再評価し、追加の経済調整は不要と判断。判定はFIX完了・本命ゲーム採用を推奨。games/README.mdを更新し、サイクル3（建築）run1へ進めた | (本PR) |
| 2026-07-13 | 3 | 1（BUILD+REVIEW） | 004-building-skyspire（側面視・積み上げ塔ビルダー。stressRatio常時公開＋brace/stabilizerによる補強設計、敵なしで揺れ・風・自重のみで緊張を作る）を新規実装。003finalの提案（安全マージンの数値公開パターン踏襲、常設ショップ踏襲、敵なしで地形・構造制約だけの難易度設計）を仕様に反映。実装中に「単一支持経路の木構造モデルでは目標高度40がどの資材でも構造的に到達不可能」という致命的なバランス崩壊をヘッドレスシミュレーションで検出し、braceの効果を「自重20%軽減」から「下へ伝える荷重40%肩代わり」へ変更、初期所持金50→90、マイルストーン間隔5→3高度、目標高度40→15へその場で応急調整（詳細はspec.mdの「実装中に判明したバランス調整」節）。それでもcareful戦略（brace併用の設計重視botで10シード）はavgスコア138.5・平均到達高度11で頭打ちとなり目標未達、reckless戦略（wood直進bot）は全シード134tickで死亡というcareful優位の明確な差は確認できた。ブラウザAIPでP01/P02それぞれ3600tickフルシミュレーションを実施し、両者とも「1回の大崩落から残り時間の97%停滞から回復できない」という重大な問題を確認。判定FIX、目標高度の構造的な到達不可能性と崩落後の復帰導線の弱さをv2で最優先修正予定 | (本PR) |
| 2026-07-13 | 3 | 2（FIX+REVIEW） | v1指摘の致命・重大バグを修正: (1)braceの効果範囲を隣接1マス→チェビシェフ距離2マスへ拡張しBRACE_FACTORを0.6→0.5へ強化（`BRACE_RADIUS`導入）。地上往復でbrace在庫が一時的に切れても等比減衰が途切れなくなり、目標高度をv1の緊急値15からオリジナル仕様の40へ復元。(2)直近マイルストーン高度（3）以下のブロックを過負荷崩落から永続的に保護する`foundationHeight`を追加。保護範囲を「直近到達高度」に連動させる実装を最初に試したところ塔全体が崩落免除になり構造リスクが消える致命的な過剰修正をヘッドレスシミュレーションで検出し、最初のマイルストーン（高さ3）固定に修正。(3)崩落後、重力判定が「1つ下にブロックがあれば接地」も認めていたため生き残った最上段の直上の空きマスで静止し`place up`の着地先が1段ズレて無限にinvalid actionを出す個体を検出・修正（接地判定を「同じセルにブロックがある、または地面」のみに単純化）。結果、careful戦略が20/20シードで崩落ゼロ・tick441（制限時間の約12%）で目標高度40をクリア、reckless戦略は引き続き20/20シードで死亡し狙い通りの差を維持。ブラウザAIPでP01(seed301)がヘッドレスと同一結果でクリアを確認、P02(seed302, brace無視のstoneのみ戦略)は新規パターンとして「所持金・資材ともに0で回収可能なスクラップも無い完全な経済的詰み」に高さ7で陥ることを発見（invalidActionsは6のみで無限ループではなく、単に打つ手がない状態）。reviews/004-building-skyspire-v2.md作成、判定FIX。games/README.mdの状態列を更新 | (本PR) |
| 2026-07-13 | 3 | 3（FIX only） | v2指摘#1（重大・新規、brace無視のstoneのみ「そこそこ雑」プレイが崩落を繰り返した末に所持金・資材・回収可能スクラップすべて0の完全な経済的詰みに陥る）を修正: 地上(y=0)滞在が`LABOR_INCOME_INTERVAL`(=15)tickに達するたび`LABOR_INCOME_AMOUNT`(=1)の所持金を得る最低限の労働収入を`src/core/game.ts`に追加。滞在は連続でなくてもよく積算されるため、どれだけ資材・所持金が尽きても時間をかければ必ず復帰できる。検証のため`headless/simulate.ts`にv2でブラウザAIPが発見した挙動（brace/stabilizer不使用でstoneのみ購入）を再現する`sloppy`戦略を新規追加し、修正前はmoneyEarned=137/blocksPlaced=25/collapseEvents=4のまま20シード全てtick200から3600まで完全凍結することを確認したうえで、修正後は同条件でmoneyEarned=176/blocksPlaced=29/collapseEvents=5まで活動が継続し（高さ7の頭打ち自体はbrace不使用という設計上の制約どおりで意図通り）死亡0/20・完全凍結なしを確認した。careful/reckless戦略への影響は誤差程度（careful avgScore904→906・height40クリア20/20維持、reckless avgScore-4→-3・死亡20/20維持）。npm run build / npm run simulateとも正常終了。package.jsonのversionを0.3.0へ、spec.mdに労働収入パラメータとv3修正内容を追記、games/README.mdの状態列を更新。レビューは書かず（3回目FIX onlyの規約通り）、v2の軽微指摘（careful到達が441tickと速すぎる、目標到達後の継続目標が無い）はfinal（次回）へ持ち越し | (本PR) |
| 2026-07-14 | 3 | 4（FINAL REVIEW） | 004-building-skyspireの総括レビュー（reviews/004-building-skyspire-final.md）を作成。20シードのヘッドレス比較でcareful20/20クリア（崩落0）・reckless20/20死亡・sloppy20/20死亡0（高さ7で頭打ちだが完全凍結なし）を再確認し、v3のLABOR_INCOME修正が意図通り機能し続けていることを定量確認。ブラウザAIPでP01(careful, seed301)/P02(sloppy, seed302)をフルセッション実行し、ヘッドレスと完全一致する結果（P02はfinalHp42/100で3600tick生存、money=5で完全凍結なし）を確認。判定はFIX完了・本命ゲーム採用を推奨、ただし「carefulが制限時間の12%(442tick)でクリアしてしまい稼いだ金の36%が使い道なく余る」というv2からの積み残しが3回のFIXを経ても未解消のまま終わったことを明記。003に続き「安全マージン数値公開／常設ショップ／固定範囲の保護装置／詰みからの脱出手段」という本命ゲームの共通基盤パターンを確認。次サイクルの提案として、002(戦闘)の残課題（強化選択の分岐が結果に大差を生まない）を003(採掘)で実証済みの経済パターンで解消する狙いで「戦闘×採掘の組み合わせ試作」を提案し、routine-state.mdをサイクル4・run1へ進めた。games/README.mdの状態列を更新。screenshot取得は6サイクル連続タイムアウト（既知の環境制約） | (本PR) |
| 2026-07-14 | 4 | 1（BUILD+REVIEW） | 005-combat-mining-ironvein（縦シャフト採掘×リアルタイム近接戦闘の組み合わせ。掘削音が敵の湧きを誘発し、稼いだ金で採掘/戦闘の常設ショップを両方強化する構成）を新規実装。004最終レビューの提案（安全マージン数値公開・常設複数カテゴリショップ・固定範囲の保護装置・詰みからの脱出手段・移動インセンティブの5点を最初から仕様に織り込む、単一ゴール即終了を避ける）をspecに反映し、環境ハザード（ガス・崩落）は敵と役割重複するため今回は不採用とした。実装中にヘッドレスシミュレーションで「HP危険域かつ無一文でtripsToSurfaceが数千回に達する無限退避ループ」という致命的softlockを検出し、地上滞在中のHP自動回復(+1/tick)を追加して大半のケースを解消。続けて敵湧き上限・湧き確率を1段階引き下げる調整も実施（詳細はspec.mdの「実装中に判明したバランス調整」節）。mining-first/combat-first/balancedの3ショップ優先度戦略×10シードのヘッドレス比較で、combat-firstが全10シードでmaxDepthちょうど40（drill未投資によるband境界の壁）に張り付き、mining-firstは死亡率9/10と対照的な「押し戻され方」の違いを確認し、コアファン仮説（採掘と戦闘への投資の悩ましさ）の方向性を検証。ブラウザAIPでP01(seed301,efficiency優先)/P02(seed302,安全優先)を6000tickプレイし、P02は完走(HP127/140)したがdepth39で頭打ち、P01はdepth40で消耗死という一貫した傾向を確認。skillUsesが全30ヘッドレスランで0（範囲攻撃が経済的に選ばれず機能未検証）、退路チョークポイントでの消耗死残存（balanced seed9でtripsToSurface=3522の異常値）を重大バグとして検出しreviews/005-combat-mining-ironvein-v1.mdに記載。判定FIX、v2で死亡率過多・skill不到達・チョークポイント詰みの3点を最優先修正予定 | (本PR) |
| 2026-07-14 | 4 | 2（FIX+REVIEW） | v1指摘の重大バグ3件・中1件に対応。(1)チョークポイント詰み: 「緊急離脱(dash)」を新規実装（発動後3tick敵をすり抜け移動でき無敵、HPコスト12・CD50tick、購入不要で常時使用可）。数値の安全マージン公開だけでは経路そのものの物理的封鎖を防げないため構造的な脱出手段として追加。(2)skillUses=0: shop価格引き下げ(baseCost40→25)に加え、ボットの「優先度リスト先頭を買い切ってから次へ」という購入方式自体が原因だったため「skillLv1だけは買えるようになり次第、通常優先度より先に確保する」特別ロジックをボットに追加。さらに調査の結果、1マス幅の縦シャフトでは複数同時接敵(adjCount>=2)が構造的にほぼ発生しないことが判明したため、skillの役割を「複数同時接敵の保険」から「単体でもatk以上の価値を持つ一手」へ再設計（ダメージ12→16・CD20→16、ボットの発動条件もadjCount>=1へ変更）。(3)死亡率過多: 地上HP回復を1/tick→3/tickへ引き上げ。上記(1)(2)と合わせて20シード比較で死亡率が50〜90%(v1)から0〜10%(v2)へ改善。(4)combat-firstのmaxDepth=40の壁は再確認のみ実施し、20シード全てで再現・意図通りと判断し変更せず。ブラウザAIPでP01/P02を6000tick再プレイし、v1ではP01が消耗死・P02もHP127/140だったのに対しv2ではP01が最終HP90/100・P02が最終HP160/160（満タン）で完走し、skillUsesも両者とも13回発生する（v1は0回）ことを確認。dash使用は今回のセッションでは発生せず（チョークポイント自体が稀な現象のため）。npm run build / npm run simulateとも正常終了。reviews/005-combat-mining-ironvein-v2.md作成、判定FIX。package.jsonのversionを0.2.0へ、spec.mdにv2 FIX内容を追記、games/README.mdの状態列を更新。drillへの投資インセンティブが弱く両ペルソナともmaxDepth40の壁を超えられない軽微な課題が残存し、3回目（FIX only）または後続へ持ち越し | (本PR) |
| 2026-07-14 | 4 | 3（FIX only） | v2指摘#2（軽微、mining-first/balanced seed9で帰還閾値付近のHP回復→即再潜行を細かく繰り返す「往復のヒステリシス欠如」、tripsToSurface3373・800）を修正: `headless/simulate.ts`のボットに帰還判断のヒステリシスを追加。低HP(<=25%maxHp)が理由で帰還した場合のみ`awaitingHeal`フラグを立て、地上でHPが60%maxHpへ回復するまで再潜行しない（燃料切れ・満載での帰還はHPに問題がないため即再潜行のまま）。20シード再検証でseed9のtripsToSurfaceがmining-first 3373→125・balanced 800→144へ大幅改善し、死亡率・avgScore・avgMaxDepth等の他指標はgame.ts無変更のためv2と完全一致（死亡率5%/0%/0%を維持）。v2指摘#1（軽微、drill投資インセンティブの弱さ）にも着手し、「採掘威力不足でも掘削は可能・不足分は時間コストで表現する」漸進的な壁への変更を試作したが、20シード比較でavgMaxDepthが全戦略で悪化（例: mining-first 54.1→35.8）する予期しない回帰を検出。原因を調査したところ、(a)掘削中の被弾・帰還で中断すると`p.digging`の進捗がリセットされ同じタイルを最初からやり直す仕様と、(b)不足時のペナルティが指数的（最大27倍）で高コストな組み合わせがあり、両者が重なると「同じタイルへの掘削を繰り返し試みるが燃料切れで毎回中断し完了しない」という新種のソフトロック相当のリスクを`headless/debug-drill.ts`（検証用一時スクリプト、コミット前に削除済み）で確認したため、この変更は今回見送り一旦`src/core/game.ts`を元の実装へ完全に戻した（ハードウォールのまま）。npm run build / npm run simulateとも正常終了。レビューは書かず（3回目FIX onlyの規約通り）、drill投資インセンティブの対応方針（進捗保持の実装 or 壁自体の撤廃 or 現状維持）はfinal（次回）で判断すること | (本PR) |
| 2026-07-15 | 4 | 4（FINAL REVIEW） | 005-combat-mining-ironveinの総括レビュー（reviews/005-combat-mining-ironvein-final.md）を作成。20シードのヘッドレス再検証で死亡率がv2の10%/0%/0%からさらに5%/0%/0%へ改善（v2で死亡していたmining-first seed19が生存に転じた。ゲームロジック自体は不変なのでv3のボット帰還ヒステリシスの副次効果と分析）。seed9のチョークポイント指標（tripsToSurface）もv3の狙い通りmining-first125・balanced144を維持していることを再確認。ブラウザAIPでP01(seed301)/P02(seed302)を6000tickフルセッション実行し、v1・v2と完全に同一の結果（P01 finalHp90/100、P02 finalHp160/160、両者ともmaxDepth40・skillUses13）が出ることを確認しv3の変更が回帰を生んでいないことを裏付けた。判定はFIX完了・本命ゲーム採用を推奨。「常時使用可能な緊急離脱（dash）」を003のestFuelToReturn・004のfoundationHeightに続く第5の共通成功パターンとして確立したと総括する一方、drill投資インセンティブの弱さ（3回のFIXを経ても未解消）と「進行を止める壁を他の項目と同列優先度で並べる設計」が002〜005の4要素連続で再発した根本課題である点を明記。次サイクルは「戦闘×採掘×建築の三要素統合」（004で確立した建築システムをironveinのループへ追加し、本命ゲームへの最終統合ステップとする）を提案。games/README.mdの状態列を更新し、routine-state.mdをサイクル5・run1へ進めた | (本PR) |
| 2026-07-15 | 5 | 1（BUILD+REVIEW） | 006-combat-mining-building-ironkeep（005-combat-mining-ironveinの最終確定バランスをベースに、支保工(PROP)による建築要素を追加）を新規実装。005最終レビューの提案（005のコアループへ建築を追加、drill投資インセンティブの弱さを建築による迂回手段で構造的に解決、「進行を止める壁」問題を実装前に設計判断として解決する）をspecに反映。支保工は1種類のみ（最小構成方針）で、未採掘タイルに設置すれば採掘威力不要の「迂回橋」（鉱石だった場合は価値を失う）、既に掘った床に設置すれば敵の経路を塞ぐ「バリケード」になる二用途設計とし、新規ショップカテゴリengineering（工兵術、設置コスト低減＋耐久値上昇）を追加した。ヘッドレスシミュレーション実装中に「ボットの方向優先度ロジックが横移動・後退を迂回橋より先に試すため迂回橋が一度も使われない(avgBridges=0.0)」バグを検出し、各方向ごとに移動/掘削/建築を全て試してから次の方向へ進む構成へ修正して解消。005の3戦略に加え、迂回橋の機能検証用に新戦略bridge-reliant（drill非投資・現金温存）を追加し、20シード比較でdrill投資ゼロのbridge-reliant(avgMaxDepth42.3)がdrill投資ありのmining-first(42.8)と遜色ない深さに到達することを確認（コアファン仮説の定量的裏付け）。ブラウザAIPでP01(seed301)/P02(seed302)を6000tickプレイし、P02はdrillPower1のまま迂回橋2回でmaxDepth42に到達（P01のmaxDepth43とほぼ同等）。死亡は全80ラン(20シード×4戦略)で0件、両ペルソナのブラウザセッションも死亡せず完走という005から継承した安全側バランスを確認。バリケードは全戦略・両ペルソナで設置されるが「決定的な救済」と呼べる場面は未検出という軽微な課題、および死亡率0%で新要素の必要性が検証しづらいという中程度の課題をreviews/006-combat-mining-building-ironkeep-v1.mdに記載。判定FIX、v2で死亡率（安全すぎるバランス）・バリケードの効果の弱さ・drill投資インセンティブの再検証を優先修正予定 | (本PR) |
| 2026-07-15 | 5 | 2（FIX+REVIEW） | v1指摘#2〜#4に対応（#1は実装中に検出・修正済みのため対象外）。(1)死亡率0%対策: 地上HP回復3→2/tick、
敵湧き確率基礎値0.003→0.0042、湧き頻度の深さ倍率`1+band×0.35`→`1+band×0.5`、敵HP/ATKの深さ倍率`1+band×0.2`→`1+band×0.25`、
同時湧き上限`min(2+floor(band/3),6)`→`min(2+floor(band/2),8)`に調整し、20シード×4戦略の死亡が0/80→2/80（mining-first集中）へ、
dashUsesも0.0→最大0.9へ変化（初めて実際に使われた）。(2)バリケードのdecisiveness検証: コード変更ではなく、バリケード建築を
無効化した検証用ボット（headless/debug-nobarricade.ts、検証後に削除済み）とのA/Bテストで、mining-first戦略の死亡が
2/20→8/20（バリケードが6シードの死亡を防いだ）ことを定量確認し、v1指摘「決定的な救済と言えるか不明」を解消と判断。
(3)迂回橋コスト: BRIDGE_BASE_COST 10→12・BRIDGE_TIER_COST 6→7・BRIDGE_BAND_COST 2→4に引き上げ、bridge-reliant戦略の
avgMaxDepthがmining-first比-3.4（40.5 vs 43.9）・avgUpgradesBought-2.6（2.9 vs 5.5）となり「迂回橋は使えるが正攻法の方が
効率的」という設計意図を数値で裏付けた（死亡0/20は維持、コアファン仮説は健在）。ブラウザAIPでP01(seed301)/P02(seed302)を
6000tick再プレイし、両者とも死亡なし完走。P02はtick482・depth38でバリケードを1回使用し敵に破壊される場面を確認（v1は
バリケード使用0回）、P01はv1より到達深度がやや浅く(43→39)なり難易度上昇を反映。npm run build / npm run simulateとも
正常終了。reviews/006-combat-mining-building-ironkeep-v2.md作成、判定FIX。package.jsonのversionを0.2.0へ、spec.mdに
v2バランス調整表を追記、games/README.mdの状態列を更新。残課題（P01のようなefficiency優先プレイでは新要素の使用機会が
依然少ない、死亡がmining-first戦略に偏っている）は軽微でありコアファン仮説の検証は完了しているため、3回目または
final（次回）で総合判断すること | (本PR) |
| 2026-07-15 | 5 | 3（FIX only） | v2指摘（軽微2件）の対応可否を検証。(1)efficiency優先プレイで迂回橋・バリケードの使用機会が
少ない件は、`BUILD_COOLDOWN=10tick`が`digTicksFor`（土2〜金6tick、採掘威力が要求値以上なら短縮）を常に上回るため
「採掘威力が足りている限り迂回橋は掘るより遅く有料」という構造そのものが原因と判明し、「迂回橋はdrill投資の
代替（保険）であり近道ではない」という設計意図どおりの挙動と判断。20シード再検証でもavgBridgesがdrill非投資の
bridge-reliant戦略1.8、drill投資する他3戦略0.1〜0.7と設計意図どおりに相関することを確認した。(2)死亡がmining-first
戦略に偏っている件は、v2のA/Bテスト（バリケード無効化で該当戦略のみ死亡2/20→8/20）で既に「バリケードが
mining-first戦略に対して保険として機能している」ことを確認済みであり、死亡の偏り自体がバリケードの必要性の
証左であるため、均そうとする調整はバリケードの存在意義を薄める方向に働くと判断し見送った。結論として
`src/core/game.ts`・`headless/simulate.ts`ともに変更なし。`npm run build`/`npm run simulate`（20シード×4戦略）で
v2と完全に同一の結果（死亡2/80、avgBridges/avgBarricades等すべて一致）が再現することを確認し、判断根拠を
specs/006-combat-mining-building-ironkeep/spec.mdに「v3で検討し、変更を見送った項目」として追記した。レビューは
書かず（3回目FIX onlyの規約通り）、両指摘とも解消済みとしてfinal（次回）へ引き継ぐ | (本PR) |
| 2026-07-16 | 5 | 4（FINAL REVIEW） | 006-combat-mining-building-ironkeepの総括レビュー（reviews/006-combat-mining-building-ironkeep-final.md）を作成。20シード×4戦略のヘッドレス再検証でv2・v3と完全に同一の結果（死亡2/80、avgBridges/avgMaxDepth等すべて一致）を再確認し、v3以降ソースコード無変更であることを裏付けた。bridge-reliant戦略（drill投資ゼロ）がavgMaxDepth40.5でmining-first(43.9)と遜色ない深さに到達し続けており、迂回橋のコアファン仮説が5回の検証を通じて一貫して成立していることを確認。ブラウザAIPでP01(seed301)/P02(seed302)を6000tickフルセッション実行し、両者とも死亡せず完走（P01 finalHp84/100・maxDepth39、P02 finalHp143/160・maxDepth40）、P02は今回バリケードを帰路（depth4）で使用する新しいパターンを確認した。判定はFIX完了・本命ゲーム採用を推奨。002〜005で確立した5つの共通パターン（常設ショップ・安全マージン数値公開・固定範囲保護・詰みからの脱出手段・緊急離脱dash）に加え「建築を第三の選択肢にする（迂回橋・バリケード）」を第6のパターンとして確立したと総括する一方、005から持ち越されたP02のA6課題（maxDepth40の壁到達後に次の目標が生まれない）は006でも未解消のまま残ったことを明記。次サイクルの提案として「深部拠点（前線基地）による目標の再生成」を最優先課題とする007-combat-mining-building-outpost（暫定名）を提案し、routine-state.mdをサイクル6・run1へ進めた。games/README.mdの状態列を更新。screenshot取得は9サイクル連続タイムアウト（既知の環境制約） | (本PR) |
| 2026-07-16 | 6 | 1（BUILD+REVIEW） | 007-combat-mining-building-outpost（006-combat-mining-building-ironkeepの最終確定バランスをベースに、前線基地(OUTPOST)による「目標再生成」システムを新規追加）を新規実装。006最終レビューの提案（深部拠点/前線基地を最優先課題とすること）をspecに反映し、前線基地は「直前の基地から一定深さ(OUTPOST_MIN_GAP=25マス)以上進み、かつ建設費用を払えば、現在地が新しい地上（帰還先・ショップ・回復地点）になる」1種類のみの最小構成とした。実装中にヘッドレスシミュレーションで、初期仮説値OUTPOST_BASE_COST=150がこの経済規模（20000tick全体の総稼得金70〜120程度）に対し過大で、ボットが「建設費用を貯めるために通常購入を全停止→成長が止まり収入も伸びない」という貧困の罠に陥り全戦略でavgOutposts=avgUpgradesBought=0に固着する致命的なバランス崩壊を検出し、コストを150→50へ引き下げ、ボットの貯蓄ロジックも「コストの4割貯まってから予約」というヒステリシス方式へその場で応急修正した（詳細はspec.mdの「実装中に判明したバランス調整」節）。それでも20シード×5戦略（006由来の4戦略+A/B比較用のbalanced-no-outpost）のヘッドレス比較で、前線基地を実際に活用できたmining-first/balancedはavgMaxDepthが58.3/56.5(no-outpost対照群39.9比+42〜46%)まで伸び002〜006で一度も破れなかった「深さ40の壁」を明確に超えた一方、avgOutposts自体は最大でも0.8本と低頻度に留まり、ブラウザAIPでP01(seed301)/P02(seed302)を6000tickプレイしたところ両者とも前線基地を1本も建てられなかった（深さ条件は早期に満たすが所持金がコストの1/6程度で頭打ち）。加えてbridge-reliant戦略でavgTrips=919.8という突出値を検出し、「drillPower不足の壁の直前に前線基地を建て、以後は基地と壁の間を往復するだけで進行が完全停止する」新種の停滞パターンを確認した。reviews/007-combat-mining-building-outpost-v1.mdに記載し判定FIX、v2で建設費用のさらなる引き下げ（または収入源の追加）と壁直前建設による停滞固定化への対処を最優先修正予定 | (本PR) |
| 2026-07-17 | 6 | 2（FIX+REVIEW） | 007-combat-mining-building-outpostのv1指摘バグ#2〜#4に対応。(1)バグ#2（建設費用と経済規模の乖離）: OUTPOST_BASE_COST 50→20・OUTPOST_BAND_COST_MULT 0.35→0.15へ引き下げ、加えてheadless/simulate.tsのボット予約ロジックの実装バグ（`phase==='mine'`のときだけ予約額を再計算していたため基地到着直後の大口売却益がそのまま通常購入に溶けるバグ）を修正した。(2)バグ#3（壁直前建設による停滞固定化）: `src/core/game.ts`の`canBuildOutpost()`に「建設費用を払った後の所持金でも1つ下の行(次のband)全16列が採掘威力・迂回橋のいずれでも突破不可能な完全な壁でないか」を確認する`hasForwardProgressBelow()`を追加（理論上絶対に詰む配置を防ぐ安全網）。ボットにも同じ考え方の`wallReserve`（壁を検知したら迂回橋代を優先確保）を追加した。実装途中で「同じband内の横移動はできるが次のbandへ進めない」ケースを見落とし壁判定が機能しない不具合と、arriveAtBaseの発火条件を「新規に1タイル以上掘ってから」に制限する対策案が正当な低HP/低燃料帰還時の回復・補給まで止めてしまい死亡率が0〜20%→65〜95%へ激増する重大な副作用を招いたため撤回、という2つの試行錯誤を経て現在の実装に収束した。結果、bridge-reliant戦略の極端な事例（avgTrips919.8）は202.3まで解消したが、combat-first戦略とP02ブラウザセッションで「band境界の壁のすぐ隣を小刻みに往復する」軽度の残存パターンが見つかり、次回以降の課題として持ち越した。(3)バグ#4（死亡率上昇）: 20シード再検証で「前線基地により到達深度が伸びたことに伴う自然な難易度上昇」（1シードは最深部y=160まで到達）と確認し、変更不要と判断した。20シード×5戦略のヘッドレス比較でmining-first/balancedのavgOutpostsが0.8→1.4・avgMaxDepthが58.3/56.5→71.1/69.0まで改善したことを確認。ブラウザAIPでP01(seed301)/P02(seed302)を6000tick再プレイし、v1では両者とも前線基地0本だったのに対しv2では両者とも1本の建設に成功し（P01 finalHp100/100・P02 finalHp140/140、いずれも死亡なし完走）、コアファン仮説（前線基地が新しい目標を生む）を初めて両ペルソナで体感できたことを確認した。npm run build / npm run simulateとも正常終了。reviews/007-combat-mining-building-outpost-v2.md作成、判定FIX。package.jsonのversionを0.2.0へ、spec.mdにv2 FIX内容を追記、games/README.mdの状態列を更新。残課題（band境界の壁のすぐ隣での小刻みな往復）はv3（FIX only）または最終レビューで対応可否を判断する | (本PR) |
| 2026-07-17 | 6 | 3（FIX only） | 007-combat-mining-building-outpostのv2残課題（band境界の壁のすぐ隣で小刻みな往復を続ける軽度の停滞パターン、combat-first戦略のavgTripsが261.1→374.4に上昇・P02ブラウザセッションでtripsToSurface=269）に対応。原因はv2で追加した`wallReserve`（壁を検知したら迂回橋代を優先確保する仕組み）を`s.phase`を問わず毎tick再計算していたことで、「深部の壁で足止め→撤退して基地(shopフェーズ)に戻る」瞬間にwallReserveが基地の足元の（とっくに通行可能な）行を見て0にリセットされ、実際にブロックされている深部の壁の存在をshopフェーズ側が忘れる構造になっていたと判明（`headless/simulate.ts`のボットロジックのみが原因で、`src/core/game.ts`本体は無関係だったため変更なし）。修正: wallReserveの再計算を`s.phase==='mine'`のときだけに限定し、shopフェーズでは直前にブロックされた地点の値を保持するようにした。加えて、shopフェーズで購入するものが無く、かつ保持しているwallReserveより所持金が少ない場合は無駄に潜行して即撤退するのではなく基地でwaitして資金が貯まるのを待つよう変更した（基地滞在中はLABOR_INCOMEで資金が必ず増え続けるため待機自体は新種の停滞にならない）。20シード×5戦略のヘッドレス比較でcombat-first戦略のavgTripsが374.4→217.2（-42%）まで改善し、mining-first（158.3→145.7）・balanced（214.7→207.6）でも同様の改善を確認、avgMaxDepth・avgUpgradesBought・deaths（7/20, 0/20, 2/20, 4/20, 0/20）はいずれもほぼ変化なし（誤差程度）で新たな死亡・停滞パターンは発生しなかった。npm run build / npm run simulateとも正常終了。package.jsonのversionを0.3.0へ、spec.mdにv3 FIX内容を追記、games/README.mdの状態列を更新。レビューは書かず（3回目FIX onlyの規約通り）、final（次回）で総括すること |
| 2026-07-17 | 6 | 4（FINAL REVIEW） | 007-combat-mining-building-outpostの総括レビュー（reviews/007-combat-mining-building-outpost-final.md）を作成。20シード×5戦略のヘッドレス再検証でv2・v3と完全に同一の結果を再確認しv3以降ソースコード無変更であることを裏付けた（前線基地を活用できたmining-first/balancedがno-outpost対照群比+72〜78%のavgMaxDepthを維持）。ブラウザAIPでは`headless/simulate.ts`のv3ボットロジックをJS移植してP01(seed301)/P02(seed302)を6000tickフル実行し、両者とも死亡せず前線基地1本の建設に成功した一方、**P02セッションでtick1000〜6000（セッションの約83%）y=41のband境界の壁に固着し続ける事例を新規発見**。tripsToSurfaceはv2の269→final73へ改善したが「往復の回数が減っただけで壁を抜けられない根本原因は解消していない」ことが判明し、v2/v3で「軽度」と見積もっていたよりも実際の停滞は深刻と判定した。原因を`hasForwardProgressBelow()`が「理論上突破可能か」の二値しか見ておらず「実際にどれだけの時間で突破できるか」を無視している設計限界と診断し、ボットの近視眼的探索だけが原因ではないと結論づけた。判定はFIX完了・本命ゲーム採用を推奨としつつ、この残課題（#3）を本命ゲーム統合時の最優先対応事項として明記。games/README.mdの状態列を更新し、routine-state.mdをサイクル7・run1（本命ゲーム統合実装、新要素追加ではなく002〜007の7パターンの磨き上げ）へ進めた |
| 2026-07-18 | 7 | 1（BUILD+REVIEW） | 008-flagship-frontierhold（007-combat-mining-building-outpostのコードベースをそのまま土台にした本命ゲーム統合実装。新要素の追加は行わず、007final #3で最優先課題とされた「前線基地を壁のすぐ隣に建てると迂回橋代が貯まるまで長時間停滞する」問題の解消に着手）を新規実装。修正は2点: (1) `src/core/game.ts`の`hasForwardProgressBelow()`に、即座に突破できなくても前線基地に居座りLABOR_INCOMEで稼げば`OUTPOST_MAX_WAIT_TICKS`(400tick)以内に迂回橋代が届くかを判定する「待ち時間」の概念を追加し、それを超える配置では建設自体を拒否するようにした。(2) `headless/simulate.ts`のボットが持つ`wallReserve`（壁を検知したら迂回橋代を優先確保する仕組み）の再計算バグを修正: v3実装は壁を検知した後、撤退のため上に戻る途中でも毎tick「現在地の1つ下の行」を再評価しており、既に通行済みの浅い行を見て`wallReserve`が0にリセットされてしまっていた。壁の行を`wallRow`として明示的に記憶し、実際にその行へ到達・通過するまで保持するよう変更した。20シード×5戦略のヘッドレス比較で、002〜007を通じて一度も破れなかった「band1境界の壁」をcombat-first（avgMaxDepth41.6→70.5）・bridge-reliant（42.9→62.8、死亡4/20→0/20）が初めて明確に突破したことを確認。ブラウザAIPでP01(seed301)/P02(seed302)を6000tickプレイし、y座標の時系列トレースで007finalが検出した「y=41に固着し続ける」パターンが「潜るたびに深度が単調に伸びるサイクル」に変わったことを確認した（P01 maxDepth42→52・tripsToSurface58→29、P02 maxDepth42→56・tripsToSurface73→28、両者とも死亡なし完走）。一方で新規の中程度課題として、修正後は「迂回橋の都度払い」が効率的すぎるためP01(drill最優先設定)・P02とも6000tick終了時点でdrillLevelが0のまま変化しないことを発見し、005final以来の「drill投資インセンティブの弱さ」が形を変えて再発していると判定した。npm run build / npm run simulateとも正常終了。reviews/008-flagship-frontierhold-v1.md作成、判定FIX。games/README.mdの状態列を更新し、routine-state.mdをサイクル7・run2（FIX+REVIEW）へ進めた | (本PR) |
| 2026-07-18 | 7 | 2（FIX+REVIEW） | 008-flagship-frontierholdのv1指摘#2（中・迂回橋の都度払いがdrill投資の代替として機能しすぎ、P01/P02とも6000tickの全セッションでdrillLevelが0のまま変化しなかった）に対応。`headless/simulate.ts`の`tryBuy()`に、既存のskill初回購入特例と対になる「drill初回購入だけはwallReserve/outpostReserveを無視してよい」特例を追加した（bridge-reliant戦略はdrill非投資がA/B比較の検証対象のため対象外）。`src/core/game.ts`（ゲーム本体）は無変更。20シード×5戦略のヘッドレス比較で、drillが優先度中〜後方にあるcombat-firstが最も恩恵を受け、avgMaxDepth70.5→81.1（+15%）・avgUpgradesBought5.2→9.0（+73%）まで改善した一方、bridge-reliant・balanced-no-outpost（対照群）は完全に無変化で修正の副作用がないことを確認した。あわせてv1指摘#3（軽微・mining-first死亡率7/20→9/20）を再調査し、死亡9シード全てが深部（maxDepth57〜160）で発生していることから「到達深度に見合わない積極的すぎる潜行」という自然な難易度上昇と原因を特定、005final・006v2の前例に倣いバランス調整は見送った。ブラウザAIPでP01(seed301)/P02(seed302)を6000tick再プレイし、両者ともdrillPowerが実際に上昇（P01 1→4、P02 1→2）したことを確認した一方、P01はv1では完走していたのにv2ではdrill投資により早期に深部(depth85)へ到達した結果、atk/hp後回しの生存力不足でtick4524に死亡する新規パターンを発見した（003finalが確立した「ビルド次第で生死が分かれる」パターンの一種と解釈し致命とは判断せず）。P02は逆にmaxDepth91まで到達しながら死亡せず完走（finalHp180/180満タン）し、生存力優先ビルドの合理性を裏付けた。npm run build / npm run simulateとも正常終了。reviews/008-flagship-frontierhold-v2.md作成、判定FIX。package.jsonのversionを0.2.0へ、spec.mdにv2修正内容を追記、games/README.mdの状態列を更新し、routine-state.mdをサイクル7・run3（FIX only）へ進めた | (本PR) |
| 2026-07-18 | 7 | 3（FIX only） | 008-flagship-frontierholdのv2指摘#3（中・新規。drill最優先のP01がv2ではmaxDepth85到達直後に生存力不足でtick4524に死亡。対応必須ではなく費用対効果で判断可）に対応。003finalの「ビルド次第で生死が分かれる」設計意図（バランス数値そのもの）は変更せず、v2レビューが提案した2案のうち「実プレイヤー向けUIヒント」を採用した。`src/core/game.ts`に、既存の「安全マージンの数値公開」パターン（`estFuelToReturn`等）を踏襲した`GameState.player.recommendedHp`（現在地の深さで遭遇する敵の期待攻撃力から算出した目安の耐久HP）と`combatRiskLevel`（'safe'/'caution'/'danger'。maxHpがrecommendedHpの何%かで判定）を追加し、`src/render/renderer.ts`のHUDに色分け表示した。閾値はv2で実際に死亡したP01（band4到達時点でatk/hpとも未強化のデフォルト値）がちょうどdanger判定になるよう較正した。このヒントはボットの購入・行動ロジックには一切接続していない（`headless/simulate.ts`は無変更）ため、20シード×5戦略のヘッドレス比較は全指標がv2から完全に不変（ゼロ差分）であることを確認し、既存のバランス・A/B比較用の対照群を汚染しないことを検証した。ブラウザAIPでv2と同じボットロジック（JS移植）でP01(seed301)/P02(seed302)を6000tick再実行したところ、両者ともv2と完全に同一の結果（P01: tick4524死亡・maxDepth85・score447、P02: maxDepth91・score409で完走）を再現し決定論に影響がないことを確認した上で、P01の`combatRiskLevel`は死亡の3400tick以上前（tick1110）から`danger`/`caution`を継続して示し続け、一度も`safe`に戻らなかった一方、P02は6000tick全てで`safe`のまま（誤検知ゼロ）だったことを確認した。npm run build / npm run simulateとも正常終了。レビューは書かず（3回目FIX onlyの規約通り）、package.jsonのversionを0.3.0へ、spec.mdに3回目の修正内容を追記、games/README.mdの状態列を更新し、routine-state.mdをサイクル7・run4（FINAL REVIEW）へ進めた |
| 2026-07-18 | 7 | 4（FINAL REVIEW） | 008-flagship-frontierholdの総括レビュー（reviews/008-flagship-frontierhold-final.md）を作成。20シード×5戦略のヘッドレス再検証で全指標がv2と完全に一致（ゼロ差分）することを確認し、v3（UIヒント追加）がゲームロジックに副作用を与えていないことを裏付けた。ブラウザAIPでP01(seed301)/P02(seed302)を6000tick再実行し、v2と完全に同一の結果（P01: tick4524死亡・maxDepth85・score447、P02: maxDepth91・score409で完走）を再現した上で、500tick刻みのy座標・HP・combatRiskLevelトレースにより**P01のcombatRiskLevelが死亡3000tick以上前（tick1500時点）から一貫してdangerを示し続け一度もsafeに戻らなかった一方、P02は6000tick全編でsafeのまま誤検知ゼロだった**ことを実測確認し、v3のUIヒントが「正確な早期警告」として機能していることを裏付けた。ただし固定優先度リストのヘッドレスbot・ブラウザAIPボットはいずれもcombatRiskLevelを参照しないため、「情報を見せる効果」は確認できたが「見た情報で実プレイヤーが行動を変える効果」は本サイクルの検証手法では原理的に確認できないという限界も明記した。判定はFIX完了・本命ゲーム採用を推奨。002〜007で確立した7つの共通パターン（常設・複数カテゴリショップ／安全マージンの数値公開／固定範囲の保護装置／詰みからの脱出手段／常時使用可能な緊急離脱／建築を第三の選択肢にする／目標を生む建築）がいずれも008で同時に機能していることを確認し、「目標を生む建築（前線基地）」は007finalで「未完成のパターン」だったのが008 v1の待ち時間考慮拡張により完成したパターンとして確立したと総括した。次サイクル（サイクル8）は新規ゲーム番号を切らず、games/008-flagship-frontierholdの磨き上げを継続することを提案（(1)危険度UIヒントに反応する適応型ボット戦略の追加検証、(2)マップ最深部到達時の区切り・報酬演出の検討、(3)mining-first戦略の初見詰みやすさの新規プレイヤー向け再検討）。games/README.mdの状態列を更新し、routine-state.mdをサイクル8・run1へ進めた | (本PR) |
| 2026-07-19 | 8 | 1（BUILD+REVIEW相当） | 008finalが提案した3つの優先課題に対応。(1)適応型ボット戦略: `headless/simulate.ts`に`mining-first-adaptive`/`combat-first-adaptive`/`balanced-adaptive`を新規追加。`combatRiskLevel`が`danger`のとき購入優先度でhp/atkを繰り上げ、低HPを待たずに自主的に帰還するロジックを追加した。(2)最深部到達演出: `src/core/game.ts`にy=160到達時の一度きりの+300moneyボーナスと`Metrics.bottomReached`、`src/render/renderer.ts`にHUDバナー（`GameState.bottomReachedBanner`）を追加。(3)初見詰みやすさ対策: `combatRiskLevel`が初めてsafe以外になった瞬間に一度だけ強調バナー（`GameState.firstRiskWarningBanner`）を表示（バランス・ボットロジックには非接続）。20シード×8戦略のヘッドレス比較で、最深部に到達しない3戦略（combat-first/bridge-reliant/balanced-no-outpost）がfinal時点と完全にゼロ差分であることを確認し副作用なしを裏付けた一方、mining-first-adaptiveは死亡9/20→6/20（-33%）・balanced-adaptiveは2/20→1/20に改善した。ブラウザAIPでP01(seed301)を`mining-first`（固定）と`mining-first-adaptive`の両方で6000tick再生し、**固定戦略はfinalと完全に同一のtick4524死亡を再現し、適応型戦略は同一シードで死亡を完全に回避した**（finalHp41/140、maxHp100→140、score447→501）ことを確認。P02(seed302)は`combat-first`/`combat-first-adaptive`で完全に同一の結果となり、安全なビルドには適応ロジックが介入しないことも確認した。npm run build / npm run simulateとも正常終了。reviews/008-flagship-frontierhold-cycle8-v1.md作成、判定FIX（適応型戦略のパラメータ調整、combat-first-adaptiveの介入機会不足への対応可否はv2で判断）。package.jsonのversionを0.4.0へ、spec.mdにサイクル8の修正内容を追記、games/README.mdの状態列を更新し、routine-state.mdをサイクル8・run2（FIX+REVIEW）へ進めた | (本PR) |
| 2026-07-19 | 8 | 2（FIX+REVIEW） | cycle8-v1指摘#1〜#3の要否判断を実施。(1)combat-first-adaptiveの介入機会不足（指摘#2）は「安全なビルドには何も起きない」設計通りの挙動と再確認し対応不要と判断。(2)mining-first-adaptiveの安全側への振れすぎ（指摘#1/#3）は、`priorityFor`を強制的にbaseへ固定する診断実行でavgMoneyEarned-44%等の主因が`adaptiveRiskRetreat`ではなく`'caution'`状態でのhp優先繰り上げ（drill投資を長期間後回しにする）と特定。'caution'側の繰り上げを外す変更も試したが、適用するとcycle8-v1の中核シナリオ（P01 seed301の死亡回避）がtick4414死亡へ回帰することをheadless・ブラウザAIP両方で確認したため不採用とし、'caution'/'danger'とも繰り上げは維持することにした。aggregate指標の低下はP01シナリオを救う安全機構の意図した代償と判断。副作用が無いと確認できた2点のみ反映: `'danger'`側の繰り上げからatkを除外（combatRiskLevelはmaxHpのみで決まりatkを考慮しないため無駄なdrill投資の後回しにしかならない）、`adaptiveRiskRetreat`にHP閾値（`maxHp*0.85`）を追加（被弾ゼロの満タンHPでの即時撤退を防止）。20シード比較でmining-first-adaptiveはv1と完全一致（判断通り）、combat-first-adaptive・balanced-adaptiveはわずかに改善（balanced-adaptive死亡1/20→0/20）。ブラウザAIPでP01(seed301)/P02(seed302相当)をmining-first-adaptiveで6000tick再生し、headlessと完全一致する結果（seed301: finalHp41/140で完走・死亡回避シナリオ維持、seed302: tick5334死亡）を確認。seed302の死亡は`git stash`で変更前コードでも同一に再現することを確認し、本回の回帰ではなくcycle8-v1から存在する既存挙動（適応型戦略は期待値のリスク低減であり個別シードの安全を保証しない）と判明、新規課題#3として記録。npm run build / npm run simulateとも正常終了。reviews/008-flagship-frontierhold-cycle8-v2.md作成、判定FIX。package.jsonのversionを0.5.0へ、spec.mdにサイクル8・2回目の修正内容を追記、games/README.mdの状態列を更新し、routine-state.mdをサイクル8・run3（FIX only）へ進めた | (本PR) |
| 2026-07-19 | 8 | 3（FIX only） | cycle8-v2指摘#3（seed302でmining-first-adaptiveがmining-first固定より早く死ぬ逆転現象）の対応可否を費用対効果で判断した結果、**対応不要**と判断（`src/core/game.ts`・`headless/simulate.ts`とも変更なし）。追加調査として、逆転がseed302固有の現象か主要20シード（1〜20）でも起きるかを`over`フラグで突き合わせたところ、「適応型が死亡を救う」ケースが4件（seed9/16/17/20、固定は道中で死亡・適応型は完走）に対し「適応型の方が悪化する」逆転ケースは1件のみ（seed10、固定はmaxDepth160で完走・適応型はtick2041で死亡）と判明し、seed302と合わせても救済4件・逆転2件で救済の方が明確に多いことを定量確認した。逆転の発生メカニズムをseed10のログ（kills・damageDealt・damageTakenいずれも適応型側が大幅に大きい）で調べ、本ゲームが単一PRNGストリームをtickごとに消費する決定論設計のため、ボットの行動差（'caution'/'danger'での優先度変更・早期撤退）がその時点からのRNG消費タイミングを変え、以降の敵配置・遭遇順が固定戦略と別の展開へ分岐することが原因と特定した（適応ロジック固有の欠陥ではなく、行動依存でRNG消費が分岐する設計に内在する性質）。cycle8-v2で「'caution'側の繰り上げを弱めるとaggregate指標は改善するがP01 seed301の中核救済シナリオが壊れる」トレードオフが既に確認済みであるため、個別シードの逆転を潰す方向の変更はこのリスクを再び持ち込むと判断し見送った。npm run build / npm run simulateとも既存コードのまま正常終了することを確認。レビューは書かず（3回目FIX onlyの規約通り）、判断根拠をspecs/008-flagship-frontierhold/spec.mdの「サイクル8・3回目（FIX only）で実施した判断」節に記載し、routine-state.mdをサイクル8・run4（FINAL REVIEW）へ進めた | (本PR) |
| 2026-07-20 | 8 | 4（FINAL REVIEW） | 008-flagship-frontierholdサイクル8の総括レビュー（reviews/008-flagship-frontierhold-cycle8-final.md）を作成。`src/core/game.ts`・`headless/simulate.ts`ともcycle8・2回目以降無変更のため、本回はコード修正ではなく最終確認と総括判定のみを実施。20シード×8戦略のヘッドレス再検証で全指標がcycle8-v2と完全に一致（ゼロ差分）することを再確認。ブラウザAIPでは`headless/simulate.ts`のBotクラス（適応型リスク判定・wallReserve・outpostReserve等cycle8の全修正を含む最終版）をJS移植してP01(seed301)/P02(seed302)を6000tick再実行し、既存レビュー記録（P01: 固定tick4524死亡→適応型6000tick完走・finalHp41/140・score501、P02: combat-first系は固定/適応型で完全同一のfinalHp70/140・score447、P02をmining-first-adaptiveで実行するとtick5334死亡する逆転現象）を**すべて完全一致で再現**した。さらに最深部到達演出・初回警告バナーをseed10（mining-first、20000tick完走・maxDepth160）で時系列トレースし、firstRiskWarningBannerがtick550、bottomReachedBannerがtick998で発火してから正しく減衰することを確認した。判定はFIX完了・本命ゲーム採用を維持。007final/008finalの3優先課題（適応型ボット・最深部演出・初見詰みやすさ対策）がいずれも解決し、直近の変更が2回連続で「対応不要」判断に収束したことを「磨き上げの収穫逓減」の肯定的シグナルと総括した。次サイクル（サイクル9）はコード修正を前提とせず、シード数を50〜100に拡大した稀な組み合わせ探索と、9つの共通パターン間の相互干渉確認（適応型リスク撤退とwallReserve/outpostReserveの資金予約の競合可能性等）による**本命ゲームの統合ストレステスト**を提案し、目立った新規課題が無ければコアループ検証の収束と低頻度メンテナンスへの移行を検討することとした。games/README.mdの状態列を更新し、routine-state.mdをサイクル9・run1へ進めた | (本PR) |
| 2026-07-20 | 9 | 1（BUILD+REVIEW相当） | cycle8-final提案の統合ストレステストを実施。1〜100シード×8戦略（計800ラン）のヘッドレスシミュレーションを機械的に走査し、`balanced`戦略seed=61（tripsToSurface=6142）・`balanced-adaptive`戦略seed=77（同6009）の2件で、他の同種ラン（13〜153回）と比べ桁違いの異常値を検出した。デバッグトレース（一時スクリプト、調査後に削除済み）で原因を特定: マップ最深部(y=H-1=160)の隅に前線基地を建てた後、掘る先も迂回橋を架ける先も無い完全な袋小路（down方向は常にマップ外＝既存のwallReserve機構が「壁ではない」と正しく判定するため働かない、資金では解決不可能な種類の行き止まり）に入ると、`headless/simulate.ts`のBotが機械的に潜行再開→即座に基地へ戻る3tickサイクルを無限に繰り返し、基地(OUTPOST)タイルへ戻るたびarriveAtBase()が呼ばれtripsToSurfaceが加算され続けていた。**原因は`src/core/game.ts`（ゲーム本体）ではなく検証ボット固有のナビゲーション不備**と特定し、Botに潜行セッションごとの最大移動距離（基地からのチェビシェフ距離）を測る仕組みを追加し、隣接1マス圏から一歩も出られないセッションが3回連続したら以後は潜行を再開せず基地で待機するよう修正した（`src/core/game.ts`は無変更）。修正によりseed=61 tripsToSurface6142→28、seed=77 6009→31まで解消し、20シード基準セットの全指標（死亡数含む）はcycle8-finalと完全一致（回帰なし）を確認。100シード再走査で残った異常は`combat-first`系seed=77のbridgesBuilt=53（同戦略の中央値1）のみで、finalHp160/160・6000tick完走・score483（中央値付近）と健全なため「drill非投資戦略が壁の多い地形で迂回橋に頼る」設計通りの自然な分散と判断し対応不要とした。事前に懸念していた「適応型リスク撤退とwallReserve/outpostReserveの資金予約競合」も、100シード全件で固定戦略とadaptive戦略を突き合わせ「固定版は完走するのにadaptive版だけ停滞」パターンを機械的に検出したが該当ゼロ件で、両者は独立した条件（金額 vs HP比率）でゲートされており競合しないことを確認した。ゲーム本体（`src/core/game.ts`）に関わる新規課題は800ラン中1件も見つからず、routine-state.mdの「目立った新規課題が見つからなければ収束と判断」基準に照らし収束のシグナルと判定した。`src/core/game.ts`を一切変更していないためブラウザAIP再実行は次回（final）にまとめて行うこととし本回は見送った。npm run build / npm run simulateとも正常終了。reviews/008-flagship-frontierhold-cycle9-v1.md作成、判定FIX。package.jsonのversionを0.6.0へ、spec.mdにサイクル9・1回目の修正内容を追記、games/README.mdの状態列を更新し、routine-state.mdをサイクル9・run2（FIX+REVIEW相当）へ進めた | (本PR) |
| 2026-07-20 | 9 | 2（FIX+REVIEW相当） | cycle9-v1の提案どおり新規100シード（101〜200）×8戦略（計800ラン）で追加ストレステストを実施。「ticks=20000完走・死亡なし・maxDepth<45・oreMined<10」を機械的に抽出したところ198/800ラン該当し、うち34シードは`balanced-no-outpost`（前線基地非運用のA/B対照群）単独の想定内貼り付きだったが、残り27シードは前線基地を運用する戦略（mining-first/combat-first/balanced系、最大7戦略）が同時にdepth37〜43へ貼り付いており看過できないと判断した。一時トレース機能（tick範囲指定でphase/y/money/fuel/wallReserve等を出力、調査後に削除済み）でseed=103・mining-first戦略を追跡し原因を特定: 掘削（`p.digging`、複数tick）が残り1〜3tickまで進んだタイミングで`estFuelToReturn + returnMargin`の帰還安全判定が先に発火して撤退へ切り替わり、`applyMove()`が無条件で`p.digging=null`にするため掘削進捗が丸ごと失われる（004以来の既知パターン「掘削中断で進捗リセット」の別形態）。壁の直前まで到達できる燃料容量ちょうどで運用しているシードでは次のトリップでも全く同じ地点・タイミングで撤退するため貫通が永遠に発生せず、加えて基地到着直後に即座に再潜行してしまいLABOR_INCOMEも貯まらず経済が完全停滞していた。**原因は`src/core/game.ts`（ゲーム本体）ではなく検証ボットの帰還判断の優先順位**と特定し、`needsReturn`判定に「掘削残り3tick以下、かつそれを終えてもなお`estFuelToReturn`以上の燃料が残る」場合に限り安全マージン判定を一時的に無効化する`finishingDigSafely`を追加した（掘削の実質2倍燃料消費＋完了後+1マス分のestFuelToReturn増分を見込んだ`digging.remaining*2+2`の余裕を要求。fuel<=0・満載・低HP・adaptiveRiskRetreatの安全側トリガーは変更せず維持。`src/core/game.ts`は無変更）。修正によりdepth37〜43への複数戦略同時貼り付きは27→17件（-37%）、貼り付き総ラン数は198→99（-50%）に減少し、avgMaxDepth/avgScore/avgMoneyEarnedも軒並み改善した（例: mining-first avgMaxDepth91.9→105.4、balanced 81.0→100.1）。一方で副作用として、貼り付きから解放され深部へ到達できるようになったmining-first/balanced系の死亡数（100中）が上昇した（mining-first 51→64、balanced 48→51、mining-first-adaptive 33→40。combat-first系・bridge-reliantはほぼ変化なし）。個別ラン（finalHp/kills/damageTaken）を確認しこれは新種の理不尽な即死ではなく従来到達できなかった深部での通常の被弾蓄積死と判明したため、`src/core/game.ts`の難易度カーブ自体の後退ではなく「これまで測れていなかった深部の難易度が検証精度向上により初めて可視化された」結果と判断した。20シード基準セットでは`digging.remaining`の安全係数（×1 or ×2+2）による結果への影響は検出できなかったため、より安全側の`×2+2`を採用した。残存する貼り付き（17シード）は掘削残り4tick以上のケース等が原因と推定され本回は対応を見送った。npm run build / npm run simulateとも正常終了。reviews/008-flagship-frontierhold-cycle9-v2.md作成、判定FIX。spec.mdにサイクル9・2回目の修正内容を追記、games/README.mdの状態列を更新し、routine-state.mdをサイクル9・run3（FIX only）へ進めた | (本PR) |
| 2026-07-20 | 9 | 3（FIX only） | cycle9-v2で可視化された深部（depth90〜160台、band4〜7）でのmining-first/balanced系の死亡率上昇（mining-first 51%→64%、balanced 48%→51%等）への対応要否を判断した。`headless/simulate.ts`のBotクラス（mining-first/balanced優先度）をJavaScriptへ忠実に移植し、`window.__AIP__`経由でP01(seed301, mining-first)・P02(seed302, balanced)をブラウザ上でmaxTicks=20000まで実行し、band・combatRiskLevelの変化点を時系列で記録した。P01はtick2759でfinalHp0・maxDepth85（band4境界）で死亡したが、combatRiskLevelはtick646（band4到達）で初めて`danger`になって以降、死亡まで2113tickにわたり`caution`/`danger`を行き来し続け一度も`safe`に戻らなかった（hp/atk投資を最後まで一度も行わないまま危険域に居座り続けた消耗死）。P02はtick6037でfinalHp0・maxDepth160（band7、`bottomReached=true`でマップ最下段へ到達済み）で死亡したが、死亡までにdrillLevel6・hpLevel5（maxHp200）・atkLevel7という手厚い投資を行っており、死亡直前のtick4519〜5946の区間ではband6/7への出入りのたびにHPが200中11〜29まで落ち込んでは基地で回復し再潜行する「際どい生還」を7回以上繰り返した末の消耗死だった。両ペルソナとも「警告なしの理不尽な即死」ではなく「長時間可視化された危険、または繰り返しの際どい生還の末の消耗死」であることを実測で確認し、P02がhp/atk投資を優先すればband7・マップ最下段まで実際に到達・長時間活動できることも確認できたため、**`src/core/game.ts`・`headless/simulate.ts`とも変更なし（対応不要）**と判断した。cycle9-v2で残った「掘削残り4tick以上の貼り付き17シード」への追加対応は指示どおり優先度低のため見送った。npm run build / npm run simulateとも既存コードのまま正常終了。レビューは書かず（3回目FIX onlyの規約通り）、判断根拠をspecs/008-flagship-frontierhold/spec.mdの「サイクル9・3回目（FIX only）で実施した判断」節に記載し、routine-state.mdをサイクル9・run4（FINAL REVIEW）へ進めた | (本PR) |
| 2026-07-21 | 9 | 4（FINAL REVIEW） | サイクル9総括レビュー（reviews/008-flagship-frontierhold-cycle9-final.md）を作成。まずヘッドレス再検証として20シード（1〜20）と新規100シード（101〜200）を再走査し、全8戦略の集計値（avgScore/avgMaxDepth/deaths等）がcycle9-v2の「修正後」の値と完全に一致することを確認した（`src/core/game.ts`・`headless/simulate.ts`ともcycle9・2回目以降無変更・回帰なし）。続けて`headless/simulate.ts`のBotをJS移植し、cycle9-v3とは異なり**適応型戦略**（P01=mining-first-adaptive seed301、P02=balanced-adaptive seed302）でブラウザAIPのフルセッション（6000tick）を実行したところ、両者ともtick1000前後（セッションの17%）で深度が頭打ちになり、残り83%（約5000tick）を新たな深度到達なしの停滞に費やす新課題を発見した。P01はmaxDepth85（y65〜85を往復、kills37・skillUses42の活発だが不毛な消耗戦、finalHp79/140で生存）、P02はmaxDepth102（y100〜102で静止、finalHp160/160の満タンHPで安全に足踏み）。cycle9-v3が同一シードで固定戦略を先に検証していたため直接比較したところ、P01のmaxDepth85は固定mining-firstと共通の壁（適応型固有ではない）だったが、**P02のmaxDepth102は適応型固有の停滞**（固定balancedは同一シードでマップ最下段まで到達済み）と判明した。原因は`priorityFor()`の「'caution'/'danger'の間は常にhpを最優先」という単純な二値ルールがdrill/atk投資を長時間後回しにすることと特定し、cycle8-v2で確認済みの「安全機構の意図した代償（aggregate指標の低下）」というトレードオフの実体を、フルセッション実測で「6000tickの83%を停滞に費やす」という具体的な体験として初めて可視化した。両ペルソナの最終問い（P01「クリア後も自主的に遊びたくなるか」・P02「人に話したくなる自分の物語ができたか」）は**今回のセッションに限りNo**と判定したが、これはゲームシステム全体の欠陥ではなく適応型戦略の設計粒度の課題と切り分けた。判定はFIX（本命ゲーム採用は維持）としつつ、この新課題をサイクル10の最優先課題として持ち越した。games/README.mdの状態列を更新し、routine-state.mdをサイクル10・run1へ進めた | (本PR) |
| 2026-07-21 | 10 | 1（BUILD+REVIEW相当） | cycle9-finalの最優先課題「適応型戦略のband境界停滞」に対応。P02(seed302, balanced-adaptive)を`headless/simulate.ts`へ一時トレース機能（調査後に削除済み）で追跡したところ、真因は当初の仮説（`priorityFor()`のhp優先繰り上げそのもの）よりさらに深いところにあると判明した: (1)壁（drillPower不足）に当たると1マス後退→即座に前進判定が再成立→また同じ壁へ、を無限に繰り返すだけで前線基地に滞在する時間がほぼゼロになり、基地滞在中のみ加算されるLABOR_INCOMEが一切貯まらない、(2)既存の`minEscapeBridgeCost`が「次の行のどこかに逃げ道があれば即cost=0」と判定するが、その列が既知の坑道網から実際に到達可能かを見ていないため、到達不可能な列を根拠に「壁ではない」と誤判定し`wallReserve`（貯蓄目標）が機能しない。この2つの複合で、`src/core/game.ts`は無変更のまま検証ボット側だけが構造的な経済停滞に陥っていた。対応として`headless/simulate.ts`へ(a)`s.metrics.maxDepth`ベースの停滞シグナル（800tick更新なしで`stagnant`）、(b)停滞中はhp優先を通常優先度へ戻す、(c)停滞中は1マス後退ではなく`bfsToNearestBase`で確実に基地へ戻し貯蓄する、(d)既知の坑道網全体をBFSして深さ制約付きで掘削可能タイルを探す`bfsToFrontier`、(e)到達可能な隣接タイルの実コストで`wallReserve`を上書きする`nearestBlockedBridgeCost`、(f)潜行開始時点の資金充足判定を固定する`diveHasEscapeFunds`（迂回橋を架けて支払った直後に「資金不足」と誤判定し橋を渡り切る前に引き返す新規バグを開発中に発見・修正）を追加した。全修正はisAdaptive限定のため固定戦略は無変化。個別シード（P01 seed301 finalHp79→140・P02 seed302 maxDepth102→133、milestonesReached5→6、bridgesBuilt0→4）、20シード（mining-first-adaptive avgMaxDepth80.8→129.8、balanced-adaptive 83.6→141.2、bottomReached2/20→14/20、固定戦略は完全に無変化）、100シード（101〜200、balanced-adaptive avgMaxDepth96.6→140.3・deaths32→11/100、mining-first-adaptive avgMaxDepth100.4→132.0・deaths40→25/100、固定戦略はcycle9-final報告値と完全一致）の3段階で検証し、100シード規模ではむしろ死亡率が改善することを確認した。cycle8-v2で確認済みの中核救済シナリオ（P01 seed301の死亡回避）も維持されている。ブラウザAIPはヘッドレスで記録した6000tick分の行動列を`window.__AIP__.run()`で再生する方式で検証し、P01・P02とも全指標がヘッドレスと完全一致することを確認した（`computer.screenshot`は8サイクル連続タイムアウト、既知の環境制約）。npm run build / npm run simulateとも正常終了。reviews/008-flagship-frontierhold-cycle10-v1.md作成、判定FIX。package.jsonのversionを0.8.0へ、games/README.mdの状態列を更新し、routine-state.mdをサイクル10・run2（FIX+REVIEW）へ進めた | (本PR) |
| 2026-07-21 | 10 | 2（FIX+REVIEW相当） | cycle10-v1に致命・重大な残課題はないため、指示どおり追加の確度検証を実施。(a) Bot決定ロジック（`headless/simulate.ts`のBotクラス、cycle10-v1の6点の修正すべてを含む）を検証用一時ファイル`src/bot.ts`（cycle8・1回目のJS移植手法を踏襲、検証後に削除済み）へ移植し、`window.__AIP__`経由で`decide()`を毎tick呼び出す生きたフルセッション（6000tick）をP01(seed301, mining-first-adaptive)・P02(seed302, balanced-adaptive)で実行したところ、finalHp/maxDepth/score/bridgesBuilt/milestonesReachedを含む全指標がcycle10-v1のヘッドレス記録値と完全一致し、「行動列再生」方式では検証できなかった決定ロジック移植自体の正しさを確認した。(b) 新シード範囲（201〜300、cycle9・cycle10-v1と非重複）で100シード×8戦略のヘッドレス比較を実施し、cycle10-v1が101〜200で確認した改善傾向がほぼ同水準で再現することを確認した（mining-first-adaptive avgMaxDepth132.0→130.3・deaths25→26/100、balanced-adaptive avgMaxDepth140.3→141.7・deaths11→14/100、combat-first-adaptive deaths0→1/100）。固定版との比較でも優位は維持（201〜300のdeaths: mining-first63%→mining-first-adaptive26%、balanced51%→balanced-adaptive14%）。固定戦略5種の集計値もcycle9-finalの101〜200報告値とほぼ一致し、`src/core/game.ts`無変更下でのシード範囲間の挙動一貫性を裏付けた。新規の致命・重大な問題は発見されず、`src/core/game.ts`・`headless/simulate.ts`とも変更なし。npm run build（一時ファイル追加時・削除後の両方）は正常終了。reviews/008-flagship-frontierhold-cycle10-v2.md作成、判定FIX（判定を維持、追加修正なし）。package.jsonのversionを0.8.1へ、games/README.mdの状態列を更新し、routine-state.mdをサイクル10・run3（FIX only）へ進めた | (本PR) |
| 2026-07-21 | 10 | 3（FIX only） | cycle10-v2に致命・重大な残課題がなかったため、義務的な修正は無し。routine-state.mdの指示どおり、cycle9-final以来持ち越されてきた提案「本命ゲームのタッチ操作対応の仕様具体化」に着手した。`specs/008-flagship-frontierhold/spec.md`に新セクション「サイクル10・3回目（FIX only）で実施した内容」を追加し、現行の入力セット（4方向移動＋独立ボタン5つ＋ショップ購入9項目、`src/render/input.ts`基準）に対応する画面レイアウトを具体化した: (1)仮想D-pad（画面左下28%×45%、デッドゾーン画面幅3%、タップ即座にfacing更新）、(2)アクションボタン5つ（画面右下、最小48×48dp/44×44pt、ボタン間8px以上、前線基地建設ボタンは条件未達時グレーアウト）、(3)ショップUI（数字キーに対応する物理概念がタッチにはないため、アイコン+名称+価格+レベルのカードを2カラムタップ式に刷新、所持金不足カードはグレーアウト）、(4)マルチタッチ（D-pad保持中の他指ボタンタップをtouch identifierごとに独立判定）、(5)セーフエリア（画面端16pxマージン）。あわせて、007→008へ継承されていた「移動は仮想8方向パッド」という記述が実装（`src/core/types.ts`のDir型はup/down/left/rightの4方向のみ、斜め移動は未実装）と食い違っていることを発見し、005〜008で継承された誤記と特定した上で008では「4方向」へ修正した（005〜007のspec.mdは過去の記録として遡って修正せず）。`src/core/game.ts`・`headless/simulate.ts`はいずれも無変更（spec.mdのみの変更）。npm run build / npm run simulateとも既存コードのまま正常終了を確認。レビューは書かず（3回目FIX onlyの規約通り）、games/README.mdの008行の説明とpackage.jsonのversionは変更なし（コード変更がないため）。cycle10-v1/v2の軽微事項（mining-first-adaptiveの死亡+1件、screenshot環境制約）は引き続き対応不要のまま4回目へ持ち越し。routine-state.mdをサイクル10・run4（FINAL REVIEW）へ進めた | (本PR) |
| 2026-07-22 | 10 | 4（FINAL REVIEW） | サイクル10総括レビュー（reviews/008-flagship-frontierhold-cycle10-final.md）を作成。`npm run build`正常終了を確認したうえで20シード（1〜20）×8戦略のヘッドレス再検証を行い、適応型戦略のbottomReached率（mining-first-adaptive10/20・balanced-adaptive14/20）が固定戦略（最大2/20）を大きく上回ることを確認した（cycle10-v2で実施済みの決定ロジックのライブ検証・201〜300の100シード再検証は変更なしのため再実行不要と判断し参照のみ）。定性評価として、`headless/simulate.ts`のBotクラス・Strategy型を一時的にexportし（検証後に`git checkout`で復元）、P01(seed301, mining-first-adaptive)・P02(seed302, balanced-adaptive)の6000tick分の行動列を一時ファイルへ記録、`public/`へ一時配置してブラウザで`window.__AIP__.run()`により再生し、全指標（finalHp/maxDepth/score/bridgesBuilt/milestonesReached）がヘッドレスと完全一致することを確認した（検証用ファイルはすべて削除済み、`git status`クリーン確認済み）。さらにcycle9-finalが記録した同一シードの停滞時点の数値と本回を直接比較し、**band境界停滞の解消を実測で裏付けた**（P01: maxDepth85(83%停滞)→91・finalHp79/140→140/140満タン、P02: maxDepth102(83%停滞)→133(+30%)・score469→656）。両ペルソナの最終問い（P01「クリア後も自主的に遊びたくなるか」・P02「人に話したくなる自分の物語ができたか」）はcycle9-finalのNoからYesへ反転したと判定。「危険度ヒントを状況適応的に使う（停滞シグナル併用の適応ロジック）」を10番目の共通パターンとして確立し、タッチ操作仕様の具体化（3回目）と合わせてサイクル10全体を総括した。判定はFIX完了・本命ゲーム採用を維持。次サイクル11への提案として、cycle10-v1/v2から持ち越されていた「ビルド差が結果に与える影響のさらなる検証」（単一カテゴリ全振り戦略の新規追加による定量的な寄与度切り分け）に着手することとし、検証結果次第でタッチ操作実装（Capacitor移植）への移行判断も視野に入れることを明記した。`computer.screenshot`は10サイクル連続タイムアウト（既知の環境制約、コンソールエラー0件は確認）。`src/core/game.ts`・`headless/simulate.ts`とも無変更のためpackage.jsonのversionは0.8.1のまま。games/README.mdの状態列を更新し、routine-state.mdをサイクル11・run1へ進めた | (本PR) |
| 2026-07-22 | 11 | 1（BUILD+REVIEW相当） | cycle10-finalの提案どおり「ビルド差が結果に与える影響のさらなる検証」に着手。`headless/simulate.ts`へ9種の「single-stat all-in」戦略（drill/capacity/fuel/atk/hp/atkspeed/skill/muffler/engineeringの各カテゴリだけに全額投資し他は一切買わない）を新規追加し、優先度リストを対象カテゴリ1項目のみに固定した（maxLevel到達後もフォールバックせず余剰資金を貯め続ける設計）。既存の「drill以外は初回購入だけwallReserve/outpostReserveを無視できる」特例（008 v2追加）はsingle-stat all-in戦略には適用せず除外し、単一カテゴリ隔離実験の純度を保った。20シード×17戦略（既存8＋新規9）のヘッドレス比較で、既存8戦略はcycle10-finalと完全に同一の結果（回帰なし）を再確認したうえで、新規9戦略から**drillだけが「深さと引き換えの死亡リスク」という明確なトレードオフを持つ**（avgMaxDepth105.5で2位62.8を大きく引き離す一方、死亡率55%で他8カテゴリの0〜5%から突出）ことを定量確認した。drill以外の8カテゴリはavgMaxDepthが50.5〜62.8の狭い範囲に収束し、これは対象カテゴリ投資完了後の余剰資金が（優先度リストと無関係に動く）迂回橋の都度払いに回るためで、「投資効果」ではなく「迂回橋を買えるだけの資金の有無」がmaxDepthの主因になっていたと判明した。ブラウザAIPでBotクラス・Strategy型を一時的にexportし（検証後に`git checkout`で復元）、P01相当(seed301, drill-all-in)・P02相当(seed302, hp-all-in)の6000tick分の行動列を一時ファイルへ記録・`public/`へ一時配置して`window.__AIP__.run()`で再生したところ、全指標（finalHp/maxDepth/score/bridgesBuilt/milestonesReached/over）がヘッドレスと完全一致することを確認した（drill-all-inはマップ最深部y=160到達と同時に死亡、hp-all-inは死亡なしHP満タンで完走・maxDepth57。検証用一時ファイルはすべて削除済み、`git status`クリーン確認済み）。`src/core/game.ts`は無変更。新たな致命的バランス崩壊は見つからず、drill-all-inの死亡率55%はあえて他カテゴリへ一切投資しない極端な戦略にのみ現れる意図通りのトレードオフと判断した。npm run build / npm run simulateとも正常終了。reviews/008-flagship-frontierhold-cycle11-v1.md作成、判定FIX。package.jsonのversionを0.8.2へ、spec.mdにサイクル11・1回目の内容を追記、games/README.mdの状態列を更新し、routine-state.mdをサイクル11・run2（FIX+REVIEW相当）へ進めた | (本PR) |
| 2026-07-22 | 11 | 2（FIX+REVIEW相当） | cycle11-v1に新規の致命・重大バグはなく、修正必須項目はなかった。cycle11-v1指摘#1（軽微、`games/008-flagship-frontierhold/index.html`の`<title>`が"Outpost (007)"のまま残っていた表記ミス）を"Frontierhold (008)"へ修正し、Browser paneの`document.title`確認とコンソールエラー0件を確認した。あわせてcycle10-final・cycle11-v1が繰り返し提案してきた「Capacitor移植へ進む判断」に向け、実装には入らずspec.mdへ最小スコープを定義した: (1) `src/render/`へのタッチ入力レイヤー追加（`src/core/game.ts`はActionの出所を関知しないcore/render分離設計のため、Browser paneのモバイル解像度プレビューで検証可能な範囲）と、(2) Capacitorによるネイティブアプリ化（`npx cap add ios/android`後のXcode/Android Studioでのビルド・実機確認等、ネイティブSDKを要しこの自動ルーチンの実行環境では原理的に検証不能な範囲）を明確に切り分け、次サイクル（提案:サイクル12）の4回構成案（1回目:タッチ入力レイヤー実装、2回目:タッチUX修正、3回目:残課題修正、4回目:総括＋ネイティブビルドを人手作業へ引き継ぐ文書化）を明記した。`src/core/game.ts`・`headless/simulate.ts`とも無変更のため、`npm run build`・`npm run simulate`ともcycle11-v1から完全にゼロ差分で正常終了することを確認した。ゲームバランスに影響する変更が無いため両ペルソナのフルセッション再プレイは実施せず、定量的な回帰確認とスコープ定義の妥当性検証に絞った。reviews/008-flagship-frontierhold-cycle11-v2.md作成、判定FIX。package.jsonのversionを0.8.3へ、spec.mdにサイクル11・2回目の内容を追記、games/README.mdの状態列を更新し、routine-state.mdをサイクル11・run3（FIX only）へ進めた | (本PR) |
| 2026-07-23 | 11 | 3（FIX only） | cycle11-v2時点で新規の致命・重大バグはなく修正必須項目もなかったため、routine-state.mdが提示した選択肢(a)「Capacitor移植の低リスクな下準備」を実施した。`games/008-flagship-frontierhold/`に`@capacitor/core`・`@capacitor/cli`（8.4.2）をdevDependencyとして追加し、`npx cap init "Frontierhold" "com.gametestscrapbuild.frontierhold008" --web-dir=dist`で`capacitor.config.ts`（現行Capacitor CLIの既定拡張子。routine-state.mdの想定していた`.json`ではないが同等の初期設定ファイル）を生成した。タッチ入力コードは書かず、`npx cap add ios/android`によるプラットフォームフォルダも追加していない。`src/core/game.ts`・`headless/simulate.ts`・`src/render/`はいずれも無変更。インストール直後の`npm audit`が検出したesbuild経由の脆弱性1件（moderate）は`git stash`でCapacitor追加前の状態でも同一件数・同一内容で再現することを確認し、既存の`vite`依存に起因する既存問題（今回の変更とは無関係、修正には`vite`のメジャーアップグレードを要するためスコープ外）と切り分けた。`tsconfig.json`の`include`は`["src","headless"]`のみで`capacitor.config.ts`を含まないため型チェックへの影響もないことを確認した。`node_modules/`はリポジトリルートの`.gitignore`で除外済みのため追加のgitignore変更は不要だった。`npm run build`・`npm run simulate`とも正常終了し、simulateの全指標（17戦略×5シード）は依存追加のみでゲームロジック無変更のため既存のバランス検証に一切影響しないことを確認した。レビューは書かず（3回目FIX onlyの規約通り）、判断根拠をspecs/008-flagship-frontierhold/spec.mdの「サイクル11・3回目」節に記載。package.jsonのversionを0.8.4へ、games/README.mdの状態列を更新し、routine-state.mdをサイクル11・run4（FINAL REVIEW）へ進めた | (本PR) |
| 2026-07-24 | 11 | 4（FINAL REVIEW） | サイクル11総括レビュー（reviews/008-flagship-frontierhold-cycle11-final.md）を作成。`npm run build`正常終了を確認したうえで20シード（1〜20）×17戦略のヘッドレス再検証を行い、cycle11-v1の全数値（drill-all-inのavgMaxDepth105.5・死亡率55%を含む）が完全に再現することを確認し、サイクル11の3回を通じて`src/core/game.ts`・`headless/simulate.ts`のボット決定ロジックが無変更であることを裏付けた。定性評価として`headless/simulate.ts`のBot・Strategyを一時的にexportし（検証後`git checkout`で復元、最終的に無変更）、`headless/record-actions.ts`（検証用一時ファイル、検証後削除済み）でP01(seed301, mining-first-adaptive)・P02(seed302, balanced-adaptive)の6000tick行動列を記録、Browser paneの`npm run dev`上で`window.__AIP__.run()`により再生したところ、finalHp/maxDepth/score/bridgesBuilt/milestonesReached/outpostsBuiltの全指標がヘッドレスと完全一致し、さらにcycle10-final時点（Capacitor依存追加前のv0.8.1）の記録値（P01:140/91/443、P02:180/133/656）とも完全一致することを確認した。これにより、cycle11・2回目（index.htmlのtitle修正）・3回目（Capacitor devDependency追加＋capacitor.config.ts生成）というビルド構成に影響しうる変更が実際のゲームプレイ・ビルド成果物のいずれにも一切影響していないことを実測で裏付けた（検証用一時ファイル・`public/`配下のJSONはすべて削除済み、`git status`クリーン確認済み、コンソールエラー0件）。判定はFIX完了・本命ゲーム採用を維持。両ペルソナの最終問い（P01「クリア後も自主的に遊びたくなるか」・P02「人に話したくなる自分の物語ができたか」）はいずれもcycle10-finalのYesを維持したと判定し、002〜008で確立した10の共通パターンに変更なしと結論した。次サイクル12への提案として、cycle11-v2で定義済みの最小スコープ（1回目:`src/render/`へのタッチ入力レイヤー実装、2回目:タッチUX修正、3回目:残課題修正＋余裕があれば`npx cap add android`検討、4回目:総括＋ネイティブビルドの人手引き継ぎ文書化）が依然として有効であることを再確認し、そのまま次サイクルへ適用することを明記した。`src/core/game.ts`・`headless/simulate.ts`・`src/render/`とも無変更のためpackage.jsonのversionは0.8.4のまま据え置き。spec.mdに「サイクル11・4回目」節を追記し、games/README.mdの状態列を更新し、routine-state.mdをサイクル12・run1（BUILD+REVIEW、タッチ入力レイヤー実装）へ進めた | (本PR) |
| 2026-07-24 | 12 | 1（BUILD+REVIEW） | cycle11-v2・cycle11-finalで定義済みの最小スコープに従い`src/render/touchInput.ts`を新規実装。既存`Input`と同じ`Action`型を返す`TouchInput`クラスとして、仮想D-pad（画面左下・左28%×下45%・デッドゾーン画面幅3%）・アクションボタン5つ（攻撃/範囲攻撃/緊急離脱/支保工設置/前線基地建設・各48px以上・間隔8px）・ショップの2カラムタップUI・ゲームオーバー時のリスタートオーバーレイをキャンバス上のDOMオーバーレイとして実装した（`src/core/game.ts`は想定通り無変更）。`src/main.ts`で`TouchInput`と`Input`を毎tick両方pollし、タッチ側が`wait`でなければタッチ優先・`wait`ならキーボードへフォールバックする方式で並存させた。Browser pane（モバイル解像度375×812）で実DOM要素へ`PointerEvent`を直接発火する検証を行い、(1)D-pad保持による継続move（x:8→15）、(2)pointerup即座の停止、(3)ボタン単発発火とクールダウン正常減衰（attackCd 3→0）、(4)マルチタッチの独立性（D-pad保持中に別指でボタンtapしてもy:0→2の移動が継続）、(5)前線基地ボタンの活性/非活性の視覚状態切替、(6)ショップUIのphase連動表示切替、(7)ショップタップ購入（money15減・capacity+5）の7項目すべてが期待通り動作し、キーボード版と同一の`Action`変換であることを確認した。Browser paneが非表示状態だと`setInterval`駆動のリアルタイムループがスロットリングで停止する制約を発見したため、両ペルソナ(P01 seed301・P02 seed302)の6000tickセッションは`__AIP__.takeControl()`+`step()`の同期呼び出しで実施し、いずれも死亡なく完走（P01: maxDepth42/drillLv3/score318、P02: maxDepth40/finalHp178/180/score211）。`npm run build`・`npm run simulate`とも正常終了、`src/core/game.ts`・`headless/simulate.ts`は無変更のため既存の全バランス検証に影響なし。reviews/008-flagship-frontierhold-cycle12-v1.md作成、判定FIX（実機・可視ブラウザでの見た目/触感の最終確認が残課題）。package.jsonのversionを0.9.0へ、spec.mdに「サイクル12・1回目」節を追記、games/README.mdの状態列を更新し、routine-state.mdをサイクル12・run2（FIX+REVIEW、実機/可視ブラウザでの見た目確認）へ進めた | (本PR) |
| 2026-07-24 | 12 | 2（FIX+REVIEW） | cycle12-v1の残課題（実機・可視ブラウザでの見た目確認）に対応するため`screenshot`取得を再試行したが、ユーザー不在の自動実行のためBrowser paneが表示されず今回も失敗。加えて`computer`ツールの`ref`指定クリックがエラーなく実行成功と表示されるにもかかわらず実際にはDOMへイベントが届かない（グローバルpointerdown/click/pointerupリスナーのカウントが0のまま、かつ購入可能な状態での2回のクリックでも所持金・maxCapacityが不変）ことをリスナーカウントと状態変化の両面から実測確認し、cycle12-v1が想定していたより広い環境制約（`screenshot`だけでなく`computer`ツールの入力送信自体が非表示pane下では機能しない）であると判明した。代替手段としてDOM実測（`getBoundingClientRect`）を採用し、4種のビューポート（モバイル縦375×812・タブレット768×1024・スマホ横向き相当812×375・デスクトップ1280×800）でcanvas・D-pad・ボタン群の描画位置を比較した結果、2件の実害あるバグを発見・修正した。(1) `index.html`のcanvasが固定384×600px表示で画面幅375px以下の端末ではD-pad/ボタンの一部がはみ出しうる（修正前実測: canvas右端380.3pxが画面幅381pxに対し左端-5pxでクリップ）問題を、`max-width: calc(100vw - 16px)`/`max-height: calc(100vh - 40px)`＋`width:auto`/`height:auto`のレスポンシブCSSで解消（内部解像度`canvas.width/height`は不変、`TouchInput`のオーバーレイはcanvasを包む`wrap`要素基準の配置のため自動追従）。(2) 上記の縮小により極端な横向き画面ではD-pad（wrap幅28%）とアクションボタン（固定160px幅）が算術的に重なる（812×375実測でD-pad右端376.4px・ボタン群左端338.2pxが38px分重複）ことを発見し、`dpadOverlapsButtons()`で毎tick重なりを検出して警告オーバーレイ（「画面が狭すぎて操作ボタンが重なっています。端末を縦向きにするか、画面を広げてください。」）を表示するよう`src/render/touchInput.ts`に追加、4種のビューポート全てで意図通りの表示/非表示（横向き狭小時のみflex、他はnone）を確認した。この検証過程でspec.mdの見出し誤記（「ランドスケープ固定」は実際のcanvas縦横比384×600（縦長）・D-pad「画面左下」等の記述と矛盾）も発見し「ポートレート固定」へ訂正、「横向きは正式サポートしない」旨をスコープ外として明記した。`src/core/game.ts`は無変更。`npm run build`・`npm run simulate`とも正常終了し、17戦略×5シードの全指標がcycle12-v1と完全一致（コアロジック無傷）を確認。修正版のショップ購入をsynthetic PointerEvent（javascript_toolでの直接dispatch、cycle12-v1と同じ手法）で再検証し、money25→10・maxCapacity20→25で正常動作することを確認した。両ペルソナの再評価はコアゲームプレイ部分（`src/core/game.ts`無変更のため）はcycle12-v1から差分なしとし、タッチ層の新規変更点についてP01視点（レスポンシブ化はA2「見えないコストの解消」に資する）・P02視点（重なり警告はA9「ちゃんとしてる一貫性」・B6「操作性」に資する）で評価した。reviews/008-flagship-frontierhold-cycle12-v2.md作成、判定FIX。package.jsonのversionを0.9.1へ、spec.mdに「サイクル12・2回目」節を追記、games/README.mdの状態列を更新し、routine-state.mdをサイクル12・run3（FIX only）へ進めた。残課題（実機の指ドラッグの触感）はユーザー不在の自動実行という構造的制約により対応不可であることを明記した | (本PR) |
| 2026-08-11 | 12 | 3（FIX only） | cycle12-v2のバグ・問題リスト#3（実機の指ドラッグの触感）は構造的制約（ユーザー不在の自動実行ではBrowser paneが不可視でscreenshot/computerツールの実入力が機能しない）により今回も対応不可と再確認。それ以外は`src/render/touchInput.ts`のコードレビューで新規の軽微バグを1件発見・修正: `TouchInput.update()`が横向き重なり警告オーバーレイ（`rotateOverlay`）の表示可否を`state.over`を考慮せず毎tick判定していたため、DOM順で`restartOverlay`より後に描画される`rotateOverlay`が常に手前に来て、狭い横向き画面でゲームオーバーになった場合「タップでリスタート」が重なり警告に阻まれて反応しなくなる詰みが起こり得た。`!state.over && this.dpadOverlapsButtons()`に修正し、ゲームオーバー時はリスタート操作を優先するようにした。重なり検出自体は狭い横向きビューポート（812×375）でのDOM実測（`rotateDisplay`が`flex`になること）で動作を再確認したが、`state.over`側のゲーティングは`__AIP__.getState()`がライブ参照ではなくコピーを返す実装のためAIP経由でゲームオーバーを人為的に発生させてのDOM実証はできず、コードレビューでの正当性確認にとどめた（単純な論理積の追加のため妥当と判断）。`src/core/game.ts`は無変更、`npm run build`・`npm run simulate`とも正常終了し17戦略×5シードの全指標がcycle12-v2と完全一致（コアロジック無傷）を確認。レビューは書かず（3回目FIX onlyの規約通り）、判断根拠をspec.mdの「サイクル12・3回目」節に記載。package.jsonのversionを0.9.2へ、games/README.mdの状態列を更新し、routine-state.mdをサイクル12・run4（FINAL REVIEW）へ進めた | (本PR) |
| 2026-08-12 | 12 | 4（FINAL REVIEW） | サイクル12総括レビュー（reviews/008-flagship-frontierhold-cycle12-final.md）を作成。`npm run build`・`npm run simulate`とも正常終了し17戦略×5シードの全指標がcycle12-v1〜v3と完全一致（コアロジック無傷）を確認。cycle12・3回目がコードレビューのみで正当性確認としていた「ゲームオーバー時のリスタート優先ゲーティング」を、`__AIP__.takeControl()`→`step()`で意図的に燃料切れ死亡させ（109tickでhp=0・over=true）→`__AIP__.release()`でmain.tsの実際の`setInterval`ループへ制御を返し→`canvas.parentElement.children`を直接読む、という手順で初めてDOM実証した。横向きの狭いビューポート（812×375）でstate.over=true時、restartOverlayがdisplay:flex（最前面・タップ可能）・rotateOverlayがdisplay:none（正しく非表示）であることを確認し、restartOverlayへのsynthetic pointerdownで実際にリスタート（over: true→false）することも確認した。副産物として`__AIP__.release()`後は非表示のBrowser paneセッションでも`setInterval`ループが単発tick程度は実際に進行しDOMへ反映されることが判明し、cycle12-v2/v3の「AIP経由でのstate.over実証は不可能」という想定を覆した。両ペルソナの評価はコアゲームプレイ部分（`src/core/game.ts`無変更）はcycle12-v1のセッション結果を維持し、タッチ層への最終評価としてP01=A2（見えないコストの解消・リスタート詰みの回避）・P02=A9（一貫性）の観点で肯定的に評価。判定はFIX完了・本命ゲーム採用を維持。残る未解決項目（実機の指ドラッグの触感）はサイクル12の4回全てを通じて構造的制約により未検証のまま持ち越し。次サイクル13への提案として、cycle11-v2の2段階計画の後段にあたる`npx cap add android`（Androidプラットフォーム雛形生成のみ、実機ビルド・ストア申請はスコープ外）への着手を明記した。spec.mdに「サイクル12・4回目」節を追記し、package.jsonのversionを0.10.0へ、games/README.mdの状態列を更新（サイクル完了・アーカイブ扱いへ）、routine-state.mdをサイクル13・run1（BUILD+REVIEW、`npx cap add android`）へ進めた | (本PR) |

## 備考・引き継ぎ事項

- **[サイクル11・run3への引き継ぎ、解決済み] Capacitor移植スコープの実装着手可否判断**: cycle11-v2で
  spec.mdへCapacitor移植の最小スコープ（タッチ入力レイヤー追加 vs ネイティブビルドの2段階、
  次サイクルの4回構成案）を定義済み。run3（FIX only）は「実装着手はサイクル11・3回目または
  次サイクル以降の判断に委ねる」の判断を行うこと。低リスクな下準備（`capacitor.config.json`＋
  `@capacitor/core`/`@capacitor/cli`のdevDependency追加のみ、タッチ入力コード・プラットフォーム
  フォルダは追加しない）に着手してもよいし、FIX onlyの性質上スコープ外の先取りを避け何もせず
  4回目（FINAL REVIEW）でサイクル11を総括してもよい。どちらを選んでも判断根拠をspec.mdに
  記載すること（詳細はspecs/008-flagship-frontierhold/spec.mdの「サイクル11・2回目」節、
  reviews/008-flagship-frontierhold-cycle11-v2.mdのLearnings参照）
  → run3（本PR）で対応済み: 選択肢(a)の低リスクな下準備を実施し、`@capacitor/core`・
  `@capacitor/cli`のdevDependency追加と`capacitor.config.ts`生成（`npx cap init`相当）のみを
  行った。タッチ入力コード・プラットフォームフォルダは追加せず、`npm run build`・
  `npm run simulate`とも正常終了を確認した（判断根拠はspec.mdの「サイクル11・3回目」節）。
  次サイクル12・1回目は引き続きspec.mdの推奨スコープ（`src/render/`へのタッチ入力レイヤー
  実装から本格着手）に従うこと
- **[サイクル9・run3への引き継ぎ、解決済み] 深部（depth90〜160台）でのmining-first/balanced系の死亡率上昇
  （51%→64%、48%→51%等）への対応要否**: cycle9-v2で検証ボットの帰還判断バグを修正した副作用として
  可視化された。まずP01/P02のブラウザAIPで実際にこの深さ帯へ到達した際の体感を確認し、通常の
  被弾蓄積死として妥当か`src/core/game.ts`側のhp/atk投資と敵の深さスケーリングの調整が必要かを
  判断すること。対応不要と判断した場合はその根拠をspec.mdに記載するだけでよい（詳細は
  reviews/008-flagship-frontierhold-cycle9-v2.mdのLearnings参照）
  → run3（本PR）で対応済み: `headless/simulate.ts`のBotをJS移植したブラウザAIPでP01(seed301,
  mining-first)・P02(seed302, balanced)を実測し、両者とも「警告なしの理不尽な即死」ではなく
  「長時間可視化された危険（P01: danger化から2113tick後に死亡）」または「繰り返しの際どい生還の末
  （P02: band6/7を7回以上出入りしmaxDepth160・bottomReached到達後に消耗死）」の消耗死であることを
  確認し、**`src/core/game.ts`は無変更のまま対応不要**と判断した（判断根拠は
  specs/008-flagship-frontierhold/spec.mdの「サイクル9・3回目（FIX only）で実施した判断」節）。
  サイクル9・4回目（FINAL REVIEW）は、この結論とcycle9-v1/v2で確立した「ゲーム本体の新規課題は
  ストレステストを通じて0件」という結果を踏まえて総括すること
  → run4（本PR）で対応済み: cycle9-v1〜v3の総括（reviews/008-flagship-frontierhold-cycle9-final.md）
  を作成し、100シード×2（計1600ラン）のヘッドレス再検証で回帰なしを再確認したうえで、
  ブラウザAIPフルセッション（6000tick、P01=mining-first-adaptive seed301、P02=balanced-adaptive
  seed302）を実行した。両セッションともtick1000前後で深度が頭打ちになり、残り83%を停滞に費やす
  新課題を発見した（下記サイクル10への引き継ぎ参照）ため、サイクル9・4回目・4回目FINAL REVIEWの
  判定はFIX（本命ゲーム採用は維持）としつつ次サイクルの最優先課題として持ち越した

- **[サイクル10・run1への引き継ぎ] 適応型戦略（-adaptive）のband境界停滞**: cycle9-finalのブラウザ
  AIPフルセッション実測で発見。`headless/simulate.ts`の`priorityFor()`が「combatRiskLevelが
  'caution'/'danger'の間は常にhpを最優先」という単純な二値ルールのため、band境界通過直後の長い
  'caution'期間中ずっとhp投資に資金が吸われ続け、drill/atk投資が滞って同じ経済条件下なら固定戦略で
  踏破できる境界の先へ進めないまま長時間停滞することがある。P02(seed302, balanced-adaptive)では
  固定balanced戦略が同一シードでマップ最下段まで到達したのに対し、適応型はband4/5境界（y=101）の
  1歩先で6000tickの83%（約5000tick）を停滞に費やした。P01(seed301, mining-first-adaptive)でも
  maxDepth85（固定戦略と共通の壁）の手前で同様に83%を消耗戦の均衡に費やした。対応方針の選択肢は
  reviews/008-flagship-frontierhold-cycle9-final.mdの「次サイクルへの提案」参照（優先度リストへの
  連続購入回数上限の導入、または停滞シグナルを加味したより精緻な適応ルールへの改善）。
  修正時はcycle8-v2で確認済みの中核シナリオ（P01 seed301の死亡回避）を壊さないこと、および
  「同一シードでの固定戦略 vs 適応型戦略」比較とフルセッションの時系列トレースの両方で副作用の
  有無を確認することが必須
  → run1（本PR）で対応済み: 一時トレースで追跡した結果、真因は当初の仮説（hp優先繰り上げ）
  ではなく「壁での往復により基地滞在時間がゼロになりLABOR_INCOMEが貯まらない」「既存の
  `minEscapeBridgeCost`が到達可能性を検証せず誤って壁ではないと判定する」の複合と判明した
  （詳細はreviews/008-flagship-frontierhold-cycle10-v1.md）。停滞シグナル・優先度復帰・
  強制帰還・坑道網フロンティア探索・壁の実コスト計算・潜行開始時点スナップショットの6点を
  `headless/simulate.ts`へ追加し、個別シード・20シード・100シードの3段階で検証。固定戦略は
  完全に無変化、適応型戦略はavgMaxDepth+31〜45%・100シードでのdeaths改善（40→25/100、
  32→11/100）を確認した。cycle8-v2の中核シナリオ（P01 seed301の死亡回避）も維持されている

- **[サイクル10・run2への引き継ぎ] 追加の確度検証**: run1のバグ・問題リストに致命・重大な
  残課題はない（reviews/008-flagship-frontierhold-cycle10-v1.mdの#1・#2は同一セッション内で
  発見・修正済み、#3は100シード規模ではむしろ改善と確認済みの軽微事項、#4は環境制約で対応不可）。
  run2は追加の確度検証を主目的とする: (a) run1のブラウザAIP確認は「ヘッドレスで記録した行動列を
  `window.__AIP__.run()`で再生する」方式だったため、修正後のBot決定ロジックを実際にJSへ移植し、
  ブラウザで生きた（decide()を毎tick呼ぶ）フルセッション（6000tick）をP01・P02それぞれ実行して
  決定ロジックの移植自体に誤りがないか確認する、(b) 新しいシード範囲（例: 201〜300）でさらに
  100シードのストレステストを行い、run1で見つけた死亡率低下という改善傾向が別サンプルでも
  再現するか確認する、(c) 残課題があれば修正しv2レビューを書く（改善が無ければその旨を明記して
  FIX判定を維持）

- **[サイクル11・run2への引き継ぎ] cycle11-v1に致命・重大な残課題はない**
  （reviews/008-flagship-frontierhold-cycle11-v1.mdのバグ・問題リストは軽微2件のみで、いずれも
  対応不要と判断済み: #1はindex.htmlの`<title>`表記ミスでプレイに無関係、#2はscreenshot未実施
  だが行動列再生検証で代替済み）。run2は義務的なFIXが乏しい回になる見込みのため、指示どおり
  以下のいずれかに充てること: (a) cycle11-v1が提案した次のテーマ（実際のタッチ操作実装＝
  Capacitor移植）に向けて、移植の最小スコープ（1サイクルでどこまで実装するか、
  `src/render/`への追加範囲、ビルド・依存関係の変更点）を仕様書で具体化する、(b) 軽微な
  index.html表記ミスをついでに修正する、(c) cycle11-v1で発見した「drill以外の8カテゴリが
  迂回橋依存でmaxDepthが収束する」知見を踏まえ、迂回橋の都度払いコスト自体のバランス調整が
  必要かを追加検証する（ただし新たな致命課題ではないため優先度は低い）。`src/core/game.ts`は
  cycle9-v2以降9回の検証回を通じて無変更のまま安定しているため、無理にコード変更を作る
  必要はなく、cycle11-v1のLearningsが示すとおりCapacitor移植への移行判断を軸に検討すること

- 001-mineforge（ルーチン導入前の複合プロトタイプ）の Learnings:
  敵はプレイヤー近くに湧かせないと脅威にならない／「壁がないと死ぬ」水準から調整を始める／
  強化は「作らないと乗り切れない日」を設計する（reviews/001-mineforge-v1.md 参照）
- 002-combat-ironring 総括（reviews/002-combat-ironring-final.md）からサイクル2（採掘）への提案:
  1) 強化・装備更新の選択機会が最低5〜6回は発生する生存時間をバランス初期値の時点で保証する、
  2) 「その場に留まる」より「移動する」ほうが得になるインセンティブを最初から仕様に入れる（例: 同じ場所を掘り続けると効率が逓減する）、
  3) 002は経済システムを意図的にスコープ外にしたためP01の最重要軸（経済ループ）が未検証。採掘サイクルでは経済ループの検証を中心目的にする、
  4) 「掘るほど深部が硬くなる／レアになる」等のスケーリングをバランス表に最初から明記し、後追い修正を避ける
- 003-mining-deepvein v1（reviews/003-mining-deepvein-v1.md）からv2（済）への引き継ぎ事項は全て対応済み
  （岩・ガス要求ドリル威力の緩和、`estFuelToReturn`導入＋燃料切れHPダメージ緩和。死亡0/20・停滞0/20を確認）
- 003-mining-deepvein v2（reviews/003-mining-deepvein-v2.md）からv3（済）への引き継ぎ事項は対応済み
  （鉱石基礎価値を約1.2倍に引き上げ、10シードでshallow購入回数2.7→3.1回・diver3.4→4.9回に改善、
  死亡0/20・停滞0/20を維持）
- 003-mining-deepvein v3（3回目FIX only）からfinal（済）への引き継ぎ事項は決着済み:
  ショップ購入回数の目標未達は、経済パラメータではなく検証bot（既に掘った床を無条件優先し隣の未採掘鉱石を
  素通りする欠陥）側の問題と判明。探索精度を上げたbotで再検証したところ購入回数18〜20回まで伸びることを
  確認し、追加の経済調整は不要と判断した（reviews/003-mining-deepvein-final.md 参照）
- 【軽微・継続】ブラウザの`computer.screenshot`取得は5サイクル連続（002 v2〜final、003 v1〜final、
  004 v1〜v2）でタイムアウトしており実機目視未確認。リポジトリ共通の環境制約であり個別ゲームの
  問題ではない。次回以降も「コード実装済み・getState()の値は正しい・preview_logs/console共にエラーなし」を
  目視確認の代替エビデンスとして扱う
- 003-mining-deepvein final（reviews/003-mining-deepvein-final.md）からサイクル3（建築）への提案:
  1) 「安全マージンの数値公開」パターン（estFuelToReturn相当）を最初から仕様に入れる（構造の耐久限界・
     資材残量など、詰む/壊れるリスクがある数値は必ずAI/UIに公開する）、
  2) 常設・複数カテゴリの購入システム（002のカードドラフトより003の常設ショップの方がビルドの結果責任を
     強く生んだ）を踏襲する、
  3) 敵/障害物なしでも地形・資源の制約だけで難易度と緊張を作れることが確認できたため、建築ゲームでも
     「壊す敵」を必須にせず天候・資材の希少性・構造的制約（重力・耐久）で難易度設計を検討する、
  4) 経済ループの指標が目標未達に見えても、経済パラメータをいきなり調整せず、まず検証bot・実プレイの
     行動精度が指標に影響していないかを疑う
- 004-building-skyspire v1（reviews/004-building-skyspire-v1.md）からv2（済）への引き継ぎ事項は
  全て対応済み（brace効果範囲を半径2マスへ拡張しBRACE_FACTOR強化、目標高度を40へ復元、
  直近マイルストーン以下の土台保護、崩落後の重力接地判定バグ修正。careful 20/20シードで崩落ゼロクリア、
  reckless 20/20シードで死亡を維持。reviews/004-building-skyspire-v2.md 参照）
- 004-building-skyspire v2（reviews/004-building-skyspire-v2.md）からv3（済）への引き継ぎ事項は対応済み
  （地上滞在に対する最低限の労働収入LABOR_INCOMEを追加し、brace無視の「そこそこ雑」プレイが完全な
  経済的詰みに陥らないことをheadless/simulate.tsの新規`sloppy`戦略で回帰確認。死亡0/20・完全凍結なしを維持）
- 004-building-skyspire v3（3回目FIX only、レビュー無し）からfinal（次回）への引き継ぎ事項:
  1) 【軽微、v2から継続】careful戦略が制限時間3600tickの約12%（441tick）で目標高度40をクリアしてしまい、
     6分セッションに対してやや短い。目標高度の引き上げ、または到達後も遊べる別の目標（最高到達高度を
     さらに伸ばす、効率スコアを競う等）を検討すること。final（総括レビュー）で扱う候補
  2) P02（没入型）にとってE4（ロールプレイ余地）がほぼ対象外になる仕様上の弱点は継続（v1から変化なし）。
     最終レビューでの「本命ゲームに採用すべき部分」判断時に建築要素は数値ゲー寄りになりやすい点を踏まえること
  3) v3で追加したLABOR_INCOME（地上滞在15tickごとに+1金）は「そこそこ雑」プレイの完全凍結だけを防ぐ
     最低限の救済であり、sloppy戦略は依然として高さ7で頭打ちのまま（brace不使用という設計上の制約は
     意図通り維持）。finalでブラウザAIPのP02（seed302相当）を再プレイし、ヘッドレスのsloppy戦略と
     同様に「凍結せず活動を継続できる」ことを実地確認すること
  → 上記3点はfinal（reviews/004-building-skyspire-final.md）で対応済み: 1)は結局未解消のまま次サイクルへの
    提案（単一ゴール即終了の設計を避ける）として持ち越し、2)はP01/P02のスコアに反映して総括、
    3)はブラウザAIPでP02(seed302)がfinalHp42/100・money5で3600tick完走し完全凍結しないことを実地確認した
- 004-building-skyspire final（reviews/004-building-skyspire-final.md）からサイクル4（組み合わせ:戦闘×採掘）への提案:
  1) 002（戦闘）の残課題「強化選択が2〜3回で終わりビルド差を検証できない」を、003（採掘）で実証済みの
     常設ショップ・安全マージン公開パターンを戦闘に持ち込む形で解消できないか検証する
     （坑道を掘り進みながら周期的に湧く敵と戦う構成を想定）
  2) 「安全マージンの数値公開」「常設・複数カテゴリショップ」「固定範囲の保護装置」「詰みからの脱出手段」
     「動くと得をするインセンティブ」の5点は002〜004を通じて確立した本命ゲームの共通基盤。次サイクルの
     仕様書に最初から織り込むこと
  3) 「単一の到達目標＝即セッション終了」という設計は、最適戦略のクリアが速すぎる事態を招きやすい
     （004で3回のFIXを経ても未解消）。次のゲームでは「クリア後も遊べる」「新しい目標が生える」構造を
     初期仕様の時点で入れること
  4) ヘッドレスbotは「一切適応しない固定戦略」が基本だが、実プレイヤーはより上手く適応する。
     安全網の検証（最悪ケースで詰まないか）と実プレイヤー体感の評価は区別して書くこと
- 005-combat-mining-ironvein v1（reviews/005-combat-mining-ironvein-v1.md）からv2への引き継ぎ事項:
  1) 【重大】死亡率が全戦略で高すぎる（mining-first 9/10, combat-first 5/10, balanced 6/10）。
     複数体同時接敵に対して単体攻撃しか持たない構造的な不利が根本原因。敵の同時接敵数上限をさらに
     引き下げるか、回復手段（地上HP回復+1/tickのみでは深部での持久戦に対して不足）を強化すること
  2) 【重大】skillUsesが全30ヘッドレスランで0。範囲攻撃(skill, baseCost40)がショップ優先度リストの
     どの並びでも安価なatk/hp/drillに常に先を越されて実質購入されず、機能検証ができていない。
     価格を下げる・より早期に選ばれるようボットの優先度ロジックを見直す・複数同時接敵時に
     価値が伝わりやすい効果に調整する、のいずれかで対応すること
  3) 【重大】1マス幅の坑道が唯一の帰還経路を兼ねるため、敵がその経路を塞ぐと強制的な戦闘
     チョークポイントになり、balanced戦略seed9でtripsToSurface=3522・damageTaken=3696という
     異常値を記録した。ビルド中に追加した地上HP回復で大半のケースは解消したが、この残存パターンには
     対応できていない。退路上の敵を無視して通過できる緊急手段等、構造的な解決を検討すること
  4) 【中】combat-first戦略が10/10シード全てでmaxDepthがちょうど40（band1境界）に張り付く。
     drill未投資による物理的な進行不能が「押し戻され方」の一種として意図通り機能している面はあるが、
     v2で他の指摘を直した後も同じ壁が残るか再確認すること
  → 上記4点はv2（reviews/005-combat-mining-ironvein-v2.md）で対応済み: 1)地上HP回復1→3/tick、
    2)shop価格引き下げ+ボットの特別購入ロジック+skill自体を単体でも有効な性能へ再設計、
    3)緊急離脱(dash)を新規実装、4)20シードで再確認し意図通りと判断。20シード比較で死亡率が
    50〜90%から0〜10%へ改善し、skillUsesも0→平均48〜51回/runへ改善した
- 005-combat-mining-ironvein v2（reviews/005-combat-mining-ironvein-v2.md）から3回目（FIX only、済）への引き継ぎ事項:
  1) 【軽微】drillへの投資インセンティブが弱く、P01/P02とも「capacity/hpを先に安定させてからdrillへ回す」
     という自然な優先度判断ではband1(depth40)の壁を超えられない。002〜004からの共通課題（強化選択の分岐が
     「詰むか詰まないか」の二択になりやすい）が005でも部分的に再発している。drill専用の早期割引・
     壁到達時のヒント表示・壁自体の撤廃（漸進的な難度上昇へ変更）等を検討すること
  2) 【軽微】mining-first/balanced戦略のseed9で、帰還閾値付近のHP回復→即再潜行を細かく繰り返す
     「往復のヒステリシス欠如」が残存（tripsToSurface3373・800）。死亡はしないため優先度は低いが、
     ボットの帰還判断にヒステリシス（一定HP以上まで回復してから再潜行する等）を持たせると
     指標のノイズが減り、より正確な計測ができる
  3) サイクル4は4回で1サイクル。3回目は上記のうちFIXが必要と判断したものを修正するのみ（レビューは書かない）。
     4回目（FINAL REVIEW）で総括し、次サイクル（サイクル5）への提案を行うこと
  → 2)は3回目で対応済み: ボットの帰還判断にヒステリシスを追加し（低HP帰還時のみ60%maxHpまで再潜行しない）、
    seed9のtripsToSurfaceがmining-first 3373→125・balanced 800→144へ大幅改善。1)は試作したが見送った
    （下記v3引き継ぎ参照）
- 005-combat-mining-ironvein v3（3回目FIX only、レビュー無し）からfinal（次回）への引き継ぎ事項:
  1) 【軽微、継続】drill投資インセンティブの弱さ（v2から持ち越し）は3回目で「採掘威力不足でも掘削可能・
     不足分は時間コストで表現する」漸進的な壁への変更を試作したが、20シード比較でavgMaxDepthが
     全戦略で悪化する回帰を検出し見送った。原因は(a)掘削中に被弾・帰還で中断すると`p.digging`の
     進捗が全リセットされ同じタイルを最初からやり直す仕様と、(b)不足時のペナルティが指数的（最大27倍）
     な組み合わせで、両者が重なると「同じタイルへの掘削を繰り返すが燃料切れで毎回中断し完了しない」
     という新種のソフトロック相当のリスクがあったため。finalで対応するなら
     (i) 掘削の部分進捗をタイル単位で保持する仕組みを先に入れる、(ii) ペナルティ倍率をもっと
     穏やかにする（線形・上限4倍程度）、(iii) 壁自体は維持しdrill専用の早期割引やヒント表示など
     ボット/UI側の誘導で対応する、のいずれかを検討すること。3回のFIXを経ても未解消のまま
     finalに persist する軽微課題として総括に明記すること
  2) 001〜004のLearningsで繰り返し出ている「進行を止める種類の壁がある設計では、壁を解除する項目を
     別枠の早期必須購入として扱うか、壁自体を撤廃するかを最初から選ぶ」という指摘は005でも未解決のまま。
     次サイクルの仕様書ではこのパターンを避けるか、最初から解決策込みで設計すること
- 005-combat-mining-ironvein final（reviews/005-combat-mining-ironvein-final.md）からサイクル5（戦闘×採掘×建築）への提案:
  1) 004で確立した建築システム（stressRatio常時公開・brace効果範囲・foundationHeight固定範囲保護・LABOR_INCOME）を
     005のコアループ（掘る→戦う→帰還→強化）へ追加し、7 Days to Die型の3要素併存プロトタイプへ到達する。
     想定する統合案: 坑道内に一時的な補強構造物を設置して退路・拠点を安全化する、または地上ショップ近くに
     防御施設を建てて敵湧きを抑制するなど「採掘・戦闘のどちらにも意味を持つ建築」を狙うこと
  2) 005で3回のFIXを経ても未解消だった「drill投資インセンティブの弱さ（capacity/hp優先の自然な判断ではband境界の
     壁を超えられない）」を、建築による迂回手段（掘れない岩を足場で迂回する等）で構造的に解決できないか検証すること
  3) 002→003→004→005の4要素連続で再発した最大の未解決パターン「進行を止める壁を他の項目と同列優先度で並べると
     投資が後回しになり続ける」は、次の仕様書で最初の設計判断として明記し、壁を解除する項目を別枠の早期必須購入に
     するか壁自体を撤廃するかを実装前に選ぶこと。後付けの漸進化修正は既存仕様（進捗リセット・指数ペナルティ等）との
     組み合わせで新種のソフトロックを生みうる（005 v3で実際に検出）ため、周辺仕様も同時に見直すこと
  4) 三要素同時結合はリスクが高いため、建築要素は「補強構造物1種類＋設置コスト」程度の最小構成から始め、
     CLAUDE.mdのコンテンツ水増し禁止方針を維持すること
  5) P02（あき型）視点でmaxDepth40の壁到達後に「もう一段深く」という次の目標が構造的に生まれない点（A6評価3/5）を、
     「深部に前線基地を建てるとさらに深く安全に潜れる」といった建築由来のマイルストーンで補完できないか検証すること
- 006-combat-mining-building-ironkeep v1（reviews/006-combat-mining-building-ironkeep-v1.md）からv2への引き継ぎ事項:
  1) 【中】全80ラン（20シード×4戦略）・両ペルソナのブラウザセッションともに死亡0件。005最終盤の安全側
     バランスをそのまま継承しているため、006固有の新要素（迂回橋・バリケード）が「使わないと詰む」場面まで
     難易度を押し込めておらず、新要素の真の必要性を検証しにくい。敵の湧き確率・HP/ATKの深さ倍率を1段階
     引き上げる、またはHP回復量を絞るなどしてv2で意図的に難易度を上げ、迂回橋・バリケードが「決定的な
     救済」になる場面を作れるか検証すること
  2) 【中】バリケードは全戦略・両ペルソナで設置されるものの、破壊される頻度（avgPropsDestroyedByEnemy
     0.3〜1.4）や実プレイでの使用回数（P01は1回、P02は0回）から見て「敵の猛攻をわずかな時間だけ食い止める」
     程度に留まっている。上記1)の難易度引き上げと合わせて、バリケードが実際に退路確保の決め手になる場面が
     生まれるか再検証すること
  3) 【軽微】P02（drill投資ゼロ）が迂回橋2回のみでmining-first相当の深さ(42)に到達できてしまい、spec.mdで
     想定していた「迂回橋はdrill投資よりトータルで高くつく」という設計意図が数値面で十分に効いていない
     可能性がある。迂回橋のコスト係数（BRIDGE_BASE_COST/BRIDGE_TIER_COST/BRIDGE_BAND_COST）を引き上げるか、
     drill投資側のメリット（掘削時間短縮・鉱石価値の保持）を強調するバランス調整を検討すること
  4) サイクル5は4回で1サイクル。2回目はFIX+REVIEW（上記の優先度順に致命・重大は必須、今回は重大指摘が
     ないため中項目から着手可）、3回目はFIX only（レビューなし）、4回目にFINAL REVIEWで総括し次サイクルへ
     の提案を行うこと
  → 上記1)〜3)はv2（reviews/006-combat-mining-building-ironkeep-v2.md）で対応済み: 1)難易度引き上げ
    （地上回復・湧き確率・敵強さ・同時湧き上限）で死亡0/80→2/80（mining-first集中）、dashも初使用、
    2)バリケード無効化A/Bテストでmining-first戦略の死亡6/20を防ぐ効果を定量確認、3)迂回橋コスト引き上げで
    bridge-reliantのavgMaxDepthがmining-first比-3.4・投資数-2.6となり設計意図が数値で裏付けられた
- 006-combat-mining-building-ironkeep v2（reviews/006-combat-mining-building-ironkeep-v2.md）から3回目
  （FIX only）への引き継ぎ事項:
  1) 【軽微】P01（efficiency優先）はヘッドレス・ブラウザ双方で迂回橋・バリケードの使用機会がほぼ発生しない
     （プレイスタイル依存の傾向が継続）。drill投資中でも迂回橋が有利になる局面を追加できないか検討の余地あり
  2) 【軽微】死亡がmining-first戦略に偏っている（他3戦略は死亡0/20のまま）。3回目で追加対応するかは、
     コアファン仮説の検証が既に完了していることを踏まえ、費用対効果を見て判断すること（無理に手を入れず
     現状維持もありうる）
  3) 3回目はFIX only（レビューなし、修正内容はPR本文に記載）。4回目でFINAL REVIEWを行い次サイクルへの
     提案を行うこと
  → 1)2)とも3回目で検証し、構造的に意図通りの挙動と判明したためコード変更は見送った: 1)は
    `BUILD_COOLDOWN`(10tick)が`digTicksFor`(土2〜金6tick)を常に上回るため「採掘威力が足りている限り
    迂回橋は掘るより遅く有料」という設計そのものが原因（drill投資しないbridge-reliant戦略のavgBridges1.8
    に対し他3戦略0.1〜0.7という相関で裏付け済み）、2)はv2のA/Bテストで判明した「バリケードがmining-first
    戦略に対する保険として機能している」ことの裏返しであり、死亡の偏り自体がバリケードの必要性の証左。
    判断根拠はspecs/006-combat-mining-building-ironkeep/spec.mdの「v3で検討し、変更を見送った項目」に記載
- 006-combat-mining-building-ironkeep v3（3回目FIX only、レビュー無し）からfinal（次回）への引き継ぎ事項:
  1) v2指摘の軽微2件（efficiency優先での新要素使用機会の少なさ、mining-first戦略への死亡偏り）はいずれも
     3回目で「構造的に意図通り」と判断し解消済み扱いとした。finalでは追加のコード変更は不要という前提で、
     006全体の総括（迂回橋・バリケード・engineeringカテゴリが本命ゲームに採用すべき共通パターンとして
     成立しているか）と次サイクル（何を作るか）の提案に注力すること
  2) サイクル5（組み合わせ:戦闘×採掘×建築）はこれで4回中3回が完了。4回目はFINAL REVIEWとして20シード
     ヘッドレス比較の再確認＋ブラウザAIPでP01/P02のフルセッション評価を行い、routine-state.mdを
     次サイクル（サイクル6）のrun1へ進めること
  → 上記2点はfinal（reviews/006-combat-mining-building-ironkeep-final.md）で対応済み: 1)20シード再検証で
    v2・v3と完全に同一の結果（死亡2/80）を確認し回帰なしを裏付けた。2)本命ゲーム採用を推奨する総括を行い、
    「建築を第三の選択肢にする（迂回橋・バリケード）」を6つ目の共通パターンとして確立したと結論づけた
- 006-combat-mining-building-ironkeep final（reviews/006-combat-mining-building-ironkeep-final.md）から
  サイクル6（深部拠点/前線基地による目標再生成）への提案:
  1) 002〜006を通じて一度も解決されていない「壁を超えた先に新しい目標が生えない」問題（P02のA6評価が
     005・006で3/5のまま変化なし、maxDepth40の壁到達後に次の目標が構造的に生まれない）を最優先課題とする。
     006の迂回橋・バリケードは「詰まないこと」には貢献したが「新しい目標が生まれること」には貢献しなかった
     ——この2つは別の課題であるとfinalで明確になった
  2) 005final提案5・006specのスコープ外項目として2サイクル連続で先送りされてきた「深部に前線基地を建てると
     さらに深く安全に潜れる」構想（拠点化・ワープ地点化）を、007-combat-mining-building-outpost（暫定名。
     仕様書作成時に確定）として検証すること。前線基地は「そこに拠点があるから、もう少し深く行けそうだ」という
     目標そのものを生む建築として設計し、006の迂回橋・バリケード（詰みからの脱出手段）とは役割を区別すること
  3) 難易度の再検証を初期仕様の時点で織り込む: 004→005→006の3サイクル連続で「安全側バランスの継承→検証の
     ための難易度引き上げ」という手戻りが発生している。次の仕様書では新要素（前線基地）の検証に必要な
     最低限の死亡リスク・資源逼迫をバランス初期値に最初から組み込み、v1→v2の手戻りを避けること
  4) P01視点の「プレイスタイル依存」問題（迂回橋がefficiency優先プレイでほぼ使われない）への対応も検討する:
     前線基地の価値がプレイスタイルによらず発生する条件（例: 拠点からの往復時間短縮が全戦略で有意な利益に
     なる設計）を仕様書の段階で検討すること
  5) サイクル1〜5を通じて確立した本命ゲームの共通基盤（最終版）: 常設・複数カテゴリショップ／安全マージンの
     数値公開／固定範囲の保護装置／詰みからの脱出手段／常時使用可能な緊急離脱／建築を第三の選択肢にする。
     次サイクルの仕様書に最初から織り込み、これに加え「目標を生む建築」という7つ目のパターンの成立可否を検証すること
- 007-combat-mining-building-outpost final（reviews/007-combat-mining-building-outpost-final.md）から
  サイクル7（本命ゲーム統合実装）への提案:
  1) 002〜007の6サイクルを通じて本命ゲームに必要な要素・パターンの検証はほぼ完了したため、次サイクルは
     「要素を1つ足す新規プロトタイプ」ではなく**本命ゲームの統合実装**に着手すること。007のコードベースを
     土台にしてよい（ゼロから作り直す必要はない）
  2) 【最優先】007の残課題（#3: 前線基地を壁のすぐ隣に建てると、迂回橋代が貯まるまで長時間停滞する）に
     統合実装の初期タスクとして対応すること。原因は`hasForwardProgressBelow()`が「理論上突破可能か」の
     二値しか見ておらず「実際にどれだけの時間で突破できるか」を無視している設計限界（finalのP02ブラウザ
     セッションでtick1000〜6000の83%が停滞という深刻な事例で判明）。対応案: (a) 前線基地にも地上と同水準の
     資金回復を与える、(b) 建設可否判定に「居座った場合の資金回復速度」まで含める、(c) 迂回橋代が貯まる
     までの推定時間が長すぎる場合は建設自体を拒否する、のいずれか（複数可）を検討すること
  3) ヘッドレスbotの経路選択（隣接1マスのみの近視眼的探索）も統合実装で見直すこと。「資金が貯まるまで待つ」
     等のより長期的な判断を正しく検証するため、次の1〜3行や左右に広い範囲を見る探索へ拡張することを検討する
  4) 統合実装でもCLAUDE.mdの「コンテンツの水増しはしない」方針を維持する。新マップ・新敵種別を増やすのでは
     なく、007までに確立したシステム（採掘・戦闘・迂回橋・バリケード・前線基地）を1つのゲームとして磨き
     上げ、P01の最終問い「クリア後も自主的に遊びたくなるか」・P02の最終問い「人に話したくなる自分の物語が
     できたか」を満たす完成度を目指すこと
  5) サイクル1〜6を通じて確立した本命ゲームの共通基盤（最終版・7パターン）: 常設・複数カテゴリショップ／
     安全マージンの数値公開／固定範囲の保護装置／詰みからの脱出手段／常時使用可能な緊急離脱／建築を
     第三の選択肢にする／目標を生む建築（前線基地。ただし#2の残課題対応が前提）
  → 上記2)は008 v1で対応済み: `hasForwardProgressBelow()`に待ち時間の概念（OUTPOST_MAX_WAIT_TICKS=400）を
    追加し、ボットの`wallReserve`追跡バグ（`wallRow`記憶方式）も修正。20シード×5戦略でcombat-first
    （avgMaxDepth41.6→70.5）・bridge-reliant（42.9→62.8、死亡4/20→0/20）がband1境界の壁を初めて突破し、
    ブラウザAIPのP01/P02双方でy座標の時系列トレースが「単調に深度が伸びるサイクル」に変化したことを確認した。
    3)（ボットの近視眼的探索の見直し）は今回は明示的な複数行先読みではなく`wallRow`記憶による実質的な
    先読み代替で対応し、効果を確認済み。4)は新要素追加なしで維持。ただし新たな中程度課題として
    「迂回橋の都度払いが効率化されすぎ、drill投資（恒久強化）に資金が回らずP01/P02ともdrillLevel0のまま
    セッションを終える」現象を発見しており、v2で対応要否を判断すること（詳細はreviews/008-flagship-frontierhold-v1.md）
- 008-flagship-frontierhold v1（reviews/008-flagship-frontierhold-v1.md）からv2への引き継ぎ事項:
  1) 【中・新規】前線基地の壁際停滞は解消できたが、副作用として「迂回橋の都度払い」がdrill投資の
     代替として機能しすぎ、P01（drill最優先設定）・P02（drill後回し設定）とも6000tickの全セッションで
     drillLevelが0のまま変化しなかった。対応候補: (a) drill購入だけは迂回橋/outpostの予約から一部除外する
     優遇枠を設ける、(b) 迂回橋のコストを深さに応じてより急峻に引き上げdrill投資の方が総コストで
     安くなるようにする、(c) 現状維持（迂回橋は元々「drill投資の保険」という006以来の設計意図の範囲内と
     捉え、drill不使用でも壁を越えられること自体を成果とみなす）。両ペルソナとも死亡せず高スコアで
     完走しているため、致命度合いを見極めた上で対応要否を判断すること
  2) 【軽微】mining-first戦略の死亡率が7/20→9/20へ微増（到達深度が伸びたことに伴う自然な難易度上昇の
     可能性が高い）。他4戦略は死亡が同等か改善しているため経過観察でよいが、v2で再確認すること
  3) サイクル7は4回で1サイクル。2回目はFIX+REVIEW（上記の優先度順に致命・重大は必須、今回は
     致命・重大指摘がないため中項目から着手可）、3回目はFIX only、4回目にFINAL REVIEWで総括し
     次サイクルへの提案を行うこと
  → 上記1)2)はv2（reviews/008-flagship-frontierhold-v2.md）で対応済み: 1)`tryBuy()`にdrill初回購入の
    reserve除外特例を追加し、combat-firstのavgMaxDepth+15%・avgUpgradesBought+73%、ブラウザAIPの
    P01/P02双方でdrillPowerが実際に上昇（1→4、1→2）したことを確認した。2)死亡9シード全てが深部
    （maxDepth57〜160）で発生していることから自然な難易度上昇と原因を特定し、バランス調整は見送った
- 008-flagship-frontierhold v2（reviews/008-flagship-frontierhold-v2.md）から3回目（FIX only）への
  引き継ぎ事項:
  1) 【中・新規】v2のdrill特例修正により、P01(seed301, drill最優先)がv1では6000tick完走していたのに
     対しv2ではtick4524で死亡する新規パターンが発生した。drill投資で早期にmaxDepth85（深部）へ
     到達した結果、atk/hp強化が後回しになるP01のビルドが深部の敵の強さに見合う打たれ強さを
     持たないまま深く進みすぎたことが原因。003finalが確立した「ビルド次第で生死が分かれる」
     パターンの一種と解釈でき致命ではないが、「drill最優先」という一見合理的な優先度設定が
     実は最もリスクの高いビルドになっている点は、実プレイヤー向けのUIヒント（危険域への接近を
     示す警告等）や軽微なバランス調整（深部の敵の強さの伸び方を緩やかにする等）で対応する余地が
     ないか、3回目またはfinalで検討すること。対応必須ではなく、費用対効果を見て判断してよい
  2) 【軽微・継続】mining-first戦略の死亡率9/20は死因（深すぎる潜行に見合う生存力不足）を
     特定済みで、005final・006v2の前例に倣い意図的にバランス調整を見送っている。同じ判断枠組みで
     良いか、本命ゲーム統合という文脈（新規プレイヤーが初見で詰みやすい印象を与えないか）を踏まえ
     finalで再検討すること
  3) サイクル7は4回で1サイクル。3回目はFIX only（レビューなし、修正内容はPR本文・spec.mdに記載）、
     4回目にFINAL REVIEWで総括し、本命ゲーム統合実装（サイクル7）全体の完成度評価と次サイクルへの
     提案を行うこと
  → 上記1)は3回目（本PR、spec.md「3回目で実施した修正内容」節）でUIヒントの追加により対応した:
    `combatRiskLevel`/`recommendedHp`をGameState.player・HUDに追加し、ボットロジックには非接続
    （ヘッドレス20シード×5戦略はv2から完全にゼロ差分）。ブラウザAIPでP01(seed301)を再実行し
    v2と完全に同一の結果（tick4524死亡・maxDepth85・score447）を再現した上で、死亡の3400tick以上前
    （tick1110）から一度も`safe`に戻らず`danger`/`caution`を示し続けていたことを確認した。P02は
    6000tick全て`safe`で誤検知ゼロ。ただしこれは「情報を見せるだけ」の対応であり、ボット
    （＝実プレイヤーの意思決定モデル）がこの警告を実際に見て行動を変えるかどうかまでは検証して
    いない。バランス数値自体は変更していないため、P01がこの警告を無視すれば同じ死に方をする
    （ヘッドレスの決定論的再現がそれを証明している）。UIヒントが実際に「合理的に見えて実は
    高リスクなビルド」を回避させる効果を持つかは、4回目（FINAL REVIEW）でブラウザAIPの意思決定
    ロジック側にこの警告を読ませて反応させる簡易実験を行うか、次サイクルの課題として持ち越すかを
    判断すること
  2) は未対応のまま持ち越し。4回目で最終判断すること
- 008-flagship-frontierhold 3回目（本PR）からサイクル7・4回目（FINAL REVIEW）への引き継ぎ事項:
  1) サイクル7全体（008 v1〜v3）の総括レビュー（reviews/008-flagship-frontierhold-final.md）を作成し、
     本命ゲーム統合実装として「クリア後も自主的に遊びたくなるか」（P01）「人に話したくなる自分の
     物語ができたか」（P02）を最終評価すること。007final #3（壁際停滞）の解消、v2のdrill投資
     インセンティブ回復、v3の危険度ヒント追加を通じて、002〜007で確立した7パターンが本命ゲームとして
     機能しているかを判定する
  2) 上記の【中・新規】【軽微・継続】2件について、UIヒント追加だけで十分か、追加のバランス調整
     （深部の敵の強さの伸び方の緩和、mining-first戦略の生存力調整）が必要かを最終判断すること
  3) サイクル7完了後、次サイクル（サイクル8）で取り組むべき提案を明記すること（新要素追加は
     引き続き避け、本命ゲームの磨き上げを継続するか、007final・008で確立した知見を踏まえた
     別の統合改善に着手するか）
  → 上記1)〜3)はfinal（reviews/008-flagship-frontierhold-final.md）で対応済み: 1)P01「クリア後も
    遊びたくなるか」はYes、P02「人に話したくなる物語ができたか」もYesと判定し、7パターンすべてが
    008で同時に機能していることを確認した。2)UIヒント追加のみで十分と判断しバランス調整は見送った
    （P01のcombatRiskLevelが死亡3000tick以上前から一貫してdanger、P02は誤検知ゼロを実測確認した
    ため）。mining-first死亡率9/20も自然な難易度上昇のまま維持する判断を再確認した。3)次サイクルは
    新規ゲーム番号を切らず008自体の磨き上げを継続する提案を行った
- 008-flagship-frontierhold final（reviews/008-flagship-frontierhold-final.md）からサイクル8への提案:
  1) 【最優先】危険度UIヒント（combatRiskLevel）は「正確に危険を示す」ことは実測確認できたが、
     固定優先度リストのヘッドレスbot・ブラウザAIPボットはヒントを一切参照しないため「見た情報で
     実プレイヤーが行動を変える効果」は原理的に検証できていない。`headless/simulate.ts`に
     combatRiskLevelを読んで動的に優先度を調整する「適応型ボット戦略」を新規追加し、固定戦略との
     比較でP01のような死亡パターンが回避できるかを定量検証すること
  2) マップ最深部到達（band8、y=160）に区切り・報酬演出がなく、スコア加算以外に到達の意味がない。
     004final以来の「クリア後も遊べる」は満たしているが「これが物語の終わり」という手応えが薄い。
     P01のD2（エンドゲーム・周回性）・P02のE4（想像の余地・ロールプレイ）を強化できないか検討する
  3) mining-first戦略の死亡率9/20（自然な難易度上昇と特定済み、バランス調整は見送り済み）を、
     本命ゲームとして新規プレイヤーに提示する文脈で再検討する。バランス調整ではなく、序盤の
     recommendedHp/combatRiskLevelの見え方や初回プレイ時のガイダンスで設計意図を初見でも
     伝えられるかを検証すること
  4) 新規ゲーム番号（009-）は切らず、games/008-flagship-frontierholdをそのまま拡張すること。
     上記1)〜3)はいずれも新要素の追加ではなく既存システムの検証手法・伝達方法の改善であり、
     CLAUDE.mdの「コンテンツの水増しはしない」方針と整合する
