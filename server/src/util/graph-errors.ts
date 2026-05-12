export class ToolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "ToolError";
  }
}

type GraphErrShape = {
  statusCode?: number;
  code?: string;
  message?: string;
  body?: string | { error?: { code?: string; message?: string } };
};

export function mapGraphError(e: unknown): ToolError {
  const err = (e ?? {}) as GraphErrShape;
  const status = err.statusCode ?? 0;

  let bodyObj: { error?: { code?: string; message?: string } } | undefined;
  if (typeof err.body === "string") {
    try { bodyObj = JSON.parse(err.body); } catch { /* ignore */ }
  } else {
    bodyObj = err.body;
  }
  const graphCode = bodyObj?.error?.code ?? err.code ?? "UNKNOWN";
  const graphMsg = bodyObj?.error?.message ?? err.message ?? "Unknown error";

  if (status === 401 || /InvalidAuthenticationToken|TokenExpired/i.test(graphCode)) {
    return new ToolError(
      "AUTH_REQUIRED",
      "Token invalid or expired — re-authenticate at /auth/login."
    );
  }
  if (status === 403) {
    if (/(ErrorAccessDenied|sharing|calendar)/i.test(graphCode + " " + graphMsg)) {
      return new ToolError(
        "CALENDAR_NOT_SHARED",
        `Colleague calendar not accessible. Check that the calendar baseline has run for this user. Underlying: ${graphMsg}`
      );
    }
    return new ToolError("FORBIDDEN", graphMsg);
  }
  if (status === 404 || /NotFound|ItemNotFound/i.test(graphCode)) {
    return new ToolError("NOT_FOUND", graphMsg);
  }
  if (status === 429) {
    return new ToolError(
      "RATE_LIMITED",
      "Microsoft Graph rate limit hit — try again shortly.",
      30_000
    );
  }
  if (status >= 500) {
    return new ToolError("UPSTREAM_ERROR", `Graph 5xx: ${graphMsg}`);
  }
  return new ToolError("UNEXPECTED", `Graph ${status || "?"}: ${graphMsg}`);
}
