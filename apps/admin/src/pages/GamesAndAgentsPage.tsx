import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi, type AdminAgentReport, type TestGameOddsEntry, type TestGameProfile, type TestGameRoundRecord } from '../api';

type Variant = TestGameOddsEntry['variant'];
type PayoutPolicy = 'MULTIPLIER_INCLUDES_STAKE' | 'MULTIPLIER_IS_PROFIT';
const money = (minor?: string | bigint | null) => {
  const amount = BigInt(minor ?? 0);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}${absolute / 1_000_000n}.${(absolute % 1_000_000n).toString().padStart(6, '0').slice(0, 2)}`;
};
const units = (minor: string) => {
  const value = BigInt(minor);
  const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${value / 1_000_000n}${fraction ? `.${fraction}` : ''}`;
};
const labelVariant = (variant: string) => variant.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
const defaultPacketCount = (variant: Variant) => variant === 'NINE_MULTI_MINE' ? 9 : 5;
const packetOptions = (variant: Variant) => variant === 'SINGLE_MINE' ? [5, 6, 9] : variant === 'CHAIN_MINE' ? [5, 6] : [9];
const moneyRate = (bps: number) => (bps / 100).toFixed(2);

export function GamesAndAgentsPage() {
  const client = useQueryClient();
  const mode = useQuery({ queryKey: ['testing'], queryFn: () => adminApi<{ fundsMode: 'test' | 'real' }>('/api/admin/testing') });
  const profiles = useQuery({ queryKey: ['test-game-profiles'], queryFn: () => adminApi<TestGameProfile[]>('/api/admin/test-games/profiles'), enabled: mode.data?.fundsMode === 'test' });
  const rounds = useQuery({ queryKey: ['test-game-admin-rounds'], queryFn: () => adminApi<TestGameRoundRecord[]>('/api/admin/test-games/rounds'), enabled: mode.data?.fundsMode === 'test' });
  const agents = useQuery({ queryKey: ['agents-admin'], queryFn: () => adminApi<AdminAgentReport[]>('/api/admin/agents'), enabled: mode.data?.fundsMode === 'test' });
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const selectedProfile = profiles.data?.find((profile) => profile.id === selectedProfileId) ?? profiles.data?.[0];
  const [variant, setVariant] = useState<Variant>('SINGLE_MINE');
  const [packetCount, setPacketCount] = useState(5);
  const [targetDigit, setTargetDigit] = useState(0);
  const [telegramId, setTelegramId] = useState('');
  const [commissionPercent, setCommissionPercent] = useState('0');
  const [agentMessage, setAgentMessage] = useState('');

  useEffect(() => {
    if (packetOptions(variant).includes(packetCount)) return;
    setPacketCount(defaultPacketCount(variant));
  }, [variant, packetCount]);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['test-game-profiles'] });
    void client.invalidateQueries({ queryKey: ['test-game-admin-rounds'] });
    void client.invalidateQueries({ queryKey: ['agents-admin'] });
    void client.invalidateQueries({ queryKey: ['audit'] });
  };
  const openRound = useMutation({
    mutationFn: () => adminApi('/api/admin/test-games/rounds', { method: 'POST', body: JSON.stringify({ profileId: selectedProfile!.id, variant, packetCount, targetDigit }) }),
    onSuccess: () => { setTargetDigit(0); refresh(); },
  });
  const createAgent = useMutation({
    mutationFn: () => {
      const rate = rateToBps(commissionPercent);
      return adminApi('/api/admin/agents', { method: 'POST', body: JSON.stringify({ telegramId: telegramId.trim(), commissionRateBps: rate, active: true }) });
    },
    onSuccess: () => { setAgentMessage('Agent created. Copy and share the invite link.'); setTelegramId(''); setCommissionPercent('0'); refresh(); },
    onError: (error) => setAgentMessage(error instanceof Error ? error.message : 'Unable to create agent.')
  });
  const isTestMode = mode.data?.fundsMode === 'test';

  return <div className="page-content games-admin-page">
    <header className="page-header"><div><p className="overline">TEST MODE ONLY</p><h1>Games & agents</h1><p>Editable poster odds, test rounds, manual payout reporting and referral turnover.</p></div><button className="refresh-button" onClick={refresh}>Refresh</button></header>
    {!mode.isLoading && !isTestMode && <div className="alert danger">Game and agent endpoints are disabled because FUNDS_MODE is not test. No real-funds game settlement is available.</div>}
    {mode.isError && <div className="alert danger">{(mode.error as Error).message}</div>}
    {isTestMode && <>
      <section className="panel test-games-safety-panel"><strong>Test credits only · no automatic winner/agent transfers</strong><p>Bet stakes are debited from the internal test wallet. Settlement calculates both possible payout totals; a winner is never credited automatically. Recording a manual transfer only saves a reference and never calls a payment rail.</p><p>The game outcome is entered by an admin; it is not derived from Telegram packet contents. Both payout interpretations remain informational until a boss-approved reference is recorded.</p></section>

      <section className="panel test-profile-admin-panel">
        <div className="panel-head"><div><h2>Editable poster profiles</h2><p>Profiles are kept separate because their odds and limits differ.</p></div></div>
        {profiles.isLoading && <p className="muted">Loading profiles…</p>}
        {profiles.isError && <div className="alert danger">{(profiles.error as Error).message}</div>}
        {profiles.data?.length ? <>
          <label className="admin-game-select">Profile<select value={selectedProfile?.id ?? ''} onChange={(event) => setSelectedProfileId(event.target.value)}>{profiles.data.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.active ? 'active' : 'inactive'}</option>)}</select></label>
          {selectedProfile && <ProfileEditor key={selectedProfile.id} profile={selectedProfile} onSaved={refresh} />}
        </> : null}
      </section>

      {selectedProfile && <section className="panel game-round-create-panel">
        <div className="panel-head"><div><h2>Open a test round</h2><p>New rounds take an immutable snapshot of the current profile odds and stake limits.</p></div></div>
        <div className="admin-round-form">
          <label>Game profile<select value={selectedProfile.id} onChange={(event) => setSelectedProfileId(event.target.value)}>{profiles.data?.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
          <label>Variant<select value={variant} onChange={(event) => setVariant(event.target.value as Variant)}><option value="SINGLE_MINE">Single mine</option><option value="CHAIN_MINE">Chain mine</option><option value="NINE_MULTI_MINE">9-packet multi-mine / lucky</option></select></label>
          <label>Packets<select value={packetCount} onChange={(event) => setPacketCount(Number(event.target.value))}>{packetOptions(variant).map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
          <label>Target digit<input type="number" min={0} max={9} value={targetDigit} onChange={(event) => setTargetDigit(Number(event.target.value))} /></label>
          <button className="login-button" disabled={openRound.isPending || !selectedProfile.active} onClick={() => openRound.mutate()}>{openRound.isPending ? 'Opening…' : 'Open round'}</button>
        </div>
        {openRound.isError && <div className="alert danger">{(openRound.error as Error).message}</div>}
        {!selectedProfile.active && <div className="alert warning">This profile is inactive. Activate it before opening a round.</div>}
      </section>}

      <section className="panel admin-round-list-panel">
        <div className="panel-head"><div><h2>Test round settlement & reports</h2><p>Both payout interpretations remain visible. No payout basis is live by default.</p></div><span className="status-pill">{rounds.data?.length ?? 0}</span></div>
        {rounds.isLoading && <p className="muted">Loading rounds…</p>}
        {rounds.isError && <div className="alert danger">{(rounds.error as Error).message}</div>}
        {!rounds.isLoading && !rounds.isError && !rounds.data?.length && <p className="muted">No test rounds have been opened.</p>}
        <div className="admin-round-list">{rounds.data?.map((round) => <AdminRoundCard key={round.id} round={round} onUpdated={refresh} />)}</div>
      </section>

      <section className="panel admin-agents-panel">
        <div className="panel-head"><div><h2>Agents & referral reports</h2><p>Invite attribution is first-touch. Commission is turnover-based, editable per agent, and defaults to 0%.</p></div></div>
        <form className="admin-agent-create" onSubmit={(event) => { event.preventDefault(); setAgentMessage(''); createAgent.mutate(); }}>
          <label>Existing player Telegram ID<input value={telegramId} onChange={(event) => setTelegramId(event.target.value.replace(/\D/g, '').slice(0, 20))} placeholder="Telegram ID" inputMode="numeric" /></label>
          <label>Commission rate (%)<input value={commissionPercent} onChange={(event) => setCommissionPercent(event.target.value)} inputMode="decimal" placeholder="0" /></label>
          <button className="table-action" disabled={createAgent.isPending || !telegramId || !isValidRate(commissionPercent)}>{createAgent.isPending ? 'Creating…' : 'Create agent'}</button>
        </form>
        {agentMessage && <div className={createAgent.isError ? 'alert danger' : 'alert success'}>{agentMessage}</div>}
        {agents.isError && <div className="alert danger">{(agents.error as Error).message}</div>}
        {agents.isLoading && <p className="muted">Loading agents…</p>}
        {!agents.isLoading && !agents.isError && !agents.data?.length && <p className="muted">No agents yet.</p>}
        <div className="admin-agent-list">{agents.data?.map((agent) => <AdminAgentCard key={agent.id} agent={agent} onUpdated={refresh} />)}</div>
      </section>
    </>}
  </div>;
}

