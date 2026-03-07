const RESEND_URL = "https://api.resend.com/emails";

const SUPABASE_ADMIN_USERS_PATH = "/auth/v1/admin/users";
const SUPABASE_ADMIN_GENERATE_LINK_PATH = "/auth/v1/admin/generate_link";

const GOAL_LABELS = {
  mortgage: "Mortgage readiness",
  auto: "Auto financing",
  score: "Improve score and profile",
  review: "General credit review",
};

function json(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(payload));
}

function requiredEnv(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isTruthy(value, defaultValue = false) {
  if (value == null) return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function formatGoal(goal) {
  return GOAL_LABELS[goal] || goal || "Not specified";
}

function buildPortalLoginUrl() {
  const explicit = requiredEnv("PORTAL_LOGIN_URL");
  if (explicit) return explicit;

  const siteUrl = requiredEnv("SITE_URL") || requiredEnv("PUBLIC_SITE_URL");
  if (siteUrl) {
    return `${siteUrl.replace(/\/+$/, "")}/portal.html`;
  }

  return "http://localhost:8080/portal.html";
}

function buildPortalRedirectUrl(portalLoginUrl) {
  const explicit = requiredEnv("PORTAL_REDIRECT_URL");
  return explicit || portalLoginUrl;
}

function generateTemporaryPassword() {
  const seed = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random()
    .toString(36)
    .slice(2)}`;
  return `Dr!${seed.slice(0, 18)}9Aa`;
}

async function sendEmail(apiKey, message) {
  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend request failed (${response.status}): ${body}`);
  }
}

function parsePayload(body) {
  if (!body) return null;

  let sourceBody = body;
  if (typeof body === "string") {
    sourceBody = parseMaybeJson(body);
  }
  if (!sourceBody || typeof sourceBody !== "object") return null;

  const payload = {
    name: String(sourceBody.name || "").trim(),
    email: String(sourceBody.email || "").trim(),
    phone: String(sourceBody.phone || "").trim(),
    goal: String(sourceBody.goal || "").trim(),
    message: String(sourceBody.message || "").trim(),
    source: String(sourceBody.source || "website").trim(),
    consent: Boolean(sourceBody.consent),
  };

  if (!payload.name || !payload.email || !payload.phone || !payload.goal || !payload.consent) {
    return null;
  }

  payload.email = normalizeEmail(payload.email);
  return payload;
}

function parseMaybeJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function formatSupabaseError(status, data, rawText) {
  const message =
    (data && (data.msg || data.message || data.error_description || data.error)) || rawText;
  return `Supabase request failed (${status}): ${String(message || "Unknown error")}`;
}

async function supabaseRequest({
  supabaseUrl,
  serviceRoleKey,
  path,
  method = "GET",
  body,
  headers = {},
}) {
  const base = supabaseUrl.replace(/\/+$/, "");
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });

  const rawText = await response.text();
  const data = parseMaybeJson(rawText);

  if (!response.ok) {
    throw new Error(formatSupabaseError(response.status, data, rawText));
  }

  return data;
}

function isDuplicateUserError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("already") ||
    message.includes("duplicate") ||
    message.includes("registered") ||
    message.includes("exists")
  );
}

async function findUserByEmail({ supabaseUrl, serviceRoleKey, email }) {
  const data = await supabaseRequest({
    supabaseUrl,
    serviceRoleKey,
    path: `${SUPABASE_ADMIN_USERS_PATH}?page=1&per_page=1000`,
    method: "GET",
  });

  const users = Array.isArray(data?.users) ? data.users : [];
  const target = normalizeEmail(email);
  return users.find((user) => normalizeEmail(user?.email) === target) || null;
}

async function createOrFetchPortalUser({ supabaseUrl, serviceRoleKey, payload }) {
  try {
    const data = await supabaseRequest({
      supabaseUrl,
      serviceRoleKey,
      path: SUPABASE_ADMIN_USERS_PATH,
      method: "POST",
      body: {
        email: payload.email,
        password: generateTemporaryPassword(),
        email_confirm: true,
        user_metadata: {
          full_name: payload.name,
          phone: payload.phone,
          lead_source: payload.source,
          lead_goal: payload.goal,
        },
      },
    });

    const userId = data?.id || data?.user?.id || null;
    if (!userId) {
      throw new Error("Supabase did not return a user id for created account.");
    }

    return { userId, created: true };
  } catch (error) {
    if (!isDuplicateUserError(error)) {
      throw error;
    }

    const existingUser = await findUserByEmail({
      supabaseUrl,
      serviceRoleKey,
      email: payload.email,
    });

    if (!existingUser?.id) {
      throw new Error("Portal user exists but could not be loaded by email.");
    }

    return { userId: existingUser.id, created: false };
  }
}

async function upsertClientProfile({ supabaseUrl, serviceRoleKey, userId, payload }) {
  await supabaseRequest({
    supabaseUrl,
    serviceRoleKey,
    path: "/rest/v1/client_profiles?on_conflict=user_id",
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: [
      {
        user_id: userId,
        full_name: payload.name || null,
        phone: payload.phone || null,
      },
    ],
  });
}

