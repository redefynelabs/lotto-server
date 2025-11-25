/*
  Warnings:

  - You are about to drop the column `winningNumber` on the `results` table. All the data in the column will be lost.
  - Added the required column `winner` to the `results` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "results_resultDate_type_idx";

-- AlterTable
ALTER TABLE "results" DROP COLUMN "winningNumber",
ADD COLUMN     "winner" TEXT NOT NULL;
