import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLogFilePath, getLoggerHealth, logInfo, readLogs, waitForLogWrites } from '../src/lib/log.js';

const previousConfigHome = process.env.CQ_CONFIG_HOME;

let tempRoot = '';
let configHome = '';

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cqm-log-test-'));
  configHome = path.join(tempRoot, 'config');
  await fs.mkdir(configHome, { recursive: true });
  process.env.CQ_CONFIG_HOME = configHome;
});

afterEach(async () => {
  vi.restoreAllMocks();
  logInfo('test', 'reset logger health');
  await waitForLogWrites();

  if (previousConfigHome === undefined) {
    delete process.env.CQ_CONFIG_HOME;
  } else {
    process.env.CQ_CONFIG_HOME = previousConfigHome;
  }
});

describe('readLogs', () => {
  it('shows the tail of large logs instead of the full file', async () => {
    const largePrefix = 'HEADER START\n' + 'x'.repeat(205_000);
    const ending = '\nEND OF LOG';
    await fs.mkdir(path.dirname(getLogFilePath()), { recursive: true });
    await fs.writeFile(getLogFilePath(), `${largePrefix}${ending}`, 'utf8');

    const text = await readLogs();

    expect(text).toContain('Showing the last');
    expect(text).toContain('bytes.');
    expect(text).toContain('END OF LOG');
    expect(text).not.toContain('HEADER START');
  });
});

describe('logger health', () => {
  it('surfaces a warning when log writes fail', async () => {
    const appendSpy = vi.spyOn(fs, 'appendFile').mockRejectedValueOnce(new Error('disk full'));

    logInfo('test', 'this write will fail');
    await waitForLogWrites();

    expect(appendSpy).toHaveBeenCalled();
    expect(getLoggerHealth().healthy).toBe(false);
    expect(getLoggerHealth().message).toContain('Failed to write application logs.');
    expect(await readLogs()).toContain('Logger warning: Failed to write application logs.');
  });
});
