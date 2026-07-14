import { useEffect, useMemo, useRef, useState } from "react";
import { matchDynamicAnswerTemplates } from "./data/dynamicAnswerTemplates";
import { lectureMaterials } from "./data/loadLectures";
import { allQuestions, quizzes } from "./data/loadQuizzes";
import { buildBalancedSet, isTextCorrect, loadAttempts, loadReviewIds, saveAttempt, saveReviewResult, shuffle } from "./lib/quiz";
import type { DynamicAnswerTemplateResult } from "./data/dynamicAnswerTemplates";
import type { LectureMaterial, LoadedQuiz, QuestionType, QuizPlatform, QuizQuestion, SessionMode } from "./types";

type UserAnswer = string | boolean | string[] | Record<string, string>;
type AnswerMap = Record<string, UserAnswer>;
type AppPage = "quiz" | "search";
type ViewMode = "setup" | "quiz" | "summary";
type PlatformFilter = "all" | QuizPlatform;
type SearchSortMode = "relevance" | "newest" | "oldest";
type SearchTargetMode = "questions" | "lectures";
type StoredQuizState = {
  platformFilter: PlatformFilter;
  mode: SessionMode;
  selectedQuizKey: string;
  questionCount: number;
  questionIds: string[];
  answers: AnswerMap;
  currentIndex: number;
  viewMode: Exclude<ViewMode, "setup">;
};

const SEARCH_BATCH_SIZE = 15;
const QUIZ_STATE_STORAGE_KEY = "mechatronics-quiz-current-session";

const pageLabels: Record<AppPage, string> = {
  quiz: "テスト対策",
  search: "講義資料検索",
};

const modeLabels: Record<SessionMode, string> = {
  single: "この回の小テストを受ける",
  balanced: "バラバラ・均等モード",
  random: "バラバラ・完全ランダムモード",
  review: "要復習だけ",
};

const platformLabels: Record<PlatformFilter, string> = {
  all: "すべて",
  moodle: "Moodle版 (Mtest)",
  canvas: "Canvas版 (test)",
};

const searchSortLabels: Record<SearchSortMode, string> = {
  relevance: "関連度順",
  newest: "新しい順",
  oldest: "古い順",
};

const lectureIgnoredTokens = new Set([
  "2013",
  "2016",
  "aoyama",
  "gakuin",
  "university",
  "iit",
  "dpt",
  "mechatronics",
  "guillaume",
  "lopez",
]);

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
    calculation: "計算",
  }[type];
}

function platformLabel(platform: QuizPlatform | undefined) {
  return platform === "moodle" ? "Moodle版" : "Canvas版";
}

function pageFromHash(): AppPage {
  return window.location.hash === "#search" ? "search" : "quiz";
}

function questionByIdMap() {
  return new Map(allQuestions.map((question) => [question.id, question]));
}

function loadStoredQuizState(): (Omit<StoredQuizState, "questionIds"> & { session: QuizQuestion[] }) | null {
  const raw = localStorage.getItem(QUIZ_STATE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as StoredQuizState;
    const byId = questionByIdMap();
    const session = (stored.questionIds ?? []).map((id) => byId.get(id)).filter((question): question is QuizQuestion => Boolean(question));
    if (session.length === 0) return null;
    return {
      platformFilter: stored.platformFilter ?? "moodle",
      mode: stored.mode ?? "single",
      selectedQuizKey: stored.selectedQuizKey ?? quizKey(quizzes[0]),
      questionCount: stored.questionCount ?? 10,
      answers: stored.answers ?? {},
      currentIndex: Math.min(Math.max(stored.currentIndex ?? 0, 0), session.length - 1),
      viewMode: stored.viewMode === "summary" ? "summary" : "quiz",
      session,
    };
  } catch {
    return null;
  }
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
  if (question.type === "calculation") return ["数値は貼り付けた問題文から自動計算"];
  if (question.type === "multi_select") {
    return (question.answers ?? []).map((answer, index) => `Answer ${index + 1}: ${formatExpectedAnswer(answer)}`);
  }
  if (question.type === "matching") {
    return (question.items ?? []).map((item) => `${item.prompt} -> ${item.answer}`);
  }
  return (question.answers ?? []).map((answer, index) => `Answer ${index + 1}: ${formatExpectedAnswer(answer)}`);
}

