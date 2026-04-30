import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const config = window.__PORTAL_CONFIG__ || {};
const authCard = document.getElementById("auth-card");
const dashboardCard = document.getElementById("dashboard-card");
const setPasswordCard = document.getElementById("set-password-card");
const setPasswordForm = document.getElementById("set-password-form");
const setPasswordStatus = document.getElementById("set-password-status");
const setPasswordTitle = setPasswordCard?.querySelector("h2");
const setPasswordSub = setPasswordCard?.querySelector(".sub");
const setPasswordSubmitBtn = setPasswordForm?.querySelector("button[type=submit]");
const authForm = document.getElementById("auth-form");
const authStatus = document.getElementById("auth-status");
const authTitle = document.getElementById("auth-title");
const authSub = document.getElementById("auth-sub");
const authSubmitBtn = document.getElementById("auth-submit-btn");
const authNotice = document.getElementById("auth-notice");
const authNoticeTitle = document.getElementById("auth-notice-title");
const authNoticeText = document.getElementById("auth-notice-text");
const signupFields = document.getElementById("signup-fields");
const signupConfirmWrap = document.getElementById("signup-confirm-wrap");
const signupFullNameInput = document.getElementById("signup-full-name");
const signupPhoneInput = document.getElementById("signup-phone");
const signupAddressInput = document.getElementById("signup-address");
const signupConfirmPasswordInput = document.getElementById("signup-confirm-password");
const resetBtn = document.getElementById("reset-btn");
const toggleAuthModeBtn = document.getElementById("toggle-auth-mode-btn");
const logoutBtn = document.getElementById("logout-btn");
const refreshBtn = document.getElementById("refresh-btn");
const portalThemeToggleBtn = document.getElementById("portal-theme-toggle");
const clientNameEl = document.getElementById("client-name");
const clientEmailEl = document.getElementById("client-email");
const clientContactEmailEl = document.getElementById("client-contact-email");
const clientContactPhoneEl = document.getElementById("client-contact-phone");
const clientContactAddressEl = document.getElementById("client-contact-address");
const previewBannerEl = document.getElementById("portal-preview-banner");
const previewMetaEl = document.getElementById("portal-preview-meta");
const portalTabButtons = Array.from(document.querySelectorAll("[data-portal-tab-button]"));
const portalTabPanels = Array.from(document.querySelectorAll("[data-portal-panel]"));
const scoreSnapshotSectionEl = document.getElementById("score-snapshot-section");
const scoreGridEl = document.getElementById("score-grid");
const reportGridEl = document.getElementById("report-grid");
const billingPlanCardEl = document.getElementById("billing-plan-card");
const billingInvoicesListEl = document.getElementById("billing-invoices-list");
const negativeTrackerStatsEl = document.getElementById("negative-tracker-stats");
const negativeTrackerGridEl = document.getElementById("negative-tracker-grid");
const deletedProgressSummaryEl = document.getElementById("deleted-progress-summary");
const deletedProgressListEl = document.getElementById("deleted-progress-list");
const lettersBodyEl = document.getElementById("letters-body");
const updatesListEl = document.getElementById("updates-list");
const activityListEl = document.getElementById("activity-list");
const filesListEl = document.getElementById("files-list");
const messageThreadEl = document.getElementById("message-thread");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const messageStatus = document.getElementById("message-status");
const clientUploadForm = document.getElementById("client-upload-form");
const clientFileCategoryInput = document.getElementById("client-file-category");
const uploadStatus = document.getElementById("upload-status");
const requiredDocsListEl = document.getElementById("required-docs-list");
const authLandingState = getAuthLandingState();
let authEmailCooldownUntil = 0;

const MAX_UPLOAD_SIZE_MB = 500;
const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;
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
const PORTAL_TAB_STORAGE_KEY = "portal_active_tab";
const THEME_STORAGE_KEY = "donoso_theme_preference";
const REQUIRED_UPLOAD_DOCS = [
  { key: "id", category: "Government ID" },
  { key: "ssn", category: "Social Security Card" },
  { key: "address", category: "Proof of Address" },
];

const requiredConfig = ["supabaseUrl", "supabaseAnonKey"];
const missingConfig = requiredConfig.filter((k) => !config[k]);

function getStoredThemePreference() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch (_) {}

  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyThemePreference(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.style.colorScheme = nextTheme;

  if (portalThemeToggleBtn) {
    const switchToDark = nextTheme !== "dark";
    portalThemeToggleBtn.textContent = switchToDark ? "Dark mode" : "Light mode";
    portalThemeToggleBtn.setAttribute(
      "aria-label",
      switchToDark ? "Switch to dark mode" : "Switch to light mode"
    );
    portalThemeToggleBtn.setAttribute("aria-pressed", String(nextTheme === "dark"));
  }
}

function initializeThemeToggle() {
  applyThemePreference(getStoredThemePreference());

  portalThemeToggleBtn?.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch (_) {}
    applyThemePreference(nextTheme);
  });
}

initializeThemeToggle();

if (missingConfig.length > 0) {
  setAuthStatus(
    "Portal is not configured yet. Add Supabase values in portal-config.js before using this page.",
    true
  );
  if (authForm) authForm.querySelectorAll("input,button").forEach((el) => { el.disabled = true; });
  if (resetBtn) resetBtn.disabled = true;
} else {
  initializePortal();
}

function setAuthStatus(message, isError = false) {
  if (!authStatus) return;
  authStatus.textContent = message;
  authStatus.classList.toggle("error", isError);
}

function setAuthNotice(title = "", message = "", tone = "info") {
  if (!authNotice || !authNoticeTitle || !authNoticeText) return;

  const hasNotice = Boolean(title || message);
  authNotice.classList.toggle("hidden", !hasNotice);

  if (!hasNotice) {
    authNotice.removeAttribute("data-tone");
    authNoticeTitle.textContent = "";
    authNoticeText.textContent = "";
    return;
  }

  authNotice.dataset.tone = tone;
  authNoticeTitle.textContent = title;
  authNoticeText.textContent = message;
}

function setAuthControlsDisabled(disabled) {
  authForm?.querySelectorAll("input,button").forEach((el) => {
    el.disabled = disabled;
  });
  if (resetBtn) resetBtn.disabled = disabled;
  if (toggleAuthModeBtn) toggleAuthModeBtn.disabled = disabled;
}

function getAuthEmailCooldownMs() {
  return Math.max(0, authEmailCooldownUntil - Date.now());
}

function requireAuthEmailCooldown(actionLabel) {
  const remainingMs = getAuthEmailCooldownMs();
  if (!remainingMs) return true;

  const seconds = Math.ceil(remainingMs / 1000);
  setAuthStatus(
    `Please wait ${seconds} seconds before requesting another ${actionLabel} email.`,
    true,
  );
  return false;
}

function startAuthEmailCooldown(ms = 60 * 1000) {
  authEmailCooldownUntil = Date.now() + ms;
}

function formatAuthError(error, context = "auth") {
  const message = String(error?.message || error || "").trim();
  const normalized = message.toLowerCase();

  if (normalized.includes("rate limit")) {
    return context === "reset"
      ? "Supabase blocked another password email because the project email limit was hit. Wait a minute and try again."
      : "Supabase blocked another confirmation email because the project email limit was hit. Wait a minute and try again. If this keeps happening, use the admin invite flow or configure custom SMTP in Supabase.";
  }

  if (normalized.includes("user already registered")) {
    return "This email already has an account. Sign in or use Forgot password.";
  }

  if (normalized.includes("invalid login credentials") || normalized.includes("invalid credentials")) {
    return "That email or password did not match. If this account was already created, use Forgot password or your setup email instead of creating it again.";
  }

  return message || "Unexpected authentication error.";
}

function isEmailConfirmationError(error) {
  const message = String(error?.message || error || "").trim().toLowerCase();
  return message.includes("email not confirmed") || message.includes("email not verified");
}

function setUploadStatus(message, isError = false) {
  if (!uploadStatus) return;
  uploadStatus.textContent = message;
  uploadStatus.classList.toggle("error", isError);
}

function setActivePortalTab(tabName = "overview") {
  const availableTabs = new Set(portalTabButtons.map((button) => button.dataset.portalTabButton));
  const nextTab = availableTabs.has(tabName) ? tabName : "overview";

  portalTabButtons.forEach((button) => {
    const isActive = button.dataset.portalTabButton === nextTab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  portalTabPanels.forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.portalPanel !== nextTab);
  });

  try {
    localStorage.setItem(PORTAL_TAB_STORAGE_KEY, nextTab);
  } catch (_) {}
}

function setMessageStatus(message, isError = false) {
  if (!messageStatus) return;
  messageStatus.textContent = message;
  messageStatus.classList.toggle("error", isError);
}

function setContactValue(element, value, fallback = "Not added yet") {
  if (!element) return;
  element.textContent = String(value || "").trim() || fallback;
}

function normalizeUploadCategory(value) {
  return String(value || "").trim().toLowerCase();
}

function showDashboard() {
  setAuthNotice("", "");
  if (authCard) authCard.classList.add("hidden");
  if (setPasswordCard) setPasswordCard.classList.add("hidden");
  if (dashboardCard) dashboardCard.classList.remove("hidden");
}

function showAuth() {
  if (dashboardCard) dashboardCard.classList.add("hidden");
  if (setPasswordCard) setPasswordCard.classList.add("hidden");
  if (authCard) authCard.classList.remove("hidden");
}

function showSetPassword() {
  if (authCard) authCard.classList.add("hidden");
  if (dashboardCard) dashboardCard.classList.add("hidden");
  if (setPasswordCard) setPasswordCard.classList.remove("hidden");
}

