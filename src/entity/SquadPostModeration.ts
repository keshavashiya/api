import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Post } from './posts';
import { Source } from './Source';
import { User } from './user';

export enum SquadPostModerationStatus {
  Approved = 'approved',
  Rejected = 'rejected',
  Pending = 'pending',
}

@Entity()
export class SquadPostModeration {
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ type: 'text' })
  sourceId: string;

  @ManyToOne('Source', (source: Source) => source.id, {
    lazy: true,
    onDelete: 'CASCADE',
  })
  source: Promise<Source>;

  @Column({ type: 'text' })
  status: SquadPostModerationStatus;

  @Column({ type: 'text', nullable: true })
  createdById: string | null;

  @ManyToOne('User', (user: User) => user.id, {
    lazy: true,
    onDelete: 'SET NULL',
  })
  createdBy: Promise<User>;

  @Column({ type: 'text', nullable: true })
  moderatedById: string | null;

  @ManyToOne('User', (user: User) => user.id, {
    lazy: true,
    onDelete: 'SET NULL',
  })
  moderatedBy: Promise<User>;

  @Column({ type: 'text', nullable: true })
  moderatorMessage: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'text', nullable: true })
  postId: string | null;

  @ManyToOne('Post', (post: Post) => post.id, {
    lazy: true,
    onDelete: 'CASCADE',
  })
  post: Promise<Post>;

  @Column({ type: 'text' })
  type: string;

  @Column({ type: 'text', nullable: true })
  title?: string | null;

  @Column({ type: 'text', nullable: true })
  titleHtml: string | null;

  @Column({ type: 'text', nullable: true })
  content?: string | null;

  @Column({ type: 'text', nullable: true })
  contentHtml: string | null;

  @Column({ type: 'text', nullable: true })
  image: string | null;

  @Column({ type: 'text', nullable: true })
  sharedPostId?: string | null;

  @ManyToOne('Post', (post: Post) => post.id, {
    lazy: true,
    onDelete: 'SET NULL',
  })
  sharedPost: Promise<Post>;
}
