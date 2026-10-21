export type GroqMessage = { role: "system" | "user" | "assistant"; content: string };

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export function getGroqKey(request: Request): string | null {
  const fromEnv = process.env.GROQ_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const fromHeader = request.headers.get("x-groq-api-key")?.trim();
  return fromHeader || null;
}

export function getModel(): string {
  return process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b";
}

export async function groqChat(
  request: Request,
  messages: GroqMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const apiKey = getGroqKey(request);
  if (!apiKey) throw new Error("Missing Groq API key. Set GROQ_API_KEY in .env.local or enter one in the game settings.");

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getModel(),
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 512,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Groq returned an empty response.");
  }
  return content;
}

export function parseJson<T>(content: string): T {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // salvage the first JSON object in the text
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    }
    throw new Error("Could not parse JSON from model output.");
  }
}
