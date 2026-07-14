import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSpdxSbom } from '../../../scripts/create-sbom.mjs';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('SPDX release SBOM', () => {
  it('records installed production dependencies deterministically', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parako-sbom-'));
    temporaryDirectories.push(root);
    fs.mkdirSync(path.join(root, 'node_modules/example'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'parako.id', version: '1.2.3', license: 'MIT' })
    );
    fs.writeFileSync(
      path.join(root, 'node_modules/example/package.json'),
      JSON.stringify({ name: 'example', version: '4.5.6', license: 'ISC' })
    );

    const sbom = createSpdxSbom(root, '1700000000');

    expect(sbom.spdxVersion).toBe('SPDX-2.3');
    expect(sbom.creationInfo.created).toBe('2023-11-14T22:13:20.000Z');
    expect(sbom.packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'example',
          versionInfo: '4.5.6',
          licenseDeclared: 'ISC',
        }),
      ])
    );
    expect(sbom.relationships).toHaveLength(1);
  });
});
