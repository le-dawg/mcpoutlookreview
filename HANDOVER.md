# Handover — Claude for Outlook (AI Rådgivning)

**Status:** Fase 4 fuldført 2026-05-17. `https://outlook.mcp.ai-raadgivning.dk/health` live med managed cert. Den gamle `https://mcp.ai-raadgivning.dk` er stadig bundet parallelt indtil J har verificeret OAuth-flow + MCP-tools mod den nye URL — fjernes derefter. Mangler: J's OAuth-login mod prod-URL + end-to-end MCP-smoke test.
**Ejer:** J (Jacob Dalhoff) — `jacob@ai-raadgivning.dk`
**Implementering:** Claude Code kører teknisk eksekvering; J er Global Admin + Azure Owner.

---

## 1. Hvad bygger vi — og hvorfor?

AI Rådgivning (~15 medarbejdere) skal have en **organisations-dækkende Claude Cowork-integration** med Microsoft 365, så hver medarbejder i Claude kan:

1. Læse + skrive i **sin egen** Outlook-mailbox (send, svar, draft, flyt, flag, søg)
2. Læse + skrive i **sin egen** kalender (opret/opdater/slet events, svar på invitationer)
3. **Læse** alle kollegers kalendere (ingen skriveadgang)

Det officielle Microsoft 365 MCP-connector fra Anthropic er read-only — derfor bygger vi vores egen.

Leveres som et **Cowork-plugin** på AIR's interne marketplace: skill (tone, regler, slash-commands) + custom connector (MCP-server mod Graph).

---

## 2. Adgangsmodel — vigtigste regel

| | Egen mailbox | Kollegas mailbox | Egen kalender | Kollegas kalender |
|---|:---:|:---:|:---:|:---:|
| **Læs** | ✅ | ❌ | ✅ | ✅ (Reviewer, fuld detalje) |
| **Skriv** | ✅ | ❌ | ✅ | ❌ |

**Hård regel:** Ingen bruger kan nogensinde tilgå en anden brugers mail. Dette gælder i alle versioner — ikke kun v1. Ingen "assistent læser chefs indbakke", ingen delte indbakker, ingen `Mail.*.Shared` scopes, ingen application-permissions på mail.

Kalender er den eneste ressource med cross-user-læsning, og kun fordi det er et bevidst produktvalg (org-bred synlighed af kalenderdetaljer).

---

## 3. Arkitektur-beslutninger (låst — skal ikke genåbnes)

| Beslutning | Valg | Begrundelse |
|---|---|---|
| Auth-model | Delegeret OAuth 2.0 (Auth Code + PKCE) per bruger | Handlinger tilskrives rigtig bruger, rent audit trail |
| MCP-server sprog | TypeScript (Node 20 LTS) | Bedst vedligeholdte MCP SDK + Graph JS SDK |
| Hosting | Azure Container Apps | Scale-to-zero, billigst ved ~15 brugere |
| Secrets | Azure Key Vault (Managed Identity) | Per-bruger partitionering af refresh tokens |
| Token-refresh | Baggrundsworker før expiry; fejl → reconsent-flow | Brugere mærker ikke token-rotation |
| IaC | Bicep | Microsoft-native, kortere end Terraform for Azure |
| Kalender-deling | Exchange `MailboxFolderPermission` — `Default = Reviewer` på alle `\Calendar`-folders | Én central baseline frem for manuel deling |
| Distribution | Cowork plugin (skill + connector) | Skill håndhæver AIR-tone; connector installeres org-niveau |
| Transport | Streamable HTTP MCP | Understøtter auth headers, simpler end stdio |

**Eksplicit fravalgt:** n8n (skalerer ikke ved OAuth for 15+ brugere), application-permissions med app access policies (bredere angrebsflade), delt service-konto (intet per-bruger audit trail).

---

## 4. Fase 0 — bekræftede værdier

```
Tenant:            ai-raadgivning.dk (single tenant)
Tenant ID:         9de3d9c3-b0bb-4d2e-93ab-f6407a8b3793
Azure subscription: J = Owner
Resource group:    rg-claude-outlook-prod (westeurope)
Repo:              github.com/solution8-com/claude-outlook-mcp (privat)
MCP-domæne:        outlook.mcp.ai-raadgivning.dk (subdomæne under mcp.* namespace for fremtidige MCPer)
CI/CD:             GitHub Actions
Auth til app reg:  Certificate (ikke client secret)
Kollega-kalender:  Reviewer (fuld detalje)
Multi-tenant:      Nej
```

