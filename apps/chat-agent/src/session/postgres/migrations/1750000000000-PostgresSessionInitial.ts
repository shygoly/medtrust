import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial PostgreSQL schema for persistent chat sessions.
 *
 * The table guard adopts databases created by the previous development-time
 * `synchronize: true` path and records the baseline without rewriting data.
 */
export class PostgresSessionInitial1750000000000 implements MigrationInterface {
  name = 'PostgresSessionInitial1750000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('chat_sessions')) return;

    await queryRunner.query(`
      CREATE TABLE "chat_sessions" (
        "id" text NOT NULL,
        "userId" text NOT NULL,
        "spaceId" text NOT NULL,
        "title" text NOT NULL,
        "createdAt" text NOT NULL,
        "updatedAt" text NOT NULL,
        "expiresAt" text NOT NULL,
        "scenarioDraft" text,
        CONSTRAINT "PK_chat_sessions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_chat_sessions_user_space"
      ON "chat_sessions" ("userId", "spaceId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_chat_sessions_expires_at"
      ON "chat_sessions" ("expiresAt")
    `);

    await queryRunner.query(`
      CREATE TABLE "chat_messages" (
        "id" text NOT NULL,
        "sessionId" text NOT NULL,
        "role" text NOT NULL,
        "content" text NOT NULL,
        "cards" text,
        "toolCalls" text,
        "toolName" text,
        "createdAt" text NOT NULL,
        CONSTRAINT "PK_chat_messages" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chat_messages_session"
          FOREIGN KEY ("sessionId") REFERENCES "chat_sessions"("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_chat_messages_session"
      ON "chat_messages" ("sessionId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_sessions"`);
  }
}
