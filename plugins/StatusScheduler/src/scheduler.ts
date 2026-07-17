import { logger } from "@vendetta";
import { findByPropsAll } from "@vendetta/metro";
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

let interval: ReturnType<typeof setInterval> | undefined;

/**
 * Minütlicher Check. Der Status wird NUR gesetzt, wenn sich die aktuell fällige
 * Regel geändert hat – dadurch wird ein manuell gewählter Status nicht bei jedem
 * Tick überschrieben, sondern erst wieder zum nächsten Regel-Zeitpunkt.
 */
export function tick() {
    try {
        if (!storage.enabled) return;
        const due = computeDue(storage.rules ?? []);
        if (!due) return;

        const key = dueKey(due);
        if (storage.lastApplied === key) return;
        storage.lastApplied = key;

        if (setOwnStatus(due.rule.status)) {
            if (storage.notify) {
                showToast(
                    `Status automatisch auf ${STATUS_LABELS[due.rule.status]} gesetzt (Regel ${due.rule.time})`,
                    getAssetIDByName("ic_clock")
                );
            }
        } else {
            showToast("StatusScheduler: Status-Modul nicht gefunden – Status wurde nicht geändert");
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
