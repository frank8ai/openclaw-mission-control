#!/usr/bin/env node

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

function runStep(label, command, args, options) {
  process.stdout.write(`\n[mission-control] ${label}\n`);
  const result = spawnSync(command, args, options);
  if (result.status !== 0) {
    const code = result.status == null ? 1 : result.status;
    process.stderr.write(
      `[mission-control] failed: ${command} ${args.join(' ')} (exit=${code})\n`,
    );
    process.exit(code);
  }
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const verifyOnly = Boolean(flags['verify-only']);
  const skipVerify = Boolean(flags['skip-verify']);
  const team = String(
    flags.team || process.env.MISSION_CONTROL_LINEAR_TEAM || 'openclaw',
  ).trim();

  const missionControlRoot = path.resolve(__dirname, '..');
  const workspaceRoot = path.resolve(missionControlRoot, '..');
  const setupScript = path.join(workspaceRoot, 'scripts', 'linear_sot_setup.py');
  const verifyScript = path.join(workspaceRoot, 'scripts', 'linear_sot_verify.py');

  if (!fs.existsSync(setupScript) || !fs.existsSync(verifyScript)) {
    process.stderr.write(
      '[mission-control] linear scripts not found. Expected:\n' +
        `- ${setupScript}\n` +
        `- ${verifyScript}\n`,
    );
    process.exit(1);
  }

  const execOptions = {
    cwd: workspaceRoot,
    stdio: 'inherit',
    env: process.env,
  };

  if (!verifyOnly) {
    runStep(
      `Sync Linear SoT (team=${team})`,
      'python3',
      [setupScript, '--team', team, '--apply'],
      execOptions,
    );
  }

  if (!skipVerify) {
    runStep(
      `Verify Linear SoT (team=${team})`,
      'python3',
      [verifyScript, '--team', team],
      execOptions,
    );
  }

  process.stdout.write('\n[mission-control] linear bootstrap completed.\n');
}

main();
