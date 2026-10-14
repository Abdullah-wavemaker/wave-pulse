"use client";
import { useRecording, useWaterfallSteps, useStoredPerfSession, WaterfallStep, WaterfallStepKind } from "@/hooks/hooks";
import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Switch } from "@heroui/react";
import { DeleteIcon, ChevronDownIcon } from "@heroui/shared-icons";
import { useEffect, useMemo, useRef, useState } from "react";

// Same light theme + table/bar convention as network.tsx and timeline.tsx -
// name/type/time columns, a wide "Waterfall" column with a bar positioned by
// marginLeft/width percentages of the shared time range.
const KIND_META: Record<WaterfallStepKind, { label: string; badge: string; bar: string }> = {
    nav: { label: "Navigation", badge: "text-purple-600 bg-purple-200 border-purple-600", bar: "border-purple-600 bg-purple-400" },
    load: { label: "Page Load", badge: "text-blue-600 bg-blue-200 border-blue-600", bar: "border-blue-600 bg-blue-400" },
    action: { label: "Business Logic", badge: "text-orange-600 bg-orange-200 border-orange-600", bar: "border-orange-600 bg-orange-400" },
    api: { label: "API Call", badge: "text-green-600 bg-green-200 border-green-600", bar: "border-green-600 bg-green-400" },
};
const KIND_ORDER: WaterfallStepKind[] = ["nav", "load", "action", "api"];

// "Slow only" cut-off. 300ms is roughly where a step stops feeling instant to a
// user, so it's the line between noise and something worth looking at. Applied
// to the row list (and anything derived from it - print, composite video), but
// never to the session totals or the time axis: filtering is a lens on the
// rows, not a redefinition of the session, so bars keep their true positions.
const SLOW_THRESHOLD_MS = 300;

const UNSUPPORTED_MESSAGES: Record<string, string> = {
    "screen-capture-protected": "This app has screen capture protection enabled, which blocks all screen recording (including WavePulse's) at the OS level - disable it for this build to record.",
    // Reached on Android/iOS when the WMScreenRecorder native module isn't in
    // the running build. Deliberately does NOT blame Expo Go: the far more
    // common cause is a native project that already existed, so `expo run:*`
    // built it without re-running prebuild - and config plugins only apply
    // during prebuild.
    "native-module-missing":
        "Screen recording isn't in this build. The recorder is added by a config plugin, which only runs during prebuild - if android/ or ios/ already existed, `expo run:` reused it and skipped the plugin. Re-run `npx expo prebuild --clean`, then build again. Also check WavePulse is enabled for this app and that screen capture protection is off.",
    "web-capture-unavailable":
        "This browser doesn't expose screen capture (getDisplayMedia), so Web Preview recording isn't available here.",
};
const DEFAULT_UNSUPPORTED_MESSAGE = "Screen recording isn't available on this connection.";

const fmtMs = (ms: number) =>
    ms >= 1000 ? (ms / 1000).toFixed(2) + "s"
    : ms >= 10 ? Math.round(ms) + "ms"
    : ms.toFixed(1) + "ms";

// ── Composite session video ───────────────────────────────────────────────
// The "full session" export paints the screen recording and the waterfall onto
// one canvas, frame by frame, and records that canvas - producing a single
// video showing both side by side. The waterfall is drawn with Canvas 2D calls
// rather than rasterizing the DOM: DOM-to-image at video frame rates needs a
// heavy dependency and is far too slow, and we already own the data being
// drawn. Capture is real-time (MediaRecorder has no faster-than-playback
// mode), so exporting a 20s session takes 20s.
const CANVAS_KIND_COLOR: Record<WaterfallStepKind, string> = {
    nav: "#a855f7", load: "#3b82f6", action: "#f97316", api: "#22c55e",
};
const SANS = "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
    return t + "…";
}

function lastIndexAtOrBefore(steps: WaterfallStep[], ts: number) {
    let idx = -1;
    for (let i = 0; i < steps.length; i++) {
        if (steps[i].startTs <= ts) idx = i;
        else break;
    }
    return idx;
}

