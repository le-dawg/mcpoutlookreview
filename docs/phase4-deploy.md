# Fase 4 — Azure deploy

Producerer: `rg-claude-outlook-prod` med Log Analytics, Key Vault, ACR, Container Apps Environment, Container App (med user-assigned managed identity), custom domain `mcp.ai-raadgivning.dk`.

Den valgte sti er **Bicep + manuel deploy**. GitHub Actions-workflow'en (`.github/workflows/deploy.yml`) håndterer kun image-build + rolling update efter førstegangs-deploy. Førstegangs-deploy gør du selv med `az deployment sub create`.

## Forudsætninger

Engangs-installer:

```bash
brew install azure-cli
az login --tenant 9de3d9c3-b0bb-4d2e-93ab-f6407a8b3793
az account set --subscription "<din subscription>"
```

Ingen lokal Docker krævet — vi bruger `az acr build` der bygger i Azure Container Registry direkte.

Forudsætninger fra tidligere faser:
- Fase 1: Entra app reg `4c797321-edf4-4382-b455-4501cd87c8c0` med cert credential
- Cert: `out/cert/claude-outlook-mcp.key` (PEM private key, lokalt)
- Fase 2: Kalender-baseline applied

## Trin 1 — generér MCP auth-token

Til bearer auth på `/mcp` i prod:

```bash
openssl rand -hex 32
```

Gem værdien lokalt (du skal bruge den både til Bicep-deploy og til Cowork connector-konfig i Fase 5).

## Trin 2 — første deployment (placeholder-image)

Container App'en oprettes med Microsofts hello-world image som placeholder. Det er for at gennemføre hele infrastrukturen — ACR oprettes også, så vi kan pushe det rigtige image bagefter.

```bash
cd ~/projects/outlook-connector-air

az deployment sub create \
  --location westeurope \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam \
  --parameters certPrivateKeyPem=@./out/cert/claude-outlook-mcp.key \
               mcpAuthToken=<token fra trin 1>
```

Output indeholder:
- `appFqdn` — Container App's default FQDN (`...azurecontainerapps.io`)
- `appName` — fx `ca-claude-outlook-prod`
- `keyVaultName` — fx `kv-airoutlook-prod`
- `acrLoginServer` — fx `crairoutlookprod.azurecr.io`

**Forventet runtime:** 4-8 min.

## Trin 3 — build og push det rigtige image

ACR-name er `acrLoginServer` minus `.azurecr.io`-suffixet (fx `crairoutlookprod`). `az acr build` uploader `server/`-mappen til ACR og bygger imaget i skyen — ingen lokal Docker nødvendig.

```bash
ACR_NAME=<acrLoginServer fra trin 2, uden .azurecr.io>

cd server
az acr build \
  --registry "$ACR_NAME" \
  --image outlook-mcp:v0.1.0 \
  --image outlook-mcp:latest \
  .
```

Forventet runtime: 3-5 min.

Opdater Container App'en til at bruge det:

```bash
az containerapp update \
  --resource-group rg-claude-outlook-prod \
  --name ca-claude-outlook-prod \
  --image "$ACR_LOGIN/outlook-mcp:v0.1.0"
```

Tjek logs:

```bash
az containerapp logs show \
  --resource-group rg-claude-outlook-prod \
  --name ca-claude-outlook-prod \
  --follow
```

Forventet output: `outlook-mcp listening on port 8787` + `Token cache: Key Vault (kv-airoutlook-prod)`.

Verificér health:

```bash
APP_FQDN=$(az containerapp show -g rg-claude-outlook-prod -n ca-claude-outlook-prod --query properties.configuration.ingress.fqdn -o tsv)
curl -sf "https://$APP_FQDN/health"
# { "status": "ok", "version": "0.1.0" }
```

## Trin 4 — custom domain (mcp.ai-raadgivning.dk)

> **Bicep redeploy advarsel:** `infra/main.bicep` administrerer **ikke** custom-domain-bindingen. Du opretter den via `az containerapp hostname add/bind` her i Trin 4. Efterfølgende `az deployment sub create`-kørsler bevarer bindingen, fordi Bicep'en *ikke* nævner `customDomains` (omitting = preserve eksisterende state). MEN: ændrer du Bicep'en til at sætte `customDomains: []` eller andet eksplicit, ryger bindingen. Bind igen med `az containerapp hostname bind` hvis det sker.

DNS skal være på plads før Azure kan validere ejerskab og udstede et managed cert.

1. Hent verification target:
   ```bash
   az containerapp show -g rg-claude-outlook-prod -n ca-claude-outlook-prod \
     --query properties.configuration.ingress.fqdn -o tsv
   ```
   Output: noget i stil med `ca-claude-outlook-prod.salmonsand-xyz.westeurope.azurecontainerapps.io`.

2. Hent custom-domain-verification ID:
   ```bash
   az containerapp env show -g rg-claude-outlook-prod \
     -n cae-claude-outlook-prod --query properties.customDomainConfiguration.customDomainVerificationId -o tsv
   ```

