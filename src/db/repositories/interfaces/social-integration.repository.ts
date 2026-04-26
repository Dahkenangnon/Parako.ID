import type { ISocialIntegration } from '../../../types/social-integration.js';
import type {
  IBaseRepository,
  PaginationOptions,
  PaginatedResult,
} from './base.repository.js';

export type CreateSocialIntegrationDto = Omit<
  ISocialIntegration,
  'id' | '_id' | 'created_at' | 'updated_at'
>;
export type UpdateSocialIntegrationDto = Partial<CreateSocialIntegrationDto>;

export interface ISocialIntegrationRepository extends IBaseRepository<
  ISocialIntegration,
  CreateSocialIntegrationDto,
  UpdateSocialIntegrationDto
> {
  findByUserId(
    userId: string,
    opts?: PaginationOptions
  ): Promise<PaginatedResult<ISocialIntegration>>;
  findByUserAndProvider(
    userId: string,
    provider: string
  ): Promise<ISocialIntegration | null>;
  findByProvider(provider: string): Promise<ISocialIntegration[]>;
  deleteByUserId(userId: string): Promise<number>;
}
