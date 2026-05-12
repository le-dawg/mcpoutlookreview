import type { ICachePlugin } from "@azure/msal-node";
import { config } from "../config.js";
import { filePersistencePlugin } from "./token-cache.js";
import { kvPersistencePlugin } from "./kv-cache.js";

export const cachePlugin: ICachePlugin = config.KV_NAME
  ? kvPersistencePlugin
  : filePersistencePlugin;