3. Tilføj DNS records i GoDaddy:
   - **CNAME**: `mcp` → `<container app FQDN fra punkt 1>`
   - **TXT**: `asuid.mcp` → `<verification id fra punkt 2>`

4. Vent på DNS-propagation:
   ```bash
   dig +short mcp.ai-raadgivning.dk CNAME
   dig +short asuid.mcp.ai-raadgivning.dk TXT
   ```
   Begge skal returnere de værdier du satte. Kan tage minutter til timer.

5. Bind domænet og bestil managed cert:
   ```bash
   az containerapp hostname add \
     -g rg-claude-outlook-prod \
     -n ca-claude-outlook-prod \
     --hostname mcp.ai-raadgivning.dk

   az containerapp hostname bind \
     -g rg-claude-outlook-prod \
     -n ca-claude-outlook-prod \
     --hostname mcp.ai-raadgivning.dk \
     --environment cae-claude-outlook-prod \
     --validation-method CNAME
   ```

6. Cert udstedes automatisk (Let's Encrypt). Tager 1-5 min. Verificér:
   ```bash
   curl -sf https://mcp.ai-raadgivning.dk/health
   ```

## Trin 5 — log ind som dev-user mod prod

OAuth-flow'et fungerer samme måde som lokalt, bare mod `https://mcp.ai-raadgivning.dk/auth/login`. Token cachet i Key Vault (via MSAL-pluginnet).

```bash
# Åbn i browser
open https://mcp.ai-raadgivning.dk/auth/login
```

Log ind som `jacob@ai-raadgivning.dk`. Resulterende token gemmes i KV-secret `msal-token-cache`.

## Trin 6 — smoke test mod prod

```bash
TOKEN=<mcp-auth-token fra trin 1>

SID=$(curl -s -D - -X POST https://mcp.ai-raadgivning.dk/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' \
  -o /dev/null | grep -i '^mcp-session-id:' | awk '{print $2}' | tr -d '\r\n')

curl -s -X POST https://mcp.ai-raadgivning.dk/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "Authorization: Bearer $TOKEN" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

curl -s -X POST https://mcp.ai-raadgivning.dk/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "Authorization: Bearer $TOKEN" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"whoami","arguments":{}}}'
```

## Trin 7 — opsæt CI/CD (valgfrit, kan vente)

Workflow'et i `.github/workflows/deploy.yml` bygger image + opdaterer Container App'en på push til main. Kræver tre GitHub Actions secrets på repoet:

- `AZURE_TENANT_ID` — `9de3d9c3-b0bb-4d2e-93ab-f6407a8b3793`
- `AZURE_SUBSCRIPTION_ID` — din subscription
- `AZURE_CLIENT_ID_CI` — *separat* Entra app reg med Federated Credential mod GitHub OIDC. Skal have `AcrPush` på ACR og `Contributor` på resource group.

Opsætning af det er en lille sub-opgave i sig selv — vi tager den når førstegangs-deploy er stabil.

## Hvad ændrer sig sammenlignet med lokal udvikling

| | Lokal | Prod |
|---|---|---|
| Token cache | File (`server/.local/tokens.json`) | Key Vault secret `msal-token-cache` |
| Private key | File (`out/cert/claude-outlook-mcp.key`) | Env var `CERT_PRIVATE_KEY_PEM` (sourced from KV) |
| `/mcp` auth | Ingen | Bearer token i `Authorization` header |
| Redirect URI | `http://localhost:8787/auth/callback` | `https://mcp.ai-raadgivning.dk/auth/callback` |

Begge redirect URIs er allerede registreret på app reg'en (Fase 1 added prod, milestone 1 added localhost).

## Roll-back

Hvis noget er galt efter et update:

```bash
# Se aktive revisions
az containerapp revision list -g rg-claude-outlook-prod -n ca-claude-outlook-prod -o table

# Skift trafik tilbage til foregående revision
az containerapp revision set-mode \
  -g rg-claude-outlook-prod -n ca-claude-outlook-prod \
  --mode multiple

az containerapp ingress traffic set \
  -g rg-claude-outlook-prod -n ca-claude-outlook-prod \
  --revision-weight <previous-revision-name>=100
```

For at slette hele opsætningen (development clean):
```bash
az group delete --name rg-claude-outlook-prod --yes
```
*KV har soft-delete + purge protection (7 dages retention). Du kan ikke umiddelbart genskabe samme KV-navn før det er purged.*

## Forventet månedlig pris

| Komponent | DKK/md |
|---|---|
| Container Apps (scale-to-zero, ~lavt forbrug) | 50-100 |
| ACR Basic | 35 |
| Key Vault | 2-5 |
| Log Analytics (under 1 GB/dag) | 15-30 |
| Managed cert + DNS | 0 |
| **Total** | **~100-170 DKK/md** |

Matcher HANDOVER §7 budget.
