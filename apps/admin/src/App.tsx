import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { adminApi, type Dashboard, type Deposit, type EnvelopeSetup, type User, type Withdrawal } from './api';
import { useT, type Translate } from './i18n';
import { LanguageSwitcher } from './components/LanguageSwitcher';

type Page = 'dashboard' | 'envelopes' | 'deposits' | 'withdrawals' | 'users' | 'settings' | 'audit';
const money = (minor?: string | number) => { if (minor === undefined) return '0.00'; const n = BigInt(minor); return `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, '0').slice(0, 2)}`; };
const date = (value: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

function statusLabel(t: Translate, status: string): string {
  const map: Record<string, string> = {
    QUEUED: t('queued'), PROCESSING: t('statusProcessing'), BROADCAST: t('statusBroadcast'), CONFIRMING: t('statusConfirming'),
    COMPLETED: t('completed'), FAILED: t('failed'), REJECTED: t('rejected'), ACTIVE: t('statusActive'), BANNED: t('statusBanned'),
    PENDING: t('pending'), CONFIRMED: t('confirmed')
  };
  return map[status] ?? status.replace(/_/g, ' ');
}

export default function App() { const t = useT(); const [token, setToken] = useState(localStorage.getItem('admin_token')); const [page, setPage] = useState<Page>('dashboard'); if (!token) return <Login onLoggedIn={(newToken) => { localStorage.setItem('admin_token', newToken); setToken(newToken); }} />; return <div className="admin-shell"><Sidebar page={page} setPage={setPage} onLogout={() => { localStorage.removeItem('admin_token'); setToken(null); }} /><div className="admin-main"><div className="mobile-top"><span>RED ENVELOPE</span><div className="mobile-top-actions"><LanguageSwitcher /><button onClick={() => { localStorage.removeItem('admin_token'); setToken(null); }}>{t('signOut')}</button></div></div>{page === 'dashboard' && <DashboardPage />}{page === 'envelopes' && <EnvelopesPage />}{page === 'deposits' && <DepositsPage />}{page === 'withdrawals' && <WithdrawalsPage />}{page === 'users' && <UsersPage />}{page === 'settings' && <SettingsPage />}{page === 'audit' && <AuditPage />}</div></div>; }

function Login({ onLoggedIn }: { onLoggedIn: (token: string) => void }) { const t = useT(); const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [mfaCode, setMfaCode] = useState(''); const [error, setError] = useState(''); const mutation = useMutation({ mutationFn: () => adminApi<{ token: string }>('/api/admin/auth/login', { method: 'POST', body: JSON.stringify({ username, password, mfaCode: mfaCode || undefined }) }), onSuccess: (result) => onLoggedIn(result.token), onError: (e) => setError(e instanceof Error ? e.message : t('unableToSignIn')) }); return <div className="login-page"><div className="login-art"><div className="login-orb">🧧</div><p className="overline">{t('loginOverline')}</p><h1>{t('loginTitleA')}<br /><em>{t('loginTitleB')}</em></h1><p>{t('loginIntro')}</p></div><form className="login-card" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}><div className="brand-mark">RE <span>·</span> {t('brandAdmin')}</div><h2>{t('welcomeBack')}</h2><p>{t('loginHint')}</p><div className="login-lang"><LanguageSwitcher /></div><label>{t('username')}<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></label><label>{t('password')}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label><label>{t('mfaCode')} <small>{t('optional')}</small><input inputMode="numeric" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} /></label>{error && <div className="alert danger">{error}</div>}<button className="login-button" disabled={mutation.isPending}>{mutation.isPending ? t('authenticating') : t('signInSecurely')}</button><small className="login-foot">{t('loginFoot')}</small></form></div>; }

