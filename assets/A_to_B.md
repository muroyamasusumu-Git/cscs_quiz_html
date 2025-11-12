flowchart TD
  %% ===== A→B全体構造 =====
  subgraph A_Part["Aパート（問題選択画面）"]
    A1["① ユーザーが選択肢をクリック"]
    A2["② A→Bトークンを生成"]
    A3["③ localStorage へ保存\ncscs_from_a_token:<qid>\ncscs_from_a:<qid> (Kc)"]
    A4["④ sessionStorage にバックアップ\ncscs_last_token_*（A側ミラー）"]
    A5["⑤ Bページへ遷移"]
    A1 --> A2 --> A3 --> A4 --> A5
  end

  %% ===== Bプリフライト（#3.6, <head> 先頭） =====
  subgraph B_Preflight["Bプリフライト（build_quiz.py #3.6）"]
    BP1["① qid 抽出（YYYYMMDD-NNN）"]
    BP2["② consumedタブなら Kt を即削除\nlocalStorage.removeItem(cscs_from_a_token:<qid>)"]
    BP3["③ Kt/Kc を影へ退避（初回）\nKsT: cscs_ab_shadow_token:<qid>\nKsC: cscs_ab_shadow_choice:<qid>\n→ localStorage の Kt は除去（Kcは表示用に残す）"]
    BP4["④ rollup は保留（b_judge.js に委譲）"]
  end

  %% ===== Bパート（解説＆判定画面） =====
  subgraph B_Part["Bパート（解説＆判定画面 / b_judge.js）"]
    B1["① 読込 (DOMContentLoaded)"]
    B2["② URLから qid 抽出"]
    B3["③ リロードガード判定\nsessionStorage[cscs_ab_consumed:<qid>]"]
    B4["④ 初回なら mark='1'／既に消費済みなら Kt を念のため除去"]
    B5["⑤ トークン読取（影最優先）\n1) KsT/KsC を最優先で参照\n2) backfill は停止（shadow-mode）\n3) 影が無い場合のみ local の Kt/Kc を読む"]
    B6["⑥ 正答抽出\n（正解: B / .answer / data-correct）"]
    B7["⑦ userChoice（Kc or URL）と correct を比較"]
    B8["⑧ 結果UI更新 (#judge) ※常時描画"]
    B9["⑨ tally() 集計実行（token あり＆未消費タブのみ）"]
    B10["⑩ 後片付け\nlocal: Kt を破棄\nsession: KsT/KsC を破棄"]
    B1 --> B2 --> B3 --> B4 --> B5 --> B6 --> B7 --> B8 --> B9 --> B10
  end

  %% ===== Storage（キー郡） =====
  subgraph Storage["ローカルストレージ構造"]
    S0["A側ミラー（sessionStorage）\ncscs_last_token_*"]
    S6["影トークン（sessionStorage）\nKsT: cscs_ab_shadow_token:<qid>\nKsC: cscs_ab_shadow_choice:<qid>"]
    S7["リロードガード（sessionStorage）\ncscs_ab_consumed:<qid>"]
    S1["日別ログ（localStorage）\ncscs_correct_daily_log\ncscs_wrong_daily_log"]
    S2["日別ユニーク（localStorage）\ncscs_correct_day_log\ncscs_wrong_day_log"]
    S3["全期間累計（localStorage）\ncscs_alltime_correct_raw\ncscs_alltime_wrong_raw"]
    S4["ロールアップ補助（localStorage）\ncscs_rollup:YYYYMMDD\ncscs_rollup_meta\ncscs_last_seen_day"]
    S5["当該1問の延べ（localStorage）\ncscs_q_correct_total:<qid>\ncscs_q_wrong_total:<qid>"]
  end

  %% ===== 固定バッジ表示（wrong_badge.js） =====
  subgraph Display["固定バッジ表示（wrong_badge.js）"]
    D1["① DOMContentLoaded → render()"]
    D2["② お気に入り状態取得\n(cscs_fav, cscs_fav_map)"]
    D3["③ 当該qidの延べ値読取\ncscs_q_correct_total / cscs_q_wrong_total"]
    D4["④ #cscs-fixed-status 更新\n<a class='wrong-status' href='#'>（正解:x回 / 不正解:y回）</a>"]
    D5["⑤ クリックでモーダル表示\n『回数記録のリセット』ボタン →\nlocalStorage.removeItem(\n  cscs_q_correct_total:<qid>,\n  cscs_q_wrong_total:<qid>\n)／UI再描画\n※ preventDefault + stopPropagation で遷移抑止"]
    D1 --> D2 --> D3 --> D4 --> D5
  end

  %% ===== 接続 =====
  A5 --> BP1
  BP4 --> B1
  B9 -->|localStorage更新| S1 & S2 & S3 & S4 & S5
  B10 -->|トークン破棄| S6
  B10 -->|影響→UI再読| D1