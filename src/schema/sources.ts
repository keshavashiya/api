import { ForbiddenError, ValidationError } from 'apollo-server-errors';
import { IResolvers } from '@graphql-tools/utils';
import { ConnectionArguments } from 'graphql-relay';
import { traceResolverObject } from './trace';
import { Context } from '../Context';
import {
  createSharePost,
  Source,
  SourceFeed,
  SourceMember,
  SourceMemberRoles,
  SquadSource,
} from '../entity';
import {
  forwardPagination,
  offsetPageGenerator,
  PaginationResponse,
} from './common';
import graphorm from '../graphorm';
import {
  DataSource,
  DeepPartial,
  EntityManager,
  EntityNotFoundError,
} from 'typeorm';
import { GQLUser } from './users';
import { Connection } from 'graphql-relay/index';
import { createDatePageGenerator } from '../common/datePageGenerator';
import { FileUpload } from 'graphql-upload/GraphQLUpload';
import { randomUUID } from 'crypto';
import { uploadSquadImage } from '../common';
import { GraphQLResolveInfo } from 'graphql';
import { TypeOrmError } from '../errors';

export interface GQLSource {
  id: string;
  name: string;
  image?: string;
  private: boolean;
  public: boolean;
  members?: Connection<GQLSourceMember>;
}

export interface GQLSourceMember {
  source: GQLSource;
  user: GQLUser;
  role: SourceMemberRoles;
  createdAt: Date;
}

export const typeDefs = /* GraphQL */ `
  """
  Source to discover posts from (usually blogs)
  """
  type Source {
    """
    Short unique string to identify the source
    """
    id: ID!

    """
    Source type (machine/squad)
    """
    type: String!

    """
    Name of the source
    """
    name: String!

    """
    URL to an avatar image of the source
    """
    image: String!

    """
    Whether the source is public
    """
    public: Boolean

    """
    Whether the source is active or not (applicable for squads)
    """
    active: Boolean

    """
    Source handle (applicable for squads)
    """
    handle: String

    """
    Source description
    """
    description: String

    """
    Source members
    """
    members: SourceMemberConnection
  }

  type SourceConnection {
    pageInfo: PageInfo!
    edges: [SourceEdge!]!
  }

  type SourceEdge {
    node: Source!

    """
    Used in \`before\` and \`after\` args
    """
    cursor: String!
  }

  type SourceMember {
    """
    Relevant user who is part of the source
    """
    user: User!
    """
    Source the user belongs to
    """
    source: Source!
    """
    Role of this user in the source
    """
    role: String!
  }

  type SourceMemberConnection {
    pageInfo: PageInfo!
    edges: [SourceMemberEdge!]!
  }

  type SourceMemberEdge {
    node: SourceMember!

    """
    Used in \`before\` and \`after\` args
    """
    cursor: String!
  }

  extend type Query {
    """
    Get all available sources
    """
    sources(
      """
      Paginate after opaque cursor
      """
      after: String

      """
      Paginate first
      """
      first: Int
    ): SourceConnection!

    """
    Get the source that matches the feed
    """
    sourceByFeed(feed: String!): Source @auth

    """
    Get source by ID
    """
    source(id: ID!): Source

    """
    Get source members
    """
    sourceMembers(
      """
      Source ID
      """
      sourceId: ID!

      """
      Paginate after opaque cursor
      """
      after: String

      """
      Paginate first
      """
      first: Int
    ): SourceMemberConnection!

    """
    Get the logged in user source memberships
    """
    mySourceMemberships(
      """
      Paginate after opaque cursor
      """
      after: String

      """
      Paginate first
      """
      first: Int
    ): SourceMemberConnection! @auth
  }

  extend type Mutation {
    """
    Creates a new squad
    """
    createSquad(
      """
      Name for the squad
      """
      name: String!
      """
      Unique handle
      """
      handle: String!
      """
      Description for the squad (max 250 chars)
      """
      description: String
      """
      Avatar image for the squad
      """
      image: Upload
      """
      First post to share in the squad
      """
      postId: ID!
      """
      Commentary for the first share
      """
      commentary: String!
    ): Source! @auth
  }
`;

const sourceToGQL = (source: Source): GQLSource => ({
  ...source,
  public: !source.private,
  members: undefined,
});

export const canAccessSource = async (
  ctx: Context,
  source: Pick<GQLSource, 'id' | 'private'>,
): Promise<boolean> => {
  if (!source.private) {
    return true;
  }
  if (ctx.userId) {
    const member = await ctx.con.getRepository(SourceMember).findOneBy({
      userId: ctx.userId,
      sourceId: source.id,
    });
    if (member) {
      return true;
    }
  }
  return false;
};

export const ensureSourcePermissions = async (
  ctx: Context,
  source: Pick<GQLSource, 'id' | 'private'>,
): Promise<void> => {
  if (await canAccessSource(ctx, source)) {
    return;
  }
  throw new ForbiddenError('Access denied!');
};

const sourceByFeed = async (feed: string, ctx: Context): Promise<GQLSource> => {
  const res = await ctx.con
    .createQueryBuilder()
    .select('source.*')
    .from(Source, 'source')
    .innerJoin(SourceFeed, 'sf', 'source.id = sf."sourceId"')
    .where('sf.feed = :feed and source.private = false', { feed })
    .getRawOne();
  return res ? sourceToGQL(res) : null;
};

const membershipsPageGenerator = createDatePageGenerator<
  GQLSourceMember,
  'createdAt'
>({
  key: 'createdAt',
});

type CreateSquadArgs = {
  name: string;
  handle: string;
  description?: string;
  image?: FileUpload;
  postId: string;
  commentary: string;
};

