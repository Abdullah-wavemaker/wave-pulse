"use client";
import { CALLS, EVENTS } from "@/wavepulse/constants";
import { AppInfo, NetworkRequest, LogInfo, PlatformInfo, TimelineEvent, DatabaseInfo } from "@/types";
import { UIAgent } from "@/wavepulse/ui-agent";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export const UIAgentContext = createContext<UIAgent>(null as any);
const MAX_CONSOLE_LOGS = 500;
const MAX_NETWORK_REQUETS = 100;
const MAX_TIME_LINE_EVENTS = 100;

export const useLocation = () => {
    const [location, setLocation] = useState(null as any);
    useEffect(() => {
        setLocation(window && window.location);
    }, []);
    return location;
};

export const useLocalStorage = () => {
    const [localStorage, setLocalStorage] = useState(null as any);
    useEffect(() => {
        setLocalStorage(window && window.localStorage);
    }, []);
    return localStorage;
};

export const useConsole = () => {
    const uiAgent = useContext(UIAgentContext);
    const [logs, setLogs] = useState([] as LogInfo[]);
    const clearLogs = useCallback(() => {
        setLogs([]);
    }, [logs]);
    useEffect(() => {
        setLogs(uiAgent.sessionData.logs || []);
    }, [uiAgent.sessionData]);
    useEffect(() => {
        const destroy = uiAgent.subscribe(EVENTS.CONSOLE.LOG, (args) => {
            const logInfo = args[0] as LogInfo;
            setLogs((logs) => {
                const newVal = [...logs, {...logInfo}];
                while (newVal.length > MAX_CONSOLE_LOGS) {
                    newVal.shift();
                }
                return newVal;
            });
        });
        return destroy;
    }, []);
    useEffect(() => {
        uiAgent.currentSessionData.logs = logs;
        (window as any).remoteEvaL = (expr: string) => {
            uiAgent.invoke(CALLS.EXPRESSION.EVAL, [{expr}]).then((data) => {
                console.log(`Eval: ${expr} => ${JSON.stringify(data)}`);
            });
        };
    }, [logs]);
    return {logs, clearLogs};
};

export const useAppConnected = () => {
    const uiAgent = useContext(UIAgentContext);
    const [ showReloadAlert, setShowReloadAlert ] = useState(false);
    useEffect(() => {
        uiAgent.onInvoke(CALLS.HANDSHAKE.RELOAD, () => {
            if (uiAgent.isConnected) {
                setShowReloadAlert(true);
            }
            return Promise.resolve('Hello');
        });
    }, [uiAgent])
    return { showReloadAlert };
};

export const useAppInfo = () => {
    const uiAgent = useContext(UIAgentContext);
    const [appInfo, setAppInfo] = useState({} as AppInfo);
    const refreshAppInfo = useCallback(() => {
        uiAgent.invoke(CALLS.APP.INFO, [])
        .then((args: any) => {
            const appInfo = args as AppInfo;
            setAppInfo(appInfo);
        });
    }, [appInfo]);
    useEffect(() => {
        setAppInfo(uiAgent.sessionData.appInfo || {});
    }, [uiAgent.sessionData]);
    useEffect(() => {
        refreshAppInfo();
    }, []);
    useEffect(() => {
        uiAgent.currentSessionData.appInfo = appInfo;
    }, [appInfo]);
    return { appInfo, refreshAppInfo };
};

export const useStorageEntries = () => {
    const uiAgent = useContext(UIAgentContext);
    const [storage, setStorage] = useState({});
    const refreshStorage = useCallback(() => {
        uiAgent.invoke(CALLS.STORAGE.GET_ALL, [])
        .then((args: any) => {
            setStorage(args);
        });
    }, [storage]);
    useEffect(() => {
        setStorage(uiAgent.sessionData.storage || {});
    }, [uiAgent.sessionData]);
    useEffect(() => {
        refreshStorage();
    }, []);
    useEffect(() => {
        uiAgent.currentSessionData.storage = storage;
    }, [storage]);
    return {storage, refreshStorage};
};

