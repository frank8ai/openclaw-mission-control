import fs from 'fs';
import path from 'path';

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || '/Users/yizhi/.openclaw/workspace';

export function readWorkspaceFile(relativePath: string): string | null {
  const fullPath = path.join(WORKSPACE_ROOT, relativePath);
  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

export function listWorkspaceDir(relativePath: string): string[] {
  const fullPath = path.join(WORKSPACE_ROOT, relativePath);
  try {
    return fs.readdirSync(fullPath);
  } catch {
    return [];
  }
}

export function getCronJobs(): { name: string; nextRun: string; status: string }[] {
  // Placeholder - will integrate with OpenClaw API later
  return [
    { name: 'Todoist Reminder', nextRun: '20:00', status: 'scheduled' },
    { name: 'X Learning Scan', nextRun: '00:00', status: 'scheduled' },
    { name: 'Daily Briefing', nextRun: '08:00', status: 'pending_config' },
  ];
}
