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

function response(statusCode, body) {
  return {
    statusCode,
    body: JSON.stringify(body),
  };
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
  const result = await fetch(`${base}${path}`, {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });

  const rawText = await result.text();
  const data = parseMaybeJson(rawText);

  if (!result.ok) {
    throw new Error(formatSupabaseError(result.status, data, rawText));
  }

  return data;
}

async function identifySupabaseUser({ supabaseUrl, serviceRoleKey, accessToken }) {
  const result = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY || serviceRoleKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const rawText = await result.text();
  const data = parseMaybeJson(rawText);

  if (!result.ok || !data?.id) {
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
  const result = await fetch(
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

  const rawText = await result.text();
  const data = parseMaybeJson(rawText);
  if (!result.ok || !(data?.signedURL || data?.signedUrl)) {
    throw new Error(`Could not sign the uploaded PDF: ${rawText || result.status}`);
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
  const result = await fetch(OPENAI_RESPONSES_URL, {
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

  const rawText = await result.text();
  const data = parseMaybeJson(rawText);

  if (!result.ok) {
    const message =
      data?.error?.message || data?.message || rawText || "OpenAI request failed.";
    throw new Error(String(message));
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

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") {
    return response(405, { error: "Method not allowed" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !serviceRoleKey || !openAiKey) {
    return response(500, {
      error:
        "Server not configured. Add SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and OPENAI_API_KEY.",
    });
  }

  const authHeader = String(event.headers.authorization || event.headers.Authorization || "");
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!accessToken) {
    return response(401, { error: "Missing authorization token." });
  }

  const body = parseMaybeJson(event.body);
  const fileId = Number(body?.fileId || 0);
  if (!fileId) {
    return response(400, { error: "fileId is required." });
  }

  try {
    const user = await identifySupabaseUser({ supabaseUrl, serviceRoleKey, accessToken });
    await requireAdmin({ supabaseUrl, serviceRoleKey, userId: user.id });

    const fileRecord = await loadClientFile({ supabaseUrl, serviceRoleKey, fileId });
    if (!fileRecord) {
      return response(404, { error: "Uploaded file record not found." });
    }

    const isPdf =
      String(fileRecord.content_type || "").toLowerCase() === "application/pdf" ||
      /\.pdf$/i.test(String(fileRecord.file_name || ""));
    if (!isPdf) {
      return response(400, { error: "AI verification only accepts PDF credit reports." });
    }

    if (Number(fileRecord.file_size || 0) > MAX_AI_FILE_SIZE_BYTES) {
      return response(400, { error: "AI verification only supports PDFs up to 45MB." });
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

    return response(200, {
      ok: true,
      model,
      document: analysis.document,
      negative_items: Array.isArray(analysis.negative_items) ? analysis.negative_items : [],
    });
  } catch (error) {
    const message = String(error?.message || error || "Unknown error");
    const statusCode =
      message === "Unauthorized."
        ? 401
        : message === "Forbidden."
          ? 403
          : 500;
    return response(statusCode, { error: message });
  }
};
