interface MessageBoxApi {
    show(message: string, buttonText?: string, callback?: () => void): void;
}
interface StringsApi {
    get(key: string): string;
}
export class ErrorHandler {
    private messageBoxApi: MessageBoxApi;
    private strings: StringsApi;
    private isErrorState: boolean = false;
    constructor(messageBoxApi: MessageBoxApi, strings: StringsApi) {
        this.messageBoxApi = messageBoxApi;
        this.strings = strings;
    }
    handle(error: any, message: string, callback?: () => void): void {
        console.error("Handled error:", error);
        if (this.isErrorState) {
            // A dialog is already up. Never swallow the navigation callback —
            // the latch used to drop it, leaving the app stranded on a dead
            // screen after the second error of a session.
            callback?.();
            return;
        }
        this.isErrorState = true;
        if (callback) {
            this.messageBoxApi.show(message, this.strings.get("GUI:Ok"), () => {
                this.isErrorState = false;
                callback();
            });
        }
        else {
            // No callback means no OK button used to be shown, which left the
            // latch permanently set. Show a dismissable box so the error state
            // clears.
            this.messageBoxApi.show(message, this.strings.get("GUI:Ok"), () => {
                this.isErrorState = false;
            });
        }
    }
}
