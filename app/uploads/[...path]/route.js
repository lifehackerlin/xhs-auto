import { Readable } from "node:stream";
import { readFileStream } from "../../lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, context) {
  const params = await context.params;
  const parts = params.path || [];
  if (parts.some((part) => part === ".." || part.includes("/") || part.includes("\\"))) {
    return new Response("Not found", { status: 404 });
  }
  const filePath = `uploads/${parts.join("/")}`;

  try {
    const file = await readFileStream(filePath);
    return new Response(Readable.toWeb(file.stream), {
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "public, max-age=31536000, immutable"
      }
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
