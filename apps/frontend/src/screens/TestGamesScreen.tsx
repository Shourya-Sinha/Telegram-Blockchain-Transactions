import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ApiError } from '../api';
import { useT } from '../i18n';

type OddsEntry = {
  variant: 'SINGLE_MINE' | 'CHAIN_MINE' | 'NINE_MULTI_MINE';
  packetCount: 5 | 6 | 9;
  outcomeKey: string;
  label: string;
  multiplier: string;
  baseMultiplier?: string;
  inferred?: boolean;
  groupKey?: string;
};
type GameRound = {
  id: string;
  profileName: string;
  stakeMinMinor: string;
  stakeMaxMinor: string;
  variant: OddsEntry['variant'];
  packetCount: number;
  targetDigit: number;
  status: string;
  createdAt: string;
  betCount: number;
  odds: OddsEntry[];
};
type GameBet = {
  id: string;
  stakeMinor: string;
  outcomeKey: string;
  multiplierHundredths: number;
  isWin: boolean | null;
  payoutIncludesStakeMinor: string;
  payoutIsProfitMinor: string;
  selectedPayoutMinor: string | null;
  manualPayoutAt: string | null;
  round: { profileName: string; variant: string; packetCount: number; status: string; outcomeKey: string | null; payoutPolicySelected: string | null; createdAt: string; settledAt: string | null };
};
type AgentReport = {
  isAgent: boolean;
  agent?: { inviteCode: string; inviteUrl: string; commissionRateBps: number; active: boolean };
  totals?: { turnoverMinor: string; wins: number; losses: number; pendingBets: number; netIncludesStakeMinor: string; netIsProfitMinor: string; commissionMinor: string };
  referredPlayers?: Array<{ telegramId: string; firstName: string; username: string | null; turnoverMinor: string; wins: number; losses: number; pendingBets: number; netIncludesStakeMinor: string; netIsProfitMinor: string; commissionMinor: string }>;
};
type BetResponse = { potentialPayouts: { multiplierIncludesStakeMinor: string; multiplierIsProfitMinor: string; policy: 'SHOW_BOTH' } };

const money = (minor?: string | bigint | null) => {
  const amount = BigInt(minor ?? 0);
  const abs = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}${abs / 1_000_000n}.${(abs % 1_000_000n).toString().padStart(6, '0').slice(0, 2)}`;
};
const usdtInput = (minor: string) => {
  const value = BigInt(minor);
  const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${value / 1_000_000n}${fraction ? `.${fraction}` : ''}`;
};
const variantLabel = (variant: string) => variant.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());

