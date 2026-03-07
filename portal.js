import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const config = window.__PORTAL_CONFIG__ || {};
const authCard = document.getElementById("auth-card");
const dashboardCard = document.getElementById("dashboard-card");
const setPasswordCard = document.getElementById("set-password-card");
const setPasswordForm = document.getElementById("set-password-form");
const setPasswordStatus = document.getElementById("set-password-status");
const authForm = document.getElementById("auth-form");
const authStatus = document.getElementById("auth-status");
const signUpBtn = document.getElementById("signup-btn");
const resetBtn = document.getElementById("reset-btn");
const logoutBtn = document.getElementById("logout-btn");
const refreshBtn = document.getElementById("refresh-btn");
const clientNameEl = document.getElementById("client-name");
const clientEmailEl = document.getElementById("client-email");
const scoreGridEl = document.getElementById("score-grid");
const lettersBodyEl = document.getElementById("letters-body");
const updatesListEl = document.getElementById("updates-list");
const filesListEl = document.getElementById("files-list");
const messageThreadEl = document.getElementById("message-thread");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const messageStatus = document.getElementById("message-status");
const clientUploadForm = document.getElementById("client-upload-form");
const uploadStatus = document.getElementById("upload-status");

const requiredConfig = ["supabaseUrl", "supabaseAnonKey"];
const missingConfig = requiredConfig.filter((k) => !config[k]);

if (missingConfig.length > 0) {
  setAuthStatus(
    "Portal is not configured yet. Add Supabase values in portal-config.js before using this page.",
    true
  );
  if (authForm) authForm.querySelectorAll("input,button").forEach((el) => { el.disabled = true; });
  if (signUpBtn) signUpBtn.disabled = true;
  if (resetBtn) resetBtn.disabled = true;
} else {
  initializePortal();
}

function setAuthStatus(message, isError = false) {
  if (!authStatus) return;
  authStatus.textContent = message;
  authStatus.classList.toggle("error", isError);
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

  async function loadDashboard(user) {
    currentUser = user;
    if (clientEmailEl) clientEmailEl.textContent = user.email || "";

    const [
      { data: profile },
      { data: snapshots },
      { data: letters },
      { data: updates },
      { data: files },
      { data: messages },
    ] = await Promise.all([
      supabase.from("client_profiles").select("full_name").eq("user_id", user.id).maybeSingle(),
      supabase.from("credit_snapshots").select("bureau,score,reported_at").eq("user_id", user.id).order("reported_at", { ascending: false }),
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

    renderScores(snapshots || []);
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
    if (file.size > 15 * 1024 * 1024) {
      setUploadStatus("File must be 15MB or smaller.", true);
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

  signUpBtn?.addEventListener("click", async () => {
    const email = String(document.getElementById("email")?.value || "").trim();
    const password = String(document.getElementById("password")?.value || "");
    if (!email || password.length < 8) {
      setAuthStatus("Use a valid email and password with at least 8 characters.", true);
      return;
    }
    setAuthStatus("Creating account...");
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin + "/portal.html" },
    });
    if (error) { setAuthStatus(error.message, true); return; }
    setAuthStatus("Account created. Check your email to confirm before signing in.");
  });

  resetBtn?.addEventListener("click", async () => {
    const email = String(document.getElementById("email")?.value || "").trim();
    if (!email) { setAuthStatus("Enter your email first, then click reset.", true); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/portal.html",
    });
    if (error) { setAuthStatus(error.message, true); return; }
    setAuthStatus("Password reset email sent.");
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
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Activate Account →"; }
      return;
    }
    // Password set — load the dashboard
    const { data: { user } } = await supabase.auth.getUser();
    if (user) { showDashboard(); await loadDashboard(user); }
  });

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      // Client clicked invite / password-reset link — show set-password screen
      showSetPassword();
    } else if (session?.user) {
      showDashboard();
      await loadDashboard(session.user);
    } else {
      showAuth();
    }
  });

  supabase.auth.getSession().then(async ({ data }) => {
    if (data.session?.user) { showDashboard(); await loadDashboard(data.session.user); }
    else { showAuth(); }
  });
}
