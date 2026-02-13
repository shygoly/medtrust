import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedFlowerServer implements MigrationInterface {
  name = 'SeedFlowerServer';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Insert default Flower server
    await queryRunner.query(`
      INSERT INTO flower_servers (
        id,
        name,
        url,
        api_key,
        status,
        capabilities,
        request_timeout,
        max_retries,
        health_check_interval,
        is_healthy,
        created_at,
        updated_at
      ) VALUES (
        1,
        'Local Flower Server',
        'http://localhost:8080',
        NULL,
        'active',
        '["fl", "fedavg", "fedprox", "scaffold"]',
        30000,
        3,
        30000,
        1,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM flower_servers WHERE id = 1
    `);
  }
}