function textPositionInQuery(text: string, normalizedQuery: string) {
  const normalizedText = normalizeSearchText(text);
  if (!normalizedText) return Number.POSITIVE_INFINITY;
  const directIndex = normalizedQuery.indexOf(normalizedText);
  if (directIndex >= 0) return directIndex;

  const tokens = normalizedText.split(" ").filter((token) => token.length > 1);
  if (tokens.length === 0) return Number.POSITIVE_INFINITY;
  const positions = tokens.map((token) => normalizedQuery.indexOf(token)).filter((index) => index >= 0);
  if (positions.length === 0) return Number.POSITIVE_INFINITY;
  return Math.min(...positions);
}

function answerLinesForSearch(question: QuizQuestion, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return answerLines(question);

  if (question.type === "matching") {
    const orderedItems = [...(question.items ?? [])]
      .map((item, index) => ({
        item,
        index,
        position: textPositionInQuery(item.prompt, normalizedQuery),
      }))
      .sort((a, b) => a.position - b.position || a.index - b.index)
      .map(({ item }) => item);
    return orderedItems.map((item) => `${item.prompt} -> ${item.answer}`);
  }

  if (question.type === "multi_select") {
    const orderedAnswers = [...(question.answers ?? [])]
      .map((answer, index) => ({
        answer,
        index,
        position: textPositionInQuery(formatExpectedAnswer(answer), normalizedQuery),
      }))
      .sort((a, b) => a.position - b.position || a.index - b.index)
      .map(({ answer }) => answer);
    return orderedAnswers.map((answer, index) => `Answer ${index + 1}: ${formatExpectedAnswer(answer)}`);
  }

  return answerLines(question);
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/(?:answer|回答)\s*\d+\s*(?:question|問題)\s*\d+/gi, " ")
    .replace(/\{\{\d+\}\}/g, " ")
    .replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~©®™、。・「」『』（）［］【】－―–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function answerSearchTexts(question: QuizQuestion) {
  if (question.type === "true_false") return [question.answer ? "True" : "False"];
  if (question.type === "choice") return [String(question.answer ?? "")];
  if (question.type === "matching") return (question.items ?? []).map((item) => item.answer);
  if (question.type === "calculation") return question.searchKeywords ?? [];
  return (question.answers ?? []).flatMap((answer) => (Array.isArray(answer) ? answer : [answer])).map(String);
}

function questionSearchFields(question: QuizQuestion) {
  return [
    {
      weight: 12,
      texts: [
        ...answerSearchTexts(question),
        ...(question.searchKeywords ?? []),
        ...(question.images ?? []).map((image) => image.alt),
        ...(question.imageTable ?? []).flatMap((cell) => [cell.label, cell.alt]),
      ],
    },
    { weight: 6, texts: [question.prompt, filledPromptText(question)] },
    { weight: 4, texts: [...(question.choices ?? []), ...(question.items ?? []).map((item) => item.prompt)] },
    { weight: 3, texts: [question.id, question.canonicalId ?? "", question.date, question.test, `Question ${question.questionNumber}`] },
    { weight: 1, texts: [question.notes ?? ""] },
  ];
}

function lectureSearchFields(material: LectureMaterial) {
  return [
    { weight: 10, texts: [material.title, ...(material.keywords ?? [])] },
    { weight: 6, texts: [material.text] },
    { weight: 2, texts: [material.id, material.date, material.sourceName, material.sourceType, `${material.pageNumber}`] },
  ];
}

function isAsciiToken(token: string) {
  return /^[a-z0-9]+$/.test(token);
}

function fieldMatchesToken(fieldText: string, token: string) {
  if (!token) return false;
  if (isAsciiToken(token)) {
    return fieldText.split(" ").includes(token);
  }
  return fieldText.includes(token);
}

function fieldMatchesQuery(fieldText: string, normalizedQuery: string, queryTokens: string[]) {
  if (queryTokens.length === 1) return fieldMatchesToken(fieldText, queryTokens[0]);
  return fieldText.includes(normalizedQuery);
}

