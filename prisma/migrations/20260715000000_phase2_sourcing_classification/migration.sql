-- AlterTable
ALTER TABLE "Variant" ADD COLUMN     "sourcingType" TEXT,
ADD COLUMN     "reproRunSize" INTEGER,
ADD COLUMN     "reproMoq" INTEGER,
ADD COLUMN     "reproRunCost" DOUBLE PRECISION,
ADD COLUMN     "reproToolingNotes" TEXT;

-- CreateIndex
CREATE INDEX "Variant_shop_sourcingType_idx" ON "Variant"("shop", "sourcingType");
