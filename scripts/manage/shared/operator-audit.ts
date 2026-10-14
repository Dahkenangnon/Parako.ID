import { constants } from 'node:fs';
import { chmod, mkdir, open, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export type OperatorAuditStatus = 'attempt' | 'success' | 'failed';

export interface OperatorAuditEvent {
  action: string;
  status: OperatorAuditStatus;
  reason: string;
  target?: Record<string, string | number | boolean | null>;
}

const LOCK_STALE_AFTER_MS = 30_000;
const LOCK_RETRY_MS = 20;
const LOCK_RETRIES = 100;

function sanitizeText(value: string, field: string, maxLength: number): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${field} must be between 1 and ${maxLength} characters.`);
  }
  return normalized;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
    try {
      const handle = await open(
        lockPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600
      );
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
        })
      );
      await handle.close();
      return async () => {
        await unlink(lockPath).catch(error => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;

      const lockStat = await stat(lockPath).catch(() => undefined);
      if (lockStat && Date.now() - lockStat.mtimeMs > LOCK_STALE_AFTER_MS) {
        await unlink(lockPath).catch(unlinkError => {
          if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw unlinkError;
          }
        });
        continue;
      }
      await delay(LOCK_RETRY_MS);
    }
  }
  throw new Error('Timed out while waiting for the operator audit log lock.');
}

export async function writeOperatorAudit(
  projectRoot: string,
  event: OperatorAuditEvent
): Promise<void> {
  const logDirectory = path.join(projectRoot, 'runtime', 'logs');
  const auditPath = path.join(logDirectory, 'operator-audit.jsonl');
  const lockPath = path.join(logDirectory, '.operator-audit.lock');
  await mkdir(logDirectory, { recursive: true, mode: 0o700 });

  const release = await acquireLock(lockPath);
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      action: sanitizeText(event.action, 'Audit action', 100),
      status: event.status,
      reason: sanitizeText(event.reason, 'Audit reason', 500),
      actor: {
        uid: typeof process.getuid === 'function' ? process.getuid() : null,
        pid: process.pid,
      },
      ...(event.target ? { target: event.target } : {}),
    };
    const handle = await open(auditPath, 'a', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(entry)}\n`);
    } finally {
      await handle.close();
    }
    await chmod(auditPath, 0o600);
  } finally {
    await release();
  }
}
