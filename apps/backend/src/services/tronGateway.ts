import { TronWeb } from 'tronweb';
import { config } from '../config';

export type IncomingTransfer = { txHash: string; fromAddress: string; toAddress: string; amountMinor: bigint; timestamp: number; confirmations: number };

type TronTransferResponse = { data?: Array<{ transaction_id?: string; from?: string; to?: string; value?: string; block_timestamp?: number }>; meta?: { fingerprint?: string } };

export class TronGateway {
  private readonly tron: TronWeb;
  constructor() {
    this.tron = new TronWeb({
      fullHost: config.tron.fullHost,
      headers: config.tron.apiKey ? { 'TRON-PRO-API-KEY': config.tron.apiKey } : undefined,
      privateKey: config.tron.privateKey && !config.tron.privateKey.startsWith('replace-with') ? config.tron.privateKey : undefined
    });
  }

  private headers(): Record<string, string> {
    return config.tron.apiKey ? { 'TRON-PRO-API-KEY': config.tron.apiKey } : {};
  }

  async getCurrentBlock(): Promise<number> {
    const block = await this.tron.trx.getCurrentBlock();
    return Number((block as { block_header?: { raw_data?: { number?: number } } }).block_header?.raw_data?.number ?? 0);
  }

  async getUsdtBalance(address = config.tron.hotWalletAddress): Promise<bigint> {
    if (!address) return 0n;
    const contract = await this.tron.contract().at(config.tron.usdtContract);
    const value = await (contract as unknown as { balanceOf: (account: string) => { call: () => Promise<unknown> } }).balanceOf(address).call();
    return BigInt(typeof value === 'object' && value !== null && 'toString' in value ? String(value) : String(value));
  }

  async sendUsdt(toAddress: string, amountMinor: bigint): Promise<string> {
    if (!config.tron.privateKey || config.tron.privateKey.startsWith('replace-with')) throw new Error('Hot wallet signing key is not configured');
    const contract = await this.tron.contract().at(config.tron.usdtContract);
    const transfer = (contract as unknown as { transfer: (to: string, amount: string) => { send: (options: { feeLimit: number }) => Promise<string> } }).transfer(toAddress, amountMinor.toString());
    return transfer.send({ feeLimit: 100_000_000 });
  }

  async getTransactionInfo(txHash: string): Promise<{ blockNumber?: number; receipt?: { result?: string }; id?: string }> {
    return this.tron.trx.getTransactionInfo(txHash) as Promise<{ blockNumber?: number; receipt?: { result?: string }; id?: string }>;
  }

  async waitForConfirmations(txHash: string, confirmations = config.tron.confirmations, timeoutMs = 15 * 60_000): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const info = await this.getTransactionInfo(txHash);
      if (info.blockNumber !== undefined) {
        const current = await this.getCurrentBlock();
        if (current - info.blockNumber + 1 >= confirmations) {
          if (info.receipt?.result && info.receipt.result !== 'SUCCESS') throw new Error(`Tron transaction failed: ${info.receipt.result}`);
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
    throw new Error('Timed out waiting for Tron confirmations');
  }

  async findRecentOutgoingTransfer(toAddress: string, amountMinor: bigint, afterMs: number): Promise<string | undefined> {
    if (!config.tron.hotWalletAddress) return undefined;
    const params = new URLSearchParams({ limit: '200', only_confirmed: 'false', contract_address: config.tron.usdtContract, min_timestamp: String(afterMs) });
    const response = await fetch(`${config.tron.fullHost}/v1/accounts/${config.tron.hotWalletAddress}/transactions/trc20?${params.toString()}`, { headers: this.headers() });
    if (!response.ok) return undefined;
    const payload = await response.json() as TronTransferResponse;
    const match = payload.data?.find((transfer) => transfer.to === toAddress && BigInt(transfer.value ?? '0') === amountMinor && (transfer.block_timestamp ?? 0) >= afterMs);
    return match?.transaction_id;
  }

  async pollIncomingTransfers(sinceMs: number): Promise<IncomingTransfer[]> {
    if (!config.tron.hotWalletAddress) return [];
    const params = new URLSearchParams({ limit: '200', only_confirmed: 'false', contract_address: config.tron.usdtContract, min_timestamp: String(sinceMs) });
    const response = await fetch(`${config.tron.fullHost}/v1/accounts/${config.tron.hotWalletAddress}/transactions/trc20?${params.toString()}`, { headers: this.headers() });
    if (!response.ok) throw new Error(`TronGrid returned ${response.status}`);
    const payload = await response.json() as TronTransferResponse;
    const currentBlock = await this.getCurrentBlock();
    return (payload.data ?? []).filter((transfer) => transfer.to === config.tron.hotWalletAddress && transfer.transaction_id && transfer.from && transfer.value)
      .map((transfer) => ({ txHash: transfer.transaction_id as string, fromAddress: transfer.from as string, toAddress: transfer.to as string, amountMinor: BigInt(transfer.value as string), timestamp: transfer.block_timestamp ?? Date.now(), confirmations: 0 }))
      .map((transfer) => ({ ...transfer, confirmations: currentBlock > 0 ? config.tron.confirmations : 0 }));
  }
}

export const tronGateway = new TronGateway();
