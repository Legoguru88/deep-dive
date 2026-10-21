"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_DEPTH,
  POINTS_TO_METERS,
  SESSION_LENGTH,
  TIER_ORDER,
  TIER_POINTS,
  zoneFor,
} from "@/lib/scoring";


type JudgeResult = {
  valid: boolean;
  tier: string | null;
  points: number;
  depth: number;
  reason: string;
  correctedAnswer?: string | null;
  suggestion?: string | null;
};

type DiveAnswer = {
  prompt: string;
  answer: string;
  result: JudgeResult;
};

const TIER_META: Record<string, { color: string; glow: string; label: string }> = {
  Plankton: { color: "#94a3b8", glow: "rgba(148,163,184,0.5)", label: "Plankton" },
  "Too Clever": { color: "#f59e0b", glow: "rgba(245,158,11,0.5)", label: "Too Clever" },
  Schooler: { color: "#38bdf8", glow: "rgba(56,189,248,0.5)", label: "Schooler" },
  Rare: { color: "#34d399", glow: "rgba(52,211,153,0.5)", label: "Rare" },
  "Deep Cut": { color: "#a78bfa", glow: "rgba(167,139,250,0.5)", label: "Deep Cut" },
  "One in a Krillion": { color: "#f472b6", glow: "rgba(244,114,182,0.6)", label: "One in a Krillion" },
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export default function Home() {
  const [config, setConfig] = useState<{ hasServerKey: boolean; model: string } | null>(null);
  const [apiKey, setApiKey] = useState(() =>
    typeof window === "undefined" ? "" : localStorage.getItem("groq_api_key") ?? ""
  );
  const [view, setView] = useState<"start" | "playing" | "finished">("start");
  const [prompts, setPrompts] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<DiveAnswer[]>([]);
  const [totalDepth, setTotalDepth] = useState(0);
  const [currentAnswer, setCurrentAnswer] = useState("");
  useEffect(() => {
    currentAnswerRef.current = currentAnswer;
  }, [currentAnswer]);
  const [phase, setPhase] = useState<"answering" | "judging" | "result">("answering");
  const [timeLeft, setTimeLeft] = useState(25);
  const [lastResult, setLastResult] = useState<JudgeResult | null>(null);
  const [loadingPrompts, setLoadingPrompts] = useState(false);
  const [judgeError, setJudgeError] = useState<string | null>(null);
  const [invalidMessage, setInvalidMessage] = useState<string | null>(null);
  const [ladders, setLadders] = useState<
    { prompt: string; answers: { answer: string; tier: string }[] }[]
  >([]);
  const [laddersLoading, setLaddersLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const submittingRef = useRef(false);
  const currentAnswerRef = useRef("");

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => setConfig(d))
      .catch(() => setConfig({ hasServerKey: false, model: "openai/gpt-oss-20b" }));
  }, []);

  useEffect(() => {
    if (apiKey) localStorage.setItem("groq_api_key", apiKey);
  }, [apiKey]);

  const answerHeaders = useCallback((): HeadersInit => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey.trim()) h["x-groq-api-key"] = apiKey.trim();
    return h;
  }, [apiKey]);

  // fetch the 3 rarest answers for every question once the session ends
  useEffect(() => {
    if (view !== "finished" || prompts.length === 0) return;
    if (ladders.length > 0) return;
    const timer = setTimeout(() => {
      setLaddersLoading(true);
      fetch("/api/ladder", {
        method: "POST",
        headers: answerHeaders(),
        body: JSON.stringify({ prompts }),
      })
        .then((r) => r.json())
        .then((d) => setLadders(Array.isArray(d?.ladders) ? d.ladders : []))
        .catch(() => setLadders([]))
        .finally(() => setLaddersLoading(false));
    }, 0);
    return () => clearTimeout(timer);
  }, [view, prompts, ladders.length, answerHeaders]);

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startDive = async () => {
    if (!config?.hasServerKey && !apiKey.trim()) {
      setJudgeError("A Groq API key is required. Enter one above.");
      return;
    }
    setLoadingPrompts(true);
    setJudgeError(null);
    try {
      let askedHistory: string[] = [];
      try {
        const raw = localStorage.getItem("dd_asked_prompts");
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) askedHistory = parsed.map(String).slice(-80);
      } catch {
        askedHistory = [];
      }

      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: answerHeaders(),
        body: JSON.stringify({ count: SESSION_LENGTH, recent: askedHistory }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to generate prompts.");
      setPrompts(data.prompts);
      try {
        const merged = [...askedHistory, ...data.prompts].slice(-80);
        localStorage.setItem("dd_asked_prompts", JSON.stringify(merged));
      } catch {
        // ignore storage errors
      }
      setAnswers([]);
      setTotalDepth(0);
      setIndex(0);
      setCurrentAnswer("");
      setLastResult(null);
      setInvalidMessage(null);
      setJudgeError(null);
      setTimeLeft(25);
      setPhase("answering");
      setView("playing");
    } catch (e) {
      setJudgeError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoadingPrompts(false);
    }
  };

  const submitAnswer = useCallback(async (timeout: boolean) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    clearTimer();

    const answer = timeout ? "" : currentAnswerRef.current.trim();
    setPhase("judging");
    setJudgeError(null);
    setInvalidMessage(null);

    try {
      const res = await fetch("/api/judge", {
        method: "POST",
        headers: answerHeaders(),
        body: JSON.stringify({ prompt: prompts[index], answer }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Judging failed.");

      const result: JudgeResult = {
        valid: Boolean(data.valid),
        tier: data.tier ?? null,
        points: Number(data.points ?? 0),
        depth: Number(data.depth ?? 0),
        reason: String(data.reason ?? ""),
        correctedAnswer: data.correctedAnswer ?? null,
        suggestion: data.suggestion ?? null,
      };

      if (!result.valid && !timeout && answer) {
        // Invalid attempt: the player keeps the prompt and can try again.
        setInvalidMessage(
          result.suggestion
            ? `Answer was invalid. Closest answer: ${result.suggestion}`
            : "Answer was invalid"
        );
        setPhase("answering");
        return;
      }

      setLastResult(result);
      setAnswers((prev) => [
        ...prev,
        { prompt: prompts[index], answer: answer || "(no answer)", result },
      ]);
      setTotalDepth((d) => d + result.depth);
      setPhase("result");
    } catch (e) {
      setJudgeError(e instanceof Error ? e.message : "Unknown error");
      setPhase("answering");
    } finally {
      submittingRef.current = false;
    }
  }, [answerHeaders, index, prompts]);

  // timer
  useEffect(() => {
    if (view !== "playing" || phase !== "answering") return;
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearTimer();
          submitAnswer(true);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearTimer();
  }, [view, phase, index, prompts, submitAnswer]);

  const handleNext = () => {
    if (index + 1 >= prompts.length) {
      setView("finished");
      return;
    }
    setIndex((i) => i + 1);
    setCurrentAnswer("");
    setLastResult(null);
    setPhase("answering");
    setTimeLeft(25);
  };

  const markerTop = clamp((totalDepth / MAX_DEPTH) * 100, 0, 100);

  if (view === "start") {
    return (
      <main className="min-h-screen relative overflow-hidden">
        <OceanBackground depth={0} />
        <div className="relative z-10 max-w-3xl mx-auto px-6 py-16">
          <div className="text-center mb-10">
            <div className="text-6xl mb-4">🐙</div>
            <h1 className="text-5xl font-black tracking-tight bg-gradient-to-b from-cyan-200 to-blue-400 bg-clip-text text-transparent">
              Deep Dive
            </h1>
            <p className="text-cyan-100/70 mt-3 text-lg">
              A Krillion-style rarity game, powered by Groq.
            </p>
            <p className="text-cyan-100/50 mt-1 text-sm">
              Name the rarest valid answer. Common floats, rare sinks.
            </p>
          </div>

          <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 mb-6">
            <h2 className="text-lg font-semibold mb-3">How to play</h2>
            <ul className="space-y-2 text-sm text-cyan-100/80">
              <li>• Each session is 10 open prompts, 25 seconds each.</li>
              <li>• Type any valid answer. The rarer it is, the more points and depth you earn.</li>
              <li>• Tiers: Plankton {TIER_POINTS.Plankton} · Too Clever {TIER_POINTS["Too Clever"]} · Schooler {TIER_POINTS.Schooler} · Rare {TIER_POINTS.Rare} · Deep Cut {TIER_POINTS["Deep Cut"]} · One in a Krillion {TIER_POINTS["One in a Krillion"]}.</li>
              <li>• Rarer answers are weighted much harder: a single Deep Cut outweighs a pile of Plankton.</li>
              <li>• 1 point = {POINTS_TO_METERS} metres. Perfect session = {MAX_DEPTH.toLocaleString()} m (Trench Floor).</li>
              <li>• Invalid answers score 0. When in doubt, go specific.</li>
            </ul>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {TIER_ORDER.map((tier) => (
                <div
                  key={tier}
                  className="flex items-center justify-between rounded-lg bg-black/25 border border-white/10 px-3 py-2 text-xs"
                >
                  <span style={{ color: TIER_META[tier]?.color }}>{tier}</span>
                  <span className="font-semibold text-cyan-100/80">
                    {TIER_POINTS[tier]} pts · {TIER_POINTS[tier] * POINTS_TO_METERS} m
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Groq API key</h2>
              {config?.hasServerKey && (
                <span className="text-xs text-emerald-300 bg-emerald-300/10 px-2 py-1 rounded-full">
                  Server key detected
                </span>
              )}
            </div>
            {!config?.hasServerKey && (
              <>
                <p className="text-xs text-cyan-100/60 mb-3">
                  No server key found. Paste your Groq key (stored only in this browser).
                </p>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="gsk_..."
                  className="w-full bg-black/30 border border-white/10 rounded-lg px-4 py-2 text-sm outline-none focus:border-cyan-400"
                />
              </>
            )}
            {config?.hasServerKey && (
              <p className="text-xs text-cyan-100/60">
                Using the key from your server environment (GROQ_API_KEY). You can still override below.
              </p>
            )}
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={config?.hasServerKey ? "Optional override: gsk_..." : "gsk_..."}
              className="w-full mt-3 bg-black/30 border border-white/10 rounded-lg px-4 py-2 text-sm outline-none focus:border-cyan-400"
            />
            <p className="text-xs text-cyan-100/40 mt-2">Model: {config?.model ?? "…"}</p>
          </div>

          {judgeError && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-200 rounded-lg p-3 mb-4 text-sm">
              {judgeError}
            </div>
          )}

          <div className="text-center">
            <button
              onClick={startDive}
              disabled={loadingPrompts}
              className="px-8 py-4 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-bold text-lg shadow-lg shadow-cyan-500/30 hover:scale-105 transition disabled:opacity-50 disabled:scale-100"
            >
              {loadingPrompts ? "Generating dive…" : "Start Dive"}
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (view === "finished") {
    return (
      <main className="min-h-screen relative overflow-hidden">
        <OceanBackground depth={totalDepth} />
        <div className="relative z-10 max-w-3xl mx-auto px-6 py-12">
          <div className="text-center mb-8">
            <div className="text-5xl mb-3">🏁</div>
            <h1 className="text-4xl font-black">Session Complete</h1>
            <p className="text-cyan-100/70 mt-2">
              {totalDepth} m · {zoneFor(totalDepth)} · {answers.length} questions
            </p>
          </div>

          <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-4 mb-6">
            <div className="flex items-center justify-between text-sm text-cyan-100/60 mb-2">
              <span>Depth</span>
              <span>{totalDepth} / {MAX_DEPTH.toLocaleString()} m</span>
            </div>
            <div className="h-3 bg-black/30 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-400 to-fuchsia-500 transition-all duration-700"
                style={{ width: `${clamp((totalDepth / MAX_DEPTH) * 100, 0, 100)}%` }}
              />
            </div>
          </div>

          {laddersLoading && (
            <p className="text-center text-sm text-cyan-100/50 mb-4">
              Cataloging the 3 rarest answers for each question…
            </p>
          )}

          <div className="space-y-3 mb-8">
            {answers.map((a, i) => (
              <div
                key={i}
                className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-start gap-3"
              >
                <div className="text-xs text-cyan-100/40 w-6 pt-1">{i + 1}</div>
                <div className="flex-1">
                  <p className="text-sm text-cyan-100/60">{a.prompt}</p>
                  <p className="font-semibold">
                    {a.answer}
                    {a.result.correctedAnswer &&
                    a.result.correctedAnswer.toLowerCase() !== a.answer.toLowerCase() && (
                      <span className="text-xs font-normal text-cyan-100/50">
                        {" "}
                        &rarr; {a.result.correctedAnswer}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-cyan-100/50 mt-1">{a.result.reason}</p>

                  {(() => {
                    const ladder = ladders.find((l) => l.prompt === a.prompt)?.answers ?? [];
                    if (!ladder.length) return null;
                    return (
                      <div className="mt-2 border-t border-white/10 pt-2">
                        <p className="text-[10px] uppercase tracking-wide text-cyan-100/40 mb-1">
                          Top 3 rarest answers
                        </p>
                        <ol className="space-y-0.5">
                          {ladder.map((r, i) => (
                            <li key={i} className="text-xs flex items-center gap-2">
                              <span className="text-cyan-100/30">{i + 1}.</span>
                              <span style={{ color: TIER_META[r.tier]?.color ?? "#e2e8f0" }}>
                                {r.answer}
                              </span>
                              <span className="text-cyan-100/35">({r.tier})</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    );
                  })()}
                </div>
                <div className="text-right">
                  <div
                    className="text-sm font-bold"
                    style={{ color: a.result.tier ? TIER_META[a.result.tier]?.color : "#94a3b8" }}
                  >
                    {a.result.tier ?? "Invalid"}
                  </div>
                  <div className="text-xs text-cyan-100/60">+{a.result.depth} m</div>
                </div>
              </div>
            ))}
          </div>

          <div className="text-center space-x-3">
            <button
              onClick={() => {
                setView("start");
                setPrompts([]);
                setAnswers([]);
              }}
              className="px-6 py-3 rounded-full bg-white/10 border border-white/20 font-semibold hover:bg-white/20 transition"
            >
              New Dive
            </button>
          </div>
        </div>
      </main>
    );
  }

  const prompt = prompts[index] ?? "";
  const meta = lastResult?.tier ? TIER_META[lastResult.tier] : null;

  return (
    <main className="min-h-screen relative overflow-hidden">
      <OceanBackground depth={totalDepth} />

      {/* Side depth gauge */}
      <div className="fixed left-4 top-1/2 -translate-y-1/2 z-20 hidden md:block">
        <div className="relative w-12 h-72 rounded-full bg-black/40 border border-white/10 overflow-hidden">
          {/* water column fills downward as you sink */}
          <div
            className="absolute top-0 left-0 right-0 bg-gradient-to-b from-cyan-400 via-blue-500 to-fuchsia-600 opacity-60 transition-all duration-700"
            style={{ height: `${markerTop}%` }}
          />
          {/* surface */}
          <div className="absolute top-0 left-0 right-0 h-px bg-cyan-100/70" />
          <div
            className="absolute left-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-white shadow-lg flex items-center justify-center transition-all duration-700"
            style={{ top: `calc(${markerTop}% - 14px)` }}
          >
            <span className="block rotate-90 text-sm leading-none">🐟</span>
          </div>
        </div>
        <p className="text-center text-[10px] text-cyan-100/40 mt-1">surface</p>
        <p className="text-center text-xs text-cyan-100/70">{totalDepth} m</p>
        <p className="text-center text-[10px] text-cyan-100/40">{zoneFor(totalDepth)}</p>
      </div>

      <div className="relative z-10 max-w-2xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <div className="text-sm text-cyan-100/60">
            Prompt {index + 1} / {prompts.length}
          </div>
          <div className="text-sm text-cyan-100/60">
            Depth: <span className="font-semibold text-cyan-200">{totalDepth} m</span>
          </div>
          <button
            onClick={() => setView("finished")}
            className="text-xs px-3 py-1 rounded-full bg-white/10 border border-white/20 hover:bg-white/20 transition"
          >
            End Early
          </button>
        </div>

        <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 mb-6">
          <h2 className="text-2xl font-bold text-center leading-snug">{prompt}</h2>
        </div>

        {phase === "answering" && (
          <>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-cyan-100/60">Time left</span>
              <span
                className={`text-lg font-bold ${timeLeft <= 5 ? "text-red-300" : "text-cyan-200"}`}
              >
                {timeLeft}s
              </span>
            </div>
            <div className="h-2 bg-black/30 rounded-full overflow-hidden mb-4">
              <div
                className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-1000 linear"
                style={{ width: `${(timeLeft / 25) * 100}%` }}
              />
            </div>

            {invalidMessage && (
              <div className="bg-red-500/15 border border-red-500/40 text-red-200 rounded-lg px-4 py-2 mb-3 text-sm font-semibold">
                {invalidMessage}
              </div>
            )}

            <input
              type="text"
              autoFocus
              value={currentAnswer}
              onChange={(e) => {
                setCurrentAnswer(e.target.value);
                if (invalidMessage) setInvalidMessage(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && currentAnswer.trim()) submitAnswer(false);
              }}
              placeholder="Type your answer…"
              className={`w-full bg-black/30 rounded-xl px-4 py-3 text-lg outline-none mb-4 border ${
                invalidMessage
                  ? "border-red-500/70 focus:border-red-400"
                  : "border-white/10 focus:border-cyan-400"
              }`}
            />

            <div className="flex gap-3">
              <button
                onClick={() => submitAnswer(false)}
                disabled={!currentAnswer.trim()}
                className="flex-1 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-bold disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Submit
              </button>
              <button
                onClick={() => submitAnswer(true)}
                className="px-6 py-3 rounded-xl bg-white/10 border border-white/20 font-semibold hover:bg-white/20 transition"
              >
                Skip
              </button>
            </div>
          </>
        )}

        {phase === "judging" && (
          <div className="text-center py-10">
            <div className="inline-block w-10 h-10 border-4 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin mb-4" />
            <p className="text-cyan-100/70">Groq is weighing your rarity…</p>
          </div>
        )}

        {judgeError && phase !== "judging" && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-200 rounded-lg p-3 mb-4 text-sm">
            {judgeError}
          </div>
        )}

        {phase === "result" && lastResult && (
          <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 text-center">
            <div
              className="text-3xl font-black mb-1"
              style={{ color: meta?.color ?? "#94a3b8" }}
            >
              {lastResult.tier ?? "Invalid"}
            </div>
            {meta && <p className="text-xs text-cyan-100/50 mb-2">{meta.label}</p>}
            <p className="text-cyan-100/70 text-sm mb-3">{lastResult.reason}</p>
            {lastResult.correctedAnswer && lastResult.correctedAnswer !== (answers[answers.length - 1]?.answer ?? currentAnswer) && (
              <p className="text-xs text-cyan-200/80 mb-3">
                Autocorrected to: <span className="font-semibold">{lastResult.correctedAnswer}</span>
              </p>
            )}
            {lastResult.suggestion && (
              <p className="text-xs text-cyan-200/80 mb-3">
                Closest answer: <span className="font-semibold">{lastResult.suggestion}</span>
              </p>
            )}
            <div className="flex items-center justify-center gap-6 mb-5">
              <div>
                <div className="text-2xl font-bold">+{lastResult.points}</div>
                <div className="text-xs text-cyan-100/50">points</div>
              </div>
              <div>
                <div className="text-2xl font-bold">+{lastResult.depth}</div>
                <div className="text-xs text-cyan-100/50">metres</div>
              </div>
            </div>
            <button
              onClick={handleNext}
              className="px-8 py-3 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-bold hover:scale-105 transition"
            >
              {index + 1 >= prompts.length ? "See Results" : "Next Prompt"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

function OceanBackground({ depth }: { depth: number }) {
  const t = clamp(depth / MAX_DEPTH, 0, 1);
  // lerp colors from surface to trench
  const top = lerpColor("#0ea5e9", "#020617", t * 0.6);
  const bottom = lerpColor("#1e3a8a", "#000000", t);
  return (
    <div
      className="absolute inset-0 -z-0"
      style={{ background: `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)` }}
    >
      <div className="absolute inset-0 opacity-30 pointer-events-none">
        {[...Array(18)].map((_, i) => (
          <span
            key={i}
            className="bubble"
            style={{
              left: `${(i * 37 + 11) % 100}%`,
              animationDelay: `${(i % 7) * 0.8}s`,
              animationDuration: `${6 + (i % 5)}s`,
              width: `${4 + (i % 4) * 3}px`,
              height: `${4 + (i % 4) * 3}px`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function lerpColor(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
  const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bl})`;
}
