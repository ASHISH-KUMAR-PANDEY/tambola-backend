-- Add ticket pool fields to SoloWeek
ALTER TABLE "SoloWeek" ADD COLUMN "ticketPool" JSONB;
ALTER TABLE "SoloWeek" ADD COLUMN "game2TicketPool" JSONB;
