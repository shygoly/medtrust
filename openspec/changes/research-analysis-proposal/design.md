## Context

MedTrust has completed Phase 1 (authentication, encryption, key management) and Phase 2 (GM crypto foundation). The platform now needs core privacy computing and trusted mechanism capabilities to enable secure cross-institutional medical data collaboration.

The research directory contains technical investigations that have identified specific frameworks and implementation approaches. This design translates those research findings into an architectural plan for Phase 3 (privacy computing) and Phase 4 (trusted mechanisms).

**Current State:**
- NestJS backend with TypeORM + SQLite
- JWT authentication with multi-tenant support
- GM crypto primitives (SM2/SM3/SM4) integrated
- REST API architecture with WebSocket support

**Constraints:**
- Must maintain existing API patterns and authentication
- External services (FATE, MP-SPDZ, SGX, FISCO BCOS) run as separate processes
- Budget constraint: ~¥12,000/month for new cloud services
- Development team familiar with TypeScript/NestJS, limited C++/Python expertise

## Goals / Non-Goals

**Goals:**
- Enable federated learning across hospitals without raw data sharing (FATE integration)
- Support secure multi-party computation for statistical analysis (MP-SPDZ integration)
- Provide trusted execution environment for sensitive computations (Alibaba Cloud SGX)
- Implement blockchain-based attestation for medical data provenance (FISCO BCOS)
- Standardize medical data exchange using FHIR R4
- Maintain consistent API patterns and developer experience
- Keep external service complexity hidden behind NestJS abstractions

**Non-Goals:**
- Building custom privacy computing frameworks (use proven open-source solutions)
- Supporting non-medical blockchain use cases
- Full FHIR conformance testing (focus on core resources: Patient, Observation, Condition)
- Real-time streaming for federated learning (batch-oriented workflows are sufficient)
- Multi-cloud TEE support (Alibaba Cloud SGX only for Phase 3)

## Decisions

### 1. Service Integration Pattern: Gateway + Adapter

**Decision:** Wrap each external service (FATE, MP-SPDZ, SGX, FISCO BCOS) with a NestJS module that provides:
- Service adapter (HTTP/SDK client to external service)
- Domain models (TypeORM entities for job tracking)
- REST API controllers (consistent `/api/privacy/*` and `/api/blockchain/*` patterns)
- Background job processing (for long-running operations)

**Rationale:**
- Isolates external service complexity from application logic
- Enables consistent error handling, logging, and monitoring
- Allows independent testing and mocking of external services
- Maintains TypeScript type safety across the stack

**Alternatives Considered:**
- Direct client calls from controllers: Rejected due to tight coupling and difficulty testing
- Microservices architecture: Rejected as premature for current scale (adds operational complexity)

### 2. Federated Learning: FATE over Flower

**Decision:** Use FATE (Federated AI Technology Enabler) as the federated learning framework, accessed via FATE Flow REST API.

**Rationale:**
- FATE is production-ready with proven deployment in Chinese healthcare (WeBank)
- Supports both horizontal FL (same features, different samples) and vertical FL (different features, same samples)
- Includes built-in secure aggregation and differential privacy
- FATE Flow provides REST API that integrates cleanly with NestJS

**Alternatives Considered:**
- Flower: More modern Python API but less mature in healthcare domain, weaker security guarantees
- TensorFlow Federated: Google-backed but complex deployment, limited Chinese language support

**Implementation Approach:**
- FATE Flow runs as Docker service (port 9380)
- NestJS adapter calls FATE Flow API for job submission, status polling, model retrieval
- Store job metadata in `federated_learning_jobs` table (job_id, status, participants, model_path)

### 3. Multi-Party Computation: MP-SPDZ with C++ Gateway

**Decision:** Use MP-SPDZ for secure computation protocols, accessed via a thin C++ gateway service that exposes HTTP endpoints.

**Rationale:**
- MP-SPDZ supports multiple protocols (SPDZ, Shamir, replicated secret sharing) with strong security proofs
- Designed for practical deployment (not just research)
- C++ performance critical for cryptographic operations

**Alternatives Considered:**
- Pure JavaScript MPC libraries: Too slow for real-world data sizes
- Direct MP-SPDZ integration: Requires C++ expertise in main codebase, rejected for maintainability

**Implementation Approach:**
- Build lightweight C++ gateway that wraps MP-SPDZ runtime
- Gateway exposes `/compute/sum`, `/compute/mean` endpoints
- NestJS adapter handles session management, participant coordination
- Store session state in `mpc_sessions` table

### 4. Trusted Execution: Alibaba Cloud SGX

**Decision:** Use Alibaba Cloud's SGX-enabled instances for trusted execution environment, accessed via Alibaba Cloud SDK.

**Rationale:**
- Alibaba Cloud has mature SGX support in China regions
- Remote attestation infrastructure already operational
- Managed service reduces operational burden (no bare-metal SGX management)

**Alternatives Considered:**
- Self-hosted SGX: Rejected due to hardware procurement complexity and attestation infrastructure requirements
- Azure Confidential Computing: Rejected due to China region availability and compliance concerns

**Implementation Approach:**
- Use Alibaba Cloud SDK to provision SGX instances on-demand
- Enclave code handles sensitive computations (gene analysis, drug efficacy)
- NestJS adapter manages instance lifecycle, attestation verification
- Store computation records in `tee_computations` table

### 5. Blockchain: FISCO BCOS Consortium Chain

