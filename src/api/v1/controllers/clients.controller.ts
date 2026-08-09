/**
 * Clients controller — Management API v1.
 *
 * OIDC client lifecycle management: paginated listing, creation, full and
 * partial updates, deletion, activation/deactivation, secret rotation,
 * and per-client usage statistics.
 *
 * Dependencies are injected via the constructor to keep the class
 * independent of the DI container and straightforward to unit test.
 */

import type { Request, Response, NextFunction } from 'express';

import { conflict, notFound } from '../errors.js';
import { apiSuccess, apiCreated, apiList, apiNoContent } from '../response.js';
import {
  buildCursorQuery,
  buildCursorResponse,
  parsePaginationParams,
} from '../pagination.js';
import type {
  CreateClientInput,
  UpdateClientInput,
} from '../validators/clients.validator.js';
import {
  clientAuthMethodUsesSecret,
  type RegenerateSecretResult,
} from '../../../oidc/adapter/client.interface.js';

/** Service and logger dependencies required by {@link ClientsController}. */
export interface ClientsControllerDeps {
  oidcAdapter: {
    client: {
      findAllClients(filters?: Record<string, unknown>): Promise<any[]>;
      findClientById(clientId: string): Promise<any>;
      createClient(data: Record<string, unknown>): Promise<any>;
      updateClient(
        clientId: string,
        data: Record<string, unknown>
      ): Promise<any>;
      deleteClient(clientId: string): Promise<boolean>;
      activateClient(clientId: string): Promise<any>;
      deactivateClient(clientId: string): Promise<any>;
      regenerateClientSecret(
        clientId: string
      ): Promise<RegenerateSecretResult | null>;
      getClientStatistics(): Promise<Record<string, unknown>>;
      countClients(): Promise<number>;
      searchClients(query: string): Promise<any[]>;
    };
  };
  logger: {
    error(error: Error, context?: Record<string, unknown>): void;
    info(message: string, context?: Record<string, unknown>): void;
  };
}

/**
 * Strip the `client_secret` field from a client document.
 *
 * Handles both plain objects and Mongoose documents (which expose
 * `.toJSON()`). Callers provide only adapter-confirmed client records.
 */
