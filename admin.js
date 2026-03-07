import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import {
  buildManualCreditReport,
  buildManualNegativeItem,
  formatCurrency,
  scanCreditDocument,
} from "./credit-report-tools.js";

const config = window.__PORTAL_CONFIG__ || {};

const authCard = document.getElementById("auth-card");
const adminApp = document.getElementById("admin-app");
const authForm = document.getElementById("admin-auth-form");
const authStatus = document.getElementById("admin-auth-status");
const adminStatus = document.getElementById("admin-status");
const adminIdentity = document.getElementById("admin-identity");

const profileForm = document.getElementById("profile-form");
const clientSelect = document.getElementById("client-select");
const activeClientIdEl = document.getElementById("active-client-id");

const snapshotForm = document.getElementById("snapshot-form");
const creditReportForm = document.getElementById("credit-report-form");
const negativeItemForm = document.getElementById("negative-item-form");
const letterForm = document.getElementById("letter-form");
const letterUpdateForm = document.getElementById("letter-update-form");
const timelineForm = document.getElementById("timeline-form");
const fileUploadForm = document.getElementById("file-upload-form");
const scanDocumentsBtn = document.getElementById("scan-documents-btn");
const scanDocumentsStatus = document.getElementById("scan-documents-status");
const aiVerifyDocumentsBtn = document.getElementById("ai-verify-documents-btn");
const aiVerifyStatus = document.getElementById("ai-verify-status");

const inviteForm = document.getElementById("invite-form");
const inviteStatus = document.getElementById("invite-status");

const refreshAllBtn = document.getElementById("refresh-all-btn");
const logoutBtn = document.getElementById("admin-logout-btn");

const previewScores = document.getElementById("preview-scores");
const previewReports = document.getElementById("preview-reports");
const previewNegativeItems = document.getElementById("preview-negative-items");
const previewLetters = document.getElementById("preview-letters");
const previewUpdates = document.getElementById("preview-updates");
const previewFiles = document.getElementById("preview-files");
const adminMessageThread = document.getElementById("admin-message-thread");
const adminMessageForm = document.getElementById("admin-message-form");
const adminMessageInput = document.getElementById("admin-message-input");
const previewClientUploads = document.getElementById("preview-client-uploads");

const MAX_UPLOAD_SIZE_MB = 500;
const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;
const MAX_AI_REVIEW_SIZE_MB = 45;
const MAX_AI_REVIEW_SIZE_BYTES = MAX_AI_REVIEW_SIZE_MB * 1024 * 1024;
const MAX_BROWSER_SCAN_SIZE_MB = 40;
const MAX_BROWSER_SCAN_SIZE_BYTES = MAX_BROWSER_SCAN_SIZE_MB * 1024 * 1024;
const AI_REVIEW_ENDPOINTS = ["/api/analyze-credit-report", "/.netlify/functions/analyze-credit-report"];

const missingConfig = ["supabaseUrl", "supabaseAnonKey"].filter((k) => !config[k]);
let supabase = null;
let currentAdmin = null;
let activeClientId = null;

function setAuthStatus(message, isError = false) {
  if (!authStatus) return;
  authStatus.textContent = message;
  authStatus.classList.toggle("error", isError);
}

function setAdminStatus(message, isError = false) {
  if (!adminStatus) return;
  adminStatus.textContent = message;
  adminStatus.classList.toggle("error", isError);
}

function setScanStatus(message, isError = false) {
  if (!scanDocumentsStatus) return;
  scanDocumentsStatus.textContent = message;
  scanDocumentsStatus.classList.toggle("error", isError);
}

function setAiVerifyStatus(message, isError = false) {
  if (!aiVerifyStatus) return;
  aiVerifyStatus.textContent = message;
  aiVerifyStatus.classList.toggle("error", isError);
}

function showAuth() {
  authCard?.classList.remove("hidden");
  adminApp?.classList.add("hidden");
}

function showAdmin() {
  authCard?.classList.add("hidden");
  adminApp?.classList.remove("hidden");
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleDateString();
}

function safeText(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function sanitizeFileName(name) {
  return String(name || "file")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-");
}

function isMissingFeatureError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("does not exist") ||
    message.includes("could not find the table") ||
    message.includes("column") ||
    message.includes("schema cache")
  );
}

function formatMbLimit(limitMb) {
  return `${limitMb}MB`;
}

function formatVerificationStatus(value) {
  switch (String(value || "").toLowerCase()) {
    case "verified":
      return "AI verified";
    case "rejected":
      return "Rejected";
    case "needs_review":
      return "Needs review";
    default:
      return "Pending review";
  }
}

function formatVerificationMethod(value) {
  switch (String(value || "").toLowerCase()) {
    case "ai_pdf":
      return "AI PDF review";
    case "browser_scan":
      return "Browser scan";
    default:
      return "Manual";
  }
}

function prefillProfileUserId(userId) {
  const input = document.getElementById("profile-user-id");
  if (!input || !isUuid(userId)) return;
  if (!String(input.value || "").trim()) {
    input.value = userId;
  }
}

async function checkAdmin(userId) {
  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return false;
  return Boolean(data?.user_id);
}

