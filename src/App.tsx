import { useMemo, useState } from "react";
import { allQuestions, quizzes } from "./data/loadQuizzes";
import {
  buildBalancedSet,
  isTextCorrect,
  loadAttempts,
  saveAttempt,
  shuffle,
} from "./lib/quiz";
import type { LoadedQuiz, QuestionType, QuizQuestion, SessionMode } from "./types";

type UserAnswer = string | boolean | string[] | Record<string, string>;

const modeLabels: Record<SessionMode, string> = {
  single: "この回の小テストを受ける",
  balanced: "バラバラ・均等モード",
  random: "バラバラ・完全ランダムモード",
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

function defaultAnswer(question: QuizQuestion): UserAnswer {
  if (question.type === "true_false") {
    return "";
  }
  if (question.type === "multi_select") {
    return [];
  }
  if (question.type === "matching") {
    return Object.fromEntries((question.items ?? []).map((item) => [item.prompt, ""]));
  }
  if (question.type === "fill_blank") {
    return Array.from({ length: question.answers?.length ?? 1 }, () => "");
  }
  return "";
}

function renderPromptWithBlanks(
  prompt: string,
  values: string[],
  onChange: (index: number, value: string) => void,
) {
  const parts = prompt.split(/(\{\{\d+\}\})/g);
  return parts.map((part, index) => {
    const match = part.match(/\{\{(\d+)\}\}/);
    if (!match) {
      return <span key={`${part}-${index}`}>{part}</span>;
    }
    const blankIndex = Number(match[1]);
    return (
      <input
        key={part}
        className="inline-input"
        value={values[blankIndex] ?? ""}
        onChange={(event) => onChange(blankIndex, event.target.value)}
        aria-label={`空欄 ${blankIndex + 1}`}
      />
    );
  });
}

function gradeQuestion(question: QuizQuestion, answer: UserAnswer) {
  if (question.type === "true_false") {
    return answer === question.answer;
  }
  if (question.type === "choice") {
    return typeof answer === "string" && isTextCorrect(answer, String(question.answer ?? ""));
  }
  if (question.type === "multi_select") {
    const actual = Array.isArray(answer) ? answer.map(String).sort() : [];
    const expected = (question.answers ?? []).map(String).sort();
    return (
      actual.length === expected.length &&
      actual.every((value, index) => isTextCorrect(value, expected[index]))
    );
  }
  if (question.type === "matching") {
    const actual = typeof answer === "object" && !Array.isArray(answer) ? answer : {};
    return (question.items ?? []).every((item) => isTextCorrect(actual[item.prompt] ?? "", item.answer));
  }
  if (question.type === "fill_blank") {
    const actual = Array.isArray(answer) ? answer : [String(answer ?? "")];
    return (question.answers ?? []).every((expected, index) =>
      isTextCorrect(String(actual[index] ?? ""), expected),
    );
  }
  return false;
}

function answerSummary(question: QuizQuestion) {
  if (question.type === "true_false") {
    return question.answer ? "True" : "False";
  }
  if (question.type === "choice") {
    return String(question.answer);
  }
  if (question.type === "multi_select") {
    return (question.answers ?? []).join(", ");
  }
  if (question.type === "matching") {
    return (question.items ?? []).map((item) => `${item.prompt} -> ${item.answer}`).join(" / ");
  }
  return (question.answers ?? []).map((answer) => (Array.isArray(answer) ? answer[0] : answer)).join(", ");
}

function QuestionCard({
  question,
  onAnswered,
}: {
  question: QuizQuestion;
  onAnswered: (isCorrect: boolean) => void;
}) {
  const [answer, setAnswer] = useState<UserAnswer>(() => defaultAnswer(question));
  const [result, setResult] = useState<null | boolean>(null);

  function submit() {
    const isCorrect = gradeQuestion(question, answer);
    setResult(isCorrect);
    onAnswered(isCorrect);
  }

  function resetForCurrentQuestion() {
    setAnswer(defaultAnswer(question));
    setResult(null);
  }

  return (
    <article className="question-panel">
      <div className="question-meta">
        <span>{question.date} {question.test}</span>
        <span>Q{question.questionNumber}</span>
        <span>{questionTypeLabel(question.type)}</span>
      </div>

      <div className="question-body">
        {question.type === "fill_blank" && (
          <p className="fill-prompt">
            {renderPromptWithBlanks(
              question.prompt,
              Array.isArray(answer) ? answer.map(String) : [String(answer ?? "")],
              (index, value) => {
                const next = Array.isArray(answer) ? [...answer.map(String)] : [String(answer ?? "")];
                next[index] = value;
                setAnswer(next);
              },
            )}
          </p>
        )}

        {question.type === "true_false" && (
          <>
            <p>{question.prompt}</p>
            <div className="segmented">
              {[true, false].map((value) => (
                <button
                  key={String(value)}
                  className={answer === value ? "selected" : ""}
                  onClick={() => setAnswer(value)}
                  type="button"
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
                    checked={answer === choice}
                    onChange={() => setAnswer(choice)}
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
                const values = Array.isArray(answer) ? answer.map(String) : [];
                return (
                  <label key={choice}>
                    <input
                      type="checkbox"
                      checked={values.includes(choice)}
                      onChange={(event) => {
                        setAnswer(
                          event.target.checked
                            ? [...values, choice]
                            : values.filter((value) => value !== choice),
                        );
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
                const values = typeof answer === "object" && !Array.isArray(answer) ? answer : {};
                return (
                  <label key={item.prompt}>
                    <span>{item.prompt}</span>
                    <select
                      value={values[item.prompt] ?? ""}
                      onChange={(event) =>
                        setAnswer({
                          ...values,
                          [item.prompt]: event.target.value,
                        })
                      }
                    >
                      <option value="">選択</option>
                      {(question.choices ?? []).map((choice) => (
                        <option key={choice} value={choice}>
                          {choice}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="actions">
        <button type="button" className="primary" onClick={submit}>
          回答する
        </button>
        <button type="button" onClick={resetForCurrentQuestion}>
          入力を消す
        </button>
      </div>

      {result !== null && (
        <div className={result ? "result correct" : "result incorrect"}>
          <strong>{result ? "正解" : "不正解"}</strong>
          <span>正答: {answerSummary(question)}</span>
        </div>
      )}

      {question.notes && <p className="notes">{question.notes}</p>}
    </article>
  );
}

export default function App() {
  const [mode, setMode] = useState<SessionMode>("single");
  const [selectedQuizKey, setSelectedQuizKey] = useState(() => quizKey(quizzes[0]));
  const [questionCount, setQuestionCount] = useState(10);
  const [session, setSession] = useState<QuizQuestion[]>(() => quizzes[0]?.questions ?? []);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [attempts, setAttempts] = useState(() => loadAttempts());

  const selectedQuiz = quizzes.find((quiz) => quizKey(quiz) === selectedQuizKey) ?? quizzes[0];
  const currentQuestion = session[currentIndex];
  const maxCount = allQuestions.length;

  const sessionStats = useMemo(() => {
    const answered = session.filter((question) => attempts[question.id]?.attempts).length;
    const weak = session.filter((question) => {
      const record = attempts[question.id];
      return record && record.correct < record.attempts;
    }).length;
    return { answered, weak };
  }, [attempts, session]);

  function startSession() {
    const count = Math.min(Math.max(questionCount, 1), maxCount);
    if (mode === "single") {
      setSession([...(selectedQuiz?.questions ?? [])].sort((a, b) => a.questionNumber - b.questionNumber));
    } else if (mode === "balanced") {
      setSession(buildBalancedSet(quizzes, count));
    } else {
      setSession(shuffle(allQuestions).slice(0, count));
    }
    setCurrentIndex(0);
  }

  function onAnswered(isCorrect: boolean) {
    setAttempts(saveAttempt(currentQuestion.id, isCorrect));
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
            出題モード
            <select value={mode} onChange={(event) => setMode(event.target.value as SessionMode)}>
              {Object.entries(modeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          {mode === "single" && (
            <label>
              小テスト
              <select value={selectedQuizKey} onChange={(event) => setSelectedQuizKey(event.target.value)}>
                {quizzes.map((quiz) => (
                  <option key={quizKey(quiz)} value={quizKey(quiz)}>
                    {quiz.date} {quiz.test} ({quiz.questions.length}問)
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
                onChange={(event) => setQuestionCount(Number(event.target.value))}
              />
            </label>
          )}

          <button type="button" className="primary" onClick={startSession}>
            開始
          </button>
        </div>
      </section>

      <section className="status-grid">
        <div>
          <span>収録</span>
          <strong>{allQuestions.length}</strong>
        </div>
        <div>
          <span>今回</span>
          <strong>{session.length}</strong>
        </div>
        <div>
          <span>回答済み</span>
          <strong>{sessionStats.answered}</strong>
        </div>
        <div>
          <span>要復習</span>
          <strong>{sessionStats.weak}</strong>
        </div>
      </section>

      {currentQuestion ? (
        <>
          <QuestionCard key={currentQuestion.id} question={currentQuestion} onAnswered={onAnswered} />
          <nav className="pager" aria-label="問題移動">
            <button
              type="button"
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
            >
              前へ
            </button>
            <span>
              {currentIndex + 1} / {session.length}
            </span>
            <button
              type="button"
              disabled={currentIndex >= session.length - 1}
              onClick={() => setCurrentIndex((index) => Math.min(session.length - 1, index + 1))}
            >
              次へ
            </button>
          </nav>
        </>
      ) : (
        <section className="empty-state">問題データを読み込めませんでした。</section>
      )}
    </main>
  );
}
