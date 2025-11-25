/*
  Warnings:

  - You are about to drop the `Results` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Results" DROP CONSTRAINT "Results_slotId_fkey";

-- DropTable
DROP TABLE "Results";

-- CreateTable
CREATE TABLE "results" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "uniqueSlotId" TEXT,
    "type" TEXT NOT NULL,
    "winningNumber" TEXT NOT NULL,
    "resultDate" TIMESTAMP(3) NOT NULL,
    "slotTime" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "results_resultDate_idx" ON "results"("resultDate");

-- CreateIndex
CREATE INDEX "results_type_idx" ON "results"("type");

-- CreateIndex
CREATE INDEX "results_resultDate_type_idx" ON "results"("resultDate", "type");

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "results_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "Slot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
