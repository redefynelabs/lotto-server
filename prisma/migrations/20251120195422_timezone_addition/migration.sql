/*
  Warnings:

  - Added the required column `timezone` to the `AppSettings` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "timezone" TEXT NOT NULL;
