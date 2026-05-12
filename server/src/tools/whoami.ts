import { graphFor } from "../graph/client.js";
import { config } from "../config.js";

export const whoamiTool = {
  name: "whoami",
  description:
    "Returns the authenticated user's Microsoft profile (display name, UPN, mail, job title, id).",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
};

export async function whoamiHandler(_args: Record<string, unknown>) {
  const upn = config.DEV_USER_UPN;
  const me = await graphFor(upn).api("/me").get();
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            upn,
            id: me.id,
            displayName: me.displayName,
            mail: me.mail,
            userPrincipalName: me.userPrincipalName,
            jobTitle: me.jobTitle,
          },
          null,
          2
        ),
      },
    ],
  };
}
