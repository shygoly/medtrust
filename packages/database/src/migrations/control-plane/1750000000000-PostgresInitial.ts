import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Generated from the current TypeORM entity metadata against an empty
 * PostgreSQL database. The guard makes adoption idempotent when a database was
 * bootstrapped before migrations were introduced.
 */
export class PostgresControlPlaneInitial1750000000000 implements MigrationInterface {
  name = "PostgresControlPlaneInitial1750000000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable("cp_space")) return;
    const queries: Array<[string, unknown[]]> = [
    [
      "CREATE TABLE \"cp_kri_definition\" (\"id\" character varying NOT NULL, \"code\" character varying NOT NULL, \"name\" character varying NOT NULL, \"unit\" character varying NOT NULL DEFAULT '', \"category\" character varying NOT NULL DEFAULT '', \"riskTier\" character varying NOT NULL DEFAULT 'routine', \"direction\" character varying NOT NULL DEFAULT 'higher_worse', \"windowKind\" character varying NOT NULL DEFAULT 'cumulative', \"thresholds\" text, \"description\" character varying NOT NULL DEFAULT '', \"status\" character varying NOT NULL DEFAULT 'active', \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"UQ_0cdedfe7d924cfa1a9a0b6895e9\" UNIQUE (\"code\"), CONSTRAINT \"PK_991a6dc047f472b981ff98f369d\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE TABLE \"cp_kri_observation\" (\"id\" character varying NOT NULL, \"kriCode\" character varying NOT NULL, \"siteId\" character varying NOT NULL, \"siteName\" character varying NOT NULL DEFAULT '', \"studyId\" character varying NOT NULL DEFAULT '', \"periodStart\" character varying NOT NULL DEFAULT '', \"periodEnd\" character varying NOT NULL DEFAULT '', \"numerator\" integer NOT NULL DEFAULT '0', \"denominator\" integer NOT NULL DEFAULT '0', \"value\" real NOT NULL DEFAULT '0', \"cohortSize\" integer NOT NULL DEFAULT '0', \"suppressed\" boolean NOT NULL DEFAULT false, \"sourceDigest\" character varying NOT NULL DEFAULT '', \"submittedAt\" character varying NOT NULL DEFAULT '', \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_ffdb8822abf0d06e82530c8133b\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE TABLE \"cp_qtl_breach\" (\"id\" uuid NOT NULL DEFAULT uuid_generate_v4(), \"kriCode\" character varying NOT NULL, \"siteId\" character varying NOT NULL, \"studyId\" character varying NOT NULL DEFAULT '', \"observedValue\" real NOT NULL DEFAULT '0', \"thresholdLevel\" character varying NOT NULL DEFAULT 'warning', \"thresholdValue\" real NOT NULL DEFAULT '0', \"severity\" character varying NOT NULL DEFAULT 'warning', \"status\" character varying NOT NULL DEFAULT 'open', \"detectedAt\" character varying NOT NULL DEFAULT '', \"attestationTxHash\" character varying NOT NULL DEFAULT '', \"attestationBlock\" integer NOT NULL DEFAULT '0', \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_8611c81022e6ad392d94c0227fc\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE TABLE \"cp_data_product\" (\"id\" character varying NOT NULL, \"urn\" character varying NOT NULL, \"homeSpace\" character varying NOT NULL, \"providerId\" character varying NOT NULL, \"title\" character varying NOT NULL, \"productType\" character varying NOT NULL DEFAULT 'data', \"classification\" character varying, \"classificationTag\" text, \"status\" character varying NOT NULL DEFAULT 'active', \"rightsConfirmed\" boolean NOT NULL DEFAULT false, \"recordCount\" integer NOT NULL DEFAULT '0', \"fhirSchema\" text, \"productRoles\" text, \"coverage\" text, \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), \"updatedAt\" TIMESTAMP, CONSTRAINT \"PK_dcd1c4b914012401366208ea3a1\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE UNIQUE INDEX \"IDX_6f195958f503696034506a44ee\" ON \"cp_data_product\" (\"urn\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_notification\" (\"space_id\" character varying, \"id\" character varying NOT NULL, \"recipientParticipantId\" character varying NOT NULL, \"recipientRole\" character varying, \"type\" character varying NOT NULL, \"title\" character varying NOT NULL, \"body\" text, \"resourceType\" character varying, \"resourceId\" character varying, \"actorParticipantId\" character varying, \"status\" character varying NOT NULL DEFAULT 'unread', \"created_at\" TIMESTAMP NOT NULL DEFAULT now(), \"readAt\" TIMESTAMP, \"details\" text, CONSTRAINT \"PK_696faa7b05b96eb9729c67e759f\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_421522abd2a35c6b5ef1dc2ee9\" ON \"cp_notification\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_b72db0eb4d6812e98ffef8544b\" ON \"cp_notification\" (\"recipientParticipantId\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_41f75fe4ddde8c7ae63e3d3f6d\" ON \"cp_notification\" (\"type\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_data_access_grant\" (\"space_id\" character varying, \"id\" character varying NOT NULL, \"dataProductId\" character varying NOT NULL, \"providerId\" character varying NOT NULL, \"granteeParticipantId\" character varying NOT NULL, \"permissions\" text NOT NULL, \"purpose\" character varying, \"status\" character varying NOT NULL DEFAULT 'active', \"grantedByUserId\" character varying, \"grantedByParticipantId\" character varying, \"grantedAt\" TIMESTAMP NOT NULL, \"expiresAt\" character varying, \"revokedByUserId\" character varying, \"revokedAt\" TIMESTAMP, \"revokeReason\" character varying, \"note\" character varying, CONSTRAINT \"PK_dd02aff7848a129f119b33a0e15\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_49985defaf6294fb39ce298dde\" ON \"cp_data_access_grant\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_7b72e48e2155fa154d9777c93e\" ON \"cp_data_access_grant\" (\"dataProductId\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_aa93189e920918103a31534299\" ON \"cp_data_access_grant\" (\"granteeParticipantId\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_d3bc738edf2f88e58df9202ebf\" ON \"cp_data_access_grant\" (\"grantedAt\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_digital_contract\" (\"space_id\" character varying, \"id\" character varying NOT NULL, \"dataProductId\" character varying NOT NULL, \"providerId\" character varying NOT NULL, \"consumerId\" character varying NOT NULL, \"purpose\" character varying NOT NULL, \"retention\" character varying NOT NULL, \"output\" character varying NOT NULL, \"outputPolicy\" text, \"validUntil\" character varying NOT NULL, \"status\" character varying NOT NULL DEFAULT 'active', \"pricing\" text, \"hash\" character varying, \"consumerAcknowledgedAt\" character varying, \"acknowledgedHash\" character varying, \"attestationTxHash\" character varying, \"attestationBlock\" integer, \"attestedAt\" character varying, \"revokeReason\" character varying, \"pinnedModules\" text, \"preReview\" text, \"preReviewAck\" text, \"autoOfferGrantId\" character varying, \"autoOfferedAt\" character varying, \"mdopTerms\" text, \"holderSignature\" text, \"platformCountersignature\" text, \"mdopStatus\" character varying NOT NULL DEFAULT 'unsigned', \"mdopOfferedAt\" character varying, \"mdopAgreedAt\" character varying, \"mdopTerminatedAt\" character varying, \"mdopTerminateReason\" character varying, \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_6fe88375ca769b6730e346132c9\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_c92576fedab1fe51380d4b7040\" ON \"cp_digital_contract\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_d5c3bce68472d56e9b5a7c07dd\" ON \"cp_digital_contract\" (\"dataProductId\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_mdop_operator\" (\"space_id\" character varying, \"ref\" character varying NOT NULL, \"opId\" character varying NOT NULL, \"version\" character varying NOT NULL, \"kind\" character varying NOT NULL, \"category\" character varying NOT NULL, \"digest\" character varying NOT NULL, \"manifest\" text NOT NULL, \"signature\" text NOT NULL, \"registeredAt\" TIMESTAMP NOT NULL DEFAULT now(), \"registeredBy\" character varying, CONSTRAINT \"PK_4f77047e0b7b92309d66b492e13\" PRIMARY KEY (\"ref\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_02c7c32bad51337f1df5f2b9cb\" ON \"cp_mdop_operator\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_6311cc3ff625224742f44fbc50\" ON \"cp_mdop_operator\" (\"opId\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_94185740d8a72ed35a6b0c89ef\" ON \"cp_mdop_operator\" (\"category\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_101b23b1af9e735719df6db2e3\" ON \"cp_mdop_operator\" (\"digest\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_mdop_outbox\" (\"space_id\" character varying, \"id\" character varying NOT NULL, \"msg_id\" character varying NOT NULL, \"msg_type\" character varying NOT NULL, \"job_id\" character varying, \"receiver\" character varying NOT NULL, \"sender\" character varying NOT NULL, \"idempotency_key\" character varying NOT NULL, \"body\" text NOT NULL, \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), \"deliveredAt\" TIMESTAMP, \"envelope\" text, CONSTRAINT \"PK_e066df17ce4728bb8fc68eaff87\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_5688a6a91cbeea2670eac149f1\" ON \"cp_mdop_outbox\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_6490a18d3e29cc5e8acfd8607a\" ON \"cp_mdop_outbox\" (\"msg_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_1025c9e3b69d4349071dad2c7d\" ON \"cp_mdop_outbox\" (\"job_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_7f43f5f842ad693e93dd0f70f4\" ON \"cp_mdop_outbox\" (\"receiver\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_settlement_record\" (\"space_id\" character varying, \"metering_engine\" text, \"id\" character varying NOT NULL, \"taskId\" character varying NOT NULL, \"taskRef\" character varying NOT NULL, \"consumer\" character varying NOT NULL, \"consumerId\" character varying NOT NULL, \"currency\" character varying NOT NULL, \"contributionTotal\" integer NOT NULL DEFAULT '0', \"total\" real NOT NULL DEFAULT '0', \"hash\" character varying NOT NULL, \"at\" character varying NOT NULL, \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_f789537030e2141daab2d208c03\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_453a0f113432b1f7de1579b3d2\" ON \"cp_settlement_record\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_settlement_line\" (\"space_id\" character varying, \"id\" uuid NOT NULL DEFAULT uuid_generate_v4(), \"org\" character varying NOT NULL, \"participantId\" character varying NOT NULL, \"contribution\" integer NOT NULL DEFAULT '0', \"amount\" real NOT NULL DEFAULT '0', \"recordId\" character varying, CONSTRAINT \"PK_bef40b33487487747773748e5b3\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_2dd3e2f9b68b6576983de9c19e\" ON \"cp_settlement_line\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_federation_trust\" (\"spaceId\" character varying NOT NULL, \"caPublicKey\" text NOT NULL, \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_6356507e7f30ddf432383b6cf01\" PRIMARY KEY (\"spaceId\"))",
      [],
    ],
    [
      "CREATE TABLE \"cp_space\" (\"branding\" text, \"enabled_packs\" text, \"id\" character varying NOT NULL, \"name\" character varying NOT NULL, \"description\" character varying, \"status\" character varying NOT NULL DEFAULT 'active', \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_cad03120b84cc0bcaba8a7d515e\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE TABLE \"cp_remote_catalog\" (\"id\" uuid NOT NULL DEFAULT uuid_generate_v4(), \"spaceId\" character varying NOT NULL, \"productId\" character varying NOT NULL, \"urn\" character varying NOT NULL, \"homeSpace\" character varying NOT NULL, \"providerId\" character varying NOT NULL, \"title\" character varying NOT NULL, \"classification\" character varying, \"rightsConfirmed\" boolean NOT NULL DEFAULT false, \"recordCount\" integer NOT NULL DEFAULT '0', CONSTRAINT \"PK_cad91f3a802a07504013ddc5280\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_1f45d7fa33f6634634dd6ed32d\" ON \"cp_remote_catalog\" (\"spaceId\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_ca_keypair\" (\"spaceId\" character varying NOT NULL, \"publicKey\" text NOT NULL, \"privateKey\" text NOT NULL, \"platformNodePublicKey\" text, \"platformNodePrivateKey\" text, \"registryPublicKey\" text, \"registryPrivateKey\" text, \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_ec35aff3f7f663468f5506fdc43\" PRIMARY KEY (\"spaceId\"))",
      [],
    ],
    [
      "CREATE TABLE \"cp_participant\" (\"commercial\" text, \"id\" uuid NOT NULL DEFAULT uuid_generate_v4(), \"org\" character varying NOT NULL, \"role\" character varying, \"region\" character varying, \"subjectVerified\" boolean NOT NULL DEFAULT false, \"dataVerified\" boolean NOT NULL DEFAULT false, \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_39b19ddbd9d393cc5e70dd9bd37\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE UNIQUE INDEX \"IDX_fce6e7b26ffa6b71498bd89936\" ON \"cp_participant\" (\"org\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_certificate\" (\"sm2Fingerprint\" character varying NOT NULL, \"participantId\" character varying NOT NULL, \"connectorId\" character varying NOT NULL, \"spaceId\" character varying NOT NULL, \"subjectPublicKey\" text NOT NULL, \"validUntil\" TIMESTAMP NOT NULL, \"revoked\" boolean NOT NULL DEFAULT false, \"issuedAt\" TIMESTAMP NOT NULL DEFAULT now(), \"caSignature\" text, CONSTRAINT \"PK_e21def9a640804eb77f367b0d4b\" PRIMARY KEY (\"sm2Fingerprint\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_98b25d5e6f817473c67cb950f4\" ON \"cp_certificate\" (\"participantId\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_attestation_ref\" (\"space_id\" character varying, \"id\" uuid NOT NULL DEFAULT uuid_generate_v4(), \"hash\" character varying NOT NULL, \"kind\" character varying NOT NULL, \"subjectType\" character varying, \"taskId\" character varying, \"attestationLevel\" character varying NOT NULL DEFAULT 'software', \"txHash\" character varying NOT NULL, \"inputFingerprint\" character varying, \"outputHash\" character varying, \"block\" bigint NOT NULL, \"anchoredAt\" character varying, \"at\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_64363a4c95f710c5c1953ba6a4e\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_fc01fa29b07e9def1d17be0b87\" ON \"cp_attestation_ref\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_f7b9cfc86660a1244b46aa2583\" ON \"cp_attestation_ref\" (\"hash\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_connector_audit_digest\" (\"space_id\" character varying, \"id\" uuid NOT NULL DEFAULT uuid_generate_v4(), \"participantId\" character varying NOT NULL, \"count\" integer NOT NULL DEFAULT '0', \"firstPrevHash\" character varying, \"lastEntryHash\" character varying, \"chainOk\" character varying NOT NULL DEFAULT 'ok', \"blockedEvents\" text NOT NULL DEFAULT '[]', \"receivedAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_da2c39f7ecd8ae181efc5a2fe45\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_ee6fc4113796aa995a0233d42f\" ON \"cp_connector_audit_digest\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_a5749f84fe0d6aa9c79c05363b\" ON \"cp_connector_audit_digest\" (\"participantId\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_connector_registry\" (\"space_id\" character varying, \"id\" uuid NOT NULL DEFAULT uuid_generate_v4(), \"participantId\" character varying NOT NULL, \"certificateHash\" character varying, \"capabilities\" text, \"healthStatus\" character varying NOT NULL DEFAULT 'unknown', \"lastSeen\" TIMESTAMP, \"lastHeartbeat\" text, \"wsSessionId\" character varying, \"registeredAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_0a9733f4f094a1f6738188b7dc5\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_fc54fac06296df95cf6416c52c\" ON \"cp_connector_registry\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_6ef8ea714823019d99ffb69abe\" ON \"cp_connector_registry\" (\"participantId\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_rws_task\" (\"space_id\" character varying, \"taskId\" character varying NOT NULL, \"title\" character varying NOT NULL, \"purpose\" character varying NOT NULL, \"analysis\" text NOT NULL, \"consumerId\" character varying NOT NULL, \"contractIds\" text NOT NULL, \"status\" character varying NOT NULL DEFAULT 'pending', \"attestationLevel\" character varying NOT NULL DEFAULT 'software', \"merged\" text, \"completedAt\" TIMESTAMP, \"protocolVersion\" integer NOT NULL DEFAULT '1', \"revisionReason\" text, \"revisedAt\" TIMESTAMP, \"frozenAt\" TIMESTAMP, \"protocolWarnings\" text NOT NULL DEFAULT '[]', \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_3469a3e8de319c4adbefcc35ccf\" PRIMARY KEY (\"taskId\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_ce8cac4d488f5fc3214ec1a940\" ON \"cp_rws_task\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_rws_assignment\" (\"space_id\" character varying, \"assignmentId\" character varying NOT NULL, \"taskId\" character varying NOT NULL, \"providerId\" character varying NOT NULL, \"purpose\" character varying NOT NULL, \"analysis\" text NOT NULL, \"contract\" text NOT NULL, \"status\" character varying NOT NULL DEFAULT 'pending', \"progress\" text NOT NULL DEFAULT '[]', \"aggregate\" text, \"error\" text, \"startedAt\" TIMESTAMP, \"completedAt\" TIMESTAMP, \"executionIsolation\" character varying NOT NULL DEFAULT 'none', \"moduleSm3\" character varying, \"resultSm3\" character varying, \"connectorResultSig\" text, \"connectorCertFingerprint\" character varying, CONSTRAINT \"PK_d385a0c65d943ed39a3702af73a\" PRIMARY KEY (\"assignmentId\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_e6395ad3740314029339920c6f\" ON \"cp_rws_assignment\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_5d9e4c8a20e77b2d7c4efeb1ce\" ON \"cp_rws_assignment\" (\"taskId\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_9046d9b38a0fadf8f7d871fbd3\" ON \"cp_rws_assignment\" (\"providerId\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_fl_prediction_task\" (\"space_id\" character varying, \"taskId\" character varying NOT NULL, \"title\" character varying NOT NULL, \"purpose\" character varying NOT NULL, \"flPredictionSpec\" text NOT NULL, \"consumerId\" character varying NOT NULL, \"contractIds\" text NOT NULL, \"computeTaskId\" integer, \"status\" character varying NOT NULL DEFAULT 'pending', \"attestationLevel\" character varying NOT NULL DEFAULT 'software', \"merged\" text, \"resultSummary\" text, \"completedAt\" TIMESTAMP, \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_7ae1f18ddd3b7aa4967eabe934f\" PRIMARY KEY (\"taskId\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_f03a489fbcd5719fb5d9f75958\" ON \"cp_fl_prediction_task\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_fl_prediction_assignment\" (\"space_id\" character varying, \"assignmentId\" character varying NOT NULL, \"taskId\" character varying NOT NULL, \"providerId\" character varying NOT NULL, \"purpose\" character varying NOT NULL, \"flPredictionSpec\" text NOT NULL, \"contract\" text NOT NULL, \"status\" character varying NOT NULL DEFAULT 'pending', \"progress\" text NOT NULL DEFAULT '[]', \"partyResult\" text, \"error\" text, \"startedAt\" TIMESTAMP, \"completedAt\" TIMESTAMP, CONSTRAINT \"PK_cf8e38a143c41795972f44def3b\" PRIMARY KEY (\"assignmentId\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_f01963e30b63580db6118fd6a2\" ON \"cp_fl_prediction_assignment\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_870d1f9a5677208d1e5b883d8b\" ON \"cp_fl_prediction_assignment\" (\"taskId\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_b8a0e3f85b00dd4e03ae9def6c\" ON \"cp_fl_prediction_assignment\" (\"providerId\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_org_certification_application\" (\"id\" uuid NOT NULL DEFAULT uuid_generate_v4(), \"userId\" integer NOT NULL, \"status\" character varying NOT NULL DEFAULT 'draft', \"orgType\" character varying, \"licenseImages\" text, \"orgName\" character varying, \"uscc\" character varying, \"validPeriod\" character varying, \"validUntil\" character varying, \"region\" character varying, \"address\" character varying, \"businessScope\" text, \"orgIntro\" text, \"industry\" character varying, \"capitalWanYuan\" numeric, \"regDate\" character varying, \"logoKey\" character varying, \"caIdentityName\" character varying, \"caPublicKey\" text, \"caCertFingerprint\" character varying, \"source\" character varying NOT NULL DEFAULT 'manual', \"interopSubjectId\" character varying, \"reviewerId\" integer, \"reviewNote\" text, \"reviewedAt\" TIMESTAMP, \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), \"updatedAt\" TIMESTAMP, CONSTRAINT \"PK_cb67df060a89a44ee0be0484129\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE UNIQUE INDEX \"IDX_0497859ed9f2e7a3fce2c74676\" ON \"cp_org_certification_application\" (\"userId\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_open_platform_app\" (\"id\" uuid NOT NULL DEFAULT uuid_generate_v4(), \"appId\" character varying NOT NULL, \"name\" character varying NOT NULL, \"app_key_hash\" character varying(64) NOT NULL, \"scopes\" text, \"status\" character varying NOT NULL DEFAULT 'active', \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), \"revokedAt\" TIMESTAMP, CONSTRAINT \"PK_013e50db81ea110a8a43eec0cbc\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE UNIQUE INDEX \"IDX_b8a3e399b502150398e7d4f4a8\" ON \"cp_open_platform_app\" (\"appId\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_interop_subject\" (\"subjectId\" character varying NOT NULL, \"nodeId\" character varying NOT NULL, \"orgName\" character varying, \"uscc\" character varying, \"region\" character varying, \"legalPerson\" character varying, \"rawPayload\" text, \"participantId\" character varying, \"status\" character varying NOT NULL DEFAULT 'synced', \"importedAt\" TIMESTAMP NOT NULL DEFAULT now(), \"updatedAt\" TIMESTAMP, CONSTRAINT \"PK_aabc50cbac104fb8be1fa0efa0f\" PRIMARY KEY (\"subjectId\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_0928b4ec7aab10a5e9750a560c\" ON \"cp_interop_subject\" (\"nodeId\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_module_admission\" (\"space_id\" character varying, \"admissionId\" character varying NOT NULL, \"analysisType\" character varying NOT NULL, \"tier\" character varying NOT NULL, \"language\" character varying NOT NULL, \"submittedBy\" character varying NOT NULL, \"sourceRef\" text NOT NULL, \"confidential\" boolean NOT NULL DEFAULT false, \"sm3\" character varying, \"sizeBytes\" integer, \"toolchain\" text, \"reproducibleBuildRef\" text, \"staticGate\" text, \"dynamicGate\" text, \"shadow\" text, \"review\" text, \"status\" character varying NOT NULL DEFAULT 'submitted', \"rejectionReason\" text, \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), \"updatedAt\" TIMESTAMP, CONSTRAINT \"PK_6661429b1e872e7684acb753a2d\" PRIMARY KEY (\"admissionId\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_014443ce409178fe63d41b23e3\" ON \"cp_module_admission\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_c46f88e31209317a831636a80a\" ON \"cp_module_admission\" (\"analysisType\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_2e3669eaa8bab49f6577218ffa\" ON \"cp_module_admission\" (\"sm3\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_module_revocation\" (\"space_id\" character varying, \"sm3\" character varying NOT NULL, \"reason\" character varying NOT NULL, \"revokedAt\" TIMESTAMP NOT NULL, \"revokedBy\" character varying NOT NULL, \"detail\" text, \"listVersion\" integer NOT NULL DEFAULT '1', CONSTRAINT \"PK_a63d03f3e188d79adfe8af94b1a\" PRIMARY KEY (\"sm3\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_ce915645128656187a394f1463\" ON \"cp_module_revocation\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_mdop_job\" (\"space_id\" character varying, \"id\" character varying NOT NULL, \"purpose\" character varying NOT NULL, \"applicant\" text NOT NULL, \"contracts\" text NOT NULL, \"contractBundleId\" character varying, \"contractBundleVersion\" character varying, \"contractBundle\" text, \"contractBindings\" text, \"ethicsRef\" character varying, \"dpBudget\" real, \"deadline\" character varying, \"logicalPlan\" text NOT NULL, \"jobHeader\" text, \"status\" character varying NOT NULL DEFAULT 'SUBMITTED', \"planHash\" character varying, \"rejectReason\" character varying, \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), \"updatedAt\" TIMESTAMP, CONSTRAINT \"PK_8c7795fe1c6509ddacc66e5e0ae\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_8b04b0bb8eca7f7607c60dd5f9\" ON \"cp_mdop_job\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_e64d8653f54b54622e0a12663f\" ON \"cp_mdop_job\" (\"purpose\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_af62c6b58ca7cf8b46d0bea57d\" ON \"cp_mdop_job\" (\"contractBundleId\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_9d4e1055de91159fa1cac8ecb8\" ON \"cp_mdop_job\" (\"status\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_mdop_fragment\" (\"space_id\" character varying, \"id\" character varying NOT NULL, \"jobId\" character varying NOT NULL, \"node\" character varying NOT NULL, \"fragment\" text NOT NULL, \"fragmentHash\" character varying NOT NULL, \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_2945a7c1461eb2e713bb01c4602\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_d7bd248ff02cd489faf97adde2\" ON \"cp_mdop_fragment\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_ef1870e8aefbb1fd2426e4597f\" ON \"cp_mdop_fragment\" (\"jobId\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_8b257fa46ee5ce8bf3909c9e3c\" ON \"cp_mdop_fragment\" (\"node\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_mdop_stage\" (\"space_id\" character varying, \"id\" character varying NOT NULL, \"jobId\" character varying NOT NULL, \"stageId\" character varying NOT NULL, \"node\" character varying NOT NULL, \"opRef\" character varying NOT NULL, \"opDigest\" character varying NOT NULL, \"params\" text NOT NULL, \"inputs\" text NOT NULL, \"outputLabel\" character varying NOT NULL, \"outputSchema\" character varying NOT NULL, \"ttlHours\" integer, \"status\" character varying NOT NULL DEFAULT 'PENDING', \"attempt\" integer NOT NULL DEFAULT '0', \"lastError\" character varying, \"updatedAt\" TIMESTAMP, CONSTRAINT \"PK_aa13e62a96f016c4f209aa04061\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_918ad76b6c491a1a4733d9150c\" ON \"cp_mdop_stage\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_d4a981e3074f2c399a5af07029\" ON \"cp_mdop_stage\" (\"jobId\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_ba71a84b9f087a08937290e580\" ON \"cp_mdop_stage\" (\"node\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_mdop_aggregate_contribution\" (\"space_id\" character varying, \"id\" character varying NOT NULL, \"contributionRef\" character varying NOT NULL, \"jobId\" character varying NOT NULL, \"stageId\" character varying NOT NULL, \"contributorId\" character varying NOT NULL, \"digest\" character varying NOT NULL, \"partialSignature\" text NOT NULL, \"ciphertext\" text NOT NULL, \"expiresAt\" TIMESTAMP NOT NULL, \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_c4c7e9b3fd4f5a0e9638a3ef13c\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_54ea1694b14c7e4ad197aad7f5\" ON \"cp_mdop_aggregate_contribution\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_e753e5bb9b0523896c266deffe\" ON \"cp_mdop_aggregate_contribution\" (\"contributionRef\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_9dbcdd797ac935646c639de3eb\" ON \"cp_mdop_aggregate_contribution\" (\"jobId\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_cc7e3f6cb6a988f2b37cdb931a\" ON \"cp_mdop_aggregate_contribution\" (\"stageId\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_mdop_ticket\" (\"space_id\" character varying, \"ticketId\" character varying NOT NULL, \"jobId\" character varying NOT NULL, \"core\" text NOT NULL, \"signatures\" text NOT NULL, \"status\" character varying NOT NULL DEFAULT 'OFFERED', \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), \"issuedAt\" TIMESTAMP, CONSTRAINT \"PK_77a08b3999869e702187101f543\" PRIMARY KEY (\"ticketId\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_57a73f6c5c209939576f13efb1\" ON \"cp_mdop_ticket\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_cb04b86f7ec21cbd3de8dda797\" ON \"cp_mdop_ticket\" (\"jobId\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_mdop_signature_record\" (\"space_id\" character varying, \"id\" character varying NOT NULL, \"jobId\" character varying NOT NULL, \"ticketId\" character varying, \"signer\" character varying NOT NULL, \"role\" character varying NOT NULL, \"snapshot\" character varying, \"alg\" character varying NOT NULL DEFAULT 'SM2-SM3', \"value\" text NOT NULL, \"kind\" character varying NOT NULL, \"reason\" character varying, \"at\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_b177c052a6e6f039af5f3f7aa66\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_1df30b55ad12fe95a40dd79ec8\" ON \"cp_mdop_signature_record\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_a000acbd9afb8773635d77c8f1\" ON \"cp_mdop_signature_record\" (\"jobId\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_96ec013c0df219faf8cfaeeb2b\" ON \"cp_mdop_signature_record\" (\"signer\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_mdop_handle\" (\"space_id\" character varying, \"handle\" character varying NOT NULL, \"jobId\" character varying NOT NULL, \"node\" character varying NOT NULL, \"stage\" character varying NOT NULL, \"label\" character varying NOT NULL, \"schema\" character varying NOT NULL, \"digest\" character varying NOT NULL, \"producer\" text NOT NULL, \"ticketId\" character varying, \"expiresAt\" character varying NOT NULL, \"stats\" text, \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_5a0fe4bfde049af3f13805a8c28\" PRIMARY KEY (\"handle\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_06ccc2441545a536da38fcaf9d\" ON \"cp_mdop_handle\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_d0d406e629ecc83f7ddb04a529\" ON \"cp_mdop_handle\" (\"jobId\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_a21c3c3fcf1a3d9c5f1b5b4e41\" ON \"cp_mdop_handle\" (\"node\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_mdop_attestation\" (\"space_id\" character varying, \"id\" character varying NOT NULL, \"node\" character varying NOT NULL, \"jobId\" character varying, \"credentialId\" character varying, \"contractId\" character varying, \"keyId\" character varying, \"kind\" character varying NOT NULL, \"measurement\" character varying NOT NULL, \"tcb\" character varying, \"quoteDigest\" character varying NOT NULL, \"verifiedAt\" character varying NOT NULL, \"expiresAt\" character varying NOT NULL, \"verifiedBy\" character varying NOT NULL, \"warrantDigest\" character varying, \"report\" text, \"warrant\" text, \"chainTx\" character varying, \"chainBlock\" integer, \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_673c93ec60d941d35be36b0ee7f\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_0c887df4aaa784906943a9fb51\" ON \"cp_mdop_attestation\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_e406d633b27f1dd41605baaf87\" ON \"cp_mdop_attestation\" (\"node\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_22aefd73a5f6884dd7f34dcdcf\" ON \"cp_mdop_attestation\" (\"jobId\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_mdop_delivery\" (\"space_id\" character varying, \"id\" character varying NOT NULL, \"jobId\" character varying NOT NULL, \"node\" character varying NOT NULL, \"handle\" character varying NOT NULL, \"label\" character varying NOT NULL, \"digest\" character varying NOT NULL, \"accepted\" boolean NOT NULL, \"reason\" character varying, \"payload\" text, \"receivedAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_e1270d8f3fd1ef95031a578d483\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_8e95c5049ea85e170bf36f44fb\" ON \"cp_mdop_delivery\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_43372b907c26fa9162711d2601\" ON \"cp_mdop_delivery\" (\"jobId\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_3177f3006807497dc2f0bea032\" ON \"cp_mdop_delivery\" (\"node\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_mdop_receipt\" (\"space_id\" character varying, \"id\" character varying NOT NULL, \"jobId\" character varying NOT NULL, \"node\" character varying NOT NULL, \"kind\" character varying NOT NULL, \"payload\" text NOT NULL, \"prevHash\" character varying, \"receivedAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_8d32546a850988f43da01deec6f\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_8ee22d03b56c1f73e78993c064\" ON \"cp_mdop_receipt\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_dd5bae5e93a10eedd78f63a1bf\" ON \"cp_mdop_receipt\" (\"jobId\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_c5f405a664b1b916d445fc3c45\" ON \"cp_mdop_receipt\" (\"node\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_mdop_nonce\" (\"space_id\" character varying, \"nonce\" character varying NOT NULL, \"receiver\" character varying NOT NULL, \"sender\" character varying, \"seenAt\" TIMESTAMP NOT NULL DEFAULT now(), \"expiresAt\" TIMESTAMP NOT NULL, CONSTRAINT \"PK_3f517fa3357c3b35824bdd46b8d\" PRIMARY KEY (\"nonce\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_fffe33695b2cbf9d3cb12ed3d5\" ON \"cp_mdop_nonce\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_b986bdefd78a2ae3951578a3f3\" ON \"cp_mdop_nonce\" (\"receiver\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_space_member\" (\"id\" uuid NOT NULL DEFAULT uuid_generate_v4(), \"space_id\" character varying NOT NULL, \"subjectType\" character varying NOT NULL, \"subjectId\" character varying NOT NULL, \"role\" character varying NOT NULL, \"status\" character varying NOT NULL DEFAULT 'active', \"invitedBy\" character varying, \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), \"joinedAt\" TIMESTAMP, CONSTRAINT \"PK_7eabce372bed46594d855f27f54\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_e21d8d3de853837cffbc0ecba2\" ON \"cp_space_member\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE INDEX \"IDX_5324526c0b2a052e5f25421305\" ON \"cp_space_member\" (\"subjectId\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_space_invitation\" (\"id\" uuid NOT NULL DEFAULT uuid_generate_v4(), \"space_id\" character varying NOT NULL, \"token_hash\" character varying(64) NOT NULL, \"subjectType\" character varying NOT NULL, \"invitee\" character varying NOT NULL, \"role\" character varying NOT NULL, \"status\" character varying NOT NULL DEFAULT 'pending', \"expiresAt\" TIMESTAMP NOT NULL, \"consumedAt\" TIMESTAMP, \"invitedBy\" character varying, \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_ebe46b74d39c29f071736d84566\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_6c9db39fb28deb278fcc360343\" ON \"cp_space_invitation\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE UNIQUE INDEX \"IDX_cbe2ddd9a5ee689f937b468657\" ON \"cp_space_invitation\" (\"token_hash\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_collaboration\" (\"id\" uuid NOT NULL DEFAULT uuid_generate_v4(), \"space_id\" character varying NOT NULL, \"name\" character varying NOT NULL, \"description\" character varying, \"participants\" text NOT NULL DEFAULT '[]', \"dataProductIds\" text NOT NULL DEFAULT '[]', \"status\" character varying NOT NULL DEFAULT 'active', \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_a6c9ecc0cbc7c339bcfba82b376\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_23081e4042b7bb06b22aea3d36\" ON \"cp_collaboration\" (\"space_id\") ",
      [],
    ],
    [
      "CREATE TABLE \"cp_exchange_attempt\" (\"space_id\" character varying, \"id\" uuid NOT NULL DEFAULT uuid_generate_v4(), \"contractId\" character varying, \"mergePoint\" character varying, \"outputHash\" character varying, \"rejection\" character varying, \"createdAt\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"PK_6cd4a55ba6cc63ee8aaa13f715c\" PRIMARY KEY (\"id\"))",
      [],
    ],
    [
      "CREATE INDEX \"IDX_47904939e4ff4fc62319ddfdbc\" ON \"cp_exchange_attempt\" (\"space_id\") ",
      [],
    ],
    [
      "ALTER TABLE \"cp_settlement_line\" ADD CONSTRAINT \"FK_4f42d6a97d0af052a6566c0bf36\" FOREIGN KEY (\"recordId\") REFERENCES \"cp_settlement_record\"(\"id\") ON DELETE CASCADE ON UPDATE NO ACTION",
      [],
    ],
    [
      "ALTER TABLE \"cp_rws_assignment\" ADD CONSTRAINT \"FK_5d9e4c8a20e77b2d7c4efeb1cee\" FOREIGN KEY (\"taskId\") REFERENCES \"cp_rws_task\"(\"taskId\") ON DELETE CASCADE ON UPDATE NO ACTION",
      [],
    ],
    [
      "ALTER TABLE \"cp_fl_prediction_assignment\" ADD CONSTRAINT \"FK_870d1f9a5677208d1e5b883d8b1\" FOREIGN KEY (\"taskId\") REFERENCES \"cp_fl_prediction_task\"(\"taskId\") ON DELETE CASCADE ON UPDATE NO ACTION",
      [],
    ]
    ];
    for (const [statement, parameters] of queries)
      await queryRunner.query(statement, parameters);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const queries: Array<[string, unknown[]]> = [
    [
      "DROP TABLE \"cp_kri_definition\"",
      [],
    ],
    [
      "DROP TABLE \"cp_kri_observation\"",
      [],
    ],
    [
      "DROP TABLE \"cp_qtl_breach\"",
      [],
    ],
    [
      "DROP TABLE \"cp_data_product\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_6f195958f503696034506a44ee\"",
      [],
    ],
    [
      "DROP TABLE \"cp_notification\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_421522abd2a35c6b5ef1dc2ee9\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_b72db0eb4d6812e98ffef8544b\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_41f75fe4ddde8c7ae63e3d3f6d\"",
      [],
    ],
    [
      "DROP TABLE \"cp_data_access_grant\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_49985defaf6294fb39ce298dde\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_7b72e48e2155fa154d9777c93e\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_aa93189e920918103a31534299\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_d3bc738edf2f88e58df9202ebf\"",
      [],
    ],
    [
      "DROP TABLE \"cp_digital_contract\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_c92576fedab1fe51380d4b7040\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_d5c3bce68472d56e9b5a7c07dd\"",
      [],
    ],
    [
      "DROP TABLE \"cp_mdop_operator\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_02c7c32bad51337f1df5f2b9cb\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_6311cc3ff625224742f44fbc50\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_94185740d8a72ed35a6b0c89ef\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_101b23b1af9e735719df6db2e3\"",
      [],
    ],
    [
      "DROP TABLE \"cp_mdop_outbox\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_5688a6a91cbeea2670eac149f1\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_6490a18d3e29cc5e8acfd8607a\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_1025c9e3b69d4349071dad2c7d\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_7f43f5f842ad693e93dd0f70f4\"",
      [],
    ],
    [
      "DROP TABLE \"cp_settlement_record\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_453a0f113432b1f7de1579b3d2\"",
      [],
    ],
    [
      "DROP TABLE \"cp_settlement_line\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_2dd3e2f9b68b6576983de9c19e\"",
      [],
    ],
    [
      "DROP TABLE \"cp_federation_trust\"",
      [],
    ],
    [
      "DROP TABLE \"cp_space\"",
      [],
    ],
    [
      "DROP TABLE \"cp_remote_catalog\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_1f45d7fa33f6634634dd6ed32d\"",
      [],
    ],
    [
      "DROP TABLE \"cp_ca_keypair\"",
      [],
    ],
    [
      "DROP TABLE \"cp_participant\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_fce6e7b26ffa6b71498bd89936\"",
      [],
    ],
    [
      "DROP TABLE \"cp_certificate\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_98b25d5e6f817473c67cb950f4\"",
      [],
    ],
    [
      "DROP TABLE \"cp_attestation_ref\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_fc01fa29b07e9def1d17be0b87\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_f7b9cfc86660a1244b46aa2583\"",
      [],
    ],
    [
      "DROP TABLE \"cp_connector_audit_digest\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_ee6fc4113796aa995a0233d42f\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_a5749f84fe0d6aa9c79c05363b\"",
      [],
    ],
    [
      "DROP TABLE \"cp_connector_registry\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_fc54fac06296df95cf6416c52c\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_6ef8ea714823019d99ffb69abe\"",
      [],
    ],
    [
      "DROP TABLE \"cp_rws_task\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_ce8cac4d488f5fc3214ec1a940\"",
      [],
    ],
    [
      "DROP TABLE \"cp_rws_assignment\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_e6395ad3740314029339920c6f\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_5d9e4c8a20e77b2d7c4efeb1ce\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_9046d9b38a0fadf8f7d871fbd3\"",
      [],
    ],
    [
      "DROP TABLE \"cp_fl_prediction_task\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_f03a489fbcd5719fb5d9f75958\"",
      [],
    ],
    [
      "DROP TABLE \"cp_fl_prediction_assignment\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_f01963e30b63580db6118fd6a2\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_870d1f9a5677208d1e5b883d8b\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_b8a0e3f85b00dd4e03ae9def6c\"",
      [],
    ],
    [
      "DROP TABLE \"cp_org_certification_application\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_0497859ed9f2e7a3fce2c74676\"",
      [],
    ],
    [
      "DROP TABLE \"cp_open_platform_app\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_b8a3e399b502150398e7d4f4a8\"",
      [],
    ],
    [
      "DROP TABLE \"cp_interop_subject\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_0928b4ec7aab10a5e9750a560c\"",
      [],
    ],
    [
      "DROP TABLE \"cp_module_admission\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_014443ce409178fe63d41b23e3\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_c46f88e31209317a831636a80a\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_2e3669eaa8bab49f6577218ffa\"",
      [],
    ],
    [
      "DROP TABLE \"cp_module_revocation\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_ce915645128656187a394f1463\"",
      [],
    ],
    [
      "DROP TABLE \"cp_mdop_job\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_8b04b0bb8eca7f7607c60dd5f9\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_e64d8653f54b54622e0a12663f\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_af62c6b58ca7cf8b46d0bea57d\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_9d4e1055de91159fa1cac8ecb8\"",
      [],
    ],
    [
      "DROP TABLE \"cp_mdop_fragment\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_d7bd248ff02cd489faf97adde2\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_ef1870e8aefbb1fd2426e4597f\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_8b257fa46ee5ce8bf3909c9e3c\"",
      [],
    ],
    [
      "DROP TABLE \"cp_mdop_stage\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_918ad76b6c491a1a4733d9150c\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_d4a981e3074f2c399a5af07029\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_ba71a84b9f087a08937290e580\"",
      [],
    ],
    [
      "DROP TABLE \"cp_mdop_aggregate_contribution\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_54ea1694b14c7e4ad197aad7f5\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_e753e5bb9b0523896c266deffe\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_9dbcdd797ac935646c639de3eb\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_cc7e3f6cb6a988f2b37cdb931a\"",
      [],
    ],
    [
      "DROP TABLE \"cp_mdop_ticket\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_57a73f6c5c209939576f13efb1\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_cb04b86f7ec21cbd3de8dda797\"",
      [],
    ],
    [
      "DROP TABLE \"cp_mdop_signature_record\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_1df30b55ad12fe95a40dd79ec8\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_a000acbd9afb8773635d77c8f1\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_96ec013c0df219faf8cfaeeb2b\"",
      [],
    ],
    [
      "DROP TABLE \"cp_mdop_handle\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_06ccc2441545a536da38fcaf9d\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_d0d406e629ecc83f7ddb04a529\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_a21c3c3fcf1a3d9c5f1b5b4e41\"",
      [],
    ],
    [
      "DROP TABLE \"cp_mdop_attestation\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_0c887df4aaa784906943a9fb51\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_e406d633b27f1dd41605baaf87\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_22aefd73a5f6884dd7f34dcdcf\"",
      [],
    ],
    [
      "DROP TABLE \"cp_mdop_delivery\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_8e95c5049ea85e170bf36f44fb\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_43372b907c26fa9162711d2601\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_3177f3006807497dc2f0bea032\"",
      [],
    ],
    [
      "DROP TABLE \"cp_mdop_receipt\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_8ee22d03b56c1f73e78993c064\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_dd5bae5e93a10eedd78f63a1bf\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_c5f405a664b1b916d445fc3c45\"",
      [],
    ],
    [
      "DROP TABLE \"cp_mdop_nonce\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_fffe33695b2cbf9d3cb12ed3d5\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_b986bdefd78a2ae3951578a3f3\"",
      [],
    ],
    [
      "DROP TABLE \"cp_space_member\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_e21d8d3de853837cffbc0ecba2\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_5324526c0b2a052e5f25421305\"",
      [],
    ],
    [
      "DROP TABLE \"cp_space_invitation\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_6c9db39fb28deb278fcc360343\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_cbe2ddd9a5ee689f937b468657\"",
      [],
    ],
    [
      "DROP TABLE \"cp_collaboration\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_23081e4042b7bb06b22aea3d36\"",
      [],
    ],
    [
      "DROP TABLE \"cp_exchange_attempt\"",
      [],
    ],
    [
      "DROP INDEX \"public\".\"IDX_47904939e4ff4fc62319ddfdbc\"",
      [],
    ],
    [
      "ALTER TABLE \"cp_settlement_line\" DROP CONSTRAINT \"FK_4f42d6a97d0af052a6566c0bf36\"",
      [],
    ],
    [
      "ALTER TABLE \"cp_rws_assignment\" DROP CONSTRAINT \"FK_5d9e4c8a20e77b2d7c4efeb1cee\"",
      [],
    ],
    [
      "ALTER TABLE \"cp_fl_prediction_assignment\" DROP CONSTRAINT \"FK_870d1f9a5677208d1e5b883d8b1\"",
      [],
    ]
    ];
    for (const [statement, parameters] of queries)
      await queryRunner.query(statement, parameters);
  }
}
