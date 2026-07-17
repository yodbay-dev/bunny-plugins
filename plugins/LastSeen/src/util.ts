import { findByStoreName } from "@vendetta/metro";
import { getAssetIDByName } from "@vendetta/ui/assets";

const UserStore = findByStoreName("UserStore");
const ChannelStore = findByStoreName("ChannelStore");

export const ACTIVE_STATUSES = ["online", "dnd", "streaming"];

export const STATUS_DE: Record<string, string> = {
    online: "Online",
    idle: "Abwesend",
    dnd: "Bitte nicht stören",
    streaming: "Streamt",
    offline: "Offline",
    invisible: "Offline",
};

export const isActive = (s?: string) => !!s && ACTIVE_STATUSES.includes(s);

const pad = (n: number) => String(n).padStart(2, "0");

export function hhmm(ts: number): string {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "vor 2 Std." / "vor 5 Min." / "gerade eben" */
export function relTime(ts: number): string {
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60_000);
    if (min < 1) return "gerade eben";
    if (min < 60) return `vor ${min} Min.`;
    const h = Math.floor(min / 60);
    if (h < 24) return `vor ${h} Std.`;
    const d = Math.floor(h / 24);
    return `vor ${d} ${d === 1 ? "Tag" : "Tagen"}`;
}

/** "heute 14:30" / "gestern 14:30" / "12.07. 14:30" */
export function absTime(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ts >= startOfToday) return `heute ${hhmm(ts)}`;
    if (ts >= startOfToday - 86_400_000) return `gestern ${hhmm(ts)}`;
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}. ${hhmm(ts)}`;
}

/** "12 Min." / "3 Std. 24 Min." */
export function duration(ms: number): string {
    const min = Math.max(1, Math.floor(ms / 60_000));
    if (min < 60) return `${min} Min.`;
    const h = Math.floor(min / 60);
    const rest = min % 60;
    return rest ? `${h} Std. ${rest} Min.` : `${h} Std.`;
}

export function displayName(userId: string): string {
    try {
        const u = UserStore.getUser(userId);
        return u?.globalName ?? u?.global_name ?? u?.username ?? "Unbekannter Nutzer";
    } catch {
        return "Unbekannter Nutzer";
    }
}

/** Erste vorhandene Icon-Asset-ID aus einer Liste von Kandidaten (Asset-Namen ändern sich zwischen Discord-Versionen) */
export function firstAsset(...names: string[]): number | undefined {
    for (const n of names) {
        try {
            const id = getAssetIDByName(n);
            if (id) return id;
        } catch { /* weiter probieren */ }
    }
    return undefined;
}

export const icons = {
    clock: () => firstAsset("ic_clock", "ClockIcon", "ic_clock_timeout_16px"),
    bell: () => firstAsset("BellIcon", "ic_notifications", "ic_notif"),
    bellOff: () => firstAsset("BellZIcon", "ic_notifications_off", "BellSlashIcon"),
    trash: () => firstAsset("TrashIcon", "ic_trash_24px", "trash"),
    play: () => firstAsset("PlayIcon", "ic_play", "play"),
    link: () => firstAsset("LinkIcon", "ic_link", "img_nitro_star"),
    file: () => firstAsset("FileIcon", "ic_upload", "AttachmentIcon"),
};

export function isDM(channel: any): boolean {
    if (!channel) return false;
    try {
        if (typeof channel.isDM === "function") return channel.isDM();
    } catch { /* fallthrough */ }
    return channel.type === 1;
}

export function dmRecipientId(channel: any): string | null {
    if (!isDM(channel)) return null;
    return channel.recipients?.[0]
        ?? channel.rawRecipients?.[0]?.id
        ?? null;
}

export function getChannel(channelId: string): any {
    try {
        return ChannelStore.getChannel(channelId);
    } catch {
        return null;
    }
}
