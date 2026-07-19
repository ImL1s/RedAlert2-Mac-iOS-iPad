import { EnterBuildingTask } from "@/game/gameobject/task/EnterBuildingTask";
export class EnterBunkerTask extends EnterBuildingTask {
    isAllowed(e: any): boolean {
        return (!this.target.isDestroyed &&
            !!this.target.tankBunkerTrait &&
            !this.target.tankBunkerTrait.isOccupied() &&
            this.game.areFriendly(e, this.target));
    }
    onEnter(e: any): void {
        this.game.limboObject(e, {
            selected: false,
            controlGroup: this.game
                .getUnitSelection()
                .getOrCreateSelectionModel(e)
                .getControlGroupNumber(),
        });
        this.target.tankBunkerTrait.store(e, this.game);
    }
}
