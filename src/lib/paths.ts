import os from 'node:os';
import path from 'node:path';

export interface PathRuntime {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
}

const APP_DIR = 'codex-quota-manager';

function getRuntime(runtime?: PathRuntime) {
  return {
    env: runtime?.env ?? process.env,
    homeDir: runtime?.homeDir ?? os.homedir(),
    platform: runtime?.platform ?? process.platform,
  };
}

function getPathApi(runtime?: PathRuntime) {
  const { platform } = getRuntime(runtime);
  return platform === 'win32' ? path.win32 : path.posix;
}

export function cleanPath(value: string | undefined, runtime?: PathRuntime): string {
  if (!value) {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const { homeDir } = getRuntime(runtime);
  const pathApi = getPathApi(runtime);
  if (trimmed === '~') {
    return homeDir;
  }

  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return pathApi.join(homeDir, trimmed.slice(2));
  }

  return pathApi.normalize(trimmed);
}

export function getCodexAuthPath(runtime?: PathRuntime): string {
  const { env, homeDir } = getRuntime(runtime);
  const pathApi = getPathApi(runtime);

  if (env.CODEX_AUTH_PATH) {
    return cleanPath(env.CODEX_AUTH_PATH, runtime);
  }

  if (env.CODEX_HOME) {
    return pathApi.join(cleanPath(env.CODEX_HOME, runtime), 'auth.json');
  }

  return pathApi.join(homeDir, '.codex', 'auth.json');
}

export function getOpenCodeAuthPaths(runtime?: PathRuntime): string[] {
  const { env, homeDir, platform } = getRuntime(runtime);
  const pathApi = getPathApi(runtime);
  const candidates: string[] = [];

  if (env.OPENCODE_AUTH_PATH) {
    candidates.push(cleanPath(env.OPENCODE_AUTH_PATH, runtime));
  }

  if (env.OPENCODE_DATA_DIR) {
    candidates.push(pathApi.join(cleanPath(env.OPENCODE_DATA_DIR, runtime), 'auth.json'));
  }

  if (platform === 'win32') {
    const localAppData = cleanPath(env.LOCALAPPDATA, runtime);
    const roamingAppData = cleanPath(env.APPDATA, runtime);

    if (localAppData) {
      candidates.push(pathApi.join(localAppData, 'opencode', 'auth.json'));
    }
    if (roamingAppData) {
      candidates.push(pathApi.join(roamingAppData, 'opencode', 'auth.json'));
    }
  }

  candidates.push(
    pathApi.join(homeDir, '.local', 'share', 'opencode', 'auth.json'),
    pathApi.join(homeDir, '.config', 'opencode', 'auth.json'),
    pathApi.join(homeDir, 'Library', 'Application Support', 'opencode', 'auth.json'),
    pathApi.join(homeDir, '.opencode', 'auth.json'),
  );

  return [...new Set(candidates.filter(Boolean))];
}

export function getConfigDir(runtime?: PathRuntime): string {
  const { env, homeDir, platform } = getRuntime(runtime);
  const pathApi = getPathApi(runtime);

  if (env.CQM_CONFIG_DIR) {
    return cleanPath(env.CQM_CONFIG_DIR, runtime);
  }

  if (env.CQ_CONFIG_HOME) {
    return cleanPath(env.CQ_CONFIG_HOME, runtime);
  }

  if (platform === 'win32') {
    const base = cleanPath(env.APPDATA, runtime) || pathApi.join(homeDir, 'AppData', 'Roaming');
    return pathApi.join(base, APP_DIR);
  }

  if (platform === 'darwin') {
    return pathApi.join(homeDir, 'Library', 'Application Support', APP_DIR);
  }

  const xdgConfig = cleanPath(env.XDG_CONFIG_HOME, runtime);
  return pathApi.join(xdgConfig || pathApi.join(homeDir, '.config'), APP_DIR);
}

export function getManagedAccountsPath(runtime?: PathRuntime): string {
  return getPathApi(runtime).join(getConfigDir(runtime), 'accounts.json');
}
