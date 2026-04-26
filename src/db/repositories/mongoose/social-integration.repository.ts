import { injectable } from 'inversify';
import type {
  ISocialIntegration,
  ISocialIntegrationMethods,
} from '../../../models/social-integration.model.js';
import type { TypedModel } from '../../../models/base.model.js';
import type {
  ISocialIntegrationRepository,
  CreateSocialIntegrationDto,
  UpdateSocialIntegrationDto,
} from '../interfaces/social-integration.repository.js';
import type {
  PaginatedResult,
  PaginationOptions,
} from '../interfaces/base.repository.js';
import { AbstractMongooseRepository } from './base.repository.js';

type SocialIntegrationModel = TypedModel<
  ISocialIntegration,
  ISocialIntegrationMethods
>;

@injectable()
export class MongooseSocialIntegrationRepository
  extends AbstractMongooseRepository<
    ISocialIntegration,
    CreateSocialIntegrationDto,
    UpdateSocialIntegrationDto
  >
  implements ISocialIntegrationRepository
{
  constructor(socialIntegrationModel: SocialIntegrationModel) {
    super(socialIntegrationModel);
  }

  async findByUserId(
    userId: string,
    opts?: PaginationOptions
  ): Promise<PaginatedResult<ISocialIntegration>> {
    return this.paginate({ user_id: userId }, opts);
  }

  async findByUserAndProvider(
    userId: string,
    provider: string
  ): Promise<ISocialIntegration | null> {
    return this.findOne({ user_id: userId, method: provider });
  }

  async findByProvider(provider: string): Promise<ISocialIntegration[]> {
    return this.findMany({ method: provider });
  }

  async deleteByUserId(userId: string): Promise<number> {
    const result = await this.model.deleteMany({ user_id: userId }).exec();
    return result.deletedCount ?? 0;
  }
}
