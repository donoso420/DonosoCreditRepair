import { createOpenAIResponse, extractOutputText, getImportModel, getOpenAiKey } from "./_openai.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openAiKey = getOpenAiKey();
  const openAiModel = getImportModel();

  if (!supabaseUrl || !serviceRoleKey || !openAiKey) {
    res.status(500).json({ error: "Server not configured. Check Vercel environment variables." });
    return;
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    res.status(400).json({ error: "Invalid request body." });
    return;
  }

  const { userId, pdfBase64 } = body || {};

  if (!userId) {
    res.status(400).json({ error: "userId is required." });
    return;
  }
  if (!pdfBase64) {
    res.status(400).json({ error: "pdfBase64 is required." });
    return;
  }

  const prompt = `You are a credit repair data extraction assistant. I am uploading a credit dispute document — it may be a Credit Dispute Master Summary, a credit report analysis, or a similar document.

Extract EVERY dispute item found in this document. This includes ALL of the following:
- Collections, Charge-Offs, Late Payments, Repossessions, Bankruptcies, Foreclosures, Judgments, Liens
- Hard Inquiries
- Name discrepancies, address errors, personal information errors (use creditor = "EQUIFAX" / "EXPERIAN" / "TRANSUNION" for bureau-level personal info disputes)
- Any other negative or disputed item mentioned

Return ONLY a valid JSON object with this exact shape:
{
  "items": [ ... ]
}

No explanation, no markdown, no code fences — just the raw JSON object.

Each item must have these exact fields:
- creditor: string (creditor, furnisher, or bureau name — never null)
- item_type: string — must be one of: "Collection", "Charge Off", "Late Payment", "Hard Inquiry", "Repossession", "Bankruptcy", "Foreclosure", "Judgment", "Lien", "Name Discrepancy", "Address Error", "Personal Info Error", "Derogatory", "Negative Item"
- bureau: string — one of: "ALL_BUREAUS", "Experian", "Equifax", "TransUnion", "Equifax,TransUnion", "Experian,TransUnion", "Experian,Equifax"
- account_reference: string (account number if available) or null
- balance: number or null (numeric only, no $ sign)
- status: string (e.g. "Charge-Off", "Legal Name Mismatch", "Involuntary Repossession")
- fcra_laws: string (all FCRA/FDCPA sections cited)
- dispute_issue: string (brief description of the specific dispute issue)
- recommended_action: string (recommended action from the document)
- notes: string or null

For items on all 3 bureaus set bureau to "ALL_BUREAUS". For specific bureau combinations use comma-separated values.

Return only the JSON object, nothing else.`;

  // Upload PDF to OpenAI Files API first, then reference by file_id
  let uploadedFileId;
  try {
    const pdfBytes = Buffer.from(pdfBase64, "base64");
    const formData = new FormData();
    formData.append("purpose", "user_data");
    formData.append(
      "file",
      new Blob([pdfBytes], { type: "application/pdf" }),
      "credit-dispute-summary.pdf"
    );
    const uploadRes = await fetch("https://api.openai.com/v1/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${openAiKey}` },
      body: formData,
    });
    const uploadData = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok) {
      throw new Error(uploadData.error?.message || "File upload failed.");
    }
    uploadedFileId = uploadData.id;
  } catch (error) {
    res.status(500).json({ error: "PDF upload failed: " + (error.message || "Unknown error.") });
    return;
  }

  let rawText = "";
  try {
    const openAiData = await createOpenAIResponse({
      apiKey: openAiKey,
      model: openAiModel,
      maxOutputTokens: 7000,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_file",
              file_id: uploadedFileId,
            },
            {
              type: "input_text",
              text: prompt,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "credit_dispute_items",
          strict: true,
          schema: {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    creditor: { type: "string" },
                    item_type: {
                      type: "string",
                      enum: [
                        "Collection",
                        "Charge Off",
                        "Late Payment",
                        "Hard Inquiry",
                        "Repossession",
                        "Bankruptcy",
                        "Foreclosure",
                        "Judgment",
                        "Lien",
                        "Name Discrepancy",
                        "Address Error",
                        "Personal Info Error",
                        "Derogatory",
                        "Negative Item",
                      ],
                    },
                    bureau: {
                      type: "string",
                      enum: [
                        "ALL_BUREAUS",
                        "Experian",
                        "Equifax",
                        "TransUnion",
                        "Equifax,TransUnion",
                        "Experian,TransUnion",
                        "Experian,Equifax",
                      ],
                    },
                    account_reference: { type: ["string", "null"] },
                    balance: { type: ["number", "null"] },
                    status: { type: "string" },
                    fcra_laws: { type: "string" },
                    dispute_issue: { type: "string" },
                    recommended_action: { type: "string" },
                    notes: { type: ["string", "null"] },
                  },
                  required: [
                    "creditor",
                    "item_type",
                    "bureau",
                    "account_reference",
                    "balance",
                    "status",
                    "fcra_laws",
                    "dispute_issue",
                    "recommended_action",
                    "notes",
                  ],
                  additionalProperties: false,
                },
              },
            },
            required: ["items"],
            additionalProperties: false,
          },
        },
      },
    });
    rawText = extractOutputText(openAiData);
  } catch (error) {
    // Clean up uploaded file before returning error
    if (uploadedFileId) {
      fetch(`https://api.openai.com/v1/files/${uploadedFileId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${openAiKey}` },
      }).catch(() => {});
    }
    res.status(500).json({ error: error.message || "OpenAI API error." });
    return;
  }

  // Clean up uploaded file (fire and forget)
  if (uploadedFileId) {
    fetch(`https://api.openai.com/v1/files/${uploadedFileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${openAiKey}` },
    }).catch(() => {});
  }

  let items;
  try {
    // Strip markdown fences
    let cleaned = rawText.replace(/```json|```/g, "").trim();
    // Extract just the JSON array if there's surrounding text
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) cleaned = arrayMatch[0];
    // Attempt full parse first
    try {
      items = JSON.parse(cleaned);
    } catch {
      // Try to recover truncated JSON — remove last incomplete object and close array
      const recovered = cleaned
        .replace(/,\s*\{[^}]*$/, "")  // remove last incomplete object
        .replace(/,\s*$/, "")          // remove trailing comma
        + "]";
      try {
        items = JSON.parse(recovered);
      } catch {
        // Last resort — try removing everything after last complete }
        const lastBrace = cleaned.lastIndexOf("}");
        if (lastBrace !== -1) {
          items = JSON.parse(cleaned.slice(0, lastBrace + 1) + "]");
        } else {
          throw new Error("Unrecoverable JSON");
        }
      }
    }
    if (!Array.isArray(items)) {
      items = Array.isArray(items?.items) ? items.items : null;
    }
    if (!Array.isArray(items) || items.length === 0) throw new Error("Empty or invalid array");
  } catch (e) {
    res.status(500).json({
      error: "Could not parse items from PDF. Raw: " + rawText.slice(0, 600),
      detail: e.message
    });
    return;
  }

  // Expand multi-bureau items into individual rows
  const BUREAU_MAP = {
    ALL_BUREAUS: ["Experian", "Equifax", "TransUnion"],
    "Equifax,TransUnion": ["Equifax", "TransUnion"],
    "Experian,Equifax": ["Experian", "Equifax"],
    "Experian,TransUnion": ["Experian", "TransUnion"],
  };

  const rows = [];
  for (const item of items) {
    const bureaus = BUREAU_MAP[item.bureau] || [item.bureau || "Shared / Unknown"];
    for (const bureau of bureaus) {
      const creditor = String(item.creditor || "").trim();
      const itemType = String(item.item_type || "Negative Item").trim();
      const acctRef = String(item.account_reference || "").trim();
      const bureauNorm = bureau.trim();

      // Build fingerprint (same logic as frontend)
      const fp = [
        bureauNorm.toLowerCase(),
        creditor.toLowerCase(),
        itemType.toLowerCase(),
        acctRef.toLowerCase(),
      ]
        .join("|")
        .replace(/\s+/g, " ")
        .trim();

      rows.push({
        user_id: userId,
        bureau: bureauNorm,
        creditor,
        item_type: itemType,
        account_reference: acctRef || null,
        balance: item.balance != null && item.balance !== "" ? Number(item.balance) : null,
        status: String(item.status || "").trim() || null,
        fcra_laws: String(item.fcra_laws || "").trim() || null,
        dispute_issue: String(item.dispute_issue || "").trim() || null,
        recommended_action: String(item.recommended_action || "").trim() || null,
        notes: String(item.notes || "").trim() || null,
        is_active: true,
        source: "manual",
        verification_method: "manual",
        verification_notes: "Imported from Credit Dispute Master Summary PDF.",
        fingerprint: fp,
      });
    }
  }

  if (!rows.length) {
    res.status(200).json({ imported: 0, message: "No items found in PDF." });
    return;
  }

  // Deduplicate rows within the batch — keep last occurrence of each fingerprint
  const seen = new Map();
  for (const row of rows) {
    seen.set(row.fingerprint, row);
  }
  const dedupedRows = Array.from(seen.values());

  // Upsert into Supabase — on_conflict tells PostgREST which unique constraint to use
  const upsertRes = await fetch(
    `${supabaseUrl}/rest/v1/negative_items?on_conflict=user_id,fingerprint`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(dedupedRows),
    }
  );

  if (!upsertRes.ok) {
    const errText = await upsertRes.text().catch(() => "");
    res.status(500).json({ error: "Could not save items to database: " + errText.slice(0, 200) });
    return;
  }

  res.status(200).json({
    imported: dedupedRows.length,
    message: `Successfully imported ${dedupedRows.length} negative item rows from the PDF.`,
  });
}
