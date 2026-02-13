#!/usr/bin/env node
/**
 * Simple Agent Teams Completion Hook
 * Sends notification to OpenClaw when all teams complete
 */

const fs = require('fs').promises;
const path = require('path');

async function notifyOpenClaw(taskId, project, status, results) {
  const webhookUrl = process.env.OPENCLAW_WEBHOOK_URL || 'http://localhost:8080/webhook/claude/complete';
  
  const payload = {
    event: 'teams.complete',
    taskId,
    project,
    status,
    results,
    timestamp: new Date().toISOString()
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (response.ok) {
      console.log(`[Hook] Notification sent for ${taskId}`);
    } else {
      console.error(`[Hook] Failed: ${response.status}`);
    }
  } catch (error) {
    console.error(`[Hook] Error: ${error.message}`);
  }
}

async function checkTeamsComplete(outputDir, teams) {
  const completed = [];
  
  for (const team of teams) {
    const logFile = path.join(outputDir, team, 'output.log');
    
    try {
      const content = await fs.readFile(logFile, 'utf-8');
      // Check if log indicates completion (has exit code or completion marker)
      if (content.includes('Exit code:') || content.includes('Task completed')) {
        completed.push(team);
      }
    } catch (e) {
      // File doesn't exist yet
    }
  }
  
  return { 
    allComplete: completed.length === teams.length && teams.length > 0,
    completed,
    pending: teams.filter(t => !completed.includes(t))
  };
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: node on-complete-hook.js <project> <taskId> [teams]');
    process.exit(1);
  }

  const [project, taskId, teamsStr = 'frontend,backend,test'] = args;
  const teams = teamsStr.split(',');
  
  const outputDir = `/root/.openclaw/workspace/projects/${project}/.claude/output/${taskId}`;
  
  console.log(`[Hook] Monitoring ${taskId} for completion...`);
  console.log(`[Hook] Teams: ${teams.join(', ')}`);
  
  // Config
  const CHECK_INTERVAL = 5000; // Check every 5 seconds
  const CONFIRM_DELAY = 3000; // Wait 3 seconds after detecting completion
  const MAX_WAIT_TIME = 3600000; // Max 1 hour
  
  const startTime = Date.now();
  let confirmationTimer = null;
  let lastCompleted = [];
  
  // Poll every 5 seconds until all teams complete
  const checkInterval = setInterval(async () => {
    const elapsed = Date.now() - startTime;
    
    // Timeout check
    if (elapsed > MAX_WAIT_TIME) {
      clearInterval(checkInterval);
      console.log(`[Hook] Timeout after ${MAX_WAIT_TIME}ms`);
      process.exit(1);
    }
    
    const { allComplete, completed, pending } = await checkTeamsComplete(outputDir, teams);
    
    console.log(`[Hook] ${completed.length}/${teams.length} teams complete (${completed.join(', ')}) | Pending: ${pending.join(', ') || 'none'}`);
    
    if (allComplete) {
      // Check if this is the first time we see all complete
      if (lastCompleted.length !== teams.length) {
        lastCompleted = completed;
        console.log(`[Hook] All teams appear complete, waiting ${CONFIRM_DELAY}ms to confirm...`);
        
        // Set confirmation timer
        confirmationTimer = setTimeout(async () => {
          // Re-check to ensure still complete
          const recheck = await checkTeamsComplete(outputDir, teams);
          
          if (recheck.allComplete) {
            clearInterval(checkInterval);
            
            console.log(`[Hook] All teams confirmed complete! Sending notification...`);
            
            // Collect simple results
            const results = { teams: {} };
            for (const team of teams) {
              try {
                const logFile = path.join(outputDir, team, 'output.log');
                const content = await fs.readFile(logFile, 'utf-8');
                const lines = content.split('\n');
                
                results.teams[team] = {
                  lines: lines.length,
                  hasErrors: content.includes('Error:') || content.includes('FAILED'),
                  completed: true
                };
              } catch (e) {
                results.teams[team] = { error: true };
              }
            }
            
            // Send notification
            await notifyOpenClaw(taskId, project, 'completed', results);
            
            console.log(`[Hook] Done!`);
            process.exit(0);
          } else {
            console.log(`[Hook] Completion not confirmed, continuing to monitor...`);
          }
        }, CONFIRM_DELAY);
      }
    } else {
      // Reset confirmation if no longer all complete
      if (confirmationTimer) {
        clearTimeout(confirmationTimer);
        confirmationTimer = null;
        console.log(`[Hook] Completion status changed, resetting confirmation timer...`);
      }
      lastCompleted = completed;
    }
  }, CHECK_INTERVAL);
}

main().catch(err => {
  console.error('[Hook]', err);
  process.exit(1);
});
