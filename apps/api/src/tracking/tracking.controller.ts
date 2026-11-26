import { Body, Controller, ForbiddenException, Get, Inject, Post, Put, Query } from "@nestjs/common";
import { AuthToken } from "../auth/auth-user.decorator";
import { AuthService } from "../auth/auth.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { TrackingService } from "./tracking.service";

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

@Controller("tracking")
export class TrackingController {
  constructor(
    @Inject(TrackingService) private readonly tracking: TrackingService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(WorkspacesService) private readonly workspaces: WorkspacesService,
  ) {}

  @Get("connection")
  async getConnection(@AuthToken() token: string) {
    const workspaceId = await this.workspaceId(token, "canManageIntegrations");
    return this.tracking.getConnection(workspaceId);
  }

  @Put("connection")
  async updateConnection(@AuthToken() token: string, @Body() body: unknown) {
    const workspaceId = await this.workspaceId(token, "canManageIntegrations");
    return this.tracking.updateConnection(workspaceId, body);
  }

  @Post("connection/rotate")
  async rotate(@AuthToken() token: string) {
    const workspaceId = await this.workspaceId(token, "canManageIntegrations");
    return this.tracking.rotateToken(workspaceId);
  }

  @Get("monitor")
  async monitor(
    @AuthToken() token: string,
    @Query("since") since?: string | string[],
    @Query("until") until?: string | string[],
  ) {
    const workspaceId = await this.workspaceId(token, "canViewReports");
    return this.tracking.monitor(workspaceId, { since: single(since), until: single(until) });
  }

  private async workspaceId(token: string, permission: "canManageIntegrations" | "canViewReports") {
    const authenticated = await this.auth.getSession(token);
    const workspace = this.workspaces.getCurrentWorkspace(authenticated);
    if (!workspace.permissions[permission]) {
      throw new ForbiddenException("Sem permissão para a recepção de eventos");
    }
    return workspace.id;
  }
}
