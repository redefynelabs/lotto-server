-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "deviceId" TEXT,
ADD COLUMN     "ip" TEXT,
ADD COLUMN     "userAgent" TEXT,
ALTER COLUMN "expiresAt" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");
