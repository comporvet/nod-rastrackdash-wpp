"use server";

import { redirect } from "next/navigation";
import { isApiRequestError, serverApiFetch } from "../../../../lib/server-api";

function failure(error: unknown): never {
  const message = isApiRequestError(error) ? error.message : "API indisponível";
  redirect(`/analytics/settings?error=${encodeURIComponent(message)}`);
}

export async function saveGa4Connection(formData: FormData) {
  let environments: unknown;
  try {
    environments = JSON.parse(String(formData.get("environments") ?? ""));
  } catch {
    redirect(`/analytics/settings?error=${encodeURIComponent("Ambientes: JSON inválido")}`);
  }
  const serviceAccountJson = String(formData.get("serviceAccountJson") ?? "").trim();
  try {
    await serverApiFetch("/google-analytics/connection", {
      method: "PUT",
      body: JSON.stringify({
        propertyId: String(formData.get("propertyId") ?? ""),
        ...(serviceAccountJson ? { serviceAccountJson } : {}),
        environments,
        expectedMeasurementIds: String(formData.get("expectedMeasurementIds") ?? "")
          .split(/[\s,;]+/)
          .filter(Boolean),
      }),
    });
  } catch (error) {
    failure(error);
  }
  redirect("/analytics/settings?saved=1&discover=1");
}

export async function deleteGa4Connection() {
  try {
    await serverApiFetch("/google-analytics/connection", { method: "DELETE" });
  } catch (error) {
    failure(error);
  }
  redirect("/analytics/settings?removed=1");
}
