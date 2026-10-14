import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeOperatorAudit } from '../../../scripts/manage/shared/operator-audit.js';

describe('operator audit log', () => {
  it('appends structured events to a protected JSONL file', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'parako-audit-'));

    await writeOperatorAudit(root, {
      action: 'bootstrap_admin.replace_pending',
      status: 'attempt',
      reason: 'Correcting\na deployment address',
      target: { newEmail: 'admin@example.com' },
    });

    const auditPath = path.join(root, 'runtime/logs/operator-audit.jsonl');
    const content = await readFile(auditPath, 'utf8');
    const entry = JSON.parse(content.trim()) as Record<string, unknown>;
    expect(entry).toMatchObject({
      action: 'bootstrap_admin.replace_pending',
      status: 'attempt',
      reason: 'Correcting a deployment address',
      target: { newEmail: 'admin@example.com' },
    });
    expect(entry).toHaveProperty('timestamp');
    expect(entry).toHaveProperty('actor.pid');
    expect(content).not.toContain('token');
    expect((await stat(auditPath)).mode & 0o777).toBe(0o600);
  });

  it('serializes concurrent writers without losing an event', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'parako-audit-'));

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        writeOperatorAudit(root, {
          action: 'security.recovery',
          status: 'success',
          reason: `Authorized recovery operation ${index}`,
        })
      )
    );

    const content = await readFile(
      path.join(root, 'runtime/logs/operator-audit.jsonl'),
      'utf8'
    );
    const entries = content
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as { reason: string });
    expect(entries).toHaveLength(8);
    expect(new Set(entries.map(entry => entry.reason))).toHaveLength(8);
  });
});
