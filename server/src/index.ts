import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { oauthRouter } from "./auth/oauth-routes.js";
import { buildMcpServer } from "./mcp/server.js";

const app = express();
app.use(cors({ exposedHeaders: ["mcp-session-id"] }));
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", version: "0.1.0" });
});

app.use("/auth", oauthRouter);

const transports = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", async (req, res) => {
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

const forwardSessionRequest = async (
  req: express.Request,
  res: express.Response
): Promise<void> => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send("Missing or unknown mcp-session-id.");
    return;
  }
  await transport.handleRequest(req, res);
};
app.get("/mcp", forwardSessionRequest);
app.delete("/mcp", forwardSessionRequest);

app.listen(config.PORT, () => {
  console.log(`outlook-mcp listening on port ${config.PORT}`);
  console.log(`  Health     : http://localhost:${config.PORT}/health`);
  console.log(`  Sign in    : http://localhost:${config.PORT}/auth/login`);
  console.log(`  MCP        : POST http://localhost:${config.PORT}/mcp`);
  console.log(`  Dev user   : ${config.DEV_USER_UPN}`);
});
