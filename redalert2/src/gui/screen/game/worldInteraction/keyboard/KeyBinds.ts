import { DataStream } from '@/data/DataStream';
import { IniFile } from '@/data/IniFile';
import { VirtualFile } from '@/data/vfs/VirtualFile';
import { KeyCommandType } from './KeyCommandType';
const numpadArrowMap = new Map([
    [98, 40],
    [100, 37],
    [102, 39],
    [104, 38],
]);
export class KeyBinds {
    static iniSection = "Hotkey";
    private configDir: any;
    private persistFileName: string;
    private defaultIni: any;
    private hotKeys: Map<number, string>;
    constructor(configDir: any, persistFileName: string, defaultIni: any) {
        this.configDir = configDir;
        this.persistFileName = persistFileName;
        this.defaultIni = defaultIni;
        this.hotKeys = new Map();
    }
    async load(): Promise<void> {
        this.hotKeys.clear();
        let useDefault = true;
        let iniFile: any;
        try {
            if (this.configDir &&
                (await this.configDir.containsEntry(this.persistFileName))) {
                iniFile = new IniFile(await this.configDir.openFile(this.persistFileName));
                this.loadHotKeys(iniFile);
                useDefault = false;
            }
        }
        catch (error) {
            console.log(`Failed to load hotkeys from local file "${this.persistFileName}"`, error);
        }
        if (useDefault) {
            iniFile = this.defaultIni;
            const defaultBindings: [KeyCommandType, number][] = [
                [KeyCommandType.PreviousObject, "M".charCodeAt(0)],
                [KeyCommandType.VeterancyNav, "Y".charCodeAt(0)],
                [KeyCommandType.HealthNav, "U".charCodeAt(0)],
                [KeyCommandType.FreeMoney, 582],
                [KeyCommandType.BuildCheat, 593],
                [KeyCommandType.ToggleFps, 512 + "R".charCodeAt(0)],
                [KeyCommandType.ToggleShroud, 1024 + "S".charCodeAt(0)],
                [KeyCommandType.CenterBase, "H".charCodeAt(0)],
                [KeyCommandType.StopObject, "S".charCodeAt(0)],
                [KeyCommandType.DeployObject, "D".charCodeAt(0)],
                [KeyCommandType.ScatterObject, "X".charCodeAt(0)],
                [KeyCommandType.CenterOnRadarEvent, 32], // Space
                [KeyCommandType.StructureTab, "Q".charCodeAt(0)],
                [KeyCommandType.DefenseTab, "W".charCodeAt(0)],
                [KeyCommandType.UnitTab, "R".charCodeAt(0)],
                [KeyCommandType.CombatantSelect, "E".charCodeAt(0)],
                [KeyCommandType.TypeSelect, "T".charCodeAt(0)],
                [KeyCommandType.GuardObject, "G".charCodeAt(0)],
                [KeyCommandType.Follow, "F".charCodeAt(0)],
                [KeyCommandType.ToggleRepair, "K".charCodeAt(0)],
                [KeyCommandType.ToggleSell, "L".charCodeAt(0)],
                [KeyCommandType.Options, 27], // Escape
                [KeyCommandType.TeamSelect_1, "1".charCodeAt(0)],
                [KeyCommandType.TeamSelect_2, "2".charCodeAt(0)],
                [KeyCommandType.TeamSelect_3, "3".charCodeAt(0)],
                [KeyCommandType.TeamSelect_4, "4".charCodeAt(0)],
                [KeyCommandType.TeamSelect_5, "5".charCodeAt(0)],
                [KeyCommandType.TeamSelect_6, "6".charCodeAt(0)],
                [KeyCommandType.TeamSelect_7, "7".charCodeAt(0)],
                [KeyCommandType.TeamSelect_8, "8".charCodeAt(0)],
                [KeyCommandType.TeamSelect_9, "9".charCodeAt(0)],
                [KeyCommandType.TeamSelect_10, "0".charCodeAt(0)],
                [KeyCommandType.TeamCreate_1, 512 + "1".charCodeAt(0)],
                [KeyCommandType.TeamCreate_2, 512 + "2".charCodeAt(0)],
                [KeyCommandType.TeamCreate_3, 512 + "3".charCodeAt(0)],
                [KeyCommandType.TeamCreate_4, 512 + "4".charCodeAt(0)],
                [KeyCommandType.TeamCreate_5, 512 + "5".charCodeAt(0)],
                [KeyCommandType.TeamCreate_6, 512 + "6".charCodeAt(0)],
                [KeyCommandType.TeamCreate_7, 512 + "7".charCodeAt(0)],
                [KeyCommandType.TeamCreate_8, 512 + "8".charCodeAt(0)],
                [KeyCommandType.TeamCreate_9, 512 + "9".charCodeAt(0)],
                [KeyCommandType.TeamCreate_10, 512 + "0".charCodeAt(0)],
            ];
            for (const [commandType, keyCode] of defaultBindings) {
                this.addHotKey(commandType, keyCode);
            }
            if (iniFile) {
                this.loadHotKeys(iniFile);
            }
        }
        this.addHotKey(KeyCommandType.Scoreboard, 9);
    }
    async saveIni(iniFile: any): Promise<void> {
        await this.configDir?.writeFile(new VirtualFile(new DataStream().writeString(iniFile.toString()), this.persistFileName));
    }
    async resetAndReload(): Promise<void> {
        if (this.configDir &&
            (await this.configDir.containsEntry(this.persistFileName))) {
            await this.configDir.deleteFile(this.persistFileName);
        }
        await this.load();
    }
    loadHotKeys(iniFile: any): this {
        const section = iniFile.getSection(KeyBinds.iniSection);
        if (!section)
            throw new Error(`Missing [${KeyBinds.iniSection}] ini section`);
        const commandTypes = Object.keys(KeyCommandType);
        for (const key of section.entries.keys()) {
            if (commandTypes.includes(key)) {
                const keyCode = section.getNumber(key);
                this.changeHotKey(key, keyCode);
            }
            else {
                console.warn("Unknown keyboard command " + key);
            }
        }
        return this;
    }
    async save(): Promise<void> {
        const iniFile = new IniFile();
        const section = iniFile.getOrCreateSection(KeyBinds.iniSection);
        for (const [keyCode, commandType] of this.hotKeys) {
            section.set(commandType, "" + keyCode);
        }
        await this.saveIni(iniFile);
    }
    addHotKey(commandType: string, keyCode: number | KeyboardEvent): void {
        this.hotKeys.set(typeof keyCode === "number" ? keyCode : this.getHotKeyCode(keyCode), commandType);
    }
    changeHotKey(commandType: string, keyCode: number): void {
        for (const hotKeyCode of [...this.hotKeys.entries()]
            .filter(([, type]) => type === commandType)
            .map(([code]) => code)) {
            this.hotKeys.delete(hotKeyCode);
        }
        if (keyCode) {
            this.addHotKey(commandType, keyCode);
        }
    }
    getCommandType(keyEvent: KeyboardEvent): string | undefined {
        if (!(255 < keyEvent.keyCode)) {
            const hotKeyCode = this.getHotKeyCode(keyEvent);
            return this.hotKeys.get(hotKeyCode);
        }
    }
    getHotKeyCode(keyEvent: KeyboardEvent): number {
        let code = (Number(keyEvent.metaKey) << 12) +
            (Number(keyEvent.altKey) << 10) +
            (Number(keyEvent.ctrlKey) << 9) +
            (Number(keyEvent.shiftKey) << 8) +
            keyEvent.keyCode;
        const arrowKey = numpadArrowMap.get(keyEvent.keyCode);
        if (arrowKey) {
            code += 2048 - keyEvent.keyCode + arrowKey;
        }
        return code;
    }
    getHotKey(commandType: string): KeyboardEvent | undefined {
        const hotKeyCode = [...this.hotKeys.entries()].find(([, type]) => type === commandType)?.[0];
        if (hotKeyCode !== undefined) {
            let keyCode = 255 & hotKeyCode;
            if (2048 & hotKeyCode) {
                const originalKey = [...numpadArrowMap].find(([, arrow]) => arrow === keyCode)?.[0];
                if (originalKey) {
                    keyCode = originalKey;
                }
                else {
                    console.error(`Expected an numpad arrow key code but got ${keyCode} (${hotKeyCode}) instead`);
                }
            }
            return {
                keyCode: keyCode,
                shiftKey: Boolean(256 & hotKeyCode),
                ctrlKey: Boolean(512 & hotKeyCode),
                altKey: Boolean(1024 & hotKeyCode),
                metaKey: Boolean(4096 & hotKeyCode),
            } as KeyboardEvent;
        }
    }
}
