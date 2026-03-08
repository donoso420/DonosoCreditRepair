const PDF_PAGE_LIMIT = 12;
const PDF_OCR_PAGE_LIMIT = 4;

const BUREAU_NAMES = ["Experian", "Equifax", "TransUnion"];
const NEGATIVE_PATTERNS = [
  { type: "Collection", pattern: /\bcollection\b/i },
  { type: "Charge Off", pattern: /\bcharge[\s-]*off\b/i },
  { type: "Late Payment", pattern: /\b(?:30|60|90|120|150|180)\s+days?\s+late\b/i },
  { type: "Delinquent", pattern: /\bdelinquen\w*\b/i },
  { type: "Derogatory", pattern: /\bderogator\w*\b/i },
  { type: "Repossession", pattern: /\brepossession\b/i },
  { type: "Bankruptcy", pattern: /\bbankruptcy\b/i },
  { type: "Foreclosure", pattern: /\bforeclosure\b/i },
  { type: "Judgment", pattern: /\bjudg(?:e)?ment\b/i },
  { type: "Lien", pattern: /\blien\b/i },
  { type: "Settlement", pattern: /\bsettled?\b|\bsettlement\b/i },
  { type: "Charge Off", pattern: /\bprofit\s+and\s+loss\s+write-?off\b/i },
];

let pdfJsPromise = null;
let tesseractPromise = null;
let jsZipPromise = null;

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeBureau(value) {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("experian")) return "Experian";
  if (raw.includes("equifax")) return "Equifax";
  if (raw.includes("transunion") || raw.includes("trans union")) return "TransUnion";
  return value ? String(value).trim() : "";
}

function inferBureauFromText(...values) {
  for (const value of values) {
    const bureau = normalizeBureau(value);
    if (bureau) return bureau;
  }
  return "";
}

