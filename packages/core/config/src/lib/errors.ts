export class ConfigError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(issues.length > 0 ? `${message}: ${issues.join('; ')}` : message);
    this.name = 'ConfigError';
  }
}
