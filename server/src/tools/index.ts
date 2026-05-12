import { whoamiTool, whoamiHandler } from "./whoami.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type ToolEntry = {
  def: typeof whoamiTool;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
};

const registry: Record<string, ToolEntry> = {
  whoami: { def: whoamiTool, handler: whoamiHandler },
};

export function listTools() {
  return Object.values(registry).map((r) => r.def);
}

export async function callTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const entry = registry[name];
  if (!entry) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }
  try {
    return await entry.handler(args);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      content: [{ type: "text", text: `Error: ${msg}` }],
      isError: true,
    };
  }
}
