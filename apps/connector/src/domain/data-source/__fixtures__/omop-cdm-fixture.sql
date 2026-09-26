-- omop-data-source-access —— 测试用 OMOP CDM v5.4 子集 + 医院侧视图层 + 多个契约变体账号。
--
-- 本文件同时是「医院接入手册」的可执行样例：cdm_raw / cdm / results 三段布局
-- 与 connector_ok 的授权，就是医院 DBA 应当照着建的样子。
--
-- 布局：
--   cdm_raw      底表（含直接标识，连接器**无权限**）
--   cdm          正确的视图层：同名同结构、去直接标识
--   cdm_leaky    负例：person 视图漏了身份证号
--   cdm_missing  负例：缺 drug_exposure 视图
--   results      连接器可建表可写（队列定义要往这里写 cohort）
-- 账号（每个对应一类契约违规，供接入校验逐条负例）：
--   connector_ok        正确的双权限域
--   connector_readonly  只读，results 不可建表   → 「纯只读不满足契约」
--   connector_overpriv  额外能读 cdm_raw         → 「底表可达」
--   connector_leaky     读 cdm_leaky             → 「视图含直接标识」
--   connector_missing   读 cdm_missing           → 「缺必需表」
--   connector_nometa    读不到 cdm_source        → 「元数据不可读」
--   connector_mrn       person 视图带 person_source_value（CDM 规范内，但按 ETL 惯例就是病案号）

CREATE SCHEMA cdm_raw;
CREATE SCHEMA cdm;
CREATE SCHEMA cdm_leaky;
CREATE SCHEMA cdm_missing;
CREATE SCHEMA cdm_nometa;
CREATE SCHEMA cdm_mrn;
CREATE SCHEMA results;

-- ── 底表 ──────────────────────────────────────────────────────────────────
CREATE TABLE cdm_raw.person (
  person_id BIGINT PRIMARY KEY,
  gender_concept_id INTEGER NOT NULL,
  year_of_birth INTEGER NOT NULL,
  national_id VARCHAR(18),     -- 直接标识
  patient_name VARCHAR(64)     -- 直接标识
);
CREATE TABLE cdm_raw.observation_period (
  observation_period_id BIGINT PRIMARY KEY,
  person_id BIGINT NOT NULL,
  observation_period_start_date DATE NOT NULL,
  observation_period_end_date DATE NOT NULL
);
CREATE TABLE cdm_raw.drug_exposure (
  drug_exposure_id BIGINT PRIMARY KEY,
  person_id BIGINT NOT NULL,
  drug_concept_id INTEGER NOT NULL,
  drug_exposure_start_date DATE NOT NULL
);
CREATE TABLE cdm_raw.condition_occurrence (
  condition_occurrence_id BIGINT PRIMARY KEY,
  person_id BIGINT NOT NULL,
  condition_concept_id INTEGER NOT NULL,
  condition_start_date DATE NOT NULL
);
CREATE TABLE cdm_raw.concept (
  concept_id INTEGER PRIMARY KEY,
  concept_name VARCHAR(255) NOT NULL,
  domain_id VARCHAR(20),
  vocabulary_id VARCHAR(20),
  concept_class_id VARCHAR(20),
  standard_concept VARCHAR(1)
);
CREATE TABLE cdm_raw.vocabulary (
  vocabulary_id VARCHAR(20) PRIMARY KEY,
  vocabulary_name VARCHAR(255),
  vocabulary_version VARCHAR(255)
);
CREATE TABLE cdm_raw.cdm_source (
  cdm_source_name VARCHAR(255),
  cdm_version VARCHAR(10),
  vocabulary_version VARCHAR(20),
  source_release_date DATE,
  cdm_release_date DATE
);

INSERT INTO cdm_raw.vocabulary VALUES ('None','OMOP Standardized Vocabularies','v5.0 31-AUG-24');
INSERT INTO cdm_raw.cdm_source VALUES ('测试医院 CDM','5.4','v5.0 31-AUG-24','2024-12-31','2025-01-15');

-- ── 正确的视图层 ──────────────────────────────────────────────────────────
CREATE VIEW cdm.person AS SELECT person_id, gender_concept_id, year_of_birth FROM cdm_raw.person;
CREATE VIEW cdm.observation_period AS SELECT * FROM cdm_raw.observation_period;
CREATE VIEW cdm.drug_exposure AS SELECT * FROM cdm_raw.drug_exposure;
CREATE VIEW cdm.condition_occurrence AS SELECT * FROM cdm_raw.condition_occurrence;
CREATE VIEW cdm.concept AS SELECT * FROM cdm_raw.concept;
CREATE VIEW cdm.vocabulary AS SELECT * FROM cdm_raw.vocabulary;
CREATE VIEW cdm.cdm_source AS SELECT * FROM cdm_raw.cdm_source;

-- ── 负例：视图漏了直接标识 ────────────────────────────────────────────────
CREATE VIEW cdm_leaky.person AS SELECT person_id, gender_concept_id, year_of_birth, national_id FROM cdm_raw.person;
CREATE VIEW cdm_leaky.observation_period AS SELECT * FROM cdm_raw.observation_period;
CREATE VIEW cdm_leaky.drug_exposure AS SELECT * FROM cdm_raw.drug_exposure;
CREATE VIEW cdm_leaky.condition_occurrence AS SELECT * FROM cdm_raw.condition_occurrence;
CREATE VIEW cdm_leaky.concept AS SELECT * FROM cdm_raw.concept;
CREATE VIEW cdm_leaky.vocabulary AS SELECT * FROM cdm_raw.vocabulary;
CREATE VIEW cdm_leaky.cdm_source AS SELECT * FROM cdm_raw.cdm_source;

