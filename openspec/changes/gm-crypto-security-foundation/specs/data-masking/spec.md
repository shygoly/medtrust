# Data Masking Specification

## ADDED Requirements

### Requirement: Phone Number Masking

The system shall mask phone numbers to hide middle digits while preserving format recognition.

#### Scenario: Mask 11-digit Chinese mobile number

- **WHEN** a phone number "13812345678" is masked
- **THEN** the system returns "138****5678"
- **AND** the first 3 digits are visible
- **AND** the middle 4 digits are replaced with asterisks
- **AND** the last 4 digits are visible

#### Scenario: Mask landline number

- **WHEN** a landline number with area code is masked
- **THEN** the system preserves the area code format
- **AND** the middle digits are replaced with asterisks
- **AND** the last 4 digits remain visible

---

### Requirement: ID Card Number Masking

The system shall mask Chinese ID card numbers (18 digits) to protect personal identity information.

#### Scenario: Mask 18-digit ID card number

- **WHEN** an ID card number "110101199001011234" is masked
- **THEN** the system returns "110101********1234"
- **AND** the first 6 digits (region code) are visible
- **AND** the middle 8 digits (birthdate) are replaced with asterisks
- **AND** the last 4 digits (sequence and checksum) are visible

#### Scenario: Mask 15-digit old format ID card

- **WHEN** a 15-digit ID card number is masked
- **THEN** the system returns first 6 and last 3 digits visible
- **AND** the middle 6 digits are replaced with asterisks

---

### Requirement: Name Masking

The system shall mask personal names to protect privacy while maintaining recognizability.

#### Scenario: Mask Chinese name

- **WHEN** a Chinese name "张三" is masked
- **THEN** the system returns "张*"
- **AND** the first character (surname) is visible
- **AND** all remaining characters are replaced with single asterisk

#### Scenario: Mask longer Chinese name

- **WHEN** a Chinese name "欧阳修" is masked
- **THEN** the system returns "欧*"
- **AND** only the first character is visible
- **AND** all other characters are masked with single asterisk

#### Scenario: Mask English name

- **WHEN** an English name "John Smith" is masked
- **THEN** the system returns "J*** S****"
- **AND** the first letter of each word is visible
- **AND** remaining letters are replaced with asterisks

---

### Requirement: Email Masking

The system shall mask email addresses to protect contact information.

#### Scenario: Mask email address

- **WHEN** an email "zhangsan@example.com" is masked
- **THEN** the system returns "zh****an@example.com"
- **AND** the first 2 characters of local part are visible
- **AND** the last 2 characters of local part are visible
- **AND** the domain remains fully visible

#### Scenario: Mask short email

- **WHEN** an email with short local part "ab@example.com" is masked
- **THEN** the system returns "a*@example.com"
- **AND** at least one character remains visible

---

### Requirement: Masking Decorator for DTOs

The system shall provide a decorator that automatically masks fields in API responses.

#### Scenario: Apply masking decorator to DTO property

- **WHEN** a DTO property is decorated with `@Masked('phone')`
- **THEN** the property value is automatically masked when serialized
- **AND** the masking happens during JSON serialization
- **AND** the original value in the entity remains unmasked

#### Scenario: Multiple masked fields in DTO

- **WHEN** a DTO has multiple `@Masked()` decorators with different types
- **THEN** each field is masked according to its specified type
- **AND** undecorated fields remain unmasked
- **AND** the masking is applied consistently across all API responses

---

### Requirement: Conditional Masking Based on Permissions

The system shall support conditional masking based on user permissions or roles.

#### Scenario: Admin user sees unmasked data

- **WHEN** a user with 'admin' role requests patient data
- **THEN** the system returns unmasked sensitive fields
- **AND** the masking decorator is bypassed for admin users

#### Scenario: Regular user sees masked data

- **WHEN** a user with 'member' role requests patient data
- **THEN** the system returns masked sensitive fields
- **AND** the masking decorator applies to all sensitive fields

#### Scenario: Data owner sees unmasked data

- **WHEN** a user requests their own data
- **THEN** the system returns unmasked values
- **AND** the masking is bypassed for data ownership context

---

### Requirement: Null and Empty Value Handling

The system shall handle null and empty values gracefully without errors.

#### Scenario: Mask null value

- **WHEN** a null value is passed to masking function
- **THEN** the system returns null without error
- **AND** no masking operation is performed

#### Scenario: Mask empty string

- **WHEN** an empty string is passed to masking function
- **THEN** the system returns empty string without error
- **AND** no masking operation is performed

---

### Requirement: Audit Logging for Unmasked Access

The system shall log when users access unmasked sensitive data.

#### Scenario: Log unmasked data access

- **WHEN** an admin user accesses unmasked patient data
- **THEN** the system logs the access event
- **AND** the log includes user ID, patient ID, timestamp, and accessed fields
- **AND** the log does not include the actual sensitive values

#### Scenario: Log masking bypass

- **WHEN** masking is bypassed due to permissions
- **THEN** the system logs the bypass event
- **AND** the log includes the reason for bypass (admin role, data owner, etc.)

---

## Implementation Notes

- Implement masking functions as pure utility functions for reusability
- Use TypeScript decorators with metadata reflection for DTO masking
- Consider using class-transformer library for serialization control
- Masking should be applied at the presentation layer, not data layer
- Store unmasked data in database - masking is for display only
- Support custom masking patterns via configuration
- Document which fields are masked in API documentation
- Consider performance impact of masking in high-throughput scenarios
- Masking patterns should be culturally appropriate (Chinese vs Western names)