async function loadClients() {
  const { data, error } = await supabase
    .from("client_profiles")
    .select("user_id,full_name,phone")
    .order("full_name", { ascending: true });

  if (error) {
    setAdminStatus("Could not load clients: " + error.message, true);
    return;
  }

  clientSelect.innerHTML = "";
  if (!data || data.length === 0) {
    clientSelect.innerHTML = '<option value="">No clients yet</option>';
    activeClientId = null;
    activeClientIdEl.textContent = "";
    setScanStatus("");
    setAiVerifyStatus("");
    renderPreview([], [], [], [], [], []);
    return;
  }

  for (const row of data) {
    const option = document.createElement("option");
    option.value = row.user_id;
    const name = row.full_name || "Unnamed Client";
    option.textContent = `${name} (${row.user_id.slice(0, 8)}...)`;
    clientSelect.appendChild(option);
  }

  if (!activeClientId || !data.some((x) => x.user_id === activeClientId)) {
    activeClientId = data[0].user_id;
  }
  clientSelect.value = activeClientId;
  activeClientIdEl.textContent = `Active user_id: ${activeClientId}`;
  await loadClientPreview(activeClientId);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString();
}

function renderAdminMessages(messages) {
  if (!adminMessageThread) return;
  if (!messages || !messages.length) {
    adminMessageThread.innerHTML = '<li class="muted">No messages from this client yet.</li>';
    return;
  }
  adminMessageThread.innerHTML = messages
    .map((row) => {
      const isClient = row.sender_role === "client";
      const label = isClient ? "Client" : "You (Admin)";
      const cls = isClient ? "msg-from-client" : "msg-from-admin";
      return `<li class="${cls}"><strong>${safeText(label)}</strong> · ${safeText(formatDateTime(row.created_at))}<br>${safeText(row.content)}</li>`;
    })
    .join("");
  adminMessageThread.scrollTop = adminMessageThread.scrollHeight;
}

function renderClientUploads(files) {
  if (!previewClientUploads) return;
  const uploads = (files || []).filter((f) => f.uploaded_by === "client");
  if (!uploads.length) {
    previewClientUploads.innerHTML = "<li>No client uploads yet.</li>";
    return;
  }
  previewClientUploads.innerHTML = uploads
    .map((f) => {
      const link = f.signed_url
        ? `<a href="${safeText(f.signed_url)}" target="_blank" rel="noopener noreferrer">Open file</a>`
        : "Link unavailable";
      return `<li>${safeText(f.title || f.file_name || "File")} · ${safeText(formatDate(f.created_at))} — ${link}</li>`;
    })
    .join("");
}

function renderPreview(reports, negativeItems, scores, letters, updates, files) {
  if (previewReports) previewReports.innerHTML = "";
  if (previewNegativeItems) previewNegativeItems.innerHTML = "";
  previewScores.innerHTML = "";
  previewLetters.innerHTML = "";
  previewUpdates.innerHTML = "";
  previewFiles.innerHTML = "";

  if (previewReports) {
    if (!reports.length) {
      previewReports.innerHTML = "<li>No current credit reports yet.</li>";
    } else {
      for (const row of reports) {
        const li = document.createElement("li");
        const score = row.score ? ` • Score ${safeText(row.score)}` : "";
        const review = ` • ${safeText(formatVerificationStatus(row.verification_status))} (${safeText(
          formatVerificationMethod(row.verification_method)
        )})`;
        const fileLink = row.signed_url
          ? ` <a href="${safeText(row.signed_url)}" target="_blank" rel="noopener noreferrer">Open</a>`
          : "";
        li.innerHTML = `${safeText(row.bureau || "Other")} · ${safeText(formatDate(row.report_date || row.created_at))}${score}${review}${fileLink}`;
        previewReports.appendChild(li);
      }
    }
  }

  if (previewNegativeItems) {
    if (!negativeItems.length) {
      previewNegativeItems.innerHTML = "<li>No negative items yet.</li>";
    } else {
      for (const row of negativeItems) {
        const li = document.createElement("li");
        const bureau = row.bureau ? `${safeText(row.bureau)} · ` : "";
        const balance = row.balance != null ? ` · ${safeText(formatCurrency(row.balance))}` : "";
        const review = ` · ${safeText(formatVerificationMethod(row.verification_method))}`;
        li.innerHTML = `${bureau}<strong>${safeText(row.creditor)}</strong> — ${safeText(
          row.item_type
        )}${balance}${review}`;
        previewNegativeItems.appendChild(li);
      }
    }
  }

  if (!scores.length) {
    previewScores.innerHTML = "<li>No score records yet.</li>";
  } else {
    for (const row of scores) {
      const li = document.createElement("li");
      li.innerHTML = `${safeText(row.bureau)}: <strong>${safeText(row.score)}</strong> (${safeText(
        formatDate(row.reported_at)
      )})`;
      previewScores.appendChild(li);
    }
  }

  if (!letters.length) {
    previewLetters.innerHTML = "<li>No letter records yet.</li>";
  } else {
    for (const row of letters) {
      const li = document.createElement("li");
      li.innerHTML = `#${safeText(row.id)} - ${safeText(row.recipient || row.bureau || "N/A")} / ${safeText(
        row.tracking_number
      )} / ${safeText(row.status)}`;
      previewLetters.appendChild(li);
    }
  }

  if (!updates.length) {
    previewUpdates.innerHTML = "<li>No updates yet.</li>";
  } else {
    for (const row of updates) {
      const li = document.createElement("li");
      li.innerHTML = `${safeText(formatDate(row.created_at))}: ${safeText(row.details)}`;
      previewUpdates.appendChild(li);
    }
  }

  if (!files.length) {
    previewFiles.innerHTML = "<li>No files yet.</li>";
  } else {
    for (const row of files) {
      const openLink = row.signed_url
        ? ` — <a href="${safeText(row.signed_url)}" target="_blank" rel="noopener noreferrer">Open</a>`
        : "";
      const li = document.createElement("li");
      li.innerHTML = `${safeText(row.category || "File")}: ${safeText(
        row.title || row.file_name || "Attachment"
      )}${openLink}`;
      previewFiles.appendChild(li);
    }
  }
}

