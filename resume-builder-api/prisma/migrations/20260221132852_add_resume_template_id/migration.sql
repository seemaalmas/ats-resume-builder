-- AlterTable
ALTER TABLE "AppSetting" RENAME CONSTRAINT "AppSetting_new_pkey" TO "AppSetting_pkey",
ALTER COLUMN "updatedAt" DROP DEFAULT;
