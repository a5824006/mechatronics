# Mechatronics Quiz

メカトロニクス小テストの復習用サイトです。Vite + React + TypeScript で作られており、GitHub Pages に静的デプロイできます。

## Development

```powershell
npm install
npm run dev
```

本番ビルド:

```powershell
npm run build
```

## Data

問題データは `src/data/quizzes/<date>/<test or Mtest>/questions.json` に置きます。

例:

```text
src/data/quizzes/4.14/test1/questions.json
src/data/quizzes/5.19/Mtest2/questions.json
```

新しい `questions.json` を追加すると、アプリが `import.meta.glob` で自動的に読み込みます。

`test<number>` はCanvas版、`Mtest<number>` はMoodle版です。画面上の「版」セレクトで切り替えできます。
同じ/ほぼ同じ問題は `canonicalId` を揃えているため、別版でも共通IDで追えます。

## Source Materials

PNGスクショ、PDF、PPTXは抽出用の一時データです。GitHubへ公開しないため、`.gitignore` で除外しています。

問題追加時の詳しいルールは [docs/problem-authoring.md](docs/problem-authoring.md) を参照してください。
