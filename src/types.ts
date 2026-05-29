export type QuestionType =
  | "fill_blank"
  | "true_false"
  | "choice"
  | "multi_select"
  | "matching";

export type QuizPlatform = "moodle" | "canvas";

export type QuizQuestion = {
  id: string;
  date: string;
  test: string;
  platform?: QuizPlatform;
  questionNumber: number;
  canonicalId?: string;
  type: QuestionType;
  prompt: string;
  choices?: string[];
  answers?: Array<string | string[]>;
  answer?: string | boolean;
  items?: Array<{
    prompt: string;
    answer: string;
  }>;
  images?: Array<{
    alt: string;
    src: string;
  }>;
  searchKeywords?: string[];
  sourceRef?: string;
  notes?: string;
};

export type LoadedQuiz = {
  date: string;
  test: string;
  platform: QuizPlatform;
  questions: QuizQuestion[];
};

export type SessionMode = "single" | "balanced" | "random";

export type AttemptRecord = {
  attempts: number;
  correct: number;
  lastAnsweredAt: string;
};
