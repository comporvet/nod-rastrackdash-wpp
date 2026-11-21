import Link from "next/link";
import { SubmitButton } from "../../../../components/submit-button";
import { getCurrentWorkspace } from "../../../../lib/current-workspace";
import { isApiRequestError, serverApiFetch } from "../../../../lib/server-api";
import { sectionStatusCopy, type Ga4Connection, type Ga4Section, type Ga4SectionStatus } from "../ga4-types";
import { deleteGa4Connection, saveGa4Connection } from "./actions";

type SearchParams = Record<string, string | string[] | undefined>;

type Discovery = {
  serviceAccountEmail: string;
  propertyId: string;
  accessibleProperties: Ga4Section<{ account: string; propertyId: string; propertyName: string }[]>;
  property: Ga4Section<{ displayName: string; timeZone: string | null; currencyCode: string | null }>;
  dataStreams: Ga4Section<{
    items: { streamId: string; type: string; displayName: string; measurementId: string | null; defaultUri: string | null }[];
    expected: { measurementId: string; foundInProperty: boolean }[];
  }>;
  customDimensions: Ga4Section<{ apiName: string; available: boolean }[]>;
};

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`status-chip ${ok ? "" : "bad"}`.trim()}>{label}</span>;
}

function SectionError({ section }: { section: Ga4Section<unknown> }) {
  const copy = sectionStatusCopy[section.status as Ga4SectionStatus];
  return (
    <p className="ga4-section-state">
      <span className={`status-chip ${copy.tone}`.trim()}>{copy.label}</span>
      {section.message ? <span>{section.message}</span> : null}
    </p>
  );
}

