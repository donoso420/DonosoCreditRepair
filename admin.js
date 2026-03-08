import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import {
  buildManualCreditReport,
  buildManualNegativeItem,
  formatCurrency,
  scanCreditDocument,
} from "./credit-report-tools.js?v=20260308a";

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
const billingPlanForm = document.getElementById("billing-plan-form");
const invoiceForm = document.getElementById("invoice-form");
const invoiceEditIdInput = document.getElementById("invoice-edit-id");
const invoiceSubmitBtn = document.getElementById("invoice-submit-btn");
const invoiceCancelBtn = document.getElementById("invoice-cancel-btn");
const reportAutofillStatus = document.getElementById("report-autofill-status");

const inviteForm = document.getElementById("invite-form");
const inviteStatus = document.getElementById("invite-status");

const refreshAllBtn = document.getElementById("refresh-all-btn");
const logoutBtn = document.getElementById("admin-logout-btn");
const openPortalPreviewBtn = document.getElementById("open-portal-preview-btn");

const previewReports = document.getElementById("preview-reports");
const previewNegativeItems = document.getElementById("preview-negative-items");
const previewLetters = document.getElementById("preview-letters");
const previewUpdates = document.getElementById("preview-updates");
const previewActivity = document.getElementById("preview-activity");
const previewFiles = document.getElementById("preview-files");
const adminMessageThread = document.getElementById("admin-message-thread");
const adminMessageForm = document.getElementById("admin-message-form");
const adminMessageInput = document.getElementById("admin-message-input");
const previewClientUploads = document.getElementById("preview-client-uploads");
const billingPlanSummary = document.getElementById("billing-plan-summary");
const billingInvoiceList = document.getElementById("billing-invoice-list");
const fileCategorySelect = document.getElementById("file-category");
const creditReportFields = document.getElementById("credit-report-fields");

const MAX_UPLOAD_SIZE_MB = 500;
const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;
const MAX_BROWSER_SCAN_SIZE_MB = 40;
const MAX_BROWSER_SCAN_SIZE_BYTES = MAX_BROWSER_SCAN_SIZE_MB * 1024 * 1024;
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const ALLOWED_UPLOAD_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".doc", ".docx"];
const ACTIVITY_PREFIX = "[Activity] ";
const ALL_CREDIT_BUREAUS = ["Experian", "Equifax", "TransUnion"];

const missingConfig = ["supabaseUrl", "supabaseAnonKey"].filter((k) => !config[k]);
let supabase = null;
let currentAdmin = null;
let activeClientId = null;
let activeClientFiles = [];
let activeReportRows = [];
let activeNegativeItemRows = [];
let activeLetterRows = [];
let activeUpdateRows = [];
let activeBillingProfile = null;
let activeInvoiceRows = [];

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

function setReportAutofillStatus(message, isError = false) {
  if (!reportAutofillStatus) return;
  reportAutofillStatus.textContent = message;
  reportAutofillStatus.classList.toggle("error", isError);
}

function isCreditReportCategory(value = fileCategorySelect?.value) {
  return String(value || "").trim() === "Credit Report";
}

function isDisputeSummaryCategory(value = fileCategorySelect?.value) {
  return String(value || "").trim() === "Dispute Summary";
}

