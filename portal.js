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
const resetBtn = document.getElementById("reset-btn");
const logoutBtn = document.getElementById("logout-btn");
const refreshBtn = document.getElementById("refresh-btn");
const clientNameEl = document.getElementById("client-name");
const clientEmailEl = document.getElementById("client-email");
const scoreGridEl = document.getElementById("score-grid");
const reportGridEl = document.getElementById("report-grid");
const negativeTrackerStatsEl = document.getElementById("negative-tracker-stats");
const negativeTrackerGridEl = document.getElementById("negative-tracker-grid");
const lettersBodyEl = document.getElementById("letters-body");
const updatesListEl = document.getElementById("updates-list");
const filesListEl = document.getElementById("files-list");
const messageThreadEl = document.getElementById("message-thread");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const messageStatus = document.getElementById("message-status");
const clientUploadForm = document.getElementById("client-upload-form");
const uploadStatus = document.getElementById("upload-status");
const authLandingState = getAuthLandingState();
let authEmailCooldownUntil = 0;

const MAX_UPLOAD_SIZE_MB = 500;
const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;

const requiredConfig = ["supabaseUrl", "supabaseAnonKey"];
const missingConfig = requiredConfig.filter((k) => !config[k]);

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

function setAuthControlsDisabled(disabled) {
  authForm?.querySelectorAll("input,button").forEach((el) => {
    el.disabled = disabled;
  });
  if (resetBtn) resetBtn.disabled = disabled;
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

  return message || "Unexpected authentication error.";
}

function setUploadStatus(message, isError = false) {
  if (!uploadStatus) return;
  uploadStatus.textContent = message;
  uploadStatus.classList.toggle("error", isError);
}

function setMessageStatus(message, isError = false) {
  if (!messageStatus) return;
  messageStatus.textContent = message;
  messageStatus.classList.toggle("error", isError);
}