function scoreQuestion(question: QuizQuestion, normalizedQuery: string, queryTokens: string[]) {
  const fields = questionSearchFields(question).map((field) => ({
    weight: field.weight,
    texts: field.texts.map(normalizeSearchText).filter(Boolean),
  }));

  const matchedTokens = queryTokens.filter((token) => fields.some((field) => field.texts.some((text) => fieldMatchesToken(text, token))));
  const tokenScore = queryTokens.reduce((score, token) => {
    const bestWeight = fields.reduce((best, field) => {
      return field.texts.some((text) => fieldMatchesToken(text, token)) ? Math.max(best, field.weight) : best;
    }, 0);
    return score + bestWeight;
  }, 0);
  const phraseScore = fields.reduce((score, field) => {
    return field.texts.some((text) => fieldMatchesQuery(text, normalizedQuery, queryTokens)) ? Math.max(score, field.weight * 2) : score;
  }, 0);

  return {
    matchedTokens,
    score: tokenScore + phraseScore,
  };
}

function scoreLectureMaterial(material: LectureMaterial, normalizedQuery: string, queryTokens: string[]) {
  const fields = lectureSearchFields(material).map((field) => ({
    weight: field.weight,
    texts: field.texts.map(normalizeSearchText).filter(Boolean),
  }));

  const ignoredTokens = new Set(["a", "an", "and", "are", "for", "in", "is", "of", "the", "to", "with", ...lectureIgnoredTokens]);
  const effectiveTokens = queryTokens.length > 1 ? queryTokens.filter((token) => !ignoredTokens.has(token)) : queryTokens.filter((token) => !lectureIgnoredTokens.has(token));
  const tokens = effectiveTokens;
  if (tokens.length === 0) return { matchedTokens: [], score: 0 };
  const matchedTokens = tokens.filter((token) => fields.some((field) => field.texts.some((text) => fieldMatchesToken(text, token))));
  if (matchedTokens.length === 0) return { matchedTokens: [], score: 0 };
  const tokenScore = tokens.reduce((score, token) => {
    const bestWeight = fields.reduce((best, field) => {
      return field.texts.some((text) => fieldMatchesToken(text, token)) ? Math.max(best, field.weight) : best;
    }, 0);
    return score + bestWeight;
  }, 0);
  const phraseScore = fields.reduce((score, field) => {
    return field.texts.some((text) => fieldMatchesQuery(text, normalizedQuery, queryTokens)) ? Math.max(score, field.weight * 2) : score;
  }, 0);

  return {
    matchedTokens,
    score: tokenScore + phraseScore,
  };
}

function dateSortValue(question: QuizQuestion) {
  return dateValue(question.date);
}

function dateValue(date: string) {
  const match = date.match(/^(\d+)\.(\d+)$/);
  if (!match) return 0;
  return Number(match[1]) * 100 + Number(match[2]);
}

function compareQuestionOrder(a: QuizQuestion, b: QuizQuestion, direction: "newest" | "oldest") {
  const dateDelta = dateSortValue(a) - dateSortValue(b);
  if (dateDelta !== 0) return direction === "newest" ? -dateDelta : dateDelta;

  const testDelta = a.test.localeCompare(b.test, "ja", { numeric: true, sensitivity: "base" });
  if (testDelta !== 0) return testDelta;

  const questionDelta = a.questionNumber - b.questionNumber;
  if (questionDelta !== 0) return questionDelta;

  return a.id.localeCompare(b.id, "ja", { numeric: true, sensitivity: "base" });
}

function compareLectureMaterialOrder(a: LectureMaterial, b: LectureMaterial, direction: "newest" | "oldest") {
  const dateDelta = dateValue(a.date) - dateValue(b.date);
  if (dateDelta !== 0) return direction === "newest" ? -dateDelta : dateDelta;

  const sourceDelta = a.sourceName.localeCompare(b.sourceName, "ja", { numeric: true, sensitivity: "base" });
  if (sourceDelta !== 0) return sourceDelta;

  const pageDelta = a.pageNumber - b.pageNumber;
  if (pageDelta !== 0) return pageDelta;

  return a.id.localeCompare(b.id, "ja", { numeric: true, sensitivity: "base" });
}

function questionSearchQueryParts(query: string) {
  const rawParts = query
    .split(/\r?\n\s*-{3,}\s*\r?\n/g)
    .map((part) => normalizeSearchText(part))
    .filter(Boolean);
  const parts = rawParts.length > 1 ? rawParts : [normalizeSearchText(query)].filter(Boolean);
  return parts.map((normalizedQuery) => ({
    normalizedQuery,
    queryTokens: Array.from(new Set(normalizedQuery.split(" ").filter(Boolean))),
  }));
}

