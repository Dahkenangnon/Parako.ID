export interface ConfigDiff {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  changeType: 'added' | 'modified' | 'removed';
}

export interface ConfigImpact {
  servicesAffected: string[];
  requiresRestart: boolean;
  warnings: string[];
}
