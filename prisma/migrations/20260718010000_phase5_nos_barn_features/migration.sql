-- AlterTable
ALTER TABLE "Variant" ADD COLUMN     "binLocation" TEXT,
ADD COLUMN     "crossRefs" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "CycleCountSession" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "CycleCountSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CycleCountItem" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "expectedQty" INTEGER NOT NULL,
    "countedQty" INTEGER,
    "verifiedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "CycleCountItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Variant_shop_binLocation_idx" ON "Variant"("shop", "binLocation");

-- CreateIndex
CREATE INDEX "CycleCountSession_shop_status_idx" ON "CycleCountSession"("shop", "status");

-- CreateIndex
CREATE INDEX "CycleCountItem_variantId_idx" ON "CycleCountItem"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "CycleCountItem_sessionId_variantId_key" ON "CycleCountItem"("sessionId", "variantId");

-- AddForeignKey
ALTER TABLE "CycleCountItem" ADD CONSTRAINT "CycleCountItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CycleCountSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleCountItem" ADD CONSTRAINT "CycleCountItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
