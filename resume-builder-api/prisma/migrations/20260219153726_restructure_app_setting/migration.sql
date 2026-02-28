-- AlterTable
DO $$
BEGIN
  BEGIN
    ALTER TABLE "AppSetting" RENAME CONSTRAINT "AppSetting_new_pkey" TO "AppSetting_pkey";
  EXCEPTION WHEN undefined_object THEN
    NULL;
  END;
END;
$$;
ALTER TABLE "AppSetting" ALTER COLUMN "updatedAt" DROP DEFAULT;
