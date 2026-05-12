import { z } from "zod";
import { makeTool } from "./wrap.js";
import { graphFor } from "../graph/client.js";

const Address = z.string().email();

const Attendee = z.object({
  email: Address,
  type: z.enum(["required", "optional"]).default("required"),
});

const EventSelect =
  "id,subject,start,end,location,attendees,organizer,isAllDay,onlineMeetingUrl,bodyPreview,isCancelled,sensitivity,webLink";

// ----- list_calendar ---------------------------------------------------------

const ListInput = z.object({
  startDateTime: z.string().datetime(),
  endDateTime: z.string().datetime(),
  top: z.number().int().min(1).max(200).default(50),
});

export const listCalendar = makeTool(
  "list_calendar",
  "List events on the user's own calendar within a time window. Times are returned in the event's own timezone.",
  ListInput,
  async (args, ctx) => {
    const result = await graphFor(ctx.upn).api("/me/calendarView")
      .query({ startDateTime: args.startDateTime, endDateTime: args.endDateTime })
      .top(args.top)
      .select(EventSelect)
      .orderby("start/dateTime")
      .get();
    const items = (result.value ?? []) as Array<Record<string, unknown>>;
    return {
      count: items.length,
      events: items.map(projectEvent),
    };
  }
);

// ----- create_event ----------------------------------------------------------

const CreateInput = z.object({
  subject: z.string().min(1),
  start: z.string()
    .describe("Local start datetime, ISO 8601 without timezone suffix (e.g. '2026-05-15T10:00:00'). The timeZone field tells Graph which timezone to interpret this in."),
  end: z.string(),
  timeZone: z.string().default("Europe/Copenhagen"),
  attendees: z.array(Attendee).default([]),
  body: z.string().optional(),
  bodyType: z.enum(["Text", "HTML"]).default("Text"),
  location: z.string().optional(),
  isOnlineMeeting: z.boolean().default(false),
});

export const createEvent = makeTool(
  "create_event",
  "Create a calendar event on the user's own calendar. Pass isOnlineMeeting=true to attach a Teams link automatically.",
  CreateInput,
  async (args, ctx) => {
    const payload = buildEventPayload(args);
    const result = await graphFor(ctx.upn).api("/me/events").post(payload);
    return projectEvent(result);
  }
);

// ----- update_event ----------------------------------------------------------

const UpdateInput = z.object({
  eventId: z.string().min(1),
  subject: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  timeZone: z.string().default("Europe/Copenhagen"),
  attendees: z.array(Attendee).optional(),
  body: z.string().optional(),
  bodyType: z.enum(["Text", "HTML"]).default("Text"),
  location: z.string().optional(),
});

export const updateEvent = makeTool(
  "update_event",
  "Update an existing event on the user's own calendar. Only provided fields are changed.",
  UpdateInput,
  async (args, ctx) => {
    const patch: Record<string, unknown> = {};
    if (args.subject !== undefined) patch.subject = args.subject;
    if (args.start !== undefined) {
      patch.start = { dateTime: stripTzSuffix(args.start), timeZone: args.timeZone };
    }
    if (args.end !== undefined) {
      patch.end = { dateTime: stripTzSuffix(args.end), timeZone: args.timeZone };
    }
    if (args.attendees !== undefined) {
      patch.attendees = args.attendees.map((a) => ({
        emailAddress: { address: a.email },
        type: a.type,
      }));
    }
    if (args.body !== undefined) {
      patch.body = { contentType: args.bodyType, content: args.body };
    }
    if (args.location !== undefined) {
      patch.location = { displayName: args.location };
    }
    const result = await graphFor(ctx.upn).api(`/me/events/${args.eventId}`).patch(patch);
    return projectEvent(result);
  }
);

// ----- delete_event ----------------------------------------------------------

const DeleteInput = z.object({
  eventId: z.string().min(1),
  sendCancellations: z.boolean().default(true)
    .describe("If true and the event has attendees, sends cancellation notices via /cancel instead of a hard delete."),
});

export const deleteEvent = makeTool(
  "delete_event",
  "Delete an event on the user's own calendar. With sendCancellations=true, attendees get a cancellation notice.",
  DeleteInput,
  async (args, ctx) => {
    const client = graphFor(ctx.upn);
    if (args.sendCancellations) {
      try {
        await client.api(`/me/events/${args.eventId}/cancel`).post({});
        return { cancelled: true, eventId: args.eventId };
      } catch {
        // Fall through to hard delete (cancel fails for events with no attendees)
      }
    }
    await client.api(`/me/events/${args.eventId}`).delete();
    return { deleted: true, eventId: args.eventId };
  }
);

// ----- helpers ---------------------------------------------------------------

function stripTzSuffix(s: string): string {
  // Graph wants a naive local datetime when timeZone is supplied separately.
  return s.replace(/(Z|[+-]\d{2}:?\d{2})$/, "");
}

function buildEventPayload(args: z.infer<typeof CreateInput>) {
  const event: Record<string, unknown> = {
    subject: args.subject,
    start: { dateTime: stripTzSuffix(args.start), timeZone: args.timeZone },
    end: { dateTime: stripTzSuffix(args.end), timeZone: args.timeZone },
    attendees: args.attendees.map((a) => ({
      emailAddress: { address: a.email },
      type: a.type,
    })),
  };
  if (args.body) event.body = { contentType: args.bodyType, content: args.body };
  if (args.location) event.location = { displayName: args.location };
  if (args.isOnlineMeeting) {
    event.isOnlineMeeting = true;
    event.onlineMeetingProvider = "teamsForBusiness";
  }
  return event;
}

export function projectEvent(e: Record<string, unknown>) {
  const organizer = (e.organizer as { emailAddress?: { address?: string; name?: string } } | undefined)?.emailAddress;
  const location = (e.location as { displayName?: string } | undefined)?.displayName ?? null;
  const attendees = Array.isArray(e.attendees)
    ? (e.attendees as Array<Record<string, unknown>>).map((a) => {
        const ea = (a.emailAddress as { address?: string; name?: string } | undefined) ?? {};
        const status = (a.status as { response?: string } | undefined)?.response;
        return { email: ea.address, name: ea.name, response: status };
      })
    : [];
  return {
    id: e.id,
    subject: e.subject,
    start: e.start,
    end: e.end,
    location,
    organizer: organizer?.address,
    attendees,
    isAllDay: e.isAllDay,
    onlineMeetingUrl: e.onlineMeetingUrl,
    preview: e.bodyPreview,
    isCancelled: e.isCancelled,
    sensitivity: e.sensitivity,
    webLink: e.webLink,
  };
}
