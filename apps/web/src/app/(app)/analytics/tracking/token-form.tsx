"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CopyLinkButton } from "../../../../components/copy-link-button";
import { PendingSubmitButton } from "../../../../components/pending-submit-button";
import { rotateTrackingToken, type RotateTokenState } from "./actions";

const initialState: RotateTokenState = { status: "idle", message: "", nonce: 0 };

/** The token exists only in this component's state: shown once, never stored or put in a URL. */
export function TrackingTokenForm({ configured }: { configured: boolean }) {
  const [state, formAction, isPending] = useActionState(rotateTrackingToken, initialState);
  const [issued, setIssued] = useState<RotateTokenState | null>(null);
  const handledNonce = useRef(0);

  useEffect(() => {
    if (isPending) setIssued(null);
  }, [isPending]);

  useEffect(() => {
    if (!state.nonce || handledNonce.current === state.nonce) return;
    handledNonce.current = state.nonce;
    setIssued(state.status === "success" ? state : null);
  }, [state]);

  return (
    <div className="tracking-token">
      <form action={formAction}>
        <PendingSubmitButton
          className={configured ? "button ghost" : "button primary"}
          label={configured ? "Gerar novo token" : "Gerar token da recepção"}
          pendingLabel="Gerando..."
        />
      </form>
      {configured ? (
        <p className="ga4-note warn">Gerar um novo token invalida o anterior: atualize a variável no GTM Server-Side em seguida.</p>
      ) : null}
      {state.status === "error" ? <p className="ga4-note bad">{state.message}</p> : null}
      {issued?.token ? (
        <div className="ga4-note" role="status">
          <p>
            Copie agora: o token não será exibido de novo. Guarde-o só na variável constante do contêiner de servidor.
          </p>
          <p>
            ID da conexão: <code>{issued.connectionId}</code>{" "}
            <CopyLinkButton url={issued.connectionId ?? ""} label="Copiar ID" />
          </p>
          <p>
            Token: <code>{issued.token}</code> <CopyLinkButton url={issued.token} label="Copiar token" />
          </p>
        </div>
      ) : null}
    </div>
  );
}
