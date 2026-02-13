#!/usr/bin/env node
/**
 * OpenClaw Agent Teams Monitor
 * Monitors Claude Code Agent Teams and sends notifications
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');

const execAsync = promisify(exec);

class AgentTeamsMonitor {
  constructor(project, taskId) {
    this.project = project;
    this.taskId = taskId;
    this.workspace = `/root/.openclaw/workspace/projects/${project}`;
    this.outputDir = path.join(this.workspace, '.claude', 'output', taskId);
    this.resultsDir = path.join(this.workspace, '.claude', 'results');
    this.webhookUrl = process.env.OPENCLAW_WEBHOOK_URL || 'http://localhost:8080/webhook/claude';
    this.slackWebhook = process.env.SLACK_WEBHOOK_URL;
  }

  async start() {
    console.log(`[Monitor] Starting monitor for task: ${this.taskId}`);
    
    // Initial notification
    await this.notify('start', {
      taskId: this.taskId,
      project: this.project,
      status: 'monitoring',
      timestamp: new Date().toISOString()
    });

    // Start monitoring loop
    this.monitorInterval = setInterval(() => this.checkProgress(), 30000); // 30s
    
    // Also check immediately
    await this.checkProgress();
  }

  async checkProgress() {
    try {
      // Check output files
      const teams = ['frontend', 'backend', 'test', 'leader'];
      const progress = {};

      for (const team of teams) {
        const teamOutputDir = path.join(this.outputDir, team);
        
        try {
          const files = await fs.readdir(teamOutputDir);
          const logFile = path.join(teamOutputDir, 'output.log');
          
          if (files.includes('output.log')) {
            const stats = await fs.stat(logFile);
            const content = await fs.readFile(logFile, 'utf-8');
            
            // Check if completed
            const isComplete = content.includes('Task completed') || 
                              content.includes('Exit code:');
            
            progress[team] = {
              exists: true,
              size: stats.size,
              lines: content.split('\n').length,
              isComplete,
              lastModified: stats.mtime
            };
          } else {
            progress[team] = { exists: false };
          }
        } catch (e) {
          progress[team] = { exists: false, error: e.message };
        }
      }

      // Send progress notification
      await this.notify('progress', {
        taskId: this.taskId,
        progress,
        timestamp: new Date().toISOString()
      });

      // Check if all teams completed
      const allTeams = Object.values(progress).filter(p => p.exists);
      const completedTeams = allTeams.filter(p => p.isComplete);
      
      if (allTeams.length > 0 && allTeams.length === completedTeams.length) {
        await this.onAllComplete();
      }

    } catch (error) {
      console.error('[Monitor] Check progress error:', error);
    }
  }

  async onAllComplete() {
    console.log(`[Monitor] All teams completed for task: ${this.taskId}`);
    
    clearInterval(this.monitorInterval);
    
    // Collect results
    const results = await this.collectResults();
    
    // Send completion notification
    await this.notify('complete', {
      taskId: this.taskId,
      project: this.project,
      status: 'completed',
      results,
      timestamp: new Date().toISOString()
    });

    // Send Slack notification
    await this.sendSlackNotification(results);
  }

  async collectResults() {
    const results = {
      teams: {},
      files: []
    };

    const teams = ['frontend', 'backend', 'test', 'leader'];
    
    for (const team of teams) {
      const logFile = path.join(this.outputDir, team, 'output.log');
      
      try {
        const content = await fs.readFile(logFile, 'utf-8');
        
        // Extract modified files from output
        const fileMatches = content.match(/Modified:|Created:|Deleted:/g);
        
        results.teams[team] = {
          logSize: content.length,
          lines: content.split('\n').length,
          hasErrors: content.includes('Error:') || content.includes('FAILED'),
          summary: this.extractSummary(content)
        };
      } catch (e) {
        results.teams[team] = { error: e.message };
      }
    }

    return results;
  }

  extractSummary(content) {
    // Try to extract a summary from the output
    const lines = content.split('\n');
    const summaryLines = [];
    
    for (const line of lines.slice(-50)) { // Last 50 lines
      if (line.includes('✓') || line.includes('✅') || line.includes('Created') || line.includes('Modified')) {
        summaryLines.push(line.trim());
      }
    }
    
    return summaryLines.slice(0, 10); // Top 10
  }

  async notify(event, data) {
    try {
      const response = await fetch(`${this.webhookUrl}/${event}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        console.error(`[Monitor] Webhook failed: ${response.status}`);
      }
    } catch (error) {
      console.error('[Monitor] Notify error:', error.message);
    }
  }

  async sendSlackNotification(results) {
    if (!this.slackWebhook) return;

    const totalTeams = Object.keys(results.teams).length;
    const successfulTeams = Object.values(results.teams).filter(t => !t.error && !t.hasErrors).length;

    const message = {
      text: `✅ Agent Teams Task Completed: ${this.taskId}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Agent Teams Task Completed*\n• Project: ${this.project}\n• Task ID: ${this.taskId}\n• Teams: ${successfulTeams}/${totalTeams} successful`
          }
        }
      ]
    };

    try {
      await fetch(this.slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message)
      });
    } catch (error) {
      console.error('[Monitor] Slack notification error:', error.message);
    }
  }
}

// CLI entry
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: node monitor.js <project> <taskId>');
    process.exit(1);
  }

  const [project, taskId] = args;
  
  const monitor = new AgentTeamsMonitor(project, taskId);
  await monitor.start();
  
  console.log(`[Monitor] Monitoring started. Press Ctrl+C to stop.`);
  
  // Keep process alive
  process.stdin.resume();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { AgentTeamsMonitor };
