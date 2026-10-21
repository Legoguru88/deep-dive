import { NextRequest, NextResponse } from "next/server";
import { groqChat, parseJson } from "@/lib/groq";

type PromptsResponse = { prompts: string[] };

const FORBIDDEN_TERMS = [
  "popular",
  "common",
  "most",
  "favorite",
  "favourite",
  "famous",
  "best",
  "trending",
  "typical",
  "usual",
  "standard",
  "go-to",
  "mainstream",
];

const BANNED_QUESTIONS = [
  "Name a popular fruit",
  "Name a common pet",
  "Name the most common bird",
  "Name a famous movie",
  "Name a common drink",
  "Name an animal everyone knows",
  "Name a typical breakfast food",
  "Name a mainstream sport",
  "Name the best country to visit",
  "Name a standard job",
];

const SAFE_FALLBACK_PROMPTS = [
  "Name a fruit that grows on a tree",
  "Name a bird that lives in the city",
  "Name a country in Europe",
  "Name a movie with a one-word title",
  "Name a sport played without a ball",
  "Name an animal that can swim",
  "Name a blue flower",
  "Name a hot beverage",
  "Name a two-wheeled vehicle",
  "Name a type of pasta",
];


export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const count = Math.min(Math.max(Number(body?.count) || 10, 1), 12);
    const recent = Array.isArray(body?.recent)
      ? body.recent.map((x: unknown) => String(x).trim()).filter(Boolean).slice(-40)
      : [];
    const combinedAvoid = [...new Set([...recent, ...BANNED_QUESTIONS])];

    let prompts: string[] | null = null;
    for (let attempt = 0; attempt < 3 && !prompts; attempt++) {
      try {
        const content = await groqChat(request, [
          {
            role: "system",
            content: `You generate prompts for a Krillion-style rarity game. Each prompt is open-ended and has hundreds of valid answers. Prompts should be EASY and everyday: things any adult knows, with obvious common answers and lots of possible specific ones. Avoid obscure trivia, technical jargon, and closed lists.

Return strict JSON: {"prompts":["..."]}

Rules:
- Prompts must be of the form "Name a ..." or "Give a ...".
- Use simple, familiar categories: foods, colors, animals, jobs, sports, movies, places, drinks, clothes, weather, rooms, vehicles, etc.
- Avoid prompts with fewer than ~30 obvious valid answers.
- Avoid yes/no questions.
- NEVER ask "most common", "most popular", "most famous", "name the best", "most typical", "usual", "standard", "mainstream", "trending", or any variation that asks for something popular or common. Do not include those words.
- Do not repeat or closely resemble any prompt in the provided avoid list (same category, wording, or answer space).
- Avoid these exact-ish banned examples and similar variants: ${BANNED_QUESTIONS.join(" | ")}.
- Keep each prompt short and unambiguous.
- Do not include duplicates.
- Do not reveal answers or tiers.`,
          },
          {
            role: "user",
            content: `Generate ${count} fresh prompts. Avoid repeating, resembling, or varying these: ${combinedAvoid.length ? combinedAvoid.join(" | ") : "none"}.`,
          },
        ], { temperature: 0.9, maxTokens: 1200 });

        const parsed = parseJson<PromptsResponse>(content);
        if (Array.isArray(parsed?.prompts) && parsed.prompts.length > 0) {
          const badLower = (q: string) => {
            const l = q.toLowerCase();
            return FORBIDDEN_TERMS.some((t) => l.includes(t)) || combinedAvoid.some((a) => l === a.toLowerCase());
          };
          const filtered = parsed.prompts.filter((q) => !badLower(String(q)));
          const unique = filtered.filter((q, i, arr) => arr.findIndex((x) => String(x).toLowerCase() === String(q).toLowerCase()) === i);
          if (unique.length > 0) prompts = unique.slice(0, count);
        }
      } catch {
        // retry
      }
    }

    if (!prompts) {
      prompts = SAFE_FALLBACK_PROMPTS.slice(0, count);
    } else if (prompts.length < count) {
      const existing = new Set(prompts.map((p) => String(p).toLowerCase()));
      for (const fb of SAFE_FALLBACK_PROMPTS) {
        if (prompts.length >= count) break;
        if (existing.has(fb.toLowerCase())) continue;
        if (combinedAvoid.some((a) => a.toLowerCase() === fb.toLowerCase())) continue;
        prompts.push(fb);
        existing.add(fb.toLowerCase());
      }
    }

    return NextResponse.json({ prompts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