function getLocationParams() {
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return { searchParams, hashParams };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function getFirstLocationParam(...keys) {
  const { searchParams, hashParams } = getLocationParams();
  for (const key of keys) {
    const hashValue = hashParams.get(key);
    if (hashValue) return hashValue;
    const searchValue = searchParams.get(key);
    if (searchValue) return searchValue;
  }
  return "";
}

function getAuthLandingState() {
  const type = getFirstLocationParam("type").toLowerCase();
  const error = getFirstLocationParam("error_description", "error");
  return {
    type,
    error,
    needsPasswordSetup: type === "invite" || type === "recovery",
    isSignupConfirmation: type === "signup",
  };
}

function configureSetPasswordFlow(flowType) {
  const normalized = String(flowType || "invite").toLowerCase();
  const isRecovery = normalized === "recovery";

  if (setPasswordTitle) {
    setPasswordTitle.textContent = isRecovery ? "Reset Your Password" : "Create Your Password";
  }
  if (setPasswordSub) {
    setPasswordSub.textContent = isRecovery
      ? "Set a new password to regain access to your Donoso Credit Repair account."
      : "Welcome! Set a password below to activate your Donoso Credit Repair account.";
  }
  if (setPasswordSubmitBtn) {
    setPasswordSubmitBtn.textContent = isRecovery ? "Save New Password" : "Activate Account";
  }
}

function clearAuthRedirectState() {
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const keysToRemove = [
    "access_token",
    "refresh_token",
    "expires_at",
    "expires_in",
    "token_type",
    "type",
    "code",
    "error",
    "error_code",
    "error_description",
    "provider_token",
    "provider_refresh_token",
  ];

  let changed = false;
  keysToRemove.forEach((key) => {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
    if (hashParams.has(key)) {
      hashParams.delete(key);
      changed = true;
    }
  });

  if (!changed) return;

  const nextSearch = url.searchParams.toString();
  const nextHash = hashParams.toString();
  const nextUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${nextHash ? `#${nextHash}` : ""}`;
  window.history.replaceState({}, document.title, nextUrl);
}

function normalizeAuthMode(value) {
  return String(value || "").toLowerCase() === "signup" ? "signup" : "signin";
}

function updateAuthModeUrl(mode) {
  const url = new URL(window.location.href);
  if (mode === "signup") {
    url.searchParams.set("mode", "signup");
  } else {
    url.searchParams.delete("mode");
  }
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function getAuthModeCopy(mode) {
  if (mode === "signup") {
    return {
      title: "Create Account",
      sub: "Create your portal account to get started. After signup, you can sign in and track your progress here.",
      submit: "Create Account",
      toggle: "Already have an account? Sign in",
    };
  }

  return {
    title: "Sign In",
    sub: "Use the email and password from your setup email. If you already have portal access, use Forgot password instead of creating a second account.",
    submit: "Sign In",
    toggle: "Create account",
  };
}

function getProfileDraftFromInputs() {
  return {
    fullName: String(signupFullNameInput?.value || "").trim(),
    phone: String(signupPhoneInput?.value || "").trim(),
    address: String(signupAddressInput?.value || "").trim(),
  };
}

function getMissingClientProfileColumn(error) {
  const message = String(error?.message || error || "").toLowerCase();
  if (message.includes("contact_email")) return "contact_email";
  if (message.includes("address")) return "address";
  return null;
}

async function loadClientProfileRecord(supabase, userId) {
  let columns = ["full_name", "phone", "contact_email", "address"];

  while (columns.length >= 2) {
    const result = await supabase
      .from("client_profiles")
      .select(columns.join(","))
      .eq("user_id", userId)
      .maybeSingle();

    if (!result.error) {
      return {
        full_name: result.data?.full_name || null,
        phone: result.data?.phone || null,
        contact_email: result.data?.contact_email || null,
        address: result.data?.address || null,
      };
    }

    if (!isMissingFeatureError(result.error)) throw result.error;

    const missingColumn = getMissingClientProfileColumn(result.error);
    if (!missingColumn || !columns.includes(missingColumn)) break;
    columns = columns.filter((column) => column !== missingColumn);
  }

  const fallback = await supabase
    .from("client_profiles")
    .select("full_name,phone")
    .eq("user_id", userId)
    .maybeSingle();

  if (fallback.error && !isMissingFeatureError(fallback.error)) throw fallback.error;
  return {
    full_name: fallback.data?.full_name || null,
    phone: fallback.data?.phone || null,
    contact_email: null,
    address: null,
  };
}

async function upsertClientProfileRecord(supabase, payload) {
  const attemptPayload = { ...payload };

  while (true) {
    const result = await supabase.from("client_profiles").upsert(attemptPayload, { onConflict: "user_id" });
    if (!result.error) return;
    if (!isMissingFeatureError(result.error)) throw result.error;

    const missingColumn = getMissingClientProfileColumn(result.error);
    if (missingColumn === "contact_email" && Object.prototype.hasOwnProperty.call(attemptPayload, "contact_email")) {
      delete attemptPayload.contact_email;
      continue;
    }

    if (missingColumn === "address" && Object.prototype.hasOwnProperty.call(attemptPayload, "address")) {
      delete attemptPayload.address;
      continue;
    }

    throw result.error;
  }
}

async function ensureOwnClientProfile(supabase, user, draft = {}) {
  if (!user?.id) return;

  const metadata = user.user_metadata || {};
  const fullName = String(draft.fullName || metadata.full_name || metadata.fullName || "").trim();
  const phone = String(draft.phone || metadata.phone || "").trim();
  const address = String(draft.address || metadata.address || "").trim();
  const contactEmail = String(user.email || "").trim();

  if (!fullName && !phone && !address && !contactEmail) return;

  const payload = { user_id: user.id };
  if (fullName) payload.full_name = fullName;
  if (contactEmail) payload.contact_email = contactEmail;
  if (phone) payload.phone = phone;
  if (address) payload.address = address;

  await upsertClientProfileRecord(supabase, payload);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fileHasAllowedUploadType(file) {
  const fileType = String(file?.type || "").toLowerCase();
  const fileName = String(file?.name || "").toLowerCase();
  return (
    ALLOWED_UPLOAD_MIME_TYPES.has(fileType) ||
    ALLOWED_UPLOAD_EXTENSIONS.some((extension) => fileName.endsWith(extension))
  );
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

function parseDisplayDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const raw = String(value || "").trim();
  if (!raw) return null;

  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]) - 1;
    const day = Number(dateOnlyMatch[3]);
    return new Date(year, month, day);
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatDate(value) {
  const date = parseDisplayDate(value);
  if (!date) return "N/A";
  return date.toLocaleDateString();
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString();
}

let jsZipPromise = null;

function isPdfFileRow(fileRow) {
  const contentType = String(fileRow?.content_type || "").toLowerCase();
  const fileName = String(fileRow?.file_name || "").toLowerCase();
  return contentType === "application/pdf" || fileName.endsWith(".pdf");
}

function isDocxFileRow(fileRow) {
  const contentType = String(fileRow?.content_type || "").toLowerCase();
  const fileName = String(fileRow?.file_name || "").toLowerCase();
  return (
    contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fileName.endsWith(".docx")
  );
}

function getLinkedLetterFileName(fileRow = {}) {
  return String(fileRow.title || fileRow.file_name || "letter").trim() || "letter";
}

function getJsPdfCtor() {
  const ctor = window.jspdf?.jsPDF;
  if (!ctor) {
    throw new Error("PDF tools are still loading. Try again in a moment.");
  }
  return ctor;
}

async function getJsZip() {
  if (!jsZipPromise) {
    jsZipPromise = import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm").then(
      (module) => module.default || module
    );
  }
  return jsZipPromise;
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

function invoiceStatusClass(value) {
  switch (String(value || "").toLowerCase()) {
    case "sent":
      return "sent";
    case "paid":
      return "paid";
    case "overdue":
      return "overdue";
    case "void":
      return "void";
    default:
      return "draft";
  }
}

function billingStatusClass(value) {
  switch (String(value || "").toLowerCase()) {
    case "trial":
      return "trial";
    case "past_due":
      return "overdue";
    case "paused":
      return "paused";
    case "canceled":
      return "void";
    case "completed":
      return "paid";
    default:
      return "active";
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

function normalizeNegativeItemText(value) {
  return String(value || "").toLowerCase();
}

function isNegativeItemExplicitlyUpdated(row = {}) {
  return /\b(updated?|corrected)\b/.test(normalizeNegativeItemText(row.status));
}

function isNegativeItemExplicitlyLogged(row = {}) {
  return /\b(logged?|active|re-?opened?)\b/.test(normalizeNegativeItemText(row.status));
}

function isNegativeItemExplicitlyWorking(row = {}) {
  return /\b(disput|investigat|challeng|follow[- ]?up|mailed|sent|respond|pending|review|processing|verif)\w*\b/.test(
    normalizeNegativeItemText(row.status)
  );
}

function isNegativeItemExplicitlyResolved(row = {}) {
  if (isNegativeItemExplicitlyUpdated(row)) {
    return true;
  }

  const combined = [row.status, row.evidence_excerpt, row.verification_notes]
    .map(normalizeNegativeItemText)
    .join(" ");

  return /\b(resolved|removed|deleted|cleared|off report|removed from report|deleted from report)\b/.test(
    combined
  );
}

function verificationBadgeClass(value) {
  switch (String(value || "").toLowerCase()) {
    case "reviewed":
      return "reviewed";
    case "verified":
      return "verified";
    case "rejected":
      return "rejected";
    case "needs_review":
      return "needs-review";
    default:
      return "pending";
  }
}

function isScannerGeneratedReportText(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return (
    normalized.startsWith("detected a likely credit report") ||
    normalized.startsWith("detected by the browser document scanner")
  );
}

function getReportCardReviewNotes(row) {
  const notes = String(row?.verification_notes || "").trim();
  if (!notes || isScannerGeneratedReportText(notes)) {
    return "";
  }
  return notes;
}

async function markClientReportReviewed(supabase, reportId) {
  const numericReportId = Number(reportId || 0);
  if (!numericReportId) return false;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) return false;

  const response = await fetch("/api/report-opened", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ reportId: numericReportId }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "Could not update report status.");
  }

  return Boolean(payload?.updated);
}

function getNegativeItemStage(row = {}) {
  const status = normalizeNegativeItemText(row.status);
  const notes = normalizeNegativeItemText(row.notes);
  const combined = `${status} ${notes}`;

  if (row.is_active === false || isNegativeItemExplicitlyResolved(row)) {
    return { key: "resolved", label: "Resolved", step: 3, badgeClass: "stage-resolved" };
  }

  if (isNegativeItemExplicitlyLogged(row)) {
    return { key: "logged", label: "Logged", step: 1, badgeClass: "stage-logged" };
  }

  if (isNegativeItemExplicitlyWorking(row)) {
    return { key: "working", label: "In progress", step: 2, badgeClass: "stage-working" };
  }

  if (
    /\b(disput|investigat|challeng|follow[- ]?up|mailed|sent|respond|pending|review|processing|verif)\w*\b/.test(
      combined
    )
  ) {
    return { key: "working", label: "In progress", step: 2, badgeClass: "stage-working" };
  }

  return { key: "logged", label: "Logged", step: 1, badgeClass: "stage-logged" };
}

function isDeletedNegativeItem(row = {}) {
  if (row.is_active === false || isNegativeItemExplicitlyResolved(row)) {
    return true;
  }

  if (isNegativeItemExplicitlyLogged(row) || isNegativeItemExplicitlyWorking(row)) {
    return false;
  }

  const status = normalizeNegativeItemText(row.status);
  const notes = normalizeNegativeItemText(row.notes);
  const evidence = [row.evidence_excerpt, row.verification_notes]
    .map(normalizeNegativeItemText)
    .join(" ");
  const combined = `${status} ${notes} ${evidence}`;

  if (isNegativeItemExplicitlyResolved(row)) {
    return true;
  }

  if (
    row.is_active === false &&
    (/\b(deleted?|removed?|off report|removed from report|deleted from report)\b/.test(notes) ||
      !/\b(updated?|verified|paid|settled|closed|logged?|active|re-?opened?|disput|pending|investigat|challeng|review|processing|verif|mailed|sent|respond)\w*\b/.test(
        combined
      ))
  ) {
    return true;
  }

  return false;
}

function getNegativeItemResolvedLabel(row = {}) {
  const status = normalizeNegativeItemText(row.status);
  if (/\bupdated?|corrected\b/.test(status)) return "Updated";
  if (/\bremoved?\b/.test(status)) return "Removed";
  if (/\bdeleted?\b/.test(status)) return "Deleted";
  return "Resolved";
}

function renderNegativeStage(step) {
  return ["Logged", "Working", "Resolved"]
    .map((label, index) => {
      const stateClass = index + 1 <= step ? "complete" : "";
      return `
        <div class="negative-stage-step ${stateClass}">
          <span class="negative-stage-dot"></span>
          <span>${escapeHtml(label)}</span>
        </div>
      `;
    })
    .join("");
}

function formatCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "N/A";
  return amount.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function formatMbLimit(limitMb) {
  return `${limitMb}MB`;
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

async function safeTableQuery(queryPromise, fallback = []) {
  const { data, error } = await queryPromise;
  if (!error) return data || fallback;
  if (isMissingFeatureError(error)) return fallback;
  throw error;
}

async function loadPortalLetters(supabase, userId) {
  const buildQuery = (columns) =>
    supabase
      .from("client_letters")
      .select(columns)
      .eq("user_id", userId)
      .order("sent_date", { ascending: false });

  const variants = [
    {
      columns: "sent_date,bureau,recipient,tracking_number,status,notes,letter_content,letter_type,parent_letter_id,file_id",
      defaults: {},
    },
    {
      columns: "sent_date,bureau,recipient,tracking_number,status,notes,letter_content,letter_type,parent_letter_id",
      defaults: { file_id: null },
    },
    {
      columns: "sent_date,bureau,recipient,tracking_number,status,notes,letter_content,letter_type,file_id",
      defaults: { parent_letter_id: null },
    },
    {
      columns: "sent_date,bureau,recipient,tracking_number,status,notes,letter_content,letter_type",
      defaults: { parent_letter_id: null, file_id: null },
    },
  ];

  for (const variant of variants) {
    const result = await buildQuery(variant.columns);
    if (!result.error) {
      return (result.data || []).map((row) => ({
        ...variant.defaults,
        ...row,
      }));
    }
    if (!isMissingFeatureError(result.error)) throw result.error;
  }

  return [];
}

function sanitizeFileName(name) {
  return String(name || "file")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-");
}

function downloadBlob(blob, fileName) {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

async function fetchBlobFromSignedUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Could not download the linked letter file.");
  }
  return response.blob();
}

async function extractTextFromDocxBlob(blob) {
  const JSZip = await getJsZip();
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const documentXml = await zip.file("word/document.xml")?.async("text");
  if (!documentXml) return "";

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(documentXml, "application/xml");
  const paragraphs = Array.from(xmlDoc.getElementsByTagName("w:p"))
    .map((paragraph) =>
      Array.from(paragraph.getElementsByTagName("w:t"))
        .map((node) => node.textContent || "")
        .join("")
        .trim()
    )
    .filter(Boolean);

  return paragraphs.join("\n\n");
}

function buildLetterPdfFileName(row) {
  const recipient = sanitizeFileName(row.recipient || row.bureau || "letter");
  const sentDate = sanitizeFileName(row.sent_date || formatDate(new Date()));
  return `${recipient}-${sentDate}.pdf`;
}

async function createLetterPdfBlob({ title, text, metadata = [] }) {
  const JsPdf = getJsPdfCtor();
  const doc = new JsPdf({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = 54;
  const right = 54;
  const top = 56;
  const bottom = 54;
  const maxWidth = pageWidth - left - right;
  let y = top;

  const ensureSpace = (requiredHeight = 14) => {
    if (y + requiredHeight <= pageHeight - bottom) return;
    doc.addPage();
    y = top;
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  ensureSpace(20);
  doc.text(title || "Letter", left, y);
  y += 24;

  if (metadata.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    metadata.forEach((line) => {
      ensureSpace(14);
      doc.text(String(line), left, y);
      y += 14;
    });
    y += 8;
  }

  doc.setFont("times", "normal");
  doc.setFontSize(11);
  const paragraphs = String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n/g, " ").trim())
    .filter(Boolean);

  const printableParagraphs = paragraphs.length ? paragraphs : ["Letter text unavailable."];
  printableParagraphs.forEach((paragraph) => {
    const lines = doc.splitTextToSize(paragraph, maxWidth);
    lines.forEach((line) => {
      ensureSpace(16);
      doc.text(line, left, y);
      y += 16;
    });
    y += 10;
  });

  return doc.output("blob");
}

async function downloadLetterAsPdf(row) {
  const linkedFile = row.linked_file || null;
  if (linkedFile?.signed_url && isPdfFileRow(linkedFile)) {
    const blob = await fetchBlobFromSignedUrl(linkedFile.signed_url);
    downloadBlob(blob, buildLetterPdfFileName(row));
    return;
  }

  let text = "";

  if (linkedFile?.signed_url && isDocxFileRow(linkedFile)) {
    const blob = await fetchBlobFromSignedUrl(linkedFile.signed_url);
    text = await extractTextFromDocxBlob(blob);
  }

  if (!text) {
    text = String(row.letter_content || "").trim();
  }

  if (!text) {
    throw new Error(
      "PDF download is available for linked PDF files, linked DOCX files, or letters saved with text content."
    );
  }

  const pdfBlob = await createLetterPdfBlob({
    title: row.recipient || row.bureau || getLinkedLetterFileName(linkedFile),
    text,
    metadata: [
      `Sent: ${formatDate(row.sent_date)}`,
      `Tracking: ${row.tracking_number || "N/A"}`,
      `Status: ${row.status || "In Transit"}`,
    ],
  });

  downloadBlob(pdfBlob, buildLetterPdfFileName(row));
}

function statusBadgeClass(status) {
  const normalized = status.toLowerCase().replaceAll(" ", "-");
  if (normalized.includes("delivered")) return "delivered";
  if (normalized.includes("response")) return "response-received";
  return "in-transit";
}

function renderScores(snapshots) {
  const bureauOrder = ["Experian", "Equifax", "TransUnion"];
  const latestByBureau = new Map();
  snapshots.forEach((row) => {
    if (!latestByBureau.has(row.bureau)) latestByBureau.set(row.bureau, row);
  });

  const cards = bureauOrder.map((bureau) => {
    const item = latestByBureau.get(bureau);
    const score = item ? String(item.score) : "--";
    const stamp = item ? `Updated ${formatDate(item.reported_at)}` : "No data yet";
    return `
      <article class="score-card">
        <p class="bureau">${escapeHtml(bureau)}</p>
        <p class="score">${escapeHtml(score)}</p>
        <p class="stamp">${escapeHtml(stamp)}</p>
      </article>
    `;
  });

  if (scoreGridEl) scoreGridEl.innerHTML = cards.join("");
}

function syncScoreSectionVisibility(snapshots, reports) {
  if (!scoreSnapshotSectionEl) return;
  scoreSnapshotSectionEl.hidden = Array.isArray(reports) && reports.length > 0;
}

function renderTracker(letters, snapshots, reports) {
  const trackerEl = document.getElementById("progress-tracker");
  if (!trackerEl) return;

  let currentStep = 1;
  if ((snapshots && snapshots.length > 0) || (reports && reports.length > 0)) currentStep = 2;
  if (letters && letters.length > 0) currentStep = 3;

  const hasDelivered = letters.some((l) =>
    (l.status || "").toLowerCase().includes("delivered")
  );
  const hasResponse = letters.some((l) =>
    (l.status || "").toLowerCase().includes("response")
  );

  if (hasDelivered) currentStep = 4;
  if (hasResponse) currentStep = 5;

  const steps = trackerEl.querySelectorAll(".tracker-step");
  steps.forEach((step) => {
    const stepNum = Number(step.dataset.step);
    step.classList.remove("complete", "active");
    if (stepNum < currentStep) step.classList.add("complete");
    else if (stepNum === currentStep) step.classList.add("active");
  });
}

function renderLetters(letters) {
  if (!lettersBodyEl) return;
  if (!letters.length) {
    lettersBodyEl.innerHTML = '<tr><td colspan="5" class="empty">No letters posted yet.</td></tr>';
    return;
  }

  lettersBodyEl.innerHTML = letters
    .map((row, index) => {
      const status = row.status || "In Transit";
      const badgeClass = statusBadgeClass(status);
      const typeLabel = String(row.letter_type || "").toLowerCase() === "follow_up" ? "Follow-up letter" : "";
      const linkedFile = row.linked_file || null;
      const viewBtn = row.letter_content
        ? `<button class="btn sm secondary view-letter-btn" type="button" data-content="${escapeHtml(row.letter_content)}" data-label="${escapeHtml(row.recipient || row.bureau || "Letter")}">View Letter</button>`
        : "";
      const openFileBtn = linkedFile?.signed_url
        ? `<a class="btn sm secondary" href="${escapeHtml(
            linkedFile.signed_url
          )}" target="_blank" rel="noopener noreferrer">Open File</a>`
        : "";
      const canDownloadPdf = Boolean(row.letter_content) || isPdfFileRow(linkedFile) || isDocxFileRow(linkedFile);
      const downloadPdfBtn = canDownloadPdf
        ? `<button class="btn sm secondary download-letter-pdf-btn" type="button" data-letter-index="${escapeHtml(
            index
          )}">Download PDF</button>`
        : "";
      const actionMarkup = [openFileBtn, viewBtn, downloadPdfBtn].filter(Boolean).join(" ");
      return `
        <tr>
          <td>${escapeHtml(formatDate(row.sent_date))}</td>
          <td>${escapeHtml(row.recipient || row.bureau || "N/A")}${typeLabel ? `<div class="letter-row-type">${escapeHtml(typeLabel)}</div>` : ""}</td>
          <td>${escapeHtml(row.tracking_number && row.tracking_number !== "PENDING" ? row.tracking_number : "—")}</td>
          <td><span class="badge ${escapeHtml(badgeClass)}">${escapeHtml(status)}</span></td>
          <td>${actionMarkup ? `<div class="letter-actions">${actionMarkup}</div>` : "—"}</td>
        </tr>
      `;
    })
    .join("");

  // Attach view-letter handlers
  lettersBodyEl.querySelectorAll(".view-letter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const content = btn.dataset.content || "";
      const label = btn.dataset.label || "Dispute Letter";
      showLetterModal(label, content);
    });
  });

  lettersBodyEl.querySelectorAll(".download-letter-pdf-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const index = Number(btn.dataset.letterIndex || -1);
      const row = letters[index];
      if (!row) return;
      const originalLabel = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Preparing PDF...";
      try {
        await downloadLetterAsPdf(row);
      } catch (error) {
        window.alert(error?.message || "Could not prepare the PDF for this letter.");
      } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    });
  });
}

