import { head, put } from "@vercel/blob";

export async function readBlob(pathname: string) {
  try {
    const metadata = await head(pathname);
    const response = await fetch(metadata.url);
    if (!response.ok || !response.body) return null;
    return {
      body: response.body,
      contentType: metadata.contentType,
      contentDisposition: metadata.contentDisposition,
    };
  } catch {
    return null;
  }
}

export async function writeBlob(
  pathname: string,
  body: ReadableStream,
  contentType: string,
) {
  return put(pathname, body, {
    access: "public",
    contentType,
    addRandomSuffix: false,
    multipart: true,
  });
}
