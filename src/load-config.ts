import { loadConfig } from 'c12';
import type { LumeConfig } from './config.js';

export async function loadLumeConfig(cwd = process.cwd()): Promise<LumeConfig> {
  const loaded = await loadConfig<LumeConfig>({
    name: 'lume',
    cwd,
    configFile: 'lume.config',
    defaults: {},
    jitiOptions: { moduleCache: false },
  });
  return loaded.config;
}
