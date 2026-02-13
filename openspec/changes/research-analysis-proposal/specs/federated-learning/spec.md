## ADDED Requirements

### Requirement: Submit federated learning job

The system SHALL allow authenticated users to submit a federated learning job with specified algorithm, participants, and training parameters.

#### Scenario: Successful horizontal FL job submission
- **WHEN** user submits a horizontal FL job with algorithm "logistic_regression", 2 participants, and valid dataset references
- **THEN** system creates a job record, returns job_id, and initiates FATE Flow job

#### Scenario: Invalid participant count
- **WHEN** user submits FL job with less than 2 participants
- **THEN** system returns 400 error with message "At least 2 participants required"

#### Scenario: Unauthorized access
- **WHEN** unauthenticated user attempts to submit FL job
- **THEN** system returns 401 error

### Requirement: Query federated learning job status

The system SHALL allow users to query the status of their federated learning jobs.

#### Scenario: Query running job
- **WHEN** user queries a job that is currently training
- **THEN** system returns job status "running" with progress percentage and estimated completion time

#### Scenario: Query completed job
- **WHEN** user queries a job that has completed successfully
- **THEN** system returns job status "completed" with model download URL and performance metrics

#### Scenario: Query failed job
- **WHEN** user queries a job that failed during training
- **THEN** system returns job status "failed" with error message and failure reason

### Requirement: Download trained model

The system SHALL allow users to download trained federated learning models.

#### Scenario: Download completed model
- **WHEN** user requests model download for a completed job they own
- **THEN** system returns model file in FATE format with appropriate content-type header

#### Scenario: Download model before completion
- **WHEN** user requests model download for a job that is still running
- **THEN** system returns 409 error with message "Model not ready"

#### Scenario: Download model from another tenant
- **WHEN** user requests model download for a job owned by different tenant
- **THEN** system returns 403 error

### Requirement: Support horizontal federated learning

The system SHALL support horizontal federated learning where participants have same features but different samples.

#### Scenario: Train logistic regression model
- **WHEN** user submits horizontal FL job with algorithm "logistic_regression" and 3 hospital participants
- **THEN** system trains model using FATE's SecureBoost algorithm with secure aggregation

#### Scenario: Train neural network model
- **WHEN** user submits horizontal FL job with algorithm "neural_network" and 2 hospital participants
- **THEN** system trains model using FATE's federated neural network with differential privacy

### Requirement: Support vertical federated learning

The system SHALL support vertical federated learning where participants have different features for same samples.

#### Scenario: Train vertical FL model with feature alignment
- **WHEN** user submits vertical FL job with 2 participants having overlapping patient IDs
- **THEN** system performs PSI (private set intersection) to align samples and trains model on combined features

#### Scenario: Insufficient overlap
- **WHEN** user submits vertical FL job with participants having less than 10% patient ID overlap
- **THEN** system returns 400 error with message "Insufficient sample overlap for vertical FL"

### Requirement: Enforce privacy guarantees

The system SHALL enforce differential privacy and secure aggregation for all federated learning operations.

#### Scenario: Apply differential privacy
- **WHEN** user submits FL job with privacy_budget parameter
- **THEN** system applies differential privacy noise with specified epsilon value during training

#### Scenario: Secure gradient aggregation
- **WHEN** FL job aggregates gradients from participants
- **THEN** system uses secure aggregation protocol ensuring no participant sees raw gradients from others

### Requirement: Manage participant lifecycle

The system SHALL manage participant registration, heartbeat monitoring, and failure handling.

#### Scenario: Participant drops during training
- **WHEN** one participant becomes unreachable during FL job execution
- **THEN** system pauses job, notifies coordinator, and allows job resumption or cancellation

#### Scenario: All participants ready
- **WHEN** all registered participants send ready signal
- **THEN** system starts training round and distributes initial model parameters

### Requirement: Track job history and audit

The system SHALL maintain complete audit trail of all federated learning operations.

#### Scenario: Query job history
- **WHEN** user requests job history for their tenant
- **THEN** system returns list of all jobs with timestamps, participants, status, and model metrics

#### Scenario: Export audit log
- **WHEN** admin requests audit log for specific job
- **THEN** system returns detailed log including participant actions, model updates, and privacy parameters
