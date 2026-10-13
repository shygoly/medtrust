'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/api/client';
import { saveSession } from '@/lib/auth';

const DEMO_ACCOUNTS = [
  { label: '示范甲医院 · 提供方', account: 'admin@demohospa-hospital.com' },
  { label: '创新药企 · 使用方', account: 'pv@demo-pharma.example' },
  { label: '研究院 · 使用方', account: 'research@meddata-inst.edu.cn' },
  { label: '卫健委 · 监管方', account: 'data-governance@health.gov.cn' },
  { label: '合规审查官 · 合规方', account: 'compliance@medtrust.org' },
];

// 与 industries/power POWER_DEMO_USERS 同一组邮箱。密码与医疗演示账号相同。
const POWER_DEMO_ACCOUNTS = [
  { label: '省级电网', account: 'grid@hn-power.example' },
  { label: '气象部门', account: 'weather@hn-power.example' },
  { label: '市政排水', account: 'civic@hn-power.example' },
  { label: '政务数据', account: 'gov@hn-power.example' },
  { label: '新能源场站', account: 'plant@hn-power.example' },
  { label: '电力交易中心', account: 'market@hn-power.example' },
  { label: '车辆制造商', account: 'oem@hn-power.example' },
  { label: '车网聚合商', account: 'agg@hn-power.example' },
  { label: '充电运营商', account: 'charge@hn-power.example' },
];

// POC 后门关闭(P0-1):生产构建默认隐藏演示账号快速填充,仅显式
// NEXT_PUBLIC_ENABLE_DEMO_ACCOUNTS=true 时展示。
const DEMO_ACCOUNTS_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_DEMO_ACCOUNTS === 'true';

