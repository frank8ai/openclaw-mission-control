# SOP_MC_Triage_Signature_Dedupe_v1

## Purpose

Prevent duplicate Linear triage issues when repeated alerts share the same operational signature.

## Scope

- Applies in `createTriageIssueFromInput`.
- Uses two dedupe layers:
  - strict idempotency: `source + sourceId`
  - signature dedupe: repo/error/text fingerprint

## Storage

- Source index: `data/control-center/triage-source-index.json`
- Signature index: `data/control-center/triage-signature-index.json`

## Procedure

1. Intake request arrives (`triage`, `ingest-server`, integrations).
2. Check strict idempotency index (`source + sourceId`).
3. If no hit, build signature candidate:
- normalized source
- repo hint (when present)
- error signal (timeout/auth/network/blocked/failover/exception...)
- normalized text window
4. Check signature index within lookback window.
5. If hit, return existing issue (deduped).
6. If miss, create issue and store signature mapping.

## Config

`triageRouting.signatureDedupe`:
- `enabled`
- `lookbackDays`
- `maxEntries`
- `minChars`
- `sourceAllowlist`

## Verification

- Repeat same intake payload with different `sourceId` but same signature.
- Confirm second call returns existing issue (`deduped: true`).

## Safety / Tradeoff

- Conservative by default: requires meaningful text and either repo or error signal.
- For low-volume/manual workflows, can disable with:
- `triageRouting.signatureDedupe.enabled=false`

