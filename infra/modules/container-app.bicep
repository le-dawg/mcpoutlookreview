@description('Container App name.')
param name string

@description('Location.')
param location string

@description('Container Apps Environment resource ID.')
param environmentId string

@description('Image to deploy (fully qualified).')
param image string

@description('Resource ID of the user-assigned managed identity.')
param managedIdentityId string

@description('ACR login server (e.g. crairoutlookprod.azurecr.io). Used to wire the registry credentials to the managed identity.')
param acrLoginServer string

@description('Key Vault name to source secrets from.')
param keyVaultName string

@description('Entra app reg client ID.')
param azureClientId string

@description('Entra tenant ID.')
param azureTenantId string

@description('Cert thumbprint.')
param certThumbprint string

@description('Dev user UPN.')
param devUserUpn string

@description('Custom domain (empty string skips the binding).')
param customDomain string

@description('Client ID of the user-assigned managed identity (NOT the resource ID, NOT the principal ID — the clientId).')
param managedIdentityClientId string

var keyVaultBaseUrl = 'https://${keyVaultName}${environment().suffixes.keyvaultDns}/secrets'
var oauthRedirectUri = empty(customDomain)
  ? ''
  : 'https://${customDomain}/auth/callback'

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentityId}': {}
    }
  }
  properties: {
    environmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8787
        transport: 'auto'
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
        // customDomains intentionally NOT set in Bicep — managed via
        // `az containerapp hostname add/bind` after DNS is in place.
        // Re-running this template will preserve existing bindings as long
        // as we don't write the customDomains key here.
      }
      registries: [
        {
          server: acrLoginServer
          identity: managedIdentityId
        }
      ]
      secrets: [
        {
          name: 'cert-private-key-pem'
          keyVaultUrl: '${keyVaultBaseUrl}/cert-private-key-pem'
          identity: managedIdentityId
        }
        {
          name: 'mcp-auth-token'
          keyVaultUrl: '${keyVaultBaseUrl}/mcp-auth-token'
          identity: managedIdentityId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'outlook-mcp'
          image: image
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'AZURE_TENANT_ID', value: azureTenantId }
            { name: 'AZURE_CLIENT_ID', value: azureClientId }
            { name: 'CERT_THUMBPRINT', value: certThumbprint }
            { name: 'CERT_PRIVATE_KEY_PEM', secretRef: 'cert-private-key-pem' }
            { name: 'MCP_AUTH_TOKEN', secretRef: 'mcp-auth-token' }
            { name: 'OAUTH_REDIRECT_URI', value: oauthRedirectUri }
            { name: 'KV_NAME', value: keyVaultName }
            { name: 'MANAGED_IDENTITY_CLIENT_ID', value: managedIdentityClientId }
            { name: 'DEV_USER_UPN', value: devUserUpn }
            { name: 'PORT', value: '8787' }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/health', port: 8787 }
              initialDelaySeconds: 15
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: { path: '/health', port: 8787 }
              initialDelaySeconds: 5
              periodSeconds: 10
              timeoutSeconds: 3
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 3
        rules: [
          {
            name: 'http-rule'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }
}

output id string = app.id
output name string = app.name
output fqdn string = app.properties.configuration.ingress.fqdn