function Sidebar({ page, setPage, onLogout }: { page: Page; setPage: (page: Page) => void; onLogout: () => void }) { const t = useT(); const mode = useQuery({ queryKey: ['testing'], queryFn: () => adminApi<{ fundsMode: 'test' | 'real' }>('/api/admin/testing') }); const items: Array<[Page, string, string]> = [['dashboard', '⌂', t('dashboard')], ['envelopes', '🧧', t('sendEnvelope')], ['deposits', '↓', t('deposits')], ['withdrawals', '⇄', t('withdrawalQueue')], ['users', '♙', t('users')], ['settings', '⚙', t('groupSettings')], ['audit', '≡', t('auditLogs')]]; const fundsMode = mode.data?.fundsMode ?? 'test'; return <aside className="sidebar"><div className="brand"><span className="brand-box">RE</span><div><strong>{t('brandName')}</strong><small>{t('controlRoom')}</small></div></div><div className={`workspace-pill ${fundsMode}`}><span className="online-dot" /> {fundsMode === 'real' ? t('realFunds') : t('testMode')} {t('workspace')}</div><nav>{items.map(([id, icon, label]) => <button className={page === id ? 'side-link selected' : 'side-link'} key={id} onClick={() => setPage(id)}><span>{icon}</span>{label}{id === 'withdrawals' && <b>!</b>}</button>)}</nav><div className="sidebar-bottom"><div className="sidebar-lang"><LanguageSwitcher /></div><div className="operator"><span>AD</span><div><strong>{t('administrator')}</strong><small>{t('superAdmin')}</small></div></div><button className="logout" onClick={onLogout}>↪ <span>{t('signOut')}</span></button></div></aside>; }

