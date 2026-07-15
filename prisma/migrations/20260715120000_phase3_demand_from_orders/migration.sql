-- AlterTable
ALTER TABLE "Variant" ADD COLUMN     "velocity30" DOUBLE PRECISION,
ADD COLUMN     "velocity90" DOUBLE PRECISION,
ADD COLUMN     "velocity365" DOUBLE PRECISION,
ADD COLUMN     "velocityUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SyncState" ADD COLUMN     "bulkOperationType" TEXT,
ADD COLUMN     "lastOrdersSyncAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "VariantSalesDay" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariantSalesDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VariantSalesDay_shop_date_idx" ON "VariantSalesDay"("shop", "date");

-- CreateIndex
CREATE UNIQUE INDEX "VariantSalesDay_shop_variantId_date_key" ON "VariantSalesDay"("shop", "variantId", "date");

-- AddForeignKey
ALTER TABLE "VariantSalesDay" ADD CONSTRAINT "VariantSalesDay_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
