#!/bin/bash
#
# MedTrust Claude Agent Teams Launcher
# Quick start script for MedTrust async development
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="medtrust"
WORKSPACE="/root/.openclaw/workspace/projects/${PROJECT}"

cd "$WORKSPACE"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  MedTrust Claude Agent Teams${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Check configuration
echo -e "${YELLOW}[1/4] Checking configuration...${NC}"

if [ ! -f ".claude/settings.json" ]; then
  echo -e "${RED}❌ .claude/settings.json not found${NC}"
  exit 1
fi

# Verify agent teams is enabled
if ! grep -q 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS' .claude/settings.json; then
  echo -e "${YELLOW}⚠️  Agent Teams not enabled in settings.json${NC}"
  echo "Please add: \"env\": { \"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS\": \"1\" }"
fi

echo -e "${GREEN}✅ Configuration OK${NC}"

# Parse arguments
TEAMS="${1:-frontend,backend}"
NOTIFY="${2:-slack:openclawgoly}"

echo ""
echo -e "${YELLOW}[2/4] Development Plan${NC}"
echo "  Teams: ${TEAMS}"
echo "  Notify: ${NOTIFY}"
echo ""

# Show team definitions
echo -e "${YELLOW}[3/4] Teams Configuration${NC}"
echo ""

cat .claude/settings.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for name, team in data['teams'].items():
    print(f'  📋 {team[\"name\"]}')
    print(f'     └─ {team[\"description\"]}')
    print()
" 2>/dev/null || echo "  (Python not available, skipping details)"

# Export environment
export PROJECT_NAME="$PROJECT"
export OPENCLAW_WEBHOOK_URL="${OPENCLAW_WEBHOOK_URL:-http://localhost:8080/webhook/claude}"
export SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL}"

# Create task ID
TASK_ID="${PROJECT}-$(date +%Y%m%d)-$(openssl rand -hex 4)"

echo -e "${YELLOW}[4/4] Launching Teams${NC}"
echo "  Task ID: ${TASK_ID}"
echo ""

# Launch function
launch_team() {
  local TEAM=$1
  local TASK_DESC=$2
  
  echo -e "  🚀 Starting ${TEAM} team..."
  
  # Create output directory
  mkdir -p ".claude/output/${TASK_ID}/${TEAM}"
  
  # Start Claude in background
  (
    claude \
      --teams-mode \
      --config .claude/settings.json \
      --team "medtrust-${TEAM}" \
      --message "$TASK_DESC" \
      > ".claude/output/${TASK_ID}/${TEAM}/output.log" 2>&1
    
    echo "Exit code: $?" >> ".claude/output/${TASK_ID}/${TEAM}/output.log"
  ) &
  
  echo $! > ".claude/output/${TASK_ID}/${TEAM}/pid"
  echo "     └─ PID: $(cat .claude/output/${TASK_ID}/${TEAM}/pid)"
}

# Launch each team
IFS=',' read -ra TEAM_ARRAY <<< "$TEAMS"
for TEAM in "${TEAM_ARRAY[@]}"; do
  case $TEAM in
    frontend)
      launch_team "frontend" "Create UI components and pages for MedTrust Phase 2. Focus on compute task forms and audit log views."
      ;;
    backend)
      launch_team "backend" "Implement Flower federated learning integration and complete Audit module. Create API endpoints for compute tasks."
      ;;
    test)
      launch_team "test" "Write comprehensive tests for new compute task and audit features. Include E2E tests."
      ;;
    leader)
      launch_team "leader" "Review code from frontend and backend teams. Ensure consistency and quality."
      ;;
    *)
      echo "  ⚠️  Unknown team: ${TEAM}"
      ;;
  esac
done

# Save task metadata
mkdir -p ".claude/tasks"
cat > ".claude/tasks/${TASK_ID}.json" << EOF
{
  "taskId": "${TASK_ID}",
  "project": "${PROJECT}",
  "teams": [$(echo "$TEAMS" | sed 's/[^,]*/"&"/g')],
  "startedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "status": "running",
  "notify": "${NOTIFY}"
}
EOF

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  All Teams Launched!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Task ID: ${TASK_ID}"
echo ""
echo "Monitoring Commands:"
echo "  📊 View logs:     tail -f .claude/output/${TASK_ID}/*/output.log"
echo "  📈 Check status:  cat .claude/tasks/${TASK_ID}.json"
echo "  🔍 List processes: ps aux | grep claude"
echo ""
echo "Results will be saved to:"
echo "  📁 .claude/results/${TASK_ID}-*.json"
echo ""

# Start completion hook in background
echo -e "${YELLOW}Starting completion hook...${NC}"
node "${SCRIPT_DIR}/on-complete-hook.js" "${PROJECT}" "${TASK_ID}" "${TEAMS}" > ".claude/output/${TASK_ID}/hook.log" 2>&1 &
echo "  └─ Hook PID: $!"
echo ""

echo -e "${GREEN}✅ You will receive a notification when all teams complete.${NC}"
echo ""

# Output JSON
cat << EOF
{
  "taskId": "${TASK_ID}",
  "project": "${PROJECT}",
  "status": "started",
  "teams": [$(echo "$TEAMS" | sed 's/[^,]*/"&"/g')],
  "outputDir": ".claude/output/${TASK_ID}",
  "resultDir": ".claude/results",
  "taskFile": ".claude/tasks/${TASK_ID}.json"
}
EOF

echo ""
