import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfigDir } from './paths.js';
import { truncate } from './utils.js';

const LOG_DIR = 'logs';
const LOG_FILE = 'app.log';
const MAX_LOG_VIEW_BYTES = 200_000;

let writeQueue = Promise.resolve();

type LoggerHealth = {
  healthy: boolean;
  message?: string;
};

let loggerHealth: LoggerHealth = { healthy: true };

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export function logInfo(scope: string, message: string, details?: unknown): void {
  enqueueLog('INFO', scope, message, details);
}

export function logWarn(scope: string, message: string, details?: unknown): void {
  enqueueLog('WARN', scope, message, details);
}

export function logError(scope: string, message: string, details?: unknown): void {
  enqueueLog('ERROR', scope, message, details);
}

export async function readLogs(): Promise<string> {
  const filePath = getLogFilePath();
  const healthWarning = loggerHealth.healthy || !loggerHealth.message
    ? ''
    : `Logger warning: ${loggerHealth.message}\n\n`;

  try {
    const { content, truncated } = await readLogTail(filePath, MAX_LOG_VIEW_BYTES);
    if (!content.trim()) {
      return `${healthWarning}No log entries yet.`.trim();
    }

    if (!truncated) {
      return `${healthWarning}${content.trim()}`.trim();
    }

    return `${healthWarning}Log output is large. Showing the last ${MAX_LOG_VIEW_BYTES.toLocaleString()} bytes.\n\n${content.trim()}`.trim();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return `${healthWarning}No log file exists yet.`.trim();
    }
    throw error;
  }
}

export function getLogFilePath(): string {
  return path.join(getConfigDir(), LOG_DIR, LOG_FILE);
}

export function getLoggerHealth(): LoggerHealth {
  return { ...loggerHealth };
}

export async function waitForLogWrites(): Promise<void> {
  await writeQueue;
}

export function formatErrorForLog(error: unknown): string {
  if (error instanceof Error) {
    const parts = [error.name, error.message].filter(Boolean);
    const cause = formatErrorCause(error);
    const rendered = cause ? `${parts.join(': ')} | cause: ${cause}` : parts.join(': ');
    return truncate(rendered, 800);
  }

  return truncate(String(error), 800);
}

function enqueueLog(level: LogLevel, scope: string, message: string, details?: unknown): void {
  const writeLine = async () => {
    try {
      const filePath = getLogFilePath();
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const line = renderLogLine(level, scope, message, details);
      await fs.appendFile(filePath, line, 'utf8');
      loggerHealth = { healthy: true };
    } catch (error) {
      loggerHealth = {
        healthy: false,
        message: `Failed to write application logs. ${formatErrorForLog(error)}`,
      };
    }
  };

  writeQueue = writeQueue.then(writeLine, writeLine);
}

function renderLogLine(level: LogLevel, scope: string, message: string, details?: unknown): string {
  const prefix = `[${new Date().toISOString()}] [${level}] [${scope}] ${message}`;
  const detailText = formatDetails(details);

  return detailText ? `${prefix} | ${detailText}\n` : `${prefix}\n`;
}

function formatDetails(details: unknown): string {
  if (details === undefined || details === null) {
    return '';
  }

  if (typeof details === 'string') {
    return truncate(details, 1200);
  }

  if (details instanceof Error) {
    return formatErrorForLog(details);
  }

  try {
    return truncate(JSON.stringify(details), 1200);
  } catch {
    return truncate(String(details), 1200);
  }
}

function formatErrorCause(error: Error): string {
  const cause = (error as Error & { cause?: unknown }).cause;
  if (!cause) {
    return '';
  }

  if (cause instanceof Error) {
    const code = typeof (cause as Error & { code?: unknown }).code === 'string'
      ? (cause as Error & { code?: string }).code
      : '';
    const parts = [code, cause.name, cause.message].filter(Boolean);
    return parts.join(': ');
  }

  if (typeof cause === 'object') {
    try {
      return JSON.stringify(cause);
    } catch {
      return String(cause);
    }
  }

  return String(cause);
}

async function readLogTail(filePath: string, maxBytes: number): Promise<{ content: string; truncated: boolean }> {
  const handle = await fs.open(filePath, 'r');

  try {
    const stats = await handle.stat();
    const totalBytes = stats.size;
    const bytesToRead = Math.min(totalBytes, maxBytes);
    if (bytesToRead <= 0) {
      return { content: '', truncated: false };
    }

    const buffer = Buffer.alloc(bytesToRead);
    const start = totalBytes - bytesToRead;
    await handle.read(buffer, 0, bytesToRead, start);
    return {
      content: buffer.toString('utf8'),
      truncated: totalBytes > maxBytes,
    };
  } finally {
    await handle.close();
  }
}
