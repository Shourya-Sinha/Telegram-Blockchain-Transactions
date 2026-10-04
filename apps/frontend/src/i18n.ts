import { create } from 'zustand';
import { api } from './api';

/**
 * Mini App language: English (en 🇬🇧) and Simplified Chinese (zh 🇨🇳).
 * The chosen flag is persisted locally and pushed to the backend
 * (POST /api/locale) so bot messages — including the post-claim wallet
 * message — follow the same language.
 */
export type Lang = 'en' | 'zh';

export const LANGUAGES: Array<{ code: Lang; flag: string; label: string }> = [
  { code: 'en', flag: '🇬🇧', label: 'EN' },
  { code: 'zh', flag: '🇨🇳', label: 'ZH' }
];

const STORAGE_KEY = 'tma-lang';

function detectLanguage(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'zh') return stored;
    const code = window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
    if (code && code.toLowerCase().startsWith('zh')) return 'zh';
  } catch { /* storage can be unavailable in some WebViews */ }
  return 'en';
}

interface LangState {
  lang: Lang;
  setLang: (lang: Lang, options?: { sync?: boolean }) => void;
}

export const useLang = create<LangState>((set) => ({
  lang: detectLanguage(),
  setLang: (lang, options) => {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
    set({ lang });
    if (options?.sync !== false) {
      // Best-effort: keeps bot messages in the chosen language. In preview
      // mode (no Telegram auth) this 401s and is silently ignored.
      void api('/api/locale', { method: 'POST', body: JSON.stringify({ locale: lang }) }).catch(() => undefined);
    }
  }
}));

