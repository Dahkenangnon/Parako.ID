import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';
import ts from 'typescript';
import { z } from 'zod';

export interface SourceModule {
  path: string;
  source: string;
}

interface RequiredNamedImport {
  modulePath: string;
  specifier: string;
  names: readonly string[];
}

const REQUIRED_NAMED_IMPORTS: readonly RequiredNamedImport[] = [
  {
    modulePath: 'src/validators/auth/social.ts',
    specifier: '../../config/social-providers.js',
    names: ['CONFIGURABLE_SOCIAL_PROVIDER_IDS'],
  },
  {
    modulePath: 'src/assets/js/admin/layout.ts',
    specifier: '../utils/panel-layout.js',
    names: [
      'applyPanelTheme',
      'setDropdownOpen',
      'setMobileSidebarOpen',
      'setSidebarExpanded',
      'toggleDropdown',
    ],
  },
  {
    modulePath: 'src/assets/js/account/layout.ts',
    specifier: '../utils/panel-layout.js',
    names: [
      'applyPanelTheme',
      'setDropdownOpen',
      'setMobileSidebarOpen',
      'setSidebarExpanded',
      'toggleDropdown',
    ],
  },
  {
    modulePath: 'src/assets/js/admin/settings/branding.ts',
    specifier: '../../utils/confirmed-action.js',
    names: ['requestConfirmation'],
  },
  {
    modulePath: 'src/assets/js/admin/settings/common.ts',
    specifier: '../../utils/confirmed-action.js',
    names: ['requestConfirmation'],
  },
  {
    modulePath: 'src/assets/js/auth/mfa-verify.ts',
    specifier: '../utils/otp-input-controller.js',
    names: ['OtpInputController'],
  },
  {
    modulePath: 'src/assets/js/auth/recovery-verify-code.ts',
    specifier: '../utils/otp-input-controller.js',
    names: ['OtpInputController'],
  },
  {
    modulePath: 'src/assets/js/auth/setup-mfa.ts',
    specifier: '../utils/otp-input-controller.js',
    names: ['OtpInputController'],
  },
  {
    modulePath: 'src/assets/js/auth/oidc/mfa.ts',
    specifier: '../../utils/otp-input-controller.js',
    names: ['OtpInputController'],
  },
  {
    modulePath: 'src/assets/js/webauthn/authenticate.ts',
    specifier: '../utils/webauthn-browser.js',
    names: [
      'decodeBase64Url',
      'encodeBase64Url',
      'isSafeSameOriginRedirect',
      'isWebAuthnSupported',
    ],
  },
  {
    modulePath: 'src/assets/js/webauthn/register.ts',
    specifier: '../utils/webauthn-browser.js',
    names: [
      'decodeBase64Url',
      'encodeBase64Url',
      'isSafeSameOriginRedirect',
      'isWebAuthnSupported',
    ],
  },
];

const FORBIDDEN_SOURCE_MODULES = new Map([
  [
    'src/di/interfaces/base-service.interface.ts',
    'Legacy false CRUD Module is forbidden',
  ],
  ...['facebook', 'github', 'google', 'linkedin', 'microsoft'].map(
    provider =>
      [
        `src/di/interfaces/${provider}-social-login.interface.ts`,
        'Nominal provider-specific social-login Interface is forbidden',
      ] as const
  ),
]);

const FORBIDDEN_METHODS = new Map<string, ReadonlySet<string>>([
  ['src/assets/js/admin/settings/branding.ts', new Set(['uploadIconFile'])],
]);

const FORBIDDEN_BROWSER_INTERFACE_NAMES = new Set([
  'LucideApi',
  'WindowWithLucide',
]);

const MODULE_SCOPED_BROWSER_ROOTS = new Set([
  'src/assets/js/auth/login.ts',
  'src/assets/js/auth/oidc/login.ts',
  'src/assets/js/auth/register.ts',
  'src/assets/js/auth/mfa-verify.ts',
  'src/assets/js/auth/recovery-verify-code.ts',
  'src/assets/js/auth/setup-mfa.ts',
  'src/assets/js/auth/oidc/mfa.ts',
  'src/assets/js/webauthn/authenticate.ts',
  'src/assets/js/webauthn/register.ts',
]);

