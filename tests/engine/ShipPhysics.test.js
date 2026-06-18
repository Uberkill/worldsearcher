import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runShipPhysicsStep } from '../../src/components/ShipPhysics';
import { shipTransforms } from '../../src/globals';
import { Vector3, Euler, Quaternion } from 'three';

describe('ShipPhysics Integration Logic', () => {

    beforeEach(() => {
        // Setup ship global transforms state
        shipTransforms.set('default', {
            position: new Vector3(0, 0, 0),
            rotation: new Euler(0, 0, 0),
            actualPosition: new Vector3(0, 0, 0),
            actualVelocity: new Vector3(0, 0, 0)
        });
    });

    it('Should not apply manual righting torque since Pitch/Roll are locked natively', () => {
        // Mock a ship facing backward (Yaw = PI) but tilted forward slightly (Pitch = 0.1)
        const tiltedBackwardQuat = new Quaternion().setFromEuler(new Euler(0.1, Math.PI, 0, 'XYZ'));

        const rbRef = {
            current: {
                translation: () => ({ x: 0, y: 0, z: 0 }),
                rotation: () => tiltedBackwardQuat, 
                linvel: () => ({ x: 0, y: 0, z: 0 }),
                setLinvel: vi.fn(),
                setAngvel: vi.fn(),
            }
        };

        const velocityRef = { current: new Vector3(0, 0, 0) };
        const lastTimeRef = { current: performance.now() - 16 };
        const lastValidTransform = { current: { position: new Vector3(), rotation: new Euler() } };

        runShipPhysicsStep(null, lastTimeRef, true, true, rbRef, null, velocityRef, lastValidTransform, vi.fn());

        expect(rbRef.current.setAngvel).toHaveBeenCalled();
        const angvelCall = rbRef.current.setAngvel.mock.calls[0][0];

        // The physics solver natively locks X and Z via enabledRotations={[false, true, false]}
        // We should NEVER manually apply torque to those axes anymore!
        expect(angvelCall.x).toBe(0);
        expect(angvelCall.z).toBe(0);
    });

    it('Should map left steering intent to positive Y angular velocity', () => {
        const rbRef = {
            current: {
                translation: () => ({ x: 0, y: 0, z: 0 }),
                rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }), // Flat
                linvel: () => ({ x: 0, y: 0, z: 0 }),
                setLinvel: vi.fn(),
                setAngvel: vi.fn(),
            }
        };

        const velocityRef = { current: new Vector3(5.0, 0, 0) };
        const lastTimeRef = { current: performance.now() - 16 };
        const lastValidTransform = { current: { position: new Vector3(), rotation: new Euler() } };

        runShipPhysicsStep(null, lastTimeRef, true, true, rbRef, null, velocityRef, lastValidTransform, vi.fn());

        expect(rbRef.current.setAngvel).toHaveBeenCalled();
        const angvelCall = rbRef.current.setAngvel.mock.calls[0][0];

        expect(angvelCall.y).toBe(5.0);
    });

});
