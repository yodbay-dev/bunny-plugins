import { findByStoreName } from "@vendetta/metro";
import { FluxDispatcher } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { showToast } from "@vendetta/ui/toasts";

import { playBellSound } from "./sound";
import {
    absTime, displayName, dmRecipientId, duration, getChannel,
    hhmm, icons, isActive, isDM, relTime, STATUS_DE,
} from "./util";

const PresenceStore = findByStoreName("PresenceStore");
const UserStore = findByStoreName("UserStore");

/**
 * Nur pro Sitzung gültige Daten (bewusst NICHT persistiert):
 * Nach einem App-Neustart wissen wir nicht, was während der Schließzeit passiert ist,
 * daher wären persistierte "online seit"/"abwesend seit"-Werte erfunden.
 */
export const session = {
    statuses: {} as Record<string, string>,
    onlineSince: {} as Record<string, number>,
    idleSince: {} as Record<string, number>,
};

const NOTIFY_DEBOUNCE_MS = 10_000;
const lastNotify: Record<string, number> = {};
const lastTypingSound: Record<string, number> = {};
const lastOpenToast: Record<string, number> = {};

let unsubs: (() => void)[] = [];
let sweepInterval: ReturnType<typeof setInterval> | undefined;

const normalize = (s?: string) => (!s || s === "invisible" ? "offline" : s);

function seenRec(id: string) {
    storage.seen[id] ??= {};
    return storage.seen[id];
}

/** IDs, für die wir Verlauf mitschreiben: DM-Kontakte + Glocken + bereits bekannte */
function trackedIds(): Set<string> {
    const ids = new Set<string>([
        ...Object.keys(storage.seen ?? {}),
        ...Object.keys(storage.bells ?? {}),
    ]);
    try {
        const store = findByStoreName("PrivateChannelsStore");
        const chans = store?.getPrivateChannels?.() ?? store?.getMutablePrivateChannels?.();
        if (chans) {
            for (const ch of Object.values<any>(chans)) {
                const rid = dmRecipientId(ch);
                if (rid) ids.add(rid);
            }
        }
    } catch { /* Store nicht verfügbar – dann nur bekannte IDs */ }
    try {
        const self = UserStore.getCurrentUser()?.id;
        if (self) ids.delete(self);
    } catch { /* egal */ }
    return ids;
}

function handleTransition(id: string, next: string) {
    const now = Date.now();
    const prev = session.statuses[id]; // undefined = noch nie gesehen
    session.statuses[id] = next;

    if (prev === undefined) {
        // Kein beobachteter Wechsel – aber wenn wir jemanden gerade aktiv sehen,
        // ist das eine echte Live-Beobachtung und darf als "zuletzt online" zählen.
        if (isActive(next)) seenRec(id).lastSeenActive = now;
        return;
    }

    if (prev === next) {
        if (isActive(next)) seenRec(id).lastSeenActive = now;
        return;
    }

    // Echter, live beobachteter Statuswechsel
    const rec = seenRec(id);
    rec.lastChange = now;
    rec.from = prev;
    rec.to = next;

    if (isActive(prev) && !isActive(next)) rec.lastSeenActive = now;
    if (!isActive(prev) && isActive(next)) session.onlineSince[id] = now;
    if (next === "offline") delete session.onlineSince[id];

    if (next === "idle") session.idleSince[id] = now;
    else delete session.idleSince[id];

    maybeNotify(id, prev, next);
}

function maybeNotify(id: string, from: string, to: string) {
    if (!storage.settings.notifyEnabled) return;
    if (!storage.bells[id]) return;

    const now = Date.now();
    if (now - (lastNotify[id] ?? 0) < NOTIFY_DEBOUNCE_MS) return;
    lastNotify[id] = now;

    showToast(
        `🔔 ${displayName(id)} ist jetzt ${STATUS_DE[to] ?? to} (vorher: ${STATUS_DE[from] ?? from})`,
        icons.bell()
    );
    void playBellSound(id);
}

function onPresenceUpdates(payload: any) {
    try {
        const updates = payload?.updates ?? (payload?.user ? [payload] : []);
        const self = UserStore.getCurrentUser()?.id;
        for (const u of updates) {
            const id = u?.user?.id;
            if (!id || id === self) continue;
            handleTransition(id, normalize(u.status));
        }
    } catch { /* niemals den Dispatcher crashen */ }
}

