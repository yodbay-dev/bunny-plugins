import { logger } from "@vendetta";
import { findByPropsAll, findByStoreName } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { showToast } from "@vendetta/ui/toasts";

export type ScheduledStatus = "online" | "idle" | "dnd" | "invisible";

export interface Rule {
    id: string;
    time: string;           // "HH:MM", 24h
    status: ScheduledStatus;
}

export const STATUS_LABELS: Record<ScheduledStatus, string> = {
    online: "Online",
    idle: "Abwesend",
    dnd: "Bitte nicht stören",
    invisible: "Unsichtbar",
};

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** null bei ungültiger Eingabe, sonst Minuten seit Mitternacht */
export function parseTime(t: string): number | null {
    const m = TIME_RE.exec(t?.trim() ?? "");
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function normalizeTime(t: string): string {
    const min = parseTime(t)!;
    const h = Math.floor(min / 60);
    return `${String(h).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/**
 * Setzt den EIGENEN Status über dasselbe Settings-Proto-Modul, das auch das
 * normale Status-Auswahlmenü der App verwendet – die Änderung synchronisiert
 * daher genauso wie eine manuelle Auswahl (auch auf andere Geräte).
 */
export function setOwnStatus(status: ScheduledStatus): boolean {
    try {
        const candidates = findByPropsAll("updateAsync", "ProtoClass") ?? [];
        const mod =
            candidates.find((m: any) => m?.ProtoClass?.typeName?.endsWith?.("PreloadedUserSettings"))
            ?? candidates[0];
        if (!mod) return false;

        mod.updateAsync("status", (s: any) => {
            if (s?.status && typeof s.status === "object" && "value" in s.status) {
                s.status.value = status;
            } else {
                s.status = { value: status };
            }
        }, 0);
        return true;
    } catch (e) {
        logger.error("StatusScheduler: Status setzen fehlgeschlagen", e);
        return false;
    }
}

/**
 * Ermittelt die laut Zeitplan zuletzt fällig gewesene Regel – mit Tages-Wrap-around:
 * Bei Regeln 23:00/08:00 ist um 02:00 nachts die 23:00-Regel von GESTERN fällig.
 */
export function computeDue(rules: Rule[], now = new Date()): { rule: Rule; dayOffset: 0 | 1; } | null {
    const valid = rules
        .map(r => ({ rule: r, min: parseTime(r.time) }))
        .filter((x): x is { rule: Rule; min: number; } => x.min !== null)
        .sort((a, b) => a.min - b.min);
    if (!valid.length) return null;

    const nowMin = now.getHours() * 60 + now.getMinutes();
    let due: { rule: Rule; min: number; } | undefined;
    for (const x of valid) {
        if (x.min <= nowMin) due = x;
    }
    if (due) return { rule: due.rule, dayOffset: 0 };
    // Noch keine Regel heute fällig -> letzte Regel von gestern gilt weiter
    return { rule: valid[valid.length - 1].rule, dayOffset: 1 };
}

function dueKey(due: { rule: Rule; dayOffset: 0 | 1; }, now = new Date()): string {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - due.dayOffset);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}#${due.rule.time}#${due.rule.status}`;
}

/**
 * Liest den aktuell eingestellten eigenen Status. null = nicht lesbar
 * (z. B. Modul direkt nach App-Start noch nicht bereit).
 */
export function readOwnStatus(): ScheduledStatus | null {
    try {
        const store = findByStoreName("UserSettingsProtoStore");
        const v = store?.settings?.status?.status?.value;
        if (typeof v === "string" && v) return v as ScheduledStatus;
    } catch { /* Fallback unten */ }
    try {
        const id = findByStoreName("UserStore")?.getCurrentUser?.()?.id;
        const st = id ? findByStoreName("PresenceStore")?.getStatus?.(id) : null;
        // Die eigene Präsenz meldet "offline", wenn man unsichtbar ist
        if (typeof st === "string" && st) return (st === "offline" ? "invisible" : st) as ScheduledStatus;
    } catch { /* nicht lesbar */ }
    return null;
}

let interval: ReturnType<typeof setInterval> | undefined;
let lastErrorKey: string | undefined; // Fehler-Toast nur einmal pro fälliger Regel, nicht jede Minute

/**
 * Minütlicher Check.
 *
 * Standard: Der Status wird nur beim ÜBERGANG auf eine neu fällige Regel gesetzt –
 * ein manuell gewählter Status bleibt bis zum nächsten Regel-Zeitpunkt unangetastet.
 *
 * Mit "Zeitplan durchsetzen" (storage.enforce): Bei jedem Tick wird geprüft, ob der
 * aktuelle Status noch der fälligen Regel entspricht, und sonst zurückgesetzt.
 *
 * Wichtig (Bugfix): storage.lastApplied wird erst NACH einem erfolgreichen
 * Lese-/Schreibversuch gesetzt. Schlägt der Versuch fehl, bleibt die Regel
 * unmarkiert und der nächste Tick (~1 Min.) versucht es automatisch erneut –
 * ein einzelner Fehlschlag kann den Zeitplan nie für den Rest des Tages blockieren.
 */
export function tick() {
    try {
        if (!storage.enabled) return;
        const due = computeDue(storage.rules ?? []);
        if (!due) return;

        const key = dueKey(due);
        const isNewRule = storage.lastApplied !== key;
        if (!isNewRule && !storage.enforce) return;

        const target = due.rule.status;
        const current = readOwnStatus();

        // Nur schreiben, wenn der Zielwert vom aktuell gelesenen Status abweicht.
        if (current !== null && current === target) {
            storage.lastApplied = key; // erfolgreicher Lesevorgang: Ziel steht bereits
            return;
        }
        if (!isNewRule && current === null) return; // Durchsetzen ohne lesbaren Ist-Wert: nichts erzwingen

        if (setOwnStatus(target)) {
            storage.lastApplied = key;
            lastErrorKey = undefined;
            if (storage.notify) {
                showToast(
                    `Status automatisch auf ${STATUS_LABELS[target]} gesetzt (Regel ${due.rule.time})`,
                    getAssetIDByName("ic_clock")
                );
            }
        } else if (lastErrorKey !== key) {
            lastErrorKey = key;
            showToast("StatusScheduler: Status konnte nicht gesetzt werden – neuer Versuch in 1 Minute");
        }
    } catch (e) {
        logger.error("StatusScheduler: Tick fehlgeschlagen", e);
    }
}

/** Startet den Hintergrund-Check; holt sofort den zuletzt fälligen Zustand nach. */
export function start() {
    stop();
    tick();
    interval = setInterval(tick, 60_000);
}

export function stop() {
    if (interval) clearInterval(interval);
    interval = undefined;
}

/** Beim Einschalten des Schalters: fällige Regel sofort (erneut) anwenden. */
export function setEnabled(v: boolean) {
    storage.enabled = v;
    if (v) {
        delete storage.lastApplied;
        start();
    } else {
        stop();
    }
}
