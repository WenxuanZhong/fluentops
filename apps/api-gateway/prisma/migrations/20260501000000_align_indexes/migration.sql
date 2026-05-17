-- Align database indexes with the schema. Re-runnable: `IF NOT EXISTS` lets this
-- be applied to environments where Prisma never produced these indexes.

-- Assessment
CREATE INDEX IF NOT EXISTS "Assessment_userId_status_idx" ON "Assessment"("userId", "status");
CREATE INDEX IF NOT EXISTS "Assessment_status_idx" ON "Assessment"("status");

-- AssessmentEvent
CREATE INDEX IF NOT EXISTS "AssessmentEvent_assessmentId_seq_idx" ON "AssessmentEvent"("assessmentId", "seq");

-- Order
CREATE INDEX IF NOT EXISTS "Order_userId_status_idx" ON "Order"("userId", "status");
CREATE INDEX IF NOT EXISTS "Order_status_idx" ON "Order"("status");

-- CreditLedger
CREATE INDEX IF NOT EXISTS "CreditLedger_userId_reason_refId_idx" ON "CreditLedger"("userId", "reason", "refId");
