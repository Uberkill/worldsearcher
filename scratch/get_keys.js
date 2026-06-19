const { worldActions } = require('./src/stores/worldActions.js');
// Mock rawSet and rawGet
const mockSet = () => {};
const mockGet = () => ({});
const actions = worldActions(mockSet, mockGet);
console.log(Object.keys(actions));
