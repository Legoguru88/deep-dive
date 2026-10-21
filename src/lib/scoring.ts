// Single source of truth for scoring, shared by the client UI and the API.

export const TIER_POINTS: Record<string, number> = {
  Plankton: 5,
  "Too Clever": 10,
  Schooler: 20,
  Rare: 55,
  "Deep Cut": 90,
  "One in a Krillion": 100,
};

export const TIER_ORDER = [
  "Plankton",
  "Too Clever",
  "Schooler",
  "Rare",
  "Deep Cut",
  "One in a Krillion",
];

/** Every point sinks you this many metres. */
export const POINTS_TO_METERS = 10;

/** Questions in one session. */
export const SESSION_LENGTH = 10;

/** Deepest possible session (a perfect run). */
export const MAX_DEPTH = SESSION_LENGTH * 100 * POINTS_TO_METERS;

export function zoneFor(depth: number): string {
  if (depth < 200) return "Sunlit Shallows";
  if (depth < 1000) return "Twilight Zone";
  if (depth < 2000) return "Midnight Zone";
  if (depth < 3800) return "The Wreck";
  if (depth < 5000) return "Abyssal Plain";
  return "Hadal Zone / Trench Floor";
}
