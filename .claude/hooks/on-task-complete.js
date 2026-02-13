// Claude Code Hook: Task Complete
// Triggered when a subagent successfully completes a task

const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');

module.exports = async function onTaskComplete(context) {
  const { task, team, result, session } = context;
  
  console.log(`[HOOK] Task completed: ${task.id} by ${team.name}`);
  console.log(`[HOOK] Files modified: ${result.filesModified?.length || 0}`);
  console.log(`[HOOK] Duration: ${result.duration}ms`);
  
  // Save result to file
  const resultDir = path.join(process.cwd(), '.claude', 'results');
  await fs.mkdir(resultDir, { recursive: true });
  
  const resultFile = path.join(resultDir, `${task.id}-complete.json`);
  await fs.writeFile(resultFile, JSON.stringify({
    taskId: task.id,
    teamName: team.name,
    completedAt: new Date().toISOString(),
    duration: result.duration,
    filesModified: result.filesModified || [],
    summary: result.summary,
    output: result.output
  }, null, 2));
  
  // Send notification to OpenClaw Gateway
  const webhookUrl = process.env.OPENCLAW_WEBHOOK_URL || 'http://localhost:8080/webhook/claude';
  
  try {
    await fetch(`${webhookUrl}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'task.complete',
        timestamp: new Date().toISOString(),
        data: {
          taskId: task.id,
          teamName: team.name,
          teamType: team.type,
          status: 'success',
          duration: result.duration,
          filesModified: result.filesModified || [],
          summary: result.summary,
          resultFile: resultFile
        }
      })
    });
  } catch (error) {
    console.error('[HOOK] Failed to send completion notification:', error.message);
  }
  
  // Also try to notify via Slack if configured
  const slackWebhook = process.env.SLACK_WEBHOOK_URL;
  if (slackWebhook) {
    try {
      await fetch(slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `✅ Claude Task Completed`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Task Completed*\n• Team: ${team.name}\n• Task: ${task.description}\n• Files: ${result.filesModified?.length || 0}\n• Duration: ${Math.round(result.duration / 1000)}s`
              }
            }
          ]
        })
      });
    } catch (error) {
      console.error('[HOOK] Failed to send Slack notification:', error.message);
    }
  }
};
