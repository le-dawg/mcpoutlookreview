# Fase 2 — Exchange kalender-baseline

Sætter `Default = Reviewer` på alle brugeres primære kalender, tenant-wide. Det er det der lader Claude (og hver medarbejder direkte i Outlook) læse kollegers fulde kalender-detaljer uden per-bruger manuel deling.

## Hvad scriptet rører — og hvad det IKKE rører

✅ **Rører:** `Default`-permissionen på den *primære* `\Calendar`-folder for alle `UserMailbox`-typer.

❌ **Rører IKKE:**
- Mail-foldere (Inbox, Sent, alt andet) — cross-user mail er forbudt per hård regel
- Subkalendere (kun root-kalenderen)
- Rooms, shared mailboxes, resource mailboxes (medmindre du eksplicit overrider `-IncludeMailboxTypes`)
- Eksisterende per-bruger permissions (kun `Default`-objektet ændres)

## Forudsætninger

```bash
brew install --cask powershell        # PowerShell 7
```

Du logger ind som en bruger med Exchange "Recipient Management" eller højere. Global Admin er rigeligt.

## Trin 1 — Dry run (gør intet, viser hvad der ville ske)

```bash
cd ~/projects/outlook-connector-air
pwsh ./scripts/set-calendar-baseline.ps1 -UserPrincipalName jacob@ai-raadgivning.dk
```

Output ser typisk sådan ud:

```
Enumerating mailboxes (types: UserMailbox)...
Found 15 mailboxes.
  WOULD    bruger1@ai-raadgivning.dk :: Kalender :: AvailabilityOnly -> Reviewer
  WOULD    bruger2@ai-raadgivning.dk :: Calendar :: LimitedDetails  -> Reviewer
  ...
================================================================
 Calendar baseline (DRY RUN)
================================================================
Total             : 15
AlreadyBaseline   : 0
WouldChange       : 15
Changed           : 0
Skipped           : 0
Errors            : 0
```

**Tjek output:**
- Total matcher dit forventede headcount (~15)
- Ingen uventede mailbox-typer
- Ingen `Errors`
- `WouldChange` viser hvor mange du faktisk ændrer

## ⏸ Checkpoint #2 — leadership briefing

Per HANDOVER §5 skal ledelsen være briefet før non-dry kørsel — alle kalender-detaljer bliver org-synlige. **Status: ✅ kørt 2026-05-12.**

## Trin 2 — Apply

```bash
pwsh ./scripts/set-calendar-baseline.ps1 -UserPrincipalName jacob@ai-raadgivning.dk -Apply
```

Forventet runtime ved ~15 brugere: ~30 sek.

Hvis nogen mailboxes fejler (typisk pga. lock på mailboxen), kør scriptet igen — det er idempotent og springer dem der allerede har `Reviewer` over.

## Hvad ser brugerne nu?

Når en kollega åbner en brugers kalender i Outlook:
- Mødetidspunkter ✅
- Titler ✅
- Lokation / Teams-link ✅
- Body, bilag ✅

Brugere der vil holde noget privat (ferie, sygefravær), markerer eventet som **Private** i Outlook. Private events viser stadig "Busy" uden detaljer, selv med Reviewer.

## Næste — scheduled runbook (afventer)

Nye medarbejdere får default `AvailabilityOnly` når deres mailbox oprettes. For at fange dem skal scriptet køre på en cron (ugentligt).

Kræver en separat Entra app reg til unattended Exchange-management (cert auth + `Exchange.ManageAsApp` permission + `Exchange Administrator` rolle), plus en GitHub Actions workflow med cron + cert i repo secrets.

Vi sætter det op efter første manuelle Apply har valideret at scriptet opfører sig som forventet.
