import { describe, expect, it } from "vitest";
import { DISCOVERY_LIMITS, describeRateLimit, evaluateDiscoveryRateLimit, type DiscoveryRunSummary } from "./rate-limit";

const now = new Date("2026-10-26T10:00:00.000Z");
const run = (ageSeconds: number, status: DiscoveryRunSummary["status"] = "completed", errorCode: string | null = null): DiscoveryRunSummary => ({
  startedAt: new Date(now.getTime() - ageSeconds * 1000), status, errorCode,
});

describe("discovery rate limiting", () => {
  it("allows the first run", () => {
    expect(evaluateDiscoveryRateLimit([], now)).toEqual({ allowed: true });
  });

  it("blocks a second run while one is in progress, then releases a stale one", () => {
    expect(evaluateDiscoveryRateLimit([run(60, "running")], now)).toMatchObject({ allowed: false, reason: "run_in_progress" });
    expect(evaluateDiscoveryRateLimit([run(DISCOVERY_LIMITS.inProgressSeconds + 1, "running")], now)).toEqual({ allowed: true });
  });

  it("requires a pause between runs", () => {
    expect(evaluateDiscoveryRateLimit([run(5)], now)).toEqual({ allowed: false, reason: "too_soon", retryAfterSeconds: DISCOVERY_LIMITS.minIntervalSeconds - 5 });
    expect(evaluateDiscoveryRateLimit([run(DISCOVERY_LIMITS.minIntervalSeconds + 1)], now)).toEqual({ allowed: true });
  });

  it("cools down after the provider rate limited us", () => {
    const decision = evaluateDiscoveryRateLimit([run(40, "failed", "provider_rate_limited")], now);
    expect(decision).toMatchObject({ allowed: false, reason: "provider_cooldown" });
    expect(evaluateDiscoveryRateLimit([run(40, "failed", "provider_unavailable")], now)).toEqual({ allowed: true });
    expect(evaluateDiscoveryRateLimit([run(DISCOVERY_LIMITS.providerCooldownSeconds + 1, "failed", "provider_rate_limited")], now)).toEqual({ allowed: true });
  });

  it("enforces the hourly and daily caps and reports when the oldest run ages out", () => {
    const hourly = Array.from({ length: DISCOVERY_LIMITS.maxPerHour }, (_, index) => run(120 + index * 300));
    expect(evaluateDiscoveryRateLimit(hourly, now)).toMatchObject({ allowed: false, reason: "hourly_limit" });
    const oldest = hourly[hourly.length - 1];
    expect(oldest && evaluateDiscoveryRateLimit(hourly, now)).toMatchObject({ retryAfterSeconds: 3600 - (120 + (DISCOVERY_LIMITS.maxPerHour - 1) * 300) });

    const daily = Array.from({ length: DISCOVERY_LIMITS.maxPerDay }, (_, index) => run(4000 + index * 1500));
    expect(evaluateDiscoveryRateLimit(daily, now)).toMatchObject({ allowed: false, reason: "daily_limit" });
  });

  it("describes a block in plain language", () => {
    const decision = evaluateDiscoveryRateLimit([run(5)], now);
    if (decision.allowed) throw new Error("Expected a block");
    expect(describeRateLimit(decision)).toBe("Discovery runs need a short pause between them. Try again in about 25 seconds.");
  });
});
