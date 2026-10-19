import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Generated from the current TypeORM entity metadata against an empty
 * PostgreSQL database. The guard makes adoption idempotent when a database was
 * bootstrapped before migrations were introduced.
 */
export class PostgresConnectorInitial1750000000000 implements MigrationInterface {
  name = "PostgresConnectorInitial1750000000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable("local_mdop_contract")) return;
    const queries: Array<[string, unknown[]]> = [
    [
      "CREATE TABLE \"local_record\" (\"id\" uuid NOT NULL DEFAULT uuid_generate_v4(), \"datasetId\" character varying NOT NULL, \"subjectKey\" character varying NOT NULL, \"ageBand\" character varying, \"sex\" character varying, \"clinical\" text NOT NULL, \"ingestedAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_4f1d55741cccddc5baf61e93efd\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_d38f8e9e787e83561ef0f3c8ab\" ON \"local_record\" (\"datasetId\") ",
      [],
    ],
    [
      "CREATE TABLE \"local_audit_log\" (\"id\" uuid NOT NULL DEFAULT uuid_generate_v4(), \"action\" character varying NOT NULL, \"actor\" character varying NOT NULL, \"taskId\" character varying, \"allowed\" boolean NOT NULL DEFAULT true, \"detail\" character varying, \"entryHash\" character varying, \"prevHash\" character varying, \"at\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_6affe623727c9438ee12d040392\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE TABLE \"local_gold_standard\" (\"id\" uuid NOT NULL DEFAULT uuid_generate_v4(), \"subjectKey\" character varying NOT NULL, \"variableDefinitionId\" character varying NOT NULL, \"judgment\" character varying NOT NULL, \"source\" character varying NOT NULL, \"criteriaText\" text, \"goldStandardSetVersion\" character varying NOT NULL, \"labeledAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_7cb8eefb76e32969965058b90df\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_8e32e40406764623e66c97003f\" ON \"local_gold_standard\" (\"subjectKey\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_713dd4bb000aa6af00c2f49434\" ON \"local_gold_standard\" (\"variableDefinitionId\") ",
      [],
    ],
    [
      "CREATE TABLE \"local_data_source_status\" (\"label\" character varying NOT NULL, \"passed\" boolean NOT NULL DEFAULT false, \"cdmVersion\" character varying, \"vocabularyVersion\" character varying, \"checks\" text NOT NULL, \"checkedAt\" TIMESTAMP NOT NULL, CONSTRAINT \"PK_a0a849a109e46b232d862311e0d\" PRIMARY KEY (\"label\"))",
      [],
    ],
    [
      "CREATE TABLE \"local_mdop_contract\" (\"contractId\" character varying NOT NULL, \"canonical\" text NOT NULL, \"holderSignature\" text NOT NULL, \"platformCountersignature\" text NOT NULL, \"status\" character varying NOT NULL DEFAULT 'pending', \"reviewMode\" character varying NOT NULL, \"reviewPolicy\" character varying, \"reviewDeadlineHours\" integer NOT NULL DEFAULT '72', \"purposeCode\" character varying NOT NULL, \"recipients\" text NOT NULL, \"publication\" text, \"allowedOpDigests\" text NOT NULL, \"validFrom\" character varying NOT NULL, \"validUntil\" character varying NOT NULL, \"revokedAt\" character varying, \"revokeReason\" character varying, \"terminationSent\" boolean NOT NULL DEFAULT false, \"receivedAt\" TIMESTAMP NOT NULL DEFAULT now(), \"updatedAt\" TIMESTAMP NOT NULL, CONSTRAINT \"PK_9d06c0933cf64fcfb82c6ecc6c5\" PRIMARY KEY (\"contractId\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_331c89d5ac15808d51253ac348\" ON \"local_mdop_contract\" (\"status\") ",
      [],
    ],
    [
      "CREATE TABLE \"local_mdop_contract_pending\" (\"offerId\" character varying NOT NULL, \"contractId\" character varying NOT NULL, \"canonical\" text NOT NULL, \"status\" character varying NOT NULL DEFAULT 'pending', \"expiresAt\" character varying NOT NULL, \"decidedBy\" character varying, \"decidedAt\" character varying, \"rejectReason\" character varying, \"receivedAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_59eb22d659b7de9b5a56f37d917\" PRIMARY KEY (\"offerId\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_a6fb701352e59aac61cd8f1cc9\" ON \"local_mdop_contract_pending\" (\"contractId\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_c15be1cc62faf1a7941642da50\" ON \"local_mdop_contract_pending\" (\"status\") ",
      [],
    ],
    [
      "CREATE TABLE \"local_mdop_operator_whitelist\" (\"digest\" character varying NOT NULL, \"kind\" character varying NOT NULL DEFAULT 'wasm', \"addedBy\" character varying NOT NULL, \"note\" character varying, \"addedAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_896ef4741a690b4349a2216e43b\" PRIMARY KEY (\"digest\"))",
      [],
    ],
    [
      "CREATE TABLE \"local_mdop_revocation_state\" (\"id\" character varying NOT NULL DEFAULT 'current', \"version\" integer NOT NULL, \"revokedDigests\" text NOT NULL, \"issuedAt\" character varying NOT NULL, \"receivedAt\" character varying NOT NULL, CONSTRAINT \"PK_53d598db5e60f327b7ea2983e9d\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE TABLE \"local_mdop_processed_key\" (\"key\" character varying NOT NULL, \"jobId\" character varying NOT NULL, \"stageId\" character varying NOT NULL, \"attempt\" integer NOT NULL, \"result\" text NOT NULL, \"at\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_e91a8acae850c24e64298d235df\" PRIMARY KEY (\"key\"))",
      [],
    ],
    [
      "CREATE TABLE \"local_mdop_nonce\" (\"nonce\" character varying NOT NULL, \"sender\" character varying NOT NULL, \"expiresAt\" TIMESTAMP NOT NULL, \"seenAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_02edc6dcf1fea631364f63bcc89\" PRIMARY KEY (\"nonce\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_1ab6f1cce12d6378c40a9b495f\" ON \"local_mdop_nonce\" (\"sender\") ",
      [],
    ],
    [
      "CREATE TABLE \"local_mdop_artifact\" (\"handle\" character varying NOT NULL, \"jobId\" character varying NOT NULL, \"stage\" character varying NOT NULL, \"label\" character varying NOT NULL, \"schema\" character varying NOT NULL, \"digest\" character varying NOT NULL, \"payload\" text NOT NULL, \"stats\" text, \"expiresAt\" character varying NOT NULL, \"ticketId\" character varying, \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), \"destroyedAt\" character varying, CONSTRAINT \"PK_ba69d0a958099cd5351e3e2be77\" PRIMARY KEY (\"handle\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_b36b2fd62b9423af186c335bf4\" ON \"local_mdop_artifact\" (\"jobId\") ",
      [],
    ],
    [
      "CREATE TABLE \"local_mdop_receipt\" (\"receiptId\" character varying NOT NULL, \"jobId\" character varying NOT NULL, \"stage\" character varying NOT NULL, \"event\" character varying NOT NULL, \"payload\" text NOT NULL, \"prevReceiptHash\" character varying, \"entryHash\" character varying NOT NULL, \"reported\" boolean NOT NULL DEFAULT false, \"at\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_d70e863a8a7da2bf868a3c2093a\" PRIMARY KEY (\"receiptId\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_f382bdac740f638054ecae3bc6\" ON \"local_mdop_receipt\" (\"jobId\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_e3820969fdd77bf4833faf90b7\" ON \"local_mdop_receipt\" (\"entryHash\") ",
      [],
    ]
    ];
    for (const [statement, parameters] of queries)
      await queryRunner.query(statement, parameters);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const queries: Array<[string, unknown[]]> = [
    [
      "DROP TABLE \"local_record\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_d38f8e9e787e83561ef0f3c8ab\"",
      [],
    ],
    [
      "DROP TABLE \"local_audit_log\"",
      [],
    ],
    [
      "DROP TABLE \"local_gold_standard\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_8e32e40406764623e66c97003f\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_713dd4bb000aa6af00c2f49434\"",
      [],
    ],
    [
      "DROP TABLE \"local_data_source_status\"",
      [],
    ],
    [
      "DROP TABLE \"local_mdop_contract\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_331c89d5ac15808d51253ac348\"",
      [],
    ],
    [
      "DROP TABLE \"local_mdop_contract_pending\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_a6fb701352e59aac61cd8f1cc9\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_c15be1cc62faf1a7941642da50\"",
      [],
    ],
    [
      "DROP TABLE \"local_mdop_operator_whitelist\"",
      [],
    ],
    [
      "DROP TABLE \"local_mdop_revocation_state\"",
      [],
    ],
    [
      "DROP TABLE \"local_mdop_processed_key\"",
      [],
    ],
    [
      "DROP TABLE \"local_mdop_nonce\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_1ab6f1cce12d6378c40a9b495f\"",
      [],
    ],
    [
      "DROP TABLE \"local_mdop_artifact\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_b36b2fd62b9423af186c335bf4\"",
      [],
    ],
    [
      "DROP TABLE \"local_mdop_receipt\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_f382bdac740f638054ecae3bc6\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_e3820969fdd77bf4833faf90b7\"",
      [],
    ]
    ];
    for (const [statement, parameters] of queries)
      await queryRunner.query(statement, parameters);
  }
}
