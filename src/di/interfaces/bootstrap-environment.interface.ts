export interface IBootstrapEnvironment {
  readonly nodeEnvironment: string | undefined;
  readonly encryptionKey: string | undefined;
  readonly ipinfoApiToken: string | undefined;
  readonly ipQualityScoreApiKey: string | undefined;
}
