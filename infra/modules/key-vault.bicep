@description('Key Vault name. Must be globally unique, 3-24 chars, alphanumeric + dashes.')
param name string

@description('Location.')
param location string

@description('Object ID of the user-assigned managed identity that needs to read secrets.')
#disable-next-line secure-secrets-in-params
param secretsUserPrincipalId string

@description('Cert private key (PEM) — stored as a secret.')
@secure()
param certPrivateKeyPem string

@description('Bearer token for /mcp — stored as a secret.')
@secure()
param mcpAuthToken string

@description('Tenant ID for the vault.')
param tenantId string = subscription().tenantId

// "Key Vault Secrets User" role — read-only secret access
var secretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: name
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
  }
}

resource certSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'cert-private-key-pem'
  properties: {
    value: certPrivateKeyPem
    contentType: 'application/x-pem-file'
  }
}

resource authTokenSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'mcp-auth-token'
  properties: {
    value: mcpAuthToken
    contentType: 'text/plain'
  }
}

resource secretsUserAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: kv
  name: guid(kv.id, secretsUserPrincipalId, secretsUserRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      secretsUserRoleId
    )
    principalId: secretsUserPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output id string = kv.id
output name string = kv.name
output vaultUri string = kv.properties.vaultUri
