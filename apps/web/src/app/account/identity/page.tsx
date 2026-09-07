'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, type CertificationApplication } from '@/api/client';
import { clearSession, useAuth } from '@/lib/auth';

const EMPTY: CertificationApplication = {
  status: 'draft',
};

const ORG_TYPES = ['企事业单位法人', '医疗机构', '科研院所', '企业', '其他'];
const INDUSTRIES = ['医疗卫生', '医药研发', '医学研究', '数字健康', '其他'];
const REGIONS = ['上海市/黄浦区', '上海市/徐汇区', '上海市/浦东新区', '北京市/海淀区', '广东省/广州市', '陕西省/西安市'];

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function IdentityPage() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<CertificationApplication>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [licensePreviews, setLicensePreviews] = useState<string[]>([]);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [interopResults, setInteropResults] = useState<Array<{ subjectId: string; orgName?: string; uscc?: string; region?: string }>>([]);
  const [interopSearched, setInteropSearched] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!api.getToken()) {
      router.replace('/login');
      return;
    }
    (async () => {
      try {
        const res = await api.getMyCertification();
        if (res.application) setForm(res.application);
      } catch {
        // 拉取失败按空表单处理
      } finally {
        setLoading(false);
      }
    })();
  }, [ready, router]);

  // P1-6:已上传证照/LOGO 预览(带鉴权拉取 blob → object URL)。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const licenseKeys = form.licenseImages || [];
      const urls = await Promise.all(
        licenseKeys.map((k) => api.getAccountFileObjectUrl(k)),
      );
      if (!cancelled) setLicensePreviews(urls.filter((u): u is string => !!u));
      if (form.logoKey) {
        const logoUrl = await api.getAccountFileObjectUrl(form.logoKey);
        if (!cancelled) setLogoPreview(logoUrl);
      } else if (!cancelled) {
        setLogoPreview(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [form.licenseImages, form.logoKey]);

  const set = (patch: Partial<CertificationApplication>) =>
    setForm((f) => ({ ...f, ...patch }));

  const upload = async (
    file: File,
    kind: 'license' | 'logo',
  ): Promise<string | null> => {
    try {
      const dataBase64 = await toDataUrl(file);
      const res = await api.uploadCertFile({
        kind,
        fileName: file.name,
        contentType: file.type || 'image/jpeg',
        dataBase64,
      });
      return res.key;
    } catch (err: any) {
      setError(err.message || '上传失败');
      return null;
    }
  };

  const handleLicenseUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setError('');
    const keys: string[] = [];
    for (const f of files) {
      const key = await upload(f, 'license');
      if (key) keys.push(key);
    }
    set({ licenseImages: [...(form.licenseImages || []), ...keys] });
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError('');
    const key = await upload(f, 'logo');
    if (key) set({ logoKey: key });
  };

  const save = async (submit: boolean) => {
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const res = await api.saveCertification({ ...form, submit });
      setForm(res.application);
      if (submit) setStep(3);
      else setMessage('草稿已保存');
    } catch (err: any) {
      setError(err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const issueCa = async () => {
    setError('');
    setMessage('');
    if (!form.caIdentityName || !form.caPublicKey) {
      setError('请先填写身份名称与客户端生成的 SM2 公钥');
      return;
    }
    setSaving(true);
    try {
      const res = await api.issueUserCa(form.caIdentityName, form.caPublicKey);
      setForm((f) => ({ ...f, caCertFingerprint: res.certificate.fingerprint }));
      setMessage(`CA 身份凭证已生成,指纹 ${res.certificate.fingerprint}`);
    } catch (err: any) {
      setError(err.message || '生成失败');
    } finally {
      setSaving(false);
    }
  };

  const revokeCa = async () => {
    setError('');
    setMessage('');
    setSaving(true);
    try {
      await api.revokeUserCa();
      setForm((f) => ({ ...f, caCertFingerprint: undefined, caPublicKey: undefined }));
      setMessage('旧 CA 身份凭证已作废,可重新生成');
    } catch (err: any) {
      setError(err.message || '作废失败');
    } finally {
      setSaving(false);
    }
  };

  const searchInterop = async () => {
    setError('');
    setMessage('');
    setInteropSearched(true);
    try {
      const res = await api.searchSilkRoadSubjects(form.uscc || '');
      setInteropResults(res);
      if (res.length === 0) setMessage('未在丝路数港同步主体中找到匹配记录,可继续手工填写。');
    } catch (err: any) {
      setError(err.message || '检索失败');
    }
  };

  const importInterop = async (subjectId: string) => {
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const res = await api.importSilkRoadSubject(subjectId);
      setForm((f) => ({
        ...f,
        orgName: res.application.orgName,
        uscc: res.application.uscc,
        region: res.application.region,
        source: 'silk-road',
        interopSubjectId: res.application.interopSubjectId,
      }));
      setInteropResults([]);
      setMessage('已从丝路数港带入机构信息,请核对后继续。');
    } catch (err: any) {
      setError(err.message || '带入失败');
    } finally {
      setSaving(false);
    }
  };

  if (!ready || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <span className="text-gray-500">加载中…</span>
      </div>
    );
  }

  const isApproved = form.status === 'approved';
  const isSubmitted = form.status === 'submitted';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 用户中心顶部导航 */}
      <header className="bg-white border-b">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4 text-sm">
            <Link href="/space" className="text-blue-600 font-medium">返回控制台</Link>
            <span className="text-gray-300">|</span>
            <span className="text-gray-700">用户中心</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-600">{user?.name || user?.email}</span>
            <button
              className="text-gray-400 hover:text-gray-600"
              onClick={() => {
                api.logout().finally(() => {
                  clearSession();
                  router.replace('/login');
                });
              }}
            >
              退出登录
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-[200px_1fr] gap-8">
        {/* 用户中心左侧导航 */}
        <aside className="space-y-1 text-sm">
          <Link href="/account/identity" className="block px-3 py-2 rounded-md bg-blue-50 text-blue-600 font-medium">账号与身份</Link>
          <Link href="/account/favorites" className="block px-3 py-2 rounded-md text-gray-600 hover:bg-gray-50">我的收藏</Link>
          <Link href="/account/security" className="block px-3 py-2 rounded-md text-gray-600 hover:bg-gray-50">安全设置</Link>
        </aside>

        <main className="bg-white rounded-xl border p-8">
          {/* 三步流程 */}
          <div className="flex items-center gap-2 mb-8">
            {['填写基本信息', '完善认证信息', '完成机构入驻'].map((label, i) => {
              const n = i + 1;
              const active = step === n;
              const done = step > n;
              return (
                <div key={label} className="flex items-center gap-2">
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                      active || done ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'
                    }`}
                  >
                    {done ? '✓' : n}
                  </span>
                  <span className={active ? 'text-blue-600' : 'text-gray-500'}>{label}</span>
                  {n < 3 && <span className="w-8 h-px bg-gray-300 mx-2" />}
                </div>
              );
            })}
          </div>

          {error && <div className="mb-4 bg-red-50 text-red-500 p-3 rounded text-sm">{error}</div>}
          {message && <div className="mb-4 bg-blue-50 text-blue-600 p-3 rounded text-sm">{message}</div>}

          {isSubmitted && step < 3 && (
            <div className="mb-6 bg-amber-50 text-amber-700 p-4 rounded text-sm">
              您的机构认证已提交审核,请等待运营方处理。可下拉查看申请内容。
            </div>
          )}
          {isApproved && (
            <div className="mb-6 bg-green-50 text-green-700 p-4 rounded text-sm">
              机构认证已通过。若需变更机构信息,请联系运营方。
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <h3 className="font-medium">机构基本信息</h3>

              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-sm text-gray-600">机构类型 *</span>
                  <select
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                    value={form.orgType || ''}
                    onChange={(e) => set({ orgType: e.target.value })}
                    disabled={isApproved || isSubmitted}
                  >
                    <option value="">请选择</option>
                    {ORG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>

                <label className="block">
                  <span className="text-sm text-gray-600">行业类型 *</span>
                  <select
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                    value={form.industry || ''}
                    onChange={(e) => set({ industry: e.target.value })}
                    disabled={isApproved || isSubmitted}
                  >
                    <option value="">请选择</option>
                    {INDUSTRIES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
              </div>

              {/* 营业执照上传 */}
              <div>
                <span className="text-sm text-gray-600">营业执照或其他证件 *</span>
                <label className="mt-1 flex items-center justify-center border border-dashed border-gray-300 rounded-md h-24 cursor-pointer hover:bg-gray-50">
                  <span className="text-gray-400 text-sm">+ 上传图片</span>
                  <input type="file" accept="image/jpeg,image/png" multiple className="hidden" onChange={handleLicenseUpload} disabled={isApproved || isSubmitted} />
                </label>
                <p className="mt-1 text-xs text-gray-400">
                  请上传三证合一的主体证照彩色照片;图片仅支持 JPG/PNG,大小不超过 5M。
                </p>
                {(form.licenseImages || []).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {form.licenseImages!.map((k, i) => (
                      <div key={k} className="w-16 h-16 border border-gray-200 rounded-md overflow-hidden">
                        {licensePreviews[i] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={licensePreviews[i]} alt="证照预览" className="w-full h-full object-cover" />
                        ) : (
                          <span className="w-full h-full flex items-center justify-center text-[10px] text-gray-400">{k.split('/').pop()}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-sm text-gray-600">机构名称 *</span>
                  <input
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="请输入名称"
                    value={form.orgName || ''}
                    onChange={(e) => set({ orgName: e.target.value })}
                    disabled={isApproved || isSubmitted}
                  />
                </label>

                <label className="block">
                  <span className="text-sm text-gray-600">统一社会信用代码 *</span>
                  <input
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="18位信用代码,支持英文、数字"
                    maxLength={18}
                    value={form.uscc || ''}
                    onChange={(e) => set({ uscc: e.target.value.toUpperCase() })}
                    disabled={isApproved || isSubmitted}
                  />
                </label>
              </div>

              {/* P2-2:从丝路数港带入机构信息 */}
              <div className="rounded-lg border border-dashed border-blue-200 bg-blue-50/50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-600">
                    已在丝路数港注册?输入统一社会信用代码后检索已同步主体,一键带入机构信息,免重复上传证照。
                  </span>
                  <button
                    type="button"
                    className="shrink-0 px-3 py-1.5 text-sm border border-blue-600 text-blue-600 rounded-md hover:bg-blue-50 disabled:opacity-50"
                    onClick={searchInterop}
                    disabled={saving || isApproved || isSubmitted || !form.uscc}
                  >
                    检索丝路数港主体
                  </button>
                </div>
                {interopSearched && interopResults.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {interopResults.map((s) => (
                      <div key={s.subjectId} className="flex items-center justify-between bg-white border border-gray-200 rounded-md px-3 py-2">
                        <div className="text-sm">
                          <div className="font-medium">{s.orgName}</div>
                          <div className="text-xs text-gray-400">{s.uscc} · {s.region}</div>
                        </div>
                        <button
                          type="button"
                          className="text-sm text-blue-600 hover:underline"
                          onClick={() => importInterop(s.subjectId)}
                          disabled={saving}
                        >
                          带入
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <span className="text-sm text-gray-600">营业期限或有效期 *</span>
                <div className="mt-1 flex items-center gap-6 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={form.validPeriod === 'long-term' || !form.validPeriod} onChange={() => set({ validPeriod: 'long-term', validUntil: '' })} disabled={isApproved || isSubmitted} />
                    长期有效
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={form.validPeriod === 'custom'} onChange={() => set({ validPeriod: 'custom' })} disabled={isApproved || isSubmitted} />
                    自定义
                  </label>
                  {form.validPeriod === 'custom' && (
                    <input type="date" className="px-3 py-1.5 border border-gray-300 rounded-md" value={form.validUntil || ''} onChange={(e) => set({ validUntil: e.target.value })} disabled={isApproved || isSubmitted} />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-sm text-gray-600">注册地 *</span>
                  <select className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" value={form.region || ''} onChange={(e) => set({ region: e.target.value })} disabled={isApproved || isSubmitted}>
                    <option value="">请选择</option>
                    {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>

                <label className="block">
                  <span className="text-sm text-gray-600">注册金额(万元)</span>
                  <input type="number" className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="请输入" value={form.capitalWanYuan ?? ''} onChange={(e) => set({ capitalWanYuan: Number(e.target.value) || undefined })} disabled={isApproved || isSubmitted} />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-sm text-gray-600">注册日期</span>
                  <input type="date" className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" value={form.regDate || ''} onChange={(e) => set({ regDate: e.target.value })} disabled={isApproved || isSubmitted} />
                </label>

                <label className="block">
                  <span className="text-sm text-gray-600">注册详细地址 *</span>
                  <input className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="请输入" value={form.address || ''} onChange={(e) => set({ address: e.target.value })} disabled={isApproved || isSubmitted} />
                </label>
              </div>

              <label className="block">
                <span className="text-sm text-gray-600">经营范围或业务范围 *（0/1000）</span>
                <textarea className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" rows={3} maxLength={1000} placeholder="请输入" value={form.businessScope || ''} onChange={(e) => set({ businessScope: e.target.value })} disabled={isApproved || isSubmitted} />
                <span className="text-xs text-gray-400">{(form.businessScope || '').length}/1000</span>
              </label>

              <label className="block">
                <span className="text-sm text-gray-600">机构简介（0/2000）</span>
                <textarea className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" rows={3} maxLength={2000} placeholder="请输入" value={form.orgIntro || ''} onChange={(e) => set({ orgIntro: e.target.value })} disabled={isApproved || isSubmitted} />
                <span className="text-xs text-gray-400">{(form.orgIntro || '').length}/2000</span>
              </label>

              {/* 机构 LOGO */}
              <div>
                <span className="text-sm text-gray-600">机构 LOGO</span>
                <label className="mt-1 flex items-center justify-center border border-dashed border-gray-300 rounded-md h-20 cursor-pointer hover:bg-gray-50">
                  <span className="text-gray-400 text-sm">+ 上传图片</span>
                  <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={handleLogoUpload} disabled={isApproved || isSubmitted} />
                </label>
                <p className="mt-1 text-xs text-gray-400">建议上传 128x128 像素图片,JPG/PNG,不超过 2M。</p>
                {form.logoKey && (
                  <div className="mt-2 w-16 h-16 border border-gray-200 rounded-md overflow-hidden">
                    {logoPreview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoPreview} alt="LOGO 预览" className="w-full h-full object-cover" />
                    ) : (
                      <span className="w-full h-full flex items-center justify-center text-[10px] text-gray-400">加载中</span>
                    )}
                  </div>
                )}
              </div>

              {/* CA 身份凭证 */}
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">CA 身份凭证</span>
                  {form.caCertFingerprint ? (
                    <span className="text-xs text-green-600">已生成 · {form.caCertFingerprint}</span>
                  ) : (
                    <span className="text-xs text-gray-400">暂未生成</span>
                  )}
                </div>
                <ol className="list-decimal ml-4 text-xs text-gray-500 space-y-1">
                  <li>初次使用需要 下载信通院接入连接器客户端</li>
                  <li>安装客户端,运行客户端并填写「身份名称」,生成公钥信息,再确认</li>
                  <li>生成凭证完成</li>
                </ol>
                <p className="text-xs text-gray-400">
                  身份私钥、数字凭证是接入全国数据基础设施、跨节点通信、数据交易核验的唯一可信凭证;私钥仅存本机客户端,平台、节点服务端不存储您的私钥;建议导出凭证文件至 U 盘等离线设备,禁止仅存单一电脑;更换电脑、重装系统将作废当前全部身份凭证。
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                    placeholder="身份名称"
                    value={form.caIdentityName || ''}
                    onChange={(e) => set({ caIdentityName: e.target.value })}
                    disabled={isApproved || isSubmitted || !!form.caCertFingerprint}
                  />
                  <input
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                    placeholder="客户端生成的 SM2 公钥(130 位十六进制)"
                    value={form.caPublicKey || ''}
                    onChange={(e) => set({ caPublicKey: e.target.value })}
                    disabled={isApproved || isSubmitted || !!form.caCertFingerprint}
                  />
                </div>
                <div className="flex gap-3">
                  {!form.caCertFingerprint ? (
                    <button className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm" onClick={issueCa} disabled={saving || isApproved || isSubmitted}>生成凭证</button>
                  ) : (
                    <button className="px-4 py-2 border border-red-300 text-red-500 rounded-md text-sm" onClick={revokeCa} disabled={saving || isApproved}>作废重发</button>
                  )}
                </div>
              </div>

              <div className="flex justify-between pt-2">
                <button className="px-4 py-2 border border-gray-300 rounded-md text-sm" onClick={() => router.push('/space')} disabled={saving}>取消</button>
                <div className="flex gap-3">
                  <button className="px-4 py-2 border border-gray-300 rounded-md text-sm" onClick={() => save(false)} disabled={saving || isApproved}>保存草稿</button>
                  <button className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm" onClick={() => { setStep(2); }} disabled={saving || isApproved}>下一步</button>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <h3 className="font-medium">完善认证信息</h3>
              <p className="text-sm text-gray-500">请核对以下机构认证信息,确认无误后提交运营方审核。</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                {[
                  ['机构类型', form.orgType],
                  ['机构名称', form.orgName],
                  ['统一社会信用代码', form.uscc],
                  ['营业期限', form.validPeriod === 'custom' ? `自定义至 ${form.validUntil}` : '长期有效'],
                  ['注册地', form.region],
                  ['注册详细地址', form.address],
                  ['经营范围', form.businessScope],
                  ['行业类型', form.industry],
                  ['注册金额(万元)', form.capitalWanYuan],
                  ['注册日期', form.regDate],
                  ['CA 身份名称', form.caIdentityName || '未生成'],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span className="text-gray-400">{label}</span>
                    <div className="mt-0.5 text-gray-800">{value || '—'}</div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between pt-2">
                <button className="px-4 py-2 border border-gray-300 rounded-md text-sm" onClick={() => setStep(1)} disabled={saving}>上一步</button>
                <button className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm" onClick={() => save(true)} disabled={saving || isApproved || isSubmitted}>
                  {saving ? '提交中...' : '提交审核'}
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-xl">✓</div>
              <h3 className="font-medium">机构入驻申请已提交</h3>
              <p className="text-sm text-gray-500">
                运营方将在 1-3 个工作日内完成审核。审核通过后,您的账号将获得对应参与方角色。
                {form.reviewNote && <span className="block mt-2 text-amber-600">审核意见:{form.reviewNote}</span>}
              </p>
              <div className="flex justify-center gap-3">
                <Link href="/space" className="px-4 py-2 border border-gray-300 rounded-md text-sm">返回控制台</Link>
                <button className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm" onClick={() => setStep(1)}>查看申请内容</button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
