const isProduction = process.env.NODE_ENV === 'production';

export const config = {
  port: parseInt(process.env.VIGIL_PORT || (isProduction ? '3915' : '4015'), 10),
  dbPath: process.env.VIGIL_DB_PATH || './data/vigil.db',
  binding: '127.0.0.1',
  spineUrl: process.env.SPINE_URL || (isProduction ? 'http://127.0.0.1:3800' : 'http://127.0.0.1:3801'),
  schedulerEnabled: process.env.VIGIL_SCHEDULER_ENABLED === 'true',
  registryPath: process.env.CV_REGISTRY_PATH || '/Library/AI/AI-Infra-MDvaults/MDvault-LLM-Ops/00-Registry/continuous-verification-registry.yaml',
  sqliteDbPath: process.env.SQLITE_DB_PATH || '/Library/AI/AI-Datastore/AI-KB-DB/ai-kb.db',
};