**Decision:** Deploy FISCO BCOS as a 3-node consortium chain for medical data attestation.

**Rationale:**
- FISCO BCOS designed for Chinese enterprise use (supports GM crypto natively)
- Consortium model fits healthcare trust requirements (known participants)
- Active community and production deployments in healthcare

**Alternatives Considered:**
- Public blockchain (Ethereum): Rejected due to privacy concerns and cost
- Hyperledger Fabric: More complex deployment, less GM crypto support

**Implementation Approach:**
- 3-node FISCO BCOS cluster (docker-compose services)
- Smart contracts for attestation (store hash + metadata, not raw data)
- Use `fisco-bcos-browser-sdk` for transaction submission
- Store attestation records in `blockchain_attestations` table (local cache + blockchain reference)

### 6. FHIR Integration: Client Library + Transform Layer

**Decision:** Use `fhir-kit-client` for FHIR R4 operations, with a transform layer to map between MedTrust domain models and FHIR resources.

**Rationale:**
- FHIR R4 is the current standard for healthcare data exchange
- Transform layer keeps domain models clean (not polluted with FHIR-specific fields)
- Enables gradual FHIR adoption (start with Patient, Observation, expand later)

**Implementation Approach:**
- FHIR module with resource-specific controllers (`/api/fhir/Patient`, `/api/fhir/Observation`)
- Transform functions: `toFHIR()` and `fromFHIR()` for each resource type
- Store FHIR resources as JSON in existing tables (add `fhir_resource` column)

## Risks / Trade-offs

**[Risk] External service failures cascade to main application**
→ Mitigation: Implement circuit breakers (use `@nestjs/axios` with retry/timeout), graceful degradation (return cached results when services unavailable)

**[Risk] High operational complexity (5 new external services)**
→ Mitigation: Docker Compose for local dev, comprehensive health checks, centralized logging (Winston + ELK stack)

**[Risk] Cost overruns (¥12,000/month baseline, could spike with usage)**
→ Mitigation: Implement usage quotas per tenant, monitor cloud costs with alerts, consider reserved instances for SGX

**[Risk] FATE/MP-SPDZ learning curve for team**
→ Mitigation: Start with simple use cases (horizontal FL, secure sum), comprehensive documentation, consider external training

**[Risk] Data synchronization between local DB and blockchain**
→ Mitigation: Blockchain is source of truth for attestations, local DB is cache (rebuild from chain if inconsistent)

**[Risk] FHIR compliance gaps**
→ Mitigation: Document supported FHIR profiles explicitly, validate with FHIR validator tool, plan for certification if needed

**[Trade-off] Latency vs Security**
- Privacy computing operations are slow (FL training: minutes to hours, MPC: seconds per operation)
- Accept higher latency for sensitive operations, use async job patterns with status polling

**[Trade-off] Flexibility vs Simplicity**
- FATE supports many FL algorithms, but exposing all options increases API complexity
- Start with 2-3 common algorithms (logistic regression, neural network), expand based on user feedback

## Migration Plan

**Phase 1: Infrastructure Setup (Week 1-2)**
1. Add Docker services to `docker-compose.yml`: FATE Flow, FISCO BCOS nodes
2. Provision Alibaba Cloud SGX instances (dev environment)
3. Set up MP-SPDZ gateway (build C++ service, containerize)
4. Verify all services healthy and accessible

**Phase 2: Core Module Development (Week 3-6)**
1. Implement service adapters (one per external service)
2. Create TypeORM entities and migrations
3. Build REST API controllers with OpenAPI specs
4. Add integration tests (mock external services)

**Phase 3: End-to-End Testing (Week 7-8)**
1. Test federated learning workflow (2-party horizontal FL)
2. Test MPC secure sum (3-party computation)
3. Test TEE computation (gene analysis example)
4. Test blockchain attestation (prescription flow)
5. Test FHIR data exchange (Patient CRUD)

**Phase 4: Production Deployment (Week 9-10)**
1. Deploy to staging environment
2. Performance testing and optimization
3. Security audit (focus on key management, attestation verification)
4. Production deployment with feature flags (gradual rollout)

**Rollback Strategy:**
- Feature flags allow disabling new capabilities without code changes
- External services are additive (no changes to existing APIs)
- Database migrations are reversible (down migrations provided)
- If critical issues arise, disable feature flags and scale down external services

## Open Questions

1. **FATE Model Storage:** Where to store trained models long-term? (S3-compatible storage vs local filesystem vs FHIR DocumentReference)
   - Recommendation: Start with local filesystem, migrate to S3 if storage grows beyond 100GB

2. **MPC Protocol Selection:** Which MP-SPDZ protocol for production? (SPDZ vs Shamir vs replicated)
   - Recommendation: Start with Shamir (simpler, good for 3-party), evaluate SPDZ if need >5 parties

3. **SGX Attestation Verification:** Should we verify attestation on every request or cache verification results?
   - Recommendation: Cache for 1 hour, re-verify on cache miss (balance security vs performance)

4. **Blockchain Gas Fees:** How to handle transaction costs in consortium chain?
   - Recommendation: FISCO BCOS has no gas fees (consortium model), but monitor transaction volume for node capacity planning

5. **FHIR Server:** Should we run a full FHIR server (HAPI FHIR) or just implement FHIR API patterns?
   - Recommendation: Implement FHIR API patterns in NestJS (lighter weight), consider HAPI FHIR if need full conformance
