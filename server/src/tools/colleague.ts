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
  acceptTentative: z.boolean().default(false)
    .describe("If true, slots where an attendee is 'tentative' (has a soft event) are also returned. Default false — only slots where everyone is 'free'."),
});

const ACCEPTABLE_FREE = new Set(["free"]);
const ACCEPTABLE_WITH_TENTATIVE = new Set(["free", "tentative"]);

export const findMeetingSlot = makeTool(
  "find_meeting_slot",
  "Suggest meeting time slots that work across a list of attendees within a search window. Only returns slots where ALL attendees (and the organizer) are free — pass acceptTentative=true to also accept slots where attendees are tentatively booked. Uses Microsoft Graph findMeetingTimes.",
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
      minimumAttendeePercentage: 100,
      isOrganizerOptional: false,
    });

    const acceptable = args.acceptTentative ? ACCEPTABLE_WITH_TENTATIVE : ACCEPTABLE_FREE;
    const raw = (result.meetingTimeSuggestions ?? []) as Array<Record<string, unknown>>;

    const projected = raw.map((s) => {
      const slot = s.meetingTimeSlot as { start?: unknown; end?: unknown } | undefined;
      const attendeeAvailability = Array.isArray(s.attendeeAvailability)
        ? (s.attendeeAvailability as Array<Record<string, unknown>>).map((a) => {
            const ea = (a.attendee as { emailAddress?: { address?: string } } | undefined)?.emailAddress;
            return {
              attendee: ea?.address,
              availability: a.availability as string | undefined,
            };
          })
        : [];
      return {
        confidence: s.confidence,
        organizerAvailability: s.organizerAvailability as string | undefined,
        start: slot?.start,
        end: slot?.end,
        attendeeAvailability,
      };
    });

    const filtered = projected.filter((s) => {
      if (!s.organizerAvailability || !acceptable.has(s.organizerAvailability)) return false;
      return s.attendeeAvailability.every(
        (a) => a.availability !== undefined && acceptable.has(a.availability)
      );
    });

    return {
      attendees: args.attendees,
      durationMinutes: args.meetingDurationMinutes,
      acceptTentative: args.acceptTentative,
      emptySuggestionsReason: result.emptySuggestionsReason ?? null,
      candidatesFromGraph: raw.length,
      droppedDueToConflicts: raw.length - filtered.length,
      suggestions: filtered,
    };
  }
);
