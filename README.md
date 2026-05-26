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

問題データは `src/data/quizzes/<date>/<test>/questions.json` に置きます。

例:

```text
src/data/quizzes/4.14/test1/questions.json
src/data/quizzes/5.19/test2/questions.json
```

新しい `questions.json` を追加すると、アプリが `import.meta.glob` で自動的に読み込みます。

## Source Materials

PNGスクショ、PDF、PPTXは抽出用の一時データです。GitHubへ公開しないため、`.gitignore` で除外しています。

問題追加時の詳しいルールは [docs/problem-authoring.md](docs/problem-authoring.md) を参照してください。
