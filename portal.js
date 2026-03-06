import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const config = window.__PORTAL_CONFIG__ || {};
const authCard = document.getElementById("auth-card");
const dashboardCard = document.getElementById("dashboard-card");
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

const requiredConfig = ["supabaseUrl", "supabaseAnonKey"];
const missingConfig = requiredConfig.filter((k) => !config[k]);

if (missingConfig.length > 0) {
  setAuthStatus(
    "Portal is not configured yet. Add Supabase values in portal-config.js before using this page.",
    true
  );
  if (authForm) {
    authForm.querySelectorAll("input,button").forEach((el) => {
      el.disabled = true;
    });
  }
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

function showDashboard() {
  if (authCard) authCard.classList.add("hidden");
  if (dashboardCard) dashboardCard.classList.remove("hidden");
}

function showAuth() {
  if (dashboardCard) dashboardCard.classList.add("hidden");
  if (authCard) authCard.classList.remove("hidden");
}

function escapeHtml(value) {
  return value
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
    const key = row.bureau;
    if (!latestByBureau.has(key)) latestByBureau.set(key, row);
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
      const link = row.signed_url
        ? `<a href="${escapeHtml(row.signed_url)}" target="_blank" rel="noopener noreferrer">Open file</a>`
        : "File link unavailable";

      return `
        <li>
          <p class="file-meta">${escapeHtml(category)} • ${escapeHtml(created)}</p>
          <p class="file-title">${escapeHtml(title)} - ${link}</p>
          <p class="file-note">${escapeHtml(note)}</p>
        </li>
      `;
    })
    .join("");
}

function initializePortal() {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

  async function loadDashboard(user) {
    if (clientEmailEl) clientEmailEl.textContent = user.email || "";

    const [{ data: profile }, { data: snapshots }, { data: letters }, { data: updates }, { data: files }] =
      await Promise.all([
        supabase
          .from("client_profiles")
          .select("full_name")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("credit_snapshots")
          .select("bureau,score,reported_at")
          .eq("user_id", user.id)
          .order("reported_at", { ascending: false }),
        supabase
          .from("client_letters")
          .select("sent_date,bureau,recipient,tracking_number,status,notes")
          .eq("user_id", user.id)
          .order("sent_date", { ascending: false }),
        supabase
          .from("client_updates")
          .select("details,created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("client_files")
          .select("id,title,category,notes,file_name,file_path,bucket,created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
      ]);

    if (clientNameEl) {
      clientNameEl.textContent = profile?.full_name || "Client";
    }

    const filesWithSignedUrls = await Promise.all(
      (files || []).map(async (row) => {
        const bucket = row.bucket || "client-docs";
        const { data } = await supabase.storage
          .from(bucket)
          .createSignedUrl(row.file_path, 60 * 60);
        return {
          ...row,
          signed_url: data?.signedUrl || "",
        };
      })
    );

    renderScores(snapshots || []);
    renderLetters(letters || []);
    renderUpdates(updates || []);
    renderFiles(filesWithSignedUrls);
  }

  authForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = String(document.getElementById("email")?.value || "").trim();
    const password = String(document.getElementById("password")?.value || "");

    if (!email || !password) {
      setAuthStatus("Please enter email and password.", true);
      return;
    }

    setAuthStatus("Signing in...");

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      setAuthStatus(error?.message || "Could not sign in.", true);
      return;
    }

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
      options: {
        emailRedirectTo: window.location.origin + "/portal.html",
      },
    });

    if (error) {
      setAuthStatus(error.message, true);
      return;
    }

    setAuthStatus("Account created. Check your email to confirm before signing in.");
  });

  resetBtn?.addEventListener("click", async () => {
    const email = String(document.getElementById("email")?.value || "").trim();
    if (!email) {
      setAuthStatus("Enter your email first, then click reset.", true);
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/portal.html",
    });

    if (error) {
      setAuthStatus(error.message, true);
      return;
    }

    setAuthStatus("Password reset email sent.");
  });

  logoutBtn?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    showAuth();
    setAuthStatus("Signed out.");
  });

  refreshBtn?.addEventListener("click", async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await loadDashboard(user);
  });

  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user) {
      showDashboard();
      await loadDashboard(session.user);
    } else {
      showAuth();
    }
  });

  supabase.auth.getSession().then(async ({ data }) => {
    if (data.session?.user) {
      showDashboard();
      await loadDashboard(data.session.user);
    } else {
      showAuth();
    }
  });
}
