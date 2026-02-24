// Session Sharding and Handoff Policy for CLAW-108
// Hard thresholds: >=60k tokens or >=30 turns

const SESSION_SHARDING_CONFIG = {
  tokenThreshold: 60000, // 60k tokens
  turnThreshold: 30, // 30 turns/messages
  enabled: true,
};

function countSessionTurns(sessionKey, agentId, settings) {
  const sessionPath = path.join(
    settings.openclawHome,
    'agents',
    agentId,
    'sessions',
    `${sessionKey}.jsonl`,
  );

  if (!fs.existsSync(sessionPath)) {
    return 0;
  }

  const content = fs.readFileSync(sessionPath, 'utf8');
  const lines = content.split('\n').filter((line) => line.trim());
  return lines.length;
}

function checkSessionShardingThreshold(sessionKey, agentId, settings, config = SESSION_SHARDING_CONFIG) {
  if (!config.enabled) {
    return {
      shouldShard: false,
      reason: 'sharding-disabled',
      metrics: { tokens: 0, turns: 0 },
    };
  }

  const sessions = loadSessions(settings);
  const session = sessions.find((s) => s.key === sessionKey && s.agentId === agentId);

  if (!session) {
    return {
      shouldShard: false,
      reason: 'session-not-found',
      metrics: { tokens: 0, turns: 0 },
    };
  }

  const tokens = session.totalTokens || 0;
  const turns = countSessionTurns(sessionKey, agentId, settings);

  const shouldShard = tokens >= config.tokenThreshold || turns >= config.turnThreshold;
  const reason = shouldShard
    ? tokens >= config.tokenThreshold
      ? `token-threshold-exceeded (${tokens}/${config.tokenThreshold})`
      : `turn-threshold-exceeded (${turns}/${config.turnThreshold})`
    : 'within-thresholds';

  return {
    shouldShard,
    reason,
    metrics: { tokens, turns },
    thresholds: {
      tokenThreshold: config.tokenThreshold,
      turnThreshold: config.turnThreshold,
    },
  };
}

function createHandoffPackage(issueIdentifier, sessionKey, agentId, settings) {
  const sessions = loadSessions(settings);
  const session = sessions.find((s) => s.key === sessionKey && s.agentId === agentId);

  const issueLinks = readJsonFile(ISSUE_LINKS_PATH, { bySessionId: {}, bySessionKey: {} });
  const autopilotHistory = readJsonFile(LINEAR_AUTOPILOT_PATH, { runs: [] });

  const relatedRuns = autopilotHistory.runs.filter(
    (run) => run.issueIdentifier === issueIdentifier,
  );

  const handoffPackage = {
    issueIdentifier,
    sourceSession: {
      sessionKey,
      agentId,
      totalTokens: session ? session.totalTokens : 0,
      contextTokens: session ? session.contextTokens : 0,
      model: session ? session.model : '',
      updatedAt: session ? session.updatedAt : 0,
    },
    metrics: {
      tokens: session ? session.totalTokens : 0,
      turns: session ? countSessionTurns(sessionKey, agentId, settings) : 0,
    },
    recentRuns: relatedRuns.slice(0, 10).map((run) => ({
      runId: run.runId,
      status: run.status,
      summary: run.error || 'completed',
      atMs: run.atMs,
    })),
    context: {
      repositoryRoot: ROOT_DIR,
      sopPath: 'docs/sop/linear-codex-dev-sop.md',
    },
    handoffReason: 'session-sharding-threshold-exceeded',
    timestamp: new Date().toISOString(),
  };

  const handoffDir = path.join(DATA_DIR, 'handoffs');
  if (!fs.existsSync(handoffDir)) {
    fs.mkdirSync(handoffDir, { recursive: true });
  }

  const handoffFile = path.join(
    handoffDir,
    `${issueIdentifier}-${Date.now()}-handoff.json`,
  );
  fs.writeFileSync(handoffFile, JSON.stringify(handoffPackage, null, 2));

  return {
    package: handoffPackage,
    filePath: handoffFile,
  };
}

function enforceSessionHandoff(issueIdentifier, sessionKey, agentId, settings, checkResult) {
  const handoff = createHandoffPackage(issueIdentifier, sessionKey, agentId, settings);

  const handoffSummary = [
    `Session handoff enforced for ${issueIdentifier}`,
    `Reason: ${checkResult.reason}`,
    `Metrics: ${checkResult.metrics.tokens} tokens, ${checkResult.metrics.turns} turns`,
    `Thresholds: ${checkResult.thresholds.tokenThreshold} tokens, ${checkResult.thresholds.turnThreshold} turns`,
    `Handoff package saved to: ${handoff.filePath}`,
    `Source session: ${agentId}/${sessionKey}`,
  ].join('\n');

  return {
    enforced: true,
    summary: handoffSummary,
    handoffPackage: handoff.package,
    handoffFilePath: handoff.filePath,
    newSessionRequired: true,
  };
}
