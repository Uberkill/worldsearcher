const fs = require('fs');
const file = 'src/components/Player.jsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add Constants
const constMarker = 'const JUMP_FORCE = 7;';
const newConstants = `const JUMP_FORCE = 7;

const MAX_ALLOWED_VELOCITY = 60;
const CollisionLayers = {
  TERRAIN:     0x00010001, // Layer 0
  PLAYER:      0x00020002, // Layer 1
  PROJECTILES: 0x00040004, // Layer 2
  ITEMS:       0x00080008  // Layer 3
};`;
content = content.replace(constMarker, newConstants);

// 2. Add ccd and collisionGroups to RigidBody
const rigidBodyMarker = '<RigidBody\n        ref={playerRef}\n        colliders={false}\n        mass={1}\n        type="dynamic"\n        position={initialPos}\n        enabledRotations={[false, false, false]}';
const newRigidBody = `<RigidBody
        ref={playerRef}
        colliders={false}
        mass={1}
        type="dynamic"
        position={initialPos}
        enabledRotations={[false, false, false]}
        ccd={true}
        collisionGroups={CollisionLayers.PLAYER}`;
content = content.replace(rigidBodyMarker, newRigidBody);

// 3. Update world.castRay calls
content = content.replace(/world\.castRay\(new rapier\.Ray\(startPos, dir\), 200, false\);/g, 'world.castRay(new rapier.Ray(startPos, dir), 200, false, CollisionLayers.TERRAIN);');
content = content.replace(/world\.castRay\(\s*new rapier\.Ray\(\{\s*x:\s*startPos\.x,\s*y:\s*startPos\.y,\s*z:\s*startPos\.z\s*\},\{\s*x:\s*dir\.x,\s*y:\s*dir\.y,\s*z:\s*dir\.z\s*\}\),\s*50,\s*false\s*\);/g, 'world.castRay(new rapier.Ray({ x: startPos.x, y: startPos.y, z: startPos.z }, { x: dir.x, y: dir.y, z: dir.z }), 50, false, CollisionLayers.TERRAIN);');

// 4. Update useFrame for Grapple physics
const movementStart = content.indexOf('    // Movement');
const movementEnd = content.indexOf('    // Vertical Raycast (Underground check)');

const movementLogic = `    // Movement
    const state = useStore.getState();
    const grappleTarget = state.grappleTarget;

    if (grappleTarget && playerRef.current) {
        const pPos = playerRef.current.translation();
        const gTarget = new Vector3(grappleTarget[0], grappleTarget[1], grappleTarget[2]);
        const pVec = new Vector3(pPos.x, pPos.y, pPos.z);
        
        const dist = pVec.distanceTo(gTarget);
        if (dist < 2.0) {
            // Auto detach when close
            state.setGrappleTarget(null);
        } else {
            const pullDir = gTarget.sub(pVec).normalize();
            const GRAPPLE_SPEED = 30; // Strong pull
            
            // Standard WASD steering on orthogonal plane
            _frontVector.set(0, 0, moveBackward - moveForward);
            _sideVector.set(moveLeft - moveRight, 0, 0);
            _direction.subVectors(_frontVector, _sideVector).normalize().multiplyScalar(SPEED * 0.8).applyEuler(camera.rotation);
            _direction.y = 0; 

            // Combine pull and steering
            const finalVel = new Vector3(
               pullDir.x * GRAPPLE_SPEED + _direction.x,
               pullDir.y * GRAPPLE_SPEED,
               pullDir.z * GRAPPLE_SPEED + _direction.z
            );
            
            // Velocity Clamping
            const speed = finalVel.length();
            if (speed > MAX_ALLOWED_VELOCITY) {
               finalVel.multiplyScalar(MAX_ALLOWED_VELOCITY / speed);
            }
            
            playerRef.current.setLinvel(finalVel, true);
        }
        
        // We still need to update position globals so audio/raycasts work
        playerPosition.set(pPos.x, pPos.y, pPos.z);
    } else {
        // Normal Movement
        _frontVector.set(0, 0, moveBackward - moveForward);
        _sideVector.set(moveLeft - moveRight, 0, 0);
        _direction.subVectors(_frontVector, _sideVector).normalize().multiplyScalar(currentSpeed).applyEuler(camera.rotation);
    
        if (playerRef.current) {
          const linvel = playerRef.current.linvel();
          
          if (!isFlying) {
            playerRef.current.setLinvel({ x: _direction.x, y: linvel.y, z: _direction.z }, true);
          } else {
            const upVelocity = jump ? currentSpeed : (sprint ? -currentSpeed : 0);
            playerRef.current.setLinvel({ x: _direction.x, y: upVelocity, z: _direction.z }, true);
          }
          
          const trans = playerRef.current.translation();
          playerPosition.set(trans.x, trans.y, trans.z);
        }
    }

`;

content = content.substring(0, movementStart) + movementLogic + content.substring(movementEnd);

fs.writeFileSync(file, content, 'utf8');
console.log("Successfully rewrote Player.jsx!");
