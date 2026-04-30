const SUPABASE_ADMIN_USERS_PATH = "/auth/v1/admin/users";

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function supabaseAdminRequest({ supabaseUrl, serviceRoleKey, path, method = "GET", body }) {
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.msg || payload?.message || "Supabase request failed.");
  }

  return payload;
}

async function findUserByEmail({ supabaseUrl, serviceRoleKey, email }) {
  const data = await supabaseAdminRequest({
    supabaseUrl,
    serviceRoleKey,
    path: `${SUPABASE_ADMIN_USERS_PATH}?page=1&per_page=1000`,
  });

  const users = Array.isArray(data?.users) ? data.users : [];
  const target = normalizeEmail(email);
  return users.find((user) => normalizeEmail(user?.email) === target) || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: "Server not configured for portal signup checks." });
    return;
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    res.status(400).json({ error: "Invalid request body." });
    return;
  }

  const email = normalizeEmail(body?.email);
  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "A valid email is required." });
    return;
  }

  try {
    const existingUser = await findUserByEmail({
      supabaseUrl,
      serviceRoleKey,
      email,
    });

    if (existingUser?.id) {
      res.status(409).json({
        exists: true,
        error:
          "This email already has portal access. Use your setup email or tap Forgot password instead of creating a new account.",
      });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error?.message || "Could not verify portal account access." });
  }
}
