export class VaultError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "VaultError";
    this.code = code;
    this.status = status;
  }
}

export function toErrorResponse(error: unknown) {
  if (error instanceof VaultError) {
    return {
      status: error.status,
      body: {
        error: error.message,
        code: error.code,
      },
    };
  }

  console.error("[smart-notes] unexpected vault error", error);
  return {
    status: 500,
    body: {
      error: "Unexpected vault error",
      code: "INTERNAL_ERROR",
    },
  };
}
