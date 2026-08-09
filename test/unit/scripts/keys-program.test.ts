import { describe, expect, it, vi } from 'vitest';

const generateKeys = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../../scripts/manage/keys/index.js', () => ({
  generateKeys,
  generateKeysInteractive: vi.fn(),
}));

import { buildKeysProgram } from '../../../scripts/manage/keys/commands.js';

describe('JWKS Commander program', () => {
  it('exposes the generate command and its short alias', async () => {
    const program = buildKeysProgram();
    program.exitOverride();

    expect(program.name()).toBe('keys');
    expect(program.version()).toBe('1.0.0');
    expect(program.commands.map(command => command.name())).toEqual([
      'generate',
    ]);
    expect(program.commands[0]?.aliases()).toEqual(['gen']);

    await program.parseAsync(['node', 'keys', 'gen']);
    expect(generateKeys).toHaveBeenCalledWith(true);
  });
});