function showLetterModal(title, content) {
  // Remove any existing modal
  document.getElementById("letter-modal")?.remove();

  const modal = document.createElement("div");
  modal.id = "letter-modal";
  modal.style.cssText = `
    position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.6);
    display:flex;align-items:center;justify-content:center;padding:1rem;
  `;
  modal.innerHTML = `
    <div style="background:var(--surface,#fff);border-radius:12px;max-width:700px;width:100%;
                max-height:90vh;display:flex;flex-direction:column;overflow:hidden;
                box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="padding:1rem 1.25rem;border-bottom:1px solid var(--line,#e4d9ef);
                  display:flex;justify-content:space-between;align-items:center;">
        <strong style="font-size:1rem;">${escapeHtml(title)}</strong>
        <button id="letter-modal-close" style="background:none;border:none;font-size:1.3rem;
                cursor:pointer;color:var(--muted);">✕</button>
      </div>
      <div style="padding:1.25rem;overflow-y:auto;flex:1;">
        <pre style="font-family:Georgia,serif;font-size:0.875rem;line-height:1.75;
                    white-space:pre-wrap;margin:0;color:var(--ink,#1f1830);">${escapeHtml(content)}</pre>
      </div>
      <div style="padding:1rem 1.25rem;border-top:1px solid var(--line,#e4d9ef);display:flex;gap:0.5rem;">
        <button id="letter-modal-copy" class="btn secondary" style="flex:1;">📋 Copy Letter</button>
        <button id="letter-modal-close2" class="btn primary" style="flex:1;">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector("#letter-modal-close").addEventListener("click", () => modal.remove());
  modal.querySelector("#letter-modal-close2").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelector("#letter-modal-copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(content).catch(() => {});
    const copyBtn = modal.querySelector("#letter-modal-copy");
    copyBtn.textContent = "✅ Copied!";
    setTimeout(() => (copyBtn.textContent = "📋 Copy Letter"), 1800);
  });
}

function renderReports(reports) {
  if (!reportGridEl) return;
  if (!reports.length) {
    reportGridEl.innerHTML = `
      <article class="report-card empty-card">
        <p class="empty">No current credit reports uploaded yet.</p>
      </article>
    `;
    return;
  }

  const preferredOrder = ["Experian", "Equifax", "TransUnion", "Other"];
  const latestByBureau = new Map();
  reports.forEach((row) => {
    const bureau = row.bureau || "Other";
    if (!latestByBureau.has(bureau)) latestByBureau.set(bureau, row);
  });

  const orderedReports = [
    ...preferredOrder.map((bureau) => latestByBureau.get(bureau)).filter(Boolean),
    ...Array.from(latestByBureau.values()).filter((row) => !preferredOrder.includes(row.bureau || "Other")),
  ];

  reportGridEl.innerHTML = orderedReports
    .map((row) => {
      const reportDate = formatDate(row.report_date || row.created_at);
      const reviewLabel = formatVerificationStatus(row.verification_status);
      const reviewMethod = formatVerificationMethod(row.verification_method);
      const reviewNotesText = getReportCardReviewNotes(row);
      const reviewNotes = reviewNotesText
        ? `<p class="report-review-note">${escapeHtml(reviewNotesText)}</p>`
        : "";
      const openLink = row.signed_url
        ? `<a href="${escapeHtml(
            row.signed_url
          )}" target="_blank" rel="noopener noreferrer" data-action="open-report" data-report-id="${escapeHtml(
            row.id
          )}">Open report</a>`
        : "File link unavailable";
      return `
        <article class="report-card">
          <p class="bureau">${escapeHtml(row.bureau || "Other")}</p>
          <p class="report-review"><span class="badge ${escapeHtml(
            verificationBadgeClass(row.verification_status)
          )}">${escapeHtml(reviewLabel)}</span> ${escapeHtml(reviewMethod)}</p>
          <p class="report-score">${escapeHtml(row.score != null ? row.score : "--")}</p>
          <p class="stamp">${escapeHtml(reportDate)}</p>
          ${reviewNotes}
          <p class="report-link">${openLink}</p>
        </article>
      `;
    })
    .join("");
}

