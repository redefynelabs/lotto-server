/*
  Warnings:

  - You are about to drop the column `biddingWalletId` on the `WalletTx` table. All the data in the column will be lost.
  - You are about to drop the column `earningWalletId` on the `WalletTx` table. All the data in the column will be lost.
  - You are about to drop the column `walletType` on the `WalletTx` table. All the data in the column will be lost.
  - You are about to drop the `BiddingWallet` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EarningWallet` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `balanceAfter` to the `WalletTx` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `type` on the `WalletTx` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "WalletTxType" AS ENUM ('BID_CREDIT', 'BID_DEBIT', 'COMMISSION_CREDIT', 'COMMISSION_PAID', 'DEBT_ADJUST', 'WIN_CREDIT', 'WIN_PAID', 'WIN_CLEAR');

-- DropForeignKey
ALTER TABLE "BiddingWallet" DROP CONSTRAINT "BiddingWallet_userId_fkey";

-- DropForeignKey
ALTER TABLE "EarningWallet" DROP CONSTRAINT "EarningWallet_userId_fkey";

-- DropForeignKey
ALTER TABLE "WalletTx" DROP CONSTRAINT "WalletTx_biddingWalletId_fkey";

-- DropForeignKey
ALTER TABLE "WalletTx" DROP CONSTRAINT "WalletTx_earningWalletId_fkey";

-- DropIndex
DROP INDEX "WalletTx_walletType_walletId_idx";

-- AlterTable
ALTER TABLE "WalletTx" DROP COLUMN "biddingWalletId",
DROP COLUMN "earningWalletId",
DROP COLUMN "walletType",
ADD COLUMN     "balanceAfter" DECIMAL(65,30) NOT NULL,
ALTER COLUMN "walletId" SET DATA TYPE TEXT,
DROP COLUMN "type",
ADD COLUMN     "type" "WalletTxType" NOT NULL;

-- DropTable
DROP TABLE "BiddingWallet";

-- DropTable
DROP TABLE "EarningWallet";

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalBalance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "reservedWinning" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "WalletTx_walletId_idx" ON "WalletTx"("walletId");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTx" ADD CONSTRAINT "WalletTx_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
