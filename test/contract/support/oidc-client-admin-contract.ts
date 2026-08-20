import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { IOidcClientAdmin } from '../../../src/oidc/adapter/admin.contract.js';

export interface OidcClientAdminContractHarness {
  client: IOidcClientAdmin;
  supportsTenantIsolation: boolean;
  reset(): Promise<void>;
  runAsTenant<T>(tenantId: string, operation: () => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}

interface OidcClientAdminContractOptions {
  backend: string;
  createHarness(): Promise<OidcClientAdminContractHarness>;
}

export function defineOidcClientAdminContract({
  backend,
  createHarness,
}: OidcClientAdminContractOptions): void {
  describe.sequential(`${backend} OIDC client administration contract`, () => {
    let harness!: OidcClientAdminContractHarness;

    beforeAll(async () => {
      harness = await createHarness();
    });

    beforeEach(async () => {
      await harness.reset();
    });

    afterAll(async () => {
      await harness.close?.();
    });

    it('preserves the portable client lifecycle and statistics', async () => {
      const created = await harness.client.createClient({
        client_id: 'contract-web-client',
        client_name: 'Contract Web Client',
        description: 'Portable contract target',
        redirect_uris: ['https://client.example.test/callback'],
        tags: ['contract'],
      });

      expect(created).toMatchObject({
        client_id: 'contract-web-client',
        client_name: 'Contract Web Client',
        application_type: 'web',
        active: true,
      });
      expect(created.client_secret).toMatch(/^[0-9a-f]{64}$/);
      await expect(
        harness.client.findClientById('contract-web-client')
      ).resolves.toMatchObject({
        client_id: 'contract-web-client',
        client_name: 'Contract Web Client',
        tags: ['contract'],
      });
      await expect(
        harness.client.findAllClients({ active: true, tags: ['contract'] })
      ).resolves.toHaveLength(1);
      await expect(
        harness.client.searchClients('portable CONTRACT')
      ).resolves.toEqual([
        expect.objectContaining({ client_id: 'contract-web-client' }),
      ]);
      await expect(harness.client.countClients()).resolves.toBe(1);
      await expect(harness.client.getClientStatistics()).resolves.toEqual({
        total: 1,
        active: 1,
        inactive: 0,
        byType: { web: 1, native: 0, spa: 0 },
      });

      await expect(
        harness.client.updateClient('contract-web-client', {
          client_id: 'replacement-id',
          client_name: 'Updated Contract Client',
        })
      ).resolves.toMatchObject({
        client_id: 'contract-web-client',
        client_name: 'Updated Contract Client',
      });
      await expect(
        harness.client.deactivateClient('contract-web-client')
      ).resolves.toMatchObject({ active: false });
      await expect(
        harness.client.activateClient('contract-web-client')
      ).resolves.toMatchObject({ active: true });

      const regenerated = await harness.client.regenerateClientSecret(
        'contract-web-client'
      );
      expect(regenerated?.newSecret).toMatch(/^[0-9a-f]{64}$/);
      expect(regenerated?.newSecret).not.toBe(created.client_secret);
      expect(regenerated?.client.client_secret).toBe(regenerated?.newSecret);

      await expect(
        harness.client.deleteClient('contract-web-client')
      ).resolves.toBe(true);
      await expect(
        harness.client.deleteClient('contract-web-client')
      ).resolves.toBe(false);
      await expect(
        harness.client.findClientById('contract-web-client')
      ).resolves.toBeNull();
    });

    it('rejects invalid and duplicate client registrations', async () => {
      expect(
        harness.client.validateClientDataSync({
          client_name: 'Invalid redirect',
          redirect_uris: ['javascript:alert(1)'],
        })
      ).toMatchObject({ isValid: false });
      await expect(
        harness.client.createClient({
          client_name: 'Invalid redirect',
          redirect_uris: ['javascript:alert(1)'],
        })
      ).rejects.toThrow('Client validation failed');

      const duplicate = {
        client_id: 'contract-duplicate-client',
        client_name: 'Duplicate Contract Client',
        redirect_uris: ['https://client.example.test/callback'],
      };
      await harness.client.createClient(duplicate);
      await expect(harness.client.createClient(duplicate)).rejects.toThrow(
        'already exists'
      );
    });

    it('matches the declared tenant-isolation capability', async () => {
      if (!harness.supportsTenantIsolation) {
        await harness.client.createClient({
          client_id: 'single-tenant-contract-client',
          client_name: 'Single Tenant Contract Client',
          redirect_uris: ['https://client.example.test/callback'],
        });
        await expect(harness.client.countClients()).resolves.toBe(1);
        return;
      }

      const createForTenant = (tenantId: string, clientName: string) =>
        harness.runAsTenant(tenantId, () =>
          harness.client.createClient({
            client_id: 'shared-contract-client',
            client_name: clientName,
            redirect_uris: [`https://${tenantId}.example.test/callback`],
          })
        );

      await createForTenant('contract-tenant-a', 'Tenant A Client');
      await createForTenant('contract-tenant-b', 'Tenant B Client');

      await expect(
        harness.runAsTenant('contract-tenant-a', () =>
          harness.client.findClientById('shared-contract-client')
        )
      ).resolves.toMatchObject({ client_name: 'Tenant A Client' });
      await expect(
        harness.runAsTenant('contract-tenant-b', () =>
          harness.client.findClientById('shared-contract-client')
        )
      ).resolves.toMatchObject({ client_name: 'Tenant B Client' });
      await expect(
        harness.runAsTenant('contract-tenant-a', () =>
          harness.client.countClients()
        )
      ).resolves.toBe(1);
      await expect(
        harness.runAsTenant('contract-tenant-b', () =>
          harness.client.countClients()
        )
      ).resolves.toBe(1);

      await harness.runAsTenant('contract-tenant-a', () =>
        harness.client.deleteClient('shared-contract-client')
      );
      await expect(
        harness.runAsTenant('contract-tenant-a', () =>
          harness.client.findClientById('shared-contract-client')
        )
      ).resolves.toBeNull();
      await expect(
        harness.runAsTenant('contract-tenant-b', () =>
          harness.client.findClientById('shared-contract-client')
        )
      ).resolves.toMatchObject({ client_name: 'Tenant B Client' });
    });
  });
}
