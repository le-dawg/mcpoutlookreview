# Fase 5 — Cowork connector-registrering + pilot

Mål: registrér MCP-serveren som custom connector i Claude Cowork, onboard 2 pilot-brugere (Kasper, Dawid) ud over J selv, og verificér end-to-end at Claude rent faktisk kan kalde tools på vegne af de individuelle brugere.

## Multi-user-model

For pilot stoler vi på Cowork's authentication: Cowork har allerede valideret brugeren mod Anthropic, og sender deres email videre til vores MCP-server som en header (`X-MCP-User`). Serveren bruger den header til at slå brugerens MSAL-token op i Key Vault.

Sikkerheden hviler på at **kun Cowork har bearer-tokenet** (`MCP_AUTH_TOKEN`). Uden tokenet kan ingen kalde `/mcp`, så ingen kan spoofe headeren udefra.

Fremtidige hærdninger (Fase 7+):
- JWT-validering af user identity fra Cowork
- Per-bruger OAuth-tokens via MCP-spec OAuth-flow
- IP-allowlist hvis Cowork har stabile udgående IPs

## Pilot-onboarding (per bruger)

Hver pilot-bruger skal gennem disse trin **én gang**, før Cowork kan handle på deres vegne:

### 1. Personlig OAuth-login

Brugeren åbner i deres egen browser:
> https://outlook.mcp.ai-raadgivning.dk/auth/login

Logger ind med deres M365-konto (`kasper@ai-raadgivning.dk`, `dawid@ai-raadgivning.dk`). Side viser "Signed in as ...".

Effekt: deres MSAL-tokens (access + refresh) gemmes i Key Vault under den fælles `msal-token-cache` secret, keyed pr. brugerens AAD homeAccountId.

### 2. Cowork connector installeres

Brugeren logger ind i Claude Cowork, går til Connectors / Marketplace, finder "AIR Outlook" (efter Cowork-admin har registreret den per nedenfor), og klikker **Connect**.

Cowork har nu connectoren tilgængelig i samtaler.

## Cowork-admin: registrering af custom connector

Logget ind som org-admin i Claude Cowork:

1. **Settings → Connectors → Custom connectors → + New**

2. Udfyld:
   | Felt | Værdi |
   |---|---|
   | Name | `AIR Outlook` |
   | Description | `Læs/skriv egen Outlook mail og kalender + læs kollegers kalender` |
   | MCP server URL | `https://outlook.mcp.ai-raadgivning.dk/mcp` |
   | Auth type | Bearer token |
   | Bearer token | *(værdien fra `out/mcp-auth-token.txt`)* |
   | User identity header | `X-MCP-User` |
   | User identity value | `{{user.email}}` *(Cowork's template-syntax for den authenticated brugers email)* |

   Note: feltnavne kan variere — Cowork-UI'et har formentligt et "custom headers"-felt hvor du tilføjer `X-MCP-User: {{user.email}}`.

3. **Test connection** — Cowork bør slå op mod `/mcp` med en `initialize`-call og se 12 tools.

4. **Save** og evt. **Publish to org marketplace**.

5. Tilføj pilot-brugere (kun J, Kasper, Dawid) til adgangslisten indtil pilot er valideret. Org-wide kommer i Fase 6.

## Smoke test af pilot

I Claude Cowork, som **Kasper**:

> *"Hvad har jeg i kalenderen i morgen?"*

Claude bør:
1. Kalde `list_calendar` mod MCP-serveren
2. Server logger audit-linje med `"user":"kasper@ai-raadgivning.dk"`
3. Returnerer Kaspers events (ikke Jacobs!)

Verificér i Log Analytics:

```bash
# tail audit-logs fra Container App
az containerapp logs show -g rg-claude-outlook-prod -n ca-claude-outlook-prod --tail 50 --type console \
  | grep '"kind":"audit"'
```

Hver linje skal vise det rigtige `user`-felt.

Test også:
- Kasper sender en mail som Kasper (ikke som Jacob)
- Kasper kan læse Dawids kalender (kollega-read pathen)
- Dawid kan IKKE læse Kaspers mail (ingen tool er programmeret til det)

## Når pilot er grøn

- Genstart `MCP_AUTH_TOKEN` (`openssl rand -hex 32` → opdater KV-secret + Cowork-config) hvis tokenet har været delt undervejs
- Tilføj resten af AIR til adgangslisten i Cowork
- Gå videre til Fase 6 (skill + plugin marketplace) for at lægge en AIR-tone og slash-commands ovenpå

## Hvis ting fejler

| Symptom | Mest sandsynlig årsag |
|---|---|
| Cowork-test viser "connection refused" eller 401 | Bearer token mismatch — tjek værdien i Cowork mod `out/mcp-auth-token.txt` |
| Tool-kald returnerer `AUTH_REQUIRED` | Brugeren har ikke gennemført step 1 (personlig OAuth) endnu |
| Tool-kald returnerer events fra forkert bruger | `X-MCP-User`-header ikke konfigureret i Cowork — alle requests defaulter til `DEV_USER_UPN` (Jacob) |
| `CALENDAR_NOT_SHARED` ved kollega-read | Phase 2 baseline ikke applied for den specifikke bruger — kør `set-calendar-baseline.ps1` igen |