function onTypingStart(payload: any) {
    try {
        const s = storage.settings;
        if (!s.notifyEnabled || !s.typingSound) return;
        const userId = payload?.userId;
        if (!userId || !storage.bells[userId]) return;

        const ch = getChannel(payload.channelId);
        if (!isDM(ch) || dmRecipientId(ch) !== userId) return;

        const now = Date.now();
        if (now - (lastTypingSound[userId] ?? 0) < NOTIFY_DEBOUNCE_MS) return;
        lastTypingSound[userId] = now;

        void playBellSound(userId);
    } catch { /* ignorieren */ }
}

function onChannelSelect(payload: any) {
    try {
        if (!storage.settings.showToastOnOpen) return;
        const ch = getChannel(payload?.channelId);
        const rid = dmRecipientId(ch);
        if (!rid) return;

        const now = Date.now();
        if (now - (lastOpenToast[rid] ?? 0) < 8000) return;
        lastOpenToast[rid] = now;

        showToast(`${displayName(rid)}: ${getInfoText(rid)}`, icons.clock());
    } catch { /* ignorieren */ }
}

/**
 * Minütlicher Abgleich: hält "zuletzt online" für gerade aktive Kontakte frisch,
 * damit der Wert auch dann stimmt, wenn die App beendet wird, während jemand
 * noch online ist (der Übergang zu offline wäre dann nicht mehr beobachtbar).
 */
function sweep() {
    try {
        const now = Date.now();
        for (const id of trackedIds()) {
            const st = normalize(PresenceStore.getStatus?.(id));
            session.statuses[id] ??= st;
            if (isActive(st)) seenRec(id).lastSeenActive = now;
        }
    } catch { /* ignorieren */ }
}

/** Baut den deutschen Anzeigetext für einen Nutzer. */
export function getInfoText(userId: string): string {
    const s = storage.settings;
    let status = session.statuses[userId];
    if (status === undefined) {
        try { status = normalize(PresenceStore.getStatus?.(userId)); } catch { status = "offline"; }
    }

    if (isActive(status)) {
        const base = STATUS_DE[status] ?? "Online";
        const since = session.onlineSince[userId];
        // "Online seit" nur, wenn der Übergang in den aktiven Status selbst
        // live beobachtet wurde – sonst wäre der Wert erfunden.
        if (s.showOnlineSince && since) return `${base} seit ${duration(Date.now() - since)}`;
        return base;
    }

    if (status === "idle") {
        const since = session.idleSince[userId];
        return since ? `Abwesend seit ${hhmm(since)}` : "Abwesend";
    }

    // offline / unsichtbar / unbekannt
    const rec = storage.seen[userId];
    if (rec?.lastSeenActive) {
        return s.timeFormat === "absolute"
            ? `Zuletzt online ${absTime(rec.lastSeenActive)}`
            : `Zuletzt online ${relTime(rec.lastSeenActive)}`;
    }
    return "Zuletzt online: Unbekannt";
}

export function toggleBell(userId: string) {
    if (storage.bells[userId]) {
        delete storage.bells[userId];
        showToast(`Statusglocke für ${displayName(userId)} deaktiviert`, icons.bellOff());
    } else {
        storage.bells[userId] = true;
        showToast(`Statusglocke für ${displayName(userId)} aktiviert`, icons.bell());
    }
}

/** Löscht Verlaufsdaten, behält Glocken & Sounds. */
export function resetData() {
    storage.seen = {};
    session.statuses = {};
    session.onlineSince = {};
    session.idleSince = {};
}

export function startTracking() {
    // Aktuelle Status als Ausgangsbasis merken (ohne Zeiten zu erfinden):
    // Nur so erkennen wir später echte Übergänge.
    try {
        const statuses = PresenceStore.getState?.()?.statuses;
        if (statuses) {
            for (const id of trackedIds()) {
                const st = statuses[id];
                if (st) session.statuses[id] = normalize(st);
            }
        }
    } catch { /* dann eben lazy über die ersten Events */ }

    const subs: [string, (p: any) => void][] = [
        ["PRESENCE_UPDATES", onPresenceUpdates],
        ["TYPING_START", onTypingStart],
        ["CHANNEL_SELECT", onChannelSelect],
    ];
    for (const [ev, fn] of subs) {
        FluxDispatcher.subscribe(ev, fn);
        unsubs.push(() => FluxDispatcher.unsubscribe(ev, fn));
    }

    sweep();
    sweepInterval = setInterval(sweep, 60_000);
}

export function stopTracking() {
    for (const u of unsubs) {
        try { u(); } catch { /* egal */ }
    }
    unsubs = [];
    if (sweepInterval) clearInterval(sweepInterval);
    sweepInterval = undefined;
}
