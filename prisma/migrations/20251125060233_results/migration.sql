-- CreateTable
CREATE TABLE "Results" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "winningNumber" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Results_slotId_idx" ON "Results"("slotId");

-- AddForeignKey
ALTER TABLE "Results" ADD CONSTRAINT "Results_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "Slot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
