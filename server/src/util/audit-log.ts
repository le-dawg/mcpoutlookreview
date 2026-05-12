export type AuditEvent = {
  timestamp: string;
  user: string;
  tool: string;
  outcome: "ok" | "error" | "rate_limited";
  errorCode?: string;
  errorMessage?: string;
  durationMs: number;
};

export function emitAudit(event: AuditEvent): void {
  console.log(JSON.stringify({ kind: "audit", ...event }));
}
