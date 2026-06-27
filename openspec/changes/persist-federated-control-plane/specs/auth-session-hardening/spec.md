## ADDED Requirements

### Requirement: JWT signing secret is required in production
The system SHALL require an explicit `JWT_SECRET` and SHALL NOT fall back to a hardcoded
default. In production a missing or empty `JWT_SECRET` SHALL cause the API to fail to start.

#### Scenario: Production boot without a secret fails fast
- **WHEN** the API starts with `NODE_ENV=production` and `JWT_SECRET` unset or empty
- **THEN** startup aborts with a clear configuration error, and no tokens are ever signed with
  a hardcoded fallback

#### Scenario: Tokens are signed with the configured secret
- **WHEN** `JWT_SECRET` is set and the API issues a token
- **THEN** the token verifies only against that configured secret

### Requirement: Refresh-token rotation
The system SHALL issue a short-lived access token plus a longer-lived refresh token, and SHALL
allow exchanging a valid refresh token for a new access token without re-entering credentials.
Refresh tokens SHALL rotate on use.

#### Scenario: Refresh yields a new access token
- **WHEN** a client presents a valid, unexpired refresh token to `POST /auth/refresh`
- **THEN** the system returns a new access token and a new refresh token, and invalidates the
  presented refresh token

#### Scenario: Reusing a rotated refresh token is rejected
- **WHEN** a client presents a refresh token that has already been used (rotated)
- **THEN** the request is rejected as unauthorized

### Requirement: Bounded and revocable sessions
Access tokens SHALL be short-lived; refresh tokens SHALL have a bounded lifetime and SHALL be
revocable on logout.

#### Scenario: Logout revokes the refresh token
- **WHEN** a user logs out
- **THEN** their outstanding refresh token can no longer be exchanged for a new access token

#### Scenario: Expired refresh token requires re-login
- **WHEN** a refresh token has passed its bounded lifetime
- **THEN** `POST /auth/refresh` is rejected and the user must authenticate again
