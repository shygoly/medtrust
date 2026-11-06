/**
 * 任务提交被拒时的「说人话」映射。
 *
 * 后端拒绝语已经写清楚了**为什么**，但用户在表单上看到的是一行等宽小字，
 * 既不像错误、也没有下一步。这里只做两件事：归类原因、给一个能直接点的下一步。
 * 不认识的错误原样展示——不猜、不吞。
 */
export interface SubmitErrorHint {
  title: string;
  detail: string;
  action?: { label: string; href: string };
}

/** 后端可能抛 Error、字符串，或 Nest 的校验数组。 */
export function normaliseError(raw: unknown): string {
  if (raw == null) return "";
  if (Array.isArray(raw)) return raw.map((x) => String(x)).join("；");
  if (raw instanceof Error) return raw.message;
  return String(raw);
}

export function explainSubmitError(raw: unknown): SubmitErrorHint | null {
  const text = normaliseError(raw).trim();
  if (!text) return null;

  if (/无合规预审快照/.test(text)) {
    return {
      title: "这份合约不能用于新任务",
      detail: "它是在合规预审闸门上线前签发的，没有裁决快照。请重新申请一份带预审的合约。",
      action: { label: "去数字合约申请", href: "/space/contracts" },
    };
  }
  if (/预审组合.*缺失|预审复评失败/.test(text)) {
    return {
      title: "合约引用的合规预审已不可用",
      detail: "预审组合缺失或复评失败（组合/规则被删除）。请重新做一次合规预审并申请合约。",
      action: { label: "去合规预审", href: "/space/atlas/pre-review" },
    };
  }
  if (/预审未覆盖分析类型/.test(text)) {
    return {
      title: "超出这份合约的预审范围",
      detail: "本次分析类型没有被合约的预审覆盖。回到合规预审，把对应的能力对象选进组合后重新申请。",
      action: { label: "去合规预审补充能力", href: "/space/atlas/pre-review" },
    };
  }
  if (/任务准入复审驳回/.test(text)) {
    return {
      title: "任务准入复审被驳回",
      detail: "按**当前**规则与本次参与机构数复评命中阻断规则（规则可能在合约签发后收紧）。",
      action: { label: "去合规预审重做组合", href: "/space/atlas/pre-review" },
    };
  }
  if (/复评为需审批.*无医院确认/.test(text)) {
    return {
      title: "这份合约需要医院确认后才能放行",
      detail: "预审裁决是「需审批」，但合约上没有医院的确认记录。请医院在合约页完成确认。",
      action: { label: "去数字合约查看", href: "/space/contracts" },
    };
  }
  if (/尚未确认规则知悉|consumerAcknowledged/.test(text)) {
    return {
      title: "使用方尚未确认规则知悉",
      detail: "先由使用方在合约上确认规则知悉，医院才能签发、任务才能提交。",
      action: { label: "去数字合约确认", href: "/space/contracts" },
    };
  }
  if (/请选择生效数字合约|没有生效合约|合约.*不生效|仅生效中的合约/.test(text)) {
    return {
      title: "没有可用的生效合约",
      detail: "任务必须引用一份已生效的数字合约；先申请并由医院签发。",
      action: { label: "去数字合约", href: "/space/contracts" },
    };
  }

  return { title: "提交被拒绝", detail: text };
}
