#!/bin/bash
# Auto-generated Aider batch script
# Generated from OpenSpec

set -e

echo "🚀 Running Aider with OpenSpec prompts..."
echo ""

# Database Schema
aider --yes --message "$(cat .aider-prompts/monorepo-init-database-schema.md)" packages/database/src/entities/

# Nestjs Backend
aider --yes --message "$(cat .aider-prompts/monorepo-init-nestjs-backend.md)" apps/api/src/

# Nextjs Frontend
aider --yes --message "$(cat .aider-prompts/monorepo-init-nextjs-frontend.md)" apps/web/

# Project Structure
aider --yes --message "$(cat .aider-prompts/monorepo-init-project-structure.md)" apps/ packages/

# Sqlite Database
aider --yes --message "$(cat .aider-prompts/monorepo-init-sqlite-database.md)" packages/database/

echo ""
echo "✅ All implementations completed!"
