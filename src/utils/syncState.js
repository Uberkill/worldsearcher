export const getGuestSyncData = (state, pos, rot) => {
  return {
    version: state.version || 1,
    inventory: state.inventory,
    activeHotbarIndex: state.activeHotbarIndex,
    texture: state.texture,
    coins: state.coins,
    playerHealth: state.playerHealth,
    playerMaxHealth: state.playerMaxHealth,
    playerDamageMult: state.playerDamageMult,
    playerJumpMult: state.playerJumpMult,
    playerPos: pos,
    playerRot: rot,
    isDead: state.isDead,
    playtime: state.playtime || 0,
  };
};
