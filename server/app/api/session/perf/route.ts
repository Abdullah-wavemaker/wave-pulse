import { NextRequest, NextResponse } from "next/server";
import { tmpdir } from "node:os";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { unlink } from "node:fs/promises";

// Stores the LAST performance session per channel so the dashboard can still
// show it after the app disconnects (backgrounded, killed, reloaded) instead of
// dropping straight to the connect screen. The screen recording is already
// stored server-side by the upload route; this adds the waterfall steps, which
// otherwise only ever lived in browser memory.
//
// Same posture as the recording itself: OS temp dir, one file per channel
// (overwritten each time, we only keep the latest), and a bounded retention -
// this is a hand-off buffer, not a system of record. On a multi-instance
// deployment a channel's session only exists on the instance that stored it.
const RETENTION_MS = 2 * 60 * 60 * 1000;
const MAX_STEPS = 2000;

function perfPath(channelId: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(channelId)) throw new Error("invalid channelId");
    return `${tmpdir()}/wavepulse_perf_${channelId}.json`;
}

function scheduleSweep(filePath: string) {
    setTimeout(() => { unlink(filePath).catch(() => {}); }, RETENTION_MS);
}

export async function POST(request: NextRequest) {
    let body: any;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "invalid json body" }, { status: 400 });
    }

    const channelId = String(body?.channelId ?? "");
    if (!Array.isArray(body?.steps)) {
        return NextResponse.json({ error: "steps must be an array" }, { status: 400 });
    }
    if (body.recordingId != null && !/^[a-zA-Z0-9_-]+$/.test(String(body.recordingId))) {
        return NextResponse.json({ error: "invalid recordingId" }, { status: 400 });
    }

    let filePath: string;
    try {
        filePath = perfPath(channelId);
    } catch {
        return NextResponse.json({ error: "invalid channelId" }, { status: 400 });
    }

    const payload = {
        channelId,
        recordingId: body.recordingId ?? null,
        startTs: typeof body.startTs === "number" ? body.startTs : null,
        endTs: typeof body.endTs === "number" ? body.endTs : null,
        savedAt: Date.now(),
        steps: body.steps.slice(-MAX_STEPS),
    };

    try {
        writeFileSync(filePath, JSON.stringify(payload), "utf-8");
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "failed to store session" }, { status: 500 });
    }
    scheduleSweep(filePath);
    return NextResponse.json({ ok: true, savedAt: payload.savedAt, steps: payload.steps.length });
}

export async function GET(request: NextRequest) {
    const channelId = request.nextUrl.searchParams.get("channelId") || "";
    let filePath: string;
    try {
        filePath = perfPath(channelId);
    } catch {
        return NextResponse.json({ error: "invalid channelId" }, { status: 400 });
    }
    if (!existsSync(filePath)) {
        return NextResponse.json({ error: "no stored session" }, { status: 404 });
    }
    try {
        const raw = readFileSync(filePath, { encoding: "utf-8" });
        return NextResponse.json(JSON.parse(raw), { headers: { "Cache-Control": "no-store" } });
    } catch {
        return NextResponse.json({ error: "stored session unreadable" }, { status: 500 });
    }
}

// "Close session" - drops the stored steps AND the recording they refer to, so
// closing really does discard the data rather than leaving the video behind to
// age out on its own.
export async function DELETE(request: NextRequest) {
    const channelId = request.nextUrl.searchParams.get("channelId") || "";
    let filePath: string;
    try {
        filePath = perfPath(channelId);
    } catch {
        return NextResponse.json({ error: "invalid channelId" }, { status: 400 });
    }

    let recordingId: string | null = null;
    if (existsSync(filePath)) {
        try {
            recordingId = JSON.parse(readFileSync(filePath, { encoding: "utf-8" }))?.recordingId ?? null;
        } catch { /* unreadable - still remove the file below */ }
    }
    await unlink(filePath).catch(() => {});

    if (recordingId && /^[a-zA-Z0-9_-]+$/.test(recordingId)) {
        await unlink(`${tmpdir()}/wavepulse_recording_${recordingId}.mp4`).catch(() => {});
    }
    return NextResponse.json({ ok: true });
}
