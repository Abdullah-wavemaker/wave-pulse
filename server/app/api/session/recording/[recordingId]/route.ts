import { NextRequest, NextResponse } from "next/server";
import { tmpdir } from "node:os";
import { existsSync, statSync } from "node:fs";
import { streamFile } from "@/wavepulse/zip";

export async function GET(request: NextRequest, { params }: { params: { recordingId: string } }) {
    const { recordingId } = params;
    if (!/^[a-zA-Z0-9_-]+$/.test(recordingId)) {
        return NextResponse.json({ error: "invalid recordingId" }, { status: 400 });
    }
    const filePath = `${tmpdir()}/wavepulse_recording_${recordingId}.mp4`;
    if (!existsSync(filePath)) {
        return NextResponse.json({ error: "not found or expired" }, { status: 404 });
    }

    const { size } = statSync(filePath);
    const rangeHeader = request.headers.get("range");

    // A <video> element seeks by requesting a specific byte range - without
    // honoring that, the server always returns the whole file from byte 0
    // with a plain 200, so the browser can't actually land on the requested
    // position; a seek ends up looking like it restarts playback from 0.
    if (rangeHeader) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
        const start = match ? parseInt(match[1], 10) : NaN;
        const end = match && match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1;
        if (!isNaN(start) && start < size && start <= end) {
            return new Response(streamFile(filePath, undefined, { start, end }), {
                status: 206,
                headers: {
                    "Content-Type": "video/mp4",
                    "Content-Range": `bytes ${start}-${end}/${size}`,
                    "Content-Length": String(end - start + 1),
                    "Accept-Ranges": "bytes",
                    "Cache-Control": "no-store",
                },
            });
        }
        // Range present but unsatisfiable (e.g. start beyond file size).
        return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${size}` },
        });
    }

    return new Response(streamFile(filePath), {
        headers: {
            "Content-Type": "video/mp4",
            "Content-Length": String(size),
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
        },
    });
}
