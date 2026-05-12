# Handover — Claude for Outlook (AI Rådgivning)

**Status:** Fase 0 (Discovery) afsluttet. Klar til Fase 1 (Azure AD app registration) så snart GitHub-repo er oprettet.
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
MCP-domæne:        mcp.ai-raadgivning.dk (CNAME via GoDaddy)
CI/CD:             GitHub Actions
Auth til app reg:  Certificate (ikke client secret)
Kollega-kalender:  Reviewer (fuld detalje)
Multi-tenant:      Nej
```

---

## 5. De 7 faser

| # | Fase | Hvad leveres | Checkpoint? |
|---|---|---|---|
| 0 | **Discovery** | Beslutninger ovenfor, kickoff-doc | — |
| 1 | **Azure AD app registration** | Bicep-modul + PowerShell fallback + certifikat, 7 Graph-scopes (delegated) | ⏸ Før "Grant admin consent" i Entra |
| 2 | **Exchange kalender-baseline** | `set-calendar-baseline.ps1` + scheduled runbook (ugentligt) | ⏸ Før non-dry kørsel — skal socialiseres med ledelse først |
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

**Blokkeret på:** GitHub CLI re-auth hos J. Token i keyring er udløbet.

Når J kører:
```
gh auth login -h github.com -s "repo,read:org,workflow" -w
```

…så starter Claude Code:

1. Initialiserer lokalt git-repo
2. Opretter privat repo `github.com/solution8-com/claude-outlook-mcp`
3. Committer Fase 1-artefakter:
   - `infra/modules/app-registration.bicep`
   - `scripts/create-app-registration.ps1`
   - `scripts/generate-cert.sh`
   - `docs/kickoff.md`
   - `.gitignore`, `README.md`
4. Pusher til main
5. Stopper ved **checkpoint #1** — J klikker "Grant admin consent for AI Rådgivning" i Entra-portalen

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
