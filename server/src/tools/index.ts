import type { RegisteredTool, ToolCtx, ToolDef, ToolResult } from "./wrap.js";
import { whoami } from "./whoami.js";
import { searchMail, readMail, sendMail, createDraft, replyToThread } from "./mail.js";
import { listCalendar, createEvent, updateEvent, deleteEvent } from "./calendar.js";
import { readColleagueCalendar, findMeetingSlot } from "./colleague.js";

const all: RegisteredTool[] = [
  whoami,
  searchMail,
  readMail,
  sendMail,
  createDraft,
  replyToThread,
  listCalendar,
  createEvent,
  updateEvent,
  deleteEvent,
  readColleagueCalendar,
  findMeetingSlot,
];

const registry: Record<string, RegisteredTool> = Object.fromEntries(
  all.map((t) => [t.def.name, t])
);

export function listTools(): ToolDef[] {
  return all.map((t) => t.def);
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolCtx
): Promise<ToolResult> {
  const entry = registry[name];
  if (!entry) {
    return {
      content: [{ type: "text", text: `UNKNOWN_TOOL: ${name}` }],
      isError: true,
    };
  }
  return entry.handler(args, ctx);
}
