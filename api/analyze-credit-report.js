const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MAX_AI_FILE_SIZE_BYTES = 45 * 1024 * 1024;
const DEFAULT_MODEL = process.env.OPENAI_CREDIT_REPORT_MODEL || "gpt-4o-mini";

const CREDIT_REPORT_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["document", "negative_items"],
  properties: {
    document: {
      type: "object",
      additionalProperties: false,
      required: [
        "accepted",
        "document_type",
        "reason",
        "bureau",
        "report_date",
        "score",
        "report_label",
        "summary",
      ],
      properties: {
        accepted: { type: "boolean" },
        document_type: {
          type: "string",
          enum: ["credit_report_pdf", "screenshot_or_photo", "non_report", "uncertain"],
        },
        reason: { type: "string" },
        bureau: { type: "string" },
        report_date: { type: "string" },
        score: { anyOf: [{ type: "integer" }, { type: "null" }] },
        report_label: { type: "string" },
        summary: { type: "string" },
      },
    },
    negative_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "bureau",
          "creditor",
          "item_type",
          "account_reference",
          "status",
          "balance",
          "notes",
          "evidence_excerpt",
          "confidence",
        ],
        properties: {
          bureau: { type: "string" },
          creditor: { type: "string" },
          item_type: { type: "string" },
          account_reference: { type: "string" },
          status: { type: "string" },
          balance: { anyOf: [{ type: "number" }, { type: "null" }] },
          notes: { type: "string" },
          evidence_excerpt: { type: "string" },
          confidence: { anyOf: [{ type: "number" }, { type: "null" }] },
        },
      },
    },
  },
};

function parseMaybeJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function json(res, status, body) {
  res.status(status).json(body);
}

function buildApiError(message, statusCode = 500, code = "") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function formatSupabaseError(status, data, rawText) {
  const message =
    (data && (data.message || data.msg || data.error_description || data.error)) || rawText;
  return `Supabase request failed (${status}): ${String(message || "Unknown error")}`;
}

