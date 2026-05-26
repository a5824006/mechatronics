# 問題作成README

このREADMEは、メカトロニクスの小テスト画像や講義資料から、同じ形式のJSONを追加するための手順です。前提知識が少ないモデルや人でも、既存データと同じ形式で作れることを目的にしています。

## 1. フォルダ規則

元の小テストフォルダ構造に合わせて、以下の場所に置きます。

```text
src/data/quizzes/<日付>/<test名>/questions.json
```

例:

```text
src/data/quizzes/4.14/test1/questions.json
src/data/quizzes/5.19/test2/questions.json
```

1つの `questions.json` は、問題オブジェクトの配列です。

## 2. Gitに含めるもの・含めないもの

Gitに含める:

- `questions.json`
- アプリのソースコード
- このREADMEなどのドキュメント

Gitに含めない:

- 小テストのPNGスクショ
- 講義資料PDF
- PPTX
- OCRや抽出途中の一時ファイル

作業用ファイルを置く場合は `raw/`, `tmp/`, `extraction-work/` を使います。これらは `.gitignore` 対象です。

## 3. 共通スキーマ

基本形:

```json
{
  "id": "5.19-test2-q1",
  "date": "5.19",
  "test": "test2",
  "questionNumber": 1,
  "type": "fill_blank",
  "prompt": "Write the Ohm's Law. Answer: {{0}}",
  "answers": ["V=RxI", "V=IR"],
  "sourceRef": "5.19/test2/Q1.png",
  "notes": "必要な補足があれば書く"
}
```

必須:

- `id`: `<date>-<test>-q<number>` を基本にする
- `date`: 元フォルダ名
- `test`: 元フォルダ名
- `questionNumber`: 小テスト上の問題番号
- `type`: 問題タイプ
- `prompt`: 問題文

推奨:

- `sourceRef`: 元スクショ名。画像そのものはGitに入れない
- `notes`: 誤答補正、講義資料からの補完、見えない選択肢など

## 4. 問題タイプ

### fill_blank

空欄入力または式入力に使います。`prompt` 内の `{{0}}`, `{{1}}` が入力欄になります。

```json
{
  "type": "fill_blank",
  "prompt": "A sensor translates reaction into a {{0}}.",
  "answers": ["physical quantity"]
}
```

別解を認める場合は、該当空欄を配列にします。

```json
{
  "type": "fill_blank",
  "prompt": "Answer: {{0}}",
  "answers": [["V=RxI", "V=IR", "V=IxR"]]
}
```

### true_false

```json
{
  "type": "true_false",
  "prompt": "The mechanical systems are good at lifting/moving heavy objects.",
  "answer": true
}
```

### choice

単一選択です。

```json
{
  "type": "choice",
  "prompt": "Choose the correct term.",
  "choices": ["machine element", "electronic element", "mechanism"],
  "answer": "machine element"
}
```

### multi_select

複数選択です。`answers` に正答選択肢だけを書きます。

```json
{
  "type": "multi_select",
  "prompt": "Select everything that is correct about the role of sensors.",
  "choices": ["pass to the CPU", "translates energy", "convert into an electric signal"],
  "answers": ["pass to the CPU", "convert into an electric signal"]
}
```

### matching

マッチング問題です。

```json
{
  "type": "matching",
  "prompt": "Match each sign with its corresponding physical quantity.",
  "choices": ["electric current", "electric power"],
  "items": [
    { "prompt": "I", "answer": "electric current" },
    { "prompt": "P", "answer": "electric power" }
  ]
}
```

## 5. 選択肢の補完ルール

- スクショに選択肢が見える場合は、それを優先します。
- ドロップダウン候補が見えない場合は、講義資料から同じ分類の語を追加します。
- 講義資料から補完した場合は `notes` に「講義資料から候補補完」と書きます。
- 確信がない候補は正答にしないでください。
- 問題文や正答が読めない場合は推測で登録せず、`notes` に未登録理由を書きます。

## 6. 既知の補正

`4.21/test1/Q2_last_one_is_incorrect.png` は元スクショで最後の回答が一部誤答です。ユーザー指定により、最後の2つの engineering は以下を正答とします。

- `electronic engineering`
- `electrical engineering`

JSON上では空欄回答を `electronic`, `electrical` として登録します。

## 7. 追加後の確認

```powershell
npm run build
npm run dev
```

確認観点:

- JSON構文エラーがない
- 追加した小テストが出題モードの選択肢に出る
- その小テストを選んで問題が表示される
- 採点して正答表示が出る
- PNG/PDF/PPTXがGit差分に含まれていない
