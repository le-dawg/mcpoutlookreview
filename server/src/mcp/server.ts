import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { callTool, listTools } from "../tools/index.js";

export function buildMcpServer(): Server {
  const server = new Server(
    { name: "outlook-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    return callTool(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>);
  });

  return server;
}
