import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { callTool, listTools } from "../tools/index.js";
import { config } from "../config.js";

export function buildMcpServer(): Server {
  const server = new Server(
    { name: "outlook-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    return callTool(req.params.name, args, { upn: config.DEV_USER_UPN });
  });

  return server;
}