const en = {
  yourPortfolio: 'YOUR PORTFOLIO',
  greetingMorning: 'Good morning, {name}',
  greetingAfternoon: 'Good afternoon, {name}',
  greetingEvening: 'Good evening, {name}',
  testMode: 'TEST MODE',
  testBannerTestWithdraw: 'Test USDT only · withdrawals are simulated to the required test address',
  testBannerDisabled: 'Test USDT only · blockchain deposits and withdrawals are disabled',
  testBalance: 'Test balance',
  totalBalance: 'Total balance',
  demo: 'Demo',
  live: 'Live',
  usdAvailable: '≈ {amount} USDT available',
  pending: '🔒 {amount} pending',
  deposit: 'Deposit',
  withdraw: 'Withdraw',
  withdrawTest: 'Withdraw (test)',
  history: 'History',
  transfer: 'Transfer',
  assets: 'Assets',
  manage: 'Manage',
  tether: 'Tether',
  recentActivity: 'Recent activity',
  seeAll: 'See all',
  activityEmptyTitle: 'Your activity will appear here',
  activityEmptyHint: 'Deposit or claim a red envelope to begin',
  ledgerTypeDeposit: 'Deposit',
  ledgerTypeClaim: 'Red envelope claim',
  ledgerTypeWithdrawal: 'Withdrawal',
  ledgerTypeFee: 'Fee',
  ledgerTypeRefund: 'Refund',
  ledgerTypeTransfer: 'Transfer',
  historyTitle: 'History',
  backToWallet: '‹ Wallet',
  withdrawals: 'Withdrawals',
  allActivity: 'All activity',
  loadingWithdrawals: 'Loading withdrawals…',
  loadingActivity: 'Loading activity…',
  noWithdrawals: 'No withdrawals yet',
  noWithdrawalsHint: 'Withdrawal requests and their status appear here',
  withdrawalTestTag: ' · test',
  simulatedTag: ' · simulated',
  feeLabel: 'fee {amount}',
  txLabel: 'tx {hash}',
  testHistoryWarning: 'This is test currency only — history shows simulated activity.',
  withdrawDisabledHint: 'Withdrawals are temporarily disabled.',
  statusQueued: 'Queued',
  statusProcessing: 'Processing',
  statusBroadcast: 'Broadcast',
  statusConfirming: 'Confirming',
  statusCompleted: 'Completed',
  statusFailed: 'Failed',
  statusRejected: 'Rejected',
  withdrawTitle: 'Withdraw USDT',
  withdrawTestTitle: 'Withdraw USDT (Test)',
  testCurrencyWarning: 'This is test currency only — no real USDT is sent or received. Balances, claims and withdrawals are simulated for testing.',
  amount: 'Amount',
  destinationAddress: 'TRC20 destination address',
  requiredTestAddress: 'Required test TRC20 address (locked in test mode)',
  networkFee: 'Network fee',
  youWillReceive: 'You will receive',
  totalDeducted: 'Total deducted',
  confirmWithdrawal: 'Confirm withdrawal',
  confirmTestWithdrawal: 'Confirm test withdrawal',
  submitting: 'Submitting…',
  minWithdrawalError: 'Minimum withdrawal is {min} USDT.',
  invalidAddressError: 'Enter a valid TRON address.',
  testWithdrawSuccess: 'Test withdrawal completed — simulated only. Test currency: no real USDT was sent. See it in History › Withdrawals.',
  withdrawSuccess: 'Withdrawal queued securely. You can follow its status in History › Withdrawals.',
  autoApprovalNote: 'Withdrawals below 50 USDT are processed automatically. Larger requests may require finance approval.',
  testWithdrawNote: 'Test mode: withdrawals are simulated and only the required test address above is accepted. No blockchain transaction is made.',
  depositTitle: 'Deposit USDT',
  addressUnavailable: 'Address unavailable',
  depositHint: 'Only send USDT using the TRC20 network. Deposits need {confirmations} confirmations.',
  copy: 'Copy',
  copied: 'Copied',
  configureDepositAddress: 'Configure a deposit address',
  depositWarning: 'Sending another token or network may result in permanent loss. Double-check the address before sending.',
  claimTitle: 'A little luck for you',
  claimOpening: 'Opening your envelope…',
  claimOpeningHint: 'The amount is selected fairly and recorded atomically.',
  claimAdded: 'Added to your available wallet balance.',
  done: 'Done',
  envelopeGone: 'This envelope is no longer available.',
  claimInTelegram: 'Open the wallet inside Telegram to claim.',
  redEnvelopeGeneric: 'Red envelope',
  redEnvelopeFrom: '{name}’s red envelope',
  fromSender: 'From {name}',
  envelopeSent: 'Sent red envelope',
  envelopeRefunded: 'Expired · refunded',
  blessing: 'Wishing you fortune and joy 🧧',
  tapToOpen: 'Tap the seal to open',
  modeRandom: 'lucky draw',
  modeEqual: 'even split',
  sharesLabel: '{count} shares',
  claimsProgress: '{claimed}/{total} claimed',
  claimDetails: 'Claim details',
  youLabel: 'You',
  alreadyClaimedNote: 'You already opened this envelope.',
  envelopeFullyClaimed: 'Too slow — every share was already claimed.',
  envelopeExpiredMsg: 'This envelope expired. The rest went back to its sender.',
  navWallet: 'Wallet',
  navDefi: 'DeFi',
  navYield: 'Yield',
  navApps: 'Apps',
  previewMode: 'Preview mode · open inside Telegram for live data',
  ledgerOnline: 'Custodial ledger online',
  defiEyebrow: 'COMMUNITY FINANCE',
  defiTitle: 'DeFi & Red Envelopes',
  defiBannerEyebrow: 'TELEGRAM NATIVE',
  defiBannerTitle: 'Share a little luck.',
  defiBannerText: 'Turn your USDT balance into a fair, instant community moment.',
  createEnvelope: 'Create red envelope',
  createEnvelopeHint: 'Funds are debited atomically, then the bot posts the claim button.',
  telegramGroup: 'Telegram group',
  selectGroup: 'Select a registered group',
  noGroups: 'No groups are registered. Add the bot to a group and run /registergroup there first.',
  totalUsdt: 'Total USDT',
  claims: 'Claims',
  distribution: 'Distribution',
  randomShares: 'Random shares',
  equalShares: 'Equal shares',
  postEnvelope: 'Post envelope to group',
  fundingPosting: 'Funding and posting…',
  envelopePosted: 'Envelope {id} was posted in the Telegram group.',
  envelopeFailed: 'Unable to create envelope.',
  selectGroupFirst: 'Select the Telegram group where the bot should post the claim button.',
  howClaimsWork: 'How claims work',
  ledgerVerified: 'Ledger verified',
  claimsWorkTitle: 'Members tap the group button',
  claimsWorkText: 'Telegram verifies their identity and one share is credited to their wallet',
  yieldEyebrow: 'MAKE YOUR BALANCE WORK',
  yieldTitle: 'Yield',
  goldVault: 'GOLD TOKEN VAULT',
  earnYield: 'Earn 2.38%',
  goldTokenYield: 'Gold Token Yield',
  yieldText: 'Put your idle USDT to work while keeping full visibility over every movement.',
  exploreYield: 'Explore yield',
  estimatedApy: 'Estimated APY',
  lockup: 'Lockup',
  flexible: 'Flexible',
  comingSoon: 'Coming soon',
  beta: 'BETA',
  yieldNote: 'Yield products will launch after the custody reserve, risk controls, and transparent strategy reporting have been reviewed.',
  appsEyebrow: 'TELEGRAM ECOSYSTEM',
  appsTitle: 'Apps',
  appsTitleText: 'More ways to use your wallet',
  appsText: 'Mini Apps, communities, and helpful tools are on their way.',
  buildingFuture: 'BUILDING THE FUTURE',
  telegramMiniApps: 'Telegram Mini Apps',
  miniAppsText: 'Seamless in-chat experiences',
  partnerNetwork: 'Partner network',
  partnerText: 'Explore verified integrations',
  soon: 'Soon',
  languageLabel: 'Language'
} as const;

