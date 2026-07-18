import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { jsonResponse } from "./project-session.server";

export async function apiHandler(handler: () => Promise<Response>) {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof SyntaxError) {
      return jsonResponse({ error: "Malformed JSON request" }, { status: 400 });
    }
    if (error instanceof ZodError) {
      return jsonResponse(
        {
          error: "Request validation failed",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 },
      );
    }
    const requestId = randomUUID();
    console.error(`[api:${requestId}]`, error);
    return jsonResponse(
      { error: "The request could not be completed", requestId },
      { status: 500, headers: { "x-request-id": requestId } },
    );
  }
}
