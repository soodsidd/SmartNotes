import { NextResponse } from "next/server";
import { resolveJobApplication } from "@/server/vault/job-inbox";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const path = await resolveJobApplication(id);
  return path ? NextResponse.json({ path }) : NextResponse.json({ error: "Application not found." }, { status: 404 });
}
