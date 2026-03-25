import { describe, expect, it } from 'vitest';
import { getCodexAuthPath, getConfigDir, getOpenCodeAuthPaths } from '../src/lib/paths.js';

describe('path resolution', () => {
  it('resolves Windows-friendly config and auth locations', () => {
    const runtime = {
      platform: 'win32' as const,
      homeDir: 'C:\\Users\\Test',
      env: {
        APPDATA: 'C:\\Users\\Test\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local',
      },
    };

    expect(getCodexAuthPath(runtime)).toBe('C:\\Users\\Test\\.codex\\auth.json');
    expect(getConfigDir(runtime)).toBe('C:\\Users\\Test\\AppData\\Roaming\\codex-quota-manager');
    expect(getOpenCodeAuthPaths(runtime)).toContain('C:\\Users\\Test\\AppData\\Local\\opencode\\auth.json');
    expect(getOpenCodeAuthPaths(runtime)).toContain('C:\\Users\\Test\\AppData\\Roaming\\opencode\\auth.json');
  });

  it('honors explicit environment overrides', () => {
    const runtime = {
      platform: 'linux' as const,
      homeDir: '/home/tester',
      env: {
        CODEX_AUTH_PATH: '/tmp/codex-auth.json',
        CQ_CONFIG_HOME: '/tmp/cqm',
        OPENCODE_AUTH_PATH: '/tmp/opencode-auth.json',
      },
    };

    expect(getCodexAuthPath(runtime)).toBe('/tmp/codex-auth.json');
    expect(getConfigDir(runtime)).toBe('/tmp/cqm');
    expect(getOpenCodeAuthPaths(runtime)[0]).toBe('/tmp/opencode-auth.json');
  });

  it('falls back to XDG config on Linux', () => {
    const runtime = {
      platform: 'linux' as const,
      homeDir: '/home/tester',
      env: {
        XDG_CONFIG_HOME: '/home/tester/.config-alt',
      },
    };

    expect(getConfigDir(runtime)).toBe('/home/tester/.config-alt/codex-quota-manager');
  });
});
