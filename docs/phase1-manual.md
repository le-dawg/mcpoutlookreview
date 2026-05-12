# Fase 1 — Manuel app registration (clickthrough)

Denne guide er den **primære vej** til at oprette Entra-app'en. Klik dig igennem Entra-portalen mens du følger checklisten. Tager ~10 min.

Bicep- og PowerShell-versionerne (`infra/modules/app-registration.bicep`, `scripts/create-app-registration.ps1`) er bevaret som dokumentation af præcis hvad app'en skal indeholde — men de behøver ikke køres.

## 0. Forudsætning — generér cert

App'en skal autentificere med certifikat (ikke client secret — låst arkitektur).

```bash
./scripts/generate-cert.sh ./out/cert claude-outlook-mcp 365
```

Output:
- `./out/cert/claude-outlook-mcp.crt` — uploades til Entra i trin 4
- `./out/cert/claude-outlook-mcp.key` — privat, ryger i Key Vault i Fase 4
- `./out/cert/claude-outlook-mcp.pfx` — PKCS12 bundle til runtime

Begge `.key` og `.pfx` er gitignored. Lad dem ligge i `out/cert/` indtil Fase 4.

## 1. Opret app registration

1. Åbn <https://entra.microsoft.com> — log ind som `jacob@ai-raadgivning.dk`
2. Tjek at "Directory" i toppen er **AI Rådgivning** (tenant `9de3d9c3-b0bb-4d2e-93ab-f6407a8b3793`)
3. Venstre menu → **Applications** → **App registrations** → **+ New registration**
4. Udfyld:
   - **Name:** `Claude for Outlook (AI Rådgivning)`
   - **Supported account types:** `Accounts in this organizational directory only (AI Rådgivning only - Single tenant)`
   - **Redirect URI:**
     - Platform: `Web`
     - URI: `https://mcp.ai-raadgivning.dk/auth/callback`
5. **Register**

Når app'en er oprettet, lander du på dens Overview-side. **Noter:**
- Application (client) ID — kald den `APP_ID`
- Directory (tenant) ID — bør være `9de3d9c3-b0bb-4d2e-93ab-f6407a8b3793`
- Object ID — kald den `APP_OBJECT_ID`

Gem disse — Fase 3 (MCP-server) og Fase 4 (deploy) bruger dem.

## 2. Lås manifest-indstillinger ned

På app'ens venstre menu → **Manifest** (eller **Authentication**):

**Authentication-fanen:**
- Under **Implicit grant and hybrid flows**: lad både `Access tokens` og `ID tokens` være **slået fra** (vi bruger Auth Code + PKCE, ikke implicit)
- **Allow public client flows:** `No`
- **Supported account types:** bekræft `Accounts in this organizational directory only`
- **Front-channel logout URL:** tom

Klik **Save**.

## 3. Tilføj Microsoft Graph permissions

Venstre menu → **API permissions**.

Den default `User.Read` (delegated) er allerede tilføjet — lad den stå.

Klik **+ Add a permission** → **Microsoft Graph** → **Delegated permissions**, og tilføj følgende. Brug søgefeltet til at finde hver:

| Scope | Hvad det giver |
|---|---|
| `Mail.ReadWrite` | Egen mailbox — læs, draft, flyt, flag |
| `Mail.Send` | Send mail som brugeren |
| `MailboxSettings.ReadWrite` | Signatur, automatic replies |
| `Calendars.ReadWrite` | Egen kalender — opret/opdater/slet events |
| `Calendars.Read.Shared` | Kollegers kalendere (kun læs) |
| `offline_access` | Refresh tokens |

Klik **Add permissions**.

**Vigtigt — det der IKKE må stå på listen:**
- ❌ Noget under "Application permissions"
- ❌ `Mail.Read.Shared`, `Mail.ReadWrite.Shared`, `Mail.Send.Shared` (cross-user mail er forbudt)
- ❌ `Calendars.ReadWrite.Shared` (vi giver kun læs på kollega-kalendere)

Listen skal ende sådan her (7 delegerede, 0 application):

- `Calendars.Read.Shared` — Delegated
- `Calendars.ReadWrite` — Delegated
- `Mail.ReadWrite` — Delegated
- `Mail.Send` — Delegated
- `MailboxSettings.ReadWrite` — Delegated
- `offline_access` — Delegated
- `User.Read` — Delegated

## 4. Upload certifikat

Venstre menu → **Certificates & secrets** → fanen **Certificates** → **Upload certificate**.

1. Vælg filen: `./out/cert/claude-outlook-mcp.crt`
2. **Description:** `mcp-prod-cert`
3. **Upload**

Bekræft at:
- Thumbprint matcher det `generate-cert.sh` printede
- **Expires** står ca. 1 år frem
- Fanen **Client secrets** er **tom** — vi bruger ikke secrets

## 5. ⏸ Checkpoint #1 — Grant admin consent

Stadig på **API permissions**-siden:

1. Klik **Grant admin consent for AI Rådgivning**
2. Bekræft pop-up'en
3. Vent til "Status"-kolonnen viser **grønt flueben** for alle 7 scopes

Indtil dette er gjort, kan ingen bruger OAuth'e mod app'en — også selvom app reg'en er oprettet.

Hvis knappen er disabled: tjek at du er logget ind som **Global Admin** (du burde være det — `jacob@ai-raadgivning.dk` har Global Admin per memory).

## 6. Verificér

Tag screenshot eller noter ned:

```
App display name      : Claude for Outlook (AI Rådgivning)
Application (client) ID: <APP_ID>
Directory (tenant) ID  : 9de3d9c3-b0bb-4d2e-93ab-f6407a8b3793
Object ID              : <APP_OBJECT_ID>
Redirect URI           : https://mcp.ai-raadgivning.dk/auth/callback
Sign-in audience       : AzureADMyOrg (single tenant)
Cert thumbprint        : <fra generate-cert.sh>
Cert expires           : ~ et år frem
Admin consent granted  : ✅ alle 7 scopes
```

Send `APP_ID` og cert-thumbprint videre — så er Fase 1 lukket og vi er klar til Fase 2 (Exchange kalender-baseline).

## Hvis du laver fejl

App registrations kan oprettes igen — der er ingen "betaling" eller låsning. Hvis du klikker forkert:
- Slet app'en under **App registrations** → app'en → **Delete**
- Start forfra fra trin 1

Slettede app reg'er kan recoveres i 30 dage under **App registrations → Deleted applications** hvis du sletter den ved en fejl.
