import type { AttemptRecord, LoadedQuiz, QuizQuestion } from "../types";

export const STORAGE_KEY = "mechatronics-quiz-attempts";

export function normalizeAnswer(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isTextCorrect(input: string, expected: string | string[]) {
  const candidates = Array.isArray(expected) ? expected : [expected];
  return candidates.some((candidate) => normalizeAnswer(input) === normalizeAnswer(candidate));
}

export function shuffle<T>(items: T[]) {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

export function buildBalancedSet(quizzes: LoadedQuiz[], count: number) {
  const buckets = quizzes
    .map((quiz) => shuffle(quiz.questions))
    .filter((questions) => questions.length > 0);
  const selected: QuizQuestion[] = [];
  let cursor = 0;

  while (selected.length < count && buckets.some((bucket) => bucket.length > 0)) {
    const bucket = buckets[cursor % buckets.length];
    const next = bucket.shift();
    if (next) {
      selected.push(next);
    }
    cursor += 1;
  }

  return shuffle(selected);
}

export function loadAttempts(): Record<string, AttemptRecord> {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as Record<string, AttemptRecord>;
  } catch {
    return {};
  }
}

export function saveAttempt(questionId: string, isCorrect: boolean) {
  const attempts = loadAttempts();
  const current = attempts[questionId] ?? { attempts: 0, correct: 0, lastAnsweredAt: "" };
  attempts[questionId] = {
    attempts: current.attempts + 1,
    correct: current.correct + (isCorrect ? 1 : 0),
    lastAnsweredAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(attempts));
  return attempts;
}
