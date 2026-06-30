export type DynamicAnswerTemplateResult = {
  id: string;
  title: string;
  kind: "lookup" | "calculation";
  confidence: number;
  matchedTokens: string[];
  extracted: Array<{
    label: string;
    value: string;
  }>;
  answers: Array<{
    label: string;
    value: string;
  }>;
  formulaLines?: string[];
  notes?: string;
};

type SiUnitEntry = {
  quantity: string;
  aliases: string[];
  unit: string;
  abbreviation: string;
};

const siBaseUnits: SiUnitEntry[] = [
  { quantity: "length", aliases: ["length"], unit: "metre", abbreviation: "m" },
  { quantity: "mass", aliases: ["mass"], unit: "kilogram", abbreviation: "kg" },
  { quantity: "time", aliases: ["time"], unit: "second", abbreviation: "s" },
  { quantity: "electric current", aliases: ["electric current", "electrical current", "current"], unit: "ampere", abbreviation: "A" },
  { quantity: "thermodynamic temperature", aliases: ["thermodynamic temperature", "temperature"], unit: "kelvin", abbreviation: "K" },
  { quantity: "amount of substance", aliases: ["amount of substance", "substance amount"], unit: "mole", abbreviation: "mol" },
  { quantity: "luminous intensity", aliases: ["luminous intensity"], unit: "candela", abbreviation: "cd" },
];

function normalizeTemplateText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/(?:answer|回答)\s*\d+\s*(?:question|問題)\s*\d+/gi, " ")
    .replace(/\{\{\d+\}\}/g, " ")
    .replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~©®™、。・「」『』（）［］【】－―–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function includesAny(text: string, candidates: string[]) {
  return candidates.some((candidate) => text.includes(candidate));
}

function formatNumber(value: number, decimals: number) {
  return value.toFixed(decimals);
}