function DashboardPage() { const t = useT(); const query = useQuery({ queryKey: ['dashboard'], queryFn: () => adminApi<Dashboard>('/api/admin/dashboard') }); const d = query.data; return <PageFrame title={t('goodMorning')} subtitle={t('dashboardSubtitle')} action={<button className="refresh-button" onClick={() => void query.refetch()}>{t('refresh')}</button>}>{query.isError && <div className="alert danger">{(query.error as Error).message}</div>}<div className="kpi-grid"><Kpi label={t('internalLiability')} value={`${money(d?.totalLiabilityMinor)} USDT`} note={t('liabilityNote')} icon="◈" tone="blue" /><Kpi label={t('hotWalletBalance')} value={`${money(d?.hotWalletBalance)} USDT`} note={t('hotWalletNote')} icon="◉" tone="green" /><Kpi label={t('pendingWithdrawals')} value={String(d?.pendingWithdrawals ?? 0)} note={t('pendingNote')} icon="⇄" tone="amber" /><Kpi label={t('depositsToday')} value={`${money(d?.depositsToday)} USDT`} note={t('depositsNote')} icon="↓" tone="purple" /></div><div className="dashboard-grid"><section className="panel chart-panel"><div className="panel-head"><div><h2>{t('volumeOverview')}</h2><p>{t('volumeSubtitle')}</p></div><span className="chart-legend"><i /> {t('legendDeposits')} <i className="legend-out" /> {t('legendWithdrawals')}</span></div><div className="chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={(d?.volume ?? []).map((item) => ({ ...item, deposits: Number(money(item.deposits)), withdrawals: Number(money(item.withdrawals)), label: item.date.slice(5) }))}><defs><linearGradient id="depositFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#66cda5" stopOpacity={.25} /><stop offset="100%" stopColor="#66cda5" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#1d3044" vertical={false} /><XAxis dataKey="label" stroke="#667b94" tickLine={false} axisLine={false} fontSize={10} /><YAxis stroke="#667b94" tickLine={false} axisLine={false} fontSize={10} tickFormatter={(value) => `${value}`} /><Tooltip contentStyle={{ background: '#112237', border: '1px solid #29435d', borderRadius: 10, fontSize: 11 }} /><Area type="monotone" dataKey="deposits" stroke="#66cda5" fill="url(#depositFill)" strokeWidth={2} /><Area type="monotone" dataKey="withdrawals" stroke="#77a9e0" fill="none" strokeWidth={2} /></AreaChart></ResponsiveContainer></div></section><section className="panel reserve-panel"><div className="panel-head"><div><h2>{t('reserveHealth')}</h2><p>{t('reserveSubtitle')}</p></div><span className="health-check">{t('healthy')}</span></div><div className="reserve-ring"><div><strong>{d && Number(d.hotWalletBalance) > 0 ? '100' : '—'}<small>%</small></strong><span>{t('coverageView')}</span></div></div><div className="reserve-row"><span>{t('onChainReserve')}</span><strong>{money(d?.hotWalletBalance)} USDT</strong></div><div className="reserve-row"><span>{t('internalLiability')}</span><strong>{money(d?.totalLiabilityMinor)} USDT</strong></div></section></div><div className="kill-switch"><div><span className="danger-icon">!</span><div><strong>{t('emergencyControls')}</strong><p>{t('emergencyNote')}</p></div></div><KillSwitch /></div></PageFrame>; }
function Kpi({ label, value, note, icon, tone }: { label: string; value: string; note: string; icon: string; tone: string }) { return <div className={`kpi-card ${tone}`}><div className="kpi-top"><span>{label}</span><b>{icon}</b></div><strong>{value}</strong><small>{note}</small></div>; }
function KillSwitch() {
  const t = useT();
  const client = useQueryClient();
  const status = useQuery({ queryKey: ['emergency-status'], queryFn: () => adminApi<{ withdrawalsDisabled: boolean; envelopesDisabled: boolean }>('/api/admin/emergency/status') });
  const mutation = useMutation({ mutationFn: ({ target, disabled }: { target: 'withdrawals' | 'envelopes'; disabled: boolean }) => adminApi<{ disabled: boolean }>(`/api/admin/emergency/disable-${target}`, { method: 'POST', body: JSON.stringify({ disabled }) }), onSuccess: () => void client.invalidateQueries({ queryKey: ['emergency-status'] }) });
  const toggle = (target: 'withdrawals' | 'envelopes', disabled: boolean) => { if (!disabled && !window.confirm(t('confirmDisable', target === 'withdrawals' ? t('targetWithdrawals') : t('targetEnvelopes')))) return; mutation.mutate({ target, disabled: !disabled }); };
  const withdrawalsDisabled = status.data?.withdrawalsDisabled ?? false;
  const envelopesDisabled = status.data?.envelopesDisabled ?? false;
  return <div className="row-actions"><button className={withdrawalsDisabled ? 'kill-button active' : 'kill-button'} onClick={() => toggle('withdrawals', withdrawalsDisabled)}>{withdrawalsDisabled ? t('withdrawalsDisabledEnable') : t('disableWithdrawals')}</button><button className={envelopesDisabled ? 'kill-button active' : 'kill-button'} onClick={() => toggle('envelopes', envelopesDisabled)}>{envelopesDisabled ? t('envelopesDisabledEnable') : t('disableEnvelopes')}</button></div>;
}
function PageFrame({ title, subtitle, action, children }: { title: string; subtitle: string; action?: React.ReactNode; children: React.ReactNode }) { const t = useT(); return <div className="page-content"><header className="page-header"><div><p className="overline">{t('operationsOverview')}</p><h1>{title}</h1><p>{subtitle}</p></div>{action}</header>{children}</div>; }

function EnvelopesPage() {
  const t = useT();
  const client = useQueryClient();
  const setup = useQuery({ queryKey: ['envelope-setup'], queryFn: () => adminApi<EnvelopeSetup>('/api/admin/envelopes/setup') });
  const testing = useQuery({ queryKey: ['testing'], queryFn: () => adminApi<{ fundsMode: 'test' | 'real'; testCreditEnabled: boolean }>('/api/admin/testing') });
  const [groupId, setGroupId] = useState('');
  const [total, setTotal] = useState('10');
  const [count, setCount] = useState(5);
  const [mode, setMode] = useState<'RANDOM' | 'EQUAL'>('RANDOM');
  const [expiresInMinutes, setExpiresInMinutes] = useState(1440);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'success' | 'danger'>('danger');
  const [treasuryAmount, setTreasuryAmount] = useState('1000');
  const [treasuryMessage, setTreasuryMessage] = useState('');
  const [treasuryTone, setTreasuryTone] = useState<'success' | 'danger'>('danger');
  // Top up the treasury wallet directly from the console — the same audited
  // ledger operation as `npm run db:dev-credit -- <treasury-id> <amount>`.
  const treasuryCredit = useMutation({
    mutationFn: () => adminApi<{ availableMinor: string }>(`/api/admin/users/${setup.data!.treasury!.id}/test-credit`, {
      method: 'POST',
      body: JSON.stringify({ amount: treasuryAmount, reason: 'Treasury top-up from admin console' })
    }),
    onSuccess: (result) => {
      setTreasuryMessage(t('treasuryCredited', treasuryAmount, money(result.availableMinor)));
      setTreasuryTone('success');
      void client.invalidateQueries({ queryKey: ['envelope-setup'] });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error) => {
      setTreasuryMessage(error instanceof Error ? error.message : t('unableToAddBalance'));
      setTreasuryTone('danger');
    }
  });
  const send = useMutation({
    mutationFn: () => adminApi<{ envelope: { id: string } }>('/api/admin/envelopes/send', {
      method: 'POST',
      body: JSON.stringify({ groupId, total, count, mode, expiresInMinutes })
    }),
    onSuccess: (result) => {
      setMessage(t('envelopePosted', result.envelope.id.slice(0, 8)));
      setMessageTone('success');
      void client.invalidateQueries({ queryKey: ['envelope-setup'] });
    },
    onError: (error) => {
      const detail = error instanceof Error ? error.message : t('unableToSendEnvelope');
      const code = (error as { code?: string }).code;
      // Friendly, localized toast for the most common failure; the backend
      // detail (needs X / has Y USDT) is appended for the operator.
      setMessage(code === 'TREASURY_INSUFFICIENT_BALANCE' ? `${t('treasuryInsufficient')} ${detail}` : detail);
      setMessageTone('danger');
    }
  });
  const groups = setup.data?.groups.filter((group) => group.enabled) ?? [];
  const groupName = (id: string) => setup.data?.groups.find((group) => group.chatId === id)?.title ?? id;
  return <PageFrame title={t('sendEnvelopeTitle')} subtitle={t('sendEnvelopeSubtitle')}>
    {setup.isError && <div className="alert danger">{(setup.error as Error).message}</div>}
    {setup.data && !setup.data.configured && <div className="alert danger">{setup.data.configurationMessage}</div>}
    <div className="envelope-admin-grid">
      <section className="panel settings-panel envelope-form">
        <div className="panel-head"><div><h2>{t('newGroupEnvelope')}</h2><p>{t('newGroupEnvelopeNote')}</p></div><span className="settings-icon">🧧</span></div>
        <label>{t('destinationGroup')}<select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">{t('selectRegisteredGroup')}</option>{groups.map((group) => <option key={group.id} value={group.chatId}>{group.title ?? group.username ?? group.chatId} ({group.chatId})</option>)}</select></label>
        {!groups.length && <div className="info-callout"><strong>{t('noRegisteredGroups')}</strong><p>{t('noRegisteredGroupsHint')}</p></div>}
        <div className="settings-grid"><label>{t('totalUsdt')}<input value={total} inputMode="decimal" onChange={(event) => setTotal(event.target.value)} /></label><label>{t('numberOfClaims')}<input type="number" min="1" max="500" value={count} onChange={(event) => setCount(Number(event.target.value))} /></label><label>{t('distribution')}<select value={mode} onChange={(event) => setMode(event.target.value as 'RANDOM' | 'EQUAL')}><option value="RANDOM">{t('randomShares')}</option><option value="EQUAL">{t('equalShares')}</option></select></label></div>
        <label>{t('expires')}<select value={expiresInMinutes} onChange={(event) => setExpiresInMinutes(Number(event.target.value))}><option value={60}>{t('inOneHour')}</option><option value={1440}>{t('in24Hours')}</option><option value={10080}>{t('in7Days')}</option></select></label>
        <div className="treasury-line"><span>{t('treasuryWallet')}</span><strong>{setup.data?.treasury ? t('usdtAvailable', money(setup.data.treasury.wallet?.availableMinor)) : setup.data?.treasuryTelegramIdConfigured ? t('idConfigured') : t('telegramIdNotConfigured')}</strong></div>
        {setup.data?.treasury && <div className="treasury-topup">
          {testing.data?.testCreditEnabled
            ? <>
              <label>{t('amountUsdt')}<input value={treasuryAmount} inputMode="decimal" onChange={(event) => setTreasuryAmount(event.target.value)} /></label>
              <button className="table-action" disabled={treasuryCredit.isPending || !treasuryAmount} onClick={() => { if (window.confirm(t('confirmAddCredit', treasuryAmount, t('treasuryWallet')))) { setTreasuryMessage(''); treasuryCredit.mutate(); } }}>{treasuryCredit.isPending ? t('adding') : t('addTreasuryUsdt')}</button>
              <small className="treasury-topup-hint">{t('treasuryTopUpNote')}</small>
            </>
            : <small className="treasury-topup-hint"><strong>{t('testCreditsDisabled')}</strong> {t('testCreditsDisabledNote')}</small>}
          {treasuryMessage && <div className={`alert ${treasuryTone} treasury-alert`}>{treasuryMessage}</div>}
        </div>}
        {message && <div className={`alert ${messageTone}`}>{message}</div>}
        <button className="login-button save-button" disabled={!setup.data?.configured || !groupId || send.isPending} onClick={() => { setMessage(''); send.mutate(); }}>{send.isPending ? t('fundingPosting') : t('sendToGroup')}</button>
      </section>
      <div className="info-callout envelope-help"><strong>{t('whatMembersSee')}</strong><p>{t('whatMembersSeeText')}</p></div>
    </div>
    <section className="panel table-panel envelope-history"><div className="panel-head"><div><h2>{t('recentEnvelopes')}</h2><p>{t('recentEnvelopesNote')}</p></div></div><table><thead><tr><th>{t('colEnvelope')}</th><th>{t('colGroup')}</th><th>{t('colAmount')}</th><th>{t('colClaims')}</th><th>{t('colMode')}</th><th>{t('colStatus')}</th></tr></thead><tbody>{setup.data?.recent.map((item) => <tr key={item.id}><td><strong>#{item.id.slice(0, 8)}</strong><small>{date(item.createdAt)}</small></td><td><strong>{groupName(item.groupId)}</strong><small>{item.groupId}</small></td><td><strong>{money(item.totalMinor)} USDT</strong><small>{money(item.remainingMinor)} {t('remaining')}</small></td><td>{item._count.claims} / {item.totalSlots}</td><td>{item.mode === 'RANDOM' ? t('randomShares') : t('equalShares')}</td><td><Status status={item.status} /></td></tr>)}</tbody></table>{!setup.data?.recent.length && <Empty text={t('noEnvelopesYet')} />}</section>
  </PageFrame>;
}

function DepositsPage() {
  const t = useT();
  const [status, setStatus] = useState('');
  const query = useQuery({ queryKey: ['deposits', status], queryFn: () => adminApi<Deposit[]>(`/api/admin/deposits${status ? `?status=${status}` : ''}`) });
  return <PageFrame title={t('depositReconciliation')} subtitle={t('depositReconciliationSubtitle')} action={<button className="refresh-button" onClick={() => void query.refetch()}>{t('refresh')}</button>}>
    <div className="toolbar"><div className="filter-tabs"><button className={!status ? 'filter active' : 'filter'} onClick={() => setStatus('')}>{t('all')}</button><button className={status === 'PENDING' ? 'filter active' : 'filter'} onClick={() => setStatus('PENDING')}>{t('pending')}</button><button className={status === 'CONFIRMED' ? 'filter active' : 'filter'} onClick={() => setStatus('CONFIRMED')}>{t('confirmed')}</button><button className={status === 'FAILED' ? 'filter active' : 'filter'} onClick={() => setStatus('FAILED')}>{t('failed')}</button></div><span className="muted">{query.data?.length ?? 0} {t('records')}</span></div>
    <section className="panel table-panel"><table><thead><tr><th>{t('colDetected')}</th><th>{t('colUserIdentity')}</th><th>{t('colAmount')}</th><th>{t('colConfirmations')}</th><th>{t('colDestination')}</th><th>{t('colTransaction')}</th><th>{t('colStatus')}</th></tr></thead><tbody>{query.data?.map((item) => <tr key={item.id}><td><small>{date(item.detectedAt)}</small></td><td><strong>{item.user.firstName}</strong><small>Telegram ID {item.user.telegramId}{item.user.username ? ` · @${item.user.username}` : ''}</small></td><td><strong>{money(item.amountMinor)} USDT</strong><small>TRC20</small></td><td>{item.confirmations}</td><td><code>{item.toAddress.slice(0, 7)}…{item.toAddress.slice(-5)}</code></td><td><code>{item.txHash.slice(0, 8)}…{item.txHash.slice(-6)}</code></td><td><Status status={item.status} /></td></tr>)}</tbody></table>{!query.data?.length && <Empty text={t('noDepositsMatch')} />}</section>
  </PageFrame>;
}

function WithdrawalsPage() {
  const t = useT();
  const [status, setStatus] = useState('');
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['withdrawals', status], queryFn: () => adminApi<Withdrawal[]>(`/api/admin/withdrawals${status ? `?status=${status}` : ''}`) });
  const action = useMutation({
    mutationFn: ({ id, kind, reason }: { id: string; kind: 'approve' | 'retry' | 'reject'; reason?: string }) => adminApi(`/api/admin/withdrawals/${id}/${kind}`, { method: 'POST', body: kind === 'reject' ? JSON.stringify({ reason }) : undefined }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['withdrawals'] }); void client.invalidateQueries({ queryKey: ['users'] }); }
  });
  const reject = (item: Withdrawal) => { const reason = window.prompt(t('rejectPrompt')); if (reason?.trim()) action.mutate({ id: item.id, kind: 'reject', reason }); };
  return <PageFrame title={t('withdrawalQueueTitle')} subtitle={t('withdrawalQueueSubtitle')} action={<button className="refresh-button" onClick={() => void query.refetch()}>{t('refresh')}</button>}><div className="toolbar"><div className="filter-tabs"><button className={!status ? 'filter active' : 'filter'} onClick={() => setStatus('')}>{t('all')}</button><button className={status === 'QUEUED' ? 'filter active' : 'filter'} onClick={() => setStatus('QUEUED')}>{t('queued')}</button><button className={status === 'FAILED' ? 'filter active' : 'filter'} onClick={() => setStatus('FAILED')}>{t('failed')}</button><button className={status === 'COMPLETED' ? 'filter active' : 'filter'} onClick={() => setStatus('COMPLETED')}>{t('completed')}</button></div><span className="muted">{query.data?.length ?? 0} {t('records')}</span></div><section className="panel table-panel"><table><thead><tr><th>{t('colRequest')}</th><th>{t('colUser')}</th><th>{t('colAmount')}</th><th>{t('colDestination')}</th><th>{t('colStatus')}</th><th>{t('colAction')}</th></tr></thead><tbody>{query.data?.map((item) => <tr key={item.id}><td><strong>#{item.id.slice(0, 8)}</strong><small>{date(item.createdAt)}</small></td><td><strong>{item.user.firstName}</strong><small>Telegram ID {item.user.telegramId}{item.user.username ? ` · @${item.user.username}` : ''}</small></td><td><strong>{money(item.amountMinor)} USDT</strong><small>{t('feeReserved', money(item.feeMinor))}</small></td><td><code>{item.toAddress.slice(0, 7)}…{item.toAddress.slice(-5)}</code></td><td><Status status={item.status} /></td><td><div className="row-actions">{item.status === 'QUEUED' && <button className="table-action" onClick={() => action.mutate({ id: item.id, kind: 'approve' })}>{t('approve')}</button>}{item.status === 'FAILED' && <button className="table-action" onClick={() => action.mutate({ id: item.id, kind: 'retry' })}>{t('retry')}</button>}{['QUEUED', 'FAILED'].includes(item.status) && !item.txHash && <button className="table-action danger-action" onClick={() => reject(item)}>{t('reject')}</button>}{['COMPLETED', 'REJECTED'].includes(item.status) && <span className="muted">—</span>}</div></td></tr>)}</tbody></table>{!query.data?.length && <Empty text={t('noWithdrawalsMatch')} />}</section></PageFrame>;
}
function Status({ status }: { status: string }) { const t = useT(); return <span className={`status ${status.toLowerCase()}`}>{statusLabel(t, status)}</span>; }
function Empty({ text }: { text: string }) { return <div className="empty-table">◌<p>{text}</p></div>; }

function UsersPage() {
  const t = useT();
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['users', submitted], queryFn: () => adminApi<User[]>(`/api/admin/users${submitted ? `?search=${encodeURIComponent(submitted)}` : ''}`) });
  const testing = useQuery({ queryKey: ['testing'], queryFn: () => adminApi<{ fundsMode: 'test' | 'real'; testCreditEnabled: boolean }>('/api/admin/testing') });
  const detail = useQuery({ queryKey: ['user', selectedId], queryFn: () => adminApi<User>(`/api/admin/users/${selectedId}`), enabled: Boolean(selectedId) });
  const ban = useMutation({ mutationFn: (id: string) => adminApi(`/api/admin/users/${id}/ban`, { method: 'POST' }), onSuccess: () => void client.invalidateQueries({ queryKey: ['users'] }) });
  const refreshUser = () => {
    void client.invalidateQueries({ queryKey: ['users'] });
    void client.invalidateQueries({ queryKey: ['user', selectedId] });
    void client.invalidateQueries({ queryKey: ['dashboard'] });
    void client.invalidateQueries({ queryKey: ['audit'] });
  };
  return <PageFrame title={t('usersTitle')} subtitle={t('usersSubtitle')} action={<form className="search-box" onSubmit={(e) => { e.preventDefault(); setSubmitted(search); }}><span>⌕</span><input placeholder={t('searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} /></form>}>
    <section className="panel table-panel"><table><thead><tr><th>{t('colAccount')}</th><th>{t('colTelegramId')}</th><th>{t('colAvailableBalance')}</th><th>{t('colJoined')}</th><th>{t('colAccess')}</th><th>{t('colActions')}</th></tr></thead><tbody>{query.data?.map((user) => <tr key={user.id}><td><div className="user-cell"><span>{user.firstName.slice(0, 1)}</span><div><strong>{user.firstName}</strong><small>@{user.username ?? t('noUsername')}</small></div></div></td><td><code>{user.telegramId}</code></td><td><strong>{money(user.wallet?.availableMinor)} USDT</strong><small>{t('locked')} {money(user.wallet?.lockedMinor)}</small></td><td><small>{date(user.createdAt)}</small></td><td><Status status={user.status} /></td><td><div className="row-actions"><button className="table-action" onClick={() => setSelectedId(selectedId === user.id ? undefined : user.id)}>{selectedId === user.id ? t('close') : t('transactions')}</button><button className="table-action danger-action" onClick={() => ban.mutate(user.id)}>{user.status === 'BANNED' ? t('unban') : t('ban')}</button></div></td></tr>)}</tbody></table>{!query.data?.length && <Empty text={t('noUsersFound')} />}</section>
    {selectedId && <UserTransactionPanel user={detail.data} loading={detail.isLoading} error={detail.error} testCreditEnabled={testing.data?.testCreditEnabled === true} onCredited={refreshUser} />}
  </PageFrame>;
}

function UserTransactionPanel({ user, loading, error, testCreditEnabled, onCredited }: { user?: User; loading: boolean; error: Error | null; testCreditEnabled: boolean; onCredited: () => void }) {
  const t = useT();
  const [amount, setAmount] = useState('1000');
  const [reason, setReason] = useState('Local red-envelope testing');
  const [message, setMessage] = useState('');
  const credit = useMutation({
    mutationFn: () => adminApi<{ availableMinor: string }>(`/api/admin/users/${user!.id}/test-credit`, { method: 'POST', body: JSON.stringify({ amount, reason }) }),
    onSuccess: (result) => { setMessage(t('addedTestCredit', amount, money(result.availableMinor))); onCredited(); },
    onError: (creditError) => setMessage(creditError instanceof Error ? creditError.message : t('unableToAddBalance'))
  });
  if (loading) return <section className="panel user-detail-panel"><p className="muted">{t('loadingTransactions')}</p></section>;
  if (error) return <div className="alert danger">{error.message}</div>;
  if (!user) return null;
  return <section className="panel user-detail-panel">
    <div className="panel-head"><div><h2>{t('transactionHistory', user.firstName)}</h2><p>{t('transactionHistoryNote')}</p></div><strong>{t('usdtAvailable', money(user.wallet?.availableMinor))}</strong></div>
    {testCreditEnabled && <div className="test-credit-box"><div><strong>{t('addTestUsdt')}</strong><p>{t('addTestUsdtNote')}</p></div><label>{t('colAmount')}<input value={amount} inputMode="decimal" onChange={(event) => setAmount(event.target.value)} /></label><label>{t('reason')}<input value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} /></label><button className="table-action" disabled={credit.isPending || !amount || reason.trim().length < 3} onClick={() => { if (window.confirm(t('confirmAddCredit', amount, user.firstName))) credit.mutate(); }}>{credit.isPending ? t('adding') : t('addTestBalance')}</button></div>}
    {!testCreditEnabled && <div className="info-callout"><strong>{t('testCreditsDisabled')}</strong><p>{t('testCreditsDisabledNote')}</p></div>}
    {message && <div className={message.startsWith(t('addedTestCredit', '', '').split(' ')[0]) ? 'alert success' : 'alert danger'}>{message}</div>}
    <div className="table-panel transaction-table"><table><thead><tr><th>{t('colTime')}</th><th>{t('colTransactionName')}</th><th>{t('colDirection')}</th><th>{t('colAmount')}</th><th>{t('colBalanceAfter')}</th><th>{t('colReference')}</th></tr></thead><tbody>{user.ledger?.map((entry) => <tr key={entry.id}><td><small>{date(entry.createdAt)}</small></td><td><strong>{entry.type.replace('_', ' ')}</strong><small>{entry.referenceType}</small></td><td><span className={`status ${entry.direction === 'CREDIT' ? 'active' : 'queued'}`}>{entry.direction === 'CREDIT' ? t('credit') : t('debit')}</span></td><td><strong>{entry.direction === 'CREDIT' ? '+' : '-'}{money(entry.amountMinor)} USDT</strong></td><td>{money(entry.balanceAfterMinor)} USDT</td><td><code>{entry.referenceId.slice(0, 24)}</code></td></tr>)}</tbody></table>{!user.ledger?.length && <Empty text={t('noTransactions')} />}</div>
  </section>;
}

function SettingsPage() { const t = useT(); const [chatId, setChatId] = useState(''); const [form, setForm] = useState({ enabled: true, minAccountAgeDays: 0, minMessages: 0, maxClaimsPerDay: 10 }); const [message, setMessage] = useState(''); const mutation = useMutation({ mutationFn: () => adminApi(`/api/admin/settings/${chatId}`, { method: 'PUT', body: JSON.stringify(form) }), onSuccess: () => setMessage(t('policySaved')), onError: (e) => setMessage(e instanceof Error ? e.message : t('unableToSave')) }); return <PageFrame title={t('groupSettingsTitle')} subtitle={t('groupSettingsSubtitle')}><section className="panel settings-panel"><div className="panel-head"><div><h2>{t('claimPolicy')}</h2><p>{t('claimPolicyNote')}</p></div><span className="settings-icon">⚙</span></div><label>{t('telegramGroupId')}<input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="-1001234567890" /></label><div className="settings-grid"><label>{t('minAccountAge')}<input type="number" min="0" value={form.minAccountAgeDays} onChange={(e) => setForm({ ...form, minAccountAgeDays: Number(e.target.value) })} /></label><label>{t('minGroupMessages')}<input type="number" min="0" value={form.minMessages} onChange={(e) => setForm({ ...form, minMessages: Number(e.target.value) })} /></label><label>{t('claimsPerDay')}<input type="number" min="0" value={form.maxClaimsPerDay} onChange={(e) => setForm({ ...form, maxClaimsPerDay: Number(e.target.value) })} /></label></div><label className="toggle-line"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /><span className="fake-toggle" />{t('allowEnvelopes')}</label>{message && <div className="alert success">{message}</div>}<button className="login-button save-button" disabled={!chatId || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? t('saving') : t('saveGroupPolicy')}</button></section><div className="info-callout"><strong>{t('howMessageChecksWork')}</strong><p>{t('howMessageChecksText')}</p></div></PageFrame>; }

function AuditPage() { const t = useT(); const query = useQuery({ queryKey: ['audit'], queryFn: () => adminApi<Array<{ id: string; action: string; entityType: string; entityId: string; actorId?: string; createdAt: string }>>('/api/admin/audit-logs') }); return <PageFrame title={t('auditTitle')} subtitle={t('auditSubtitle')}><section className="panel table-panel"><table><thead><tr><th>{t('colTime')}</th><th>{t('colAction')}</th><th>{t('colEntity')}</th><th>{t('colActor')}</th><th>{t('colRecord')}</th></tr></thead><tbody>{query.data?.map((log) => <tr key={log.id}><td><small>{date(log.createdAt)}</small></td><td><span className="audit-action">{log.action}</span></td><td>{log.entityType}</td><td><code>{log.actorId?.slice(0, 8) ?? t('system')}</code></td><td><code>{log.entityId.slice(0, 12)}</code></td></tr>)}</tbody></table>{!query.data?.length && <Empty text={t('noAuditEvents')} />}</section></PageFrame>; }
