# 🐙 Deep Dive

A Krillion-style rarity game, powered by the [Groq API](https://console.groq.com/).

Every prompt is open-ended — *"Name a red fruit"*, *"Name a bird that lives in the city"*. There is no single right answer. The judge estimates how common your answer would be among typical players, and scores it accordingly. **The rarer your answer, the deeper you sink and the higher you score.**

## How it works

- A session is **10 questions**, 25 seconds each.
- Groq generates the prompts and acts as the rarity judge.
- Answers are autocorrected to the closest valid answer, and a bad answer doesn't burn the question — you can retry until the clock runs out.
- Points are weighted hard toward rarity: `1 point = 10 metres`, and a perfect session reaches the **10,000 m Trench Floor**.
- At the end of a session you get a full breakdown: your answer, your tier, and the **top 3 rarest answers** for every question.
- Prompts are never repeated across sessions, and the AI is told to avoid "most common / most popular" style questions.

## Scoring

| Tier | Points | Depth |
| --- | --- | --- |
| Plankton | 5 | 50 m |
| Too Clever | 10 | 100 m |
| Schooler | 20 | 200 m |
| Rare | 55 | 550 m |
| Deep Cut | 90 | 900 m |
| One in a Krillion | 100 | 1,000 m |

Tune the curve in [`src/lib/scoring.ts`](src/lib/scoring.ts) — tier points, metres per point, and session length all live there and are shared by the UI and the API.

## Getting started

```bash
npm install
cp .env.local.example .env.local
# add your Groq API key to .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

You can also skip the env file and paste your Groq key into the game UI — it's stored only in your browser's local storage.

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `GROQ_API_KEY` | yes* | Your Groq API key. |
| `GROQ_MODEL` | no | Model to use (default `openai/gpt-oss-20b`). |

\* Only required if you don't paste a key into the UI.

## Tech

- [Next.js 16](https://nextjs.org) (App Router) + React 19 + TypeScript
- [Tailwind CSS 4](https://tailwindcss.com)
- [Groq](https://groq.com) for prompt generation, rarity judging and answer ladders

## API routes

| Route | Purpose |
| --- | --- |
| `GET /api/config` | Reports whether a server-side key is configured. |
| `POST /api/prompts` | Generates a batch of prompts, avoiding any previously used ones. |
| `POST /api/judge` | Validates an answer, autocorrects it and assigns a tier. |
| `POST /api/ladder` | Returns the 3 rarest answers for a set of prompts. |