const getSourceById = async (
  ctx: Context,
  info: GraphQLResolveInfo,
  id: string,
): Promise<GQLSource> => {
  const res = await graphorm.query<GQLSource>(ctx, info, (builder) => {
    builder.queryBuilder = builder.queryBuilder.andWhere({ id }).limit(1);
    return builder;
  });
  if (!res.length) {
    throw new EntityNotFoundError(Source, 'not found');
  }
  return res[0];
};

const addNewSourceMember = async (
  con: DataSource | EntityManager,
  member: Omit<DeepPartial<SourceMember>, 'referralToken'>,
): Promise<void> => {
  await con.getRepository(SourceMember).save({
    ...member,
    referralToken: randomUUID(),
  });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const resolvers: IResolvers<any, Context> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Query: traceResolverObject<any, any>({
    sources: forwardPagination(
      async (
        source,
        args: ConnectionArguments,
        ctx,
        { limit, offset },
      ): Promise<PaginationResponse<GQLSource>> => {
        const res = await ctx.con.getRepository(Source).find({
          where: { active: true },
          order: { name: 'ASC' },
          take: limit,
          skip: offset,
        });
        return {
          nodes: res.map(sourceToGQL),
        };
      },
      offsetPageGenerator(100, 500),
    ),
    sourceByFeed: async (
      _,
      { feed }: { feed: string },
      ctx,
    ): Promise<GQLSource> => sourceByFeed(feed, ctx),
    source: async (
      _,
      { id }: { id: string },
      ctx,
      info,
    ): Promise<GQLSource> => {
      const source = await getSourceById(ctx, info, id);
      await ensureSourcePermissions(ctx, source);
      return source;
    },
    sourceMembers: async (
      _,
      args: ConnectionArguments & { sourceId: string },
      ctx,
      info,
    ): Promise<Connection<GQLSourceMember>> => {
      const source = await ctx.con
        .getRepository(Source)
        .findOneByOrFail({ id: args.sourceId });
      await ensureSourcePermissions(ctx, source);

      const page = membershipsPageGenerator.connArgsToPage(args);
      return graphorm.queryPaginated(
        ctx,
        info,
        (nodeSize) => membershipsPageGenerator.hasPreviousPage(page, nodeSize),
        (nodeSize) => membershipsPageGenerator.hasNextPage(page, nodeSize),
        (node, index) =>
          membershipsPageGenerator.nodeToCursor(page, args, node, index),
        (builder) => {
          builder.queryBuilder
            .andWhere(`${builder.alias}."sourceId" = :source`, {
              source: args.sourceId,
            })
            .addOrderBy(`${builder.alias}."createdAt"`, 'DESC');

          builder.queryBuilder.limit(page.limit);
          if (page.timestamp) {
            builder.queryBuilder = builder.queryBuilder.andWhere(
              `${builder.alias}."createdAt" < :timestamp`,
              { timestamp: page.timestamp },
            );
          }
          return builder;
        },
      );
    },
    mySourceMemberships: async (
      _,
      args: ConnectionArguments,
      ctx,
      info,
    ): Promise<Connection<GQLSourceMember>> => {
      const page = membershipsPageGenerator.connArgsToPage(args);
      return graphorm.queryPaginated(
        ctx,
        info,
        (nodeSize) => membershipsPageGenerator.hasPreviousPage(page, nodeSize),
        (nodeSize) => membershipsPageGenerator.hasNextPage(page, nodeSize),
        (node, index) =>
          membershipsPageGenerator.nodeToCursor(page, args, node, index),
        (builder) => {
          builder.queryBuilder
            .andWhere(`${builder.alias}."userId" = :user`, { user: ctx.userId })
            .addOrderBy(`${builder.alias}."createdAt"`, 'DESC');

          builder.queryBuilder.limit(page.limit);
          if (page.timestamp) {
            builder.queryBuilder = builder.queryBuilder.andWhere(
              `${builder.alias}."createdAt" < :timestamp`,
              { timestamp: page.timestamp },
            );
          }
          return builder;
        },
      );
    },
  }),
  Mutation: traceResolverObject({
    createSquad: async (
      source,
      { name, handle, commentary, image, postId, description }: CreateSquadArgs,
      ctx,
      info,
    ): Promise<GQLSource> => {
      try {
        const sourceId = await ctx.con.transaction(async (entityManager) => {
          const id = randomUUID();
          const repo = entityManager.getRepository(SquadSource);
          // Create a new source
          await repo.insert({
            id,
            name,
            handle,
            active: false,
            description,
          });
          // Add the logged-in user as owner
          await addNewSourceMember(entityManager, {
            sourceId: id,
            userId: ctx.userId,
            role: SourceMemberRoles.Owner,
          });
          // Create the first post of the squad
          await createSharePost(
            entityManager,
            id,
            ctx.userId,
            postId,
            commentary,
          );
          // Upload the image (if provided)
          if (image) {
            const { createReadStream } = await image;
            const stream = createReadStream();
            const imageUrl = await uploadSquadImage(id, stream);
            await repo.update({ id }, { image: imageUrl });
          }
          return id;
        });
        return getSourceById(ctx, info, sourceId);
      } catch (err) {
        if (err.code === TypeOrmError.DUPLICATE_ENTRY) {
          if (err.message.indexOf('source_handle') > -1) {
            throw new ValidationError(
              JSON.stringify({ handle: 'handle is already used' }),
            );
          }
        } else if (err.code === TypeOrmError.FOREIGN_KEY) {
          if (err.detail.indexOf('sharedPostId') > -1) {
            throw new ForbiddenError(
              JSON.stringify({ sharedPostId: 'post does not exist' }),
            );
          }
        }
        throw err;
      }
    },
  }),
};
