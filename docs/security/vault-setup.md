# Vault Setup Guide

## Overview

HashiCorp Vault is used for secure key management in MedTrust. This guide covers setup for development and production environments.

## Development Setup

### 1. Start Vault with Docker Compose

```bash
# Start Vault in dev mode
docker-compose up -d vault

# Check Vault status
docker-compose logs vault
```

### 2. Initialize Vault

Run the initialization script to create keys and policies:

```bash
# Make script executable (if not already)
chmod +x scripts/vault-init.sh

# Run initialization
./scripts/vault-init.sh
```

This script will:
- Enable KV secrets engine (v2)
- Create encryption keys for patient data
- Enable Transit engine for envelope encryption
- Create access policies
- Set up the KEK (Key Encryption Key)

### 3. Verify Setup

```bash
export VAULT_ADDR='http://localhost:8200'
export VAULT_TOKEN='dev-token-12345'

# List secrets
vault kv list secret/medical

# Get a specific key
vault kv get secret/medical/patient-id-card-key
```

### 4. Configure Application

Update `.env` file:

```bash
VAULT_ADDR=http://localhost:8200
VAULT_TOKEN=dev-token-12345
KEY_CACHE_TTL_SECONDS=300
```

## Production Setup

### 1. Deploy Vault Cluster

**Minimum Requirements**:
- 3+ Vault nodes for HA
- Consul or Raft storage backend
- TLS certificates for all connections
- Hardware or cloud HSM (recommended)

**Example Terraform Configuration**:

```hcl
module "vault" {
  source = "hashicorp/vault/aws"

  cluster_size = 3
  vault_version = "1.15.0"

  storage_backend = "raft"
  enable_auto_unseal = true

  tls_cert_path = "/etc/vault/tls/cert.pem"
  tls_key_path  = "/etc/vault/tls/key.pem"
}
```

### 2. Initialize and Unseal

```bash
# Initialize Vault (run once)
vault operator init -key-shares=5 -key-threshold=3

# Save the unseal keys and root token securely!

# Unseal Vault (requires 3 of 5 keys)
vault operator unseal <key1>
vault operator unseal <key2>
vault operator unseal <key3>
```

**⚠️ Critical**: Store unseal keys in separate secure locations (e.g., different team members, password managers, HSM).

### 3. Enable Audit Logging

```bash
vault audit enable file file_path=/vault/logs/audit.log
```

### 4. Configure AppRole Authentication

**Don't use static tokens in production!** Use AppRole instead:

```bash
# Enable AppRole
vault auth enable approle

# Create role for MedTrust API
vault write auth/approle/role/medtrust-api \
  token_policies="medtrust-app" \
  token_ttl=1h \
  token_max_ttl=4h

# Get role ID
vault read auth/approle/role/medtrust-api/role-id

# Generate secret ID
vault write -f auth/approle/role/medtrust-api/secret-id
```

**Application Configuration**:

```bash
VAULT_ADDR=https://vault.production.example.com:8200
VAULT_ROLE_ID=<role-id>
VAULT_SECRET_ID=<secret-id>
```

**Update VaultService** to use AppRole:

```typescript
async onModuleInit() {
  const roleId = this.configService.get('VAULT_ROLE_ID');
  const secretId = this.configService.get('VAULT_SECRET_ID');

  // Login with AppRole
  const loginResponse = await this.vaultClient.approleLogin({
    role_id: roleId,
    secret_id: secretId,
  });

  this.vaultClient.token = loginResponse.auth.client_token;
}
```

### 5. Create Production Keys

```bash
# Generate secure random keys (32 hex chars = 128 bits)
openssl rand -hex 16

# Store in Vault
vault kv put secret/medical/patient-id-card-key \
  key="$(openssl rand -hex 16)" \
  description="Production SM4 key for patient ID cards" \
  created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

### 6. Set Up Key Rotation

Create a rotation policy:

```bash
# Enable versioning (already enabled with KV v2)
vault kv metadata put secret/medical/patient-id-card-key \
  max-versions=10 \
  delete-version-after=90d
```

**Manual Rotation Process**:

1. Create new key version in Vault
2. Update application to use new key for new encryptions
3. Background job re-encrypts existing data with new key
4. Retire old key version after migration complete

### 7. Configure Vault Policies

**Production Policy** (more restrictive):

```hcl
# Read-only access to encryption keys
path "secret/data/medical/*" {
  capabilities = ["read"]
}

# Transit encryption operations only
path "transit/encrypt/medtrust-kek" {
  capabilities = ["update"]
}

path "transit/decrypt/medtrust-kek" {
  capabilities = ["update"]
}