function renderBilling(profile, invoices) {
  if (billingPlanCardEl) {
    if (!profile?.plan_name) {
      billingPlanCardEl.innerHTML = '<p class="empty">No billing plan has been posted yet.</p>';
    } else {
      const amountLabel =
        profile.plan_amount != null && profile.plan_amount !== ""
          ? formatCurrency(profile.plan_amount)
          : "Custom";
      const zelleLine = profile.zelle_handle
        ? `<p class="billing-plan-note"><strong>Zelle:</strong> ${escapeHtml(
            profile.zelle_display_name || "Billing"
          )} · ${escapeHtml(profile.zelle_handle)}</p>`
        : "";
      billingPlanCardEl.innerHTML = `
        <div class="billing-plan-head">
          <div>
            <p class="billing-plan-eyebrow">Current Plan</p>
            <h4>${escapeHtml(profile.plan_name)}</h4>
          </div>
          <span class="badge ${escapeHtml(billingStatusClass(profile.billing_status))}">${escapeHtml(
            formatBillingStatus(profile.billing_status)
          )}</span>
        </div>
        <div class="billing-plan-grid">
          <div>
            <span>Amount</span>
            <strong>${escapeHtml(amountLabel)}</strong>
          </div>
          <div>
            <span>Interval</span>
            <strong>${escapeHtml(formatBillingInterval(profile.billing_interval))}</strong>
          </div>
          <div>
            <span>Started</span>
            <strong>${escapeHtml(profile.started_at ? formatDate(profile.started_at) : "Not set")}</strong>
          </div>
          <div>
            <span>Next Billing</span>
            <strong>${escapeHtml(profile.renewal_date ? formatDate(profile.renewal_date) : "Not set")}</strong>
          </div>
        </div>
        <p class="billing-plan-terms"><strong>Terms:</strong> ${escapeHtml(profile.payment_terms || "Not set")}</p>
        ${zelleLine}
        ${profile.zelle_note ? `<p class="billing-plan-note"><strong>Zelle memo:</strong> ${escapeHtml(profile.zelle_note)}</p>` : ""}
        ${profile.notes ? `<p class="billing-plan-note">${escapeHtml(profile.notes)}</p>` : ""}
      `;
    }
  }

  if (!billingInvoicesListEl) return;

  const visibleInvoices = (invoices || []).filter((row) => String(row.status || "").toLowerCase() !== "draft");
  if (!visibleInvoices.length) {
    billingInvoicesListEl.innerHTML = '<p class="empty">No invoices have been sent yet.</p>';
    return;
  }

  billingInvoicesListEl.innerHTML = visibleInvoices
    .map((row) => {
      const zelleHandle = row.zelle_handle || profile?.zelle_handle || "";
      const zelleName = row.zelle_display_name || profile?.zelle_display_name || "Billing";
      const zelleMemo = row.zelle_memo || profile?.zelle_note || row.invoice_number || "";
      const zelleInstructions = zelleHandle
        ? `
          <div class="billing-invoice-zelle">
            <p><strong>Pay by Zelle to:</strong> ${escapeHtml(zelleName)}</p>
            <p><strong>Zelle email/phone:</strong> ${escapeHtml(zelleHandle)}</p>
            ${zelleMemo ? `<p><strong>Memo:</strong> ${escapeHtml(zelleMemo)}</p>` : ""}
          </div>
        `
        : '<p class="billing-invoice-note">Zelle instructions will be posted here once added by the admin team.</p>';
      return `
        <article class="billing-invoice-item">
          <div class="billing-invoice-item-top">
            <div>
              <p class="billing-invoice-number">${escapeHtml(row.invoice_number || "Invoice")}</p>
              <h4>${escapeHtml(row.title || "Service invoice")}</h4>
            </div>
            <div class="billing-invoice-amount">
              <span class="badge ${escapeHtml(invoiceStatusClass(row.status))}">${escapeHtml(
                formatInvoiceStatus(row.status)
              )}</span>
              <strong>${escapeHtml(formatCurrency(row.amount))}</strong>
            </div>
          </div>
          <p class="billing-invoice-meta">${escapeHtml(
            row.plan_name || profile?.plan_name || "Billing"
          )} · Issued ${escapeHtml(formatDate(row.invoice_date || row.created_at))} · Due ${escapeHtml(
            row.due_date ? formatDate(row.due_date) : "Not set"
          )}</p>
          ${zelleInstructions}
          ${row.notes ? `<p class="billing-invoice-note">${escapeHtml(row.notes)}</p>` : ""}
        </article>
      `;
    })
    .join("");
}

