# Kickoff — Claude for Outlook

## TL;DR

AI Rådgivning bygger en organisations-dækkende Claude Cowork-integration mod Microsoft 365: hver medarbejder får læs+skriv på sin egen Outlook mail og kalender, plus læs på kollegernes kalendere.

Hvorfor egen connector? Microsoft 365 MCP fra Anthropic er read-only. AIR har brug for write (send mail, opret events).

## Hård regel

Ingen bruger må nogensinde tilgå en anden brugers mail. Gælder i alle versioner — ikke `Mail.*.Shared`, ingen application permissions på mail, ingen delte indbakker gennem denne connector. Kalender-cross-read er undtagelsen og er et bevidst produktvalg.

## Locked architecture

| | |
|---|---|
| Auth | Delegeret OAuth (Auth Code + PKCE) per bruger |
| MCP-server | TypeScript, Node 20 LTS |
| Hosting | Azure Container Apps (scale-to-zero) |
| Secrets | Azure Key Vault via Managed Identity |
| IaC | Bicep (Microsoft.Graph extension til app reg) |
| Tenant | Single-tenant |
| App-auth | Certificate (ingen client secret) |
| Distribution | Cowork plugin: skill + custom connector |

Fuld kontekst: [`../HANDOVER.md`](../HANDOVER.md).

## Faser

- ✅ Fase 0 — Discovery
- ✅ Fase 1 — Entra app registration
- 🟡 Fase 2 — Exchange kalender-baseline (Reviewer på `\Calendar`) *(her — se [`phase2-calendar-baseline.md`](./phase2-calendar-baseline.md))*
- ⚪ Fase 3 — MCP-server (TypeScript)
- ⚪ Fase 4 — Azure deploy (Container Apps, Key Vault, custom domain)
- ⚪ Fase 5 — Cowork connector-registrering + pilot
- ⚪ Fase 6 — Skill + plugin til marketplace
- ⚪ Fase 7 — Governance & handoff

## Fase 1 — sådan kører du det

**Primær vej:** Manuel clickthrough i Entra-portalen. Den er hurtigere end at installere `az`/`pwsh` for én engangs-opsætning.

👉 Følg [`phase1-manual.md`](./phase1-manual.md) — ~10 min, inkluderer cert-generering og checkpoint #1.

**Alternativ (IaC):** Hvis du vil have app reg'en provisioneret via kode, er Bicep og PowerShell-fallback bevaret som referencer:
- `infra/modules/app-registration.bicep` — Microsoft.Graph Bicep extension (preview)
- `scripts/create-app-registration.ps1` — Graph PowerShell fallback

Begge filer beskriver præcis samme konfiguration som den manuelle guide — brug dem hvis du senere skal oprette app'en igen i en test-tenant eller automatisere efter en rotation.

## De 7 delegerede Graph-scopes

| Scope | Hvad det giver |
|---|---|
| `Mail.ReadWrite` | Egen mailbox — læs, draft, flyt, flag |
| `Mail.Send` | Send mail som brugeren |
| `MailboxSettings.ReadWrite` | Signatur, automatic replies |
| `Calendars.ReadWrite` | Egen kalender — opret, opdater, slet events |
| `Calendars.Read.Shared` | Kollegers kalendre (kun læs) |
| `User.Read` | Baseline profil til hvem-er-jeg |
| `offline_access` | Refresh tokens |

Ingen `.Shared` på mail. Ingen application permissions.
