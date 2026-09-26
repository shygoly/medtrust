-- omop-data-source-access 8.3 —— 接入手册演练用的「医院既有 CDM 库」（ETL 产物的替身）。
--
-- 七张必需表按 OHDSI CDM v5.4 PostgreSQL DDL 的完整列建在 omop schema；person 另加两列
-- 医院自有的直接标识（身份证号、姓名）——接入手册的视图层必须把它们挡在外面。
-- 数据是合成的：60 人，观察期 2019-2024，两种药、三种诊断。
CREATE SCHEMA omop;

CREATE TABLE omop.person (
  person_id integer NOT NULL PRIMARY KEY,
  gender_concept_id integer NOT NULL,
  year_of_birth integer NOT NULL,
  month_of_birth integer NULL,
  day_of_birth integer NULL,
  birth_datetime timestamp NULL,
  race_concept_id integer NOT NULL,
  ethnicity_concept_id integer NOT NULL,
  location_id integer NULL,
  provider_id integer NULL,
  care_site_id integer NULL,
  person_source_value varchar(50) NULL,
  gender_source_value varchar(50) NULL,
  gender_source_concept_id integer NULL,
  race_source_value varchar(50) NULL,
  race_source_concept_id integer NULL,
  ethnicity_source_value varchar(50) NULL,
  ethnicity_source_concept_id integer NULL,
  id_card_no varchar(18) NULL,   -- 医院自加：身份证号
  patient_name varchar(64) NULL  -- 医院自加：姓名
);

CREATE TABLE omop.observation_period (
  observation_period_id integer NOT NULL PRIMARY KEY,
  person_id integer NOT NULL,
  observation_period_start_date date NOT NULL,
  observation_period_end_date date NOT NULL,
  period_type_concept_id integer NOT NULL
);

CREATE TABLE omop.drug_exposure (
  drug_exposure_id integer NOT NULL PRIMARY KEY,
  person_id integer NOT NULL,
  drug_concept_id integer NOT NULL,
  drug_exposure_start_date date NOT NULL,
  drug_exposure_start_datetime timestamp NULL,
  drug_exposure_end_date date NOT NULL,
  drug_exposure_end_datetime timestamp NULL,
  verbatim_end_date date NULL,
  drug_type_concept_id integer NOT NULL,
  stop_reason varchar(20) NULL,
  refills integer NULL,
  quantity numeric NULL,
  days_supply integer NULL,
  sig text NULL,
  route_concept_id integer NULL,
  lot_number varchar(50) NULL,
  provider_id integer NULL,
  visit_occurrence_id integer NULL,
  visit_detail_id integer NULL,
  drug_source_value varchar(50) NULL,
  drug_source_concept_id integer NULL,
  route_source_value varchar(50) NULL,
  dose_unit_source_value varchar(50) NULL
);

CREATE TABLE omop.condition_occurrence (
  condition_occurrence_id integer NOT NULL PRIMARY KEY,
  person_id integer NOT NULL,
  condition_concept_id integer NOT NULL,
  condition_start_date date NOT NULL,
  condition_start_datetime timestamp NULL,
  condition_end_date date NULL,
  condition_end_datetime timestamp NULL,
  condition_type_concept_id integer NOT NULL,
  condition_status_concept_id integer NULL,
  stop_reason varchar(20) NULL,
  provider_id integer NULL,
  visit_occurrence_id integer NULL,
  visit_detail_id integer NULL,
  condition_source_value varchar(50) NULL,
  condition_source_concept_id integer NULL,
  condition_status_source_value varchar(50) NULL
);

CREATE TABLE omop.concept (
  concept_id integer NOT NULL PRIMARY KEY,
  concept_name varchar(255) NOT NULL,
  domain_id varchar(20) NOT NULL,
  vocabulary_id varchar(20) NOT NULL,
  concept_class_id varchar(20) NOT NULL,
  standard_concept varchar(1) NULL,
  concept_code varchar(50) NOT NULL,
  valid_start_date date NOT NULL,
  valid_end_date date NOT NULL,
  invalid_reason varchar(1) NULL
);

CREATE TABLE omop.vocabulary (
  vocabulary_id varchar(20) NOT NULL PRIMARY KEY,
  vocabulary_name varchar(255) NOT NULL,
  vocabulary_reference varchar(255) NULL,
  vocabulary_version varchar(255) NULL,
  vocabulary_concept_id integer NOT NULL
);

