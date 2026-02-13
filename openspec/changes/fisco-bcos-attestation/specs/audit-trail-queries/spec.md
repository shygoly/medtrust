## ADDED Requirements

### Requirement: Query attestation history by entity

The system SHALL provide functionality to retrieve complete attestation history for any entity (patient record, consent, data sharing agreement).

#### Scenario: Query all attestations for patient record
- **WHEN** user requests attestation history for patient record ID
- **THEN** system retrieves all AttestationRecords with entityType "patient_record" and matching entityId
- **THEN** system returns attestations in chronological order
- **THEN** system includes transaction hash, block number, timestamp, and data hash for each attestation

#### Scenario: Query attestations for non-existent entity
- **WHEN** user queries attestations for entity with no attestations
- **THEN** system returns empty array
- **THEN** system indicates entity has not been attested

#### Scenario: Query attestations across entity types
- **WHEN** user queries all attestations for a patient
- **THEN** system retrieves attestations for patient records, consents, and data sharing agreements
- **THEN** system groups results by entity type
- **THEN** system returns unified timeline of all patient-related attestations

### Requirement: Filter attestations by date range

The system SHALL support filtering attestation queries by date range for compliance reporting periods.

#### Scenario: Query attestations for specific month
- **WHEN** user requests attestations between 2026-01-01 and 2026-01-31
- **THEN** system filters attestations by attestedAt timestamp
- **THEN** system returns only attestations within date range
- **THEN** system includes count of filtered results

#### Scenario: Query attestations for fiscal year
- **WHEN** compliance team requests annual audit report
- **THEN** system retrieves all attestations for fiscal year
- **THEN** system groups attestations by month
- **THEN** system provides summary statistics (total attestations, by type, success rate)

### Requirement: Search attestations by transaction hash

The system SHALL support looking up attestations by blockchain transaction hash for forensic analysis.

#### Scenario: Lookup attestation by transaction hash
- **WHEN** auditor provides blockchain transaction hash
- **THEN** system queries AttestationRecord by txHash
- **THEN** system returns complete attestation details
- **THEN** system includes entity information and original data hash

#### Scenario: Verify transaction on blockchain
- **WHEN** user requests blockchain verification for transaction hash
- **THEN** system queries FISCO BCOS node for transaction receipt
- **THEN** system retrieves block number, timestamp, and transaction status
- **THEN** system confirms transaction exists on-chain

### Requirement: Query attestations by status

The system SHALL support filtering attestations by status (pending, attested, failed) for operational monitoring.

#### Scenario: Query pending attestations
- **WHEN** operator requests list of pending attestations
- **THEN** system retrieves all AttestationRecords with status "pending"
- **THEN** system calculates time since submission
- **THEN** system highlights attestations pending more than 5 minutes

#### Scenario: Query failed attestations
- **WHEN** operator requests failed attestations
- **THEN** system retrieves all AttestationRecords with status "failed"
- **THEN** system includes error messages and retry count
- **THEN** system provides option to retry failed attestations

#### Scenario: Query successful attestations
- **WHEN** user requests completed attestations
- **THEN** system retrieves all AttestationRecords with status "attested"
- **THEN** system includes blockchain confirmation details
- **THEN** system calculates attestation success rate

### Requirement: Generate compliance audit reports

The system SHALL generate comprehensive audit reports with attestation data for regulatory compliance.

#### Scenario: Generate monthly compliance report
- **WHEN** compliance officer requests monthly report
- **THEN** system aggregates all attestations for the month
- **THEN** system groups by entity type (patient records, consents, data sharing)
- **THEN** system includes success rate, average attestation time, and failure analysis
- **THEN** system exports report as PDF with blockchain transaction references

#### Scenario: Generate entity-specific audit trail
- **WHEN** auditor requests audit trail for specific patient record
- **THEN** system retrieves complete attestation history
- **THEN** system includes creation, modifications, and sharing events
- **THEN** system provides blockchain verification links for each attestation
- **THEN** system exports as timestamped PDF report

### Requirement: Export attestation data

The system SHALL support exporting attestation data in multiple formats for external analysis and archival.

#### Scenario: Export attestations as CSV
- **WHEN** user requests CSV export of attestations
- **THEN** system generates CSV with columns: entityType, entityId, dataHash, txHash, blockNumber, timestamp, status
- **THEN** system includes metadata fields as additional columns
- **THEN** system provides download link for CSV file

#### Scenario: Export attestations as JSON
- **WHEN** developer requests JSON export for integration
- **THEN** system generates JSON array of attestation records
- **THEN** system includes complete attestation details and metadata
- **THEN** system provides API endpoint for programmatic access

#### Scenario: Export blockchain verification bundle
- **WHEN** auditor requests verification bundle
- **THEN** system exports attestation records with blockchain transaction receipts
- **THEN** system includes smart contract ABI and address
- **THEN** system provides instructions for independent verification

### Requirement: Pagination for large result sets

The system SHALL implement pagination for attestation queries to handle large volumes of historical data.

#### Scenario: Paginate attestation history
- **WHEN** user queries attestations with more than 100 results
- **THEN** system returns first page of 100 results
- **THEN** system includes pagination metadata (total count, current page, total pages)
- **THEN** system provides links to next and previous pages

