import { msal, SCOPES } from "./msal-client.js";

export async function getAccessTokenForUser(upn: string): Promise<string> {
  const cache = msal.getTokenCache();
  const accounts = await cache.getAllAccounts();
  const account = accounts.find(
    (a) => a.username.toLowerCase() === upn.toLowerCase()
  );
  if (!account) {
    throw new Error(
      `AUTH_REQUIRED: no cached token for ${upn} — sign in at /auth/login first.`
    );
  }
  const result = await msal.acquireTokenSilent({
    account,
    scopes: [...SCOPES],
  });
  if (!result?.accessToken) {
    throw new Error(`AUTH_REQUIRED: silent token acquisition failed for ${upn}.`);
  }
  return result.accessToken;
}
