import express from "express";
import crypto from "node:crypto";
import { msal, SCOPES } from "./msal-client.js";
import { newPkce, type PkcePair } from "./pkce.js";
import { config } from "../config.js";

type Pending = { pkce: PkcePair; createdAt: number };
const pending = new Map<string, Pending>();

setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of pending) {
    if (v.createdAt < cutoff) pending.delete(k);
  }
}, 60 * 1000).unref();

export const oauthRouter = express.Router();

oauthRouter.get("/login", async (_req, res, next) => {
  try {
    const state = crypto.randomBytes(16).toString("base64url");
    const pkce = newPkce();
    pending.set(state, { pkce, createdAt: Date.now() });

    const url = await msal.getAuthCodeUrl({
      scopes: [...SCOPES],
      redirectUri: config.OAUTH_REDIRECT_URI,
      state,
      codeChallenge: pkce.challenge,
      codeChallengeMethod: pkce.method,
      prompt: "select_account",
    });
    res.redirect(url);
  } catch (e) {
    next(e);
  }
});

oauthRouter.get("/callback", async (req, res, next) => {
  try {
    if (req.query.error) {
      res
        .status(400)
        .send(`OAuth error: ${req.query.error} — ${req.query.error_description ?? ""}`);
      return;
    }
    const code = req.query.code;
    const state = req.query.state;
    if (typeof code !== "string" || typeof state !== "string") {
      res.status(400).send("Missing code or state.");
      return;
    }
    const session = pending.get(state);
    if (!session) {
      res.status(400).send("Unknown or expired state — restart sign-in.");
      return;
    }
    pending.delete(state);

    const result = await msal.acquireTokenByCode({
      code,
      scopes: [...SCOPES],
      redirectUri: config.OAUTH_REDIRECT_URI,
      codeVerifier: session.pkce.verifier,
    });
    if (!result?.account) {
      res.status(500).send("Auth code exchange returned no account.");
      return;
    }
    res.type("html").send(`<!doctype html>
<html><body style="font-family:system-ui;padding:2rem;max-width:40rem">
  <h1>Signed in as ${escapeHtml(result.account.username)}</h1>
  <p>Token cached. You can close this tab and call MCP tools now.</p>
  <p style="color:#666"><small>Scopes granted: ${[...SCOPES].join(", ")}</small></p>
</body></html>`);
  } catch (e) {
    next(e);
  }
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}
