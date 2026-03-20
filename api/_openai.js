const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export function getOpenAiKey() {
  return process.env.OPENAI_API_KEY;
}

export function getLetterModel() {
  return process.env.OPENAI_LETTER_MODEL || "gpt-5.2-chat-latest";
}

export function getImportModel() {
  return process.env.OPENAI_IMPORT_MODEL || process.env.OPENAI_LETTER_MODEL || "gpt-5-mini";
}

export async function createOpenAIResponse({
  apiKey,
  model,
  input,
  instructions,
  maxOutputTokens,
  text,
  reasoning,
}) {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input,
      instructions,
      max_output_tokens: maxOutputTokens,
      text,
      reasoning,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error?.message || "OpenAI API error.");
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export function extractOutputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const outputItems = Array.isArray(data?.output) ? data.output : [];

  return outputItems
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .filter((content) => content?.type === "output_text" && typeof content.text === "string")
    .map((content) => content.text)
    .join("")
    .trim();
}
