import { NextRequest, NextResponse } from "next/server";
import { groqChat, parseJson } from "@/lib/groq";
import { TIER_POINTS } from "@/lib/scoring";

type LadderResponse = {
  answers: { answer?: string; tier?: string }[];
};

const TIER_NAMES = Object.keys(TIER_POINTS);

const LADDER_SYSTEM = `You list the rarest valid answers for an open-ended prompt in a Krillion-style rarity game.

Return strict JSON: {"answers":[{"answer":"...","tier":"..."}]}

Rules:
- Give exactly 3 answers that are genuinely valid for the prompt.
- Order them from rarest to most common.
- "tier" must be exactly one of: ${TIER_NAMES.map((t) => `"${t}"`).join(", ")}.
- Prefer specific names, varieties, regional terms, technical terms, and edge cases over umbrella terms.
- Never repeat the same answer twice.`;

async function ladderFor(request: NextRequest, prompt: string) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const nudge =
        attempt === 0
          ? ""
          : " You must return exactly 3 distinct answers that are all valid for the prompt.";

      const content = await groqChat(
        request,
        [
          { role: "system", content: LADDER_SYSTEM },
          { role: "user", content: `Prompt: ${prompt}${nudge}` },
        ],
        { temperature: 0.7, maxTokens: 900 }
      );

      const parsed = parseJson<LadderResponse>(content);
      const answers = (parsed.answers ?? [])
        .filter((a) => typeof a.answer === "string" && a.answer.trim())
        .map((a) => ({
          answer: a.answer!.trim(),
          tier:
            typeof a.tier === "string" && TIER_POINTS[a.tier] ? a.tier : "Deep Cut",
        }))
        .slice(0, 3);

      if (answers.length >= 3) return { prompt, answers };
      if (answers.length > 0 && attempt === 2) return { prompt, answers };
      throw new Error("Not enough ladder answers returned.");
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Ladder request failed.");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const prompts = Array.isArray(body?.prompts)
      ? body.prompts.map((p: unknown) => String(p).trim()).filter(Boolean).slice(0, 12)
      : [];

    if (prompts.length === 0) {
      return NextResponse.json({ ladders: [] });
    }

    const settled = await Promise.allSettled(prompts.map((p: string) => ladderFor(request, p)));
    for (const r of settled) {
      if (r.status === "rejected") {
        console.error("[ladder] failed:", r.reason instanceof Error ? r.reason.message : r.reason);
      }
    }
    const ladders = settled
      .filter((r): r is PromiseFulfilledResult<{ prompt: string; answers: { answer: string; tier: string }[] }> => r.status === "fulfilled")
      .map((r) => r.value)
      .filter((l) => l.answers.length > 0);

    return NextResponse.json({ ladders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
