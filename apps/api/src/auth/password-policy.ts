// P0-5 密码策略:至少 8 位,且大写/小写/数字/特殊字符中至少三类。
export const PASSWORD_POLICY_REGEX =
  /^(?:(?=.*[a-z])(?=.*[A-Z])(?=.*\d)|(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9])|(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])|(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]))/;

export const PASSWORD_POLICY_MESSAGE =
  "密码需至少包含大写字母、小写字母、数字、特殊字符中的三类";
