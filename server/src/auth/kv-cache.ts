import { SecretClient } from "@azure/keyvault-secrets";
import { DefaultAzureCredential } from "@azure/identity";
import type { ICachePlugin, TokenCacheContext } from "@azure/msal-node";
import { config } from "../config.js";

const SECRET_NAME = "msal-token-cache";

let cachedClient: SecretClient | undefined;
function getClient(): SecretClient {
  if (!cachedClient) {
    if (!config.KV_NAME) {
      throw new Error("KV_NAME not set — cannot use KV-backed token cache.");
    }
    // Container App env has AZURE_CLIENT_ID set to the Entra app reg's
    // client ID, which DefaultAzureCredential would otherwise misinterpret
    // as the managed identity's client ID. Pass MANAGED_IDENTITY_CLIENT_ID
    // explicitly when set.
    const credential = new DefaultAzureCredential(
      config.MANAGED_IDENTITY_CLIENT_ID
        ? { managedIdentityClientId: config.MANAGED_IDENTITY_CLIENT_ID }
        : undefined
    );
    cachedClient = new SecretClient(
      `https://${config.KV_NAME}.vault.azure.net`,
      credential
    );
  }
  return cachedClient;
}

export const kvPersistencePlugin: ICachePlugin = {
  beforeCacheAccess: async (ctx: TokenCacheContext) => {
    try {
      const secret = await getClient().getSecret(SECRET_NAME);
      if (secret.value) ctx.tokenCache.deserialize(secret.value);
    } catch (e) {
      const err = e as { code?: string; statusCode?: number };
      if (err.code === "SecretNotFound" || err.statusCode === 404) return;
      throw e;
    }
  },
  afterCacheAccess: async (ctx: TokenCacheContext) => {
    if (ctx.cacheHasChanged) {
      await getClient().setSecret(SECRET_NAME, ctx.tokenCache.serialize());
    }
  },
};