async function safeTableQuery(queryPromise, fallback = []) {
  const { data, error } = await queryPromise;
  if (!error) return data || fallback;
  if (isMissingFeatureError(error)) return fallback;
  throw error;
}

async function getSignedFileUrl(fileRow) {
  const { data } = await supabase.storage
    .from(fileRow.bucket || "client-docs")
    .createSignedUrl(fileRow.file_path, 60 * 60);
  return data?.signedUrl || "";
}

async function loadClientFiles(userId) {
  const { data, error } = await supabase
    .from("client_files")
    .select("id,title,notes,category,file_name,file_path,bucket,created_at,uploaded_by,content_type,file_size")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) throw error;

  const files = data || [];
  return Promise.all(
    files.map(async (row) => ({
      ...row,
      signed_url: await getSignedFileUrl(row),
    }))
  );
}

function isScannableFile(fileRow) {
  const contentType = String(fileRow.content_type || "").toLowerCase();
  const fileName = String(fileRow.file_name || "").toLowerCase();
  return (
    contentType === "application/pdf" ||
    /image\/(png|jpeg|jpg|webp)/.test(contentType) ||
    /\.(pdf|png|jpe?g|webp)$/.test(fileName)
  );
}

function isPdfFile(fileRow) {
  const contentType = String(fileRow?.content_type || "").toLowerCase();
  const fileName = String(fileRow?.file_name || "").toLowerCase();
  return contentType === "application/pdf" || /\.pdf$/.test(fileName);
}

function isLikelyCreditReportCandidate(fileRow) {
  if (!isPdfFile(fileRow)) return false;
  const path = String(fileRow.file_path || "").toLowerCase();
  const haystack = [
    fileRow.category,
    fileRow.title,
    fileRow.notes,
    fileRow.file_name,
    path,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    path.includes("/reports/") ||
    String(fileRow.category || "").toLowerCase() === "credit report" ||
    /\b(credit report|annualcreditreport|experian|equifax|transunion|tri[- ]merge)\b/.test(
      haystack
    )
  );
}

function inferReportSource(fileRow) {
  return fileRow?.uploaded_by === "client" ? "client_upload" : "admin_upload";
}

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data?.session?.access_token || "";
}

async function callAiReviewEndpoint(body, accessToken) {
  let lastResponse = null;
  let lastData = null;

  for (const endpoint of AI_REVIEW_ENDPOINTS) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({}));
    if (response.status === 404) {
      lastResponse = response;
      lastData = data;
      continue;
    }

    if (!response.ok) {
      throw new Error(data?.error || "AI review request failed.");
    }

    return data;
  }

  throw new Error(lastData?.error || "AI review endpoint is not deployed.");
}

async function verifyFileRowWithAi(fileRow) {
  if (!isPdfFile(fileRow)) {
    throw new Error("AI verification only works on PDF reports.");
  }

  if (Number(fileRow.file_size || 0) > MAX_AI_REVIEW_SIZE_BYTES) {
    throw new Error(
      `AI verification only handles PDFs up to ${formatMbLimit(MAX_AI_REVIEW_SIZE_MB)}.`
    );
  }

  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new Error("Admin session expired. Sign in again.");
  }

  return callAiReviewEndpoint({ fileId: fileRow.id }, accessToken);
}

async function applyAiReviewResult(fileRow, analysis, fallback = {}) {
  const documentResult = analysis?.document || {};
  const negativeItems = Array.isArray(analysis?.negative_items) ? analysis.negative_items : [];
  const verifiedAt = new Date().toISOString();
  const reportSource = fallback.source || inferReportSource(fileRow);
  const reportDate =
    documentResult.report_date || fallback.report_date || String(fileRow.created_at || "").slice(0, 10);
  const reportLabel =
    documentResult.report_label || fallback.report_label || fileRow.title || fileRow.file_name || "Credit report";
  let reportId = null;

  if (documentResult.accepted || fallback.persistRejectedReport) {
    reportId = await upsertCreditReportRow(
      buildManualCreditReport({
        bureau: documentResult.bureau || fallback.bureau || "Other",
        report_date: reportDate,
        score:
          documentResult.score == null || documentResult.score === ""
            ? fallback.score ?? ""
            : documentResult.score,
        report_label: reportLabel,
        summary: documentResult.summary || fallback.summary || "",
        source: reportSource,
        verification_status: documentResult.accepted ? "verified" : "rejected",
        verification_method: "ai_pdf",
        verification_notes: documentResult.reason || fallback.verification_notes || "",
        verified_at: verifiedAt,
        ai_model: analysis?.model || "",
        file_id: fileRow.id,
      })
    );
  }

  if (!documentResult.accepted) {
    return { accepted: false, reportId, itemsCreated: 0 };
  }

  let itemsCreated = 0;
  for (const item of negativeItems) {
    await upsertNegativeItemRow(
      buildManualNegativeItem({
        bureau: item.bureau || documentResult.bureau || "",
        creditor: item.creditor || "Reported Item",
        item_type: item.item_type || "Negative Item",
        account_reference: item.account_reference || "",
        status: item.status || "",
        balance: item.balance ?? null,
        notes: item.notes || "",
        is_active: true,
        source: "scanned",
        verification_method: "ai_pdf",
        verification_notes:
          documentResult.reason || "Verified from an uploaded PDF credit report.",
        evidence_excerpt: item.evidence_excerpt || "",
        verified_at: verifiedAt,
        ai_model: analysis?.model || "",
        confidence: item.confidence ?? null,
        source_file_id: fileRow.id,
        report_id: reportId,
        last_seen_at: reportDate,
      })
    );
    itemsCreated += 1;
  }

  return { accepted: true, reportId, itemsCreated };
}