export type TranslationKey = keyof typeof en;

const zh: Record<TranslationKey, string> = {
  yourPortfolio: '您的资产组合',
  greetingMorning: '早上好，{name}',
  greetingAfternoon: '下午好，{name}',
  greetingEvening: '晚上好，{name}',
  testMode: '测试模式',
  testBannerTestWithdraw: '仅测试 USDT · 提现将模拟发送至指定测试地址',
  testBannerDisabled: '仅测试 USDT · 区块链充值与提现已停用',
  testBalance: '测试余额',
  totalBalance: '总余额',
  demo: '演示',
  live: '实盘',
  usdAvailable: '≈ 可用 {amount} USDT',
  pending: '🔒 {amount} 处理中',
  deposit: '充值',
  withdraw: '提现',
  withdrawTest: '提现（测试）',
  history: '历史',
  transfer: '转账',
  assets: '资产',
  manage: '管理',
  tether: '泰达币',
  recentActivity: '近期动态',
  seeAll: '查看全部',
  activityEmptyTitle: '您的动态将显示在这里',
  activityEmptyHint: '充值或领取红包即可开始',
  ledgerTypeDeposit: '充值',
  ledgerTypeClaim: '红包领取',
  ledgerTypeWithdrawal: '提现',
  ledgerTypeFee: '手续费',
  ledgerTypeRefund: '退款',
  ledgerTypeTransfer: '转账',
  historyTitle: '交易历史',
  backToWallet: '‹ 返回钱包',
  withdrawals: '提现记录',
  allActivity: '全部动态',
  loadingWithdrawals: '正在加载提现记录…',
  loadingActivity: '正在加载动态…',
  noWithdrawals: '暂无提现记录',
  noWithdrawalsHint: '提现请求及其状态将显示在这里',
  withdrawalTestTag: ' · 测试',
  simulatedTag: ' · 模拟',
  feeLabel: '手续费 {amount}',
  txLabel: '交易 {hash}',
  testHistoryWarning: '仅为测试币——历史记录为模拟数据。',
  withdrawDisabledHint: '提现功能暂时停用。',
  statusQueued: '排队中',
  statusProcessing: '处理中',
  statusBroadcast: '已广播',
  statusConfirming: '确认中',
  statusCompleted: '已完成',
  statusFailed: '失败',
  statusRejected: '已拒绝',
  withdrawTitle: '提现 USDT',
  withdrawTestTitle: '提现 USDT（测试）',
  testCurrencyWarning: '此为测试币——不会发送或接收真实 USDT。余额、领取与提现均为模拟测试。',
  amount: '金额',
  destinationAddress: 'TRC20 收款地址',
  requiredTestAddress: '指定测试 TRC20 地址（测试模式下锁定）',
  networkFee: '网络手续费',
  youWillReceive: '您将收到',
  totalDeducted: '总计扣除',
  confirmWithdrawal: '确认提现',
  confirmTestWithdrawal: '确认测试提现',
  submitting: '提交中…',
  minWithdrawalError: '最低提现额度为 {min} USDT。',
  invalidAddressError: '请输入有效的 TRON（波场）地址。',
  testWithdrawSuccess: '测试提现已完成——仅为模拟。测试币：未发送真实 USDT。可在 历史 › 提现记录 中查看。',
  withdrawSuccess: '提现请求已安全提交。可在 历史 › 提现记录 中跟踪状态。',
  autoApprovalNote: '低于 50 USDT 的提现将自动处理；更大金额可能需要财务审批。',
  testWithdrawNote: '测试模式：提现为模拟操作，仅接受上方指定的测试地址，不会产生区块链交易。',
  depositTitle: '充值 USDT',
  addressUnavailable: '地址不可用',
  depositHint: '请仅通过 TRC20 网络发送 USDT。充值需要 {confirmations} 次确认。',
  copy: '复制',
  copied: '已复制',
  configureDepositAddress: '请先配置充值地址',
  depositWarning: '发送其他代币或使用其他网络可能导致资产永久丢失。发送前请仔细核对地址。',
  claimTitle: '一份小惊喜',
  claimOpening: '正在开启您的红包…',
  claimOpeningHint: '金额公平分配并原子化记账。',
  claimAdded: '已计入您的可用余额。',
  done: '完成',
  envelopeGone: '该红包已被领完。',
  claimInTelegram: '请在 Telegram 内打开钱包后领取。',
  redEnvelopeGeneric: '红包',
  redEnvelopeFrom: '{name} 的红包',
  fromSender: '来自 {name}',
  envelopeSent: '发出的红包',
  envelopeRefunded: '已过期 · 已退款',
  blessing: '恭喜发财，大吉大利 🧧',
  tapToOpen: '点击红包拆开',
  modeRandom: '拼手气',
  modeEqual: '平均',
  sharesLabel: '{count} 份',
  claimsProgress: '已领 {claimed}/{total}',
  claimDetails: '领取记录',
  youLabel: '我',
  alreadyClaimedNote: '该红包你已领取过。',
  envelopeFullyClaimed: '手慢了，红包已被领完。',
  envelopeExpiredMsg: '该红包已过期，剩余金额已退回发送者。',
  navWallet: '钱包',
  navDefi: 'DeFi',
  navYield: '收益',
  navApps: '应用',
  previewMode: '预览模式 · 在 Telegram 内打开查看实时数据',
  ledgerOnline: '托管账本在线',
  defiEyebrow: '社区金融',
  defiTitle: 'DeFi 与红包',
  defiBannerEyebrow: 'TELEGRAM 原生',
  defiBannerTitle: '分享一份好运。',
  defiBannerText: '将您的 USDT 余额变成公平、即时的社区互动。',
  createEnvelope: '创建红包',
  createEnvelopeHint: '资金原子化扣除后，机器人会在群内发布领取按钮。',
  telegramGroup: 'Telegram 群组',
  selectGroup: '选择已注册的群组',
  noGroups: '尚未注册群组。请先将机器人添加到群组并在群内运行 /registergroup。',
  totalUsdt: '总额 USDT',
  claims: '份数',
  distribution: '分配方式',
  randomShares: '随机分配',
  equalShares: '平均分配',
  postEnvelope: '发布红包到群组',
  fundingPosting: '正在注资并发布…',
  envelopePosted: '红包 {id} 已发布到 Telegram 群组。',
  envelopeFailed: '无法创建红包。',
  selectGroupFirst: '请选择机器人发布领取按钮的 Telegram 群组。',
  howClaimsWork: '领取原理',
  ledgerVerified: '账本已验证',
  claimsWorkTitle: '成员点击群内按钮',
  claimsWorkText: 'Telegram 验证身份后，一份金额立即计入其钱包',
  yieldEyebrow: '让余额增值',
  yieldTitle: '收益',
  goldVault: '黄金代币金库',
  earnYield: '赚取 2.38%',
  goldTokenYield: '黄金代币收益',
  yieldText: '让闲置 USDT 为您工作，同时每笔资金流动透明可见。',
  exploreYield: '探索收益',
  estimatedApy: '预估年化',
  lockup: '锁仓期',
  flexible: '灵活',
  comingSoon: '即将上线',
  beta: '测试版',
  yieldNote: '收益产品将在托管储备、风险控制与透明策略报告审查完成后上线。',
  appsEyebrow: 'TELEGRAM 生态',
  appsTitle: '应用',
  appsTitleText: '更多使用钱包的方式',
  appsText: '小程序、社区与实用工具即将上线。',
  buildingFuture: '构建未来',
  telegramMiniApps: 'Telegram 小程序',
  miniAppsText: '无缝的聊天内体验',
  partnerNetwork: '合作伙伴网络',
  partnerText: '探索认证集成',
  soon: '即将推出',
  languageLabel: '语言'
};

