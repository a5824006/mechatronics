import type { LoadedQuiz, QuizPlatform, QuizQuestion } from "../types";

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

function inferPlatform(test: string): QuizPlatform {
  return test.startsWith("Mtest") ? "moodle" : "canvas";
}

export const quizzes: LoadedQuiz[] = Object.entries(modules)
  .map(([path, data]) => {
    const { date, test } = getPathParts(path);
    const platform = inferPlatform(test);
    return {
      date,
      test,
      platform,
      questions: (data as QuizQuestion[]).map((question) => ({
        ...question,
        date: question.date ?? date,
        test: question.test ?? test,
        platform: question.platform ?? platform,
        canonicalId: question.canonicalId ?? question.id,
      })),
    };
  })
  .sort((a, b) => `${a.date}/${a.test}`.localeCompare(`${b.date}/${b.test}`));

export const allQuestions = quizzes.flatMap((quiz) => quiz.questions);
