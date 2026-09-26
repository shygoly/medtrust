# Synthea 糖尿病模块用药登记（D-DATA-1 / Task 1.2）

> 来源：本仓 `data/synthea/` 实测 CSV + Keep Module 生成自检。  
> Synthea **不**开磺脲 / DPP-4（如 sitagliptin）；注入层暴露臂应对齐下列真实开药。

## 疾病

| 角色 | 系统 | 码 | 显示名 |
|---|---|---|---|
| 队列纳入（T2DM） | SNOMED-CT | `44054006` | Diabetes mellitus type 2 (disorder) |
| 常见前驱 | SNOMED-CT | `714628002` | Prediabetes (finding) |

## 降糖药（暴露 / 对照臂）

| 臂 | 角色 | 通用名 | RxNorm | Synthea 描述（摘录） |
|---|---|---|---|---|
| **对照** | 一线口服 | metformin | `860975` | 24 HR Metformin hydrochloride 500 MG Extended Release Oral Tablet |
| **暴露** | 升级 / 注射 | insulin (NPH/regular mix) | `106892` | insulin isophane human 70 UNT/ML / insulin regular human 30 UNT/ML Injectable Suspension [Humulin] |
| （同暴露族） | 短效人胰岛素 | insulin regular | `311034` | insulin regular human 100 UNT/ML Injectable Solution |
| （偶见） | GLP-1 | liraglutide | `897122` | 3 ML liraglutide 6 MG/ML Pen Injector |

注入层默认（`DEFAULT_INJECTION`）对齐：

- `comparatorDrug` = `metformin`（对照）
- `exposureDrug` = `insulin`（暴露；匹配 Synthea 升级路径）

> 实测 Keep Module 队列中偶见 liraglutide；注入层主臂仍用 insulin / metformin（覆盖最广）。
生成脚本每次跑完会在输出目录写 `diabetes-formulary.json`（含本跑实测 dispense 计数）。

## 生成方式（勿用 `-m`）

```bash
# 小样本验证（默认 50 人）
scripts/generate-synthea-diabetes.sh 50 42

# 自定义规模 / 输出目录
scripts/generate-synthea-diabetes.sh 200 42 data/synthea/diabetes-cohort
```

Keep Module：`data/synthea/modules/keep_diabetes_t2.json`（Active Condition = 44054006）。