const dictionaries: Record<Lang, Record<TranslationKey, string>> = { en, zh };

export type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

export function useT(): Translate {
  const lang = useLang((state) => state.lang);
  return (key, params) => {
    let text: string = dictionaries[lang][key] ?? dictionaries.en[key] ?? key;
    if (params) for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  };
}

export function ledgerTypeLabel(t: Translate, type: string): string {
  const map: Record<string, TranslationKey> = {
    DEPOSIT: 'ledgerTypeDeposit',
    CLAIM: 'ledgerTypeClaim',
    WITHDRAWAL: 'ledgerTypeWithdrawal',
    FEE: 'ledgerTypeFee',
    REFUND: 'ledgerTypeRefund',
    TRANSFER: 'ledgerTypeTransfer'
  };
  return map[type] ? t(map[type]) : type[0] + type.slice(1).toLowerCase();
}

export function withdrawalStatusLabel(t: Translate, status: string): string {
  const map: Record<string, TranslationKey> = {
    QUEUED: 'statusQueued',
    PROCESSING: 'statusProcessing',
    BROADCAST: 'statusBroadcast',
    CONFIRMING: 'statusConfirming',
    COMPLETED: 'statusCompleted',
    FAILED: 'statusFailed',
    REJECTED: 'statusRejected'
  };
  return map[status] ? t(map[status]) : status;
}

export function greetingKey(): TranslationKey {
  const hour = new Date().getHours();
  if (hour < 12) return 'greetingMorning';
  if (hour < 18) return 'greetingAfternoon';
  return 'greetingEvening';
}
