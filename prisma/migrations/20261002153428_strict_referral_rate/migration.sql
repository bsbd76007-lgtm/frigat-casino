-- AlterTable
ALTER TABLE "User" ALTER COLUMN "revSharePercentage" SET DEFAULT 10.00;


-- Move accounts still on the old 25% default to the new 10%. A custom cut an
-- admin set (anything other than exactly 25) is left as it is.
UPDATE "User" SET "revSharePercentage" = 10.00 WHERE "revSharePercentage" = 25.00;
