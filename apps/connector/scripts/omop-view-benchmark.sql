-- omop-data-source-access 8.4 —— 视图层（含行级过滤）对索引使用的影响：合成千万行级数据。
--
-- **合成数据**：100 万人、1000 万条用药、1000 万条诊断，概念 id 均匀分布，日期 2015–2024。
-- 它能回答「视图 / 行级过滤会不会让规划器放弃索引」（规划器行为，不依赖真实分布）；
-- 回答不了「在某家医院的真实分布与硬件上多快」——那仍须在目标院真实数据上测。
\set ON_ERROR_STOP on
SET maintenance_work_mem = '512MB';

CREATE SCHEMA omop;
CREATE TABLE omop.person (
  person_id integer PRIMARY KEY,
  gender_concept_id integer NOT NULL,
  year_of_birth integer NOT NULL,
  person_source_value varchar(50)
);
CREATE TABLE omop.drug_exposure (
  drug_exposure_id bigint PRIMARY KEY,
  person_id integer NOT NULL,
  drug_concept_id integer NOT NULL,
  drug_exposure_start_date date NOT NULL,
  drug_exposure_end_date date NOT NULL
);
CREATE TABLE omop.condition_occurrence (
  condition_occurrence_id bigint PRIMARY KEY,
  person_id integer NOT NULL,
  condition_concept_id integer NOT NULL,
  condition_start_date date NOT NULL
);
CREATE TABLE omop.research_opt_out (person_id integer PRIMARY KEY);

INSERT INTO omop.person
SELECT g, CASE WHEN g % 2 = 0 THEN 8507 ELSE 8532 END, 1930 + g % 80, 'MRN' || g
FROM generate_series(1, 1000000) g;

INSERT INTO omop.drug_exposure
SELECT g, 1 + (hashint4(g::int) & 2147483647) % 1000000, 1 + (hashint4(g::int + 7) & 2147483647) % 2000,
       DATE '2015-01-01' + (hashint4(g::int + 13) & 2147483647) % 3600,
       DATE '2015-01-01' + (hashint4(g::int + 13) & 2147483647) % 3600 + 30
FROM generate_series(1, 10000000) g;

INSERT INTO omop.condition_occurrence
SELECT g, 1 + (hashint4(g::int + 101) & 2147483647) % 1000000, 1 + (hashint4(g::int + 107) & 2147483647) % 5000,
       DATE '2015-01-01' + (hashint4(g::int + 113) & 2147483647) % 3650
FROM generate_series(1, 10000000) g;

-- 1% 的人退出研究（行级过滤的对象）。
INSERT INTO omop.research_opt_out SELECT g FROM generate_series(1, 1000000, 100) g;

-- OHDSI CDM v5.4 PostgreSQL 标准索引（节选）。
CREATE INDEX idx_drug_person_id ON omop.drug_exposure (person_id);
CREATE INDEX idx_drug_concept_id ON omop.drug_exposure (drug_concept_id);
CREATE INDEX idx_condition_person_id ON omop.condition_occurrence (person_id);
CREATE INDEX idx_condition_concept_id ON omop.condition_occurrence (condition_concept_id);
ANALYZE;

-- 视图层 A：只裁列（去 person_source_value），不过滤行。
CREATE SCHEMA v_plain;
CREATE VIEW v_plain.person AS SELECT person_id, gender_concept_id, year_of_birth FROM omop.person;
CREATE VIEW v_plain.drug_exposure AS SELECT * FROM omop.drug_exposure;
CREATE VIEW v_plain.condition_occurrence AS SELECT * FROM omop.condition_occurrence;

-- 视图层 B：裁列 + 行级过滤（手册推荐写法：每张含 person_id 的视图带同一 NOT EXISTS 条件）。
CREATE SCHEMA v_filtered;
CREATE VIEW v_filtered.person AS
  SELECT p.person_id, p.gender_concept_id, p.year_of_birth FROM omop.person p
  WHERE NOT EXISTS (SELECT 1 FROM omop.research_opt_out o WHERE o.person_id = p.person_id);
CREATE VIEW v_filtered.drug_exposure AS
  SELECT d.* FROM omop.drug_exposure d
  WHERE NOT EXISTS (SELECT 1 FROM omop.research_opt_out o WHERE o.person_id = d.person_id);
CREATE VIEW v_filtered.condition_occurrence AS
  SELECT c.* FROM omop.condition_occurrence c
  WHERE NOT EXISTS (SELECT 1 FROM omop.research_opt_out o WHERE o.person_id = c.person_id);