async function generatePortalSetupLink({
  supabaseUrl,
  serviceRoleKey,
  email,
  redirectTo,
}) {
  const body = {
    type: "recovery",
    email,
  };

  if (redirectTo) {
    // Raw GoTrue admin endpoints expect snake_case here.
    body.redirect_to = redirectTo;
  }

  const data = await supabaseRequest({
    supabaseUrl,
    serviceRoleKey,
    path: SUPABASE_ADMIN_GENERATE_LINK_PATH,
    method: "POST",
    body,
  });

  return data?.action_link || data?.properties?.action_link || "";
}

async function runPortalOnboarding(payload) {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const portalLoginUrl = buildPortalLoginUrl();

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      enabled: false,
      status: "skipped",
      reason: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      portalLoginUrl,
    };
  }

  if (!isTruthy(requiredEnv("AUTO_CREATE_PORTAL_USERS"), true)) {
    return {
      enabled: false,
      status: "disabled",
      reason: "AUTO_CREATE_PORTAL_USERS is disabled",
      portalLoginUrl,
    };
  }

  try {
    const { userId, created } = await createOrFetchPortalUser({
      supabaseUrl,
      serviceRoleKey,
      payload,
    });

    await upsertClientProfile({
      supabaseUrl,
      serviceRoleKey,
      userId,
      payload,
    });

    const redirectTo = buildPortalRedirectUrl(portalLoginUrl);
    const actionLink = await generatePortalSetupLink({
      supabaseUrl,
      serviceRoleKey,
      email: payload.email,
      redirectTo,
    });

    return {
      enabled: true,
      status: created ? "created" : "existing",
      userId,
      actionLink,
      portalLoginUrl,
    };
  } catch (error) {
    return {
      enabled: true,
      status: "error",
      error: error instanceof Error ? error.message : "Unknown onboarding error",
      portalLoginUrl,
    };
  }
}

function buildAdminLeadText(payload, onboarding) {
  const lines = [
    "New website lead",
    `Name: ${payload.name}`,
    `Email: ${payload.email}`,
    `Phone: ${payload.phone}`,
    `Goal: ${formatGoal(payload.goal)} (${payload.goal})`,
    `Message: ${payload.message || "N/A"}`,
    `Source: ${payload.source}`,
    `Received: ${new Date().toISOString()}`,
    "",
    "Portal onboarding:",
    `Enabled: ${onboarding.enabled ? "Yes" : "No"}`,
    `Status: ${onboarding.status}`,
    `Portal login URL: ${onboarding.portalLoginUrl || "N/A"}`,
  ];

  if (onboarding.userId) {
    lines.push(`Portal user id: ${onboarding.userId}`);
  }

  if (onboarding.actionLink) {
    lines.push(`Password setup link generated: Yes`);
  }

  if (onboarding.reason) {
    lines.push(`Reason: ${onboarding.reason}`);
  }

  if (onboarding.error) {
    lines.push(`Error: ${onboarding.error}`);
  }

  return lines.join("\n");
}

function buildClientReplyText(payload, onboarding) {
  if (onboarding.enabled && onboarding.status !== "error" && onboarding.actionLink) {
    return `Hi ${payload.name},

Thank you for enrolling with Donoso Credit Repair.

Your secure client portal account is ready.

1) Set your password and activate access:
${onboarding.actionLink}

2) Sign in at:
${onboarding.portalLoginUrl}

Login email:
${payload.email}

If the link expires, use "Forgot password?" on the portal page.

Need help now? Reply to this email.

Donoso Credit Repair`;
  }

  return `Hi ${payload.name},

Thank you for contacting Donoso Credit Repair.
We received your request and will contact you soon.

If you need immediate assistance, reply to this email.

Requested goal: ${formatGoal(payload.goal)}

Donoso Credit Repair`;
}

async function postWebhookIfConfigured(payload, onboarding) {
  const webhookUrl = requiredEnv("LEAD_WEBHOOK_URL");
  if (!webhookUrl) return;

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      onboarding_status: onboarding.status,
      onboarding_user_id: onboarding.userId || null,
      received_at: new Date().toISOString(),
    }),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed." });
  }

  const resendKey = requiredEnv("RESEND_API_KEY");
  const toEmail = requiredEnv("LEADS_TO_EMAIL") || "donoso420@icloud.com";
  const fromEmail = requiredEnv("FROM_EMAIL");

  if (!resendKey || !fromEmail) {
    return json(res, 500, {
      error: "Server email configuration is incomplete.",
    });
  }

  const payload = parsePayload(req.body);
  if (!payload) {
    return json(res, 400, { error: "Please complete all required fields." });
  }

  const onboarding = await runPortalOnboarding(payload);

  try {
    await sendEmail(resendKey, {
      from: fromEmail,
      to: [toEmail],
      reply_to: payload.email,
      subject: `New lead: ${payload.name} (${formatGoal(payload.goal)})`,
      text: buildAdminLeadText(payload, onboarding),
    });

    await sendEmail(resendKey, {
      from: fromEmail,
      to: [payload.email],
      subject:
        onboarding.enabled && onboarding.status !== "error"
          ? "Your Donoso Credit Repair portal access"
          : "We received your consultation request",
      text: buildClientReplyText(payload, onboarding),
    });

    await postWebhookIfConfigured(payload, onboarding);

    return json(res, 200, {
      ok: true,
      onboarding: {
        status: onboarding.status,
      },
    });
  } catch (error) {
    return json(res, 500, {
      error: "We could not submit your request. Please try again.",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
