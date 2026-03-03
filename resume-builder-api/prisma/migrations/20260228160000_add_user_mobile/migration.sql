-- Add mobile column
ALTER TABLE "User" ADD COLUMN "mobile" text;
CREATE UNIQUE INDEX "User_mobile_key" ON "User" ("mobile");
