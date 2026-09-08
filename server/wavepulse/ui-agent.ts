"use client";
import { Agent, Channel, WebSocketChannel } from '@wavemaker/wavepulse-agent';
import { CALLS } from '@/wavepulse/constants';
import axios from 'axios';
import { Subject } from 'rxjs';

const WAVEPULSE_SESSION_DATA = 'wavepulse:session_data';
const WAVEPULSE_LIVE_SESSION_PREFIX = 'wavepulse:live_session:';
const LIVE_SESSION_PERSIST_DEBOUNCE_MS = 300;
const HEALTH_CHECK_INTERVAL_MS = 10000;

export class UIAgent extends Agent {

    private connectionSubject = new Subject();
    private _isConnected = false;
    private _sessionData = {} as any;
    private _currentSessionData = {} as any;
    private _sessionDataKey = '';
    private liveSessionStorageKey = '';
    private persistTimeoutId: any;

    constructor(private wsurl: string,
        private httpurl: string,
        public channelId: string,
        private localStorage: Storage,
        sessionDataKey?: string,) {
        // Older builds stored an imported session's key here, origin-wide, which
        // silently flipped every other open tab into offline mode on its next
        // reload (nothing writes this anymore - see the removed `sessionDataKey`
        // setter). Clear any leftover value so a stale entry from a previous
        // version can't still trigger that on a fresh load.
        localStorage.removeItem(WAVEPULSE_SESSION_DATA);
        sessionDataKey = sessionDataKey || '';
        super(sessionDataKey ? {
            send: () => {},
            setListener: () => {}
        } as Channel: WebSocketChannel.connect({
            url: wsurl,
            path: '/wavepulse/socket.io',
            channelId: channelId
        }));
        if (!sessionDataKey) {
            this.checkForWavePulseAgent();
            // Live sessions have no sessionDataKey, so a refresh would otherwise
            // start every hook from empty state. Cache to sessionStorage (cleared
            // when the tab closes) and rehydrate here.
            this.liveSessionStorageKey = WAVEPULSE_LIVE_SESSION_PREFIX + channelId;
            this._sessionData = this.loadLiveSessionData();
            this._currentSessionData = this.createPersistingSessionData();
        };
        this._sessionDataKey = sessionDataKey || '';
    }

    private loadLiveSessionData() {
        try {
            const raw = window.sessionStorage.getItem(this.liveSessionStorageKey);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    private createPersistingSessionData() {
        return new Proxy({} as any, {
            set: (target, prop, value) => {
                target[prop as string] = value;
                this.schedulePersist(target);
                return true;
            }
        });
    }

    private schedulePersist(data: any) {
        clearTimeout(this.persistTimeoutId);
        this.persistTimeoutId = setTimeout(() => {
            try {
                window.sessionStorage.setItem(this.liveSessionStorageKey, JSON.stringify(data));
            } catch (e) {
                // sessionStorage unavailable/full; live cache is best-effort.
            }
        }, LIVE_SESSION_PERSIST_DEBOUNCE_MS);
    }

    // Base for this dashboard's own API routes (already includes the /wavepulse
    // basePath), so callers don't have to reconstruct it from window.location.
    get apiBaseUrl() {
        return this.httpurl;
    }

    get sessionData() {
        return this._sessionData;
    }

    get currentSessionData() {
        return this._currentSessionData;
    }

    get sessionDataKey() {
        return this._sessionDataKey;
    }

    private async checkForWavePulseAgent() {
        try {
            await this.invoke(CALLS.HANDSHAKE.WISH, [], {
                timeout: 2000
            });
            this.setConnected(true);
            setTimeout(() => this.checkForWavePulseAgent(), HEALTH_CHECK_INTERVAL_MS);
        } catch(e) {
            this.setConnected(false);
            this.checkForWavePulseAgent();
        }
    }

    private setConnected(connected: boolean) {
        if (this._isConnected !== connected) {
            this._isConnected = connected;
            this.connectionSubject.next(this.isConnected);
        }
    }

    get isConnected() {
        return this._isConnected && !this.sessionDataKey;
    }

    public onConnect(callback : Function) {
        callback();
        const subscription = this.connectionSubject.subscribe(() => callback());
        return () => subscription.unsubscribe();
    }

    public getWavepulseUrl({appId, expoUrl} : {appId?: string, expoUrl?: string}) {
        if (appId) {
            return axios.get(`${this.httpurl}/api/service/url?appId=${appId}&channelId=${this.channelId}`).then(res => res.data);
        } else if(expoUrl) {
            return axios.get(`${this.httpurl}/api/service/url?expoUrl=${expoUrl}&channelId=${this.channelId}`).then(res => res.data);
        }
        return Promise.resolve('');
    }

    exportSessionData(name: string) {
        name = name + '.wavepulse';
        const form = new FormData();
        form.append('filename', name);
        const entries = [] as any;
        Object.keys(this.currentSessionData).forEach((k: string) => {
            form.append(k, JSON.stringify(this.currentSessionData[k]));
            entries.push(k);
        });
        form.append('entries', JSON.stringify(entries));
        return axios.post(`${this.httpurl}/api/session/data/export`, form,  {
            headers: {
                'Content-Type': 'multipart/form'
            }
        }).then(res => {
            window.location.href = `${this.httpurl}/api/session/data/${res.data.path}?name=${name}.zip`;
        });
    }

    importSessionData(file: any) {
        const formData = new FormData();
        formData.append("file", file);
        return axios.post(`${this.httpurl}/api/session/data/import`, formData, {
            headers: {
                'Content-Type': 'multipart/form'
            }
        }).then((res) => {
            this._sessionData = {...res.data};
            this._sessionDataKey = file.name;
        });
    }
}