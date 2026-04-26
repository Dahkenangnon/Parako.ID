import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    // Node.js backend files
    files: ['src/**/*.ts', 'scripts/**/*.ts', 'test/**/*.ts', '*.js', '*.ts'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        // Node.js globals
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        console: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        // ES2020 globals
        BigInt: 'readonly',
        Promise: 'readonly',
        Symbol: 'readonly',
        Map: 'readonly',
        Set: 'readonly',
        WeakMap: 'readonly',
        WeakSet: 'readonly',
        Proxy: 'readonly',
        Reflect: 'readonly',
      },
    },
    rules: {
      // TypeScript specific rules
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],

      // General rules
      'no-console': 'off',
      'no-unused-vars': 'off', // Use TypeScript version instead
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',

      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'warn',
      'no-useless-escape': 'error',
      'no-useless-catch': 'error',
      'no-case-declarations': 'warn',
      'no-dupe-keys': 'error',
    },
  },
  {
    // Browser frontend files
    files: ['public/**/*.js', 'src/assets/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        history: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        fetch: 'readonly',
        XMLHttpRequest: 'readonly',
        screen: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        // DOM types
        NodeListOf: 'readonly',
        HTMLCollection: 'readonly',
        Element: 'readonly',
        HTMLElement: 'readonly',
        Document: 'readonly',
        Window: 'readonly',
        Node: 'readonly',
        HTMLFormElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLSelectElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLImageElement: 'readonly',
        // File and Blob APIs
        Blob: 'readonly',
        FileReader: 'readonly',
        File: 'readonly',
        // Event types
        Event: 'readonly',
        EventSource: 'readonly',
        KeyboardEvent: 'readonly',
        MessageEvent: 'readonly',
        ClipboardEvent: 'readonly',
        PageTransitionEvent: 'readonly',
        // Observer types
        MutationObserver: 'readonly',
        // ES2020 globals
        BigInt: 'readonly',
        Promise: 'readonly',
        Symbol: 'readonly',
        Map: 'readonly',
        Set: 'readonly',
        WeakMap: 'readonly',
        WeakSet: 'readonly',
        Proxy: 'readonly',
        Reflect: 'readonly',
      },
    },
    rules: {
      // Only errors for frontend code - suppress all warnings
      'no-console': 'off',
      'no-unused-vars': 'off',
      'prefer-const': 'off',
      'no-var': 'off',
      'object-shorthand': 'off',
      'prefer-template': 'off',
      'no-useless-escape': 'off',
      'no-case-declarations': 'off',
      // Keep only critical errors
      'no-dupe-keys': 'error',
      'no-undef': 'error',
    },
  },
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'test-results/**',
      '*.min.js',
      '*.bundle.js',
      '.git/**',
      '.worktrees/**',
      'parako-id-v*.tar.gz',
      'parako-id-v*.zip',
      'public/js/**',
      'ecosystem.config.cjs',
      'runtime/locales/.merged/**',
      'options/locales/.merged/**',
      'data/**',
    ],
  }
);
