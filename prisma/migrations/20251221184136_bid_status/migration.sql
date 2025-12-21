-- CreateEnum
CREATE TYPE "BidStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- AlterEnum
ALTER TYPE "WalletTxType" ADD VALUE 'COMMISSION_DEBIT';

-- AlterTable
ALTER TABLE "Bid" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "status" "BidStatus" NOT NULL DEFAULT 'ACTIVE';
