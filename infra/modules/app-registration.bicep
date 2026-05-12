// Phase 1: Entra ID app registration for the Claude for Outlook MCP connector.
//
// Creates a single-tenant Entra app with:
//   - 7 delegated Microsoft Graph scopes (no application permissions, no .Shared mail scopes)
//   - Certificate credential (no client secret)
//   - Web platform redirect URI for Auth Code + PKCE
//   - Matching service principal
//
// Uses the Microsoft.Graph Bicep extension (preview). If your tenant cannot
// load the extension, use scripts/create-app-registration.ps1 — it mirrors
// this file 1:1.
//
// Deploy:
//   az deployment sub create \
//     --location westeurope \
//     --template-file infra/modules/app-registration.bicep \
//     --parameters certificatePublicKey="$(base64 -i ./out/cert/claude-outlook-mcp.crt)"

targetScope = 'subscription'

extension microsoftGraphV1_0

@description('Display name shown in Entra portal and on the OAuth consent screen.')
param appDisplayName string = 'Claude for Outlook (AI Rådgivning)'

@description('Unique name used by Microsoft.Graph Bicep to identify the application.')
param appUniqueName string = 'claude-outlook-mcp'

@description('OAuth redirect URI for the Auth Code + PKCE flow. Production value is the MCP server callback.')
param redirectUri string = 'https://mcp.ai-raadgivning.dk/auth/callback'

@description('Base64-encoded DER X.509 public certificate. Generate with scripts/generate-cert.sh.')
@secure()
param certificatePublicKey string

@description('Display name for the certificate credential entry on the app registration.')
param certificateDisplayName string = 'mcp-prod-cert'

// Microsoft Graph resource — well-known appId, same in every tenant.
var graphResourceAppId = '00000003-0000-0000-c000-000000000046'

// Delegated permission IDs (Microsoft Graph). These IDs are global constants.
var scopeIds = {
  MailReadWrite:            '024d486e-b451-40bb-833d-3e66d98c5c73'
  MailSend:                 'e383f46e-2787-4529-855e-0e479a3ffac0'
  MailboxSettingsReadWrite: '818c620a-27a9-40bd-a6a5-d96f7d610b4b'
  CalendarsReadWrite:       '1ec239c2-d7c9-4623-a91a-a9775856bb36'
  CalendarsReadShared:      '2b9c4092-424d-4249-948d-b43879977640'
  UserRead:                 'e1fe6dd8-ba31-4d61-89e7-88639da4683d'
  offlineAccess:            '7427e0e9-2fba-42fe-b0c0-848c9e6a8182'
}

resource app 'Microsoft.Graph/applications@v1.0' = {
  uniqueName: appUniqueName
  displayName: appDisplayName
  signInAudience: 'AzureADMyOrg'

  web: {
    redirectUris: [
      redirectUri
    ]
    implicitGrantSettings: {
      enableAccessTokenIssuance: false
      enableIdTokenIssuance: false
    }
  }

  requiredResourceAccess: [
    {
      resourceAppId: graphResourceAppId
      resourceAccess: [
        { id: scopeIds.MailReadWrite,            type: 'Scope' }
        { id: scopeIds.MailSend,                 type: 'Scope' }
        { id: scopeIds.MailboxSettingsReadWrite, type: 'Scope' }
        { id: scopeIds.CalendarsReadWrite,       type: 'Scope' }
        { id: scopeIds.CalendarsReadShared,      type: 'Scope' }
        { id: scopeIds.UserRead,                 type: 'Scope' }
        { id: scopeIds.offlineAccess,            type: 'Scope' }
      ]
    }
  ]

  keyCredentials: [
    {
      displayName: certificateDisplayName
      type: 'AsymmetricX509Cert'
      usage: 'Verify'
      key: certificatePublicKey
    }
  ]
}

resource sp 'Microsoft.Graph/servicePrincipals@v1.0' = {
  appId: app.appId
}

output appId string = app.appId
output appObjectId string = app.id
output servicePrincipalObjectId string = sp.id
