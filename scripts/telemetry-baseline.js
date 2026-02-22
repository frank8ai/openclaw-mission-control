#!/usr/local/bin/node
/**
 * CLAW-109: Baseline Token Telemetry Script
 * Generates a snapshot of token usage by agent, job, and result.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORKSPACE_ROOT = '/Users/yizhi/.openclaw/workspace/mission-control';
const TELEMETRY_DIR = path.join(WORKSPACE_ROOT, 'data', 'telemetry');
const SNAPSHOT_PATH = path.join(TELEMETRY_DIR, `token-baseline-${new Date().toISOString().split('T')[0]}.json`);

function runCommand(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', cwd: WORKSPACE_ROOT });
  } catch (error) {
    return null;
  }
}

async function main() {
  console.log('[CLAW-109] Collecting baseline token telemetry...');

  // 1. Collect session data via openclaw status --json
  const statusOutput = runCommand('openclaw status --json');
  const status = statusOutput ? JSON.parse(statusOutput) : null;
  
  const sessions = (status && status.sessions && status.sessions.recent) || [];
  const agentBaseline = {};

  sessions.forEach(session => {
    const agentId = session.agentId || 'unknown';
    if (!agentBaseline[agentId]) {
      agentBaseline[agentId] = {
        sessionCount: 0,
        totalTokens: 0,
        avgTokens: 0,
        models: new Set()
      };
    }
    agentBaseline[agentId].sessionCount++;
    agentBaseline[agentId].totalTokens += (session.totalTokens || 0);
    if (session.model) agentBaseline[agentId].models.add(session.model);
  });

  // Convert Set to Array for JSON
  Object.keys(agentBaseline).forEach(agentId => {
    agentBaseline[agentId].models = Array.from(agentBaseline[agentId].models);
    agentBaseline[agentId].avgTokens = agentBaseline[agentId].sessionCount > 0 
      ? Math.round(agentBaseline[agentId].totalTokens / agentBaseline[agentId].sessionCount) 
      : 0;
  });

  // 2. Collect autopilot job history
  const autopilotPath = path.join(WORKSPACE_ROOT, 'data', 'control-center', 'linear-autopilot.json');
  let autopilotHistory = { runs: [] };
  if (fs.existsSync(autopilotPath)) {
    autopilotHistory = JSON.parse(fs.readFileSync(autopilotPath, 'utf8'));
  }

  const jobStats = {
    success: { count: 0 },
    failure: { count: 0 },
    in_progress: { count: 0 }
  };

  autopilotHistory.runs.forEach(run => {
    const category = run.status || 'unknown';
    if (!jobStats[category]) jobStats[category] = { count: 0 };
    jobStats[category].count++;
  });

  const finalSnapshot = {
    timestamp: new Date().toISOString(),
    scope: 'baseline-control-group',
    agents: agentBaseline,
    jobs: jobStats,
    meta: {
      totalSessions: sessions.length,
      totalAutopilotRuns: autopilotHistory.runs.length
    }
  };

  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(finalSnapshot, null, 2));
  console.log(`[CLAW-109] Baseline snapshot saved to: ${SNAPSHOT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