export const usePlatformInfo = () => {
    const uiAgent = useContext(UIAgentContext);
    const [platformInfo, setPlatformInfo] = useState({} as PlatformInfo);
    const refreshPlatformInfo = useCallback(() => {
        uiAgent.invoke(CALLS.PLATFORM.INFO, [])
        .then((args: any) => {
            const platformInfo = args as PlatformInfo;
            setPlatformInfo(platformInfo);
        });
    }, [platformInfo]);
    useEffect(() => {
        setPlatformInfo(uiAgent.sessionData.platformInfo || {});
    }, [uiAgent.sessionData]);
    useEffect(() => {
        refreshPlatformInfo();
    }, []);
    useEffect(() => {
        uiAgent.currentSessionData.platformInfo = platformInfo;
    }, [platformInfo]);
    return {platformInfo, refreshPlatformInfo};
};

export const useDatabases = () => {
    const uiAgent = useContext(UIAgentContext);
    const [databases, setDatbases] = useState([] as DatabaseInfo[]);
    const executeSQl = useCallback((dbName: string, sql: string) => {
        return uiAgent.invoke(CALLS.DATABASE.EXECUTE_SQL, [dbName, sql])
        .then((args: any) => {
            return {
                rowsEffected: args.rowsEffected,
                rows: args.rows as any[]
            }
        });
    }, [databases]);
    const refreshDatabases = useCallback(() => {
        uiAgent.invoke(CALLS.DATABASE.INFO, [])
        .then((args: any) => {
            setDatbases(args as DatabaseInfo[]);
        });
    }, [databases]);
    useEffect(() => {
        setDatbases(uiAgent.sessionData.databases || []);
    }, [uiAgent.sessionData]);
    useEffect(() => {
        refreshDatabases();
    }, []);
    useEffect(() => {
        uiAgent.currentSessionData.databases = databases;
    }, [databases]);
    return {databases, executeSQl};
};

export const useVariables = () => {
    const uiAgent = useContext(UIAgentContext);
    const [variables, setVariables] = useState([] as any[]);
    useEffect(() => {
        setVariables(uiAgent.sessionData.variables || []);
    }, [uiAgent.sessionData]);
    const clearVariables = useCallback(() => {
        setVariables([]);
    }, [variables])
    useEffect(() => {
        const destroy = uiAgent.subscribe(EVENTS.VARIABLE.AFTER_INVOKE, (args) => {
            const variable = args[0] as any;
            setVariables(variables => [...variables, {...variable}]);
        });
        return destroy;
    }, []);
    useEffect(() => {
        uiAgent.currentSessionData.variables = variables;
    }, [variables]);
    return [variables, clearVariables];
};

export const useNetworkRequests = () => {
    const uiAgent = useContext(UIAgentContext);
    const [requests, setRequests] = useState([] as NetworkRequest[]);
    useEffect(() => {
        setRequests(uiAgent.sessionData.requests || []);
    }, [uiAgent.sessionData]);
    const clearRequests = useCallback(() => {
        setRequests([]);
    }, [requests]);
    useEffect(() => {
        const destroy = uiAgent.subscribe(EVENTS.SERVICE.AFTER_CALL, ([req, res]) => {
            const request = {
                id: Date.now() + '',
                name: req.url?.split('?')[0].split('/').findLast((s: string) => s),
                path: req.url,
                method: req.method,
                status: res.status,
                time: ((req.__endTime || 0) - (req.__startTime || 0)),
                req: req,
                res: res
            } as NetworkRequest;
            setRequests((requests) => {
                const newVal = [...requests, {...request}];
                while (newVal.length > MAX_NETWORK_REQUETS) {
                    newVal.shift();
                }
                return newVal;
            });
        });
        return destroy;
    }, [requests]);
    useEffect(() => {
        uiAgent.currentSessionData.requests = requests;
    }, [requests]);
    return {requests, clearRequests};
};

export const useComponentTree = () => {
    const uiAgent = useContext(UIAgentContext);
    const [componentTree, setComponentTree] = useState(null as any);
    useEffect(() => {
        setComponentTree(uiAgent.sessionData.componentTree || null);
    }, [uiAgent.sessionData]);
    const highlight = useCallback((widetId: string) => {
        uiAgent.invoke(CALLS.WIDGET.HIGHLIGHT, [widetId]);
    }, []);
    const refreshComponentTree = useCallback(() => {
        uiAgent.invoke(CALLS.WIDGET.TREE, []).then((data) => {
            setComponentTree(data);
        });
    }, []);
    useEffect(() => {
        const destroy =  uiAgent.subscribe(EVENTS.TIMELINE.EVENT, (args) => {
            const logInfo = args[0] as TimelineEvent<any>;
            if (logInfo.name === 'PAGE_READY') {
                refreshComponentTree();
            }
        });
        return destroy;
    }, [refreshComponentTree]);
    useEffect(refreshComponentTree, []);
    useEffect(() => {
        uiAgent.currentSessionData.componentTree = componentTree;
    }, [componentTree]);
    return {componentTree, refreshComponentTree, highlight};
};

