import type { AgentGuardrails, AgentUsage } from "./types";

export const DEFAULT_AGENT_GUARDRAILS: AgentGuardrails = Object.freeze({
  maxPages: 30,
  maxToolCalls: 48,
  maxRetries: 2,
  maxDurationMs: 120_000,
  maxReinvestigations: 4,
  maxAdditionalPagesPerReinvestigation: 5,
});

export const EMPTY_AGENT_USAGE: AgentUsage = Object.freeze({
  pagesCrawled: 0,
  toolCalls: 0,
  retries: 0,
  elapsedMs: 0,
  reinvestigations: 0,
});

export type GuardrailCode =
  | "max_pages"
  | "max_tool_calls"
  | "max_retries"
  | "max_duration"
  | "max_reinvestigations";

export interface GuardrailViolation {
  code: GuardrailCode;
  current: number;
  limit: number;
  message: string;
}

export class GuardrailError extends Error {
  constructor(public readonly violations: GuardrailViolation[]) {
    super(violations.map((violation) => violation.message).join(" "));
    this.name = "GuardrailError";
  }
}

export function validateAgentGuardrails(input: AgentGuardrails): AgentGuardrails {
  const integerLimits: Array<[keyof AgentGuardrails, number, number]> = [
    ["maxPages", 1, 100],
    ["maxToolCalls", 1, 200],
    ["maxRetries", 0, 5],
    ["maxDurationMs", 10_000, 600_000],
    ["maxReinvestigations", 0, 10],
    ["maxAdditionalPagesPerReinvestigation", 1, 20],
  ];
  for (const [key, minimum, maximum] of integerLimits) {
    const value = input[key];
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${key}は${minimum}〜${maximum}の整数で指定してください。`);
    }
  }
  return { ...input };
}

export function projectUsage(usage: AgentUsage, delta: Partial<AgentUsage>): AgentUsage {
  return {
    pagesCrawled: usage.pagesCrawled + (delta.pagesCrawled ?? 0),
    toolCalls: usage.toolCalls + (delta.toolCalls ?? 0),
    retries: usage.retries + (delta.retries ?? 0),
    elapsedMs: usage.elapsedMs + (delta.elapsedMs ?? 0),
    reinvestigations: usage.reinvestigations + (delta.reinvestigations ?? 0),
  };
}

export function checkGuardrails(limits: AgentGuardrails, usage: AgentUsage): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];
  const add = (code: GuardrailCode, current: number, limit: number, label: string): void => {
    if (current > limit) {
      violations.push({ code, current, limit, message: `${label}上限（${limit}）を超えました。` });
    }
  };
  add("max_pages", usage.pagesCrawled, limits.maxPages, "Page");
  add("max_tool_calls", usage.toolCalls, limits.maxToolCalls, "Tool Call");
  add("max_retries", usage.retries, limits.maxRetries, "Retry");
  add("max_duration", usage.elapsedMs, limits.maxDurationMs, "Duration(ms)");
  add("max_reinvestigations", usage.reinvestigations, limits.maxReinvestigations, "Re-investigation");
  return violations;
}

export function assertWithinGuardrails(limits: AgentGuardrails, usage: AgentUsage): void {
  const violations = checkGuardrails(limits, usage);
  if (violations.length > 0) throw new GuardrailError(violations);
}