function inferReportDate(text, fallbackDate = "") {
  const normalized = normalizeWhitespace(text);
  const numericMatch = normalized.match(
    /\b(?:report date|generated(?: on)?|as of|pulled on)\b[^0-9]{0,12}(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i
  );
  if (numericMatch) {
    const parts = numericMatch[1].split(/[/-]/).map((part) => part.trim());
    if (parts.length === 3) {
      let [month, day, year] = parts;
      if (year.length === 2) year = `20${year}`;
      const iso = `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    }
  }

  const writtenMatch = normalized.match(
    /\b(?:report date|generated(?: on)?|as of|pulled on)\b[^a-z0-9]{0,12}([A-Za-z]+\s+\d{1,2},\s+\d{4})/i
  );
  if (writtenMatch) {
    const parsed = new Date(writtenMatch[1]);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  return fallbackDate || "";
}

function cleanLine(line) {
  return normalizeWhitespace(String(line || "").replace(/\s+/g, " "));
}

function isGenericLine(line) {
  const normalized = cleanLine(line).toLowerCase();
  if (!normalized) return true;
  return (
    normalized.length < 3 ||
    /^(account|status|remarks?|comment|creditor|balance|bureau|date|page|payment|scheduled|reported|opened|closed)\b/.test(normalized) ||
    normalized.includes("annualcreditreport") ||
    normalized.includes("dispute") ||
    normalized.includes("investigation")
  );
}

function extractMoney(text) {
  const match = String(text || "").match(
    /\b(?:balance|past due|amount owed|high balance|monthly payment)?[^0-9$]{0,12}\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i
  );
  if (!match) return null;
  const value = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(value) ? value : null;
}

function extractAccountReference(text) {
  const match = String(text || "").match(
    /\b(?:acct|account|account #|account no|account number|a\/c|loan #|reference)\b[^a-z0-9]{0,10}([a-z0-9*Xx-]{3,})/i
  );
  if (!match) return "";
  return match[1].replace(/^[-:#\s]+/, "").slice(-12);
}

function extractStatus(text) {
  const normalized = normalizeWhitespace(text);
  const statusMatch = normalized.match(
    /\b(?:status|payment status|account status|remarks?)\b[^a-z0-9]{0,10}([a-z0-9 ,/-]{4,80})/i
  );
  if (statusMatch) {
    return cleanLine(statusMatch[1]).slice(0, 80);
  }

  const fallback = NEGATIVE_PATTERNS.find(({ pattern }) => pattern.test(normalized));
  return fallback ? fallback.type : "";
}

function isBureauOnlyLine(line) {
  const normalized = cleanLine(line)
    .toLowerCase()
    .replace(/[,+/&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return false;
  return /^(experian|equifax|transunion|exp|eq|tu|all 3|all three)( (experian|equifax|transunion|exp|eq|tu))*$/.test(
    normalized
  );
}

function extractBureausFromSummary(text) {
  const normalized = cleanLine(text).toLowerCase();
  const bureaus = [];

  if (/\ball 3\b|\ball three\b/.test(normalized)) {
    return [...BUREAU_NAMES];
  }
  if (/\bexperian\b|\bexp\b/.test(normalized)) bureaus.push("Experian");
  if (/\bequifax\b|\beq\b/.test(normalized)) bureaus.push("Equifax");
  if (/\btransunion\b|\btrans union\b|\btu\b/.test(normalized)) bureaus.push("TransUnion");

  return bureaus.length ? bureaus : [""];
}

function inferSummaryItemType(issue) {
  const normalized = cleanLine(issue).toLowerCase();
  if (/\b(inquiry|hard pull|hard inquiry)\b/.test(normalized)) return "Hard Inquiry";
  if (/\b(name variants?|addresses?)\b/.test(normalized)) return "Personal Information";
  if (/\b(duplicate|listed twice|same account)\b/.test(normalized)) return "Duplicate Account";
  if (/\b(charge[\s-]*off|written off)\b/.test(normalized)) return "Charge Off";
  if (/\bcollection\b/.test(normalized)) return "Collection";
  if (/\b(90|120|150|180)\s+days?\s+past due\b|\bdays?\s+late\b/.test(normalized)) {
    return "Late Payment";
  }
  if (/\bbankruptcy\b/.test(normalized)) return "Bankruptcy";
  if (/\bforeclosure\b/.test(normalized)) return "Foreclosure";
  if (/\blien\b/.test(normalized)) return "Lien";
  if (/\bjudg(?:e)?ment\b/.test(normalized)) return "Judgment";
  return extractStatus(issue) || "Negative Item";
}

function extractSummaryCreditor(issue) {
  const normalized = cleanLine(issue.replace(/^\d+\s+/, ""));

  if (/\bname variants?\b/i.test(normalized)) return "Name Variants";
  if (/\baddresses?\b/i.test(normalized)) return "Address History";

  const groupedMatch = normalized.match(
    /^(.+?)\s+(?:collection accounts|hard inquiries|name variants|addresses)\b/i
  );
  if (groupedMatch) {
    return cleanLine(groupedMatch[1]).replace(/^\d+\s+/, "");
  }

  const accountLabelMatch = normalized.match(/account:\s*([^;—]+?)(?:\s+opened|\s+—|$)/i);
  if (accountLabelMatch) {
    return cleanLine(accountLabelMatch[1]).replace(/\s*#\s*[a-z0-9*Xx-]+$/i, "");
  }

  const separatorMatch = normalized.match(/^(.+?)(?:\s+[—–-]\s+|:\s)/);
  if (separatorMatch) {
    return cleanLine(separatorMatch[1]).replace(/\s*#\s*[a-z0-9*Xx-]+$/i, "");
  }

  return cleanLine(normalized).slice(0, 80) || "Reported Item";
}

function extractSummaryNegativeItems(text, fileMeta = {}) {
  const normalized = normalizeWhitespace(text);
  const startIndex = normalized.indexOf("PRIORITY DISPUTE ACTION LIST");
  const endIndex = normalized.indexOf("LEGAL REFERENCE GUIDE");
  if (startIndex === -1) return [];

  const section = normalized.slice(
    startIndex + "PRIORITY DISPUTE ACTION LIST".length,
    endIndex === -1 ? normalized.length : endIndex
  );

  const lines = section
    .split("\n")
    .map((line) => cleanLine(line))
    .filter(Boolean)
    .filter((line) => !["#", "Priority", "Issue", "Bureaus", "Legal Basis", "Action"].includes(line));

  const reportDate = inferReportDate(normalized, fileMeta.reportDate || "");
  const detected = [];

  for (let index = 0; index < lines.length; ) {
    if (!/^\d+$/.test(lines[index])) {
      index += 1;
      continue;
    }

    let cursor = index + 1;
    const priority = /^(critical|high|medium|low)$/i.test(lines[cursor] || "") ? lines[cursor++] : "";
    const issueLines = [];
    while (cursor < lines.length && !/^\d+$/.test(lines[cursor]) && !isBureauOnlyLine(lines[cursor])) {
      issueLines.push(lines[cursor]);
      cursor += 1;
    }

    const bureauLines = [];
    while (cursor < lines.length && isBureauOnlyLine(lines[cursor])) {
      bureauLines.push(lines[cursor]);
      cursor += 1;
    }

    while (cursor < lines.length && !/^\d+$/.test(lines[cursor])) {
      cursor += 1;
    }

    const issue = cleanLine(issueLines.join(" "));
    if (!issue) {
      index = cursor;
      continue;
    }

    const bureaus = extractBureausFromSummary(bureauLines.join(" "));
    const creditor = extractSummaryCreditor(issue);
    const accountReference = extractAccountReference(issue);
    const itemType = inferSummaryItemType(issue);
    const status = priority ? `${priority.toUpperCase()} priority dispute` : "Needs review";
    const notes = cleanLine(issue).slice(0, 240);
    const balance = extractMoney(issue);

    bureaus.forEach((bureau) => {
      detected.push({
        bureau,
        creditor,
        item_type: itemType,
        account_reference: accountReference,
        status,
        balance,
        notes,
        source: "scanned",
        verification_method: "browser_scan",
        verification_notes: "Imported from uploaded dispute summary document.",
        evidence_excerpt: notes,
        source_file_id: fileMeta.fileId || null,
        last_seen_at: reportDate || fileMeta.reportDate || "",
        is_active: true,
      });
    });

    index = cursor;
  }

  return dedupeItems(detected, buildNegativeItemFingerprint);
}

function extractCreditor(contextLines, sourceName) {
  const candidates = contextLines
    .map((line) => cleanLine(line))
    .filter((line) => line && !isGenericLine(line))
    .filter((line) => !NEGATIVE_PATTERNS.some(({ pattern }) => pattern.test(line)))
    .filter((line) => !/\b(experian|equifax|transunion)\b/i.test(line));

  const strongest = candidates.find((line) => /^[A-Z0-9 &'.,/-]{4,60}$/.test(line));
  if (strongest) return strongest;

  if (candidates[0]) return candidates[0].slice(0, 80);
  return cleanLine(sourceName || "Reported Item").slice(0, 80);
}

function buildNegativeItemFingerprint(item) {
  return [
    normalizeBureau(item.bureau || "all-bureaus") || "all-bureaus",
    normalizeKey(item.creditor),
    normalizeKey(item.item_type),
    normalizeKey(item.account_reference),
  ].join("|");
}

function buildCreditReportFingerprint(report) {
  const bureau = normalizeBureau(report.bureau || "other") || "other";
  if (report.file_id) {
    return [bureau, `file-${report.file_id}`].join("|");
  }
  return [
    bureau,
    normalizeKey(report.report_date || "undated"),
    normalizeKey(report.report_label || "manual"),
  ].join("|");
}

function dedupeItems(items, getKey) {
  const seen = new Map();
  items.forEach((item) => {
    const key = getKey(item);
    if (!seen.has(key)) {
      seen.set(key, item);
      return;
    }

    const existing = seen.get(key);
    seen.set(key, {
      ...existing,
      balance: existing.balance ?? item.balance,
      status: existing.status || item.status,
      notes: existing.notes?.length >= item.notes?.length ? existing.notes : item.notes,
    });
  });
  return Array.from(seen.values());
}

function looksLikeCreditReport(text, fileMeta = {}) {
  const haystack = normalizeWhitespace(
    [
      text,
      fileMeta.fileName,
      fileMeta.title,
      fileMeta.category,
      fileMeta.bureau,
    ]
      .filter(Boolean)
      .join("\n")
  ).toLowerCase();

  return (
    /\b(experian|equifax|transunion|trans union)\b/.test(haystack) ||
    /\b(credit report|annualcreditreport|tri[- ]merge|tradeline|account review|consumer disclosure)\b/.test(
      haystack
    )
  );
}

function extractScores(text, fileMeta = {}) {
  const normalized = normalizeWhitespace(text);
  const fallbackBureau = inferBureauFromText(fileMeta.bureau, fileMeta.fileName, fileMeta.title);
  const fallbackDate = inferReportDate(normalized, fileMeta.reportDate || "");
  const results = [];

  const bureauMatches = normalized.matchAll(
    /(Experian|Equifax|TransUnion)[^0-9\n]{0,60}\b([3-8][0-9]{2})\b/gi
  );
  for (const match of bureauMatches) {
    const bureau = normalizeBureau(match[1]);
    const score = Number(match[2]);
    if (!bureau || !Number.isFinite(score)) continue;
    results.push({
      bureau,
      score,
      report_date: fallbackDate || fileMeta.reportDate || "",
      report_label: fileMeta.title || `${bureau} credit report`,
      summary: `Extracted score from ${fileMeta.title || fileMeta.fileName || "uploaded document"}.`,
      source: "scanned",
      verification_status: "verified",
      verification_method: "browser_scan",
      verification_notes: "Detected by the browser document scanner from extractable text or OCR.",
      file_id: fileMeta.fileId || null,
    });
  }

  if (!results.length && fallbackBureau) {
    const scoreMatch = normalized.match(/\b(?:fico|vantagescore|credit score|score)\b[^0-9]{0,24}([3-8][0-9]{2})\b/i);
    if (scoreMatch) {
      results.push({
        bureau: fallbackBureau,
        score: Number(scoreMatch[1]),
        report_date: fallbackDate || fileMeta.reportDate || "",
        report_label: fileMeta.title || `${fallbackBureau} credit report`,
        summary: `Extracted score from ${fileMeta.title || fileMeta.fileName || "uploaded document"}.`,
        source: "scanned",
        verification_status: "verified",
        verification_method: "browser_scan",
        verification_notes: "Detected by the browser document scanner from extractable text or OCR.",
        file_id: fileMeta.fileId || null,
      });
    }
  }

  if (!results.length && looksLikeCreditReport(normalized, fileMeta)) {
    results.push({
      bureau: fallbackBureau || "Other",
      score: null,
      report_date: fallbackDate || fileMeta.reportDate || "",
      report_label: fileMeta.title || fileMeta.fileName || `${fallbackBureau || "Credit"} report`,
      summary: `Detected a likely credit report from ${fileMeta.title || fileMeta.fileName || "the uploaded document"}, but no score was extracted from the scanned text.`,
      source: "scanned",
      verification_status: "verified",
      verification_method: "browser_scan",
      verification_notes:
        "Detected by the browser document scanner from report text or file metadata. No score was confidently extracted.",
      file_id: fileMeta.fileId || null,
    });
  }

  return dedupeItems(results, (item) => `${item.bureau}|${item.score}|${item.report_date || ""}`);
}

function extractNegativeItems(text, fileMeta = {}) {
  const lines = normalizeWhitespace(text)
    .split("\n")
    .map((line) => cleanLine(line))
    .filter(Boolean);

  let currentBureau = inferBureauFromText(fileMeta.bureau, fileMeta.fileName, fileMeta.title);
  const detected = [];

  lines.forEach((line, index) => {
    const lineBureau = inferBureauFromText(line);
    if (lineBureau) currentBureau = lineBureau;

    const negativeMatch = NEGATIVE_PATTERNS.find(({ pattern }) => pattern.test(line));
    if (!negativeMatch) return;
    if (/\bno\s+(?:negative|derogatory|collection|late|adverse)\b/i.test(line)) return;

    const contextLines = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 3));
    const context = contextLines.join(" | ");
    const creditor = extractCreditor(contextLines, fileMeta.title || fileMeta.fileName);
    const accountReference = extractAccountReference(context);
    const status = extractStatus(context) || negativeMatch.type;
    const bureau = currentBureau || "";
    const notes = cleanLine(context).slice(0, 240);

    detected.push({
      bureau,
      creditor,
      item_type: negativeMatch.type,
      account_reference: accountReference,
      status,
      balance: extractMoney(context),
      notes,
      source: "scanned",
      verification_method: "browser_scan",
      verification_notes: "Detected by the browser document scanner from extractable text or OCR.",
      evidence_excerpt: notes,
      source_file_id: fileMeta.fileId || null,
      last_seen_at: inferReportDate(context, fileMeta.reportDate || "") || fileMeta.reportDate || "",
      is_active: true,
    });
  });

  return dedupeItems(detected, buildNegativeItemFingerprint);
}

async function getPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.mjs").then(
      (module) => {
        module.GlobalWorkerOptions.workerSrc =
          "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.mjs";
        return module;
      }
    );
  }
  return pdfJsPromise;
}

async function getTesseract() {
  if (!tesseractPromise) {
    tesseractPromise = import(
      "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js"
    ).then((module) => module.default || module);
  }
  return tesseractPromise;
}

async function getJsZip() {
  if (!jsZipPromise) {
    jsZipPromise = import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm").then(
      (module) => module.default || module
    );
  }
  return jsZipPromise;
}

async function runOcr(source, progress, label = "document") {
  const Tesseract = await getTesseract();
  progress?.(`Running OCR on ${label}...`);
  const result = await Tesseract.recognize(source, "eng");
  return normalizeWhitespace(result?.data?.text || "");
}

async function extractTextFromPdf(file, progress) {
  const pdfjs = await getPdfJs();
  const documentTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const pdf = await documentTask.promise;
  const pageCount = Math.min(pdf.numPages, PDF_PAGE_LIMIT);
  const rawChunks = [];

  for (let pageIndex = 1; pageIndex <= pageCount; pageIndex += 1) {
    progress?.(`Reading PDF page ${pageIndex} of ${pageCount}...`);
    const page = await pdf.getPage(pageIndex);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str || "").join(" ");
    rawChunks.push(pageText);
  }

  const extracted = normalizeWhitespace(rawChunks.join("\n"));
  if (extracted.length >= 120) return extracted;

  const ocrPageCount = Math.min(pdf.numPages, PDF_OCR_PAGE_LIMIT);
  const ocrChunks = [];
  for (let pageIndex = 1; pageIndex <= ocrPageCount; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) continue;
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: context, viewport }).promise;
    ocrChunks.push(await runOcr(canvas, progress, `PDF page ${pageIndex}`));
  }

  return normalizeWhitespace([extracted, ...ocrChunks].join("\n"));
}

async function extractTextFromImage(file, progress) {
  return runOcr(file, progress, file.name || "image");
}

async function extractTextFromDocx(file, progress) {
  progress?.(`Reading Word document ${file.name || ""}...`);
  const JSZip = await getJsZip();
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const documentXml = await zip.file("word/document.xml")?.async("text");
  if (!documentXml) return "";

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(documentXml, "application/xml");
  const paragraphs = Array.from(xmlDoc.getElementsByTagName("w:p"))
    .map((paragraph) =>
      Array.from(paragraph.getElementsByTagName("w:t"))
        .map((node) => node.textContent || "")
        .join("")
    )
    .map((line) => cleanLine(line))
    .filter(Boolean);

  return normalizeWhitespace(paragraphs.join("\n"));
}

export async function scanCreditDocument(file, fileMeta = {}, progress) {
  const contentType = String(fileMeta.contentType || file.type || "").toLowerCase();
  const fileName = String(fileMeta.fileName || file.name || "");
  let text = "";

  if (contentType === "application/pdf" || /\.pdf$/i.test(fileName)) {
    text = await extractTextFromPdf(file, progress);
  } else if (
    contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    /\.docx$/i.test(fileName)
  ) {
    text = await extractTextFromDocx(file, progress);
  } else if (/image\/(png|jpeg|jpg|webp)/.test(contentType) || /\.(png|jpe?g|webp)$/i.test(fileName)) {
    text = await extractTextFromImage(file, progress);
  }

  const reports = extractScores(text, fileMeta).map((report) => ({
    ...report,
    fingerprint: buildCreditReportFingerprint(report),
  }));

  const negativeItems = dedupeItems(
    [...extractSummaryNegativeItems(text, fileMeta), ...extractNegativeItems(text, fileMeta)],
    buildNegativeItemFingerprint
  ).map((item) => ({
    ...item,
    fingerprint: buildNegativeItemFingerprint(item),
  }));

  return {
    text,
    reports,
    negativeItems,
  };
}

export function buildManualNegativeItem(values = {}) {
  const item = {
    bureau: normalizeBureau(values.bureau || ""),
    creditor: cleanLine(values.creditor || ""),
    item_type: cleanLine(values.item_type || ""),
    account_reference: cleanLine(values.account_reference || ""),
    status: cleanLine(values.status || ""),
    balance: values.balance == null || values.balance === "" ? null : Number(values.balance),
    notes: cleanLine(values.notes || ""),
    is_active: values.is_active !== false,
    source: values.source || "manual",
    verification_method: values.verification_method || "manual",
    verification_notes: cleanLine(values.verification_notes || ""),
    evidence_excerpt: cleanLine(values.evidence_excerpt || ""),
    verified_at: values.verified_at || null,
    ai_model: cleanLine(values.ai_model || ""),
    confidence:
      values.confidence == null || values.confidence === "" ? null : Number(values.confidence),
    source_file_id: values.source_file_id || null,
    report_id: values.report_id || null,
    last_seen_at: values.last_seen_at || "",
  };
  return {
    ...item,
    fingerprint: buildNegativeItemFingerprint(item),
  };
}

export function buildManualCreditReport(values = {}) {
  const report = {
    bureau: normalizeBureau(values.bureau || "") || "Other",
    report_date: values.report_date || "",
    score: values.score == null || values.score === "" ? null : Number(values.score),
    report_label: cleanLine(values.report_label || ""),
    summary: cleanLine(values.summary || ""),
    source: values.source || "manual",
    verification_status: values.verification_status || "pending",
    verification_method: values.verification_method || "manual",
    verification_notes: cleanLine(values.verification_notes || ""),
    verified_at: values.verified_at || null,
    ai_model: cleanLine(values.ai_model || ""),
    file_id: values.file_id || null,
  };
  return {
    ...report,
    fingerprint: buildCreditReportFingerprint(report),
  };
}

export function formatCurrency(value) {
  if (value == null || value === "") return "";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return amount.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function getNegativeItemTypes() {
  return Array.from(new Set(NEGATIVE_PATTERNS.map((item) => item.type)));
}
