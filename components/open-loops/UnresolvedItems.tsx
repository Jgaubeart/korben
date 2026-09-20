"use client";

import { KeyboardEvent, useEffect, useRef, useState } from "react";

export type UnresolvedItem = {
  id: string;
  title: string;
  detail: string | null;
  status: "open" | "waiting" | "closed";
  waiting_on: string | null;
  due_at: string | null;
  created_at: string;
  resolved_at: string | null;
  resolution: string | null;
};

type Props = {
  items: UnresolvedItem[];
  projectId: string | null;
  getAccessToken: () => Promise<string | null>;
  onChange: (items: UnresolvedItem[]) => void;
};

type Mode = { id: string; kind: "edit" | "remove" } | null;

export function UnresolvedItems({ items, projectId, getAccessToken, onChange }: Props) {
  const activeItems = items.filter((item) => item.status !== "closed");
  const [mode, setMode] = useState<Mode>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (mode?.kind === "edit") textareaRef.current?.focus();
    if (mode?.kind === "remove") keepRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function close(returnFocus = true) {
    const previous = mode;
    setMode(null);
    setError("");
    setBusy(false);
    if (returnFocus && previous) requestAnimationFrame(() => triggerRefs.current[`${previous.kind}-${previous.id}`]?.focus());
  }

  function openEdit(item: UnresolvedItem) {
    setMode({ id: item.id, kind: "edit" });
    setDraft(item.detail || "");
    setError("");
    setNotice("");
  }

  function openRemove(id: string) {
    setMode({ id, kind: "remove" });
    setError("");
    setNotice("");
  }

  async function mutate(item: UnresolvedItem, action: "update_detail" | "remove") {
    if (!projectId) {
      setError("Select a project before updating this item.");
      return;
    }

    const detail = draft.trim();
    if (action === "update_detail" && !detail) {
      setError("Enter the missing details.");
      textareaRef.current?.focus();
      return;
    }
    if (action === "update_detail" && detail.length > 1000) {
      setError("Keep details to 1,000 characters or fewer.");
      textareaRef.current?.focus();
      return;
    }

    setBusy(true);
    setError("");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Your session has expired. Sign in and try again.");
      const response = await fetch(`/api/open-loops/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action, project_id: projectId, detail }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The item could not be updated.");

      if (action === "update_detail") {
        onChange(items.map((current) => current.id === item.id ? payload.open_loop : current));
        setMode(null);
        setNotice("Details saved");
        requestAnimationFrame(() => triggerRefs.current[`edit-${item.id}`]?.focus());
      } else {
        const index = activeItems.findIndex((current) => current.id === item.id);
        onChange(items.map((current) => current.id === item.id ? payload.open_loop : current));
        setMode(null);
        setNotice("Item removed");
        requestAnimationFrame(() => {
          const target = activeItems[index + 1] || activeItems[index - 1];
          if (target) itemRefs.current[target.id]?.focus();
          else headingRef.current?.focus();
        });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : action === "remove"
        ? "Item couldn’t be removed. Try again."
        : "Details couldn’t be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function onEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, item: UnresolvedItem) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void mutate(item, "update_detail");
    } else if (event.key === "Escape" && draft === (item.detail || "")) {
      event.preventDefault();
      close();
    }
  }

  return (
    <section className="unresolved-items" aria-labelledby="unresolved-items-heading">
      <div className="unresolved-items-header">
        <div>
          <span>Open loops</span>
          <h3 id="unresolved-items-heading" ref={headingRef} tabIndex={-1}>Unresolved items</h3>
        </div>
        <b>{activeItems.length}</b>
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">{notice}</p>

      {activeItems.length === 0 ? (
        <div className="unresolved-empty" role="status">
          <strong>Nothing unresolved</strong>
          <span>Items that need more information will appear here.</span>
        </div>
      ) : (
        <div className="unresolved-list">
          {activeItems.map((item) => {
            const editing = mode?.id === item.id && mode.kind === "edit";
            const removing = mode?.id === item.id && mode.kind === "remove";
            const errorId = `open-loop-error-${item.id}`;
            const helperId = `open-loop-helper-${item.id}`;
            return (
              <article
                className="unresolved-item"
                key={item.id}
                tabIndex={-1}
                ref={(node) => { itemRefs.current[item.id] = node; }}
              >
                <div className="unresolved-item-topline">
                  <strong>{item.title}</strong>
                  <span>{item.status === "waiting" ? "Waiting" : "Open"}</span>
                </div>
                {item.detail ? <p>{item.detail}</p> : <p className="unresolved-missing">Missing details</p>}
                {item.waiting_on && <small>Waiting on {item.waiting_on}</small>}

                {editing ? (
                  <form
                    className="unresolved-editor"
                    aria-busy={busy}
                    onSubmit={(event) => { event.preventDefault(); void mutate(item, "update_detail"); }}
                  >
                    <label htmlFor={`open-loop-detail-${item.id}`}>Missing details <span aria-hidden="true">*</span></label>
                    <textarea
                      id={`open-loop-detail-${item.id}`}
                      ref={textareaRef}
                      value={draft}
                      maxLength={1001}
                      disabled={busy}
                      aria-invalid={Boolean(error)}
                      aria-describedby={`${helperId}${error ? ` ${errorId}` : ""}`}
                      onChange={(event) => { setDraft(event.target.value); setError(""); }}
                      onKeyDown={(event) => onEditorKeyDown(event, item)}
                    />
                    <div className="unresolved-helper" id={helperId}>
                      <span>Required · Describe the information needed to continue.</span>
                      <span aria-label={`${draft.length} of 1000 characters`}>{draft.length}/1000</span>
                    </div>
                    {error && <p className="unresolved-error" id={errorId} ref={errorRef} tabIndex={-1} role="alert">{error}</p>}
                    <div className="unresolved-form-actions">
                      <button className="unresolved-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save details"}</button>
                      <button type="button" disabled={busy} onClick={() => close()}>Cancel</button>
                    </div>
                  </form>
                ) : removing ? (
                  <div className="unresolved-confirm" aria-busy={busy} onKeyDown={(event) => { if (event.key === "Escape" && !busy) close(); }}>
                    <strong>Remove this unresolved item?</strong>
                    <p>It will leave the active list but remain in history.</p>
                    {error && <p className="unresolved-error" ref={errorRef} tabIndex={-1} role="alert">{error}</p>}
                    <div className="unresolved-form-actions">
                      <button className="unresolved-danger" type="button" disabled={busy} onClick={() => void mutate(item, "remove")}>{busy ? "Removing…" : "Remove item"}</button>
                      <button ref={keepRef} type="button" disabled={busy} onClick={() => close()}>Keep item</button>
                    </div>
                  </div>
                ) : (
                  <div className="unresolved-actions">
                    <button ref={(node) => { triggerRefs.current[`edit-${item.id}`] = node; }} type="button" onClick={() => openEdit(item)}>
                      {item.detail ? "Update details" : "Add details"}
                    </button>
                    <button className="unresolved-remove" ref={(node) => { triggerRefs.current[`remove-${item.id}`] = node; }} type="button" onClick={() => openRemove(item.id)}>Remove</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
