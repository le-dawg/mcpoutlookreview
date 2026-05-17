// Phase 4: subscription-scope deployment for the Claude for Outlook MCP server.
//
// Creates: resource group, Log Analytics workspace, Key Vault, container
// registry, Container Apps environment, user-assigned managed identity,
// Container App. Wires KV secrets + role assignments so the app can pull
// secrets via managed identity at runtime.
//
// Deploy:
//   az deployment sub create \
//     --location westeurope \
//     --template-file infra/main.bicep \
//     --parameters infra/main.bicepparam \
//     --parameters certPrivateKeyPem=@./out/cert/claude-outlook-mcp.key \
//                  mcpAuthToken=$(openssl rand -hex 32)

targetScope = 'subscription'

@description('Resource group name.')
param resourceGroupName string = 'rg-claude-outlook-prod'

@description('Azure region for all resources.')
param location string = 'westeurope'

@description('Environment short name (used in resource naming).')
param envName string = 'prod'

@description('Container image fully qualified (e.g. crxxx.azurecr.io/outlook-mcp:abc123). Pass a placeholder on first deploy if image is not yet built; update on a subsequent deploy.')
param containerImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

@description('Entra tenant ID (Phase 1 output).')
param azureTenantId string

@description('Entra app reg client ID (Phase 1 output).')
param azureClientId string

@description('Cert thumbprint as uploaded to the Entra app reg (Phase 1 output).')
param certThumbprint string

@description('Cert private key in PEM format. Stored in Key Vault. Pass via @file argument: -p certPrivateKeyPem=@./out/cert/claude-outlook-mcp.key')
@secure()
param certPrivateKeyPem string

@description('Shared bearer token clients must present on /mcp. Generate with `openssl rand -hex 32`. Stored in Key Vault.')
@secure()
param mcpAuthToken string

@description('UPN used as the single dev user until Cowork integration (Phase 5).')
param devUserUpn string

@description('Custom domain. The DNS CNAME must point at the container app FQDN before the binding succeeds.')
param customDomain string = 'mcp.ai-raadgivning.dk'

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
}

module mi 'modules/managed-identity.bicep' = {
  name: 'mi'
  scope: rg
  params: {
    name: 'id-claude-outlook-${envName}'
    location: location
  }
}

module la 'modules/log-analytics.bicep' = {
  name: 'la'
  scope: rg
  params: {
    name: 'log-claude-outlook-${envName}'
    location: location
  }
}

module kv 'modules/key-vault.bicep' = {
  name: 'kv'
  scope: rg
  params: {
    name: 'kv-airoutlook-${envName}'
    location: location
    secretsUserPrincipalId: mi.outputs.principalId
    certPrivateKeyPem: certPrivateKeyPem
    mcpAuthToken: mcpAuthToken
  }
}

module acr 'modules/container-registry.bicep' = {
  name: 'acr'
  scope: rg
  params: {
    name: 'crairoutlook${envName}'
    location: location
    acrPullPrincipalId: mi.outputs.principalId
  }
}

module env 'modules/container-app-env.bicep' = {
  name: 'env'
  scope: rg
  params: {
    name: 'cae-claude-outlook-${envName}'
    location: location
    logAnalyticsCustomerId: la.outputs.customerId
    logAnalyticsSharedKey: la.outputs.primarySharedKey
  }
}

module app 'modules/container-app.bicep' = {
  name: 'app'
  scope: rg
  params: {
    name: 'ca-claude-outlook-${envName}'
    location: location
    environmentId: env.outputs.id
    image: containerImage
    managedIdentityId: mi.outputs.id
    managedIdentityClientId: mi.outputs.clientId
    acrLoginServer: acr.outputs.loginServer
    keyVaultName: kv.outputs.name
    azureClientId: azureClientId
    azureTenantId: azureTenantId
    certThumbprint: certThumbprint
    devUserUpn: devUserUpn
    customDomain: customDomain
  }
}

output appFqdn string = app.outputs.fqdn
output appName string = app.outputs.name
output resourceGroup string = rg.name
output keyVaultName string = kv.outputs.name
output acrLoginServer string = acr.outputs.loginServer
output managedIdentityClientId string = mi.outputs.clientId
