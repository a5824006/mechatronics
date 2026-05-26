import { useMemo, useState } from "react";
import { allQuestions, quizzes } from "./data/loadQuizzes";
import { buildBalancedSet, isTextCorrect, loadAttempts, saveAttempt, shuffle } from "./lib/quiz";
import type { LoadedQuiz, QuestionType, QuizPlatform, QuizQuestion, SessionMode } from "./types";

type UserAnswer = string | boolean | string[] | Record<string, string>;
type AnswerMap = Record<string, UserAnswer>;
type ViewMode = "setup" | "quiz" | "summary";
type PlatformFilter = "all" | QuizPlatform;

const modeLabels: Record<SessionMode, string> = {
  single: "この回の小テストを受ける",
  balanced: "バラバラ・均等モード",
  random: "バラバラ・完全ランダムモード",
};

const platformLabels: Record<PlatformFilter, string> = {
  all: "すべて",
  moodle: "Moodle版 (Mtest)",
  canvas: "Canvas版 (test)",
};

function quizKey(quiz: LoadedQuiz) {
  return `${quiz.date}/${quiz.test}`;
}

function questionTypeLabel(type: QuestionType) {
  return {
    fill_blank: "入力",
    true_false: "True / False",
    choice: "選択",
    multi_select: "複数選択",
    matching: "マッチング",
  }[type];
}

function platformLabel(platform: QuizPlatform | undefined) {
  return platform === "moodle" ? "Moodle版" : "Canvas版";
}

function defaultAnswer(question: QuizQuestion): UserAnswer {
  if (question.type === "true_false") return "";
  if (question.type === "multi_select") return [];
  if (question.type === "matching") {
    return Object.fromEntries((question.items ?? []).map((item) => [item.prompt, ""]));
  }
  if (question.type === "fill_blank") {
    return Array.from({ length: question.answers?.length ?? 1 }, () => "");
  }
  return "";
}

function normalizeQuestionAnswer(question: QuizQuestion, answer: UserAnswer | undefined): UserAnswer {
  return answer ?? defaultAnswer(question);
}

function renderPromptWithBlanks(
  prompt: string,
  values: string[],
  onChange: (index: number, value: string) => void,
  disabled = false,
) {
  const parts = prompt.split(/(\{\{\d+\}\})/g);
  return parts.map((part, index) => {
    const match = part.match(/\{\{(\d+)\}\}/);
    if (!match) return <span key={`${part}-${index}`}>{part}</span>;
    const blankIndex = Number(match[1]);
    return (
      <input
        key={part}
        className="inline-input"
        value={values[blankIndex] ?? ""}
        onChange={(event) => onChange(blankIndex, event.target.value)}
        aria-label={`空欄 ${blankIndex + 1}`}
        disabled={disabled}
      />
    );
  });
}

function gradeQuestion(question: QuizQuestion, answer: UserAnswer | undefined) {
  const normalized = normalizeQuestionAnswer(question, answer);
  if (question.type === "true_false") return normalized === question.answer;
  if (question.type === "choice") {
    return typeof normalized === "string" && isTextCorrect(normalized, String(question.answer ?? ""));
  }
  if (question.type === "multi_select") {
    const actual = Array.isArray(normalized) ? normalized.map(String).sort() : [];
    const expected = (question.answers ?? []).map(String).sort();
    return actual.length === expected.length && actual.every((value, index) => isTextCorrect(value, expected[index]));
  }
  if (question.type === "matching") {
    const actual = typeof normalized === "object" && !Array.isArray(normalized) ? normalized : {};
    return (question.items ?? []).every((item) => isTextCorrect(actual[item.prompt] ?? "", item.answer));
  }
  if (question.type === "fill_blank") {
    const actual = Array.isArray(normalized) ? normalized : [String(normalized ?? "")];
    return (question.answers ?? []).every((expected, index) => isTextCorrect(String(actual[index] ?? ""), expected));
  }
  return false;
}