export type RecordingInfo = {
    recordingId: string;
    startTs: number;
    endTs?: number;
    url?: string;
    error?: string;
};

export const useRecording = () => {
    const uiAgent = useContext(UIAgentContext);
    const [isRecording, setIsRecording] = useState(false);
    const [isStarting, setIsStarting] = useState(false);
    const [supported, setSupported] = useState(true);
    const [unsupportedReason, setUnsupportedReason] = useState('');
    const [recording, setRecording] = useState(null as RecordingInfo | null);
    const [error, setError] = useState('');

    // Recover in-progress-recording state across a dashboard refresh - the
    // device keeps recording even if the browser tab reloads mid-session.
    const refreshStatus = useCallback(() => {
        uiAgent.invoke(CALLS.RECORDING.STATUS, []).then((status: any) => {
            setSupported(status.supported !== false);
            setUnsupportedReason(status.supported === false ? (status.reason || '') : '');
            setIsRecording(!!status.recording);
            if (status.recording) {
                setRecording((r) => r || { recordingId: status.recordingId, startTs: status.startTs });
            }
        }).catch(() => {});
    }, []);
    useEffect(() => {
        refreshStatus();
    }, [refreshStatus]);

    useEffect(() => {
        const destroy = uiAgent.subscribe(EVENTS.RECORDING.READY, (args) => {
            const info = args[0] as RecordingInfo;
            // Merge rather than replace: some platforms' READY payload doesn't
            // repeat startTs (only the web path currently does), and a full
            // replace here would silently wipe it out right as the video
            // becomes available - exactly when the dashboard needs it to sync
            // the waterfall to playback.
            setRecording((prev) => ({ ...prev, ...info }));
            setIsRecording(false);
        });
        return destroy;
    }, []);

    const startRecording = useCallback(() => {
        setError('');
        setIsStarting(true);
        // The native promise doesn't resolve until the user finishes the OS's screen-capture
        // consent dialog - including, on Android, the extra "a single app" picker sub-step -
        // which routinely takes longer than a typical RPC round trip.
        return uiAgent.invoke(CALLS.RECORDING.START, [], { timeout: 120000 })
            .then((res: any) => {
                setIsStarting(false);
                if (res.supported === false) {
                    setSupported(false);
                    setUnsupportedReason(res.reason || '');
                    return;
                }
                if (res.error) {
                    setError(res.error);
                    return;
                }
                setIsRecording(true);
                setRecording({ recordingId: res.recordingId, startTs: res.startTs });
            }).catch((e: any) => {
                setIsStarting(false);
                setError(typeof e === 'string' ? e : 'Failed to start recording.');
            });
    }, []);

    const stopRecording = useCallback(() => {
        return uiAgent.invoke(CALLS.RECORDING.STOP, [], { timeout: 15000 })
            .then(() => {
                setIsRecording(false);
                // final url/error arrives async via EVENTS.RECORDING.READY once the upload completes
            }).catch((e: any) => {
                setError(typeof e === 'string' ? e : 'Failed to stop recording.');
            });
    }, []);

    return { isRecording, isStarting, supported, unsupportedReason, recording, error, startRecording, stopRecording };
};

export type PerfEvent = {
    type: string;
    event: string;
    ts: number;
    hts: number;
    seq: number;
    name?: string;
    pageName?: string;
    ms?: number;
    [key: string]: any;
};

export type WaterfallStepKind = 'nav' | 'load' | 'action' | 'api';
export type WaterfallStep = {
    key: string;
    kind: WaterfallStepKind;
    label: string;
    detail: string;
    startTs: number;
    endTs: number;
    ms: number;
};

const MAX_WATERFALL_STEPS = 1000;
// Widget event handlers below this are noise for a customer-facing view - a
// tap whose bound script does essentially nothing still emits an EVENT/DONE.
const MIN_SCRIPT_MS = 1;
// A page has settled once nothing on it has re-rendered for this long. Matches
// the offline tool's RENDER_IDLE_GAP concept (it uses 250ms).
const TTI_SETTLE_GAP_MS = 300;
// A page that never goes quiet (polling, animation) still has to report
// something rather than measuring forever.
const TTI_MAX_WINDOW_MS = 12000;

