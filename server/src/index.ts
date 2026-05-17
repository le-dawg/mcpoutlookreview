import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { oauthRouter } from "./auth/oauth-routes.js";
import { requestContext } from "./auth/request-context.js";
import { buildMcpServer } from "./mcp/server.js";

const app = express();
app.use(cors({ exposedHeaders: ["mcp-session-id"] }));
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", version: "0.1.0" });
});

app.use("/auth", oauthRouter);

function bearerAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.MCP_AUTH_TOKEN) {
    next();
    return;
  }
  const header = req.headers.authorization;
  if (header !== `Bearer ${config.MCP_AUTH_TOKEN}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

function resolveUpn(req: Request): string {
  const hdr = req.headers["x-mcp-user"];
  if (typeof hdr === "string" && hdr.trim().length > 0) {
    return hdr.trim().toLowerCase();
  }
  return config.DEV_USER_UPN.toLowerCase();
}

const transports = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", bearerAuth, async (req, res) => {
  await requestContext.run({ upn: resolveUpn(req) }, async () => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport = sessionId ? transports.get(sessionId) : undefined;

      if (!transport) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport!);
          },
        });
        transport.onclose = () => {
          if (transport!.sessionId) transports.delete(transport!.sessionId);
        };
        const server = buildMcpServer();
        await server.connect(transport);
      }
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!res.headersSent) res.status(500).json({ error: msg });
    }
  });
});

async function forwardSessionRequest(req: Request, res: Response): Promise<void> {
  await requestContext.run({ upn: resolveUpn(req) }, async () => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).send("Missing or unknown mcp-session-id.");
      return;
    }
    await transport.handleRequest(req, res);
  });
}
app.get("/mcp", bearerAuth, forwardSessionRequest);
app.delete("/mcp", bearerAuth, forwardSessionRequest);

app.listen(config.PORT, () => {
  const cacheBackend = config.KV_NAME ? `Key Vault (${config.KV_NAME})` : "local file";
  const authMode = config.MCP_AUTH_TOKEN ? "bearer token required" : "disabled (dev)";
  console.log(`outlook-mcp listening on port ${config.PORT}`);
  console.log(`  Token cache: ${cacheBackend}`);
  console.log(`  /mcp auth  : ${authMode}`);
  console.log(`  Dev user   : ${config.DEV_USER_UPN}`);
});