function answerSummary(question: QuizQuestion) {
  if (question.type === "true_false") return question.answer ? "True" : "False";
  if (question.type === "choice") return String(question.answer);
  if (question.type === "multi_select") return (question.answers ?? []).join(", ");
  if (question.type === "matching") {
    return (question.items ?? []).map((item) => `${item.prompt} -> ${item.answer}`).join(" / ");
  }
  return (question.answers ?? []).map((answer) => (Array.isArray(answer) ? answer[0] : answer)).join(", ");
}

function userAnswerSummary(question: QuizQuestion, answer: UserAnswer | undefined) {
  const normalized = normalizeQuestionAnswer(question, answer);
  if (question.type === "true_false") return normalized === "" ? "未回答" : normalized ? "True" : "False";
  if (question.type === "multi_select") {
    const values = Array.isArray(normalized) ? normalized : [];
    return values.length > 0 ? values.join(", ") : "未回答";
  }
  if (question.type === "matching") {
    const values = typeof normalized === "object" && !Array.isArray(normalized) ? normalized : {};
    return (question.items ?? []).map((item) => `${item.prompt} -> ${values[item.prompt] || "未回答"}`).join(" / ");
  }
  if (question.type === "fill_blank") {
    const values = Array.isArray(normalized) ? normalized : [String(normalized ?? "")];
    return values.map((value) => value || "未回答").join(", ");
  }
  return String(normalized || "未回答");
}

function hasAnswer(question: QuizQuestion, answer: UserAnswer | undefined) {
  if (answer === undefined) return false;
  if (question.type === "true_false") return typeof answer === "boolean";
  if (question.type === "multi_select") return Array.isArray(answer) && answer.length > 0;
  if (question.type === "matching") {
    return typeof answer === "object" && !Array.isArray(answer) && (question.items ?? []).every((item) => Boolean(answer[item.prompt]));
  }
  if (question.type === "fill_blank") {
    return Array.isArray(answer) && answer.every((value) => String(value).trim().length > 0);
  }
  return typeof answer === "string" && answer.length > 0;
}