function renderNegativeItems(items) {
  if (!negativeTrackerGridEl || !negativeTrackerStatsEl) return;

  const bureauColumns = [
    { key: "experian", label: "Experian" },
    { key: "equifax", label: "Equifax" },
    { key: "transunion", label: "TransUnion" },
    { key: "shared", label: "Shared / Unknown" },
  ];

  const groupedItems = new Map(bureauColumns.map((column) => [column.key, []]));
  const totals = {
    total: 0,
    active: 0,
    resolved: 0,
    balances: {
      experian: 0,
      equifax: 0,
      transunion: 0,
      shared: 0,
    },
  };
  const resolvedItems = (items || []).filter((row) => isDeletedNegativeItem(row));

  items.forEach((row) => {
    const stage = getNegativeItemStage(row);
    const balance = Number(row.balance);
    const bureauValue = String(row.bureau || "").toLowerCase();

    totals.total += 1;
    if (stage.key === "resolved") {
      totals.resolved += 1;
      return;
    }

    totals.active += 1;

    if (bureauValue.includes("experian")) {
      groupedItems.get("experian").push(row);
      if (Number.isFinite(balance)) totals.balances.experian += balance;
    } else if (bureauValue.includes("equifax")) {
      groupedItems.get("equifax").push(row);
      if (Number.isFinite(balance)) totals.balances.equifax += balance;
    } else if (bureauValue.includes("transunion")) {
      groupedItems.get("transunion").push(row);
      if (Number.isFinite(balance)) totals.balances.transunion += balance;
    } else {
      groupedItems.get("shared").push(row);
      if (Number.isFinite(balance)) totals.balances.shared += balance;
    }
  });

  const activeBalanceTotal =
    totals.balances.experian + totals.balances.equifax + totals.balances.transunion + totals.balances.shared;

  negativeTrackerStatsEl.innerHTML = `
    <article class="negative-stat-card">
      <span>Total Items</span>
      <strong>${escapeHtml(totals.total)}</strong>
    </article>
    <article class="negative-stat-card">
      <span>Active Items</span>
      <strong>${escapeHtml(totals.active)}</strong>
    </article>
    <article class="negative-stat-card">
      <span>Resolved</span>
      <strong>${escapeHtml(totals.resolved)}</strong>
    </article>
    <article class="negative-stat-card">
      <span>Active Balance</span>
      <strong>${escapeHtml(formatCurrency(activeBalanceTotal))}</strong>
    </article>
  `;

  if (deletedProgressSummaryEl && deletedProgressListEl) {
    const stillReporting = Math.max(0, totals.total - resolvedItems.length);
    const progressRate = totals.total
      ? `${Math.round((resolvedItems.length / totals.total) * 100)}%`
      : "0%";

    deletedProgressSummaryEl.innerHTML = `
      <article class="negative-stat-card deleted-stat-card">
        <span>Resolved Items</span>
        <strong>${escapeHtml(resolvedItems.length)}</strong>
      </article>
      <article class="negative-stat-card deleted-stat-card">
        <span>Still Reporting</span>
        <strong>${escapeHtml(stillReporting)}</strong>
      </article>
      <article class="negative-stat-card deleted-stat-card">
        <span>Progress Rate</span>
        <strong>${escapeHtml(progressRate)}</strong>
      </article>
    `;

    if (!resolvedItems.length) {
      deletedProgressListEl.innerHTML = `
        <article class="deleted-progress-empty">
          <p class="empty">No resolved items recorded yet.</p>
        </article>
      `;
    } else {
      deletedProgressListEl.innerHTML = resolvedItems
        .map((row) => {
          const bureau = row.bureau || "Shared / Unknown";
          const accountRef = row.account_reference ? ` • Acct ${escapeHtml(row.account_reference)}` : "";
          const status = row.status || "Resolved";
          const note = row.notes || row.evidence_excerpt || "";
          const resolvedLabel = getNegativeItemResolvedLabel(row);
          return `
            <article class="deleted-progress-item">
              <div class="deleted-progress-top">
                <div>
                  <h4>${escapeHtml(row.creditor || "Unknown creditor")}</h4>
                  <p class="deleted-progress-meta">${escapeHtml(bureau)} • ${escapeHtml(
                    row.item_type || "Negative Item"
                  )}${accountRef ? accountRef : ""}</p>
                </div>
                <span class="deleted-progress-pill">${escapeHtml(resolvedLabel)}</span>
              </div>
              <p class="deleted-progress-status">${escapeHtml(status)}</p>
              ${note ? `<p class="deleted-progress-note">${escapeHtml(note)}</p>` : ""}
            </article>
          `;
        })
        .join("");
    }
  }

  const visibleColumns = bureauColumns.filter((column) => (groupedItems.get(column.key) || []).length > 0);

  if (!visibleColumns.length) {
    negativeTrackerGridEl.dataset.activeBureau = "";
    negativeTrackerGridEl.innerHTML =
      `<article class="negative-track-card empty-card"><p class="empty">${
        totals.total ? "No active negative items still reporting." : "No negative items logged yet."
      }</p></article>`;
    return;
  }

  const currentActiveKey = negativeTrackerGridEl.dataset.activeBureau || "";
  const activeKey = visibleColumns.some((column) => column.key === currentActiveKey)
    ? currentActiveKey
    : visibleColumns[0].key;

  negativeTrackerGridEl.dataset.activeBureau = activeKey;
  negativeTrackerGridEl.innerHTML = `
    <div class="negative-bureau-tabs" role="tablist" aria-label="Negative item bureaus">
      ${visibleColumns
        .map((column) => {
          const count = (groupedItems.get(column.key) || []).length;
          return `
            <button
              type="button"
              class="negative-bureau-tab"
              data-bureau-tab="${escapeHtml(column.key)}"
              role="tab"
              aria-selected="${column.key === activeKey ? "true" : "false"}"
            >
              <span>${escapeHtml(column.label)}</span>
              <strong>${escapeHtml(count)}</strong>
            </button>
          `;
        })
        .join("")}
    </div>
    ${visibleColumns
      .map((column) => {
        const bureauItems = groupedItems.get(column.key) || [];
        const itemCountLabel = `${bureauItems.length} item${bureauItems.length === 1 ? "" : "s"}`;
        const bureauBalance = formatCurrency(totals.balances[column.key]);
        const cards = bureauItems
          .map((row) => {
            const stage = getNegativeItemStage(row);
            const status = row.status || (row.is_active === false ? "Resolved / removed" : "Under review");
            const balance = row.balance == null ? "N/A" : formatCurrency(row.balance);
            const reviewLabel = formatVerificationMethod(row.verification_method);
            const accountRef = row.account_reference ? `Acct ${row.account_reference}` : "";
            const note = row.notes || row.evidence_excerpt || "";
            return `
              <article class="negative-track-card">
                <div class="negative-track-top">
                  <div>
                    <h4>${escapeHtml(row.creditor || "Unknown creditor")}</h4>
                    <p class="negative-track-meta">${escapeHtml(row.item_type || "Negative Item")}${
                      accountRef ? ` • ${escapeHtml(accountRef)}` : ""
                    }</p>
                  </div>
                  <span class="negative-stage-badge ${escapeHtml(stage.badgeClass)}">${escapeHtml(
                    stage.label
                  )}</span>
                </div>
                <div class="negative-track-details">
                  <span><strong>Status:</strong> ${escapeHtml(status)}</span>
                  <span><strong>Balance:</strong> ${escapeHtml(balance)}</span>
                  <span><strong>Source:</strong> ${escapeHtml(reviewLabel)}</span>
                </div>
                ${note ? `<p class="negative-track-note">${escapeHtml(note)}</p>` : ""}
              </article>
            `;
          })
          .join("");

        return `
          <section
            class="negative-bureau-panel ${column.key === activeKey ? "" : "hidden"}"
            data-bureau-panel="${escapeHtml(column.key)}"
            role="tabpanel"
          >
            <div class="negative-bureau-head">
              <div>
                <p class="bureau">${escapeHtml(column.label)}</p>
                <p class="negative-bureau-count">${escapeHtml(itemCountLabel)} • Active balance ${escapeHtml(
                  bureauBalance
                )}</p>
                <p class="negative-bureau-note">Bureau balance is separated here so repeated accounts do not look overstated.</p>
              </div>
            </div>
            <div class="negative-bureau-scroll">
              ${cards}
            </div>
          </section>
        `;
      })
      .join("")}
  `;
}

