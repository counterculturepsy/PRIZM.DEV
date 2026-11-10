/**
 * Limits for external discovery runs, per workspace. They sit well inside the public Overpass guidance
 * (regular use is roughly 100 queries a day, no parallel runs, and a pause after HTTP 429).
 */
export const DISCOVERY_LIMITS = {
  minIntervalSeconds: 30,
  maxPerHour: 10,
  maxPerDay: 50,
  inProgressSeconds: 300,
  providerCooldownSeconds: 120,
};

export type DiscoveryLimits = Readonly<typeof DISCOVERY_LIMITS>;

export type DiscoveryRunSummary = Readonly<{
  startedAt: Date;
  status: "running" | "completed" | "failed";
  errorCode: string | null;
}>;

export type RateLimitReason = "run_in_progress" | "provider_cooldown" | "too_soon" | "hourly_limit" | "daily_limit";

export type RateLimitDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; reason: RateLimitReason; retryAfterSeconds: number }>;

const elapsedSeconds = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / 1000);
const blocked = (reason: RateLimitReason, seconds: number): RateLimitDecision => ({ allowed: false, reason, retryAfterSeconds: Math.max(1, Math.ceil(seconds)) });

/** Decides whether a workspace may start another external discovery run. `runs` must contain only external (non-CSV) runs. */
export function evaluateDiscoveryRateLimit(
  runs: readonly DiscoveryRunSummary[],
  now: Date,
  limits: DiscoveryLimits = DISCOVERY_LIMITS,
): RateLimitDecision {
  const newestFirst = [...runs].sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime());
  const latest = newestFirst[0];
  if (latest) {
    const age = elapsedSeconds(latest.startedAt, now);
    if (latest.status === "running" && age < limits.inProgressSeconds) return blocked("run_in_progress", limits.inProgressSeconds - age);
    if (latest.status === "failed" && latest.errorCode === "provider_rate_limited" && age < limits.providerCooldownSeconds) {
      return blocked("provider_cooldown", limits.providerCooldownSeconds - age);
    }
    if (age < limits.minIntervalSeconds) return blocked("too_soon", limits.minIntervalSeconds - age);
  }

  const within = (windowSeconds: number) => newestFirst.filter((run) => elapsedSeconds(run.startedAt, now) < windowSeconds);
  const lastHour = within(3600);
  const oldestInHour = lastHour[lastHour.length - 1];
  if (oldestInHour && lastHour.length >= limits.maxPerHour) return blocked("hourly_limit", 3600 - elapsedSeconds(oldestInHour.startedAt, now));
  const lastDay = within(86_400);
  const oldestInDay = lastDay[lastDay.length - 1];
  if (oldestInDay && lastDay.length >= limits.maxPerDay) return blocked("daily_limit", 86_400 - elapsedSeconds(oldestInDay.startedAt, now));
  return { allowed: true };
}

const reasonText: Record<RateLimitReason, string> = {
  run_in_progress: "A discovery run is already in progress.",
  provider_cooldown: "The data provider asked us to slow down.",
  too_soon: "Discovery runs need a short pause between them.",
  hourly_limit: "This workspace reached its hourly discovery limit.",
  daily_limit: "This workspace reached its daily discovery limit.",
};

export function describeRateLimit(decision: Extract<RateLimitDecision, { allowed: false }>): string {
  const minutes = Math.ceil(decision.retryAfterSeconds / 60);
  const wait = decision.retryAfterSeconds < 90 ? `${decision.retryAfterSeconds} seconds` : `${minutes} minutes`;
  return `${reasonText[decision.reason]} Try again in about ${wait}.`;
}
