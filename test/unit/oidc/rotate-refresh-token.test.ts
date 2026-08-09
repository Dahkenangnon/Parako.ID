import { describe, expect, it, vi } from 'vitest';

import { getDefaultFullConfig } from '../../../src/config/constants.js';
import RotateRefreshToken from '../../../src/oidc/specs/rotate-refresh-token.js';

const MAX_ROTATING_LIFETIME_SECONDS = 365.25 * 24 * 60 * 60;

function createPolicy(enabled = true) {
  const config = getDefaultFullConfig();
  config.features.oidc.rotate_refresh_token = enabled;
  const logger = { error: vi.fn() };
  return {
    logger,
    rotate: RotateRefreshToken(
      { getConfig: () => config } as never,
      logger as never
    ),
  };
}

function createContext({
  totalLifetime = 1_000,
  senderConstrained = false,
  ttlPercentagePassed = 0,
  tokenEndpointAuthMethod = 'client_secret_basic',
}: {
  totalLifetime?: number;
  senderConstrained?: boolean;
  ttlPercentagePassed?: number;
  tokenEndpointAuthMethod?: string;
} = {}) {
  return {
    oidc: {
      entities: {
        RefreshToken: {
          totalLifetime: vi.fn().mockReturnValue(totalLifetime),
          isSenderConstrained: vi.fn().mockReturnValue(senderConstrained),
          ttlPercentagePassed: vi.fn().mockReturnValue(ttlPercentagePassed),
        },
        Client: { tokenEndpointAuthMethod },
      },
    },
  };
}

describe('OIDC refresh-token rotation policy', () => {
  it('does not rotate when refresh-token rotation is disabled', () => {
    const { rotate } = createPolicy(false);

    expect(
      rotate(createContext({ tokenEndpointAuthMethod: 'none' }) as never)
    ).toBe(false);
  });

  it.each([
    ['refresh token', { Client: { tokenEndpointAuthMethod: 'none' } }],
    [
      'client',
      {
        RefreshToken: {
          totalLifetime: vi.fn(),
          isSenderConstrained: vi.fn(),
          ttlPercentagePassed: vi.fn(),
        },
      },
    ],
  ])('does not rotate without the %s entity', (_entity, entities) => {
    const { logger, rotate } = createPolicy();

    expect(rotate({ oidc: { entities } } as never)).toBe(false);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('stops rotation at the maximum total lifetime', () => {
    const { rotate } = createPolicy();
    const context = createContext({
      totalLifetime: MAX_ROTATING_LIFETIME_SECONDS,
      tokenEndpointAuthMethod: 'none',
      ttlPercentagePassed: 100,
    });

    expect(rotate(context as never)).toBe(false);
    expect(
      context.oidc.entities.RefreshToken.isSenderConstrained
    ).not.toHaveBeenCalled();
    expect(
      context.oidc.entities.RefreshToken.ttlPercentagePassed
    ).not.toHaveBeenCalled();
  });

  it('rotates a non-sender-constrained public-client token', () => {
    const { rotate } = createPolicy();
    const context = createContext({ tokenEndpointAuthMethod: 'none' });

    expect(rotate(context as never)).toBe(true);
    expect(
      context.oidc.entities.RefreshToken.ttlPercentagePassed
    ).not.toHaveBeenCalled();
  });

  it.each([
    ['confidential client', 'client_secret_basic', false],
    ['sender-constrained public client', 'none', true],
  ])(
    'does not rotate a young token for a %s',
    (_case, tokenEndpointAuthMethod, senderConstrained) => {
      const { rotate } = createPolicy();

      expect(
        rotate(
          createContext({
            tokenEndpointAuthMethod,
            senderConstrained,
            ttlPercentagePassed: 69.99,
          }) as never
        )
      ).toBe(false);
    }
  );

  it.each([70, 99.9])(
    'rotates a token after %s%% of its lifetime has passed',
    ttlPercentagePassed => {
      const { rotate } = createPolicy();

      expect(rotate(createContext({ ttlPercentagePassed }) as never)).toBe(
        true
      );
    }
  );

  it('fails closed and logs unexpected policy errors', () => {
    const { logger, rotate } = createPolicy();
    const error = new Error('adapter failure');
    const context = createContext();
    context.oidc.entities.RefreshToken.totalLifetime.mockImplementation(() => {
      throw error;
    });

    expect(rotate(context as never)).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(error, {
      context: 'Error in refresh token rotation logic',
    });
  });
});
