import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddEncryptedColumnsToPatient1707620000000 implements MigrationInterface {
  name = 'AddEncryptedColumnsToPatient1707620000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Update idCard column to accommodate encrypted data
    await queryRunner.changeColumn(
      'patients',
      'id_card',
      new TableColumn({
        name: 'id_card',
        type: 'varchar',
        length: '500',
        isNullable: false,
        comment: 'Encrypted with patient-id-card-key',
      }),
    );

    // Update phoneNumber column to accommodate encrypted data
    await queryRunner.changeColumn(
      'patients',
      'phone_number',
      new TableColumn({
        name: 'phone_number',
        type: 'varchar',
        length: '500',
        isNullable: false,
        comment: 'Encrypted with patient-contact-key',
      }),
    );

    // Update medicalHistory column to accommodate encrypted data
    await queryRunner.changeColumn(
      'patients',
      'medical_history',
      new TableColumn({
        name: 'medical_history',
        type: 'text',
        isNullable: true,
        comment: 'Encrypted with patient-medical-history-key',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert idCard column
    await queryRunner.changeColumn(
      'patients',
      'id_card',
      new TableColumn({
        name: 'id_card',
        type: 'varchar',
        length: '18',
        isNullable: false,
      }),
    );

    // Revert phoneNumber column
    await queryRunner.changeColumn(
      'patients',
      'phone_number',
      new TableColumn({
        name: 'phone_number',
        type: 'varchar',
        length: '20',
        isNullable: false,
      }),
    );

    // Revert medicalHistory column
    await queryRunner.changeColumn(
      'patients',
      'medical_history',
      new TableColumn({
        name: 'medical_history',
        type: 'text',
        isNullable: true,
      }),
    );
  }
}
