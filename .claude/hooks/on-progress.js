// Claude Code Hook: Progress Update
// Triggered periodically during task execution (throttled)

const fetch = require('node-fetch');

let lastProgressTime = 0;
const THROTTLE_MS = 30000; // 30 seconds

module.exports = async function onProgress(context) {
  const { task, team, progress } = context;
  const now = Date.now();
  
  // Throttle progress updates
  if (now - lastProgressTime < THROTTLE_MS) {
    return;
  }
  lastProgressTime = now;
  
  console.log(`[HOOK] Progress: ${task.id} - ${progress.percentage}%`);
  
  const webhookUrl = process.env.OPENCLAW_WEBHOOK_URL || 'http://localhost:8080/webhook/claude';
  
  try {
    await fetch(`${webhookUrl}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'task.progress',
        timestamp: new Date().toISOString(),
        data: {
          taskId: task.id,
          teamName: team.name,
          progress: progress.percentage,
          currentStep: progress.step,
          filesModified: progress.filesModified || [],
          estimatedTimeRemaining: progress.estimatedTimeRemaining
        }
      })
    });
  } catch (error) {
    console.error('[HOOK] Failed to send progress notification:', error.message);
  }
};
