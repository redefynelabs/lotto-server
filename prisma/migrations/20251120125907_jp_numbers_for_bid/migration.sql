/*
  Warnings:

  - Made the column `customerName` on table `Bid` required. This step will fail if there are existing NULL values in that column.
  - Made the column `customerPhone` on table `Bid` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "Bid_slotId_number_idx";

-- AlterTable
ALTER TABLE "Bid" ADD COLUMN     "jpNumbers" INTEGER[],
ALTER COLUMN "customerName" SET NOT NULL,
ALTER COLUMN "customerPhone" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Bid_slotId_idx" ON "Bid"("slotId");
