// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/** 电力空间标识。目录产品的 homeSpace 固定为此值，不写入医疗空间。 */
export const POWER_SPACE_ID = "hn-power";

export const POWER_SPACE_NAME = "河南电力可信数据空间";

export interface PowerParticipant {
  readonly participantId: string;
  readonly org: string;
  readonly role: "provider" | "consumer";
}

export interface PowerField {
  readonly name: string;
  readonly type: string;
  readonly description: string;
}

export interface PowerProductSeed {
  readonly id: string;
  readonly providerId: string;
  readonly title: string;
  readonly classification: string;
  readonly scenarioId: string;
  readonly fields: readonly PowerField[];
}

export interface PowerApplication {
  readonly name: string;
  readonly fusion: string;
  readonly value: string;
}

export interface PowerScenario {
  readonly id: string;
  readonly title: string;
  readonly purpose: string;
  readonly applications: readonly PowerApplication[];
  readonly products: readonly PowerProductSeed[];
}

export const POWER_PARTICIPANTS: readonly PowerParticipant[] = [
  { participantId: "p-grid-hn", org: "省级电网公司", role: "provider" },
  { participantId: "p-weather-hn", org: "气象部门", role: "provider" },
  { participantId: "p-civic-hn", org: "市政排水与城管", role: "provider" },
  { participantId: "p-gov-hn", org: "政务数据主管部门", role: "provider" },
  { participantId: "p-res-hn", org: "新能源场站运营商", role: "provider" },
  { participantId: "p-market-hn", org: "电力交易中心", role: "provider" },
  { participantId: "p-ev-oem-hn", org: "车辆制造商", role: "provider" },
  { participantId: "p-ev-agg-hn", org: "车网聚合商", role: "provider" },
  { participantId: "p-charge-hn", org: "充电运营商", role: "provider" },
];

/** 可登录的协作单位。一个机构一个账号，只加入自己参加的协作。 */
export interface PowerDemoUser {
  readonly email: string;
  readonly name: string;
  readonly participantId: string;
  readonly role: "provider" | "consumer";
  readonly scenarioIds: readonly string[];
}

export const POWER_DEMO_USERS: readonly PowerDemoUser[] = [
  {
    email: "grid@hn-power.example",
    name: "省级电网公司",
    participantId: "p-grid-hn",
    role: "provider",
    scenarioIds: ["urban-anomaly", "renewable-absorption", "v2g-coordination"],
  },
  {
    email: "weather@hn-power.example",
    name: "气象部门",
    participantId: "p-weather-hn",
    role: "provider",
    scenarioIds: ["urban-anomaly", "renewable-absorption"],
  },
  {
    email: "civic@hn-power.example",
    name: "市政排水与城管",
    participantId: "p-civic-hn",
    role: "provider",
    scenarioIds: ["urban-anomaly"],
  },
  {
    email: "gov@hn-power.example",
    name: "政务数据主管部门",
    participantId: "p-gov-hn",
    role: "provider",
    scenarioIds: ["urban-anomaly"],
  },
  {
    email: "plant@hn-power.example",
    name: "新能源场站运营商",
    participantId: "p-res-hn",
    role: "provider",
    scenarioIds: ["renewable-absorption"],
  },
  {
    email: "market@hn-power.example",
    name: "电力交易中心",
    participantId: "p-market-hn",
    role: "provider",
    scenarioIds: ["renewable-absorption"],
  },
  {
    email: "oem@hn-power.example",
    name: "车辆制造商",
    participantId: "p-ev-oem-hn",
    role: "provider",
    scenarioIds: ["v2g-coordination"],
  },
  {
    email: "agg@hn-power.example",
    name: "车网聚合商",
    participantId: "p-ev-agg-hn",
    role: "provider",
    scenarioIds: ["v2g-coordination"],
  },
  {
    email: "charge@hn-power.example",
    name: "充电运营商",
    participantId: "p-charge-hn",
    role: "provider",
    scenarioIds: ["v2g-coordination"],
  },
];

const interval = (name: string, description: string): PowerField => ({
  name,
  type: "number",
  description,
});

