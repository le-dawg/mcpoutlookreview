@description('Log Analytics workspace name.')
param name string

@description('Location.')
param location string

@description('Retention in days.')
param retentionInDays int = 30

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: name
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionInDays
    workspaceCapping: {
      dailyQuotaGb: 1
    }
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

output id string = law.id
output customerId string = law.properties.customerId

#disable-next-line outputs-should-not-contain-secrets
output primarySharedKey string = law.listKeys().primarySharedKey
