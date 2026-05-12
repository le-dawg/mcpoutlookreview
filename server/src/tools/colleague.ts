import { z } from "zod";
import { makeTool } from "./wrap.js";
import { graphFor } from "../graph/client.js";
import { projectEvent } from "./calendar.js";

const Address = z.string().email();

// ----- read_colleague_calendar -----------------------------------------------

const ReadColleagueInput = z.object({
  userEmail: Address.describe("UPN or primary SMTP of the colleague to read."),
  startDateTime: z.string().datetime(),
  endDateTime: z.string().datetime(),
  top: z.number().int().min(1).max(200).default(50),
});

export const readColleagueCalendar = makeTool(
  "read_colleague_calendar",
  "Read events from another user's calendar in the tenant. Returns 'CALENDAR_NOT_SHARED' if Reviewer permission is not set (Phase 2 baseline should have set it for all employees).",
  ReadColleagueInput,
  async (args, ctx) => {
    const result = await graphFor(ctx.upn).api(`/users/${args.userEmail}/calendarView`)
      .query({ startDateTime: args.startDateTime, endDateTime: args.endDateTime })
      .top(args.top)
      .select("id,subject,start,end,location,attendees,organizer,isAllDay,bodyPreview,isCancelled,sensitivity,webLink")
      .orderby("start/dateTime")
      .get();
    const items = (result.value ?? []) as Array<Record<string, unknown>>;
    return {
      user: args.userEmail,
      count: items.length,
      events: items.map(projectEvent),
    };
  }
);

// ----- find_meeting_slot -----------------------------------------------------

const FindSlotInput = z.object({
  attendees: z.array(Address).min(1),
  startWindow: z.string().datetime(),
  endWindow: z.string().datetime(),
  meetingDurationMinutes: z.number().int().min(15).max(480).default(30),
  maxCandidates: z.number().int().min(1).max(20).default(5),
});

export const findMeetingSlot = makeTool(
  "find_meeting_slot",
  "Ask Graph to suggest meeting time slots that work across a list of attendees within a search window. Uses Microsoft Graph findMeetingTimes.",
  FindSlotInput,
  async (args, ctx) => {
    const result: Record<string, unknown> = await graphFor(ctx.upn).api("/me/findMeetingTimes").post({
      attendees: args.attendees.map((e) => ({
        emailAddress: { address: e },
        type: "required",
      })),
      timeConstraint: {
        timeslots: [{
          start: { dateTime: args.startWindow, timeZone: "UTC" },
          end:   { dateTime: args.endWindow,   timeZone: "UTC" },
        }],
      },
      meetingDuration: `PT${args.meetingDurationMinutes}M`,
      maxCandidates: args.maxCandidates,
    });

    const suggestions = (result.meetingTimeSuggestions ?? []) as Array<Record<string, unknown>>;
    return {
      attendees: args.attendees,
      durationMinutes: args.meetingDurationMinutes,
      emptySuggestionsReason: result.emptySuggestionsReason ?? null,
      suggestions: suggestions.map((s) => {
        const slot = s.meetingTimeSlot as { start?: unknown; end?: unknown } | undefined;
        const attendeeAvailability = Array.isArray(s.attendeeAvailability)
          ? (s.attendeeAvailability as Array<Record<string, unknown>>).map((a) => {
              const ea = (a.attendee as { emailAddress?: { address?: string } } | undefined)?.emailAddress;
              return { attendee: ea?.address, availability: a.availability };
            })
          : [];
        return {
          confidence: s.confidence,
          organizerAvailability: s.organizerAvailability,
          start: slot?.start,
          end: slot?.end,
          attendeeAvailability,
        };
      }),
    };
  }
);