function QuestionCard({
  question,
  answer,
  review,
  onAnswerChange,
}: {
  question: QuizQuestion;
  answer: UserAnswer | undefined;
  review: boolean;
  onAnswerChange: (answer: UserAnswer) => void;
}) {
  const currentAnswer = normalizeQuestionAnswer(question, answer);
  const isCorrect = review ? gradeQuestion(question, currentAnswer) : false;

  return (
    <article className="question-panel">
      <div className="question-meta">
        <span>{question.date} {question.test}</span>
        <span>{platformLabel(question.platform)}</span>
        <span>共通ID {question.canonicalId ?? question.id}</span>
        <span>Q{question.questionNumber}</span>
        <span>{questionTypeLabel(question.type)}</span>
      </div>

      <div className="question-body">
        {question.type === "fill_blank" && (
          <>
            <p className="fill-prompt">
              {renderPromptWithBlanks(
                question.prompt,
                Array.isArray(currentAnswer) ? currentAnswer.map(String) : [String(currentAnswer ?? "")],
                (index, value) => {
                  const next = Array.isArray(currentAnswer) ? [...currentAnswer.map(String)] : [String(currentAnswer ?? "")];
                  next[index] = value;
                  onAnswerChange(next);
                },
                review,
              )}
            </p>
            {question.choices && question.choices.length > 0 && (
              <div className="word-bank" aria-label="候補語">
                {question.choices.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    disabled={review}
                    onClick={() => {
                      const values = Array.isArray(currentAnswer) ? currentAnswer.map(String) : [String(currentAnswer ?? "")];
                      const emptyIndex = values.findIndex((value) => value.trim().length === 0);
                      if (emptyIndex === -1) return;
                      const next = [...values];
                      next[emptyIndex] = choice;
                      onAnswerChange(next);
                    }}
                  >
                    {choice}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {question.type === "true_false" && (
          <>
            <p>{question.prompt}</p>
            <div className="segmented">
              {[true, false].map((value) => (
                <button
                  key={String(value)}
                  className={currentAnswer === value ? "selected" : ""}
                  onClick={() => onAnswerChange(value)}
                  type="button"
                  disabled={review}
                >
                  {value ? "True" : "False"}
                </button>
              ))}
            </div>
          </>
        )}

        {question.type === "choice" && (
          <>
            <p>{question.prompt}</p>
            <div className="choice-list">
              {(question.choices ?? []).map((choice) => (
                <label key={choice}>
                  <input
                    type="radio"
                    checked={currentAnswer === choice}
                    onChange={() => onAnswerChange(choice)}
                    disabled={review}
                  />
                  {choice}
                </label>
              ))}
            </div>
          </>
        )}

        {question.type === "multi_select" && (
          <>
            <p>{question.prompt}</p>
            <div className="choice-list">
              {(question.choices ?? []).map((choice) => {
                const values = Array.isArray(currentAnswer) ? currentAnswer.map(String) : [];
                return (
                  <label key={choice}>
                    <input
                      type="checkbox"
                      checked={values.includes(choice)}
                      disabled={review}
                      onChange={(event) => {
                        onAnswerChange(event.target.checked ? [...values, choice] : values.filter((value) => value !== choice));
                      }}
                    />
                    {choice}
                  </label>
                );
              })}
            </div>
          </>
        )}

        {question.type === "matching" && (
          <>
            <p>{question.prompt}</p>
            <div className="matching-list">
              {(question.items ?? []).map((item) => {
                const values = typeof currentAnswer === "object" && !Array.isArray(currentAnswer) ? currentAnswer : {};
                return (
                  <label key={item.prompt}>
                    <span>{item.prompt}</span>
                    <select
                      value={values[item.prompt] ?? ""}
                      disabled={review}
                      onChange={(event) => onAnswerChange({ ...values, [item.prompt]: event.target.value })}
                    >
                      <option value="">選択</option>
                      {(question.choices ?? []).map((choice) => (
                        <option key={choice} value={choice}>{choice}</option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          </>
        )}
      </div>

      {review && (
        <div className={isCorrect ? "result correct" : "result incorrect"}>
          <strong>{isCorrect ? "正解" : "不正解"}</strong>
          <span>あなたの回答: {userAnswerSummary(question, currentAnswer)}</span>
          <span>正答: {answerSummary(question)}</span>
        </div>
      )}

      {question.notes && <p className="notes">{question.notes}</p>}
    </article>
  );
}

export default function App() {
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("moodle");
  const [mode, setMode] = useState<SessionMode>("single");
  const [selectedQuizKey, setSelectedQuizKey] = useState(() => quizKey(quizzes[0]));
  const [questionCount, setQuestionCount] = useState(10);
  const [session, setSession] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("setup");
  const [attempts, setAttempts] = useState(() => loadAttempts());

  const activeQuizzes = useMemo(
    () => quizzes.filter((quiz) => platformFilter === "all" || quiz.platform === platformFilter),
    [platformFilter],
  );
  const activeQuestions = activeQuizzes.flatMap((quiz) => quiz.questions);
  const selectedQuiz = activeQuizzes.find((quiz) => quizKey(quiz) === selectedQuizKey) ?? activeQuizzes[0];
  const currentQuestion = session[currentIndex];
  const maxCount = activeQuestions.length || allQuestions.length;
  const answeredCount = session.filter((question) => hasAnswer(question, answers[question.id])).length;
  const correctCount = session.filter((question) => gradeQuestion(question, answers[question.id])).length;

  const historicalWeakCount = useMemo(() => {
    return allQuestions.filter((question) => {
      const record = attempts[question.id];
      return record && record.correct < record.attempts;
    }).length;
  }, [attempts]);

  function buildSession() {
    const count = Math.min(Math.max(questionCount, 1), maxCount);
    if (mode === "single") return [...(selectedQuiz?.questions ?? [])].sort((a, b) => a.questionNumber - b.questionNumber);
    if (mode === "balanced") return buildBalancedSet(activeQuizzes, count);
    return shuffle(activeQuestions).slice(0, count);
  }

  function startSession() {
    const nextSession = buildSession();
    setSession(nextSession);
    setAnswers(Object.fromEntries(nextSession.map((question) => [question.id, defaultAnswer(question)])));
    setCurrentIndex(0);
    setViewMode("quiz");
  }

  function finishSession() {
    let nextAttempts = attempts;
    session.forEach((question) => {
      nextAttempts = saveAttempt(question.id, gradeQuestion(question, answers[question.id]));
    });
    setAttempts(nextAttempts);
    setViewMode("summary");
    setCurrentIndex(0);
  }

  function updateAnswer(questionId: string, answer: UserAnswer) {
    setAnswers((current) => ({ ...current, [questionId]: answer }));
  }

  return (
    <main className="app-shell">
      <section className="control-band">
        <div>
          <p className="eyebrow">Mechatronics Quiz</p>
          <h1>メカトロニクス小テスト</h1>
        </div>

        <div className="controls">
          <label>
            版
            <select
              value={platformFilter}
              onChange={(event) => {
                const nextPlatform = event.target.value as PlatformFilter;
                setPlatformFilter(nextPlatform);
                const nextQuiz = quizzes.find((quiz) => nextPlatform === "all" || quiz.platform === nextPlatform);
                if (nextQuiz) setSelectedQuizKey(quizKey(nextQuiz));
              }}
              disabled={viewMode === "quiz"}
            >
              {Object.entries(platformLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label>
            出題モード
            <select value={mode} onChange={(event) => setMode(event.target.value as SessionMode)} disabled={viewMode === "quiz"}>
              {Object.entries(modeLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          {mode === "single" && (
            <label>
              小テスト
              <select value={selectedQuizKey} onChange={(event) => setSelectedQuizKey(event.target.value)} disabled={viewMode === "quiz"}>
                {activeQuizzes.map((quiz) => (
                  <option key={quizKey(quiz)} value={quizKey(quiz)}>
                    {quiz.date} {quiz.test} / {platformLabel(quiz.platform)} ({quiz.questions.length}問)
                  </option>
                ))}
              </select>
            </label>
          )}

          {mode !== "single" && (
            <label>
              出題数
              <input
                type="number"
                min={1}
                max={maxCount}
                value={questionCount}
                disabled={viewMode === "quiz"}
                onChange={(event) => setQuestionCount(Number(event.target.value))}
              />
            </label>
          )}

          <button type="button" className="primary" onClick={startSession}>
            {viewMode === "setup" ? "開始" : "新しく開始"}
          </button>
        </div>
      </section>

      <section className="status-grid">
        <div><span>収録</span><strong>{activeQuestions.length}</strong></div>
        <div><span>今回</span><strong>{session.length || "-"}</strong></div>
        <div><span>回答済み</span><strong>{answeredCount}</strong></div>
        <div><span>要復習</span><strong>{historicalWeakCount}</strong></div>
      </section>

      {viewMode === "setup" && (
        <section className="empty-state">出題モードを選んで「開始」を押すと問題が表示されます。</section>
      )}

      {viewMode === "quiz" && currentQuestion && (
        <>
          <QuestionCard
            question={currentQuestion}
            answer={answers[currentQuestion.id]}
            review={false}
            onAnswerChange={(answer) => updateAnswer(currentQuestion.id, answer)}
          />
          <nav className="pager" aria-label="問題移動">
            <button type="button" disabled={currentIndex === 0} onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}>前へ</button>
            <span>{currentIndex + 1} / {session.length}</span>
            {currentIndex < session.length - 1 ? (
              <button type="button" onClick={() => setCurrentIndex((index) => Math.min(session.length - 1, index + 1))}>次へ</button>
            ) : (
              <button type="button" className="primary" onClick={finishSession}>集計する</button>
            )}
          </nav>
        </>
      )}

      {viewMode === "summary" && (
        <>
          <section className="summary-panel">
            <h2>集計</h2>
            <strong>{correctCount} / {session.length}</strong>
            <p>解答と正誤は下のレビューで確認できます。</p>
          </section>
          <div className="review-list">
            {session.map((question) => (
              <QuestionCard
                key={question.id}
                question={question}
                answer={answers[question.id]}
                review
                onAnswerChange={(answer) => updateAnswer(question.id, answer)}
              />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