// Derives curated waterfall steps (page transitions, page load/TTI, business
// logic, API calls) directly from each EVENTS.PERF.EVENT as it arrives, rather
// than storing the raw event stream and recomputing - a busy session (e.g.
// search-as-you-type) produces far more raw noise (EVENT/TRIGGER,
// COMPONENT/UPDATE, ...) than a bounded raw buffer can hold, which was
// silently evicting the curated steps we actually care about once the buffer
// filled. Steps themselves are much rarer, so a much larger cap here still
// covers a realistic session.
export const useWaterfallSteps = () => {
    const uiAgent = useContext(UIAgentContext);
    const [steps, setSteps] = useState([] as WaterfallStep[]);
    const seenTtiLoad = useRef(false);
    // COMPONENT/TTI re-fires on every re-render of a page, and its `ms` is
    // measured from the original MOUNT - so the 2nd, 3rd, ... TTI for a page
    // report "time since mount" (6.14s, ...), not a load time. Only the FIRST
    // TTI after a given mount is a real page-load number, which is also how
    // the offline tool's computeVisits treats it (it takes containerTtis[0]).
    // Tracks which pages have already produced a load step for the current
    // visit; cleared on navigation, and per-page on a fresh FRAGMENT_READY.
    const loadEmittedFor = useRef<Set<string>>(new Set());
    // The page a navigation is heading to, until its TTI arrives. Lets a
    // cached page - which WaveMaker re-attaches instead of remounting, so it
    // only ever produces an update-path TTI - still report a real
    // time-to-interactive for that transition.
    const pendingNavTo = useRef<string | null>(null);
    // In-flight time-to-interactive measurement. The FIRST render after a page
    // appears is not "ready" - it's the shell painting while data is still
    // loading behind skeletons. Readiness is the LAST render before the page
    // goes quiet, so a measurement stays open and keeps extending while any
    // widget on that page is still re-rendering, and only closes after
    // TTI_SETTLE_GAP_MS of silence. Same render-settle rule the offline tool's
    // computeVisits uses.
    const pendingTti = useRef<{
        page: string; anchorTs: number; lastRenderTs: number; fromMount: boolean; seq: number;
    } | null>(null);
    const ttiSettleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const appendStep = useCallback((s: WaterfallStep) => {
        setSteps((prev) => {
            // Collapse repeated page-load steps for the same page (e.g. one
            // TTI per keystroke re-render) - keep only the first.
            const last = prev[prev.length - 1];
            if (s.kind === 'load' && last && last.kind === 'load' && last.label === s.label) {
                return prev;
            }
            const next = [...prev, s];
            while (next.length > MAX_WATERFALL_STEPS) next.shift();
            return next;
        });
    }, []);

    const flushPendingTti = useCallback(() => {
        if (ttiSettleTimer.current) {
            clearTimeout(ttiSettleTimer.current);
            ttiSettleTimer.current = null;
        }
        const p = pendingTti.current;
        pendingTti.current = null;
        if (!p) return;
        if (loadEmittedFor.current.has(p.page)) return;
        loadEmittedFor.current.add(p.page);
        const ms = Math.max(p.lastRenderTs - p.anchorTs, 1);
        appendStep({
            key: 'load-' + p.seq,
            kind: 'load',
            label: p.fromMount ? `${p.page} loaded` : `${p.page} ready`,
            detail: p.fromMount
                ? `${ms.toFixed(0)}ms to interactive (settled after last render)`
                : `${ms.toFixed(0)}ms to interactive after transition (page restored from cache)`,
            startTs: p.anchorTs,
            endTs: p.lastRenderTs,
            ms,
        });
    }, [appendStep]);

    const armTtiSettle = useCallback(() => {
        if (ttiSettleTimer.current) clearTimeout(ttiSettleTimer.current);
        ttiSettleTimer.current = setTimeout(flushPendingTti, TTI_SETTLE_GAP_MS);
    }, [flushPendingTti]);

    const clearSteps = useCallback(() => {
        if (ttiSettleTimer.current) clearTimeout(ttiSettleTimer.current);
        ttiSettleTimer.current = null;
        pendingTti.current = null;
        loadEmittedFor.current.clear();
        pendingNavTo.current = null;
        setSteps([]);
        seenTtiLoad.current = false;
    }, []);

    useEffect(() => () => { if (ttiSettleTimer.current) clearTimeout(ttiSettleTimer.current); }, []);

    useEffect(() => {
        const destroy = uiAgent.subscribe(EVENTS.PERF.EVENT, (args) => {
            const e = args[0] as PerfEvent;

            let step: WaterfallStep | null = null;

            if (e.type === 'NAV' && e.event === 'DISPATCHED' && e.ms != null) {
                // A navigation starts a fresh visit - every page is eligible to
                // report a load time again, and the destination is now awaiting
                // its time-to-interactive.
                loadEmittedFor.current.clear();
                pendingNavTo.current = e.to != null ? String(e.to) : null;
                step = { key: 'nav-' + e.seq, kind: 'nav', label: `${e.from} → ${e.to}`,
                    detail: `${e.ms.toFixed(0)}ms transition`, startTs: e.ts - e.ms, endTs: e.ts, ms: e.ms };
            } else if (e.type === 'COMPONENT' && e.event === 'TTI' && e.ms != null) {
                const page = e.pageName || 'Page';
                const open = pendingTti.current;

                // Any widget still re-rendering on the page being measured means
                // it hasn't settled - extend the window. This is what catches the
                // skeleton -> real-data repaint, which the page CONTAINER alone
                // may not re-render for.
                if (open && open.page === page) {
                    open.lastRenderTs = e.ts;
                    if (open.lastRenderTs - open.anchorTs >= TTI_MAX_WINDOW_MS) flushPendingTti();
                    else armTtiSettle();
                    return;
                }

                // Only a page-level TTI opens a new measurement.
                if (!e.isPage) return;
                const isNavTarget = pendingNavTo.current != null && pendingNavTo.current === page;
                // A mount-path TTI is a genuine load. An update-path TTI only
                // counts as the destination of a just-completed navigation - a
                // cached page being re-attached. Any other update-path TTI is a
                // mid-session re-render (typing, data arriving); accepting those
                // is what produced "Main loaded 36.21s".
                if (e.fromMount === false && !isNavTarget) return;
                if (loadEmittedFor.current.has(page)) return; // double-mount guard
                if (isNavTarget) pendingNavTo.current = null;
                seenTtiLoad.current = true;
                // Open a measurement instead of emitting now - the step is
                // appended once rendering for this page goes quiet.
                flushPendingTti(); // close any measurement for a different page
                pendingTti.current = {
                    page,
                    anchorTs: e.ts - e.ms,
                    lastRenderTs: e.ts,
                    fromMount: e.fromMount !== false,
                    seq: e.seq,
                };
                armTtiSettle();
                return;
            } else if (e.type === 'COMPONENT' && e.event === 'FRAGMENT_READY' && e.isPage) {
                // A fresh fragment-ready means this page mounted again, so it may
                // report a load time once more.
                const page = e.pageName || 'Page';
                loadEmittedFor.current.delete(page);
                if (!seenTtiLoad.current
                    && e.wmPageStartTime != null && e.wmPageReadyTime != null && e.wmPageReadyTime > e.wmPageStartTime) {
                    // Fallback only until the first real TTI-based load shows up -
                    // see the isPage-tagging ordering caveat on the TTI branch.
                    const ms = e.wmPageReadyTime - e.wmPageStartTime;
                    loadEmittedFor.current.add(page);
                    step = { key: 'load-fr-' + e.seq, kind: 'load', label: `${page} loaded`,
                        detail: `${ms.toFixed(0)}ms (WaveMaker page diagnostics)`, startTs: e.wmPageStartTime, endTs: e.wmPageReadyTime, ms };
                }
            } else if (e.type === 'ACTION' && e.event === 'INVOKE_END' && e.ms != null) {
                step = { key: 'action-' + e.seq, kind: 'action', label: e.name || 'unknown',
                    detail: `${e.ms.toFixed(0)}ms`, startTs: e.ts - e.ms, endTs: e.ts, ms: e.ms };
            } else if (e.type === 'EVENT' && e.event === 'DONE' && e.ms != null && e.ms >= MIN_SCRIPT_MS) {
                // The script bound to a widget event (onTap, onChange, ...) running.
                // ms covers the handler's synchronous work only - an API call it
                // kicks off resolves later and is reported as its own API step, so
                // these don't double-count each other.
                const on = e.eventName ? `${e.eventName}` : 'event';
                step = { key: 'script-' + e.seq, kind: 'action',
                    label: `${e.name || 'widget'} · ${on}`,
                    detail: `${e.ms.toFixed(0)}ms of script`, startTs: e.ts - e.ms, endTs: e.ts, ms: e.ms };
            } else if (e.type === 'VAR' && e.event === 'INVOKE_END' && (e.varType === 'service' || e.varType === 'live') && e.ms != null) {
                step = { key: 'api-' + e.seq, kind: 'api', label: e.name || 'unknown',
                    detail: `${e.ms.toFixed(0)}ms response`, startTs: e.ts - e.ms, endTs: e.ts, ms: e.ms };
            }
            if (!step) return;
            appendStep(step);
        });
        return destroy;
    }, [appendStep, flushPendingTti, armTtiSettle]);

    return { steps, clearSteps };
};

