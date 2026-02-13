## ADDED Requirements

### Requirement: Create MPC session

The system SHALL allow authenticated users to create a multi-party computation session with specified participants and computation type.

#### Scenario: Successful session creation
- **WHEN** user creates MPC session with 3 participants and computation type "secure_sum"
- **THEN** system generates session_id, registers participants, and returns session details

#### Scenario: Invalid participant count
- **WHEN** user creates MPC session with less than 2 participants
- **THEN** system returns 400 error with message "At least 2 participants required for MPC"

#### Scenario: Unsupported computation type
- **WHEN** user creates MPC session with computation type "unsupported_operation"
- **THEN** system returns 400 error with list of supported computation types

### Requirement: Submit secret shares

The system SHALL allow participants to submit their secret-shared data to an MPC session.

#### Scenario: Submit valid share
- **WHEN** participant submits encrypted share for their assigned party ID
- **THEN** system stores share and updates session status to reflect received shares

#### Scenario: Submit share for wrong party
- **WHEN** participant submits share with party_id that doesn't match their registration
- **THEN** system returns 403 error with message "Party ID mismatch"

#### Scenario: All shares received
- **WHEN** all participants have submitted their shares
- **THEN** system triggers computation phase and updates session status to "computing"

### Requirement: Execute secure sum computation

The system SHALL compute the sum of participant inputs without revealing individual values.

#### Scenario: Compute sum of patient counts
- **WHEN** 3 hospitals submit secret shares of their patient counts (100, 150, 200)
- **THEN** system returns result 450 without revealing individual hospital counts

#### Scenario: Handle negative values
- **WHEN** participants submit shares that include negative values
- **THEN** system correctly computes sum including negative values

### Requirement: Execute secure mean computation

The system SHALL compute the mean of participant inputs without revealing individual values.

#### Scenario: Compute mean drug efficacy
- **WHEN** 3 hospitals submit secret shares of drug efficacy rates (0.75, 0.82, 0.79)
- **THEN** system returns mean 0.787 without revealing individual hospital rates

#### Scenario: Handle zero count
- **WHEN** one participant submits zero count
- **THEN** system includes zero in mean calculation and returns correct result

### Requirement: Query computation result

The system SHALL allow participants to retrieve computation results for sessions they are part of.

#### Scenario: Query completed computation
- **WHEN** participant queries session that has completed computation
- **THEN** system returns computation result and session metadata

#### Scenario: Query in-progress computation
- **WHEN** participant queries session that is still computing
- **THEN** system returns status "computing" with estimated completion time

#### Scenario: Query session from non-participant
- **WHEN** user queries session they are not registered as participant
- **THEN** system returns 403 error

### Requirement: Enforce cryptographic security

The system SHALL use MP-SPDZ protocols to ensure no participant can learn others' inputs.

#### Scenario: Verify secret sharing
- **WHEN** computation executes with Shamir secret sharing
- **THEN** system ensures each participant holds only their share, not reconstructable without threshold

#### Scenario: Verify secure computation
- **WHEN** computation executes in MP-SPDZ runtime
- **THEN** system ensures all operations performed on encrypted shares without decryption

### Requirement: Handle participant timeout

The system SHALL detect and handle participant timeouts during MPC sessions.

#### Scenario: Participant fails to submit share
- **WHEN** participant does not submit share within 5 minutes of session creation
- **THEN** system marks session as "timeout" and notifies other participants

#### Scenario: Participant disconnects during computation
- **WHEN** participant connection drops during computation phase
- **THEN** system aborts computation and marks session as "failed"

### Requirement: Support session cancellation

The system SHALL allow session initiator to cancel MPC sessions before completion.

#### Scenario: Cancel pending session
- **WHEN** session initiator cancels session in "waiting_for_shares" status
- **THEN** system marks session as "cancelled" and notifies all participants

#### Scenario: Cannot cancel completed session
- **WHEN** user attempts to cancel session in "completed" status
- **THEN** system returns 409 error with message "Cannot cancel completed session"

### Requirement: Audit MPC operations

The system SHALL maintain audit trail of all MPC session operations without logging sensitive data.

#### Scenario: Query session history
- **WHEN** user requests their MPC session history
- **THEN** system returns list of sessions with timestamps, participants, computation type, and status

#### Scenario: Verify no plaintext logging
- **WHEN** system logs MPC operations
- **THEN** system ensures no plaintext input values or intermediate results are logged
