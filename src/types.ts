export type QuestionType =
  | "fill_blank"
  | "true_false"
  | "choice"
  | "multi_select"
  | "matching";

export type QuizQuestion = {
  id: string;
  date: string;
  test: string;
  questionNumber: number;
  type: QuestionType;
  prompt: string;
  choices?: string[];
  answers?: Array<string | string[]>;
  answer?: string | boolean;
  items?: Array<{
    prompt: string;
    answer: string;
  }>;
  sourceRef?: string;
  notes?: string;
};

export type LoadedQuiz = {
  date: string;
  test: string;
  questions: QuizQuestion[];
};

export type SessionMode = "single" | "balanced" | "random";

export type AttemptRecord = {
  attempts: number;
  correct: number;
  lastAnsweredAt: string;
};
