import { Controller, Headers, HttpCode, Inject, Post, RawBody } from "@nestjs/common";
import { TrackingIngestService } from "./tracking-ingest.service";

@Controller("tracking/server/v1")
export class TrackingIngestController {
  constructor(@Inject(TrackingIngestService) private readonly ingestion: TrackingIngestService) {}

  @Post("events")
  @HttpCode(202)
  receive(
    @Headers("x-rastrack-connection") connectionId: unknown,
    @Headers("authorization") authorization: unknown,
    @Headers("x-rastrack-timestamp") requestTimestamp: unknown,
    @Headers("content-type") contentType: string | undefined,
    @RawBody() rawBody: Buffer | undefined,
  ) {
    return this.ingestion.ingest({ connectionId, authorization, requestTimestamp, contentType, rawBody });
  }
}
