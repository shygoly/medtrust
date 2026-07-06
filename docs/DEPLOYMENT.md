# MedTrust Privacy Computing & Trusted Mechanisms - Deployment Guide

## Overview

This guide covers deploying the MedTrust privacy computing and blockchain attestation services to Fly.io.

## Prerequisites

- Fly.io CLI installed (`fly auth login`)
- Docker installed locally
- Access to Alibaba Cloud account (for SGX instances)
- FISCO BCOS consortium chain access

## External Services Deployment

### 1. Deploy FATE Flow Service

```bash
cd fly-services/fate-flow
fly launch --name medtrust-fate-flow --region hkg
fly deploy
```

### 2. Deploy ChainMaker Chain (single node + sidecar)

Deploy the merged ChainMaker v2.3.0 node + Java SDK sidecar image (single Fly app):

```bash
# Run from the repo root so the Docker build context includes apps/ and fly-services/chain-sdk/
fly deploy . --config fly-services/chainmaker-node/fly.medtrust-chain.toml \
  --dockerfile fly-services/chainmaker-node/Dockerfile.chain -a medtrust-chain \
  --remote-only --ha=false --yes
```

### 3. Deploy MP-SPDZ Gateway

```bash
cd fly-services/mp-spdz-gateway
fly launch --name medtrust-mp-spdz-gateway --region hkg
fly deploy
```

## Environment Configuration

Update `.env` with deployed service URLs:

```bash
# External Services - Privacy Computing
FATE_FLOW_URL=https://medtrust-fate-flow.fly.dev
FATE_FLOW_TIMEOUT=300000

# External Services - Multi-Party Computation
MP_SPDZ_GATEWAY_URL=https://medtrust-mp-spdz-gateway.fly.dev
MP_SPDZ_TIMEOUT=60000

# External Services - Blockchain (FISCO BCOS)
FISCO_BCOS_NODE1_URL=https://medtrust-fisco-node1.fly.dev
FISCO_BCOS_NODE2_URL=https://medtrust-fisco-node2.fly.dev
FISCO_BCOS_NODE3_URL=https://medtrust-fisco-node3.fly.dev

# External Services - Alibaba Cloud SGX
ALIBABA_CLOUD_ACCESS_KEY_ID=your-access-key-id
ALIBABA_CLOUD_ACCESS_KEY_SECRET=your-access-key-secret
ALIBABA_CLOUD_REGION=cn-hongkong
```

## Health Checks

Verify all services are healthy:

```bash
curl https://medtrust-fate-flow.fly.dev/v1/version
curl https://medtrust-mp-spdz-gateway.fly.dev/health
curl -X POST https://medtrust-fisco-node1.fly.dev \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"getBlockNumber","params":[1],"id":1}'
```

## Database Migrations

Run migrations to create new tables:

```bash
pnpm --filter @medtrust/database migrate
```

## Feature Flags

Enable new capabilities gradually:

```bash
FEATURE_FEDERATED_LEARNING=true
FEATURE_MPC=true
FEATURE_TEE=true
FEATURE_BLOCKCHAIN=true
FEATURE_FHIR=true
```

## Monitoring

Check service health via API:

```bash
curl http://localhost:3000/health
```

## Cost Monitoring

Expected monthly costs:
- FATE Flow: ~¥4,000/month
- MP-SPDZ Gateway: ~¥1,000/month
- FISCO BCOS (3 nodes): ~¥3,000/month
- Alibaba Cloud SGX: ~¥5,000/month (on-demand)

**Total: ~¥13,000/month**

## Rollback Procedures

If issues arise, disable features via environment variables:

```bash
FEATURE_FEDERATED_LEARNING=false
FEATURE_MPC=false
FEATURE_TEE=false
FEATURE_BLOCKCHAIN=false
```

Restart the API service to apply changes.

## Troubleshooting

### FATE Flow Connection Issues
- Check service logs: `fly logs -a medtrust-fate-flow`
- Verify network connectivity
- Check timeout settings

### FISCO BCOS Node Failures
- System automatically fails over to backup nodes
- Check node status: `fly status -a medtrust-fisco-node1`

### MP-SPDZ Gateway Timeout
- Increase `MP_SPDZ_TIMEOUT` for complex computations
- Check gateway logs for errors

### SGX Instance Provisioning Failures
- Verify Alibaba Cloud credentials
- Check instance quota limits
- Ensure correct region configuration
