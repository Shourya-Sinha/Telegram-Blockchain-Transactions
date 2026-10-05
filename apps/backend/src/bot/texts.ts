/**
 * Localized bot message templates. The locale comes from `User.locale`,
 * which the Mini App updates whenever the user switches the flag selector
 * (POST /api/locale). Missing locales fall back to English.
 */
export type BotLocale = 'en' | 'zh';

export const SUPPORTED_LOCALES: BotLocale[] = ['en', 'zh'];

export function normalizeLocale(value: string | null | undefined): BotLocale {
  return value === 'zh' ? 'zh' : 'en';
}

const en = {
  startWelcome: (telegramId: number | undefined) =>
    `Welcome to Red Envelope Wallet 🧧\n\nYour account is secured by Telegram ID ${telegramId}. Your display name and @username are profile labels only and never identify financial ownership.\n\nTap "🧧 Open Red Envelope Wallet" or the 💳 button next to the message input to open your Mini App any time.`,
  startGroup: '🧧 Red Envelope Wallet\n\nTap the button below to open your wallet (balance, history, withdrawals). It opens in your private chat with the bot — your details are never shown in the group.',
  walletButton: '🧧 Open Red Envelope Wallet',
  walletDetailsButton: '🧧 Open My Wallet',
  walletMiniButton: '🧧 Open Mini App',
  walletGroupButton: '🧧 Open My Wallet',
  groupWalletPrompt: '🧧 Tap the button below to open your wallet (balance, history, withdrawals). It opens in your private chat with the bot; your details were also sent there.',
  walletDetails:
    (available: string, locked: string) =>
      `💳 Available: ${available} USDT\n🔒 Locked/pending withdrawal: ${locked} USDT`,
  walletOpenApp: 'Open the Mini App for your full history, deposits and withdrawals.',
  claimAlert: (amount: string, balance: string) =>
    `You claimed ${amount} USDT! New available balance: ${balance} USDT. I sent your wallet details to our chat.`,
  claimDmTitle: '🧧 <b>Red envelope claimed</b>',
  claimDmClaimed: (amount: string) => `Claimed: <b>+${amount} USDT</b>`,
  claimDmAvailable: (available: string) => `Available: <b>${available} USDT</b>`,
  claimDmLocked: (locked: string) => `Locked/pending withdrawal: <b>${locked} USDT</b>`,
  claimDmOpenApp: 'Open the Mini App for your full history, deposit address and withdrawals.',
  claimDmHeader: '🧧 <b>Red envelope claimed</b>',
  openEnvelopeButton: '🧧 Open red envelope',
  openEnvelopePrompt: 'Open this red envelope in the Mini App, then tap the gold seal to claim and reveal your amount.',
  openEnvelopeAlert: 'Opening the red envelope…',
  testCurrencyWarning: 'This is test currency only — no real USDT is sent or received. Balances, claims and withdrawals are simulated for testing.',
  historyButton: '🕘 Full history in Mini App',
  historyFooter: 'Open the Mini App for your complete history and withdrawal status.',
  historyEmpty: 'No ledger activity yet. Open the Mini App to see deposits, claims and withdrawals once you start.',
  groupWalletButton: '💰 Open My Wallet · 打开钱包',
  withdrawDisabled: '⏸ Withdrawals are currently disabled.\n\nWhy: this deployment runs in test mode (FUNDS_MODE=test) and no required test address is configured. Real TRC20 payouts need FUNDS_MODE=real with the Tron hot-wallet setup.\n\nUntil then your balance can be used for test red envelopes.',
  withdrawTest: (address: string, min: string, fee: string) =>
    `🧪 Test withdrawal\n\nWithdrawals are simulated in test mode — nothing is sent on the blockchain.\nRequired test TRC20 address: ${address}\nMinimum: ${min} USDT · Fee: ${fee} USDT`,
  withdrawReal: 'Open your wallet to submit a TRC20 withdrawal. Minimum and network fee are shown before confirmation.',
  withdrawTestShort: (address: string) =>
    `🧪 Test withdrawals are simulated and must use the required test address ${address}.`,
  withdrawDisabledShort: '⏸ Withdrawals are disabled in test mode and no TEST_WITHDRAWAL_ADDRESS is configured. Your balance can be used for test red envelopes.'
} as const;

