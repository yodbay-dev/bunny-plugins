import { findByProps } from "@vendetta/metro";
import { React } from "@vendetta/metro/common";
import { after, before } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";
import { findInReactTree } from "@vendetta/utils";

import { getInfoText, toggleBell } from "./tracker";
import { dmRecipientId, getChannel, icons } from "./util";

const LazyActionSheet = findByProps("openLazy", "hideActionSheet");
const Row = findByProps("ActionSheetRow")?.ActionSheetRow ?? Forms.FormRow;

/** Wird ins Long-Press-Menü einer DM injiziert. useProxy sorgt dafür, dass
 *  der Glocken-Zustand sofort auch hier aktualisiert wird, egal wo er umgeschaltet wurde. */
function LastSeenRows({ userId }: { userId: string; }) {
    useProxy(storage);
    const bell = !!storage.bells[userId];

    return (
        <>
            <Row
                label={getInfoText(userId)}
                icon={<Row.Icon source={icons.clock()} />}
                onPress={() => { /* reine Info-Zeile */ }}
            />
            <Row
                label={bell ? "Statusglocke: An ✓" : "Statusglocke: Aus"}
                icon={<Row.Icon source={bell ? icons.bell() : icons.bellOff()} />}
                onPress={() => toggleBell(userId)}
            />
        </>
    );
}

export default function patchSheet(): () => void {
    return before("openLazy", LazyActionSheet, ([component, key, props]) => {
        if (key !== "ChannelLongPressActionSheet") return;

        const channel = props?.channel ?? (props?.channelId ? getChannel(props.channelId) : null);
        const userId = dmRecipientId(channel);
        if (!userId) return;

        component.then((instance: any) => {
            const unpatch = after("default", instance, (_: any, comp: any) => {
                React.useEffect(() => () => { unpatch(); }, []);

                const rows = <LastSeenRows userId={userId} />;

                // Bevorzugt in die Button-Liste des Sheets einhängen …
                const buttons = findInReactTree(comp, x => Array.isArray(x) && x[0]?.type?.name === "ButtonRow");
                if (buttons) {
                    buttons.unshift(rows);
                    return;
                }
                // … sonst unten ans Sheet anhängen (robust gegen Discord-Umbauten).
                return (
                    <>
                        {comp}
                        {rows}
                    </>
                );
            });
        });
    });
}
