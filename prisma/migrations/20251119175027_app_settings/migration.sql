-- AlterTable
ALTER TABLE "User" ALTER COLUMN "commissionPct" SET DEFAULT 10;

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL,
    "slotAutoGenerateCount" INTEGER NOT NULL DEFAULT 7,
    "defaultLdTimes" TEXT[],
    "defaultJpTimes" TEXT[],
    "defaultCommissionPct" DECIMAL(65,30) NOT NULL DEFAULT 10,
    "bidPrizeLD" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "bidPrizeJP" DECIMAL(65,30) NOT NULL DEFAULT 5,
    "winningPrizeLD" DECIMAL(65,30) NOT NULL DEFAULT 3300,
    "winningPrizeJP" DECIMAL(65,30) NOT NULL DEFAULT 10000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);
