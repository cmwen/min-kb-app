import type { AttachmentUpload, StoredAttachment } from "@min-kb-app/shared";

export const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024;

export function validateAttachmentFile(file: File): string | undefined {
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return `Files must be ${formatFileSize(MAX_ATTACHMENT_SIZE_BYTES)} or smaller.`;
  }
  return undefined;
}

export async function toAttachmentUpload(
  file: File
): Promise<AttachmentUpload> {
  return {
    name: file.name,
    contentType: file.type || "application/octet-stream",
    size: file.size,
    base64Data: await readFileAsBase64(file),
  };
}

export function isImageAttachment(
  attachment:
    | Pick<File, "type">
    | Pick<StoredAttachment, "contentType" | "mediaType">
): boolean {
  if ("mediaType" in attachment) {
    return attachment.mediaType === "image";
  }
  return attachment.type.startsWith("image/");
}

export function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function readFileAsBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