-- ── 负例：缺 drug_exposure ────────────────────────────────────────────────
CREATE VIEW cdm_missing.person AS SELECT person_id, gender_concept_id, year_of_birth FROM cdm_raw.person;
CREATE VIEW cdm_missing.observation_period AS SELECT * FROM cdm_raw.observation_period;
CREATE VIEW cdm_missing.condition_occurrence AS SELECT * FROM cdm_raw.condition_occurrence;
CREATE VIEW cdm_missing.concept AS SELECT * FROM cdm_raw.concept;
CREATE VIEW cdm_missing.vocabulary AS SELECT * FROM cdm_raw.vocabulary;
CREATE VIEW cdm_missing.cdm_source AS SELECT * FROM cdm_raw.cdm_source;

-- ── 负例：元数据不可读（cdm_source 视图存在但不授权）──────────────────────
CREATE VIEW cdm_nometa.person AS SELECT person_id, gender_concept_id, year_of_birth FROM cdm_raw.person;
CREATE VIEW cdm_nometa.observation_period AS SELECT * FROM cdm_raw.observation_period;
CREATE VIEW cdm_nometa.drug_exposure AS SELECT * FROM cdm_raw.drug_exposure;
CREATE VIEW cdm_nometa.condition_occurrence AS SELECT * FROM cdm_raw.condition_occurrence;
CREATE VIEW cdm_nometa.concept AS SELECT * FROM cdm_raw.concept;
CREATE VIEW cdm_nometa.vocabulary AS SELECT * FROM cdm_raw.vocabulary;
CREATE VIEW cdm_nometa.cdm_source AS SELECT * FROM cdm_raw.cdm_source;

-- ── 负例：规范内的列也可能是直接标识——person_source_value 按 ETL 惯例就是院内病案号 ──
CREATE VIEW cdm_mrn.person AS
  SELECT person_id, gender_concept_id, year_of_birth, national_id AS person_source_value FROM cdm_raw.person;
CREATE VIEW cdm_mrn.observation_period AS SELECT * FROM cdm_raw.observation_period;
CREATE VIEW cdm_mrn.drug_exposure AS SELECT * FROM cdm_raw.drug_exposure;
CREATE VIEW cdm_mrn.condition_occurrence AS SELECT * FROM cdm_raw.condition_occurrence;
CREATE VIEW cdm_mrn.concept AS SELECT * FROM cdm_raw.concept;
CREATE VIEW cdm_mrn.vocabulary AS SELECT * FROM cdm_raw.vocabulary;
CREATE VIEW cdm_mrn.cdm_source AS SELECT * FROM cdm_raw.cdm_source;

REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- ── 正确的双权限域：CDM 视图只读 + results 可建表 ─────────────────────────
CREATE ROLE connector_ok LOGIN PASSWORD 'ok-pw';
GRANT USAGE ON SCHEMA cdm TO connector_ok;
GRANT SELECT ON ALL TABLES IN SCHEMA cdm TO connector_ok;
GRANT USAGE, CREATE ON SCHEMA results TO connector_ok;

-- 纯只读：看得到 results 但不能建表
CREATE ROLE connector_readonly LOGIN PASSWORD 'ro-pw';
GRANT USAGE ON SCHEMA cdm TO connector_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA cdm TO connector_readonly;
GRANT USAGE ON SCHEMA results TO connector_readonly;

-- 越权：额外能读底表
CREATE ROLE connector_overpriv LOGIN PASSWORD 'op-pw';
GRANT USAGE ON SCHEMA cdm, cdm_raw TO connector_overpriv;
GRANT SELECT ON ALL TABLES IN SCHEMA cdm TO connector_overpriv;
GRANT SELECT ON ALL TABLES IN SCHEMA cdm_raw TO connector_overpriv;
GRANT USAGE, CREATE ON SCHEMA results TO connector_overpriv;

CREATE ROLE connector_leaky LOGIN PASSWORD 'lk-pw';
GRANT USAGE ON SCHEMA cdm_leaky TO connector_leaky;
GRANT SELECT ON ALL TABLES IN SCHEMA cdm_leaky TO connector_leaky;
GRANT USAGE, CREATE ON SCHEMA results TO connector_leaky;

CREATE ROLE connector_missing LOGIN PASSWORD 'ms-pw';
GRANT USAGE ON SCHEMA cdm_missing TO connector_missing;
GRANT SELECT ON ALL TABLES IN SCHEMA cdm_missing TO connector_missing;
GRANT USAGE, CREATE ON SCHEMA results TO connector_missing;

CREATE ROLE connector_nometa LOGIN PASSWORD 'nm-pw';
GRANT USAGE ON SCHEMA cdm_nometa TO connector_nometa;
GRANT SELECT ON cdm_nometa.person, cdm_nometa.observation_period, cdm_nometa.drug_exposure,
             cdm_nometa.condition_occurrence, cdm_nometa.concept, cdm_nometa.vocabulary TO connector_nometa;
-- 刻意不授权 cdm_nometa.cdm_source
GRANT USAGE, CREATE ON SCHEMA results TO connector_nometa;

CREATE ROLE connector_mrn LOGIN PASSWORD 'mrn-pw';
GRANT USAGE ON SCHEMA cdm_mrn TO connector_mrn;
GRANT SELECT ON ALL TABLES IN SCHEMA cdm_mrn TO connector_mrn;
GRANT USAGE, CREATE ON SCHEMA results TO connector_mrn;
