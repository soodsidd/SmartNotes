import { NextResponse } from "next/server";
import { buildAttachmentContentDisposition } from "@/server/http/content-disposition";

describe("buildAttachmentContentDisposition", () => {
  it("builds RFC 5987 headers for Unicode titles", () => {
    const header = buildAttachmentContentDisposition(
      "Ambient Care Companion \u2014 Product Requirements Document",
      ".docx"
    );
    expect(header).toContain('filename="Ambient Care Companion - Product Requirements Document.docx"');
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain("%E2%80%94");

    expect(() =>
      new NextResponse(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Disposition": header },
      })
    ).not.toThrow();
  });

  it("sanitizes illegal path characters", () => {
    const header = buildAttachmentContentDisposition('bad<>:"|?*name', ".docx");
    expect(header).toContain('filename="badname.docx"');
  });
});