function parseModule(module: SourceModule): ts.SourceFile {
  return ts.createSourceFile(
    module.path,
    module.source,
    ts.ScriptTarget.Latest,
    true,
    module.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

function collectNamedImports(
  sourceFile: ts.SourceFile
): Map<string, Set<string>> {
  const imports = new Map<string, Set<string>>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      !statement.importClause?.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }

    const names =
      imports.get(statement.moduleSpecifier.text) ?? new Set<string>();
    for (const element of statement.importClause.namedBindings.elements) {
      names.add(element.propertyName?.text ?? element.name.text);
    }
    imports.set(statement.moduleSpecifier.text, names);
  }

  return imports;
}

function collectModuleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }

  return specifiers;
}

function collectDirectServiceConstructions(
  sourceFile: ts.SourceFile
): string[] {
  const constructions: string[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      /Service$/u.test(node.expression.text)
    ) {
      constructions.push(node.expression.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return constructions;
}

function collectClassMethodNames(sourceFile: ts.SourceFile): Set<string> {
  const methodNames = new Set<string>();

  function visit(node: ts.Node): void {
    if (
      ts.isMethodDeclaration(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name))
    ) {
      methodNames.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return methodNames;
}

function hasTopLevelIife(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(statement => {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isCallExpression(statement.expression)
    ) {
      return false;
    }

    let expression: ts.Expression = statement.expression.expression;
    while (ts.isParenthesizedExpression(expression)) {
      expression = expression.expression;
    }

    return (
      ts.isFunctionExpression(expression) || ts.isArrowFunction(expression)
    );
  });
}

function collectInterfaceNames(sourceFile: ts.SourceFile): Set<string> {
  const interfaceNames = new Set<string>();

  function visit(node: ts.Node): void {
    if (ts.isInterfaceDeclaration(node)) {
      interfaceNames.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return interfaceNames;
}

export function evaluateSourceModuleRules(
  modules: readonly SourceModule[]
): string[] {
  const violations: string[] = [];
  const modulesByPath = new Map(modules.map(module => [module.path, module]));

  for (const [forbiddenPath, message] of FORBIDDEN_SOURCE_MODULES) {
    if (modulesByPath.has(forbiddenPath)) {
      violations.push(`${message}: ${forbiddenPath}`);
    }
  }

  for (const module of modules) {
    const sourceFile = parseModule(module);

    if (
      (module.path.startsWith('src/di/modules/') ||
        module.path.startsWith('src/di/factories/')) &&
      countTypeEscapes(sourceFile, module.source).anyAssertions > 0
    ) {
      violations.push(
        `DI composition root uses an any assertion: ${module.path}`
      );
    }

    if (module.path.startsWith('src/di/interfaces/')) {
      for (const specifier of collectModuleSpecifiers(sourceFile)) {
        if (specifier.includes('/utils/')) {
          violations.push(
            `DI contract imports a utility Implementation: ${module.path} -> ${specifier}`
          );
        }
      }
    }

    if (module.path.startsWith('src/assets/js/')) {
      if (
        MODULE_SCOPED_BROWSER_ROOTS.has(module.path) &&
        hasTopLevelIife(sourceFile)
      ) {
        violations.push(
          `Browser entry must use module scope instead of an IIFE: ${module.path}`
        );
      }

      const interfaceNames = collectInterfaceNames(sourceFile);
      for (const interfaceName of FORBIDDEN_BROWSER_INTERFACE_NAMES) {
        if (interfaceNames.has(interfaceName)) {
          violations.push(
            `Browser external-global Interface must be declared centrally: ${module.path} -> ${interfaceName}`
          );
        }
      }
    }

    if (module.path.startsWith('src/controllers/')) {
      for (const implementation of collectDirectServiceConstructions(
        sourceFile
      )) {
        violations.push(
          `Controller constructs Service Implementation directly: ${module.path} -> ${implementation}`
        );
      }
    }

    const forbiddenMethods = FORBIDDEN_METHODS.get(module.path);
    if (forbiddenMethods) {
      const methodNames = collectClassMethodNames(sourceFile);
      for (const methodName of forbiddenMethods) {
        if (methodNames.has(methodName)) {
          violations.push(
            `Duplicate browser Implementation is forbidden: ${module.path} -> ${methodName}`
          );
        }
      }
    }
  }

  for (const requirement of REQUIRED_NAMED_IMPORTS) {
    const module = modulesByPath.get(requirement.modulePath);
    if (!module) continue;

    const importedNames = collectNamedImports(parseModule(module)).get(
      requirement.specifier
    );
    for (const name of requirement.names) {
      if (!importedNames?.has(name)) {
        violations.push(
          `Required shared import missing: ${requirement.modulePath} -> ${name} from ${requirement.specifier}`
        );
      }
    }
  }

  return [...new Set(violations)].sort();
}

export interface TypeEscapeCounts {
  explicitAny: number;
  anyAssertions: number;
  nonNullAssertions: number;
  typescriptSuppressions: number;
}

export interface ArchitectureSnapshot {
  sourceFiles: number;
  cycles: string[][];
  typeEscapes: TypeEscapeCounts;
  directEnvironmentModules: string[];
}

export interface ArchitectureBaseline {
  version: 1;
  sourceRoot: 'src';
  allowedCycles: string[][];
  allowedDirectEnvironmentModules: string[];
  maximumTypeEscapes: TypeEscapeCounts;
}
const TypeEscapeCountsSchema = z
  .object({
    explicitAny: z.number().int().nonnegative(),
    anyAssertions: z.number().int().nonnegative(),
    nonNullAssertions: z.number().int().nonnegative(),
    typescriptSuppressions: z.number().int().nonnegative(),
  })
  .strict();
const ArchitectureBaselineSchema = z
  .object({
    version: z.literal(1),
    sourceRoot: z.literal('src'),
    allowedCycles: z.array(z.array(z.string()).min(1)),
    allowedDirectEnvironmentModules: z.array(z.string()),
    maximumTypeEscapes: TypeEscapeCountsSchema,
  })
  .strict();

const TYPE_ESCAPE_KEYS = [
  'explicitAny',
  'anyAssertions',
  'nonNullAssertions',
  'typescriptSuppressions',
] as const satisfies readonly (keyof TypeEscapeCounts)[];

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function resolveRelativeImport(
  importer: string,
  specifier: string,
  sourcePaths: ReadonlySet<string>
): string | undefined {
  if (!specifier.startsWith('.')) return undefined;

  const unresolved = normalizePath(posix.join(dirname(importer), specifier));
  const withoutRuntimeExtension = unresolved.replace(/\.(?:c|m)?jsx?$/u, '');
  const candidates = [
    unresolved,
    `${unresolved}.ts`,
    `${unresolved}.tsx`,
    `${withoutRuntimeExtension}.ts`,
    `${withoutRuntimeExtension}.tsx`,
    `${withoutRuntimeExtension}.d.ts`,
    posix.join(unresolved, 'index.ts'),
    posix.join(unresolved, 'index.tsx'),
  ];

  return candidates.find(candidate => sourcePaths.has(candidate));
}

function collectStaticImports(sourceFile: ts.SourceFile): string[] {
  const imports: string[] = [];

  for (const statement of sourceFile.statements) {
    if (
      (ts.isImportDeclaration(statement) ||
        ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      imports.push(statement.moduleSpecifier.text);
    }
  }

  return imports;
}

function countTypeEscapes(
  sourceFile: ts.SourceFile,
  source: string
): TypeEscapeCounts {
  const counts: TypeEscapeCounts = {
    explicitAny: 0,
    anyAssertions: 0,
    nonNullAssertions: 0,
    typescriptSuppressions:
      source.match(/@ts-(?:check|expect-error|ignore|nocheck)\b/gu)?.length ??
      0,
  };

  function visit(node: ts.Node): void {
    if (node.kind === ts.SyntaxKind.AnyKeyword) counts.explicitAny += 1;
    if (
      (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
      node.type.kind === ts.SyntaxKind.AnyKeyword
    ) {
      counts.anyAssertions += 1;
    }
    if (ts.isNonNullExpression(node)) counts.nonNullAssertions += 1;
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return counts;
}

function hasDirectEnvironmentAccess(sourceFile: ts.SourceFile): boolean {
  let found = false;

  function visit(node: ts.Node): void {
    if (found) return;

    const propertyAccess =
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'process' &&
      node.name.text === 'env';
    const elementAccess =
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'process' &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === 'env';

    if (propertyAccess || elementAccess) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

function findStronglyConnectedComponents(
  graph: ReadonlyMap<string, readonly string[]>
): string[][] {
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  let nextIndex = 0;

  function visit(node: string): void {
    const index = nextIndex++;
    indices.set(node, index);
    lowLinks.set(node, index);
    stack.push(node);
    onStack.add(node);

    for (const dependency of graph.get(node) ?? []) {
      if (!indices.has(dependency)) {
        visit(dependency);
        lowLinks.set(
          node,
          Math.min(lowLinks.get(node)!, lowLinks.get(dependency)!)
        );
      } else if (onStack.has(dependency)) {
        lowLinks.set(
          node,
          Math.min(lowLinks.get(node)!, indices.get(dependency)!)
        );
      }
    }

    if (lowLinks.get(node) !== indices.get(node)) return;

    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (!member) throw new Error('Architecture graph stack underflow');
      onStack.delete(member);
      component.push(member);
    } while (member !== node);

    const selfCycle =
      component.length === 1 &&
      (graph.get(component[0]) ?? []).includes(component[0]);
    if (component.length > 1 || selfCycle) components.push(component.sort());
  }

  for (const node of [...graph.keys()].sort()) {
    if (!indices.has(node)) visit(node);
  }

  return components.sort((left, right) =>
    left.join('\n').localeCompare(right.join('\n'))
  );
}

export function analyzeSourceModules(
  modules: readonly SourceModule[]
): ArchitectureSnapshot {
  const normalizedModules = modules
    .map(module => ({ ...module, path: normalizePath(module.path) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const sourcePaths = new Set(normalizedModules.map(module => module.path));
  const graph = new Map<string, string[]>();
  const directEnvironmentModules: string[] = [];
  const typeEscapes: TypeEscapeCounts = {
    explicitAny: 0,
    anyAssertions: 0,
    nonNullAssertions: 0,
    typescriptSuppressions: 0,
  };

  for (const module of normalizedModules) {
    const sourceFile = ts.createSourceFile(
      module.path,
      module.source,
      ts.ScriptTarget.Latest,
      true,
      module.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const dependencies = collectStaticImports(sourceFile)
      .map(specifier =>
        resolveRelativeImport(module.path, specifier, sourcePaths)
      )
      .filter((dependency): dependency is string => Boolean(dependency));
    graph.set(module.path, [...new Set(dependencies)].sort());
    if (hasDirectEnvironmentAccess(sourceFile)) {
      directEnvironmentModules.push(module.path);
    }

    const moduleCounts = countTypeEscapes(sourceFile, module.source);
    for (const key of TYPE_ESCAPE_KEYS) {
      typeEscapes[key] += moduleCounts[key];
    }
  }

  return {
    sourceFiles: normalizedModules.length,
    cycles: findStronglyConnectedComponents(graph),
    typeEscapes,
    directEnvironmentModules,
  };
}

export function createArchitectureBaseline(
  snapshot: ArchitectureSnapshot
): ArchitectureBaseline {
  return {
    version: 1,
    sourceRoot: 'src',
    allowedCycles: snapshot.cycles,
    allowedDirectEnvironmentModules: snapshot.directEnvironmentModules,
    maximumTypeEscapes: snapshot.typeEscapes,
  };
}

function cycleIsAllowed(
  cycle: readonly string[],
  allowedCycles: readonly (readonly string[])[]
): boolean {
  return allowedCycles.some(allowed =>
    cycle.every(modulePath => allowed.includes(modulePath))
  );
}

export function evaluateArchitecturePolicy(
  snapshot: ArchitectureSnapshot,
  baseline: ArchitectureBaseline
): string[] {
  const violations: string[] = [];

  for (const cycle of snapshot.cycles) {
    if (!cycleIsAllowed(cycle, baseline.allowedCycles)) {
      violations.push(`New import cycle: ${cycle.join(' -> ')}`);
    }
  }

  const allowedEnvironmentModules = new Set(
    baseline.allowedDirectEnvironmentModules
  );
  for (const modulePath of snapshot.directEnvironmentModules) {
    if (!allowedEnvironmentModules.has(modulePath)) {
      violations.push(
        `Direct process.env access outside bootstrap boundary: ${modulePath}`
      );
    }
  }

  for (const key of TYPE_ESCAPE_KEYS) {
    const actual = snapshot.typeEscapes[key];
    const maximum = baseline.maximumTypeEscapes[key];
    if (actual > maximum) {
      violations.push(
        `Type escape budget exceeded: ${key} ${actual} > ${maximum}`
      );
    }
  }

  return violations;
}

export function loadSourceModules(root: string): SourceModule[] {
  return globSync('src/**/*.{ts,tsx}', {
    cwd: root,
    nodir: true,
  })
    .sort()
    .map(path => ({
      path: normalizePath(path),
      source: readFileSync(resolve(root, path), 'utf8'),
    }));
}

export function parseArchitectureBaseline(
  value: unknown
): ArchitectureBaseline {
  return ArchitectureBaselineSchema.parse(value);
}

function readBaseline(path: string): ArchitectureBaseline {
  return parseArchitectureBaseline(JSON.parse(readFileSync(path, 'utf8')));
}

function renderSnapshot(
  snapshot: ArchitectureSnapshot,
  sourceRuleViolations: readonly string[] = []
): string {
  const lines = [
    `Source files: ${snapshot.sourceFiles}`,
    `Import cycles: ${snapshot.cycles.length}`,
    `Direct environment modules: ${snapshot.directEnvironmentModules.length}`,
    `Source rule violations: ${sourceRuleViolations.length}`,
    ...TYPE_ESCAPE_KEYS.map(key => `${key}: ${snapshot.typeEscapes[key]}`),
  ];
  for (const cycle of snapshot.cycles) {
    lines.push(`- ${cycle.join(' -> ')}`);
  }
  return lines.join('\n');
}

export function runArchitecturePolicyCli(
  argv = process.argv.slice(2),
  root = fileURLToPath(new URL('../../', import.meta.url))
): number {
  const baselinePath = resolve(
    root,
    'scripts/testing/architecture-baseline.json'
  );
  const modules = loadSourceModules(root);
  const snapshot = analyzeSourceModules(modules);
  const sourceRuleViolations = evaluateSourceModuleRules(modules);

  if (argv.includes('--write-baseline')) {
    writeFileSync(
      baselinePath,
      `${JSON.stringify(createArchitectureBaseline(snapshot), null, 2)}\n`,
      { mode: 0o644 }
    );
    console.log(
      `Architecture baseline written to ${relative(root, baselinePath)}`
    );
    console.log(renderSnapshot(snapshot, sourceRuleViolations));
    return 0;
  }

  const violations = [
    ...evaluateArchitecturePolicy(snapshot, readBaseline(baselinePath)),
    ...sourceRuleViolations,
  ];
  console.log(renderSnapshot(snapshot, sourceRuleViolations));
  if (violations.length === 0) {
    console.log('Architecture policy passed.');
    return 0;
  }

  for (const violation of violations) console.error(`- ${violation}`);
  return 1;
}

export function isDirectExecution(
  moduleUrl: string,
  argvEntry = process.argv[1]
): boolean {
  return (
    argvEntry !== undefined && resolve(argvEntry) === fileURLToPath(moduleUrl)
  );
}

if (isDirectExecution(import.meta.url)) {
  process.exitCode = runArchitecturePolicyCli();
}