function searchQuestions(query: string, candidates: QuizQuestion[], sortMode: SearchSortMode) {
  const queryParts = questionSearchQueryParts(query);
  if (queryParts.length === 0) return [];

  return candidates
    .map((question) => {
      const best = queryParts
        .map((part) => scoreQuestion(question, part.normalizedQuery, part.queryTokens))
        .sort((a, b) => b.score - a.score || b.matchedTokens.length - a.matchedTokens.length)[0] ?? { score: 0, matchedTokens: [] };
      return {
        question,
        score: best.score,
        matchedTokens: best.matchedTokens,
      };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => {
      if (sortMode === "newest") return compareQuestionOrder(a.question, b.question, "newest") || b.score - a.score;
      if (sortMode === "oldest") return compareQuestionOrder(a.question, b.question, "oldest") || b.score - a.score;
      return b.score - a.score || compareQuestionOrder(a.question, b.question, "newest");
    });
}

function searchLectureMaterials(query: string, candidates: LectureMaterial[], sortMode: SearchSortMode) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  const queryTokens = Array.from(new Set(normalizedQuery.split(" ").filter(Boolean)));
  return candidates
    .map((material) => {
      const { score, matchedTokens } = scoreLectureMaterial(material, normalizedQuery, queryTokens);
      return {
        material,
        score,
        matchedTokens,
      };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => {
      if (sortMode === "newest") return compareLectureMaterialOrder(a.material, b.material, "newest") || b.score - a.score;
      if (sortMode === "oldest") return compareLectureMaterialOrder(a.material, b.material, "oldest") || b.score - a.score;
      return b.score - a.score || compareLectureMaterialOrder(a.material, b.material, "newest");
    });
}

function materialLocation(material: LectureMaterial) {
  return material.sourceType === "pdf" ? `p.${material.pageNumber}` : `slide ${material.pageNumber}`;
}

function materialExcerpt(material: LectureMaterial, matchedTokens: string[]) {
  const text = material.text;
  if (text.length <= 360) return text;
  const normalized = normalizeSearchText(text);
  const token = matchedTokens.find((candidate) => normalized.includes(candidate));
  if (!token) return `${text.slice(0, 360)}...`;

  const index = Math.max(0, normalized.indexOf(token));
  const start = Math.max(0, index - 120);
  const end = Math.min(text.length, start + 360);
  return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function materialMatchRange(text: string, matchedTokens: string[]) {
  for (const token of matchedTokens) {
    if (!token) continue;
    if (isAsciiToken(token)) {
      const match = new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").exec(text);
      if (match) return { index: match.index, length: match[0].length };
    } else {
      const normalizedText = text.normalize("NFKC");
      const normalizedToken = token.normalize("NFKC");
      const index = normalizedText.indexOf(normalizedToken);
      if (index >= 0) return { index, length: normalizedToken.length };
    }
  }
  return null;
}

function sameLectureSourceMaterials(material: LectureMaterial) {
  return lectureMaterials
    .filter((candidate) => (
      candidate.date === material.date
      && candidate.sourceName === material.sourceName
      && candidate.sourceType === material.sourceType
    ))
    .sort((a, b) => a.pageNumber - b.pageNumber);
}

function LectureMaterialText({
  material,
  matchedTokens,
  expanded,
}: {
  material: LectureMaterial;
  matchedTokens: string[];
  expanded: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const matchRef = useRef<HTMLSpanElement | null>(null);
  const matchRange = materialMatchRange(material.text, matchedTokens);

  useEffect(() => {
    if (!expanded || !containerRef.current || !matchRef.current) return;
    const container = containerRef.current;
    const target = matchRef.current;
    container.scrollTop = Math.max(0, target.offsetTop - container.clientHeight / 2);
  }, [expanded, material.id, matchRange?.index]);

  if (!expanded) {
    return <p className="search-question-text">{materialExcerpt(material, matchedTokens)}</p>;
  }

  if (!matchRange) {
    return (
      <div className="lecture-detail-text" ref={containerRef} onClick={(event) => event.stopPropagation()}>
        {material.text}
      </div>
    );
  }

  const before = material.text.slice(0, matchRange.index);
  const matched = material.text.slice(matchRange.index, matchRange.index + matchRange.length);
  const after = material.text.slice(matchRange.index + matchRange.length);

  return (
    <div className="lecture-detail-text" ref={containerRef} onClick={(event) => event.stopPropagation()}>
      {before}
      <span className="lecture-match" ref={matchRef}>{matched}</span>
      {after}
    </div>
  );
}

function LectureSourceText({
  activeMaterial,
  matchedTokens,
}: {
  activeMaterial: LectureMaterial;
  matchedTokens: string[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLSpanElement | null>(null);
  const sourceMaterials = useMemo(() => sameLectureSourceMaterials(activeMaterial), [activeMaterial]);
  const targetMaterial = sourceMaterials.find((material) => (
    material.id === activeMaterial.id && materialMatchRange(material.text, matchedTokens)
  )) ?? sourceMaterials.find((material) => materialMatchRange(material.text, matchedTokens)) ?? activeMaterial;

  useEffect(() => {
    if (!containerRef.current || !targetRef.current) return;
    const container = containerRef.current;
    const target = targetRef.current;
    container.scrollTop = Math.max(0, target.offsetTop - container.clientHeight / 2);
  }, [activeMaterial.id, targetMaterial.id, matchedTokens.join("|")]);

  return (
    <div className="lecture-detail-text lecture-source-text" ref={containerRef}>
      {sourceMaterials.map((material) => {
        const matchRange = materialMatchRange(material.text, matchedTokens);
        const shouldMarkTarget = material.id === targetMaterial.id && matchRange;
        const before = matchRange ? material.text.slice(0, matchRange.index) : material.text;
        const matched = matchRange ? material.text.slice(matchRange.index, matchRange.index + matchRange.length) : "";
        const after = matchRange ? material.text.slice(matchRange.index + matchRange.length) : "";

        return (
          <section key={material.id} className="lecture-section">
            <h3 className="lecture-section-heading">{materialLocation(material)}</h3>
            {matchRange ? (
              <p>
                {before}
                <span className="lecture-match" ref={shouldMarkTarget ? targetRef : undefined}>{matched}</span>
                {after}
              </p>
            ) : (
              <p>{material.text}</p>
            )}
          </section>
        );
      })}
    </div>
  );
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

function QuestionImageTable({ cells }: { cells: QuizQuestion["imageTable"] }) {
  if (!cells || cells.length === 0) return null;
  return (
    <div className="question-image-table-scroll" aria-label="問題画像の表">
      <table className="question-image-table">
        <thead>
          <tr>
            {cells.map((cell) => <th key={cell.label} scope="col">{cell.label}</th>)}
          </tr>
        </thead>
        <tbody>
          <tr>
            {cells.map((cell) => (
              <td key={cell.label}>
                <img src={cell.src} alt={cell.alt} />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
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
        <QuestionImageTable cells={question.imageTable} />

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

function DynamicAnswerResultCard({ result }: { result: DynamicAnswerTemplateResult }) {
  return (
    <article className="search-result dynamic-answer-result">
      <div className="question-meta">
        <span>可変問題として検出</span>
        <span>{result.kind === "calculation" ? "計算" : "辞書"}</span>
        <span>{result.title}</span>
      </div>
      <h2 className="lecture-title">{result.title}</h2>
      {result.extracted.length > 0 && (
        <dl className="dynamic-answer-grid">
          {result.extracted.map((item) => (
            <div key={`${item.label}-${item.value}`}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <ol className="answer-list dynamic-answer-list">
        {result.answers.map((answer) => (
          <li key={`${answer.label}-${answer.value}`}>
            <strong>{answer.label}: </strong>
            {answer.value}
          </li>
        ))}
      </ol>
      {result.formulaLines && result.formulaLines.length > 0 && (
        <div className="formula-box">
          {result.formulaLines.map((line) => (
            <code key={line}>{line}</code>
          ))}
        </div>
      )}
      <p className="match-hint">一致: {result.matchedTokens.slice(0, 8).join(", ")}</p>
      {result.notes && <p className="notes">{result.notes}</p>}
    </article>
  );
}

function SearchPage() {
  const [query, setQuery] = useState("");
  const [questionSearchEnabled, setQuestionSearchEnabled] = useState(false);
  const [isSearchSettingsOpen, setIsSearchSettingsOpen] = useState(false);
  const [searchPlatformFilter, setSearchPlatformFilter] = useState<PlatformFilter>("all");
  const [searchSortMode, setSearchSortMode] = useState<SearchSortMode>("relevance");
  const [visibleCount, setVisibleCount] = useState(SEARCH_BATCH_SIZE);
  const [activeMaterialDetail, setActiveMaterialDetail] = useState<{
    material: LectureMaterial;
    matchedTokens: string[];
  } | null>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const searchTargetMode: SearchTargetMode = questionSearchEnabled ? "questions" : "lectures";
  const normalizedQuery = normalizeSearchText(query);
  const searchableQuestions = useMemo(
    () => allQuestions.filter((question) => searchPlatformFilter === "all" || question.platform === searchPlatformFilter),
    [searchPlatformFilter],
  );
  const questionResults = useMemo(() => searchQuestions(query, searchableQuestions, searchSortMode), [query, searchableQuestions, searchSortMode]);
  const dynamicAnswerResults = useMemo(() => matchDynamicAnswerTemplates(query), [query]);
  const lectureResults = useMemo(() => searchLectureMaterials(query, lectureMaterials, searchSortMode), [query, searchSortMode]);
  const activeResultCount = searchTargetMode === "questions" ? dynamicAnswerResults.length + questionResults.length : lectureResults.length;
  const activeTargetCount = searchTargetMode === "questions" ? searchableQuestions.length : lectureMaterials.length;
  const visibleResultCount = Math.min(visibleCount, activeResultCount);
  const visibleDynamicResults = searchTargetMode === "questions" ? dynamicAnswerResults.slice(0, visibleCount) : [];
  const visibleQuestionResults = questionResults.slice(0, Math.max(0, visibleCount - visibleDynamicResults.length));
  const visibleLectureResults = lectureResults.slice(0, visibleCount);

  useEffect(() => {
    setVisibleCount(SEARCH_BATCH_SIZE);
    setActiveMaterialDetail(null);
  }, [query, questionSearchEnabled, searchPlatformFilter, searchSortMode]);

  useEffect(() => {
    if (!activeMaterialDetail) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setActiveMaterialDetail(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeMaterialDetail]);

  useEffect(() => {
    if (!isSearchSettingsOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsSearchSettingsOpen(false);
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (settingsRef.current?.contains(target) || settingsButtonRef.current?.contains(target)) return;
      setIsSearchSettingsOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isSearchSettingsOpen]);

  return (
    <section className="search-page">
      <section className="search-panel">
        <div className="search-header">
          <h2>講義資料検索</h2>
        </div>
        <label className="search-box">
          検索文字列
          <textarea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            rows={8}
            placeholder="任意の文字列またはキーワードを入力"
          />
        </label>
        <div className="search-actions">
          <button type="button" onClick={() => setQuery("")} disabled={!query}>
            クリア
          </button>
          <div className="search-filter">
            <label>
              並び順
              <select
                value={searchSortMode}
                onChange={(event) => setSearchSortMode(event.target.value as SearchSortMode)}
              >
                {Object.entries(searchSortLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <span>
              {normalizedQuery
                ? `${visibleResultCount} / ${activeResultCount}件表示（対象:${activeTargetCount}）`
                : `対象:${activeTargetCount}`}
            </span>
            <button
              ref={settingsButtonRef}
              type="button"
              className="settings-button settings-fab"
              aria-label="設定"
              aria-expanded={isSearchSettingsOpen}
              onClick={() => setIsSearchSettingsOpen((current) => !current)}
            >
              <svg className="gear-icon" aria-hidden="true" viewBox="0 0 24 24">
                <path d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a8 8 0 0 0-2.6-1.5L14 2h-4l-.4 3a8 8 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5a8.6 8.6 0 0 0 0 3l-2 1.5 2 3.5 2.4-1a8 8 0 0 0 2.6 1.5l.4 3h4l.4-3a8 8 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z" />
              </svg>
            </button>
          </div>
        </div>
        {isSearchSettingsOpen && (
          <div className="search-settings" ref={settingsRef}>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={questionSearchEnabled}
                onChange={(event) => setQuestionSearchEnabled(event.target.checked)}
              />
              <span>小テストの正答検索を有効にする</span>
            </label>
            {questionSearchEnabled && (
              <label>
                版
                <select
                  value={searchPlatformFilter}
                  onChange={(event) => setSearchPlatformFilter(event.target.value as PlatformFilter)}
                >
                  {Object.entries(platformLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
      </section>

      {!normalizedQuery && (
        <section className="empty-state">
          キーワードや問題文を貼り付けると、関連する講義資料ページが表示されます。
        </section>
      )}

      {normalizedQuery && activeResultCount === 0 && (
        <section className="empty-state">
          {searchTargetMode === "questions" ? "一致する問題が見つかりませんでした。" : "一致する講義資料が見つかりませんでした。"}
        </section>
      )}

      {normalizedQuery && visibleDynamicResults.length > 0 && (
        <div className="search-results">
          {visibleDynamicResults.map((result) => (
            <DynamicAnswerResultCard key={result.id} result={result} />
          ))}
        </div>
      )}

      {searchTargetMode === "questions" && questionResults.length > 0 && (
        <>
          <div className="search-results">
            {visibleQuestionResults.map(({ question, matchedTokens }) => (
              <article key={question.id} className="search-result">
                <div className="question-meta">
                  <span>{question.date} {question.test}</span>
                  <span>{platformLabel(question.platform)}</span>
                  <span>Q{question.questionNumber}</span>
                  <span>{questionTypeLabel(question.type)}</span>
                </div>
                <QuestionImages images={question.images} />
                <QuestionImageTable cells={question.imageTable} />
                <p className="search-question-text">{filledPromptText(question)}</p>
                <ol className="answer-list">
                  {answerLinesForSearch(question, query).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ol>
                <p className="match-hint">一致: {matchedTokens.slice(0, 8).join(", ")}</p>
                {question.notes && <p className="notes">{question.notes}</p>}
              </article>
            ))}
          </div>
          {visibleResultCount < activeResultCount && (
            <div className="load-more">
              <button
                type="button"
                onClick={() => setVisibleCount((current) => Math.min(current + SEARCH_BATCH_SIZE, activeResultCount))}
              >
                次の15件を表示
              </button>
            </div>
          )}
        </>
      )}

      {searchTargetMode === "lectures" && lectureResults.length > 0 && (
        <>
          <div className="search-results">
            {visibleLectureResults.map(({ material, matchedTokens }) => (
              <article
                key={material.id}
                className="search-result lecture-result"
                role="button"
                tabIndex={0}
                aria-haspopup="dialog"
                onClick={() => setActiveMaterialDetail({ material, matchedTokens })}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setActiveMaterialDetail({ material, matchedTokens });
                  }
                }}
              >
                <div className="question-meta">
                  <span>{material.date}</span>
                  <span>{material.sourceName}</span>
                  <span>{materialLocation(material)}</span>
                  <span>{material.sourceType.toUpperCase()}</span>
                </div>
                <QuestionImages images={material.images} />
                <h2 className="lecture-title">{material.title}</h2>
                <LectureMaterialText
                  material={material}
                  matchedTokens={matchedTokens}
                  expanded={false}
                />
                {material.keywords.length > 0 && (
                  <p className="lecture-keywords">キーワード: {material.keywords.slice(0, 10).join(", ")}</p>
                )}
                <p className="match-hint">一致: {matchedTokens.slice(0, 8).join(", ")}</p>
                <p className="detail-hint">クリックで詳細表示</p>
              </article>
            ))}
          </div>
          {visibleResultCount < lectureResults.length && (
            <div className="load-more">
              <button
                type="button"
                onClick={() => setVisibleCount((current) => Math.min(current + SEARCH_BATCH_SIZE, lectureResults.length))}
              >
                次の15件を表示
              </button>
            </div>
          )}
        </>
      )}

      {activeMaterialDetail && (
        <div
          className="modal-backdrop"
          role="presentation"
        >
          <section
            className="material-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="material-modal-title"
          >
            <button
              type="button"
              className="modal-close"
              aria-label="詳細を閉じる"
              onClick={() => setActiveMaterialDetail(null)}
            >
              ×
            </button>
            <div className="material-modal-header">
              <div>
                <div className="question-meta">
                  <span>{activeMaterialDetail.material.date}</span>
                  <span>{activeMaterialDetail.material.sourceName}</span>
                  <span>{materialLocation(activeMaterialDetail.material)}</span>
                  <span>{activeMaterialDetail.material.sourceType.toUpperCase()}</span>
                </div>
                <h2 id="material-modal-title" className="lecture-title">{activeMaterialDetail.material.title}</h2>
              </div>
            </div>
            <QuestionImages images={activeMaterialDetail.material.images} />
            <LectureSourceText
              activeMaterial={activeMaterialDetail.material}
              matchedTokens={activeMaterialDetail.matchedTokens}
            />
            {activeMaterialDetail.material.keywords.length > 0 && (
              <p className="lecture-keywords">キーワード: {activeMaterialDetail.material.keywords.slice(0, 12).join(", ")}</p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}

export default function App() {
  const restoredQuizState = useMemo(() => loadStoredQuizState(), []);
  const [page, setPage] = useState<AppPage>(() => pageFromHash());
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>(restoredQuizState?.platformFilter ?? "moodle");
  const [mode, setMode] = useState<SessionMode>(restoredQuizState?.mode ?? "single");
  const [selectedQuizKey, setSelectedQuizKey] = useState(() => restoredQuizState?.selectedQuizKey ?? quizKey(quizzes[0]));
  const [questionCount, setQuestionCount] = useState(restoredQuizState?.questionCount ?? 10);
  const [session, setSession] = useState<QuizQuestion[]>(restoredQuizState?.session ?? []);
  const [answers, setAnswers] = useState<AnswerMap>(restoredQuizState?.answers ?? {});
  const [currentIndex, setCurrentIndex] = useState(restoredQuizState?.currentIndex ?? 0);
  const [viewMode, setViewMode] = useState<ViewMode>(restoredQuizState?.viewMode ?? "setup");
  const [attempts, setAttempts] = useState(() => loadAttempts());
  const [reviewIds, setReviewIds] = useState(() => loadReviewIds());

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
  const activeReviewQuestions = useMemo(() => {
    const ids = new Set(reviewIds);
    return activeQuestions.filter((question) => ids.has(question.id));
  }, [activeQuestions, reviewIds]);
  const canStart = mode !== "review" || activeReviewQuestions.length > 0;

  const reviewCount = useMemo(() => {
    const validIds = new Set(allQuestions.map((question) => question.id));
    return reviewIds.filter((id) => validIds.has(id)).length;
  }, [reviewIds]);

  useEffect(() => {
    if (viewMode === "setup" || session.length === 0) {
      localStorage.removeItem(QUIZ_STATE_STORAGE_KEY);
      return;
    }
    const stored: StoredQuizState = {
      platformFilter,
      mode,
      selectedQuizKey,
      questionCount,
      questionIds: session.map((question) => question.id),
      answers,
      currentIndex,
      viewMode,
    };
    localStorage.setItem(QUIZ_STATE_STORAGE_KEY, JSON.stringify(stored));
  }, [answers, currentIndex, mode, platformFilter, questionCount, selectedQuizKey, session, viewMode]);

  function buildSession() {
    const count = Math.min(Math.max(questionCount, 1), maxCount);
    if (mode === "single") return [...(selectedQuiz?.questions ?? [])].sort((a, b) => a.questionNumber - b.questionNumber);
    if (mode === "review") return [...activeReviewQuestions].sort((a, b) => compareQuestionOrder(a, b, "newest"));
    if (mode === "balanced") return buildBalancedSet(activeQuizzes, count);
    return shuffle(activeQuestions).slice(0, count);
  }

  function startSession() {
    const nextSession = buildSession();
    if (nextSession.length === 0) return;
    setSession(nextSession);
    setAnswers(Object.fromEntries(nextSession.map((question) => [question.id, defaultAnswer(question)])));
    setCurrentIndex(0);
    setViewMode("quiz");
  }

  function finishSession() {
    let nextAttempts = attempts;
    let nextReviewIds = reviewIds;
    session.forEach((question) => {
      const isCorrect = gradeQuestion(question, answers[question.id]);
      nextAttempts = saveAttempt(question.id, isCorrect);
      nextReviewIds = saveReviewResult(question.id, isCorrect);
    });
    setAttempts(nextAttempts);
    setReviewIds(nextReviewIds);
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
            <h1>メカトロニクステスト対策</h1>
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

          {(mode === "balanced" || mode === "random") && (
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

          <button type="button" className="primary" onClick={startSession} disabled={!canStart}>
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
        <div><span>要復習</span><strong>{reviewCount}</strong></div>
      </section>

      {viewMode === "setup" && (
        <section className="empty-state">
          {mode === "review" && activeReviewQuestions.length === 0
            ? "要復習に登録されている問題はありません。"
            : "出題モードを選んで「開始」を押すと問題が表示されます。"}
        </section>
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
