import { NextRequest, NextResponse } from "next/server";
import { tmpdir } from "node:os";
import { writeFile } from "node:fs/promises";
import { unlink } from "node:fs/promises";

// Gap-filler storage, not a system of record: uploaded recordings live in the
// OS temp dir and are swept after RETENTION_MS, same posture as the session
// export/import cleanup. If export/replay ever needs to fold a recording into
// a downloaded bundle, that has to happen before this timer fires.
const RETENTION_MS = 2 * 60 * 60 * 1000;

function recordingPath(recordingId: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(recordingId)) {
        throw new Error("invalid recordingId");
    }
    return `${tmpdir()}/wavepulse_recording_${recordingId}.mp4`;
}

export async function POST(request: NextRequest) {
    const recordingId = request.nextUrl.searchParams.get("recordingId") || "";
    let filePath: string;
    try {
        filePath = recordingPath(recordingId);
    } catch {
        return NextResponse.json({ error: "invalid recordingId" }, { status: 400 });
    }
    const buffer = Buffer.from(await request.arrayBuffer());
    await writeFile(filePath, buffer);
    setTimeout(() => {
        unlink(filePath).catch(() => {});
    }, RETENTION_MS);
    return NextResponse.json({ recordingId });
}
