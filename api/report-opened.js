function json(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(payload));
}

function getEnv(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function parseMaybeJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function getAuthenticatedUser({ supabaseUrl, serviceRoleKey, accessToken }) {
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  return response.json().catch(() => null);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed." });
    return;
  }

  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    json(res, 500, {
      error: "Server not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to host env vars.",
    });
    return;
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    json(res, 400, { error: "Invalid request body." });
    return;
  }

  const reportId = Number(body?.reportId || 0);
  if (!Number.isInteger(reportId) || reportId <= 0) {
    json(res, 400, { error: "A valid reportId is required." });
    return;
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    json(res, 401, { error: "Missing bearer token." });
    return;
  }

  const user = await getAuthenticatedUser({ supabaseUrl, serviceRoleKey, accessToken });
  if (!user?.id) {
    json(res, 401, { error: "Invalid session." });
    return;
  }

  const query = new URLSearchParams({
    id: `eq.${reportId}`,
    user_id: `eq.${user.id}`,
    verification_status: "in.(pending,needs_review)",
    select: "id,verification_status",
  });

  const response = await fetch(
    `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/credit_reports?${query.toString()}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        verification_status: "reviewed",
        verified_at: new Date().toISOString(),
      }),
    }
  );

  const rawText = await response.text();
  const data = parseMaybeJson(rawText) ?? [];

  if (!response.ok) {
    json(res, 400, { error: data?.message || data?.error || "Could not mark report reviewed." });
    return;
  }

  json(res, 200, {
    updated: Array.isArray(data) && data.length > 0,
  });
}