export type StoredPerfSession = {
    channelId: string;
    recordingId: string | null;
    startTs: number | null;
    endTs: number | null;
    savedAt: number;
    steps: WaterfallStep[];
};

// Server-side persistence for the last performance session (steps here, the
// recording is already stored by the upload route). Lets the dashboard keep
// showing a finished session after the app disconnects - backgrounded, killed,
// or the tab reloaded - instead of dropping to the connect screen and losing
// everything that was just captured.
export const useStoredPerfSession = () => {
    const uiAgent = useContext(UIAgentContext);
    const [stored, setStored] = useState<StoredPerfSession | null>(null);
    const [checked, setChecked] = useState(false);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const url = (suffix = "") =>
        `${uiAgent.apiBaseUrl}/api/session/perf${suffix}`;

    const reload = useCallback(() => {
        return fetch(`${url()}?channelId=${encodeURIComponent(uiAgent.channelId)}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => { setStored(data || null); setChecked(true); return data || null; })
            .catch(() => { setChecked(true); return null; });
    }, [uiAgent]);

    useEffect(() => { reload(); }, [reload]);

    // Debounced: the settle-based TTI can append a step a few hundred ms after
    // a recording finishes, so an immediate save would miss the last row.
    const saveSession = useCallback((payload: {
        steps: WaterfallStep[]; recordingId?: string | null; startTs?: number | null; endTs?: number | null;
    }) => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
            fetch(url(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    channelId: uiAgent.channelId,
                    recordingId: payload.recordingId ?? null,
                    startTs: payload.startTs ?? null,
                    endTs: payload.endTs ?? null,
                    steps: payload.steps,
                }),
            }).catch(() => {});
        }, 700);
    }, [uiAgent]);

    const closeSession = useCallback(() => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        setStored(null);
        return fetch(`${url()}?channelId=${encodeURIComponent(uiAgent.channelId)}`, { method: "DELETE" })
            .catch(() => {});
    }, [uiAgent]);

    useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

    return { stored, storedChecked: checked, reload, saveSession, closeSession, apiBase: uiAgent.apiBaseUrl };
};

export const useTimelineLog = () => {
    const uiAgent = useContext(UIAgentContext);
    const [timelineLogs, setTimelineLogs] = useState([] as TimelineEvent<any>[]);
    const clearTimelineLogs = useCallback(() => {
        setTimelineLogs([]);
    }, [timelineLogs]);
    const startProfile = useCallback(() => {
        const destroy =  uiAgent.subscribe(EVENTS.TIMELINE.EVENT, (args) => {
            const logInfo = args[0] as TimelineEvent<any>;
            setTimelineLogs(timelineLogs => {
                const newVal = [...timelineLogs];
                const i = newVal.findIndex(v => {
                    return v.startTime > logInfo.startTime;
                });
                if (i < 0) {
                    newVal.push(logInfo);
                } else {
                    newVal.splice(i, 0, logInfo);
                }
                while (newVal.length > MAX_TIME_LINE_EVENTS) {
                    newVal.shift();
                }
                return newVal;
            });
        });
        return destroy;
    }, [uiAgent]);
    useEffect(() => {
        return startProfile();
    }, [])
    useEffect(() => {
        setTimelineLogs(uiAgent.sessionData.timelineLogs || []);
    }, [uiAgent.sessionData]);
    useEffect(() => {
        uiAgent.currentSessionData.timelineLogs = timelineLogs;
    }, [timelineLogs]);
    return {timelineLogs, clearTimelineLogs, startProfile};
};