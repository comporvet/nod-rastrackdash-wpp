import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Put,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import { AuthToken } from "../auth/auth-user.decorator";
import { AuthService } from "../auth/auth.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { GoogleAnalyticsService } from "./google-analytics.service";

const connectionInputSchema = z.object({
  propertyId: z.string().trim().min(1).max(40),
  serviceAccountJson: z.string().max(20_000).optional(),
  environments: z.unknown(),
  expectedMeasurementIds: z.array(z.string().max(30)).max(10).default([]),
});

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

@Controller("google-analytics")
export class GoogleAnalyticsController {
  constructor(
    @Inject(GoogleAnalyticsService) private readonly ga4: GoogleAnalyticsService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(WorkspacesService) private readonly workspaces: WorkspacesService,
  ) {}

  @Get("connection")
  async getConnection(@AuthToken() token: string) {
    const { workspace } = await this.context(token, "canManageIntegrations");
    return this.ga4.getConnection(workspace.id);
  }

  @Put("connection")
  async saveConnection(@AuthToken() token: string, @Body() body: unknown) {
    const { workspace, userId } = await this.context(token, "canManageIntegrations");
    const parsed = connectionInputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Payload inválido");
    return this.ga4.saveConnection(workspace.id, userId, parsed.data);
  }

  @Delete("connection")
  async deleteConnection(@AuthToken() token: string) {
    const { workspace } = await this.context(token, "canManageIntegrations");
    return this.ga4.deleteConnection(workspace.id);
  }

  @Get("discovery")
  async discover(@AuthToken() token: string) {
    const { workspace } = await this.context(token, "canManageIntegrations");
    return this.ga4.discover(workspace.id);
  }

  @Get("funnel-diagnostics")
  async funnelDiagnostics(
    @AuthToken() token: string,
    @Query("since") since?: string | string[],
    @Query("until") until?: string | string[],
  ) {
    const { workspace } = await this.context(token, "canManageIntegrations");
    return this.ga4.funnelDiagnostics(workspace.id, { since: single(since), until: single(until) });
  }

  @Get("report")
  async report(
    @AuthToken() token: string,
    @Query("since") since?: string | string[],
    @Query("until") until?: string | string[],
    @Query("compare") compare?: string | string[],
    @Query("device") device?: string | string[],
    @Query("sourceMedium") sourceMedium?: string | string[],
    @Query("campaign") campaign?: string | string[],
    @Query("refresh") refresh?: string | string[],
    @Query("includeTests") includeTests?: string | string[],
  ) {
    const { workspace } = await this.context(token, "canViewReports");
    return this.ga4.report(workspace.id, {
      since: single(since),
      until: single(until),
      compare: single(compare) === "1",
      device: single(device),
      sourceMedium: single(sourceMedium),
      campaign: single(campaign),
      refresh: single(refresh) === "1",
      includeTestTraffic: single(includeTests) === "1",
    });
  }

  private async context(token: string, permission: "canManageIntegrations" | "canViewReports") {
    const authenticated = await this.auth.getSession(token);
    const workspace = this.workspaces.getCurrentWorkspace(authenticated);
    if (!workspace.permissions[permission]) {
      throw new ForbiddenException("Sem permissão para o Google Analytics");
    }
    return { workspace, userId: authenticated.user.id };
  }
}