# No access to Vault management
path "sys/*" {
  capabilities = ["deny"]
}
```

Apply policy:

```bash
vault policy write medtrust-app-prod policy.hcl
```

## Key Management

### Key Naming Convention

```
secret/medical/{entity}-{field}-key
```

Examples:
- `secret/medical/patient-id-card-key`
- `secret/medical/patient-medical-history-key`
- `secret/medical/user-password-key`

### Key Metadata

Always include metadata:

```bash
vault kv put secret/medical/patient-id-card-key \
  key="<32-hex-chars>" \
  description="SM4 key for patient ID card encryption" \
  created_at="2026-02-11T10:00:00Z" \
  owner="security-team" \
  compliance="等保2.0"
```

### Key Rotation Schedule

| Key Type | Rotation Frequency | Reason |
|----------|-------------------|--------|
| Data Encryption Keys (DEK) | Every 90 days | Compliance requirement |
| Key Encryption Keys (KEK) | Every 180 days | Lower exposure risk |
| Database Credentials | Every 24 hours | Dynamic secrets |

## Monitoring and Alerts

### Health Checks

```bash
# Check Vault status
vault status

# Check seal status
vault operator seal-status

# Check audit log
tail -f /vault/logs/audit.log
```

### Prometheus Metrics

Enable telemetry in Vault config:

```hcl
telemetry {
  prometheus_retention_time = "30s"
  disable_hostname = true
}
```

**Key Metrics to Monitor**:
- `vault_core_unsealed`: Vault seal status (should be 1)
- `vault_runtime_alloc_bytes`: Memory usage
- `vault_core_handle_request`: Request rate
- `vault_core_handle_request_duration`: Request latency

### Alerts

```yaml
# Prometheus alert rules
groups:
  - name: vault
    rules:
      - alert: VaultSealed
        expr: vault_core_unsealed == 0
        for: 1m
        annotations:
          summary: "Vault is sealed"

      - alert: VaultHighLatency
        expr: vault_core_handle_request_duration > 1000
        for: 5m
        annotations:
          summary: "Vault request latency is high"
```

## Backup and Recovery

### Backup Vault Data

**For Raft Storage**:

```bash
vault operator raft snapshot save backup.snap
```

**For Consul Storage**:

```bash
consul snapshot save backup.snap
```

**Backup Schedule**: Daily automated backups, retained for 30 days.

### Disaster Recovery

1. **Restore from Snapshot**:
   ```bash
   vault operator raft snapshot restore backup.snap
   ```

2. **Unseal Vault** (requires threshold of unseal keys)

3. **Verify Data**:
   ```bash
   vault kv get secret/medical/patient-id-card-key
   ```

4. **Test Application Connectivity**

## Security Best Practices

### 1. Network Security

- Use TLS for all Vault connections
- Restrict Vault access to application subnet only
- Use VPN or private network for Vault cluster communication

### 2. Access Control

- Use AppRole, not static tokens
- Implement least-privilege policies
- Rotate AppRole secret IDs regularly
- Enable MFA for human access

### 3. Audit and Compliance

- Enable audit logging on all Vault nodes
- Forward logs to SIEM system
- Regular audit log reviews
- Compliance reporting (等保2.0 requirements)

### 4. High Availability

- Deploy 3+ Vault nodes
- Use load balancer for Vault endpoints
- Test failover scenarios regularly
- Monitor cluster health continuously

### 5. Key Management

- Never store keys in code or config files
- Use separate keys for different data types
- Implement key rotation procedures
- Document key usage and ownership

## Troubleshooting

### Vault Sealed

**Symptom**: Application cannot connect to Vault.

**Solution**:
```bash
vault operator unseal <key1>
vault operator unseal <key2>
vault operator unseal <key3>
```

### Connection Timeout

**Symptom**: `Failed to initialize Vault client`

**Solution**:
- Check Vault is running: `docker-compose ps vault`
- Verify network connectivity: `curl http://localhost:8200/v1/sys/health`
- Check firewall rules

### Permission Denied

**Symptom**: `permission denied` when accessing keys

**Solution**:
- Verify token has correct policy: `vault token lookup`
- Check policy allows read access: `vault policy read medtrust-app`
- Ensure key path is correct

### Key Not Found

**Symptom**: `Key not found in Vault: patient-id-card-key`

**Solution**:
```bash
# List available keys
vault kv list secret/medical

# Create missing key
vault kv put secret/medical/patient-id-card-key key="$(openssl rand -hex 16)"
```

## References

- [Vault Documentation](https://www.vaultproject.io/docs)
- [Vault Production Hardening](https://learn.hashicorp.com/tutorials/vault/production-hardening)
- [AppRole Authentication](https://www.vaultproject.io/docs/auth/approle)
- [Vault HA Setup](https://learn.hashicorp.com/tutorials/vault/ha-with-consul)
