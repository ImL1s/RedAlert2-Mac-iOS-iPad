import { jsx } from '@/gui/jsx/jsx';
import { HtmlView } from '@/gui/jsx/HtmlView';
import { ReplaySel } from '@/gui/screen/replay/ReplaySel';
import { ScreenType, MainMenuScreenType } from '@/gui/screen/ScreenType';
import { CompositeDisposable } from '@/util/disposable/CompositeDisposable';
import { MainMenuScreen } from '@/gui/screen/mainMenu/MainMenuScreen';
import { MainMenuRoute } from '@/gui/screen/mainMenu/MainMenuRoute';

interface SaveMeta {
    id: string;
    name: string;
    timestamp: number;
    keep?: boolean;
}

const SAVE_PREFIX = '[SAVE] ';

/**
 * Mid-match save selection. Saves are stored through the replay system (a
 * save is the action log up to the saved tick); loading resimulates the
 * recorded ticks and hands control back to the player.
 */
export class LoadGameScreen extends MainMenuScreen {
    declare public title: string;
    private disposables = new CompositeDisposable();
    private availableSaves: SaveMeta[] = [];
    private selectedSave?: SaveMeta;
    private form?: any;
    constructor(private rootController: any, private strings: any, private jsxRenderer: any, private errorHandler: any, private messageBoxApi: any, private replayManager: any) {
        super();
        this.title = this.strings?.get('GUI:LoadGame') || 'Load Game';
    }
    private handleSelectSave = (save: SaveMeta, doubleClick?: boolean): void => {
        this.selectedSave = save;
        this.updateSidebarButtons();
        this.form?.applyOptions((options: any) => {
            options.selectedReplay = save;
            options.selectedReplayDetails = undefined;
        });
        if (doubleClick) {
            this.loadSelectedSave();
        }
    };
    async onEnter(): Promise<void> {
        this.availableSaves = [];
        this.controller?.toggleMainVideo(false);
        this.controller?.setMainComponent(this.jsxRenderer.render(jsx(HtmlView, {
            innerRef: (ref: any) => (this.form = ref),
            component: ReplaySel,
            props: {
                strings: this.strings,
                replays: undefined,
                selectedReplay: undefined,
                selectedReplayDetails: undefined,
                onSelectReplay: this.handleSelectSave,
            },
        }))[0]);
        try {
            const allReplays = await this.replayManager.loadList(true);
            this.availableSaves = allReplays
                .filter((entry: SaveMeta) => entry.name.startsWith(SAVE_PREFIX))
                .map((entry: SaveMeta) => ({ ...entry, name: entry.name }));
        }
        catch (error: any) {
            this.errorHandler.handle(error, this.strings.get('GUI:ReplayListError'), () => {
                this.controller?.goToScreen(MainMenuScreenType.Home);
            });
            return;
        }
        this.selectedSave = this.availableSaves[0];
        this.form?.applyOptions((options: any) => {
            options.replays = this.availableSaves;
            options.selectedReplay = this.selectedSave;
        });
        this.updateSidebarButtons();
        this.controller?.showSidebarButtons();
    }
    private updateSidebarButtons(): void {
        this.controller?.setSidebarButtons([
            {
                label: this.strings.get('GUI:LoadGame') || 'Load Game',
                disabled: !this.selectedSave,
                onClick: () => {
                    this.loadSelectedSave();
                },
            },
            {
                label: this.strings.get('GUI:DeleteReplay') || 'Delete',
                disabled: !this.selectedSave,
                onClick: async () => {
                    const save = this.selectedSave;
                    if (!save) {
                        return;
                    }
                    const confirmed = await this.messageBoxApi.confirm(this.strings.get('GUI:ConfirmDeleteReplay', save.name), this.strings.get('GUI:Ok'), this.strings.get('GUI:Cancel'));
                    if (!confirmed) {
                        return;
                    }
                    try {
                        await this.replayManager.deleteReplay(save);
                    }
                    catch (error: any) {
                        this.errorHandler.handle(error, this.strings.get('GUI:DeleteReplayError'), () => { });
                        return;
                    }
                    this.selectedSave = undefined;
                    this.availableSaves = this.availableSaves.filter((entry) => entry.id !== save.id);
                    this.form?.applyOptions((options: any) => {
                        options.replays = this.availableSaves;
                        options.selectedReplay = undefined;
                        options.selectedReplayDetails = undefined;
                    });
                    this.updateSidebarButtons();
                },
            },
            {
                label: this.strings.get('GUI:Back'),
                isBottom: true,
                onClick: () => {
                    this.controller?.goToScreen(MainMenuScreenType.Home);
                },
            },
        ]);
    }
    private async loadSelectedSave(): Promise<void> {
        const save = this.selectedSave;
        if (!save) {
            return;
        }
        let replay: any;
        try {
            replay = await this.replayManager.loadReplay(save);
        }
        catch (error: any) {
            this.errorHandler.handle(error, this.strings.get('GUI:ReplayError'), () => { });
            return;
        }
        const playerName = replay.gameOpts?.humanPlayers?.[0]?.name;
        if (!playerName) {
            this.errorHandler.handle(new Error('Save has no human player'), this.strings.get('GUI:ReplayError'), () => { });
            return;
        }
        this.rootController.goToScreen(ScreenType.Game, {
            create: true,
            gameId: replay.gameId,
            timestamp: replay.gameTimestamp * 1000,
            playerName,
            gameOpts: replay.gameOpts,
            singlePlayer: true,
            tournament: false,
            mapTransfer: false,
            createPrivateGame: false,
            gservUrl: '',
            resumeReplay: replay,
            returnTo: new MainMenuRoute(MainMenuScreenType.Home, {}),
        });
    }
    async onLeave(): Promise<void> {
        this.availableSaves.length = 0;
        this.form = undefined;
        this.disposables.dispose();
        this.controller?.setMainComponent();
        await this.controller?.hideSidebarButtons();
    }
}
