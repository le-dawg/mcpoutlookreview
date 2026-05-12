#!/usr/bin/env bash
#
# generate-cert.sh — self-signed cert for Entra app registration auth
#
# Produces three files under $OUT_DIR/:
#   $NAME.key   private key   (stays out of git, will be loaded into Key Vault)
#   $NAME.crt   public cert   (uploaded to Entra app registration)
#   $NAME.pfx   PKCS12 bundle (for runtime libs that need cert + key together)
#
# Usage:
#   ./scripts/generate-cert.sh [OUT_DIR] [NAME] [DAYS]
#
# Defaults: OUT_DIR=./out/cert  NAME=claude-outlook-mcp  DAYS=365
#
# PFX password is taken from the PFX_PASSWORD env var (default: empty).

set -euo pipefail

OUT_DIR="${1:-./out/cert}"
NAME="${2:-claude-outlook-mcp}"
DAYS="${3:-365}"
PFX_PASS="${PFX_PASSWORD:-}"

if ! command -v openssl >/dev/null 2>&1; then
  echo "error: openssl not found" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

if [[ -f "$OUT_DIR/$NAME.key" || -f "$OUT_DIR/$NAME.crt" ]]; then
  echo "error: $OUT_DIR/$NAME.{key,crt} already exists. Refusing to overwrite." >&2
  echo "       Move or delete the existing files first." >&2
  exit 1
fi

echo "Generating RSA 2048 self-signed cert (valid $DAYS days)..."
openssl req -x509 -nodes \
  -newkey rsa:2048 \
  -keyout "$OUT_DIR/$NAME.key" \
  -out    "$OUT_DIR/$NAME.crt" \
  -days   "$DAYS" \
  -subj   "/CN=$NAME" \
  -addext "keyUsage=digitalSignature" \
  -addext "extendedKeyUsage=clientAuth"

echo "Packaging as PKCS12..."
openssl pkcs12 -export \
  -out    "$OUT_DIR/$NAME.pfx" \
  -inkey  "$OUT_DIR/$NAME.key" \
  -in     "$OUT_DIR/$NAME.crt" \
  -passout "pass:$PFX_PASS"

chmod 600 "$OUT_DIR/$NAME.key" "$OUT_DIR/$NAME.pfx"

THUMB=$(openssl x509 -in "$OUT_DIR/$NAME.crt" -noout -fingerprint -sha1 \
        | sed 's/.*=//' | tr -d ':')

cat <<EOF

==============================================================
 Certificate generated
==============================================================
 Public cert    : $OUT_DIR/$NAME.crt   (upload to Entra)
 Private key    : $OUT_DIR/$NAME.key   (Key Vault — keep secret)
 PFX bundle     : $OUT_DIR/$NAME.pfx   (Key Vault — keep secret)
 SHA1 thumbprint: $THUMB

Next: deploy the Entra app registration (see docs/kickoff.md).
EOF