export function TestGamesScreen() {
  const t = useT();
  const client = useQueryClient();
  const rounds = useQuery({ queryKey: ['test-game-rounds'], queryFn: () => api<GameRound[]>('/api/games/rounds') });
  const bets = useQuery({ queryKey: ['test-game-bets'], queryFn: () => api<GameBet[]>('/api/games/bets') });
  const agent = useQuery({ queryKey: ['agent-report'], queryFn: () => api<AgentReport>('/api/agent/me'), retry: false });

  return <main className="screen test-games-screen">
    <header className="topbar"><div><p className="eyebrow">{t('gamesEyebrow')}</p><h1>{t('gamesTitle')}</h1></div><span className="round-symbol">🎲</span></header>
    <section className="game-test-banner"><strong>{t('gamesTestOnly')}</strong><p>{t('gamesIntro')}</p></section>
    <section className="game-assumptions"><strong>{t('gamesAssumptionTitle')}</strong><p>{t('gamesAssumptionText')}</p><p>{t('gamesPosterNote')}</p></section>

    <section className="section test-rounds-section">
      <div className="section-heading"><div><h2>{t('openTestRounds')}</h2><p className="muted">{t('openTestRoundsHint')}</p></div><span className="status-pill">{rounds.data?.length ?? 0}</span></div>
      {rounds.isLoading && <p className="muted">{t('gamesLoading')}</p>}
      {rounds.isError && <div className="game-inline-warning">{(rounds.error as Error).message}</div>}
      {!rounds.isLoading && !rounds.isError && !rounds.data?.length && <p className="muted">{t('noOpenTestRounds')}</p>}
      <div className="test-round-list">{rounds.data?.map((round) => <TestRoundCard key={round.id} round={round} onBetCreated={() => {
        void client.invalidateQueries({ queryKey: ['test-game-rounds'] });
        void client.invalidateQueries({ queryKey: ['test-game-bets'] });
        void client.invalidateQueries({ queryKey: ['me'] });
      }} />)}</div>
    </section>

    <section className="section test-bet-history">
      <div className="section-heading"><div><h2>{t('yourGameBets')}</h2><p className="muted">{t('yourGameBetsHint')}</p></div></div>
      {bets.isLoading && <p className="muted">{t('gamesLoading')}</p>}
      {bets.isError && <div className="game-inline-warning">{(bets.error as Error).message}</div>}
      {!bets.isLoading && !bets.isError && !bets.data?.length && <p className="muted">{t('noGameBets')}</p>}
      <div className="test-bet-list">{bets.data?.map((bet) => <article className="test-bet-row" key={bet.id}>
        <div className="test-bet-top"><strong>{bet.round.profileName} · {bet.round.packetCount} {t('gamePackets')}</strong><span className={`game-result-pill ${bet.isWin === null ? 'pending' : bet.isWin ? 'won' : 'lost'}`}>{bet.isWin === null ? t('gamePending') : bet.isWin ? t('gameWon') : t('gameLost')}</span></div>
        <p>{t('gameBetDetails', { variant: variantLabel(bet.round.variant), outcome: bet.outcomeKey, stake: money(bet.stakeMinor), odds: (bet.multiplierHundredths / 100).toFixed(2) })}</p>
        {bet.isWin !== null && <div className="test-bet-payouts"><span>{t('payoutIncludesStake')}: <strong>{money(bet.payoutIncludesStakeMinor)} USDT</strong></span><span>{t('payoutPlusStake')}: <strong>{money(bet.payoutIsProfitMinor)} USDT</strong></span></div>}
        {bet.selectedPayoutMinor !== null && <small className="game-payout-status">{t('selectedManualPayout', { amount: money(bet.selectedPayoutMinor) })} · {bet.manualPayoutAt ? t('manualPayoutRecorded') : t('manualPayoutPending')}</small>}
      </article>)}</div>
    </section>

    {agent.data?.isAgent && agent.data.agent && agent.data.totals && <AgentDashboard report={agent.data} />}
    {agent.isError && <section className="section"><div className="game-inline-warning">{(agent.error as ApiError).message}</div></section>}
  </main>;
}

function TestRoundCard({ round, onBetCreated }: { round: GameRound; onBetCreated: () => void }) {
  const t = useT();
  const [outcomeKey, setOutcomeKey] = useState(round.odds[0]?.outcomeKey ?? '');
  const [stake, setStake] = useState(usdtInput(round.stakeMinMinor));
  const [message, setMessage] = useState('');
  const [payoutQuote, setPayoutQuote] = useState<BetResponse['potentialPayouts']>();
  const selected = round.odds.find((row) => row.outcomeKey === outcomeKey) ?? round.odds[0];
  const mutation = useMutation({
    mutationFn: () => api<BetResponse>(`/api/games/rounds/${round.id}/bets`, { method: 'POST', body: JSON.stringify({ outcomeKey, stake }) }),
    onSuccess: (response) => {
      setPayoutQuote(response.potentialPayouts);
      setMessage(t('testBetAccepted'));
      onBetCreated();
    },
    onError: (error) => setMessage((error as Error).message)
  });
  const groups = [...new Set(round.odds.map((row) => row.groupKey).filter((value): value is string => Boolean(value)))];

  return <article className="test-round-card">
    <div className="test-round-heading"><div><span className="game-round-eyebrow">{round.profileName}</span><h3>{variantLabel(round.variant)} · {round.packetCount} {t('gamePackets')}</h3><small>{t('targetDigitLabel', { digit: round.targetDigit })} · {round.betCount} {t('gameBetsCount')}</small></div><span className="status-pill live-pill">{t('gameOpen')}</span></div>
    <div className="test-game-limits"><span>{t('stakeLimit')}: <strong>{money(round.stakeMinMinor)}–{money(round.stakeMaxMinor)} test USDT</strong></span></div>
    <div className="test-game-odds"><strong>{t('availableOutcomes')}</strong><div>{groups.length > 0 && <small>{t('nineMultiOddsNote')}</small>}{round.odds.map((row) => <span key={row.outcomeKey} className={row.outcomeKey === outcomeKey ? 'selected' : ''} onClick={() => setOutcomeKey(row.outcomeKey)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setOutcomeKey(row.outcomeKey); }}>
      <b>{row.label}</b><em>{row.baseMultiplier ? `base ${row.baseMultiplier}× · ` : ''}{row.multiplier}×{row.inferred ? ` · ${t('inferredFromPoster')}` : ''}</em>
    </span>)}</div></div>
    <form className="test-bet-form" onSubmit={(event) => { event.preventDefault(); setMessage(''); setPayoutQuote(undefined); mutation.mutate(); }}>
      <label>{t('pickOutcome')}<select value={outcomeKey} onChange={(event) => setOutcomeKey(event.target.value)}>{round.odds.map((row) => <option key={row.outcomeKey} value={row.outcomeKey}>{row.label} · {row.multiplier}×</option>)}</select></label>
      <label>{t('testStake')}<input value={stake} onChange={(event) => setStake(event.target.value)} inputMode="decimal" placeholder={usdtInput(round.stakeMinMinor)} /></label>
      <button className="primary-button" disabled={mutation.isPending || !selected}>{mutation.isPending ? t('placingTestBet') : t('placeTestBet')}</button>
    </form>
    {message && <div className={payoutQuote ? 'game-inline-success' : 'game-inline-warning'}>{message}{payoutQuote && <small>{t('potentialManualPayouts', { includes: money(payoutQuote.multiplierIncludesStakeMinor), profit: money(payoutQuote.multiplierIsProfitMinor) })}</small>}</div>}
    <p className="game-no-auto-pay">{t('noAutoGamePayout')}</p>
  </article>;
}

