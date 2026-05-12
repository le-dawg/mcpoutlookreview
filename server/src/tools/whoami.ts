import { z } from "zod";
import { makeTool } from "./wrap.js";
import { graphFor } from "../graph/client.js";

const Input = z.object({});

export const whoami = makeTool(
  "whoami",
  "Returns the authenticated user's Microsoft profile (display name, UPN, mail, job title, id).",
  Input,
  async (_args, ctx) => {
    const me = await graphFor(ctx.upn).api("/me").get();
    return {
      upn: ctx.upn,
      id: me.id,
      displayName: me.displayName,
      mail: me.mail,
      userPrincipalName: me.userPrincipalName,
      jobTitle: me.jobTitle,
    };
  }
);