export const POWER_SCENARIOS: readonly PowerScenario[] = [
  {
    id: "urban-anomaly",
    title: "城市用电异常监测",
    purpose:
      "把输配电设备状态、智能电表负荷与气象、排水、消防、户籍社保等政务数据在各自连接器内融合，提前发现内涝、电气火灾和独居老人用电异常，只出聚合预警。",
    applications: [
      {
        name: "洪涝内涝预警",
        fusion: "设备位置与状态、气象预报、实时降雨、市政排水能力、河道水位、路面积水",
        value: "预测内涝点与电网风险，部署应急资源，避免漏电。",
      },
      {
        name: "火灾隐患预警",
        fusion: "用电负荷异常、历史火灾、建筑类型、消防通道占用、湿度与风力",
        value: "标出老旧小区和充电点等高风险位置，供排查而不是导出户表。",
      },
      {
        name: "独居老人异常关怀",
        fusion: "用电模式基线、户籍与社保中的独居标记",
        value: "生成预警事件推送社区网格员，原始用电曲线不出域。",
      },
    ],
    products: [
      {
        id: "dp-pwr-grid-asset",
        providerId: "p-grid-hn",
        title: "输配电设备位置与运行状态",
        classification: "二级 · 重要数据",
        scenarioId: "urban-anomaly",
        fields: [
          { name: "assetId", type: "string", description: "设备标识" },
          { name: "geoCode", type: "string", description: "地理编码（楼/单元粒度）" },
          { name: "kind", type: "string", description: "变压器 / 线路监测装置" },
          interval("status", "运行状态"),
        ],
      },
      {
        id: "dp-pwr-ami-load",
        providerId: "p-grid-hn",
        title: "楼栋级负荷异常标记",
        classification: "三级 · 敏感数据",
        scenarioId: "urban-anomaly",
        fields: [
          { name: "buildingId", type: "string", description: "楼栋标识" },
          { name: "geoCode", type: "string", description: "地理编码（楼/单元粒度）" },
          { name: "anomalyFlag", type: "boolean", description: "楼栋级负荷异常标记" },
          {
            name: "baselineBand",
            type: "string",
            description: "楼栋聚合用电基线档，不含户表曲线",
          },
        ],
      },
      {
        id: "dp-pwr-flood-weather",
        providerId: "p-weather-hn",
        title: "降雨、积水与市政排水能力",
        classification: "一级 · 一般数据",
        scenarioId: "urban-anomaly",
        fields: [
          interval("rainMm", "实时降雨"),
          interval("riverLevel", "河道水位"),
          { name: "pondingPoint", type: "string", description: "路面积水点" },
          interval("drainCapacity", "市政排水能力"),
        ],
      },
      {
        id: "dp-pwr-fire-civic",
        providerId: "p-civic-hn",
        title: "建筑类型、历史火灾与消防通道",
        classification: "二级 · 重要数据",
        scenarioId: "urban-anomaly",
        fields: [
          { name: "buildingId", type: "string", description: "建筑标识" },
          { name: "buildingType", type: "string", description: "建筑类型" },
          interval("fireHistory", "历史火灾标记"),
          { name: "accessBlocked", type: "boolean", description: "消防通道占用" },
          interval("humidity", "湿度"),
          interval("wind", "风力"),
        ],
      },
      {
        id: "dp-pwr-elder-care",
        providerId: "p-gov-hn",
        title: "独居老人户籍与社保标记",
        classification: "三级 · 敏感数据",
        scenarioId: "urban-anomaly",
        fields: [
          { name: "subjectKey", type: "string", description: "政务侧假名" },
          { name: "geoCode", type: "string", description: "居住地理编码" },
          { name: "livingAlone", type: "boolean", description: "独居标记（最小必要）" },
        ],
      },
    ],
  },
  {
    id: "renewable-absorption",
    title: "新能源消纳预测",
    purpose:
      "在场站、电网、交易中心和气象各自不出域的前提下，融合发电预测、断面限额、负荷预测和电价，支撑报量报价，并预警弃风弃光。",
    applications: [
      {
        name: "市场化交易报量报价",
        fusion: "场站发电预测、断面限额、系统负荷预测、日前/实时电价、中长期合约、风光资源预报",
        value: "提示「电价高但发电受限」或「发电强但电价低」的时段，划分日前、实时与辅助服务电量。",
      },
      {
        name: "弃风弃光风险预警",
        fusion: "短期与超短期发电预测、断面负载率、区域净负荷、AGC 指令、检修计划、区域气象",
        value: "提前数小时至一天预警强制弃电，供生产安排和偏差处理。",
      },
      {
        name: "辅助服务市场决策",
        fusion: "功率调节能力、调频/备用需求、历史出清价格与容量",
        value: "比较能量市场与辅助服务的预期收益。",
      },
    ],
    products: [
      {
        id: "dp-pwr-res-forecast",
        providerId: "p-res-hn",
        title: "新能源场站发电功率预测",
        classification: "二级 · 重要数据",
        scenarioId: "renewable-absorption",
        fields: [
          { name: "plantId", type: "string", description: "场站标识" },
          interval("forecastMw", "短期 / 超短期功率预测"),
          interval("flexibleMw", "可调节功率（含储能）"),
        ],
      },
      {
        id: "dp-pwr-grid-constraint",
        providerId: "p-grid-hn",
        title: "断面限额、负荷预测与检修",
        classification: "二级 · 重要数据",
        scenarioId: "renewable-absorption",
        fields: [
          { name: "sectionId", type: "string", description: "断面标识" },
          interval("limitMw", "断面限额"),
          interval("loadForecastMw", "系统负荷预测"),
          interval("sectionLoad", "实时断面负载率"),
          { name: "outagePlan", type: "string", description: "检修计划" },
        ],
      },
      {
        id: "dp-pwr-market-price",
        providerId: "p-market-hn",
        title: "日前实时电价与辅助服务需求",
        classification: "二级 · 重要数据",
        scenarioId: "renewable-absorption",
        fields: [
          interval("dayAheadPrice", "日前电价预测"),
          interval("realtimePrice", "实时电价预测"),
          interval("contractMwh", "中长期合约电量"),
          interval("reservePrice", "调频 / 备用历史出清价格"),
          interval("reserveNeedMw", "调频 / 备用容量需求"),
        ],
      },
      {
        id: "dp-pwr-weather-resource",
        providerId: "p-weather-hn",
        title: "区域风光资源预报",
        classification: "一级 · 一般数据",
        scenarioId: "renewable-absorption",
        fields: [
          interval("windResource", "风速资源"),
          interval("solarResource", "辐照资源"),
          { name: "regionId", type: "string", description: "预报区域" },
        ],
      },
    ],
  },
  {
    id: "v2g-coordination",
    title: "车网供需协同",
    purpose:
      "电网、车主、车企、聚合商和充电运营商各自保留原始数据。车主只发布可验证的充放电能力凭证；聚合商提交容量证明和实际响应，用于调峰与有序充电。",
    applications: [
      {
        name: "面向调峰的聚合充放电",
        fusion: "调峰指令与电价、经授权的充放电能力凭证、聚合容量证明、中标容量与实际放电量",
        value: "电网得到可计量的灵活性；车主不交出行程和电池明细；聚合商按贡献结算。",
      },
      {
        name: "有序智能充电",
        fusion: "区域负荷预测、分时电价、容量预警、预期离场时间、目标 SOC、充电桩可用容量",
        value: "平滑充电负荷，车主使用谷电，场站提高利用率。",
      },
    ],
    products: [
      {
        id: "dp-pwr-grid-flex",
        providerId: "p-grid-hn",
        title: "调峰指令、分区负荷与分时电价",
        classification: "二级 · 重要数据",
        scenarioId: "v2g-coordination",
        fields: [
          interval("flexNeedMw", "调频 / 调峰需求"),
          interval("priceSignal", "电价信号"),
          interval("areaLoadForecast", "区域负荷预测"),
          interval("capacityWarn", "配网容量预警"),
        ],
      },
      {
        id: "dp-pwr-ev-credential",
        providerId: "p-ev-oem-hn",
        title: "经车主授权的充放电能力凭证",
        classification: "二级 · 重要数据",
        scenarioId: "v2g-coordination",
        fields: [
          { name: "credentialId", type: "string", description: "能力凭证标识（不含行程）" },
          interval("dischargeKw", "可验证放电功率"),
          interval("chargeKw", "可验证充电功率"),
          { name: "window", type: "string", description: "授权时段" },
        ],
      },
      {
        id: "dp-pwr-agg-capacity",
        providerId: "p-ev-agg-hn",
        title: "聚合容量证明与实际响应",
        classification: "二级 · 重要数据",
        scenarioId: "v2g-coordination",
        fields: [
          interval("provenKw", "聚合后可信容量"),
          interval("awardedKw", "中标容量"),
          interval("deliveredKwh", "实际放电量"),
        ],
      },
      {
        id: "dp-pwr-charger-state",
        providerId: "p-charge-hn",
        title: "充电桩状态与用户授权的离场目标",
        classification: "二级 · 重要数据",
        scenarioId: "v2g-coordination",
        fields: [
          { name: "chargerId", type: "string", description: "充电桩标识" },
          interval("availableKw", "可用容量"),
          { name: "departAt", type: "string", description: "预期离场时间（用户授权）" },
          interval("targetSoc", "目标 SOC（用户设定）"),
        ],
      },
    ],
  },
];

export function powerCatalogProducts(): readonly PowerProductSeed[] {
  return POWER_SCENARIOS.flatMap((s) => s.products);
}
