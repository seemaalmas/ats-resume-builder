CREATE TABLE "AppSetting_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rateLimitEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
    "paymentFeatureEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

DO
$$
BEGIN
  INSERT INTO "AppSetting_new" ("id", "rateLimitEnabled", "paymentFeatureEnabled", "createdAt", "updatedAt")
  SELECT
    'app-settings',
    CASE
      WHEN LOWER("value") IN ('true', '1', 'yes', 'on') THEN TRUE
      ELSE FALSE
    END,
    FALSE,
    NOW(),
    NOW()
  FROM "AppSetting"
  WHERE "key" = 'RESUME_CREATION_RATE_LIMIT_ENABLED'
  LIMIT 1;
EXCEPTION WHEN undefined_table THEN
  -- no existing AppSetting table to migrate
  NULL;
END;
$$;

INSERT INTO "AppSetting_new" ("id", "rateLimitEnabled", "paymentFeatureEnabled", "createdAt", "updatedAt")
SELECT 'app-settings', FALSE, FALSE, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "AppSetting_new");

DROP TABLE IF EXISTS "AppSetting";

ALTER TABLE "AppSetting_new" RENAME TO "AppSetting";