async function upsertCreditReportRow(report) {
  const payload = {
    ...report,
    user_id: activeClientId,
    report_date: report.report_date || null,
    score: report.score ?? null,
    report_label: report.report_label || null,
    summary: report.summary || null,
    verification_status: report.verification_status || "pending",
    verification_method: report.verification_method || "manual",
    verification_notes: report.verification_notes || null,
    verified_at: report.verified_at || null,
    ai_model: report.ai_model || null,
    file_id: report.file_id || null,
  };

  const { data, error } = await supabase
    .from("credit_reports")
    .upsert(payload, { onConflict: "user_id,fingerprint" })
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return data?.id || null;
}

async function upsertNegativeItemRow(item) {
  const payload = {
    ...item,
    user_id: activeClientId,
    bureau: item.bureau || null,
    account_reference: item.account_reference || null,
    status: item.status || null,
    balance: item.balance ?? null,
    notes: item.notes || null,
    verification_method: item.verification_method || "manual",
    verification_notes: item.verification_notes || null,
    evidence_excerpt: item.evidence_excerpt || null,
    verified_at: item.verified_at || null,
    ai_model: item.ai_model || null,
    confidence: item.confidence ?? null,
    source_file_id: item.source_file_id || null,
    report_id: item.report_id || null,
    last_seen_at: item.last_seen_at || null,
  };

  const { error } = await supabase
    .from("negative_items")
    .upsert(payload, { onConflict: "user_id,fingerprint" });

  if (error) throw error;
}

async function scanFileRows(fileRows, { storeReports = true } = {}) {
  const scannableFiles = fileRows.filter(isScannableFile);
  if (!scannableFiles.length) {
    return { scannedFiles: 0, reportsCreated: 0, itemsCreated: 0, skippedFiles: 0 };
  }

  let reportsCreated = 0;
  let itemsCreated = 0;
  let skippedFiles = 0;

  for (let index = 0; index < scannableFiles.length; index += 1) {
    const row = scannableFiles[index];
    const label = row.title || row.file_name || `document ${index + 1}`;

    if (Number(row.file_size || 0) > MAX_BROWSER_SCAN_SIZE_BYTES) {
      skippedFiles += 1;
      continue;
    }

    setScanStatus(`Scanning ${index + 1}/${scannableFiles.length}: ${label}`);

    const signedUrl = row.signed_url || (await getSignedFileUrl(row));
    if (!signedUrl) {
      throw new Error(`Could not generate a signed URL for ${label}.`);
    }

    const response = await fetch(signedUrl);
    if (!response.ok) {
      throw new Error(`Could not read ${label} for scanning.`);
    }

    const blob = await response.blob();
    const file = new File([blob], row.file_name || `${label}.pdf`, {
      type: row.content_type || blob.type || "application/octet-stream",
    });

    const result = await scanCreditDocument(
      file,
      {
        fileId: row.id,
        fileName: row.file_name,
        title: row.title,
        contentType: row.content_type || blob.type,
        reportDate: String(row.created_at || "").slice(0, 10),
        bureau: [row.title, row.category, row.notes].filter(Boolean).join(" "),
      },
      (message) => {
        setScanStatus(`Scanning ${index + 1}/${scannableFiles.length}: ${message}`);
      }
    );

    if (storeReports) {
      for (const report of result.reports) {
        await upsertCreditReportRow({
          ...report,
          file_id: row.id,
        });
        reportsCreated += 1;
      }
    }

    for (const item of result.negativeItems) {
      await upsertNegativeItemRow({
        ...item,
        source_file_id: row.id,
      });
      itemsCreated += 1;
    }
  }

  return {
    scannedFiles: scannableFiles.length,
    reportsCreated,
    itemsCreated,
    skippedFiles,
  };
}

