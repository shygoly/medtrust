-- MedTrust 连接器 · OMOP CDM v5.4 院内库接入：医院侧视图层 + 双权限域账号（PostgreSQL）
-- 配套说明：docs/omop-cdm-onboarding.md。本文件由医院 DBA 执行，平台侧无需任何权限。
--
-- 用法（以库 owner 或超级用户身份，在 CDM 所在库执行）：
--
--   psql -d <库名> \
--        -v base_schema=omop \                 # 已有的 CDM 底表所在 schema（ETL 产物）
--        -v view_schema=medtrust_cdm \         # 新建：给连接器看的视图层
--        -v results_schema=medtrust_results \  # 新建：连接器可写的中间结果区
--        -v connector_role=medtrust_connector \
--        -v connector_password='<强口令，只交给连接器运维>' \
--        -f omop-cdm-onboarding.sql
--
-- 执行后连接器账号的权限**恰为两个域**：
--   ① view_schema 里的视图：只读；
--   ② results_schema：可建表、可写、可删自己建的表（队列定义要把 cohort 写在这里）。
-- 它读不到 base_schema 的任何底表，也读不到库里其它 schema。
-- **只给只读账号不满足接入契约**——连接器的接入校验会明确报「纯只读账号不满足接入契约」。
--
-- 可重复执行：schema / 视图 / 授权都是幂等的，账号已存在时只更新口令与属性。

\set ON_ERROR_STOP on

SELECT current_database() AS target_db \gset

-- ── ① 两个新 schema ──────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS :"view_schema";
CREATE SCHEMA IF NOT EXISTS :"results_schema";

-- ── ② 视图层：同名、列为 CDM v5.4 规范列的子集、去直接标识 ─────────────────────
-- 规则：
--   · 视图名与 CDM 表名相同，列名与 CDM 规范相同——连接器按规范生成 SQL，不探测表结构；
--   · 只放 CDM 规范内的列：医院在底表上自加的列（身份证号、姓名、手机号……）一律不进视图；
--   · 规范内但承载标识的列也不进视图：person_source_value（按 ETL 惯例就是病案号）、
--     精确出生日期（month_of_birth / day_of_birth / birth_datetime，只留 year_of_birth）、
--     drug_exposure.sig（自由文本医嘱）；
--   · 其余 *_source_value 列是否夹带标识，请按本院 ETL 实际情况审查后再决定是否保留；
--   · 行级过滤写在视图的 WHERE 里（见文件末尾示例），被过滤的人对连接器不可见。

CREATE OR REPLACE VIEW :"view_schema".person AS
SELECT person_id, gender_concept_id, year_of_birth,
       race_concept_id, ethnicity_concept_id, location_id, provider_id, care_site_id,
       gender_source_value, gender_source_concept_id,
       race_source_value, race_source_concept_id,
       ethnicity_source_value, ethnicity_source_concept_id
FROM :"base_schema".person;

CREATE OR REPLACE VIEW :"view_schema".observation_period AS
SELECT observation_period_id, person_id,
       observation_period_start_date, observation_period_end_date, period_type_concept_id
FROM :"base_schema".observation_period;

CREATE OR REPLACE VIEW :"view_schema".drug_exposure AS
SELECT drug_exposure_id, person_id, drug_concept_id,
       drug_exposure_start_date, drug_exposure_start_datetime,
       drug_exposure_end_date, drug_exposure_end_datetime, verbatim_end_date,
       drug_type_concept_id, stop_reason, refills, quantity, days_supply,
       route_concept_id, lot_number, provider_id, visit_occurrence_id, visit_detail_id,
       drug_source_value, drug_source_concept_id, route_source_value, dose_unit_source_value
FROM :"base_schema".drug_exposure;

CREATE OR REPLACE VIEW :"view_schema".condition_occurrence AS
SELECT condition_occurrence_id, person_id, condition_concept_id,
       condition_start_date, condition_start_datetime,
       condition_end_date, condition_end_datetime,
       condition_type_concept_id, condition_status_concept_id, stop_reason,
       provider_id, visit_occurrence_id, visit_detail_id,
       condition_source_value, condition_source_concept_id, condition_status_source_value
FROM :"base_schema".condition_occurrence;

-- 词汇表与元数据：不含患者信息，按规范列原样提供。
CREATE OR REPLACE VIEW :"view_schema".concept AS
SELECT concept_id, concept_name, domain_id, vocabulary_id, concept_class_id,
       standard_concept, concept_code, valid_start_date, valid_end_date, invalid_reason
FROM :"base_schema".concept;

CREATE OR REPLACE VIEW :"view_schema".vocabulary AS
SELECT vocabulary_id, vocabulary_name, vocabulary_reference, vocabulary_version,
       vocabulary_concept_id
FROM :"base_schema".vocabulary;

CREATE OR REPLACE VIEW :"view_schema".cdm_source AS
SELECT cdm_source_name, cdm_source_abbreviation, cdm_holder, source_description,
       source_documentation_reference, cdm_etl_reference, source_release_date,
       cdm_release_date, cdm_version, cdm_version_concept_id, vocabulary_version
FROM :"base_schema".cdm_source;

-- ── ③ 连接器账号：普通账号，不是超级用户、不能绕过行级安全、不能建角色或建库 ───────
SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = :'connector_role') AS role_exists \gset
\if :role_exists
ALTER ROLE :"connector_role" WITH LOGIN PASSWORD :'connector_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT;
\else
CREATE ROLE :"connector_role" WITH LOGIN PASSWORD :'connector_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT;
\endif

-- ── ④ 授权：恰好两个权限域 ────────────────────────────────────────────────────
GRANT CONNECT ON DATABASE :"target_db" TO :"connector_role";

-- 底表：显式不给（默认本就没有；写出来是为了重复执行时收回历史误授权）。
REVOKE ALL ON ALL TABLES IN SCHEMA :"base_schema" FROM :"connector_role";
REVOKE ALL ON SCHEMA :"base_schema" FROM :"connector_role";

-- 权限域 ①：视图只读。
GRANT USAGE ON SCHEMA :"view_schema" TO :"connector_role";
GRANT SELECT ON ALL TABLES IN SCHEMA :"view_schema" TO :"connector_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA :"view_schema" GRANT SELECT ON TABLES TO :"connector_role";

-- 权限域 ②：results 可建表可写（表的 owner 是连接器账号，因此也能删自己建的表）。
GRANT USAGE, CREATE ON SCHEMA :"results_schema" TO :"connector_role";

-- ── 可选：行级过滤示例（按本院规则改写后，替换上面对应的视图）─────────────────
-- 例：退出研究的患者、特殊保护人群对连接器不可见。每张含 person_id 的视图都要带同一条件，
-- 否则被排除者的用药 / 诊断记录仍会出现在其它视图里（连接器按 person 对齐时会丢弃它们，
-- 但它们不应被读到）。
--
--   CREATE OR REPLACE VIEW medtrust_cdm.person AS
--   SELECT ... FROM omop.person p
--   WHERE NOT EXISTS (SELECT 1 FROM omop.research_opt_out o WHERE o.person_id = p.person_id);
--
-- 医院随时可单方面切断：REVOKE SELECT ON ALL TABLES IN SCHEMA medtrust_cdm FROM medtrust_connector;
-- 连接器下一条查询即被数据库拒绝，周期复核随即判数据源不可用，无需平台任何配合。
