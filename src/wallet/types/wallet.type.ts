export enum WalletTxType {
  BID_CREDIT = 'BID_CREDIT',
  BID_DEBIT = 'BID_DEBIT',

  COMMISSION_CREDIT = 'COMMISSION_CREDIT',
  COMMISSION_SETTLEMENT = 'COMMISSION_SETTLEMENT',

  WIN_CREDIT = 'WIN_CREDIT',
  WIN_SETTLEMENT_ADMIN_TO_AGENT = 'WIN_SETTLEMENT_ADMIN_TO_AGENT',
  WIN_SETTLEMENT_AGENT_TO_USER = 'WIN_SETTLEMENT_AGENT_TO_USER',

  WITHDRAW = 'WITHDRAW',
}

export interface WalletTxMeta {
  transId?: string;
  proofUrl?: string;
  note?: string;
  requestedBy?: string;
  processedBy?: string;
  adminId?: string;
  slotId?: string;
  bidId?: string;
  jpNumbers?: number[];
  number?: number;
}