async function supabaseJsonRequest({
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

async function identifySupabaseUser({ supabaseUrl, serviceRoleKey, accessToken }) {
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY || serviceRoleKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const rawText = await response.text();
  const data = parseMaybeJson(rawText);

  if (!response.ok || !data?.id) {
    throw new Error("Unauthorized.");
  }

  return data;
}

async function requireAdmin({ supabaseUrl, serviceRoleKey, userId }) {
  const params = new URLSearchParams({
    select: "user_id",
    user_id: `eq.${userId}`,
    limit: "1",
  });
  const data = await supabaseJsonRequest({
    supabaseUrl,
    serviceRoleKey,
    path: `/rest/v1/admin_users?${params.toString()}`,
  });

  if (!Array.isArray(data) || !data.length) {
    throw new Error("Forbidden.");
  }
}

async function loadClientFile({ supabaseUrl, serviceRoleKey, fileId }) {
  const params = new URLSearchParams({
    select: "id,user_id,bucket,file_path,file_name,content_type,file_size,category,title,notes,uploaded_by,created_at",
    id: `eq.${fileId}`,
    limit: "1",
  });
  const data = await supabaseJsonRequest({
    supabaseUrl,
    serviceRoleKey,
    path: `/rest/v1/client_files?${params.toString()}`,
  });

  return Array.isArray(data) && data[0] ? data[0] : null;
}

function encodeStoragePath(path) {
  return String(path || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function createSignedStorageUrl({ supabaseUrl, serviceRoleKey, bucket, filePath }) {
  const base = supabaseUrl.replace(/\/+$/, "");
  const response = await fetch(
    `${base}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodeStoragePath(filePath)}`,
    {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: 300 }),
    }
  );

  const rawText = await response.text();
  const data = parseMaybeJson(rawText);
  if (!response.ok || !(data?.signedURL || data?.signedUrl)) {
    throw new Error(`Could not sign the uploaded PDF: ${rawText || response.status}`);
  }

  const signedPath = data.signedURL || data.signedUrl;
  return signedPath.startsWith("http") ? signedPath : `${base}/storage/v1${signedPath}`;
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const block of output) {
    const content = Array.isArray(block?.content) ? block.content : [];
    for (const part of content) {
      if (typeof part?.text === "string" && part.text.trim()) {
        return part.text.trim();
      }
    }
  }

  return "";
}

function buildPrompt(fileRecord) {
  const hints = [fileRecord.category, fileRecord.title, fileRecord.notes].filter(Boolean).join(" | ");
  return [
    "You are reviewing a PDF uploaded to a credit repair client portal.",
    "Decide whether it is a real credit report PDF that can be trusted for negative-item extraction.",
    "Reject screenshots, phone captures, camera photos, image-only screenshot PDFs, or general correspondence that does not clearly show tradelines/negative accounts.",
    "Only accept PDFs that look like bureau reports, AnnualCreditReport downloads, tri-merge reports, or other structured credit reports.",
    "If accepted, extract only negative items explicitly visible in the PDF.",
    "Be conservative. If you are unsure, reject the document and return an empty negative_items array.",
    "Use short evidence excerpts copied from the report to justify each negative item.",
    "Return report_date as YYYY-MM-DD when visible, otherwise an empty string.",
    "Return an empty string for any unknown text field.",
    `Portal metadata: ${hints || "No metadata provided."}`,
  ].join("\n");
}

async function analyzePdfWithOpenAi({ openAiKey, fileUrl, fileRecord }) {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: buildPrompt(fileRecord) },
            {
              type: "input_file",
              file_url: fileUrl,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "credit_report_analysis",
          strict: true,
          schema: CREDIT_REPORT_ANALYSIS_SCHEMA,
        },
      },
    }),
  });

  const rawText = await response.text();
  const data = parseMaybeJson(rawText);

  if (!response.ok) {
    const code = String(data?.error?.code || data?.code || "").toLowerCase();
    const message = String(data?.error?.message || data?.message || rawText || "OpenAI request failed.");
    const combined = `${code} ${message}`.toLowerCase();

    if (
      code === "insufficient_quota" ||
      combined.includes("insufficient quota") ||
      combined.includes("check your plan and billing details")
    ) {
      throw buildApiError(
        "The OpenAI API key for this deployment has no active API billing or quota. Add billing/credits in OpenAI Platform, then retry.",
        503,
        "openai_insufficient_quota"
      );
    }

    if (response.status === 401) {
      throw buildApiError(
        "OPENAI_API_KEY is missing, invalid, or not authorized for this project.",
        500,
        "openai_auth"
      );
    }

    if (response.status === 429) {
      throw buildApiError(
        "OpenAI rate limit reached for this API key. Wait a minute and retry.",
        429,
        "openai_rate_limit"
      );
    }

    throw buildApiError(message, response.status || 500, code || "openai_request_failed");
  }

  const outputText = extractResponseText(data);
  if (!outputText) {
    throw new Error("OpenAI did not return structured analysis text.");
  }

  return {
    model: data?.model || DEFAULT_MODEL,
    analysis: JSON.parse(outputText),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !serviceRoleKey || !openAiKey) {
    json(res, 500, {
      error:
        "Server not configured. Add SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and OPENAI_API_KEY.",
    });
    return;
  }

  const authHeader = String(req.headers.authorization || "");
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!accessToken) {
    json(res, 401, { error: "Missing authorization token." });
    return;
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    json(res, 400, { error: "Invalid request body." });
    return;
  }

  const fileId = Number(body?.fileId || 0);
  if (!fileId) {
    json(res, 400, { error: "fileId is required." });
    return;
  }

  try {
    const user = await identifySupabaseUser({ supabaseUrl, serviceRoleKey, accessToken });
    await requireAdmin({ supabaseUrl, serviceRoleKey, userId: user.id });

    const fileRecord = await loadClientFile({ supabaseUrl, serviceRoleKey, fileId });
    if (!fileRecord) {
      json(res, 404, { error: "Uploaded file record not found." });
      return;
    }

    const isPdf =
      String(fileRecord.content_type || "").toLowerCase() === "application/pdf" ||
      /\.pdf$/i.test(String(fileRecord.file_name || ""));
    if (!isPdf) {
      json(res, 400, { error: "AI verification only accepts PDF credit reports." });
      return;
    }

    if (Number(fileRecord.file_size || 0) > MAX_AI_FILE_SIZE_BYTES) {
      json(res, 400, {
        error: "AI verification only supports PDFs up to 45MB.",
      });
      return;
    }

    const fileUrl = await createSignedStorageUrl({
      supabaseUrl,
      serviceRoleKey,
      bucket: fileRecord.bucket || "client-docs",
      filePath: fileRecord.file_path,
    });

    const { model, analysis } = await analyzePdfWithOpenAi({
      openAiKey,
      fileUrl,
      fileRecord,
    });

    json(res, 200, {
      ok: true,
      model,
      document: analysis.document,
      negative_items: Array.isArray(analysis.negative_items) ? analysis.negative_items : [],
    });
  } catch (error) {
    const message = String(error?.message || error || "Unknown error");
    const status =
      Number(error?.statusCode) ||
      (message === "Unauthorized."
        ? 401
        : message === "Forbidden."
          ? 403
          : 500);
    json(res, status, { error: message, code: error?.code || "" });
  }
}