function showDashboard() {
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

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleDateString();
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString();
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

function verificationBadgeClass(value) {
  switch (String(value || "").toLowerCase()) {
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

function getNegativeItemStage(row = {}) {
  const status = String(row.status || "").toLowerCase();
  const notes = String(row.notes || "").toLowerCase();
  const combined = `${status} ${notes}`;

  if (
    row.is_active === false ||
    /\b(resolved|removed|deleted|completed|closed|cleared)\b/.test(combined)
  ) {
    return { key: "resolved", label: "Resolved", step: 3, badgeClass: "stage-resolved" };
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

function sanitizeFileName(name) {
  return String(name || "file")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-");
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

function renderTracker(letters, snapshots) {
  const trackerEl = document.getElementById("progress-tracker");
  if (!trackerEl) return;

  let currentStep = 1;
  if (snapshots && snapshots.length > 0) currentStep = 2;
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
    .map((row) => {
      const status = row.status || "In Transit";
      const badgeClass = statusBadgeClass(status);
      return `
        <tr>
          <td>${escapeHtml(formatDate(row.sent_date))}</td>
          <td>${escapeHtml(row.recipient || row.bureau || "N/A")}</td>
          <td>${escapeHtml(row.tracking_number || "N/A")}</td>
          <td><span class="badge ${escapeHtml(badgeClass)}">${escapeHtml(status)}</span></td>
          <td>${escapeHtml(row.notes || "")}</td>
        </tr>
      `;
    })
    .join("");
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
      const summary = row.summary || "Current report on file.";
      const reviewLabel = formatVerificationStatus(row.verification_status);
      const reviewMethod = formatVerificationMethod(row.verification_method);
      const reviewNotes = row.verification_notes
        ? `<p class="report-review-note">${escapeHtml(row.verification_notes)}</p>`
        : "";
      const openLink = row.signed_url
        ? `<a href="${escapeHtml(row.signed_url)}" target="_blank" rel="noopener noreferrer">Open report</a>`
        : "File link unavailable";
      return `
        <article class="report-card">
          <p class="bureau">${escapeHtml(row.bureau || "Other")}</p>
          <p class="report-review"><span class="badge ${escapeHtml(
            verificationBadgeClass(row.verification_status)
          )}">${escapeHtml(reviewLabel)}</span> ${escapeHtml(reviewMethod)}</p>
          <p class="report-score">${escapeHtml(row.score != null ? row.score : "--")}</p>
          <p class="stamp">${escapeHtml(reportDate)}</p>
          <p class="report-summary">${escapeHtml(summary)}</p>
          ${reviewNotes}
          <p class="report-link">${openLink}</p>
        </article>
      `;
    })
    .join("");
}

function renderNegativeItems(items) {
  if (!negativeTrackerGridEl || !negativeTrackerStatsEl) return;

  const totals = items.reduce(
    (summary, row) => {
      const stage = getNegativeItemStage(row);
      const balance = Number(row.balance);

      summary.total += 1;
      if (stage.key === "resolved") {
        summary.resolved += 1;
      } else {
        summary.inProgress += 1;
      }
      if (Number.isFinite(balance) && stage.key !== "resolved") {
        summary.activeBalance += balance;
      }
      return summary;
    },
    { total: 0, inProgress: 0, resolved: 0, activeBalance: 0 }
  );

  negativeTrackerStatsEl.innerHTML = `
    <article class="negative-stat-card">
      <span>Total Items</span>
      <strong>${escapeHtml(totals.total)}</strong>
    </article>
    <article class="negative-stat-card">
      <span>In Progress</span>
      <strong>${escapeHtml(totals.inProgress)}</strong>
    </article>
    <article class="negative-stat-card">
      <span>Resolved</span>
      <strong>${escapeHtml(totals.resolved)}</strong>
    </article>
    <article class="negative-stat-card">
      <span>Active Balance</span>
      <strong>${escapeHtml(formatCurrency(totals.activeBalance))}</strong>
    </article>
  `;

  if (!items.length) {
    negativeTrackerGridEl.innerHTML =
      '<article class="negative-track-card empty-card"><p class="empty">No negative items logged yet.</p></article>';
    return;
  }

  negativeTrackerGridEl.innerHTML = items
    .map((row) => {
      const stage = getNegativeItemStage(row);
      const status = row.status || (row.is_active === false ? "Resolved / removed" : "Under review");
      const balance = row.balance == null ? "N/A" : formatCurrency(row.balance);
      const reviewLabel = formatVerificationMethod(row.verification_method);
      const accountRef = row.account_reference ? ` • Acct ${row.account_reference}` : "";
      const note = row.notes || row.evidence_excerpt || "";
      return `
        <article class="negative-track-card">
          <div class="negative-track-top">
            <p class="bureau">${escapeHtml(row.bureau || "All Bureaus")}</p>
            <span class="negative-stage-badge ${escapeHtml(stage.badgeClass)}">${escapeHtml(
              stage.label
            )}</span>
          </div>
          <h4>${escapeHtml(row.creditor || "Unknown creditor")}</h4>
          <p class="negative-track-meta">${escapeHtml(row.item_type || "Negative Item")}${escapeHtml(
            accountRef
          )}</p>
          <div class="negative-stage">${renderNegativeStage(stage.step)}</div>
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
}

function renderUpdates(updates) {
  if (!updatesListEl) return;
  if (!updates.length) {
    updatesListEl.innerHTML = '<li class="empty">No updates posted yet.</li>';
    return;
  }

  updatesListEl.innerHTML = updates
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

function renderMessages(messages, currentUserId) {
  if (!messageThreadEl) return;
  if (!messages.length) {
    messageThreadEl.innerHTML = '<li class="empty">No messages yet.</li>';
    return;
  }

  messageThreadEl.innerHTML = messages
    .map((row) => {
      const isClient = row.sender_role === "client";
      const sideClass = isClient ? "msg-client" : "msg-admin";
      const label = isClient ? "You" : "Donoso Credit Repair";
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

function initializePortal() {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  let currentUser = null;
  let pendingPasswordSetupFlow = authLandingState.needsPasswordSetup ? authLandingState.type : "";

  if (pendingPasswordSetupFlow) {
    configureSetPasswordFlow(pendingPasswordSetupFlow);
  }

  async function loadDashboard(user) {
    currentUser = user;
    if (clientEmailEl) clientEmailEl.textContent = user.email || "";

    const [
      { data: profile },
      { data: snapshots },
      reports,
      negativeItems,
      { data: letters },
      { data: updates },
      { data: files },
      { data: messages },
    ] = await Promise.all([
      supabase.from("client_profiles").select("full_name").eq("user_id", user.id).maybeSingle(),
      supabase.from("credit_snapshots").select("bureau,score,reported_at").eq("user_id", user.id).order("reported_at", { ascending: false }),
      safeTableQuery(
        supabase
          .from("credit_reports")
          .select("id,bureau,score,report_date,summary,verification_status,verification_method,verification_notes,file_id,created_at")
          .eq("user_id", user.id)
          .order("report_date", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(12)
      ),
      safeTableQuery(
        supabase
          .from("negative_items")
          .select("bureau,creditor,item_type,account_reference,balance,status,notes,is_active,verification_method,evidence_excerpt,created_at")
          .eq("user_id", user.id)
          .order("is_active", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(40)
      ),
      supabase.from("client_letters").select("sent_date,bureau,recipient,tracking_number,status,notes").eq("user_id", user.id).order("sent_date", { ascending: false }),
      supabase.from("client_updates").select("details,created_at").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("client_files").select("id,title,category,notes,file_name,file_path,bucket,created_at,uploaded_by").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("portal_messages").select("sender_role,content,created_at").eq("user_id", user.id).order("created_at", { ascending: true }),
    ]);

    if (clientNameEl) clientNameEl.textContent = profile?.full_name || "Client";

    const filesWithSignedUrls = await Promise.all(
      (files || []).map(async (row) => {
        const bucket = row.bucket || "client-docs";
        const { data } = await supabase.storage.from(bucket).createSignedUrl(row.file_path, 60 * 60);
        return { ...row, signed_url: data?.signedUrl || "" };
      })
    );

    const fileMap = new Map(filesWithSignedUrls.map((row) => [row.id, row.signed_url || ""]));
    const reportsWithUrls = (reports || []).map((row) => ({
      ...row,
      signed_url: fileMap.get(row.file_id) || "",
    }));

    renderScores(snapshots || []);
    renderReports(reportsWithUrls);
    renderNegativeItems(negativeItems || []);
    renderTracker(letters || [], snapshots || []);
    renderLetters(letters || []);
    renderUpdates(updates || []);
    renderFiles(filesWithSignedUrls);
    renderMessages(messages || [], user.id);
  }

  // Message send
  messageForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentUser) return;
    const content = String(messageInput?.value || "").trim();
    if (!content) return;

    setMessageStatus("Sending...");
    const { error } = await supabase.from("portal_messages").insert({
      user_id: currentUser.id,
      sender_role: "client",
      content,
    });

    if (error) {
      setMessageStatus("Could not send message. Try again.", true);
      return;
    }

    if (messageInput) messageInput.value = "";
    setMessageStatus("");

    const { data: messages } = await supabase
      .from("portal_messages")
      .select("sender_role,content,created_at")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: true });

    renderMessages(messages || [], currentUser.id);
  });

  // Client file upload
  clientUploadForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentUser) return;

    const fileInput = document.getElementById("client-file-input");
    const file = fileInput?.files?.[0];
    const title = String(document.getElementById("client-file-title")?.value || "").trim();

    if (!file) { setUploadStatus("Please choose a file.", true); return; }

    const allowedTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
    if (!allowedTypes.has(file.type)) {
      setUploadStatus("Only PDF, PNG, JPG, or WebP files are allowed.", true);
      return;
    }
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      setUploadStatus(`File must be ${formatMbLimit(MAX_UPLOAD_SIZE_MB)} or smaller.`, true);
      return;
    }

    setUploadStatus("Uploading...");
    const bucket = "client-docs";
    const safeName = sanitizeFileName(file.name);
    const objectPath = `${currentUser.id}/client-uploads/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage.from(bucket).upload(objectPath, file, {
      upsert: false,
      contentType: file.type,
    });

    if (uploadError) {
      setUploadStatus("Upload failed: " + uploadError.message, true);
      return;
    }

    const { error: rowError } = await supabase.from("client_files").insert({
      user_id: currentUser.id,
      bucket,
      file_path: objectPath,
      file_name: file.name,
      content_type: file.type,
      file_size: file.size,
      category: "Incoming Mail",
      title: title || file.name,
      uploaded_by: "client",
    });

    if (rowError) {
      setUploadStatus("File uploaded but could not save record: " + rowError.message, true);
      return;
    }

    clientUploadForm.reset();
    setUploadStatus("Document uploaded successfully.");
    await loadDashboard(currentUser);
  });

  authForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = String(document.getElementById("email")?.value || "").trim();
    const password = String(document.getElementById("password")?.value || "");
    if (!email || !password) { setAuthStatus("Please enter email and password.", true); return; }

    setAuthStatus("Signing in...");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) { setAuthStatus(error?.message || "Could not sign in.", true); return; }

    setAuthStatus("");
    showDashboard();
    await loadDashboard(data.user);
  });

  resetBtn?.addEventListener("click", async () => {
    const email = String(document.getElementById("email")?.value || "").trim();
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
    currentUser = null;
    window.location.href = "portal.html";
  });

  refreshBtn?.addEventListener("click", async () => {
    if (!currentUser) return;
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Refreshing…";
    try {
      await loadDashboard(currentUser);
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
    if (user) { showDashboard(); await loadDashboard(user); }
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

      clearAuthRedirectState();
      showDashboard();
      window.setTimeout(() => {
        loadDashboard(session.user).catch(() => {
          setAuthStatus("Could not load your portal data right now.", true);
        });
      }, 0);
      return;
    }

    showAuth();
    if (authLandingState.error) {
      setAuthStatus(authLandingState.error, true);
      return;
    }
    if (authLandingState.isSignupConfirmation) {
      setAuthStatus("Email confirmed. Sign in below with the password you created.");
      return;
    }
    setAuthStatus("");
  });

  supabase.auth.getSession().then(async ({ data }) => {
    if (data.session?.user) {
      if (pendingPasswordSetupFlow) {
        configureSetPasswordFlow(pendingPasswordSetupFlow);
        showSetPassword();
        return;
      }
      clearAuthRedirectState();
      showDashboard();
      await loadDashboard(data.session.user);
      return;
    }

    showAuth();
    if (authLandingState.error) {
      setAuthStatus(authLandingState.error, true);
      return;
    }
    if (authLandingState.isSignupConfirmation) {
      setAuthStatus("Email confirmed. Sign in below with the password you created.");
      return;
    }
    setAuthStatus("");
  });
}