function AgentDashboard({ report }: { report: AgentReport }) {
  const t = useT();
  const agent = report.agent!;
  const totals = report.totals!;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(agent.inviteUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setCopied(false); }
  };
  return <section className="section agent-dashboard">
    <div className="section-heading"><div><h2>{t('agentDashboardTitle')}</h2><p className="muted">{t('agentDashboardHint')}</p></div><span className="status-pill">{(agent.commissionRateBps / 100).toFixed(2)}%</span></div>
    <div className="agent-invite-card"><div><small>{t('yourInviteCode')}</small><strong>{agent.inviteCode}</strong></div><button onClick={() => void copy()}>{copied ? t('inviteCopied') : t('copyInviteLink')}</button></div>
    <div className="agent-invite-url">{agent.inviteUrl}</div>
    {!agent.active && <div className="game-inline-warning">{t('agentInactiveNotice')}</div>}
    <div className="agent-metrics"><div><span>{t('agentTurnover')}</span><strong>{money(totals.turnoverMinor)} USDT</strong></div><div><span>{t('agentWinsLosses')}</span><strong>{totals.wins} / {totals.losses}</strong></div><div><span>{t('agentCommissionReport')}</span><strong>{money(totals.commissionMinor)} USDT</strong></div><div><span>{t('agentPendingBets')}</span><strong>{totals.pendingBets}</strong></div></div>
    <div className="test-bet-payouts agent-net-pnl"><span>{t('netUnderIncludesStake')}: <strong>{money(totals.netIncludesStakeMinor)} USDT</strong></span><span>{t('netUnderProfitPlusStake')}: <strong>{money(totals.netIsProfitMinor)} USDT</strong></span></div>
    <p className="agent-commission-note">{t('commissionNotTransferred')}</p>
    <h3 className="agent-players-title">{t('referredPlayersTitle')}</h3>
    {!report.referredPlayers?.length && <p className="muted">{t('noReferredPlayers')}</p>}
    <div className="agent-player-list">{report.referredPlayers?.map((player) => <article key={player.telegramId}>
      <div><strong>{player.firstName}</strong><small>{player.username ? `@${player.username} · ` : ''}Telegram ID {player.telegramId}</small></div>
      <div><span>{t('agentTurnover')}</span><strong>{money(player.turnoverMinor)} USDT</strong></div>
      <div><span>{t('agentWinsLosses')}</span><strong>{player.wins} / {player.losses}</strong></div>
      <div><span>{t('agentCommissionReport')}</span><strong>{money(player.commissionMinor)} USDT</strong></div>
    </article>)}</div>
  </section>;
}
