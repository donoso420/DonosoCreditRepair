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
const snapshotEditIdInput = document.getElementById("snapshot-edit-id");
const snapshotSubmitBtn = document.getElementById("snapshot-submit-btn");
const snapshotCancelBtn = document.getElementById("snapshot-cancel-btn");
const creditReportForm = document.getElementById("credit-report-form");
const negativeItemForm = document.getElementById("negative-item-form");
const negativeEditIdInput = document.getElementById("negative-edit-id");
const negativeSubmitBtn = document.getElementById("negative-submit-btn");
const negativeCancelBtn = document.getElementById("negative-cancel-btn");
const letterForm = document.getElementById("letter-form");
const letterEditIdInput = document.getElementById("letter-edit-id");
const letterSubmitBtn = document.getElementById("letter-submit-btn");
const letterCancelBtn = document.getElementById("letter-cancel-btn");
const letterUpdateForm = document.getElementById("letter-update-form");
const timelineForm = document.getElementById("timeline-form");
const timelineEditIdInput = document.getElementById("timeline-edit-id");
const timelineSubmitBtn = document.getElementById("timeline-submit-btn");
const timelineCancelBtn = document.getElementById("timeline-cancel-btn");
const fileUploadForm = document.getElementById("file-upload-form");
const scanDocumentsBtn = document.getElementById("scan-documents-btn");
const scanDocumentsStatus = document.getElementById("scan-documents-status");
const reportAutofillStatus = document.getElementById("report-autofill-status");

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
const MAX_BROWSER_SCAN_SIZE_MB = 40;
const MAX_BROWSER_SCAN_SIZE_BYTES = MAX_BROWSER_SCAN_SIZE_MB * 1024 * 1024;

const missingConfig = ["supabaseUrl", "supabaseAnonKey"].filter((k) => !config[k]);
let supabase = null;
let currentAdmin = null;
let activeClientId = null;
let activeClientFiles = [];
let activeScoreRows = [];
let activeNegativeItemRows = [];
let activeLetterRows = [];
let activeUpdateRows = [];

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

