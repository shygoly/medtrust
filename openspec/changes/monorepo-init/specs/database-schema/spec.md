## ADDED Requirements

### Requirement: Multi-tenant data model
The system SHALL support multi-tenant architecture with proper data isolation.

#### Scenario: Define tenant entity
- **WHEN** creating the tenant model
- **THEN** system defines a Tenant entity with:
  - id, name, type (provider/consumer/admin/tech)
  - status (pending/active/suspended/rejected)
  - business license, medical license information
  - contact information (name, phone, email)
  - resource quotas (compute, storage)
  - financial fields (stripe customer id, total earnings/spending)

#### Scenario: Define tenant member entity
- **WHEN** managing tenant members
- **THEN** system defines TenantMember entity with:
  - association to tenant and user
  - role within tenant (owner/admin/member)
  - permissions array
  - joined timestamp

---

### Requirement: User authentication model
The system SHALL provide secure user authentication.

#### Scenario: Define user entity
- **WHEN** creating user accounts
- **THEN** system defines User entity with:
  - id, email (unique), password hash
  - profile information (name, avatar)
  - email verification status
  - MFA settings (optional)
  - timestamps (created, updated, last login)

#### Scenario: Define session management
- **WHEN** managing user sessions
- **THEN** system:
  - Issues JWT tokens with proper expiration
  - Supports refresh token rotation
  - Tracks session metadata (IP, user agent)
  - Allows session revocation

---

### Requirement: Data asset model
The system SHALL support medical data asset management.

#### Scenario: Define data asset entity
- **WHEN** registering data assets
- **THEN** system defines DataAsset entity with:
  - id, tenant_id (owner), name, description
  - type (EMR, imaging, lab, prescription, etc.)
  - status (draft, reviewing, published, offline)
  - statistics (record_count, patient_count)
  - temporal coverage (time_range_start, time_range_end)
  - data quality metrics (completeness, accuracy)
  - pricing fields (price_per_query, price_per_compute)
  - storage information (path, size, encryption)
  - usage policy (JSON configuration)

#### Scenario: Define data asset version
- **WHEN** updating data assets
- **THEN** system maintains version history with:
  - version number
  - change summary
  - previous version reference
  - created timestamp

---

### Requirement: Access request model
The system SHALL manage data access requests.

#### Scenario: Define access request entity
- **WHEN** requesting data access
- **THEN** system defines DataAccessRequest entity with:
  - requester_tenant_id, provider_tenant_id, asset_id
  - purpose description
  - expected duration and cost
  - status (pending, approved, rejected, completed)
  - approval metadata (approved_by, approved_at, rejection_reason)
  - actual usage tracking (actual_start/end, actual_cost)

---

### Requirement: Compute task model
The system SHALL track privacy-preserving computation tasks.

#### Scenario: Define compute task entity
- **WHEN** executing computation
- **THEN** system defines ComputeTask entity with:
  - id, tenant_id (owner), request_id (optional)
  - name, description, method (MPC/FL/TEE/sandbox)
  - status (pending, running, completed, failed, cancelled)
  - algorithm configuration (id, params)
  - data assets used (JSON array)
  - resource consumption (cpu_hours, gpu_hours, memory_gb)
  - result storage (path, summary)
  - error tracking
  - timestamps (created, started, completed)

---

### Requirement: Audit log model
The system SHALL maintain comprehensive audit logs.

#### Scenario: Define audit log entity
- **WHEN** tracking operations
- **THEN** system defines AuditLog entity with:
  - id, tenant_id, user_id
  - action type, resource type, resource id
  - detailed payload (JSON)
  - client information (IP, user agent)
  - compliance metadata (level, requires_review)
  - review information (reviewed_by, reviewed_at)
  - timestamp
