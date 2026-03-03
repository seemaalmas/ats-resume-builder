-- Add admin marker for mobile OTP allowlist handling
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isAdmin" boolean NOT NULL DEFAULT false;
