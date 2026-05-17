import { AsyncLocalStorage } from "node:async_hooks";
import type { ToolCtx } from "../tools/wrap.js";

export const requestContext = new AsyncLocalStorage<ToolCtx>();
