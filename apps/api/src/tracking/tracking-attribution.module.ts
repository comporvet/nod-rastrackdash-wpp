import { Module } from "@nestjs/common";
import { PrismaModule } from "../common/prisma/prisma.module";
import { TrackingContactMatcherService } from "./tracking-contact-matcher.service";

/** Prisma only, so the inbound webhook pipeline can import it without a cycle. */
@Module({
  imports: [PrismaModule],
  providers: [TrackingContactMatcherService],
  exports: [TrackingContactMatcherService],
})
export class TrackingAttributionModule {}
