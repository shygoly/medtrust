// Claude Code Hook: Task Start
// Triggered when a subagent starts working on a task

const fetch = require('node-fetch');

module.exports = async function onTaskStart(context) {
  const { task, team, session } = context;
  
  console.log(`[HOOK] Task started: ${task.id} by ${team.name}`);
  
  // Send notification to OpenClaw Gateway
  const webhookUrl = process.env.OPENCLAW_WEBHOOK_URL || 'http://localhost:8080/webhook/claude';
  
  try {
    await fetch(`${webhookUrl}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'task.start',
        timestamp: new Date().toISOString(),
        data: {
          taskId: task.id,
          taskDescription: task.description,
          teamName: team.name,
          teamType: team.type,
          sessionId: session.id,
          project: process.env.PROJECT_NAME || 'unknown'
        }
      })
    });
  } catch (error) {
    console.error('[HOOK] Failed to send start notification:', error.message);
  }
};
