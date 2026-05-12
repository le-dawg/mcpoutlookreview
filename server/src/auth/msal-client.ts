import fs from "node:fs";
import { ConfidentialClientApplication, type Configuration } from "@azure/msal-node";
import { config } from "../config.js";
import { cachePlugin } from "./cache-factory.js";

function loadPrivateKey(): string {
  if (config.CERT_PRIVATE_KEY_PEM) return config.CERT_PRIVATE_KEY_PEM;
  if (config.CERT_PRIVATE_KEY_PATH) {
    return fs.readFileSync(config.CERT_PRIVATE_KEY_PATH, "utf8");
  }
  throw new Error(
    "Neither CERT_PRIVATE_KEY_PEM nor CERT_PRIVATE_KEY_PATH is set — cannot construct MSAL client."
  );
}

const msalConfig: Configuration = {
  auth: {
    clientId: config.AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${config.AZURE_TENANT_ID}`,
    clientCertificate: {
      thumbprint: config.CERT_THUMBPRINT,
      privateKey: loadPrivateKey(),
    },
  },
  cache: {
    cachePlugin,
  },
};

export const msal = new ConfidentialClientApplication(msalConfig);

export const SCOPES = [
  "Mail.ReadWrite",
  "Mail.Send",
  "MailboxSettings.ReadWrite",
  "Calendars.ReadWrite",
  "Calendars.Read.Shared",
  "User.Read",
  "offline_access",
] as const;
