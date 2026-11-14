module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js', 'dist'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    // Windows 下 core.autocrlf=true 时工作区多为 CRLF；默认 prettier endOfLine=lf
    // 会在无 --fix 时炸出上万条 Delete ␍。auto 按文件现有行尾校验，避免
    // pre-commit 为过闸去 --fix 整树、提交后留下未暂存噪声。
    'prettier/prettier': ['error', { endOfLine: 'auto' }],
  },
};
