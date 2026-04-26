export interface SystemdConfig {
  user: string;
  workingDirectory: string;
  envFile: string;
  nodePath: string;
  serviceName: string;
  /** Resource limit for the main app service. Default: 1G */
  memoryApp?: string;
  /** Resource limit for the worker service. Default: 300M */
  memoryWorker?: string;
}

export interface UnitFiles {
  app: string;
  worker: string;
}