function ProfileEditor({ profile, onSaved }: { profile: TestGameProfile; onSaved: () => void }) {
  const [name, setName] = useState(profile.name);
  const [stakeMin, setStakeMin] = useState(units(profile.stakeMinMinor));
  const [stakeMax, setStakeMax] = useState(units(profile.stakeMaxMinor));
  const [odds, setOdds] = useState(profile.odds);
  const [active, setActive] = useState(profile.active);
  const mutation = useMutation({
    mutationFn: () => adminApi(`/api/admin/test-games/profiles/${profile.id}`, { method: 'PUT', body: JSON.stringify({ name, stakeMin, stakeMax, odds, active }) }),
    onSuccess: onSaved
  });
  const updateOdds = (index: number, field: 'multiplier' | 'baseMultiplier', value: string) => setOdds((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  return <>
    <div className="admin-profile-fields">
      <label>Display name<input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} /></label>
      <label>Min stake · test USDT<input value={stakeMin} onChange={(event) => setStakeMin(event.target.value)} inputMode="decimal" /></label>
      <label>Max stake · test USDT<input value={stakeMax} onChange={(event) => setStakeMax(event.target.value)} inputMode="decimal" /></label>
      <label className="admin-checkbox"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Active for new rounds</label>
    </div>
    <div className="admin-profile-note">New round odds are snapshotted. Editing this profile will not change rounds already open or settled. The payout interpretation is not editable here; both remain informational.</div>
    <div className="table-panel admin-odds-table"><table><thead><tr><th>Mode</th><th>Packets</th><th>Outcome</th><th>Poster outcome</th><th>Base rate</th><th>Reward multiplier</th></tr></thead><tbody>
      {odds.map((row, index) => <tr key={`${row.variant}-${row.packetCount}-${row.outcomeKey}`}>
        <td>{labelVariant(row.variant)}</td><td>{row.packetCount}</td><td><code>{row.outcomeKey}</code></td><td>{row.label}{row.inferred ? <small>inferred</small> : null}</td>
        <td>{row.baseMultiplier !== undefined ? <input className="odds-input" aria-label={`Base multiplier ${row.outcomeKey}`} value={row.baseMultiplier} onChange={(event) => updateOdds(index, 'baseMultiplier', event.target.value)} /> : '—'}</td>
        <td><input className="odds-input" aria-label={`Reward multiplier ${row.outcomeKey}`} value={row.multiplier} onChange={(event) => updateOdds(index, 'multiplier', event.target.value)} /></td>
      </tr>)}
    </tbody></table></div>
    {mutation.isError && <div className="alert danger">{(mutation.error as Error).message}</div>}
    <div className="admin-profile-actions"><span>{mutation.isSuccess ? 'Saved. Existing round snapshots are unchanged.' : 'Multipliers accept up to two decimal places.'}</span><button className="table-action" disabled={mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? 'Saving…' : 'Save profile'}</button></div>
  </>;
}

function AdminRoundCard({ round, onUpdated }: { round: TestGameRoundRecord; onUpdated: () => void }) {
  const [outcomeKey, setOutcomeKey] = useState(round.outcomeKey ?? '');
  const [approvalReference, setApprovalReference] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const outcomes = round.oddsSnapshot.filter((row) => row.variant === round.variant && row.packetCount === round.packetCount);
  const settle = useMutation({
    mutationFn: () => adminApi(`/api/admin/test-games/rounds/${round.id}/settle`, { method: 'POST', body: JSON.stringify({ outcomeKey }) }),
    onSuccess: () => { setErrorMessage(''); onUpdated(); },
    onError: (error) => setErrorMessage((error as Error).message)
  });
  const setPolicy = useMutation({
    mutationFn: (policy: PayoutPolicy) => adminApi(`/api/admin/test-games/rounds/${round.id}/payout-policy`, { method: 'POST', body: JSON.stringify({ policy, approvalReference }) }),
    onSuccess: () => { setErrorMessage(''); onUpdated(); },
    onError: (error) => setErrorMessage((error as Error).message)
  });
  const recordPayout = useMutation({
    mutationFn: ({ betId, transferReference }: { betId: string; transferReference: string }) => adminApi(`/api/admin/test-games/bets/${betId}/manual-payout`, { method: 'POST', body: JSON.stringify({ transferReference }) }),
    onSuccess: () => { setErrorMessage(''); onUpdated(); },
    onError: (error) => setErrorMessage((error as Error).message)
  });
  const settled = round.status === 'SETTLED';
  const winningBets = round.bets.filter((bet) => bet.isWin === true);
  const sum = (field: 'payoutIncludesStakeMinor' | 'payoutIsProfitMinor') => winningBets.reduce((total, bet) => total + BigInt(bet[field]), 0n);
  const totalStakes = round.bets.reduce((total, bet) => total + BigInt(bet.stakeMinor), 0n);
  const totalCommission = round.bets.reduce((total, bet) => total + BigInt(bet.agentCommissionMinor), 0n);
  const markPaid = (betId: string) => {
    const transferReference = window.prompt('Manual transfer reference (this only records the reference; it does not send money):');
    if (transferReference?.trim()) recordPayout.mutate({ betId, transferReference: transferReference.trim() });
  };
  const approvePolicy = (policy: PayoutPolicy) => {
    if (!approvalReference.trim()) { setErrorMessage('Enter the boss approval reference first.'); return; }
    if (!window.confirm('Confirm the boss has approved this single payout interpretation. Both options will no longer be payable for this round.')) return;
    setPolicy.mutate(policy);
  };

  return <article className="admin-round-card">
    <div className="admin-round-card-head"><div><strong>{round.profileName} · {labelVariant(round.variant)} · {round.packetCount} packets</strong><small>Target digit {round.targetDigit} · {round.bets.length} bet(s) · stake {money(totalStakes)} USDT · agent commission report {money(totalCommission)} USDT</small><small>Round #{round.id.slice(0, 8)} · {new Date(round.createdAt).toLocaleString()}</small></div><span className={`status ${settled ? 'completed' : 'queued'}`}>{round.status}</span></div>
    {!settled && <div className="admin-round-settle"><label>Winning outcome<select value={outcomeKey} onChange={(event) => setOutcomeKey(event.target.value)}>{outcomes.map((row) => <option key={row.outcomeKey} value={row.outcomeKey}>{row.label} · {row.multiplier}×</option>)}</select></label><button className="table-action" disabled={settle.isPending || !outcomeKey} onClick={() => { if (window.confirm('Close this round and settle all test bets using the selected outcome?')) settle.mutate(); }}>{settle.isPending ? 'Settling…' : 'Record result & settle'}</button><small>Settlement records wins/losses and both candidate payout amounts. It does not pay winners.</small></div>}
    {settled && <>
      <div className="admin-round-settled-summary"><span>Recorded result: <strong>{outcomes.find((row) => row.outcomeKey === round.outcomeKey)?.label ?? round.outcomeKey}</strong></span><span>Winners / losses: <strong>{winningBets.length} / {round.bets.filter((bet) => bet.isWin === false).length}</strong></span><span>Candidate total · multiplier includes stake: <strong>{money(sum('payoutIncludesStakeMinor'))} USDT</strong></span><span>Candidate total · multiplier plus stake: <strong>{money(sum('payoutIsProfitMinor'))} USDT</strong></span></div>
      {!round.payoutPolicySelected ? <div className="admin-policy-box"><strong>Boss confirmation required before a manual payout basis is selected.</strong><p>Both amounts above are informational. Do not mark a manual transfer unless the boss has decided which interpretation applies.</p><label>Boss decision / approval reference<input value={approvalReference} onChange={(event) => setApprovalReference(event.target.value)} placeholder="Meeting note, ticket, or written decision reference" maxLength={200} /></label><div><button className="table-action" onClick={() => approvePolicy('MULTIPLIER_INCLUDES_STAKE')}>Use multiplier × stake</button><button className="table-action" onClick={() => approvePolicy('MULTIPLIER_IS_PROFIT')}>Use multiplier × stake + stake</button></div></div>
        : <div className="admin-policy-selected">Manual payout basis locked: <strong>{round.payoutPolicySelected === 'MULTIPLIER_INCLUDES_STAKE' ? 'multiplier × stake' : 'multiplier × stake + stake'}</strong><small>Approval reference: {round.payoutPolicyApprovalReference}</small></div>}
    </>}
    {errorMessage && <div className="alert danger">{errorMessage}</div>}
    {round.bets.length > 0 && <div className="table-panel admin-round-bets"><table><thead><tr><th>Player</th><th>Pick</th><th>Stake</th><th>Result</th><th>Both candidate payouts</th><th>Commission</th><th>Manual transfer record</th></tr></thead><tbody>{round.bets.map((bet) => <tr key={bet.id}>
      <td><strong>{bet.user.firstName}</strong><small>{bet.user.username ? `@${bet.user.username} · ` : ''}ID {bet.user.telegramId}</small></td>
      <td><code>{bet.outcomeKey}</code><small>{(bet.multiplierHundredths / 100).toFixed(2)}×</small></td>
      <td>{money(bet.stakeMinor)} USDT</td>
      <td>{bet.isWin === null ? 'Pending' : bet.isWin ? 'Won' : 'Lost'}</td>
      <td><small>includes stake: {money(bet.payoutIncludesStakeMinor)}</small><small>plus stake: {money(bet.payoutIsProfitMinor)}</small></td>
      <td>{money(bet.agentCommissionMinor)} USDT<small>{bet.agentCommissionRateBps / 100}% of turnover</small></td>
      <td>{bet.isWin !== true ? '—' : bet.manualPayoutAt ? <><strong>Recorded</strong><small>{money(bet.selectedPayoutMinor)} USDT · {bet.manualPayoutReference}</small></> : round.payoutPolicySelected && bet.selectedPayoutMinor ? <button className="table-action" disabled={recordPayout.isPending} onClick={() => markPaid(bet.id)}>Record manual payout · {money(bet.selectedPayoutMinor)} USDT</button> : <small>Await boss decision</small>}</td>
    </tr>)}</tbody></table></div>}
  </article>;
}

function AdminAgentCard({ agent, onUpdated }: { agent: AdminAgentReport; onUpdated: () => void }) {
  const client = useQueryClient();
  const [rate, setRate] = useState(moneyRate(agent.commissionRateBps));
  const [active, setActive] = useState(agent.active);
  const [copied, setCopied] = useState(false);
  const mutation = useMutation({
    mutationFn: () => adminApi(`/api/admin/agents/${agent.id}`, { method: 'PUT', body: JSON.stringify({ commissionRateBps: rateToBps(rate), active }) }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['agents-admin'] }); void client.invalidateQueries({ queryKey: ['audit'] }); onUpdated(); }
  });
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(agent.inviteUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setCopied(false); }
  };
  return <article className="admin-agent-card">
    <div className="admin-agent-card-head"><div><strong>{agent.user.firstName}{agent.user.username ? ` · @${agent.user.username}` : ''}</strong><small>Telegram ID {agent.user.telegramId} · code {agent.inviteCode}</small><a href={agent.inviteUrl} target="_blank" rel="noreferrer">{agent.inviteUrl}</a></div><span className={`status ${agent.active ? 'active' : 'failed'}`}>{agent.active ? 'ACTIVE' : 'INACTIVE'}</span></div>
    <div className="admin-agent-controls"><label>Turnover commission (%)<input value={rate} onChange={(event) => setRate(event.target.value)} inputMode="decimal" /></label><label className="admin-checkbox"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Accept new referrals</label><button className="table-action" disabled={mutation.isPending || !isValidRate(rate)} onClick={() => mutation.mutate()}>{mutation.isPending ? 'Saving…' : 'Save rate/status'}</button><button className="table-action" onClick={() => void copyLink()}>{copied ? 'Copied' : 'Copy invite link'}</button></div>
    {mutation.isError && <div className="alert danger">{(mutation.error as Error).message}</div>}
    <div className="agent-report-metrics"><span>Referred turnover <strong>{money(agent.totals.turnoverMinor)} USDT</strong></span><span>Wins / losses <strong>{agent.totals.wins} / {agent.totals.losses}</strong></span><span>Commission report <strong>{money(agent.totals.commissionMinor)} USDT</strong></span><span>Unsettled <strong>{agent.totals.pendingBets}</strong></span><span>Net · includes stake <strong>{money(agent.totals.netIncludesStakeMinor)} USDT</strong></span><span>Net · plus stake <strong>{money(agent.totals.netIsProfitMinor)} USDT</strong></span></div>
    <details className="admin-agent-referrals"><summary>Referred players ({agent.referredPlayers.length})</summary><div className="table-panel"><table><thead><tr><th>Player</th><th>Turnover</th><th>Wins / losses</th><th>Commission report</th><th>Net · both interpretations</th></tr></thead><tbody>{agent.referredPlayers.map((player) => <tr key={player.telegramId}><td><strong>{player.firstName}</strong><small>{player.username ? `@${player.username} · ` : ''}ID {player.telegramId}</small></td><td>{money(player.turnoverMinor)} USDT</td><td>{player.wins} / {player.losses}<small>{player.pendingBets} pending</small></td><td>{money(player.commissionMinor)} USDT</td><td><small>includes stake: {money(player.netIncludesStakeMinor)}</small><small>plus stake: {money(player.netIsProfitMinor)}</small></td></tr>)}</tbody></table></div></details>
  </article>;
}

function isValidRate(value: string) {
  return /^(?:\d{1,2}(?:\.\d{1,2})?|100(?:\.0{1,2})?)$/.test(value.trim());
}
function rateToBps(value: string) {
  if (!isValidRate(value)) throw new Error('Commission rate must be 0–100 with up to two decimals.');
  return Math.round(Number(value) * 100);
}
