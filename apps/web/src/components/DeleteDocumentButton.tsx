'use client';

export function DeleteDocumentButton({ id, title }: { id: string; title: string }) {
  return (
    <form
      action={`/api/documents/${id}/delete`}
      method="post"
      className="doc-delete"
      onSubmit={(event) => {
        if (!window.confirm(`Delete "${title}"? This removes its versions and comments.`)) {
          event.preventDefault();
        }
      }}
    >
      <button type="submit" className="text-btn danger">
        Delete
      </button>
    </form>
  );
}
