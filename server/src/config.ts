import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const Schema = z.object({
  AZURE_TENANT_ID: z.string().uuid(),
  AZURE_CLIENT_ID: z.string().uuid(),
  CERT_PRIVATE_KEY_PATH: z.string().min(1),
  CERT_THUMBPRINT: z.string().regex(/^[0-9A-F]+$/i),
  OAUTH_REDIRECT_URI: z.string().url(),
  PORT: z.coerce.number().int().positive().default(8787),
  TOKEN_STORE_PATH: z.string().default("./.local/tokens.json"),
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
