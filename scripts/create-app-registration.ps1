#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Create the Entra ID app registration for the Claude for Outlook MCP connector.

.DESCRIPTION
  Fallback for tenants where the Microsoft.Graph Bicep extension cannot be loaded.
  Mirrors infra/modules/app-registration.bicep 1:1 — single-tenant, certificate auth,
  7 delegated Microsoft Graph scopes, no application permissions, no client secret.

  Idempotent: if an app with the given DisplayName already exists, it is updated.

.PARAMETER TenantId
  Entra tenant ID. Defaults to AI Rådgivning.

.PARAMETER DisplayName
  Display name shown on consent screen.

.PARAMETER CertPath
  Path to the public certificate (.crt / .cer) produced by scripts/generate-cert.sh.

.PARAMETER RedirectUri
  OAuth redirect URI for Auth Code + PKCE flow.

.EXAMPLE
  ./scripts/create-app-registration.ps1 -CertPath ./out/cert/claude-outlook-mcp.crt
#>

[CmdletBinding()]
param(
  [string]$TenantId    = '9de3d9c3-b0bb-4d2e-93ab-f6407a8b3793',
  [string]$DisplayName = 'Claude for Outlook (AI Rådgivning)',
  [string]$RedirectUri = 'https://mcp.ai-raadgivning.dk/auth/callback',
  [Parameter(Mandatory)] [string]$CertPath
)

$ErrorActionPreference = 'Stop'

# --- Modules -----------------------------------------------------------------
foreach ($m in @('Microsoft.Graph.Authentication','Microsoft.Graph.Applications')) {
  if (-not (Get-Module -ListAvailable -Name $m)) {
    Write-Host "Installing $m..." -ForegroundColor Cyan
    Install-Module $m -Scope CurrentUser -Force -AllowClobber
  }
}
Import-Module Microsoft.Graph.Authentication, Microsoft.Graph.Applications

# --- Connect -----------------------------------------------------------------
Write-Host "Connecting to Microsoft Graph (tenant $TenantId)..." -ForegroundColor Cyan
Connect-MgGraph -TenantId $TenantId -Scopes 'Application.ReadWrite.All','User.Read' -NoWelcome

# --- Resolve Microsoft Graph SP & scope IDs ---------------------------------
$graphSp = Get-MgServicePrincipal -Filter "appId eq '00000003-0000-0000-c000-000000000046'"
if (-not $graphSp) { throw 'Could not resolve Microsoft Graph service principal in this tenant.' }

$wantedScopes = @(
  'Mail.ReadWrite',
  'Mail.Send',
  'MailboxSettings.ReadWrite',
  'Calendars.ReadWrite',
  'Calendars.Read.Shared',
  'User.Read',
  'offline_access'
)

$resourceAccess = @($wantedScopes | ForEach-Object {
  $scopeName = $_
  $scope = $graphSp.Oauth2PermissionScopes | Where-Object { $_.Value -eq $scopeName }
  if (-not $scope) { throw "Delegated scope '$scopeName' not found on Microsoft Graph SP." }
  @{ Id = $scope.Id; Type = 'Scope' }
})

# --- Read cert ---------------------------------------------------------------
if (-not (Test-Path $CertPath)) { throw "Certificate not found: $CertPath" }
$cert      = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($CertPath)
$certBytes = $cert.GetRawCertData()

$keyCred = @{
  DisplayName   = 'mcp-prod-cert'
  Type          = 'AsymmetricX509Cert'
  Usage         = 'Verify'
  Key           = $certBytes
  StartDateTime = $cert.NotBefore
  EndDateTime   = $cert.NotAfter
}

$requiredResource = @(@{
  ResourceAppId  = $graphSp.AppId
  ResourceAccess = $resourceAccess
})

$webConfig = @{ RedirectUris = @($RedirectUri) }

# --- Create or update --------------------------------------------------------
$existing = Get-MgApplication -Filter "displayName eq '$DisplayName'" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
  Write-Host "App exists ($($existing.AppId)) — updating..." -ForegroundColor Yellow
  Update-MgApplication -ApplicationId $existing.Id `
    -SignInAudience 'AzureADMyOrg' `
    -Web $webConfig `
    -RequiredResourceAccess $requiredResource `
    -KeyCredentials @($keyCred)
  $app = Get-MgApplication -ApplicationId $existing.Id
} else {
  Write-Host "Creating app registration '$DisplayName'..." -ForegroundColor Green
  $app = New-MgApplication `
    -DisplayName $DisplayName `
    -SignInAudience 'AzureADMyOrg' `
    -Web $webConfig `
    -RequiredResourceAccess $requiredResource `
    -KeyCredentials @($keyCred)
}

# --- Service principal -------------------------------------------------------
$sp = Get-MgServicePrincipal -Filter "appId eq '$($app.AppId)'" -ErrorAction SilentlyContinue
if (-not $sp) {
  Write-Host "Creating service principal..." -ForegroundColor Green
  $sp = New-MgServicePrincipal -AppId $app.AppId
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host " App registration ready" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  Display name          : $($app.DisplayName)"
Write-Host "  AppId (client ID)     : $($app.AppId)"
Write-Host "  Application object ID : $($app.Id)"
Write-Host "  Service principal ID  : $($sp.Id)"
Write-Host "  Tenant                : $TenantId"
Write-Host ""
Write-Host "Next step — Checkpoint #1:" -ForegroundColor Yellow
Write-Host "  Entra portal -> App registrations -> '$DisplayName'"
Write-Host "  -> API permissions -> 'Grant admin consent for AI Rådgivning'"
