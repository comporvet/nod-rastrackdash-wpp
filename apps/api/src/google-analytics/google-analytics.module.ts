import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../common/prisma/prisma.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { GoogleAnalyticsController } from "./google-analytics.controller";
import { GoogleAnalyticsService } from "./google-analytics.service";

@Module({
  imports: [PrismaModule, AuthModule, WorkspacesModule],
  controllers: [GoogleAnalyticsController],
  providers: [GoogleAnalyticsService],
})
export class GoogleAnalyticsModule {}
