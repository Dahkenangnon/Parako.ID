export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Dependabot bodies contain advisory and comparison URLs that cannot be wrapped.
    'body-max-line-length': [0],
    'scope-enum': [
      2,
      'always',
      [
        'build',
        'ci',
        'cli',
        'config',
        'db',
        'deps',
        'docs',
        'errors',
        'i18n',
        'jobs',
        'lifecycle',
        'lint',
        'oidc',
        'reliability',
        'release',
        'security',
        'tenant',
        'test',
        'types',
        'webauthn',
      ],
    ],
  },
};
