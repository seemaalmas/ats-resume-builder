-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "refreshTokenHash" TEXT,
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "aiTokensUsed" INTEGER NOT NULL DEFAULT 0,
    "aiTokensLimit" INTEGER NOT NULL DEFAULT 20000,
    "atsScansUsed" INTEGER NOT NULL DEFAULT 0,
    "atsScansLimit" INTEGER NOT NULL DEFAULT 10,
    "resumesLimit" INTEGER NOT NULL DEFAULT 1,
    "pdfExportsUsed" INTEGER NOT NULL DEFAULT 0,
    "pdfExportsLimit" INTEGER NOT NULL DEFAULT 5,
    "usagePeriodStart" TIMESTAMP(3),
    "usagePeriodEnd" TIMESTAMP(3),
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripeCurrentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resume" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "skills" TEXT[],
    "summary" TEXT NOT NULL,
    "experience" JSONB NOT NULL,
    "education" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resume_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "Resume" ADD CONSTRAINT "Resume_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
