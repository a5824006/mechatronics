export type PastedMatchingItem = {
  prompt: string;
  answer: string;
};

function normalizePastedValue(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~©®™、。・「」『』（）［］【】－―–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function matchingItemsInPastedAnswerOrder<T extends PastedMatchingItem>(items: T[], query: string) {
  const lines = query
    .normalize("NFKC")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const ordered: Array<{ answerNumber: number; item: T }> = [];
  const seenPrompts = new Set<string>();

  for (let index = 1; index < lines.length - 1; index += 1) {
    const marker = lines[index].match(/^(?:answer|回答)\s*(\d+)\s*(?:question|問題)\s*\d+$/i);
    if (!marker) continue;

    const prompt = normalizePastedValue(lines[index - 1]);
    const answer = normalizePastedValue(lines[index + 1]);
    const item = items.find((candidate) => (
      normalizePastedValue(candidate.prompt) === prompt
      && normalizePastedValue(candidate.answer) === answer
    ));
    if (!item || seenPrompts.has(item.prompt)) continue;

    ordered.push({ answerNumber: Number(marker[1]), item });
    seenPrompts.add(item.prompt);
  }

  if (ordered.length < 2) return null;
  ordered.sort((a, b) => a.answerNumber - b.answerNumber);
  return [...ordered.map(({ item }) => item), ...items.filter((item) => !seenPrompts.has(item.prompt))];
}
