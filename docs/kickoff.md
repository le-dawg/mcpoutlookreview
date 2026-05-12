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
- 🟡 Fase 1 — Entra app registration *(her)*
- ⚪ Fase 2 — Exchange kalender-baseline (Reviewer på `\Calendar`)
- ⚪ Fase 3 — MCP-server (TypeScript)
- ⚪ Fase 4 — Azure deploy (Container Apps, Key Vault, custom domain)
- ⚪ Fase 5 — Cowork connector-registrering + pilot
- ⚪ Fase 6 — Skill + plugin til marketplace
- ⚪ Fase 7 — Governance & handoff

## Fase 1 — sådan kører du det

### 1. Forudsætninger (engangs)

```bash
brew install azure-cli
brew install --cask powershell      # kun nødvendigt hvis du bruger PS-fallback
# openssl følger med macOS
az login --tenant 9de3d9c3-b0bb-4d2e-93ab-f6407a8b3793
```

### 2. Generér cert

```bash
./scripts/generate-cert.sh ./out/cert claude-outlook-mcp 365
```

Output:
- `./out/cert/claude-outlook-mcp.crt` — uploades til Entra (offentlig)
- `./out/cert/claude-outlook-mcp.key` — privat, skal i Key Vault før Fase 4
- `./out/cert/claude-outlook-mcp.pfx` — bundle, hvis runtime-loaderen kræver PKCS12

### 3. Deploy app registration

**Primær vej — Bicep (Microsoft.Graph extension):**

```bash
CERT_B64=$(base64 -i ./out/cert/claude-outlook-mcp.crt)

az deployment sub create \
  --location westeurope \
  --template-file infra/modules/app-registration.bicep \
  --parameters certificatePublicKey="$CERT_B64"
```

**Fallback — PowerShell (hvis Microsoft.Graph Bicep extension ikke kan loades):**

```bash
pwsh ./scripts/create-app-registration.ps1 \
  -CertPath ./out/cert/claude-outlook-mcp.crt
```

Begge veje opretter:
- Entra app reg `Claude for Outlook (AI Rådgivning)`, single-tenant
- De 7 delegerede Graph-scopes (se nedenfor)
- Service principal
- Certifikat-credential på app reg

### 4. Checkpoint #1 — admin consent

Når deployment er færdig, åbn:

> Entra-portal → **App registrations** → *Claude for Outlook (AI Rådgivning)* → **API permissions** → **Grant admin consent for AI Rådgivning**

Indtil dette er gjort, kan ingen bruger OAuth'e mod app'en.

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
