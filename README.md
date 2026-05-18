# claude-outlook-mcp

Org-scoped Claude Cowork integration for AI Rådgivning — gives every employee read+write on their own Outlook mail and calendar, and read-only access to colleagues' calendars.

Built because the official Microsoft 365 MCP connector is read-only. AIR needs write (send, reply, create events).

## Architecture (locked)zbkmxcg;lbmnxf;ogns
- Delegated OAuth 2.0 (Auth Code + PKCE) per user
- TypeScript MCP server, Node 20 LTS
- Hosting: Azure Container Apps (scale-to-zero)
- Secrets: Azure Key Vault via Managed Identity
- IaC: Bicep
- Distribution: Cowork plugin (skill + custom connector)
- Single-tenant Entra app, certificate auth (no client secret)

Full context, decisions, and phase plan: [`HANDOVER.md`](./HANDOVER.md).
Phase 1 quickstart: [`docs/kickoff.md`](./docs/kickoff.md).

## Hard rule

No user may ever access another user's mail. This applies in every version — never `Mail.*.Shared` scopes, never application permissions on mail, never shared mailboxes via this connector. Calendar cross-read is the only cross-user resource, and it is intentional.

## Repo layout

```
infra/
  modules/
    app-registration.bicep      # Phase 1: Entra app reg (Microsoft.Graph extension)
scripts/
  generate-cert.sh              # Self-signed cert for app reg auth
  create-app-registration.ps1   # PowerShell fallback if Bicep extension unavailable
docs/
  kickoff.md                    # Phase 1 quickstart
HANDOVER.md                     # Full project context
```

## Status

Phase 0 (Discovery) complete. Phase 1 (Azure AD app registration) in progress.
Next checkpoint: J grants admin consent in the Entra portal after app reg is deployed.