const zh = {
  startWelcome: (telegramId: number | undefined) =>
    `欢迎来到红包钱包 🧧\n\n您的账户由 Telegram ID ${telegramId} 安全保障。显示名称与 @用户名仅作为资料标签，绝不作为资金所有权的标识。\n\n点击「🧧 打开红包钱包」或输入框旁的 💳 按钮即可随时打开小程序。`,
  startGroup: '🧧 红包钱包\n\n点击下方按钮打开您的钱包（余额、历史记录、提现）。按钮将在与机器人的私聊中打开钱包——您的资产信息绝不会显示在群内。',
  walletButton: '🧧 打开红包钱包',
  walletDetailsButton: '🧧 打开我的钱包',
  walletMiniButton: '🧧 打开小程序',
  walletGroupButton: '🧧 打开我的钱包',
  groupWalletPrompt: '🧧 点击下方按钮打开您的钱包（余额、历史记录、提现）。按钮将在与机器人的私聊中打开钱包；您的资产详情也已发送至该私聊。',
  walletDetails:
    (available: string, locked: string) =>
      `💳 可用余额：${available} USDT\n🔒 锁定/提现处理中：${locked} USDT`,
  walletOpenApp: '打开小程序查看完整历史记录、充值与提现。',
  claimAlert: (amount: string, balance: string) =>
    `您领取了 ${amount} USDT！新的可用余额：${balance} USDT。钱包详情已发送至我们的私聊。`,
  claimDmTitle: '🧧 <b>红包已领取</b>',
  claimDmClaimed: (amount: string) => `领取金额：<b>+${amount} USDT</b>`,
  claimDmAvailable: (available: string) => `可用余额：<b>${available} USDT</b>`,
  claimDmLocked: (locked: string) => `锁定/提现处理中：<b>${locked} USDT</b>`,
  claimDmOpenApp: '打开小程序查看完整历史记录、充值地址与提现。',
  claimDmHeader: '🧧 <b>红包已领取</b>',
  openEnvelopeButton: '🧧 打开红包',
  openEnvelopePrompt: '请在小程序中打开这个红包，然后点击金色封印领取并显示金额。',
  openEnvelopeAlert: '正在打开红包…',
  testCurrencyWarning: '此为测试币——不会发送或接收真实 USDT。余额、领取与提现均为模拟测试。',
  historyButton: '🕘 在小程序中查看完整历史',
  historyFooter: '打开小程序查看完整历史记录与提现状态。',
  historyEmpty: '暂无账目记录。开始使用后，可在小程序中查看充值、领取与提现。',
  groupWalletButton: '💰 Open My Wallet · 打开钱包',
  withdrawDisabled: '⏸ 提现功能目前已停用。\n\n原因：当前部署运行于测试模式（FUNDS_MODE=test）且未配置指定的测试地址。真实的 TRC20 提现需要 FUNDS_MODE=real 以及波场热钱包环境。\n\n在此之前，您的余额可用于测试红包。',
  withdrawTest: (address: string, min: string, fee: string) =>
    `🧪 测试提现\n\n测试模式下的提现为模拟操作——不会向区块链发送任何交易。\n指定测试 TRC20 地址：${address}\n最低额度：${min} USDT · 手续费：${fee} USDT`,
  withdrawReal: '打开钱包提交 TRC20 提现申请。确认前会显示最低额度与网络手续费。',
  withdrawTestShort: (address: string) =>
    `🧪 测试提现为模拟操作，必须使用指定测试地址 ${address}。`,
  withdrawDisabledShort: '⏸ 测试模式下提现已停用，且未配置 TEST_WITHDRAWAL_ADDRESS。您的余额可用于测试红包。'
} as const;

export type BotTexts = typeof en;

export function botTexts(locale: BotLocale): BotTexts {
  return locale === 'zh' ? (zh as unknown as BotTexts) : en;
}
