import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../common/prisma/prisma.module";
import { IntegrationsModule } from "../integrations/integrations.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { TrackingIngestController } from "./tracking-ingest.controller";
import { TrackingIngestService } from "./tracking-ingest.service";
import { TrackingLeadDispatcherService } from "./tracking-lead-dispatcher.service";
import { TrackingController } from "./tracking.controller";
import { LeadOriginService } from "./lead-origin.service";
import { TrackingService } from "./tracking.service";

@Module({
  imports: [PrismaModule, AuthModule, WorkspacesModule, IntegrationsModule],
  controllers: [TrackingIngestController, TrackingController],
  providers: [TrackingIngestService, TrackingService, TrackingLeadDispatcherService, LeadOriginService],
})
export class TrackingModule {}
