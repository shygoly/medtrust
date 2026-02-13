## ADDED Requirements

### Requirement: SQLite database configuration
The system SHALL use SQLite for data persistence.

#### Scenario: Database connection
- **WHEN** configuring database
- **THEN** system:
  - Uses better-sqlite3 for synchronous operations
  - Stores database file at configured path
  - Enables WAL mode for better concurrency
  - Sets proper busy timeout
  - Enables foreign keys

#### Scenario: Environment-based configuration
- **WHEN** running in different environments
- **THEN** system:
  - Development: SQLite file at `./data/dev.db`
  - Testing: In-memory or file at `./data/test.db`
  - Production: SQLite file at configured path
  - Supports connection pooling if needed

---

### Requirement: TypeORM entity definitions
The system SHALL use TypeORM for database operations.

#### Scenario: Entity configuration
- **WHEN** defining entities
- **THEN** system:
  - Uses TypeORM decorators (@Entity, @Column, etc.)
  - Defines proper TypeScript types
  - Sets up relations with lazy/eager loading
  - Configures indices for performance

#### Scenario: Repository pattern
- **WHEN** accessing data
- **THEN** system:
  - Uses TypeORM Repository pattern
  - Provides custom repositories for complex queries
  - Implements transaction support
  - Uses QueryBuilder for dynamic queries

---

### Requirement: Database migrations
The system SHALL support database schema migrations.

#### Scenario: Migration generation
- **WHEN** schema changes
- **THEN** system:
  - Auto-generates migrations from entity changes
  - Names migrations with timestamps
  - Stores migrations in `/migrations` directory

#### Scenario: Migration execution
- **WHEN** deploying application
- **THEN** system:
  - Runs pending migrations on startup
  - Supports rollback for failed migrations
  - Validates migration checksums
  - Logs migration execution

---

### Requirement: Data seeding
The system SHALL support database seeding for development.

#### Scenario: Development data
- **WHEN** setting up development environment
- **THEN** system provides seed data for:
  - Sample tenants of each type
  - Sample users with different roles
  - Sample data assets
  - Sample access requests and compute tasks

#### Scenario: Factory pattern
- **WHEN** creating test data
- **THEN** system uses factory pattern:
  - Generates realistic fake data
  - Handles entity relationships
  - Supports custom overrides
