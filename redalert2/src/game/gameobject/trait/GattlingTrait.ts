import { NotifyTick } from './interface/NotifyTick';
import { VeteranLevel } from '@/game/gameobject/unit/VeteranLevel';

// Sim ticks of sustained fire per stage. With retail RateUp=1 this reaches
// the top stage of a 3-stage gattling after ~7 seconds of continuous fire,
// matching the original's feel; retail RateDown=50 spins it down almost
// instantly when the gun goes quiet.
const STAGE_TICKS = 54;

/**
 * Yuri's gattling escalation (IsGattling=yes): the longer the weapon keeps
 * firing, the higher its stage, swapping in the faster Weapon(2n+1)/(2n+2)
 * pair via ArmedTrait.selectGattlingStage.
 */
export class GattlingTrait {
    private value: number = 0;
    private stage: number = 0;

    [NotifyTick.onTick](gameObject: any): void {
        const attackTrait = gameObject.attackTrait;
        const armedTrait = gameObject.armedTrait;
        if (!attackTrait || !armedTrait) {
            return;
        }
        const rules = gameObject.rules;
        const maxValue = Math.max(1, rules.weaponStages) * STAGE_TICKS;
        // The barrels keep spinning for as long as the gun is ENGAGED on a
        // target. The reliable engagement signal is an active Attack task
        // (buildings fire without one via opportunity fire, covered by the
        // attackState check); RateDown applies once the engagement ends.
        const currentTask = gameObject.unitOrderTrait?.getCurrentTask?.();
        const engaged = ((!!currentTask && /Attack/.test(currentTask.constructor?.name ?? '')) ||
            !attackTrait.isIdle()) &&
            !attackTrait.isDisabled();
        if (engaged) {
            this.value = Math.min(maxValue - 1, this.value + rules.rateUp);
        }
        else {
            this.value = Math.max(0, this.value - rules.rateDown);
        }
        const newStage = Math.floor(this.value / STAGE_TICKS);
        if (newStage !== this.stage) {
            this.stage = newStage;
            armedTrait.selectGattlingStage(newStage, gameObject.veteranLevel === VeteranLevel.Elite);
        }
    }

    getStage(): number {
        return this.stage;
    }
}
