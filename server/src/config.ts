import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const Schema = z.object({
  AZURE_TENANT_ID: z.string().uuid(),
  AZURE_CLIENT_ID: z.string().uuid(),
  CERT_THUMBPRINT: z.string().regex(/^[0-9A-F]+$/i),

  // One of these must be set — checked at runtime in msal-client.ts
  CERT_PRIVATE_KEY_PATH: z.string().optional(),
  CERT_PRIVATE_KEY_PEM: z.string().optional(),

  OAUTH_REDIRECT_URI: z.string().url(),
  PORT: z.coerce.number().int().positive().default(8787),

  // Token cache backend. If KV_NAME is set, use Key Vault. Else local file.
  KV_NAME: z.string().optional(),
  TOKEN_STORE_PATH: z.string().default("./.local/tokens.json"),

  // Client ID of the user-assigned managed identity attached to the Container
  // App. Used to disambiguate DefaultAzureCredential when AZURE_CLIENT_ID
  // is also set (to the Entra app reg). Required for KV access in prod.
  MANAGED_IDENTITY_CLIENT_ID: z.string().uuid().optional(),

  // Bearer auth on /mcp. If unset, no auth check (dev only).
  MCP_AUTH_TOKEN: z.string().optional(),

  // Single dev user for current multi-user-stub phase.
  DEV_USER_UPN: z.string().email(),
});

const parsed = Schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;
