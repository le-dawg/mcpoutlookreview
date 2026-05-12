import fs from "node:fs";
import { ConfidentialClientApplication, type Configuration } from "@azure/msal-node";
import { config } from "../config.js";
import { filePersistencePlugin } from "./token-cache.js";

const privateKey = fs.readFileSync(config.CERT_PRIVATE_KEY_PATH, "utf8");

const msalConfig: Configuration = {
  auth: {
    clientId: config.AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${config.AZURE_TENANT_ID}`,
    clientCertificate: {
      thumbprint: config.CERT_THUMBPRINT,
      privateKey,
    },
  },
  cache: {
    cachePlugin: filePersistencePlugin,
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
