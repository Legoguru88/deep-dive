import { NextRequest, NextResponse } from "next/server";
import { groqChat, parseJson } from "@/lib/groq";
import { POINTS_TO_METERS, TIER_POINTS } from "@/lib/scoring";



type JudgeResponse = {
  valid: boolean;
  tier?: string;
  reason?: string;
  correctedAnswer?: string | null;
  suggestion?: string | null;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const prompt = String(body?.prompt ?? "").trim();
    const answer = String(body?.answer ?? "").trim();

    if (!prompt) {
      return NextResponse.json({ error: "Missing prompt." }, { status: 400 });
    }

    if (!answer) {
      return NextResponse.json({
        valid: false,
        tier: null,
        points: 0,
        depth: 0,
        reason: "No answer submitted.",
      });
    }

    let parsed: JudgeResponse | null = null;
    for (let attempt = 0; attempt < 3 && !parsed; attempt++) {
      try {
        const content = await groqChat(request, [
          {
            role: "system",
            content: `You are the rarity judge for a Krillion-style word game. A prompt is open-ended. The player types one answer. You decide whether it is valid, then estimate how common it would be among typical players.

Return strict JSON with these fields:
{"valid":boolean,"tier":string|null,"reason":string,"correctedAnswer":string|null,"suggestion":string|null}

If valid is false, tier must be null.
If valid is true, tier must be exactly one of:
- "Plankton": the first obvious answer almost everyone gives.
- "Too Clever": the common "clever" swerve many players reach for.
- "Schooler": a somewhat common answer.
- "Rare": an uncommon answer.
- "Deep Cut": a very uncommon, specific, or niche answer.
- "One in a Krillion": an answer almost nobody gives but still valid.

Scoring is by familiarity among typical players, not by how smart the answer sounds. Specific varieties, regional names, full titles, technical terms, and edge cases usually score higher than umbrella terms.

Validity rules:
- The answer must genuinely satisfy the prompt.
- Reject nonsense, wrong category, misspellings that change meaning, and answers that only loosely fit.
- Only reject answers that clearly do not fit the prompt. If it plausibly fits, accept it.
- AUTOCORRECT: If the typed answer is a misspelling, abbreviation, plural/singular variant, or otherwise close to a valid answer for the prompt, treat it as that closest valid answer: set valid=true, correctedAnswer to that valid answer, and score that answer. Explain briefly in reason. If no close valid answer exists, set valid=false, correctedAnswer=null, and suggestion to the closest plausible valid answer (or null).

Calibration examples (prompt -> answer -> tier):
"Name a red fruit" -> "apple" -> Plankton
"Name a red fruit" -> "strawberry" -> Schooler
"Name a red fruit" -> "blood orange" -> Rare
"Name a red fruit" -> "acerola" -> Deep Cut
"Name a bird" -> "eagle" -> Plankton
"Name a bird" -> "potoo" -> One in a Krillion
"Name a country" -> "France" -> Plankton
"Name a country" -> "Liechtenstein" -> Rare

Keep reason under 20 words.`,
          },
          {
            role: "user",
            content: `Prompt: ${prompt}\nAnswer: ${answer}`,
          },
        ], { temperature: 0.1, maxTokens: 800 });
        const candidate = parseJson<JudgeResponse>(content);
        if (typeof candidate?.valid === "boolean") {
          parsed = candidate;
        } else {
          throw new Error("Malformed judge JSON.");
        }
      } catch {
        // retry
      }
    }

    if (!parsed) {
      return NextResponse.json({
        valid: false,
        tier: null,
        points: 0,
        depth: 0,
        reason: "Judge unavailable; please try again.",
        correctedAnswer: null,
        suggestion: null,
      });
    }

    const tier = typeof parsed.tier === "string" && TIER_POINTS[parsed.tier] ? parsed.tier : null;
    const valid = parsed.valid === true && tier !== null;

    const correctedAnswer =
      typeof parsed.correctedAnswer === "string" && parsed.correctedAnswer.trim()
        ? parsed.correctedAnswer.trim()
        : valid
        ? answer
        : null;
    const suggestion =
      typeof parsed.suggestion === "string" && parsed.suggestion.trim()
        ? parsed.suggestion.trim()
        : null;

    if (!valid) {
      return NextResponse.json({
        valid: false,
        tier: null,
        points: 0,
        depth: 0,
        reason: parsed.reason || "Invalid answer.",
        correctedAnswer: null,
        suggestion,
      });
    }

    const points = TIER_POINTS[tier!];
    return NextResponse.json({
      valid: true,
      tier,
      points,
      depth: points * POINTS_TO_METERS,
      reason: parsed.reason || "",
      correctedAnswer,
      suggestion: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