function setReportAutofillStatus(message, isError = false) {
  if (!reportAutofillStatus) return;
  reportAutofillStatus.textContent = message;
  reportAutofillStatus.classList.toggle("error", isError);
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

function renderFileActionButtons(fileRow) {
  const viewButton = fileRow.signed_url
    ? `<a class="btn secondary sm" href="${safeText(fileRow.signed_url)}" target="_blank" rel="noopener noreferrer">View</a>`
    : `<span class="muted sm">No link</span>`;
  return `
    <div class="file-actions-row">
      ${viewButton}
      <button class="btn danger sm" type="button" data-action="delete-file" data-file-id="${safeText(
        fileRow.id
      )}">Delete</button>
    </div>
  `;
}

function renderRecordActionButtons(id, editAction, deleteAction) {
  return `
    <div class="file-actions-row">
      <button class="btn secondary sm" type="button" data-action="${safeText(
        editAction
      )}" data-row-id="${safeText(id)}">Edit</button>
      <button class="btn danger sm" type="button" data-action="${safeText(
        deleteAction
      )}" data-row-id="${safeText(id)}">Delete</button>
    </div>
  `;
}

function toggleFormEditMode(submitBtn, cancelBtn, isEditing, createLabel, editLabel) {
  if (submitBtn) submitBtn.textContent = isEditing ? editLabel : createLabel;
  cancelBtn?.classList.toggle("hidden", !isEditing);
}

function resetSnapshotForm() {
  snapshotForm?.reset();
  if (snapshotEditIdInput) snapshotEditIdInput.value = "";
  toggleFormEditMode(snapshotSubmitBtn, snapshotCancelBtn, false, "Add Snapshot", "Save Snapshot");
}

function populateSnapshotForm(row) {
  if (!row) return;
  if (snapshotEditIdInput) snapshotEditIdInput.value = String(row.id || "");
  const bureauInput = document.getElementById("snapshot-bureau");
  const scoreInput = document.getElementById("snapshot-score");
  const dateInput = document.getElementById("snapshot-date");
  if (bureauInput) bureauInput.value = row.bureau || "Experian";
  if (scoreInput) scoreInput.value = row.score ?? "";
  if (dateInput) dateInput.value = row.reported_at || "";
  toggleFormEditMode(snapshotSubmitBtn, snapshotCancelBtn, true, "Add Snapshot", "Save Snapshot");
  snapshotForm?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetTimelineForm() {
  timelineForm?.reset();
  if (timelineEditIdInput) timelineEditIdInput.value = "";
  toggleFormEditMode(timelineSubmitBtn, timelineCancelBtn, false, "Post Update", "Save Update");
}

function populateTimelineForm(row) {
  if (!row) return;
  if (timelineEditIdInput) timelineEditIdInput.value = String(row.id || "");
  const detailsInput = document.getElementById("timeline-details");
  if (detailsInput) detailsInput.value = row.details || "";
  toggleFormEditMode(timelineSubmitBtn, timelineCancelBtn, true, "Post Update", "Save Update");
  timelineForm?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetNegativeItemForm() {
  negativeItemForm?.reset();
  if (negativeEditIdInput) negativeEditIdInput.value = "";
  const activeCheckbox = document.getElementById("negative-active");
  if (activeCheckbox) activeCheckbox.checked = true;
  toggleFormEditMode(
    negativeSubmitBtn,
    negativeCancelBtn,
    false,
    "Save Negative Item",
    "Save Changes"
  );
}

function populateNegativeItemForm(row) {
  if (!row) return;
  if (negativeEditIdInput) negativeEditIdInput.value = String(row.id || "");
  const bureauInput = document.getElementById("negative-bureau");
  const typeInput = document.getElementById("negative-type");
  const creditorInput = document.getElementById("negative-creditor");
  const accountRefInput = document.getElementById("negative-account-ref");
  const balanceInput = document.getElementById("negative-balance");
  const statusInput = document.getElementById("negative-status");
  const notesInput = document.getElementById("negative-notes");
  const activeCheckbox = document.getElementById("negative-active");
  if (bureauInput) bureauInput.value = row.bureau || "";
  if (typeInput) typeInput.value = row.item_type || "Collection";
  if (creditorInput) creditorInput.value = row.creditor || "";
  if (accountRefInput) accountRefInput.value = row.account_reference || "";
  if (balanceInput) balanceInput.value = row.balance ?? "";
  if (statusInput) statusInput.value = row.status || "";
  if (notesInput) notesInput.value = row.notes || "";
  if (activeCheckbox) activeCheckbox.checked = row.is_active !== false;
  toggleFormEditMode(
    negativeSubmitBtn,
    negativeCancelBtn,
    true,
    "Save Negative Item",
    "Save Changes"
  );
  negativeItemForm?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetLetterForm() {
  letterForm?.reset();
  if (letterEditIdInput) letterEditIdInput.value = "";
  toggleFormEditMode(letterSubmitBtn, letterCancelBtn, false, "Add Letter Record", "Save Letter");
}

function populateLetterForm(row) {
  if (!row) return;
  if (letterEditIdInput) letterEditIdInput.value = String(row.id || "");
  const sentDateInput = document.getElementById("letter-date");
  const statusInput = document.getElementById("letter-status");
  const recipientInput = document.getElementById("letter-recipient");
  const trackingInput = document.getElementById("letter-tracking");
  const notesInput = document.getElementById("letter-notes");
  if (sentDateInput) sentDateInput.value = row.sent_date || "";
  if (statusInput) statusInput.value = row.status || "In Transit";
  if (recipientInput) recipientInput.value = row.recipient || row.bureau || "";
  if (trackingInput) trackingInput.value = row.tracking_number || "";
  if (notesInput) notesInput.value = row.notes || "";
  toggleFormEditMode(letterSubmitBtn, letterCancelBtn, true, "Add Letter Record", "Save Letter");
  letterForm?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function formatVerificationStatus(value) {
  switch (String(value || "").toLowerCase()) {
    case "verified":
      return "Verified";
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
      return "PDF review";
    case "browser_scan":
      return "Document scan";
    default:
      return "Manual";
  }
}

function getNegativeItemStage(row = {}) {
  const status = String(row.status || "").toLowerCase();
  const notes = String(row.notes || "").toLowerCase();
  const combined = `${status} ${notes}`;

  if (
    row.is_active === false ||
    /\b(resolved|removed|deleted|completed|closed|cleared)\b/.test(combined)
  ) {
    return { label: "Resolved", step: 3, className: "stage-resolved" };
  }

  if (
    /\b(disput|investigat|challeng|follow[- ]?up|mailed|sent|respond|pending|review|processing|verif)\w*\b/.test(
      combined
    )
  ) {
    return { label: "In progress", step: 2, className: "stage-working" };
  }

  return { label: "Logged", step: 1, className: "stage-logged" };
}

function renderNegativeAdminStage(step) {
  return ["Logged", "Working", "Resolved"]
    .map((label, index) => {
      const complete = index + 1 <= step ? "complete" : "";
      return `
        <span class="mini-stage-step ${complete}">
          <span class="mini-stage-dot"></span>
          ${safeText(label)}
        </span>
      `;
    })
    .join("");
}

function normalizeReportBureau(value) {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("experian")) return "Experian";
  if (raw.includes("equifax")) return "Equifax";
  if (raw.includes("transunion") || raw.includes("trans union")) return "TransUnion";
  return "";
}

function buildAutoReportLabel({ bureau, reportDate, fileName }) {
  const cleanName = String(fileName || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  if (bureau && reportDate) {
    return `${bureau} report pulled ${new Date(`${reportDate}T00:00:00`).toLocaleDateString()}`;
  }
  if (bureau) return `${bureau} credit report`;
  return cleanName || "Credit report";
}

function buildAutoReportSummary({ result, bureau, reportDate }) {
  const score = result?.reports?.[0]?.score;
  const items = Array.isArray(result?.negativeItems) ? result.negativeItems.length : 0;
  const bureauLabel = bureau || "credit";
  const parts = [
    `Auto-filled from PDF analysis for ${bureauLabel} report.`,
  ];
  if (score) parts.push(`Detected score ${score}.`);
  if (reportDate) parts.push(`Report date ${reportDate}.`);
  parts.push(`Detected ${items} potential negative item(s).`);
  return parts.join(" ");
}

async function autofillCreditReportForm(file) {
  if (!file) {
    setReportAutofillStatus("");
    return;
  }

  const isPdfUpload =
    String(file.type || "").toLowerCase() === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdfUpload) {
    setReportAutofillStatus("Autofill only works on PDF credit reports.", true);
    return;
  }

  if (file.size > MAX_BROWSER_SCAN_SIZE_BYTES) {
    setReportAutofillStatus(
      "This PDF is too large for browser autofill. Upload it first, then use document scan or enter the report details manually.",
      true
    );
    return;
  }

  try {
    const titleInput = document.getElementById("report-title");
    const bureauInput = document.getElementById("report-bureau");
    const scoreInput = document.getElementById("report-score");
    const dateInput = document.getElementById("report-date");
    const summaryInput = document.getElementById("report-summary");

    const result = await scanCreditDocument(
      file,
      {
        fileName: file.name,
        title: titleInput?.value || file.name,
        contentType: file.type,
      },
      (message) => {
        setReportAutofillStatus(`Analyzing PDF: ${message}`);
      }
    );

    const firstReport = Array.isArray(result?.reports) && result.reports[0] ? result.reports[0] : null;
    const firstNegativeItem = Array.isArray(result?.negativeItems) && result.negativeItems[0]
      ? result.negativeItems[0]
      : null;
    const detectedBureau =
      normalizeReportBureau(firstReport?.bureau) ||
      normalizeReportBureau(firstNegativeItem?.bureau) ||
      normalizeReportBureau(file.name);
    const detectedDate = firstReport?.report_date || "";
    const detectedScore = firstReport?.score ?? "";
    const detectedLabel = buildAutoReportLabel({
      bureau: detectedBureau,
      reportDate: detectedDate,
      fileName: file.name,
    });
    const detectedSummary = buildAutoReportSummary({
      result,
      bureau: detectedBureau,
      reportDate: detectedDate,
    });

    if (titleInput) titleInput.value = detectedLabel;
    if (bureauInput && detectedBureau) bureauInput.value = detectedBureau;
    if (scoreInput && detectedScore) scoreInput.value = String(detectedScore);
    if (dateInput && detectedDate) dateInput.value = detectedDate;
    if (summaryInput) summaryInput.value = detectedSummary;

    const items = Array.isArray(result?.negativeItems) ? result.negativeItems.length : 0;
    const filled = [
      detectedBureau ? "bureau" : "",
      detectedScore ? "score" : "",
      detectedDate ? "report date" : "",
      "summary",
    ].filter(Boolean);

    if (!filled.length) {
      setReportAutofillStatus(
        "The PDF loaded, but browser autofill could not confidently detect report details. You can still upload it and use document scan or enter the report details manually.",
        true
      );
      return;
    }

    setReportAutofillStatus(
      `PDF analyzed. Filled ${filled.join(", ")} and detected ${items} potential negative item(s). Review the fields, then upload.`
    );
  } catch (error) {
    setReportAutofillStatus(
      "Could not auto-fill report details from this PDF: " + (error?.message || "Unknown error"),
      true
    );
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
    activeClientFiles = [];
    activeScoreRows = [];
    activeNegativeItemRows = [];
    activeLetterRows = [];
    activeUpdateRows = [];
    activeClientIdEl.textContent = "";
    setScanStatus("");
    resetSnapshotForm();
    resetNegativeItemForm();
    resetLetterForm();
    resetTimelineForm();
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
      return `
        <li class="file-record">
          <p class="file-record-title">${safeText(f.title || f.file_name || "File")}</p>
          <p class="file-record-meta">${safeText(
            f.category || "Document"
          )} · ${safeText(formatDate(f.created_at))}</p>
          ${renderFileActionButtons(f)}
        </li>
      `;
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
        li.className = "file-record negative-admin-card";
        const stage = getNegativeItemStage(row);
        const bureau = row.bureau || "All Bureaus";
        const balance = row.balance != null ? formatCurrency(row.balance) : "N/A";
        const review = formatVerificationMethod(row.verification_method);
        const accountRef = row.account_reference ? ` • Acct ${safeText(row.account_reference)}` : "";
        const note = row.notes || "";
        li.innerHTML = `
          <div class="negative-admin-head">
            <div>
              <p class="file-record-title">${safeText(row.creditor)} — ${safeText(
                row.item_type
              )}</p>
              <p class="file-record-meta">${safeText(bureau)}${accountRef}</p>
            </div>
            <span class="negative-admin-pill ${safeText(stage.className)}">${safeText(
              stage.label
            )}</span>
          </div>
          <div class="mini-stage">${renderNegativeAdminStage(stage.step)}</div>
          <p class="file-record-meta">${safeText(
            row.status || "Under review"
          )} · ${safeText(balance)} · ${safeText(review)}</p>
          ${note ? `<p class="negative-admin-note">${safeText(note)}</p>` : ""}
          ${renderRecordActionButtons(row.id, "edit-negative-item", "delete-negative-item")}
        `;
        previewNegativeItems.appendChild(li);
      }
    }
  }

  if (!scores.length) {
    previewScores.innerHTML = "<li>No score records yet.</li>";
  } else {
    for (const row of scores) {
      const li = document.createElement("li");
      li.className = "file-record";
      li.innerHTML = `
        <p class="file-record-title">${safeText(row.bureau)}: ${safeText(row.score)}</p>
        <p class="file-record-meta">${safeText(formatDate(row.reported_at))}</p>
        ${renderRecordActionButtons(row.id, "edit-score", "delete-score")}
      `;
      previewScores.appendChild(li);
    }
  }

  if (!letters.length) {
    previewLetters.innerHTML = "<li>No letter records yet.</li>";
  } else {
    for (const row of letters) {
      const li = document.createElement("li");
      li.className = "file-record";
      li.innerHTML = `
        <p class="file-record-title">#${safeText(row.id)} · ${safeText(
          row.recipient || row.bureau || "N/A"
        )}</p>
        <p class="file-record-meta">${safeText(row.tracking_number || "N/A")} · ${safeText(
          row.status || "In Transit"
        )}</p>
        ${renderRecordActionButtons(row.id, "edit-letter", "delete-letter")}
      `;
      previewLetters.appendChild(li);
    }
  }

  if (!updates.length) {
    previewUpdates.innerHTML = "<li>No updates yet.</li>";
  } else {
    for (const row of updates) {
      const li = document.createElement("li");
      li.className = "file-record";
      li.innerHTML = `
        <p class="file-record-title">${safeText(formatDate(row.created_at))}</p>
        <p class="file-record-meta">${safeText(row.details)}</p>
        ${renderRecordActionButtons(row.id, "edit-update", "delete-update")}
      `;
      previewUpdates.appendChild(li);
    }
  }

  if (!files.length) {
    previewFiles.innerHTML = "<li>No files yet.</li>";
  } else {
    for (const row of files) {
      const li = document.createElement("li");
      li.className = "file-record";
      li.innerHTML = `
        <p class="file-record-title">${safeText(row.title || row.file_name || "Attachment")}</p>
        <p class="file-record-meta">${safeText(row.category || "File")} · ${safeText(
        formatDate(row.created_at)
      )}</p>
        ${renderFileActionButtons(row)}
      `;
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
      supabase.from("credit_snapshots").select("id,bureau,score,reported_at,created_at").eq("user_id", userId).order("reported_at", { ascending: false }).limit(12),
      supabase.from("client_letters").select("id,recipient,bureau,tracking_number,status,sent_date,notes,created_at").eq("user_id", userId).order("sent_date", { ascending: false }).limit(20),
      supabase.from("client_updates").select("id,details,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
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
          .select("id,bureau,creditor,item_type,account_reference,balance,status,notes,is_active,source,source_file_id,report_id,verification_method,confidence,created_at")
          .eq("user_id", userId)
          .order("is_active", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(40)
      ),
    ]);

  const filesWithUrls = files || [];
  activeClientFiles = filesWithUrls;
  activeScoreRows = scores || [];
  activeLetterRows = letters || [];
  activeUpdateRows = updates || [];
  activeNegativeItemRows = negativeItems || [];
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

async function safeDeleteQuery(queryPromise) {
  const { error } = await queryPromise;
  if (!error || isMissingFeatureError(error)) return;
  throw error;
}

async function deleteClientFile(fileId) {
  const numericFileId = Number(fileId || 0);
  if (!numericFileId || !activeClientId) return;

  const fileRow = activeClientFiles.find((row) => Number(row.id) === numericFileId);
  if (!fileRow) {
    setAdminStatus("That file is no longer loaded. Refresh and try again.", true);
    return;
  }

  const label = fileRow.title || fileRow.file_name || "this file";
  const warning = isLikelyCreditReportCandidate(fileRow)
    ? " This will also remove any report summary rows and negative items linked to this file."
    : "";
  const confirmed = window.confirm(`Delete ${label}?${warning}`);
  if (!confirmed) return;

  setAdminStatus(`Deleting ${label}...`);

  try {
    await safeDeleteQuery(
      supabase
        .from("negative_items")
        .delete()
        .eq("user_id", activeClientId)
        .eq("source_file_id", numericFileId)
    );

    await safeDeleteQuery(
      supabase
        .from("credit_reports")
        .delete()
        .eq("user_id", activeClientId)
        .eq("file_id", numericFileId)
    );

    const { error: rowError } = await supabase
      .from("client_files")
      .delete()
      .eq("user_id", activeClientId)
      .eq("id", numericFileId);

    if (rowError) {
      throw rowError;
    }

    const { error: storageError } = await supabase
      .storage
      .from(fileRow.bucket || "client-docs")
      .remove([fileRow.file_path]);

    if (storageError) {
      setAdminStatus(
        `${label} was removed from the client record, but storage cleanup failed: ${storageError.message}`,
        true
      );
    } else {
      setAdminStatus(`${label} deleted.`);
    }

    await loadClientPreview(activeClientId);
  } catch (error) {
    setAdminStatus("Could not delete file: " + (error?.message || error), true);
  }
}

function findActiveRow(rows, rowId) {
  const numericId = Number(rowId || 0);
  return (rows || []).find((row) => Number(row.id) === numericId) || null;
}

async function deleteClientRecord({ table, rowId, label, successMessage }) {
  const numericId = Number(rowId || 0);
  if (!numericId || !activeClientId) return;

  const confirmed = window.confirm(`Delete ${label}?`);
  if (!confirmed) return;

  setAdminStatus(`Deleting ${label}...`);

  const { error } = await supabase
    .from(table)
    .delete()
    .eq("user_id", activeClientId)
    .eq("id", numericId);

  if (error) {
    setAdminStatus(`Could not delete ${label}: ${error.message}`, true);
    return;
  }

  setAdminStatus(successMessage);
  await loadClientPreview(activeClientId);
}

async function handlePreviewRecordAction(action, rowId) {
  switch (action) {
    case "edit-score": {
      const row = findActiveRow(activeScoreRows, rowId);
      if (!row) {
        setAdminStatus("Score snapshot not found. Refresh and try again.", true);
        return;
      }
      populateSnapshotForm(row);
      return;
    }
    case "delete-score": {
      const row = findActiveRow(activeScoreRows, rowId);
      if (!row) {
        setAdminStatus("Score snapshot not found. Refresh and try again.", true);
        return;
      }
      await deleteClientRecord({
        table: "credit_snapshots",
        rowId,
        label: `${row.bureau} score snapshot from ${formatDate(row.reported_at)}`,
        successMessage: "Score snapshot deleted.",
      });
      return;
    }
    case "edit-negative-item": {
      const row = findActiveRow(activeNegativeItemRows, rowId);
      if (!row) {
        setAdminStatus("Negative item not found. Refresh and try again.", true);
        return;
      }
      populateNegativeItemForm(row);
      return;
    }
    case "delete-negative-item": {
      const row = findActiveRow(activeNegativeItemRows, rowId);
      if (!row) {
        setAdminStatus("Negative item not found. Refresh and try again.", true);
        return;
      }
      await deleteClientRecord({
        table: "negative_items",
        rowId,
        label: `${row.creditor} ${row.item_type}`,
        successMessage: "Negative item deleted.",
      });
      return;
    }
    case "edit-letter": {
      const row = findActiveRow(activeLetterRows, rowId);
      if (!row) {
        setAdminStatus("Letter record not found. Refresh and try again.", true);
        return;
      }
      populateLetterForm(row);
      return;
    }
    case "delete-letter": {
      const row = findActiveRow(activeLetterRows, rowId);
      if (!row) {
        setAdminStatus("Letter record not found. Refresh and try again.", true);
        return;
      }
      await deleteClientRecord({
        table: "client_letters",
        rowId,
        label: `letter #${row.id}`,
        successMessage: "Letter record deleted.",
      });
      return;
    }
    case "edit-update": {
      const row = findActiveRow(activeUpdateRows, rowId);
      if (!row) {
        setAdminStatus("Timeline update not found. Refresh and try again.", true);
        return;
      }
      populateTimelineForm(row);
      return;
    }
    case "delete-update": {
      const row = findActiveRow(activeUpdateRows, rowId);
      if (!row) {
        setAdminStatus("Timeline update not found. Refresh and try again.", true);
        return;
      }
      await deleteClientRecord({
        table: "client_updates",
        rowId,
        label: "this timeline update",
        successMessage: "Timeline update deleted.",
      });
      return;
    }
    default:
      return;
  }
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
    activeClientFiles = [];
    activeScoreRows = [];
    activeNegativeItemRows = [];
    activeLetterRows = [];
    activeUpdateRows = [];
    activeClientIdEl.textContent = activeClientId ? `Active user_id: ${activeClientId}` : "";
    setScanStatus("");
    resetSnapshotForm();
    resetNegativeItemForm();
    resetLetterForm();
    resetTimelineForm();
    await loadClientPreview(activeClientId);
  });

  const handleFileActionClick = async (event) => {
    const actionEl = event.target.closest("[data-action]");
    if (!actionEl) return;

    const action = String(actionEl.getAttribute("data-action") || "");
    const fileId = actionEl.getAttribute("data-file-id");
    if (action !== "delete-file" || !fileId) return;

    event.preventDefault();
    await deleteClientFile(fileId);
  };

  previewFiles?.addEventListener("click", handleFileActionClick);
  previewClientUploads?.addEventListener("click", handleFileActionClick);

  const handlePreviewRecordClick = async (event) => {
    const actionEl = event.target.closest("[data-action]");
    if (!actionEl) return;

    const action = String(actionEl.getAttribute("data-action") || "");
    const rowId = actionEl.getAttribute("data-row-id");
    if (!rowId) return;

    event.preventDefault();
    await handlePreviewRecordAction(action, rowId);
  };

  previewScores?.addEventListener("click", handlePreviewRecordClick);
  previewNegativeItems?.addEventListener("click", handlePreviewRecordClick);
  previewLetters?.addEventListener("click", handlePreviewRecordClick);
  previewUpdates?.addEventListener("click", handlePreviewRecordClick);

  const reportFileInput = document.getElementById("report-file-input");
  reportFileInput?.addEventListener("change", async () => {
    const file = reportFileInput.files?.[0];
    await autofillCreditReportForm(file || null);
  });

  snapshotCancelBtn?.addEventListener("click", resetSnapshotForm);
  negativeCancelBtn?.addEventListener("click", resetNegativeItemForm);
  letterCancelBtn?.addEventListener("click", resetLetterForm);
  timelineCancelBtn?.addEventListener("click", resetTimelineForm);

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

    creditReportForm.reset();
    setReportAutofillStatus("");
    setScanStatus("");
    setAdminStatus("Credit report uploaded. Use document scan if you want help pulling report details from the PDF.");
    await loadClientPreview(activeClientId);
  });

  negativeItemForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(await requireActiveClient())) return;

    const editId = Number(negativeEditIdInput?.value || 0);
    const creditor = String(document.getElementById("negative-creditor")?.value || "").trim();
    const itemType = String(document.getElementById("negative-type")?.value || "").trim();

    if (!creditor || !itemType) {
      setAdminStatus("Creditor and item type are required.", true);
      return;
    }

    try {
      const baseItem = buildManualNegativeItem({
        bureau: String(document.getElementById("negative-bureau")?.value || "").trim(),
        creditor,
        item_type: itemType,
        account_reference: String(document.getElementById("negative-account-ref")?.value || "").trim(),
        balance: String(document.getElementById("negative-balance")?.value || "").trim(),
        status: String(document.getElementById("negative-status")?.value || "").trim(),
        notes: String(document.getElementById("negative-notes")?.value || "").trim(),
        is_active: Boolean(document.getElementById("negative-active")?.checked),
        source: "manual",
        verification_method: "manual",
      });

      if (editId) {
        const existingRow = findActiveRow(activeNegativeItemRows, editId);
        const { error } = await supabase
          .from("negative_items")
          .update({
            ...baseItem,
            bureau: baseItem.bureau || null,
            account_reference: baseItem.account_reference || null,
            balance: baseItem.balance ?? null,
            status: baseItem.status || null,
            notes: baseItem.notes || null,
            source: "manual",
            verification_method: "manual",
            verification_notes: "Updated by admin.",
            evidence_excerpt: existingRow?.evidence_excerpt || null,
            source_file_id: existingRow?.source_file_id || null,
            report_id: existingRow?.report_id || null,
            verified_at: null,
            ai_model: null,
            confidence: null,
          })
          .eq("user_id", activeClientId)
          .eq("id", editId);

        if (error) throw error;
      } else {
        await upsertNegativeItemRow(baseItem);
      }
    } catch (error) {
      if (isMissingFeatureError(error)) {
        setAdminStatus("Run the updated supabase-portal-schema.sql before using negative items.", true);
        return;
      }
      setAdminStatus("Could not save negative item: " + (error?.message || error), true);
      return;
    }

    resetNegativeItemForm();
    setAdminStatus(editId ? "Negative item updated." : "Negative item saved.");
    await loadClientPreview(activeClientId);
  });

  snapshotForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(await requireActiveClient())) return;

    const editId = Number(snapshotEditIdInput?.value || 0);
    const bureau = String(document.getElementById("snapshot-bureau")?.value || "");
    const score = Number(document.getElementById("snapshot-score")?.value || 0);
    const reportedAt = String(document.getElementById("snapshot-date")?.value || "");

    if (!reportedAt || !score) {
      setAdminStatus("Score and reported date are required.", true);
      return;
    }

    const query = editId
      ? supabase
          .from("credit_snapshots")
          .update({
            bureau,
            score,
            reported_at: reportedAt,
          })
          .eq("user_id", activeClientId)
          .eq("id", editId)
      : supabase.from("credit_snapshots").insert({
          user_id: activeClientId,
          bureau,
          score,
          reported_at: reportedAt,
        });

    const { error } = await query;

    if (error) {
      setAdminStatus("Could not add snapshot: " + error.message, true);
      return;
    }

    resetSnapshotForm();
    setAdminStatus(editId ? "Snapshot updated." : "Snapshot added.");
    await loadClientPreview(activeClientId);
  });

  letterForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(await requireActiveClient())) return;

    const editId = Number(letterEditIdInput?.value || 0);
    const sentDate = String(document.getElementById("letter-date")?.value || "");
    const recipient = String(document.getElementById("letter-recipient")?.value || "").trim();
    const tracking = String(document.getElementById("letter-tracking")?.value || "").trim();
    const status = String(document.getElementById("letter-status")?.value || "").trim();
    const notes = String(document.getElementById("letter-notes")?.value || "").trim();

    if (!sentDate || !recipient || !tracking) {
      setAdminStatus("Sent date, recipient, and tracking number are required.", true);
      return;
    }

    const query = editId
      ? supabase
          .from("client_letters")
          .update({
            sent_date: sentDate,
            recipient,
            bureau: recipient,
            tracking_number: tracking,
            status,
            notes: notes || null,
          })
          .eq("user_id", activeClientId)
          .eq("id", editId)
      : supabase.from("client_letters").insert({
          user_id: activeClientId,
          sent_date: sentDate,
          recipient,
          bureau: recipient,
          tracking_number: tracking,
          status,
          notes: notes || null,
        });

    const { error } = await query;

    if (error) {
      setAdminStatus("Could not add letter record: " + error.message, true);
      return;
    }

    resetLetterForm();
    setAdminStatus(editId ? "Letter record updated." : "Letter record added.");
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

    const editId = Number(timelineEditIdInput?.value || 0);
    const details = String(document.getElementById("timeline-details")?.value || "").trim();
    if (!details) {
      setAdminStatus("Update details are required.", true);
      return;
    }

    const query = editId
      ? supabase
          .from("client_updates")
          .update({ details })
          .eq("user_id", activeClientId)
          .eq("id", editId)
      : supabase.from("client_updates").insert({
          user_id: activeClientId,
          details,
        });

    const { error } = await query;

    if (error) {
      setAdminStatus("Could not add timeline update: " + error.message, true);
      return;
    }

    resetTimelineForm();
    setAdminStatus(editId ? "Timeline update saved." : "Timeline update added.");
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
