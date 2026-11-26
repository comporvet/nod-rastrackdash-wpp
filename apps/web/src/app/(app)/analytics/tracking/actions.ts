"use server";

import { redirect } from "next/navigation";
import { isApiRequestError, serverApiFetch } from "../../../../lib/server-api";

export type RotateTokenState = {
  status: "idle" | "success" | "error";
  message: string;
  nonce: number;
  token?: string;
  connectionId?: string;
  endpointUrl?: string | null;
};

export async function rotateTrackingToken(): Promise<RotateTokenState> {
  try {
    const result = await serverApiFetch<{ connectionId: string; token: string; endpointUrl: string | null }>(
      "/tracking/connection/rotate",
      { method: "POST" },
    );
    return { status: "success", message: "", nonce: Date.now(), ...result };
  } catch (error) {
    return {
      status: "error",
      message: isApiRequestError(error) ? error.message : "API indisponível",
      nonce: Date.now(),
    };
  }
}

export async function updateTrackingConnection(formData: FormData) {
  const allowedEvents = String(formData.get("allowedEvents") ?? "")
    .split(/[\s,;]+/)
    .map((name) => name.trim())
    .filter(Boolean);
  try {
    await serverApiFetch("/tracking/connection", {
      method: "PUT",
      body: JSON.stringify({
        allowedEvents,
        status: formData.get("status") === "paused" ? "paused" : "active",
        metaLeadEnabled: formData.get("metaLeadEnabled") === "on",
        metaPixelId: String(formData.get("metaPixelId") ?? "").trim(),
        metaTestEventCode: String(formData.get("metaTestEventCode") ?? "").trim(),
      }),
    });
  } catch (error) {
    const message = isApiRequestError(error) ? error.message : "API indisponível";
    redirect(`/analytics/tracking?error=${encodeURIComponent(message)}`);
  }
  redirect("/analytics/tracking?saved=1");
}
