# Fase 3 — MCP-server (lokal udvikling)

Milestone 1 leverer:
- TypeScript MCP-server skeleton
- OAuth Auth Code + PKCE-flow med cert auth mod Entra app reg
- Token-cache der persisterer på tværs af restarts
- Én smoke-tool: `whoami` (kalder `/me` på Graph)

Det er nok til at bevise at pipelinen virker end-to-end. Milestone 2 (tool-surface) tilføjer de rigtige 11 tools.

## Engangsopgaver

### 1. Tilføj localhost-redirect URI til Entra app reg

Skal gøres én gang. I Entra-portalen:

- App registrations → *Claude for Outlook (AI Rådgivning)* → **Authentication**
- Under **Web → Redirect URIs**, klik **Add URI**
- Indtast: `http://localhost:8787/auth/callback`
- **Save** øverst

Bemærk: kun `localhost` (ikke `127.0.0.1`) accepteres som `http://` redirect af Entra. Alt andet skal være `https://`.

### 2. Installer Node dependencies

```bash
cd server
npm install
```

### 3. Konfigurér miljø

```bash
cp .env.example .env
```

`.env.example` er allerede udfyldt med tenant ID, app ID og cert thumbprint fra Fase 1. Tjek at `CERT_PRIVATE_KEY_PATH` peger på den rigtige fil (default: `../out/cert/claude-outlook-mcp.key`).

## Daglig kørsel

```bash
cd server
npm run dev
```

Output:
```
outlook-mcp listening on port 8787
  Health     : http://localhost:8787/health
  Sign in    : http://localhost:8787/auth/login
  MCP        : POST http://localhost:8787/mcp
  Dev user   : jacob@ai-raadgivning.dk
```

`tsx watch` reloader ved fil-ændringer.

## Smoke test

### 1. Log ind

Åbn <http://localhost:8787/auth/login> i en browser → log ind som `jacob@ai-raadgivning.dk` → siden viser "Signed in as ...".

Token cachet til `server/.local/tokens.json` (gitignored). Næste kørsel læser det automatisk — du behøver ikke logge ind igen før refresh token udløber (~90 dage).

### 2. Kald MCP-protokollen

Initialize en session:

```bash
curl -i -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

Response indeholder en `mcp-session-id` response header. Gem den:

```bash
SID=<paste session id>
```

List tools:

```bash
curl -s -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

Kald whoami:

```bash
curl -s -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"whoami","arguments":{}}}'
```

Forventet output i `content[0].text`:
```json
{
  "upn": "jacob@ai-raadgivning.dk",
  "id": "<your AAD object id>",
  "displayName": "Jacob Dalhoff",
  "mail": "jacob@ai-raadgivning.dk",
  "userPrincipalName": "Jacob@ai-raadgivning.dk",
  "jobTitle": null
}
```

### 3. Alternativt — brug MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Connect to `http://localhost:8787/mcp` med transport type "Streamable HTTP". Du kan klikke tools/list og tools/call i UI'et.

## Arkitektur-noter

| Komponent | Beslutning |
|---|---|
| Transport | Streamable HTTP (per HANDOVER §3) — session via `mcp-session-id` header |
| Auth | Confidential client + cert auth + PKCE for code exchange (defense in depth) |
| Token cache | MSAL Node's built-in cache + custom file-persistence plugin |
| Multi-user | Milestone 1 bruger `DEV_USER_UPN` env var; multi-user identification kommer i Fase 5 (Cowork integration) |
| Local token file | `server/.local/tokens.json`, mode 0600, gitignored |

## Hvad kommer i milestone 2

11 tools:
- Mail (egen): `search_mail`, `read_mail`, `send_mail`, `create_draft`, `reply_to_thread`
- Kalender (egen): `list_calendar`, `create_event`, `update_event`, `delete_event`
- Kollega kalender: `read_colleague_calendar`, `find_meeting_slot`

Plus: per-bruger rate limit, struktureret audit-log, Graph-fejl-mapping (401 → AUTH_REQUIRED, 403 → CALENDAR_NOT_SHARED, 429 → respektér Retry-After).

## Hvis ting fejler

| Symptom | Sandsynlig årsag |
|---|---|
| `Invalid environment configuration` ved start | `.env` mangler en variabel — sammenlign med `.env.example` |
| `AADSTS50011: The reply URL specified in the request does not match` | Localhost-redirect ikke tilføjet til app reg — se engangsopgave 1 |
| `AADSTS700016: Application not found in directory` | Forkert `AZURE_TENANT_ID` eller `AZURE_CLIENT_ID` i `.env` |
| `Error reading private key` | `CERT_PRIVATE_KEY_PATH` peger på en fil der ikke findes — kør `scripts/generate-cert.sh` igen |
| `AUTH_REQUIRED: no cached token` ved tool-kald | Du har ikke været på `/auth/login` endnu, eller `.local/tokens.json` blev slettet |