function renderUpdates(updates) {
  if (!updatesListEl) return;
  const manualUpdates = (updates || []).filter((row) => !String(row.details || "").startsWith(ACTIVITY_PREFIX));

  if (!manualUpdates.length) {
    updatesListEl.innerHTML = '<li class="empty">No updates posted yet.</li>';
    return;
  }

  updatesListEl.innerHTML = manualUpdates
    .map(
      (row) => `
        <li>
          <p class="timeline-date">${escapeHtml(formatDate(row.created_at))}</p>
          <p class="timeline-text">${escapeHtml(row.details || "")}</p>
        </li>
      `
    )
    .join("");
}

function renderActivity(updates) {
  if (!activityListEl) return;
  const activityRows = (updates || []).filter((row) => String(row.details || "").startsWith(ACTIVITY_PREFIX));

  if (!activityRows.length) {
    activityListEl.innerHTML = '<li class="empty">No record activity yet.</li>';
    return;
  }

  activityListEl.innerHTML = activityRows
    .map(
      (row) => `
        <li>
          <p class="timeline-date">${escapeHtml(formatDateTime(row.created_at))}</p>
          <p class="timeline-text">${escapeHtml(
            String(row.details || "").replace(ACTIVITY_PREFIX, "").trim()
          )}</p>
        </li>
      `
    )
    .join("");
}

function renderRequiredDocuments(files) {
  if (!requiredDocsListEl) return;

  const uploadedCategories = new Set(
    (files || []).map((row) => normalizeUploadCategory(row.category))
  );

  requiredDocsListEl
    .querySelectorAll("[data-doc-key]")
    .forEach((item) => {
      const key = item.getAttribute("data-doc-key") || "";
      const config = REQUIRED_UPLOAD_DOCS.find((entry) => entry.key === key);
      const statusEl = item.querySelector("[data-doc-status]");
      if (!config || !statusEl) return;

      const isComplete = uploadedCategories.has(normalizeUploadCategory(config.category));
      statusEl.textContent = isComplete ? "Received" : "Needed";
      statusEl.classList.toggle("complete", isComplete);
      statusEl.classList.toggle("pending", !isComplete);
    });
}

function renderFiles(files) {
  if (!filesListEl) return;
  if (!files.length) {
    filesListEl.innerHTML = '<li class="empty">No files uploaded yet.</li>';
    return;
  }

  filesListEl.innerHTML = files
    .map((row) => {
      const category = row.category || "Document";
      const created = formatDate(row.created_at);
      const title = row.title || row.file_name || "Attachment";
      const note = row.notes || "";
      const uploadedBy = row.uploaded_by === "client" ? " • Uploaded by you" : "";
      const link = row.signed_url
        ? `<a href="${escapeHtml(row.signed_url)}" target="_blank" rel="noopener noreferrer">Open file</a>`
        : "File link unavailable";

      return `
        <li>
          <p class="file-meta">${escapeHtml(category)} • ${escapeHtml(created)}${escapeHtml(uploadedBy)}</p>
          <p class="file-title">${escapeHtml(title)} — ${link}</p>
          ${note ? `<p class="file-note">${escapeHtml(note)}</p>` : ""}
        </li>
      `;
    })
    .join("");
}

function renderMessages(messages, currentUserId, options = {}) {
  if (!messageThreadEl) return;
  const isPreviewMode = options.preview === true;
  if (!messages.length) {
    messageThreadEl.innerHTML = '<li class="empty">No messages yet.</li>';
    return;
  }

  messageThreadEl.innerHTML = messages
    .map((row) => {
      const isClient = row.sender_role === "client";
      const sideClass = isClient ? "msg-client" : "msg-admin";
      const label = isClient ? (isPreviewMode ? "Client" : "You") : "Donoso Credit Repair";
      return `
        <li class="msg-bubble ${escapeHtml(sideClass)}">
          <p class="msg-label">${escapeHtml(label)} · ${escapeHtml(formatDateTime(row.created_at))}</p>
          <p class="msg-content">${escapeHtml(row.content)}</p>
        </li>
      `;
    })
    .join("");

  messageThreadEl.scrollTop = messageThreadEl.scrollHeight;
}

async function checkAdminAccess(supabase, userId) {
  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  return {
    allowed: Boolean(data?.user_id) && !error,
    error: error?.message || "",
  };
}

function setPreviewModeUi(enabled, targetUserId = "") {
  previewBannerEl?.classList.toggle("hidden", !enabled);
  if (previewMetaEl) {
    previewMetaEl.textContent = enabled
      ? `Read-only preview for client user_id ${targetUserId}. Uploads and messages are disabled here.`
      : "Read-only preview of the selected client portal.";
  }

  clientUploadForm?.querySelectorAll("input,button").forEach((el) => {
    el.disabled = enabled;
  });
  messageForm?.querySelectorAll("textarea,button").forEach((el) => {
    el.disabled = enabled;
  });

  if (messageInput) {
    messageInput.placeholder = enabled
      ? "Messaging is disabled in admin preview."
      : "Send a message to your advisor...";
  }

  if (logoutBtn) {
    logoutBtn.textContent = enabled ? "Exit Preview" : "Sign Out";
  }
}

