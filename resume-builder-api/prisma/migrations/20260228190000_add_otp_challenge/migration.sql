-- Create OTP challenge table
CREATE TABLE "OtpChallenge" (
  "id" text PRIMARY KEY,
  "mobile" text NOT NULL,
  "otpHash" text NOT NULL,
  "expiresAt" timestamp(3) NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "lockedUntil" timestamp(3),
  "ip" text,
  "userAgent" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT now()
);
CREATE INDEX "OtpChallenge_mobile_idx" ON "OtpChallenge" ("mobile");
