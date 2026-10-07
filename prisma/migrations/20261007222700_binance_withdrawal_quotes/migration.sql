ALTER TABLE "Withdrawal"
  ADD COLUMN "payoutAmount" DECIMAL(18,8),
  ADD COLUMN "exchangeRateUsdt" DECIMAL(24,12),
  ADD COLUMN "exchangeRateSource" TEXT;
