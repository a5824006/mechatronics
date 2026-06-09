import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

globalThis.DOMMatrix ??= class DOMMatrix {};
globalThis.ImageData ??= class ImageData {};
globalThis.Path2D ??= class Path2D {};

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const lectureRoot = process.env.LECTURE_SOURCE_DIR ?? "C:\\Users\\lfant\\メカトロニクス\\講義資料";
const outputPath = path.join(repoRoot, "src", "data", "lectures", "materials.json");
const lectureTitles = new Map([
  ["Mechatronics-4-14.pdf", "Introduction to Mechatronics"],
  ["Mechatronics-4-21.pdf", "Basic knowledge About Sensors (1)"],
  ["Mechatronics-4-28.pdf", "Basic knowledge About Sensors (2)"],
  ["Mechatronics-5-12.pptx", "Basic knowledge of digital circuits required for mechatronics"],
  ["Suuplementary-diode_transistor_dff.pptx", "Suplementary: diode / transistor difference"],
  ["Mechatronics-5-19.pdf", "Basic Knowledge about Electrical Engineering"],
  ["Mechatronics-5-26.pdf", "Basic knowledge about actuators"],
  ["Mechatronics-6-9.pdf", "Computer technology required to understand mechatronics"],
]);

const stopWords = new Set([
  "about", "after", "again", "also", "and", "are", "basic", "been", "before", "being", "between", "can",
  "class", "due", "each", "for", "from", "have", "into", "its", "lesson", "more", "not", "one", "part",
  "required", "since", "than", "that", "the", "their", "then", "there", "this", "today", "university",
  "using", "was", "with", "will", "you", "2013", "2016", "aoyama", "gakuin", "guillaume", "lopez",
  "mechatronics", "iit", "dpt",
]);

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function removeFooterText(value) {
  return normalizeWhitespace(value
    .replace(/©2016\s+Aoyama\s+Gakuin\s+University\s+IIT\s+Dpt\s+-\s+Mechatronics\s+-\s+Guillaume\s+LOPEZ\s*\d*/gi, " ")
    .replace(/Aoyama\s+Gakuin\s+University\s+IIT\s+Dpt\s+-\s+Mechatronics\s+-\s+Guillaume\s+LOPEZ\s*\d*/gi, " ")
    .replace(/since\s+(?:2013\s+)?\d*\s*Aoyama\s+Gakuin\s+University\s+-\s+Guillaume\s+Lopez\s*\d*/gi, " ")
    .replace(/©2016/gi, " "));
}

function toDateFromPath(filePath) {
  const parent = path.basename(path.dirname(filePath));
  return /^\d+\.\d+$/.test(parent) ? parent : "";
}

function naturalSort(a, b) {
  return a.localeCompare(b, "ja", { numeric: true, sensitivity: "base" });
}

async function walk(dir) {
  const entries = await readdir(dir);
  const files = [];
  for (const entry of entries.sort(naturalSort)) {
    const fullPath = path.join(dir, entry);
    const info = await stat(fullPath);
    if (info.isDirectory()) {
      files.push(...await walk(fullPath));
    } else if (/\.(pdf|pptx)$/i.test(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

function titleForSource(sourceName) {
  return lectureTitles.get(sourceName) ?? sourceName.replace(/\.[^.]+$/, "");
}

function keywordsFromText(title, text) {
  const tokens = `${title} ${text}`
    .normalize("NFKC")
    .toLowerCase()
    .match(/[a-z][a-z0-9+-]{2,}|[0-9]+(?:\.[0-9]+)?|[\u3040-\u30ff\u3400-\u9fff]{2,}/g) ?? [];
  const counts = new Map();
  for (const token of tokens) {
    if (stopWords.has(token) || token.length > 32) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || naturalSort(a[0], b[0]))
    .slice(0, 14)
    .map(([token]) => token);
}

async function extractPdf(filePath) {
  const data = new Uint8Array(await readFile(filePath));
  const document = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  const date = toDateFromPath(filePath);
  const sourceName = path.basename(filePath);
  const materials = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = removeFooterText(content.items.map((item) => item.str).join(" "));
    if (!text) continue;
    const title = titleForSource(sourceName);
    materials.push({
      id: `${date}-${sourceName.replace(/\.[^.]+$/, "")}-p${pageNumber}`,
      date,
      sourceName,
      sourceType: "pdf",
      pageNumber,
      title,
      text,
      keywords: keywordsFromText(title, text),
    });
  }

  return materials;
}

function decodeXmlText(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractSlideText(xml) {
  const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => decodeXmlText(match[1] ?? ""));
  return removeFooterText(texts.join(" "));
}

async function extractPptx(filePath) {
  const zip = await JSZip.loadAsync(await readFile(filePath));
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)/)?.[1] ?? 0) - Number(b.match(/slide(\d+)/)?.[1] ?? 0));
  const date = toDateFromPath(filePath);
  const sourceName = path.basename(filePath);
  const materials = [];

  for (const slideName of slideNames) {
    const pageNumber = Number(slideName.match(/slide(\d+)/)?.[1] ?? 0);
    const file = zip.file(slideName);
    if (!file) continue;
    const text = extractSlideText(await file.async("text"));
    if (!text) continue;
    const title = titleForSource(sourceName);
    materials.push({
      id: `${date}-${sourceName.replace(/\.[^.]+$/, "")}-s${pageNumber}`,
      date,
      sourceName,
      sourceType: "pptx",
      pageNumber,
      title,
      text,
      keywords: keywordsFromText(title, text),
    });
  }

  return materials;
}

const files = await walk(lectureRoot);
const materials = [];
for (const filePath of files) {
  if (filePath.toLowerCase().endsWith(".pdf")) {
    materials.push(...await extractPdf(filePath));
  } else if (filePath.toLowerCase().endsWith(".pptx")) {
    materials.push(...await extractPptx(filePath));
  }
}

materials.sort((a, b) => naturalSort(a.date, b.date) || naturalSort(a.sourceName, b.sourceName) || a.pageNumber - b.pageNumber);

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(materials, null, 2)}\n`, "utf8");
console.log(`Wrote ${materials.length} lecture material entries to ${path.relative(repoRoot, outputPath)}`);