type Tab = 'password' | 'sms' | 'ca';

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('password');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [caAccount, setCaAccount] = useState('');
  const [caChallenge, setCaChallenge] = useState('');
  const [caChallengeId, setCaChallengeId] = useState('');
  const [caSignature, setCaSignature] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [captchaId, setCaptchaId] = useState('');
  const [captchaCode, setCaptchaCode] = useState('');
  const [captchaImage, setCaptchaImage] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  const loadCaptcha = useCallback(async () => {
    try {
      const c = await api.getCaptcha();
      setCaptchaId(c.captchaId);
      setCaptchaImage(c.image);
      setCaptchaCode('');
    } catch {
      setError('无法加载图形验证码,请刷新重试');
    }
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('expired') === '1') {
      setError('登录已过期，请重新登录后再访问控制台。');
    }
    if (new URLSearchParams(window.location.search).get('reset') === '1') {
      setNotice('密码已重置，请使用新密码登录。');
    }
    loadCaptcha();
  }, [loadCaptcha]);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const saveAndGo = (res: { access_token: string; refresh_token?: string; user: any }) => {
    saveSession(res.access_token, res.refresh_token, res.user);
    router.push('/space');
  };

  const doPasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const response = await api.login({
        account,
        password,
        captchaId,
        captchaCode,
        mfaCode: mfaCode || undefined,
      });
      saveAndGo(response);
    } catch (err: any) {
      setError(err.message || '登录失败');
      await loadCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const doSendSmsCode = async () => {
    setError('');
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError('请输入正确的手机号');
      return;
    }
    setLoading(true);
    try {
      await api.sendSmsCode(phone);
      setCountdown(60);
      setNotice('验证码已发送(开发环境请查看 API 控制台日志)');
    } catch (err: any) {
      setError(err.message || '发送失败');
    } finally {
      setLoading(false);
    }
  };

  const doSmsLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError('请输入正确的手机号');
      return;
    }
    setLoading(true);
    try {
      const response = await api.smsLogin(phone, smsCode);
      saveAndGo(response);
    } catch (err: any) {
      setError(err.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const doGetCaChallenge = async () => {
    setError('');
    setNotice('');
    if (!caAccount) {
      setError('请输入账号');
      return;
    }
    setLoading(true);
    try {
      const res = await api.createCaChallenge(caAccount);
      setCaChallengeId(res.challengeId);
      setCaChallenge(res.challenge);
      setNotice('请在信通院客户端中对上述挑战签名,并将签名粘贴到下方输入框。');
    } catch (err: any) {
      setError(err.message || '获取挑战失败');
    } finally {
      setLoading(false);
    }
  };

  const doCaLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!caChallengeId || !caSignature) {
      setError('请先获取登录挑战并粘贴签名');
      return;
    }
    setLoading(true);
    try {
      const response = await api.caLogin(caAccount, caChallengeId, caSignature);
      saveAndGo(response);
    } catch (err: any) {
      setError(err.message || 'CA 登录失败');
    } finally {
      setLoading(false);
    }
  };

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'password', label: '账号密码登录' },
    { key: 'sms', label: '手机快捷登录' },
    { key: 'ca', label: 'CA证书登录' },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full space-y-6 p-8 bg-white rounded-xl shadow-lg border border-gray-100">
        <div>
          <h2 className="text-2xl font-bold text-center">用户登录</h2>
          <p className="mt-1 text-center text-gray-500 text-sm">MedTrust 医疗可信数据空间</p>
        </div>

        {/* L-1:三种登录方式横向切换 */}
        <div className="grid grid-cols-3 rounded-lg bg-gray-100 p-1 text-sm">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTab(t.key);
                setError('');
                setNotice('');
              }}
              className={`py-2 rounded-md font-medium transition ${
                tab === t.key
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="bg-red-50 text-red-500 p-3 rounded text-sm">{error}</div>
        )}
        {notice && (
          <div className="bg-blue-50 text-blue-600 p-3 rounded text-sm">{notice}</div>
        )}

        {tab === 'password' && (
          <form className="space-y-4" onSubmit={doPasswordLogin}>
            <div>
              <label htmlFor="account" className="block text-sm font-medium text-gray-700">
                账号
              </label>
              <input
                id="account"
                type="text"
                required
                minLength={3}
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="请输入账号"
                autoComplete="username"
              />
            </div>

            <div>
              <label htmlFor="captcha" className="block text-sm font-medium text-gray-700">
                图形验证码
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="captcha"
                  type="text"
                  required
                  value={captchaCode}
                  onChange={(e) => setCaptchaCode(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="请输入图形验证码"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={loadCaptcha}
                  disabled={loading}
                  title="点击刷新验证码"
                  className="shrink-0 w-[120px] h-[42px] rounded-md border border-gray-300 overflow-hidden p-0 disabled:opacity-50"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {captchaImage ? (
                    <img src={captchaImage} alt="图形验证码" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs text-gray-400">加载中…</span>
                  )}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                密码
              </label>
              <div className="mt-1 relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full px-3 py-2 pr-10 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="请输入密码"
                  autoComplete="current-password"
                />
                {/* L-5:密码可见性切换 */}
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  title={showPassword ? '隐藏密码' : '显示密码'}
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="mfaCode" className="block text-sm font-medium text-gray-700">
                MFA 验证码（未启用可留空）
              </label>
              <input
                id="mfaCode"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="已启用 MFA 时必填"
                autoComplete="one-time-code"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {loading ? '登录中...' : '登录'}
            </button>
          </form>
        )}

        {tab === 'sms' && (
          <form className="space-y-4" onSubmit={doSmsLogin}>
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
                手机号
              </label>
              <input
                id="phone"
                type="tel"
                required
                maxLength={11}
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="请输入手机号"
                autoComplete="tel"
              />
            </div>

            <div>
              <label htmlFor="smsCode" className="block text-sm font-medium text-gray-700">
                短信验证码
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="smsCode"
                  type="text"
                  required
                  maxLength={6}
                  value={smsCode}
                  onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, ''))}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="请输入短信验证码"
                  autoComplete="one-time-code"
                />
                <button
                  type="button"
                  onClick={doSendSmsCode}
                  disabled={loading || countdown > 0}
                  className="shrink-0 px-4 py-2 text-sm border border-blue-600 text-blue-600 rounded-md hover:bg-blue-50 disabled:opacity-50"
                >
                  {countdown > 0 ? `${countdown}s 后重发` : '获取验证码'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {loading ? '登录中...' : '登录'}
            </button>
            <p className="text-xs text-gray-400">
              未注册手机号首次登录将自动创建待认证账号,登录后请按引导完成机构认证。
            </p>
          </form>
        )}

        {tab === 'ca' && (
          <form className="space-y-4" onSubmit={doCaLogin}>
            <div className="rounded-lg border border-dashed border-gray-300 p-3 text-xs text-gray-500 space-y-1">
              <p className="font-medium text-gray-700">CA 证书登录</p>
              <p>使用信通院接入连接器客户端本地私钥签名完成登录,平台不接触您的私钥。</p>
              <ol className="list-decimal ml-4 space-y-0.5">
                <li>在「用户中心 → 账号与身份」完成机构认证并生成 CA 身份凭证</li>
                <li>输入账号获取登录挑战</li>
                <li>在客户端中对挑战签名,粘贴签名后登录</li>
              </ol>
            </div>

            <div>
              <label htmlFor="caAccount" className="block text-sm font-medium text-gray-700">
                账号
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="caAccount"
                  type="text"
                  required
                  minLength={3}
                  value={caAccount}
                  onChange={(e) => setCaAccount(e.target.value)}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="请输入账号"
                />
                <button
                  type="button"
                  onClick={doGetCaChallenge}
                  disabled={loading}
                  className="shrink-0 px-4 py-2 text-sm border border-blue-600 text-blue-600 rounded-md hover:bg-blue-50 disabled:opacity-50"
                >
                  获取登录挑战
                </button>
              </div>
            </div>

            {caChallenge && (
              <div>
                <span className="text-xs text-gray-500">登录挑战(请用客户端本地私钥签名)</span>
                <div className="mt-1 p-2 bg-gray-50 border border-gray-200 rounded-md text-xs font-mono break-all text-gray-700">
                  {caChallenge}
                </div>
              </div>
            )}

            <div>
              <label htmlFor="caSignature" className="block text-sm font-medium text-gray-700">
                签名
              </label>
              <textarea
                id="caSignature"
                required
                rows={3}
                value={caSignature}
                onChange={(e) => setCaSignature(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                placeholder="粘贴客户端生成的 SM2 签名(十六进制)"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {loading ? '登录中...' : '签名登录'}
            </button>
          </form>
        )}

        {DEMO_ACCOUNTS_ENABLED && (
          <div className="border-t pt-4">
            <p className="text-xs text-gray-500 mb-2">快速选择演示账号(密码 demo123456):</p>
            <div className="flex flex-wrap gap-2">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.account}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setTab('password');
                    setAccount(a.account);
                    setPassword('demo123456');
                    document.getElementById('captcha')?.focus();
                  }}
                  className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                >
                  {a.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-3 mb-2">河南电力可信数据空间:</p>
            <div className="flex flex-wrap gap-2">
              {POWER_DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.account}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setTab('password');
                    setAccount(a.account);
                    setPassword('demo123456');
                    document.getElementById('captcha')?.focus();
                  }}
                  className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* L-6:底部链接 */}
        <div className="text-center flex justify-center gap-4 text-sm">
          <Link href="/register" className="text-blue-600 hover:text-blue-500">
            立即注册
          </Link>
          <Link href="/login/forgot" className="text-gray-500 hover:text-blue-500">
            忘记密码
          </Link>
        </div>
      </div>
    </div>
  );
}
