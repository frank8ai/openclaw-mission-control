/**
 * CLAW-109: Baseline Token Telemetry Script
 * Generates a snapshot of token usage by agent, job, and result.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const WORKSPACE_ROOT = '/Users/yizhi/.openclaw/workspace/mission-control';
const TELEMETRY_DIR = path.join(WORKSPACE_ROOT, 'data', 'telemetry');
const SNAPSHOT_PATH = path.join(TELEMETRY_DIR, `token-baseline-${new Date().toISOString().split('T')[0]}.json`);

function runCommand(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', cwd: WORKSPACE_ROOT });
  } catch (_error) {
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

  sessions.forEach((session) => {
    const agentId = session.agentId || 'unknown';
    if (!agentBaseline[agentId]) {
      agentBaseline[agentId] = {
        sessionCount: 0,
        totalTokens: 0,
        avgTokens: 0,
        models: []
      };
    }
    const currentAgent = agentBaseline[agentId];
    currentAgent.sessionCount++;
    currentAgent.totalTokens += (session.totalTokens || 0);
    if (session.model && !currentAgent.models.includes(session.model)) {
      currentAgent.models.push(session.model);
    }
  });

  // Calculate averages
  Object.keys(agentBaseline).forEach((agentId) => {
    const currentAgent = agentBaseline[agentId];
    currentAgent.avgTokens = currentAgent.sessionCount > 0 
      ? Math.round(currentAgent.totalTokens / currentAgent.sessionCount) 
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

  autopilotHistory.runs.forEach((run) => {
    const category = run.status || 'unknown';
    if (!jobStats[category]) {
      jobStats[category] = { count: 0 };
    }
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
