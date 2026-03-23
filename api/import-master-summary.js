export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !serviceRoleKey || !anthropicKey) {
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

  let rawText = "";
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_IMPORT_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: 7000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: pdfBase64,
                },
              },
              {
                type: "text",
                text: prompt,
              },
            ],
          },
        ],
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error?.message || "Anthropic API error.");
    }

    rawText = data.content?.find((b) => b.type === "text")?.text?.trim() || "";
  } catch (error) {
    res.status(500).json({ error: error.message || "Anthropic API error." });
    return;
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