CREATE TABLE omop.cdm_source (
  cdm_source_name varchar(255) NOT NULL,
  cdm_source_abbreviation varchar(25) NOT NULL,
  cdm_holder varchar(255) NOT NULL,
  source_description text NULL,
  source_documentation_reference varchar(255) NULL,
  cdm_etl_reference varchar(255) NULL,
  source_release_date date NOT NULL,
  cdm_release_date date NOT NULL,
  cdm_version varchar(10) NULL,
  cdm_version_concept_id integer NOT NULL,
  vocabulary_version varchar(20) NOT NULL
);

-- ── 合成数据 ────────────────────────────────────────────────────────────────
INSERT INTO omop.vocabulary VALUES
  ('None', 'OMOP Standardized Vocabularies', 'OMOP generated', 'v5.0 31-AUG-24', 44819096);
INSERT INTO omop.cdm_source VALUES
  ('演练医院 CDM', 'DRILL', '演练医院', NULL, NULL, NULL,
   DATE '2024-12-31', DATE '2025-01-15', '5.4', 756265, 'v5.0 31-AUG-24');

INSERT INTO omop.concept VALUES
  (1308216, 'lisinopril',            'Drug',      'RxNorm', 'Ingredient', 'S', '29046',    DATE '1970-01-01', DATE '2099-12-31', NULL),
  (1545958, 'atorvastatin',          'Drug',      'RxNorm', 'Ingredient', 'S', '83367',    DATE '1970-01-01', DATE '2099-12-31', NULL),
  (201826,  'Type 2 diabetes mellitus', 'Condition', 'SNOMED', 'Clinical Finding', 'S', '44054006', DATE '1970-01-01', DATE '2099-12-31', NULL),
  (4112343, 'Angioedema',            'Condition', 'SNOMED', 'Clinical Finding', 'S', '41291007', DATE '1970-01-01', DATE '2099-12-31', NULL),
  (254761,  'Cough',                 'Condition', 'SNOMED', 'Clinical Finding', 'S', '49727002', DATE '1970-01-01', DATE '2099-12-31', NULL);

INSERT INTO omop.person
SELECT g, CASE WHEN g % 2 = 0 THEN 8507 ELSE 8532 END, 1940 + g % 50, 1 + g % 12, 1 + g % 28,
       NULL, 0, 0, NULL, NULL, NULL,
       'MRN' || lpad(g::text, 8, '0'), NULL, NULL, NULL, NULL, NULL, NULL,
       '11010119' || lpad((g * 7919 % 100000000)::text, 10, '0'), '演练患者' || g
FROM generate_series(1, 60) g;

INSERT INTO omop.observation_period
SELECT g, g, DATE '2019-01-01' + (g % 180), DATE '2024-06-30' - (g % 60), 32817
FROM generate_series(1, 60) g;

-- 前 24 人用 lisinopril，其余一半用 atorvastatin。
INSERT INTO omop.drug_exposure (drug_exposure_id, person_id, drug_concept_id,
       drug_exposure_start_date, drug_exposure_end_date, drug_type_concept_id, sig)
SELECT g, g, CASE WHEN g <= 24 THEN 1308216 ELSE 1545958 END,
       DATE '2021-03-01' + g, DATE '2021-06-01' + g, 32838, '每日一次，每次一片'
FROM generate_series(1, 60) g
WHERE g <= 24 OR g % 2 = 0;

-- 诊断：所有人 T2DM；lisinopril 组多见血管性水肿 / 咳嗽。
INSERT INTO omop.condition_occurrence (condition_occurrence_id, person_id, condition_concept_id,
       condition_start_date, condition_type_concept_id)
SELECT g, g, 201826, DATE '2020-01-01' + g, 32817 FROM generate_series(1, 60) g;
INSERT INTO omop.condition_occurrence (condition_occurrence_id, person_id, condition_concept_id,
       condition_start_date, condition_type_concept_id)
SELECT 100 + g, g, CASE WHEN g % 3 = 0 THEN 4112343 ELSE 254761 END, DATE '2021-04-01' + g, 32817
FROM generate_series(1, 60) g
WHERE (g <= 24 AND g % 2 = 1) OR g % 11 = 0;
