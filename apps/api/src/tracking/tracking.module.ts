import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../common/prisma/prisma.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { TrackingIngestController } from "./tracking-ingest.controller";
import { TrackingIngestService } from "./tracking-ingest.service";
import { TrackingController } from "./tracking.controller";
import { TrackingService } from "./tracking.service";

@Module({
  imports: [PrismaModule, AuthModule, WorkspacesModule],
  controllers: [TrackingIngestController, TrackingController],
  providers: [TrackingIngestService, TrackingService],
})
export class TrackingModule {}
