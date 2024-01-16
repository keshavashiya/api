import {
  DynamicConfig,
  FeedConfigGenerator,
  FeedConfigName,
  FeedResponse,
  FeedVersion,
  IFeedClient,
} from './types';
import { Context } from '../../Context';
import { FeedClient } from './clients';
import {
  FeedPreferencesConfigGenerator,
  FeedUserStateConfigGenerator,
  SimpleFeedConfigGenerator,
} from './configs';
import { SnotraClient } from '../snotra';

/**
 * Utility class for easily generating feeds using provided config and client
 */
export class FeedGenerator {
  private readonly client: IFeedClient;
  private readonly config: FeedConfigGenerator;
  private readonly feedId?: string;

  constructor(
    client: IFeedClient,
    config: FeedConfigGenerator,
    feedId?: string,
  ) {
    this.client = client;
    this.config = config;
    this.feedId = feedId;
  }

  async generate(ctx: Context, opts: DynamicConfig): Promise<FeedResponse> {
    const config = await this.config.generate(ctx, opts);
    const userId = opts.user_id;
    return this.client.fetchFeed(ctx, this.feedId ?? userId, config);
  }
}

export const snotraClient = new SnotraClient();
export const feedClient = new FeedClient();

const opts = {
  includeBlockedTags: true,
  includeAllowedTags: true,
  includeBlockedSources: true,
  includeSourceMemberships: true,
  includePostTypes: true,
};

export const feedGenerators: Record<FeedVersion, FeedGenerator> = Object.freeze(
  {
    '20': new FeedGenerator(
      feedClient,
      new FeedUserStateConfigGenerator(snotraClient, {
        personalised: new FeedPreferencesConfigGenerator(
          {
            feed_config_name: FeedConfigName.VectorV20,
            source_types: ['machine', 'squad'],
          },
          opts,
        ),
        non_personalised: new FeedPreferencesConfigGenerator(
          {
            feed_config_name: FeedConfigName.PersonaliseV20,
            source_types: ['machine', 'squad'],
          },
          opts,
        ),
      }),
    ),
    '21': new FeedGenerator(
      feedClient,
      new FeedUserStateConfigGenerator(snotraClient, {
        personalised: new FeedPreferencesConfigGenerator(
          {
            feed_config_name: FeedConfigName.VectorV21,
            source_types: ['machine', 'squad'],
          },
          opts,
        ),
        non_personalised: new FeedPreferencesConfigGenerator(
          {
            feed_config_name: FeedConfigName.PersonaliseV20,
            source_types: ['machine', 'squad'],
          },
          opts,
        ),
      }),
    ),
    popular: new FeedGenerator(
      feedClient,
      new SimpleFeedConfigGenerator({
        providers: {
          fresh: {
            enable: true,
            remove_engaged_posts: true,
            page_size_fraction: 0.1,
          },
          engaged: {
            enable: true,
            remove_engaged_posts: true,
            page_size_fraction: 1,
            fallback_provider: 'fresh',
          },
        },
      }),
      'popular',
    ),
    onboarding: new FeedGenerator(
      feedClient,
      new FeedPreferencesConfigGenerator(
        {
          feed_config_name: FeedConfigName.Onboarding,
          total_pages: 1,
        },
        opts,
      ),
      'onboarding',
    ),
    post_similarity: new FeedGenerator(
      feedClient,
      new FeedPreferencesConfigGenerator(
        {
          feed_config_name: FeedConfigName.PostSimilarity,
          total_pages: 1,
        },
        {
          includeBlockedTags: true,
          includeBlockedSources: true,
          includeSourceMemberships: true,
        },
      ),
    ),
  },
);

export const versionToFeedGenerator = (version: number): FeedGenerator => {
  return feedGenerators[version.toString()] ?? feedGenerators['20'];
};
