import fs from 'node:fs/promises';
import path from 'node:path';

export async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });

  const tempFile = path.join(
    directory,
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`,
  );
  const content = `${JSON.stringify(value, null, 2)}\n`;

  await fs.writeFile(tempFile, content, { encoding: 'utf8', mode: 0o600 });

  try {
    await fs.rename(tempFile, filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EPERM') {
      throw error;
    }

    await fs.rm(filePath, { force: true });
    await fs.rename(tempFile, filePath);
  } finally {
    await fs.rm(tempFile, { force: true }).catch(() => undefined);
  }
}
