import { z } from "zod";
import { makeTool } from "./wrap.js";
import { graphFor } from "../graph/client.js";

const Address = z.string().email();

// ----- search_mail -----------------------------------------------------------

const SearchInput = z.object({
  query: z.string().min(1).optional()
    .describe("Free-text search across subject and body. Mutually exclusive with date filters in Graph; if both are passed, query wins."),
  folder: z.enum(["inbox", "sentitems", "drafts", "archive", "deleteditems"]).default("inbox"),
  top: z.number().int().min(1).max(100).default(20),
  receivedAfter: z.string().datetime().optional(),
  receivedBefore: z.string().datetime().optional(),
});

export const searchMail = makeTool(
  "search_mail",
  "Search the user's own mailbox by free-text query and/or date range. Returns lightweight message metadata.",
  SearchInput,
  async (args, ctx) => {
    const client = graphFor(ctx.upn);
    const select = "id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,hasAttachments";
    const path = `/me/mailFolders/${args.folder}/messages`;

    let result: { value?: unknown[] };
    if (args.query) {
      const safe = args.query.replace(/"/g, '""');
      result = await client.api(path)
        .header("ConsistencyLevel", "eventual")
        .search(`"${safe}"`)
        .top(args.top)
        .select(select)
        .get();
    } else {
      let req = client.api(path).top(args.top).select(select).orderby("receivedDateTime DESC");
      const filters: string[] = [];
      if (args.receivedAfter) filters.push(`receivedDateTime ge ${args.receivedAfter}`);
      if (args.receivedBefore) filters.push(`receivedDateTime le ${args.receivedBefore}`);
      if (filters.length) req = req.filter(filters.join(" and "));
      result = await req.get();
    }

    const items = (result.value ?? []) as Array<Record<string, unknown>>;
    return {
      count: items.length,
      messages: items.map(projectMessage),
    };
  }
);

// ----- read_mail -------------------------------------------------------------

const ReadInput = z.object({
  messageId: z.string().min(1),
  bodyFormat: z.enum(["text", "html"]).default("text"),
  includeAttachmentsMeta: z.boolean().default(true),
});

export const readMail = makeTool(
  "read_mail",
  "Fetch full content of a single mail by id. Returns body, recipients, and attachment metadata (not attachment bytes).",
  ReadInput,
  async (args, ctx) => {
    const client = graphFor(ctx.upn);
    const m: Record<string, unknown> = await client.api(`/me/messages/${args.messageId}`)
      .header("Prefer", `outlook.body-content-type="${args.bodyFormat}"`)
      .get();

    let attachments: unknown[] = [];
    if (args.includeAttachmentsMeta && m.hasAttachments) {
      const att = await client.api(`/me/messages/${args.messageId}/attachments`)
        .select("id,name,contentType,size")
        .get();
      attachments = (att.value ?? []) as unknown[];
    }
    return {
      id: m.id,
      subject: m.subject,
      from: (m.from as { emailAddress?: unknown } | undefined)?.emailAddress,
      to: addresses(m.toRecipients),
      cc: addresses(m.ccRecipients),
      bcc: addresses(m.bccRecipients),
      received: m.receivedDateTime,
      sent: m.sentDateTime,
      body: (m.body as { content?: string } | undefined)?.content,
      bodyType: (m.body as { contentType?: string } | undefined)?.contentType,
      hasAttachments: m.hasAttachments,
      attachments,
    };
  }
);

// ----- send_mail -------------------------------------------------------------

const SendInput = z.object({
  to: z.array(Address).min(1),
  cc: z.array(Address).optional(),
  bcc: z.array(Address).optional(),
  subject: z.string().min(1),
  body: z.string(),
  bodyType: z.enum(["Text", "HTML"]).default("Text"),
  saveToSentItems: z.boolean().default(true),
});

export const sendMail = makeTool(
  "send_mail",
  "Send an email immediately from the user's account. The mail is saved to Sent Items by default.",
  SendInput,
  async (args, ctx) => {
    await graphFor(ctx.upn).api("/me/sendMail").post({
      message: {
        subject: args.subject,
        body: { contentType: args.bodyType, content: args.body },
        toRecipients: args.to.map(toRecipient),
        ccRecipients: (args.cc ?? []).map(toRecipient),
        bccRecipients: (args.bcc ?? []).map(toRecipient),
      },
      saveToSentItems: args.saveToSentItems,
    });
    return {
      sent: true,
      sentAt: new Date().toISOString(),
      to: args.to,
      subject: args.subject,
    };
  }
);

// ----- create_draft ----------------------------------------------------------

const DraftInput = z.object({
  to: z.array(Address).default([]),
  cc: z.array(Address).optional(),
  bcc: z.array(Address).optional(),
  subject: z.string(),
  body: z.string(),
  bodyType: z.enum(["Text", "HTML"]).default("Text"),
});

export const createDraft = makeTool(
  "create_draft",
  "Create a draft email in the Drafts folder without sending it. Returns the draft id and webLink.",
  DraftInput,
  async (args, ctx) => {
    const result: Record<string, unknown> = await graphFor(ctx.upn).api("/me/messages").post({
      subject: args.subject,
      body: { contentType: args.bodyType, content: args.body },
      toRecipients: args.to.map(toRecipient),
      ccRecipients: (args.cc ?? []).map(toRecipient),
      bccRecipients: (args.bcc ?? []).map(toRecipient),
    });
    return {
      id: result.id,
      webLink: result.webLink,
      subject: result.subject,
    };
  }
);

// ----- reply_to_thread -------------------------------------------------------

const ReplyInput = z.object({
  messageId: z.string().min(1),
  body: z.string(),
  bodyType: z.enum(["Text", "HTML"]).default("Text"),
  replyAll: z.boolean().default(false),
});

export const replyToThread = makeTool(
  "reply_to_thread",
  "Reply to an existing mail thread. Set replyAll=true to reply to all recipients.",
  ReplyInput,
  async (args, ctx) => {
    const endpoint = args.replyAll ? "replyAll" : "reply";
    await graphFor(ctx.upn).api(`/me/messages/${args.messageId}/${endpoint}`).post({
      message: {
        body: { contentType: args.bodyType, content: args.body },
      },
    });
    return {
      sent: true,
      mode: endpoint,
      inReplyTo: args.messageId,
    };
  }
);

// ----- helpers ---------------------------------------------------------------

function toRecipient(address: string) {
  return { emailAddress: { address } };
}

function addresses(value: unknown): Array<{ name?: string; address?: string }> {
  if (!Array.isArray(value)) return [];
  return value.map((r) => {
    const ea = (r as { emailAddress?: { name?: string; address?: string } }).emailAddress ?? {};
    return { name: ea.name, address: ea.address };
  });
}

function projectMessage(m: Record<string, unknown>) {
  const from = (m.from as { emailAddress?: { address?: string; name?: string } } | undefined)?.emailAddress;
  return {
    id: m.id,
    subject: m.subject,
    from: from?.address,
    fromName: from?.name,
    to: addresses(m.toRecipients).map((a) => a.address).filter(Boolean),
    received: m.receivedDateTime,
    preview: m.bodyPreview,
    isRead: m.isRead,
    hasAttachments: m.hasAttachments,
  };
}
