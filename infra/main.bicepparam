using 'main.bicep'

param resourceGroupName = 'rg-claude-outlook-prod'
param location = 'westeurope'
param envName = 'prod'

// Phase 1 outputs
param azureTenantId = '9de3d9c3-b0bb-4d2e-93ab-f6407a8b3793'
param azureClientId = '4c797321-edf4-4382-b455-4501cd87c8c0'
param certThumbprint = '00EFA562B712661D3DA092803C99014C83A60B70'

param devUserUpn = 'jacob@ai-raadgivning.dk'
param customDomain = 'mcp.ai-raadgivning.dk'

// containerImage, certPrivateKeyPem, mcpAuthToken passed at deploy time via CLI
