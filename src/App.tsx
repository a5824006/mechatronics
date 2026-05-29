import { useEffect, useMemo, useState } from "react";
import { allQuestions, quizzes } from "./data/loadQuizzes";
import { buildBalancedSet, isTextCorrect, loadAttempts, saveAttempt, shuffle } from "./lib/quiz";
import type { LoadedQuiz, QuestionType, QuizPlatform, QuizQuestion, SessionMode } from "./types";

type UserAnswer = string | boolean | string[] | Record<string, string>;
type AnswerMap = Record<string, UserAnswer>;
type AppPage = "quiz" | "search";
type ViewMode = "setup" | "quiz" | "summary";
type PlatformFilter = "all" | QuizPlatform;

const pageLabels: Record<AppPage, string> = {
  quiz: "小テスト",
  search: "答え検索",
};

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

function pageFromHash(): AppPage {
  return window.location.hash === "#search" ? "search" : "quiz";
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

function formatExpectedAnswer(answer: string | string[] | undefined) {
  if (Array.isArray(answer)) return answer.join(" / ");
  return String(answer ?? "");
}

function filledPromptText(question: QuizQuestion) {
  if (question.type !== "fill_blank") return question.prompt;
  return question.prompt.replace(/\{\{(\d+)\}\}/g, (_, index: string) => {
    const answer = question.answers?.[Number(index)];
    return `[${formatExpectedAnswer(answer)}]`;
  });
}

function answerLines(question: QuizQuestion) {
  if (question.type === "true_false") return [`True / False: ${question.answer ? "True" : "False"}`];
  if (question.type === "choice") return [`Answer: ${String(question.answer ?? "")}`];
  if (question.type === "multi_select") {
    return (question.answers ?? []).map((answer, index) => `Answer ${index + 1}: ${formatExpectedAnswer(answer)}`);
  }
  if (question.type === "matching") {
    return (question.items ?? []).map((item) => `${item.prompt} -> ${item.answer}`);
  }
  return (question.answers ?? []).map((answer, index) => `Answer ${index + 1}: ${formatExpectedAnswer(answer)}`);
}

function questionSearchText(question: QuizQuestion) {
  const chunks = [
    question.id,
    question.canonicalId ?? "",
    question.date,
    question.test,
    `Question ${question.questionNumber}`,
    question.prompt,
    filledPromptText(question),
    ...(question.choices ?? []),
    ...(question.items ?? []).flatMap((item) => [item.prompt, item.answer]),
    ...answerLines(question),
    ...(question.images ?? []).map((image) => image.alt),
    question.notes ?? "",
  ];
  return chunks.join(" ");
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/(?:answer|回答)\s*\d+\s*(?:question|問題)\s*\d+/gi, " ")
    .replace(/\{\{\d+\}\}/g, " ")
    .replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~、。・「」『』（）［］【】]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function searchQuestions(query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  const queryTokens = Array.from(new Set(normalizedQuery.split(" ").filter(Boolean)));
  return allQuestions
    .map((question) => {
      const corpus = normalizeSearchText(questionSearchText(question));
      const matchedTokens = queryTokens.filter((token) => corpus.includes(token));
      const exactBonus = corpus.includes(normalizedQuery) ? queryTokens.length + 8 : 0;
      return {
        question,
        score: matchedTokens.length + exactBonus,
        matchedTokens,
      };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.question.id.localeCompare(b.question.id))
    .slice(0, 12);
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
  if (question.type === "multi_select") return (question.answers ?? []).map(formatExpectedAnswer).join(", ");
  if (question.type === "matching") {
    return (question.items ?? []).map((item) => `${item.prompt} -> ${item.answer}`).join(" / ");
  }
  return (question.answers ?? []).map(formatExpectedAnswer).join(", ");
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

function QuestionImages({ images }: { images: QuizQuestion["images"] }) {
  if (!images || images.length === 0) return null;
  return (
    <div className="question-images" aria-label="問題画像">
      {images.map((image) => (
        <figure key={image.alt}>
          <img src={image.src} alt={image.alt} />
          <figcaption>{image.alt}</figcaption>
        </figure>
      ))}
    </div>
  );
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
        <QuestionImages images={question.images} />

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

function SearchPage() {
  const [query, setQuery] = useState("");
  const normalizedQuery = normalizeSearchText(query);
  const results = useMemo(() => searchQuestions(query), [query]);

  return (
    <section className="search-page">
      <section className="search-panel">
        <label className="search-box">
          検索文字列
          <textarea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            rows={8}
            placeholder="Binary Decimal Hexadecimal 11100111 Answer 1 Question 2 ..."
          />
        </label>
        <div className="search-actions">
          <button type="button" onClick={() => setQuery("")} disabled={!query}>
            クリア
          </button>
          <span>{normalizedQuery ? `${results.length}件` : `${allQuestions.length}問から検索`}</span>
        </div>
      </section>

      {!normalizedQuery && (
        <section className="empty-state">問題文や表を貼り付けると、近い問題と正答が表示されます。</section>
      )}

      {normalizedQuery && results.length === 0 && (
        <section className="empty-state">一致する問題が見つかりませんでした。</section>
      )}

      {results.length > 0 && (
        <div className="search-results">
          {results.map(({ question, matchedTokens }) => (
            <article key={question.id} className="search-result">
              <div className="question-meta">
                <span>{question.date} {question.test}</span>
                <span>{platformLabel(question.platform)}</span>
                <span>Q{question.questionNumber}</span>
                <span>{questionTypeLabel(question.type)}</span>
              </div>
              <QuestionImages images={question.images} />
              <p className="search-question-text">{filledPromptText(question)}</p>
              <ol className="answer-list">
                {answerLines(question).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
              <p className="match-hint">一致: {matchedTokens.slice(0, 8).join(", ")}</p>
              {question.notes && <p className="notes">{question.notes}</p>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default function App() {
  const [page, setPage] = useState<AppPage>(() => pageFromHash());
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("moodle");
  const [mode, setMode] = useState<SessionMode>("single");
  const [selectedQuizKey, setSelectedQuizKey] = useState(() => quizKey(quizzes[0]));
  const [questionCount, setQuestionCount] = useState(10);
  const [session, setSession] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("setup");
  const [attempts, setAttempts] = useState(() => loadAttempts());

  useEffect(() => {
    const handleHashChange = () => setPage(pageFromHash());
    window.addEventListener("hashchange", handleHashChange);
    handleHashChange();
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

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
        <div className="page-header">
          <div>
            <p className="eyebrow">Mechatronics Quiz</p>
            <h1>メカトロニクス小テスト</h1>
          </div>
          <nav className="top-links" aria-label="ページ移動">
            {(Object.entries(pageLabels) as Array<[AppPage, string]>).map(([value, label]) => (
              <a key={value} className={page === value ? "active" : ""} href={value === "search" ? "#search" : "#quiz"}>
                {label}
              </a>
            ))}
          </nav>
        </div>

        {page === "quiz" && (
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
        )}
      </section>

      {page === "search" ? (
        <SearchPage />
      ) : (
        <>
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
        </>
      )}
    </main>
  );
}
