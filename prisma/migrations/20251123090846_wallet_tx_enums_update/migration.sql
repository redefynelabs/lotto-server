/*
  Warnings:

  - The values [COMMISSION_PAID,WIN_PAID,WIN_CLEAR] on the enum `WalletTxType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "WalletTxType_new" AS ENUM ('BID_CREDIT', 'BID_DEBIT', 'COMMISSION_CREDIT', 'COMMISSION_SETTLEMENT', 'WIN_CREDIT', 'WIN_SETTLEMENT_ADMIN_TO_AGENT', 'WIN_SETTLEMENT_AGENT_TO_USER', 'WITHDRAW');
ALTER TABLE "WalletTx" ALTER COLUMN "type" TYPE "WalletTxType_new" USING ("type"::text::"WalletTxType_new");
ALTER TYPE "WalletTxType" RENAME TO "WalletTxType_old";
ALTER TYPE "WalletTxType_new" RENAME TO "WalletTxType";
DROP TYPE "public"."WalletTxType_old";
COMMIT;