async function loadClientPreview(userId) {
  if (!userId) return;
  const [
    { data: scores },
    { data: letters },
    { data: updates },
    files,
    { data: messages },
    reports,
    negativeItems,
  ] =
    await Promise.all([
      supabase.from("credit_snapshots").select("bureau,score,reported_at").eq("user_id", userId).order("reported_at", { ascending: false }).limit(6),
      supabase.from("client_letters").select("id,recipient,bureau,tracking_number,status,sent_date").eq("user_id", userId).order("sent_date", { ascending: false }).limit(8),
      supabase.from("client_updates").select("details,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(8),
      loadClientFiles(userId),
      supabase.from("portal_messages").select("sender_role,content,created_at").eq("user_id", userId).order("created_at", { ascending: true }),
      safeTableQuery(
        supabase
          .from("credit_reports")
          .select("id,bureau,score,report_date,report_label,summary,verification_status,verification_method,file_id,created_at")
          .eq("user_id", userId)
          .order("report_date", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(12)
      ),
      safeTableQuery(
        supabase
          .from("negative_items")
          .select("id,bureau,creditor,item_type,balance,status,notes,is_active,verification_method,confidence,created_at")
          .eq("user_id", userId)
          .order("is_active", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(40)
      ),
    ]);

  const filesWithUrls = files || [];
  const reportFileMap = new Map(filesWithUrls.map((row) => [row.id, row.signed_url || ""]));
  const reportsWithUrls = (reports || []).map((row) => ({
    ...row,
    signed_url: reportFileMap.get(row.file_id) || "",
  }));

  renderPreview(
    reportsWithUrls,
    negativeItems || [],
    scores || [],
    letters || [],
    updates || [],
    filesWithUrls.filter((f) => f.uploaded_by !== "client")
  );
  renderAdminMessages(messages || []);
  renderClientUploads(filesWithUrls);
}

function initTabs() {
  // Tab switching is handled by adminTab() inline onclick in HTML
}

async function requireActiveClient() {
  if (!activeClientId) {
    setAdminStatus("Select a client first.", true);
    return false;
  }
  return true;
}

function initialize() {
  if (missingConfig.length > 0) {
    setAuthStatus(
      "Admin portal is not configured yet. Add Supabase values in portal-config.js.",
      true
    );
    authForm?.querySelectorAll("input,button").forEach((el) => {
      el.disabled = true;
    });
    return;
  }

  supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

  authForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = String(document.getElementById("admin-email")?.value || "").trim();
    const password = String(document.getElementById("admin-password")?.value || "");
    if (!email || !password) {
      setAuthStatus("Enter admin email and password.", true);
      return;
    }

    setAuthStatus("Signing in...");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      setAuthStatus(error?.message || "Could not sign in.", true);
      return;
    }

    const allowed = await checkAdmin(data.user.id);
    if (!allowed) {
      await supabase.auth.signOut();
      setAuthStatus("Access denied. This account is not in admin_users.", true);
      showAuth();
      return;
    }

    currentAdmin = data.user;
    adminIdentity.textContent = `Signed in as ${data.user.email}`;
    prefillProfileUserId(data.user.id);
    showAdmin();
    initTabs();
    setAuthStatus("");
    setAdminStatus("Admin session ready.");
    await loadClients();
  });

  clientSelect?.addEventListener("change", async () => {
    activeClientId = clientSelect.value || null;
    activeClientIdEl.textContent = activeClientId ? `Active user_id: ${activeClientId}` : "";
    setScanStatus("");
    setAiVerifyStatus("");
    await loadClientPreview(activeClientId);
  });

  refreshAllBtn?.addEventListener("click", async () => {
    refreshAllBtn.disabled = true;
    refreshAllBtn.textContent = "Refreshing…";
    try {
      await loadClients();
      setAdminStatus("Data refreshed.");
    } catch (err) {
      setAdminStatus("Refresh failed: " + (err?.message || "Unknown error"), true);
    } finally {
      refreshAllBtn.disabled = false;
      refreshAllBtn.textContent = "↺ Refresh";
    }
  });

  logoutBtn?.addEventListener("click", async () => {
    logoutBtn.disabled = true;
    logoutBtn.textContent = "Signing out…";
    // Give signOut up to 1s to clear the local session; redirect regardless.
    try {
      await Promise.race([
        supabase.auth.signOut(),
        new Promise(resolve => setTimeout(resolve, 1000)),
      ]);
    } catch (_) {}
    // Belt-and-suspenders: wipe any leftover Supabase auth tokens from storage.
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith("sb-"))
        .forEach(k => localStorage.removeItem(k));
    } catch (_) {}
    currentAdmin = null;
    window.location.href = "admin.html";
  });

  inviteForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = String(document.getElementById("invite-email")?.value || "").trim();
    const fullName = String(document.getElementById("invite-name")?.value || "").trim();
    const phone = String(document.getElementById("invite-phone")?.value || "").trim();

    if (!email) {
      if (inviteStatus) { inviteStatus.textContent = "Email is required."; inviteStatus.classList.add("error"); }
      return;
    }

    if (inviteStatus) { inviteStatus.textContent = "Sending invite..."; inviteStatus.classList.remove("error"); }

    const res = await fetch("/api/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, fullName }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (inviteStatus) { inviteStatus.textContent = "Error: " + (data.error || "Could not send invite."); inviteStatus.classList.add("error"); }
      return;
    }

    const userId = data.userId;

    // Auto-create client profile so they appear in the dropdown immediately
    if (userId) {
      await supabase.from("client_profiles").upsert(
        { user_id: userId, full_name: fullName || null, phone: phone || null },
        { onConflict: "user_id" }
      );
      activeClientId = userId;
    }

    inviteForm.reset();
    if (inviteStatus) {
      inviteStatus.textContent = `✓ Invite sent to ${email}. They'll get an email to create their portal password.`;
      inviteStatus.classList.remove("error");
    }
    await loadClients();
  });

  profileForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const rawUserId = String(document.getElementById("profile-user-id")?.value || "").trim();
    const userId = rawUserId || String(currentAdmin?.id || "");
    const fullName = String(document.getElementById("profile-full-name")?.value || "").trim();
    const phone = String(document.getElementById("profile-phone")?.value || "").trim();

    if (!isUuid(userId)) {
      setAdminStatus(
        "Client User ID must be a valid UUID (example: 39748f68-10c8-4de4-8eb8-29a5dba5f0b6).",
        true
      );
      return;
    }
    const userIdInput = document.getElementById("profile-user-id");
    if (userIdInput) userIdInput.value = userId;

    const { error } = await supabase.from("client_profiles").upsert(
      {
        user_id: userId,
        full_name: fullName || null,
        phone: phone || null,
      },
      { onConflict: "user_id" }
    );

    if (error) {
      setAdminStatus("Could not save profile: " + error.message, true);
      return;
    }

    activeClientId = userId;
    setAdminStatus("Profile saved.");
    await loadClients();
  });

  creditReportForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(await requireActiveClient())) return;

    const fileInput = document.getElementById("report-file-input");
    const file = fileInput?.files?.[0];
    const bureau = String(document.getElementById("report-bureau")?.value || "").trim();
    const reportDate = String(document.getElementById("report-date")?.value || "").trim();
    const scoreRaw = String(document.getElementById("report-score")?.value || "").trim();
    const summary = String(document.getElementById("report-summary")?.value || "").trim();
    const titleInput = String(document.getElementById("report-title")?.value || "").trim();
    const runAiReview = Boolean(document.getElementById("report-run-scan")?.checked);

    if (!file) {
      setAdminStatus("Choose a credit report file to upload.", true);
      return;
    }

    const isPdfUpload =
      String(file.type || "").toLowerCase() === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!isPdfUpload) {
      setAdminStatus("Only PDF credit reports are allowed in this upload form.", true);
      return;
    }
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      setAdminStatus(`File must be ${formatMbLimit(MAX_UPLOAD_SIZE_MB)} or smaller.`, true);
      return;
    }

    const bucket = "client-docs";
    const safeName = sanitizeFileName(file.name);
    const objectPath = `${activeClientId}/reports/${Date.now()}-${safeName}`;
    const reportLabel = titleInput || `${bureau || "Credit"} report`;

    setAdminStatus("Uploading credit report...");
    const { error: uploadError } = await supabase.storage.from(bucket).upload(objectPath, file, {
      upsert: false,
      contentType: file.type,
    });

    if (uploadError) {
      setAdminStatus("Could not upload credit report: " + uploadError.message, true);
      return;
    }

    const { data: fileRow, error: rowError } = await supabase
      .from("client_files")
      .insert({
        user_id: activeClientId,
        bucket,
        file_path: objectPath,
        file_name: file.name,
        content_type: file.type,
        file_size: file.size,
        category: "Credit Report",
        title: reportLabel,
        notes: summary || null,
        uploaded_by: "admin",
      })
      .select("id,title,notes,category,file_name,file_path,bucket,created_at,uploaded_by,content_type,file_size")
      .single();

    if (rowError) {
      setAdminStatus("Report uploaded but metadata save failed: " + rowError.message, true);
      return;
    }

    try {
      await upsertCreditReportRow(
        buildManualCreditReport({
          bureau,
          report_date: reportDate,
          score: scoreRaw,
          report_label: reportLabel,
          summary,
          source: "admin_upload",
          verification_status: "pending",
          verification_method: "manual",
          file_id: fileRow.id,
        })
      );
    } catch (error) {
      if (isMissingFeatureError(error)) {
        setAdminStatus("Run the updated supabase-portal-schema.sql before using credit reports.", true);
        return;
      }
      setAdminStatus("Credit report saved but report record failed: " + (error?.message || error), true);
      return;
    }

    if (runAiReview) {
      try {
        setScanStatus("");
        if (file.size > MAX_AI_REVIEW_SIZE_BYTES) {
          setAiVerifyStatus(
            `Report uploaded. AI verification skipped because PDF review only handles files up to ${formatMbLimit(MAX_AI_REVIEW_SIZE_MB)}. Use browser scan for a smaller excerpt or add negative items manually.`,
            true
          );
        } else {
          setAiVerifyStatus("AI reviewing uploaded PDF report...");
          const analysis = await verifyFileRowWithAi(fileRow);
          const result = await applyAiReviewResult(fileRow, analysis, {
            bureau,
            report_date: reportDate,
            score: scoreRaw,
            report_label: reportLabel,
            summary,
            source: "admin_upload",
            persistRejectedReport: true,
          });
          if (result.accepted) {
            setAiVerifyStatus(
              `AI verification complete: ${result.itemsCreated} negative item(s) verified from the PDF report.`
            );
          } else {
            setAiVerifyStatus(
              analysis?.document?.reason ||
                "AI review rejected this file because it does not look like a real credit report PDF.",
              true
            );
          }
        }
      } catch (error) {
        setAiVerifyStatus(
          "Report uploaded, but AI verification failed: " + (error?.message || "Unknown error"),
          true
        );
      }
    } else {
      setAiVerifyStatus("");
      setScanStatus("");
    }

    creditReportForm.reset();
    setAdminStatus("Credit report uploaded.");
    await loadClientPreview(activeClientId);
  });

  negativeItemForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(await requireActiveClient())) return;

    const creditor = String(document.getElementById("negative-creditor")?.value || "").trim();
    const itemType = String(document.getElementById("negative-type")?.value || "").trim();

    if (!creditor || !itemType) {
      setAdminStatus("Creditor and item type are required.", true);
      return;
    }

    try {
      await upsertNegativeItemRow(
        buildManualNegativeItem({
          bureau: String(document.getElementById("negative-bureau")?.value || "").trim(),
          creditor,
          item_type: itemType,
          account_reference: String(document.getElementById("negative-account-ref")?.value || "").trim(),
          balance: String(document.getElementById("negative-balance")?.value || "").trim(),
          status: String(document.getElementById("negative-status")?.value || "").trim(),
          notes: String(document.getElementById("negative-notes")?.value || "").trim(),
          is_active: Boolean(document.getElementById("negative-active")?.checked),
          source: "manual",
        })
      );
    } catch (error) {
      if (isMissingFeatureError(error)) {
        setAdminStatus("Run the updated supabase-portal-schema.sql before using negative items.", true);
        return;
      }
      setAdminStatus("Could not save negative item: " + (error?.message || error), true);
      return;
    }

    negativeItemForm.reset();
    const activeCheckbox = document.getElementById("negative-active");
    if (activeCheckbox) activeCheckbox.checked = true;
    setAdminStatus("Negative item saved.");
    await loadClientPreview(activeClientId);
  });

  snapshotForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(await requireActiveClient())) return;

    const bureau = String(document.getElementById("snapshot-bureau")?.value || "");
    const score = Number(document.getElementById("snapshot-score")?.value || 0);
    const reportedAt = String(document.getElementById("snapshot-date")?.value || "");

    if (!reportedAt || !score) {
      setAdminStatus("Score and reported date are required.", true);
      return;
    }

    const { error } = await supabase.from("credit_snapshots").insert({
      user_id: activeClientId,
      bureau,
      score,
      reported_at: reportedAt,
    });

    if (error) {
      setAdminStatus("Could not add snapshot: " + error.message, true);
      return;
    }

    snapshotForm.reset();
    setAdminStatus("Snapshot added.");
    await loadClientPreview(activeClientId);
  });

  letterForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(await requireActiveClient())) return;

    const sentDate = String(document.getElementById("letter-date")?.value || "");
    const recipient = String(document.getElementById("letter-recipient")?.value || "").trim();
    const tracking = String(document.getElementById("letter-tracking")?.value || "").trim();
    const status = String(document.getElementById("letter-status")?.value || "").trim();
    const notes = String(document.getElementById("letter-notes")?.value || "").trim();

    if (!sentDate || !recipient || !tracking) {
      setAdminStatus("Sent date, recipient, and tracking number are required.", true);
      return;
    }

    const { error } = await supabase.from("client_letters").insert({
      user_id: activeClientId,
      sent_date: sentDate,
      recipient,
      bureau: recipient,
      tracking_number: tracking,
      status,
      notes: notes || null,
    });

    if (error) {
      setAdminStatus("Could not add letter record: " + error.message, true);
      return;
    }

    letterForm.reset();
    setAdminStatus("Letter record added.");
    await loadClientPreview(activeClientId);
  });

  letterUpdateForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const letterId = Number(document.getElementById("letter-id")?.value || 0);
    const status = String(document.getElementById("letter-update-status")?.value || "").trim();
    const notes = String(document.getElementById("letter-update-notes")?.value || "").trim();

    if (!letterId) {
      setAdminStatus("Letter ID is required.", true);
      return;
    }

    const { error } = await supabase
      .from("client_letters")
      .update({ status, notes: notes || null })
      .eq("id", letterId);

    if (error) {
      setAdminStatus("Could not update letter: " + error.message, true);
      return;
    }

    letterUpdateForm.reset();
    setAdminStatus("Letter status updated.");
    if (activeClientId) await loadClientPreview(activeClientId);
  });

  timelineForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(await requireActiveClient())) return;

    const details = String(document.getElementById("timeline-details")?.value || "").trim();
    if (!details) {
      setAdminStatus("Update details are required.", true);
      return;
    }

    const { error } = await supabase.from("client_updates").insert({
      user_id: activeClientId,
      details,
    });

    if (error) {
      setAdminStatus("Could not add timeline update: " + error.message, true);
      return;
    }

    timelineForm.reset();
    setAdminStatus("Timeline update added.");
    await loadClientPreview(activeClientId);
  });

  fileUploadForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(await requireActiveClient())) return;

    const fileInput = document.getElementById("file-input");
    const file = fileInput?.files?.[0];
    const category = String(document.getElementById("file-category")?.value || "").trim();
    const notes = String(document.getElementById("file-notes")?.value || "").trim();
    const titleInput = String(document.getElementById("file-title")?.value || "").trim();

    if (!file) {
      setAdminStatus("Choose a file to upload.", true);
      return;
    }

    const allowedTypes = new Set([
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/webp",
    ]);
    if (!allowedTypes.has(file.type)) {
      setAdminStatus("Only PDF, PNG, JPG, or WebP files are allowed.", true);
      return;
    }

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      setAdminStatus(`File must be ${formatMbLimit(MAX_UPLOAD_SIZE_MB)} or smaller.`, true);
      return;
    }

    const bucket = "client-docs";
    const safeName = sanitizeFileName(file.name);
    const objectPath = `${activeClientId}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage.from(bucket).upload(objectPath, file, {
      upsert: false,
      contentType: file.type,
    });

    if (uploadError) {
      setAdminStatus("Could not upload file: " + uploadError.message, true);
      return;
    }

    const { error: rowError } = await supabase.from("client_files").insert({
      user_id: activeClientId,
      bucket,
      file_path: objectPath,
      file_name: file.name,
      content_type: file.type,
      file_size: file.size,
      category: category || "Other",
      title: titleInput || file.name,
      notes: notes || null,
    });

    if (rowError) {
      setAdminStatus("File uploaded but metadata save failed: " + rowError.message, true);
      return;
    }

    fileUploadForm.reset();
    setAdminStatus("File uploaded and attached to client record.");
    await loadClientPreview(activeClientId);
  });

  aiVerifyDocumentsBtn?.addEventListener("click", async () => {
    if (!(await requireActiveClient())) return;

    aiVerifyDocumentsBtn.disabled = true;
    setAiVerifyStatus("Loading uploaded PDF reports...");

    try {
      const files = await loadClientFiles(activeClientId);
      const candidates = files.filter(isLikelyCreditReportCandidate);

      if (!candidates.length) {
        setAiVerifyStatus(
          "No likely credit report PDFs found. Upload the file in the Credit Reports section or use a title that clearly marks it as a credit report.",
          true
        );
        return;
      }

      let reviewed = 0;
      let verifiedReports = 0;
      let rejectedReports = 0;
      let itemsCreated = 0;
      let skippedOversize = 0;

      for (let index = 0; index < candidates.length; index += 1) {
        const row = candidates[index];
        const label = row.title || row.file_name || `PDF ${index + 1}`;

        if (Number(row.file_size || 0) > MAX_AI_REVIEW_SIZE_BYTES) {
          skippedOversize += 1;
          continue;
        }

        setAiVerifyStatus(`AI reviewing ${index + 1}/${candidates.length}: ${label}`);
        const analysis = await verifyFileRowWithAi(row);
        const result = await applyAiReviewResult(row, analysis, {
          source: inferReportSource(row),
        });

        reviewed += 1;
        if (result.accepted) {
          verifiedReports += 1;
          itemsCreated += result.itemsCreated;
        } else {
          rejectedReports += 1;
        }
      }

      const skippedNote = skippedOversize
        ? ` ${skippedOversize} oversized PDF(s) were skipped because AI review is limited to ${formatMbLimit(MAX_AI_REVIEW_SIZE_MB)}.`
        : "";
      setAiVerifyStatus(
        `AI review complete: ${reviewed} PDF(s) reviewed, ${verifiedReports} verified, ${rejectedReports} rejected, ${itemsCreated} negative item(s) added.${skippedNote}`
      );
      setAdminStatus("AI review finished.");
      await loadClientPreview(activeClientId);
    } catch (error) {
      if (isMissingFeatureError(error)) {
        setAiVerifyStatus("Run the updated supabase-portal-schema.sql before using AI review.", true);
      } else {
        setAiVerifyStatus("AI review failed: " + (error?.message || "Unknown error"), true);
      }
    } finally {
      aiVerifyDocumentsBtn.disabled = false;
    }
  });

  scanDocumentsBtn?.addEventListener("click", async () => {
    if (!(await requireActiveClient())) return;

    scanDocumentsBtn.disabled = true;
    setScanStatus("Loading uploaded documents...");

    try {
      const files = await loadClientFiles(activeClientId);
      const result = await scanFileRows(files, { storeReports: true });
      const skippedNote = result.skippedFiles
        ? ` ${result.skippedFiles} oversized file(s) were skipped because browser scanning is limited to ${formatMbLimit(MAX_BROWSER_SCAN_SIZE_MB)}.`
        : "";
      setScanStatus(
        `Scan complete: ${result.scannedFiles} file(s), ${result.reportsCreated} report summary row(s), ${result.itemsCreated} negative item(s).${skippedNote}`
      );
      setAdminStatus("Document scan finished.");
      await loadClientPreview(activeClientId);
    } catch (error) {
      if (isMissingFeatureError(error)) {
        setScanStatus("Run the updated supabase-portal-schema.sql before using the scanner.", true);
      } else {
        setScanStatus("Scanner failed: " + (error?.message || error), true);
      }
    } finally {
      scanDocumentsBtn.disabled = false;
    }
  });

  adminMessageForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(await requireActiveClient())) return;
    const content = String(adminMessageInput?.value || "").trim();
    if (!content) { setAdminStatus("Message cannot be empty.", true); return; }

    const { error } = await supabase.from("portal_messages").insert({
      user_id: activeClientId,
      sender_role: "admin",
      content,
    });

    if (error) { setAdminStatus("Could not send message: " + error.message, true); return; }
    if (adminMessageInput) adminMessageInput.value = "";
    setAdminStatus("Message sent.");
    await loadClientPreview(activeClientId);
  });

  supabase.auth.getSession().then(async ({ data }) => {
    const user = data.session?.user;
    if (!user) {
      showAuth();
      return;
    }
    const allowed = await checkAdmin(user.id);
    if (!allowed) {
      await supabase.auth.signOut();
      showAuth();
      setAuthStatus("Access denied. This account is not in admin_users.", true);
      return;
    }
    currentAdmin = user;
    adminIdentity.textContent = `Signed in as ${user.email}`;
    prefillProfileUserId(user.id);
    showAdmin();
    initTabs();
    await loadClients();
  });
}

initialize();