function rounded(value: number, decimals: number) {
  const multiplier = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

function extractNumber(text: string, pattern: RegExp) {
  const match = pattern.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function matchSiUnitTemplate(normalizedQuery: string): DynamicAnswerTemplateResult | null {
  if (!includesAny(normalizedQuery, ["unit of", "abbreviation"])) return null;

  const explicitQuantity = /unit of ([a-z ]+?) is\b/i.exec(normalizedQuery)?.[1]?.trim();
  const entry = siBaseUnits.find((candidate) => {
    if (explicitQuantity && candidate.aliases.includes(explicitQuantity)) return true;
    return candidate.aliases.some((alias) => normalizedQuery.includes(alias));
  });
  if (!entry) return null;

  return {
    id: `si-base-unit-${entry.quantity.replace(/\s+/g, "-")}`,
    title: "SI基本単位",
    kind: "lookup",
    confidence: explicitQuantity ? 120 : 95,
    matchedTokens: ["unit", "abbreviation", entry.quantity],
    extracted: [{ label: "physical quantity", value: entry.quantity }],
    answers: [
      { label: "unit name", value: entry.unit },
      { label: "abbreviation", value: entry.abbreviation },
    ],
    notes: "表記ゆれ対策として current / electrical current などの別名も同じ物理量として扱います。",
  };
}

function matchSamplingRateTemplate(rawQuery: string, normalizedQuery: string): DynamicAnswerTemplateResult | null {
  if (!includesAny(normalizedQuery, ["sampling rate", "sampled every", "sampled"])) return null;

  const intervalMs = extractNumber(
    rawQuery,
    /every\s+([0-9]+(?:\.[0-9]+)?)\s*(?:milli\s*seconds?|milliseconds?|miliseconds?|msec|ms)\b/i,
  );
  if (intervalMs === null || intervalMs === 0) return null;

  const frequency = Math.round(1000 / intervalMs);
  return {
    id: "sampling-rate-from-interval",
    title: "Sampling rate",
    kind: "calculation",
    confidence: 130,
    matchedTokens: ["sampling", "rate", "milliseconds"],
    extracted: [{ label: "sampling interval T", value: `${intervalMs} ms` }],
    answers: [{ label: "sampling rate F", value: String(frequency) }],
    formulaLines: [
      "F = 1 / T",
      "T is given in milliseconds, so F = 1000 / T",
      `F = 1000 / ${intervalMs} = ${1000 / intervalMs}`,
      "Rounded to the nearest integer.",
    ],
    notes: "millisecond / milliseconds / milli seconds / ms / miliseconds を同じ単位として扱います。",
  };
}

function matchSamplingPeriodTemplate(rawQuery: string, normalizedQuery: string): DynamicAnswerTemplateResult | null {
  if (!includesAny(normalizedQuery, ["sampling period", "sampled at"])) return null;

  const frequencyHz = extractNumber(
    rawQuery,
    /sampled\s+at\s+([0-9]+(?:\.[0-9]+)?)\s*(?:hertz|hz)\b/i,
  ) ?? extractNumber(rawQuery, /sampling\s+(?:rate|frequency)\s*(?:is|=|:)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:hertz|hz)\b/i);
  if (frequencyHz === null || frequencyHz === 0) return null;

  const periodMs = 1000 / frequencyHz;
  return {
    id: "sampling-period-from-frequency",
    title: "Sampling period",
    kind: "calculation",
    confidence: 130,
    matchedTokens: ["sampling", "period", "hertz"],
    extracted: [{ label: "sampling frequency F", value: `${frequencyHz} Hz` }],
    answers: [{ label: "sampling period T", value: String(Math.round(periodMs)) }],
    formulaLines: [
      "T = 1 / F",
      "The answer is requested in milliseconds, so T = 1000 / F",
      `T = 1000 / ${frequencyHz} = ${periodMs}`,
      "Rounded to the nearest integer.",
    ],
    notes: "sampled at / sampling rate / sampling frequency と Hz / hertz の表記ゆれを同じ意味として扱います。",
  };
}

function extractAdcValues(rawQuery: string) {
  const bits = extractNumber(rawQuery, /([0-9]+)\s*[- ]?\s*bit\s+adc/i);
  const rangeMatch = /ranging\s+from\s+(-?[0-9]+(?:\.[0-9]+)?)\s+to\s+(-?[0-9]+(?:\.[0-9]+)?)\s*(?:volts?|v)\b/i.exec(rawQuery);
  const minVoltage = rangeMatch ? Number(rangeMatch[1]) : null;
  const maxVoltage = rangeMatch ? Number(rangeMatch[2]) : null;
  const inputVoltage = extractNumber(rawQuery, /analog\s+input\s+is\s+(-?[0-9]+(?:\.[0-9]+)?)\s*(?:volts?|v)\b/i);

  if (bits === null || minVoltage === null || maxVoltage === null) return null;
  return {
    bits,
    minVoltage,
    maxVoltage,
    inputVoltage,
  };
}

function matchAdcTemplate(rawQuery: string, normalizedQuery: string): DynamicAnswerTemplateResult | null {
  if (!includesAny(normalizedQuery, ["adc", "quantization", "quantisation", "quantizer"])) return null;
  const values = extractAdcValues(rawQuery);
  if (!values) return null;

  const levels = 2 ** values.bits;
  const stepSize = (values.maxVoltage - values.minVoltage) / (levels - 1);
  const wantsLevels = includesAny(normalizedQuery, ["number of quantization levels", "quantization levels", "levels l"]);
  const wantsStep = includesAny(normalizedQuery, ["step size", "quantizer"]);
  const wantsLevelValue = /\bquantization level\b/.test(normalizedQuery) || /\bxq\b/.test(normalizedQuery);
  const answers: DynamicAnswerTemplateResult["answers"] = [];
  const formulaLines: string[] = [
    `L = 2^${values.bits} = ${levels}`,
    `Delta = (${values.maxVoltage} - ${values.minVoltage}) / (L - 1) = ${stepSize}`,
  ];

  if (wantsLevels || (!wantsStep && !wantsLevelValue)) {
    answers.push({ label: "number of quantization levels L", value: String(levels) });
  }
  if (wantsStep || (!wantsLevels && !wantsLevelValue)) {
    answers.push({ label: "step size Delta", value: formatNumber(rounded(stepSize, 2), 2) });
  }
  if ((wantsLevelValue || (!wantsLevels && !wantsStep)) && values.inputVoltage !== null) {
    const index = Math.round((values.inputVoltage - values.minVoltage) / stepSize);
    const quantized = values.minVoltage + index * stepSize;
    answers.push({ label: "quantization level xq", value: formatNumber(rounded(quantized, 2), 2) });
    formulaLines.push(`xq = round((${values.inputVoltage} - ${values.minVoltage}) / Delta) * Delta + ${values.minVoltage}`);
    formulaLines.push(`xq = ${quantized}`);
  }

  return {
    id: "adc-quantization",
    title: "ADC quantization",
    kind: "calculation",
    confidence: 125,
    matchedTokens: ["adc", "quantization", "bit"],
    extracted: [
      { label: "ADC bits", value: String(values.bits) },
      { label: "range", value: `${values.minVoltage} to ${values.maxVoltage} V` },
      ...(values.inputVoltage === null ? [] : [{ label: "analog input", value: `${values.inputVoltage} V` }]),
    ],
    answers,
    formulaLines,
  };
}

function matchImpedancePowerTemplate(rawQuery: string, normalizedQuery: string): DynamicAnswerTemplateResult | null {
  if (!includesAny(normalizedQuery, ["input impedance", "output impedance", "light bulb", "electric power"])) return null;

  const inputImpedance = extractNumber(rawQuery, /(?:input\s+impedance\s*,?\s*)?r\s*[iı]\s*[=＝]\s*([0-9]+(?:\.[0-9]+)?)/i)
    ?? extractNumber(rawQuery, /input\s+impedance\s*(?:is|,|=)?\s*([0-9]+(?:\.[0-9]+)?)/i);
  const outputImpedance = extractNumber(rawQuery, /(?:output\s+impedance\s*,?\s*)?r\s*(?:0|o)\s*[=＝]\s*([0-9]+(?:\.[0-9]+)?)/i)
    ?? extractNumber(rawQuery, /output\s+impedance\s*(?:is|,|=)?\s*([0-9]+(?:\.[0-9]+)?)/i);
  const voltage = extractNumber(rawQuery, /battery\s*([0-9]+(?:\.[0-9]+)?)\s*v/i)
    ?? extractNumber(rawQuery, /\b([0-9]+(?:\.[0-9]+)?)\s*v\b/i)
    ?? 12;

  if (inputImpedance === null || outputImpedance === null) return null;

  const current = voltage / (inputImpedance + outputImpedance);
  const power = current ** 2 * inputImpedance;
  return {
    id: "impedance-light-bulb-power",
    title: "Input/output impedance circuit",
    kind: "calculation",
    confidence: 125,
    matchedTokens: ["input", "output", "impedance", "power"],
    extracted: [
      { label: "input impedance Ri", value: String(inputImpedance) },
      { label: "output impedance Ro", value: String(outputImpedance) },
      { label: "battery voltage U", value: `${voltage} V` },
    ],
    answers: [{ label: "electric power Pi", value: formatNumber(rounded(power, 1), 1) }],
    formulaLines: [
      "I = U / (Ri + Ro)",
      "Pi = I^2 * Ri",
      `I = ${voltage} / (${inputImpedance} + ${outputImpedance}) = ${current}`,
      `Pi = ${current}^2 * ${inputImpedance} = ${power}`,
      "Rounded to the 1st decimal place.",
    ],
    notes: "R0 / Ro、Ri / R_i などの表記ゆれを吸収します。電圧が本文から読めない場合は図の 12 V として扱います。",
  };
}

export function matchDynamicAnswerTemplates(query: string) {
  const normalizedQuery = normalizeTemplateText(query);
  if (!normalizedQuery) return [];

  return [
    matchSiUnitTemplate(normalizedQuery),
    matchSamplingRateTemplate(query, normalizedQuery),
    matchSamplingPeriodTemplate(query, normalizedQuery),
    matchAdcTemplate(query, normalizedQuery),
    matchImpedancePowerTemplate(query, normalizedQuery),
  ]
    .filter((result): result is DynamicAnswerTemplateResult => Boolean(result))
    .sort((a, b) => b.confidence - a.confidence || a.title.localeCompare(b.title, "ja", { numeric: true }));
}
