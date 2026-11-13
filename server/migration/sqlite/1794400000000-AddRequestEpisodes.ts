import type { MigrationInterface, QueryRunner } from 'typeorm';
import { TableColumn } from 'typeorm';

export class AddRequestEpisodes1794400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'media_request',
      new TableColumn({ name: 'manualSearch', type: 'boolean', default: false })
    );
    await queryRunner.addColumn(
      'media_request',
      new TableColumn({ name: 'episodes', type: 'text', isNullable: true })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('media_request', 'episodes');
    await queryRunner.dropColumn('media_request', 'manualSearch');
  }
}
