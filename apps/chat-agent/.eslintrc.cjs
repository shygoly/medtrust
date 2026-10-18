/* eslint-env node */
/**
 * 与 apps/api 同代（eslint 8 + @typescript-eslint 6）的 legacy 配置。
 *
 * 刻意**不引 prettier**：本仓没有 .prettierrc，接进来等于引一套没人执行的格式规范，
 * 只会用"格式不合规"淹没真问题。这里只留能抓 bug 的规则。
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, es2022: true },
  ignorePatterns: ['dist', 'coverage', 'node_modules', 'test-results', 'playwright-report'],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    // 显式 any 是会传染的滑坡：新代码里不许新增（测试替身见下方 override）
    '@typescript-eslint/no-explicit-any': 'error',
    // 服务端往 stdout 乱打会破坏 JSON 结构化日志；日志走 JsonLogger
    'no-console': ['error', { allow: ['warn', 'error'] }],
    eqeqeq: ['error', 'smart'],
    'prefer-const': 'error',
    'no-var': 'error',
    // 与 apps/api 保持一致：返回类型交给 tsc，不靠 lint 逼注解
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
  },
  overrides: [
    {
      files: ['*.spec.ts', 'test/**/*.ts', 'src/test-utils/**/*.ts'],
      env: { jest: true },
      rules: {
        // 测试替身需要松散类型
        '@typescript-eslint/no-explicit-any': 'off',
        // 测试/演示的进度输出本来就该打到终端；no-console 是保护服务端
        // 「日志只走 JsonLogger」这条契约的，不该管测试文件。
        'no-console': 'off',
      },
    },
  ],
};
