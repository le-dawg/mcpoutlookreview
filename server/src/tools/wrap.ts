import { z, type ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { checkRateLimit } from "../util/rate-limit.js";
import { emitAudit } from "../util/audit-log.js";
import { mapGraphError, ToolError } from "../util/graph-errors.js";

export type ToolCtx = { upn: string };

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type RegisteredTool = {
  def: ToolDef;
  handler: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<ToolResult>;
};

function buildInputSchema<S extends ZodTypeAny>(schema: S): Record<string, unknown> {
  const raw = zodToJsonSchema(schema, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  const out = { ...raw };
  delete out.$schema;
  delete out.definitions;
  return out;
}

export function makeTool<S extends ZodTypeAny>(
  name: string,
  description: string,
  schema: S,
  fn: (args: z.infer<S>, ctx: ToolCtx) => Promise<unknown>
): RegisteredTool {
  const def: ToolDef = {
    name,
    description,
    inputSchema: buildInputSchema(schema),
  };

  const handler: RegisteredTool["handler"] = async (rawArgs, ctx) => {
    const start = Date.now();
    const base = {
      timestamp: new Date(start).toISOString(),
      user: ctx.upn,
      tool: name,
    };

    const rl = checkRateLimit(ctx.upn);
    if (!rl.ok) {
      const seconds = Math.ceil((rl.retryAfterMs ?? 0) / 1000);
      const msg = `RATE_LIMITED: 60 requests/min/user exceeded — retry in ~${seconds}s.`;
      emitAudit({
        ...base,
        outcome: "rate_limited",
        errorCode: "RATE_LIMITED",
        durationMs: Date.now() - start,
      });
      return { content: [{ type: "text", text: msg }], isError: true };
    }

    let parsed: z.infer<S>;
    try {
      parsed = schema.parse(rawArgs) as z.infer<S>;
    } catch (e) {
      const zerr = e as z.ZodError;
      const detail = zerr.errors
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      const msg = `INVALID_INPUT: ${detail}`;
      emitAudit({
        ...base,
        outcome: "error",
        errorCode: "INVALID_INPUT",
        errorMessage: msg,
        durationMs: Date.now() - start,
      });
      return { content: [{ type: "text", text: msg }], isError: true };
    }

    try {
      const result = await fn(parsed, ctx);
      const text =
        typeof result === "string" ? result : JSON.stringify(result, null, 2);
      emitAudit({
        ...base,
        outcome: "ok",
        durationMs: Date.now() - start,
      });
      return { content: [{ type: "text", text }] };
    } catch (e) {
      const toolErr = e instanceof ToolError ? e : mapGraphError(e);
      emitAudit({
        ...base,
        outcome: "error",
        errorCode: toolErr.code,
        errorMessage: toolErr.message,
        durationMs: Date.now() - start,
      });
      return {
        content: [{ type: "text", text: `${toolErr.code}: ${toolErr.message}` }],
        isError: true,
      };
    }
  };

  return { def, handler };
}
