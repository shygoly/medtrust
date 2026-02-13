## ADDED Requirements

### Requirement: Initialize monorepo structure
The system SHALL have a monorepo structure with separate frontend and backend packages.

#### Scenario: Create directory structure
- **WHEN** initializing the project
- **THEN** system creates the following structure:
  - `/apps/web` - Next.js frontend application
  - `/apps/api` - NestJS backend application
  - `/packages/shared` - Shared types and utilities
  - `/packages/database` - Database schema and migrations

#### Scenario: Configure package manager
- **WHEN** setting up the project
- **THEN** system configures pnpm workspaces with proper dependencies

---

### Requirement: Setup NestJS backend
The system SHALL have a NestJS backend application with proper configuration.

#### Scenario: Initialize NestJS app
- **WHEN** creating the backend
- **THEN** system creates a NestJS app with:
  - Main module and bootstrap
  - Configuration module for environment variables
  - Logger configuration
  - CORS and security middleware

#### Scenario: Configure SQLite with TypeORM
- **WHEN** setting up the database
- **THEN** system configures:
  - TypeORM module with SQLite connection
  - Entity definitions for core tables
  - Migration system
  - Database configuration for development and production

---

### Requirement: Setup Next.js frontend
The system SHALL have a Next.js frontend with shadcn/ui components.

#### Scenario: Initialize NextJS app
- **WHEN** creating the frontend
- **THEN** system creates a Next.js app with:
  - App Router structure
  - Tailwind CSS configuration
  - shadcn/ui component library
  - API client configuration for backend communication

---

### Requirement: Configure development environment
The system SHALL provide development tooling and configuration.

#### Scenario: Setup dev scripts
- **WHEN** running development server
- **THEN** system provides:
  - Concurrent dev servers for frontend and backend
  - Hot reload for both applications
  - Shared environment variable configuration
  - Docker Compose for optional services (blockchain node)

#### Scenario: Configure linting and formatting
- **WHEN** developing code
- **THEN** system enforces:
  - ESLint configuration for TypeScript
  - Prettier formatting
  - Import sorting
  - Git hooks for pre-commit checks
