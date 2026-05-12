# Fase 3 — MCP-server (lokal udvikling)

Milestone 1 + 2 leverer:
- TypeScript MCP-server med Streamable HTTP transport
- OAuth Auth Code + PKCE med cert auth mod Entra app reg
- Persisteret token-cache (MSAL Node file plugin)
- 12 tools: `whoami` + 11 produktions-tools (mail, kalender, kollega-kalender)
- Cross-cutting: per-bruger rate limit (60/min), struktureret audit-log, Graph fejl-mapping

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

## Tools

Alle tools tager JSON-args og returnerer JSON-resultat i `content[0].text`. Hvert kald emitterer en `{"kind":"audit",...}`-linje på stdout.

### Mail (egen mailbox)

| Tool | Hvad | Vigtige args |
|---|---|---|
| `search_mail` | Søg i indbakke/sent/drafts/archive | `query?`, `folder?='inbox'`, `top?=20`, `receivedAfter?`, `receivedBefore?` |
| `read_mail` | Hent fuld mail med body | `messageId`, `bodyFormat?='text'`, `includeAttachmentsMeta?=true` |
| `send_mail` | Send mail nu | `to[]`, `cc?`, `bcc?`, `subject`, `body`, `bodyType?='Text'` |
| `create_draft` | Opret kladde uden at sende | `to?`, `subject`, `body`, `bodyType?='Text'` |
| `reply_to_thread` | Svar på eksisterende mail | `messageId`, `body`, `replyAll?=false` |

### Kalender (egen)

| Tool | Hvad | Vigtige args |
|---|---|---|
| `list_calendar` | Events i tidsrum | `startDateTime`, `endDateTime`, `top?=50` |
| `create_event` | Opret event | `subject`, `start`, `end`, `timeZone?='Europe/Copenhagen'`, `attendees?`, `isOnlineMeeting?` |
| `update_event` | PATCH event | `eventId`, valgfri felter |
| `delete_event` | Slet/cancel event | `eventId`, `sendCancellations?=true` |

`start`/`end` er naive local datetime (uden Z/offset) — Graph fortolker dem ud fra `timeZone`-feltet. Eksempel: `"2026-05-15T10:00:00"` + `timeZone="Europe/Copenhagen"` = 10:00 dansk tid.

### Kollega-kalender

| Tool | Hvad | Vigtige args |
|---|---|---|
| `read_colleague_calendar` | Læs anden brugers kalender | `userEmail`, `startDateTime`, `endDateTime`, `top?=50` |
| `find_meeting_slot` | Find ledige slots på tværs af deltagere | `attendees[]`, `startWindow`, `endWindow`, `meetingDurationMinutes?=30`, `maxCandidates?=5` |

Forudsætter Fase 2 kalender-baseline. 403 fra Graph → `CALENDAR_NOT_SHARED`.

## Cross-cutting

- **Rate limit:** 60 kald/min per UPN. Overskrider → `RATE_LIMITED` med retry-tid.
- **Audit log:** strukturerede JSON-linier på stdout. Container Apps forwarder til Log Analytics i Fase 4.
- **Fejl-mapping:** Graph 401 → `AUTH_REQUIRED`, 403 (kalender) → `CALENDAR_NOT_SHARED`, 403 (andet) → `FORBIDDEN`, 404 → `NOT_FOUND`, 429 → `RATE_LIMITED`, 5xx → `UPSTREAM_ERROR`.
- **Input-validering:** Zod på alle tool-args. Forkert input → `INVALID_INPUT` med felt-detalje.

## Eksempel-kald

Forudsætter at du har `$SID` fra et tidligere `initialize`.

```bash
# Søg indbakke
curl -s -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_mail","arguments":{"query":"faktura","top":5}}}'

# List din kalender de næste 7 dage
START=$(date -u +%Y-%m-%dT%H:%M:%SZ); END=$(date -u -v+7d +%Y-%m-%dT%H:%M:%SZ)
curl -s -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SID" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"list_calendar\",\"arguments\":{\"startDateTime\":\"$START\",\"endDateTime\":\"$END\"}}}"

# Læs en kollegas kalender
curl -s -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SID" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"read_colleague_calendar\",\"arguments\":{\"userEmail\":\"kasper@ai-raadgivning.dk\",\"startDateTime\":\"$START\",\"endDateTime\":\"$END\"}}}"

# Find ledige slots
curl -s -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SID" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"find_meeting_slot\",\"arguments\":{\"attendees\":[\"kasper@ai-raadgivning.dk\"],\"startWindow\":\"$START\",\"endWindow\":\"$END\",\"meetingDurationMinutes\":30}}}"
```

## Hvad kommer næst (Fase 4)

- Dockerfile + Bicep til Container Apps deploy
- Key Vault-backet token-cache (erstatter file plugin)
- Multi-user identification (Cowork-header → UPN)
- Audit-log forwarded til Log Analytics
- Custom domain + managed cert

## Hvis ting fejler

| Symptom | Sandsynlig årsag |
|---|---|
| `Invalid environment configuration` ved start | `.env` mangler en variabel — sammenlign med `.env.example` |
| `AADSTS50011: The reply URL specified in the request does not match` | Localhost-redirect ikke tilføjet til app reg — se engangsopgave 1 |
| `AADSTS700016: Application not found in directory` | Forkert `AZURE_TENANT_ID` eller `AZURE_CLIENT_ID` i `.env` |
| `Error reading private key` | `CERT_PRIVATE_KEY_PATH` peger på en fil der ikke findes — kør `scripts/generate-cert.sh` igen |
| `AUTH_REQUIRED: no cached token` ved tool-kald | Du har ikke været på `/auth/login` endnu, eller `.local/tokens.json` blev slettet |