function drawSessionFrame(o: {
    ctx: CanvasRenderingContext2D; width: number; height: number;
    video: HTMLVideoElement; steps: WaterfallStep[];
    // The rows drawn are `steps` (possibly filtered); the header totals come
    // from `totalsSteps` (the whole session) so the exported video's summary
    // line matches the on-screen one rather than the filter's subset.
    totalsSteps?: WaterfallStep[];
    startTime: number; totalTime: number; nowTs: number; sessionMs: number;
}) {
    const { ctx, width, height, video, steps, startTime, totalTime, nowTs, sessionMs } = o;
    const totalsSteps = o.totalsSteps ?? steps;
    ctx.textBaseline = "top";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    // Left: the phone recording, letterboxed into its column.
    const leftW = Math.round(width * 0.36);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, leftW, height);
    const vw = video.videoWidth, vh = video.videoHeight;
    if (vw && vh) {
        const scale = Math.min(leftW / vw, height / vh);
        const dw = vw * scale, dh = vh * scale;
        ctx.drawImage(video, (leftW - dw) / 2, (height - dh) / 2, dw, dh);
    }

    const x0 = leftW + 24;
    const panelW = width - x0 - 24;

    ctx.fillStyle = "#111827";
    ctx.font = `bold 22px ${SANS}`;
    ctx.fillText("Performance Waterfall", x0, 24);

    ctx.font = `14px ${SANS}`;
    ctx.fillStyle = "#6b7280";
    ctx.fillText(`Session ${fmtMs(sessionMs)} · ${totalsSteps.length} step${totalsSteps.length === 1 ? "" : "s"}`, x0, 56);

    let cx = x0;
    const chipY = 82;
    ctx.font = `13px ${SANS}`;
    KIND_ORDER.forEach((k) => {
        const rows = totalsSteps.filter((s) => s.kind === k);
        if (!rows.length) return;
        const text = `${KIND_META[k].label} ${fmtMs(rows.reduce((a, s) => a + s.ms, 0))} (${rows.length})`;
        const tw = ctx.measureText(text).width;
        if (cx + 16 + tw > x0 + panelW) return; // don't spill past the panel
        ctx.fillStyle = CANVAS_KIND_COLOR[k];
        ctx.fillRect(cx, chipY + 3, 10, 10);
        ctx.fillStyle = "#374151";
        ctx.fillText(text, cx + 16, chipY);
        cx += 16 + tw + 22;
    });

    const headerY = 118;
    const colName = x0 + 8;
    const colType = x0 + Math.round(panelW * 0.34);
    const colTime = x0 + Math.round(panelW * 0.5);
    const wfX = x0 + Math.round(panelW * 0.62);
    const wfW = x0 + panelW - wfX - 8;

    ctx.fillStyle = "#f3f4f6";
    ctx.fillRect(x0, headerY, panelW, 26);
    ctx.fillStyle = "#374151";
    ctx.font = `bold 12px ${SANS}`;
    ctx.fillText("Name", colName, headerY + 7);
    ctx.fillText("Type", colType, headerY + 7);
    ctx.fillText("Time", colTime, headerY + 7);
    ctx.fillText("Waterfall", wfX, headerY + 7);

    const rowH = 30;
    const rowsTop = headerY + 30;
    const maxRows = Math.max(Math.floor((height - rowsTop - 16) / rowH), 1);
    const activeIdx = lastIndexAtOrBefore(steps, nowTs);
    // Keep the currently-playing step on screen when there are more rows than fit.
    let first = 0;
    if (steps.length > maxRows && activeIdx >= 0) {
        first = Math.min(Math.max(activeIdx - Math.floor(maxRows / 2), 0), steps.length - maxRows);
    }

    for (let i = first; i < Math.min(first + maxRows, steps.length); i++) {
        const s = steps[i];
        const y = rowsTop + (i - first) * rowH;
        if (i === activeIdx) {
            ctx.fillStyle = "#fde68a";
            ctx.fillRect(x0, y, panelW, rowH);
        } else if (i % 2 === 1) {
            ctx.fillStyle = "#fafafa";
            ctx.fillRect(x0, y, panelW, rowH);
        }
        ctx.strokeStyle = "#e5e7eb";
        ctx.beginPath();
        ctx.moveTo(x0, y + rowH);
        ctx.lineTo(x0 + panelW, y + rowH);
        ctx.stroke();

        ctx.fillStyle = "#111827";
        ctx.font = `13px ${SANS}`;
        ctx.fillText(fitText(ctx, s.label, colType - colName - 12), colName, y + 9);

        ctx.fillStyle = CANVAS_KIND_COLOR[s.kind];
        ctx.font = `11px ${SANS}`;
        ctx.fillText(KIND_META[s.kind].label, colType, y + 10);

        ctx.fillStyle = "#374151";
        ctx.font = `12px ${SANS}`;
        ctx.fillText(fmtMs(s.ms), colTime, y + 9);

        // Clipped to the waterfall column, same as the on-screen bars.
        const rawL = wfX + ((s.startTs - startTime) / totalTime) * wfW;
        const rawR = rawL + (s.ms / totalTime) * wfW;
        const bx = Math.max(rawL, wfX);
        const bw = Math.max(Math.min(rawR, wfX + wfW) - bx, 2);
        ctx.fillStyle = CANVAS_KIND_COLOR[s.kind];
        ctx.fillRect(bx, y + 8, bw, 13);
    }

    // Playhead marking where the video is in the session timeline. It spans the
    // header plus the rows that were actually drawn - running it to the bottom
    // of the canvas turned a short session into a red stripe down a page of
    // empty space, with nothing next to it to relate it to. The cap at the top
    // is what makes it read as a playhead rather than an unexplained line.
    const drawnRows = Math.max(Math.min(first + maxRows, steps.length) - first, 0);
    const playheadBottom = rowsTop + Math.max(drawnRows, 1) * rowH;
    const px = wfX + Math.max(Math.min((nowTs - startTime) / totalTime, 1), 0) * wfW;
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.moveTo(px - 5, headerY - 8);
    ctx.lineTo(px + 5, headerY - 8);
    ctx.lineTo(px, headerY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, headerY);
    ctx.lineTo(px, playheadBottom);
    ctx.stroke();
    ctx.lineWidth = 1;
}