function syncUploadCategoryUi() {
  const showReportFields = isCreditReportCategory();
  creditReportFields?.classList.toggle("hidden", !showReportFields);
  const reportBureauInput = document.getElementById("report-bureau");
  const reportFileInput = document.getElementById("file-input");
  if (reportBureauInput) reportBureauInput.required = showReportFields;
  if (!showReportFields) {
    setReportAutofillStatus("");
    if (reportFileInput && reportFileInput.files?.length) {
      const notesInput = document.getElementById("file-notes");
      if (notesInput && !String(notesInput.value || "").trim()) {
        notesInput.placeholder = "Optional description";
      }
    }
  }
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

function fileHasAllowedUploadType(file) {
  const fileType = String(file?.type || "").toLowerCase();
  const fileName = String(file?.name || "").toLowerCase();
  return (
    ALLOWED_UPLOAD_MIME_TYPES.has(fileType) ||
    ALLOWED_UPLOAD_EXTENSIONS.some((extension) => fileName.endsWith(extension))
  );
}

function isPdfFile(file) {
  const fileType = String(file?.type || "").toLowerCase();
  const fileName = String(file?.name || "").toLowerCase();
  return fileType === "application/pdf" || fileName.endsWith(".pdf");
}

function isDocxFile(file) {
  const fileType = String(file?.type || "").toLowerCase();
  const fileName = String(file?.name || "").toLowerCase();
  return (
    fileType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fileName.endsWith(".docx")
  );
}

function isImageFile(file) {
  const fileType = String(file?.type || "").toLowerCase();
  const fileName = String(file?.name || "").toLowerCase();
  return /image\/(png|jpeg|jpg|webp)/.test(fileType) || /\.(png|jpe?g|webp)$/i.test(fileName);
}

function canBrowserImportDisputeSummary(file) {
  return isPdfFile(file) || isDocxFile(file) || isImageFile(file);
}

function getUploadContentType(file) {
  const fileType = String(file?.type || "").toLowerCase();
  if (fileType) return fileType;

  const fileName = String(file?.name || "").toLowerCase();
  if (fileName.endsWith(".pdf")) return "application/pdf";
  if (fileName.endsWith(".png")) return "image/png";
  if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) return "image/jpeg";
  if (fileName.endsWith(".webp")) return "image/webp";
  if (fileName.endsWith(".doc")) return "application/msword";
  if (fileName.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return "application/octet-stream";
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
    ? `<a class="btn secondary sm" href="${safeText(
        fileRow.signed_url
      )}" target="_blank" rel="noopener noreferrer" data-action="view-file" data-file-id="${safeText(
        fileRow.id
      )}">View</a>`
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
  if (bureauInput) bureauInput.value = row.bureau || "Shared / Unknown";
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
    case "reviewed":
      return "Reviewed";
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
    /\b(resolved|removed|deleted|cleared)\b/.test(combined)
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

function setPreviewCount(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = String(value || 0);
}

function isActivityUpdateRow(row = {}) {
  return String(row.details || "").startsWith(ACTIVITY_PREFIX);
}

function formatActivityDetails(details) {
  const value = String(details || "");
  return value.startsWith(ACTIVITY_PREFIX) ? value.slice(ACTIVITY_PREFIX.length).trim() : value;
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
  if (!isCreditReportCategory()) {
    setReportAutofillStatus("");
    return;
  }

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
      "This PDF is too large for browser autofill. Upload it and complete the report details manually.",
      true
    );
    return;
  }

  try {
    const titleInput = document.getElementById("file-title");
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
        "The PDF loaded, but browser autofill could not confidently detect report details. You can still upload it and complete the report details manually.",
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

  if (error) {
    return {
      allowed: false,
      error: error.message || "Could not verify admin access.",
    };
  }
  return {
    allowed: Boolean(data?.user_id),
    error: null,
  };
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
    activeNegativeItemRows = [];
    activeLetterRows = [];
    activeUpdateRows = [];
    activeBillingProfile = null;
    activeInvoiceRows = [];
    activeClientIdEl.textContent = "";
    resetNegativeItemForm();
    resetLetterForm();
    resetTimelineForm();
    resetInvoiceForm();
    renderPreview([], [], [], [], [], []);
    renderBillingManager(null, []);
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

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function formatBillingInterval(value) {
  switch (String(value || "").toLowerCase()) {
    case "biweekly":
      return "Biweekly";
    case "weekly":
      return "Weekly";
    case "one_time":
      return "One time";
    case "custom":
      return "Custom";
    default:
      return "Monthly";
  }
}

function formatBillingStatus(value) {
  switch (String(value || "").toLowerCase()) {
    case "trial":
      return "Trial";
    case "past_due":
      return "Past due";
    case "paused":
      return "Paused";
    case "canceled":
      return "Canceled";
    case "completed":
      return "Completed";
    default:
      return "Active";
  }
}

function formatInvoiceStatus(value) {
  switch (String(value || "").toLowerCase()) {
    case "sent":
      return "Sent";
    case "paid":
      return "Paid";
    case "overdue":
      return "Overdue";
    case "void":
      return "Void";
    default:
      return "Draft";
  }
}

function billingStatusClass(value) {
  switch (String(value || "").toLowerCase()) {
    case "trial":
      return "status-chip trial";
    case "past_due":
      return "status-chip overdue";
    case "paused":
      return "status-chip paused";
    case "canceled":
      return "status-chip void";
    case "completed":
      return "status-chip paid";
    default:
      return "status-chip active";
  }
}

function invoiceStatusClass(value) {
  switch (String(value || "").toLowerCase()) {
    case "sent":
      return "status-chip sent";
    case "paid":
      return "status-chip paid";
    case "overdue":
      return "status-chip overdue";
    case "void":
      return "status-chip void";
    default:
      return "status-chip draft";
  }
}

function buildInvoiceNumber(userId = "") {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
  const clientSuffix = String(userId || "").replace(/-/g, "").slice(0, 4).toUpperCase() || "CLNT";
  const random = Math.floor(Math.random() * 9000 + 1000);
  return `INV-${stamp}-${clientSuffix}-${random}`;
}

function setFieldValue(id, value) {
  const input = document.getElementById(id);
  if (!input) return;
  input.value = value == null ? "" : String(value);
}

function populateBillingPlanForm(profile) {
  setFieldValue("billing-plan-name", profile?.plan_name || "");
  setFieldValue("billing-plan-amount", profile?.plan_amount ?? "");
  setFieldValue("billing-plan-interval", profile?.billing_interval || "monthly");
  setFieldValue("billing-plan-status", profile?.billing_status || "active");
  setFieldValue("billing-started-at", profile?.started_at || "");
  setFieldValue("billing-renewal-date", profile?.renewal_date || "");
  setFieldValue("billing-zelle-name", profile?.zelle_display_name || "");
  setFieldValue("billing-zelle-handle", profile?.zelle_handle || "");
  setFieldValue("billing-zelle-note", profile?.zelle_note || "");
  setFieldValue("billing-payment-terms", profile?.payment_terms || "");
  setFieldValue("billing-plan-notes", profile?.notes || "");
}

function resetInvoiceForm() {
  invoiceForm?.reset();
  if (invoiceEditIdInput) invoiceEditIdInput.value = "";
  setFieldValue("invoice-status", "draft");
  setFieldValue("invoice-date", todayIsoDate());
  setFieldValue("invoice-plan-name", activeBillingProfile?.plan_name || "");
  setFieldValue("invoice-zelle-name", activeBillingProfile?.zelle_display_name || "");
  setFieldValue("invoice-zelle-handle", activeBillingProfile?.zelle_handle || "");
  setFieldValue(
    "invoice-zelle-memo",
    activeBillingProfile?.zelle_note || ""
  );
  const sendNowCheckbox = document.getElementById("invoice-send-now");
  if (sendNowCheckbox) sendNowCheckbox.checked = false;
  toggleFormEditMode(invoiceSubmitBtn, invoiceCancelBtn, false, "Save Invoice", "Save Changes");
}

function populateInvoiceForm(row) {
  if (!row) return;
  if (invoiceEditIdInput) invoiceEditIdInput.value = String(row.id || "");
  setFieldValue("invoice-number", row.invoice_number || "");
  setFieldValue("invoice-title", row.title || "");
  setFieldValue("invoice-plan-name", row.plan_name || activeBillingProfile?.plan_name || "");
  setFieldValue("invoice-amount", row.amount ?? "");
  setFieldValue("invoice-date", row.invoice_date || todayIsoDate());
  setFieldValue("invoice-due-date", row.due_date || "");
  setFieldValue("invoice-status", row.status || "draft");
  setFieldValue("invoice-zelle-name", row.zelle_display_name || activeBillingProfile?.zelle_display_name || "");
  setFieldValue("invoice-zelle-handle", row.zelle_handle || activeBillingProfile?.zelle_handle || "");
  setFieldValue("invoice-zelle-memo", row.zelle_memo || activeBillingProfile?.zelle_note || "");
  setFieldValue("invoice-notes", row.notes || "");
  const sendNowCheckbox = document.getElementById("invoice-send-now");
  if (sendNowCheckbox) sendNowCheckbox.checked = false;
  toggleFormEditMode(invoiceSubmitBtn, invoiceCancelBtn, true, "Save Invoice", "Save Changes");
  invoiceForm?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderBillingManager(profile, invoices) {
  activeBillingProfile = profile || null;
  activeInvoiceRows = invoices || [];
  populateBillingPlanForm(activeBillingProfile);

  if (billingPlanSummary) {
    if (!profile?.plan_name) {
      billingPlanSummary.innerHTML = '<p class="empty">No billing plan saved for this client yet.</p>';
    } else {
      const amountLabel =
        profile.plan_amount != null && profile.plan_amount !== ""
          ? formatCurrency(profile.plan_amount)
          : "Custom";
      const renewal = profile.renewal_date ? formatDate(profile.renewal_date) : "Not set";
      const started = profile.started_at ? formatDate(profile.started_at) : "Not set";
      const zelleLine = profile.zelle_handle
        ? `<p class="billing-summary-meta">Zelle to ${safeText(
            profile.zelle_display_name || "Billing"
          )} · ${safeText(profile.zelle_handle)}</p>`
        : "";
      const notes = profile.notes ? `<p class="billing-summary-note">${safeText(profile.notes)}</p>` : "";
      billingPlanSummary.innerHTML = `
        <div class="billing-summary-top">
          <div>
            <p class="billing-summary-name">${safeText(profile.plan_name)}</p>
            <p class="billing-summary-meta">${safeText(amountLabel)} · ${safeText(
              formatBillingInterval(profile.billing_interval)
            )}</p>
            ${zelleLine}
          </div>
          <span class="${safeText(billingStatusClass(profile.billing_status))}">${safeText(
            formatBillingStatus(profile.billing_status)
          )}</span>
        </div>
        <div class="billing-summary-grid">
          <div>
            <span>Started</span>
            <strong>${safeText(started)}</strong>
          </div>
          <div>
            <span>Next billing</span>
            <strong>${safeText(renewal)}</strong>
          </div>
          <div>
            <span>Terms</span>
            <strong>${safeText(profile.payment_terms || "Not set")}</strong>
          </div>
        </div>
        ${profile.zelle_note ? `<p class="billing-summary-note"><strong>Zelle note:</strong> ${safeText(profile.zelle_note)}</p>` : ""}
        ${notes}
      `;
    }
  }

  if (billingInvoiceList) {
    if (!activeInvoiceRows.length) {
      billingInvoiceList.innerHTML = '<p class="empty">No invoices saved yet.</p>';
    } else {
      billingInvoiceList.innerHTML = activeInvoiceRows
        .map((row) => {
          const zelleMeta = row.zelle_handle
            ? `<p class="billing-invoice-note"><strong>Zelle:</strong> ${safeText(
                row.zelle_display_name || "Billing"
              )} · ${safeText(row.zelle_handle)}${
                row.zelle_memo ? ` · Memo ${safeText(row.zelle_memo)}` : ""
              }</p>`
            : "";
          return `
            <article class="billing-invoice-row">
              <div class="billing-invoice-top">
                <div>
                  <p class="billing-invoice-title">${safeText(row.title || "Invoice")}</p>
                  <p class="billing-invoice-meta">${safeText(
                    row.invoice_number || "No invoice number"
                  )} · ${safeText(formatDate(row.invoice_date || row.created_at))} · Due ${safeText(
                    row.due_date ? formatDate(row.due_date) : "Not set"
                  )}</p>
                </div>
                <div class="billing-invoice-side">
                  <span class="${safeText(invoiceStatusClass(row.status))}">${safeText(
                    formatInvoiceStatus(row.status)
                  )}</span>
                  <strong>${safeText(formatCurrency(row.amount))}</strong>
                </div>
              </div>
              <p class="billing-invoice-submeta">${safeText(
                row.plan_name || activeBillingProfile?.plan_name || "No plan name"
              )}</p>
              ${zelleMeta}
              ${row.notes ? `<p class="billing-invoice-note">${safeText(row.notes)}</p>` : ""}
              <div class="file-actions-row">
                <button class="btn secondary sm" type="button" data-action="edit-invoice" data-row-id="${safeText(
                  row.id
                )}">Edit</button>
                <button class="btn secondary sm" type="button" data-action="send-invoice" data-row-id="${safeText(
                  row.id
                )}">Send</button>
                <button class="btn secondary sm" type="button" data-action="mark-invoice-paid" data-row-id="${safeText(
                  row.id
                )}">Paid</button>
                <button class="btn danger sm" type="button" data-action="delete-invoice" data-row-id="${safeText(
                  row.id
                )}">Delete</button>
              </div>
            </article>
          `;
        })
        .join("");
    }
  }

  if (!invoiceEditIdInput?.value) {
    resetInvoiceForm();
  }
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

function renderPreview(reports, negativeItems, letters, updates, files) {
  if (previewReports) previewReports.innerHTML = "";
  if (previewNegativeItems) previewNegativeItems.innerHTML = "";
  previewLetters.innerHTML = "";
  previewUpdates.innerHTML = "";
  if (previewActivity) previewActivity.innerHTML = "";
  previewFiles.innerHTML = "";

  const activityRows = (updates || []).filter((row) => isActivityUpdateRow(row));
  const manualUpdates = (updates || []).filter((row) => !isActivityUpdateRow(row));

  setPreviewCount("preview-count-reports", reports?.length || 0);
  setPreviewCount("preview-count-negative", negativeItems?.length || 0);
  setPreviewCount("preview-count-letters", letters?.length || 0);
  setPreviewCount("preview-count-updates", manualUpdates.length);
  setPreviewCount("preview-count-activity", activityRows.length);
  setPreviewCount("preview-count-files", files?.length || 0);

  if (previewReports) {
    if (!reports.length) {
      previewReports.innerHTML = '<li class="preview-empty">No current credit reports yet.</li>';
    } else {
      for (const row of reports) {
        const li = document.createElement("li");
        li.className = "file-record";
        const bureau = row.bureau || "Other";
        const date = formatDate(row.report_date || row.created_at);
        const score = row.score ? `Score ${safeText(row.score)}` : "No score";
        const review = `${safeText(formatVerificationStatus(row.verification_status))} · ${safeText(
          formatVerificationMethod(row.verification_method)
        )}`;
        const fileLink = row.signed_url
          ? `<a class="btn secondary sm preview-item-link" href="${safeText(
              row.signed_url
            )}" target="_blank" rel="noopener noreferrer" data-action="open-report" data-row-id="${safeText(
              row.id
            )}">Open</a>`
          : "";
        li.innerHTML = `
          <div class="preview-item-head">
            <div class="preview-item-main">
              <p class="file-record-title">${safeText(bureau)}</p>
              <p class="file-record-meta">${safeText(date)} · ${safeText(score)} · ${review}</p>
            </div>
            ${fileLink}
          </div>
        `;
        previewReports.appendChild(li);
      }
    }
  }

  if (previewNegativeItems) {
    if (!negativeItems.length) {
      previewNegativeItems.innerHTML = '<li class="preview-empty">No negative items yet.</li>';
    } else {
      for (const row of negativeItems) {
        const li = document.createElement("li");
        li.className = "file-record negative-admin-row";
        const stage = getNegativeItemStage(row);
        const bureau = row.bureau || "All Bureaus";
        const balance = row.balance != null ? formatCurrency(row.balance) : "N/A";
        const review = formatVerificationMethod(row.verification_method);
        const accountRef = row.account_reference ? ` • Acct ${safeText(row.account_reference)}` : "";
        const note = row.notes || "";
        li.innerHTML = `
          <div class="negative-admin-head">
            <div class="preview-item-main">
              <p class="file-record-title">${safeText(row.creditor)} — ${safeText(
                row.item_type
              )}</p>
              <p class="file-record-meta">${safeText(bureau)}${accountRef}</p>
            </div>
            <span class="negative-admin-pill ${safeText(stage.className)}">${safeText(
              stage.label
            )}</span>
          </div>
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

  if (!letters.length) {
    previewLetters.innerHTML = '<li class="preview-empty">No letter records yet.</li>';
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

  if (!manualUpdates.length) {
    previewUpdates.innerHTML = '<li class="preview-empty">No updates yet.</li>';
  } else {
    for (const row of manualUpdates) {
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

  if (previewActivity) {
    if (!activityRows.length) {
      previewActivity.innerHTML = '<li class="preview-empty">No record activity yet.</li>';
    } else {
      for (const row of activityRows) {
        const li = document.createElement("li");
        li.className = "file-record";
        li.innerHTML = `
          <p class="file-record-title">${safeText(formatDateTime(row.created_at))}</p>
          <p class="file-record-meta">${safeText(formatActivityDetails(row.details))}</p>
        `;
        previewActivity.appendChild(li);
      }
    }
  }

  if (!files.length) {
    previewFiles.innerHTML = '<li class="preview-empty">No files yet.</li>';
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

function isPdfFileRow(fileRow) {
  const contentType = String(fileRow?.content_type || "").toLowerCase();
  const fileName = String(fileRow?.file_name || "").toLowerCase();
  return contentType === "application/pdf" || /\.pdf$/.test(fileName);
}

function isLikelyCreditReportCandidate(fileRow) {
  if (!isPdfFileRow(fileRow)) return false;
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

async function logClientActivity(message) {
  if (!activeClientId || !message) return;

  const { error } = await supabase.from("client_updates").insert({
    user_id: activeClientId,
    details: `${ACTIVITY_PREFIX}${message}`,
  });

  if (error) {
    console.warn("Could not log client activity:", error.message || error);
  }
}

async function importNegativeItemsFromUploadedFile(file, fileRow, category) {
  const importLabel = isDisputeSummaryCategory(category) ? "dispute summary" : "uploaded document";

  const result = await scanCreditDocument(
    file,
    {
      fileId: fileRow?.id || null,
      fileName: file?.name || fileRow?.file_name || "",
      title: fileRow?.title || file?.name || "",
      category,
      contentType: getUploadContentType(file),
    },
    (message) => {
      setAdminStatus(`Importing negative items: ${message}`);
    }
  );

  const negativeItems = Array.isArray(result?.negativeItems) ? result.negativeItems : [];
  for (const item of negativeItems) {
    await upsertNegativeItemRow(
      buildManualNegativeItem({
        ...item,
        source: item.source || "scanned",
        verification_method: item.verification_method || "browser_scan",
        verification_notes:
          item.verification_notes || `Imported from uploaded ${importLabel} document.`,
        source_file_id: fileRow?.id || null,
      })
    );
  }

  return {
    importedCount: negativeItems.length,
  };
}

async function loadClientPreview(userId) {
  if (!userId) return;
  const [
    { data: letters },
    { data: updates },
    files,
    { data: messages },
    reports,
    negativeItems,
    billingProfile,
    invoices,
  ] =
    await Promise.all([
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
          .select("id,bureau,creditor,item_type,account_reference,balance,status,notes,is_active,source,source_file_id,report_id,verification_method,verification_notes,evidence_excerpt,verified_at,ai_model,confidence,last_seen_at,created_at")
          .eq("user_id", userId)
          .order("is_active", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(40)
      ),
      safeTableQuery(
        supabase
          .from("client_billing_profiles")
          .select("user_id,plan_name,plan_amount,billing_interval,billing_status,started_at,renewal_date,payment_terms,zelle_display_name,zelle_handle,zelle_note,notes,created_at,updated_at")
          .eq("user_id", userId)
          .maybeSingle(),
        null
      ),
      safeTableQuery(
        supabase
          .from("client_invoices")
          .select("id,invoice_number,title,plan_name,amount,currency,invoice_date,due_date,status,zelle_display_name,zelle_handle,zelle_memo,notes,sent_at,paid_at,created_at,updated_at")
          .eq("user_id", userId)
          .order("invoice_date", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(40)
      ),
    ]);

  const filesWithUrls = files || [];
  activeClientFiles = filesWithUrls;
  activeReportRows = reports || [];
  activeLetterRows = letters || [];
  activeUpdateRows = updates || [];
  activeNegativeItemRows = negativeItems || [];
  activeBillingProfile = billingProfile || null;
  activeInvoiceRows = invoices || [];
  const reportFileMap = new Map(filesWithUrls.map((row) => [row.id, row.signed_url || ""]));
  const reportsWithUrls = (reports || []).map((row) => ({
    ...row,
    signed_url: reportFileMap.get(row.file_id) || "",
  }));

  renderPreview(
    reportsWithUrls,
    negativeItems || [],
    letters || [],
    updates || [],
    filesWithUrls.filter((f) => f.uploaded_by !== "client")
  );
  renderBillingManager(activeBillingProfile, activeInvoiceRows);
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

    await logClientActivity(`File deleted: ${label}.`);
    await loadClientPreview(activeClientId);
  } catch (error) {
    setAdminStatus("Could not delete file: " + (error?.message || error), true);
  }
}

async function markReportReviewed(row) {
  if (!row || !activeClientId) return false;

  const currentStatus = String(row.verification_status || "").toLowerCase();
  if (!["pending", "needs_review"].includes(currentStatus)) return false;

  const { error } = await supabase
    .from("credit_reports")
    .update({
      verification_status: "reviewed",
      verification_method: row.verification_method || "manual",
      verification_notes: row.verification_notes || null,
      verified_at: row.verified_at || new Date().toISOString(),
    })
    .eq("user_id", activeClientId)
    .eq("id", row.id);

  if (error) {
    setAdminStatus("Could not update report review status: " + error.message, true);
    return false;
  }

  return true;
}

async function markReportsReviewedByFileId(fileId) {
  const numericFileId = Number(fileId || 0);
  if (!numericFileId) return false;

  const matchingRows = activeReportRows.filter((row) => Number(row.file_id) === numericFileId);
  if (!matchingRows.length) return false;

  let changed = false;
  for (const row of matchingRows) {
    const rowChanged = await markReportReviewed(row);
    changed = rowChanged || changed;
  }
  return changed;
}

function findActiveRow(rows, rowId) {
  const numericId = Number(rowId || 0);
  return (rows || []).find((row) => Number(row.id) === numericId) || null;
}

function normalizeNegativeLookupValue(value) {
  return String(value || "").trim().toLowerCase();
}

function findMatchingNegativeItemRow(item, rows = activeNegativeItemRows) {
  return (rows || []).find((row) => {
    return (
      normalizeNegativeLookupValue(row.bureau) === normalizeNegativeLookupValue(item.bureau) &&
      normalizeNegativeLookupValue(row.creditor) === normalizeNegativeLookupValue(item.creditor) &&
      normalizeNegativeLookupValue(row.item_type) === normalizeNegativeLookupValue(item.item_type) &&
      normalizeNegativeLookupValue(row.account_reference) === normalizeNegativeLookupValue(item.account_reference)
    );
  }) || null;
}

function buildNegativeItemPersistencePayload(baseItem, existingRow = null) {
  return {
    user_id: activeClientId,
    ...baseItem,
    bureau: baseItem.bureau || null,
    account_reference: baseItem.account_reference || null,
    balance: baseItem.balance ?? null,
    status: baseItem.status || null,
    notes: baseItem.notes || null,
    source: "manual",
    verification_method: existingRow?.verification_method || "manual",
    verification_notes: existingRow?.verification_notes || (existingRow ? "Updated by admin." : "Added by admin."),
    evidence_excerpt: existingRow?.evidence_excerpt || null,
    source_file_id: existingRow?.source_file_id || null,
    report_id: existingRow?.report_id || null,
    verified_at: existingRow?.verified_at || null,
    ai_model: existingRow?.ai_model || null,
    confidence: existingRow?.confidence ?? null,
    last_seen_at: baseItem.last_seen_at || existingRow?.last_seen_at || null,
  };
}

async function deleteClientRecord({ table, rowId, label, successMessage, activityMessage }) {
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
  if (activityMessage) {
    await logClientActivity(activityMessage);
  }
  await loadClientPreview(activeClientId);
}

async function deleteInvoice(rowId) {
  const row = findActiveRow(activeInvoiceRows, rowId);
  if (!row) {
    setAdminStatus("Invoice not found. Refresh and try again.", true);
    return;
  }

  await deleteClientRecord({
    table: "client_invoices",
    rowId,
    label: `invoice ${row.invoice_number || `#${row.id}`}`,
    successMessage: "Invoice deleted.",
    activityMessage: `Invoice deleted: ${row.invoice_number || row.title || `#${row.id}`}.`,
  });
}

async function updateInvoiceStatus(rowId, nextStatus) {
  const row = findActiveRow(activeInvoiceRows, rowId);
  if (!row || !activeClientId) {
    setAdminStatus("Invoice not found. Refresh and try again.", true);
    return;
  }

  if (["sent", "paid", "overdue"].includes(nextStatus) && !row.zelle_handle && !activeBillingProfile?.zelle_handle) {
    setAdminStatus("Add a Zelle email or phone to this invoice before sending it.", true);
    return;
  }

  const now = new Date().toISOString();
  const payload = {
    status: nextStatus,
    updated_at: now,
    payment_method: "zelle",
    zelle_display_name: row.zelle_display_name || activeBillingProfile?.zelle_display_name || null,
    zelle_handle: row.zelle_handle || activeBillingProfile?.zelle_handle || null,
    zelle_memo: row.zelle_memo || activeBillingProfile?.zelle_note || null,
  };

  if (nextStatus === "sent") {
    payload.sent_at = row.sent_at || now;
    payload.paid_at = null;
  } else if (nextStatus === "paid") {
    payload.status = "paid";
    payload.sent_at = row.sent_at || now;
    payload.paid_at = row.paid_at || now;
  }

  const { error } = await supabase
    .from("client_invoices")
    .update(payload)
    .eq("user_id", activeClientId)
    .eq("id", row.id);

  if (error) {
    if (isMissingFeatureError(error)) {
      setAdminStatus("Run the updated supabase-portal-schema.sql before using billing.", true);
      return;
    }
    setAdminStatus("Could not update invoice: " + error.message, true);
    return;
  }

  const actionLabel = nextStatus === "paid" ? "marked paid" : `marked ${formatInvoiceStatus(nextStatus).toLowerCase()}`;
  await logClientActivity(`Invoice ${actionLabel}: ${row.invoice_number || row.title || `#${row.id}`}.`);
  setAdminStatus(`Invoice ${formatInvoiceStatus(nextStatus).toLowerCase()}.`);
  await loadClientPreview(activeClientId);
}

async function handlePreviewRecordAction(action, rowId) {
  switch (action) {
    case "open-report": {
      const row = findActiveRow(activeReportRows, rowId);
      if (!row) {
        setAdminStatus("Credit report not found. Refresh and try again.", true);
        return;
      }
      const changed = await markReportReviewed(row);
      if (changed) {
        setAdminStatus("Report marked reviewed.");
        await loadClientPreview(activeClientId);
      }
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
        activityMessage: `Negative item deleted: ${row.creditor} — ${row.item_type}.`,
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
        activityMessage: `Letter deleted: ${row.recipient || row.bureau || `#${row.id}`}.`,
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
        activityMessage: "Timeline update deleted.",
      });
      return;
    }
    case "edit-invoice": {
      const row = findActiveRow(activeInvoiceRows, rowId);
      if (!row) {
        setAdminStatus("Invoice not found. Refresh and try again.", true);
        return;
      }
      populateInvoiceForm(row);
      return;
    }
    case "send-invoice": {
      await updateInvoiceStatus(rowId, "sent");
      return;
    }
    case "mark-invoice-paid": {
      await updateInvoiceStatus(rowId, "paid");
      return;
    }
    case "delete-invoice": {
      await deleteInvoice(rowId);
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
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.user) {
        setAuthStatus(error?.message || "Could not sign in.", true);
        return;
      }

      const access = await checkAdmin(data.user.id);
      if (access.error) {
        await supabase.auth.signOut();
        setAuthStatus(`Could not verify admin access: ${access.error}`, true);
        showAuth();
        return;
      }

      if (!access.allowed) {
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
    } catch (error) {
      setAuthStatus("Could not sign in: " + (error?.message || error), true);
    }
  });

  clientSelect?.addEventListener("change", async () => {
    activeClientId = clientSelect.value || null;
    activeClientFiles = [];
    activeReportRows = [];
    activeNegativeItemRows = [];
    activeLetterRows = [];
    activeUpdateRows = [];
    activeBillingProfile = null;
    activeInvoiceRows = [];
    activeClientIdEl.textContent = activeClientId ? `Active user_id: ${activeClientId}` : "";
    resetNegativeItemForm();
    resetLetterForm();
    resetTimelineForm();
    resetInvoiceForm();
    await loadClientPreview(activeClientId);
  });

  const handleFileActionClick = async (event) => {
    const actionEl = event.target.closest("[data-action]");
    if (!actionEl) return;

    const action = String(actionEl.getAttribute("data-action") || "");
    const fileId = actionEl.getAttribute("data-file-id");
    event.preventDefault();
    if (!fileId) return;

    if (action === "view-file") {
      const href = actionEl.getAttribute("href") || "";
      if (href) {
        window.open(href, "_blank", "noopener,noreferrer");
      }
      const changed = await markReportsReviewedByFileId(fileId);
      if (changed) {
        setAdminStatus("Report marked reviewed.");
        await loadClientPreview(activeClientId);
      }
      return;
    }

    if (action === "delete-file") {
      await deleteClientFile(fileId);
    }
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
    if (action === "open-report") {
      const href = actionEl.getAttribute("href") || "";
      if (href) {
        window.open(href, "_blank", "noopener,noreferrer");
      }
    }
    await handlePreviewRecordAction(action, rowId);
  };

  previewReports?.addEventListener("click", handlePreviewRecordClick);
  previewNegativeItems?.addEventListener("click", handlePreviewRecordClick);
  previewLetters?.addEventListener("click", handlePreviewRecordClick);
  previewUpdates?.addEventListener("click", handlePreviewRecordClick);
  billingInvoiceList?.addEventListener("click", handlePreviewRecordClick);

  const uploadFileInput = document.getElementById("file-input");
  uploadFileInput?.addEventListener("change", async () => {
    const file = uploadFileInput.files?.[0];
    await autofillCreditReportForm(file || null);
  });
  fileCategorySelect?.addEventListener("change", async () => {
    syncUploadCategoryUi();
    const file = uploadFileInput?.files?.[0];
    await autofillCreditReportForm(file || null);
  });
  syncUploadCategoryUi();

  negativeCancelBtn?.addEventListener("click", resetNegativeItemForm);
  letterCancelBtn?.addEventListener("click", resetLetterForm);
  timelineCancelBtn?.addEventListener("click", resetTimelineForm);
  invoiceCancelBtn?.addEventListener("click", resetInvoiceForm);

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

  openPortalPreviewBtn?.addEventListener("click", () => {
    if (!activeClientId) {
      setAdminStatus("Select a client first.", true);
      return;
    }
    window.open(`portal.html?preview_user_id=${encodeURIComponent(activeClientId)}`, "_blank", "noopener,noreferrer");
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

  billingPlanForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(await requireActiveClient())) return;

    const planName = String(document.getElementById("billing-plan-name")?.value || "").trim();
    const amountRaw = String(document.getElementById("billing-plan-amount")?.value || "").trim();
    const billingInterval = String(document.getElementById("billing-plan-interval")?.value || "monthly").trim();
    const billingStatusValue = String(document.getElementById("billing-plan-status")?.value || "active").trim();
    const startedAt = String(document.getElementById("billing-started-at")?.value || "").trim();
    const renewalDate = String(document.getElementById("billing-renewal-date")?.value || "").trim();
    const zelleDisplayName = String(document.getElementById("billing-zelle-name")?.value || "").trim();
    const zelleHandle = String(document.getElementById("billing-zelle-handle")?.value || "").trim();
    const zelleNote = String(document.getElementById("billing-zelle-note")?.value || "").trim();
    const paymentTerms = String(document.getElementById("billing-payment-terms")?.value || "").trim();
    const notes = String(document.getElementById("billing-plan-notes")?.value || "").trim();

    if (!planName) {
      setAdminStatus("Plan name is required.", true);
      return;
    }

    const planAmount = amountRaw === "" ? null : Number(amountRaw);
    if (amountRaw !== "" && !Number.isFinite(planAmount)) {
      setAdminStatus("Enter a valid plan amount.", true);
      return;
    }

    const payload = {
      user_id: activeClientId,
      plan_name: planName,
      plan_amount: planAmount,
      billing_interval: billingInterval || "monthly",
      billing_status: billingStatusValue || "active",
      started_at: startedAt || null,
      renewal_date: renewalDate || null,
      payment_method: "zelle",
      zelle_display_name: zelleDisplayName || null,
      zelle_handle: zelleHandle || null,
      zelle_note: zelleNote || null,
      payment_terms: paymentTerms || null,
      notes: notes || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("client_billing_profiles")
      .upsert(payload, { onConflict: "user_id" });

    if (error) {
      if (isMissingFeatureError(error)) {
        setAdminStatus("Run the updated supabase-portal-schema.sql before using billing.", true);
        return;
      }
      setAdminStatus("Could not save billing plan: " + error.message, true);
      return;
    }

    await logClientActivity(`Billing plan updated: ${planName}.`);
    setAdminStatus("Billing plan saved.");
    await loadClientPreview(activeClientId);
  });

  invoiceForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(await requireActiveClient())) return;

    const editId = Number(invoiceEditIdInput?.value || 0);
    const existingRow = editId ? findActiveRow(activeInvoiceRows, editId) : null;
    const invoiceNumberInput = String(document.getElementById("invoice-number")?.value || "").trim();
    const title = String(document.getElementById("invoice-title")?.value || "").trim();
    const planNameInput = String(document.getElementById("invoice-plan-name")?.value || "").trim();
    const amountRaw = String(document.getElementById("invoice-amount")?.value || "").trim();
    const invoiceDate = String(document.getElementById("invoice-date")?.value || todayIsoDate()).trim();
    const dueDate = String(document.getElementById("invoice-due-date")?.value || "").trim();
    const zelleDisplayName = String(document.getElementById("invoice-zelle-name")?.value || "").trim();
    const zelleHandle = String(document.getElementById("invoice-zelle-handle")?.value || "").trim();
    const zelleMemo = String(document.getElementById("invoice-zelle-memo")?.value || "").trim();
    const notes = String(document.getElementById("invoice-notes")?.value || "").trim();
    const sendNow = Boolean(document.getElementById("invoice-send-now")?.checked);
    let status = String(document.getElementById("invoice-status")?.value || "draft").trim().toLowerCase();

    if (!title) {
      setAdminStatus("Invoice title is required.", true);
      return;
    }

    const amount = Number(amountRaw);
    if (!Number.isFinite(amount)) {
      setAdminStatus("Enter a valid invoice amount.", true);
      return;
    }

    if (sendNow && status === "draft") status = "sent";

    if (["sent", "paid", "overdue"].includes(status) && !(zelleHandle || activeBillingProfile?.zelle_handle)) {
      setAdminStatus("Add a Zelle email or phone before sending this invoice.", true);
      return;
    }

    const now = new Date().toISOString();
    const payload = {
      user_id: activeClientId,
      invoice_number: invoiceNumberInput || existingRow?.invoice_number || buildInvoiceNumber(activeClientId),
      title,
      plan_name: planNameInput || activeBillingProfile?.plan_name || null,
      amount,
      currency: "USD",
      invoice_date: invoiceDate || todayIsoDate(),
      due_date: dueDate || null,
      status,
      payment_method: "zelle",
      zelle_display_name: zelleDisplayName || activeBillingProfile?.zelle_display_name || null,
      zelle_handle: zelleHandle || activeBillingProfile?.zelle_handle || null,
      zelle_memo: zelleMemo || activeBillingProfile?.zelle_note || null,
      notes: notes || null,
      sent_at:
        status === "sent" || status === "paid"
          ? existingRow?.sent_at || now
          : null,
      paid_at: status === "paid" ? existingRow?.paid_at || now : null,
      updated_at: now,
    };

    const query = editId
      ? supabase.from("client_invoices").update(payload).eq("user_id", activeClientId).eq("id", editId)
      : supabase.from("client_invoices").insert(payload);

    const { error } = await query;

    if (error) {
      if (isMissingFeatureError(error)) {
        setAdminStatus("Run the updated supabase-portal-schema.sql before using billing.", true);
        return;
      }
      setAdminStatus("Could not save invoice: " + error.message, true);
      return;
    }

    const activityMessage =
      status === "paid"
        ? `Invoice paid: ${payload.invoice_number}.`
        : status === "sent"
          ? `Invoice sent: ${payload.invoice_number}.`
          : editId
            ? `Invoice updated: ${payload.invoice_number}.`
            : `Invoice created: ${payload.invoice_number}.`;

    await logClientActivity(activityMessage);
    resetInvoiceForm();
    setAdminStatus(status === "sent" ? "Invoice sent to the client portal." : "Invoice saved.");
    await loadClientPreview(activeClientId);
  });

  negativeItemForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(await requireActiveClient())) return;

    const editId = Number(negativeEditIdInput?.value || 0);
    const existingRow = editId ? findActiveRow(activeNegativeItemRows, editId) : null;
    const selectedBureau = String(document.getElementById("negative-bureau")?.value || "").trim();
    const creditor = String(document.getElementById("negative-creditor")?.value || "").trim();
    const itemType = String(document.getElementById("negative-type")?.value || "").trim();

    if (!creditor || !itemType) {
      setAdminStatus("Creditor and item type are required.", true);
      return;
    }

    try {
      const sharedItemValues = {
        creditor,
        item_type: itemType,
        account_reference: String(document.getElementById("negative-account-ref")?.value || "").trim(),
        balance: String(document.getElementById("negative-balance")?.value || "").trim(),
        status: String(document.getElementById("negative-status")?.value || "").trim(),
        notes: String(document.getElementById("negative-notes")?.value || "").trim(),
        is_active: Boolean(document.getElementById("negative-active")?.checked),
        source: "manual",
        verification_method: "manual",
      };

      const targetBureaus =
        selectedBureau === "ALL_BUREAUS"
          ? ALL_CREDIT_BUREAUS
          : [selectedBureau || "Shared / Unknown"];

      const targetItems = targetBureaus.map((bureau) =>
        buildManualNegativeItem({
          ...sharedItemValues,
          bureau,
        })
      );

      for (const item of targetItems) {
        const matchingRow =
          findMatchingNegativeItemRow(item) ||
          (existingRow &&
          normalizeNegativeLookupValue(existingRow.bureau) === normalizeNegativeLookupValue(item.bureau)
            ? existingRow
            : null);

        const { error } = await supabase
          .from("negative_items")
          .upsert(buildNegativeItemPersistencePayload(item, matchingRow), {
            onConflict: "user_id,fingerprint",
          });

        if (error) throw error;
      }

      if (editId && existingRow) {
        const existingFingerprint =
          existingRow.fingerprint ||
          buildManualNegativeItem({
            bureau: existingRow.bureau || "",
            creditor: existingRow.creditor || "",
            item_type: existingRow.item_type || "",
            account_reference: existingRow.account_reference || "",
            balance: existingRow.balance,
            status: existingRow.status || "",
            notes: existingRow.notes || "",
            is_active: existingRow.is_active !== false,
            source: existingRow.source || "manual",
            verification_method: existingRow.verification_method || "manual",
          }).fingerprint;
        const nextFingerprints = new Set(targetItems.map((item) => item.fingerprint));

        if (!nextFingerprints.has(existingFingerprint)) {
          const { error } = await supabase
            .from("negative_items")
            .delete()
            .eq("user_id", activeClientId)
            .eq("id", editId);
          if (error) throw error;
        }
      }
    } catch (error) {
      if (isMissingFeatureError(error)) {
        setAdminStatus("Run the updated supabase-portal-schema.sql before using negative items.", true);
        return;
      }
      setAdminStatus("Could not save negative item: " + (error?.message || error), true);
      return;
    }

    const savedToAllBureaus = selectedBureau === "ALL_BUREAUS";
    await logClientActivity(
      editId
        ? savedToAllBureaus
          ? `Negative item updated on all 3 bureaus: ${creditor} — ${itemType}.`
          : `Negative item updated: ${creditor} — ${itemType}.`
        : savedToAllBureaus
          ? `Negative item added on all 3 bureaus: ${creditor} — ${itemType}.`
          : `Negative item added: ${creditor} — ${itemType}.`
    );
    resetNegativeItemForm();
    setAdminStatus(
      savedToAllBureaus
        ? editId
          ? "Negative item updated across Experian, Equifax, and TransUnion."
          : "Negative item saved across Experian, Equifax, and TransUnion."
        : editId
          ? "Negative item updated."
          : "Negative item saved."
    );
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

    await logClientActivity(
      editId
        ? `Letter updated: ${recipient} — ${tracking}.`
        : `Letter added: ${recipient} — ${tracking}.`
    );
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

    await logClientActivity(`Letter status updated: #${letterId} → ${status}.`);
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

    if (editId) {
      await logClientActivity("Timeline update edited.");
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
    const isCreditReportUpload = isCreditReportCategory(category);
    const isDisputeSummaryUpload = isDisputeSummaryCategory(category);
    const bureau = String(document.getElementById("report-bureau")?.value || "").trim();
    const reportDate = String(document.getElementById("report-date")?.value || "").trim();
    const scoreRaw = String(document.getElementById("report-score")?.value || "").trim();
    const reportSummary = String(document.getElementById("report-summary")?.value || "").trim();

    if (!file) {
      setAdminStatus("Choose a file to upload.", true);
      return;
    }

    if (!category) {
      setAdminStatus("Choose a file category.", true);
      return;
    }

    if (!fileHasAllowedUploadType(file)) {
      setAdminStatus("Only PDF, PNG, JPG, WebP, DOC, or DOCX files are allowed.", true);
      return;
    }

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      setAdminStatus(`File must be ${formatMbLimit(MAX_UPLOAD_SIZE_MB)} or smaller.`, true);
      return;
    }

    const bucket = "client-docs";
    const safeName = sanitizeFileName(file.name);
    const objectPath = isCreditReportUpload
      ? `${activeClientId}/reports/${Date.now()}-${safeName}`
      : isDisputeSummaryUpload
        ? `${activeClientId}/summaries/${Date.now()}-${safeName}`
      : `${activeClientId}/${Date.now()}-${safeName}`;
    const fileLabel = titleInput || (isCreditReportUpload ? `${bureau || "Credit"} report` : file.name);
    const fileNotes = isCreditReportUpload ? reportSummary || notes || null : notes || null;

    const { error: uploadError } = await supabase.storage.from(bucket).upload(objectPath, file, {
      upsert: false,
      contentType: getUploadContentType(file),
    });

    if (uploadError) {
      setAdminStatus("Could not upload file: " + uploadError.message, true);
      return;
    }

    const { data: fileRow, error: rowError } = await supabase
      .from("client_files")
      .insert({
        user_id: activeClientId,
        bucket,
        file_path: objectPath,
        file_name: file.name,
        content_type: getUploadContentType(file),
        file_size: file.size,
        category: category || "Other",
        title: fileLabel,
        notes: fileNotes,
        uploaded_by: "admin",
      })
      .select("id,title,notes,category,file_name,file_path,bucket,created_at,uploaded_by,content_type,file_size")
      .single();

    if (rowError) {
      setAdminStatus("File uploaded but metadata save failed: " + rowError.message, true);
      return;
    }

    if (isCreditReportUpload) {
      try {
        await upsertCreditReportRow(
          buildManualCreditReport({
            bureau,
            report_date: reportDate,
            score: scoreRaw,
            report_label: fileLabel,
            summary: reportSummary || notes,
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
        setAdminStatus("File uploaded but report record failed: " + (error?.message || error), true);
        return;
      }
    }

    let importedNegativeItemCount = 0;
    let importSkippedReason = "";
    if (isDisputeSummaryUpload) {
      try {
        if (canBrowserImportDisputeSummary(file) && file.size <= MAX_BROWSER_SCAN_SIZE_BYTES) {
          const result = await importNegativeItemsFromUploadedFile(file, fileRow, category);
          importedNegativeItemCount = result.importedCount || 0;
        } else if (!canBrowserImportDisputeSummary(file)) {
          importSkippedReason = "Uploaded successfully. Auto-import currently works on PDF, DOCX, and image files.";
        } else {
          importSkippedReason = `Uploaded successfully. Auto-import is limited to ${formatMbLimit(
            MAX_BROWSER_SCAN_SIZE_MB
          )} or smaller files.`;
        }
      } catch (error) {
        if (isMissingFeatureError(error)) {
          setAdminStatus("Run the updated supabase-portal-schema.sql before importing negative items.", true);
          return;
        }
        setAdminStatus(
          "File uploaded but negative item import failed: " + (error?.message || error),
          true
        );
        return;
      }
    }

    const uploadActivityMessage = isCreditReportUpload
      ? `Credit report uploaded: ${fileLabel}.`
      : isDisputeSummaryUpload
        ? importedNegativeItemCount
          ? `Dispute summary uploaded: ${fileLabel}. Imported ${importedNegativeItemCount} negative item(s).`
          : `Dispute summary uploaded: ${fileLabel}.`
        : `File uploaded: ${fileLabel}.`;

    await logClientActivity(uploadActivityMessage);
    fileUploadForm.reset();
    syncUploadCategoryUi();
    setReportAutofillStatus("");
    setAdminStatus(
      isCreditReportUpload
        ? "Credit report uploaded."
        : isDisputeSummaryUpload
          ? importedNegativeItemCount
            ? `Dispute summary uploaded. Imported ${importedNegativeItemCount} negative item(s).`
            : importSkippedReason || "Dispute summary uploaded, but no negative items were detected."
        : "File uploaded and attached to client record."
    );
    await loadClientPreview(activeClientId);
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
    const access = await checkAdmin(user.id);
    if (access.error) {
      await supabase.auth.signOut();
      showAuth();
      setAuthStatus(`Could not verify admin access: ${access.error}`, true);
      return;
    }
    if (!access.allowed) {
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
  }).catch((error) => {
    showAuth();
    setAuthStatus("Could not restore admin session: " + (error?.message || error), true);
  });
}

initialize();