function DiscoveryResult({ discovery }: { discovery: Discovery }) {
  return (
    <section className="surface-panel ga4-panel">
      <header className="ga4-panel-header">
        <span className="eyebrow">Descoberta</span>
        <h2>O que a conta de serviço enxerga</h2>
      </header>

      <h4>Propriedade {discovery.propertyId}</h4>
      {discovery.property.data ? (
        <p>
          <Check ok label="Acesso confirmado" /> {discovery.property.data.displayName}, fuso{" "}
          <strong>{discovery.property.data.timeZone ?? "não informado"}</strong>
          {discovery.property.data.currencyCode ? `, moeda ${discovery.property.data.currencyCode}` : ""}.
        </p>
      ) : (
        <SectionError section={discovery.property} />
      )}

      <h4>Fluxos de dados</h4>
      {discovery.dataStreams.data ? (
        <>
          <div className="table-wrap ga4-table-wrap">
            <table className="ga4-table compact">
              <thead>
                <tr>
                  <th scope="col">Fluxo</th>
                  <th scope="col">ID numérico</th>
                  <th scope="col">ID de medição</th>
                  <th scope="col">URL</th>
                </tr>
              </thead>
              <tbody>
                {discovery.dataStreams.data.items.map((stream) => (
                  <tr key={stream.streamId}>
                    <th scope="row">{stream.displayName}</th>
                    <td>{stream.streamId}</td>
                    <td>{stream.measurementId ?? "—"}</td>
                    <td>{stream.defaultUri ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            {discovery.dataStreams.data.expected.map((item) => (
              <Check
                key={item.measurementId}
                ok={item.foundInProperty}
                label={`${item.measurementId} ${item.foundInProperty ? "nesta propriedade" : "não está nesta propriedade"}`}
              />
            ))}
          </p>
        </>
      ) : (
        <SectionError section={discovery.dataStreams} />
      )}

      <h4>Dimensões personalizadas</h4>
      {discovery.customDimensions.data ? (
        <p>
          {discovery.customDimensions.data.map((item) => (
            <Check key={item.apiName} ok={item.available} label={`${item.apiName} ${item.available ? "disponível" : "ausente"}`} />
          ))}
        </p>
      ) : (
        <SectionError section={discovery.customDimensions} />
      )}

      <h4>Propriedades acessíveis pela conta {discovery.serviceAccountEmail}</h4>
      {discovery.accessibleProperties.data ? (
        discovery.accessibleProperties.data.length ? (
          <ul className="ga4-plain-list">
            {discovery.accessibleProperties.data.map((item) => (
              <li key={item.propertyId}>
                {item.account} / {item.propertyName}: <strong>{item.propertyId}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ga4-note warn">Nenhuma. Adicione o e-mail da conta de serviço como Leitor na propriedade GA4.</p>
        )
      ) : (
        <SectionError section={discovery.accessibleProperties} />
      )}
    </section>
  );
}

export default async function Ga4SettingsPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const params = searchParams ? await searchParams : {};
  const workspace = await getCurrentWorkspace();
  if (!workspace.permissions.canManageIntegrations) {
    return (
      <section className="page-stack page-standard">
        <p className="ga4-section-state">Sem permissão para configurar integrações.</p>
      </section>
    );
  }

  const connection = await serverApiFetch<Ga4Connection>("/google-analytics/connection");
  let discovery: Discovery | null = null;
  let discoveryError: string | null = null;
  if (connection.configured && single(params.discover) === "1") {
    try {
      discovery = await serverApiFetch<Discovery>("/google-analytics/discovery");
    } catch (error) {
      discoveryError = isApiRequestError(error) ? error.message : "API indisponível";
    }
  }
  const error = single(params.error);
  const environments = connection.configured ? connection.environments : connection.environmentPreset;

  return (
    <section className="page-stack page-standard ga4-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Google Analytics 4</span>
          <h1>Configurar GA4</h1>
          <p>Leitura pela Google Analytics Data API com uma conta de serviço. Nada é alterado no GA4 nem no GTM.</p>
        </div>
        <div className="header-actions">
          <Link className="button ghost" href="/analytics">
            Voltar para Site e LPs
          </Link>
        </div>
      </header>

      {error ? <p className="ga4-note bad" role="alert">{error}</p> : null}
      {single(params.saved) === "1" ? <p className="ga4-note">Configuração salva.</p> : null}
      {single(params.removed) === "1" ? <p className="ga4-note">Conexão removida.</p> : null}
      {connection.configured && connection.lastErrorKind ? (
        <p className="ga4-note warn">
          Último erro: {sectionStatusCopy[connection.lastErrorKind as Ga4SectionStatus]?.label ?? connection.lastErrorKind}.{" "}
          {connection.lastErrorMessage}
        </p>
      ) : null}

      <section className="surface-panel ga4-panel">
        <ol className="ga4-steps">
          <li>No Google Cloud, ative a Google Analytics Data API e a Google Analytics Admin API.</li>
          <li>Crie uma conta de serviço e baixe a chave JSON.</li>
          <li>
            No GA4, em Administrador → Gerenciamento de acesso à propriedade, adicione o e-mail da conta de serviço
            com o papel Leitor. Criar a conta no Cloud não dá acesso aos dados.
          </li>
          <li>
            Informe o ID numérico da propriedade (Administrador → Detalhes da propriedade). Os G-... são IDs de
            medição dos fluxos, não da propriedade.
          </li>
        </ol>

        <form action={saveGa4Connection} className="ga4-settings-form">
          <label className="filter-field">
            <span>ID numérico da propriedade GA4</span>
            <input
              name="propertyId"
              required
              inputMode="numeric"
              placeholder="ex.: 123456789"
              defaultValue={connection.configured ? connection.propertyId : ""}
            />
          </label>
          <label className="filter-field">
            <span>
              Chave JSON da conta de serviço
              {connection.configured ? ` (salva para ${connection.serviceAccountEmail}; deixe vazio para manter)` : ""}
            </span>
            <textarea
              name="serviceAccountJson"
              rows={4}
              autoComplete="off"
              spellCheck={false}
              required={!connection.configured}
              placeholder='{"type":"service_account", ...}'
            />
          </label>
          <label className="filter-field">
            <span>IDs de medição esperados (para conferir os fluxos)</span>
            <input
              name="expectedMeasurementIds"
              placeholder="G-XM10SRKV8D, G-D3GRCTSMNW"
              defaultValue={connection.configured ? connection.expectedMeasurementIds.join(", ") : ""}
            />
          </label>
          <label className="filter-field">
            <span>Ambientes (host e caminho, expressões regulares RE2)</span>
            <textarea
              name="environments"
              rows={14}
              spellCheck={false}
              defaultValue={JSON.stringify(environments, null, 2)}
            />
          </label>
          <div className="header-actions">
            <SubmitButton className="button primary" pendingLabel="Salvando...">Salvar e testar</SubmitButton>
          </div>
        </form>
        {connection.configured ? (
          <div className="header-actions">
            <Link className="button ghost" href="/analytics/settings?discover=1" prefetch={false}>
              Testar acesso de novo
            </Link>
            <form action={deleteGa4Connection}>
              <SubmitButton className="button danger" pendingLabel="Removendo...">Remover conexão</SubmitButton>
            </form>
          </div>
        ) : null}
      </section>

      {discoveryError ? <p className="ga4-note bad">{discoveryError}</p> : null}
      {discovery ? <DiscoveryResult discovery={discovery} /> : null}
    </section>
  );
}
