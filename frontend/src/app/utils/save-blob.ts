/**
 * Hand a downloaded file to the browser's own save flow ⟨CP5⟩.
 *
 * A Resource has no URL. The bytes arrive over an authenticated request as a
 * `Blob`, so there is nothing to point an `<a href>` at and nothing to open in a
 * tab — which is the point: a link would be a public address, and a new tab
 * would ask the browser to render a document this product has decided never to
 * render.
 *
 * So a temporary object URL is made, clicked once, and revoked. The URL lives
 * inside this document, expires with the revoke, and is never shown to anybody.
 *
 * The revoke is deferred by a tick rather than being immediate: some browsers
 * have not yet begun reading the blob when the click handler returns, and
 * revoking underneath them cancels the save.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  // `download` is what makes this a save rather than a navigation. The server
  // says the same thing in `Content-Disposition`; both have to be true for the
  // file never to be rendered.
  link.download = filename || 'resource';
  link.rel = 'noopener';
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 0);
}
