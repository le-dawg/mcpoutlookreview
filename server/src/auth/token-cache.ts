import fs from "node:fs/promises";
import path from "node:path";
import type { ICachePlugin, TokenCacheContext } from "@azure/msal-node";
import { config } from "../config.js";

async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export const filePersistencePlugin: ICachePlugin = {
  beforeCacheAccess: async (ctx: TokenCacheContext) => {
    try {
      const data = await fs.readFile(config.TOKEN_STORE_PATH, "utf8");
      ctx.tokenCache.deserialize(data);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") throw err;
    }
  },
  afterCacheAccess: async (ctx: TokenCacheContext) => {
    if (ctx.cacheHasChanged) {
      await ensureDir(config.TOKEN_STORE_PATH);
      await fs.writeFile(config.TOKEN_STORE_PATH, ctx.tokenCache.serialize(), { mode: 0o600 });
    }
  },
};
