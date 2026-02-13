// Claude Code Hook: Task Fail
// Triggered when a subagent fails to complete a task

const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');

module.exports = async function onTaskFail(context) {
  const { task, team, error, session } = context;
  
  console.error(`[HOOK] Task failed: ${task.id} by ${team.name}`);
  console.error(`[HOOK] Error: ${error.message}`);
  
  // Save error to file
  const resultDir = path.join(process.cwd(), '.claude', 'results');
  await fs.mkdir(resultDir, { recursive: true });
  
  const errorFile = path.join(resultDir, `${task.id}-error.json`);
  await fs.writeFile(errorFile, JSON.stringify({
    taskId: task.id,
    teamName: team.name,
    failedAt: new Date().toISOString(),
    error: {
      message: error.message,
      stack: error.stack,
      code: error.code
    },
    sessionOutput: session.output
  }, null, 2));
  
  // Send notification to OpenClaw Gateway
  const webhookUrl = process.env.OPENCLAW_WEBHOOK_URL || 'http://localhost:8080/webhook/claude';
  
  try {
    await fetch(`${webhookUrl}/fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'task.fail',
        timestamp: new Date().toISOString(),
        data: {
          taskId: task.id,
          teamName: team.name,
          teamType: team.type,
          status: 'failed',
          error: {
            message: error.message,
            code: error.code
          },
          errorFile: errorFile
        }
      })
    });
  } catch (notifyError) {
    console.error('[HOOK] Failed to send failure notification:', notifyError.message);
  }
  
  // Slack notification for failures
  const slackWebhook = process.env.SLACK_WEBHOOK_URL;
  if (slackWebhook) {
    try {
      await fetch(slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `❌ Claude Task Failed`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Task Failed*\n• Team: ${team.name}\n• Task: ${task.description}\n• Error: ${error.message}`
              }
            }
          ]
        })
      });
    } catch (notifyError) {
      console.error('[HOOK] Failed to send Slack notification:', notifyError.message);
    }
  }
};
