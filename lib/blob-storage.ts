import { get, put } from "@vercel/blob";

export async function readBlob(pathname: string) {
  try {
    const result = await get(pathname, { access: "private", useCache: true });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return {
      body: result.stream,
      contentType: result.blob.contentType,
      contentDisposition: result.blob.contentDisposition,
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
    access: "private",
    contentType,
    addRandomSuffix: false,
    multipart: true,
  });
}
