# Plumb changelog

## Release update

- Bumped local data schema from version 1 to version 2 with automatic, non-destructive migration.
- Added profile-level idle-lock settings and platform WebAuthn biometric unlock when supported.
- Added safe restore previews showing profile, transaction, category, and merchant-rule counts before replacement.
- Added local activity history, undo, recurring transaction, and savings-goal data structures.
- Added amount/date/merchant duplicate candidate detection for explicit review.
- Added Web Share Target handling for received images and PDFs.
- Added SpreadsheetML XML statement file support and retained CSV, TSV, PDF, and OCR workflows.
- Updated the offline shell cache and Netlify routing configuration.

## Input required / not completed

- Native Excel `.xls` and `.xlsx` parsing is not enabled because the available browser libraries either require unsafe or server-assisted processing. SpreadsheetML XML works locally; CSV export from Excel is recommended when possible.
- WebAuthn is device/browser/HTTPS dependent. PIN remains the recovery path and is never replaced automatically.
- The existing Supabase sync is optional and remains separate from device-local privacy; financial data is not sent to third parties unless a user explicitly enables sync.