function initializePortal() {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  let authMode = normalizeAuthMode(getFirstLocationParam("mode"));
  const requestedPreviewUserId = (() => {
    const value = getFirstLocationParam("preview_user_id");
    return isUuid(value) ? value : "";
  })();
  let currentSessionUser = null;
  let currentPortalUserId = "";
  let isPreviewMode = false;
  let pendingPasswordSetupFlow = authLandingState.needsPasswordSetup ? authLandingState.type : "";

  async function postPortalNotification(payload) {
    const { data, error } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (error || !accessToken) {
      throw new Error(error?.message || "No active portal session.");
    }

    const response = await fetch("/api/portal-notify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || "Could not send portal notification.");
    }

    return result;
  }

  function getCurrentClientNotificationProfile() {
    const metadata = currentSessionUser?.user_metadata || {};
    const fallbackName = String(
      clientNameEl?.textContent || metadata.full_name || metadata.fullName || "Client"
    ).trim();

    return {
      userId: currentPortalUserId || currentSessionUser?.id || "",
      name: fallbackName || "Client",
      email: String(currentSessionUser?.email || "").trim().toLowerCase(),
    };
  }

  async function notifyAdminPortalAlert({
    eventType = "client_message",
    summary = "",
    details = "",
    fileTitle = "",
    category = "",
  } = {}) {
    const client = getCurrentClientNotificationProfile();
    if (!client.userId || !summary) return false;

    try {
      await postPortalNotification({
        eventType,
        clientUserId: client.userId,
        clientName: client.name,
        clientEmail: client.email,
        summary,
        details,
        fileTitle,
        category,
      });
      return true;
    } catch (error) {
      console.warn("Could not send admin portal alert:", error?.message || error);
      return false;
    }
  }

  if (pendingPasswordSetupFlow) {
    configureSetPasswordFlow(pendingPasswordSetupFlow);
  }

  function setAuthMode(nextMode, options = {}) {
    authMode = normalizeAuthMode(nextMode);
    const copy = getAuthModeCopy(authMode);

    if (authTitle) authTitle.textContent = copy.title;
    if (authSub) authSub.textContent = copy.sub;
    if (authSubmitBtn) authSubmitBtn.textContent = copy.submit;
    if (toggleAuthModeBtn) toggleAuthModeBtn.textContent = copy.toggle;

    signupFields?.classList.toggle("hidden", authMode !== "signup");
    signupConfirmWrap?.classList.toggle("hidden", authMode !== "signup");
    resetBtn?.classList.toggle("hidden", authMode === "signup");

    if (authMode === "signup") {
      if (options.keepNotice !== true) {
        setAuthNotice("", "");
      }
      document.getElementById("password")?.setAttribute("autocomplete", "new-password");
      signupConfirmPasswordInput?.setAttribute("required", "required");
      signupFullNameInput?.setAttribute("required", "required");
      signupPhoneInput?.setAttribute("required", "required");
      signupAddressInput?.setAttribute("required", "required");
    } else {
      document.getElementById("password")?.setAttribute("autocomplete", "current-password");
      signupConfirmPasswordInput?.removeAttribute("required");
      signupFullNameInput?.removeAttribute("required");
      signupPhoneInput?.removeAttribute("required");
      signupAddressInput?.removeAttribute("required");
    }

    if (options.syncUrl !== false) {
      updateAuthModeUrl(authMode);
    }
  }

  setAuthMode(authMode, { syncUrl: false });

  const savedTab = (() => {
    try {
      return localStorage.getItem(PORTAL_TAB_STORAGE_KEY) || "overview";
    } catch (_) {
      return "overview";
    }
  })();
  setActivePortalTab(savedTab);

  portalTabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActivePortalTab(button.dataset.portalTabButton || "overview");
    });
  });

  async function loadDashboard(user, options = {}) {
    currentSessionUser = user;
    currentPortalUserId = options.targetUserId || user.id;
    isPreviewMode = options.preview === true;
    setPreviewModeUi(isPreviewMode, currentPortalUserId);

    const [
      profile,
      { data: snapshots },
      reports,
      billingProfile,
      invoices,
      negativeItems,
      letters,
      { data: updates },
      { data: files },
      { data: messages },
    ] = await Promise.all([
      loadClientProfileRecord(supabase, currentPortalUserId),
      supabase.from("credit_snapshots").select("bureau,score,reported_at").eq("user_id", currentPortalUserId).order("reported_at", { ascending: false }),
      safeTableQuery(
        supabase
          .from("credit_reports")
          .select("id,bureau,score,report_date,summary,verification_status,verification_method,verification_notes,file_id,created_at")
          .eq("user_id", currentPortalUserId)
          .order("report_date", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(12)
      ),
      safeTableQuery(
        supabase
          .from("client_billing_profiles")
          .select("plan_name,plan_amount,billing_interval,billing_status,started_at,renewal_date,payment_terms,zelle_display_name,zelle_handle,zelle_note,notes,updated_at")
          .eq("user_id", currentPortalUserId)
          .maybeSingle(),
        null
      ),
      safeTableQuery(
        supabase
          .from("client_invoices")
          .select("invoice_number,title,plan_name,amount,currency,invoice_date,due_date,status,zelle_display_name,zelle_handle,zelle_memo,notes,created_at")
          .eq("user_id", currentPortalUserId)
          .order("invoice_date", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(20)
      ),
      safeTableQuery(
        supabase
          .from("negative_items")
          .select("bureau,creditor,item_type,account_reference,balance,status,notes,is_active,verification_method,evidence_excerpt,created_at")
          .eq("user_id", currentPortalUserId)
          .order("is_active", { ascending: false })
          .order("created_at", { ascending: false })
      ),
      loadPortalLetters(supabase, currentPortalUserId),
      supabase.from("client_updates").select("details,created_at").eq("user_id", currentPortalUserId).order("created_at", { ascending: false }),
      supabase.from("client_files").select("id,title,category,notes,file_name,file_path,bucket,created_at,uploaded_by,content_type,file_size").eq("user_id", currentPortalUserId).order("created_at", { ascending: false }),
      supabase.from("portal_messages").select("sender_role,content,created_at").eq("user_id", currentPortalUserId).order("created_at", { ascending: true }),
    ]);

    const metadata = user.user_metadata || {};
    const displayName =
      profile?.full_name ||
      metadata.full_name ||
      metadata.fullName ||
      (isPreviewMode ? "Client Preview" : "Client");
    const displayEmail = profile?.contact_email || user.email || "";
    const phone = profile?.phone || metadata.phone || "";
    const address = profile?.address || metadata.address || "";

    if (clientNameEl) clientNameEl.textContent = displayName;
    if (clientEmailEl) {
      clientEmailEl.textContent = isPreviewMode
        ? displayEmail
          ? `Admin preview · ${displayEmail}`
          : `Admin preview · ${currentPortalUserId}`
        : displayEmail;
    }
    setContactValue(
      clientContactEmailEl,
      isPreviewMode ? displayEmail : displayEmail,
      isPreviewMode ? "Not available in preview" : "Not added yet"
    );
    setContactValue(clientContactPhoneEl, phone);
    setContactValue(clientContactAddressEl, address);

    const filesWithSignedUrls = await Promise.all(
      (files || []).map(async (row) => {
        const bucket = row.bucket || "client-docs";
        const { data } = await supabase.storage.from(bucket).createSignedUrl(row.file_path, 60 * 60);
        return { ...row, signed_url: data?.signedUrl || "" };
      })
    );

    const fileMap = new Map(filesWithSignedUrls.map((row) => [row.id, row]));
    const reportsWithUrls = (reports || []).map((row) => ({
      ...row,
      signed_url: fileMap.get(row.file_id)?.signed_url || "",
    }));
    const lettersWithFiles = (letters || []).map((row) => ({
      ...row,
      linked_file: row.file_id ? fileMap.get(row.file_id) || null : null,
    }));

    renderScores(snapshots || []);
    renderReports(reportsWithUrls);
    renderBilling(billingProfile || null, invoices || []);
    syncScoreSectionVisibility(snapshots || [], reportsWithUrls);
    renderNegativeItems(negativeItems || []);
    renderTracker(lettersWithFiles, snapshots || [], reportsWithUrls);
    renderLetters(lettersWithFiles);
    renderUpdates(updates || []);
    renderActivity(updates || []);
    renderRequiredDocuments(filesWithSignedUrls);
    renderFiles(filesWithSignedUrls);
    renderMessages(messages || [], currentPortalUserId, { preview: isPreviewMode });
  }

  async function loadSessionOrPreview(user) {
    if (requestedPreviewUserId) {
      const access = await checkAdminAccess(supabase, user.id);
      if (!access.allowed) {
        showAuth();
        setAuthStatus(access.error || "Preview links require an active admin session.", true);
        return false;
      }

      clearAuthRedirectState();
      showDashboard();
      await loadDashboard(user, {
        targetUserId: requestedPreviewUserId,
        preview: true,
      });
      return true;
    }

    clearAuthRedirectState();
    showDashboard();
    try {
      await ensureOwnClientProfile(supabase, user);
    } catch (_) {
      // Dashboard should still load even if profile sync fails.
    }
    await loadDashboard(user, {
      targetUserId: user.id,
      preview: false,
    });
    return true;
  }

  reportGridEl?.addEventListener("click", async (event) => {
    const actionEl = event.target.closest("[data-action='open-report']");
    if (!actionEl || !currentSessionUser) return;

    event.preventDefault();
    const href = actionEl.getAttribute("href") || "";
    const reportId = actionEl.getAttribute("data-report-id") || "";

    if (href) {
      window.open(href, "_blank", "noopener,noreferrer");
    }

    if (isPreviewMode) return;

    try {
      const updated = await markClientReportReviewed(supabase, reportId);
      if (updated) {
        await loadDashboard(currentSessionUser, {
          targetUserId: currentPortalUserId,
          preview: isPreviewMode,
        });
      }
    } catch (_) {
      // Report access should still work even if the status update fails.
    }
  });

  negativeTrackerGridEl?.addEventListener("click", (event) => {
    const tabBtn = event.target.closest("[data-bureau-tab]");
    if (!tabBtn || !negativeTrackerGridEl) return;

    const nextKey = String(tabBtn.getAttribute("data-bureau-tab") || "");
    if (!nextKey) return;

    negativeTrackerGridEl.dataset.activeBureau = nextKey;
    negativeTrackerGridEl
      .querySelectorAll("[data-bureau-tab]")
      .forEach((button) => {
        const isActive = button.getAttribute("data-bureau-tab") === nextKey;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-selected", String(isActive));
      });
    negativeTrackerGridEl
      .querySelectorAll("[data-bureau-panel]")
      .forEach((panel) => {
        panel.classList.toggle("hidden", panel.getAttribute("data-bureau-panel") !== nextKey);
      });
  });

  // Message send
  messageForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentSessionUser || !currentPortalUserId) return;
    if (isPreviewMode) {
      setMessageStatus("Messaging is disabled in admin preview.", true);
      return;
    }
    const content = String(messageInput?.value || "").trim();
    if (!content) return;

    setMessageStatus("Sending...");
    const { error } = await supabase.from("portal_messages").insert({
      user_id: currentPortalUserId,
      sender_role: "client",
      content,
    });

    if (error) {
      setMessageStatus("Could not send message. Try again.", true);
      return;
    }

    if (messageInput) messageInput.value = "";
    await notifyAdminPortalAlert({
      eventType: "client_message",
      summary: "A client sent a new portal message.",
      details: content,
    });
    setMessageStatus("");

    const { data: messages } = await supabase
      .from("portal_messages")
      .select("sender_role,content,created_at")
      .eq("user_id", currentPortalUserId)
      .order("created_at", { ascending: true });

    renderMessages(messages || [], currentPortalUserId, { preview: false });
  });

  // Client file upload
  clientUploadForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentSessionUser || !currentPortalUserId) return;
    if (isPreviewMode) {
      setUploadStatus("Uploads are disabled in admin preview.", true);
      return;
    }

    const fileInput = document.getElementById("client-file-input");
    const file = fileInput?.files?.[0];
    const title = String(document.getElementById("client-file-title")?.value || "").trim();
    const category = String(clientFileCategoryInput?.value || "").trim();

    if (!category) {
      setUploadStatus("Choose the type of document you are uploading.", true);
      return;
    }

    if (!file) { setUploadStatus("Please choose a file.", true); return; }

    if (!fileHasAllowedUploadType(file)) {
      setUploadStatus("Only PDF, PNG, JPG, WebP, DOC, or DOCX files are allowed.", true);
      return;
    }
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      setUploadStatus(`File must be ${formatMbLimit(MAX_UPLOAD_SIZE_MB)} or smaller.`, true);
      return;
    }

    setUploadStatus("Uploading...");
    const bucket = "client-docs";
    const safeName = sanitizeFileName(file.name);
    const categoryFolder = sanitizeFileName(category);
    const objectPath = `${currentPortalUserId}/client-uploads/${categoryFolder}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage.from(bucket).upload(objectPath, file, {
      upsert: false,
      contentType: getUploadContentType(file),
    });

    if (uploadError) {
      setUploadStatus("Upload failed: " + uploadError.message, true);
      return;
    }

    const { error: rowError } = await supabase.from("client_files").insert({
      user_id: currentPortalUserId,
      bucket,
      file_path: objectPath,
      file_name: file.name,
      content_type: getUploadContentType(file),
      file_size: file.size,
      category,
      title: title || category,
      uploaded_by: "client",
    });

    if (rowError) {
      setUploadStatus("File uploaded but could not save record: " + rowError.message, true);
      return;
    }

    clientUploadForm.reset();
    await notifyAdminPortalAlert({
      eventType: "client_upload",
      summary: "A client uploaded a new portal document.",
      details: title || file.name,
      fileTitle: title || file.name,
      category,
    });
    setUploadStatus(`${category} uploaded successfully.`);
    await loadDashboard(currentSessionUser, {
      targetUserId: currentPortalUserId,
      preview: false,
    });
  });

  authForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = String(document.getElementById("email")?.value || "").trim().toLowerCase();
    const password = String(document.getElementById("password")?.value || "");
    const emailInput = document.getElementById("email");
    if (emailInput) emailInput.value = email;
    if (!email || !password) {
      setAuthStatus(
        authMode === "signup"
          ? "Please enter your name, phone, address, email, and password."
          : "Please enter email and password.",
        true
      );
      return;
    }

    if (authMode === "signup") {
      const draft = getProfileDraftFromInputs();
      const confirmPassword = String(signupConfirmPasswordInput?.value || "");

      if (!draft.fullName) {
        setAuthStatus("Please enter your full name.", true);
        return;
      }
      if (!draft.phone) {
        setAuthStatus("Please enter your phone number.", true);
        return;
      }
      if (!draft.address) {
        setAuthStatus("Please enter your address.", true);
        return;
      }
      if (password.length < 8) {
        setAuthStatus("Password must be at least 8 characters.", true);
        return;
      }
      if (password !== confirmPassword) {
        setAuthStatus("Passwords do not match.", true);
        return;
      }
      if (!requireAuthEmailCooldown("signup confirmation")) return;

      setAuthControlsDisabled(true);
      setAuthNotice("", "");
      setAuthStatus("Creating your account...");
      try {
        const signupCheckResponse = await fetch("/api/portal-signup-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const signupCheckPayload = await signupCheckResponse.json().catch(() => ({}));

        if (!signupCheckResponse.ok) {
          if (signupCheckResponse.status === 409 || signupCheckPayload?.exists) {
            setAuthMode("signin", { keepNotice: true });
            if (signupConfirmPasswordInput) signupConfirmPasswordInput.value = "";
            document.getElementById("password").value = "";
            setAuthStatus("");
            setAuthNotice(
              "Account already exists",
              signupCheckPayload?.error ||
                "This email already has portal access. Use Forgot password or your setup email instead of creating a new account.",
            );
            return;
          }

          setAuthStatus(signupCheckPayload?.error || "Could not verify your portal access right now.", true);
          return;
        }

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/portal.html`,
            data: {
              full_name: draft.fullName,
              phone: draft.phone,
              address: draft.address,
            },
          },
        });

        if (error) {
          if (String(error.message || "").toLowerCase().includes("rate limit")) {
            startAuthEmailCooldown();
          }
          setAuthStatus(formatAuthError(error, "signup"), true);
          return;
        }

        if (data.session?.user) {
          try {
            await ensureOwnClientProfile(supabase, data.session.user, draft);
          } catch (_) {}
          setAuthStatus("");
          await loadSessionOrPreview(data.session.user);
          return;
        }

        startAuthEmailCooldown();
        setAuthMode("signin");
        if (signupConfirmPasswordInput) signupConfirmPasswordInput.value = "";
        document.getElementById("password").value = "";
        setAuthStatus("");
        setAuthNotice(
          "Verify your email",
          `We sent a confirmation link to ${email}. Open that email, tap the link, then sign in here.`,
        );
        return;
      } finally {
        setAuthControlsDisabled(false);
      }
    }

    setAuthNotice("", "");
    setAuthStatus("Signing in...");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      if (isEmailConfirmationError(error)) {
        setAuthStatus("");
        setAuthNotice(
          "Verify your email",
          `Please open the confirmation email sent to ${email}, tap the link, then sign in here.`,
        );
        return;
      }

      setAuthStatus(formatAuthError(error, "signin"), true);
      return;
    }

    setAuthNotice("", "");
    setAuthStatus("");
    await loadSessionOrPreview(data.user);
  });

  toggleAuthModeBtn?.addEventListener("click", () => {
    setAuthStatus("");
    setAuthMode(authMode === "signup" ? "signin" : "signup");
  });

  resetBtn?.addEventListener("click", async () => {
    const email = String(document.getElementById("email")?.value || "").trim().toLowerCase();
    const emailInput = document.getElementById("email");
    if (emailInput) emailInput.value = email;
    if (!email) { setAuthStatus("Enter your email first, then click reset.", true); return; }
    if (!requireAuthEmailCooldown("password reset")) return;

    setAuthControlsDisabled(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + "/portal.html",
      });
      if (error) {
        if (String(error.message || "").toLowerCase().includes("rate limit")) {
          startAuthEmailCooldown();
        }
        setAuthStatus(formatAuthError(error, "reset"), true);
        return;
      }
      startAuthEmailCooldown();
      setAuthStatus("Password reset email sent.");
    } finally {
      setAuthControlsDisabled(false);
    }
  });

  logoutBtn?.addEventListener("click", async () => {
    if (isPreviewMode) {
      window.location.href = "admin.html";
      return;
    }
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
    currentSessionUser = null;
    currentPortalUserId = "";
    isPreviewMode = false;
    window.location.href = "portal.html";
  });

  refreshBtn?.addEventListener("click", async () => {
    if (!currentSessionUser) return;
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Refreshing…";
    try {
      await loadDashboard(currentSessionUser, {
        targetUserId: currentPortalUserId || currentSessionUser.id,
        preview: isPreviewMode,
      });
    } catch (_) {
      // silently ignore
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = "Refresh";
    }
  });

  // Set-password form (shown when client clicks their invite / reset link)
  setPasswordForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const newPass = String(document.getElementById("new-password")?.value || "");
    const confirmPass = String(document.getElementById("confirm-password")?.value || "");
    if (newPass.length < 8) {
      if (setPasswordStatus) { setPasswordStatus.textContent = "Password must be at least 8 characters."; setPasswordStatus.classList.add("error"); }
      return;
    }
    if (newPass !== confirmPass) {
      if (setPasswordStatus) { setPasswordStatus.textContent = "Passwords do not match."; setPasswordStatus.classList.add("error"); }
      return;
    }
    const submitBtn = setPasswordForm.querySelector("button[type=submit]");
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Activating…"; }
    if (setPasswordStatus) { setPasswordStatus.textContent = ""; setPasswordStatus.classList.remove("error"); }

    const { error } = await supabase.auth.updateUser({ password: newPass });
    if (error) {
      if (setPasswordStatus) { setPasswordStatus.textContent = error.message; setPasswordStatus.classList.add("error"); }
      if (submitBtn) {
        submitBtn.disabled = false;
        configureSetPasswordFlow(pendingPasswordSetupFlow || "invite");
      }
      return;
    }
    pendingPasswordSetupFlow = "";
    clearAuthRedirectState();
    // Password set — load the dashboard
    const { data: { user } } = await supabase.auth.getUser();
    if (user) { await loadSessionOrPreview(user); }
  });

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      pendingPasswordSetupFlow = "recovery";
      configureSetPasswordFlow("recovery");
      showSetPassword();
      return;
    }

    if (session?.user) {
      if (pendingPasswordSetupFlow) {
        configureSetPasswordFlow(pendingPasswordSetupFlow);
        showSetPassword();
        return;
      }

      window.setTimeout(() => {
        loadSessionOrPreview(session.user).catch(() => {
          setAuthStatus("Could not load your portal data right now.", true);
        });
      }, 0);
      return;
    }

    showAuth();
    setPreviewModeUi(false);
    if (requestedPreviewUserId) {
      setAuthStatus("Admin preview requires an active admin session. Sign in to the admin portal first.", true);
      return;
    }
    if (authLandingState.error) {
      setAuthNotice("", "");
      setAuthStatus(authLandingState.error, true);
      return;
    }
    if (authLandingState.isSignupConfirmation) {
      setAuthMode("signin");
      setAuthStatus("");
      setAuthNotice(
        "Email verified",
        "Your email is confirmed. Sign in below with the password you created.",
        "success",
      );
      return;
    }
    setAuthNotice("", "");
    setAuthStatus("");
  });

  supabase.auth.getSession().then(async ({ data }) => {
    if (data.session?.user) {
      if (pendingPasswordSetupFlow) {
        configureSetPasswordFlow(pendingPasswordSetupFlow);
        showSetPassword();
        return;
      }
      await loadSessionOrPreview(data.session.user);
      return;
    }

    showAuth();
    setPreviewModeUi(false);
    if (requestedPreviewUserId) {
      setAuthStatus("Admin preview requires an active admin session. Sign in to the admin portal first.", true);
      return;
    }
    if (authLandingState.error) {
      setAuthNotice("", "");
      setAuthStatus(authLandingState.error, true);
      return;
    }
    if (authLandingState.isSignupConfirmation) {
      setAuthMode("signin");
      setAuthStatus("");
      setAuthNotice(
        "Email verified",
        "Your email is confirmed. Sign in below with the password you created.",
        "success",
      );
      return;
    }
    setAuthNotice("", "");
    setAuthStatus("");
  });
}
