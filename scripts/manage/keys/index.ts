#!/usr/bin/env node

/**
 * Key generation module for OIDC JWKS keys
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as jose from 'jose';
import { assertInteractiveTty } from '../shared/utils.js';

export interface JWK extends jose.JWK {
  use?: string;
  kid?: string;
}

export interface JWKS {
  keys: JWK[];
}

/**
 * Create a backup of the existing JWKS file
 */
export function createBackup(filePath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.backup-${timestamp}`;

  fs.copyFileSync(filePath, backupPath);
  fs.chmodSync(backupPath, 0o600);
  console.log(chalk.green(`📦 Backup created: ${path.basename(backupPath)}`));

  return backupPath;
}

/**
 * Generate JWKS keys
 */
export async function generateKeys(
  includeEdDSA: boolean = true,
  overwriteExisting: boolean = false
): Promise<void> {
  const outputPath = path.resolve('./runtime/jwks/jwks.json');
  const outputDir = path.dirname(outputPath);
  fs.mkdirSync(outputDir, { recursive: true });

  let descriptor: number | undefined;
  if (!overwriteExisting) {
    try {
      descriptor = fs.openSync(
        outputPath,
        fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          fs.constants.O_NOFOLLOW,
        0o600
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(
          `JWKS file already exists at ${outputPath}. Refusing to overwrite first-boot keys.`
        );
      }
      throw error;
    }
  }

  let completed = false;
  try {
    const keys: JWK[] = [];

    console.log(chalk.cyan('\n🔑 Generating JWKS keys...\n'));

    console.log(chalk.dim('  Generating RS256 key...'));
    const rsaKey = await jose.generateKeyPair('RS256', { extractable: true });
    const rsaJwk = (await jose.exportJWK(rsaKey.privateKey)) as JWK;
    rsaJwk.use = 'sig';
    rsaJwk.alg = 'RS256';
    rsaJwk.kid = await jose.calculateJwkThumbprint(rsaJwk, 'sha256');
    keys.push(rsaJwk);
    console.log(chalk.green(`  ✓ RS256 generated`));

    console.log(chalk.dim('  Generating ES256 key...'));
    const ecKey = await jose.generateKeyPair('ES256', { extractable: true });
    const ecJwk = (await jose.exportJWK(ecKey.privateKey)) as JWK;
    ecJwk.use = 'sig';
    ecJwk.alg = 'ES256';
    ecJwk.kid = await jose.calculateJwkThumbprint(ecJwk, 'sha256');
    keys.push(ecJwk);
    console.log(chalk.green(`  ✓ ES256 generated`));

    if (includeEdDSA) {
      console.log(chalk.dim('  Generating EdDSA key...'));
      const okpKey = await jose.generateKeyPair('EdDSA', { extractable: true });
      const okpJwk = (await jose.exportJWK(okpKey.privateKey)) as JWK;
      okpJwk.use = 'sig';
      okpJwk.alg = 'EdDSA';
      okpJwk.kid = await jose.calculateJwkThumbprint(okpJwk, 'sha256');
      keys.push(okpJwk);
      console.log(chalk.green(`  ✓ EdDSA generated`));
    }

    const contents = JSON.stringify({ keys } satisfies JWKS, null, 2);
    if (descriptor !== undefined) {
      fs.writeFileSync(descriptor, contents, 'utf8');
      fs.fchmodSync(descriptor, 0o600);
    } else {
      const temporaryPath = `${outputPath}.tmp-${process.pid}-${randomUUID()}`;
      let temporaryDescriptor: number | undefined;
      try {
        temporaryDescriptor = fs.openSync(
          temporaryPath,
          fs.constants.O_WRONLY |
            fs.constants.O_CREAT |
            fs.constants.O_EXCL |
            fs.constants.O_NOFOLLOW,
          0o600
        );
        fs.writeFileSync(temporaryDescriptor, contents, 'utf8');
        fs.fchmodSync(temporaryDescriptor, 0o600);
        fs.closeSync(temporaryDescriptor);
        temporaryDescriptor = undefined;
        fs.renameSync(temporaryPath, outputPath);
      } finally {
        if (temporaryDescriptor !== undefined) {
          fs.closeSync(temporaryDescriptor);
        }
        try {
          fs.unlinkSync(temporaryPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }

    completed = true;
    console.log(chalk.green('\n✅ JWKS keys generated successfully'));
    console.log(chalk.dim(`Saved to: ${outputPath}\n`));
  } finally {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
      if (!completed) {
        try {
          fs.unlinkSync(outputPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }
  }
}

/**
 * Interactive generation with confirmation prompts.
 *
 * Bails out via `assertInteractiveTty` if stdin is not a TTY so the
 * command never hangs a CI pipeline that pipes empty input.
 */
export async function generateKeysInteractive(): Promise<void> {
  assertInteractiveTty('keys generate');

  const outputPath = path.resolve('./runtime/jwks/jwks.json');
  const fileExists = fs.existsSync(outputPath);

  console.log(chalk.bold.cyan('\n🔐 OIDC JWKS Key Generation\n'));

  if (fileExists) {
    console.log(chalk.yellow('⚠️  Warning: A JWKS file already exists at:'));
    console.log(chalk.dim(`   ${outputPath}\n`));

    const { confirmOverwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmOverwrite',
        message: 'Do you want to overwrite the existing JWKS file?',
        default: false,
      },
    ]);

    if (!confirmOverwrite) {
      console.log(chalk.yellow('\n❌ Generation cancelled.\n'));
      return;
    }

    console.log();
    createBackup(outputPath);
  }

  await generateKeys(true, true);
}
