#!/bin/bash

set -e

echo "🔐 Initializing Vault for MedTrust..."

export VAULT_ADDR='http://localhost:8200'
export VAULT_TOKEN='dev-token-12345'

echo "⏳ Waiting for Vault to be ready..."
until vault status > /dev/null 2>&1; do
  echo "Waiting for Vault..."
  sleep 2
done

echo "✅ Vault is ready!"

echo "📝 Enabling KV secrets engine..."
vault secrets enable -version=2 -path=secret kv || echo "KV engine already enabled"

echo "🔑 Creating encryption keys..."

vault kv put secret/medical/patient-id-card-key \
  key="0123456789abcdeffedcba9876543210" \
  description="SM4 key for patient ID card encryption"

vault kv put secret/medical/patient-medical-history-key \
  key="fedcba98765432100123456789abcdef" \
  description="SM4 key for medical history encryption"

vault kv put secret/medical/patient-contact-key \
  key="abcdef0123456789fedcba9876543210" \
  description="SM4 key for patient contact info encryption"

echo "🔐 Enabling Transit secrets engine..."
vault secrets enable transit || echo "Transit engine already enabled"

echo "🔑 Creating KEK (Key Encryption Key)..."
vault write -f transit/keys/medtrust-kek || echo "KEK already exists"

echo "📋 Creating Vault policy..."
vault policy write medtrust-app - <<EOF
path "secret/data/medical/*" {
  capabilities = ["read"]
}

path "transit/encrypt/medtrust-kek" {
  capabilities = ["update"]
}

path "transit/decrypt/medtrust-kek" {
  capabilities = ["update"]
}
EOF

echo "✅ Vault initialization complete!"
echo ""
echo "📌 Vault Configuration:"
echo "   Address: http://localhost:8200"
echo "   Token: dev-token-12345"
echo ""
echo "🔍 Test key retrieval:"
vault kv get secret/medical/patient-id-card-key