## 4d. Fase 4 — bekræftede værdier (2026-05-17)

Sub deployment til `MCPP Subscription` (`35cd9c6c-0c00-4efe-bd03-21549de140e4`) i `westeurope`. Bicep'en gennemgik to small-fix-iterations efter første deploy (BCP258 bicepparam-decls + ACR registry-wiring via MI).

```
Resource group        : rg-claude-outlook-prod
Container App         : ca-claude-outlook-prod
Default FQDN          : ca-claude-outlook-prod.bravepebble-9654e2dc.westeurope.azurecontainerapps.io
Custom domain target  : outlook.mcp.ai-raadgivning.dk (subdomæne — plads til linear.mcp, notion.mcp osv. senere)
Image                 : crairoutlookprod.azurecr.io/outlook-mcp:v0.1.0
Key Vault             : kv-airoutlook-prod (cert-private-key-pem, mcp-auth-token, msal-token-cache)
Container Registry    : crairoutlookprod.azurecr.io
Log Analytics         : log-claude-outlook-prod (1 GB/dag cap, 30 dages retention)
Managed Identity      : id-claude-outlook-prod
  - clientId          : 00f83490-27fc-4a82-9ab6-eb36b5a05062
  - rolle på KV       : Key Vault Secrets User
  - rolle på ACR      : AcrPull
Custom domain verification ID: 16B909AF9CDC568AD2CF579E563A370836A94977D71DA09F1B8758819385040B
MCP_AUTH_TOKEN        : lokalt i out/mcp-auth-token.txt (gitignored); kopi i KV som `mcp-auth-token`
Custom domain bundet  : ✅ outlook.mcp.ai-raadgivning.dk (managed cert `outlook-mcp-ai-raadgivning-dk`). Gammel mcp.ai-raadgivning.dk bundet parallelt (backwards compat) — fjernes når migration er verificeret.
Health check OK       : `curl https://outlook.mcp.ai-raadgivning.dk/health` → 200
Entra redirect URIs   : http://localhost:8787/auth/callback, https://mcp.ai-raadgivning.dk/auth/callback (deprecated), https://outlook.mcp.ai-raadgivning.dk/auth/callback (active)
OAUTH_REDIRECT_URI    : env var på Container App opdateret til outlook.mcp-variant (revision --0000002)
```

## 4c. Fase 2a — bekræftede værdier (2026-05-12)

Kalender-baseline kørt med `-Apply` mod produktion. Ingen errors, ingen skips.

```
Total user mailboxes : 10 (faktisk headcount; tidligere estimat ~15 var højt)
Pre-Apply state      : 4× AvailabilityOnly, 6× LimitedDetails, 0× Reviewer
Post-Apply state     : 10× Reviewer (Default-principalen på primær kalender)
Lokaler i scope      : Kalender (4 brugere, DK locale), Calendar (6 brugere, EN locale)
Rooms/shared/resource: korrekt sprunget over
```

Brugere kan markere events som `Private` i Outlook for at skjule detaljer ad hoc — Reviewer respekterer Private-flag.

## 4b. Fase 1 — bekræftede værdier (2026-05-12)

App registration oprettet via manuel clickthrough (`docs/phase1-manual.md`). Admin consent givet for alle 7 scopes.

```
App display name      : Claude for Outlook (AI Rådgivning)
App ID (client ID)    : 4c797321-edf4-4382-b455-4501cd87c8c0
Tenant                : 9de3d9c3-b0bb-4d2e-93ab-f6407a8b3793
Redirect URI          : https://mcp.ai-raadgivning.dk/auth/callback (Web platform). Bliver suppleret med outlook.mcp-variant under rename.
Sign-in audience      : AzureADMyOrg (single tenant)
Cert thumbprint (SHA1): 00EFA562B712661D3DA092803C99014C83A60B70
Cert algorithm        : RSA 2048
Cert expires          : ca. 2027-05-12 (rotation går i Fase 7 runbook)
Cert privat nøgle     : lokalt på J's maskine — flyttes til Key Vault i Fase 4
Admin consent         : ✅ alle 7 delegerede Graph-scopes
Client secret         : ingen (cert-only)
```

App ID og tenant ID er ikke hemmelige — de bruges direkte som config-parametre i Fase 3 og 4.

---

## 5. De 7 faser

| # | Fase | Hvad leveres | Checkpoint? | Status |
|---|---|---|---|---|
| 0 | **Discovery** | Beslutninger ovenfor, kickoff-doc | — | ✅ 2026-04-23 |
| 1 | **Azure AD app registration** | Bicep-modul + PowerShell fallback + certifikat, 7 Graph-scopes (delegated) | ⏸ Før "Grant admin consent" i Entra | ✅ 2026-05-12 |
| 2a | **Exchange kalender-baseline (manual)** | `set-calendar-baseline.ps1` applied mod alle user mailboxes | ⏸ Før non-dry kørsel — skal socialiseres med ledelse først | ✅ 2026-05-12 |
| 2b | **Scheduled runbook** | Cron der fanger nye medarbejdere ugentligt (kræver separat Entra app reg + cert) | — | ⚪ Pending |
| 3a | **MCP-server skeleton + auth** | TS-server, OAuth Auth Code + PKCE, MSAL cache, `whoami` smoke-tool | — | ✅ 2026-05-12 |
| 3b | **Tool surface** | 11 tools (mail+kalender), rate limit, audit log, Graph fejl-mapping | — | ✅ 2026-05-12 |
| 4 | **Azure deploy** | Bicep, Dockerfile, Container App + KV + ACR + LA, CI-skelet | ⏸ Før første `az deployment sub create` | ✅ 2026-05-17 (default FQDN; custom domain mangler DNS) |
| 3 | **MCP-server** | TypeScript-server med tool-endpoints: `send_email`, `create_draft`, `reply_to_thread`, `create_event`, `update_event`, `delete_event`, `read_colleague_calendar`, `find_meeting_slot` (+ mail-søgning/læsning på *egen* mailbox). OAuth-flow, Key Vault token-store, audit logging | — |
| 4 | **Deploy til Azure** | Bicep `main.bicep` → RG, Log Analytics, Container App, Key Vault, custom domain, managed cert | ⏸ Før første `az deployment sub create` i prod |
| 5 | **Registrering i Claude Cowork** | Custom connector i Cowork admin, pilot med J + 1–2 kolleger, derefter org-wide | ⏸ Før org-wide-aktivering (pilot skal være grøn) |
| 6 | **Skill + plugin** | `outlook-air` skill (tone, regler), slash-commands (`/draft-reply`, `/schedule`, `/inbox-triage`), plugin-manifest, push til marketplace | ⏸ Før push til marketplace |
| 7 | **Governance & handoff** | `RUNBOOK.md`: onboarding, offboarding (`revokeSignInSessions` + Key Vault cleanup), Conditional Access, token-lifetime, quarterly access review, on-call, DR-plan | — |

---

## 6. Graph-scopes (delegerede, single-tenant)

App'en beder om præcis disse — ikke mere:

- `Mail.ReadWrite` — egen mailbox
- `Mail.Send` — send på vegne af bruger
- `MailboxSettings.ReadWrite` — signatur, automatic replies
- `Calendars.ReadWrite` — egen kalender
- `Calendars.Read.Shared` — kollegers kalendre (læs)
- `User.Read` — baseline profil
- `offline_access` — refresh tokens

Ingen `.Shared` på mail. Ingen application permissions.

---

## 7. Budget

Groft estimat ved ~15 brugere:

| Komponent | ~DKK/md |
|---|---|
| Container Apps (scale-to-zero) | 50–100 |
| Key Vault | 2–5 |
| Log Analytics (audit) | 15–30 |
| Container Registry (Basic) | 35 |
| Managed TLS-cert | 0 |
| Entra app + DNS | 0 |
| **I alt** | **~100–170 DKK/md** (<$30) |

Ingen licens-omkostning oven i Microsoft 365 eller Claude Cowork.

---

## 8. Sikkerhed / governance (indbygget fra starten)

- **TLS only** — Container Apps erzwinger `allowInsecure: false`
- **Managed Identity** til Key Vault (ingen connection strings i env)
- **Per-bruger rate limit:** 60 Graph-kald/min (defense in depth vs 10k/10min tenant-limit)
- **Audit log** pr. tool-call → Log Analytics: user email, tool-navn, target, resultat-status
- **Token-refresh i baggrund** — blokerer aldrig brugerens request
- **Certificate auth** til app registration (ikke client secret), roteres årligt
- **Conditional Access** i Fase 7: kræv managed device + MFA for app'en
- **Offboarding:** Graph `revokeSignInSessions` + sletning af brugerens Key Vault-secrets

Error-handling konventioner:
- Graph 401 → invalidér token, returnér `AUTH_REQUIRED`
- Graph 403 på kollega-kalender → `CALENDAR_NOT_SHARED` med remediation-hint
- Graph 429 → respektér `Retry-After`, retry én gang
- Graph 5xx → eksponentiel backoff, 3 retries

---

## 9. Roller — hvem gør hvad

| Rolle | Person | Ansvar |
|---|---|---|
| Teknisk ejer | J | Alle Azure-deploys, app registration, consent-godkendelse, Cowork admin |
| Global Admin M365 | J (selv) | Admin consent i Entra, Exchange baseline-script |
| Azure Owner | J (selv) | Subscription, resource group, Key Vault-rettigheder |
| DNS | J via GoDaddy | Opret CNAME `mcp` → Container App FQDN når Fase 4 leverer target |
| Ledelse | [navn?] | Skal briefes før Fase 2 (kalender-baseline gør alle kalendre org-synlige) |
| On-call / drift efter go-live | [navn?] | Se Fase 7 runbook |

---

## 10. Success-kriterier

Ved projektets slutning:

- Hver AIR-medarbejder åbner Claude Cowork, klikker "Connect" på AIR Outlook-connector, OAuth'er gennem Entra én gang, og har fuld mail + egen kalender + kollega-kalender-læs.
- Admin kan se audit log af hvert tool-call i Log Analytics.
- Nye medarbejdere rulles automatisk på (kalender-baseline cron griber dem inden for en uge; connector er pre-approved).
- Azure-omkostning < $30/md ved nuværende headcount.
- Tid til pilot: ≤3 dage. Pilot → org-wide: ≤1 uge.

---

## 11. Lige nu — næste skridt

To åbne tråde — Fase 2b (cron) er valgfri og kan udsættes:

**Fase 2b (valgfri/parkeret):** Scheduled runbook der griber nye medarbejdere. Ved AIR's tempo (få nyansættelser/år) er det rimeligt at udsætte og bare køre `set-calendar-baseline.ps1` manuelt ved hver onboarding. Hvis vi vil have det automatiseret kræver det:
- Separat Entra app reg til Exchange-management (cert auth + `Exchange.ManageAsApp` + `Exchange Administrator` rolle)
- GitHub Actions workflow med cron + cert i repo secrets

**Fase 3 (primær næste):** TypeScript MCP-server — auth-flow, Key Vault token-store, tool-endpoints mod Graph, audit logging.

---

## 12. Åbne punkter til teamet

- **Hvem** skal på listen som on-call/drift-ansvarlig efter go-live? (Fase 7)
- **Hvem** skal briefes før Fase 2 kalender-baseline? (Kalender-detaljer bliver org-synlige — bevidst valg, men kræver leadership awareness.)
- **Teams chat/channel** er ude af scope for v1. Arkitekturen understøtter det senere; flag hvis nogen har stærke ønsker.
- **International udvidelse:** app'en er single-tenant. Hvis AIR nogensinde får folk på en anden tenant, kræver det app-ændring.

---

## Referencer

- Claude Cowork plugin + MCP dokumentation (Anthropic)
- Microsoft Graph API — `/me/messages`, `/me/events`, `/users/{id}/calendar`, `/me/findMeetingTimes`
- Azure Container Apps — custom domains, managed certs, managed identity
- Exchange Online PowerShell — `Set-MailboxFolderPermission`

---

*Dokument genereret af Claude Code under Fase 0. Opdateres efter hver fase.*