function stripClientSecret(client: any): any {
  const plain = {
    ...(typeof client.toJSON === 'function' ? client.toJSON() : client),
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure-and-discard pattern strips client_secret before returning the client to the caller.
  const { client_secret: _secret, ...rest } = plain;
  return rest;
}

export class ClientsController {
  private readonly oidcAdapter: ClientsControllerDeps['oidcAdapter'];
  private readonly logger: ClientsControllerDeps['logger'];

  constructor(deps: ClientsControllerDeps) {
    this.oidcAdapter = deps.oidcAdapter;
    this.logger = deps.logger;
  }

  /** Lazy accessor — the bridge may not be initialized at construction time. */
  private get adapter() {
    return this.oidcAdapter.client;
  }

  /** List clients with cursor-based pagination and optional filters. */
  list = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { limit, cursor, includeCount } = parsePaginationParams(
        req.query as Record<string, unknown>
      );

      const filters: Record<string, unknown> = {};

      if (req.query.application_type) {
        filters.application_type = req.query.application_type;
      }

      if (req.query.active !== undefined) {
        filters.active = req.query.active === 'true';
      }

      const searchTerm =
        typeof req.query.q === 'string' && req.query.q.trim().length > 0
          ? req.query.q.trim().slice(0, 200)
          : undefined;
      let docs = searchTerm
        ? await this.adapter.searchClients(searchTerm)
        : await this.adapter.findAllClients(filters);

      // Search adapters return all matches, so apply the same structured
      // filters as non-search listing before pagination.
      if (searchTerm) {
        docs = docs.filter(client => {
          if (
            filters.application_type !== undefined &&
            client.application_type !== filters.application_type
          ) {
            return false;
          }
          if (
            filters.active !== undefined &&
            client.active !== filters.active
          ) {
            return false;
          }
          return true;
        });
      }

      docs = [...docs].sort((left, right) =>
        String(left.client_id).localeCompare(String(right.client_id))
      );

      const totalCount = includeCount
        ? searchTerm || Object.keys(filters).length > 0
          ? docs.length
          : await this.adapter.countClients()
        : undefined;

      if (cursor) {
        const cursorQuery = buildCursorQuery(cursor, 'client_id');
        const clientIdRange = cursorQuery.client_id as { $gt: string };
        const afterClientId = clientIdRange.$gt;
        docs = docs.filter(
          client => String(client.client_id).localeCompare(afterClientId) > 0
        );
      }

      const page = buildCursorResponse(
        docs.slice(0, limit + 1).map(stripClientSecret),
        limit,
        'client_id',
        totalCount
      );

      apiList(res, page);
    } catch (error) {
      next(error);
    }
  };

  // POST /clients

  /** Create a new OIDC client. Returns the client WITH its secret (shown once). */
  create = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const body = req.body as CreateClientInput;
      const client = await this.adapter.createClient(body);

      this.logger.info('OIDC client created', { client_id: client.client_id });

      // Return the full client including the secret — callers must store
      // it now because it will never be returned again.
      apiCreated(res, client);
    } catch (error) {
      next(error);
    }
  };

  /** Retrieve a single client by its `client_id`. */
  get = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const client = await this.adapter.findClientById(req.params.client_id);

      if (!client) {
        throw notFound(`Client '${req.params.client_id}' not found`);
      }

      apiSuccess(res, stripClientSecret(client));
    } catch (error) {
      next(error);
    }
  };

  // PUT /clients/:client_id

  /** Full update of a client (all mutable fields replaced). */
  update = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const body = req.body as UpdateClientInput;
      const client = await this.adapter.updateClient(
        req.params.client_id,
        body
      );

      if (!client) {
        throw notFound(`Client '${req.params.client_id}' not found`);
      }

      apiSuccess(res, stripClientSecret(client));
    } catch (error) {
      next(error);
    }
  };

  // PATCH /clients/:client_id

  /** Partial update — only supplied fields are modified. */
  patch = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const body = req.body as UpdateClientInput;
      const client = await this.adapter.updateClient(
        req.params.client_id,
        body
      );

      if (!client) {
        throw notFound(`Client '${req.params.client_id}' not found`);
      }

      apiSuccess(res, stripClientSecret(client));
    } catch (error) {
      next(error);
    }
  };

  /** Delete a client permanently. */
  destroy = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const deleted = await this.adapter.deleteClient(req.params.client_id);

      if (!deleted) {
        throw notFound(`Client '${req.params.client_id}' not found`);
      }

      this.logger.info('OIDC client deleted', {
        client_id: req.params.client_id,
      });

      apiNoContent(res);
    } catch (error) {
      next(error);
    }
  };

  // POST /clients/:client_id/activate

  /** Re-activate a previously deactivated client. */
  activate = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const client = await this.adapter.activateClient(req.params.client_id);

      if (!client) {
        throw notFound(`Client '${req.params.client_id}' not found`);
      }

      apiSuccess(res, stripClientSecret(client));
    } catch (error) {
      next(error);
    }
  };

  // POST /clients/:client_id/deactivate

  /** Deactivate a client (prevents token issuance). */
  deactivate = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const client = await this.adapter.deactivateClient(req.params.client_id);

      if (!client) {
        throw notFound(`Client '${req.params.client_id}' not found`);
      }

      apiSuccess(res, stripClientSecret(client));
    } catch (error) {
      next(error);
    }
  };

  // POST /clients/:client_id/secret

  /** Regenerate the client secret. Returns the new secret (shown once). */
  regenerateSecret = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const existing = await this.adapter.findClientById(req.params.client_id);

      if (!existing) {
        throw notFound(`Client '${req.params.client_id}' not found`);
      }

      if (!clientAuthMethodUsesSecret(existing.token_endpoint_auth_method)) {
        throw conflict(
          `Client '${req.params.client_id}' does not use secret-based authentication`
        );
      }

      const result = await this.adapter.regenerateClientSecret(
        req.params.client_id
      );

      if (!result) {
        throw notFound(`Client '${req.params.client_id}' not found`);
      }

      this.logger.info('OIDC client secret regenerated', {
        client_id: req.params.client_id,
      });

      // Return WITH the new secret — callers must store it now.
      apiSuccess(res, {
        ...stripClientSecret(result.client),
        client_secret: result.newSecret,
      });
    } catch (error) {
      next(error);
    }
  };

  /** Retrieve usage statistics for a specific client. */
  stats = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const client = await this.adapter.findClientById(req.params.client_id);

      if (!client) {
        throw notFound(`Client '${req.params.client_id}' not found`);
      }

      const statistics = await this.adapter.getClientStatistics();
      apiSuccess(res, statistics);
    } catch (error) {
      next(error);
    }
  };
}
