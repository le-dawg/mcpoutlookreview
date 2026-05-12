#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Sets Default = Reviewer on every user's primary Calendar folder, tenant-wide.

.DESCRIPTION
  Phase 2 of the Outlook MCP connector rollout. Enables org-wide calendar
  visibility (full details) without per-user manual sharing.

  Cross-user MAIL is forbidden — this script touches \Calendar permissions only.
  Subcalendars are not touched (only the primary calendar at the mailbox root).
  Localized folder names ("Kalender", "Calendar", ...) are auto-detected via
  FolderType = 'Calendar'.

  Default mode is dry-run: nothing is changed, only a report is printed.
  Pass -Apply to actually update permissions.

.PARAMETER Apply
  Without this flag, the script only prints what WOULD change. With this flag,
  it actually calls Set-MailboxFolderPermission.

.PARAMETER IncludeMailboxTypes
  Recipient types to include. Default: UserMailbox only (skips rooms, shared,
  resources, equipment).

.PARAMETER UserPrincipalName
  UPN used to authenticate to Exchange Online interactively when no active
  session exists. Skipped if a session is already connected.

.EXAMPLE
  pwsh ./scripts/set-calendar-baseline.ps1 -UserPrincipalName jacob@ai-raadgivning.dk
  # Dry run — prints which mailboxes would change

.EXAMPLE
  pwsh ./scripts/set-calendar-baseline.ps1 -UserPrincipalName jacob@ai-raadgivning.dk -Apply
  # Actually sets Default = Reviewer on every user mailbox primary calendar
#>

[CmdletBinding()]
param(
  [switch]$Apply,
  [string[]]$IncludeMailboxTypes = @('UserMailbox'),
  [string]$UserPrincipalName
)

$ErrorActionPreference = 'Stop'

# --- Module ------------------------------------------------------------------
if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
  Write-Host "Installing ExchangeOnlineManagement..." -ForegroundColor Cyan
  Install-Module ExchangeOnlineManagement -Scope CurrentUser -Force -AllowClobber
}
Import-Module ExchangeOnlineManagement

# --- Connect -----------------------------------------------------------------
$existing = Get-ConnectionInformation -ErrorAction SilentlyContinue |
  Where-Object { $_.State -eq 'Connected' -and $_.Name -like 'ExchangeOnline*' }
if (-not $existing) {
  if (-not $UserPrincipalName) {
    throw 'No active Exchange Online session. Pass -UserPrincipalName <upn>.'
  }
  $connectParams = @{
    UserPrincipalName = $UserPrincipalName
    ShowBanner        = $false
  }
  # MSAL's embedded browser flow is unreliable on macOS/Linux — use device code instead.
  if ($IsMacOS -or $IsLinux) {
    $connectParams.Device = $true
    Write-Host "Connecting to Exchange Online as $UserPrincipalName (device code flow)..." -ForegroundColor Cyan
    Write-Host "Follow the URL + code that appears below in any browser." -ForegroundColor Yellow
  } else {
    Write-Host "Connecting to Exchange Online as $UserPrincipalName..." -ForegroundColor Cyan
  }
  Connect-ExchangeOnline @connectParams
}

# --- Enumerate target mailboxes ---------------------------------------------
Write-Host "Enumerating mailboxes (types: $($IncludeMailboxTypes -join ', '))..." -ForegroundColor Cyan
$mailboxes = Get-EXOMailbox -RecipientTypeDetails $IncludeMailboxTypes -ResultSize Unlimited |
  Sort-Object UserPrincipalName
Write-Host "Found $($mailboxes.Count) mailboxes."

# --- Process each mailbox ----------------------------------------------------
$summary = [ordered]@{
  Total           = $mailboxes.Count
  AlreadyBaseline = 0
  WouldChange     = 0
  Changed         = 0
  Skipped         = 0
  Errors          = 0
}
$errors = @()

foreach ($mbx in $mailboxes) {
  $upn = $mbx.UserPrincipalName
  try {
    # Find the primary (top-level) calendar folder. Subfolders have deeper paths.
    $calFolder = Get-EXOMailboxFolderStatistics -Identity $upn -FolderScope Calendar |
      Where-Object { $_.FolderType -eq 'Calendar' -and (($_.FolderPath -split '/').Count -le 2) } |
      Select-Object -First 1

    if (-not $calFolder) {
      Write-Warning "[$upn] Could not locate primary Calendar folder — skipping"
      $summary.Skipped++
      continue
    }

    $folderName     = $calFolder.FolderPath.TrimStart('/').Split('/')[0]
    $folderIdentity = "${upn}:\${folderName}"

    $currentPerm   = Get-MailboxFolderPermission -Identity $folderIdentity -User Default -ErrorAction Stop
    $currentRights = ($currentPerm.AccessRights -join ',')

    if ($currentRights -eq 'Reviewer') {
      $summary.AlreadyBaseline++
      continue
    }

    $line = "$upn :: $folderName :: $currentRights -> Reviewer"

    if ($Apply) {
      Set-MailboxFolderPermission -Identity $folderIdentity -User Default -AccessRights Reviewer | Out-Null
      $summary.Changed++
      Write-Host "  CHANGED  $line" -ForegroundColor Green
    } else {
      $summary.WouldChange++
      Write-Host "  WOULD    $line" -ForegroundColor Yellow
    }
  } catch {
    $summary.Errors++
    $msg = "[$upn] $($_.Exception.Message)"
    $errors += $msg
    Write-Warning $msg
  }
}

# --- Report ------------------------------------------------------------------
$mode = if ($Apply) { '(APPLY)' } else { '(DRY RUN)' }
Write-Host ''
Write-Host '================================================================' -ForegroundColor Cyan
Write-Host " Calendar baseline $mode" -ForegroundColor Cyan
Write-Host '================================================================' -ForegroundColor Cyan
$summary.GetEnumerator() | ForEach-Object {
  '{0,-18}: {1}' -f $_.Key, $_.Value
}

if (-not $Apply -and $summary.WouldChange -gt 0) {
  Write-Host ''
  Write-Host 'Re-run with -Apply to actually update permissions.' -ForegroundColor Yellow
}

if ($errors.Count -gt 0) {
  Write-Host ''
  Write-Host 'Errors:' -ForegroundColor Red
  $errors | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
  exit 1
}