#### Scenario: Configure page size
- **WHEN** user specifies page size in query parameters
- **THEN** system returns requested number of results per page (max 1000)
- **THEN** system maintains pagination state across requests

### Requirement: Attestation timeline visualization

The system SHALL provide timeline view of attestations for visual audit trail analysis.

#### Scenario: Display entity attestation timeline
- **WHEN** user views entity details page
- **THEN** system displays timeline of all attestations
- **THEN** system shows attestation events with timestamps and types
- **THEN** system provides links to blockchain transactions

#### Scenario: Filter timeline by event type
- **WHEN** user filters timeline to show only "data_sharing" events
- **THEN** system updates timeline to show filtered events
- **THEN** system maintains chronological order

### Requirement: Integration with existing AuditModule

The system SHALL integrate blockchain attestation data with existing audit logs for unified audit trail.

#### Scenario: Combine database and blockchain audit logs
- **WHEN** user requests complete audit trail for entity
- **THEN** system retrieves audit logs from AuditModule
- **THEN** system retrieves attestation records from blockchain
- **THEN** system merges logs in chronological order
- **THEN** system indicates which events have blockchain attestation

#### Scenario: Cross-reference audit logs with attestations
- **WHEN** audit log entry has corresponding attestation
- **THEN** system displays blockchain verification badge
- **THEN** system provides link to attestation details
- **THEN** system shows verification status (valid/invalid/not_attested)

### Requirement: Query performance optimization

The system SHALL optimize query performance for historical attestation data using database indexes and caching.

#### Scenario: Fast entity lookup
- **WHEN** user queries attestations by entity ID
- **THEN** system uses database index on (entityType, entityId)
- **THEN** system returns results in less than 100ms
- **THEN** system caches frequently accessed attestations

#### Scenario: Fast date range queries
- **WHEN** user queries attestations by date range
- **THEN** system uses index on attestedAt timestamp
- **THEN** system returns results efficiently even for large date ranges

#### Scenario: Cache compliance reports
- **WHEN** system generates monthly compliance report
- **THEN** system caches report for 24 hours
- **THEN** subsequent requests return cached report
- **THEN** cache is invalidated when new attestations are added

### Requirement: Attestation statistics and metrics

The system SHALL provide statistical analysis of attestation data for operational insights.

#### Scenario: Calculate attestation success rate
- **WHEN** operator views attestation dashboard
- **THEN** system calculates percentage of successful attestations
- **THEN** system shows success rate trend over time
- **THEN** system highlights periods with high failure rates

#### Scenario: Analyze attestation latency
- **WHEN** operator reviews performance metrics
- **THEN** system calculates average time from submission to confirmation
- **THEN** system shows latency distribution (p50, p95, p99)
- **THEN** system alerts if latency exceeds threshold

#### Scenario: Track attestation volume
- **WHEN** operator monitors system health
- **THEN** system shows attestations per hour/day/month
- **THEN** system compares current volume to historical baseline
- **THEN** system alerts on unusual volume spikes or drops

### Requirement: Blockchain transaction verification

The system SHALL provide tools to independently verify attestations on the blockchain.

#### Scenario: Verify attestation on-chain
- **WHEN** user requests verification of attestation
- **THEN** system queries blockchain node for transaction by hash
- **THEN** system retrieves transaction receipt and block details
- **THEN** system confirms transaction is included in blockchain
- **THEN** system displays block number, timestamp, and confirmation count

#### Scenario: Detect blockchain reorganization
- **WHEN** system verifies attestation after blockchain reorg
- **THEN** system detects block number has changed
- **THEN** system logs reorganization event
- **THEN** system updates attestation record with new block number

### Requirement: Audit trail API endpoints

The system SHALL provide REST API endpoints for querying attestation history and generating reports.

#### Scenario: Query attestation history via API
- **WHEN** client sends GET /attestation/history/:entityType/:entityId
- **THEN** system returns array of attestation records
- **THEN** system supports query parameters for filtering (dateFrom, dateTo, status)
- **THEN** system includes pagination metadata

#### Scenario: Search attestations via API
- **WHEN** client sends GET /attestation/search with query parameters
- **THEN** system searches attestations by transaction hash, entity ID, or date range
- **THEN** system returns matching attestations with relevance scoring
- **THEN** system supports pagination for large result sets

#### Scenario: Generate report via API
- **WHEN** client sends POST /attestation/reports with report parameters
- **THEN** system generates compliance report asynchronously
- **THEN** system returns report ID and status URL
- **THEN** system notifies client when report is ready for download

### Requirement: Attestation data retention

The system SHALL implement data retention policies for attestation records while preserving blockchain immutability.

#### Scenario: Archive old attestation records
- **WHEN** attestation records are older than retention period (7 years)
- **THEN** system moves records to archive storage
- **THEN** system maintains blockchain transaction references
- **THEN** system can restore archived records on demand

#### Scenario: Query archived attestations
- **WHEN** user queries attestations including archived data
- **THEN** system searches both active and archived storage
- **THEN** system indicates which records are archived
- **THEN** system retrieves archived records with acceptable latency