// MP4/H.264 first, webm only as a fallback. MediaRecorder's webm output is
// muxed as a live stream with no duration in the header, so players treat it
// as unseekable or outright broken - and QuickTime can't open webm at all, so
// on macOS the file simply looks corrupt. Chrome has supported mp4 recording
// since ~v126.
function pickRecorderMime() {
    const candidates = [
        "video/mp4;codecs=avc1.42E01E",
        "video/mp4",
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
    ];
    for (const m of candidates) {
        if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(m)) return m;
    }
    return "";
}

const extForMime = (m: string) => (m.includes("mp4") ? "mp4" : "webm");

// Every await in the export used to be an unbounded "wait for this event to
// maybe happen". If the event never arrived - a stalled load, a seek the
// browser silently dropped, a video that never reaches `ended` - the export
// hung on a spinner forever with no error and no file. Each wait now fails
// loudly instead: an `error` event on the target rejects, and an optional
// timeout rejects too.
const onceEvent = (target: EventTarget, name: string, timeoutMs = 0, label = name) =>
    new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const cleanup = () => {
            if (timer) clearTimeout(timer);
            target.removeEventListener(name, onOk);
            target.removeEventListener("error", onErr);
        };
        const onOk = () => { cleanup(); resolve(); };
        const onErr = () => { cleanup(); reject(new Error(`The recording failed to load while waiting for ${label}.`)); };
        target.addEventListener(name, onOk, { once: true });
        target.addEventListener("error", onErr, { once: true });
        if (timeoutMs > 0) {
            timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${label}.`)); }, timeoutMs);
        }
    });

// `ended` can simply never fire if playback stalls mid-way (a bad range
// response, a decode hiccup). Watch currentTime instead of trusting the event:
// if it stops advancing while we think we're playing, give up with a real
// message rather than hanging.
const playbackStalled = (video: HTMLVideoElement, done: { finished: boolean }, graceMs = 12000) =>
    new Promise<never>((_, reject) => {
        let last = -1;
        let lastMovedAt = Date.now();
        const id = setInterval(() => {
            if (done.finished || video.ended) { clearInterval(id); return; }
            if (video.currentTime !== last) {
                last = video.currentTime;
                lastMovedAt = Date.now();
            } else if (Date.now() - lastMovedAt > graceMs) {
                clearInterval(id);
                reject(new Error(`Playback stalled at ${video.currentTime.toFixed(1)}s - the recording may be incomplete.`));
            }
        }, 1000);
    });

const SessionTotals = ({ steps, sessionMsOverride }: { steps: WaterfallStep[]; sessionMsOverride?: number }) => {
    const totals = useMemo(() => {
        const byKind: Record<WaterfallStepKind, { ms: number; count: number }> = {
            nav: { ms: 0, count: 0 }, load: { ms: 0, count: 0 }, action: { ms: 0, count: 0 }, api: { ms: 0, count: 0 },
        };
        steps.forEach((s) => { byKind[s.kind].ms += s.ms; byKind[s.kind].count++; });
        const spanMs = steps.length ? Math.max(...steps.map((s) => s.endTs)) - Math.min(...steps.map((s) => s.startTs)) : 0;
        // When a recording exists, the session IS the recording window - the
        // waterfall has to describe the same stretch of time the video shows.
        return { byKind, sessionMs: sessionMsOverride ?? spanMs };
    }, [steps, sessionMsOverride]);

    if (!steps.length) return null;

    return (
        <div className="flex flex-wrap items-center gap-4 px-4 py-2 bg-zinc-50 border-b text-xs">
            <span className="font-bold text-color">Session: {fmtMs(totals.sessionMs)}</span>
            {KIND_ORDER.map((k) => (
                totals.byKind[k].count > 0 && (
                    <span key={k} className="flex items-center gap-1">
                        <span className={"w-2.5 h-2.5 rounded-sm inline-block border " + KIND_META[k].bar} />
                        <span className="text-color">{KIND_META[k].label}:</span>
                        <span className="font-semibold text-color">{fmtMs(totals.byKind[k].ms)}</span>
                        <span className="text-gray-400">({totals.byKind[k].count})</span>
                    </span>
                )
            ))}
        </div>
    );
};

export const Performance = ({ onCloseSession }: { onCloseSession?: () => void } = {}) => {
    const { isRecording, isStarting, supported, unsupportedReason, recording, error, startRecording, stopRecording } = useRecording();
    const { steps, clearSteps } = useWaterfallSteps();
    const { stored, saveSession, closeSession, apiBase } = useStoredPerfSession();
    const videoRef = useRef<HTMLVideoElement>(null);
    const pendingSeekRef = useRef<number | null>(null);
    const [activeStepKey, setActiveStepKey] = useState<string | null>(null);
    const [isExporting, setIsExporting] = useState(false);
    const [exportError, setExportError] = useState("");
    const [exportProgress, setExportProgress] = useState<{ cur: number; total: number } | null>(null);
    const [slowOnly, setSlowOnly] = useState(false);

    // Once a recording exists, the waterfall is scoped to exactly the recorded
    // window: anything captured before Start Recording, or after the recording
    // was stopped, isn't part of the session the video represents and would
    // otherwise inflate both the row list and the session totals.
    const recStart = recording?.startTs ?? null;
    const recEnd = recording?.endTs ?? null;
    const liveSteps = useMemo(() => {
        if (recStart == null) return steps;
        const end = recEnd ?? Infinity;
        // Overlap, not containment. A step only had to be *running* during the
        // recording to belong to it - requiring startTs >= recStart silently
        // dropped exactly the longest and most important steps, since a page
        // load's startTs is its mount time, which is usually a second or two
        // before Start Recording was pressed.
        return steps.filter((s) => s.endTs >= recStart && s.startTs <= end);
    }, [steps, recStart, recEnd]);

    // Persist a finished session (steps + which recording they belong to) so it
    // survives the app disconnecting right after Stop Recording.
    useEffect(() => {
        if (!recording?.url || !liveSteps.length) return;
        saveSession({
            steps: liveSteps,
            recordingId: recording.recordingId ?? null,
            startTs: recStart,
            endTs: recEnd,
        });
    }, [recording?.url, recording?.recordingId, liveSteps, recStart, recEnd, saveSession]);

    // Fall back to the server-stored session only when there's nothing live to
    // show - a reconnected app always wins over stored data.
    const showingStored = liveSteps.length === 0 && !!stored && stored.steps.length > 0;
    const visibleSteps = showingStored ? (stored as NonNullable<typeof stored>).steps : liveSteps;
    const viewStart = showingStored ? stored!.startTs : recStart;
    const viewEnd = showingStored ? stored!.endTs : recEnd;
    // Always address the recording through THIS page's own origin, never the
    // absolute URL the agent sent back. The agent builds that URL from whatever
    // host the phone used to reach the server (a LAN IP, a tunnel hostname),
    // which is a different origin from the dashboard on localhost. Playback
    // doesn't care - media elements load cross-origin fine - but drawing such a
    // video onto a canvas TAINTS it, and a tainted canvas makes
    // captureStream()/MediaRecorder throw SecurityError. That's why the video
    // showed, seeking worked and the PDF exported, while only "Full session
    // (video)" failed. recordingId is origin-independent, so build the URL here.
    const liveRecordingUrl = recording?.recordingId
        ? `${apiBase}/api/session/recording/${recording.recordingId}`
        : (recording?.url ?? null);
    const videoUrl = showingStored
        ? (stored!.recordingId ? `${apiBase}/api/session/recording/${stored!.recordingId}` : null)
        : liveRecordingUrl;

    // What the row list actually renders. Deliberately separate from
    // visibleSteps: totals and the timeline scale stay anchored to the whole
    // session so toggling the filter never moves a bar.
    const displaySteps = useMemo(
        () => (slowOnly ? visibleSteps.filter((s) => s.ms >= SLOW_THRESHOLD_MS) : visibleSteps),
        [visibleSteps, slowOnly],
    );
    const hiddenCount = visibleSteps.length - displaySteps.length;

    const sessionMsOverride = viewStart != null && viewEnd != null ? viewEnd - viewStart : undefined;

    const startTime = viewStart != null
        ? viewStart
        : (visibleSteps.length ? Math.min(...visibleSteps.map((s) => s.startTs)) : 0);
    const endTime = viewStart != null && viewEnd != null
        ? viewEnd
        : (visibleSteps.length ? Math.max(...visibleSteps.map((s) => s.endTs)) : 0);
    const totalTime = Math.max(endTime - startTime, 1);

    // recording.startTs and every step's timestamps are both Date.now() /
    // System.currentTimeMillis() epoch-ms captured on the SAME device clock
    // (agent-side), so they're directly comparable - no separate sync step
    // needed, unlike the offline tool's manual click-to-mark-then-click-video
    // procedure. Offset is zero by construction on the JS side; native
    // recorder start latency (a few hundred ms, platform-dependent) is not
    // measured/compensated for yet.
    // Anchored on viewStart, not recording.startTs, so a stored session replayed
    // after the app disconnected stays clickable and stays in sync too.
    const videoTimeFor = (ts: number) => (viewStart != null ? (ts - viewStart) / 1000 : null);
    // Same overlap test as visibleSteps - a step that began just before the
    // recording is still seekable (it clamps to t=0 of the video).
    const inRecordingWindow = (s: WaterfallStep) =>
        !!videoUrl && viewStart != null && s.endTs >= viewStart
        && (viewEnd == null || s.startTs <= viewEnd);

    // Setting .currentTime before the browser has loaded the video's metadata
    // (readyState >= HAVE_METADATA) is unreliable - it can silently get reset
    // back to 0 once metadata does load, which is exactly what "seeks to 0"
    // looks like. Queue the seek and apply it from onLoadedMetadata if the
    // video isn't ready yet.
    const applySeek = (target: number) => {
        if (!videoRef.current) return;
        videoRef.current.currentTime = target;
        videoRef.current.play?.().catch(() => {});
    };
    const seekToStep = (s: WaterfallStep) => {
        const vt = videoTimeFor(s.startTs);
        if (vt == null || !videoRef.current) return;
        const target = Math.max(vt, 0);
        if (videoRef.current.readyState >= 1) {
            applySeek(target);
        } else {
            pendingSeekRef.current = target;
        }
    };
    const onLoadedMetadata = () => {
        if (pendingSeekRef.current != null) {
            const target = pendingSeekRef.current;
            pendingSeekRef.current = null;
            applySeek(target);
        }
    };

    const onVideoTimeUpdate = () => {
        if (!videoRef.current || viewStart == null) return;
        const nowTs = viewStart + videoRef.current.currentTime * 1000;
        let match: WaterfallStep | null = null;
        for (const s of visibleSteps) {
            if (s.startTs <= nowTs) match = s;
            else break; // steps are time-sorted, so the first one past `nowTs` ends the search
        }
        setActiveStepKey(match ? match.key : null);
    };

    // PDF goes through the browser's own print-to-PDF rather than a bundled PDF
    // library: no extra dependency, and the print stylesheet below already
    // renders a clean report (title block + totals + full step table) instead
    // of a screenshot of the dashboard.
    const exportPdf = () => window.print();

    // Renders the recording and the waterfall side by side into one video by
    // painting both onto a canvas and recording that canvas. Capture is
    // real-time, so this plays the recording through once at 1x - a 20s
    // session takes 20s to export.
    const exportSessionVideo = async () => {
        const video = videoRef.current;
        if (!video || !videoUrl) {
            setExportError("A screen recording is needed for this export.");
            return;
        }
        const mimeType = pickRecorderMime();
        if (typeof MediaRecorder === "undefined" || !mimeType) {
            setExportError("This browser can't record a composite video (MediaRecorder unavailable).");
            return;
        }

        setExportError("");
        setIsExporting(true);
        setExportProgress({ cur: 0, total: 0 });

        const canvas = document.createElement("canvas");
        canvas.width = 1600;
        canvas.height = 900;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            setIsExporting(false);
            setExportError("Could not create a canvas for the export.");
            return;
        }

        let raf = 0;
        let recorder: MediaRecorder | null = null;
        const wasPaused = video.paused;
        const wasMuted = video.muted;
        // Capture is driven by requestAnimationFrame, which browsers throttle to
        // a near-stop in a backgrounded tab. The video keeps playing, so the
        // export "succeeds" - with a long stretch of one frozen frame in it.
        // Notice it rather than handing back a quietly broken file.
        let wentHidden = document.hidden;
        const onVisibility = () => { if (document.hidden) wentHidden = true; };
        document.addEventListener("visibilitychange", onVisibility);
        try {
            video.pause();
            // Muted for the duration: this plays the whole recording through at
            // 1x, and blasting its audio for 20s is not what anyone wants. It
            // also sidesteps autoplay policy - `play()` on a muted element is
            // always allowed, whereas an unmuted one can reject with
            // NotAllowedError if the click's transient activation was already
            // spent by the dropdown that launched this.
            video.muted = true;
            if (video.readyState < 1) await onceEvent(video, "loadedmetadata", 20000, "the recording's metadata");
            if (video.currentTime > 0.01) {
                video.currentTime = 0;
                await onceEvent(video, "seeked", 15000, "the video to rewind to the start");
            }

            const chunks: Blob[] = [];
            const stream = canvas.captureStream(30);
            recorder = new MediaRecorder(stream, { mimeType });
            recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

            const total = isFinite(video.duration) ? video.duration : 0;
            let lastSecond = -1;
            // A throw inside a requestAnimationFrame callback doesn't reach the
            // try/catch around this function - it just kills the loop. The
            // canvas then freezes on its last frame while MediaRecorder happily
            // keeps recording that frozen frame, which is exactly what a
            // "broken" export looks like. Capture it and surface it instead.
            let drawError: Error | null = null;
            const draw = () => {
                try {
                    const nowTs = (viewStart ?? startTime) + video.currentTime * 1000;
                    drawSessionFrame({
                        ctx, width: canvas.width, height: canvas.height, video,
                        steps: displaySteps, totalsSteps: visibleSteps, startTime, totalTime, nowTs,
                        sessionMs: sessionMsOverride ?? totalTime,
                    });
                } catch (err: any) {
                    drawError = err instanceof Error ? err : new Error(String(err));
                    return; // stop the loop; the awaits below will report it
                }
                const sec = Math.floor(video.currentTime);
                if (sec !== lastSecond) {
                    lastSecond = sec;
                    setExportProgress({ cur: sec, total: Math.floor(total) });
                }
                raf = requestAnimationFrame(draw);
            };

            // Timeslice, not one giant blob at the end: chunks are flushed every
            // second, so a long session doesn't hinge on a single final flush.
            recorder.start(1000);
            draw();
            const ended = onceEvent(video, "ended");
            await video.play();
            // Whichever settles first wins: a clean finish, or the stall
            // watchdog rejecting. Without the race a stalled video meant an
            // export that never returned.
            const playback = { finished: false };
            try {
                await Promise.race([ended, playbackStalled(video, playback)]);
            } finally {
                playback.finished = true;
            }
            if (drawError) throw drawError;

            cancelAnimationFrame(raf);
            raf = 0;
            recorder.stop();
            await onceEvent(recorder, "stop", 30000, "the recorder to flush");

            // Type and extension both come from what the recorder ACTUALLY
            // negotiated - hardcoding "webm" here mislabels an mp4 recording and
            // makes a perfectly good file look corrupt to the player.
            const actualMime = recorder.mimeType || mimeType;
            const baseMime = actualMime.split(";")[0] || "video/webm";
            if (!chunks.length) throw new Error("Recording produced no data - nothing was captured.");
            const blob = new Blob(chunks, { type: baseMime });
            if (blob.size === 0) throw new Error("Recording produced an empty file.");
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `wavepulse-session-${new Date().toISOString().replace(/[:.]/g, "-")}.${extForMime(actualMime)}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 30000);
            if (wentHidden) {
                setExportError("Export finished, but this tab was in the background part of the time - those seconds will show a frozen frame. Re-export with the tab visible for a clean capture.");
            }
        } catch (e: any) {
            setExportError(e?.message || "Export failed.");
        } finally {
            if (raf) cancelAnimationFrame(raf);
            try { if (recorder && recorder.state !== "inactive") recorder.stop(); } catch {}
            document.removeEventListener("visibilitychange", onVisibility);
            if (wasPaused) video.pause();
            video.muted = wasMuted;
            setIsExporting(false);
            setExportProgress(null);
        }
    };

    return (
        <div className="w-full h-full flex flex-row wp-perf-root">
            {/* Print-to-PDF report shaping. On screen this is all inert; when
                printing, the left recording panel and interactive controls drop
                out, the waterfall panel expands to the full page, and the
                otherwise-hidden report header appears - so "Report (PDF)"
                produces a document rather than a picture of the dashboard. */}
            <style>{`
                .wp-print-only { display: none; }
                @media print {
                    .wp-no-print { display: none !important; }
                    .wp-perf-root { display: block !important; height: auto !important; }
                    .wp-perf-left { display: none !important; }
                    .wp-perf-right {
                        width: 100% !important; height: auto !important;
                        overflow: visible !important;
                    }
                    .wp-perf-right .sticky { position: static !important; }
                    .wp-print-only { display: block !important; }
                    .wp-perf-row { break-inside: avoid; }
                    @page { margin: 14mm; }
                }
            `}</style>
            <div className="wp-print-only px-4 pt-2 pb-3">
                <div className="text-lg font-bold text-color">Application Performance Report</div>
                <div className="text-xs text-gray-500">
                    Generated {new Date().toLocaleString()}
                    {sessionMsOverride != null ? ` · Recorded session ${fmtMs(sessionMsOverride)}` : ""}
                    {` · ${displaySteps.length} step${displaySteps.length === 1 ? "" : "s"}`}
                    {slowOnly ? ` (showing only steps over ${SLOW_THRESHOLD_MS}ms)` : ""}
                </div>
            </div>
            <div className="w-2/5 h-full flex flex-col gap-3 overflow-hidden p-4 border-r wp-perf-left">
                {!supported && (
                    <div className="text-sm text-amber-600">
                        {UNSUPPORTED_MESSAGES[unsupportedReason] || DEFAULT_UNSUPPORTED_MESSAGE}
                    </div>
                )}
                <div className="flex items-center gap-2">
                    <Button
                        color={isRecording ? "danger" : "primary"}
                        isDisabled={!supported || isStarting}
                        onClick={() => (isRecording ? stopRecording() : startRecording())}
                    >
                        {isRecording ? "Stop Recording" : isStarting ? "Starting…" : "Start Recording"}
                    </Button>
                    {isRecording && <span className="text-xs text-red-500 animate-pulse">Recording…</span>}
                </div>
                {error && <div className="text-sm text-red-500">{error}</div>}
                {videoUrl && (
                    <>
                        {/* flex-1 + min-h-0 inside a non-scrolling column: the box takes
                            exactly the height left over after the button/messages, so the
                            video fills the panel without ever overflowing it. min-h-0 is
                            required - a flex child defaults to min-height:auto, which
                            would let it grow past the container and reintroduce scrolling.
                            object-contain then scales the video to fit that box whatever
                            its real aspect ratio is. */}
                        <div className="w-full flex-1 min-h-0 rounded border bg-black overflow-hidden">
                            <video
                                ref={videoRef}
                                className="w-full h-full"
                                style={{ objectFit: "contain" }}
                                src={videoUrl}
                                controls
                                onTimeUpdate={onVideoTimeUpdate}
                                onLoadedMetadata={onLoadedMetadata}
                            />
                        </div>
                        <div className="text-[11px] text-gray-500 flex-shrink-0">
                            Click a row in the waterfall to jump the video to that moment.
                        </div>
                    </>
                )}
                {recording && !recording.url && !recording.error && !isRecording && (
                    <div className="text-sm text-gray-500">Uploading recording…</div>
                )}
            </div>
            <div className="w-3/5 h-full overflow-x-hidden overflow-y-auto relative wp-perf-right">
                <div className="sticky top-0 z-10">
                    <div className="bg-zinc-100 px-4 py-1 flex flex-row content-center w-full">
                        <div className="flex flex-1 flex-col justify-center text-xs font-bold text-color">
                            Performance Waterfall
                        </div>
                        <div className="flex items-center gap-1 wp-no-print">
                            <Dropdown>
                                <DropdownTrigger>
                                    <Button
                                        size="sm"
                                        variant="bordered"
                                        className="h-6 min-w-0 px-2 text-xs"
                                        isDisabled={!visibleSteps.length || isExporting}
                                    >
                                        {isExporting
                                            ? (exportProgress && exportProgress.total
                                                ? `Recording ${exportProgress.cur}/${exportProgress.total}s`
                                                : "Exporting…")
                                            : "Export"}
                                        <ChevronDownIcon width={12} height={12} />
                                    </Button>
                                </DropdownTrigger>
                                <DropdownMenu aria-label="Export options">
                                    <DropdownItem
                                        key="pdf"
                                        description="A printable performance report of this session"
                                        onPress={exportPdf}
                                    >
                                        Report (PDF)
                                    </DropdownItem>
                                    <DropdownItem
                                        key="video"
                                        description="One video: screen recording and this waterfall side by side. Records in real time, so it takes as long as the session."
                                        onPress={exportSessionVideo}
                                    >
                                        Full session video
                                    </DropdownItem>
                                </DropdownMenu>
                            </Dropdown>
                            <Button
                                isIconOnly
                                className="bg-transparent w-8 h-6"
                                onClick={() => clearSteps()}
                            >
                                <DeleteIcon></DeleteIcon>
                            </Button>
                        </div>
                    </div>
                    {exportError && (
                        <div className="px-4 py-1 text-xs text-red-500 wp-no-print">{exportError}</div>
                    )}
                    {showingStored && (
                        <div className="flex items-center gap-3 px-4 py-1.5 bg-blue-50 border-b text-xs">
                            <span className="text-blue-800">
                                Showing the last saved session from{" "}
                                {new Date(stored!.savedAt).toLocaleString()}. The app isn&apos;t sending live data.
                            </span>
                            <Button
                                size="sm"
                                variant="bordered"
                                className="h-6 min-w-0 px-2 text-xs ml-auto wp-no-print"
                                onClick={() => { closeSession(); onCloseSession?.(); }}
                            >
                                Close session
                            </Button>
                        </div>
                    )}
                    <SessionTotals steps={visibleSteps} sessionMsOverride={sessionMsOverride} />
                    {visibleSteps.length > 0 && (
                        <div className="flex items-center gap-2 px-4 py-1.5 border-b bg-white">
                            <Switch
                                size="sm"
                                isSelected={slowOnly}
                                onValueChange={setSlowOnly}
                                classNames={{ label: "text-xs text-color" }}
                                className="wp-no-print"
                            >
                                {`Slow steps only (over ${SLOW_THRESHOLD_MS}ms)`}
                            </Switch>
                            {slowOnly && (
                                <span className="text-xs text-gray-500">
                                    {`${displaySteps.length} of ${visibleSteps.length} shown · ${hiddenCount} under ${SLOW_THRESHOLD_MS}ms hidden`}
                                </span>
                            )}
                        </div>
                    )}
                    <div className="flex flex-row border border-x-0 px-4 py-1 w-full bg-zinc-100">
                        <div className="flex-shrink-0 text-xs text-color w-3/12 font-bold">Name</div>
                        <div className="flex-shrink-0 px-2 text-xs w-2/12 font-bold">Type</div>
                        <div className="flex-shrink-0 px-2 text-xs w-1/12 font-bold">Time</div>
                        <div className="px-2 text-xs w-6/12 font-bold">Waterfall</div>
                    </div>
                </div>
                {visibleSteps.length === 0 && (
                    <div className="p-4 text-xs text-gray-400">
                        No page loads, navigations, business logic, or API calls captured yet - navigate or interact with the connected app to see them here.
                    </div>
                )}
                {visibleSteps.length > 0 && displaySteps.length === 0 && (
                    <div className="p-4 text-xs text-gray-400">
                        {`Nothing took longer than ${SLOW_THRESHOLD_MS}ms in this session - turn off "Slow steps only" to see all ${visibleSteps.length} steps.`}
                    </div>
                )}
                {displaySteps.map((s, i) => {
                    const meta = KIND_META[s.kind];
                    // Clip to the visible window rather than letting a step that
                    // straddles either edge draw outside the Waterfall column.
                    const rawLeft = ((s.startTs - startTime) / totalTime) * 100;
                    const rawWidth = (s.ms / totalTime) * 100;
                    const mx = Math.max(rawLeft, 0);
                    const w = Math.max(Math.min(rawLeft + rawWidth, 100) - mx, 0.3);
                    const seekable = inRecordingWindow(s);
                    const active = s.key === activeStepKey;
                    return (
                        <div
                            key={s.key}
                            className={
                                "wp-perf-row flex flex-row w-full items-center border border-x-0 border-t-0 px-4 py-1.5 "
                                + (seekable ? "cursor-pointer hover:bg-zinc-50 " : "")
                                + (active ? "bg-amber-100 border-l-2 border-l-amber-500 " : (i % 2 ? "bg-zinc-50/50 " : ""))
                            }
                            title={seekable ? `${s.detail} — click to jump the video here` : s.detail}
                            onClick={() => seekable && !isExporting && seekToStep(s)}
                        >
                            <div className="flex-shrink-0 text-xs text-color w-3/12 truncate">{s.label}</div>
                            <div className="flex-shrink-0 px-0 w-2/12">
                                <span className={"px-2 text-[10px] text-center border rounded-lg whitespace-nowrap " + meta.badge}>
                                    {meta.label}
                                </span>
                            </div>
                            <div className="flex-shrink-0 px-2 text-xs w-1/12 font-medium">{fmtMs(s.ms)}</div>
                            <div className="relative px-2 text-xs w-6/12 h-5">
                                <div
                                    className={"absolute top-0 h-5 rounded-sm border flex items-center " + meta.bar}
                                    style={{ left: `calc(${mx}% + 8px)`, width: w + "%" }}
                                >
                                    {/* Label rendered in white, inside the bar - only safe once the bar is
                                        wide enough to actually hold it; on a narrow bar most of this text
                                        would spill onto the white row background and become invisible
                                        (white-on-white), which is exactly what was happening before. */}
                                    {w >= 8 && <span className="px-1 text-[10px] text-white whitespace-nowrap">{fmtMs(s.ms)}</span>}
                                </div>
                                {w < 8 && (
                                    <span
                                        className="absolute top-0 text-[10px] text-color leading-5 whitespace-nowrap"
                                        style={{ left: `calc(${mx + w}% + 12px)` }}
                                    >
                                        {fmtMs(s.ms)}
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
