import type { LoadedQuiz, QuizQuestion } from "../types";

const modules = import.meta.glob("./quizzes/**/questions.json", {
  eager: true,
  import: "default",
});

function getPathParts(path: string) {
  const match = path.match(/quizzes\/([^/]+)\/([^/]+)\/questions\.json$/);
  if (!match) {
    throw new Error(`Unexpected quiz data path: ${path}`);
  }
  return { date: match[1], test: match[2] };
}

export const quizzes: LoadedQuiz[] = Object.entries(modules)
  .map(([path, data]) => {
    const { date, test } = getPathParts(path);
    return {
      date,
      test,
      questions: data as QuizQuestion[],
    };
  })
  .sort((a, b) => `${a.date}/${a.test}`.localeCompare(`${b.date}/${b.test}`));

export const allQuestions = quizzes.flatMap((quiz) => quiz.questions);
